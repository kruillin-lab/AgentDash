// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(cleanup);

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
  test("shows the five read-only projections and disabled conversation controls", () => {
    render(<MissionControlShell board={board} />);

    expect(screen.getByRole("region", { name: "Ready" }).textContent).toContain("Prepare release");
    expect(screen.getByRole("region", { name: "Working" }).textContent).toContain("Build dashboard");
    expect(screen.getByRole("region", { name: "Needs you" }).textContent).toContain("Choose target environment");
    expect(screen.getByRole("region", { name: "Stopped" }).textContent).toContain("Repair bridge");
    expect(screen.getByRole("region", { name: "Completed" }).textContent).toContain("Archive report");
    expect(screen.getByRole("textbox", { name: "PM conversation" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Send disabled in read-only mission control" }).hasAttribute("disabled")).toBe(true);
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
});
