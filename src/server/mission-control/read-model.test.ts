import { describe, expect, test } from "vitest";

import { buildBoardProjection, type HermesBoardSnapshotV1, type OutboxOverlayV1 } from "./read-model";
import { GET } from "../../app/api/mission-control/board/route";

const digest = "a".repeat(64);
const generatedAt = "2026-08-04T10:00:00.000Z";

function ceoInput(taskId: string) {
  return {
    schema_version: "agentdash.ceo-input-request/v1",
    task_id: taskId,
    task_spec_revision: 1,
    task_spec_digest: digest,
    active_mandate_id: null,
    proposed_mandate_id: "mandate-1",
    proposed_mandate_digest: digest,
    decision_type: "initial_mandate_approval",
    proposed_diff: { digest, summary: "Choose target environment" },
    proposed_limits: { max_cost_usd: 1, max_runtime_ms: 60_000, max_attempts: 1, max_provider_tokens: 100 },
    proposed_route_ids: ["route-1"],
    proposed_side_effects: [],
    rationale: "Environment affects release scope.",
    evidence_refs: ["evidence-1"],
    completed_attempt_receipt_ids: [],
    no_unapproved_action_running: true,
    created_at: "2026-08-04T09:00:00.000Z",
    expires_at: "2026-08-04T11:00:00.000Z",
  };
}

const source: HermesBoardSnapshotV1 = {
  generated_at: generatedAt,
  unavailable_reason: null,
  tasks: [
    { task_id: "ready-task", title: "Prepare release", detail: "Ready to dispatch", state: "ready", attempt: null, ceo_input: null, task_outcome: null },
    { task_id: "working-task", title: "Build dashboard", detail: "Agent is implementing", state: "working", attempt: "Attempt 2", ceo_input: null, task_outcome: null },
    { task_id: "needs-you-task", title: "Choose target", detail: "A decision is required", state: "stopped", attempt: null, ceo_input: ceoInput("needs-you-task"), task_outcome: null },
    { task_id: "stopped-task", title: "Repair bridge", detail: "Hermes bridge is unavailable", state: "stopped", attempt: "Attempt 1", ceo_input: { reason: "technical block" }, task_outcome: null },
    { task_id: "completed-task", title: "Archive report", detail: "Checks passed", state: "working", attempt: "Attempt 3", ceo_input: null, task_outcome: { schema_version: "agentdash.task-outcome/v1", task_id: "completed-task", outcome: "succeeded", rationale: "All checks passed" } },
  ],
};

describe("buildBoardProjection", () => {
  test("projects ready, working, typed CEO input, stopped, and successful tasks into their five lanes", () => {
    const board = buildBoardProjection(source, { reconciliation_pending_task_ids: [] });

    expect(board.lanes.ready).toHaveLength(1);
    expect(board.lanes.working).toHaveLength(1);
    expect(board.lanes.needs_you).toHaveLength(1);
    expect(board.lanes.stopped).toHaveLength(1);
    expect(board.lanes.completed).toHaveLength(1);
  });

  test("does not mistake untyped input for an active CEO decision or an incomplete outcome for success", () => {
    const board = buildBoardProjection({
      ...source,
      tasks: [
        { ...source.tasks[2], task_id: "untyped-input", ceo_input: { summary: "Choose target environment" } },
        { ...source.tasks[4], task_id: "failed-task", task_outcome: { schema_version: "agentdash.task-outcome/v1", task_id: "failed-task", outcome: "failed", rationale: "Verification failed" } },
      ],
    }, { reconciliation_pending_task_ids: [] });

    expect(board.lanes.needs_you).toHaveLength(0);
    expect(board.lanes.completed).toHaveLength(0);
    expect(board.lanes.stopped).toHaveLength(2);
  });

  test("ignores a typed CEO input whose task identity does not match the containing task", () => {
    const board = buildBoardProjection({
      ...source,
      tasks: [{ ...source.tasks[3], ceo_input: ceoInput("another-task") }],
    }, { reconciliation_pending_task_ids: [] });

    expect(board.lanes.needs_you).toHaveLength(0);
    expect(board.lanes.stopped).toHaveLength(1);
  });

  test("ignores a successful outcome whose task identity does not match the containing task", () => {
    const board = buildBoardProjection({
      ...source,
      tasks: [{ ...source.tasks[1], task_outcome: { schema_version: "agentdash.task-outcome/v1", task_id: "another-task", outcome: "succeeded", rationale: "Wrong task record" } }],
    }, { reconciliation_pending_task_ids: [] });

    expect(board.lanes.completed).toHaveLength(0);
    expect(board.lanes.working).toHaveLength(1);
  });

  test("keeps reconciliation-pending work stopped even when a typed CEO input or success is present", () => {
    const overlay: OutboxOverlayV1 = { reconciliation_pending_task_ids: ["needs-you-task", "completed-task"] };
    const board = buildBoardProjection(source, overlay);

    expect(board.lanes.needs_you).toHaveLength(0);
    expect(board.lanes.completed).toHaveLength(0);
    expect(board.lanes.stopped.map((item) => item.summary)).toEqual(expect.arrayContaining([
      expect.stringContaining("Reconciliation pending"),
    ]));
  });
});

test("the read-only board route returns a schema-safe empty unavailable board without a mutation surface", async () => {
  const response = await GET();
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toEqual({
    board: {
      generated_at: expect.any(String),
      lanes: { ready: [], working: [], needs_you: [], stopped: [], completed: [] },
      archived_count: 0,
      unavailable_reason: expect.stringContaining("not configured"),
    },
    unavailable_reason: expect.stringContaining("not configured"),
  });
});
