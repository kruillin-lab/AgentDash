import { z } from "zod";

import {
  ArtifactIdSchema,
  ArtifactKeySchema,
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
import { ActionAuthorityV1Schema, ActionCommandV1Schema, ApprovalGrantV1Schema, AutoActivationReceiptV1Schema, CEOInputRequestV1Schema } from "./authority";
import { ExecutionMandateV1Schema } from "./mandate";
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

export const PersistIntakeInputSchema = z.object({ request_id: RequestIdSchema, proposal_digest: DigestSchema, task_spec: TaskSpecV1Schema, mandate: ExecutionMandateV1Schema, route_snapshot: z.array(RouteEvidenceV1Schema), activation: activationShape }).strict().superRefine((value, context) => {
  if (value.request_id !== value.task_spec.request_id || value.request_id !== value.mandate.request_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "intake request identities must match" });
  if (value.task_spec.plan_revision !== value.mandate.task_spec_revision.plan_revision) context.addIssue({ code: z.ZodIssueCode.custom, message: "intake TaskSpec revisions must match" });
  const taskSpecDigest = canonicalDigest(value.task_spec);
  const objectiveDigest = canonicalDigest(value.task_spec.objective);
  const acceptanceDigest = canonicalDigest(value.task_spec.acceptance_checks);
  const mandateDigest = canonicalDigest(value.mandate);
  if (value.mandate.task_spec_revision.task_spec_digest !== taskSpecDigest || value.mandate.task_spec_revision.objective_digest !== objectiveDigest || value.mandate.task_spec_revision.acceptance_digest !== acceptanceDigest) context.addIssue({ code: z.ZodIssueCode.custom, message: "intake mandate must bind canonical TaskSpec, objective, and acceptance digests" });
  if (value.mandate.verification_step.acceptance_digest !== acceptanceDigest || canonicalDigest(value.mandate.verification_step.acceptance_checks) !== acceptanceDigest) context.addIssue({ code: z.ZodIssueCode.custom, message: "intake verifier must bind the exact canonical acceptance checks" });
  const workspace = value.task_spec.workspace;
  const mandateWorkspace = value.mandate.workspace_scope;
  if (workspace.project_id !== mandateWorkspace.project_id || workspace.mode !== mandateWorkspace.mode || workspace.path !== mandateWorkspace.path) context.addIssue({ code: z.ZodIssueCode.custom, message: "intake workspace scopes must match" });
  if (!budgetWithin(value.mandate.aggregate_budget, value.task_spec.budget)) context.addIssue({ code: z.ZodIssueCode.custom, message: "mandate aggregate budget may not exceed TaskSpec" });
  const finalization = value.mandate.finalization_step;
  if (finalization.mutation_type !== value.task_spec.finalization.mutation_type || finalization.allowed_path_prefixes.some((path) => !value.task_spec.finalization.allowed_path_prefixes.includes(path)) || value.task_spec.finalization.prohibited_changes.some((prohibition) => !finalization.prohibited_changes.includes(prohibition))) context.addIssue({ code: z.ZodIssueCode.custom, message: "mandate finalization scope must match or narrow TaskSpec" });
  if (!value.task_spec.finalization.authority_predicate.allowed_external_mutation && finalization.mutation_type === "approved_merge") context.addIssue({ code: z.ZodIssueCode.custom, message: "mandate finalization exceeds TaskSpec external-mutation authority" });
  if (value.task_spec.prohibited_actions.some((prohibition) => !value.mandate.capability_scope.prohibited_actions.includes(prohibition))) context.addIssue({ code: z.ZodIssueCode.custom, message: "mandate capability scope may not weaken TaskSpec prohibitions" });
  const phaseRoles = { execute: "execute", fallback: "retry", remediate: "remediate", verify: "verify", finalize: "finalize" } as const;
  const deterministicExecutors = { execute: "controller", fallback: "controller", remediate: "controller", verify: "verifier", finalize: "finalizer" } as const;
  const phaseRoleSet = new Set<string>(Object.values(phaseRoles));
  const phaseNodes = value.mandate.action_nodes.filter((node) => phaseRoleSet.has(node.action_role));
  if (phaseNodes.length !== value.task_spec.route_plan.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "mandate phase actions must correspond one-to-one with TaskSpec phases" });
  for (const [index, phase] of value.task_spec.route_plan.entries()) {
    const role = phaseRoles[phase.phase];
    const node = phaseNodes[index];
    if (!node) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `TaskSpec ${phase.phase} phase is missing its ordered mandate action` });
      continue;
    }
    const executorMatches = phase.deterministic ? node.executor_kind === deterministicExecutors[phase.phase] : node.executor_kind === "codeg_worker";
    if (node.action_role !== role || !executorMatches || node.route_id !== phase.route_id) context.addIssue({ code: z.ZodIssueCode.custom, message: `TaskSpec ${phase.phase} phase must positionally match its mandate role, executor, and route` });
  }
  const verifierPhases = value.task_spec.route_plan.filter((phase) => phase.phase === "verify");
  const verifierNodes = value.mandate.action_nodes.filter((node) => node.action_role === "verify");
  if (verifierPhases.length !== 1 || verifierNodes.length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "intake requires exactly one bound verifier phase and mandate action" });
  } else {
    const verifierPhase = verifierPhases[0];
    const verifierNode = verifierNodes[0];
    const verifier = value.mandate.verification_step;
    if (verifierPhase.deterministic) {
      if (verifier.deterministic_verifier_id !== verifierPhase.name || verifier.route_id !== null || verifier.route_proof_id !== null || verifier.route_proof_digest !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: "deterministic verifier identity must exactly match its TaskSpec phase" });
    } else if (verifier.deterministic_verifier_id !== null || verifier.route_id !== verifierPhase.route_id || verifier.route_id !== verifierNode.route_id || verifier.route_proof_id !== verifierNode.route_proof_id || verifier.route_proof_digest !== verifierNode.route_proof_digest) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "routed verifier must exactly match its TaskSpec phase and mandate action proof" });
    }
  }
  if (value.task_spec.route_plan.filter((phase) => phase.phase === "finalize").length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: "intake requires exactly one finalization phase" });
  if ((value.task_spec.risk_mode === "auto") !== (value.activation.kind === "auto")) context.addIssue({ code: z.ZodIssueCode.custom, message: "TaskSpec risk mode must match activation branch" });
  const activation = value.activation.kind === "auto" ? value.activation.receipt : value.activation.request;
  if (activation.task_id !== value.mandate.task_id || activation.task_spec_revision !== value.mandate.task_spec_revision.plan_revision || activation.task_spec_digest !== value.mandate.task_spec_revision.task_spec_digest) context.addIssue({ code: z.ZodIssueCode.custom, message: "intake activation must match task and TaskSpec revision" });
  const phaseRouteIds = value.task_spec.route_plan.map((phase) => phase.route_id).filter((routeId): routeId is NonNullable<typeof routeId> => routeId !== null);
  if (value.activation.kind === "auto") {
    if (value.activation.receipt.mandate_id !== value.mandate.mandate_id || value.activation.receipt.mandate_digest !== mandateDigest || value.activation.receipt.objective_digest !== objectiveDigest || value.activation.receipt.acceptance_digest !== acceptanceDigest) context.addIssue({ code: z.ZodIssueCode.custom, message: "auto activation must bind the canonical mandate and TaskSpec claims" });
    const receipt = value.activation.receipt;
    if (canonicalDigest(receipt.capability_scope) !== canonicalDigest(value.mandate.capability_scope) || receipt.capability_scope_digest !== canonicalDigest(receipt.capability_scope)) context.addIssue({ code: z.ZodIssueCode.custom, message: "auto activation capability scope must exactly match mandate" });
    if (canonicalDigest(receipt.workspace_scope) !== canonicalDigest(value.mandate.workspace_scope)) context.addIssue({ code: z.ZodIssueCode.custom, message: "auto activation workspace must exactly match mandate" });
    if (!sameBudget(receipt.aggregate_budget, value.mandate.aggregate_budget)) context.addIssue({ code: z.ZodIssueCode.custom, message: "auto activation budget must exactly match mandate" });
    if (canonicalDigest(receipt.ordered_route_ids) !== canonicalDigest(phaseRouteIds)) context.addIssue({ code: z.ZodIssueCode.custom, message: "auto activation ordered routes must exactly match the validated TaskSpec phase plan" });
    if (receipt.finalization_predicate.mutation_type !== finalization.mutation_type || receipt.finalization_predicate.mutation_manifest_digest !== finalization.mutation_manifest.manifest_digest) context.addIssue({ code: z.ZodIssueCode.custom, message: "auto activation finalization predicate must exactly match mandate" });
    if (value.mandate.authority_source.kind !== "auto_policy_receipt" || value.mandate.authority_source.authority_id !== receipt.authority_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "auto activation authority source must match mandate" });
  } else {
    const request = value.activation.request;
    if (request.proposed_mandate_id !== value.mandate.mandate_id || request.proposed_mandate_digest !== mandateDigest) context.addIssue({ code: z.ZodIssueCode.custom, message: "approval request must bind the canonical mandate" });
    if (!sameBudget(request.proposed_limits, value.mandate.aggregate_budget) || canonicalDigest(request.proposed_route_ids) !== canonicalDigest(phaseRouteIds) || canonicalDigest(request.proposed_side_effects) !== canonicalDigest(value.mandate.capability_scope.allowed_side_effects)) context.addIssue({ code: z.ZodIssueCode.custom, message: "approval request claims must exactly match the validated phase plan and mandate" });
  }
  const referencedRouteIds = new Set<string>();
  for (const phase of value.task_spec.route_plan) if (phase.route_id !== null) referencedRouteIds.add(phase.route_id);
  for (const node of value.mandate.action_nodes) if (node.route_id !== null) referencedRouteIds.add(node.route_id);
  if (value.mandate.verification_step.route_id !== null) referencedRouteIds.add(value.mandate.verification_step.route_id);
  const activationRouteIds = value.activation.kind === "auto" ? value.activation.receipt.ordered_route_ids : value.activation.request.proposed_route_ids;
  for (const routeId of activationRouteIds) referencedRouteIds.add(routeId);
  const evidenceByRoute = new Map<string, z.infer<typeof RouteEvidenceV1Schema>>(value.route_snapshot.map((evidence) => [evidence.route_id, evidence]));
  if (evidenceByRoute.size !== value.route_snapshot.length || evidenceByRoute.size !== referencedRouteIds.size || [...referencedRouteIds].some((routeId) => !evidenceByRoute.has(routeId))) context.addIssue({ code: z.ZodIssueCode.custom, message: "route snapshot must exactly cover every referenced route" });
  for (const phase of value.task_spec.route_plan) if (phase.route_id !== null && evidenceByRoute.get(phase.route_id)?.task_class !== phase.task_class) context.addIssue({ code: z.ZodIssueCode.custom, message: "route snapshot task class must match every TaskSpec route phase" });
  for (const node of value.mandate.action_nodes) {
    if (node.route_id === null) continue;
    const evidence = evidenceByRoute.get(node.route_id);
    if (!evidence || evidence.route_proof_id !== node.route_proof_id || evidence.evidence_digest !== node.route_proof_digest) context.addIssue({ code: z.ZodIssueCode.custom, message: "route snapshot must bind each mandate action proof" });
  }
  const verification = value.mandate.verification_step;
  if (verification.route_id !== null) {
    const evidence = evidenceByRoute.get(verification.route_id);
    if (!evidence || evidence.route_proof_id !== verification.route_proof_id || evidence.evidence_digest !== verification.route_proof_digest) context.addIssue({ code: z.ZodIssueCode.custom, message: "route snapshot must bind the verifier proof" });
  }
});
export type PersistIntakeInput = z.infer<typeof PersistIntakeInputSchema>;
export const PersistIntakeResultSchema = z.object({ task_id: TaskIdSchema, created: z.boolean(), task_spec_digest: DigestSchema, mandate_digest: DigestSchema }).strict();
export type PersistIntakeResult = z.infer<typeof PersistIntakeResultSchema>;
export const EnsureArtifactInputSchema = z.object({ task_id: TaskIdSchema, artifact_key: ArtifactKeySchema, kind: z.string().min(1), digest: DigestSchema, payload: RedactedPayloadV1Schema }).strict();
export type EnsureArtifactInput = z.infer<typeof EnsureArtifactInputSchema>;
export const EnsureArtifactResultSchema = z.object({ artifact_id: ArtifactIdSchema, created: z.boolean(), digest: DigestSchema }).strict();
export type EnsureArtifactResult = z.infer<typeof EnsureArtifactResultSchema>;
export const ActivateMandateInputSchema = z.object({ task_id: TaskIdSchema, task_spec_digest: DigestSchema, mandate_digest: DigestSchema, activation: z.union([ApprovalGrantV1Schema, AutoActivationReceiptV1Schema]) }).strict().superRefine((value, context) => {
  if (value.task_id !== value.activation.task_id || value.task_spec_digest !== value.activation.task_spec_digest || value.mandate_digest !== value.activation.mandate_digest) context.addIssue({ code: z.ZodIssueCode.custom, message: "activation envelope must match its authority" });
});
export type ActivateMandateInput = z.infer<typeof ActivateMandateInputSchema>;
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
