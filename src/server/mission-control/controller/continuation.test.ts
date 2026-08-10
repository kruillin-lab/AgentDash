import { describe, expect, test } from "vitest";

import { BudgetLedger, type BudgetLedgerState } from "./ledger";
import { chooseContinuation, type ContinuationInput, type MandateContinuationView } from "./continuation";

const RESERVES_USD = 0.2;

function mandate(overrides: Partial<MandateContinuationView> = {}): MandateContinuationView {
  return {
    action_nodes: [
      { node_id: "execute", action_role: "execute", route_id: "route-primary" },
      { node_id: "fallback-1", action_role: "retry", route_id: "route-fallback" },
      { node_id: "remediate-1", action_role: "remediate", route_id: "route-remediate" },
      { node_id: "verify", action_role: "verify", route_id: null },
      { node_id: "finalize", action_role: "finalize", route_id: null },
    ],
    transition_graph: {
      execute: {
        succeeded: { kind: "node", node_id: "verify" },
        transient_infrastructure: { kind: "node", node_id: "fallback-1" },
        semantic_failure: { kind: "node", node_id: "remediate-1" },
        route_unavailable: { kind: "terminal", outcome: "route_unavailable" },
        ambiguous: { kind: "reconciliation", category: "dispatch_lookup", max_attempts: 6, deadline_ms: 60_000 },
      },
      "fallback-1": { succeeded: { kind: "node", node_id: "verify" } },
      "remediate-1": { succeeded: { kind: "node", node_id: "verify" } },
      verify: {
        succeeded: { kind: "node", node_id: "finalize" },
        verification_failure: { kind: "node", node_id: "remediate-1" },
      },
      finalize: { succeeded: { kind: "terminal", outcome: "succeeded" } },
    },
    visit_caps: { execute: 1, "fallback-1": 2, "remediate-1": 2, verify: 3, finalize: 1 },
    edge_visit_caps: {
      "execute:succeeded": 1, "execute:transient_infrastructure": 2, "execute:semantic_failure": 2,
      "execute:route_unavailable": 1, "execute:ambiguous": 6,
      "fallback-1:succeeded": 1, "remediate-1:succeeded": 2,
      "verify:succeeded": 1, "verify:verification_failure": 2, "finalize:succeeded": 1,
    },
    per_action_limits: {
      execute: { max_cost_usd: 0.3 }, "fallback-1": { max_cost_usd: 0.3 }, "remediate-1": { max_cost_usd: 0.3 },
      verify: { max_cost_usd: 0.05 }, finalize: { max_cost_usd: 0.05 },
    },
    aggregate_budget: { max_cost_usd: 1 },
    task_reserves_usd: RESERVES_USD,
    ...overrides,
  };
}

function ledger(observed = 0): BudgetLedgerState {
  return { schema_version: "agentdash.budget-ledger/v1", aggregate_limit_usd: 1, observed_cost_usd: observed, held_task_reserves_usd: RESERVES_USD, held_command_headroom_usd: 0, commands: {} };
}

function input(overrides: Partial<ContinuationInput> = {}): ContinuationInput {
  return {
    mandate: mandate(),
    node: "execute",
    outcome: "transient_infrastructure",
    visits: { node_visits: { execute: 1 }, edge_visits: {} },
    ledger: ledger(),
    routeEvidence: () => "current",
    ...overrides,
  };
}

describe("chooseContinuation", () => {
  test("transient failure schedules the exact named fallback, never a CEO interruption", () => {
    const decision = chooseContinuation(input());
    expect(decision).toEqual({ kind: "schedule_action", node_id: "fallback-1" });
    expect(decision).not.toHaveProperty("approval_request");
    expect(decision.kind).not.toBe("request_ceo_input");
  });

  test("semantic failure schedules the scoped remediation action inside the mandate", () => {
    const decision = chooseContinuation(input({ outcome: "semantic_failure" }));
    expect(decision).toEqual({ kind: "schedule_action", node_id: "remediate-1" });
    expect(decision.kind).not.toBe("request_ceo_input");
  });

  test("verification failure routes back through a named remediation cycle, not the CEO", () => {
    const decision = chooseContinuation(input({ node: "verify", outcome: "verification_failure", visits: { node_visits: { execute: 1, verify: 1 }, edge_visits: {} } }));
    expect(decision).toEqual({ kind: "schedule_action", node_id: "remediate-1" });
    expect(decision.kind).not.toBe("request_ceo_input");
  });

  test("success walks verify then finalize to terminal success", () => {
    expect(chooseContinuation(input({ outcome: "succeeded" }))).toEqual({ kind: "schedule_action", node_id: "verify" });
    expect(chooseContinuation(input({ node: "verify", outcome: "succeeded", visits: { node_visits: { execute: 1, verify: 1 }, edge_visits: {} } }))).toEqual({ kind: "schedule_action", node_id: "finalize" });
    expect(chooseContinuation(input({ node: "finalize", outcome: "succeeded", visits: { node_visits: { execute: 1, verify: 1, finalize: 1 }, edge_visits: {} } }))).toMatchObject({ kind: "finish_task", outcome: "succeeded" });
  });

  test("repeated failure that exhausts the aggregate budget finishes budget_exhausted", () => {
    // Only 0.05 remains after prior spend; the fallback needs 0.3 worst-case.
    const decision = chooseContinuation(input({ ledger: ledger(0.75) }));
    expect(decision).toMatchObject({ kind: "finish_task", outcome: "budget_exhausted" });
    expect(decision.kind).not.toBe("request_ceo_input");
  });

  test("an exhausted visit cap stops truthfully instead of over-running the named action", () => {
    const decision = chooseContinuation(input({ visits: { node_visits: { execute: 1, "fallback-1": 2 }, edge_visits: {} } }));
    expect(decision).toMatchObject({ kind: "finish_task" });
    expect(decision.kind).not.toBe("schedule_action");
  });

  test("route expiry with no eligible current route finishes route_unavailable without blind substitution", () => {
    const decision = chooseContinuation(input({ routeEvidence: () => "unavailable" }));
    expect(decision).toMatchObject({ kind: "finish_task", outcome: "route_unavailable" });
    expect(decision.kind).not.toBe("request_ceo_input");
  });

  test("route unavailable transitions to a terminal stop", () => {
    const decision = chooseContinuation(input({ outcome: "route_unavailable" }));
    expect(decision).toMatchObject({ kind: "finish_task", outcome: "route_unavailable" });
  });

  test("an ambiguous dispatch schedules a bounded reconciliation, never a CEO question", () => {
    const decision = chooseContinuation(input({ outcome: "ambiguous" }));
    expect(decision).toMatchObject({ kind: "schedule_reconciliation", category: "dispatch_lookup", attempt: 1 });
    expect(decision.kind).not.toBe("request_ceo_input");
  });

  test("an out-of-mandate expansion is the only path that requests typed CEO input", () => {
    const expanded = mandate({
      transition_graph: {
        ...mandate().transition_graph,
        execute: { semantic_failure: { kind: "ceo_input", decision_type: "capability_change" } },
      },
    });
    const decision = chooseContinuation(input({ mandate: expanded, outcome: "semantic_failure" }));
    expect(decision).toEqual({ kind: "request_ceo_input", decision_type: "capability_change" });
  });

  test("a missing transition edge fails closed rather than inventing work", () => {
    expect(() => chooseContinuation(input({ outcome: "timed_out" }))).toThrow(/transition|edge/i);
  });
});
