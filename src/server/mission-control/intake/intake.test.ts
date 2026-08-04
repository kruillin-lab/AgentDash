import { describe, expect, test, vi } from "vitest";

import { ActionOutcomeValues, CompilationPolicySnapshotV1Schema, DigestSchema, PersistIntakeInputSchema, RequestIdSchema, canonicalCardAuthorizationDigest, canonicalDigest, type IntakeReadinessV1, type PersistIntakeInput } from "../../../lib/mission-control/contracts";
import { IntakeAckV1Schema, type IntakeAckV1 } from "../../../lib/mission-control/intake-api";
import { PM_RESPONSE_TEXT, serializePMRenderEnvelope, type HermesPM, type PMTurnOutputV1 } from "../../hermes/pm";
import type { ServerIntakeContextPort } from "./context";
import type { AuthorizedIntakeArtifactV1, AuthorizeCardInput, CEOConversationPort, ReconcileCommittedCardInput } from "./conversation";
import { IntakeController } from "./intake";
import { canonicalIntakeArtifactDigestFromReadiness, canonicalizeCEOIntakeRequest, compileIntake, type CompileIntakeInput, type CompileIntakeResult } from "./compiler";

const now = "2026-08-04T10:00:00.000Z";
const request = { request_id: "123e4567-e89b-42d3-a456-426614174000", message: "Plan the release." };

function output(intent: "conversation_only" | "create_task", suffix = "1") {
  const proposal = { schema_version: "agentdash.management-proposal/v1" as const, proposal_id: `proposal-${suffix}`, task_id: null, intent, created_at: now };
  if (intent === "create_task") {
    return {
      envelope: { text: serializePMRenderEnvelope({ schema_version: "agentdash.pm-render-envelope/v1", response_code: "proposal_drafted", conversation_atoms: [], rendered_text: PM_RESPONSE_TEXT.proposal_drafted }), session_ref: `pm-session-${suffix}`, proposal },
      parsed: { text: PM_RESPONSE_TEXT.proposal_drafted, session_ref: `pm-session-${suffix}`, proposal },
    };
  }
  const text = `${PM_RESPONSE_TEXT.conversation_acknowledged} Focus: scope.`;
  return {
    envelope: { text: serializePMRenderEnvelope({ schema_version: "agentdash.pm-render-envelope/v1", response_code: "conversation_acknowledged", conversation_atoms: [{ kind: "planning_focus", focus: "scope" }], rendered_text: text }), session_ref: `pm-session-${suffix}`, proposal },
    parsed: { text, session_ref: `pm-session-${suffix}`, proposal },
  };
}

function compilationPolicy() {
  const patchDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [] });
  const manifestDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [], diff_bytes: 0, patch_digest: patchDigest });
  const acceptance_checks = ["The requested outcome is complete and verified."];
  const nodeIds = ["execute", "fallback", "remediate", "verify", "finalize"];
  const terminal = Object.fromEntries(ActionOutcomeValues.map((outcome) => [outcome, { kind: "terminal", outcome: outcome === "cancelled" ? "cancelled" : "failed" }]));
  const actionLimit = { max_cost_usd: 1, max_runtime_ms: 1_000, max_output_tokens: 100, max_provider_tokens: 200 };
  const reserve = { max_cost_usd: 1, max_runtime_ms: 500, max_attempts: 1, max_provider_tokens: 50 };
  const workspace = { project_id: "agentdash", mode: "isolated_worktree" as const, path: "C:/workspace/agentdash" };
  const aggregateBudget = { max_cost_usd: 9, max_runtime_ms: 7_000, max_attempts: 9, max_provider_tokens: 1_200 };
  return CompilationPolicySnapshotV1Schema.parse({
    schema_version: "agentdash.compilation-policy-snapshot/v1" as const,
    policy_version: "compiler-policy-v1",
    task_template: {
      acceptance_checks, constraints: ["Use only controller-approved operations."], prohibited_actions: ["No direct dispatch."], project_id: "agentdash", workspace,
      workspace_policy: { schema_version: "agentdash.workspace-policy/v1" as const, workspace, allowed_roots: ["C:/workspace"], require_isolated_worktree: true },
      required_capabilities: ["deterministic_planning"], budget: aggregateBudget,
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
        execute: { ...terminal, succeeded: { kind: "node", node_id: "fallback" } }, fallback: { ...terminal, succeeded: { kind: "node", node_id: "remediate" } },
        remediate: { ...terminal, succeeded: { kind: "node", node_id: "verify" } }, verify: { ...terminal, succeeded: { kind: "node", node_id: "finalize" } },
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
  });
}

type Claim = {
  request_id: string;
  request_digest: PersistIntakeInput["request_digest"];
  claim_id: string;
  generation: number;
  lease_expires_at: string;
  staged: PMTurnOutputV1 | null;
  artifact_digest: PersistIntakeInput["artifact_digest"] | null;
  authorized_artifact: AuthorizedIntakeArtifactV1 | null;
  card_committed: boolean;
  ack: IntakeAckV1 | null;
};

class ConversationFake implements CEOConversationPort {
  readonly claims = new Map<string, Claim>();
  history: Array<{ role: "user" | "assistant"; content: string }> = [];
  nowMs = Date.parse(now);
  completeFailureOnce = false;
  completeCalls = 0;
  authorizeCalls = 0;
  repairCalls = 0;
  readonly repairStatuses: Array<"created" | "existing" | "stale_generation" | "conflict"> = [];

  async claimTurn(input: Parameters<CEOConversationPort["claimTurn"]>[0]) {
    const current = this.claims.get(input.request_id);
    if (!current) {
      const claim = { request_id: input.request_id, request_digest: input.request_digest, claim_id: `claim-${input.request_id}`, generation: 1, lease_expires_at: new Date(this.nowMs + 1_000).toISOString(), staged: null, artifact_digest: null, authorized_artifact: null, card_committed: false, ack: null };
      this.claims.set(input.request_id, claim);
      return { status: "claimed" as const, request_digest: claim.request_digest, claim_id: claim.claim_id, claim_generation: 1, lease_expires_at: claim.lease_expires_at, mode: "initial_inference" as const };
    }
    if (current.request_digest !== input.request_digest) return { status: "conflict" as const };
    if (current.ack) return { status: "existing" as const, request_digest: current.request_digest, ack: current.ack, ack_digest: canonicalDigest(current.ack) };
    return { status: "pending" as const, request_digest: current.request_digest, claim_id: current.claim_id, observed_generation: current.generation, lease_expires_at: current.lease_expires_at, staged_pm: current.staged, staged_pm_digest: current.staged ? canonicalDigest(current.staged) : null, authorized_artifact: current.authorized_artifact };
  }

  async committedHistory() { return structuredClone(this.history); }

  async takeoverTurn(claim_id: string, observed_generation: number) {
    const claim = [...this.claims.values()].find((candidate) => candidate.claim_id === claim_id);
    if (!claim || claim.generation !== observed_generation || Date.parse(claim.lease_expires_at) > this.nowMs || claim.ack || claim.card_committed) return { status: "rejected" as const };
    claim.generation += 1;
    claim.lease_expires_at = new Date(this.nowMs + 1_000).toISOString();
    return claim.staged
      ? { status: "resume_staged" as const, request_digest: claim.request_digest, claim_id, claim_generation: claim.generation, lease_expires_at: claim.lease_expires_at, staged_pm: claim.staged, staged_pm_digest: canonicalDigest(claim.staged), authorized_artifact: claim.authorized_artifact }
      : { status: "retry_inference_after_uncertain_failure" as const, request_digest: claim.request_digest, claim_id, claim_generation: claim.generation, lease_expires_at: claim.lease_expires_at };
  }

  async stagePMResult(claim_id: string, claim_generation: number, request_digest: string, pm_output: PMTurnOutputV1) {
    const claim = [...this.claims.values()].find((candidate) => candidate.claim_id === claim_id);
    if (!claim || claim.request_digest !== request_digest) return { status: "conflict" as const };
    if (claim.generation !== claim_generation || claim.ack) return { status: "stale_generation" as const };
    if (claim.staged) return canonicalDigest(claim.staged) === canonicalDigest(pm_output) ? { status: "existing" as const, claim_id, claim_generation, request_digest: claim.request_digest, staged_pm_digest: canonicalDigest(claim.staged) } : { status: "conflict" as const };
    claim.staged = structuredClone(pm_output);
    return { status: "staged" as const, claim_id, claim_generation, request_digest: claim.request_digest, staged_pm_digest: canonicalDigest(pm_output) };
  }

  async authorizeCardPersistence(input: AuthorizeCardInput) {
    this.authorizeCalls += 1;
    const claim = [...this.claims.values()].find((candidate) => candidate.claim_id === input.claim_id);
    if (!claim) return { status: "conflict" as const };
    if (claim.generation !== input.claim_generation) return { status: "stale_generation" as const };
    if (!claim.staged
      || canonicalDigest(claim.staged) !== input.artifact.staged_pm_digest
      || claim.request_digest !== input.artifact.request_digest
      || claim.ack) return { status: "conflict" as const };
    if (claim.authorized_artifact
      && canonicalDigest(claim.authorized_artifact) !== canonicalDigest(input.artifact)) {
      return { status: "conflict" as const };
    }
    const status = claim.authorized_artifact ? "existing" as const : "authorized" as const;
    claim.authorized_artifact ??= structuredClone(input.artifact);
    claim.artifact_digest = claim.authorized_artifact.artifact_digest;
    const authorization = canonicalCardAuthorizationDigest({ claim_id: input.claim_id, claim_generation: input.claim_generation, ...claim.authorized_artifact });
    return { status, claim_id: input.claim_id, claim_generation: input.claim_generation, card_authorization_digest: authorization, authorized_artifact: structuredClone(claim.authorized_artifact) };
  }

  async reconcileCommittedCard(input: ReconcileCommittedCardInput) {
    this.repairCalls += 1;
    const claim = [...this.claims.values()].find((candidate) => candidate.claim_id === input.claim_id);
    if (!claim
      || claim.request_digest !== input.artifact.request_digest
      || input.ack.result.kind !== "card_existing"
      || input.ack.request_id !== claim.request_id
      || input.ack.result.task_id !== input.artifact.readiness.task_id
      || canonicalDigest(input.ack.pm) !== input.artifact.staged_pm_digest) {
      this.repairStatuses.push("conflict");
      return { status: "conflict" as const };
    }
    if (claim.generation !== input.claim_generation) {
      this.repairStatuses.push("stale_generation");
      return { status: "stale_generation" as const };
    }
    if (claim.staged && canonicalDigest(claim.staged) !== input.artifact.staged_pm_digest) {
      this.repairStatuses.push("conflict");
      return { status: "conflict" as const };
    }
    if (claim.authorized_artifact && canonicalDigest(claim.authorized_artifact) !== canonicalDigest(input.artifact)) {
      this.repairStatuses.push("conflict");
      return { status: "conflict" as const };
    }
    if (claim.ack) {
      const exactExisting = claim.staged !== null
        && claim.authorized_artifact !== null
        && claim.artifact_digest === input.artifact.artifact_digest
        && claim.card_committed
        && canonicalDigest(claim.staged) === input.artifact.staged_pm_digest
        && canonicalDigest(claim.authorized_artifact) === canonicalDigest(input.artifact)
        && canonicalDigest(claim.ack) === canonicalDigest(input.ack);
      this.repairStatuses.push(exactExisting ? "existing" : "conflict");
      return exactExisting
        ? { status: "existing" as const, claim_id: input.claim_id, claim_generation: input.claim_generation, artifact_digest: claim.artifact_digest!, authorized_artifact: structuredClone(claim.authorized_artifact!), ack: structuredClone(claim.ack), ack_digest: canonicalDigest(claim.ack) }
        : { status: "conflict" as const };
    }
    claim.staged ??= structuredClone(input.artifact.readiness.pm);
    claim.authorized_artifact ??= structuredClone(input.artifact);
    claim.artifact_digest = input.artifact.artifact_digest;
    claim.card_committed = true;
    claim.ack = structuredClone(input.ack);
    this.repairStatuses.push("created");
    return { status: "created" as const, claim_id: input.claim_id, claim_generation: input.claim_generation, artifact_digest: claim.artifact_digest, authorized_artifact: structuredClone(claim.authorized_artifact), ack: structuredClone(claim.ack), ack_digest: canonicalDigest(claim.ack) };
  }

  markCardCommitted(claim_id: string, claim_generation: number) {
    const claim = [...this.claims.values()].find((candidate) => candidate.claim_id === claim_id);
    if (!claim || claim.generation !== claim_generation || !claim.artifact_digest) throw new Error("card commit rejected");
    claim.card_committed = true;
  }

  async completeTurn(claim_id: string, claim_generation: number, ack: IntakeAckV1) {
    this.completeCalls += 1;
    const claim = [...this.claims.values()].find((candidate) => candidate.claim_id === claim_id);
    if (!claim || claim.generation !== claim_generation) return { status: "stale_generation" as const };
    if (claim.ack) return canonicalDigest(claim.ack) === canonicalDigest(ack) ? { status: "existing" as const, claim_id, claim_generation, ack: claim.ack, ack_digest: canonicalDigest(claim.ack) } : { status: "conflict" as const };
    const card = ack.result.kind === "card_created" || ack.result.kind === "card_existing";
    if (card && !claim.card_committed) return { status: "conflict" as const };
    if (!card && claim.artifact_digest) return { status: "conflict" as const };
    if (this.completeFailureOnce) { this.completeFailureOnce = false; return { status: "conflict" as const }; }
    claim.ack = structuredClone(ack);
    return { status: "created" as const, claim_id, claim_generation, ack: claim.ack, ack_digest: canonicalDigest(claim.ack) };
  }
}

class HermesFake {
  readonly cards = new Map<string, { request_digest: string; task_id: string; artifact_digest: string; readiness: IntakeReadinessV1 }>();
  readonly persistInputs: PersistIntakeInput[] = [];
  persistCalls = 0;
  persistWrites = 0;
  persistFailureOnce = false;
  afterLookup: (() => void) | null = null;
  constructor(private readonly conversation: ConversationFake) {}
  async lookupIntake(request_id: string) {
    const card = this.cards.get(request_id);
    this.afterLookup?.();
    return card ? { status: "found" as const, ...card } : { status: "not_found" as const };
  }
  async persistIntake(input: PersistIntakeInput) {
    this.persistCalls += 1;
    this.persistInputs.push(structuredClone(input));
    const parsed = PersistIntakeInputSchema.safeParse(input);
    if (!parsed.success || input.artifact_digest !== canonicalIntakeArtifactDigestFromReadiness(input.readiness)) return { status: "conflict" as const };
    const claim = [...this.conversation.claims.values()].find((candidate) => candidate.claim_id === input.claim_id);
    if (!claim) return { status: "conflict" as const };
    if (claim.generation !== input.claim_generation) return { status: "stale_generation" as const };
    const exactClaim = claim.request_id === input.request_id
      && claim.request_digest === input.request_digest
      && claim.staged !== null
      && canonicalDigest(claim.staged) === input.staged_pm_digest
      && claim.authorized_artifact !== null
      && canonicalDigest(claim.authorized_artifact) === canonicalDigest({ request_digest: input.request_digest, staged_pm_digest: input.staged_pm_digest, artifact_digest: input.artifact_digest, readiness: input.readiness })
      && claim.artifact_digest === input.artifact_digest
      && claim.ack === null
      && input.card_authorization_digest === canonicalCardAuthorizationDigest(input);
    if (!exactClaim) return { status: "conflict" as const };
    if (this.persistFailureOnce) {
      this.persistFailureOnce = false;
      throw new Error("simulated crash after authorization");
    }
    const existing = this.cards.get(input.request_id);
    if (existing) return existing.request_digest === input.request_digest
      && existing.artifact_digest === input.artifact_digest
      && canonicalDigest(existing.readiness) === canonicalDigest(input.readiness)
      ? { status: "existing" as const, ...existing }
      : { status: "conflict" as const };
    if (claim.card_committed) return { status: "conflict" as const };
    this.conversation.markCardCommitted(input.claim_id, input.claim_generation);
    const winner = { request_digest: input.request_digest, task_id: input.readiness.task_id, artifact_digest: input.artifact_digest, readiness: input.readiness };
    this.persistWrites += 1;
    this.cards.set(input.request_id, winner);
    return { status: "created" as const, ...winner };
  }
}

function context(history: Array<{ role: "user" | "assistant"; content: string }> = []): ServerIntakeContextPort {
  const policy = compilationPolicy();
  return { load: vi.fn().mockResolvedValue({ pm_context: { history, reviewed_recall: [], capability_facts: [], status_facts: [] }, compilation_policy: policy, compilation_policy_digest: canonicalDigest(policy), activation: { kind: "approval_required" } }) } as unknown as ServerIntakeContextPort;
}

function fakeCompiler(input: CompileIntakeInput): CompileIntakeResult {
  const policy = input.compilation_policy?.schema_version === "agentdash.compilation-policy-snapshot/v1"
    ? input.compilation_policy
    : compilationPolicy();
  return compileIntake({
    request: input.request,
    pm_output: input.pm_output,
    compilation_policy: policy,
    compilation_policy_digest: canonicalDigest(policy),
    activation: input.activation ?? { kind: "approval_required" },
    now: input.now ?? now,
  });
}

function controller(
  conversation: ConversationFake,
  pm: HermesPM,
  intakeContext = context(),
  compile: (input: CompileIntakeInput) => CompileIntakeResult = fakeCompiler,
) {
  const hermes = new HermesFake(conversation);
  return { hermes, intake: new IntakeController({ conversation, context: intakeContext, pm, hermes: hermes as unknown as ConstructorParameters<typeof IntakeController>[0]["hermes"], compile, now: () => new Date(conversation.nowMs) }) };
}

describe("IntakeController", () => {
  test("reconciles a matching durable card into a newly claimed turn before PM inference", async () => {
    const conversation = new ConversationFake();
    const pmOutput = output("create_task").parsed as PMTurnOutputV1;
    const compiled = fakeCompiler({ request, pm_output: pmOutput } as CompileIntakeInput);
    if (compiled.status !== "compiled") throw new Error("expected compiled fixture");
    const pm = { turn: vi.fn().mockResolvedValue(output("conversation_only").envelope) } as HermesPM;
    const { intake, hermes } = controller(conversation, pm);
    hermes.cards.set(request.request_id, {
      request_digest: compiled.request_digest,
      task_id: compiled.task_id,
      artifact_digest: compiled.artifact_digest,
      readiness: compiled.readiness,
    });

    await expect(intake.handle(request)).resolves.toMatchObject({ result: { kind: "card_existing", task_id: compiled.task_id } });
    expect(pm.turn).not.toHaveBeenCalled();
    expect(hermes.persistCalls).toBe(0);
    expect(conversation.repairCalls).toBe(1);
  });

  test("rejects a durable-card digest mismatch on a newly claimed turn before PM inference", async () => {
    const conversation = new ConversationFake();
    const compiled = fakeCompiler({ request, pm_output: output("create_task").parsed } as CompileIntakeInput);
    if (compiled.status !== "compiled") throw new Error("expected compiled fixture");
    const pm = { turn: vi.fn().mockResolvedValue(output("conversation_only").envelope) } as HermesPM;
    const { intake, hermes } = controller(conversation, pm);
    hermes.cards.set(request.request_id, {
      request_digest: "f".repeat(64),
      task_id: compiled.task_id,
      artifact_digest: compiled.artifact_digest,
      readiness: compiled.readiness,
    });

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "request_id_conflict" });
    expect(pm.turn).not.toHaveBeenCalled();
    expect(hermes.persistCalls).toBe(0);
    expect(conversation.repairCalls).toBe(0);
  });

  test.each([
    ["readiness request digest", (card: { request_digest: string; task_id: string; artifact_digest: string; readiness: IntakeReadinessV1 }) => ({ ...card, readiness: { ...card.readiness, request_digest: "f".repeat(64) } as IntakeReadinessV1 })],
    ["readiness artifact digest", (card: { request_digest: string; task_id: string; artifact_digest: string; readiness: IntakeReadinessV1 }) => ({ ...card, readiness: { ...card.readiness, artifact_digest: "f".repeat(64) } as IntakeReadinessV1 })],
    ["readiness request identity", (card: { request_digest: string; task_id: string; artifact_digest: string; readiness: IntakeReadinessV1 }) => ({ ...card, readiness: { ...card.readiness, task_spec: { ...card.readiness.task_spec, request_id: "123e4567-e89b-42d3-a456-426614174001" } } as IntakeReadinessV1 })],
    ["winner task identity", (card: { request_digest: string; task_id: string; artifact_digest: string; readiness: IntakeReadinessV1 }) => ({ ...card, task_id: "task-f" + "f".repeat(63) })],
  ])("returns request_id_conflict for a durable card with mismatched %s before inference", async (_name, mutate) => {
    const conversation = new ConversationFake();
    const compiled = fakeCompiler({ request, pm_output: output("create_task").parsed } as CompileIntakeInput);
    if (compiled.status !== "compiled") throw new Error("expected compiled fixture");
    const canonicalCard = { request_digest: compiled.request_digest, task_id: compiled.task_id, artifact_digest: compiled.artifact_digest, readiness: compiled.readiness };
    const pm = { turn: vi.fn() } as unknown as HermesPM;
    const intakeContext = context();
    const compile = vi.fn(fakeCompiler);
    const { intake, hermes } = controller(conversation, pm, intakeContext, compile);
    hermes.cards.set(request.request_id, mutate(canonicalCard));

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "request_id_conflict" });
    expect(conversation.repairCalls).toBe(0);
    expect(pm.turn).not.toHaveBeenCalled();
    expect(intakeContext.load).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
    expect(hermes.persistCalls).toBe(0);
  });

  test.each([
    ["task identity", (card: { request_digest: string; task_id: string; artifact_digest: string; readiness: IntakeReadinessV1 }) => {
      const wrongTaskId = "task-" + "f".repeat(64);
      return { ...card, task_id: wrongTaskId, readiness: { ...card.readiness, task_id: wrongTaskId } as IntakeReadinessV1 };
    }],
    ["artifact content and digest", (card: { request_digest: string; task_id: string; artifact_digest: string; readiness: IntakeReadinessV1 }) => {
      const wrongArtifactDigest = "f".repeat(64);
      return {
        ...card,
        artifact_digest: wrongArtifactDigest,
        readiness: {
          ...card.readiness,
          artifact_digest: wrongArtifactDigest,
          pm: { ...card.readiness.pm, session_ref: "pm-session-corrupted" },
        } as IntakeReadinessV1,
      };
    }],
  ])("rejects coupled durable-card %s corruption before inference", async (_name, mutate) => {
    const conversation = new ConversationFake();
    const compiled = fakeCompiler({ request, pm_output: output("create_task").parsed } as CompileIntakeInput);
    if (compiled.status !== "compiled") throw new Error("expected compiled fixture");
    const canonicalCard = { request_digest: compiled.request_digest, task_id: compiled.task_id, artifact_digest: compiled.artifact_digest, readiness: compiled.readiness };
    const pm = { turn: vi.fn() } as unknown as HermesPM;
    const intakeContext = context();
    const compile = vi.fn(fakeCompiler);
    const { intake, hermes } = controller(conversation, pm, intakeContext, compile);
    hermes.cards.set(request.request_id, mutate(canonicalCard));

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "request_id_conflict" });
    expect(conversation.repairCalls).toBe(0);
    expect(pm.turn).not.toHaveBeenCalled();
    expect(intakeContext.load).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
    expect(hermes.persistCalls).toBe(0);
  });

  test("linearizes concurrent identical durable-card repairs as one created and exact existing acknowledgement", async () => {
    const conversation = new ConversationFake();
    const compiled = fakeCompiler({ request, pm_output: output("create_task").parsed } as CompileIntakeInput);
    if (compiled.status !== "compiled") throw new Error("expected compiled fixture");
    const pm = { turn: vi.fn() } as unknown as HermesPM;
    const intakeContext = context();
    const compile = vi.fn(fakeCompiler);
    const { intake, hermes } = controller(conversation, pm, intakeContext, compile);
    hermes.cards.set(request.request_id, { request_digest: compiled.request_digest, task_id: compiled.task_id, artifact_digest: compiled.artifact_digest, readiness: compiled.readiness });

    const acknowledgements = await Promise.all([intake.handle(request), intake.handle(request)]);

    expect(acknowledgements[1]).toEqual(acknowledgements[0]);
    expect(conversation.repairStatuses).toEqual(["created", "existing"]);
    expect(pm.turn).not.toHaveBeenCalled();
    expect(intakeContext.load).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
    expect(hermes.persistCalls).toBe(0);
  });

  test("replays the exact repaired acknowledgement after response loss without another lookup repair or inference", async () => {
    const conversation = new ConversationFake();
    const compiled = fakeCompiler({ request, pm_output: output("create_task").parsed } as CompileIntakeInput);
    if (compiled.status !== "compiled") throw new Error("expected compiled fixture");
    const pm = { turn: vi.fn() } as unknown as HermesPM;
    const { intake, hermes } = controller(conversation, pm);
    hermes.cards.set(request.request_id, { request_digest: compiled.request_digest, task_id: compiled.task_id, artifact_digest: compiled.artifact_digest, readiness: compiled.readiness });

    const repaired = await intake.handle(request);
    const replayed = await intake.handle(request);

    expect(replayed).toEqual(repaired);
    expect(conversation.repairStatuses).toEqual(["created"]);
    expect(pm.turn).not.toHaveBeenCalled();
    expect(hermes.persistCalls).toBe(0);
  });

  test("returns no card acknowledgement when the repair CAS loses its generation fence", async () => {
    const conversation = new ConversationFake();
    const compiled = fakeCompiler({ request, pm_output: output("create_task").parsed } as CompileIntakeInput);
    if (compiled.status !== "compiled") throw new Error("expected compiled fixture");
    const pm = { turn: vi.fn() } as unknown as HermesPM;
    const intakeContext = context();
    const compile = vi.fn(fakeCompiler);
    const { intake, hermes } = controller(conversation, pm, intakeContext, compile);
    hermes.cards.set(request.request_id, { request_digest: compiled.request_digest, task_id: compiled.task_id, artifact_digest: compiled.artifact_digest, readiness: compiled.readiness });
    hermes.afterLookup = () => {
      hermes.afterLookup = null;
      const claim = conversation.claims.get(request.request_id);
      if (!claim) throw new Error("expected active claim");
      claim.generation += 1;
    };

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "intake_unavailable" });

    const claim = conversation.claims.get(request.request_id)!;
    expect(conversation.repairStatuses).toEqual(["stale_generation"]);
    expect(claim).toMatchObject({ generation: 2, staged: null, authorized_artifact: null, artifact_digest: null, card_committed: false, ack: null });
    expect(pm.turn).not.toHaveBeenCalled();
    expect(intakeContext.load).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
    expect(hermes.persistCalls).toBe(0);
  });

  test("does not heal a partial committed claim while reconciling a durable card", async () => {
    const conversation = new ConversationFake();
    const compiled = fakeCompiler({ request, pm_output: output("create_task").parsed } as CompileIntakeInput);
    if (compiled.status !== "compiled") throw new Error("expected compiled fixture");
    const partialAck = IntakeAckV1Schema.parse({
      schema_version: "agentdash.intake-ack/v1" as const,
      request_id: request.request_id,
      pm: compiled.readiness.pm,
      result: { kind: "card_existing" as const, task_id: compiled.task_id, readiness: { kind: "approval_required" as const, reasons: [], decision_type: "initial_mandate_approval" as const } },
      board_refresh: true,
      select_task_id: compiled.task_id,
    });
    const pm = { turn: vi.fn() } as unknown as HermesPM;
    const { intake, hermes } = controller(conversation, pm);
    hermes.cards.set(request.request_id, { request_digest: compiled.request_digest, task_id: compiled.task_id, artifact_digest: compiled.artifact_digest, readiness: compiled.readiness });
    hermes.afterLookup = () => {
      hermes.afterLookup = null;
      const claim = conversation.claims.get(request.request_id);
      if (!claim) throw new Error("expected active claim");
      claim.ack = structuredClone(partialAck);
    };

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "request_id_conflict" });

    const claim = conversation.claims.get(request.request_id)!;
    expect(conversation.repairStatuses).toEqual(["conflict"]);
    expect(claim).toMatchObject({ staged: null, authorized_artifact: null, artifact_digest: null, card_committed: false, ack: partialAck });
    expect(pm.turn).not.toHaveBeenCalled();
    expect(hermes.persistCalls).toBe(0);
  });

  test("serializes eight concurrent same-request callers before inference and replays one canonical outcome", async () => {
    const conversation = new ConversationFake();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const divergent = [output("conversation_only", "1").envelope, output("create_task", "2").envelope];
    const pm = { turn: vi.fn(async () => { await gate; return divergent.shift()!; }) } as unknown as HermesPM;
    const { intake } = controller(conversation, pm);

    const calls = Array.from({ length: 8 }, () => intake.handle(request));
    const settlement = Promise.allSettled(calls);
    await vi.waitFor(() => expect(pm.turn).toHaveBeenCalledTimes(1));
    release();
    const results = await settlement;

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected" && (result.reason as { code?: string }).code === "intake_pending")).toHaveLength(7);
    expect(pm.turn).toHaveBeenCalledTimes(1);
    await expect(intake.handle(request)).resolves.toEqual((results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<IntakeAckV1>).value);
    expect(pm.turn).toHaveBeenCalledTimes(1);
  });

  test("rejects request-id digest conflicts without inference", async () => {
    const conversation = new ConversationFake();
    const pm = { turn: vi.fn().mockResolvedValue(output("conversation_only").envelope) } as HermesPM;
    const { intake } = controller(conversation, pm);
    await intake.handle(request);

    await expect(intake.handle({ ...request, message: "Different request." })).rejects.toMatchObject({ code: "request_id_conflict" });
    expect(pm.turn).toHaveBeenCalledTimes(1);
  });

  test("uses only committed server history and replays conversation-only response loss without inference", async () => {
    const conversation = new ConversationFake();
    conversation.history = [{ role: "user", content: "Earlier committed question." }, { role: "assistant", content: "Earlier committed answer." }];
    const pm = { turn: vi.fn().mockResolvedValue(output("conversation_only").envelope) } as HermesPM;
    const intakeContext = context(conversation.history);
    const { intake } = controller(conversation, pm, intakeContext);
    const first = await intake.handle(request);
    const replay = await intake.handle(request);

    expect(replay).toEqual(first);
    expect(pm.turn).toHaveBeenCalledTimes(1);
    expect(pm.turn).toHaveBeenCalledWith(expect.objectContaining({ history: conversation.history }), expect.anything());
  });

  test("returns intake_pending for a live holder and resumes a staged output after fenced takeover", async () => {
    const conversation = new ConversationFake();
    const identity = canonicalizeCEOIntakeRequest(request);
    const staged = output("conversation_only").parsed as PMTurnOutputV1;
    conversation.claims.set(request.request_id, { request_id: request.request_id, request_digest: identity.request_digest, claim_id: "claim-staged", generation: 1, lease_expires_at: new Date(conversation.nowMs + 1_000).toISOString(), staged, artifact_digest: null, authorized_artifact: null, card_committed: false, ack: null });
    const pm = { turn: vi.fn() } as unknown as HermesPM;
    const { intake } = controller(conversation, pm);

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "intake_pending" });
    conversation.nowMs += 1_001;
    await expect(intake.handle(request)).resolves.toMatchObject({ result: { kind: "conversation_only" } });
    expect(pm.turn).not.toHaveBeenCalled();
  });

  test.each([
    ["typed compiler fault", false],
    ["thrown compiler fault", true],
  ])("does not lifetime-complete a clarification for a %s and succeeds after repair", async (_name, throws) => {
    const conversation = new ConversationFake();
    const pm = { turn: vi.fn().mockResolvedValue(output("create_task").envelope) } as HermesPM;
    let failed = false;
    const compile = vi.fn((input: CompileIntakeInput): CompileIntakeResult => {
      if (!failed) {
        failed = true;
        if (throws) throw new Error("compiler dependency unavailable");
        return { status: "intake_unavailable", reasons: [{ code: "compiler_fault", message: "The compiler is temporarily unavailable." }] };
      }
      return fakeCompiler(input);
    });
    const { intake, hermes } = controller(conversation, pm, context(), compile);

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "intake_unavailable" });
    expect(conversation.claims.get(request.request_id)).toMatchObject({
      staged: output("create_task").parsed,
      artifact_digest: null,
      authorized_artifact: null,
      card_committed: false,
      ack: null,
    });

    conversation.nowMs += 1_001;
    await expect(intake.handle(request)).resolves.toMatchObject({ result: { kind: "card_created" } });
    expect(pm.turn).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(2);
    expect(hermes.persistCalls).toBe(1);
    expect(conversation.claims.get(request.request_id)?.ack?.result.kind).toBe("card_created");
  });

  test("does not complete a clarification for malformed server policy and succeeds after policy repair", async () => {
    const conversation = new ConversationFake();
    const pm = { turn: vi.fn().mockResolvedValue(output("create_task").envelope) } as HermesPM;
    const invalidPolicy = structuredClone(compilationPolicy());
    invalidPolicy.task_template.workspace_policy.workspace.path = "C:/workspace/other";
    const repairedPolicy = compilationPolicy();
    const load = vi.fn()
      .mockResolvedValueOnce({ pm_context: { history: [], reviewed_recall: [], capability_facts: [], status_facts: [] }, compilation_policy: invalidPolicy, compilation_policy_digest: canonicalDigest(invalidPolicy), activation: { kind: "approval_required" } })
      .mockResolvedValueOnce({ pm_context: { history: [], reviewed_recall: [], capability_facts: [], status_facts: [] }, compilation_policy: repairedPolicy, compilation_policy_digest: canonicalDigest(repairedPolicy), activation: { kind: "approval_required" } });
    const intakeContext = { load } as unknown as ServerIntakeContextPort;
    const { intake, hermes } = controller(conversation, pm, intakeContext, compileIntake);

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "intake_unavailable" });
    expect(conversation.completeCalls).toBe(0);
    expect(conversation.claims.get(request.request_id)).toMatchObject({ staged: output("create_task").parsed, ack: null, authorized_artifact: null, card_committed: false });
    expect(hermes.cards.size).toBe(0);

    conversation.nowMs += 1_001;
    await expect(intake.handle(request)).resolves.toMatchObject({ result: { kind: "card_created" } });
    expect(load).toHaveBeenCalledTimes(2);
    expect(pm.turn).toHaveBeenCalledTimes(1);
    expect(conversation.completeCalls).toBe(1);
    expect(conversation.claims.get(request.request_id)?.ack?.result.kind).toBe("card_created");
  });

  test("lifetime-completes an actual TaskSpec clarification and replays it exactly", async () => {
    const conversation = new ConversationFake();
    const pm = { turn: vi.fn().mockResolvedValue(output("create_task").envelope) } as HermesPM;
    const compile = vi.fn((): CompileIntakeResult => ({
      status: "clarification_required",
      reasons: [{ code: "invalid_task_spec", message: "Clarify the requested task." }],
    }));
    const { intake, hermes } = controller(conversation, pm, context(), compile);

    const first = await intake.handle(request);
    const replay = await intake.handle(request);

    expect(first).toMatchObject({ result: { kind: "clarification_required", reasons: [{ code: "invalid_task_spec" }] } });
    expect(replay).toEqual(first);
    expect(pm.turn).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(hermes.persistCalls).toBe(0);
  });

  test("repairs a card-persist/claim-complete split without duplicate persistence or inference", async () => {
    const conversation = new ConversationFake();
    conversation.completeFailureOnce = true;
    const pm = { turn: vi.fn().mockResolvedValue(output("create_task").envelope) } as HermesPM;
    const { intake, hermes } = controller(conversation, pm);

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "intake_unavailable" });
    await expect(intake.handle(request)).resolves.toMatchObject({ result: { kind: "card_existing" } });
    expect(pm.turn).toHaveBeenCalledTimes(1);
    expect(hermes.persistCalls).toBe(1);
  });

  test("replays the authorized artifact after a persistence crash without recompiling from drifted context or time", async () => {
    const conversation = new ConversationFake();
    const compiled: Array<Extract<CompileIntakeResult, { status: "compiled" }>> = [];
    const compile = vi.fn((input: CompileIntakeInput): CompileIntakeResult => {
      const candidate = fakeCompiler(input);
      if (candidate.status !== "compiled") return candidate;
      const readiness = {
        ...candidate.readiness,
        compilation_policy_digest: canonicalDigest({ original: candidate.readiness.compilation_policy_digest, now: input.now }),
      } as IntakeReadinessV1;
      const artifact_digest = canonicalIntakeArtifactDigestFromReadiness(readiness);
      readiness.artifact_digest = artifact_digest as IntakeReadinessV1["artifact_digest"];
      const drifted = {
        ...candidate,
        artifact_digest,
        readiness,
      };
      compiled.push(structuredClone(drifted));
      return drifted;
    });
    const pm = { turn: vi.fn().mockResolvedValue(output("create_task").envelope) } as HermesPM;
    const intakeContext = context();
    const { intake, hermes } = controller(conversation, pm, intakeContext, compile);
    hermes.persistFailureOnce = true;

    await expect(intake.handle(request)).rejects.toThrow("simulated crash after authorization");
    conversation.nowMs += 1_001;
    await expect(intake.handle(request)).resolves.toMatchObject({ result: { kind: "card_created" } });

    expect(pm.turn).toHaveBeenCalledTimes(1);
    expect(intakeContext.load).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(hermes.persistInputs.map((input) => input.claim_generation)).toEqual([1, 2]);
    expect(hermes.persistInputs[1].card_authorization_digest).not.toBe(hermes.persistInputs[0].card_authorization_digest);
    expect(hermes.persistInputs[1].artifact_digest).toBe(hermes.persistInputs[0].artifact_digest);
    expect(hermes.persistInputs[1].readiness).toEqual(hermes.persistInputs[0].readiness);
    expect(hermes.cards.get(request.request_id)).toMatchObject({
      artifact_digest: compiled[0].artifact_digest,
      readiness: compiled[0].readiness,
    });
  });

  test.each([
    ["claim identity", (input: any) => { input.claim_id = "claim-other"; }],
    ["claim generation", (input: any) => { input.claim_generation += 1; input.card_authorization_digest = canonicalCardAuthorizationDigest(input); }],
    ["request identity", (input: any) => { input.request_id = "123e4567-e89b-42d3-a456-426614174001"; }],
    ["request digest", (input: any) => { input.request_digest = "b".repeat(64); input.card_authorization_digest = canonicalCardAuthorizationDigest(input); }],
    ["staged PM digest", (input: any) => { input.staged_pm_digest = "b".repeat(64); input.card_authorization_digest = canonicalCardAuthorizationDigest(input); }],
    ["card authorization", (input: any) => { input.card_authorization_digest = "b".repeat(64); }],
    ["artifact digest", (input: any) => { input.artifact_digest = "b".repeat(64); input.readiness.artifact_digest = input.artifact_digest; input.card_authorization_digest = canonicalCardAuthorizationDigest(input); }],
    ["sealed readiness", (input: any) => {
      input.readiness.compilation_policy_digest = "b".repeat(64);
      input.artifact_digest = canonicalIntakeArtifactDigestFromReadiness(input.readiness);
      input.readiness.artifact_digest = input.artifact_digest;
      input.card_authorization_digest = canonicalCardAuthorizationDigest(input);
    }],
    ["conversation completion", (_input: any, claim: Claim) => {
      claim.ack = IntakeAckV1Schema.parse({
        schema_version: "agentdash.intake-ack/v1",
        request_id: claim.request_id,
        pm: claim.staged,
        result: { kind: "clarification_required", reasons: [{ code: "already_completed", message: "The conversation already completed." }] },
        board_refresh: false,
        select_task_id: null,
      });
    }],
  ])("atomic card persistence rejects mismatched %s with zero writes", async (_name, mutate) => {
    const conversation = new ConversationFake();
    const pm = { turn: vi.fn().mockResolvedValue(output("create_task").envelope) } as HermesPM;
    const { intake, hermes } = controller(conversation, pm);
    hermes.persistFailureOnce = true;
    await expect(intake.handle(request)).rejects.toThrow("simulated crash after authorization");
    const input = structuredClone(hermes.persistInputs[0]);
    const claim = conversation.claims.get(request.request_id)!;
    mutate(input, claim);

    await expect(hermes.persistIntake(input)).resolves.toMatchObject({ status: expect.stringMatching(/conflict|stale_generation/) });
    expect(hermes.persistWrites).toBe(0);
    expect(hermes.cards.size).toBe(0);
    expect(claim.card_committed).toBe(false);
  });

  test("rejects a corrupted sealed authorized artifact on takeover before reauthorization or persistence", async () => {
    const conversation = new ConversationFake();
    const pm = { turn: vi.fn().mockResolvedValue(output("create_task").envelope) } as HermesPM;
    const compile = vi.fn(fakeCompiler);
    const { intake, hermes } = controller(conversation, pm, context(), compile);
    hermes.persistFailureOnce = true;
    await expect(intake.handle(request)).rejects.toThrow("simulated crash after authorization");
    const claim = conversation.claims.get(request.request_id)!;
    const artifact = claim.authorized_artifact!;
    artifact.readiness.compilation_policy_digest = "b".repeat(64) as typeof artifact.readiness.compilation_policy_digest;
    artifact.artifact_digest = "c".repeat(64) as typeof artifact.artifact_digest;
    artifact.readiness.artifact_digest = artifact.artifact_digest;

    conversation.nowMs += 1_001;
    await expect(intake.handle(request)).rejects.toMatchObject({ code: "intake_unavailable" });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(hermes.persistCalls).toBe(1);
    expect(hermes.persistWrites).toBe(0);
    expect(hermes.cards.size).toBe(0);
  });

  test.each([
    ["wrong claim identity", (result: any) => ({ ...result, claim_id: "claim-other" })],
    ["non-advancing generation", (result: any, observedGeneration: number) => ({ ...result, claim_generation: observedGeneration })],
  ])("rejects takeover with %s before reauthorization or persistence", async (_name, mutate) => {
    const conversation = new ConversationFake();
    const pm = { turn: vi.fn().mockResolvedValue(output("create_task").envelope) } as HermesPM;
    const { intake, hermes } = controller(conversation, pm);
    hermes.persistFailureOnce = true;
    await expect(intake.handle(request)).rejects.toThrow("simulated crash after authorization");
    const originalTakeover = conversation.takeoverTurn.bind(conversation);
    (conversation as any).takeoverTurn = vi.fn(async (claimId: string, observedGeneration: number) => {
      const result = await originalTakeover(claimId, observedGeneration);
      return result.status === "rejected" ? result : mutate(result, observedGeneration);
    });

    conversation.nowMs += 1_001;
    await expect(intake.handle(request)).rejects.toMatchObject({ code: "intake_unavailable" });
    expect(conversation.authorizeCalls).toBe(1);
    expect(conversation.completeCalls).toBe(0);
    expect(hermes.persistCalls).toBe(1);
    expect(hermes.persistWrites).toBe(0);
    expect(hermes.cards.size).toBe(0);
  });

  test.each([
    ["claim identity", (result: any) => ({ ...result, claim_id: "claim-other" })],
    ["claim generation", (result: any) => ({ ...result, claim_generation: result.claim_generation + 1 })],
    ["request digest", (result: any) => ({ ...result, request_digest: "b".repeat(64) })],
  ])("rejects staged PM CAS evidence with mismatched %s", async (_name, mutate) => {
    const conversation = new ConversationFake();
    const originalStage = conversation.stagePMResult.bind(conversation);
    (conversation as any).stagePMResult = vi.fn(async (...args: Parameters<ConversationFake["stagePMResult"]>) => {
      const result = await originalStage(...args);
      return result.status === "staged" || result.status === "existing" ? mutate(result) : result;
    });
    const pm = { turn: vi.fn().mockResolvedValue(output("conversation_only").envelope) } as HermesPM;
    const { intake, hermes } = controller(conversation, pm);

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "intake_unavailable" });
    expect(conversation.authorizeCalls).toBe(0);
    expect(conversation.completeCalls).toBe(0);
    expect(hermes.persistCalls).toBe(0);
    expect(hermes.cards.size).toBe(0);
  });

  test.each([
    ["claim identity", (claimId: string, claimGeneration: number) => ({ claim_id: `${claimId}-other`, claim_generation: claimGeneration })],
    ["claim generation", (claimId: string, claimGeneration: number) => ({ claim_id: claimId, claim_generation: claimGeneration + 1 })],
  ])("rejects completion CAS evidence with mismatched %s", async (_name, resultBinding) => {
    const conversation = new ConversationFake();
    (conversation as any).completeTurn = vi.fn(async (claimId: string, claimGeneration: number, ack: IntakeAckV1) => ({ status: "created", ...resultBinding(claimId, claimGeneration), ack, ack_digest: canonicalDigest(ack) }));
    const pm = { turn: vi.fn().mockResolvedValue(output("conversation_only").envelope) } as HermesPM;
    const { intake, hermes } = controller(conversation, pm);

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "intake_unavailable" });
    expect(conversation.claims.get(request.request_id)?.ack).toBeNull();
    expect(hermes.persistCalls).toBe(0);
    expect(hermes.cards.size).toBe(0);
  });

  test.each(["request_id", "request_digest"] as const)("rejects an existing acknowledgement bound to a different %s", async (field) => {
    const conversation = new ConversationFake();
    const pm = { turn: vi.fn().mockResolvedValue(output("conversation_only").envelope) } as HermesPM;
    const { intake } = controller(conversation, pm);
    await intake.handle(request);
    const claim = conversation.claims.get(request.request_id)!;
    if (field === "request_id") {
      claim.ack = { ...claim.ack!, request_id: "123e4567-e89b-42d3-a456-426614174001" };
    } else {
      claim.request_digest = DigestSchema.parse("b".repeat(64));
    }

    await expect(intake.handle(request)).rejects.toMatchObject({ code: "request_id_conflict" });
    expect(pm.turn).toHaveBeenCalledTimes(1);
  });

  test("rejects stale generations from staging, authorization, and completion", async () => {
    const conversation = new ConversationFake();
    const identity = canonicalizeCEOIntakeRequest(request);
    const claim = await conversation.claimTurn({ request_id: RequestIdSchema.parse(request.request_id), request_digest: identity.request_digest });
    if (claim.status !== "claimed") throw new Error("expected claim");
    const staged = output("conversation_only").parsed as PMTurnOutputV1;
    conversation.nowMs += 1_001;
    await conversation.takeoverTurn(claim.claim_id, claim.claim_generation);

    await expect(conversation.stagePMResult(claim.claim_id, 1, identity.request_digest, staged)).resolves.toMatchObject({ status: "stale_generation" });
    await expect(conversation.authorizeCardPersistence({ claim_id: claim.claim_id, claim_generation: 1, artifact: {} as never })).resolves.toMatchObject({ status: "stale_generation" });
    await expect(conversation.completeTurn(claim.claim_id, 1, {} as IntakeAckV1)).resolves.toMatchObject({ status: "stale_generation" });
  });
});
