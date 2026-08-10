import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mission Control mock fixture
//
// Implements the Mission Control API surface at the network layer (page.route)
// so the CEO lifecycle can be driven end to end without a live Hermes/CodeG
// bridge. Every boundary exposes deterministic fault injection by name. The
// mock never fabricates a worker transcript: activity is only the original
// ACP items the scenario supplies, and a model-backed session link appears only
// when the scenario provides its exact native URI.
// ---------------------------------------------------------------------------

const DIGEST = "a".repeat(64);

export interface MockCard {
  task_id: string;
  title: string;
  detail: string;
  attempt?: string | null;
}

export interface MockBoardLanes {
  ready?: MockCard[];
  working?: MockCard[];
  needs_you?: MockCard[];
  stopped?: MockCard[];
  completed?: MockCard[];
}

export interface MockFaults {
  board?: boolean;
  activity?: boolean;
  commands?: boolean;
}

function cardPayload(card: MockCard) {
  return {
    redacted: true as const,
    digest: DIGEST,
    summary: JSON.stringify({
      schema_version: "agentdash.mission-control-card-view/v1",
      task_id: card.task_id,
      title: card.title,
      detail: card.detail,
      attempt: card.attempt ?? null,
    }),
  };
}

export function boardResponse(lanes: MockBoardLanes, unavailableReason: string | null = null) {
  return {
    board: {
      generated_at: "2026-08-06T12:00:00.000Z",
      lanes: {
        ready: (lanes.ready ?? []).map(cardPayload),
        working: (lanes.working ?? []).map(cardPayload),
        needs_you: (lanes.needs_you ?? []).map(cardPayload),
        stopped: (lanes.stopped ?? []).map(cardPayload),
        completed: (lanes.completed ?? []).map(cardPayload),
      },
      archived_count: 0,
      unavailable_reason: unavailableReason,
    },
    unavailable_reason: unavailableReason,
  };
}

export interface MockActivityItem {
  cursor: string;
  kind: string;
  summary: string;
  observed_at?: string;
}

export function activityResponse(items: MockActivityItem[], unavailableReason: string | null = null) {
  return {
    items: items.map((item) => ({
      cursor: item.cursor,
      observed_at: item.observed_at ?? "2026-08-06T12:00:00.000Z",
      kind: item.kind,
      tab: item.kind.startsWith("file") ? "files" : item.kind === "check" ? "checks" : "live",
      payload: { redacted: true as const, digest: DIGEST, summary: item.summary },
    })),
    next_cursor: items.length === 0 ? null : items[items.length - 1].cursor,
    unavailable_reason: unavailableReason,
  };
}

/**
 * Install the Mission Control API mocks on a page. Faults inject deterministic
 * failures at the named boundary; otherwise the supplied scenario payloads are
 * served.
 */
export async function mockMissionControl(page: Page, scenario: {
  board?: ReturnType<typeof boardResponse>;
  activity?: ReturnType<typeof activityResponse>;
  faults?: MockFaults;
}): Promise<void> {
  const faults = scenario.faults ?? {};

  await page.route("**/api/mission-control/board", async (route) => {
    if (faults.board) return route.abort("failed");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scenario.board ?? boardResponse({})) });
  });

  await page.route("**/api/mission-control/tasks/*/activity", async (route) => {
    if (faults.activity) return route.abort("failed");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(scenario.activity ?? activityResponse([])) });
  });

  await page.route("**/api/mission-control/commands", async (route) => {
    if (faults.commands) return route.abort("failed");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "accepted" }) });
  });
}
