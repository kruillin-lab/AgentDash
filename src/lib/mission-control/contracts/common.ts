import { createHash } from "node:crypto";

import { z } from "zod";

const opaqueId = <Brand extends string>() => z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/).brand<Brand>();

export const RequestIdSchema = opaqueId<"RequestId">();
export const TaskIdSchema = opaqueId<"TaskId">();
export const AttemptIdSchema = z.number().int().positive().brand<"AttemptId">();
export const WorkTaskIdSchema = opaqueId<"WorkTaskId">();
export const CodeGTaskIdSchema = opaqueId<"CodeGTaskId">();
export const CodeGConversationIdSchema = opaqueId<"CodeGConversationId">();
export const ConnectionIdSchema = opaqueId<"ConnectionId">();
export const HarnessSessionIdSchema = opaqueId<"HarnessSessionId">();
export const MandateIdSchema = opaqueId<"MandateId">();
export const AuthorityIdSchema = opaqueId<"AuthorityId">();
export const CommandIdSchema = opaqueId<"CommandId">();
export const ReceiptIdSchema = opaqueId<"ReceiptId">();
export const ArtifactIdSchema = opaqueId<"ArtifactId">();
export const RouteProofIdSchema = opaqueId<"RouteProofId">();
export const FolderIdSchema = opaqueId<"FolderId">();
export const ProjectIdSchema = opaqueId<"ProjectId">();
export const EventIdSchema = opaqueId<"EventId">();
export const ProposalIdSchema = opaqueId<"ProposalId">();
export const RunIdSchema = opaqueId<"RunId">();
export const ArtifactKeySchema = opaqueId<"ArtifactKey">();
export const ActionNodeIdSchema = opaqueId<"ActionNodeId">();
export const RouteIdSchema = opaqueId<"RouteId">();
const gitObjectId = <Brand extends string>() => z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).brand<Brand>();
export const GitCommitIdSchema = gitObjectId<"GitCommitId">();
export const GitTreeIdSchema = gitObjectId<"GitTreeId">();
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/).brand<"Digest">();
export const TimestampSchema = z.string().datetime({ offset: true });

export type RequestId = z.infer<typeof RequestIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
export type AttemptId = z.infer<typeof AttemptIdSchema>;
export type WorkTaskId = z.infer<typeof WorkTaskIdSchema>;
export type CodeGTaskId = z.infer<typeof CodeGTaskIdSchema>;
export type CodeGConversationId = z.infer<typeof CodeGConversationIdSchema>;
export type ConnectionId = z.infer<typeof ConnectionIdSchema>;
export type HarnessSessionId = z.infer<typeof HarnessSessionIdSchema>;
export type MandateId = z.infer<typeof MandateIdSchema>;
export type AuthorityId = z.infer<typeof AuthorityIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
export type ReceiptId = z.infer<typeof ReceiptIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export type RouteProofId = z.infer<typeof RouteProofIdSchema>;
export type FolderId = z.infer<typeof FolderIdSchema>;
export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type ProposalId = z.infer<typeof ProposalIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type ArtifactKey = z.infer<typeof ArtifactKeySchema>;
export type ActionNodeId = z.infer<typeof ActionNodeIdSchema>;
export type RouteId = z.infer<typeof RouteIdSchema>;
export type GitCommitId = z.infer<typeof GitCommitIdSchema>;
export type GitTreeId = z.infer<typeof GitTreeIdSchema>;
export type Digest = z.infer<typeof DigestSchema>;
export type Timestamp = z.infer<typeof TimestampSchema>;

export const ActionOutcomeValues = [
  "succeeded", "transient_infrastructure", "semantic_failure", "verification_failure", "policy_violation", "cancelled", "timed_out", "budget_exhausted", "route_unavailable", "ceo_input_required", "ambiguous",
] as const;
export const ActionOutcomeSchema = z.enum(ActionOutcomeValues);
export type ActionOutcome = z.infer<typeof ActionOutcomeSchema>;

export const TaskOutcomeValues = ["succeeded", "failed", "timed_out", "budget_exhausted", "cancelled", "route_unavailable", "inconsistent"] as const;
export const TaskOutcomeSchema = z.enum(TaskOutcomeValues);
export type TaskOutcome = z.infer<typeof TaskOutcomeSchema>;

export const ActionCommandStateValues = ["prepared", "submitted", "unknown", "found", "terminal", "revoked"] as const;
export const ActionCommandStateSchema = z.enum(ActionCommandStateValues);
export type ActionCommandState = z.infer<typeof ActionCommandStateSchema>;

export const ActionRoleValues = ["execute", "retry", "remediate", "verify", "finalize", "cancel", "reconcile"] as const;
export const ActionRoleSchema = z.enum(ActionRoleValues);
export type ActionRole = z.infer<typeof ActionRoleSchema>;

export const ExecutorKindSchema = z.enum(["codeg_worker", "controller", "finalizer", "verifier"]);
export type ExecutorKind = z.infer<typeof ExecutorKindSchema>;

export const WorkspaceScopeV1Schema = z.object({
  project_id: ProjectIdSchema,
  mode: z.enum(["validated_directory", "isolated_worktree"]),
  path: z.string().min(1).max(4096),
}).strict();
export type WorkspaceScopeV1 = z.infer<typeof WorkspaceScopeV1Schema>;

/** Validated workspace boundary plus the controller policy that selected it. */
export const WorkspacePolicyV1Schema = z.object({
  schema_version: z.literal("agentdash.workspace-policy/v1"),
  workspace: WorkspaceScopeV1Schema,
  allowed_roots: z.array(z.string().min(1)).min(1),
  require_isolated_worktree: z.boolean(),
}).strict().refine((value) => !value.require_isolated_worktree || value.workspace.mode === "isolated_worktree", "isolated-worktree policy requires an isolated worktree");
export type WorkspacePolicyV1 = z.infer<typeof WorkspacePolicyV1Schema>;

export const BudgetV1Schema = z.object({
  max_cost_usd: z.number().finite().nonnegative(),
  max_runtime_ms: z.number().int().positive(),
  max_attempts: z.number().int().positive(),
  max_provider_tokens: z.number().int().nonnegative(),
}).strict();
export type BudgetV1 = z.infer<typeof BudgetV1Schema>;

export const ReconciliationDeadlineV1Schema = z.object({ max_attempts: z.number().int().positive(), deadline_ms: z.number().int().positive() }).strict();
export type ReconciliationDeadlineV1 = z.infer<typeof ReconciliationDeadlineV1Schema>;
export const ReconciliationDeadlinesV1Schema = z.object({
  dispatch_lookup: ReconciliationDeadlineV1Schema,
  cancel_confirmation: ReconciliationDeadlineV1Schema,
  orphan_recovery: ReconciliationDeadlineV1Schema,
  finalization: ReconciliationDeadlineV1Schema,
  receipt_delivery: ReconciliationDeadlineV1Schema,
}).strict();
export type ReconciliationDeadlinesV1 = z.infer<typeof ReconciliationDeadlinesV1Schema>;

/**
 * The approved initial reconciliation defaults. These are explicit mandate values, not hidden
 * polling behavior: a mandate carries them so every uncertain operation exits Working by a numeric
 * deadline and a bounded observation count. A mandate may tighten them; the validator rejects a
 * mandate that has no deadline for a reachable uncertain operation.
 */
export const INITIAL_RECONCILIATION_DEADLINES_V1: ReconciliationDeadlinesV1 = ReconciliationDeadlinesV1Schema.parse({
  dispatch_lookup: { deadline_ms: 60_000, max_attempts: 6 },
  cancel_confirmation: { deadline_ms: 60_000, max_attempts: 6 },
  orphan_recovery: { deadline_ms: 120_000, max_attempts: 12 },
  finalization: { deadline_ms: 60_000, max_attempts: 6 },
  receipt_delivery: { deadline_ms: 120_000, max_attempts: 12 },
});

/** Opaque, pre-redacted transport evidence; never a raw adapter payload. */
export const RedactedPayloadV1Schema = z.object({ redacted: z.literal(true), digest: DigestSchema, summary: z.string().min(1).max(4096) }).strict();
export type RedactedPayloadV1 = z.infer<typeof RedactedPayloadV1Schema>;

function canonicalValue(value: unknown, stack: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string": return JSON.stringify(value);
    case "boolean": return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonical JSON does not support non-finite numbers");
      return JSON.stringify(value);
    case "undefined": case "bigint": case "function": case "symbol":
      throw new TypeError("canonical JSON does not support this value");
    case "object": break;
    default: throw new TypeError("canonical JSON does not support this value");
  }
  if (stack.has(value)) throw new TypeError("canonical JSON does not support cycles");
  if (Array.isArray(value)) {
    stack.add(value);
    try {
      const members = Array.from({ length: value.length }, (_, index) => {
        if (!Object.hasOwn(value, index)) throw new TypeError("canonical JSON does not support array holes");
        return canonicalValue(value[index], stack);
      });
      return `[${members.join(",")}]`;
    } finally { stack.delete(value); }
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("canonical JSON only supports plain objects");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("canonical JSON does not support symbol keys");
  stack.add(value);
  try {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(source[key], stack)}`).join(",")}}`;
  } finally { stack.delete(value); }
}

/** Serializes the JSON subset used for signed controller artifacts. */
export function canonicalJson(value: unknown): string { return canonicalValue(value, new Set()); }
export function canonicalDigest(value: unknown): Digest { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex") as Digest; }
