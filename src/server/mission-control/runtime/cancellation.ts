import "server-only";

import type { CodeGBindingV1, ReconciliationDeadlinesV1 } from "../../../lib/mission-control/contracts";
import { Reconciler, type ReconciliationRecord } from "./reconciler";

// ---------------------------------------------------------------------------
// Bounded cancellation
//
// Cancellation is a UI action state while the canonical task remains running.
// A confirmed exact stop yields `cancelled`; an ambiguous result stays pending
// inside the numeric cancel-confirmation deadline; deadline expiry terminalizes
// `inconsistent` and never claims a false cancellation. The request targets one
// exact binding and never creates a second session.
// ---------------------------------------------------------------------------

export type CancellationStatus =
  | { status: "confirmed"; outcome: "cancelled"; record: ReconciliationRecord }
  | { status: "pending"; record: ReconciliationRecord }
  | { status: "inconsistent"; record: ReconciliationRecord };

export interface CancellationCodeG {
  cancelExact(binding: CodeGBindingV1, reason: string): Promise<{ status: "confirmed" | "not_active" | "unknown"; binding: CodeGBindingV1 }>;
}

export type CancellationServiceOptions = Readonly<{
  codeg: CancellationCodeG;
  limits: ReconciliationDeadlinesV1;
}>;

export class CancellationService {
  private readonly codeg: CancellationCodeG;
  private readonly limits: ReconciliationDeadlinesV1;

  constructor(options: CancellationServiceOptions) {
    this.codeg = options.codeg;
    this.limits = options.limits;
  }

  private confirmed(record: ReconciliationRecord): CancellationStatus {
    return { status: "confirmed", outcome: "cancelled", record: { ...record, resolution: "cancelled" } };
  }

  async request(input: { task_id: string; binding: CodeGBindingV1; reason: string; now: string }): Promise<CancellationStatus> {
    const record: ReconciliationRecord = { category: "cancel_confirmation", started_at: input.now, attempts_used: 1, resolution: null };
    const result = await this.codeg.cancelExact(input.binding, input.reason);
    if (result.status === "unknown") return { status: "pending", record };
    // `confirmed` and `not_active` are both definitive exact stops.
    return this.confirmed(record);
  }

  async reconcile(input: { record: ReconciliationRecord; binding: CodeGBindingV1; reason: string; now: string }): Promise<CancellationStatus> {
    const result = await this.codeg.cancelExact(input.binding, input.reason);
    if (result.status !== "unknown") return this.confirmed(input.record);
    return this.tick(input.now, { ...input.record, attempts_used: input.record.attempts_used + 1 });
  }

  tick(now: string, record: ReconciliationRecord): CancellationStatus {
    const decision = Reconciler.tick(now, record, this.limits);
    if (decision.terminal === "inconsistent") return { status: "inconsistent", record };
    if (decision.allow_new_work && decision.terminal === null) return this.confirmed(record);
    return { status: "pending", record };
  }
}
