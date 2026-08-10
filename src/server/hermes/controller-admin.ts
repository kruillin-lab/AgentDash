import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";

import { z } from "zod";

import { canonicalDigest } from "../../lib/mission-control/contracts";
import { createCommandRunner, type CommandOptions, type CommandResult } from "./command";

const PROTOCOL = "hermes-kanban-controller-admin/1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

const IdentifierSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const UuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const GitObjectSchema = z.string().regex(/^[0-9a-f]{40}$/);
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const GenerationSchema = z.number().int().positive().safe();
const TimestampSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .datetime({ offset: true });
const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine((value) => {
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 && decoded.toString("base64url") === value;
  } catch {
    return false;
  }
});

const AdminOperationSchema = z.enum([
  "capability-bootstrap",
  "capability-rotate-stage",
  "capability-rotate-probe",
  "capability-revoke",
  "capability-status",
]);
type AdminOperation = z.infer<typeof AdminOperationSchema>;

const BootstrapAuthorizationSchema = z.object({ kind: z.literal("os_identity_bootstrap") }).strict();
const ActiveAuthorizationSchema = z.object({
  kind: z.literal("active_capability"),
  capability_id: IdentifierSchema,
  generation: GenerationSchema,
  token: TokenSchema,
}).strict();
const StagedAuthorizationSchema = z.object({
  kind: z.literal("staged_capability"),
  capability_id: IdentifierSchema,
  generation: GenerationSchema,
  token: TokenSchema,
}).strict();

function validityWindow<T extends { not_before: string; not_after: string }>(value: T, context: z.RefinementCtx): void {
  if (Date.parse(value.not_after) <= Date.parse(value.not_before)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["not_after"], message: "invalid validity window" });
  }
}

const BootstrapPayloadSchema = z.object({
  board_uuid: UuidSchema,
  candidate_commit: GitObjectSchema,
  candidate_tree: GitObjectSchema,
  executable_sha256: DigestSchema,
  capability_id: IdentifierSchema,
  generation: z.literal(1),
  token: TokenSchema,
  allowed_operation_digest: DigestSchema,
  not_before: TimestampSchema,
  not_after: TimestampSchema,
}).strict().superRefine(validityWindow);

const RotateStagePayloadSchema = z.object({
  new_capability_id: IdentifierSchema,
  new_generation: GenerationSchema,
  new_token: TokenSchema,
  allowed_operation_digest: DigestSchema,
  not_before: TimestampSchema,
  not_after: TimestampSchema,
  expected_active_generation: GenerationSchema,
}).strict().superRefine(validityWindow);

const RotateProbePayloadSchema = z.object({
  expected_previous_capability_id: IdentifierSchema,
  expected_previous_generation: GenerationSchema,
}).strict();

const RevokePayloadSchema = z.object({
  target_capability_id: IdentifierSchema,
  target_generation: GenerationSchema,
  reason_code: z.enum(["compromised", "rotated", "operator_retired", "test_cleanup"]),
  expected_active_generation: GenerationSchema,
}).strict();

const BootstrapResultSchema = z.object({
  board_uuid: UuidSchema,
  capability_id: IdentifierSchema,
  generation: z.literal(1),
  state: z.literal("active"),
  schema_version: GenerationSchema,
  candidate_commit: GitObjectSchema,
  candidate_tree: GitObjectSchema,
  executable_sha256: DigestSchema,
}).strict();

const RotateStageResultSchema = z.object({
  board_uuid: UuidSchema,
  capability_id: IdentifierSchema,
  generation: GenerationSchema,
  state: z.literal("staged"),
}).strict();

const RotateProbeResultSchema = z.object({
  board_uuid: UuidSchema,
  capability_id: IdentifierSchema,
  generation: GenerationSchema,
  state: z.literal("active"),
  revoked_capability_id: IdentifierSchema,
  revoked_generation: GenerationSchema,
}).strict();

const RevokeResultSchema = z.object({
  board_uuid: UuidSchema,
  capability_id: IdentifierSchema,
  generation: GenerationSchema,
  state: z.literal("revoked"),
}).strict();

const CapabilityStatusRowSchema = z.object({
  capability_id: IdentifierSchema,
  generation: GenerationSchema,
  state: z.enum(["staged", "active", "revoked"]),
  allowed_operation_digest: DigestSchema,
  not_before: TimestampSchema,
  not_after: TimestampSchema,
}).strict().superRefine(validityWindow);

const StatusResultSchema = z.object({
  board_uuid: UuidSchema,
  schema_version: GenerationSchema,
  candidate_commit: GitObjectSchema,
  candidate_tree: GitObjectSchema,
  executable_sha256: DigestSchema,
  active_generation: GenerationSchema,
  capabilities: z.array(CapabilityStatusRowSchema),
}).strict().superRefine((value, context) => {
  let previous = 0;
  const generations = new Set<number>();
  const identifiers = new Set<string>();
  for (const [index, capability] of value.capabilities.entries()) {
    if (capability.generation <= previous || generations.has(capability.generation) || identifiers.has(capability.capability_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["capabilities", index], message: "capabilities must be unique and generation-ascending" });
    }
    previous = capability.generation;
    generations.add(capability.generation);
    identifiers.add(capability.capability_id);
  }
  const active = value.capabilities.filter((capability) => capability.state === "active");
  if (active.length !== 1 || active[0]?.generation !== value.active_generation) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["active_generation"], message: "active generation mismatch" });
  }
});

const DomainErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("unauthorized"), message: z.literal("The controller capability is not authorized."), disposition: z.literal("operator_action") }).strict(),
  z.object({ code: z.literal("invalid_request"), message: z.literal("The controller request is invalid."), disposition: z.literal("do_not_retry") }).strict(),
  z.object({ code: z.literal("conflict"), message: z.literal("The controller state conflicts with this request."), disposition: z.literal("reconcile") }).strict(),
  z.object({ code: z.literal("stale_revision"), message: z.literal("The controller revision is stale."), disposition: z.literal("reconcile") }).strict(),
  z.object({ code: z.literal("not_found"), message: z.literal("The requested controller record was not found."), disposition: z.literal("do_not_retry") }).strict(),
  z.object({ code: z.literal("migration_required"), message: z.literal("The controller schema requires operator migration."), disposition: z.literal("operator_action") }).strict(),
  z.object({ code: z.literal("busy"), message: z.literal("The controller database is busy."), disposition: z.literal("reconcile") }).strict(),
  z.object({ code: z.literal("isolation_required"), message: z.literal("Controller isolation is not proven."), disposition: z.literal("operator_action") }).strict(),
  z.object({ code: z.literal("bootstrap_forbidden"), message: z.literal("Controller bootstrap is not permitted."), disposition: z.literal("operator_action") }).strict(),
  z.object({ code: z.literal("internal_unknown"), message: z.literal("The controller outcome is unknown."), disposition: z.literal("reconcile") }).strict(),
]);

const SuccessResponseSchema = z.object({
  protocol: z.literal(PROTOCOL),
  request_id: IdentifierSchema,
  operation: AdminOperationSchema,
  ok: z.literal(true),
  result_digest: DigestSchema,
  result: z.unknown(),
  error: z.null(),
  observed_at: TimestampSchema,
}).strict();

const DomainErrorResponseSchema = z.object({
  protocol: z.literal(PROTOCOL),
  request_id: IdentifierSchema,
  operation: AdminOperationSchema,
  ok: z.literal(false),
  result_digest: z.null(),
  result: z.null(),
  error: DomainErrorSchema,
  observed_at: TimestampSchema,
}).strict();

const ResponseSchema = z.discriminatedUnion("ok", [SuccessResponseSchema, DomainErrorResponseSchema]);

type Runner = (options: CommandOptions) => Promise<CommandResult>;
type ActiveAuthorization = z.input<typeof ActiveAuthorizationSchema>;
type StagedAuthorization = z.input<typeof StagedAuthorizationSchema>;

export type CapabilityBootstrapInput = z.input<typeof BootstrapPayloadSchema>;
export type CapabilityRotateStageInput = z.input<typeof RotateStagePayloadSchema>;
export type CapabilityRotateProbeInput = z.input<typeof RotateProbePayloadSchema>;
export type CapabilityRevokeInput = z.input<typeof RevokePayloadSchema>;
export type CapabilityBootstrapResult = z.output<typeof BootstrapResultSchema>;
export type CapabilityRotateStageResult = z.output<typeof RotateStageResultSchema>;
export type CapabilityRotateProbeResult = z.output<typeof RotateProbeResultSchema>;
export type CapabilityRevokeResult = z.output<typeof RevokeResultSchema>;
export type CapabilityStatusResult = z.output<typeof StatusResultSchema>;

export type HermesControllerAdminOptions = Readonly<{
  executable: string;
  expectedExecutableSha256: string;
  expectedBoardUuid: string;
  cwd: string;
  runner?: Runner;
  readExecutable?: (path: string) => Promise<Uint8Array>;
  assertExecutableProtected: (input: Readonly<{ path: string; expectedSha256: string }>) => Promise<void>;
  requestId?: () => string;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
}>;

export class HermesControllerAdminTransportError extends Error {
  readonly code = "unknown";

  constructor(message = "The Hermes controller admin outcome is unknown.") {
    super(message);
    this.name = "HermesControllerAdminTransportError";
  }
}

export class HermesControllerAdminDomainError extends Error {
  constructor(
    readonly code: z.output<typeof DomainErrorSchema>["code"],
    readonly disposition: z.output<typeof DomainErrorSchema>["disposition"],
    message: string,
  ) {
    super(message);
    this.name = "HermesControllerAdminDomainError";
  }
}

function invalidInput(label: string): Error {
  return new Error(`Hermes controller admin ${label} is invalid.`);
}

function parseInput<S extends z.ZodTypeAny>(schema: S, value: unknown, label: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidInput(label);
  return parsed.data;
}

function parseStrictJson(text: string): unknown {
  let index = 0;
  const skipWhitespace = (): void => {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[index])) index += 1;
  };
  const parseString = (): string => {
    if (text[index] !== "\"") throw new SyntaxError("invalid JSON");
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === "\"") {
        index += 1;
        return JSON.parse(text.slice(start, index)) as string;
      }
      if (character === "\\") {
        index += 1;
        const escape = text[index];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index + 1, index + 5))) throw new SyntaxError("invalid JSON");
          index += 5;
          continue;
        }
        if (escape === undefined || !"\"\\/bfnrt".includes(escape)) throw new SyntaxError("invalid JSON");
        index += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) throw new SyntaxError("invalid JSON");
      index += 1;
    }
    throw new SyntaxError("invalid JSON");
  };
  const parseValue = (depth: number): void => {
    if (depth > 128) throw new SyntaxError("invalid JSON");
    skipWhitespace();
    const character = text[index];
    if (character === "{") {
      index += 1;
      skipWhitespace();
      if (text[index] === "}") { index += 1; return; }
      const keys = new Set<string>();
      while (true) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) throw new SyntaxError("invalid JSON");
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ":") throw new SyntaxError("invalid JSON");
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "}") { index += 1; return; }
        if (text[index] !== ",") throw new SyntaxError("invalid JSON");
        index += 1;
      }
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") { index += 1; return; }
      while (true) {
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "]") { index += 1; return; }
        if (text[index] !== ",") throw new SyntaxError("invalid JSON");
        index += 1;
      }
    }
    if (character === "\"") { parseString(); return; }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) { index += literal.length; return; }
    }
    const number = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (number === undefined) throw new SyntaxError("invalid JSON");
    index += number.length;
  };

  parseValue(0);
  skipWhitespace();
  if (index !== text.length) throw new SyntaxError("invalid JSON");
  return JSON.parse(text) as unknown;
}

function assertEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new HermesControllerAdminTransportError("The Hermes controller admin result is invalid.");
}

export class HermesControllerAdmin {
  private readonly runner: Runner;
  private readExecutable: (path: string) => Promise<Uint8Array>;
  private assertExecutableProtected: HermesControllerAdminOptions["assertExecutableProtected"];
  private readonly requestId: () => string;
  private readonly timeoutMs: number;
  private readonly maxInputBytes: number;
  private readonly maxOutputBytes: number;

  constructor(private readonly options: HermesControllerAdminOptions) {
    if (!isAbsolute(options.executable)
      || (process.platform === "win32" && extname(options.executable).toLowerCase() !== ".exe")
      || !isAbsolute(options.cwd)
      || !DigestSchema.safeParse(options.expectedExecutableSha256).success
      || !UuidSchema.safeParse(options.expectedBoardUuid).success) {
      throw new Error("Hermes controller admin configuration is invalid.");
    }
    this.runner = options.runner ?? createCommandRunner();
    this.readExecutable = options.readExecutable ?? readFile;
    this.assertExecutableProtected = options.assertExecutableProtected;
    this.requestId = options.requestId ?? randomUUID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (![this.timeoutMs, this.maxInputBytes, this.maxOutputBytes].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error("Hermes controller admin transport bounds are invalid.");
    }
  }

  private async invoke<S extends z.ZodTypeAny>(
    operation: AdminOperation,
    authorization: unknown,
    payload: unknown,
    resultSchema: S,
    tokens: readonly string[],
  ): Promise<z.output<S>> {
    let executable: Uint8Array;
    try {
      executable = await this.readExecutable(this.options.executable);
    } catch {
      throw new Error("Hermes controller admin executable could not be verified.");
    }
    const actualHash = createHash("sha256").update(executable).digest("hex");
    if (actualHash !== this.options.expectedExecutableSha256) {
      throw new Error("Hermes controller admin executable no longer matches the reviewed launcher.");
    }
    try {
      await this.assertExecutableProtected({ path: this.options.executable, expectedSha256: actualHash });
    } catch {
      throw new Error("Hermes controller admin executable is not protected against replacement.");
    }

    const requestId = this.requestId();
    if (!IdentifierSchema.safeParse(requestId).success) throw new Error("Hermes controller admin request identity is invalid.");
    const request = {
      protocol: PROTOCOL,
      request_id: requestId,
      operation,
      authorization,
      payload_digest: canonicalDigest(payload),
      payload,
    };
    const stdin = JSON.stringify(request);
    if (Buffer.byteLength(stdin, "utf8") > this.maxInputBytes) throw invalidInput("request size");
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;

    let commandResult: CommandResult;
    try {
      commandResult = await this.runner({
        executable: this.options.executable,
        allowedExecutables: [this.options.executable],
        args: [operation],
        env: {
          SystemRoot: systemRoot,
          WINDIR: systemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          NODE_ENV: "production",
        },
        cwd: this.options.cwd,
        stdin,
        timeoutMs: this.timeoutMs,
        maxOutputBytes: this.maxOutputBytes,
        redactValues: [...new Set(tokens)],
      });
    } catch {
      throw new HermesControllerAdminTransportError();
    }

    if (commandResult.code !== 0
      || commandResult.signal !== null
      || commandResult.timedOut
      || commandResult.aborted
      || commandResult.outputLimitExceeded
      || commandResult.stderr !== ""
      || commandResult.stdout === "") {
      throw new HermesControllerAdminTransportError();
    }

    let decoded: unknown;
    try {
      decoded = parseStrictJson(commandResult.stdout);
    } catch {
      throw new HermesControllerAdminTransportError();
    }
    const parsedResponse = ResponseSchema.safeParse(decoded);
    if (!parsedResponse.success) throw new HermesControllerAdminTransportError("The Hermes controller admin response is invalid.");
    const response = parsedResponse.data;
    if (response.request_id !== requestId || response.operation !== operation) {
      throw new HermesControllerAdminTransportError("The Hermes controller admin response identity is invalid.");
    }
    if (!response.ok) {
      throw new HermesControllerAdminDomainError(response.error.code, response.error.disposition, response.error.message);
    }
    if (response.result_digest !== canonicalDigest(response.result)) {
      throw new HermesControllerAdminTransportError("The Hermes controller admin result digest is invalid.");
    }
    const parsedResult = resultSchema.safeParse(response.result);
    if (!parsedResult.success) throw new HermesControllerAdminTransportError("The Hermes controller admin result is invalid.");
    if ((parsedResult.data as { board_uuid?: unknown }).board_uuid !== this.options.expectedBoardUuid) {
      throw new HermesControllerAdminTransportError("The Hermes controller admin board identity is invalid.");
    }
    return parsedResult.data;
  }

  async bootstrap(input: CapabilityBootstrapInput): Promise<CapabilityBootstrapResult> {
    const payload = parseInput(BootstrapPayloadSchema, input, "request");
    if (payload.board_uuid !== this.options.expectedBoardUuid) throw invalidInput("board identity");
    if (payload.executable_sha256 !== this.options.expectedExecutableSha256) throw invalidInput("request");
    const authorization = BootstrapAuthorizationSchema.parse({ kind: "os_identity_bootstrap" });
    const result = await this.invoke("capability-bootstrap", authorization, payload, BootstrapResultSchema, [payload.token]);
    assertEqual(result.board_uuid, payload.board_uuid);
    assertEqual(result.capability_id, payload.capability_id);
    assertEqual(result.generation, payload.generation);
    assertEqual(result.candidate_commit, payload.candidate_commit);
    assertEqual(result.candidate_tree, payload.candidate_tree);
    assertEqual(result.executable_sha256, payload.executable_sha256);
    return result;
  }

  async rotateStage(authorizationInput: ActiveAuthorization, input: CapabilityRotateStageInput): Promise<CapabilityRotateStageResult> {
    const authorization = parseInput(ActiveAuthorizationSchema, authorizationInput, "authorization");
    const payload = parseInput(RotateStagePayloadSchema, input, "request");
    if (payload.expected_active_generation !== authorization.generation
      || payload.new_generation !== authorization.generation + 1) {
      throw invalidInput("generation transition");
    }
    const result = await this.invoke("capability-rotate-stage", authorization, payload, RotateStageResultSchema, [authorization.token, payload.new_token]);
    assertEqual(result.capability_id, payload.new_capability_id);
    assertEqual(result.generation, payload.new_generation);
    return result;
  }

  async rotateProbe(authorizationInput: StagedAuthorization, input: CapabilityRotateProbeInput): Promise<CapabilityRotateProbeResult> {
    const authorization = parseInput(StagedAuthorizationSchema, authorizationInput, "authorization");
    const payload = parseInput(RotateProbePayloadSchema, input, "request");
    if (authorization.generation <= 1 || payload.expected_previous_generation !== authorization.generation - 1) {
      throw invalidInput("generation transition");
    }
    const result = await this.invoke("capability-rotate-probe", authorization, payload, RotateProbeResultSchema, [authorization.token]);
    assertEqual(result.capability_id, authorization.capability_id);
    assertEqual(result.generation, authorization.generation);
    assertEqual(result.revoked_capability_id, payload.expected_previous_capability_id);
    assertEqual(result.revoked_generation, payload.expected_previous_generation);
    return result;
  }

  async revoke(authorizationInput: ActiveAuthorization, input: CapabilityRevokeInput): Promise<CapabilityRevokeResult> {
    const authorization = parseInput(ActiveAuthorizationSchema, authorizationInput, "authorization");
    const payload = parseInput(RevokePayloadSchema, input, "request");
    if (payload.expected_active_generation !== authorization.generation) throw invalidInput("generation transition");
    const result = await this.invoke("capability-revoke", authorization, payload, RevokeResultSchema, [authorization.token]);
    assertEqual(result.capability_id, payload.target_capability_id);
    assertEqual(result.generation, payload.target_generation);
    return result;
  }

  async status(authorizationInput: ActiveAuthorization): Promise<CapabilityStatusResult> {
    const authorization = parseInput(ActiveAuthorizationSchema, authorizationInput, "authorization");
    const result = await this.invoke("capability-status", authorization, {}, StatusResultSchema, [authorization.token]);
    assertEqual(result.executable_sha256, this.options.expectedExecutableSha256);
    assertEqual(result.active_generation, authorization.generation);
    const active = result.capabilities.find((capability) => capability.state === "active");
    assertEqual(active?.capability_id, authorization.capability_id);
    return result;
  }
}
