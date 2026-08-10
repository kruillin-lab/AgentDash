import "server-only";

import type { TaskOutcome } from "../../../lib/mission-control/contracts";

type ReconciliationCategory = "dispatch_lookup" | "cancel_confirmation" | "orphan_recovery" | "finalization" | "receipt_delivery";

export interface NextActionState {
  terminal: { outcome: TaskOutcome; rationale: string } | null;
  node_visits: Record<string, number>;
  pending_action_node_id: string | null;
  pending_reconciliation: { category: ReconciliationCategory; attempt: number; deadline_at: string } | null;
  active_ceo_input: { decision_type: string; request_id: string } | null;
}

export interface MandateSchedulingView {
  action_nodes: ReadonlyArray<{ node_id: string }>;
  visit_caps: Record<string, number>;
}

export type NextMechanismV1 =
  | { kind: "schedule_action"; node_id: string }
  | { kind: "schedule_reconciliation"; category: ReconciliationCategory; attempt: number; deadline_at: string }
  | { kind: "request_ceo_input"; decision_type: string; request_id: string }
  | { kind: "finish_task"; outcome: TaskOutcome; rationale: string };

export function nextAction(state: NextActionState, mandate: MandateSchedulingView): NextMechanismV1 {
  if (state.terminal) {
    if (state.pending_action_node_id || state.pending_reconciliation || state.active_ceo_input) throw new Error("Terminal state cannot retain a pending mechanism.");
    return { kind: "finish_task", ...state.terminal };
  }
  const mechanisms = Number(state.pending_action_node_id !== null) + Number(state.pending_reconciliation !== null) + Number(state.active_ceo_input !== null);
  if (mechanisms !== 1) throw new Error("Every reachable nonterminal state must have exactly one authorized next mechanism.");
  if (state.pending_action_node_id !== null) {
    const nodeId = state.pending_action_node_id;
    if (!mandate.action_nodes.some((node) => node.node_id === nodeId)) throw new Error("Pending action is not in the active mandate.");
    const cap = mandate.visit_caps[nodeId];
    if (!Number.isSafeInteger(cap) || (state.node_visits[nodeId] ?? 0) >= cap) throw new Error(`Visit cap exhausted for ${nodeId}.`);
    return { kind: "schedule_action", node_id: nodeId };
  }
  if (state.pending_reconciliation !== null) return { kind: "schedule_reconciliation", ...state.pending_reconciliation };
  return { kind: "request_ceo_input", ...state.active_ceo_input! };
}
