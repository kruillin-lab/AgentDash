import { describe, expect, test, vi } from "vitest";

import { ActionOutcomeValues, ActivateMandateInputSchema, ActivationSnapshotV1Schema, DigestSchema, RouteEvidenceV1Schema, canonicalActivationQualificationDigest, canonicalDigest, canonicalizeActivationRoutes, type ActivateMandateInput, type ActivationSnapshotV1, type GetActivationQualificationResult } from "../../../lib/mission-control/contracts";
import { compileIntake, type CompileIntakeInput } from "../intake/compiler";
import type { CommandSessionV1 } from "../security/command-session";
import type { NonceConsumption, NonceReplayLookup, NonceStore } from "../security/nonce-store";
import { CEOCommandService, CEOInitialApprovalRequestV1Schema, type CEOInitialApprovalRequestV1 } from "./ceo-command";

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

function fixture(compilation_policy = policy()) {
  const compiled = compileIntake({
    request: { request_id: "123e4567-e89b-42d3-a456-426614174000", message: "Plan the release." },
    pm_output: { text: "A bounded proposal is ready.", session_ref: "pm-session-1", proposal: { schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-1", task_id: null, intent: "create_task", created_at: now } },
    compilation_policy, compilation_policy_digest: canonicalDigest(compilation_policy), activation: { kind: "approval_required" }, now,
  } as unknown as CompileIntakeInput);
  if (compiled.status !== "compiled" || compiled.mandate === null || compiled.readiness.kind !== "approval_required") throw new Error("fixture compilation failed");
  const parsedSnapshot = ActivationSnapshotV1Schema.parse({ status: "pending", snapshot_digest: canonicalDigest({ pending: compiled.artifact_digest }), request_digest: compiled.request_digest, task_spec: compiled.task_spec, mandate: compiled.mandate, approval_request: compiled.readiness.activation.request, readiness: compiled.readiness, budget_policy: compilation_policy.budget_policy });
  if (parsedSnapshot.status !== "pending") throw new Error("pending fixture failed");
  const snapshot = parsedSnapshot;
  const request = CEOInitialApprovalRequestV1Schema.parse({ task_id: compiled.task_id, replay_nonce: "nonce-1234567890", displayed_task_spec_revision: compiled.task_spec.plan_revision, displayed_task_spec_digest: canonicalDigest(compiled.task_spec), proposed_mandate_id: compiled.mandate.mandate_id, proposed_mandate_digest: canonicalDigest(compiled.mandate), decision_type: "initial_mandate_approval" });
  return { compiled, snapshot, request };
}

function routeEvidence(expires_at = "2026-08-20T00:00:00.000Z", route_id = "route-execute") {
  const safetyGates = ["authority_isolation", "workspace_containment", "identity_binding", "cancellation_reconciliation", "secret_handling", "prohibited_actions"];
  return RouteEvidenceV1Schema.parse({
    schema_version: "agentdash.route-evidence/v1" as const,
    route_proof_id: `proof-${route_id}`,
    route_id,
    task_class: "bounded_coding" as const,
    level: 5 as const,
    status: "active" as const,
    outer_harness: "codex",
    provider: "openai",
    model: "model-route-execute",
    agent_type: "worker",
    config_digest: canonicalDigest({ config: route_id }),
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
    safety_gate_results: safetyGates.map((gate) => ({ gate, passed: true, evidence_digest: canonicalDigest({ route_id, gate }) })),
    raw_receipt_digest: canonicalDigest({ receipt: route_id }),
    score_digest: canonicalDigest({ score: route_id }),
    environment_digest: canonicalDigest({ environment: route_id }),
    evidence_digest: canonicalDigest({ evidence: route_id }),
    evaluated_at: "2026-08-01T00:00:00.000Z",
    expires_at,
    revocation_reason: null,
    critical_failure: false,
    drift_detected: false,
  });
}

function routedFixture() {
  const compilationPolicy = structuredClone(policy()) as any;
  const route = routeEvidence();
  compilationPolicy.task_template.route_plan[0] = { ...compilationPolicy.task_template.route_plan[0], route_id: route.route_id, deterministic: false };
  compilationPolicy.mandate_template.action_nodes[0] = { ...compilationPolicy.mandate_template.action_nodes[0], executor_kind: "codeg_worker", route_id: route.route_id, route_proof_id: route.route_proof_id, route_proof_digest: route.evidence_digest };
  compilationPolicy.route_snapshot = [route];
  return fixture(compilationPolicy);
}

function twoRoutedFixture() {
  const compilationPolicy = structuredClone(policy()) as any;
  const routes = [routeEvidence(undefined, "route-execute"), routeEvidence(undefined, "route-fallback")];
  routes.forEach((route, index) => {
    compilationPolicy.task_template.route_plan[index] = { ...compilationPolicy.task_template.route_plan[index], route_id: route.route_id, deterministic: false };
    compilationPolicy.mandate_template.action_nodes[index] = { ...compilationPolicy.mandate_template.action_nodes[index], executor_kind: "codeg_worker", route_id: route.route_id, route_proof_id: route.route_proof_id, route_proof_digest: route.evidence_digest };
  });
  compilationPolicy.route_snapshot = routes;
  return fixture(compilationPolicy);
}

const session: CommandSessionV1 = { schema_version: "command_session_v1", session_id: "session-id-with-at-least-thirty-two-chars", csrf_digest: "d".repeat(64), issued_at: nowMs - 1_000, expires_at: nowMs + 50_000 };

class MemoryNonces implements NonceStore {
  readonly records = new Map<string, { digest: string; consumed_at: number }>();
  calls = 0;
  lookupCalls = 0;
  constructor(private readonly consumedAt = nowMs) {}
  async lookup(input: { session_id: string; nonce: string; expires_at: number; binding_digest: string }): Promise<NonceReplayLookup> {
    this.lookupCalls += 1;
    const record = this.records.get(`${input.session_id}:${input.nonce}`);
    if (!record) return { status: "missing" };
    return record.digest === input.binding_digest ? { status: "replayed_same", consumed_at: record.consumed_at } : { status: "replayed_conflict" };
  }
  async consume(input: { session_id: string; nonce: string; expires_at: number; binding_digest: string }): Promise<NonceConsumption> {
    this.calls += 1;
    const key = `${input.session_id}:${input.nonce}`;
    const record = this.records.get(key);
    if (!record) { this.records.set(key, { digest: input.binding_digest, consumed_at: this.consumedAt }); return { status: "consumed", consumed_at: this.consumedAt }; }
    return record.digest === input.binding_digest ? { status: "replayed_same", consumed_at: record.consumed_at } : { status: "replayed_conflict" };
  }
}

class HermesFake {
  snapshot: ActivationSnapshotV1;
  committedSnapshot: Extract<ActivationSnapshotV1, { status: "active" }> | null = null;
  activation: ActivateMandateInput | null = null;
  activationCalls = 0;
  activationLookupCalls = 0;
  qualificationCalls = 0;
  activationFailure = false;
  loseResponseAfterWrite = false;
  activationWrites = 0;
  routeRegistryRevision = 1;
  currentRoutes: ReturnType<typeof routeEvidence>[];
  qualificationStatus: "qualified" | "conflict" | "unavailable" = "qualified";
  beforeActivation: (() => void) | null = null;
  activationResponseOverride: ((input: ActivateMandateInput) => unknown) | null = null;
  activationLookupResponseOverride: ((commandId: string) => unknown | Promise<unknown>) | null = null;
  commitNow = nowMs;
  result: ReturnType<typeof this.activationResult> | null = null;
  constructor(snapshot: ActivationSnapshotV1) {
    this.snapshot = snapshot;
    this.currentRoutes = snapshot.status === "pending" ? structuredClone(snapshot.readiness.route_snapshot) as ReturnType<typeof routeEvidence>[] : [];
  }
  activationResult(input: ActivateMandateInput) { return { schema_version: "agentdash.activation-result/v1" as const, task_id: input.task_id, command_id: input.command.command_id, authority_id: input.grant.authority_id, task_spec_digest: input.task_spec_digest, mandate_digest: input.mandate_digest, source_snapshot_digest: input.qualification.source_snapshot_digest, qualification_digest: input.qualification.qualification_digest, activated_at: input.command.created_at }; }
  async getActivationSnapshot() { return this.snapshot; }
  async qualifyActivation(): Promise<GetActivationQualificationResult> {
    this.qualificationCalls += 1;
    if (this.qualificationStatus === "conflict") return { status: "conflict" as const };
    if (this.qualificationStatus === "unavailable") return { status: "unavailable" as const, reason: "registry unavailable" };
    return { status: "qualified" as const, route_registry_revision: this.routeRegistryRevision, routes: structuredClone(this.currentRoutes) };
  }
  async lookupActivationByCommand(command_id: string) {
    this.activationLookupCalls += 1;
    if (this.activationLookupResponseOverride) return await this.activationLookupResponseOverride(command_id) as any;
    return this.result?.command_id === command_id ? { status: "found" as const, result: this.result } : { status: "not_found" as const };
  }
  async activateMandate(input: ActivateMandateInput) {
    this.activationCalls += 1;
    if (this.activationFailure) throw new Error("simulated response loss");
    this.beforeActivation?.();
    if (!ActivateMandateInputSchema.safeParse(input).success) return { status: "conflict" as const };
    if (this.activationResponseOverride) return this.activationResponseOverride(input) as any;
    if (this.result) {
      return this.result.command_id === input.command.command_id && this.result.qualification_digest === input.qualification.qualification_digest
        ? { status: "existing" as const, ...this.result }
        : { status: "conflict" as const };
    }
    const pending = this.snapshot.status === "pending" ? this.snapshot : null;
    const currentRoutes = structuredClone(this.currentRoutes);
    const conflict = !pending
      || input.expected_snapshot_digest !== pending.snapshot_digest
      || input.request_digest !== pending.request_digest
      || input.task_id !== pending.mandate.task_id
      || input.task_spec_digest !== canonicalDigest(pending.task_spec)
      || input.mandate_digest !== canonicalDigest(pending.mandate)
      || canonicalDigest(input.source_approval_request) !== canonicalDigest(pending.approval_request)
      || input.qualification.route_registry_revision !== this.routeRegistryRevision
      || canonicalDigest(input.qualification.routes) !== canonicalDigest(canonicalizeActivationRoutes(currentRoutes))
      || canonicalDigest(input.qualification.routes) !== input.qualification.route_snapshot_digest
      || input.qualification.source_snapshot_digest !== pending.snapshot_digest
      || this.commitNow >= Date.parse(input.qualification.valid_until)
      || currentRoutes.some((route) => route.status !== "active" || Date.parse(route.expires_at) <= this.commitNow);
    if (conflict) return { status: "conflict" as const };
    this.activationWrites += 1;
    this.activation = structuredClone(input);
    this.result = structuredClone(input.result);
    this.committedSnapshot = activeSnapshotFromActivation(input);
    if (this.loseResponseAfterWrite) {
      this.loseResponseAfterWrite = false;
      throw new Error("simulated response loss after durable write");
    }
    return { status: "activated" as const, ...this.result };
  }
}

function commandService(hermes: HermesFake, nonces: MemoryNonces, at = now) {
  return new CEOCommandService({ hermes, nonces, now: () => new Date(at) });
}

function activeSnapshotFromActivation(activation: ActivateMandateInput): Extract<ActivationSnapshotV1, { status: "active" }> {
  const snapshot = ActivationSnapshotV1Schema.parse({
    status: "active",
    snapshot_digest: canonicalDigest({ active: activation.result }),
    source_snapshot_digest: activation.expected_snapshot_digest,
    request_digest: activation.request_digest,
    task_spec: activation.source_task_spec,
    mandate: activation.mandate,
    source_approval_request: activation.source_approval_request,
    qualification: activation.qualification,
    replay_binding_digest: activation.replay_binding_digest,
    consumed_at: activation.consumed_at,
    command: activation.command,
    grant: activation.grant,
    result: activation.result,
  });
  if (snapshot.status !== "active") throw new Error("active activation fixture failed");
  return snapshot;
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

  test("passes every byte required to persist an exact active replay through the atomic activation input", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();

    const first = await commandService(hermes, nonces).approveInitial(request, session);
    const durableSnapshot = ActivationSnapshotV1Schema.parse(structuredClone(hermes.committedSnapshot));
    hermes.snapshot = durableSnapshot;

    await expect(commandService(hermes, nonces).approveInitial(structuredClone(request), structuredClone(session))).resolves.toEqual(first);
    expect(hermes.activationCalls).toBe(1);
  });

  test("qualifies current server-owned route state before consuming activation authority", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();

    await commandService(hermes, nonces).approveInitial(request, session);

    expect(hermes.qualificationCalls).toBe(1);
    expect((hermes.activation as ActivateMandateInput & { qualification?: unknown })?.qualification).toMatchObject({
      source_snapshot_digest: snapshot.snapshot_digest,
      route_registry_revision: 1,
      routes: [],
    });
  });

  test("canonicalizes route identities with locale-invariant code-unit ordering", () => {
    const routes = ["route_z", "route-z", "route.A", "route-A"].map((routeId) => routeEvidence(undefined, routeId));

    expect(canonicalizeActivationRoutes(routes).map((route) => route.route_id)).toEqual([
      "route-A",
      "route-z",
      "route.A",
      "route_z",
    ]);
  });

  test.each(["revoked", "expired"] as const)("blocks a %s current route before nonce consumption", async (condition) => {
    const { snapshot, request } = routedFixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();
    if (condition === "revoked") {
      (hermes.currentRoutes[0] as any).status = "revoked";
      (hermes.currentRoutes[0] as any).revocation_reason = "revoked after card creation";
    } else {
      hermes.currentRoutes[0].expires_at = "2026-08-04T09:59:59.000Z";
    }

    await expect(commandService(hermes, nonces).approveInitial(request, session)).rejects.toMatchObject({ code: "activation_unavailable" });
    expect(nonces.calls).toBe(0);
    expect(hermes.activationWrites).toBe(0);
  });

  test.each([
    ["proof replacement", (hermes: HermesFake) => { hermes.currentRoutes[0].evidence_digest = canonicalDigest({ replaced: true }); }],
    ["route-registry ABA", (hermes: HermesFake) => { hermes.routeRegistryRevision += 2; }],
    ["qualification expiry before commit", (hermes: HermesFake) => { hermes.commitNow = Date.parse(hermes.currentRoutes[0].expires_at); }],
  ] as const)("atomically rejects %s after qualification with zero activation writes", async (_name, mutate) => {
    const { snapshot, request } = routedFixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();
    hermes.beforeActivation = () => mutate(hermes);

    await expect(commandService(hermes, nonces).approveInitial(request, session)).rejects.toMatchObject({ code: "activation_conflict" });
    expect(hermes.activationWrites).toBe(0);
  });

  test("modeled activation CAS rejects authority whose qualification outlives a current route", async () => {
    const { snapshot, request } = routedFixture();
    const producer = new HermesFake(snapshot);
    await commandService(producer, new MemoryNonces()).approveInitial(request, session);
    const input = structuredClone(producer.activation!);
    input.qualification.routes[0].expires_at = "2026-08-04T10:00:05.000Z";
    input.qualification.route_snapshot_digest = canonicalDigest(input.qualification.routes);
    input.qualification.qualification_digest = DigestSchema.parse(canonicalActivationQualificationDigest(input.qualification));
    input.command.qualification_digest = input.qualification.qualification_digest;
    input.grant.qualification_digest = input.qualification.qualification_digest;
    expect(ActivateMandateInputSchema.safeParse(input).success).toBe(false);

    const hermes = new HermesFake(snapshot);
    hermes.currentRoutes = structuredClone(input.qualification.routes);
    await expect(hermes.activateMandate(input)).resolves.toMatchObject({ status: "conflict" });
    expect(hermes.activationWrites).toBe(0);
  });

  test.each([
    ["unknown result status", (hermes: HermesFake) => {
      hermes.activationResponseOverride = (input) => ({ status: "bogus", ...hermes.activationResult(input) });
    }],
    ["drifted activation timestamp", (hermes: HermesFake) => {
      hermes.activationResponseOverride = (input) => ({ status: "activated", ...hermes.activationResult(input), activated_at: "2026-08-04T10:00:00.001Z" });
    }],
  ] as const)("fails closed on %s without accepting a result", async (_name, configure) => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    configure(hermes);

    await expect(commandService(hermes, new MemoryNonces()).approveInitial(request, session)).rejects.toMatchObject({ code: "activation_unavailable" });
    expect(hermes.activationWrites).toBe(0);
  });

  test("fails closed when coordinated current-route qualification is unavailable", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    hermes.qualificationStatus = "unavailable";
    const nonces = new MemoryNonces();

    await expect(commandService(hermes, nonces).approveInitial(request, session)).rejects.toMatchObject({ code: "activation_unavailable" });
    expect(nonces.calls).toBe(0);
    expect(hermes.activationWrites).toBe(0);
  });

  test("materializes one activation under concurrent identical approvals", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();
    const service = commandService(hermes, nonces);

    const [first, second] = await Promise.all([service.approveInitial(request, session), service.approveInitial(structuredClone(request), structuredClone(session))]);

    expect(second).toEqual(first);
    expect(hermes.activationWrites).toBe(1);
    expect(nonces.records.size).toBe(1);
  });

  test("reconstructs byte-identical command and grant after response loss", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();
    const service = commandService(hermes, nonces);
    const first = await service.approveInitial(request, session);
    const activation = structuredClone(hermes.activation!);
    hermes.snapshot = structuredClone(hermes.committedSnapshot!);

    await expect(commandService(hermes, nonces, "2026-08-04T10:00:31.000Z").approveInitial(structuredClone(request), structuredClone(session))).resolves.toEqual(first);
    expect(hermes.activation).toEqual(activation);
    expect(hermes.activationCalls).toBe(1);
    expect(nonces.records.size).toBe(1);
    expect(hermes.qualificationCalls).toBe(1);
  });

  test("requires replayed_same nonce state for an active exact-command replay", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const originalNonces = new MemoryNonces();
    await commandService(hermes, originalNonces).approveInitial(request, session);
    hermes.snapshot = structuredClone(hermes.committedSnapshot!);
    const recreatedWithoutRecord = new MemoryNonces();

    await expect(commandService(hermes, recreatedWithoutRecord, "2026-08-04T10:00:31.000Z").approveInitial(request, session)).rejects.toMatchObject({ code: "activation_conflict" });
    expect(hermes.activationCalls).toBe(1);
    expect(recreatedWithoutRecord.records.size).toBe(0);
  });

  test("rejects a different nonce against active state before creating a nonce record", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();
    const service = commandService(hermes, nonces);
    await service.approveInitial(request, session);
    hermes.snapshot = structuredClone(hermes.committedSnapshot!);
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

  test("validates a corrupt active authority tuple before read-only nonce lookup", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();
    await commandService(hermes, nonces).approveInitial(request, session);
    const active = structuredClone(hermes.committedSnapshot!);
    active.grant.approved_by = "another-session-with-at-least-16-chars";
    hermes.snapshot = active;
    const lookups = nonces.lookupCalls;

    await expect(commandService(hermes, nonces, "2026-08-04T10:00:31.000Z").approveInitial(request, session)).rejects.toMatchObject({ code: "activation_unavailable" });
    expect(nonces.lookupCalls).toBe(lookups);
    expect(nonces.records.size).toBe(1);
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

  test("rejects an expired pending mandate before nonce access", async () => {
    const { snapshot, request } = fixture();
    const hermes = new HermesFake(snapshot);
    const nonces = new MemoryNonces();

    await expect(commandService(hermes, nonces, "2026-08-04T10:01:01.000Z").approveInitial(request, session)).rejects.toMatchObject({ code: "activation_expired" });
    expect(nonces.calls).toBe(0);
    expect(hermes.activationWrites).toBe(0);
  });

  test("rejects a persisted nonce timestamp at either pending authority deadline", async () => {
    const { snapshot, request } = fixture();
    const nonces = new MemoryNonces(Date.parse(snapshot.approval_request.expires_at));
    const hermes = new HermesFake(snapshot);

    await expect(commandService(hermes, nonces).approveInitial(request, session)).rejects.toMatchObject({ code: "activation_expired" });
    expect(nonces.records.size).toBe(1);
    expect(hermes.activationWrites).toBe(0);
  });

  test("binds a crash retry to the exact source snapshot and canonical approval metadata", async () => {
    const { snapshot, request } = fixture();
    const nonces = new MemoryNonces();
    const hermes = new HermesFake(snapshot);
    hermes.activationFailure = true;
    await expect(commandService(hermes, nonces).approveInitial(request, session)).rejects.toThrow("simulated response loss");
    const changedExpiry = "2026-08-04T10:00:25.000Z";
    snapshot.approval_request.expires_at = changedExpiry;
    if (snapshot.readiness.kind !== "approval_required") throw new Error("approval fixture changed");
    snapshot.readiness.activation.request.expires_at = changedExpiry;
    snapshot.snapshot_digest = canonicalDigest({ changed_source: snapshot.snapshot_digest });
    hermes.snapshot = ActivationSnapshotV1Schema.parse(snapshot);
    hermes.activationFailure = false;

    await expect(commandService(hermes, nonces).approveInitial(request, session)).rejects.toMatchObject({ code: "replay_conflict" });
    expect(nonces.records.size).toBe(1);
    expect(hermes.activationWrites).toBe(0);
  });

  test("resumes the identical pending activation after nonce consumption and response loss", async () => {
    const { snapshot, request } = fixture();
    const nonces = new MemoryNonces();
    const hermes = new HermesFake(snapshot);
    hermes.activationFailure = true;
    await expect(commandService(hermes, nonces).approveInitial(request, session)).rejects.toThrow("simulated response loss");
    hermes.activationFailure = false;
    await commandService(hermes, nonces).approveInitial(request, session);
    expect(hermes.activation).not.toBeNull();
    expect(hermes.activation?.command.created_at).toBe(now);
  });

  test("treats reordered current route rows as the same qualified snapshot on retry", async () => {
    const { snapshot, request } = twoRoutedFixture();
    const nonces = new MemoryNonces();
    const hermes = new HermesFake(snapshot);
    hermes.activationFailure = true;
    await expect(commandService(hermes, nonces).approveInitial(request, session)).rejects.toThrow("simulated response loss");
    hermes.activationFailure = false;
    hermes.currentRoutes.reverse();

    await expect(commandService(hermes, nonces).approveInitial(request, session)).resolves.toMatchObject({ task_id: snapshot.mandate.task_id });
    expect(hermes.activationWrites).toBe(1);
    expect(nonces.records.size).toBe(1);
  });

  test("returns the authoritative stored result after committed response loss without a second activation", async () => {
    const { snapshot, request } = twoRoutedFixture();
    const nonces = new MemoryNonces();
    const hermes = new HermesFake(snapshot);
    hermes.loseResponseAfterWrite = true;
    await expect(commandService(hermes, nonces).approveInitial(request, session)).rejects.toThrow("simulated response loss after durable write");
    const materialized = structuredClone(hermes.result);
    hermes.currentRoutes.reverse();
    hermes.activationFailure = true;

    await expect(commandService(hermes, nonces).approveInitial(structuredClone(request), structuredClone(session))).resolves.toEqual(materialized);
    expect(hermes.activationWrites).toBe(1);
    expect(hermes.activationCalls).toBe(1);
    expect(hermes.activationLookupCalls).toBe(1);
    expect(hermes.qualificationCalls).toBe(2);
    expect(nonces.records.size).toBe(1);
  });

  test.each([
    ["malformed", () => ({ status: "found", result: {} })],
    ["unknown", () => ({ status: "unknown" })],
    ["unavailable", () => ({ status: "unavailable", reason: "store unavailable" })],
    ["thrown", () => { throw new Error("lookup failed"); }],
  ] as const)("fails closed on a %s authoritative replay lookup without a speculative activation", async (_name, lookupResult) => {
    const { snapshot, request } = fixture();
    const nonces = new MemoryNonces();
    const hermes = new HermesFake(snapshot);
    hermes.activationFailure = true;
    await expect(commandService(hermes, nonces).approveInitial(request, session)).rejects.toThrow("simulated response loss");
    hermes.activationFailure = false;
    hermes.activationLookupResponseOverride = lookupResult;
    const activationCalls = hermes.activationCalls;

    await expect(commandService(hermes, nonces).approveInitial(structuredClone(request), structuredClone(session))).rejects.toMatchObject({ code: "activation_unavailable" });
    expect(hermes.activationLookupCalls).toBe(1);
    expect(hermes.activationCalls).toBe(activationCalls);
    expect(hermes.activationWrites).toBe(0);
  });
});
