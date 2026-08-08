import { describe, expect, test } from "vitest";

import { evaluateAutoEligibility, type AutoEligibilitySnapshotV1 } from "./auto";

function eligible(): AutoEligibilitySnapshotV1 {
  return {
    aggregate_cost_usd: 0.5,
    aggregate_runtime_ms: 600_000,
    cost_enforceable: true,
    runtime_enforceable: true,
    cancel_enforceable: true,
    workspace_safe: true,
    capability_risk: false,
    terminal_path_complete: true,
    reserves_held: true,
    route_level5: true,
    proof_current: true,
    verification_present: true,
    finalization_present: true,
  };
}

describe("evaluateAutoEligibility", () => {
  test("a complete low-risk snapshot is eligible with no reasons", () => {
    const result = evaluateAutoEligibility(eligible());
    expect(result).toMatchObject({ eligible: true });
    expect(result.reasons).toEqual([]);
  });

  test("aggregate cost above $1 is rejected", () => {
    expect(evaluateAutoEligibility({ ...eligible(), aggregate_cost_usd: 1.01 })).toMatchObject({ eligible: false });
    expect(evaluateAutoEligibility({ ...eligible(), aggregate_cost_usd: 1.01 }).reasons.join(" ")).toMatch(/cost/i);
  });

  test("aggregate cost exactly $1 is allowed (hard bound is inclusive)", () => {
    expect(evaluateAutoEligibility({ ...eligible(), aggregate_cost_usd: 1.0 })).toMatchObject({ eligible: true });
  });

  test("runtime above 30 minutes is rejected", () => {
    const result = evaluateAutoEligibility({ ...eligible(), aggregate_runtime_ms: 1_800_001 });
    expect(result).toMatchObject({ eligible: false });
    expect(result.reasons.join(" ")).toMatch(/runtime/i);
  });

  test("unenforceable cost, runtime, or cancel is rejected", () => {
    expect(evaluateAutoEligibility({ ...eligible(), cost_enforceable: false }).reasons.join(" ")).toMatch(/cost/i);
    expect(evaluateAutoEligibility({ ...eligible(), runtime_enforceable: false }).reasons.join(" ")).toMatch(/runtime/i);
    expect(evaluateAutoEligibility({ ...eligible(), cancel_enforceable: false }).reasons.join(" ")).toMatch(/cancel/i);
  });

  test("an unsafe workspace is rejected", () => {
    expect(evaluateAutoEligibility({ ...eligible(), workspace_safe: false }).reasons.join(" ")).toMatch(/workspace/i);
  });

  test("a risky capability is rejected", () => {
    expect(evaluateAutoEligibility({ ...eligible(), capability_risk: true }).reasons.join(" ")).toMatch(/capability/i);
  });

  test("a missing terminal path is rejected", () => {
    expect(evaluateAutoEligibility({ ...eligible(), terminal_path_complete: false }).reasons.join(" ")).toMatch(/terminal/i);
  });

  test("missing task reserves are rejected", () => {
    expect(evaluateAutoEligibility({ ...eligible(), reserves_held: false }).reasons.join(" ")).toMatch(/reserve/i);
  });

  test("a non-level-5 route is rejected", () => {
    expect(evaluateAutoEligibility({ ...eligible(), route_level5: false }).reasons.join(" ")).toMatch(/level.?5|route/i);
  });

  test("a stale proof is rejected", () => {
    expect(evaluateAutoEligibility({ ...eligible(), proof_current: false }).reasons.join(" ")).toMatch(/proof|stale|current/i);
  });

  test("missing verification or finalization is rejected", () => {
    expect(evaluateAutoEligibility({ ...eligible(), verification_present: false }).reasons.join(" ")).toMatch(/verification/i);
    expect(evaluateAutoEligibility({ ...eligible(), finalization_present: false }).reasons.join(" ")).toMatch(/finalization/i);
  });

  test("multiple failures produce an exhaustive reason list", () => {
    const result = evaluateAutoEligibility({ ...eligible(), aggregate_cost_usd: 2, workspace_safe: false, route_level5: false });
    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
