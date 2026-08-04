import { z } from "zod";
import { ActionNodeIdSchema, ActionOutcomeSchema, ActionRoleSchema, AuthorityIdSchema, BudgetV1Schema, DigestSchema, ExecutorKindSchema, MandateIdSchema, ReconciliationDeadlinesV1Schema, RequestIdSchema, RouteIdSchema, RouteProofIdSchema, TaskIdSchema, TimestampSchema, WorkspaceScopeV1Schema, canonicalDigest } from "./common";
import { MutationManifestInternalSchema, MutationScopeInternalSchema, validateMutationEnvelope } from "./mutation";
import { TaskSpecRevisionV1Schema } from "./task";

const ceoDecision = z.enum(["initial_mandate_approval", "objective_change", "acceptance_change", "business_product_decision", "route_change", "capability_change", "workspace_change", "budget_change", "new_external_action"]);
const target = z.discriminatedUnion("kind", [z.object({ kind: z.literal("node"), node_id: ActionNodeIdSchema }).strict(), z.object({ kind: z.literal("reconciliation"), category: z.enum(["dispatch_lookup", "cancel_confirmation", "orphan_recovery", "finalization", "receipt_delivery"]), max_attempts: z.number().int().positive(), deadline_ms: z.number().int().positive() }).strict(), z.object({ kind: z.literal("ceo_input"), decision_type: ceoDecision }).strict(), z.object({ kind: z.literal("terminal"), outcome: z.enum(["succeeded", "failed", "timed_out", "budget_exhausted", "cancelled", "route_unavailable", "inconsistent"]) }).strict()]);
const limits = z.object({ max_cost_usd: z.number().finite().nonnegative(), max_runtime_ms: z.number().int().positive(), max_output_tokens: z.number().int().nonnegative() }).strict();
export const ActionNodeV1Schema = z.object({ node_id: ActionNodeIdSchema, action_role: ActionRoleSchema, executor_kind: ExecutorKindSchema, route_id: RouteIdSchema.nullable(), route_proof_id: RouteProofIdSchema.nullable(), route_proof_digest: DigestSchema.nullable(), remediation_scope: z.object({ finding_classes: z.array(z.string().min(1)).min(1), artifact_scope: z.array(z.string().min(1)).min(1) }).strict().nullable() }).strict().superRefine((v, c) => { const hasCompleteRoute = v.route_id !== null && v.route_proof_id !== null && v.route_proof_digest !== null; if ((v.executor_kind === "codeg_worker") !== hasCompleteRoute) c.addIssue({ code: z.ZodIssueCode.custom, message: "node route proof binding does not match executor" }); if (v.action_role === "remediate" && v.remediation_scope === null) c.addIssue({ code: z.ZodIssueCode.custom, message: "remediation needs bounded scope" }); if (v.action_role !== "remediate" && v.remediation_scope !== null) c.addIssue({ code: z.ZodIssueCode.custom, message: "non-remediation nodes cannot carry remediation scope" }); });
export type ActionNodeV1 = z.infer<typeof ActionNodeV1Schema>;

const mandateBase = z.object({
  schema_version: z.literal("agentdash.execution-mandate/v1"), mandate_id: MandateIdSchema, task_id: TaskIdSchema, request_id: RequestIdSchema, task_spec_revision: TaskSpecRevisionV1Schema,
  action_nodes: z.array(ActionNodeV1Schema).min(1), transition_graph: z.record(z.record(ActionOutcomeSchema, target)), visit_caps: z.record(z.number().int().positive()), edge_visit_caps: z.record(z.number().int().positive()),
  verification_step: z.object({ acceptance_digest: DigestSchema, acceptance_checks: z.array(z.string().min(1)).min(1), required_independence_tier: z.union([z.literal(1), z.literal(2)]), route_id: RouteIdSchema.nullable(), route_proof_id: RouteProofIdSchema.nullable(), route_proof_digest: DigestSchema.nullable(), deterministic_verifier_id: z.string().min(1).nullable(), independence_proof_digest: DigestSchema }).strict().superRefine((v, c) => { const routeParts = [v.route_id, v.route_proof_id, v.route_proof_digest]; const completeRoute = routeParts.every((part) => part !== null); const emptyRoute = routeParts.every((part) => part === null); if (!completeRoute && !emptyRoute) c.addIssue({ code: z.ZodIssueCode.custom, message: "verifier route binding may not be partial" }); if (completeRoute === (v.deterministic_verifier_id !== null)) c.addIssue({ code: z.ZodIssueCode.custom, message: "verification must bind exactly one verifier identity" }); }),
  finalization_step: MutationScopeInternalSchema.extend({ mutation_manifest: MutationManifestInternalSchema, expected_post_state: z.discriminatedUnion("kind", [z.object({ kind: z.literal("digest"), digest: DigestSchema }).strict(), z.object({ kind: z.literal("postcondition"), predicate: z.string().min(1), predicate_digest: DigestSchema }).strict()]), drift_preconditions: z.object({ base_digest: DigestSchema, target_digest: DigestSchema, cas_precondition_digest: DigestSchema }).strict() }).superRefine(validateMutationEnvelope),
  capability_scope: z.object({ allowed_tools: z.array(z.string().min(1)), allowed_side_effects: z.array(z.string()), allowed_data_classes: z.array(z.string().min(1)), prohibited_actions: z.array(z.string().min(1)) }).strict(), workspace_scope: WorkspaceScopeV1Schema, aggregate_budget: BudgetV1Schema, per_action_limits: z.record(limits),
  budget_proof: z.object({ worst_case_path_node_ids: z.array(ActionNodeIdSchema).min(1), worst_case_path: BudgetV1Schema, task_reserves: z.object({ verification: BudgetV1Schema, finalization: BudgetV1Schema, cancellation: BudgetV1Schema, reconciliation: BudgetV1Schema }).strict(), reserves_carried_once: z.literal(true) }).strict(),
  reconciliation_limits: ReconciliationDeadlinesV1Schema, expiry: TimestampSchema, authority_source: z.object({ kind: z.enum(["approval_grant", "auto_policy_receipt"]), authority_id: AuthorityIdSchema }).strict(),
}).strict();

export const ExecutionMandateV1Schema = mandateBase.superRefine((v, c) => {
  if (v.verification_step.acceptance_digest !== canonicalDigest(v.verification_step.acceptance_checks)) c.addIssue({ code: z.ZodIssueCode.custom, path: ["verification_step", "acceptance_digest"], message: "verification acceptance digest must match exact checks" });
  const nodes = new Set<string>(v.action_nodes.map((n) => n.node_id));
  const expectedEdges = new Set<string>();
  if (nodes.size !== v.action_nodes.length) c.addIssue({ code: z.ZodIssueCode.custom, message: "node ids must be unique" });
  for (const [nodeId, outcomes] of Object.entries(v.transition_graph)) {
    if (!nodes.has(nodeId)) c.addIssue({ code: z.ZodIssueCode.custom, path: ["transition_graph", nodeId], message: "unknown transition node" });
    for (const outcome of ActionOutcomeSchema.options) {
      const key = `${nodeId}:${outcome}`; expectedEdges.add(key);
      if (!(outcome in outcomes)) c.addIssue({ code: z.ZodIssueCode.custom, path: ["transition_graph", nodeId, outcome], message: "missing outcome transition" });
    }
    for (const next of Object.values(outcomes)) {
      if (next.kind === "node" && !nodes.has(next.node_id)) c.addIssue({ code: z.ZodIssueCode.custom, message: "transition target is not finite" });
      if (next.kind === "reconciliation") {
        const ceiling = v.reconciliation_limits[next.category];
        if (next.max_attempts > ceiling.max_attempts || next.deadline_ms > ceiling.deadline_ms) c.addIssue({ code: z.ZodIssueCode.custom, message: "reconciliation transition exceeds mandate category ceiling" });
      }
    }
  }
  for (const nodeId of nodes) {
    if (!(nodeId in v.transition_graph) || !(nodeId in v.visit_caps) || !(nodeId in v.per_action_limits)) c.addIssue({ code: z.ZodIssueCode.custom, message: "node structural maps must be one-to-one" });
  }
  for (const key of Object.keys(v.visit_caps)) if (!nodes.has(key)) c.addIssue({ code: z.ZodIssueCode.custom, message: "extra visit cap" });
  for (const key of Object.keys(v.per_action_limits)) if (!nodes.has(key)) c.addIssue({ code: z.ZodIssueCode.custom, message: "extra action limit" });
  for (const key of expectedEdges) if (!(key in v.edge_visit_caps)) c.addIssue({ code: z.ZodIssueCode.custom, message: "missing edge cap" });
  for (const key of Object.keys(v.edge_visit_caps)) if (!expectedEdges.has(key)) c.addIssue({ code: z.ZodIssueCode.custom, message: "extra edge cap" });
  for (const nodeId of v.budget_proof.worst_case_path_node_ids) if (!nodes.has(nodeId)) c.addIssue({ code: z.ZodIssueCode.custom, message: "budget proof names an unknown action node" });
});
export type ExecutionMandateV1 = z.infer<typeof ExecutionMandateV1Schema>;
