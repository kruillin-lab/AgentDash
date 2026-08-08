import { describe, expect, test } from "vitest";

import { INITIAL_RECONCILIATION_DEADLINES_V1 } from "../../../lib/mission-control/contracts";

import { Reconciler, type ReconciliationRecord } from "./reconciler";

// Exercise the shipped default mandate values rather than a hand-copied duplicate of the table.
const limits = INITIAL_RECONCILIATION_DEADLINES_V1;

function clock(start = Date.parse("2026-08-06T12:00:00.000Z")) {
  let current = start;
  return {
    now: () => new Date(current).toISOString(),
    advanceTo: (iso: string) => { current = Date.parse(iso); },
    advanceMs: (ms: number) => { current += ms; },
  };
}

function record(overrides: Partial<ReconciliationRecord> = {}): ReconciliationRecord {
  return {
    category: "dispatch_lookup",
    started_at: "2026-08-06T12:00:00.000Z",
    attempts_used: 0,
    resolution: null,
    ...overrides,
  };
}

describe("Reconciler.tick", () => {
  test("an unresolved record inside its deadline keeps reconciling and blocks new work", () => {
    const clk = clock();
    clk.advanceMs(5_000);
    const decision = Reconciler.tick(clk.now(), record({ attempts_used: 1 }), limits);
    expect(decision).toMatchObject({ terminal: null, allow_new_work: false });
  });

  test("a definitive resolution allows new work to continue", () => {
    const clk = clock();
    const decision = Reconciler.tick(clk.now(), record({ resolution: "found", attempts_used: 2 }), limits);
    expect(decision).toMatchObject({ terminal: null, allow_new_work: true });
  });

  test("dispatch lookup deadline expiry terminalizes inconsistent and blocks new work", () => {
    const clk = clock();
    clk.advanceMs(60_001);
    const decision = Reconciler.tick(clk.now(), record({ category: "dispatch_lookup" }), limits);
    expect(decision).toMatchObject({ terminal: "inconsistent", allow_new_work: false });
  });

  test("cancel confirmation deadline expiry yields inconsistent, never a false cancellation", () => {
    const clk = clock();
    clk.advanceMs(60_001);
    const decision = Reconciler.tick(clk.now(), record({ category: "cancel_confirmation" }), limits);
    expect(decision).toMatchObject({ terminal: "inconsistent", allow_new_work: false });
    expect(decision.terminal).not.toBe("cancelled");
  });

  test("orphan recovery uses its longer deadline and observation count", () => {
    const clk = clock();
    clk.advanceMs(119_000);
    expect(Reconciler.tick(clk.now(), record({ category: "orphan_recovery", attempts_used: 3 }), limits)).toMatchObject({ terminal: null });
    clk.advanceMs(2_000);
    expect(Reconciler.tick(clk.now(), record({ category: "orphan_recovery", attempts_used: 3 }), limits)).toMatchObject({ terminal: "inconsistent", allow_new_work: false });
  });

  test("finalization ambiguity past its deadline terminalizes inconsistent", () => {
    const clk = clock();
    clk.advanceMs(60_001);
    expect(Reconciler.tick(clk.now(), record({ category: "finalization" }), limits)).toMatchObject({ terminal: "inconsistent", allow_new_work: false });
  });

  test("receipt delivery failure past its deadline terminalizes inconsistent", () => {
    const clk = clock();
    clk.advanceMs(120_001);
    expect(Reconciler.tick(clk.now(), record({ category: "receipt_delivery" }), limits)).toMatchObject({ terminal: "inconsistent", allow_new_work: false });
  });

  test("exhausting the observation count terminalizes even before the wall-clock deadline", () => {
    const clk = clock();
    clk.advanceMs(1_000);
    const decision = Reconciler.tick(clk.now(), record({ category: "dispatch_lookup", attempts_used: 6 }), limits);
    expect(decision).toMatchObject({ terminal: "inconsistent", allow_new_work: false });
  });

  test("a restart mid-deadline resumes from the durable started_at, not a fresh clock", () => {
    const clk = clock();
    // Started at T0, restart "now" is past the deadline even though this process just booted.
    clk.advanceMs(61_000);
    const decision = Reconciler.tick(clk.now(), record({ category: "dispatch_lookup", started_at: "2026-08-06T12:00:00.000Z" }), limits);
    expect(decision).toMatchObject({ terminal: "inconsistent", allow_new_work: false });
  });

  // The approved initial defaults are explicit mandate values, not hidden polling behavior. Pin the
  // exact table so a silently widened deadline or observation cap fails the gate.
  test("ships the approved initial reconciliation deadline table", () => {
    expect(INITIAL_RECONCILIATION_DEADLINES_V1).toEqual({
      dispatch_lookup: { deadline_ms: 60_000, max_attempts: 6 },
      cancel_confirmation: { deadline_ms: 60_000, max_attempts: 6 },
      orphan_recovery: { deadline_ms: 120_000, max_attempts: 12 },
      finalization: { deadline_ms: 60_000, max_attempts: 6 },
      receipt_delivery: { deadline_ms: 120_000, max_attempts: 12 },
    });
  });
});
