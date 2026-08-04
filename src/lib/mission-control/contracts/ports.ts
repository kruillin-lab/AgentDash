import { z } from "zod";

import {
  ArtifactIdSchema,
  ArtifactKeySchema,
  AuthorityIdSchema,
  CodeGConversationIdSchema,
  CommandIdSchema,
  ConnectionIdSchema,
  DigestSchema,
  EventIdSchema,
  FolderIdSchema,
  GitCommitIdSchema,
  GitTreeIdSchema,
  HarnessSessionIdSchema,
  ProjectIdSchema,
  ReceiptIdSchema,
  RedactedPayloadV1Schema,
  RequestIdSchema,
  RunIdSchema,
  TaskIdSchema,
  TimestampSchema,
  WorkTaskIdSchema,
  BudgetV1Schema,
  canonicalDigest,
} from "./common";
import { ActionAuthorityV1Schema, ActionCommandV1Schema, ApprovalGrantV1Schema, AutoActivationReceiptV1Schema, CEOCommandV1Schema, CEOInputRequestV1Schema } from "./authority";
import { ExecutionMandateV1Schema, approvalGrantFulfillsMandate } from "./mandate";
import { BudgetPolicySnapshotV1Schema, IntakeReadinessV1Schema } from "./intake";
import { ActionOutcomeV1Schema, TaskOutcomeV1Schema } from "./outcomes";
import { RouteEvidenceV1Schema } from "./routes";
import { TaskSpecV1Schema } from "./task";

const activationShape = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("auto"), receipt: AutoActivationReceiptV1Schema }).strict(),
  z.object({ kind: z.literal("approval_required"), request: CEOInputRequestV1Schema }).strict(),
]);

const sameBudget = (left: z.infer<typeof BudgetV1Schema>, right: z.infer<typeof BudgetV1Schema>) => left.max_cost_usd === right.max_cost_usd && left.max_runtime_ms === right.max_runtime_ms && left.max_attempts === right.max_attempts && left.max_provider_tokens === right.max_provider_tokens;
const budgetWithin = (inner: z.infer<typeof BudgetV1Schema>, outer: z.infer<typeof BudgetV1Schema>) => inner.max_cost_usd <= outer.max_cost_usd && inner.max_runtime_ms <= outer.max_runtime_ms && inner.max_attempts <= outer.max_attempts && inner.max_provider_tokens <= outer.max_provider_tokens;
const reserveKeys = ["verification", "finalization", "cancellation", "reconciliation"] as const;

export function canonicalCardAuthorizationDigest(input: {
  claim_id: string;
  claim_generation: number;
  request_digest: string;
  staged_pm_digest: string;
  artifact_digest: string;
  readiness: z.infer<typeof IntakeReadinessV1Schema>;
}): z.infer<typeof DigestSchema> {
  return canonicalDigest({
    schema_version: "agentdash.card-persistence-authorization/v1",
    claim_id: input.claim_id,
    claim_generation: input.claim_generation,
    request_digest: input.request_digest,
    staged_pm_digest: input.staged_pm_digest,
    artifact_digest: input.artifact_digest,
    readiness_digest: canonicalDigest(input.readiness),
  });
}

export const PersistIntakeInputSchema = z.object({
  request_id: RequestIdSchema,
  request_digest: DigestSchema,
  claim_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  claim_generation: z.number().int().positive().safe(),
  staged_pm_digest: DigestSchema,
  card_authorization_digest: DigestSchema,
  artifact_digest: DigestSchema,
  readiness: IntakeReadinessV1Schema,
}).strict().superRefine((value, context) => {
  if (value.request_digest !== value.readiness.request_digest || value.artifact_digest !== value.readiness.artifact_digest) context.addIssue({ code: z.ZodIssueCode.custom, message: "persisted intake digests must match the authorized readiness" });
  if (value.staged_pm_digest !== canonicalDigest(value.readiness.pm)) context.addIssue({ code: z.ZodIssueCode.custom, message: "persisted intake must bind the canonical staged PM output" });
  if (value.request_id !== value.readiness.task_spec.request_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "persisted intake request identity must match the TaskSpec" });
  if (value.card_authorization_digest !== canonicalCardAuthorizationDigest(value)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["card_authorization_digest"], message: "persisted intake must bind the exact generation-specific card authorization" });
});
export type PersistIntakeInput = z.infer<typeof PersistIntakeInputSchema>;
const persistedIntakeWinnerShape = { request_digest: DigestSchema, task_id: TaskIdSchema, artifact_digest: DigestSchema, readiness: IntakeReadinessV1Schema };
const persistedIntakeWinner = <Status extends "created" | "existing" | "found">(status: Status) => z.object({ ...persistedIntakeWinnerShape, status: z.literal(status) }).strict().superRefine((value, context) => {
  if (value.request_digest !== value.readiness.request_digest
    || value.task_id !== value.readiness.task_id
    || value.artifact_digest !== value.readiness.artifact_digest) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "persisted intake winner identities must match readiness" });
  }
});
export const PersistIntakeResultSchema = z.union([
  persistedIntakeWinner("created"),
  persistedIntakeWinner("existing"),
  z.object({ status: z.literal("stale_generation") }).strict(),
  z.object({ status: z.literal("conflict") }).strict(),
]);
export type PersistIntakeResult = z.infer<typeof PersistIntakeResultSchema>;
export const LookupIntakeResultSchema = z.union([z.object({ status: z.literal("not_found") }).strict(), persistedIntakeWinner("found")]);
export type LookupIntakeResult = z.infer<typeof LookupIntakeResultSchema>;
export const EnsureArtifactInputSchema = z.object({ task_id: TaskIdSchema, artifact_key: ArtifactKeySchema, kind: z.string().min(1), digest: DigestSchema, payload: RedactedPayloadV1Schema }).strict();
export type EnsureArtifactInput = z.infer<typeof EnsureArtifactInputSchema>;
export const EnsureArtifactResultSchema = z.object({ artifact_id: ArtifactIdSchema, created: z.boolean(), digest: DigestSchema }).strict();
export type EnsureArtifactResult = z.infer<typeof EnsureArtifactResultSchema>;
const activationQualificationSubject = (value: {
  source_snapshot_digest: string;
  request_digest: string;
  task_id: string;
  task_spec_digest: string;
  mandate_id: string;
  mandate_digest: string;
  approval_request_digest: string;
  budget_policy_digest: string;
  route_registry_revision: number;
  routes: z.infer<typeof RouteEvidenceV1Schema>[];
  route_snapshot_digest: string;
  valid_until: string;
}) => ({
  schema_version: "agentdash.activation-qualification/v1" as const,
  source_snapshot_digest: value.source_snapshot_digest,
  request_digest: value.request_digest,
  task_id: value.task_id,
  task_spec_digest: value.task_spec_digest,
  mandate_id: value.mandate_id,
  mandate_digest: value.mandate_digest,
  approval_request_digest: value.approval_request_digest,
  budget_policy_digest: value.budget_policy_digest,
  route_registry_revision: value.route_registry_revision,
  routes: value.routes,
  route_snapshot_digest: value.route_snapshot_digest,
  valid_until: value.valid_until,
});

export function canonicalizeActivationRoutes(routes: readonly z.infer<typeof RouteEvidenceV1Schema>[]): z.infer<typeof RouteEvidenceV1Schema>[] {
  return [...routes].sort((left, right) => {
    const length = Math.min(left.route_id.length, right.route_id.length);
    for (let index = 0; index < length; index += 1) {
      const difference = left.route_id.charCodeAt(index) - right.route_id.charCodeAt(index);
      if (difference !== 0) return difference;
    }
    return left.route_id.length - right.route_id.length;
  });
}

export function canonicalActivationQualificationDigest(value: Parameters<typeof activationQualificationSubject>[0]): z.infer<typeof DigestSchema> {
  return canonicalDigest(activationQualificationSubject(value));
}

export const ActivationQualificationV1Schema = z.object({
  schema_version: z.literal("agentdash.activation-qualification/v1"),
  source_snapshot_digest: DigestSchema,
  request_digest: DigestSchema,
  task_id: TaskIdSchema,
  task_spec_digest: DigestSchema,
  mandate_id: z.string().min(1),
  mandate_digest: DigestSchema,
  approval_request_digest: DigestSchema,
  budget_policy_digest: DigestSchema,
  route_registry_revision: z.number().int().nonnegative().safe(),
  routes: z.array(RouteEvidenceV1Schema),
  route_snapshot_digest: DigestSchema,
  valid_until: TimestampSchema,
  qualification_digest: DigestSchema,
}).strict().superRefine((value, context) => {
  const canonicalRoutes = canonicalizeActivationRoutes(value.routes);
  if (new Set(value.routes.map((route) => route.route_id)).size !== value.routes.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["routes"], message: "qualification routes must be unique by route identity" });
  if (canonicalDigest(value.routes) !== canonicalDigest(canonicalRoutes)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["routes"], message: "qualification routes must use canonical route-id ordering" });
  if (value.route_snapshot_digest !== canonicalDigest(value.routes)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["route_snapshot_digest"], message: "qualification must bind the exact route rows" });
  if (value.routes.some((route) => Date.parse(value.valid_until) > Date.parse(route.expires_at))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["valid_until"], message: "qualification lifetime may not outlive any qualified route" });
  if (value.qualification_digest !== canonicalActivationQualificationDigest(value)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["qualification_digest"], message: "qualification digest must bind the stable qualification subject" });
});
export type ActivationQualificationV1 = z.infer<typeof ActivationQualificationV1Schema>;

export const GetActivationQualificationInputSchema = z.object({ source_snapshot_digest: DigestSchema, request_digest: DigestSchema, task_id: TaskIdSchema, task_spec_digest: DigestSchema, mandate_digest: DigestSchema, approval_request_digest: DigestSchema, budget_policy_digest: DigestSchema }).strict();
export type GetActivationQualificationInput = z.infer<typeof GetActivationQualificationInputSchema>;
export const GetActivationQualificationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("qualified"), route_registry_revision: z.number().int().nonnegative().safe(), routes: z.array(RouteEvidenceV1Schema) }).strict(),
  z.object({ status: z.literal("conflict") }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.string().min(1).max(512) }).strict(),
]);
export type GetActivationQualificationResult = z.infer<typeof GetActivationQualificationResultSchema>;

export const ActivationResultV1Schema = z.object({ schema_version: z.literal("agentdash.activation-result/v1"), task_id: TaskIdSchema, command_id: CommandIdSchema, authority_id: AuthorityIdSchema, task_spec_digest: DigestSchema, mandate_digest: DigestSchema, source_snapshot_digest: DigestSchema, qualification_digest: DigestSchema, activated_at: TimestampSchema }).strict();
export const ActivateMandateInputSchema = z.object({ expected_snapshot_digest: DigestSchema, request_digest: DigestSchema, task_id: TaskIdSchema, task_spec_digest: DigestSchema, mandate_digest: DigestSchema, source_approval_request: CEOInputRequestV1Schema, qualification: ActivationQualificationV1Schema, command: CEOCommandV1Schema, grant: ApprovalGrantV1Schema, mandate: ExecutionMandateV1Schema }).strict().superRefine((value, context) => {
  const request = value.source_approval_request;
  const qualification = value.qualification;
  const command = value.command;
  const grant = value.grant;
  const mandate = value.mandate;
  const expectedRouteIds = mandate.action_nodes.flatMap((node) => node.route_id === null ? [] : [node.route_id]);
  const referencedRouteIds = new Set(expectedRouteIds);
  if (mandate.verification_step.route_id !== null) referencedRouteIds.add(mandate.verification_step.route_id);
  const evidenceByRoute = new Map(qualification.routes.map((route) => [route.route_id, route]));
  const taskAndMandateBound = value.task_id === mandate.task_id
    && value.task_spec_digest === mandate.task_spec_revision.task_spec_digest
    && value.mandate_digest === canonicalDigest(mandate)
    && value.request_digest === qualification.request_digest
    && qualification.source_snapshot_digest === value.expected_snapshot_digest
    && qualification.task_id === value.task_id
    && qualification.task_spec_digest === value.task_spec_digest
    && qualification.mandate_id === mandate.mandate_id
    && qualification.mandate_digest === value.mandate_digest
    && qualification.approval_request_digest === canonicalDigest(request)
    && qualification.budget_policy_digest === mandate.budget_policy_digest;
  const sourceRequestBound = request.decision_type === "initial_mandate_approval"
    && request.active_mandate_id === null
    && request.completed_attempt_receipt_ids.length === 0
    && request.task_id === value.task_id
    && request.task_spec_revision === mandate.task_spec_revision.plan_revision
    && request.task_spec_digest === value.task_spec_digest
    && request.proposed_mandate_id === mandate.mandate_id
    && request.proposed_mandate_digest === value.mandate_digest
    && request.proposed_diff.digest === canonicalDigest({ task_spec_digest: value.task_spec_digest, mandate_digest: value.mandate_digest })
    && canonicalDigest(request.proposed_limits) === canonicalDigest(mandate.aggregate_budget)
    && canonicalDigest(request.proposed_route_ids) === canonicalDigest(expectedRouteIds)
    && canonicalDigest(request.proposed_side_effects) === canonicalDigest(mandate.capability_scope.allowed_side_effects)
    && Date.parse(request.expires_at) <= Date.parse(mandate.expiry);
  const commandBound = command.command_type === "approve"
    && command.requested_decision === "initial_mandate_approval"
    && command.task_id === value.task_id
    && command.displayed_task_spec_revision === mandate.task_spec_revision.plan_revision
    && command.displayed_task_spec_digest === value.task_spec_digest
    && command.active_mandate_id === null
    && command.proposed_mandate_id === mandate.mandate_id
    && command.viewed_mandate_digest === value.mandate_digest
    && command.source_snapshot_digest === value.expected_snapshot_digest
    && command.qualification_digest === qualification.qualification_digest;
  const grantBound = grant.source_command_id === command.command_id
    && grant.approved_by === command.authenticated_session_id
    && grant.approved_at === command.created_at
    && grant.expires_at === command.expires_at
    && grant.source_snapshot_digest === value.expected_snapshot_digest
    && grant.qualification_digest === qualification.qualification_digest
    && approvalGrantFulfillsMandate(mandate, grant);
  const deadlinesBound = Date.parse(command.expires_at) <= Date.parse(request.expires_at)
    && Date.parse(command.expires_at) <= Date.parse(mandate.expiry)
    && Date.parse(command.expires_at) <= Date.parse(qualification.valid_until)
    && Date.parse(request.created_at) <= Date.parse(command.created_at)
    && Date.parse(qualification.valid_until) === Math.min(Date.parse(request.expires_at), Date.parse(mandate.expiry), ...qualification.routes.map((route) => Date.parse(route.expires_at)));
  const routesBound = evidenceByRoute.size === qualification.routes.length
    && evidenceByRoute.size === referencedRouteIds.size
    && [...referencedRouteIds].every((routeId) => evidenceByRoute.has(routeId))
    && qualification.routes.every((route) => route.status === "active"
      && Date.parse(route.evaluated_at) <= Date.parse(command.created_at)
      && Date.parse(route.expires_at) >= Date.parse(qualification.valid_until)
      && Date.parse(route.expires_at) >= Date.parse(command.expires_at)
      && Date.parse(route.expires_at) >= Date.parse(grant.expires_at))
    && mandate.action_nodes.every((node) => node.route_id === null || (evidenceByRoute.get(node.route_id)?.route_proof_id === node.route_proof_id && evidenceByRoute.get(node.route_id)?.evidence_digest === node.route_proof_digest))
    && (mandate.verification_step.route_id === null || (evidenceByRoute.get(mandate.verification_step.route_id)?.route_proof_id === mandate.verification_step.route_proof_id && evidenceByRoute.get(mandate.verification_step.route_id)?.evidence_digest === mandate.verification_step.route_proof_digest));
  if (!taskAndMandateBound || !sourceRequestBound || !commandBound || !grantBound || !deadlinesBound || !routesBound) context.addIssue({ code: z.ZodIssueCode.custom, message: "activation envelope must bind one exact qualified approval authority tuple" });
});
export type ActivateMandateInput = z.infer<typeof ActivateMandateInputSchema>;
export const ActivateMandateResultSchema = z.discriminatedUnion("status", [ActivationResultV1Schema.extend({ status: z.literal("activated") }).strict(), ActivationResultV1Schema.extend({ status: z.literal("existing") }).strict(), z.object({ status: z.literal("conflict") }).strict()]);
export type ActivateMandateResult = z.infer<typeof ActivateMandateResultSchema>;
export const ActivationSnapshotV1Schema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_found") }).strict(),
  z.object({ status: z.literal("pending"), snapshot_digest: DigestSchema, request_digest: DigestSchema, task_spec: TaskSpecV1Schema, mandate: ExecutionMandateV1Schema, approval_request: CEOInputRequestV1Schema, readiness: IntakeReadinessV1Schema.refine((value) => value.kind === "approval_required", "pending activation requires approval readiness"), budget_policy: BudgetPolicySnapshotV1Schema }).strict(),
  z.object({ status: z.literal("active"), snapshot_digest: DigestSchema, source_snapshot_digest: DigestSchema, request_digest: DigestSchema, task_spec: TaskSpecV1Schema, mandate: ExecutionMandateV1Schema, source_approval_request: CEOInputRequestV1Schema, qualification: ActivationQualificationV1Schema, replay_binding_digest: DigestSchema, consumed_at: z.number().int().nonnegative().safe(), command: CEOCommandV1Schema, grant: ApprovalGrantV1Schema, result: ActivationResultV1Schema }).strict(),
]).superRefine((value, context) => {
  if (value.status === "not_found") return;
  const taskSpecDigest = canonicalDigest(value.task_spec);
  const mandateDigest = canonicalDigest(value.mandate);
  if (value.status === "pending") {
    if (value.request_digest !== value.readiness.request_digest
      || canonicalDigest(value.task_spec) !== canonicalDigest(value.readiness.task_spec)
      || canonicalDigest(value.mandate) !== canonicalDigest(value.readiness.mandate)
      || canonicalDigest(value.approval_request) !== canonicalDigest(value.readiness.activation.request)
      || value.readiness.budget_policy_digest !== canonicalDigest(value.budget_policy)
      || value.mandate.budget_policy_digest !== canonicalDigest(value.budget_policy)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "pending activation snapshot must preserve the exact sealed readiness tuple" });
    }
    return;
  }
  const envelope = ActivateMandateInputSchema.safeParse({ expected_snapshot_digest: value.source_snapshot_digest, request_digest: value.request_digest, task_id: value.mandate.task_id, task_spec_digest: taskSpecDigest, mandate_digest: mandateDigest, source_approval_request: value.source_approval_request, qualification: value.qualification, command: value.command, grant: value.grant, mandate: value.mandate });
  const consumedAt = value.consumed_at;
  const resultBound = value.result.task_id === value.mandate.task_id
    && value.result.command_id === value.command.command_id
    && value.result.authority_id === value.grant.authority_id
    && value.result.task_spec_digest === taskSpecDigest
    && value.result.mandate_digest === mandateDigest
    && value.result.source_snapshot_digest === value.source_snapshot_digest
    && value.result.qualification_digest === value.qualification.qualification_digest
    && value.result.activated_at === value.command.created_at;
  if (!envelope.success
    || consumedAt !== Date.parse(value.command.created_at)
    || consumedAt !== Date.parse(value.grant.approved_at)
    || consumedAt >= Date.parse(value.source_approval_request.expires_at)
    || consumedAt >= Date.parse(value.mandate.expiry)
    || consumedAt >= Date.parse(value.qualification.valid_until)
    || !resultBound) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "active activation snapshot must preserve the exact materialized authority tuple" });
  }
});
export type ActivationSnapshotV1 = z.infer<typeof ActivationSnapshotV1Schema>;
export const LookupActivationByCommandResultSchema = z.discriminatedUnion("status", [z.object({ status: z.literal("not_found") }).strict(), z.object({ status: z.literal("found"), result: ActivationResultV1Schema }).strict()]);
export type LookupActivationByCommandResult = z.infer<typeof LookupActivationByCommandResultSchema>;
export const PrepareActionInputSchema = z.object({ task_id: TaskIdSchema, authority: ActionAuthorityV1Schema, command: ActionCommandV1Schema, command_headroom: BudgetV1Schema, task_reserve_refs: z.array(ReceiptIdSchema), launch_intent_digest: DigestSchema }).strict().superRefine((value, context) => {
  const authority = value.authority;
  const command = value.command;
  if (value.task_id !== authority.task_id || value.task_id !== command.task_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "prepared action task identities must match" });
  const authorityFields = ["authority_id", "task_spec_revision", "task_spec_digest", "mandate_id", "mandate_digest", "node_id", "action_role", "executor_kind", "route_id", "route_proof_id", "route_proof_digest", "action_input_digest"] as const;
  for (const field of authorityFields) if (authority[field] !== command[field]) context.addIssue({ code: z.ZodIssueCode.custom, path: ["command", field], message: `prepared action ${field} must match authority` });
  if (authority.allowed_adapter_operation !== command.adapter_operation) context.addIssue({ code: z.ZodIssueCode.custom, path: ["command", "adapter_operation"], message: "prepared action adapter operation must match authority" });
  if (command.authority_digest !== canonicalDigest(authority)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["command", "authority_digest"], message: "prepared command must bind the canonical authority" });
  if (Date.parse(command.created_at) < Date.parse(authority.issued_at) || Date.parse(command.issued_at) < Date.parse(authority.issued_at) || Date.parse(command.expires_at) > Date.parse(authority.expires_at)) context.addIssue({ code: z.ZodIssueCode.custom, message: "prepared command timestamps must remain within the authority window" });
  if (!sameBudget(value.command_headroom, authority.action_headroom) || !sameBudget(value.command_headroom, command.command_headroom)) context.addIssue({ code: z.ZodIssueCode.custom, message: "prepared action headroom must match authority and command" });
  const expectedReserves = reserveKeys.map((key) => authority.task_reserve_refs[key]);
  if (new Set(expectedReserves).size !== expectedReserves.length || reserveKeys.some((key) => authority.task_reserve_refs[key] !== command.task_reserve_refs[key]) || value.task_reserve_refs.length !== expectedReserves.length || expectedReserves.some((reference, index) => value.task_reserve_refs[index] !== reference)) context.addIssue({ code: z.ZodIssueCode.custom, message: "prepared action reserve references must be unique and category-ordered" });
});
export type PrepareActionInput = z.infer<typeof PrepareActionInputSchema>;
export const PreparedActionResultSchema = z.object({ run_id: RunIdSchema, command: ActionCommandV1Schema, created: z.boolean() }).strict();
export type PreparedActionResult = z.infer<typeof PreparedActionResultSchema>;

export const CodeGBindingV1Schema = z.object({ work_task_id: WorkTaskIdSchema, run_sequence: RunIdSchema, conversation_id: CodeGConversationIdSchema, connection_id: ConnectionIdSchema.nullable(), harness_session_id: HarnessSessionIdSchema.nullable(), folder_id: FolderIdSchema }).strict();
export type CodeGBindingV1 = z.infer<typeof CodeGBindingV1Schema>;
export const BindWorkerSessionInputSchema = z.object({ task_id: TaskIdSchema, run_id: RunIdSchema, command_id: CommandIdSchema, binding: CodeGBindingV1Schema }).strict().superRefine((value, context) => { if (value.run_id !== value.binding.run_sequence) context.addIssue({ code: z.ZodIssueCode.custom, message: "worker binding run identity must match" }); });
export type BindWorkerSessionInput = z.infer<typeof BindWorkerSessionInputSchema>;
export const AppendRunEventInputSchema = z.object({ task_id: TaskIdSchema, run_id: RunIdSchema, event_id: EventIdSchema, digest: DigestSchema, payload: RedactedPayloadV1Schema }).strict();
export type AppendRunEventInput = z.infer<typeof AppendRunEventInputSchema>;
export const CloseActionInputSchema = z.object({ task_id: TaskIdSchema, run_id: RunIdSchema, outcome: ActionOutcomeV1Schema, receipt_digest: DigestSchema }).strict().superRefine((value, context) => { if (value.task_id !== value.outcome.task_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "closed action task identity must match outcome" }); });
export type CloseActionInput = z.infer<typeof CloseActionInputSchema>;
export const SetCEOInputInputSchema = z.object({ task_id: TaskIdSchema, request: CEOInputRequestV1Schema.nullable(), expected_revision: z.number().int().nonnegative() }).strict().superRefine((value, context) => { if (value.request !== null && (value.task_id !== value.request.task_id || value.expected_revision !== value.request.task_spec_revision)) context.addIssue({ code: z.ZodIssueCode.custom, message: "CEO-input task and revision must match envelope" }); });
export type SetCEOInputInput = z.infer<typeof SetCEOInputInputSchema>;
export const TerminalIntentInputSchema = z.object({ task_id: TaskIdSchema, outcome: TaskOutcomeV1Schema, receipt_digest: DigestSchema, expected_nonterminal: z.literal(true) }).strict().superRefine((value, context) => { if (value.task_id !== value.outcome.task_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "terminal-intent task identity must match outcome" }); });
export type TerminalIntentInput = z.infer<typeof TerminalIntentInputSchema>;

const boardLanesShape = z.object({ ready: z.array(RedactedPayloadV1Schema), working: z.array(RedactedPayloadV1Schema), needs_you: z.array(RedactedPayloadV1Schema), stopped: z.array(RedactedPayloadV1Schema), completed: z.array(RedactedPayloadV1Schema) }).strict();
export const MissionControlBoardV1Schema = z.object({ generated_at: TimestampSchema, lanes: boardLanesShape, archived_count: z.number().int().nonnegative(), unavailable_reason: z.string().min(1).nullable() }).strict();
export type MissionControlBoardV1 = z.infer<typeof MissionControlBoardV1Schema>;

export const CodeGEnsureResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("created"), binding: CodeGBindingV1Schema }).strict(),
  z.object({ status: z.literal("found"), binding: CodeGBindingV1Schema }).strict(),
  z.object({ status: z.literal("unknown"), binding: z.null() }).strict(),
]);
export type CodeGEnsureResult = z.infer<typeof CodeGEnsureResultSchema>;
export const CodeGLookupResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("found"), binding: CodeGBindingV1Schema }).strict(),
  z.object({ status: z.literal("not_found") }).strict(),
  z.object({ status: z.literal("unknown"), reason: z.string().min(1) }).strict(),
]);
export type CodeGLookupResult = z.infer<typeof CodeGLookupResultSchema>;
export const CodeGSnapshotV1Schema = z.object({ binding: CodeGBindingV1Schema, terminal: z.boolean(), source_commit: GitCommitIdSchema.nullable(), source_tree: GitTreeIdSchema.nullable(), raw: RedactedPayloadV1Schema }).strict();
export type CodeGSnapshotV1 = z.infer<typeof CodeGSnapshotV1Schema>;
export const CodeGActivityV1Schema = z.object({ cursor: z.string().min(1), source_timestamp: TimestampSchema, kind: z.string().min(1), payload: RedactedPayloadV1Schema }).strict();
export type CodeGActivityV1 = z.infer<typeof CodeGActivityV1Schema>;
export const CodeGCancelResultSchema = z.object({ status: z.enum(["confirmed", "not_active", "unknown"]), binding: CodeGBindingV1Schema }).strict();
export type CodeGCancelResult = z.infer<typeof CodeGCancelResultSchema>;
export const CodeGWorkspaceBindingV1Schema = z.object({ project_id: ProjectIdSchema, requested_root: z.string().min(1), real_root: z.string().min(1), folder_id: FolderIdSchema }).strict();
export type CodeGWorkspaceBindingV1 = z.infer<typeof CodeGWorkspaceBindingV1Schema>;
export const ReviewedRecallV1Schema = z.object({ page_id: z.string().min(1), page_digest: DigestSchema, excerpt: z.string().min(1), reviewed_at: TimestampSchema }).strict();
export type ReviewedRecallV1 = z.infer<typeof ReviewedRecallV1Schema>;
export const ActivationDecisionV1Schema = activationShape;
export type ActivationDecisionV1 = z.infer<typeof ActivationDecisionV1Schema>;
