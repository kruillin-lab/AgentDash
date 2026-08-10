import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  MissionControlBoardResponseV1Schema,
  parseMissionControlCardPayload,
} from "../../../../lib/mission-control/board-view";
import { loadBoardFromHermes } from "../../../../server/mission-control/read-model";
import { GET } from "./route";

vi.mock("../../../../server/mission-control/read-model", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../server/mission-control/read-model")>(),
  loadBoardFromHermes: vi.fn(),
}));

const digest = "c".repeat(64);
const payload = (summary: string) => ({ redacted: true as const, digest, summary });
const card = (taskId: string) => JSON.stringify({
  schema_version: "agentdash.mission-control-card-view/v1",
  task_id: taskId,
  title: "Prepare release",
  detail: "Ready to dispatch",
  attempt: null,
});

const emptyLanes = () => ({ ready: [], working: [], needs_you: [], stopped: [], completed: [] });

beforeEach(() => vi.mocked(loadBoardFromHermes).mockReset());

describe("GET /api/mission-control/board", () => {
  test("serves a valid non-empty versioned card through the actual GET contract", async () => {
    vi.mocked(loadBoardFromHermes).mockResolvedValue({
      generated_at: "2026-08-04T10:00:00.000Z",
      lanes: { ...emptyLanes(), ready: [payload(card("task-1"))] },
      archived_count: 0,
      unavailable_reason: null,
    } as never);

    const response = await GET();
    expect(response.status).toBe(200);

    const body = MissionControlBoardResponseV1Schema.parse(await response.json());
    expect(body.unavailable_reason).toBeNull();
    expect(body.board.lanes.ready).toHaveLength(1);
    expect(parseMissionControlCardPayload(body.board.lanes.ready[0])).toEqual({
      schema_version: "agentdash.mission-control-card-view/v1",
      task_id: "task-1",
      title: "Prepare release",
      detail: "Ready to dispatch",
      attempt: null,
    });
  });

  test("rejects a malformed non-renderable card summary before serving the board", async () => {
    vi.mocked(loadBoardFromHermes).mockResolvedValue({
      generated_at: "2026-08-04T10:00:00.000Z",
      lanes: { ...emptyLanes(), ready: [payload("not-json")] },
      archived_count: 0,
      unavailable_reason: null,
    } as never);

    await expect(GET()).rejects.toThrow();
  });

  test("rejects duplicate card task identities across served lanes", async () => {
    vi.mocked(loadBoardFromHermes).mockResolvedValue({
      generated_at: "2026-08-04T10:00:00.000Z",
      lanes: { ...emptyLanes(), ready: [payload(card("task-1"))], working: [payload(card("task-1"))] },
      archived_count: 0,
      unavailable_reason: null,
    } as never);

    await expect(GET()).rejects.toThrow(/unique/i);
  });

  test("rejects card identities outside the locked opaque Task ID lexical space", async () => {
    vi.mocked(loadBoardFromHermes).mockResolvedValue({
      generated_at: "2026-08-04T10:00:00.000Z",
      lanes: { ...emptyLanes(), ready: [payload(card("not a valid task id"))] },
      archived_count: 0,
      unavailable_reason: null,
    } as never);

    await expect(GET()).rejects.toThrow();
  });
});
