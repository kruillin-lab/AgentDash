import { z } from "zod";

import { AuthorityIdSchema, BudgetV1Schema, DigestSchema, ProjectIdSchema, TaskIdSchema, WorkspacePolicyV1Schema, WorkspaceScopeV1Schema, canonicalDigest } from "./common";
import { AutoActivationReceiptV1Schema, CEOInputRequestV1Schema } from "./authority";
import { ActionBudgetLimitV1Schema, ExecutionMandateTemplateV1Schema, ExecutionMandateV1Schema } from "./mandate";
import { ManagementProposalV1Schema } from "./proposals";
import { RouteEvidenceV1Schema } from "./routes";
import { RoutePlanPhaseV1Schema, TaskSpecV1Schema } from "./task";

export const BudgetPolicySnapshotV1Schema = z.object({
  schema_version: z.literal("agentdash.budget-policy-snapshot/v1"),
  action_limits: z.record(ActionBudgetLimitV1Schema),
  task_reserves: z.object({
    verification: BudgetV1Schema,
    finalization: BudgetV1Schema,
    cancellation: BudgetV1Schema,
    reconciliation: BudgetV1Schema,
  }).strict(),
}).strict().refine((value) => Object.keys(value.action_limits).length > 0, "budget policy requires action ceilings");
export type BudgetPolicySnapshotV1 = z.infer<typeof BudgetPolicySnapshotV1Schema>;

const taskTemplateSchema = z.object({
  acceptance_checks: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)),
  prohibited_actions: z.array(z.string().min(1)),
  project_id: ProjectIdSchema,
  workspace: WorkspaceScopeV1Schema,
  workspace_policy: WorkspacePolicyV1Schema,
  required_capabilities: z.array(z.string().min(1)),
  budget: BudgetV1Schema,
  route_plan: z.array(RoutePlanPhaseV1Schema).min(5),
  finalization: z.object({
    mutation_type: z.enum(["no_change_close", "artifact_delivery", "local_patch", "approved_merge"]),
    authority_predicate: z.object({ required: z.boolean(), allowed_external_mutation: z.boolean() }).strict(),
    allowed_path_prefixes: z.array(z.string().min(1)),
    prohibited_changes: z.array(z.string()),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.finalization.authority_predicate.allowed_external_mutation !== (value.finalization.mutation_type === "approved_merge")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["finalization", "authority_predicate", "allowed_external_mutation"], message: "policy external-mutation authority must exactly match approved-merge finalization" });
});

export const CompilationPolicySnapshotV1Schema = z.object({
  schema_version: z.literal("agentdash.compilation-policy-snapshot/v1"),
  policy_version: z.string().min(1).max(128),
  task_template: taskTemplateSchema,
  mandate_template: ExecutionMandateTemplateV1Schema,
  budget_policy: BudgetPolicySnapshotV1Schema,
  route_snapshot: z.array(RouteEvidenceV1Schema),
  mandate_ttl_ms: z.number().int().positive().max(24 * 60 * 60 * 1_000),
  approval_request_ttl_ms: z.number().int().positive().max(60 * 60 * 1_000),
}).strict().superRefine((value, context) => {
  if (canonicalDigest(value.task_template.workspace) !== canonicalDigest(value.mandate_template.workspace_scope)) context.addIssue({ code: z.ZodIssueCode.custom, message: "policy workspace templates must match" });
  if (canonicalDigest(value.task_template.budget) !== canonicalDigest(value.mandate_template.aggregate_budget)) context.addIssue({ code: z.ZodIssueCode.custom, message: "policy aggregate budgets must match" });
  if (canonicalDigest(value.budget_policy.action_limits) !== canonicalDigest(value.mandate_template.per_action_limits)) context.addIssue({ code: z.ZodIssueCode.custom, message: "policy action ceilings must match mandate template" });
  if (canonicalDigest(value.task_template.acceptance_checks) !== value.mandate_template.verification_step.acceptance_digest || canonicalDigest(value.mandate_template.verification_step.acceptance_checks) !== value.mandate_template.verification_step.acceptance_digest) context.addIssue({ code: z.ZodIssueCode.custom, message: "policy verifier must bind task acceptance checks" });
  if (value.task_template.finalization.mutation_type !== value.mandate_template.finalization_step.mutation_type
    || value.task_template.finalization.authority_predicate.allowed_external_mutation !== (value.mandate_template.finalization_step.mutation_type === "approved_merge")) context.addIssue({ code: z.ZodIssueCode.custom, message: "policy finalization template must bind external-mutation authority" });
  if (value.approval_request_ttl_ms > value.mandate_ttl_ms) context.addIssue({ code: z.ZodIssueCode.custom, path: ["approval_request_ttl_ms"], message: "approval request expiry may not exceed mandate expiry" });
});
export type CompilationPolicySnapshotV1 = z.infer<typeof CompilationPolicySnapshotV1Schema>;

export const PMPresentationV1Schema = z.object({
  text: z.string().min(1).max(4_096),
  session_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  proposal: ManagementProposalV1Schema.superRefine((proposal, context) => {
    if (!(["conversation_only", "create_task"] as string[]).includes(proposal.intent) || proposal.task_id !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: "PM presentation must remain proposal-only" });
  }),
}).strict();
export type PMPresentationV1 = z.infer<typeof PMPresentationV1Schema>;

export const NoStartReasonV1Schema = z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/), message: z.string().min(1).max(512) }).strict();
export const NoStartReportV1Schema = z.object({ schema_version: z.literal("agentdash.no-start-report/v1"), ready: z.boolean(), reasons: z.array(NoStartReasonV1Schema).max(64) }).strict().superRefine((value, context) => {
  if (value.ready === (value.reasons.length > 0)) context.addIssue({ code: z.ZodIssueCode.custom, message: "no-start readiness must match reasons" });
});

const readinessBase = z.object({
  schema_version: z.literal("agentdash.intake-readiness/v1"),
  task_id: TaskIdSchema,
  request_digest: DigestSchema,
  pm: PMPresentationV1Schema,
  proposal_digest: DigestSchema,
  compilation_policy_digest: DigestSchema,
  budget_policy: BudgetPolicySnapshotV1Schema,
  budget_policy_digest: DigestSchema,
  artifact_digest: DigestSchema,
});

const intakeReadinessUnion = z.discriminatedUnion("kind", [
  readinessBase.extend({
    kind: z.literal("blocked_no_start"),
    task_spec: TaskSpecV1Schema,
    candidate_mandate: ExecutionMandateV1Schema.nullable(),
    route_snapshot: z.array(RouteEvidenceV1Schema),
    no_start: NoStartReportV1Schema.refine((report) => !report.ready, "blocked card requires failed no-start"),
    activation: z.null(),
  }).strict(),
  readinessBase.extend({
    kind: z.literal("approval_required"),
    task_spec: TaskSpecV1Schema,
    mandate: ExecutionMandateV1Schema,
    route_snapshot: z.array(RouteEvidenceV1Schema),
    no_start: NoStartReportV1Schema.refine((report) => report.ready, "approval card requires ready no-start"),
    activation: z.object({ kind: z.literal("approval_required"), request: CEOInputRequestV1Schema }).strict(),
  }).strict(),
  readinessBase.extend({
    kind: z.literal("auto_activated"),
    task_spec: TaskSpecV1Schema,
    mandate: ExecutionMandateV1Schema,
    route_snapshot: z.array(RouteEvidenceV1Schema),
    no_start: NoStartReportV1Schema.refine((report) => report.ready, "auto card requires ready no-start"),
    activation: z.object({ kind: z.literal("auto"), receipt: AutoActivationReceiptV1Schema }).strict(),
  }).strict(),
]);
export const IntakeReadinessV1Schema = intakeReadinessUnion.superRefine((value, context) => {
  if (value.budget_policy_digest !== canonicalDigest(value.budget_policy)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["budget_policy_digest"], message: "readiness must bind the complete sealed budget policy" });
  if (value.proposal_digest !== canonicalDigest(value.pm.proposal)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["proposal_digest"], message: "readiness must bind the canonical PM proposal" });
  if (value.task_id !== `task-${value.request_digest}`) context.addIssue({ code: z.ZodIssueCode.custom, path: ["task_id"], message: "readiness task identity must derive from the canonical request digest" });
  const mandate = value.kind === "blocked_no_start" ? value.candidate_mandate : value.mandate;
  const reasonCodes = new Set(value.no_start.reasons.map((reason) => reason.code));
  const taskRouteIds = new Set(value.task_spec.route_plan.flatMap((phase) => phase.route_id === null ? [] : [phase.route_id]));
  const taskEvidenceByRoute = new Map(value.route_snapshot.map((evidence) => [evidence.route_id, evidence]));
  if (taskEvidenceByRoute.size !== value.route_snapshot.length
    || taskEvidenceByRoute.size !== taskRouteIds.size
    || [...taskRouteIds].some((routeId) => !taskEvidenceByRoute.has(routeId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["route_snapshot"], message: "route snapshot must exactly and uniquely cover every TaskSpec route" });
  }
  if (!mandate) {
    if (value.kind === "blocked_no_start" && !reasonCodes.has("invalid_mandate")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["no_start", "reasons"], message: "a missing candidate mandate requires an invalid_mandate reason" });
    return;
  }
  if (value.task_id !== mandate.task_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "readiness task identity must match its mandate" });

  const taskSpecDigest = canonicalDigest(value.task_spec);
  const mandateDigest = canonicalDigest(mandate);
  const routeIds = value.task_spec.route_plan.flatMap((phase) => phase.route_id === null ? [] : [phase.route_id]);
  const expectedRisk = value.kind === "auto_activated"
    ? "auto"
    : value.kind === "approval_required"
      ? "approval_required"
      : mandate.authority_source.kind === "auto_policy_receipt" ? "auto" : "approval_required";
  if (value.task_spec.risk_mode !== expectedRisk
    || mandate.request_id !== value.task_spec.request_id
    || mandate.task_spec_revision.plan_revision !== value.task_spec.plan_revision
    || mandate.task_spec_revision.task_spec_digest !== taskSpecDigest
    || mandate.task_spec_revision.objective_digest !== canonicalDigest(value.task_spec.objective)
    || mandate.task_spec_revision.acceptance_digest !== canonicalDigest(value.task_spec.acceptance_checks)
    || mandate.budget_policy_digest !== value.budget_policy_digest
    || canonicalDigest(mandate.workspace_scope) !== canonicalDigest(value.task_spec.workspace)
    || canonicalDigest(mandate.aggregate_budget) !== canonicalDigest(value.task_spec.budget)
    || mandate.finalization_step.mutation_type !== value.task_spec.finalization.mutation_type
    || value.task_spec.finalization.authority_predicate.allowed_external_mutation !== (mandate.finalization_step.mutation_type === "approved_merge")
    || canonicalDigest(mandate.finalization_step.allowed_path_prefixes) !== canonicalDigest(value.task_spec.finalization.allowed_path_prefixes)
    || canonicalDigest(mandate.finalization_step.prohibited_changes) !== canonicalDigest(value.task_spec.finalization.prohibited_changes)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "readiness executable artifacts must bind the exact TaskSpec" });
  }
  if (value.task_spec.prohibited_actions.some((prohibition) => !mandate.capability_scope.prohibited_actions.includes(prohibition))) context.addIssue({ code: z.ZodIssueCode.custom, message: "mandate capability scope may not weaken TaskSpec prohibitions" });

  const expectedRoles = { execute: "execute", fallback: "retry", remediate: "remediate", verify: "verify", finalize: "finalize" } as const;
  const deterministicExecutors = { execute: "controller", fallback: "controller", remediate: "controller", verify: "verifier", finalize: "finalizer" } as const;
  const phaseRoleSet = new Set<string>(Object.values(expectedRoles));
  const phaseNodes = mandate.action_nodes.filter((node) => phaseRoleSet.has(node.action_role));
  if (phaseNodes.length !== value.task_spec.route_plan.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "mandate phase actions must correspond one-to-one with TaskSpec phases" });
  value.task_spec.route_plan.forEach((phase, index) => {
    const action = phaseNodes[index];
    const expectedExecutor = phase.deterministic ? deterministicExecutors[phase.phase] : "codeg_worker";
    if (!action || action.action_role !== expectedRoles[phase.phase] || action.executor_kind !== expectedExecutor || action.route_id !== phase.route_id) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["task_spec", "route_plan", index], message: "TaskSpec phase must match the ordered mandate action" });
    }
  });
  const verifierPhases = value.task_spec.route_plan.filter((phase) => phase.phase === "verify");
  const verifierNodes = mandate.action_nodes.filter((node) => node.action_role === "verify");
  const finalizePhases = value.task_spec.route_plan.filter((phase) => phase.phase === "finalize");
  const finalizeNodes = mandate.action_nodes.filter((node) => node.action_role === "finalize");
  if (verifierPhases.length !== 1 || verifierNodes.length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: "readiness requires exactly one bound verifier phase and action" });
  if (finalizePhases.length !== 1 || finalizeNodes.length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: "readiness requires exactly one bound finalization phase and action" });
  if (verifierPhases.length === 1 && verifierNodes.length === 1) {
    const phase = verifierPhases[0];
    const node = verifierNodes[0];
    const verifier = mandate.verification_step;
    if (phase.deterministic) {
      if (node.executor_kind !== "verifier" || node.route_id !== null || verifier.deterministic_verifier_id !== phase.name || verifier.route_id !== null || verifier.route_proof_id !== null || verifier.route_proof_digest !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: "deterministic verifier identity must exactly match its TaskSpec phase" });
    } else if (node.executor_kind !== "codeg_worker" || verifier.deterministic_verifier_id !== null || verifier.route_id !== phase.route_id || verifier.route_id !== node.route_id || verifier.route_proof_id !== node.route_proof_id || verifier.route_proof_digest !== node.route_proof_digest) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "routed verifier must exactly match its TaskSpec phase and mandate action proof" });
    }
  }

  if (value.kind === "approval_required") {
    const request = value.activation.request;
    if (mandate.authority_source.kind !== "approval_precommit"
      || request.decision_type !== "initial_mandate_approval"
      || request.active_mandate_id !== null
      || request.completed_attempt_receipt_ids.length !== 0
      || request.task_id !== value.task_id
      || request.task_spec_revision !== value.task_spec.plan_revision
      || request.task_spec_digest !== taskSpecDigest
      || request.proposed_mandate_id !== mandate.mandate_id
      || request.proposed_mandate_digest !== mandateDigest
      || canonicalDigest(request.proposed_limits) !== canonicalDigest(mandate.aggregate_budget)
      || canonicalDigest(request.proposed_route_ids) !== canonicalDigest(routeIds)
      || canonicalDigest(request.proposed_side_effects) !== canonicalDigest(mandate.capability_scope.allowed_side_effects)
      || request.proposed_diff.digest !== canonicalDigest({ task_spec_digest: taskSpecDigest, mandate_digest: mandateDigest })
      || Date.parse(request.expires_at) > Date.parse(mandate.expiry)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["activation"], message: "approval request must bind the exact proposed mandate" });
    }
  }
  if (value.kind === "auto_activated") {
    const receipt = value.activation.receipt;
    if (mandate.authority_source.kind !== "auto_policy_receipt"
      || receipt.authority_id !== mandate.authority_source.authority_id
      || receipt.task_id !== value.task_id
      || receipt.task_spec_revision !== value.task_spec.plan_revision
      || receipt.task_spec_digest !== taskSpecDigest
      || receipt.mandate_id !== mandate.mandate_id
      || receipt.mandate_digest !== mandateDigest
      || receipt.objective_digest !== mandate.task_spec_revision.objective_digest
      || receipt.acceptance_digest !== mandate.task_spec_revision.acceptance_digest
      || canonicalDigest(receipt.ordered_route_ids) !== canonicalDigest(routeIds)
      || canonicalDigest(receipt.capability_scope) !== canonicalDigest(mandate.capability_scope)
      || canonicalDigest(receipt.workspace_scope) !== canonicalDigest(mandate.workspace_scope)
      || canonicalDigest(receipt.aggregate_budget) !== canonicalDigest(mandate.aggregate_budget)
      || receipt.finalization_predicate.mutation_type !== mandate.finalization_step.mutation_type
      || receipt.finalization_predicate.mutation_manifest_digest !== mandate.finalization_step.mutation_manifest.manifest_digest
      || receipt.finalization_predicate.max_external_mutation !== value.task_spec.finalization.authority_predicate.allowed_external_mutation
      || receipt.expires_at !== mandate.expiry) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["activation"], message: "auto receipt must materialize the exact mandate authority" });
    }
  }

  const referencedRouteIds = new Set<string>();
  for (const phase of value.task_spec.route_plan) if (phase.route_id !== null) referencedRouteIds.add(phase.route_id);
  for (const node of mandate.action_nodes) if (node.route_id !== null) referencedRouteIds.add(node.route_id);
  if (mandate.verification_step.route_id !== null) referencedRouteIds.add(mandate.verification_step.route_id);
  if (value.kind === "approval_required") for (const routeId of value.activation.request.proposed_route_ids) referencedRouteIds.add(routeId);
  if (value.kind === "auto_activated") for (const routeId of value.activation.receipt.ordered_route_ids) referencedRouteIds.add(routeId);
  const evidenceByRoute = new Map<string, (typeof value.route_snapshot)[number]>(value.route_snapshot.map((evidence) => [evidence.route_id, evidence]));
  if (evidenceByRoute.size !== value.route_snapshot.length || evidenceByRoute.size !== referencedRouteIds.size || [...referencedRouteIds].some((routeId) => !evidenceByRoute.has(routeId))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["route_snapshot"], message: "route snapshot must exactly and uniquely cover every referenced route" });
  const blocked = value.kind === "blocked_no_start";
  for (const routeId of referencedRouteIds) {
    const evidence = evidenceByRoute.get(routeId);
    if (!evidence) continue;
    if (evidence.status !== "active") {
      if (!blocked) context.addIssue({ code: z.ZodIssueCode.custom, path: ["route_snapshot"], message: "executable readiness requires active route evidence" });
      else if (!reasonCodes.has("route_inactive")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["no_start", "reasons"], message: "inactive route evidence requires a route_inactive reason" });
    }
    if (blocked && evidence.status === "expired" && !reasonCodes.has("route_expired")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["no_start", "reasons"], message: "expired route evidence requires a route_expired reason" });
  }
  for (const phase of value.task_spec.route_plan) {
    if (phase.route_id === null || evidenceByRoute.get(phase.route_id)?.task_class === phase.task_class) continue;
    if (!blocked) context.addIssue({ code: z.ZodIssueCode.custom, path: ["route_snapshot"], message: "route evidence task class must match the TaskSpec" });
    else if (!reasonCodes.has("route_task_class_mismatch")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["no_start", "reasons"], message: "route task-class drift requires a typed reason" });
  }
  for (const node of mandate.action_nodes) {
    if (node.route_id === null) continue;
    const evidence = evidenceByRoute.get(node.route_id);
    if (evidence && evidence.route_proof_id === node.route_proof_id && evidence.evidence_digest === node.route_proof_digest) continue;
    if (!blocked) context.addIssue({ code: z.ZodIssueCode.custom, path: ["route_snapshot"], message: "route evidence must bind every mandate action proof" });
    else if (!reasonCodes.has("route_proof_mismatch")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["no_start", "reasons"], message: "route proof drift requires a typed reason" });
  }
  const verification = mandate.verification_step;
  if (verification.route_id !== null) {
    const evidence = evidenceByRoute.get(verification.route_id);
    if (!evidence || evidence.route_proof_id !== verification.route_proof_id || evidence.evidence_digest !== verification.route_proof_digest) {
      if (!blocked) context.addIssue({ code: z.ZodIssueCode.custom, path: ["route_snapshot"], message: "route evidence must bind the verifier proof" });
      else if (!reasonCodes.has("route_proof_mismatch")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["no_start", "reasons"], message: "verifier proof drift requires a typed reason" });
    }
  }
});
export type IntakeReadinessV1 = z.infer<typeof IntakeReadinessV1Schema>;

export const AutoActivationSeedV1Schema = z.object({
  kind: z.literal("auto"),
  authority_id: AuthorityIdSchema,
  policy_version: z.string().min(1),
  policy_evidence_digest: DigestSchema,
}).strict();
export type AutoActivationSeedV1 = z.infer<typeof AutoActivationSeedV1Schema>;
