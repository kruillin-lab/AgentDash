import { describe, expect, test } from "vitest";

import { ActionOutcomeValues, canonicalDigest } from "../../../lib/mission-control/contracts";
import { compileIntake, type CompileIntakeInput } from "./compiler";

const request_id = "123e4567-e89b-42d3-a456-426614174000";
const now = "2026-08-04T10:00:00.000Z";

function policy() {
  const patchDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [] });
  const manifestDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [], diff_bytes: 0, patch_digest: patchDigest });
  const acceptance_checks = ["The requested outcome is complete and verified."];
  const nodeIds = ["execute", "fallback", "remediate", "verify", "finalize"];
  const terminal = Object.fromEntries(ActionOutcomeValues.map((outcome) => [outcome, { kind: "terminal", outcome: outcome === "cancelled" ? "cancelled" : "failed" }]));
  const actionLimit = { max_cost_usd: 1, max_runtime_ms: 1_000, max_output_tokens: 100, max_provider_tokens: 200 };
  const reserve = { max_cost_usd: 1, max_runtime_ms: 500, max_attempts: 1, max_provider_tokens: 50 };
  const workspace = { project_id: "agentdash", mode: "isolated_worktree" as const, path: "C:/workspace/agentdash" };
  const aggregateBudget = { max_cost_usd: 9, max_runtime_ms: 7_000, max_attempts: 9, max_provider_tokens: 1_200 };
  return {
    schema_version: "agentdash.compilation-policy-snapshot/v1" as const,
    policy_version: "compiler-policy-v1",
    task_template: {
      acceptance_checks,
      constraints: ["Use only controller-approved operations."],
      prohibited_actions: ["No direct dispatch."],
      project_id: "agentdash",
      workspace,
      workspace_policy: { schema_version: "agentdash.workspace-policy/v1" as const, workspace, allowed_roots: ["C:/workspace"], require_isolated_worktree: true },
      required_capabilities: ["deterministic_planning"],
      budget: aggregateBudget,
      route_plan: [
        { phase: "execute" as const, name: "primary" as const, route_id: null, task_class: "bounded_coding" as const, deterministic: true as const },
        { phase: "fallback" as const, name: "fallback", route_id: null, task_class: "bounded_coding" as const, deterministic: true as const },
        { phase: "remediate" as const, name: "bounded-remediation", route_id: null, task_class: "bounded_coding" as const, deterministic: true as const },
        { phase: "verify" as const, name: "deterministic-checks", route_id: null, task_class: "bounded_coding" as const, deterministic: true as const },
        { phase: "finalize" as const, route_id: null, task_class: "bounded_coding" as const, deterministic: true as const },
      ],
      finalization: { mutation_type: "no_change_close" as const, authority_predicate: { required: true, allowed_external_mutation: false }, allowed_path_prefixes: [], prohibited_changes: ["No mutation."] },
    },
    mandate_template: {
      action_nodes: [
        { node_id: "execute", action_role: "execute" as const, executor_kind: "controller" as const, route_id: null, route_proof_id: null, route_proof_digest: null, remediation_scope: null },
        { node_id: "fallback", action_role: "retry" as const, executor_kind: "controller" as const, route_id: null, route_proof_id: null, route_proof_digest: null, remediation_scope: null },
        { node_id: "remediate", action_role: "remediate" as const, executor_kind: "controller" as const, route_id: null, route_proof_id: null, route_proof_digest: null, remediation_scope: { finding_classes: ["bounded_failure"], artifact_scope: ["controller"] } },
        { node_id: "verify", action_role: "verify" as const, executor_kind: "verifier" as const, route_id: null, route_proof_id: null, route_proof_digest: null, remediation_scope: null },
        { node_id: "finalize", action_role: "finalize" as const, executor_kind: "finalizer" as const, route_id: null, route_proof_id: null, route_proof_digest: null, remediation_scope: null },
      ],
      transition_graph: {
        execute: { ...terminal, succeeded: { kind: "node", node_id: "fallback" } },
        fallback: { ...terminal, succeeded: { kind: "node", node_id: "remediate" } },
        remediate: { ...terminal, succeeded: { kind: "node", node_id: "verify" } },
        verify: { ...terminal, succeeded: { kind: "node", node_id: "finalize" } },
        finalize: { ...terminal, succeeded: { kind: "terminal", outcome: "succeeded" } },
      },
      visit_caps: Object.fromEntries(nodeIds.map((nodeId) => [nodeId, 1])),
      edge_visit_caps: Object.fromEntries(nodeIds.flatMap((nodeId) => ActionOutcomeValues.map((outcome) => [`${nodeId}:${outcome}`, 1]))),
      verification_step: { acceptance_digest: canonicalDigest(acceptance_checks), acceptance_checks, required_independence_tier: 1 as const, route_id: null, route_proof_id: null, route_proof_digest: null, deterministic_verifier_id: "deterministic-checks", independence_proof_digest: canonicalDigest({ verifier: "deterministic-checks" }) },
      finalization_step: { mutation_type: "no_change_close" as const, allowed_path_prefixes: [], max_files: 0, max_diff_bytes: 0, prohibited_changes: ["No mutation."], mutation_manifest: { mutation_type: "no_change_close" as const, entries: [], diff_bytes: 0, manifest_digest: manifestDigest, patch_digest: patchDigest }, expected_post_state: { kind: "digest" as const, digest: canonicalDigest({ state: "verified" }) }, drift_preconditions: { base_digest: canonicalDigest({ base: 1 }), target_digest: canonicalDigest({ target: 1 }), cas_precondition_digest: canonicalDigest({ cas: 1 }) } },
      capability_scope: { allowed_tools: ["controller"], allowed_side_effects: [], allowed_data_classes: ["project"], prohibited_actions: ["No direct dispatch."] },
      workspace_scope: workspace,
      aggregate_budget: aggregateBudget,
      per_action_limits: Object.fromEntries(nodeIds.map((nodeId) => [nodeId, actionLimit])),
      reconciliation_limits: { dispatch_lookup: { max_attempts: 2, deadline_ms: 10_000 }, cancel_confirmation: { max_attempts: 2, deadline_ms: 10_000 }, orphan_recovery: { max_attempts: 2, deadline_ms: 10_000 }, finalization: { max_attempts: 2, deadline_ms: 10_000 }, receipt_delivery: { max_attempts: 2, deadline_ms: 10_000 } },
    },
    budget_policy: { schema_version: "agentdash.budget-policy-snapshot/v1" as const, action_limits: Object.fromEntries(nodeIds.map((nodeId) => [nodeId, actionLimit])), task_reserves: { verification: reserve, finalization: reserve, cancellation: reserve, reconciliation: reserve } },
    route_snapshot: [],
    mandate_ttl_ms: 60_000,
    approval_request_ttl_ms: 30_000,
  };
}

function input(overrides: Record<string, unknown> = {}): CompileIntakeInput {
  const compilation_policy = policy();
  return {
    request: { request_id, message: "Plan the release." },
    pm_output: { text: "A bounded proposal is ready.", session_ref: "pm-session-1", proposal: { schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-1", task_id: null, intent: "create_task", evidence_refs: ["pm-evidence"], created_at: now } },
    compilation_policy,
    compilation_policy_digest: canonicalDigest(compilation_policy),
    activation: { kind: "approval_required" },
    now,
    ...overrides,
  } as unknown as CompileIntakeInput;
}

describe("deterministic intake compiler", () => {
  test("produces byte-identical artifacts and IDs for identical inputs", () => {
    const first = compileIntake(input());
    const second = compileIntake(structuredClone(input()));

    expect(first.status).toBe("compiled");
    expect(second).toEqual(first);
  });

  test("normalizes the CEO message for stable request and task identity", () => {
    const spaced = compileIntake(input({ request: { request_id, message: "  Plan   the release.  " } }));
    const normalized = compileIntake(input({ request: { request_id, message: "Plan the release." } }));

    expect(spaced.status).toBe("compiled");
    expect(normalized.status).toBe("compiled");
    if (spaced.status === "compiled" && normalized.status === "compiled" && spaced.mandate && normalized.mandate) {
      expect(spaced.request_digest).toBe(normalized.request_digest);
      expect(spaced.task_id).toBe(normalized.task_id);
      expect(spaced.mandate.mandate_id).toBe(normalized.mandate.mandate_id);
    }
  });

  test("keeps volatile PM facts as evidence and out of executable identity", () => {
    const first = compileIntake(input());
    const changedPM = compileIntake(input({ pm_output: { text: "Different canonical presentation.", session_ref: "pm-session-2", proposal: { schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-2", task_id: null, intent: "create_task", created_at: "2026-08-04T10:00:01.000Z" } } }));

    expect(first.status).toBe("compiled");
    expect(changedPM.status).toBe("compiled");
    if (first.status === "compiled" && changedPM.status === "compiled") {
      expect(changedPM.task_id).toBe(first.task_id);
      expect(changedPM.task_spec).toEqual(first.task_spec);
      expect(changedPM.mandate).toEqual(first.mandate);
      expect(changedPM.readiness.pm).not.toEqual(first.readiness.pm);
    }
  });

  test("persists only a deterministic precommit for approval-required work", () => {
    const result = compileIntake(input());
    expect(result.status).toBe("compiled");
    if (result.status === "compiled" && result.mandate) {
      expect(result.mandate.authority_source).toMatchObject({ kind: "approval_precommit", binding: "precommitted_at_intake" });
      expect(JSON.stringify(result.readiness)).not.toContain("approval-grant/v1");
    }
  });

  test("returns retryable intake_unavailable for invalid policy, PM input, trusted time, or approval deadline policy", () => {
    const badDigest = compileIntake(input({ compilation_policy_digest: "a".repeat(64) }));
    const pmAuthority = compileIntake(input({ pm_output: { ...input().pm_output, authority: { approved: true } } }));
    const badTime = compileIntake(input({ now: "not-a-time" }));
    const badDeadlinePolicy = policy();
    badDeadlinePolicy.approval_request_ttl_ms = badDeadlinePolicy.mandate_ttl_ms + 1;
    const badDeadline = compileIntake(input({ compilation_policy: badDeadlinePolicy, compilation_policy_digest: canonicalDigest(badDeadlinePolicy) }));

    expect(badDigest).toMatchObject({ status: "intake_unavailable", reasons: [{ code: "compilation_policy_mismatch" }] });
    expect(pmAuthority).toMatchObject({ status: "intake_unavailable", reasons: [{ code: "invalid_pm_output" }] });
    expect(badTime).toMatchObject({ status: "intake_unavailable", reasons: [{ code: "invalid_compilation_time" }] });
    expect(badDeadline).toMatchObject({ status: "intake_unavailable", reasons: [{ code: "compilation_policy_mismatch" }] });
  });

  test("returns retryable intake_unavailable when server policy cannot produce a valid TaskSpec", () => {
    const invalidTaskPolicy = policy();
    invalidTaskPolicy.task_template.workspace_policy.workspace = {
      ...invalidTaskPolicy.task_template.workspace_policy.workspace,
      path: "C:/workspace/other",
    };

    const result = compileIntake(input({
      compilation_policy: invalidTaskPolicy,
      compilation_policy_digest: canonicalDigest(invalidTaskPolicy),
    }));

    expect(result).toMatchObject({ status: "intake_unavailable", reasons: [{ code: "invalid_task_spec" }] });
  });

  test("returns retryable intake_unavailable for structural graph and budget arithmetic failures", () => {
    const invalidGraphPolicy = policy();
    invalidGraphPolicy.mandate_template.visit_caps.execute = 33;
    const arithmeticPolicy = policy();
    arithmeticPolicy.budget_policy.task_reserves.verification.max_cost_usd = Number.MAX_SAFE_INTEGER;

    const invalidGraph = compileIntake(input({
      compilation_policy: invalidGraphPolicy,
      compilation_policy_digest: canonicalDigest(invalidGraphPolicy),
    }));
    const arithmeticFailure = compileIntake(input({
      compilation_policy: arithmeticPolicy,
      compilation_policy_digest: canonicalDigest(arithmeticPolicy),
    }));

    expect(invalidGraph).toMatchObject({ status: "intake_unavailable", reasons: [{ code: "invalid_graph" }] });
    expect(arithmeticFailure).toMatchObject({ status: "intake_unavailable", reasons: [{ code: "invalid_budget" }] });
  });

  test("persists an invalid candidate mandate as a truthful nullable blocked_no_start artifact", () => {
    const invalidMandatePolicy = policy();
    const orphanLimit = { max_cost_usd: 1, max_runtime_ms: 1_000, max_output_tokens: 100, max_provider_tokens: 200 };
    invalidMandatePolicy.mandate_template.per_action_limits.orphan = orphanLimit;
    invalidMandatePolicy.budget_policy.action_limits.orphan = orphanLimit;

    const result = compileIntake(input({
      compilation_policy: invalidMandatePolicy,
      compilation_policy_digest: canonicalDigest(invalidMandatePolicy),
    }));

    expect(result).toMatchObject({
      status: "compiled",
      mandate: null,
      readiness: {
        kind: "blocked_no_start",
        candidate_mandate: null,
        no_start: { ready: false, reasons: [{ code: "invalid_mandate" }] },
        activation: null,
      },
    });
  });

  test("persists a structurally valid but unsafe candidate as blocked_no_start", () => {
    const unsafePolicy = policy();
    unsafePolicy.mandate_template.transition_graph.finalize.succeeded = { kind: "terminal", outcome: "failed" };

    const result = compileIntake(input({
      compilation_policy: unsafePolicy,
      compilation_policy_digest: canonicalDigest(unsafePolicy),
    }));

    expect(result).toMatchObject({
      status: "compiled",
      readiness: {
        kind: "blocked_no_start",
        no_start: { ready: false, reasons: expect.arrayContaining([expect.objectContaining({ code: "graph_missing_terminal_success" })]) },
        activation: null,
      },
    });
    if (result.status === "compiled") expect(result.mandate).not.toBeNull();
  });
});
