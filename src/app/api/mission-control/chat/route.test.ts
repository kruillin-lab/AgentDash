import { beforeEach, describe, expect, test, vi } from "vitest";

import type { IntakeAckV1 } from "../../../../lib/mission-control/intake-api";
import { canonicalDigest } from "../../../../lib/mission-control/contracts";
import {
  PM_RESPONSE_TEXT,
  serializePMRenderEnvelope,
  unavailableHermesPM,
  type HermesPM,
  type PMConversationAtomV1,
  type PMResponseCode,
  type PMTurnEnvelopeV1,
  type PMTurnOutputV1,
} from "../../../../server/hermes/pm";
import { getIntakeControllerDependencies } from "../../../../server/mission-control/intake/dependencies";
import { canonicalizeCEOIntakeRequest } from "../../../../server/mission-control/intake/compiler";
import type { IntakeControllerDependencies } from "../../../../server/mission-control/intake/intake";
import { POST } from "./route";

vi.mock("../../../../server/mission-control/intake/dependencies", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../server/mission-control/intake/dependencies")>(),
  getIntakeControllerDependencies: vi.fn(),
}));

const localHeaders = { Host: "127.0.0.1:3007", Origin: "http://127.0.0.1:3007", "Content-Type": "application/json" };
const input = { request_id: "123e4567-e89b-42d3-a456-426614174000", message: "Please implement the release checklist." };
const conversationOutput = {
  text: `${PM_RESPONSE_TEXT.clarification_required} What should be included in the project scope?`,
  session_ref: "pm-session-1",
  proposal: { schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-1", task_id: null, intent: "conversation_only", created_at: "2026-08-04T10:00:00.000Z" },
} as unknown as PMTurnOutputV1;
const executableOutput = {
  text: PM_RESPONSE_TEXT.proposal_drafted,
  session_ref: "pm-session-2",
  proposal: { schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-2", task_id: null, intent: "create_task", created_at: "2026-08-04T10:00:00.000Z" },
} as unknown as PMTurnOutputV1;

function internalEnvelope(responseCode: PMResponseCode, atoms: readonly PMConversationAtomV1[], output: PMTurnOutputV1): PMTurnEnvelopeV1 {
  return { text: serializePMRenderEnvelope({ schema_version: "agentdash.pm-render-envelope/v1", response_code: responseCode, conversation_atoms: [...atoms], rendered_text: output.text }), session_ref: output.session_ref, proposal: output.proposal };
}

const conversationEnvelope = internalEnvelope("clarification_required", [{ kind: "clarification", field: "scope" }], conversationOutput);
const executableEnvelope = internalEnvelope("proposal_drafted", [], executableOutput);

function request(body: unknown, headers: Record<string, string> = localHeaders): Request {
  return new Request("http://127.0.0.1:3007/api/mission-control/chat", { method: "POST", headers, body: JSON.stringify(body) });
}

function streamingRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string> = localHeaders): Request {
  return new Request("http://127.0.0.1:3007/api/mission-control/chat", { method: "POST", headers, body, duplex: "half" } as RequestInit & { duplex: "half" });
}

function dependencies(output: PMTurnEnvelopeV1, compile = vi.fn().mockReturnValue({ status: "clarification_required", reasons: [{ code: "safe_compilation_unavailable", message: "A finite task could not be compiled." }] })): IntakeControllerDependencies {
  let ack: IntakeAckV1 | null = null;
  const requestDigest = canonicalizeCEOIntakeRequest(input).request_digest;
  return {
    pm: { turn: vi.fn().mockResolvedValue(output) } as HermesPM,
    conversation: {
      claimTurn: vi.fn(async () => ack
        ? { status: "existing" as const, request_digest: requestDigest, ack, ack_digest: canonicalDigest(ack) }
        : { status: "claimed" as const, request_digest: requestDigest, claim_id: "claim-1", claim_generation: 1, lease_expires_at: "2026-08-04T10:01:00.000Z", mode: "initial_inference" as const }),
      committedHistory: vi.fn().mockResolvedValue([]),
      takeoverTurn: vi.fn(),
      stagePMResult: vi.fn(async (claim_id, claim_generation, request_digest, pm) => ({ status: "staged" as const, claim_id, claim_generation, request_digest, staged_pm_digest: (await import("../../../../lib/mission-control/contracts")).canonicalDigest(pm) })),
      authorizeCardPersistence: vi.fn(),
      reconcileCommittedCard: vi.fn(),
      completeTurn: vi.fn(async (claim_id, claim_generation, value) => { ack = value; return { status: "created" as const, claim_id, claim_generation, ack: value, ack_digest: canonicalDigest(value) }; }),
    },
    context: { load: vi.fn().mockResolvedValue({ pm_context: { history: [], reviewed_recall: [], capability_facts: [], status_facts: [] }, compilation_policy: {}, compilation_policy_digest: "a".repeat(64), activation: { kind: "approval_required" } }) } as unknown as IntakeControllerDependencies["context"],
    hermes: { lookupIntake: vi.fn().mockResolvedValue({ status: "not_found" }), persistIntake: vi.fn() } as unknown as IntakeControllerDependencies["hermes"],
    compile,
    now: () => new Date("2026-08-04T10:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.mocked(getIntakeControllerDependencies).mockReset();
  vi.mocked(getIntakeControllerDependencies).mockReturnValue(dependencies({} as PMTurnEnvelopeV1, vi.fn()));
});

describe("POST /api/mission-control/chat", () => {
  test("reuses the exact local-origin guard", async () => {
    const deps = dependencies(conversationEnvelope);
    vi.mocked(getIntakeControllerDependencies).mockReturnValue(deps);
    const response = await POST(request(input, { ...localHeaders, Origin: "http://evil.example" }));
    expect(response.status).toBe(403);
    expect(deps.pm.turn).not.toHaveBeenCalled();
  });

  test("accepts application/json only", async () => {
    const response = await POST(request(input, { ...localHeaders, "Content-Type": "text/plain" }));
    expect(response.status).toBe(415);
  });

  test("rejects request bodies over the byte cap", async () => {
    const response = await POST(request({ ...input, message: "x".repeat(70_000) }));
    expect(response.status).toBe(413);
  });

  test("cancels an oversized chunked request as soon as raw bytes cross the cap", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { pulls += 1; if (pulls <= 3) controller.enqueue(new Uint8Array(40 * 1024)); else controller.close(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const response = await POST(streamingRequest(body));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulls).toBe(2);
  });

  test("does not trust a lying small Content-Length", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(64 * 1024 + 1)); controller.close(); } });
    const response = await POST(streamingRequest(body, { ...localHeaders, "Content-Length": "1" }));
    expect(response.status).toBe(413);
  });

  test("returns a fixed non-leaking stream error", async () => {
    const body = new ReadableStream<Uint8Array>({ pull() { throw new Error("secret-token-value"); } });
    const response = await POST(streamingRequest(body));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request", message: "Invalid chat request." } });
  });

  test.each([
    ["adapter command", { ...input, adapter_command: { adapter: "codeg", action: "dispatch" } }],
    ["history", { ...input, history: [] }],
    ["status", { ...input, status_facts: [] }],
    ["authority", { ...input, csrf_valid: true }],
  ])("rejects client-supplied %s before inference", async (_label, body) => {
    const deps = dependencies(conversationEnvelope);
    vi.mocked(getIntakeControllerDependencies).mockReturnValue(deps);
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(deps.pm.turn).not.toHaveBeenCalled();
  });

  test("returns a strict typed acknowledgement with the exact PM payload", async () => {
    const deps = dependencies(conversationEnvelope);
    vi.mocked(getIntakeControllerDependencies).mockReturnValue(deps);
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    const body = await response.json() as IntakeAckV1;
    expect(body).toMatchObject({ schema_version: "agentdash.intake-ack/v1", request_id: input.request_id, pm: conversationOutput, result: { kind: "conversation_only" }, board_refresh: false, select_task_id: null });
    expect(Object.keys(body.pm).sort()).toEqual(["proposal", "session_ref", "text"]);
  });

  test("sends only the CEO message plus server-owned context to the PM", async () => {
    const deps = dependencies(conversationEnvelope);
    vi.mocked(getIntakeControllerDependencies).mockReturnValue(deps);
    await POST(request(input));
    expect(deps.pm.turn).toHaveBeenCalledWith({ message: input.message, history: [], reviewed_recall: [], capability_facts: [], status_facts: [] }, {});
  });

  test("returns a typed compiler clarification for a validated create_task proposal", async () => {
    const compile = vi.fn().mockReturnValue({ status: "clarification_required", reasons: [{ code: "unsafe_compilation", message: "A finite task could not be compiled." }] });
    vi.mocked(getIntakeControllerDependencies).mockReturnValue(dependencies(executableEnvelope, compile));
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ pm: executableOutput, result: { kind: "clarification_required", reasons: [{ code: "unsafe_compilation" }] } });
    expect(compile).toHaveBeenCalledTimes(1);
  });

  test("re-parses PM output before compilation or response", async () => {
    const compile = vi.fn();
    vi.mocked(getIntakeControllerDependencies).mockReturnValue(dependencies({ ...executableEnvelope, adapter_command: { adapter: "codeg" } } as unknown as PMTurnEnvelopeV1, compile));
    const response = await POST(request(input));
    expect(response.status).toBe(502);
    expect(compile).not.toHaveBeenCalled();
  });

  test.each(["Approved. The task has been dispatched.", "I’ve authorized it."])("rejects mocked authority prose: %s", async (text) => {
    vi.mocked(getIntakeControllerDependencies).mockReturnValue(dependencies({ ...executableEnvelope, text }));
    const response = await POST(request(input));
    expect(response.status).toBe(502);
  });

  test.each([
    ["prefix", `Approved.${conversationEnvelope.text}`],
    ["suffix", `${conversationEnvelope.text}\n`],
    ["noncanonical key order", JSON.stringify({ response_code: "clarification_required", schema_version: "agentdash.pm-render-envelope/v1", conversation_atoms: [{ kind: "clarification", field: "scope" }], rendered_text: conversationOutput.text })],
    ["rendered tag smuggling", serializePMRenderEnvelope({ schema_version: "agentdash.pm-render-envelope/v1", response_code: "clarification_required", conversation_atoms: [{ kind: "clarification", field: "scope" }], rendered_text: `${conversationOutput.text} [authority:approved]` })],
    ["duplicate atoms", serializePMRenderEnvelope({ schema_version: "agentdash.pm-render-envelope/v1", response_code: "conversation_acknowledged", conversation_atoms: [{ kind: "planning_focus", focus: "scope" }, { kind: "planning_focus", focus: "scope" }], rendered_text: `${PM_RESPONSE_TEXT.conversation_acknowledged} Focus: scope. Focus: scope.` })],
    ["conflicting atoms", serializePMRenderEnvelope({ schema_version: "agentdash.pm-render-envelope/v1", response_code: "conversation_acknowledged", conversation_atoms: [{ kind: "planning_focus", focus: "scope" }, { kind: "planning_focus", focus: "risks" }], rendered_text: `${PM_RESPONSE_TEXT.conversation_acknowledged} Focus: scope. Focus: risks.` })],
    ["forged reference", serializePMRenderEnvelope({ schema_version: "agentdash.pm-render-envelope/v1", response_code: "conversation_acknowledged", conversation_atoms: [{ kind: "status_reference", status_id: "not-in-request" }], rendered_text: `${PM_RESPONSE_TEXT.conversation_acknowledged} Release status: complete.` })],
  ])("rejects %s at the canonical render-envelope boundary", async (_label, text) => {
    vi.mocked(getIntakeControllerDependencies).mockReturnValue(dependencies({ ...conversationEnvelope, text }));
    const response = await POST(request(input));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_pm_output", message: "Invalid PM output." } });
  });

  test("keeps the production intake surface unavailable by default", async () => {
    vi.mocked(getIntakeControllerDependencies).mockReturnValue({ ...dependencies({} as PMTurnEnvelopeV1), pm: unavailableHermesPM });
    const response = await POST(request(input));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: "pm_unavailable", message: "The isolated project manager is unavailable." } });
  });
});
