import "server-only";

import type { ReconciliationDeadlinesV1, TaskOutcome } from "../../../lib/mission-control/contracts";

// ---------------------------------------------------------------------------
// Bounded reconciliation
//
// Every uncertain external operation must exit Working by a numeric deadline
// with a bounded observation count. While a record is unresolved the task may
// not start new work; when its deadline or observation budget expires the task
// terminalizes `inconsistent`, records the unresolved external activity, and a
// read-only quarantined monitor may keep looking but can never revise the
// accepted terminal outcome. "Retry until available" is invalid.
// ---------------------------------------------------------------------------

export type ReconciliationCategory = keyof ReconciliationDeadlinesV1;

export type ReconciliationResolution = "found" | "not_found" | "cancelled";

export interface ReconciliationRecord {
  category: ReconciliationCategory;
  /** Durable start instant; survives restart so a reboot never resets the budget. */
  started_at: string;
  attempts_used: number;
  /** The definitive resolution once known; null while still uncertain. */
  resolution: ReconciliationResolution | null;
}

export type ReconciliationDecisionV1 =
  | { terminal: null; allow_new_work: true; resolution: ReconciliationResolution }
  | { terminal: null; allow_new_work: false; next_attempt: number; deadline_at: string }
  | { terminal: TaskOutcome; allow_new_work: false; reason: string };

export const Reconciler = {
  tick(now: string, record: ReconciliationRecord, limits: ReconciliationDeadlinesV1): ReconciliationDecisionV1 {
    // A definitive resolution releases the task to continue.
    if (record.resolution !== null) return { terminal: null, allow_new_work: true, resolution: record.resolution };

    const limit = limits[record.category];
    if (!Number.isSafeInteger(limit.max_attempts) || !Number.isSafeInteger(limit.deadline_ms)) {
      throw new Error(`Missing numeric reconciliation limit for ${record.category}.`);
    }

    const deadlineAtMs = Date.parse(record.started_at) + limit.deadline_ms;
    const nowMs = Date.parse(now);
    const attemptsExhausted = record.attempts_used >= limit.max_attempts;
    const deadlineExpired = nowMs >= deadlineAtMs;

    if (attemptsExhausted || deadlineExpired) {
      return {
        terminal: "inconsistent",
        allow_new_work: false,
        reason: attemptsExhausted
          ? `Reconciliation for ${record.category} exhausted its ${limit.max_attempts} observations.`
          : `Reconciliation for ${record.category} passed its ${limit.deadline_ms}ms deadline.`,
      };
    }

    return { terminal: null, allow_new_work: false, next_attempt: record.attempts_used + 1, deadline_at: new Date(deadlineAtMs).toISOString() };
  },
};
