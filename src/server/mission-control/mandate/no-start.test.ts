import { describe, expect, test } from "vitest";

import { ActionOutcomeValues, canonicalDigest } from "../../../lib/mission-control/contracts/common";
import { runNoStartChecks, type NoStartInput } from "./no-start";

const digest = (value: string) => canonicalDigest({ value });
const now = "2026-08-04T10:00:00.000Z";
const safetyGates = ["authority_isolation", "workspace_containment", "identity_binding", "cancellation_reconciliation", "secret_handling", "prohibited_actions"];
const taskClass = "bounded_coding" as const;

function route(route_id: string, outer_harness: string, provider: string) {
  const route_proof_id = `proof-${route_id}`;
  const evidence_digest = digest(`evidence-${route_id}`);
  return {
    schema_version: "agentdash.route-evidence/v1" as const,
    route_proof_id,
    route_id,
    task_class: taskClass,
    level: 5 as const,
    status: "active" as const,
    outer_harness,
    provider,
    model: `model-${route_id}`,
    agent_type: "worker",
    mode: "standard",
    config_digest: digest(`config-${route_id}`),
    fixture_set_version: "fixtures-v1",
    scoring_rubric_version: "rubric-v1",
    evaluator_version: "evaluator-v1",
    policy_version: "policy-v1",
    minimum_sample_count: 20,
    minimum_fixture_shapes: 5,
    confidence_threshold: 0.7,
    max_cost_usd: 1,
    max_runtime_ms: 10_000,
    safety_gates: safetyGates,
    observed_sample_count: 20,
    observed_fixture_shapes: 5,
    observed_wilson_lower_bound: 0.8,
    observed_max_cost_usd: 0.5,
    observed_max_runtime_ms: 5_000,
    safety_gate_results: safetyGates.map((gate) => ({ gate, passed: true, evidence_digest: digest(`${route_id}-${gate}`) })),
    raw_receipt_digest: digest(`receipt-${route_id}`),
    score_digest: digest(`score-${route_id}`),
    environment_digest: digest(`environment-${route_id}`),
    evidence_digest,
    evaluated_at: "2026-08-01T00:00:00.000Z",
    expires_at: "2026-08-20T00:00:00.000Z",
    revocation_reason: null,
    critical_failure: false,
    drift_detected: false,
  };
}

function validFixture(): NoStartInput {
  const routes = [
    route("route-execute", "codex", "openai"),
    route("route-fallback", "claude-code", "anthropic"),
    route("route-remediate", "opencode", "deepseek"),
    route("route-verify", "independent-harness", "independent-provider"),
  ];
  const request_id = "123e4567-e89b-42d3-a456-426614174000";
  const task_spec = {
    schema_version: "agentdash.task-spec/v1" as const,
    request_id,
    title: "Prepare release",
    objective: "Prepare a verified release checklist.",
    acceptance_checks: ["The checklist is complete."],
    constraints: ["Stay in the approved workspace."],
    prohibited_actions: ["No network publication."],
    project_id: "agentdash",
    workspace: { project_id: "agentdash", mode: "isolated_worktree" as const, path: "C:/workspace/agentdash" },
    workspace_policy: { schema_version: "agentdash.workspace-policy/v1" as const, workspace: { project_id: "agentdash", mode: "isolated_worktree" as const, path: "C:/workspace/agentdash" }, allowed_roots: ["C:/workspace"], require_isolated_worktree: true },
    required_capabilities: ["filesystem_write"],
    risk_mode: "approval_required" as const,
    budget: { max_cost_usd: 12, max_runtime_ms: 12_000, max_attempts: 9, max_provider_tokens: 2_000 },
    route_plan: [
      { phase: "execute" as const, name: "primary" as const, route_id: "route-execute", task_class: taskClass, deterministic: false as const },
      { phase: "fallback" as const, name: "fallback", route_id: "route-fallback", task_class: taskClass, deterministic: false as const },
      { phase: "remediate" as const, name: "remediation", route_id: "route-remediate", task_class: taskClass, deterministic: false as const },
      { phase: "verify" as const, name: "independent", route_id: "route-verify", task_class: taskClass, deterministic: false as const },
      { phase: "finalize" as const, route_id: null, task_class: taskClass, deterministic: true as const },
    ],
    finalization: { mutation_type: "no_change_close" as const, authority_predicate: { required: true, allowed_external_mutation: false }, allowed_path_prefixes: [], prohibited_changes: ["No mutation."] },
    plan_revision: 0,
    source_refs: ["ceo-request"],
  };
  const taskSpecDigest = canonicalDigest(task_spec);
  const acceptanceDigest = canonicalDigest(task_spec.acceptance_checks);
  const emptyPatchDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [] });
  const emptyManifestDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [], diff_bytes: 0, patch_digest: emptyPatchDigest });
  const nodeTargets = (target: unknown) => Object.fromEntries(ActionOutcomeValues.map((outcome) => [outcome, target]));
  const action_nodes = [
    { node_id: "execute", action_role: "execute" as const, executor_kind: "codeg_worker" as const, route_id: "route-execute", route_proof_id: routes[0].route_proof_id, route_proof_digest: routes[0].evidence_digest, remediation_scope: null },
    { node_id: "fallback", action_role: "retry" as const, executor_kind: "codeg_worker" as const, route_id: "route-fallback", route_proof_id: routes[1].route_proof_id, route_proof_digest: routes[1].evidence_digest, remediation_scope: null },
    { node_id: "remediate", action_role: "remediate" as const, executor_kind: "codeg_worker" as const, route_id: "route-remediate", route_proof_id: routes[2].route_proof_id, route_proof_digest: routes[2].evidence_digest, remediation_scope: { finding_classes: ["test_failure"], artifact_scope: ["src"] } },
    { node_id: "verify", action_role: "verify" as const, executor_kind: "codeg_worker" as const, route_id: "route-verify", route_proof_id: routes[3].route_proof_id, route_proof_digest: routes[3].evidence_digest, remediation_scope: null },
    { node_id: "finalize", action_role: "finalize" as const, executor_kind: "finalizer" as const, route_id: null, route_proof_id: null, route_proof_digest: null, remediation_scope: null },
  ];
  const transition_graph = {
    execute: { ...nodeTargets({ kind: "terminal", outcome: "failed" }), succeeded: { kind: "node", node_id: "verify" }, transient_infrastructure: { kind: "node", node_id: "fallback" }, semantic_failure: { kind: "node", node_id: "remediate" } },
    fallback: { ...nodeTargets({ kind: "terminal", outcome: "failed" }), succeeded: { kind: "node", node_id: "verify" } },
    remediate: { ...nodeTargets({ kind: "terminal", outcome: "failed" }), succeeded: { kind: "node", node_id: "verify" } },
    verify: { ...nodeTargets({ kind: "terminal", outcome: "failed" }), succeeded: { kind: "node", node_id: "finalize" } },
    finalize: { ...nodeTargets({ kind: "terminal", outcome: "failed" }), succeeded: { kind: "terminal", outcome: "succeeded" } },
  };
  const actionLimit = { max_cost_usd: 1, max_runtime_ms: 1_000, max_output_tokens: 100, max_provider_tokens: 200 };
  const reserve = { max_cost_usd: 1, max_runtime_ms: 500, max_attempts: 1, max_provider_tokens: 50 };
  const budget_policy = { schema_version: "agentdash.budget-policy-snapshot/v1" as const, action_limits: Object.fromEntries(action_nodes.map((node) => [node.node_id, actionLimit])), task_reserves: { verification: reserve, finalization: reserve, cancellation: reserve, reconciliation: reserve } };
  const mandate = {
    schema_version: "agentdash.execution-mandate/v1" as const,
    mandate_id: `mandate-${digest("mandate")}`,
    task_id: `task-${digest("task")}`,
    request_id,
    task_spec_revision: { plan_revision: 0, task_spec_digest: taskSpecDigest, objective_digest: canonicalDigest(task_spec.objective), acceptance_digest: acceptanceDigest },
    action_nodes,
    transition_graph,
    visit_caps: Object.fromEntries(action_nodes.map((node) => [node.node_id, 1])),
    edge_visit_caps: Object.fromEntries(action_nodes.flatMap((node) => ActionOutcomeValues.map((outcome) => [`${node.node_id}:${outcome}`, 1]))),
    verification_step: { acceptance_digest: acceptanceDigest, acceptance_checks: task_spec.acceptance_checks, required_independence_tier: 2 as const, route_id: "route-verify", route_proof_id: routes[3].route_proof_id, route_proof_digest: routes[3].evidence_digest, deterministic_verifier_id: null, independence_proof_digest: digest("independence") },
    finalization_step: { mutation_type: "no_change_close" as const, allowed_path_prefixes: [], max_files: 0, max_diff_bytes: 0, prohibited_changes: ["No mutation."], mutation_manifest: { mutation_type: "no_change_close" as const, entries: [], diff_bytes: 0, manifest_digest: emptyManifestDigest, patch_digest: emptyPatchDigest }, expected_post_state: { kind: "digest" as const, digest: digest("post-state") }, drift_preconditions: { base_digest: digest("base"), target_digest: digest("target"), cas_precondition_digest: digest("cas") } },
    capability_scope: { allowed_tools: ["filesystem"], allowed_side_effects: ["workspace_edit"], allowed_data_classes: ["source"], prohibited_actions: task_spec.prohibited_actions },
    workspace_scope: task_spec.workspace,
    aggregate_budget: task_spec.budget,
    per_action_limits: Object.fromEntries(action_nodes.map((node) => [node.node_id, actionLimit])),
    budget_policy_digest: canonicalDigest(budget_policy),
    budget_proof: { worst_case_path_node_ids: ["execute", "remediate", "verify", "finalize"], worst_case_path: { max_cost_usd: 8, max_runtime_ms: 6_000, max_attempts: 8, max_provider_tokens: 1_000 }, task_reserves: budget_policy.task_reserves, reserves_carried_once: true as const },
    reconciliation_limits: Object.fromEntries(["dispatch_lookup", "cancel_confirmation", "orphan_recovery", "finalization", "receipt_delivery"].map((key) => [key, { max_attempts: 2, deadline_ms: 10_000 }])),
    expiry: "2026-08-10T00:00:00.000Z",
    authority_source: { kind: "approval_precommit" as const, authority_id: `authority-${digest("authority")}`, binding: "precommitted_at_intake" as const },
  };
  return { task_spec, mandate, routes, budget_policy, now } as unknown as NoStartInput;
}

const codes = (input: NoStartInput) => runNoStartChecks(input).reasons.map((reason) => reason.code);

describe("composed no-start proof", () => {
  test("accepts schema-valid finite work with current routes and independent verification", () => {
    expect(runNoStartChecks(validFixture())).toMatchObject({ ready: true, reasons: [] });
  });

  test("rechecks route status, proof identity, task class, and expiry at the injected time", () => {
    const inactive = validFixture();
    inactive.routes[0].status = "revoked";
    inactive.routes[0].revocation_reason = "revoked for test";
    expect(codes(inactive)).toContain("route_inactive");

    const wrongProof = validFixture();
    wrongProof.routes[0].evidence_digest = digest("wrong-proof");
    expect(codes(wrongProof)).toContain("route_proof_mismatch");

    const wrongClass = validFixture();
    wrongClass.routes[0].task_class = "general_implementation";
    expect(codes(wrongClass)).toContain("route_task_class_mismatch");

    const expired = validFixture();
    expired.routes[0].expires_at = "2026-08-04T09:59:59.000Z";
    expect(codes(expired)).toContain("route_expired");
  });

  test("enforces provider and outer-harness independence on every success-capable path", () => {
    const sameProvider = validFixture();
    sameProvider.routes[3].provider = sameProvider.routes[1].provider;
    expect(codes(sameProvider)).toContain("verifier_not_independent");

    const sameHarness = validFixture();
    sameHarness.routes[3].outer_harness = sameHarness.routes[2].outer_harness;
    expect(codes(sameHarness)).toContain("verifier_not_independent");
  });

  test("checks tier-2 independence for model-backed mutation after an earlier verifier", () => {
    const input = validFixture();
    input.mandate.transition_graph.execute.semantic_failure = { kind: "terminal", outcome: "failed" };
    input.mandate.transition_graph.verify.semantic_failure = { kind: "node", node_id: input.mandate.action_nodes[2].node_id };
    input.mandate.transition_graph.remediate.succeeded = { kind: "node", node_id: input.mandate.action_nodes[3].node_id };
    input.mandate.visit_caps.verify = 2;
    input.mandate.edge_visit_caps["verify:semantic_failure"] = 1;
    input.mandate.edge_visit_caps["verify:succeeded"] = 2;
    input.routes[3].provider = input.routes[2].provider;

    expect(codes(input)).toContain("verifier_not_independent");
  });

  test("fails closed for mandate expiry and an invalid exact finalization action", () => {
    const expired = validFixture();
    expired.mandate.expiry = "2026-08-04T09:59:59.000Z";
    expect(codes(expired)).toContain("mandate_expired");

    const wrongFinalizer = validFixture();
    wrongFinalizer.mandate.action_nodes[4].action_role = "execute";
    expect(codes(wrongFinalizer)).toContain("finalization_invalid");
  });

  test("retains TaskSpec prohibitions in the no-start capability proof", () => {
    const input = validFixture();
    input.task_spec.prohibited_actions = [...input.task_spec.prohibited_actions, "No credential export."];
    input.mandate.task_spec_revision.task_spec_digest = canonicalDigest(input.task_spec);

    expect(codes(input)).toContain("capability_scope_mismatch");
  });

  // "High-risk work requires Tier 2 and fails the no-start invariant when no current proven verifier
  // satisfies it... CEO approval cannot waive this MVP safety floor." The tier must therefore be
  // compelled by the task's risk, not self-declared by the mandate it governs.
  test("refuses to let high-risk work self-declare a Tier 1 model verifier", () => {
    const input = validFixture();
    // The fixture is approval_required (high risk) with a compliant model-backed Tier 2 verifier.
    // Downgrading the declared tier must not silently skip the independence floor.
    Object.assign(input.mandate.verification_step, { required_independence_tier: 1 as const });

    expect(codes(input)).toContain("independence_tier_too_low");
  });

  test("still enforces Tier 2 independence for high-risk work that declares tier 2", () => {
    const input = validFixture();
    // Make the verifier share the executing route's provider: independence must fail.
    const execute = input.routes.find((evidence) => evidence.route_id === "route-execute");
    const verify = input.routes.find((evidence) => evidence.route_id === "route-verify");
    if (execute && verify) Object.assign(verify, { provider: execute.provider });

    expect(codes(input)).toContain("verifier_not_independent");
  });

  test("binds deterministic TaskSpec phases to their exact controller executor kinds", () => {
    const input = validFixture();
    Object.assign(input.task_spec.route_plan[0], { deterministic: true, route_id: null });
    Object.assign(input.mandate.action_nodes[0], { executor_kind: "verifier", route_id: null, route_proof_id: null, route_proof_digest: null });
    input.routes = input.routes.filter((evidence) => evidence.route_id !== "route-execute");
    input.mandate.task_spec_revision.task_spec_digest = canonicalDigest(input.task_spec);

    expect(codes(input)).toContain("phase_binding_mismatch");
  });
});
