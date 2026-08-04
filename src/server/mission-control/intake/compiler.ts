import {
  AutoActivationReceiptV1Schema,
  CompilationPolicySnapshotV1Schema,
  ExecutionMandateV1Schema,
  IntakeReadinessV1Schema,
  PMPresentationV1Schema,
  TaskIdSchema,
  TaskSpecV1Schema,
  canonicalDigest,
  type AutoActivationSeedV1,
  type CompilationPolicySnapshotV1,
  type Digest,
  type ExecutionMandateV1,
  type IntakeReadinessV1,
  type PMPresentationV1,
  type TaskId,
  type TaskSpecV1,
} from "../../../lib/mission-control/contracts";
import { CEOIntakeRequestV1Schema, type CEOIntakeRequestV1 } from "../../../lib/mission-control/intake-api";

import { proveMandateBudget } from "../mandate/budget-proof";
import { validateMandateGraph } from "../mandate/graph";
import { runNoStartChecks } from "../mandate/no-start";

type ActivationSeed = { kind: "approval_required" } | AutoActivationSeedV1;
type IntakeArtifactBranch = {
  kind: IntakeReadinessV1["kind"];
  task_spec: IntakeReadinessV1["task_spec"];
  route_snapshot: IntakeReadinessV1["route_snapshot"];
  no_start: IntakeReadinessV1["no_start"];
  activation: IntakeReadinessV1["activation"];
  mandate?: ExecutionMandateV1;
  candidate_mandate?: ExecutionMandateV1 | null;
};

export function canonicalIntakeArtifactDigest(input: {
  task_id: TaskId;
  request_digest: string;
  pm: PMPresentationV1;
  proposal_digest: string;
  compilation_policy_digest: string;
  budget_policy_digest: string;
  branch: IntakeArtifactBranch;
}): string {
  return canonicalDigest({
    schema_version: "agentdash.intake-artifact-set/v1",
    task_id: input.task_id,
    request_digest: input.request_digest,
    pm: input.pm,
    proposal_digest: input.proposal_digest,
    compilation_policy_digest: input.compilation_policy_digest,
    budget_policy_digest: input.budget_policy_digest,
    branch: input.branch,
  });
}

function artifactBranch(readiness: IntakeReadinessV1): IntakeArtifactBranch {
  switch (readiness.kind) {
    case "blocked_no_start":
      return { kind: readiness.kind, task_spec: readiness.task_spec, candidate_mandate: readiness.candidate_mandate, route_snapshot: readiness.route_snapshot, no_start: readiness.no_start, activation: readiness.activation };
    case "approval_required":
      return { kind: readiness.kind, task_spec: readiness.task_spec, mandate: readiness.mandate, route_snapshot: readiness.route_snapshot, no_start: readiness.no_start, activation: readiness.activation };
    case "auto_activated":
      return { kind: readiness.kind, task_spec: readiness.task_spec, mandate: readiness.mandate, route_snapshot: readiness.route_snapshot, no_start: readiness.no_start, activation: readiness.activation };
  }
}

export function canonicalIntakeArtifactDigestFromReadiness(readiness: IntakeReadinessV1): string {
  return canonicalIntakeArtifactDigest({
    task_id: readiness.task_id,
    request_digest: readiness.request_digest,
    pm: readiness.pm,
    proposal_digest: readiness.proposal_digest,
    compilation_policy_digest: readiness.compilation_policy_digest,
    budget_policy_digest: readiness.budget_policy_digest,
    branch: artifactBranch(readiness),
  });
}

export interface CompileIntakeInput {
  request: CEOIntakeRequestV1;
  pm_output: PMPresentationV1;
  compilation_policy: CompilationPolicySnapshotV1;
  compilation_policy_digest: string;
  activation: ActivationSeed;
  now: string;
}

export type CompileIntakeResult =
  | {
      status: "compiled";
      normalized_message: string;
      request_digest: string;
      task_id: TaskId;
      task_spec: TaskSpecV1;
      mandate: ExecutionMandateV1 | null;
      readiness: IntakeReadinessV1;
      artifact_digest: string;
    }
  | { status: "clarification_required"; reasons: Array<{ code: string; message: string }> }
  | { status: "intake_unavailable"; reasons: Array<{ code: string; message: string }> };

function unavailable(code: string, message: string): CompileIntakeResult {
  return { status: "intake_unavailable", reasons: [{ code, message }] };
}

export function normalizeIntakeMessage(message: string): string {
  return message.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function canonicalizeCEOIntakeRequest(rawRequest: CEOIntakeRequestV1): { request: CEOIntakeRequestV1; normalized_message: string; request_digest: Digest; task_id: TaskId } {
  const request = CEOIntakeRequestV1Schema.parse(rawRequest);
  const normalized_message = normalizeIntakeMessage(request.message);
  if (normalized_message.length === 0 || normalized_message.length > 4_096) throw new TypeError("invalid normalized request");
  const request_digest = canonicalDigest({ schema_version: "agentdash.intake-request/v1", request_id: request.request_id, message: normalized_message });
  return { request, normalized_message, request_digest, task_id: TaskIdSchema.parse(`task-${request_digest}`) };
}

function futureTimestamp(now: number, milliseconds: number): string {
  const value = now + milliseconds;
  if (!Number.isSafeInteger(value)) throw new TypeError("timestamp overflow");
  return new Date(value).toISOString();
}

export function compileIntake(rawInput: CompileIntakeInput): CompileIntakeResult {
  const request = CEOIntakeRequestV1Schema.safeParse(rawInput.request);
  if (!request.success) return unavailable("invalid_request", "The CEO request is invalid.");
  const pm = PMPresentationV1Schema.safeParse(rawInput.pm_output);
  if (!pm.success) return unavailable("invalid_pm_output", "The PM presentation is invalid.");
  if (pm.data.proposal.intent !== "create_task") return unavailable("invalid_pm_output", "Only create_task proposals can be compiled.");
  const policy = CompilationPolicySnapshotV1Schema.safeParse(rawInput.compilation_policy);
  if (!policy.success || rawInput.compilation_policy_digest !== canonicalDigest(rawInput.compilation_policy)) {
    return unavailable("compilation_policy_mismatch", "The compilation policy is invalid or unbound.");
  }
  const now = Date.parse(rawInput.now);
  if (!Number.isSafeInteger(now)) return unavailable("invalid_compilation_time", "The compilation time is invalid.");
  const normalizedMessage = normalizeIntakeMessage(request.data.message);
  if (normalizedMessage.length === 0 || normalizedMessage.length > 4_096) return unavailable("invalid_request", "The normalized CEO request is invalid.");

  try {
    const compilationPolicyDigest = canonicalDigest(policy.data);
    const budgetPolicyDigest = canonicalDigest(policy.data.budget_policy);
    const { request_digest: requestDigest, task_id: taskId } = canonicalizeCEOIntakeRequest(request.data);
    const taskSpecResult = TaskSpecV1Schema.safeParse({
      schema_version: "agentdash.task-spec/v1",
      request_id: request.data.request_id,
      title: normalizedMessage.slice(0, 256),
      objective: normalizedMessage,
      ...policy.data.task_template,
      risk_mode: rawInput.activation.kind === "auto" ? "auto" : "approval_required",
      plan_revision: 0,
      source_refs: [`request:${request.data.request_id}`, `policy:${compilationPolicyDigest}`],
    });
    if (!taskSpecResult.success) {
      return unavailable("invalid_task_spec", "The server compilation policy cannot produce a valid TaskSpec.");
    }
    const taskSpec = taskSpecResult.data;
    const taskSpecRevision = {
      plan_revision: taskSpec.plan_revision,
      task_spec_digest: canonicalDigest(taskSpec),
      objective_digest: canonicalDigest(taskSpec.objective),
      acceptance_digest: canonicalDigest(taskSpec.acceptance_checks),
    };
    const mandateId = `mandate-${canonicalDigest({ schema_version: "agentdash.mandate-id/v1", task_id: taskId, task_spec_revision: taskSpecRevision.plan_revision, compilation_policy_digest: compilationPolicyDigest })}`;
    const approvalAuthorityId = `authority-${canonicalDigest({ schema_version: "agentdash.approval-authority-precommit/v1", task_id: taskId, mandate_id: mandateId, task_spec_revision: taskSpecRevision.plan_revision, compilation_policy_digest: compilationPolicyDigest })}`;

    const graph = validateMandateGraph({
      action_nodes: policy.data.mandate_template.action_nodes.map((node) => ({ node_id: node.node_id, action_role: node.action_role, remediation_scope: node.remediation_scope })),
      transition_graph: policy.data.mandate_template.transition_graph,
      visit_caps: policy.data.mandate_template.visit_caps,
      edge_visit_caps: policy.data.mandate_template.edge_visit_caps,
    });
    const structuralGraphCodes = new Set([
      "graph_complexity_exceeded",
      "graph_structural_map_mismatch",
      "graph_missing_outcome_edge",
      "graph_dangling_node",
      "graph_visit_cap_exceeded",
      "graph_edge_cap_exceeded",
      "graph_open_reconciliation",
      "graph_unreachable_node",
      "graph_unbounded_remediation",
      "graph_cap_dead_end",
    ]);
    if (graph.paths.length === 0 || graph.reasons.some((reason) => structuralGraphCodes.has(reason.code))) {
      return unavailable("invalid_graph", "The compilation policy graph is structurally invalid or cannot be expanded safely.");
    }
    const budget = proveMandateBudget({
      paths: graph.paths,
      aggregate_budget: policy.data.mandate_template.aggregate_budget,
      mandate_action_limits: policy.data.mandate_template.per_action_limits,
      mandate_budget_policy_digest: budgetPolicyDigest,
      claimed_task_reserves: policy.data.budget_policy.task_reserves,
      policy: policy.data.budget_policy,
    });
    const structuralBudgetCodes = new Set([
      "budget_action_limits_unbound",
      "budget_reserves_unbound",
      "budget_aggregate_invalid",
      "budget_arithmetic_overflow",
      "budget_missing_paths",
      "budget_unknown_node",
    ]);
    if (!budget.component_maxima || budget.reasons.some((reason) => structuralBudgetCodes.has(reason.code))) {
      return unavailable("invalid_budget", "The compilation policy budget cannot be computed safely.");
    }
    const worstPath = [...graph.paths].sort((left, right) => right.node_ids.length - left.node_ids.length || canonicalDigest(left.node_ids).localeCompare(canonicalDigest(right.node_ids)))[0];
    const mandateResult = ExecutionMandateV1Schema.safeParse({
      schema_version: "agentdash.execution-mandate/v1",
      mandate_id: mandateId,
      task_id: taskId,
      request_id: request.data.request_id,
      task_spec_revision: taskSpecRevision,
      ...policy.data.mandate_template,
      budget_policy_digest: budgetPolicyDigest,
      budget_proof: {
        worst_case_path_node_ids: worstPath.node_ids,
        worst_case_path: budget.component_maxima,
        task_reserves: policy.data.budget_policy.task_reserves,
        reserves_carried_once: true,
      },
      expiry: futureTimestamp(now, policy.data.mandate_ttl_ms),
      authority_source: rawInput.activation.kind === "auto"
        ? { kind: "auto_policy_receipt", authority_id: rawInput.activation.authority_id, binding: "materialized_at_intake" }
        : { kind: "approval_precommit", authority_id: approvalAuthorityId, binding: "precommitted_at_intake" },
    });
    const proposalDigest = canonicalDigest(pm.data.proposal);
    if (!mandateResult.success) {
      const noStart = {
        schema_version: "agentdash.no-start-report/v1" as const,
        ready: false as const,
        reasons: [{ code: "invalid_mandate", message: "The candidate mandate is invalid." }],
      };
      const branch = {
        kind: "blocked_no_start" as const,
        task_spec: taskSpec,
        candidate_mandate: null,
        route_snapshot: policy.data.route_snapshot,
        no_start: noStart,
        activation: null,
      };
      const artifactDigest = canonicalIntakeArtifactDigest({
        task_id: taskId,
        request_digest: requestDigest,
        pm: pm.data,
        proposal_digest: proposalDigest,
        compilation_policy_digest: compilationPolicyDigest,
        budget_policy_digest: budgetPolicyDigest,
        branch,
      });
      const readiness = IntakeReadinessV1Schema.parse({
        schema_version: "agentdash.intake-readiness/v1",
        task_id: taskId,
        request_digest: requestDigest,
        pm: pm.data,
        proposal_digest: proposalDigest,
        compilation_policy_digest: compilationPolicyDigest,
        budget_policy_digest: budgetPolicyDigest,
        artifact_digest: artifactDigest,
        ...branch,
      });
      return { status: "compiled", normalized_message: normalizedMessage, request_digest: requestDigest, task_id: taskId, task_spec: taskSpec, mandate: null, readiness, artifact_digest: artifactDigest };
    }
    const mandate = mandateResult.data;
    const noStart = runNoStartChecks({ task_spec: taskSpec, mandate, routes: policy.data.route_snapshot, budget_policy: policy.data.budget_policy, now: rawInput.now });
    const mandateDigest = canonicalDigest(mandate);
    const routeIds = taskSpec.route_plan.map((phase) => phase.route_id).filter((routeId): routeId is NonNullable<typeof routeId> => routeId !== null);
    let branch: IntakeArtifactBranch;
    if (!noStart.ready) {
      branch = { kind: "blocked_no_start", task_spec: taskSpec, candidate_mandate: mandate, route_snapshot: policy.data.route_snapshot, no_start: noStart, activation: null };
    } else if (rawInput.activation.kind === "auto") {
      const activation = {
        kind: "auto" as const,
        receipt: AutoActivationReceiptV1Schema.parse({
          schema_version: "agentdash.auto-activation-receipt/v1",
          authority_id: rawInput.activation.authority_id,
          task_id: taskId,
          task_spec_revision: taskSpec.plan_revision,
          task_spec_digest: taskSpecRevision.task_spec_digest,
          mandate_id: mandate.mandate_id,
          objective_digest: taskSpecRevision.objective_digest,
          acceptance_digest: taskSpecRevision.acceptance_digest,
          mandate_digest: mandateDigest,
          ordered_route_ids: routeIds,
          policy_version: rawInput.activation.policy_version,
          policy_evidence_digest: rawInput.activation.policy_evidence_digest,
          capability_scope: mandate.capability_scope,
          capability_scope_digest: canonicalDigest(mandate.capability_scope),
          workspace_scope: mandate.workspace_scope,
          aggregate_budget: mandate.aggregate_budget,
          finalization_predicate: { mutation_type: mandate.finalization_step.mutation_type, mutation_manifest_digest: mandate.finalization_step.mutation_manifest.manifest_digest, max_external_mutation: mandate.finalization_step.mutation_type === "approved_merge" },
          issued_at: rawInput.now,
          expires_at: mandate.expiry,
        }),
      };
      branch = { kind: "auto_activated", task_spec: taskSpec, mandate, route_snapshot: policy.data.route_snapshot, no_start: noStart, activation };
    } else {
      const activation = {
        kind: "approval_required" as const,
        request: {
          schema_version: "agentdash.ceo-input-request/v1" as const,
          task_id: taskId,
          task_spec_revision: taskSpec.plan_revision,
          task_spec_digest: taskSpecRevision.task_spec_digest,
          active_mandate_id: null,
          proposed_mandate_id: mandate.mandate_id,
          proposed_mandate_digest: mandateDigest,
          decision_type: "initial_mandate_approval" as const,
          proposed_diff: { digest: canonicalDigest({ task_spec_digest: taskSpecRevision.task_spec_digest, mandate_digest: mandateDigest }), summary: "Activate the initial finite mandate." },
          proposed_limits: mandate.aggregate_budget,
          proposed_route_ids: routeIds,
          proposed_side_effects: mandate.capability_scope.allowed_side_effects,
          rationale: "The initial finite mandate requires authenticated CEO approval.",
          evidence_refs: [`policy:${compilationPolicyDigest}`, `proposal:${proposalDigest}`],
          completed_attempt_receipt_ids: [],
          no_unapproved_action_running: true as const,
          created_at: rawInput.now,
          expires_at: futureTimestamp(now, policy.data.approval_request_ttl_ms),
        },
      };
      branch = { kind: "approval_required", task_spec: taskSpec, mandate, route_snapshot: policy.data.route_snapshot, no_start: noStart, activation };
    }
    const artifactDigest = canonicalIntakeArtifactDigest({
      task_id: taskId,
      request_digest: requestDigest,
      pm: pm.data,
      proposal_digest: proposalDigest,
      compilation_policy_digest: compilationPolicyDigest,
      budget_policy_digest: budgetPolicyDigest,
      branch,
    });
    const readiness = IntakeReadinessV1Schema.parse({
      schema_version: "agentdash.intake-readiness/v1",
      task_id: taskId,
      request_digest: requestDigest,
      pm: pm.data,
      proposal_digest: proposalDigest,
      compilation_policy_digest: compilationPolicyDigest,
      budget_policy_digest: budgetPolicyDigest,
      artifact_digest: artifactDigest,
      ...branch,
    });
    return { status: "compiled", normalized_message: normalizedMessage, request_digest: requestDigest, task_id: taskId, task_spec: taskSpec, mandate, readiness, artifact_digest: artifactDigest };
  } catch {
    return unavailable("compiler_fault", "The intake compiler could not safely materialize an artifact.");
  }
}
