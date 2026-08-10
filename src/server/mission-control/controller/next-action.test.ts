import { describe, expect, test } from "vitest";

import { nextAction, type NextActionState } from "./next-action";

const mandate = { action_nodes: [{ node_id: "execute" }, { node_id: "verify" }], visit_caps: { execute: 2, verify: 1 } };

function state(overrides: Partial<NextActionState> = {}): NextActionState {
  return { terminal: null, node_visits: {}, pending_action_node_id: "execute", pending_reconciliation: null, active_ceo_input: null, ...overrides };
}

describe("next action", () => {
  test("maps every reachable nonterminal state to exactly one authorized mechanism", () => {
    const reachable = [
      state(),
      state({ pending_action_node_id: null, pending_reconciliation: { category: "dispatch_lookup", attempt: 1, deadline_at: "2026-08-06T12:01:00.000Z" } }),
      state({ pending_action_node_id: null, active_ceo_input: { decision_type: "business_product_decision", request_id: "input-1" } }),
    ];
    expect(reachable.map((candidate) => nextAction(candidate, mandate).kind)).toEqual(["schedule_action", "schedule_reconciliation", "request_ceo_input"]);
  });

  test("finishes terminal state and rejects ambiguous or exhausted scheduling", () => {
    expect(nextAction(state({ terminal: { outcome: "succeeded", rationale: "done" }, pending_action_node_id: null }), mandate)).toEqual({ kind: "finish_task", outcome: "succeeded", rationale: "done" });
    expect(() => nextAction(state({ pending_reconciliation: { category: "dispatch_lookup", attempt: 1, deadline_at: "2026-08-06T12:01:00.000Z" } }), mandate)).toThrow(/exactly one/i);
    expect(() => nextAction(state({ node_visits: { execute: 2 } }), mandate)).toThrow(/visit cap/i);
  });
});
