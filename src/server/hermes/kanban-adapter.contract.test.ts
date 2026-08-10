import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import {
  ActionOutcomeValues,
  ActivateMandateInputSchema,
  EnsureArtifactInputSchema,
  canonicalActivationCommandId,
  canonicalActivationQualificationDigest,
  canonicalDigest,
} from "../../lib/mission-control/contracts";

import { HermesKanbanAdapter } from "./kanban-adapter";
import type { CommandOptions } from "./command";

const executableBytes = Buffer.from("sealed Hermes launcher");
const executableSha256 = createHash("sha256").update(executableBytes).digest("hex");
const observedAt = "2026-08-04T13:14:15.123Z";

// A complete, schema-valid CEOInputRequestV1 for board-projection tests. `Needs you` is reserved for
// an active typed request, so these tests need a request that really parses — an approximate object
// would pass the lane assertion for the wrong reason.
const boardTaskId = "task-1";
function boardApprovalRequest(overrides: Record<string, unknown> = {}) {
  const taskSpecDigest = canonicalDigest({ task_spec: boardTaskId });
  const mandateDigest = canonicalDigest({ mandate: boardTaskId });
  return {
    schema_version: "agentdash.ceo-input-request/v1",
    task_id: boardTaskId,
    task_spec_revision: 0,
    task_spec_digest: taskSpecDigest,
    active_mandate_id: null,
    proposed_mandate_id: "mandate-1",
    proposed_mandate_digest: mandateDigest,
    decision_type: "initial_mandate_approval",
    proposed_diff: { digest: canonicalDigest({ task_spec_digest: taskSpecDigest, mandate_digest: mandateDigest }), summary: "activate mandate" },
    proposed_limits: { max_cost_usd: 2, max_runtime_ms: 2_000, max_attempts: 2, max_provider_tokens: 400 },
    proposed_route_ids: [],
    proposed_side_effects: [],
    rationale: "approval required",
    evidence_refs: ["evidence-1"],
    completed_attempt_receipt_ids: [],
    no_unapproved_action_running: true,
    created_at: "2026-08-04T12:00:00.000Z",
    expires_at: "2026-08-04T14:00:00.000Z",
    ...overrides,
  };
}

function boardTaskRow(ceoInput: unknown, status = "blocked", title = "Approve release") {
  return { task_id: boardTaskId, title, body: "Review the proposed release.", status, priority: 1, created_at: 1, updated_at: observedAt, request_digest: "a".repeat(64), revision: 2, ceo_input: ceoInput, ceo_input_digest: "b".repeat(64), terminal_state: "nonterminal", terminal_intent: null, terminal_intent_digest: null, terminal_receipt_digest: null, runs: [] };
}

function options(resultFor: (operation: string, payload: any) => unknown) {
  const runner = vi.fn(async (command: CommandOptions) => {
    const request = JSON.parse(command.stdin ?? "null");
    const result = resultFor(request.operation, request.payload);
    return {
      stdout: JSON.stringify({ protocol: "hermes-kanban-controller/1", request_id: request.request_id, operation: request.operation, ok: true, result_digest: canonicalDigest(result), result, error: null, observed_at: observedAt }),
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      outputLimitExceeded: false,
    };
  });
  return {
    adapter: new HermesKanbanAdapter({
      executable: "C:\\trusted\\hermes-kanban-controller.exe",
      expectedExecutableSha256: executableSha256,
      cwd: "C:\\trusted",
      boardId: "123e4567-e89b-12d3-a456-426614174000",
      capability: { capabilityId: "capability_00001", generation: 1, token: "eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg" },
      readExecutable: async () => executableBytes,
      runner,
    }),
    runner,
  };
}

function completeActivationInput(commandExpiresAt: string, qualificationValidUntil: string) {
  const taskId = "task-1";
  const requestId = "request-1";
  const actionLimit = { max_cost_usd: 1, max_runtime_ms: 1_000, max_output_tokens: 100, max_provider_tokens: 200 };
  const reserve = { max_cost_usd: 1, max_runtime_ms: 500, max_attempts: 1, max_provider_tokens: 50 };
  const aggregateBudget = { max_cost_usd: 2, max_runtime_ms: 2_000, max_attempts: 2, max_provider_tokens: 400 };
  const workspace = { project_id: "agentdash", mode: "isolated_worktree", path: "C:/workspace/agentdash" };
  const capabilityScope = { allowed_tools: ["controller"], allowed_side_effects: [], allowed_data_classes: ["project"], prohibited_actions: ["No direct dispatch."] };
  const acceptanceChecks = ["The requested outcome is complete and verified."];
  const patchDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [] });
  const manifestDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [], diff_bytes: 0, patch_digest: patchDigest });
  const taskSpec = {
    schema_version: "agentdash.task-spec/v1",
    request_id: requestId,
    title: "Approve release",
    objective: "Approve the bounded release plan.",
    acceptance_checks: acceptanceChecks,
    constraints: ["Use only controller-approved operations."],
    prohibited_actions: ["No direct dispatch."],
    project_id: workspace.project_id,
    workspace,
    workspace_policy: { schema_version: "agentdash.workspace-policy/v1", workspace, allowed_roots: ["C:/workspace"], require_isolated_worktree: true },
    required_capabilities: ["deterministic_planning"],
    risk_mode: "approval_required",
    budget: aggregateBudget,
    route_plan: [
      { phase: "execute", name: "primary", route_id: null, task_class: "bounded_coding", deterministic: true },
      { phase: "fallback", name: "fallback", route_id: null, task_class: "bounded_coding", deterministic: true },
      { phase: "remediate", name: "bounded-remediation", route_id: null, task_class: "bounded_coding", deterministic: true },
      { phase: "verify", name: "deterministic-checks", route_id: null, task_class: "bounded_coding", deterministic: true },
      { phase: "finalize", route_id: null, task_class: "bounded_coding", deterministic: true },
    ],
    finalization: { mutation_type: "no_change_close", authority_predicate: { required: true, allowed_external_mutation: false }, allowed_path_prefixes: [], prohibited_changes: ["No mutation."] },
    plan_revision: 0,
    source_refs: [`request:${requestId}`],
  };
  const taskSpecDigest = canonicalDigest(taskSpec);
  const terminal = Object.fromEntries(ActionOutcomeValues.map((outcome) => [outcome, {
    kind: "terminal",
    outcome: outcome === "succeeded" ? "succeeded" : outcome === "cancelled" ? "cancelled" : outcome === "timed_out" ? "timed_out" : outcome === "budget_exhausted" ? "budget_exhausted" : outcome === "route_unavailable" ? "route_unavailable" : outcome === "ambiguous" ? "inconsistent" : "failed",
  }]));
  const budgetPolicy = {
    schema_version: "agentdash.budget-policy-snapshot/v1",
    action_limits: { execute: actionLimit },
    task_reserves: { verification: reserve, finalization: reserve, cancellation: reserve, reconciliation: reserve },
  };
  const mandate = {
    schema_version: "agentdash.execution-mandate/v1",
    mandate_id: "mandate-1",
    task_id: taskId,
    request_id: requestId,
    task_spec_revision: { plan_revision: taskSpec.plan_revision, task_spec_digest: taskSpecDigest, objective_digest: canonicalDigest(taskSpec.objective), acceptance_digest: canonicalDigest(acceptanceChecks) },
    action_nodes: [{ node_id: "execute", action_role: "execute", executor_kind: "controller", route_id: null, route_proof_id: null, route_proof_digest: null, remediation_scope: null }],
    transition_graph: { execute: terminal },
    visit_caps: { execute: 1 },
    edge_visit_caps: Object.fromEntries(ActionOutcomeValues.map((outcome) => [`execute:${outcome}`, 1])),
    verification_step: { acceptance_digest: canonicalDigest(acceptanceChecks), acceptance_checks: acceptanceChecks, required_independence_tier: 1, route_id: null, route_proof_id: null, route_proof_digest: null, deterministic_verifier_id: "deterministic-checks", independence_proof_digest: canonicalDigest({ verifier: "deterministic-checks" }) },
    finalization_step: { mutation_type: "no_change_close", allowed_path_prefixes: [], max_files: 0, max_diff_bytes: 0, prohibited_changes: ["No mutation."], mutation_manifest: { mutation_type: "no_change_close", entries: [], diff_bytes: 0, manifest_digest: manifestDigest, patch_digest: patchDigest }, expected_post_state: { kind: "digest", digest: canonicalDigest({ state: "verified" }) }, drift_preconditions: { base_digest: canonicalDigest({ base: 1 }), target_digest: canonicalDigest({ target: 1 }), cas_precondition_digest: canonicalDigest({ cas: 1 }) } },
    capability_scope: capabilityScope,
    workspace_scope: workspace,
    aggregate_budget: aggregateBudget,
    per_action_limits: { execute: actionLimit },
    budget_policy_digest: canonicalDigest(budgetPolicy),
    budget_proof: { worst_case_path_node_ids: ["execute"], worst_case_path: aggregateBudget, task_reserves: budgetPolicy.task_reserves, reserves_carried_once: true },
    reconciliation_limits: { dispatch_lookup: { max_attempts: 1, deadline_ms: 1_000 }, cancel_confirmation: { max_attempts: 1, deadline_ms: 1_000 }, orphan_recovery: { max_attempts: 1, deadline_ms: 1_000 }, finalization: { max_attempts: 1, deadline_ms: 1_000 }, receipt_delivery: { max_attempts: 1, deadline_ms: 1_000 } },
    expiry: qualificationValidUntil,
    authority_source: { kind: "approval_precommit", authority_id: "authority-1", binding: "precommitted_at_intake" },
  };
  const mandateDigest = canonicalDigest(mandate);
  const expectedSnapshotDigest = canonicalDigest({ pending: canonicalDigest({ readiness: taskId }) });
  const approvalRequest = {
    schema_version: "agentdash.ceo-input-request/v1",
    task_id: taskId,
    task_spec_revision: taskSpec.plan_revision,
    task_spec_digest: taskSpecDigest,
    active_mandate_id: null,
    proposed_mandate_id: mandate.mandate_id,
    proposed_mandate_digest: mandateDigest,
    decision_type: "initial_mandate_approval",
    proposed_diff: { digest: canonicalDigest({ task_spec_digest: taskSpecDigest, mandate_digest: mandateDigest }), summary: "activate mandate" },
    proposed_limits: aggregateBudget,
    proposed_route_ids: [],
    proposed_side_effects: [],
    rationale: "approval required",
    evidence_refs: ["evidence-1"],
    completed_attempt_receipt_ids: [],
    no_unapproved_action_running: true,
    created_at: observedAt,
    expires_at: qualificationValidUntil,
  };
  const qualificationBase = {
    source_snapshot_digest: expectedSnapshotDigest,
    request_digest: canonicalDigest({ request: requestId }),
    task_id: taskId,
    task_spec_digest: taskSpecDigest,
    mandate_id: mandate.mandate_id,
    mandate_digest: mandateDigest,
    approval_request_digest: canonicalDigest(approvalRequest),
    budget_policy_digest: canonicalDigest(budgetPolicy),
    route_registry_revision: 1,
    route_registry_snapshot_token: canonicalDigest({ routes: "v1" }),
    routes: [],
    route_snapshot_digest: canonicalDigest([]),
    valid_until: qualificationValidUntil,
  };
  const qualification = { schema_version: "agentdash.activation-qualification/v1", ...qualificationBase, qualification_digest: canonicalActivationQualificationDigest(qualificationBase) };
  const replayBindingDigest = canonicalDigest({ replay: "activation" });
  const command = {
    schema_version: "agentdash.ceo-command/v1",
    command_id: canonicalActivationCommandId(replayBindingDigest),
    replay_nonce: "nonce-1234567890",
    authenticated_session_id: "session-1234567890",
    csrf_valid: true,
    origin_valid: true,
    command_type: "approve",
    task_id: taskId,
    displayed_task_spec_revision: taskSpec.plan_revision,
    displayed_task_spec_digest: taskSpecDigest,
    active_mandate_id: null,
    proposed_mandate_id: mandate.mandate_id,
    viewed_mandate_digest: mandateDigest,
    requested_decision: "initial_mandate_approval",
    source_snapshot_digest: expectedSnapshotDigest,
    qualification_digest: qualification.qualification_digest,
    created_at: observedAt,
    expires_at: commandExpiresAt,
  };
  const grant = {
    schema_version: "agentdash.approval-grant/v1",
    authority_id: mandate.authority_source.authority_id,
    task_id: taskId,
    task_spec_revision: taskSpec.plan_revision,
    task_spec_digest: taskSpecDigest,
    mandate_id: mandate.mandate_id,
    objective_digest: mandate.task_spec_revision.objective_digest,
    acceptance_digest: mandate.task_spec_revision.acceptance_digest,
    mandate_digest: mandateDigest,
    ordered_route_ids: [],
    capability_scope: capabilityScope,
    capability_scope_digest: canonicalDigest(capabilityScope),
    workspace_scope: workspace,
    aggregate_budget: aggregateBudget,
    finalization_predicate: { mutation_type: "no_change_close", mutation_manifest_digest: manifestDigest, max_external_mutation: false },
    approved_by: command.authenticated_session_id,
    source_command_id: command.command_id,
    source_snapshot_digest: expectedSnapshotDigest,
    qualification_digest: qualification.qualification_digest,
    approved_at: observedAt,
    expires_at: commandExpiresAt,
  };
  const result = {
    schema_version: "agentdash.activation-result/v1",
    task_id: taskId,
    command_id: command.command_id,
    authority_id: grant.authority_id,
    task_spec_digest: taskSpecDigest,
    mandate_digest: mandateDigest,
    source_snapshot_digest: expectedSnapshotDigest,
    qualification_digest: qualification.qualification_digest,
    activated_at: observedAt,
  };
  return ActivateMandateInputSchema.parse({
    expected_snapshot_digest: expectedSnapshotDigest,
    request_digest: qualificationBase.request_digest,
    task_id: taskId,
    source_task_spec: taskSpec,
    task_spec_digest: taskSpecDigest,
    mandate_digest: mandateDigest,
    source_approval_request: approvalRequest,
    qualification,
    replay_binding_digest: replayBindingDigest,
    consumed_at: Date.parse(observedAt),
    command,
    grant,
    mandate,
    result,
  });
}

describe("HermesKanbanAdapter", () => {
  test("looks up the durable intake by CEO request identity through the sealed bridge", async () => {
    const { adapter, runner } = options(() => ({ found: false, request_id: "request-1" }));

    await expect(adapter.lookupIntake("request-1")).resolves.toEqual({ status: "not_found" });
    const invocation = runner.mock.calls[0][0];
    const request = JSON.parse(invocation.stdin ?? "null");
    expect(invocation.args).toEqual(["intake-lookup"]);
    expect(request.payload).toEqual({ request_id: "request-1" });
    expect(request.authorization.token).toBe("eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg");
    expect(invocation.redactValues).toContain(request.authorization.token);
  });

  test("accepts only digest-bound exact bridge responses", async () => {
    const { adapter, runner } = options(() => ({ status: "not_found" }));
    runner.mockImplementationOnce(async (command) => {
      const request = JSON.parse(command.stdin ?? "null");
      return { stdout: JSON.stringify({ protocol: "hermes-kanban-controller/1", request_id: request.request_id, operation: request.operation, ok: true, result_digest: "0".repeat(64), result: { status: "not_found" }, error: null, observed_at: observedAt }), stderr: "", code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false };
    });

    await expect(adapter.getActivationSnapshot(`task-${"a".repeat(64)}`)).rejects.toThrow("digest");
  });

  test("ensures one immutable artifact and returns only the strict port DTO", async () => {
    const payload = { redacted: true as const, digest: "a".repeat(64), summary: "sealed task specification" };
    const digest = canonicalDigest(payload);
    const { adapter } = options((_operation, request) => ({ created: true, task_id: request.task_id, artifact_id: request.artifact_id, artifact_key: request.artifact_key, digest: request.digest }));

    const input = EnsureArtifactInputSchema.parse({ task_id: "task-1", artifact_key: "task-spec-v1", kind: "task_spec", digest, payload });
    await expect(adapter.ensureArtifact(input)).resolves.toEqual({ artifact_id: expect.stringMatching(/^artifact_/), created: true, digest });
  });

  test("uses the CEO approval grant expiry when activating a mandate", async () => {
    const grantExpiresAt = "2026-08-04T13:20:00.000Z";
    const qualificationValidUntil = "2026-08-04T13:30:00.000Z";
    let capturedPayload: Record<string, unknown> | undefined;
    const { adapter } = options((operation, payload) => {
      expect(operation).toBe("mandate-activate");
      capturedPayload = payload;
      return {
        created: true,
        command_id: payload.command_id,
        task_id: payload.task_id,
        task_spec_revision: payload.task_spec_revision,
        mandate_id: payload.mandate_id,
        activation_digest: canonicalDigest(payload.activation),
      };
    });
    const input = completeActivationInput(grantExpiresAt, qualificationValidUntil);

    await expect(adapter.activateMandate(input)).resolves.toMatchObject({ status: "activated" });
    expect(capturedPayload).toMatchObject({ valid_until: grantExpiresAt });
    expect(capturedPayload?.activation).toEqual(input);
    expect(capturedPayload?.valid_until).not.toBe(qualificationValidUntil);
  });

  test("projects exact controller rows into CEO board lanes without leaking transport rows", async () => {
    // An ACTIVE typed CEOInputRequestV1 is the only thing that earns the Needs you lane.
    const task = boardTaskRow(boardApprovalRequest());
    const { adapter } = options(() => ({ generated_at: observedAt, tasks: [task], archived_count: 0 }));

    const board = await adapter.projectBoard();
    expect(board.lanes.needs_you).toHaveLength(1);
    expect(board.lanes.ready).toEqual([]);
    expect(board.lanes.needs_you[0]).toMatchObject({ redacted: true });
    expect(board.lanes.needs_you[0]).not.toHaveProperty("body");
  });

  // `Needs you` is reserved for an ACTIVE TYPED CEOInputRequestV1. A bridge row carrying some
  // untyped or expired ceo_input value must not create a CEO review pause — the plan's superseded
  // review-pause concept must be absent, not renamed.
  test("an untyped ceo_input value never routes a task into Needs you", async () => {
    const task = boardTaskRow({ question: "Approve?" });
    const { adapter } = options(() => ({ generated_at: observedAt, tasks: [task], archived_count: 0 }));

    const board = await adapter.projectBoard();
    expect(board.lanes.needs_you).toEqual([]);
    // Terminal-less blocked with no valid CEO request is Stopped, not Needs you.
    expect(board.lanes.stopped).toHaveLength(1);
  });

  test("an expired typed CEO input request does not hold a task in Needs you", async () => {
    // Identical to the valid request except that it already expired at the observation time.
    const expired = boardApprovalRequest({ created_at: "2026-08-01T00:00:00.000Z", expires_at: "2026-08-01T01:00:00.000Z" });
    const task = boardTaskRow(expired);
    const { adapter } = options(() => ({ generated_at: observedAt, tasks: [task], archived_count: 0 }));

    const board = await adapter.projectBoard();
    expect(board.lanes.needs_you).toEqual([]);
    expect(board.lanes.stopped).toHaveLength(1);
  });

  test("archived rows are hidden from every lane and only counted", async () => {
    const task = boardTaskRow(null, "archived", "Old work");
    const { adapter } = options(() => ({ generated_at: observedAt, tasks: [task], archived_count: 1 }));

    const board = await adapter.projectBoard();
    const total = Object.values(board.lanes).reduce((sum, lane) => sum + lane.length, 0);
    expect(total).toBe(0);
    expect(board.archived_count).toBe(1);
  });

  // "Any nonzero exit, missing/truncated/multiple output, request/operation mismatch, invalid digest,
  // or malformed envelope is transport `unknown`; only a matching zero-exit `not_found` response is
  // authoritative absence." Each of these must therefore THROW rather than resolve to an absence a
  // caller could mistake for a definitive "the record does not exist".
  describe("classifies every transport failure as unknown, never a retryable absence", () => {
    function failing(overrides: Record<string, unknown>) {
      const runner = vi.fn(async (command: CommandOptions) => {
        const request = JSON.parse(command.stdin ?? "null");
        const result = { found: false, request_id: request.request_id };
        return {
          stdout: JSON.stringify({ protocol: "hermes-kanban-controller/1", request_id: request.request_id, operation: request.operation, ok: true, result_digest: canonicalDigest(result), result, error: null, observed_at: observedAt }),
          stderr: "",
          code: 0,
          signal: null,
          timedOut: false,
          aborted: false,
          outputLimitExceeded: false,
          ...overrides,
        };
      });
      return new HermesKanbanAdapter({
        executable: "C:\\trusted\\hermes-kanban-controller.exe",
        expectedExecutableSha256: executableSha256,
        cwd: "C:\\trusted",
        boardId: "123e4567-e89b-12d3-a456-426614174000",
        capability: { capabilityId: "capability_00001", generation: 1, token: "eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg" },
        readExecutable: async () => executableBytes,
        runner,
      });
    }

    test.each([
      ["a nonzero exit", { code: 1 }],
      ["a killing signal", { signal: "SIGKILL" }],
      ["a timeout", { timedOut: true }],
      ["an abort", { aborted: true }],
      ["an exceeded output limit", { outputLimitExceeded: true }],
      ["any stderr output", { stderr: "warning: slow" }],
      ["empty stdout", { stdout: "" }],
      ["truncated stdout", { stdout: '{"protocol":"hermes-kanban-controller/1"' }],
      ["multiple documents", { stdout: '{"a":1}{"b":2}' }],
    ])("rejects %s instead of reporting absence", async (_label, overrides) => {
      // The underlying payload is a well-formed `found: false`, so a fail-open implementation would
      // return { status: "not_found" } here.
      await expect(failing(overrides).lookupIntake("request-1")).rejects.toThrow();
    });

    test("rejects a response whose request identity does not match the request", async () => {
      const runner = vi.fn(async () => {
        const result = { found: false, request_id: "request-1" };
        return { stdout: JSON.stringify({ protocol: "hermes-kanban-controller/1", request_id: "some-other-request", operation: "intake-lookup", ok: true, result_digest: canonicalDigest(result), result, error: null, observed_at: observedAt }), stderr: "", code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false };
      });
      const adapter = new HermesKanbanAdapter({ executable: "C:\\trusted\\hermes-kanban-controller.exe", expectedExecutableSha256: executableSha256, cwd: "C:\\trusted", boardId: "123e4567-e89b-12d3-a456-426614174000", capability: { capabilityId: "capability_00001", generation: 1, token: "eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg" }, readExecutable: async () => executableBytes, runner });

      await expect(adapter.lookupIntake("request-1")).rejects.toThrow(/different request/i);
    });

    test("rejects a result whose digest does not bind the payload", async () => {
      const { adapter } = options(() => ({ found: false, request_id: "request-1" }));
      // Re-wrap the runner so the digest no longer matches the result it claims to bind.
      const broken = new HermesKanbanAdapter({
        ...(adapter as unknown as { options: ConstructorParameters<typeof HermesKanbanAdapter>[0] }).options,
        readExecutable: async () => executableBytes,
        runner: async (command: CommandOptions) => {
          const request = JSON.parse(command.stdin ?? "null");
          return { stdout: JSON.stringify({ protocol: "hermes-kanban-controller/1", request_id: request.request_id, operation: request.operation, ok: true, result_digest: "f".repeat(64), result: { found: false, request_id: "request-1" }, error: null, observed_at: observedAt }), stderr: "", code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false };
        },
      });

      await expect(broken.lookupIntake("request-1")).rejects.toThrow(/digest/i);
    });

    test("still reports authoritative absence for a clean zero-exit found:false response", async () => {
      const { adapter } = options(() => ({ found: false, request_id: "request-1" }));
      await expect(adapter.lookupIntake("request-1")).resolves.toEqual({ status: "not_found" });
    });
  });

  test("refuses an executable whose current bytes no longer match the reviewed launcher", async () => {
    const { adapter } = options(() => ({ found: false, request_id: "request-1" }));
    (adapter as any).readExecutable = async () => Buffer.from("replaced launcher");
    await expect(adapter.lookupIntake("request-1")).rejects.toThrow("executable");
  });
});
