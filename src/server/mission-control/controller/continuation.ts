import "server-only";

import type { ActionOutcome, ActionRole, TaskOutcome } from "../../../lib/mission-control/contracts";
import type { BudgetLedgerState } from "./ledger";

// ---------------------------------------------------------------------------
// Bounded automatic continuation
//
// After each action closes, the controller must carry the task forward through
// retry, scoped remediation, verification, and finalization WITHOUT another
// CEO interruption — every technical outcome stays inside the activated
// mandate. The only path that produces a typed CEO-input request is an
// out-of-mandate expansion already encoded as a `ceo_input` graph leaf. This
// function is pure and deterministic: it never calls a model or an adapter.
// ---------------------------------------------------------------------------

type ReconciliationCategory = "dispatch_lookup" | "cancel_confirmation" | "orphan_recovery" | "finalization" | "receipt_delivery";

type GraphTarget =
  | { kind: "node"; node_id: string }
  | { kind: "reconciliation"; category: ReconciliationCategory; max_attempts: number; deadline_ms: number }
  | { kind: "ceo_input"; decision_type: string }
  | { kind: "terminal"; outcome: TaskOutcome };

export type ContinuationDecisionV1 =
  | { kind: "schedule_action"; node_id: string }
  | { kind: "schedule_reconciliation"; category: ReconciliationCategory; attempt: number; deadline_ms: number }
  | { kind: "request_ceo_input"; decision_type: string }
  | { kind: "finish_task"; outcome: TaskOutcome; rationale: string };

export interface MandateContinuationView {
  action_nodes: ReadonlyArray<{ node_id: string; action_role: ActionRole; route_id: string | null }>;
  transition_graph: Readonly<Record<string, Partial<Record<ActionOutcome, GraphTarget>>>>;
  visit_caps: Readonly<Record<string, number>>;
  edge_visit_caps: Readonly<Record<string, number>>;
  per_action_limits: Readonly<Record<string, { max_cost_usd: number }>>;
  aggregate_budget: { max_cost_usd: number };
  task_reserves_usd: number;
}

export type RouteEvidenceStatus = "current" | "unavailable";

export interface ContinuationInput {
  mandate: MandateContinuationView;
  node: string;
  outcome: ActionOutcome;
  visits: { node_visits: Readonly<Record<string, number>>; edge_visits: Readonly<Record<string, number>> };
  ledger: BudgetLedgerState;
  /** Fresh route-proof check for a candidate model-backed route. */
  routeEvidence(routeId: string): RouteEvidenceStatus;
}

function finish(outcome: TaskOutcome, rationale: string): ContinuationDecisionV1 {
  return { kind: "finish_task", outcome, rationale };
}

export function chooseContinuation(input: ContinuationInput): ContinuationDecisionV1 {
  const { mandate, node, outcome, visits, ledger } = input;
  const transitions = mandate.transition_graph[node];
  const target = transitions?.[outcome];
  if (!target) throw new Error(`No transition edge for ${node}:${outcome}; the mandate graph is incomplete.`);

  // Every traversal consumes one use of this outcome edge; an exhausted edge cap
  // means the bounded branch is spent and the task must stop truthfully.
  const edgeId = `${node}:${outcome}`;
  const edgeCap = mandate.edge_visit_caps[edgeId];
  const edgeUsed = visits.edge_visits[edgeId] ?? 0;
  if (!Number.isSafeInteger(edgeCap) || edgeCap <= 0) throw new Error(`Missing finite edge cap for ${edgeId}.`);
  if (edgeUsed >= edgeCap) return finish("failed", `The bounded ${edgeId} branch is exhausted.`);

  if (target.kind === "terminal") return finish(target.outcome, `Action ${node} closed ${outcome} onto a terminal edge.`);
  if (target.kind === "ceo_input") return { kind: "request_ceo_input", decision_type: target.decision_type };
  if (target.kind === "reconciliation") {
    const attempt = edgeUsed + 1;
    if (attempt > target.max_attempts) return finish("inconsistent", `Reconciliation for ${edgeId} exceeded its bounded attempts.`);
    return { kind: "schedule_reconciliation", category: target.category, attempt, deadline_ms: target.deadline_ms };
  }

  // target.kind === "node": schedule the exact named next action after proving
  // its visit cap, remaining aggregate budget, and current route evidence.
  const nextNode = mandate.action_nodes.find((candidate) => candidate.node_id === target.node_id);
  if (!nextNode) throw new Error(`Transition target ${target.node_id} is not a finite action node.`);

  const nodeCap = mandate.visit_caps[nextNode.node_id];
  const nodeUsed = visits.node_visits[nextNode.node_id] ?? 0;
  if (!Number.isSafeInteger(nodeCap) || nodeCap <= 0) throw new Error(`Missing finite visit cap for ${nextNode.node_id}.`);
  if (nodeUsed >= nodeCap) return finish("failed", `The named action ${nextNode.node_id} has exhausted its visit cap.`);

  // The next action's worst-case headroom must fit the remaining aggregate while
  // the task-level verification/finalization/cancellation/reconciliation
  // reserves stay held. Observed spend is never refunded.
  const headroom = mandate.per_action_limits[nextNode.node_id]?.max_cost_usd;
  if (!Number.isFinite(headroom) || headroom < 0) throw new Error(`Missing per-action limit for ${nextNode.node_id}.`);
  const remaining = ledger.aggregate_limit_usd - ledger.observed_cost_usd - ledger.held_task_reserves_usd - ledger.held_command_headroom_usd;
  if (headroom > remaining) return finish("budget_exhausted", `Remaining aggregate budget cannot fund ${nextNode.node_id} within reserves.`);

  // A model-backed action requires a current exact route proof; route expiry or
  // unavailability stops without blind substitution.
  if (nextNode.route_id !== null && input.routeEvidence(nextNode.route_id) !== "current") {
    return finish("route_unavailable", `Route ${nextNode.route_id} for ${nextNode.node_id} is not currently proven.`);
  }

  return { kind: "schedule_action", node_id: nextNode.node_id };
}
