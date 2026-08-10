import { describe, expect, test } from "vitest";

import { BudgetLedger } from "./ledger";

describe("budget ledger", () => {
  test("holds task reserves once and adds only each command's own headroom", () => {
    const ledger = BudgetLedger.create({ aggregate_limit_usd: 10, task_reserves_usd: 2 });
    const first = BudgetLedger.reserve(ledger, { command_id: "command-1", headroom_usd: 3 });
    const replay = BudgetLedger.reserve(first, { command_id: "command-1", headroom_usd: 3 });
    const second = BudgetLedger.reserve(replay, { command_id: "command-2", headroom_usd: 1 });
    expect(replay).toEqual(first);
    expect(second).toMatchObject({ held_task_reserves_usd: 2, held_command_headroom_usd: 4, observed_cost_usd: 0 });
  });

  test("settles observed spend monotonically across restart and releases only terminal command headroom", () => {
    const initial = BudgetLedger.reserve(BudgetLedger.create({ aggregate_limit_usd: 10, task_reserves_usd: 2 }), { command_id: "command-1", headroom_usd: 3 });
    const afterRestart = structuredClone(BudgetLedger.observe(initial, "command-1", 0.12));
    const settled = BudgetLedger.settle(afterRestart, "command-1", { observed_cost_usd: 0.12, terminal: true });
    expect(settled).toMatchObject({ observed_cost_usd: 0.12, held_command_headroom_usd: 0, held_task_reserves_usd: 2 });
    expect(() => BudgetLedger.observe(settled, "command-1", 0.11)).toThrow(/monotonic/i);
  });

  test("releases proven-unsubmitted headroom without refunding observed spend or task reserves", () => {
    const reserved = BudgetLedger.reserve(BudgetLedger.create({ aggregate_limit_usd: 10, task_reserves_usd: 2 }), { command_id: "command-1", headroom_usd: 3 });
    const observed = BudgetLedger.observe(reserved, "command-1", 0.25);
    const revoked = BudgetLedger.revokeUnsubmitted(observed, "command-1");
    expect(revoked).toMatchObject({ observed_cost_usd: 0.25, held_command_headroom_usd: 0, held_task_reserves_usd: 2 });
    expect(() => BudgetLedger.revokeUnsubmitted(BudgetLedger.markSubmitted(reserved, "command-1"), "command-1")).toThrow(/submitted/i);
  });

  // "Only a command proven unsubmitted may be revoked" — such a command never reached the adapter,
  // so it can never accrue observed spend afterwards. Allowing it would let revocation release
  // headroom while spend still climbed against the aggregate limit.
  test("refuses to accrue observed spend on a proven-unsubmitted revoked command", () => {
    const ledger = BudgetLedger.create({ aggregate_limit_usd: 10, task_reserves_usd: 2 });
    const reserved = BudgetLedger.reserve(ledger, { command_id: "command-1", headroom_usd: 3 });
    const revoked = BudgetLedger.revokeUnsubmitted(reserved, "command-1");

    expect(() => BudgetLedger.observe(revoked, "command-1", 0.5)).toThrow(/revoked/i);
    expect(() => BudgetLedger.settle(revoked, "command-1", { observed_cost_usd: 0.5, terminal: true })).toThrow(/revoked/i);
  });

  test("rejects reservations that exceed aggregate remaining authority", () => {
    const ledger = BudgetLedger.create({ aggregate_limit_usd: 5, task_reserves_usd: 2 });
    expect(() => BudgetLedger.reserve(ledger, { command_id: "command-1", headroom_usd: 4 })).toThrow(/budget/i);
  });
});
