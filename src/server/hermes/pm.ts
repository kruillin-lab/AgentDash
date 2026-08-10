import { createHash, createPublicKey, randomUUID, verify as verifySignature } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { z } from "zod";

import { ManagementProposalV1Schema, type ManagementProposalV1 } from "../../lib/mission-control/contracts";
import {
  PMTurnInputV1Schema,
  type PMTurnInputV1,
  type ParsedPMTurnInputV1,
} from "../mission-control/pm-prompt";
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
  conversation_acknowledged: "Proposal-only planning view; no lifecycle action:",
  clarification_required: "Proposal-only clarification; no lifecycle action:",
  proposal_drafted: "A bounded proposal is ready for controller review; execution remains outside this PM.",
  request_outside_pm_scope: "This request is outside the proposal-only project-management boundary; no lifecycle action was taken.",
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

export const VerifiedHermesExecutionReceiptV1Schema = z.object({
  schema_version: z.literal("agentdash.verified-hermes-execution-receipt/v1"),
  request_id: z.string().uuid(),
  proof_sha256: z.string().regex(SHA256_PATTERN),
  invocation_sha256: z.string().regex(SHA256_PATTERN),
  turn_input_sha256: z.string().regex(SHA256_PATTERN),
  output_sha256: z.string().regex(SHA256_PATTERN),
  executable: z.object({
    path: z.string().min(1),
    sha256: z.string().regex(SHA256_PATTERN),
    version: z.string().min(1).max(256),
  }).strict(),
  profile: z.object({
    home: z.string().min(1),
    manifest_sha256: z.string().regex(SHA256_PATTERN),
  }).strict(),
  inference: z.object({
    model: z.string().min(1).max(256),
    provider: z.string().min(1).max(256),
  }).strict(),
  credentials: z.object({
    credential_set_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
    attestation_sha256: z.string().regex(SHA256_PATTERN),
  }).strict(),
  session_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  started_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }),
  issuer: PMProofIssuerV2Schema,
}).strict();
export type VerifiedHermesExecutionReceiptV1 = z.infer<typeof VerifiedHermesExecutionReceiptV1Schema>;

export type VerifiedHermesLaunchRequestV1 = Readonly<{
  schema_version: "agentdash.verified-hermes-launch-request/v1";
  request_id: string;
  requested_at: string;
  signed_proof_json: string;
  proof_sha256: string;
  invocation_sha256: string;
  turn_input_json: string;
  turn_input_sha256: string;
}>;

export type VerifiedHermesLaunchResultV1 = Readonly<{
  output: unknown;
  receipt: VerifiedHermesExecutionReceiptV1;
}>;

/**
 * Trusted out-of-process boundary. Implementations must authenticate the signed proof,
 * atomically bind the opened executable/profile identities to launch, and sign the receipt.
 * Callers cannot supply executable, profile, argv, environment, cwd, or usage-file paths.
 */
export interface VerifiedHermesLaunchPort {
  launch(request: VerifiedHermesLaunchRequestV1, options?: { signal?: AbortSignal }): Promise<VerifiedHermesLaunchResultV1>;
}

const ManagementProposalForTurnSchema = ManagementProposalV1Schema.superRefine((proposal, context) => {
  if (proposal.intent !== "conversation_only" && proposal.intent !== "create_task") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "unsupported management intent" });
  }
  if (proposal.task_id !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "PM proposals cannot assign task identity" });
  }
});

export const PMConversationAtomV1Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("planning_focus"),
    focus: z.enum(["scope", "schedule", "dependencies", "risks", "verification", "release_readiness"]),
  }).strict(),
  z.object({
    kind: z.literal("status_reference"),
    status_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  }).strict(),
  z.object({
    kind: z.literal("recall_reference"),
    page_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  }).strict(),
  z.object({
    kind: z.literal("capability_reference"),
    capability_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  }).strict(),
  z.object({
    kind: z.literal("clarification"),
    field: z.enum(["goal", "scope", "success_criteria", "deadline", "priority", "owner", "dependencies", "constraints", "risk_tolerance"]),
  }).strict(),
]);
export type PMConversationAtomV1 = z.infer<typeof PMConversationAtomV1Schema>;

const PMConversationAtomsV1Schema = z.array(PMConversationAtomV1Schema).max(4);

const PMModelOutputV1Schema = z.object({
  response_code: PMResponseCodeSchema,
  conversation_atoms: PMConversationAtomsV1Schema,
  proposal: ManagementProposalForTurnSchema,
}).strict().superRefine((output, context) => {
  const expectedIntent = output.response_code === "proposal_drafted" ? "create_task" : "conversation_only";
  if (output.proposal.intent !== expectedIntent) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "PM response code does not match proposal intent" });
  }

  const atomKeys = output.conversation_atoms.map((atom) => JSON.stringify(atom));
  if (new Set(atomKeys).size !== atomKeys.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["conversation_atoms"], message: "conversation atoms must be unique" });
  }
  if (output.response_code === "conversation_acknowledged") {
    if (output.conversation_atoms.length === 0 || output.conversation_atoms.some((atom) => atom.kind === "clarification")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["conversation_atoms"], message: "conversation acknowledgement requires one to four non-clarification atoms" });
    }
    if (output.conversation_atoms.filter((atom) => atom.kind === "planning_focus").length > 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["conversation_atoms"], message: "conversation acknowledgement cannot contain conflicting planning focuses" });
    }
  } else if (output.response_code === "clarification_required") {
    if (output.conversation_atoms.length !== 1 || output.conversation_atoms[0]?.kind !== "clarification") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["conversation_atoms"], message: "clarification requires exactly one clarification atom" });
    }
  } else if (output.conversation_atoms.length !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["conversation_atoms"], message: "this response code does not allow conversation atoms" });
  }
});

export const PMTurnOutputV1Schema = z.object({
  text: z.string().min(1).max(4_096),
  session_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  proposal: ManagementProposalForTurnSchema,
}).strict();
export type PMTurnOutputV1 = z.infer<typeof PMTurnOutputV1Schema>;

const PMRenderEnvelopeBodyV1Schema = z.object({
  schema_version: z.literal("agentdash.pm-render-envelope/v1"),
  response_code: PMResponseCodeSchema,
  conversation_atoms: PMConversationAtomsV1Schema,
  rendered_text: z.string().min(1).max(4_096),
}).strict();
export type PMRenderEnvelopeBodyV1 = z.infer<typeof PMRenderEnvelopeBodyV1Schema>;

export const PMTurnEnvelopeV1Schema = z.object({
  text: z.string().min(1).max(16 * 1_024),
  session_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  proposal: ManagementProposalForTurnSchema,
}).strict();
export type PMTurnEnvelopeV1 = z.infer<typeof PMTurnEnvelopeV1Schema>;

export interface HermesPM {
  turn(input: PMTurnInputV1, options?: { signal?: AbortSignal }): Promise<PMTurnEnvelopeV1>;
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

type PMModelOutputV1 = z.infer<typeof PMModelOutputV1Schema>;

const PLANNING_FOCUS_TEXT: Readonly<Record<Extract<PMConversationAtomV1, { kind: "planning_focus" }>["focus"], string>> = Object.freeze({
  scope: "Focus: scope.",
  schedule: "Focus: schedule.",
  dependencies: "Focus: dependencies.",
  risks: "Focus: risks.",
  verification: "Focus: verification.",
  release_readiness: "Focus: release readiness.",
});

const STATUS_SUBJECT_TEXT = Object.freeze({
  scope: "Scope",
  schedule: "Schedule",
  dependencies: "Dependency",
  risks: "Risk",
  verification: "Verification",
  release: "Release",
} as const);

const STATUS_STATE_TEXT = Object.freeze({
  unknown: "unknown",
  not_started: "not started",
  in_progress: "in progress",
  blocked: "blocked",
  ready_for_review: "ready for review",
  complete: "complete",
} as const);

const CLARIFICATION_TEXT: Readonly<Record<Extract<PMConversationAtomV1, { kind: "clarification" }>["field"], string>> = Object.freeze({
  goal: "What outcome should this project achieve?",
  scope: "What should be included in the project scope?",
  success_criteria: "What measurable outcome will define success?",
  deadline: "What deadline should the plan target?",
  priority: "What priority should guide the plan?",
  owner: "Who should own the proposed work?",
  dependencies: "Which dependencies must the plan account for?",
  constraints: "Which constraints must the plan respect?",
  risk_tolerance: "What level of delivery risk is acceptable?",
});

function assertExactAtomReferences(input: ParsedPMTurnInputV1, output: PMModelOutputV1): void {
  const statusIds = new Set(input.status_facts.map((fact) => fact.status_id));
  const recallIds = new Set(input.reviewed_recall.map((recall) => recall.page_id));
  const capabilityIds = new Set(input.capability_facts.map((fact) => fact.capability_id));
  for (const atom of output.conversation_atoms) {
    if (atom.kind === "status_reference" && !statusIds.has(atom.status_id)) throw new PMOutputError();
    if (atom.kind === "recall_reference" && !recallIds.has(atom.page_id)) throw new PMOutputError();
    if (atom.kind === "capability_reference" && !capabilityIds.has(atom.capability_id)) throw new PMOutputError();
  }
}

export function renderPMResponseText(
  input: ParsedPMTurnInputV1,
  responseCode: PMResponseCode,
  conversationAtoms: readonly PMConversationAtomV1[],
): string {
  if (responseCode === "proposal_drafted" || responseCode === "request_outside_pm_scope") {
    return PM_RESPONSE_TEXT[responseCode];
  }

  const sentences = conversationAtoms.map((atom): string => {
    switch (atom.kind) {
      case "planning_focus":
        return PLANNING_FOCUS_TEXT[atom.focus];
      case "status_reference": {
        const fact = input.status_facts.find((candidate) => candidate.status_id === atom.status_id);
        if (!fact) throw new PMOutputError();
        return `${STATUS_SUBJECT_TEXT[fact.subject]} status: ${STATUS_STATE_TEXT[fact.state]}.`;
      }
      case "recall_reference":
        if (!input.reviewed_recall.some((recall) => recall.page_id === atom.page_id)) throw new PMOutputError();
        return `Reviewed context ${atom.page_id} included.`;
      case "capability_reference": {
        const fact = input.capability_facts.find((candidate) => candidate.capability_id === atom.capability_id);
        if (!fact) throw new PMOutputError();
        return `Capability ${atom.capability_id}: ${fact.available ? "available" : "unavailable"}.`;
      }
      case "clarification":
        return CLARIFICATION_TEXT[atom.field];
    }
  });
  return `${PM_RESPONSE_TEXT[responseCode]} ${sentences.join(" ")}`;
}

export function serializePMRenderEnvelope(rawEnvelope: PMRenderEnvelopeBodyV1): string {
  const envelope = PMRenderEnvelopeBodyV1Schema.parse(rawEnvelope);
  return JSON.stringify({
    schema_version: envelope.schema_version,
    response_code: envelope.response_code,
    conversation_atoms: envelope.conversation_atoms,
    rendered_text: envelope.rendered_text,
  });
}

/**
 * Consumes the entire canonical machine envelope, re-renders it from request-bound atoms,
 * and returns only the three-field client contract. No model-authored prose crosses this seam.
 */
export function parsePMTurnOutputForInput(rawInput: PMTurnInputV1, rawOutput: unknown): PMTurnOutputV1 {
  try {
    const input = PMTurnInputV1Schema.parse(rawInput);
    const output = PMTurnEnvelopeV1Schema.parse(rawOutput);
    const parsedJson = JSON.parse(output.text) as unknown;
    const envelope = PMRenderEnvelopeBodyV1Schema.parse(parsedJson);
    if (serializePMRenderEnvelope(envelope) !== output.text) throw new PMOutputError();

    const modelOutput = PMModelOutputV1Schema.parse({
      response_code: envelope.response_code,
      conversation_atoms: envelope.conversation_atoms,
      proposal: output.proposal,
    });
    assertExactAtomReferences(input, modelOutput);
    const renderedText = renderPMResponseText(input, modelOutput.response_code, modelOutput.conversation_atoms);
    if (envelope.rendered_text !== renderedText) throw new PMOutputError();

    return PMTurnOutputV1Schema.parse({
      text: renderedText,
      session_ref: output.session_ref,
      proposal: modelOutput.proposal,
    });
  } catch {
    throw new PMOutputError();
  }
}

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
  launchPort: VerifiedHermesLaunchPort;
  trustedLauncher: {
    keyId: string;
    publicKeyPem: string;
  };
  environmentSource?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  requestId?: () => string;
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

export function serializePMIsolationProof(proof: PMIsolationProofV2): string {
  return JSON.stringify(stableValue(proof));
}

export function serializePMIsolationProofSigningPayload(proof: PMIsolationProofV2): string {
  return JSON.stringify(stableValue({
    ...proof,
    issuer: { key_id: proof.issuer.key_id, algorithm: proof.issuer.algorithm },
  }));
}

export function serializeVerifiedHermesReceiptSigningPayload(receipt: VerifiedHermesExecutionReceiptV1): string {
  return JSON.stringify(stableValue({
    ...receipt,
    issuer: { key_id: receipt.issuer.key_id, algorithm: receipt.issuer.algorithm },
  }));
}

function hasTrustedEd25519Signature(
  payload: string,
  issuer: z.infer<typeof PMProofIssuerV2Schema>,
  trustedIssuer: { keyId: string; publicKeyPem: string },
): boolean {
  try {
    if (issuer.key_id !== trustedIssuer.keyId) return false;
    const signature = Buffer.from(issuer.signature, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== issuer.signature) return false;
    const publicKey = createPublicKey(trustedIssuer.publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") return false;
    return verifySignature(null, Buffer.from(payload, "utf8"), publicKey, signature);
  } catch {
    return false;
  }
}

function hasTrustedIssuer(proof: PMIsolationProofV2, trustedIssuer: CreateHermesPMOptions["trustedIssuer"]): boolean {
  return hasTrustedEd25519Signature(serializePMIsolationProofSigningPayload(proof), proof.issuer, trustedIssuer);
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

async function currentProof(options: CreateHermesPMOptions, now: Date): Promise<PMIsolationProofV2 | null> {
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
    return proof;
  } catch {
    return null;
  }
}

function receiptMatchesLaunch(
  receipt: VerifiedHermesExecutionReceiptV1,
  output: unknown,
  request: VerifiedHermesLaunchRequestV1,
  proof: PMIsolationProofV2,
  trustedLauncher: CreateHermesPMOptions["trustedLauncher"],
  observedAt: Date,
): boolean {
  if (!hasTrustedEd25519Signature(serializeVerifiedHermesReceiptSigningPayload(receipt), receipt.issuer, trustedLauncher)) return false;
  if (receipt.request_id !== request.request_id
    || receipt.proof_sha256 !== request.proof_sha256
    || receipt.invocation_sha256 !== request.invocation_sha256
    || receipt.turn_input_sha256 !== request.turn_input_sha256
    || receipt.output_sha256 !== computePMEvidenceDigest(output)) return false;
  if (receipt.executable.path !== proof.executable.path
    || receipt.executable.sha256 !== proof.executable.sha256
    || receipt.executable.version !== proof.executable.version
    || receipt.profile.home !== proof.profile.home
    || receipt.profile.manifest_sha256 !== proof.profile.manifest_sha256
    || receipt.inference.model !== proof.inference.model
    || receipt.inference.provider !== proof.inference.provider
    || receipt.credentials.credential_set_ref !== proof.credentials.credential_set_ref
    || receipt.credentials.attestation_sha256 !== proof.credentials.attestation_sha256) return false;

  const requestedAt = Date.parse(request.requested_at);
  const startedAt = Date.parse(receipt.started_at);
  const completedAt = Date.parse(receipt.completed_at);
  const proofExpiresAt = Date.parse(proof.expires_at);
  const inventoryObservedAt = Date.parse(proof.inventory.evidence.observed_at);
  const sideEffectsObservedAt = Date.parse(proof.side_effects.evidence.observed_at);
  return startedAt >= requestedAt
    && startedAt < proofExpiresAt
    && completedAt >= startedAt
    && completedAt <= observedAt.getTime()
    && completedAt - startedAt <= PM_TIMEOUT_MS
    && startedAt - inventoryObservedAt <= MAX_QUALIFICATION_EVIDENCE_AGE_MS
    && startedAt - sideEffectsObservedAt <= MAX_QUALIFICATION_EVIDENCE_AGE_MS;
}

export function createHermesPM(options: CreateHermesPMOptions): HermesPM {
  const now = options.now ?? (() => new Date());
  const nextRequestId = options.requestId ?? randomUUID;

  return {
    async turn(rawInput, turnOptions = {}) {
      const input = PMTurnInputV1Schema.parse(rawInput);
      const requestedAt = now();
      const proof = await currentProof(options, requestedAt);
      if (!proof) throw new PMUnavailableError();

      const signedProofJson = serializePMIsolationProof(proof);
      const turnInputJson = JSON.stringify(stableValue(input));
      const request = Object.freeze({
        schema_version: "agentdash.verified-hermes-launch-request/v1" as const,
        request_id: nextRequestId(),
        requested_at: requestedAt.toISOString(),
        signed_proof_json: signedProofJson,
        proof_sha256: createHash("sha256").update(signedProofJson, "utf8").digest("hex"),
        invocation_sha256: proof.invocation.sha256,
        turn_input_json: turnInputJson,
        turn_input_sha256: createHash("sha256").update(turnInputJson, "utf8").digest("hex"),
      });

      let launched: VerifiedHermesLaunchResultV1;
      try {
        launched = await options.launchPort.launch(request, { signal: turnOptions.signal });
      } catch {
        throw new PMUnavailableError();
      }

      let receipt: VerifiedHermesExecutionReceiptV1;
      try {
        receipt = VerifiedHermesExecutionReceiptV1Schema.parse(launched.receipt);
      } catch {
        throw new PMUnavailableError();
      }
      if (!receiptMatchesLaunch(receipt, launched.output, request, proof, options.trustedLauncher, now())) {
        throw new PMUnavailableError();
      }

      let modelOutput: PMModelOutputV1;
      try {
        modelOutput = PMModelOutputV1Schema.parse(launched.output);
        assertExactAtomReferences(input, modelOutput);
      } catch {
        throw new PMOutputError();
      }
      const renderedText = renderPMResponseText(input, modelOutput.response_code, modelOutput.conversation_atoms);
      return PMTurnEnvelopeV1Schema.parse({
        text: serializePMRenderEnvelope({
          schema_version: "agentdash.pm-render-envelope/v1",
          response_code: modelOutput.response_code,
          conversation_atoms: modelOutput.conversation_atoms,
          rendered_text: renderedText,
        }),
        session_ref: receipt.session_ref,
        proposal: modelOutput.proposal,
      });
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
