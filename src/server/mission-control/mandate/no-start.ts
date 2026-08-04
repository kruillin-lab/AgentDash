import {
  BudgetPolicySnapshotV1Schema,
  ExecutionMandateV1Schema,
  RouteEvidenceV1Schema,
  TaskSpecV1Schema,
  canonicalDigest,
  type BudgetPolicySnapshotV1,
  type ExecutionMandateV1,
  type RouteEvidenceV1,
  type TaskSpecV1,
} from "../../../lib/mission-control/contracts";

import { proveMandateBudget } from "./budget-proof";
import { validateMandateGraph } from "./graph";

export interface NoStartInput {
  task_spec: TaskSpecV1;
  mandate: ExecutionMandateV1;
  routes: RouteEvidenceV1[];
  budget_policy: BudgetPolicySnapshotV1;
  now: string;
}

export interface NoStartReason {
  code: string;
  message: string;
}

export interface NoStartReportV1 {
  schema_version: "agentdash.no-start-report/v1";
  ready: boolean;
  reasons: NoStartReason[];
}

function addReason(reasons: NoStartReason[], code: string, message: string): void {
  if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, message });
}

function sameBudget(left: { max_cost_usd: number; max_runtime_ms: number; max_attempts: number; max_provider_tokens: number }, right: { max_cost_usd: number; max_runtime_ms: number; max_attempts: number; max_provider_tokens: number }): boolean {
  return left.max_cost_usd === right.max_cost_usd && left.max_runtime_ms === right.max_runtime_ms && left.max_attempts === right.max_attempts && left.max_provider_tokens === right.max_provider_tokens;
}

export function runNoStartChecks(rawInput: NoStartInput): NoStartReportV1 {
  const reasons: NoStartReason[] = [];
  const currentTime = Date.parse(rawInput.now);
  if (!Number.isFinite(currentTime)) addReason(reasons, "invalid_current_time", "The controller current time is invalid.");

  const taskResult = TaskSpecV1Schema.safeParse(rawInput.task_spec);
  const mandateResult = ExecutionMandateV1Schema.safeParse(rawInput.mandate);
  const policyResult = BudgetPolicySnapshotV1Schema.safeParse(rawInput.budget_policy);
  const routeResults = rawInput.routes.map((route) => RouteEvidenceV1Schema.safeParse(route));
  if (!taskResult.success) addReason(reasons, "invalid_task_spec", "The compiled TaskSpec is invalid.");
  if (!mandateResult.success) addReason(reasons, "invalid_mandate", "The candidate mandate is invalid.");
  if (!policyResult.success) addReason(reasons, "budget_policy_invalid", "The independent budget policy is invalid.");
  if (routeResults.some((result) => !result.success)) addReason(reasons, "route_snapshot_invalid", "The route snapshot contains invalid evidence.");
  if (!taskResult.success || !mandateResult.success || !policyResult.success || routeResults.some((result) => !result.success)) {
    return { schema_version: "agentdash.no-start-report/v1", ready: false, reasons };
  }

  const task = taskResult.data;
  const mandate = mandateResult.data;
  const policy = policyResult.data;
  const routes = routeResults.map((result) => result.success ? result.data : null).filter((route): route is RouteEvidenceV1 => route !== null);

  if (mandate.task_spec_revision.task_spec_digest !== canonicalDigest(task)
    || mandate.task_spec_revision.objective_digest !== canonicalDigest(task.objective)
    || mandate.task_spec_revision.acceptance_digest !== canonicalDigest(task.acceptance_checks)
    || mandate.verification_step.acceptance_digest !== canonicalDigest(task.acceptance_checks)
    || canonicalDigest(mandate.verification_step.acceptance_checks) !== canonicalDigest(task.acceptance_checks)) {
    addReason(reasons, "task_binding_mismatch", "The mandate does not bind the exact TaskSpec and acceptance checks.");
  }
  if (mandate.request_id !== task.request_id || mandate.workspace_scope.project_id !== task.workspace.project_id || mandate.workspace_scope.mode !== task.workspace.mode || mandate.workspace_scope.path !== task.workspace.path) {
    addReason(reasons, "task_binding_mismatch", "The mandate request or workspace binding differs from the TaskSpec.");
  }

  const graph = validateMandateGraph({
    action_nodes: mandate.action_nodes.map((node) => ({ node_id: node.node_id, action_role: node.action_role, remediation_scope: node.remediation_scope })),
    transition_graph: mandate.transition_graph,
    visit_caps: mandate.visit_caps,
    edge_visit_caps: mandate.edge_visit_caps,
  });
  for (const reason of graph.reasons) addReason(reasons, reason.code, reason.message);

  if (graph.paths.length > 0) {
    const budget = proveMandateBudget({
      paths: graph.paths,
      aggregate_budget: mandate.aggregate_budget,
      mandate_action_limits: mandate.per_action_limits,
      mandate_budget_policy_digest: mandate.budget_policy_digest,
      claimed_task_reserves: mandate.budget_proof.task_reserves,
      policy,
    });
    for (const reason of budget.reasons) addReason(reasons, reason.code, reason.message);
    if (budget.component_maxima && !sameBudget(budget.component_maxima, mandate.budget_proof.worst_case_path)) {
      addReason(reasons, "budget_proof_mismatch", "The supplied worst-case proof differs from recomputed conservative maxima.");
    }
    const knownNodes = new Set(mandate.action_nodes.map((node) => node.node_id));
    const claimedPath = mandate.budget_proof.worst_case_path_node_ids;
    if (claimedPath.some((nodeId) => !knownNodes.has(nodeId)) || !graph.paths.some((path) => canonicalDigest(path.node_ids) === canonicalDigest(claimedPath))) {
      addReason(reasons, "budget_proof_mismatch", "The supplied worst-case path is not one finite reachable path.");
    }
  }

  const evidenceByRoute = new Map<string, (typeof routes)[number]>(routes.map((route) => [route.route_id, route]));
  const referencedRouteIds = new Set<string>();
  for (const node of mandate.action_nodes) if (node.route_id !== null) referencedRouteIds.add(node.route_id);
  if (mandate.verification_step.route_id !== null) referencedRouteIds.add(mandate.verification_step.route_id);
  for (const phase of task.route_plan) if (phase.route_id !== null) referencedRouteIds.add(phase.route_id);
  if (evidenceByRoute.size !== routes.length || evidenceByRoute.size !== referencedRouteIds.size || [...referencedRouteIds].some((routeId) => !evidenceByRoute.has(routeId))) {
    addReason(reasons, "route_snapshot_mismatch", "The route snapshot must exactly cover every referenced route.");
  }
  for (const routeId of referencedRouteIds) {
    const evidence = evidenceByRoute.get(routeId);
    if (!evidence) continue;
    if (evidence.status !== "active") addReason(reasons, "route_inactive", "Every referenced route proof must be active.");
    if (!Number.isFinite(currentTime) || Date.parse(evidence.evaluated_at) > currentTime || Date.parse(evidence.expires_at) <= currentTime) addReason(reasons, "route_expired", "Every referenced route proof must be current at start.");
  }
  for (const phase of task.route_plan) {
    if (phase.route_id !== null && evidenceByRoute.get(phase.route_id)?.task_class !== phase.task_class) addReason(reasons, "route_task_class_mismatch", "Every route proof must match the exact TaskSpec task class.");
  }
  for (const node of mandate.action_nodes) {
    if (node.route_id === null) continue;
    const evidence = evidenceByRoute.get(node.route_id);
    if (!evidence || evidence.route_proof_id !== node.route_proof_id || evidence.evidence_digest !== node.route_proof_digest) addReason(reasons, "route_proof_mismatch", "Every action must bind the exact current route proof.");
  }
  const verifier = mandate.verification_step;
  if (verifier.route_id !== null) {
    const evidence = evidenceByRoute.get(verifier.route_id);
    if (!evidence || evidence.route_proof_id !== verifier.route_proof_id || evidence.evidence_digest !== verifier.route_proof_digest) addReason(reasons, "route_proof_mismatch", "Verification must bind the exact current route proof.");
  }

  if (verifier.required_independence_tier === 2) {
    for (const path of graph.paths.filter((candidate) => candidate.terminal_outcome === "succeeded")) {
      const verifierIndex = path.node_ids.findIndex((nodeId) => mandate.action_nodes.find((node) => node.node_id === nodeId)?.action_role === "verify");
      const verifierNode = verifierIndex >= 0 ? mandate.action_nodes.find((node) => node.node_id === path.node_ids[verifierIndex]) : undefined;
      const verifierEvidence = verifierNode?.route_id ? evidenceByRoute.get(verifierNode.route_id) : undefined;
      if (!verifierEvidence) {
        addReason(reasons, "verifier_not_independent", "Tier 2 verification requires an exact routed verifier.");
        continue;
      }
      for (const nodeId of path.node_ids.slice(0, verifierIndex)) {
        const node = mandate.action_nodes.find((candidate) => candidate.node_id === nodeId);
        if (node?.executor_kind !== "codeg_worker" || node.route_id === null || node.action_role === "verify") continue;
        const mutationEvidence = evidenceByRoute.get(node.route_id);
        if (!mutationEvidence || mutationEvidence.provider === verifierEvidence.provider || mutationEvidence.outer_harness === verifierEvidence.outer_harness) {
          addReason(reasons, "verifier_not_independent", "Tier 2 verification must use a different provider and outer harness from every preceding model-backed action.");
        }
      }
    }
  }

  if (!Number.isFinite(currentTime) || Date.parse(mandate.expiry) <= currentTime) addReason(reasons, "mandate_expired", "The mandate must remain current at start.");
  const finalizeNodes = mandate.action_nodes.filter((node) => node.action_role === "finalize");
  const finalizePhases = task.route_plan.filter((phase) => phase.phase === "finalize");
  const finalization = mandate.finalization_step;
  if (finalizeNodes.length !== 1 || finalizePhases.length !== 1
    || finalizeNodes[0].executor_kind !== "finalizer"
    || finalization.mutation_type !== task.finalization.mutation_type
    || finalization.allowed_path_prefixes.some((prefix) => !task.finalization.allowed_path_prefixes.includes(prefix))
    || task.finalization.prohibited_changes.some((prohibition) => !finalization.prohibited_changes.includes(prohibition))
    || !finalization.drift_preconditions.base_digest
    || !finalization.drift_preconditions.target_digest
    || !finalization.drift_preconditions.cas_precondition_digest) {
    addReason(reasons, "finalization_invalid", "The exact bounded finalization phase, action, and drift preconditions are required.");
  }

  return { schema_version: "agentdash.no-start-report/v1", ready: reasons.length === 0, reasons };
}
