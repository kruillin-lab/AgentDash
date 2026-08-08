import { describe, expect, test } from "vitest";

import { buildMissionControlHealth } from "./health";

const NOW = "2026-08-06T12:00:00.000Z";

describe("buildMissionControlHealth", () => {
  test("defaults to a fail-closed disabled dispatch with no manufactured evidence", () => {
    const health = buildMissionControlHealth({ now: NOW, dispatch_env: undefined, proofs: [], auto_snapshot: null });
    expect(health.dispatch).toMatchObject({ mode: "disabled", ready: false });
    expect(health.dispatch.reasons.length).toBeGreaterThan(0);
    expect(health.auto_launch.eligible).toBe(false);
    expect(health.proofs).toEqual([]);
  });

  test("a hostile dispatch mode normalizes to disabled", () => {
    const health = buildMissionControlHealth({ now: NOW, dispatch_env: "production", proofs: [], auto_snapshot: null });
    expect(health.dispatch.mode).toBe("disabled");
  });

  test("enabled mode without a proof conjunction is still not ready", () => {
    const health = buildMissionControlHealth({ now: NOW, dispatch_env: "enabled", proofs: [], auto_snapshot: null });
    expect(health.dispatch.mode).toBe("enabled");
    expect(health.dispatch.ready).toBe(false);
    expect(health.dispatch.reasons.join(" ")).toMatch(/evidence|conjunction/i);
  });

  test("a complete proven snapshot reports ready and eligible", () => {
    const health = buildMissionControlHealth({
      now: NOW,
      dispatch_env: "enabled",
      proofs: [{ id: "reconciliation", expires_at: "2026-08-06T12:15:00.000Z" }],
      auto_snapshot: {
        aggregate_cost_usd: 0.5, aggregate_runtime_ms: 600_000, cost_enforceable: true, runtime_enforceable: true,
        cancel_enforceable: true, workspace_safe: true, capability_risk: false, terminal_path_complete: true,
        reserves_held: true, route_level5: true, proof_current: true, verification_present: true, finalization_present: true,
      },
    });
    expect(health.dispatch.ready).toBe(true);
    expect(health.auto_launch.eligible).toBe(true);
    expect(health.proofs).toEqual([{ id: "reconciliation", expires_at: "2026-08-06T12:15:00.000Z" }]);
  });
});
