import { describe, expect, test } from "vitest";

import { CodeGBindingV1Schema, type CodeGActivityV1, type Digest } from "../../../lib/mission-control/contracts";
import { projectActivity } from "./projector";

const digest = "a".repeat(64) as Digest;
const binding = CodeGBindingV1Schema.parse({ work_task_id: "work-task-1", run_sequence: 1, conversation_id: "conversation-1", connection_id: "connection-1", harness_session_id: "session-1", folder_id: "folder-1" });

const redacted = (summary: string) => ({ redacted: true as const, digest, summary });

function acp(cursor: string, kind: string, summary: string, observed_at = "2026-08-06T12:00:00.000Z"): CodeGActivityV1 {
  return { cursor, observed_at, kind, payload: redacted(summary) };
}

describe("projectActivity", () => {
  test("work task lifecycle alone is not a worker transcript", () => {
    const lifecycleOnly = [{ cursor: "1", observed_at: "2026-08-06T12:00:00.000Z", kind: "status", payload: redacted("running") }];
    expect(projectActivity(binding, lifecycleOnly, [])).toEqual({ items: [], next_cursor: null });
  });

  test("renders original ACP activity in cursor order with a resume cursor", () => {
    const events = [acp("2", "tool", "ran npm test"), acp("1", "message", "starting work"), acp("3", "check", "lint passed")];
    const page = projectActivity(binding, [], events);
    expect(page.items.map((item) => item.cursor)).toEqual(["1", "2", "3"]);
    expect(page.next_cursor).toBe("3");
  });

  test("deduplicates replayed cursor items", () => {
    const events = [acp("1", "message", "one"), acp("1", "message", "one"), acp("2", "tool", "two")];
    const page = projectActivity(binding, [], events);
    expect(page.items.map((item) => item.cursor)).toEqual(["1", "2"]);
  });

  test("classifies items into live, files, and checks tabs by kind", () => {
    const events = [
      acp("1", "message", "hello"),
      acp("2", "file_changed", "src/a.ts"),
      acp("3", "file_produced", "src/b.ts"),
      acp("4", "check", "tests passed"),
      acp("5", "tool", "ran build"),
    ];
    const page = projectActivity(binding, [], events);
    expect(page.items.map((item) => item.tab)).toEqual(["live", "files", "files", "checks", "live"]);
  });

  test("never synthesizes activity from lifecycle status even when ACP is present", () => {
    const lifecycle = [{ cursor: "9", observed_at: "2026-08-06T12:00:00.000Z", kind: "status", payload: redacted("running") }];
    const page = projectActivity(binding, lifecycle, [acp("1", "message", "real work")]);
    expect(page.items.map((item) => item.cursor)).toEqual(["1"]);
  });
});
