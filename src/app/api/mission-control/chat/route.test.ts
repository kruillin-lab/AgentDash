import { beforeEach, describe, expect, test, vi } from "vitest";

import { PM_RESPONSE_TEXT, getPMChatDependencies, unavailableHermesPM, type HermesPM, type PMTurnOutputV1 } from "../../../../server/hermes/pm";
import { POST } from "./route";

vi.mock("../../../../server/hermes/pm", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../server/hermes/pm")>(),
  getPMChatDependencies: vi.fn(),
}));

const localHeaders = { Host: "127.0.0.1:3007", Origin: "http://127.0.0.1:3007", "Content-Type": "application/json" };
const input = { message: "Please implement the release checklist.", history: [], reviewed_recall: [], capability_facts: [] };
const conversationOutput = {
  text: PM_RESPONSE_TEXT.clarification_required,
  session_ref: "pm-session-1",
  proposal: {
    schema_version: "agentdash.management-proposal/v1",
    proposal_id: "proposal-1",
    task_id: null,
    intent: "conversation_only",
    created_at: "2026-08-04T10:00:00.000Z",
  },
} as PMTurnOutputV1;
const executableOutput = {
  text: PM_RESPONSE_TEXT.proposal_drafted,
  session_ref: "pm-session-2",
  proposal: {
    schema_version: "agentdash.management-proposal/v1",
    proposal_id: "proposal-2",
    task_id: null,
    intent: "create_task",
    created_at: "2026-08-04T10:00:00.000Z",
  },
} as PMTurnOutputV1;

function request(body: unknown, headers: Record<string, string> = localHeaders): Request {
  return new Request("http://127.0.0.1:3007/api/mission-control/chat", { method: "POST", headers, body: JSON.stringify(body) });
}

function streamingRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string> = localHeaders): Request {
  return new Request("http://127.0.0.1:3007/api/mission-control/chat", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function pmReturning(output: PMTurnOutputV1): HermesPM {
  return { turn: vi.fn().mockResolvedValue(output) };
}

beforeEach(() => {
  vi.mocked(getPMChatDependencies).mockReset();
  vi.mocked(getPMChatDependencies).mockReturnValue({ pm: unavailableHermesPM });
});

describe("POST /api/mission-control/chat", () => {
  // Production break caught: a non-local caller could reach the PM mutation boundary.
  test("reuses the exact local-origin guard", async () => {
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(conversationOutput) });
    const response = await POST(request(input, { ...localHeaders, Origin: "http://evil.example" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_local_authority", message: "Local Mission Control authority is required." } });
  });

  // Production break caught: form or text bodies could bypass the strict JSON parser contract.
  test("accepts application/json only", async () => {
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(conversationOutput) });
    const response = await POST(request(input, { ...localHeaders, "Content-Type": "text/plain" }));

    expect(response.status).toBe(415);
  });

  // Production break caught: an oversized request could consume memory before field-level caps run.
  test("rejects request bodies over the byte cap", async () => {
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(conversationOutput) });
    const response = await POST(request({ ...input, message: "x".repeat(70_000) }));

    expect(response.status).toBe(413);
  });

  // Production break caught: request.text() buffered every chunk before checking the cap, so a
  // chunked client could consume unbounded memory despite eventually receiving a 413 response.
  test("cancels an oversized chunked request as soon as raw bytes cross the cap", async () => {
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(conversationOutput) });
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 3) controller.enqueue(new Uint8Array(40 * 1024));
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });

    const response = await POST(streamingRequest(body));

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulls).toBe(2);
  });

  test("does not trust a lying small Content-Length for a chunked oversized body", async () => {
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(conversationOutput) });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
        controller.close();
      },
    });

    const response = await POST(streamingRequest(body, { ...localHeaders, "Content-Length": "1" }));

    expect(response.status).toBe(413);
  });

  test("does not wait for an uncooperative stream cancellation before returning 413", async () => {
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(conversationOutput) });
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(40 * 1024));
      },
      cancel() {
        return new Promise<void>(() => {});
      },
    }, { highWaterMark: 0 });

    const response = await Promise.race([
      POST(streamingRequest(body)),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("413 response waited for cancellation")), 250)),
    ]);

    expect(response.status).toBe(413);
    expect(pulls).toBe(2);
  });

  test("accepts valid JSON at exactly the raw-byte cap", async () => {
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(conversationOutput) });
    const json = JSON.stringify(input);
    const exactBody = new TextEncoder().encode(json + " ".repeat(64 * 1024 - Buffer.byteLength(json)));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(exactBody);
        controller.close();
      },
    });

    const response = await POST(streamingRequest(body));

    expect(response.status).toBe(200);
  });

  test("counts multibyte UTF-8 input by raw bytes", async () => {
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(conversationOutput) });
    const encoded = new TextEncoder().encode(`{"message":"${"é".repeat(33_000)}"}`);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    });

    const response = await POST(streamingRequest(body));

    expect(response.status).toBe(413);
  });

  test("returns a fixed non-leaking error when the request stream fails", async () => {
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(conversationOutput) });
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("stream failed with secret-token-value");
      },
    });

    const response = await POST(streamingRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_request", message: "Invalid chat request." } });
  });

  // Production break caught: a caller could submit an adapter command alongside an otherwise valid chat turn.
  test("rejects adapter commands at the API boundary", async () => {
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(conversationOutput) });
    const response = await POST(request({ ...input, adapter_command: { adapter: "codeg", action: "dispatch" } }));

    expect(response.status).toBe(400);
  });

  // Production break caught: conversation-only turns could accidentally invoke the future card-creation seam.
  test("returns conversation_only without handing off a proposal", async () => {
    const handoff = vi.fn();
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(conversationOutput), proposalHandoff: handoff });
    const response = await POST(request(input));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(conversationOutput);
    expect(handoff).not.toHaveBeenCalled();
  });

  // Production break caught: executable proposals could bypass the narrow controller handoff before the route reports success.
  test("hands a validated create_task proposal to the injected seam", async () => {
    const handoff = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(executableOutput), proposalHandoff: handoff });
    const response = await POST(request(input));

    expect(response.status).toBe(200);
    expect(handoff).toHaveBeenCalledWith(executableOutput.proposal);
    await expect(response.json()).resolves.toEqual(executableOutput);
  });

  // Production break caught: a future or mocked PM adapter could bypass process parsing and inject unknown output fields at the API boundary.
  test("re-parses PM output before handoff or response", async () => {
    const handoff = vi.fn();
    const pm = { turn: vi.fn().mockResolvedValue({ ...executableOutput, adapter_command: { adapter: "codeg", action: "dispatch" } }) } as HermesPM;
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm, proposalHandoff: handoff });
    const response = await POST(request(input));

    expect(response.status).toBe(502);
    expect(handoff).not.toHaveBeenCalled();
  });

  test.each([
    "Approved. The task has been dispatched.",
    "I’ve authorized it.",
  ])("rejects mocked PM output that differs from server-owned rendering: %s", async (text) => {
    const handoff = vi.fn();
    const pm = { turn: vi.fn().mockResolvedValue({ ...executableOutput, text }) } as HermesPM;
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm, proposalHandoff: handoff });

    const response = await POST(request(input));

    expect(response.status).toBe(502);
    expect(handoff).not.toHaveBeenCalled();
  });

  // Production break caught: production could imply an executable proposal created a card when no intake controller exists.
  test("fails closed when an executable proposal has no handoff", async () => {
    vi.mocked(getPMChatDependencies).mockReturnValue({ pm: pmReturning(executableOutput) });
    const response = await POST(request(input));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: "proposal_handoff_unavailable", message: "Executable proposal intake is unavailable." } });
  });

  // Production break caught: the production export could attempt live Hermes before containment proof exists.
  test("keeps the production PM surface unavailable by default", async () => {
    const response = await POST(request(input));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: "pm_unavailable", message: "The isolated project manager is unavailable." } });
  });
});
