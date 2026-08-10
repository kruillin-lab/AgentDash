import { describe, expect, test, vi } from "vitest";

import { CodeGBindingV1Schema } from "../../../lib/mission-control/contracts";
import { CancellationService } from "./cancellation";

const binding = CodeGBindingV1Schema.parse({ work_task_id: "work-task-1", run_sequence: 1, conversation_id: "conversation-1", connection_id: "connection-1", harness_session_id: "session-1", folder_id: "folder-1" });

const limits = {
  dispatch_lookup: { max_attempts: 6, deadline_ms: 60_000 },
  cancel_confirmation: { max_attempts: 6, deadline_ms: 60_000 },
  orphan_recovery: { max_attempts: 12, deadline_ms: 120_000 },
  finalization: { max_attempts: 6, deadline_ms: 60_000 },
  receipt_delivery: { max_attempts: 12, deadline_ms: 120_000 },
};

const startedAt = "2026-08-06T12:00:00.000Z";

function service(cancelExact: ReturnType<typeof vi.fn>) {
  return new CancellationService({ codeg: { cancelExact }, limits });
}

describe("CancellationService", () => {
  test("a confirmed exact stop yields cancelled", async () => {
    const cancelExact = vi.fn(async () => ({ status: "confirmed" as const, binding }));
    const result = await service(cancelExact).request({ task_id: "task-1", binding, reason: "CEO requested cancellation", now: startedAt });
    expect(result).toMatchObject({ status: "confirmed", outcome: "cancelled" });
    expect(cancelExact).toHaveBeenCalledWith(binding, "CEO requested cancellation");
  });

  test("an already-inactive binding is a confirmed stop, not an error", async () => {
    const cancelExact = vi.fn(async () => ({ status: "not_active" as const, binding }));
    const result = await service(cancelExact).request({ task_id: "task-1", binding, reason: "stop", now: startedAt });
    expect(result).toMatchObject({ status: "confirmed", outcome: "cancelled" });
  });

  test("an ambiguous cancel stays pending while inside the confirmation deadline", async () => {
    const cancelExact = vi.fn(async () => ({ status: "unknown" as const, binding }));
    const svc = service(cancelExact);
    const requested = await svc.request({ task_id: "task-1", binding, reason: "stop", now: startedAt });
    expect(requested).toMatchObject({ status: "pending" });

    const stillInside = svc.tick("2026-08-06T12:00:30.000Z", requested.record);
    expect(stillInside).toMatchObject({ status: "pending" });
  });

  test("deadline expiry on an ambiguous cancel yields inconsistent, never a false cancellation", async () => {
    const cancelExact = vi.fn(async () => ({ status: "unknown" as const, binding }));
    const svc = service(cancelExact);
    const requested = await svc.request({ task_id: "task-1", binding, reason: "stop", now: startedAt });

    const expired = svc.tick("2026-08-06T12:01:01.000Z", requested.record);
    expect(expired).toMatchObject({ status: "inconsistent" });
    expect(expired).not.toMatchObject({ outcome: "cancelled" });
  });

  test("a late confirmation after pending resolves to cancelled", async () => {
    const cancelExact = vi.fn()
      .mockResolvedValueOnce({ status: "unknown" as const, binding })
      .mockResolvedValueOnce({ status: "confirmed" as const, binding });
    const svc = service(cancelExact);
    const requested = await svc.request({ task_id: "task-1", binding, reason: "stop", now: startedAt });
    expect(requested).toMatchObject({ status: "pending" });

    const resolved = await svc.reconcile({ record: requested.record, binding, reason: "stop", now: "2026-08-06T12:00:20.000Z" });
    expect(resolved).toMatchObject({ status: "confirmed", outcome: "cancelled" });
  });
});
