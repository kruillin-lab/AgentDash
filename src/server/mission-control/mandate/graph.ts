import { ActionOutcomeValues, type ActionOutcome, type ActionRole, type TaskOutcome } from "../../../lib/mission-control/contracts/common";

const MAX_GRAPH_NODES = 64;
const MAX_NODE_VISITS = 32;
const MAX_EDGE_VISITS = 32;
const MAX_EXPANDED_STATES = 8_192;
const MAX_REMEDIATION_ITEMS = 32;
const MAX_RECONCILIATION_ATTEMPTS = 32;
const MAX_RECONCILIATION_DEADLINE_MS = 24 * 60 * 60 * 1_000;

type GraphTarget =
  | { kind: "node"; node_id: string }
  | { kind: "reconciliation"; category: string; max_attempts: number; deadline_ms: number }
  | { kind: "ceo_input"; decision_type: string }
  | { kind: "terminal"; outcome: TaskOutcome };

export interface MandateGraphNode {
  node_id: string;
  action_role: ActionRole;
  remediation_scope: { finding_classes: string[]; artifact_scope: string[] } | null;
}

export interface MandateGraphInput {
  action_nodes: MandateGraphNode[];
  transition_graph: Record<string, Partial<Record<ActionOutcome, GraphTarget>>>;
  visit_caps: Record<string, number>;
  edge_visit_caps: Record<string, number>;
}

export interface MandateGraphReason {
  code: string;
  message: string;
}

export interface MandateGraphPath {
  node_ids: string[];
  edge_ids: string[];
  terminal_outcome: TaskOutcome | null;
}

export interface MandateGraphValidation {
  ok: boolean;
  reasons: MandateGraphReason[];
  paths: MandateGraphPath[];
}

function addReason(reasons: MandateGraphReason[], code: string, message: string): void {
  if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, message });
}

function finiteCap(value: number, ceiling: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= ceiling;
}

export function validateMandateGraph(input: MandateGraphInput): MandateGraphValidation {
  const reasons: MandateGraphReason[] = [];
  const paths: MandateGraphPath[] = [];
  const nodes = new Map(input.action_nodes.map((node) => [node.node_id, node]));
  if (input.action_nodes.length === 0 || input.action_nodes.length > MAX_GRAPH_NODES || nodes.size !== input.action_nodes.length) {
    addReason(reasons, "graph_complexity_exceeded", "The action graph exceeds the finite structural ceiling.");
  }

  const nodeIds = new Set(nodes.keys());
  const transitionIds = Object.keys(input.transition_graph);
  const visitIds = Object.keys(input.visit_caps);
  if (transitionIds.length !== nodeIds.size || transitionIds.some((id) => !nodeIds.has(id)) || [...nodeIds].some((id) => !(id in input.transition_graph))) {
    addReason(reasons, "graph_structural_map_mismatch", "Transition keys must match action nodes one-to-one.");
  }
  if (visitIds.length !== nodeIds.size || visitIds.some((id) => !nodeIds.has(id)) || [...nodeIds].some((id) => !(id in input.visit_caps))) {
    addReason(reasons, "graph_structural_map_mismatch", "Visit-cap keys must match action nodes one-to-one.");
  }

  const expectedEdges = new Set<string>();
  for (const node of input.action_nodes) {
    const scope = node.remediation_scope;
    if (node.action_role === "remediate" && (!scope || scope.finding_classes.length === 0 || scope.artifact_scope.length === 0 || scope.finding_classes.length > MAX_REMEDIATION_ITEMS || scope.artifact_scope.length > MAX_REMEDIATION_ITEMS)) {
      addReason(reasons, "graph_unbounded_remediation", "Remediation actions require a bounded finding and artifact scope.");
    }
    if (node.action_role !== "remediate" && scope !== null) addReason(reasons, "graph_unbounded_remediation", "Only remediation actions may carry remediation scope.");
    if (!finiteCap(input.visit_caps[node.node_id], MAX_NODE_VISITS)) addReason(reasons, "graph_visit_cap_exceeded", "Every node requires a finite visit cap within the hard ceiling.");

    const transitions = input.transition_graph[node.node_id] ?? {};
    for (const outcome of ActionOutcomeValues) {
      const edgeId = `${node.node_id}:${outcome}`;
      expectedEdges.add(edgeId);
      const target = transitions[outcome];
      if (!target) {
        addReason(reasons, "graph_missing_outcome_edge", "Every action outcome requires an explicit transition.");
        continue;
      }
      if (!finiteCap(input.edge_visit_caps[edgeId], MAX_EDGE_VISITS)) addReason(reasons, "graph_edge_cap_exceeded", "Every transition requires a finite edge cap within the hard ceiling.");
      if (target.kind === "node" && !nodeIds.has(target.node_id)) addReason(reasons, "graph_dangling_node", "A transition targets an unknown action node.");
      if (target.kind === "reconciliation" && (!finiteCap(target.max_attempts, MAX_RECONCILIATION_ATTEMPTS) || !finiteCap(target.deadline_ms, MAX_RECONCILIATION_DEADLINE_MS))) {
        addReason(reasons, "graph_open_reconciliation", "Reconciliation must be bounded by attempts and deadline.");
      }
      if (target.kind === "terminal" && target.outcome === "succeeded" && node.action_role !== "finalize") {
        addReason(reasons, "graph_invalid_terminal_success", "Only the exact finalization action may transition to succeeded.");
      }
    }
  }
  const suppliedEdges = Object.keys(input.edge_visit_caps);
  if (suppliedEdges.length !== expectedEdges.size || suppliedEdges.some((edge) => !expectedEdges.has(edge))) addReason(reasons, "graph_structural_map_mismatch", "Edge-cap keys must match transitions one-to-one.");

  const entry = input.action_nodes[0]?.node_id;
  if (entry) {
    const reachable = new Set<string>([entry]);
    const queue = [entry];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const target of Object.values(input.transition_graph[current] ?? {})) {
        if (target?.kind === "node" && nodeIds.has(target.node_id) && !reachable.has(target.node_id)) {
          reachable.add(target.node_id);
          queue.push(target.node_id);
        }
      }
    }
    if ([...nodeIds].some((id) => !reachable.has(id))) addReason(reasons, "graph_unreachable_node", "Every action node must be reachable from the first ordered node.");
  }

  const structuralFailure = reasons.some((reason) => ["graph_complexity_exceeded", "graph_structural_map_mismatch", "graph_missing_outcome_edge", "graph_dangling_node", "graph_visit_cap_exceeded", "graph_edge_cap_exceeded", "graph_open_reconciliation"].includes(reason.code));
  if (entry && !structuralFailure) {
    type State = { current: string; node_ids: string[]; edge_ids: string[]; nodeVisits: Record<string, number>; edgeVisits: Record<string, number> };
    const stack: State[] = [{ current: entry, node_ids: [entry], edge_ids: [], nodeVisits: { [entry]: 1 }, edgeVisits: {} }];
    let expanded = 0;
    while (stack.length > 0) {
      const state = stack.pop()!;
      expanded += 1;
      if (expanded > MAX_EXPANDED_STATES) {
        addReason(reasons, "graph_complexity_exceeded", "Expanded graph state exceeds the hard ceiling.");
        paths.length = 0;
        break;
      }
      let advanced = false;
      for (const outcome of ActionOutcomeValues) {
        const edgeId = `${state.current}:${outcome}`;
        const target = input.transition_graph[state.current]?.[outcome];
        if (!target) continue;
        const edgeCount = state.edgeVisits[edgeId] ?? 0;
        if (edgeCount >= input.edge_visit_caps[edgeId]) continue;
        const edgeVisits = { ...state.edgeVisits, [edgeId]: edgeCount + 1 };
        if (target.kind === "node") {
          const visits = state.nodeVisits[target.node_id] ?? 0;
          if (visits >= input.visit_caps[target.node_id]) continue;
          advanced = true;
          stack.push({ current: target.node_id, node_ids: [...state.node_ids, target.node_id], edge_ids: [...state.edge_ids, edgeId], nodeVisits: { ...state.nodeVisits, [target.node_id]: visits + 1 }, edgeVisits });
        } else {
          advanced = true;
          paths.push({ node_ids: state.node_ids, edge_ids: [...state.edge_ids, edgeId], terminal_outcome: target.kind === "terminal" ? target.outcome : null });
        }
      }
      if (!advanced) {
        paths.push({ node_ids: state.node_ids, edge_ids: state.edge_ids, terminal_outcome: null });
        addReason(reasons, "graph_cap_dead_end", "A capped path can stop without an explicit terminal or bounded handoff.");
      }
    }
  }

  const successPaths = paths.filter((path) => path.terminal_outcome === "succeeded");
  if (successPaths.length === 0) addReason(reasons, "graph_missing_terminal_success", "The graph has no finite succeeded path.");
  for (const path of successPaths) {
    const roles = path.node_ids.map((id) => nodes.get(id)?.action_role);
    const verifyIndex = roles.indexOf("verify");
    const finalizeIndex = roles.lastIndexOf("finalize");
    if (verifyIndex < 0) addReason(reasons, "graph_success_without_verification", "Every succeeded path must visit verification.");
    if (finalizeIndex < 0) addReason(reasons, "graph_success_without_finalization", "Every succeeded path must visit finalization.");
    if (verifyIndex >= 0 && finalizeIndex >= 0 && verifyIndex >= finalizeIndex) addReason(reasons, "graph_invalid_success_order", "Verification must precede finalization on every succeeded path.");
    if (roles.at(-1) !== "finalize") addReason(reasons, "graph_invalid_terminal_success", "Succeeded must be emitted by the exact finalization action.");
  }

  return { ok: reasons.length === 0, reasons, paths };
}
