import "server-only";

import type { CodeGActivityV1, CodeGBindingV1, RedactedPayloadV1 } from "../../../lib/mission-control/contracts";

// ---------------------------------------------------------------------------
// Activity projector
//
// Renders only ORIGINAL CodeG/ACP activity as the worker transcript. Work Task
// lifecycle events alone are not a transcript and never produce items. Items
// are deduplicated by cursor, ordered by the monotonic resume cursor, and
// classified into the Live/Files/Checks tabs by kind. One identity is never
// derived from another; unsupported facts stay visibly unknown.
// ---------------------------------------------------------------------------

export type ActivityTab = "live" | "files" | "checks";

export interface ActivityItemV1 {
  cursor: string;
  observed_at: string;
  kind: string;
  tab: ActivityTab;
  payload: RedactedPayloadV1;
}

export interface ActivityPageV1 {
  items: ActivityItemV1[];
  next_cursor: string | null;
}

function tabFor(kind: string): ActivityTab {
  if (kind === "file_changed" || kind === "file_produced" || kind === "file_missing" || kind === "file") return "files";
  if (kind === "check" || kind === "test" || kind === "validation") return "checks";
  return "live";
}

function cursorNumber(cursor: string): number {
  const value = Number(cursor);
  return Number.isFinite(value) ? value : 0;
}

export function projectActivity(
  _binding: CodeGBindingV1,
  _workTaskEvents: CodeGActivityV1[],
  acpEvents: CodeGActivityV1[],
): ActivityPageV1 {
  // Only original ACP activity is transcript material; lifecycle status is not.
  const byCursor = new Map<string, ActivityItemV1>();
  for (const event of acpEvents) {
    if (!byCursor.has(event.cursor)) {
      byCursor.set(event.cursor, { cursor: event.cursor, observed_at: event.observed_at, kind: event.kind, tab: tabFor(event.kind), payload: event.payload });
    }
  }
  const items = [...byCursor.values()].sort((left, right) => cursorNumber(left.cursor) - cursorNumber(right.cursor));
  return { items, next_cursor: items.length === 0 ? null : items[items.length - 1].cursor };
}
