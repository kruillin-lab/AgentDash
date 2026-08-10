import { describe, expect, test } from "vitest";

import { canonicalDigest } from "../../../lib/mission-control/contracts";
import { ControllerState } from "./state";

const success = { schema_version: "agentdash.task-outcome/v1", outcome: "succeeded", task_id: "task-1", rationale: "verified" } as const;
const cancelled = { ...success, outcome: "cancelled", rationale: "cancel confirmed" } as const;

describe("controller state", () => {
  test("uses first-writer-wins CAS for completion and cancellation races", () => {
    const initial = ControllerState.create("task-1");
    const completed = ControllerState.commitTerminal(initial, 0, success);
    expect(completed).toMatchObject({ applied: true, state: { revision: 1, terminal: success } });
    expect(ControllerState.commitTerminal(completed.state, 0, cancelled)).toMatchObject({ applied: false, state: completed.state });

    const cancelledFirst = ControllerState.commitTerminal(initial, 0, cancelled);
    expect(ControllerState.commitTerminal(cancelledFirst.state, 0, success)).toMatchObject({ applied: false, state: cancelledFirst.state });
  });

  test("accounts for node and edge visits against immutable mandate caps", () => {
    let state = ControllerState.create("task-1");
    state = ControllerState.recordVisit(state, "execute", 1);
    expect(() => ControllerState.recordVisit(state, "execute", 1)).toThrow(/visit cap/i);
    state = ControllerState.recordEdge(state, "execute:succeeded", 1);
    expect(() => ControllerState.recordEdge(state, "execute:succeeded", 1)).toThrow(/edge cap/i);
  });

  test("accumulates realized mutating routes once and invalidates earlier verification", () => {
    const route = { outer_harness: "codex", provider: "openai", model: "gpt-5.6-terra", agent_type: "worker", mode: "standard", config_digest: canonicalDigest({ config: 1 }) } as const;
    const verified = ControllerState.markVerified(ControllerState.create("task-1"), canonicalDigest({ verification: 1 }));
    const mutated = ControllerState.recordMutation(verified, route);
    const replay = ControllerState.recordMutation(mutated, route);
    expect(mutated.verification).toBeNull();
    expect(replay.realized_mutating_routes).toEqual([route]);
  });
});
