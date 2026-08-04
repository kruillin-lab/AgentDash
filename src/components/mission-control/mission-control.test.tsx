// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import {
  MissionControlCardPayloadV1Schema,
  MissionControlServedBoardV1Schema,
  type MissionControlServedBoardV1,
} from "../../lib/mission-control/board-view";

let MissionControlShell: (typeof import("./MissionControlShell"))["MissionControlShell"];

beforeAll(async () => {
  Object.assign(globalThis, { React });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  ({ MissionControlShell } = await import("./MissionControlShell"));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const digest = "b".repeat(64);
const card = (task_id: string, title: string, detail: string, attempt: string | null = null) => MissionControlCardPayloadV1Schema.parse({
  redacted: true as const,
  digest,
  summary: JSON.stringify({ schema_version: "agentdash.mission-control-card-view/v1", task_id, title, detail, attempt }),
});

const board: MissionControlServedBoardV1 = MissionControlServedBoardV1Schema.parse({
  generated_at: "2026-08-04T10:00:00.000Z",
  unavailable_reason: null,
  archived_count: 0,
  lanes: {
    ready: [card("ready-task", "Prepare release", "Ready to dispatch")],
    working: [card("working-task", "Build dashboard", "Agent is implementing", "Attempt 2")],
    needs_you: [card("needs-you-task", "Choose target", "Choose target environment")],
    stopped: [card("stopped-task", "Repair bridge", "Hermes bridge is unavailable")],
    completed: [card("completed-task", "Archive report", "Checks passed", "Attempt 3")],
  },
});

describe("MissionControlShell", () => {
  test("shows the five projections and an enabled proposal-only conversation", () => {
    render(<MissionControlShell board={board} />);

    expect(screen.getByRole("region", { name: "Ready" }).textContent).toContain("Prepare release");
    expect(screen.getByRole("region", { name: "Working" }).textContent).toContain("Build dashboard");
    expect(screen.getByRole("region", { name: "Needs you" }).textContent).toContain("Choose target environment");
    expect(screen.getByRole("region", { name: "Stopped" }).textContent).toContain("Repair bridge");
    expect(screen.getByRole("region", { name: "Completed" }).textContent).toContain("Archive report");
    expect(screen.getByRole("textbox", { name: "PM conversation" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  });

  test("updates the labelled inspector from keyboard card selection", async () => {
    const user = userEvent.setup();
    render(<MissionControlShell board={board} />);

    const target = screen.getByRole("button", { name: /Build dashboard/i });
    target.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("region", { name: "Selected attempt" }).textContent).toContain("Build dashboard");
    expect(screen.getByRole("region", { name: "Selected attempt" }).textContent).toContain("Attempt 2");
    expect(target.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);

    const nextTarget = screen.getByRole("button", { name: /Prepare release/i });
    await user.click(nextTarget);

    expect(target.getAttribute("aria-pressed")).toBe("false");
    expect(nextTarget.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  test("rejects duplicate task identities before two cards can share selection state", () => {
    const duplicateBoard = {
      ...board,
      lanes: {
        ...board.lanes,
        ready: [card("same-task", "First card", "First projection")],
        working: [card("same-task", "Second card", "Second projection")],
      },
    };

    expect(() => MissionControlServedBoardV1Schema.parse(duplicateBoard)).toThrow(/unique/i);
  });

  test("uses a responsive stacked layout without hiding board information", () => {
    render(<MissionControlShell board={board} />);

    expect(screen.getByTestId("mission-control-layout").className).toContain("xl:grid-cols-[minmax(12rem,0.75fr)_minmax(0,1.5fr)_minmax(14rem,0.8fr)]");
  });

  test("shows an honest empty state when the production bridge is unavailable", () => {
    render(<MissionControlShell board={{ ...board, unavailable_reason: "Hermes board bridge is not configured.", lanes: { ready: [], working: [], needs_you: [], stopped: [], completed: [] } }} />);

    expect(screen.getByText("Hermes board bridge is not configured.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Prepare release/i })).toBeNull();
  });

  test("freezes one request envelope across failure and Retry, then clears it only after an acknowledgement", async () => {
    const user = userEvent.setup();
    const requestId = "123e4567-e89b-42d3-a456-426614174000";
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schema_version: "agentdash.intake-ack/v1",
        request_id: requestId,
        pm: {
          text: "What outcome should define success?",
          session_ref: "pm-session-1",
          proposal: {
            schema_version: "agentdash.management-proposal/v1",
            proposal_id: "proposal-1",
            task_id: null,
            intent: "conversation_only",
            created_at: "2026-08-04T10:00:00.000Z",
          },
        },
        result: { kind: "conversation_only" },
        board_refresh: false,
        select_task_id: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<MissionControlShell board={board} />);

    const composer = screen.getByRole("textbox", { name: "PM conversation" });
    await user.type(composer, "Plan the release.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("button", { name: "Retry" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("What outcome should define success?");

    const sentBodies = fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)) as unknown);
    expect(sentBodies).toEqual([
      { request_id: requestId, message: "Plan the release." },
      { request_id: requestId, message: "Plan the release." },
    ]);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe(""));
  });

  test("refreshes the board once and selects only the exact acknowledged card", async () => {
    const user = userEvent.setup();
    const requestId = "123e4567-e89b-42d3-a456-426614174000";
    const taskId = `task-${"a".repeat(64)}`;
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    const refreshed = MissionControlServedBoardV1Schema.parse({ ...board, lanes: { ...board.lanes, needs_you: [...board.lanes.needs_you, card(taskId, "New mandate", "Approval required")] } });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ schema_version: "agentdash.intake-ack/v1", request_id: requestId, pm: { text: "A bounded proposal is ready.", session_ref: "pm-session-card", proposal: { schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-card", task_id: null, intent: "create_task", created_at: "2026-08-04T10:00:00.000Z" } }, result: { kind: "card_created", task_id: taskId, readiness: { kind: "approval_required", reasons: [], decision_type: "initial_mandate_approval" } }, board_refresh: true, select_task_id: taskId }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ board: refreshed, unavailable_reason: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<MissionControlShell board={board} />);

    await user.type(screen.getByRole("textbox", { name: "PM conversation" }), "Create a release mandate.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    const selectedCard = await screen.findByRole("button", { name: /New mandate/i });
    await waitFor(() => expect(selectedCard.getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByRole("region", { name: "Selected attempt" }).textContent).toContain("New mandate");
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual(["/api/mission-control/chat", "/api/mission-control/board"]);
  });

  test("does not replay acknowledged intake or invent a card when board refresh fails", async () => {
    const user = userEvent.setup();
    const requestId = "123e4567-e89b-42d3-a456-426614174000";
    const taskId = `task-${"a".repeat(64)}`;
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ schema_version: "agentdash.intake-ack/v1", request_id: requestId, pm: { text: "A bounded proposal is ready.", session_ref: "pm-session-card", proposal: { schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-card", task_id: null, intent: "create_task", created_at: "2026-08-04T10:00:00.000Z" } }, result: { kind: "card_created", task_id: taskId, readiness: { kind: "approval_required", reasons: [], decision_type: "initial_mandate_approval" } }, board_refresh: true, select_task_id: taskId }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockRejectedValueOnce(new Error("board unavailable"));
    render(<MissionControlShell board={board} />);

    await user.type(screen.getByRole("textbox", { name: "PM conversation" }), "Create a release mandate.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("A bounded proposal is ready.");

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: /New mandate/i })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
