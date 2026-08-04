import { describe, expect, test, vi } from "vitest";

import { ActionOutcomeValues, ActivationSnapshotV1Schema, canonicalDigest, type ActivateMandateInput, type ActivationSnapshotV1 } from "../../../lib/mission-control/contracts";
import { compileIntake, type CompileIntakeInput } from "../intake/compiler";
import type { CommandSessionV1 } from "../security/command-session";
import type { NonceConsumption, NonceStore } from "../security/nonce-store";
import { CEOCommandService, CEOInitialApprovalRequestV1Schema, replayBindingDigest, type CEOInitialApprovalRequestV1 } from "./ceo-command";

const now = "2026-08-04T10:00:00.000Z";
const nowMs = Date.parse(now);

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
    task_template: { acceptance_checks, constraints: ["Use only controller-approved operations."], prohibited_actions: ["No direct dispatch."], project_id: "agentdash", workspace, workspace_policy: { schema_version: "agentdash.workspace-policy/v1" as const, workspace, allowed_roots: ["C:/workspace"], require_isolated_worktree: true }, required_capabilities: ["deterministic_planning"], budget: aggregateBudget, route_plan: [
      { phase: "execute" as const, name: "primary" as const, route_id: null, task_class: "bounded_coding" as const, deterministic: true as const },
      { phase: "fallback" as const, name: "fallback", route_id: null, task_class: "bounded_coding" as const, deterministic: true as const },
      { phase: "remediate" as const, name: "bounded-remediation", route_id: null, task_class: "bounded_coding" as const, deterministic: true as const },
      { phase: "verify" as const, name: "deterministic-checks", route_id: null, task_class: "bounded_coding" as const, deterministic: true as const },
      { phase: "finalize" as const, route_id: null, task_class: "bounded_coding" as const, deterministic: true as const },
    ], finalization: { mutation_type: "no_change_close" as const, authority_predicate: { required: true, allowed_external_mutation: false }, allowed_path_prefixes: [], prohibited_changes: ["No mutation."] } },
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
      visit_caps: Object.fromEntries(nodeIds.map((nodeId) => [nodeId, 1])), edge_visit_caps: Object.fromEntries(nodeIds.flatMap((nodeId) => ActionOutcomeValues.map((outcome) => [`${nodeId}:${outcome}`, 1]))),
      verification_step: { acceptance_digest: canonicalDigest(acceptance_checks), acceptance_checks, required_independence_tier: 1 as const, route_id: null, route_proof_id: null, route_proof_digest: null, deterministic_verifier_id: "deterministic-checks", independence_proof_digest: canonicalDigest({ verifier: "deterministic-checks" }) },
      finalization_step: { mutation_type: "no_change_close" as const, allowed_path_prefixes: [], max_files: 0, max_diff_bytes: 0, prohibited_changes: ["No mutation."], mutation_manifest: { mutation_type: "no_change_close" as const, entries: [], diff_bytes: 0, manifest_digest: manifestDigest, patch_digest: patchDigest }, expected_post_state: { kind: "digest" as const, digest: canonicalDigest({ state: "verified" }) }, drift_preconditions: { base_digest: canonicalDigest({ base: 1 }), target_digest: canonicalDigest({ target: 1 }), cas_precondition_digest: canonicalDigest({ cas: 1 }) } },
      capability_scope: { allowed_tools: ["controller"], allowed_side_effects: [], allowed_data_classes: ["project"], prohibited_actions: ["No direct dispatch."] }, workspace_scope: workspace, aggregate_budget: aggregateBudget,
      per_action_limits: Object.fromEntries(nodeIds.map((nodeId) => [nodeId, actionLimit])), reconciliation_limits: { dispatch_lookup: { max_attempts: 2, deadline_ms: 10_000 }, cancel_confirmation: { max_attempts: 2, deadline_ms: 10_000 }, orphan_recovery: { max_attempts: 2, deadline_ms: 10_000 }, finalization: { max_attempts: 2, deadline_ms: 10_000 }, receipt_delivery: { max_attempts: 2, deadline_ms: 10_000 } },
    },
    budget_policy: { schema_version: "agentdash.budget-policy-snapshot/v1" as const, action_limits: Object.fromEntries(nodeIds.map((nodeId) => [nodeId, actionLimit])), task_reserves: { verification: reserve, finalization: reserve, cancellation: reserve, reconciliation: reserve } },
    route_snapshot: [], mandate_ttl_ms: 60_000, approval_request_ttl_ms: 30_000,
  };
}

function fixture() {
  const compilation_policy = policy();
  const compiled = compileIntake({
    request: { request_id: "123e4567-e89b-42d3-a456-426614174000", message: "Plan the release." },
    pm_output: { text: "A bounded proposal is ready.", session_ref: "pm-session-1", proposal: { schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-1", task_id: null, intent: "create_task", created_at: now } },
    compilation_policy, compilation_policy_digest: canonicalDigest(compilation_policy), activation: { kind: "approval_required" }, now,
  } as unknown as CompileIntakeInput);
  if (compiled.status !== "compiled" || compiled.readiness.kind !== "approval_required") throw new Error("fixture compilation failed");
  const parsedSnapshot = ActivationSnapshotV1Schema.parse({ status: "pending", snapshot_digest: canonicalDigest({ pending: compiled.artifact_digest }), request_digest: compiled.request_digest, task_spec: compiled.task_spec, mandate: compiled.mandate, approval_request: compiled.readiness.activation.request });
  if (parsedSnapshot.status !== "pending") throw new Error("pending fixture failed");
  const snapshot = parsedSnapshot;
  const request = CEOInitialApprovalRequestV1Schema.parse({ task_id: compiled.task_id, replay_nonce: "nonce-1234567890", displayed_task_spec_revision: compiled.task_spec.plan_revision, displayed_task_spec_digest: canonicalDigest(compiled.task_spec), proposed_mandate_id: compiled.mandate.mandate_id, proposed_mandate_digest: canonicalDigest(compiled.mandate), decision_type: "initial_mandate_approval" });
  return { compiled, snapshot, request };
}

const session: CommandSessionV1 = { schema_version: "command_session_v1", session_id: "session-id-with-at-least-thirty-two-chars", csrf_digest: "d".repeat(64), issued_at: nowMs - 1_000, expires_at: nowMs + 50_000 };

class MemoryNonces implements NonceStore {
  readonly records = new Map<string, { digest: string; consumed_at: number }>();
  calls = 0;
  async consume(input: { session_id: string; nonce: string; expires_at: number; binding_digest: string }): Promise<NonceConsumption> {
    this.calls += 1;
    const key = `${input.session_id}:${input.nonce}`;
    const record = this.records.get(key);
    if (!record) { this.records.set(key, { digest: input.binding_digest, consumed_at: nowMs }); return { status: "consumed", consumed_at: nowMs }; }
    return record.digest === input.binding_digest ? { status: "replayed_same", consumed_at: record.consumed_at } : { status: "replayed_conflict" };
  }
}

class HermesFake {
  snapshot: ActivationSnapshotV1;
  activation: ActivateMandateInput | null = null;
  activationCalls = 0;
  result: ReturnType<typeof this.activationResult> | null = null;
  constructor(snapshot: ActivationSnapshotV1) { this.snapshot = snapshot; }
  activationResult(input: ActivateMandateInput) { return { schema_version: "agentdash.activation-result/v1" as const, task_id: input.task_id, command_id: input.command.command_id, authority_id: input.grant.authority_id, task_spec_digest: input.task_spec_digest, mandate_digest: input.mandate_digest, activated_at: input.command.created_at }; }
  async getActivationSnapshot() { return this.snapshot; }
  async lookupActivationByCommand(command_id: string) { return this.result?.command_id === command_id ? { status: "found" as const, result: this.result } : { status: "not_found" as const }; }
  async activateMandate(input: ActivateMandateInput) { this.activationCalls += 1; this.activation = structuredClone(input); this.result = this.activationResult(input); return { status: "activated" as const, ...this.result }; }
}

function commandService(hermes: HermesFake, nonces: MemoryNonces, at = now) {
  return new CEOCommandService({ hermes, nonces, now: () => new Date(at) });
}

describe("CEO command service", () => {
  test("accepts only the public initial-approval fields", () => {
    const { request } = fixture();
    expect(CEOInitialApprovalRequestV1Schema.safeParse(request).success).toBe(true);
    expect(CEOInitialApprovalRequestV1Schema.safeParse({ ...request, csrf_valid: true }).success).toBe(false);
  });

  test("creates the command and truthful grant only from the canonical pending snapshot", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();
    const result = await commandService(hermes, nonces).approveInitial(request, session);

    expect(result.command_id).toBe(hermes.activation?.command.command_id);
    expect(hermes.activation?.command).toMatchObject({ replay_nonce: request.replay_nonce, csrf_valid: true, origin_valid: true, created_at: now });
    expect(hermes.activation?.grant).toMatchObject({ authority_id: snapshot.mandate.authority_source.authority_id, source_command_id: result.command_id, approved_at: now });
    expect(snapshot.mandate.authority_source).toMatchObject({ kind: "approval_precommit", binding: "precommitted_at_intake" });
  });

  test("reconstructs byte-identical command and grant after response loss", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();
    const service = commandService(hermes, nonces);
    const first = await service.approveInitial(request, session);
    const activation = structuredClone(hermes.activation!);
    hermes.snapshot = ActivationSnapshotV1Schema.parse({ status: "active", snapshot_digest: canonicalDigest({ active: first }), request_digest: snapshot.request_digest, task_spec: snapshot.task_spec, mandate: snapshot.mandate, replay_binding_digest: replayBindingDigest(session, request, snapshot), consumed_at: nowMs, command: activation.command, grant: activation.grant, result: first });

    await expect(commandService(hermes, nonces, "2026-08-04T10:00:31.000Z").approveInitial(structuredClone(request), structuredClone(session))).resolves.toEqual(first);
    expect(hermes.activation).toEqual(activation);
    expect(hermes.activationCalls).toBe(1);
    expect(nonces.records.size).toBe(1);
  });

  test("requires replayed_same nonce state for an active exact-command replay", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const originalNonces = new MemoryNonces();
    const first = await commandService(hermes, originalNonces).approveInitial(request, session);
    const activation = structuredClone(hermes.activation!);
    hermes.snapshot = ActivationSnapshotV1Schema.parse({ status: "active", snapshot_digest: canonicalDigest({ active: first }), request_digest: snapshot.request_digest, task_spec: snapshot.task_spec, mandate: snapshot.mandate, replay_binding_digest: replayBindingDigest(session, request, snapshot), consumed_at: nowMs, command: activation.command, grant: activation.grant, result: first });
    const recreatedWithoutRecord = new MemoryNonces();

    await expect(commandService(hermes, recreatedWithoutRecord, "2026-08-04T10:00:31.000Z").approveInitial(request, session)).rejects.toMatchObject({ code: "activation_conflict" });
    expect(hermes.activationCalls).toBe(1);
  });

  test("rejects a different nonce against active state before creating a nonce record", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();
    const service = commandService(hermes, nonces);
    const first = await service.approveInitial(request, session);
    const activation = hermes.activation!;
    hermes.snapshot = ActivationSnapshotV1Schema.parse({ status: "active", snapshot_digest: canonicalDigest({ active: first }), request_digest: snapshot.request_digest, task_spec: snapshot.task_spec, mandate: snapshot.mandate, replay_binding_digest: replayBindingDigest(session, request, snapshot), consumed_at: nowMs, command: activation.command, grant: activation.grant, result: first });
    const calls = nonces.calls;

    await expect(service.approveInitial({ ...request, replay_nonce: "different-nonce-1234" }, session)).rejects.toMatchObject({ code: "activation_conflict" });
    expect(nonces.calls).toBe(calls);
    expect(nonces.records.size).toBe(1);
  });

  test("rejects stale displayed digests before nonce consumption", async () => {
    const { snapshot, request } = fixture();
    const nonces = new MemoryNonces();
    await expect(commandService(new HermesFake(snapshot), nonces).approveInitial({ ...request, proposed_mandate_digest: "f".repeat(64) } as CEOInitialApprovalRequestV1, session)).rejects.toMatchObject({ code: "activation_conflict" });
    expect(nonces.calls).toBe(0);
  });

  test("rejects an expired pending approval request before consuming or recording its nonce", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();
    const service = commandService(hermes, nonces, "2026-08-04T10:00:31.000Z");

    await expect(service.approveInitial(request, session)).rejects.toMatchObject({ code: "activation_expired" });
    expect(nonces.calls).toBe(0);
    expect(nonces.records.size).toBe(0);
    expect(hermes.activation).toBeNull();
  });

  test("resumes the identical activation after nonce consumption when command lookup is authoritative not-found", async () => {
    const { snapshot, request } = fixture();
    const nonces = new MemoryNonces();
    const binding = replayBindingDigest(session, request, snapshot);
    nonces.records.set(`${session.session_id}:${request.replay_nonce}`, { digest: binding, consumed_at: nowMs });
    const hermes = new HermesFake(snapshot);
    await commandService(hermes, nonces).approveInitial(request, session);
    expect(hermes.activation).not.toBeNull();
    expect(hermes.activation?.command.created_at).toBe(now);
  });
});
