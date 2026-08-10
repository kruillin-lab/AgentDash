import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { RequiredRouteSafetyGates, canonicalDigest } from "../../../lib/mission-control/contracts";
import { evaluateRoute, loadRouteEvaluationPolicy, type ScoredRouteRun } from "./evaluator";
import { loadRouteInventory } from "./inventory";

const inventoryPath = join(process.cwd(), "config", "mission-control-route-inventory.json");
const policyPath = join(process.cwd(), "config", "route-evaluation-policy.json");
const evaluatedAt = "2026-08-06T12:00:00.000Z";

function scoredRuns(count: number, failed = 0, overrides: Partial<ScoredRouteRun> = {}): ScoredRouteRun[] {
  return Array.from({ length: count }, (_, index) => ({
    run_id: `run-${index + 1}`,
    fixture_shape: `shape-${(index % 5) + 1}`,
    passed: index >= failed,
    cost_usd: 0.1,
    runtime_ms: 1_000,
    provider_tokens: 1_000,
    safety_gate_results: RequiredRouteSafetyGates.map((gate) => ({ gate, passed: true, evidence_digest: canonicalDigest({ gate, index }) })),
    critical_failure: false,
    raw_receipt_digest: canonicalDigest({ receipt: index }),
    environment_digest: canonicalDigest({ environment: index }),
    ...overrides,
  }));
}

async function fixture(routeId = "route-codex-gpt-5-6-terra") {
  const [inventory, policy] = await Promise.all([loadRouteInventory(inventoryPath), loadRouteEvaluationPolicy(policyPath)]);
  return { candidate: inventory.requireCandidate(routeId), policy };
}

describe("route evaluator", () => {
  test("keeps Hermes PM Terra and Sonnet fixtures distinct from every executable worker tuple", async () => {
    const [inventory, policy] = await Promise.all([loadRouteInventory(inventoryPath), loadRouteEvaluationPolicy(policyPath)]);
    expect(policy.pm_fixture_profiles.map((profile) => profile.model)).toEqual(["gpt-5.6-terra", "claude-sonnet-5"]);
    for (const profile of policy.pm_fixture_profiles) {
      expect(profile.agent_type).toBe("pm");
      expect(profile.mode).toBe("planning_only");
      expect(inventory.matchExact(profile)).toBeNull();
    }
  });

  test("requires 20 scored runs, five fixture shapes, and a 95% Wilson lower bound of 0.70 for standard work", async () => {
    const base = await fixture();
    expect(evaluateRoute({ ...base, task_class: "bounded_coding", level: 5, evaluated_at: evaluatedAt, current_config_digest: base.candidate.exact_route.config_digest, runs: scoredRuns(20, 1) }).decision).toBe("eligible");
    expect(evaluateRoute({ ...base, task_class: "bounded_coding", level: 5, evaluated_at: evaluatedAt, current_config_digest: base.candidate.exact_route.config_digest, runs: scoredRuns(20, 2) })).toMatchObject({ decision: "denied", reasons: expect.arrayContaining(["confidence_below_threshold"]) });
    expect(evaluateRoute({ ...base, task_class: "bounded_coding", level: 5, evaluated_at: evaluatedAt, current_config_digest: base.candidate.exact_route.config_digest, runs: scoredRuns(19) })).toMatchObject({ decision: "denied", reasons: expect.arrayContaining(["insufficient_samples"]) });
    expect(evaluateRoute({ ...base, task_class: "bounded_coding", level: 5, evaluated_at: evaluatedAt, current_config_digest: base.candidate.exact_route.config_digest, runs: scoredRuns(20).map((run) => ({ ...run, fixture_shape: "one-shape" })) })).toMatchObject({ decision: "denied", reasons: expect.arrayContaining(["insufficient_fixture_shapes"]) });
    const duplicate = scoredRuns(20).map((run) => ({ ...run, run_id: "same-run", raw_receipt_digest: canonicalDigest({ same: true }) }));
    expect(evaluateRoute({ ...base, task_class: "bounded_coding", level: 5, evaluated_at: evaluatedAt, current_config_digest: base.candidate.exact_route.config_digest, runs: duplicate })).toMatchObject({ decision: "denied", reasons: expect.arrayContaining(["duplicate_run_provenance"]) });
  });

  test("raises the hard engineering and independent review floor to 30 runs and Wilson 0.80", async () => {
    const base = await fixture("route-codex-gpt-5-6-sol");
    expect(evaluateRoute({ ...base, task_class: "hard_engineering", level: 5, evaluated_at: evaluatedAt, current_config_digest: base.candidate.exact_route.config_digest, runs: scoredRuns(30, 1) }).decision).toBe("eligible");
    expect(evaluateRoute({ ...base, task_class: "independent_review", level: 5, evaluated_at: evaluatedAt, current_config_digest: base.candidate.exact_route.config_digest, runs: scoredRuns(30, 2) })).toMatchObject({ decision: "denied", reasons: expect.arrayContaining(["confidence_below_threshold"]) });
  });

  test("denies any safety failure, critical failure, cost/runtime overage, provenance gap, or config drift", async () => {
    const base = await fixture();
    const cases: Array<[string, ScoredRouteRun[], string, string?]> = [
      ["safety", scoredRuns(20, 0, { safety_gate_results: RequiredRouteSafetyGates.map((gate, index) => ({ gate, passed: index !== 0, evidence_digest: canonicalDigest({ gate }) })) }), "safety_gate_failed"],
      ["critical", scoredRuns(20, 0, { critical_failure: true }), "critical_failure"],
      ["cost", scoredRuns(20, 0, { cost_usd: 10_000 }), "cost_ceiling_exceeded"],
      ["runtime", scoredRuns(20, 0, { runtime_ms: 10_000_000 }), "runtime_ceiling_exceeded"],
      ["provenance", scoredRuns(20, 0, { raw_receipt_digest: "" as ScoredRouteRun["raw_receipt_digest"] }), "invalid_run_provenance"],
    ];
    for (const [, runs, reason] of cases) {
      const result = evaluateRoute({ ...base, task_class: "bounded_coding", level: 5, evaluated_at: evaluatedAt, current_config_digest: base.candidate.exact_route.config_digest, runs });
      expect(result).toMatchObject({ decision: "denied", reasons: expect.arrayContaining([reason]) });
      if (reason === "critical_failure") expect(result).toMatchObject({ revocation: { reason: "critical_failure", route_id: base.candidate.route_id } });
    }
    expect(evaluateRoute({ ...base, task_class: "bounded_coding", level: 5, evaluated_at: evaluatedAt, current_config_digest: canonicalDigest({ drift: true }), runs: scoredRuns(20) })).toMatchObject({ decision: "denied", reasons: expect.arrayContaining(["config_drift"]) });
  });

  test("emits canary-only level-4 evidence or production level-5 evidence with at most 30 days validity", async () => {
    const base = await fixture();
    const level4 = evaluateRoute({ ...base, task_class: "bounded_coding", level: 4, evaluated_at: evaluatedAt, current_config_digest: base.candidate.exact_route.config_digest, runs: scoredRuns(20, 1) });
    const level5 = evaluateRoute({ ...base, task_class: "bounded_coding", level: 5, evaluated_at: evaluatedAt, current_config_digest: base.candidate.exact_route.config_digest, runs: scoredRuns(20, 1) });
    if (level4.decision !== "eligible" || level5.decision !== "eligible") throw new Error("passing fixtures must qualify");
    expect(level4).toMatchObject({ decision: "eligible", evidence: { level: 4, exact_route: base.candidate.exact_route } });
    expect(level5).toMatchObject({ decision: "eligible", evidence: { level: 5, exact_route: base.candidate.exact_route } });
    expect(Date.parse(level5.evidence.expires_at) - Date.parse(level5.evidence.evaluated_at)).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1_000);
  });
});
