import "server-only";

import {
  DigestSchema,
  ExactRouteV1Schema,
  TaskIdSchema,
  TaskOutcomeV1Schema,
  canonicalDigest,
  type Digest,
  type ExactRouteV1,
  type TaskId,
  type TaskOutcomeV1,
} from "../../../lib/mission-control/contracts";

export interface ControllerStateV1 {
  schema_version: "agentdash.controller-state/v1";
  task_id: TaskId;
  revision: number;
  terminal: TaskOutcomeV1 | null;
  node_visits: Record<string, number>;
  edge_visits: Record<string, number>;
  realized_mutating_routes: ExactRouteV1[];
  verification: { evidence_digest: Digest; state_revision: number } | null;
}

function increment(map: Record<string, number>, key: string, cap: number, label: string): Record<string, number> {
  if (!Number.isSafeInteger(cap) || cap <= 0) throw new TypeError(`${label} cap must be positive.`);
  const next = (map[key] ?? 0) + 1;
  if (next > cap) throw new Error(`${label} cap exceeded for ${key}.`);
  return { ...map, [key]: next };
}

export const ControllerState = {
  create(taskId: string): ControllerStateV1 {
    return { schema_version: "agentdash.controller-state/v1", task_id: TaskIdSchema.parse(taskId), revision: 0, terminal: null, node_visits: {}, edge_visits: {}, realized_mutating_routes: [], verification: null };
  },

  commitTerminal(state: ControllerStateV1, expectedRevision: number, rawOutcome: unknown): { applied: boolean; state: ControllerStateV1 } {
    if (state.terminal !== null || state.revision !== expectedRevision) return { applied: false, state };
    const outcome = TaskOutcomeV1Schema.parse(rawOutcome);
    if (outcome.task_id !== state.task_id) throw new Error("Terminal outcome task identity does not match controller state.");
    return { applied: true, state: { ...state, revision: state.revision + 1, terminal: outcome } };
  },

  recordVisit(state: ControllerStateV1, nodeId: string, cap: number): ControllerStateV1 {
    if (state.terminal) throw new Error("Terminal controller state cannot record a node visit.");
    return { ...state, revision: state.revision + 1, node_visits: increment(state.node_visits, nodeId, cap, "Visit") };
  },

  recordEdge(state: ControllerStateV1, edgeId: string, cap: number): ControllerStateV1 {
    if (state.terminal) throw new Error("Terminal controller state cannot record an edge visit.");
    return { ...state, revision: state.revision + 1, edge_visits: increment(state.edge_visits, edgeId, cap, "Edge") };
  },

  markVerified(state: ControllerStateV1, evidenceDigest: string): ControllerStateV1 {
    if (state.terminal) throw new Error("Terminal controller state cannot be re-verified.");
    const digest = DigestSchema.parse(evidenceDigest);
    return { ...state, revision: state.revision + 1, verification: { evidence_digest: digest, state_revision: state.revision + 1 } };
  },

  recordMutation(state: ControllerStateV1, rawRoute: unknown): ControllerStateV1 {
    if (state.terminal) throw new Error("Terminal controller state cannot record a mutation.");
    const route = ExactRouteV1Schema.parse(rawRoute);
    const routeDigest = canonicalDigest(route);
    const alreadyRealized = state.realized_mutating_routes.some((existing) => canonicalDigest(existing) === routeDigest);
    return {
      ...state,
      revision: state.revision + 1,
      realized_mutating_routes: alreadyRealized ? state.realized_mutating_routes : [...state.realized_mutating_routes, route],
      verification: null,
    };
  },
};
