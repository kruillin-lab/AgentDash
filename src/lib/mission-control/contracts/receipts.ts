import { z } from "zod";

import {
  ActionRoleSchema,
  ArtifactIdSchema,
  AttemptIdSchema,
  AuthorityIdSchema,
  CodeGConversationIdSchema,
  CommandIdSchema,
  ConnectionIdSchema,
  DigestSchema,
  EventIdSchema,
  ExecutorKindSchema,
  FolderIdSchema,
  HarnessSessionIdSchema,
  MandateIdSchema,
  ReceiptIdSchema,
  RedactedPayloadV1Schema,
  RouteIdSchema,
  RouteProofIdSchema,
  RunIdSchema,
  TaskIdSchema,
  TimestampSchema,
  WorkTaskIdSchema,
  canonicalDigest,
} from "./common";
import { ActionOutcomeV1Schema, RequiredCheckResultV1Schema, TaskOutcomeV1Schema } from "./outcomes";

const usageShape = z.object({ cost_usd: z.number().finite().nonnegative().nullable(), runtime_ms: z.number().int().nonnegative().nullable(), tokens: z.number().int().nonnegative().nullable() }).strict();
const nativeSessionShape = z.discriminatedUnion("kind", [z.object({ kind: z.literal("available"), uri: z.string().url() }).strict(), z.object({ kind: z.literal("not_applicable") }).strict(), z.object({ kind: z.literal("unavailable") }).strict()]);

export const ActionReceiptV1Schema = z.object({
  schema_version: z.literal("agentdash.action-receipt/v1"), receipt_id: ReceiptIdSchema, task_id: TaskIdSchema, mandate_id: MandateIdSchema, authority_id: AuthorityIdSchema, command_id: CommandIdSchema, attempt_id: AttemptIdSchema, run_id: RunIdSchema,
  work_task_id: WorkTaskIdSchema.nullable(), conversation_id: CodeGConversationIdSchema.nullable(), connection_id: ConnectionIdSchema.nullable(), harness_session_id: HarnessSessionIdSchema.nullable(), folder_id: FolderIdSchema.nullable(),
  action_role: ActionRoleSchema, executor_kind: ExecutorKindSchema, route_id: RouteIdSchema.nullable(), route_proof_id: RouteProofIdSchema.nullable(), route_proof_digest: DigestSchema.nullable(), harness: z.string().min(1).nullable(), model: z.string().min(1).nullable(), resolved_policy_digest: DigestSchema,
  outcome: ActionOutcomeV1Schema, summary: z.string().min(1), artifact_ids: z.array(ArtifactIdSchema), changed_files: z.array(z.string().min(1)), produced_files: z.array(z.string().min(1)), checks: z.array(z.object({ name: z.string().min(1), raw_result_digest: DigestSchema, passed: z.boolean() }).strict()), usage: usageShape,
  uncertainty: z.array(z.string()), unsupported_claims: z.array(z.string()), cancellation_detail: z.string().nullable(), timeout_detail: z.string().nullable(), failure_detail: z.string().nullable(), native_session: nativeSessionShape, created_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.outcome.task_id !== value.task_id || value.outcome.attempt_id !== value.attempt_id || value.outcome.command_id !== value.command_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "action receipt identities must match outcome" });
  if (value.route_id !== value.outcome.route_facts.route_id || value.route_proof_id !== value.outcome.route_facts.route_proof_id || value.route_proof_digest !== value.outcome.route_facts.route_proof_digest) context.addIssue({ code: z.ZodIssueCode.custom, message: "action receipt route must match outcome" });
  const outcomeChecks = value.outcome.required_checks.map((check) => ({ name: check.check_id, raw_result_digest: check.raw_result_digest, passed: check.passed }));
  const changedFiles = value.outcome.files.filter((file) => file.kind === "changed").map((file) => file.path);
  const producedFiles = value.outcome.files.filter((file) => file.kind === "produced").map((file) => file.path);
  if (canonicalDigest(value.checks) !== canonicalDigest(outcomeChecks) || canonicalDigest(value.usage) !== canonicalDigest(value.outcome.usage) || canonicalDigest(value.changed_files) !== canonicalDigest(changedFiles) || canonicalDigest(value.produced_files) !== canonicalDigest(producedFiles) || canonicalDigest(value.uncertainty) !== canonicalDigest(value.outcome.uncertainty) || value.cancellation_detail !== value.outcome.cancellation_detail || value.failure_detail !== value.outcome.failure_detail || canonicalDigest(value.native_session) !== canonicalDigest(value.outcome.native_session)) context.addIssue({ code: z.ZodIssueCode.custom, message: "action receipt evidence must exactly match nested outcome" });
  if ((value.outcome.outcome === "timed_out") !== (value.timeout_detail !== null)) context.addIssue({ code: z.ZodIssueCode.custom, message: "timeout detail must match timed-out outcome" });
  const modelBacked = value.executor_kind === "codeg_worker";
  const requiredBindings = [value.work_task_id, value.conversation_id, value.folder_id, value.route_id, value.route_proof_id, value.route_proof_digest, value.harness, value.model];
  if (modelBacked && (requiredBindings.some((binding) => binding === null) || value.native_session.kind === "not_applicable")) context.addIssue({ code: z.ZodIssueCode.custom, message: "model-backed receipts require CodeG and native-session bindings" });
  if (!modelBacked && ([...requiredBindings, value.connection_id, value.harness_session_id].some((binding) => binding !== null) || value.native_session.kind !== "not_applicable")) context.addIssue({ code: z.ZodIssueCode.custom, message: "deterministic receipts cannot carry CodeG bindings" });
});
export type ActionReceiptV1 = z.infer<typeof ActionReceiptV1Schema>;

export const VerificationReceiptV1Schema = z.object({
  schema_version: z.literal("agentdash.verification-receipt/v1"), receipt_id: ReceiptIdSchema, task_id: TaskIdSchema, task_spec_revision: z.number().int().nonnegative(), task_spec_digest: DigestSchema, mandate_id: MandateIdSchema, mandate_digest: DigestSchema, authority_id: AuthorityIdSchema, command_id: CommandIdSchema, attempt_id: AttemptIdSchema, run_id: RunIdSchema,
  work_task_id: WorkTaskIdSchema.nullable(), conversation_id: CodeGConversationIdSchema.nullable(), connection_id: ConnectionIdSchema.nullable(), harness_session_id: HarnessSessionIdSchema.nullable(), folder_id: FolderIdSchema.nullable(), source_artifact_digest: DigestSchema, acceptance_digest: DigestSchema, acceptance_checks: z.array(z.string().min(1)).min(1), realized_mutating_route_ids: z.array(RouteIdSchema), verifier_route_id: RouteIdSchema.nullable(), route_proof_id: RouteProofIdSchema.nullable(), route_proof_digest: DigestSchema.nullable(), deterministic_verifier_id: z.string().min(1).nullable(), independence_proof_digest: DigestSchema, independence_tier: z.union([z.literal(1), z.literal(2)]), raw_results: z.array(RequiredCheckResultV1Schema), outcome: ActionOutcomeV1Schema, created_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.outcome.task_id !== value.task_id || value.outcome.attempt_id !== value.attempt_id || value.outcome.command_id !== value.command_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "verification receipt identities must match outcome" });
  if (value.acceptance_digest !== canonicalDigest(value.acceptance_checks)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["acceptance_digest"], message: "verification acceptance digest must match exact checks" });
  if (canonicalDigest(value.raw_results) !== canonicalDigest(value.outcome.required_checks)) context.addIssue({ code: z.ZodIssueCode.custom, message: "verification raw results must exactly match nested outcome" });
  const routeParts = [value.verifier_route_id, value.route_proof_id, value.route_proof_digest];
  const completeRoute = routeParts.every((part) => part !== null);
  const emptyRoute = routeParts.every((part) => part === null);
  if (!completeRoute && !emptyRoute) context.addIssue({ code: z.ZodIssueCode.custom, message: "verification receipt route binding may not be partial" });
  if (completeRoute === (value.deterministic_verifier_id !== null)) context.addIssue({ code: z.ZodIssueCode.custom, message: "verification must bind exactly one verifier identity" });
  if (value.verifier_route_id !== value.outcome.route_facts.route_id || value.route_proof_id !== value.outcome.route_facts.route_proof_id || value.route_proof_digest !== value.outcome.route_facts.route_proof_digest) context.addIssue({ code: z.ZodIssueCode.custom, message: "verification receipt route must match outcome" });
  const codegBindings = [value.work_task_id, value.conversation_id, value.folder_id];
  if (completeRoute && codegBindings.some((binding) => binding === null)) context.addIssue({ code: z.ZodIssueCode.custom, message: "routed verification requires complete CodeG binding identity" });
  if (emptyRoute && [value.work_task_id, value.conversation_id, value.connection_id, value.harness_session_id, value.folder_id].some((binding) => binding !== null)) context.addIssue({ code: z.ZodIssueCode.custom, message: "deterministic verification cannot carry CodeG binding identity" });
});
export type VerificationReceiptV1 = z.infer<typeof VerificationReceiptV1Schema>;

const expectedPostStateShape = z.discriminatedUnion("kind", [z.object({ kind: z.literal("digest"), digest: DigestSchema }).strict(), z.object({ kind: z.literal("postcondition"), predicate: z.string().min(1), predicate_digest: DigestSchema }).strict()]);
const observedPostStateShape = z.discriminatedUnion("kind", [z.object({ kind: z.literal("digest"), digest: DigestSchema }).strict(), z.object({ kind: z.literal("postcondition"), predicate_digest: DigestSchema, satisfied: z.boolean(), evidence_digest: DigestSchema }).strict()]);

export const FinalizationReceiptV1Schema = z.object({
  schema_version: z.literal("agentdash.finalization-receipt/v1"), receipt_id: ReceiptIdSchema, task_id: TaskIdSchema, task_spec_revision: z.number().int().nonnegative(), task_spec_digest: DigestSchema, mandate_id: MandateIdSchema, mandate_digest: DigestSchema, authority_id: AuthorityIdSchema, command_id: CommandIdSchema, attempt_id: AttemptIdSchema, run_id: RunIdSchema, verification_receipt_digest: DigestSchema, artifact_id: ArtifactIdSchema, base_digest: DigestSchema, target_digest: DigestSchema, mutation_manifest_digest: DigestSchema, patch_digest: DigestSchema, expected_post_state: expectedPostStateShape, observed_post_state: observedPostStateShape, adapter_operation: z.string().min(1), operation_id: CommandIdSchema, outcome: z.literal("applied"), created_at: TimestampSchema,
}).strict().superRefine((value, context) => { if (value.expected_post_state.kind !== value.observed_post_state.kind) context.addIssue({ code: z.ZodIssueCode.custom, message: "finalization receipt post-state kind drifted" }); else if (value.expected_post_state.kind === "digest" && value.observed_post_state.kind === "digest" && value.expected_post_state.digest !== value.observed_post_state.digest) context.addIssue({ code: z.ZodIssueCode.custom, message: "finalization receipt post-state digest drifted" }); else if (value.expected_post_state.kind === "postcondition" && value.observed_post_state.kind === "postcondition" && (value.expected_post_state.predicate_digest !== value.observed_post_state.predicate_digest || !value.observed_post_state.satisfied)) context.addIssue({ code: z.ZodIssueCode.custom, message: "finalization receipt deterministic postcondition was not satisfied" }); });
export type FinalizationReceiptV1 = z.infer<typeof FinalizationReceiptV1Schema>;

export const AggregateReceiptV1Schema = z.object({
  schema_version: z.literal("agentdash.aggregate-receipt/v1"), receipt_id: ReceiptIdSchema, task_id: TaskIdSchema, task_spec_revision: z.number().int().nonnegative(), task_spec_digest: DigestSchema, mandate_id: MandateIdSchema, mandate_digest: DigestSchema, action_receipt_ids: z.array(ReceiptIdSchema), attempt_ids: z.array(AttemptIdSchema), verification_receipt_id: ReceiptIdSchema.nullable(), verification_receipt_digest: DigestSchema.nullable(), finalization_receipt_id: ReceiptIdSchema.nullable(), finalization_receipt_digest: DigestSchema.nullable(), path_budget_usage: z.object({ cost_usd: z.number().finite().nonnegative(), runtime_ms: z.number().int().nonnegative(), attempts: z.number().int().nonnegative(), provider_tokens: z.number().int().nonnegative() }).strict(), outcome: TaskOutcomeV1Schema, created_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.outcome.task_id !== value.task_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "aggregate receipt task must match outcome" });
  if ((value.verification_receipt_id === null) !== (value.verification_receipt_digest === null)) context.addIssue({ code: z.ZodIssueCode.custom, message: "verification receipt identity and digest must be paired" });
  if ((value.finalization_receipt_id === null) !== (value.finalization_receipt_digest === null)) context.addIssue({ code: z.ZodIssueCode.custom, message: "finalization receipt identity and digest must be paired" });
  if (value.action_receipt_ids.length !== value.attempt_ids.length || new Set(value.action_receipt_ids).size !== value.action_receipt_ids.length || new Set(value.attempt_ids).size !== value.attempt_ids.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "aggregate action receipts and attempts must form unique positional pairs" });
  if (value.outcome.outcome === "succeeded" && [value.verification_receipt_id, value.verification_receipt_digest, value.finalization_receipt_id, value.finalization_receipt_digest].some((reference) => reference === null)) context.addIssue({ code: z.ZodIssueCode.custom, message: "successful aggregate receipts require verification and finalization receipts" });
});
export type AggregateReceiptV1 = z.infer<typeof AggregateReceiptV1Schema>;

export const ReconciliationReceiptV1Schema = z.object({
  schema_version: z.literal("agentdash.reconciliation-receipt/v1"), receipt_id: ReceiptIdSchema, task_id: TaskIdSchema, mandate_id: MandateIdSchema, authority_id: AuthorityIdSchema, command_id: CommandIdSchema, attempt_id: AttemptIdSchema, run_id: RunIdSchema, category: z.enum(["dispatch_lookup", "cancel_confirmation", "orphan_recovery", "finalization", "receipt_delivery"]), work_task_id: WorkTaskIdSchema.nullable(), conversation_id: CodeGConversationIdSchema.nullable(), connection_id: ConnectionIdSchema.nullable(), harness_session_id: HarnessSessionIdSchema.nullable(), folder_id: FolderIdSchema.nullable(), attempts_used: z.number().int().positive(), deadline_ms: z.number().int().positive(), outcome: z.enum(["found", "not_found", "unknown", "cancelled"]), evidence_refs: z.array(EventIdSchema), created_at: TimestampSchema,
}).strict().superRefine((value, context) => { if (value.outcome === "found" && [value.work_task_id, value.conversation_id, value.folder_id].some((binding) => binding === null)) context.addIssue({ code: z.ZodIssueCode.custom, message: "found reconciliation requires complete binding identity" }); });
export type ReconciliationReceiptV1 = z.infer<typeof ReconciliationReceiptV1Schema>;

export const AdapterResultEnvelopeV1Schema = z.object({ schema_version: z.literal("agentdash.adapter-result-envelope/v1"), envelope_id: EventIdSchema, command_id: CommandIdSchema, adapter: z.string().min(1), result_digest: DigestSchema, redacted_result: RedactedPayloadV1Schema, observed_at: TimestampSchema }).strict();
export type AdapterResultEnvelopeV1 = z.infer<typeof AdapterResultEnvelopeV1Schema>;
