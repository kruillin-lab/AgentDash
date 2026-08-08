import { describe, expect, test } from "vitest";

import { Reconciler, type ReconciliationRecord } from "./reconciler";

const limits = {
  dispatch_lookup: { max_attempts: 6, deadline_ms: 60_000 },
  cancel_confirmation: { max_attempts: 6, deadline_ms: 60_000 },
  orphan_recovery: { max_attempts: 12, deadline_ms: 120_000 },
  finalization: { max_attempts: 6, deadline_ms: 60_000 },
  receipt_delivery: { max_attempts: 12, deadline_ms: 120_000 },
};

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
});
