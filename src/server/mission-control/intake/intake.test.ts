import { describe, expect, test, vi } from "vitest";

import { canonicalDigest, type IntakeReadinessV1 } from "../../../lib/mission-control/contracts";
import { IntakeAckV1Schema, type IntakeAckV1 } from "../../../lib/mission-control/intake-api";
import { PM_RESPONSE_TEXT, serializePMRenderEnvelope, type HermesPM, type PMTurnOutputV1 } from "../../hermes/pm";
import type { ServerIntakeContextPort } from "./context";
import type { AuthorizedIntakeArtifactV1, AuthorizeCardInput, CEOConversationPort, ReconcileCommittedCardInput } from "./conversation";
import { IntakeController } from "./intake";
import { canonicalIntakeArtifactDigestFromReadiness, canonicalizeCEOIntakeRequest, type CompileIntakeInput, type CompileIntakeResult } from "./compiler";

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

type Claim = {
  request_id: string;
  request_digest: string;
  claim_id: string;
  generation: number;
  lease_expires_at: string;
  staged: PMTurnOutputV1 | null;
  artifact_digest: string | null;
  authorized_artifact: AuthorizedIntakeArtifactV1 | null;
  card_committed: boolean;
  ack: IntakeAckV1 | null;
};

class ConversationFake implements CEOConversationPort {
  readonly claims = new Map<string, Claim>();
  history: Array<{ role: "user" | "assistant"; content: string }> = [];
  nowMs = Date.parse(now);
  completeFailureOnce = false;
  repairCalls = 0;
  readonly repairStatuses: Array<"created" | "existing" | "stale_generation" | "conflict"> = [];

  async claimTurn(input: { request_id: string; request_digest: string }) {
    const current = this.claims.get(input.request_id);
    if (!current) {
      const claim = { request_id: input.request_id, request_digest: input.request_digest, claim_id: `claim-${input.request_id}`, generation: 1, lease_expires_at: new Date(this.nowMs + 1_000).toISOString(), staged: null, artifact_digest: null, authorized_artifact: null, card_committed: false, ack: null };
      this.claims.set(input.request_id, claim);
      return { status: "claimed" as const, claim_id: claim.claim_id, claim_generation: 1, lease_expires_at: claim.lease_expires_at, mode: "initial_inference" as const };
    }
    if (current.request_digest !== input.request_digest) return { status: "conflict" as const };
    if (current.ack) return { status: "existing" as const, ack: current.ack };
    return { status: "pending" as const, claim_id: current.claim_id, observed_generation: current.generation, lease_expires_at: current.lease_expires_at, staged_pm: current.staged, authorized_artifact: current.authorized_artifact };
  }

  async committedHistory() { return structuredClone(this.history); }

  async takeoverTurn(claim_id: string, observed_generation: number) {
    const claim = [...this.claims.values()].find((candidate) => candidate.claim_id === claim_id);
    if (!claim || claim.generation !== observed_generation || Date.parse(claim.lease_expires_at) > this.nowMs || claim.ack || claim.card_committed) return { status: "rejected" as const };
    claim.generation += 1;
    claim.lease_expires_at = new Date(this.nowMs + 1_000).toISOString();
    return claim.staged
      ? { status: "resume_staged" as const, claim_id, claim_generation: claim.generation, lease_expires_at: claim.lease_expires_at, staged_pm: claim.staged, authorized_artifact: claim.authorized_artifact }
      : { status: "retry_inference_after_uncertain_failure" as const, claim_id, claim_generation: claim.generation, lease_expires_at: claim.lease_expires_at };
  }

  async stagePMResult(claim_id: string, claim_generation: number, request_digest: string, pm_output: PMTurnOutputV1) {
    const claim = [...this.claims.values()].find((candidate) => candidate.claim_id === claim_id);
    if (!claim || claim.request_digest !== request_digest) return { status: "conflict" as const };
    if (claim.generation !== claim_generation || claim.ack) return { status: "stale_generation" as const };
    if (claim.staged) return canonicalDigest(claim.staged) === canonicalDigest(pm_output) ? { status: "existing" as const, staged_pm_digest: canonicalDigest(claim.staged) } : { status: "conflict" as const };
    claim.staged = structuredClone(pm_output);
    return { status: "staged" as const, staged_pm_digest: canonicalDigest(pm_output) };
  }

  async authorizeCardPersistence(input: AuthorizeCardInput) {
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
    const authorization = canonicalDigest({
      claim_id: input.claim_id,
      claim_generation: input.claim_generation,
      authorized_artifact_digest: canonicalDigest(claim.authorized_artifact),
    });
    return { status, card_authorization_digest: authorization, authorized_artifact: structuredClone(claim.authorized_artifact) };
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
        ? { status: "existing" as const, authorized_artifact: structuredClone(claim.authorized_artifact!), ack: structuredClone(claim.ack) }
        : { status: "conflict" as const };
    }
    claim.staged ??= structuredClone(input.artifact.readiness.pm);
    claim.authorized_artifact ??= structuredClone(input.artifact);
    claim.artifact_digest = input.artifact.artifact_digest;
    claim.card_committed = true;
    claim.ack = structuredClone(input.ack);
    this.repairStatuses.push("created");
    return { status: "created" as const, authorized_artifact: structuredClone(claim.authorized_artifact), ack: structuredClone(claim.ack) };
  }

  markCardCommitted(claim_id: string, claim_generation: number) {
    const claim = [...this.claims.values()].find((candidate) => candidate.claim_id === claim_id);
    if (!claim || claim.generation !== claim_generation || !claim.artifact_digest) throw new Error("card commit rejected");
    claim.card_committed = true;
  }

  async completeTurn(claim_id: string, claim_generation: number, ack: IntakeAckV1) {
    const claim = [...this.claims.values()].find((candidate) => candidate.claim_id === claim_id);
    if (!claim || claim.generation !== claim_generation) return { status: "stale_generation" as const };
    if (claim.ack) return canonicalDigest(claim.ack) === canonicalDigest(ack) ? { status: "existing" as const, ack: claim.ack } : { status: "conflict" as const };
    const card = ack.result.kind === "card_created" || ack.result.kind === "card_existing";
    if (card && !claim.card_committed) return { status: "conflict" as const };
    if (!card && claim.artifact_digest) return { status: "conflict" as const };
    if (this.completeFailureOnce) { this.completeFailureOnce = false; return { status: "conflict" as const }; }
    claim.ack = structuredClone(ack);
    return { status: "created" as const, ack: claim.ack };
  }
}

class HermesFake {
  readonly cards = new Map<string, { request_digest: string; task_id: string; artifact_digest: string; readiness: IntakeReadinessV1 }>();
  readonly persistInputs: Array<{ claim_generation: number; card_authorization_digest: string; artifact_digest: string; readiness: IntakeReadinessV1 }> = [];
  persistCalls = 0;
  persistFailureOnce = false;
  afterLookup: (() => void) | null = null;
  constructor(private readonly conversation: ConversationFake) {}
  async lookupIntake(request_id: string) {
    const card = this.cards.get(request_id);
    this.afterLookup?.();
    return card ? { status: "found" as const, ...card } : { status: "not_found" as const };
  }
  async persistIntake(input: { request_id: string; request_digest: string; claim_id: string; claim_generation: number; card_authorization_digest: string; artifact_digest: string; readiness: IntakeReadinessV1 }) {
    this.persistCalls += 1;
    this.persistInputs.push(structuredClone(input));
    if (this.persistFailureOnce) {
      this.persistFailureOnce = false;
      throw new Error("simulated crash after authorization");
    }
    const existing = this.cards.get(input.request_id);
    if (existing) return existing.request_digest === input.request_digest ? { status: "existing" as const, ...existing } : { status: "conflict" as const };
    this.conversation.markCardCommitted(input.claim_id, input.claim_generation);
    const winner = { request_digest: input.request_digest, task_id: input.readiness.task_id, artifact_digest: input.artifact_digest, readiness: input.readiness };
    this.cards.set(input.request_id, winner);
    return { status: "created" as const, ...winner };
  }
}

function context(history: Array<{ role: "user" | "assistant"; content: string }> = []): ServerIntakeContextPort {
  return { load: vi.fn().mockResolvedValue({ pm_context: { history, reviewed_recall: [], capability_facts: [], status_facts: [] }, compilation_policy: {}, compilation_policy_digest: "a".repeat(64), activation: { kind: "approval_required" } }) } as unknown as ServerIntakeContextPort;
}

function fakeCompiler(input: CompileIntakeInput): CompileIntakeResult {
  const identity = canonicalizeCEOIntakeRequest(input.request);
  const readiness = {
    schema_version: "agentdash.intake-readiness/v1",
    kind: "approval_required",
    task_id: identity.task_id,
    request_digest: identity.request_digest,
    artifact_digest: "0".repeat(64),
    pm: input.pm_output,
    proposal_digest: canonicalDigest(input.pm_output.proposal),
    compilation_policy_digest: "a".repeat(64),
    budget_policy_digest: "b".repeat(64),
    task_spec: { request_id: input.request.request_id },
    mandate: {},
    route_snapshot: [],
    no_start: { schema_version: "agentdash.no-start-report/v1", ready: true, reasons: [] },
    activation: { kind: "approval_required", request: {} },
  } as unknown as IntakeReadinessV1;
  const artifact_digest = canonicalIntakeArtifactDigestFromReadiness(readiness);
  readiness.artifact_digest = artifact_digest as IntakeReadinessV1["artifact_digest"];
  return { status: "compiled", normalized_message: identity.normalized_message, request_digest: identity.request_digest, task_id: identity.task_id, task_spec: {} as never, mandate: {} as never, readiness, artifact_digest };
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
      const artifact_digest = canonicalDigest({ original: candidate.artifact_digest, now: input.now });
      const drifted = {
        ...candidate,
        artifact_digest,
        readiness: { ...candidate.readiness, artifact_digest } as IntakeReadinessV1,
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

  test("rejects stale generations from staging, authorization, and completion", async () => {
    const conversation = new ConversationFake();
    const identity = canonicalizeCEOIntakeRequest(request);
    const claim = await conversation.claimTurn({ request_id: request.request_id, request_digest: identity.request_digest });
    if (claim.status !== "claimed") throw new Error("expected claim");
    const staged = output("conversation_only").parsed as PMTurnOutputV1;
    conversation.nowMs += 1_001;
    await conversation.takeoverTurn(claim.claim_id, claim.claim_generation);

    await expect(conversation.stagePMResult(claim.claim_id, 1, identity.request_digest, staged)).resolves.toMatchObject({ status: "stale_generation" });
    await expect(conversation.authorizeCardPersistence({ claim_id: claim.claim_id, claim_generation: 1, artifact: {} as never })).resolves.toMatchObject({ status: "stale_generation" });
    await expect(conversation.completeTurn(claim.claim_id, 1, {} as IntakeAckV1)).resolves.toMatchObject({ status: "stale_generation" });
  });
});
