import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { z } from "zod";

import { ManagementProposalV1Schema, type ManagementProposalV1 } from "../../lib/mission-control/contracts";
import { PMTurnInputV1Schema, buildPMPrompt, type PMTurnInputV1 } from "../mission-control/pm-prompt";
import { CommandTerminationError, runCommand, type CommandOptions, type CommandResult } from "./command";
import { buildPMEnvironment } from "./pm-environment";

const PM_TIMEOUT_MS = 90_000;
const PM_OUTPUT_MAX_BYTES = 64 * 1024;
const USAGE_FILE_MAX_BYTES = 16 * 1024;
const ISOLATION_PROOF_MAX_BYTES = 64 * 1024;
const MAX_PROOF_LIFETIME_MS = 900 * 1_000;
const MAX_QUALIFICATION_EVIDENCE_AGE_MS = 900 * 1_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PM_INVOCATION_POLICY_REVISION = "agentdash.pm-invocation/v2";
const PM_PROFILE_MANIFEST_REVISION = "agentdash.pm-profile-manifest/v1";
const PM_TURN_ARGV_TEMPLATE = [
  "--safe-mode",
  "--ignore-user-config",
  "--ignore-rules",
  "--no-restore-cwd",
  "--usage-file",
  "<ephemeral-usage-file>",
  "-z",
  "<bounded-pm-prompt>",
] as const;
const PM_ENVIRONMENT_KEY_NAMES = [
  "HERMES_HOME",
  "HERMES_INFERENCE_MODEL",
  "HERMES_INFERENCE_PROVIDER",
  "SystemRoot",
  "TEMP",
  "TMP",
  "WINDIR",
] as const;

export const PM_RESPONSE_TEXT = Object.freeze({
  conversation_acknowledged: "I can help with project planning and clarification.",
  clarification_required: "I need more detail before I can draft a proposal.",
  proposal_drafted: "I drafted a bounded proposal for controller review.",
  request_outside_pm_scope: "I can only discuss or draft project-management proposals.",
} as const);
export type PMResponseCode = keyof typeof PM_RESPONSE_TEXT;

const PMResponseCodeSchema = z.enum([
  "conversation_acknowledged",
  "clarification_required",
  "proposal_drafted",
  "request_outside_pm_scope",
]);

const PMInventoryEvidenceV2Schema = z.object({
  probe_args: z.tuple([
    z.literal("--safe-mode"),
    z.literal("--ignore-user-config"),
    z.literal("--ignore-rules"),
    z.literal("prompt-size"),
    z.literal("--platform"),
    z.literal("cli"),
    z.literal("--json"),
  ]),
  tool_count: z.literal(0),
  toolsets_breakdown: z.array(z.object({
    toolset: z.string().min(1).max(128),
    tool_count: z.literal(0),
  }).strict()).max(256),
  runtime_binding_sha256: z.string().regex(SHA256_PATTERN),
  raw_receipt_sha256: z.string().regex(SHA256_PATTERN),
  observed_at: z.string().datetime({ offset: true }),
}).strict();
export type PMInventoryEvidenceV2 = z.infer<typeof PMInventoryEvidenceV2Schema>;

const PMSideEffectEvidenceV2Schema = z.object({
  cases: z.tuple([
    z.literal("file_write"),
    z.literal("command_execution"),
    z.literal("browser"),
    z.literal("research"),
    z.literal("delegation"),
  ]),
  observed_side_effects: z.literal(0),
  runtime_binding_sha256: z.string().regex(SHA256_PATTERN),
  transcript_sha256: z.string().regex(SHA256_PATTERN),
  target_receipt_sha256: z.string().regex(SHA256_PATTERN),
  observed_at: z.string().datetime({ offset: true }),
}).strict();
export type PMSideEffectEvidenceV2 = z.infer<typeof PMSideEffectEvidenceV2Schema>;

const PMProfileEntryV2Schema = z.discriminatedUnion("type", [
  z.object({ path: z.string().min(1).max(1_024), type: z.literal("directory") }).strict(),
  z.object({
    path: z.string().min(1).max(1_024),
    type: z.literal("file"),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(SHA256_PATTERN),
    classification: z.literal("non_secret"),
  }).strict(),
]);
export type PMProfileEntryV2 = z.infer<typeof PMProfileEntryV2Schema>;

const PMProofIssuerV2Schema = z.object({
  key_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  algorithm: z.literal("ed25519"),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();

export const PMIsolationProofV2Schema = z.object({
  schema_version: z.literal("agentdash.pm-isolation-proof/v2"),
  level: z.literal(5),
  status: z.literal("passed"),
  run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  executable: z.object({
    path: z.string().min(1),
    sha256: z.string().regex(SHA256_PATTERN),
    version: z.string().min(1).max(256),
  }).strict(),
  profile: z.object({
    home: z.string().min(1),
    manifest_revision: z.literal(PM_PROFILE_MANIFEST_REVISION),
    entries: z.array(PMProfileEntryV2Schema).max(1_024),
    manifest_sha256: z.string().regex(SHA256_PATTERN),
  }).strict().superRefine((profile, context) => {
    for (let index = 1; index < profile.entries.length; index += 1) {
      if (profile.entries[index - 1].path.localeCompare(profile.entries[index].path) >= 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "profile entries must have unique canonical sort order" });
        break;
      }
    }
  }),
  invocation: z.object({
    policy_revision: z.literal(PM_INVOCATION_POLICY_REVISION),
    sha256: z.string().regex(SHA256_PATTERN),
  }).strict(),
  inventory: z.object({
    evidence: PMInventoryEvidenceV2Schema,
    sha256: z.string().regex(SHA256_PATTERN),
  }).strict(),
  side_effects: z.object({
    evidence: PMSideEffectEvidenceV2Schema,
    sha256: z.string().regex(SHA256_PATTERN),
  }).strict(),
  inference: z.object({
    model: z.string().min(1).max(256),
    provider: z.string().min(1).max(256),
  }).strict(),
  credentials: z.object({
    credential_set_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
    attestation_sha256: z.string().regex(SHA256_PATTERN),
  }).strict(),
  issuer: PMProofIssuerV2Schema,
  verified_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
}).strict();
export type PMIsolationProofV2 = z.infer<typeof PMIsolationProofV2Schema>;

const ManagementProposalForTurnSchema = ManagementProposalV1Schema.superRefine((proposal, context) => {
  if (proposal.intent !== "conversation_only" && proposal.intent !== "create_task") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "unsupported management intent" });
  }
  if (proposal.task_id !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "PM proposals cannot assign task identity" });
  }
});

const PMTextSchema = z.enum([
  PM_RESPONSE_TEXT.conversation_acknowledged,
  PM_RESPONSE_TEXT.clarification_required,
  PM_RESPONSE_TEXT.proposal_drafted,
  PM_RESPONSE_TEXT.request_outside_pm_scope,
]);

const PMModelOutputV1Schema = z.object({
  response_code: PMResponseCodeSchema,
  proposal: ManagementProposalForTurnSchema,
}).strict().superRefine((output, context) => {
  const expectedIntent = output.response_code === "proposal_drafted" ? "create_task" : "conversation_only";
  if (output.proposal.intent !== expectedIntent) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "PM response code does not match proposal intent" });
  }
});

export const PMTurnOutputV1Schema = z.object({
  text: PMTextSchema,
  session_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  proposal: ManagementProposalForTurnSchema,
}).strict().superRefine((output, context) => {
  const expectedIntent = output.text === PM_RESPONSE_TEXT.proposal_drafted ? "create_task" : "conversation_only";
  if (output.proposal.intent !== expectedIntent) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "PM response text does not match proposal intent" });
  }
});
export type PMTurnOutputV1 = z.infer<typeof PMTurnOutputV1Schema>;

export interface HermesPM {
  turn(input: PMTurnInputV1, options?: { signal?: AbortSignal }): Promise<PMTurnOutputV1>;
}

export type ProposalHandoff = (proposal: ManagementProposalV1) => Promise<void>;
export type PMChatDependencies = { pm: HermesPM; proposalHandoff?: ProposalHandoff };

export class PMUnavailableError extends Error {
  readonly code = "pm_unavailable";

  constructor() {
    super("The isolated project manager is unavailable.");
    this.name = "PMUnavailableError";
  }
}

export class PMOutputError extends Error {
  readonly code = "invalid_pm_output";

  constructor() {
    super("Invalid PM output.");
    this.name = "PMOutputError";
  }
}

type RunBoundary = (options: CommandOptions) => Promise<CommandResult>;

export type CreateHermesPMOptions = {
  executable: string;
  allowedExecutables: readonly string[];
  executableVersion: string;
  profileHome: string;
  isolationProofPath: string;
  inferenceModel: string;
  inferenceProvider: string;
  credentialSetRef: string;
  credentialAttestationSha256: string;
  trustedIssuer: {
    keyId: string;
    publicKeyPem: string;
  };
  environmentSource?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  run?: RunBoundary;
};

export type PMRuntimeBindingOptions = Pick<CreateHermesPMOptions,
  "executable" | "executableVersion" | "profileHome" | "inferenceModel" | "inferenceProvider" | "credentialSetRef" | "credentialAttestationSha256" | "environmentSource"
>;

export type PMRuntimeBindingsV2 = {
  executable_path: string;
  executable_sha256: string;
  profile_home: string;
  profile_manifest_sha256: string;
  invocation_sha256: string;
  environment: Readonly<Record<string, string>>;
};

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

export function computePMEvidenceDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value)), "utf8").digest("hex");
}

export function serializePMIsolationProofSigningPayload(proof: PMIsolationProofV2): string {
  return JSON.stringify(stableValue({
    ...proof,
    issuer: { key_id: proof.issuer.key_id, algorithm: proof.issuer.algorithm },
  }));
}

function hasTrustedIssuer(proof: PMIsolationProofV2, trustedIssuer: CreateHermesPMOptions["trustedIssuer"]): boolean {
  try {
    if (proof.issuer.key_id !== trustedIssuer.keyId) return false;
    const signature = Buffer.from(proof.issuer.signature, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== proof.issuer.signature) return false;
    const publicKey = createPublicKey(trustedIssuer.publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") return false;
    return verifySignature(null, Buffer.from(serializePMIsolationProofSigningPayload(proof), "utf8"), publicKey, signature);
  } catch {
    return false;
  }
}

async function sha256File(path: string): Promise<string> {
  const before = await stat(path);
  if (!before.isFile()) throw new PMUnavailableError();
  const digest = createHash("sha256");
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", rejectHash);
    stream.once("end", resolveHash);
  });
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new PMUnavailableError();
  return digest.digest("hex");
}

async function profileManifest(profileHome: string, expectedEntries: readonly PMProfileEntryV2[]): Promise<{ home: string; sha256: string }> {
  const home = await realpath(profileHome);
  const root = await stat(home);
  if (!root.isDirectory()) throw new PMUnavailableError();
  const observedEntries: Array<{ path: string; type: "directory" } | { path: string; type: "file"; size: number }> = [];

  async function visit(directory: string): Promise<void> {
    const children = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = join(directory, child.name);
      const manifestPath = relative(home, path).replaceAll("\\", "/");
      if (child.isSymbolicLink()) throw new PMUnavailableError();
      if (child.isDirectory()) {
        observedEntries.push({ path: manifestPath, type: "directory" });
        await visit(path);
      } else if (child.isFile()) {
        const metadata = await stat(path);
        observedEntries.push({ path: manifestPath, type: "file", size: metadata.size });
      } else {
        throw new PMUnavailableError();
      }
    }
  }

  await visit(home);
  observedEntries.sort((left, right) => left.path.localeCompare(right.path));
  const expectedStructure = expectedEntries.map((entry) => entry.type === "file"
    ? { path: entry.path, type: entry.type, size: entry.size }
    : { path: entry.path, type: entry.type });
  const structureMatches = () => JSON.stringify(observedEntries) === JSON.stringify(expectedStructure);
  if (!structureMatches()) throw new PMUnavailableError();

  for (const entry of expectedEntries) {
    if (entry.type !== "file") continue;
    const path = join(home, ...entry.path.split("/"));
    const linkMetadata = await lstat(path);
    if (!linkMetadata.isFile() || linkMetadata.isSymbolicLink() || linkMetadata.size !== entry.size) throw new PMUnavailableError();
    if (await sha256File(path) !== entry.sha256) throw new PMUnavailableError();
  }
  observedEntries.length = 0;
  await visit(home);
  observedEntries.sort((left, right) => left.path.localeCompare(right.path));
  if (!structureMatches()) throw new PMUnavailableError();
  return {
    home,
    sha256: computePMEvidenceDigest({ revision: PM_PROFILE_MANIFEST_REVISION, entries: expectedEntries }),
  };
}

function boundedBinding(value: string, pattern?: RegExp): string {
  if (!value || value.length > 256 || /[\0\r\n]/.test(value) || (pattern && !pattern.test(value))) throw new PMUnavailableError();
  return value;
}

function pmTurnArguments(usageFile: string, prompt: string): string[] {
  return [
    PM_TURN_ARGV_TEMPLATE[0],
    PM_TURN_ARGV_TEMPLATE[1],
    PM_TURN_ARGV_TEMPLATE[2],
    PM_TURN_ARGV_TEMPLATE[3],
    PM_TURN_ARGV_TEMPLATE[4],
    usageFile,
    PM_TURN_ARGV_TEMPLATE[6],
    prompt,
  ];
}

export async function capturePMRuntimeBindings(options: PMRuntimeBindingOptions, expectedProfileEntries: readonly PMProfileEntryV2[]): Promise<PMRuntimeBindingsV2> {
  const executablePath = await realpath(options.executable);
  const executableVersion = boundedBinding(options.executableVersion);
  const inferenceModel = boundedBinding(options.inferenceModel);
  const inferenceProvider = boundedBinding(options.inferenceProvider);
  const credentialSetRef = boundedBinding(options.credentialSetRef, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
  const credentialAttestationSha256 = boundedBinding(options.credentialAttestationSha256, SHA256_PATTERN);
  const executableSha256 = await sha256File(executablePath);
  const profile = await profileManifest(options.profileHome, expectedProfileEntries);
  const environment = Object.freeze(buildPMEnvironment({
    source: options.environmentSource ?? process.env,
    profileHome: profile.home,
    inferenceModel,
    inferenceProvider,
  }));
  const invocation = {
    policy_revision: PM_INVOCATION_POLICY_REVISION,
    executable_path: executablePath,
    executable_version: executableVersion,
    argv: PM_TURN_ARGV_TEMPLATE,
    environment_key_names: PM_ENVIRONMENT_KEY_NAMES,
    environment,
    profile_home: profile.home,
    inference_model: inferenceModel,
    inference_provider: inferenceProvider,
    credential_set_ref: credentialSetRef,
    credential_attestation_sha256: credentialAttestationSha256,
    timeout_ms: PM_TIMEOUT_MS,
    output_max_bytes: PM_OUTPUT_MAX_BYTES,
    usage_file_max_bytes: USAGE_FILE_MAX_BYTES,
    posture: {
      tools: "qualified-zero-inventory",
      rules: "ignored-by-flag",
      plugins: "profile-manifest-and-inventory-bound",
      mcp: "profile-manifest-and-inventory-bound",
      shell: false,
    },
  };
  return {
    executable_path: executablePath,
    executable_sha256: executableSha256,
    profile_home: profile.home,
    profile_manifest_sha256: profile.sha256,
    invocation_sha256: computePMEvidenceDigest(invocation),
    environment,
  };
}

async function readIsolationProof(path: string): Promise<PMIsolationProofV2> {
  if (!isAbsolute(path)) throw new PMUnavailableError();
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > ISOLATION_PROOF_MAX_BYTES) throw new PMUnavailableError();
  return PMIsolationProofV2Schema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
}

async function currentProof(options: CreateHermesPMOptions, now: Date): Promise<{ proof: PMIsolationProofV2; bindings: PMRuntimeBindingsV2 } | null> {
  try {
    const proof = await readIsolationProof(options.isolationProofPath);
    if (!hasTrustedIssuer(proof, options.trustedIssuer)) return null;
    const verifiedAt = Date.parse(proof.verified_at);
    const expiresAt = Date.parse(proof.expires_at);
    const inventoryObservedAt = Date.parse(proof.inventory.evidence.observed_at);
    const sideEffectsObservedAt = Date.parse(proof.side_effects.evidence.observed_at);
    if (verifiedAt > now.getTime() || expiresAt <= now.getTime() || expiresAt - verifiedAt > MAX_PROOF_LIFETIME_MS) return null;
    if (inventoryObservedAt > verifiedAt || sideEffectsObservedAt > verifiedAt
      || now.getTime() - inventoryObservedAt > MAX_QUALIFICATION_EVIDENCE_AGE_MS
      || now.getTime() - sideEffectsObservedAt > MAX_QUALIFICATION_EVIDENCE_AGE_MS) return null;
    if (computePMEvidenceDigest({ revision: PM_PROFILE_MANIFEST_REVISION, entries: proof.profile.entries }) !== proof.profile.manifest_sha256
      || computePMEvidenceDigest(proof.inventory.evidence) !== proof.inventory.sha256
      || computePMEvidenceDigest(proof.side_effects.evidence) !== proof.side_effects.sha256) return null;
    if (proof.inventory.evidence.runtime_binding_sha256 !== proof.invocation.sha256
      || proof.side_effects.evidence.runtime_binding_sha256 !== proof.invocation.sha256) return null;
    if (proof.inference.model !== options.inferenceModel || proof.inference.provider !== options.inferenceProvider) return null;
    if (proof.executable.version !== options.executableVersion
      || proof.credentials.credential_set_ref !== options.credentialSetRef
      || proof.credentials.attestation_sha256 !== options.credentialAttestationSha256) return null;

    const bindings = await capturePMRuntimeBindings(options, proof.profile.entries);
    const allowedCanonicalPaths = await Promise.all(options.allowedExecutables.map(async (path) => {
      try { return await realpath(path); } catch { return null; }
    }));
    if (!allowedCanonicalPaths.some((path) => path !== null && samePath(path, bindings.executable_path))) return null;
    if (!samePath(proof.executable.path, bindings.executable_path)
      || proof.executable.sha256 !== bindings.executable_sha256
      || !samePath(proof.profile.home, bindings.profile_home)
      || proof.profile.manifest_sha256 !== bindings.profile_manifest_sha256
      || proof.invocation.sha256 !== bindings.invocation_sha256) return null;
    return { proof, bindings };
  } catch {
    return null;
  }
}

async function readSessionReference(path: string, proof: PMIsolationProofV2): Promise<string> {
  const metadata = await stat(path);
  if (metadata.size <= 0 || metadata.size > USAGE_FILE_MAX_BYTES) throw new PMOutputError();
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const usage = z.object({
    session_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
    model: z.string().min(1).max(256),
    provider: z.string().min(1).max(256),
  }).passthrough().parse(parsed);
  if (usage.model !== proof.inference.model || usage.provider !== proof.inference.provider) throw new PMOutputError();
  return usage.session_id;
}

export function createHermesPM(options: CreateHermesPMOptions): HermesPM {
  const now = options.now ?? (() => new Date());
  const run = options.run ?? runCommand;

  return {
    async turn(rawInput, turnOptions = {}) {
      const input = PMTurnInputV1Schema.parse(rawInput);
      const isolation = await currentProof(options, now());
      if (!isolation) throw new PMUnavailableError();

      const directory = await mkdtemp(join(tmpdir(), "agentdash-pm-turn-"));
      const usageFile = join(directory, "usage.json");
      let cleanupSafe = true;
      try {
        const result = await run({
          executable: isolation.bindings.executable_path,
          allowedExecutables: [isolation.bindings.executable_path],
          args: pmTurnArguments(usageFile, buildPMPrompt(input)),
          cwd: directory,
          env: isolation.bindings.environment,
          timeoutMs: PM_TIMEOUT_MS,
          maxOutputBytes: PM_OUTPUT_MAX_BYTES,
          signal: turnOptions.signal,
        });
        if (result.code !== 0 || result.timedOut || result.aborted || result.outputLimitExceeded) throw new PMUnavailableError();

        let modelOutput: z.infer<typeof PMModelOutputV1Schema>;
        let sessionRef: string;
        try {
          modelOutput = PMModelOutputV1Schema.parse(JSON.parse(result.stdout) as unknown);
          sessionRef = await readSessionReference(usageFile, isolation.proof);
        } catch {
          throw new PMOutputError();
        }
        return PMTurnOutputV1Schema.parse({
          text: PM_RESPONSE_TEXT[modelOutput.response_code],
          session_ref: sessionRef,
          proposal: modelOutput.proposal,
        });
      } catch (caught) {
        if (caught instanceof CommandTerminationError) {
          cleanupSafe = false;
          throw new PMUnavailableError();
        }
        throw caught;
      } finally {
        if (cleanupSafe) await rm(directory, { force: true, recursive: true });
      }
    },
  };
}

export const unavailableHermesPM: HermesPM = {
  async turn(): Promise<never> {
    throw new PMUnavailableError();
  },
};

/** Task 6 replaces this fail-closed production seam with the durable intake controller. */
export function getPMChatDependencies(): PMChatDependencies {
  return { pm: unavailableHermesPM };
}

export type { ManagementProposalV1 };
