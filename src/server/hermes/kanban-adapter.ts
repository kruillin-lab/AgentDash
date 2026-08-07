import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { z } from "zod";

import {
  ActivateMandateResultSchema,
  ActivationSnapshotV1Schema,
  EnsureArtifactResultSchema,
  LookupActivationByCommandResultSchema,
  LookupIntakeResultSchema,
  MissionControlBoardV1Schema,
  PersistIntakeResultSchema,
  PreparedActionResultSchema,
  RedactedPayloadV1Schema,
  TimestampSchema,
  canonicalDigest,
  type ActivateMandateInput,
  type ActivateMandateResult,
  type ActivationSnapshotV1,
  type AppendRunEventInput,
  type BindWorkerSessionInput,
  type CloseActionInput,
  type EnsureArtifactInput,
  type EnsureArtifactResult,
  type LookupActivationByCommandResult,
  type LookupIntakeResult,
  type MissionControlBoardV1,
  type PersistIntakeInput,
  type PersistIntakeResult,
  type PrepareActionInput,
  type PreparedActionResult,
  type SetCEOInputInput,
  type TerminalIntentInput,
} from "../../lib/mission-control/contracts";
import type { HermesPort } from "../mission-control/ports";

import { createCommandRunner, type CommandOptions, type CommandResult } from "./command";

const PROTOCOL = "hermes-kanban-controller/1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const BridgeErrorSchema = z.object({ code: z.string().min(1), message: z.string().min(1), disposition: z.string().min(1) }).strict();
const BridgeResponseSchema = z.discriminatedUnion("ok", [
  z.object({ protocol: z.literal(PROTOCOL), request_id: z.string(), operation: z.string(), ok: z.literal(true), result_digest: z.string().regex(DIGEST), result: z.unknown(), error: z.null(), observed_at: TimestampSchema }).strict(),
  z.object({ protocol: z.literal(PROTOCOL), request_id: z.string().nullable(), operation: z.string().nullable(), ok: z.literal(false), result_digest: z.null(), result: z.null(), error: BridgeErrorSchema, observed_at: TimestampSchema }).strict(),
]);

const IntakeLookupRawSchema = z.discriminatedUnion("found", [
  z.object({ found: z.literal(false), request_id: z.string() }).strict(),
  z.object({ found: z.literal(true), request_id: z.string(), request_digest: z.string().regex(DIGEST), task_id: z.string(), claim_id: z.string(), claim_generation: z.number().int().positive().safe(), staged_pm_digest: z.string().regex(DIGEST), card_authorization_digest: z.string().regex(DIGEST), artifact_digest: z.string().regex(DIGEST), readiness: z.unknown(), readiness_digest: z.string().regex(DIGEST), created_at: TimestampSchema }).strict(),
]);
const IntakePersistRawSchema = z.object({ created: z.boolean(), request_digest: z.string().regex(DIGEST), task_id: z.string(), claim_id: z.string(), claim_generation: z.number().int().positive().safe(), readiness_digest: z.string().regex(DIGEST) }).strict();
const ArtifactRawSchema = z.object({ created: z.boolean(), task_id: z.string(), artifact_id: z.string(), artifact_key: z.string(), digest: z.string().regex(DIGEST) }).strict();
const ActivationRawSchema = z.object({ created: z.boolean(), command_id: z.string(), task_id: z.string(), task_spec_revision: z.number().int().nonnegative().safe(), mandate_id: z.string(), activation_digest: z.string().regex(DIGEST) }).strict();
const PrepareRawSchema = z.object({ created: z.boolean(), task_id: z.string(), run_id: z.string(), command_id: z.string(), command_digest: z.string().regex(DIGEST), command: z.unknown() }).strict();
const BindRawSchema = z.object({ created: z.boolean(), task_id: z.string(), run_id: z.string(), command_id: z.string(), binding_digest: z.string().regex(DIGEST) }).strict();
const EventRawSchema = z.object({ created: z.boolean(), task_id: z.string(), run_id: z.string(), event_id: z.string(), sequence: z.number().int().positive().safe(), digest: z.string().regex(DIGEST) }).strict();
const CloseRawSchema = z.object({ created: z.boolean(), task_id: z.string(), run_id: z.string(), outcome_digest: z.string().regex(DIGEST), receipt_digest: z.string().regex(DIGEST) }).strict();
const CEOInputRawSchema = z.object({ changed: z.boolean(), task_id: z.string(), revision: z.number().int().nonnegative().safe(), ceo_input_digest: z.string().regex(DIGEST) }).strict();
const TerminalRawSchema = z.object({ created: z.boolean(), task_id: z.string(), outcome_digest: z.string().regex(DIGEST), receipt_digest: z.string().regex(DIGEST) }).strict();
const BoardTaskRawSchema = z.object({ task_id: z.string(), title: z.string(), body: z.string(), status: z.string(), priority: z.number().int(), created_at: z.number().int(), updated_at: TimestampSchema, request_digest: z.string().regex(DIGEST), revision: z.number().int().nonnegative(), ceo_input: z.unknown().nullable(), ceo_input_digest: z.string().regex(DIGEST).nullable(), terminal_state: z.string(), terminal_intent: z.unknown().nullable(), terminal_intent_digest: z.string().regex(DIGEST).nullable(), terminal_receipt_digest: z.string().regex(DIGEST).nullable(), runs: z.array(z.unknown()) }).strict();
const BoardRawSchema = z.object({ generated_at: TimestampSchema, tasks: z.array(BoardTaskRawSchema), archived_count: z.number().int().nonnegative().safe() }).strict();

type BridgeOperation = "intake-lookup" | "intake-persist" | "artifact-ensure" | "activation-snapshot" | "activation-lookup" | "mandate-activate" | "action-prepare" | "run-bind" | "run-event" | "run-close" | "ceo-input-set" | "terminal-intent" | "project-board";
type Runner = (options: CommandOptions) => Promise<CommandResult>;

export type HermesKanbanAdapterOptions = Readonly<{
  executable: string;
  expectedExecutableSha256: string;
  cwd: string;
  boardId: string;
  capability: Readonly<{ capabilityId: string; generation: number; token: string }>;
  runner?: Runner;
  readExecutable?: (path: string) => Promise<Uint8Array>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}>;

export class HermesBridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "HermesBridgeError";
  }
}

function deterministicId(prefix: string, value: unknown): string {
  return `${prefix}_${canonicalDigest(value).slice(0, 32)}`;
}

function boardPayload(task: z.infer<typeof BoardTaskRawSchema>) {
  return RedactedPayloadV1Schema.parse({ redacted: true, digest: canonicalDigest(task), summary: `${task.title} — ${task.status}`.slice(0, 4096) });
}

export class HermesKanbanAdapter implements HermesPort {
  private readonly runner: Runner;
  private readonly readExecutable: (path: string) => Promise<Uint8Array>;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(readonly options: HermesKanbanAdapterOptions) {
    if (!isAbsolute(options.executable) || !isAbsolute(options.cwd) || !DIGEST.test(options.expectedExecutableSha256) || !UUID.test(options.boardId)) throw new Error("Hermes bridge configuration is invalid.");
    if (!Number.isSafeInteger(options.capability.generation) || options.capability.generation <= 0 || !/^[A-Za-z0-9_-]{43}$/.test(options.capability.token)) throw new Error("Hermes capability configuration is invalid.");
    this.runner = options.runner ?? createCommandRunner();
    this.readExecutable = options.readExecutable ?? readFile;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || !Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes <= 0) throw new Error("Hermes transport bounds are invalid.");
  }

  private async invoke<S extends z.ZodTypeAny>(operation: BridgeOperation, payload: unknown, schema: S): Promise<z.output<S>> {
    const executable = await this.readExecutable(this.options.executable);
    const actualHash = createHash("sha256").update(executable).digest("hex");
    if (actualHash !== this.options.expectedExecutableSha256) throw new Error("Hermes executable no longer matches the reviewed launcher.");
    const requestId = deterministicId("agentdash", { operation, payload });
    const request = {
      protocol: PROTOCOL,
      request_id: requestId,
      operation,
      board_id: this.options.boardId,
      authorization: { kind: "active_capability", capability_id: this.options.capability.capabilityId, generation: this.options.capability.generation, token: this.options.capability.token },
      payload_digest: canonicalDigest(payload),
      payload,
    };
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    const result = await this.runner({
      executable: this.options.executable,
      allowedExecutables: [this.options.executable],
      args: [operation],
      env: { SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: "production" },
      cwd: this.options.cwd,
      stdin: JSON.stringify(request),
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
      redactValues: [this.options.capability.token],
    });
    if (result.code !== 0 || result.signal !== null || result.timedOut || result.aborted || result.outputLimitExceeded || result.stderr !== "") throw new HermesBridgeError("transport_failure", "The sealed Hermes bridge did not complete cleanly.");
    let decoded: unknown;
    try { decoded = JSON.parse(result.stdout); } catch { throw new HermesBridgeError("malformed_response", "Hermes returned malformed JSON."); }
    const response = BridgeResponseSchema.parse(decoded);
    if (response.request_id !== requestId || response.operation !== operation) throw new HermesBridgeError("identity_mismatch", "Hermes returned a response for a different request.");
    if (!response.ok) throw new HermesBridgeError(response.error.code, response.error.message);
    if (response.result_digest !== canonicalDigest(response.result)) throw new HermesBridgeError("digest_mismatch", "Hermes returned a result with an invalid digest.");
    return schema.parse(response.result);
  }

  async lookupIntake(request_id: string): Promise<LookupIntakeResult> {
    const raw = await this.invoke("intake-lookup", { request_id }, IntakeLookupRawSchema);
    if (!raw.found) return { status: "not_found" };
    return LookupIntakeResultSchema.parse({ status: "found", request_digest: raw.request_digest, task_id: raw.task_id, artifact_digest: raw.artifact_digest, readiness: raw.readiness });
  }

  async persistIntake(input: PersistIntakeInput): Promise<PersistIntakeResult> {
    const raw = await this.invoke("intake-persist", { request_id: input.request_id, request_digest: input.request_digest, title: input.readiness.task_spec.title, body: input.readiness.task_spec.objective, priority: 1, claim_id: input.claim_id, claim_generation: input.claim_generation, staged_pm_digest: input.staged_pm_digest, card_authorization_digest: input.card_authorization_digest, artifact_digest: input.artifact_digest, readiness: input.readiness }, IntakePersistRawSchema);
    return PersistIntakeResultSchema.parse({ status: raw.created ? "created" : "existing", request_digest: raw.request_digest, task_id: raw.task_id, artifact_digest: input.artifact_digest, readiness: input.readiness });
  }

  async ensureArtifact(input: EnsureArtifactInput): Promise<EnsureArtifactResult> {
    const artifact_id = deterministicId("artifact", { task_id: input.task_id, artifact_key: input.artifact_key, digest: input.digest });
    const raw = await this.invoke("artifact-ensure", { ...input, artifact_id }, ArtifactRawSchema);
    return EnsureArtifactResultSchema.parse({ artifact_id: raw.artifact_id, created: raw.created, digest: raw.digest });
  }

  async getActivationSnapshot(task_id: string): Promise<ActivationSnapshotV1> {
    return this.invoke("activation-snapshot", { task_id }, ActivationSnapshotV1Schema);
  }

  async lookupActivationByCommand(command_id: string): Promise<LookupActivationByCommandResult> {
    return this.invoke("activation-lookup", { command_id }, LookupActivationByCommandResultSchema);
  }

  async activateMandate(input: ActivateMandateInput): Promise<ActivateMandateResult> {
    const q = input.qualification;
    const raw = await this.invoke("mandate-activate", { command_id: input.command.command_id, task_id: input.task_id, request_digest: input.request_digest, task_spec_revision: input.source_task_spec.plan_revision, task_spec_digest: input.task_spec_digest, mandate_id: input.mandate.mandate_id, mandate_digest: input.mandate_digest, source_snapshot_digest: input.expected_snapshot_digest, qualification_digest: q.qualification_digest, route_registry_revision: q.route_registry_revision, route_registry_snapshot_token: q.route_registry_snapshot_token, route_snapshot_digest: q.route_snapshot_digest, valid_until: input.grant.expires_at, replay_binding_digest: input.replay_binding_digest, consumed_at_ms: input.consumed_at, approval_authority_id: input.grant.authority_id, activation: input }, ActivationRawSchema);
    return ActivateMandateResultSchema.parse({ status: raw.created ? "activated" : "existing", ...input.result });
  }

  async prepareAction(input: PrepareActionInput): Promise<PreparedActionResult> {
    const run_id = deterministicId("controller_run", input.command);
    const raw = await this.invoke("action-prepare", { task_id: input.task_id, run_id, authority_id: input.authority.authority_id, mandate_id: input.authority.mandate_id, mandate_digest: input.authority.mandate_digest, node_id: input.authority.node_id, authority: input.authority, authority_digest: canonicalDigest(input.authority), issued_at: input.authority.issued_at, expires_at: input.authority.expires_at, command_id: input.command.command_id, idempotency_key: input.command.idempotency_key, command: input.command, command_digest: canonicalDigest(input.command), command_headroom: input.command_headroom, task_reserve_refs: input.task_reserve_refs, launch_intent_digest: input.launch_intent_digest }, PrepareRawSchema);
    return PreparedActionResultSchema.parse({ run_id: raw.run_id, command: raw.command, created: raw.created });
  }

  async bindWorkerSession(input: BindWorkerSessionInput): Promise<void> { await this.invoke("run-bind", input, BindRawSchema); }
  async appendRunEvent(input: AppendRunEventInput): Promise<void> { await this.invoke("run-event", input, EventRawSchema); }
  async closeAction(input: CloseActionInput): Promise<void> { await this.invoke("run-close", input, CloseRawSchema); }
  async setCEOInput(input: SetCEOInputInput): Promise<void> { await this.invoke("ceo-input-set", input, CEOInputRawSchema); }
  async commitTerminalIntent(input: TerminalIntentInput): Promise<void> { await this.invoke("terminal-intent", input, TerminalRawSchema); }

  async projectBoard(): Promise<MissionControlBoardV1> {
    const raw = await this.invoke("project-board", {}, BoardRawSchema);
    const lanes: MissionControlBoardV1["lanes"] = { ready: [], working: [], needs_you: [], stopped: [], completed: [] };
    for (const task of raw.tasks) {
      const payload = boardPayload(task);
      if (task.status === "done") lanes.completed.push(payload);
      else if (task.ceo_input !== null) lanes.needs_you.push(payload);
      else if (task.status === "in_progress") lanes.working.push(payload);
      else if (task.status === "blocked") lanes.stopped.push(payload);
      else lanes.ready.push(payload);
    }
    return MissionControlBoardV1Schema.parse({ generated_at: raw.generated_at, lanes, archived_count: raw.archived_count, unavailable_reason: null });
  }
}
