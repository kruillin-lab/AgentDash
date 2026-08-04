import { describe, expect, test } from "vitest";

import {
  buildBoardProjection,
  HermesBoardSnapshotV1Schema,
  OutboxOverlayV1Schema,
  type HermesBoardSnapshotV1,
  type OutboxOverlayV1,
} from "./read-model";
import { GET } from "../../app/api/mission-control/board/route";

const digest = "a".repeat(64);
const generatedAt = "2026-08-04T10:00:00.000Z";

function ceoInput(taskId: string, timestamps: { created_at?: string; expires_at?: string } = {}) {
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
    created_at: timestamps.created_at ?? "2026-08-04T09:00:00.000Z",
    expires_at: timestamps.expires_at ?? "2026-08-04T11:00:00.000Z",
  };
}

const source = HermesBoardSnapshotV1Schema.parse({
  generated_at: generatedAt,
  unavailable_reason: null,
  tasks: [
    { task_id: "ready-task", title: "Prepare release", detail: "Ready to dispatch", state: "ready", attempt: null, ceo_input: null, task_outcome: null },
    { task_id: "working-task", title: "Build dashboard", detail: "Agent is implementing", state: "running", attempt: "Attempt 2", ceo_input: null, task_outcome: null },
    { task_id: "needs-you-task", title: "Choose target", detail: "A decision is required", state: "blocked", attempt: null, ceo_input: ceoInput("needs-you-task"), task_outcome: null },
    { task_id: "stopped-task", title: "Repair bridge", detail: "Hermes bridge is unavailable", state: "blocked", attempt: "Attempt 1", ceo_input: { reason: "technical block" }, task_outcome: null },
    { task_id: "completed-task", title: "Archive report", detail: "Checks passed", state: "done", attempt: "Attempt 3", ceo_input: null, task_outcome: { schema_version: "agentdash.task-outcome/v1", task_id: "completed-task", outcome: "succeeded", rationale: "All checks passed" } },
  ],
});

describe("buildBoardProjection", () => {
  test("maps every canonical Hermes state, hides archived tasks, and completes only successful done tasks", () => {
    const canonicalSource = HermesBoardSnapshotV1Schema.parse({
      generated_at: generatedAt,
      unavailable_reason: null,
      tasks: [
        { task_id: "triage-task", title: "Triage", detail: "Awaiting triage", state: "triage", attempt: null, ceo_input: null, task_outcome: null },
        { task_id: "todo-task", title: "Todo", detail: "Queued", state: "todo", attempt: null, ceo_input: null, task_outcome: null },
        { task_id: "scheduled-task", title: "Scheduled", detail: "Scheduled", state: "scheduled", attempt: null, ceo_input: null, task_outcome: null },
        { task_id: "ready-task", title: "Ready", detail: "Ready", state: "ready", attempt: null, ceo_input: null, task_outcome: null },
        { task_id: "running-task", title: "Running", detail: "Executing", state: "running", attempt: "Attempt 1", ceo_input: null, task_outcome: { schema_version: "agentdash.task-outcome/v1", task_id: "running-task", outcome: "succeeded", rationale: "Premature outcome" } },
        { task_id: "blocked-ceo", title: "Blocked decision", detail: "Choose target environment", state: "blocked", attempt: null, ceo_input: ceoInput("blocked-ceo"), task_outcome: null },
        { task_id: "review-ceo", title: "Review decision", detail: "Choose release policy", state: "review", attempt: null, ceo_input: ceoInput("review-ceo"), task_outcome: null },
        { task_id: "blocked-tech", title: "Technical block", detail: "Bridge unavailable", state: "blocked", attempt: null, ceo_input: null, task_outcome: null },
        { task_id: "review-tech", title: "Review failed", detail: "Checks need repair", state: "review", attempt: null, ceo_input: null, task_outcome: null },
        { task_id: "done-success", title: "Done", detail: "Verified", state: "done", attempt: "Attempt 2", ceo_input: null, task_outcome: { schema_version: "agentdash.task-outcome/v1", task_id: "done-success", outcome: "succeeded", rationale: "Verified" } },
        { task_id: "done-failed", title: "Done failed", detail: "Verification failed", state: "done", attempt: "Attempt 1", ceo_input: null, task_outcome: { schema_version: "agentdash.task-outcome/v1", task_id: "done-failed", outcome: "failed", rationale: "Failed" } },
        { task_id: "archived-task", title: "Archived", detail: "Historical", state: "archived", attempt: null, ceo_input: null, task_outcome: null },
      ],
    });

    const board = buildBoardProjection(canonicalSource, { reconciliation_pending_task_ids: [] });

    expect(board.lanes.ready).toHaveLength(4);
    expect(board.lanes.working).toHaveLength(1);
    expect(board.lanes.needs_you).toHaveLength(2);
    expect(board.lanes.stopped).toHaveLength(3);
    expect(board.lanes.completed).toHaveLength(1);
    expect(board.archived_count).toBe(1);
  });

  test("rejects duplicate or malformed canonical snapshot task identities", () => {
    const duplicate = { ...source, tasks: [{ ...source.tasks[0] }, { ...source.tasks[0] }] };
    const malformed = { ...source, tasks: [{ ...source.tasks[0], task_id: "not a valid task id" }] } as unknown as HermesBoardSnapshotV1;

    expect(() => buildBoardProjection(duplicate, { reconciliation_pending_task_ids: [] })).toThrow();
    expect(() => buildBoardProjection(malformed, { reconciliation_pending_task_ids: [] })).toThrow();
  });

  test("rejects duplicate reconciliation overlay identities", () => {
    const duplicateOverlay = { reconciliation_pending_task_ids: ["ready-task", "ready-task"] } as unknown as OutboxOverlayV1;

    expect(() => buildBoardProjection(source, duplicateOverlay)).toThrow();
  });

  test.each([
    ["future-created", ceoInput("stopped-task", { created_at: "2026-08-04T10:01:00.000Z", expires_at: "2026-08-04T11:00:00.000Z" })],
    ["expired", ceoInput("stopped-task", { created_at: "2026-08-04T09:00:00.000Z", expires_at: generatedAt })],
    ["foreign-task", ceoInput("another-task")],
  ])("keeps a %s CEO-input request out of Needs you", (_case, request) => {
    const board = buildBoardProjection({ ...source, tasks: [{ ...source.tasks[3], ceo_input: request }] }, { reconciliation_pending_task_ids: [] });

    expect(board.lanes.needs_you).toHaveLength(0);
    expect(board.lanes.stopped).toHaveLength(1);
  });

  test("projects ready, working, typed CEO input, stopped, and successful tasks into their five lanes", () => {
    const board = buildBoardProjection(source, { reconciliation_pending_task_ids: [] });

    expect(board.lanes.ready).toHaveLength(1);
    expect(board.lanes.working).toHaveLength(1);
    expect(board.lanes.needs_you).toHaveLength(1);
    expect(board.lanes.stopped).toHaveLength(1);
    expect(board.lanes.completed).toHaveLength(1);
  });

  test("does not mistake untyped input for an active CEO decision or an incomplete outcome for success", () => {
    const changedSource = HermesBoardSnapshotV1Schema.parse({
      ...source,
      tasks: [
        { ...source.tasks[2], task_id: "untyped-input", ceo_input: { summary: "Choose target environment" } },
        { ...source.tasks[4], task_id: "failed-task", task_outcome: { schema_version: "agentdash.task-outcome/v1", task_id: "failed-task", outcome: "failed", rationale: "Verification failed" } },
      ],
    });
    const board = buildBoardProjection(changedSource, OutboxOverlayV1Schema.parse({ reconciliation_pending_task_ids: [] }));

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
    const overlay = OutboxOverlayV1Schema.parse({ reconciliation_pending_task_ids: ["needs-you-task", "completed-task"] });
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
