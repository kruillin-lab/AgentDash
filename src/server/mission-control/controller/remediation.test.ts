import { describe, expect, test } from "vitest";

import { assertRemediationIndependence, buildRemediationCycle } from "./remediation";

const route = (provider: string, outer_harness: string) => ({ outer_harness, provider, model: "m", agent_type: "worker", mode: "standard", config_digest: "d".repeat(64) });

const remediateNode = {
  node_id: "remediate-1",
  action_role: "remediate" as const,
  executor_kind: "codeg_worker" as const,
  route_id: "route-remediate",
  route_proof_id: "proof-remediate",
  route_proof_digest: "d".repeat(64),
  remediation_scope: { finding_classes: ["lint", "typecheck"], artifact_scope: ["src/**"] },
};

describe("buildRemediationCycle", () => {
  test("bounds the cycle to the mandate's named finding classes and artifact scope", () => {
    const cycle = buildRemediationCycle(remediateNode, { finding_classes: ["lint"], artifact_scope: ["src/a.ts"] });
    expect(cycle).toEqual({ kind: "in_scope", scope: { finding_classes: ["lint"], artifact_scope: ["src/a.ts"] } });
  });

  test("an empty intersection is not a runnable remediation", () => {
    expect(() => buildRemediationCycle(remediateNode, { finding_classes: [], artifact_scope: [] })).toThrow(/scope|bounded|empty/i);
  });

  test("findings outside the named scope are an expansion requiring typed CEO input", () => {
    const cycle = buildRemediationCycle(remediateNode, { finding_classes: ["security"], artifact_scope: ["src/a.ts"] });
    expect(cycle).toEqual({ kind: "expansion", decision_type: "capability_change" });
  });

  // The plan enumerates expansion kinds distinctly, so the typed request must name the decision the
  // CEO is actually being asked to make. Widening the artifact boundary is a workspace change, not a
  // capability change.
  test("artifact paths outside the named scope are a workspace expansion", () => {
    const cycle = buildRemediationCycle(remediateNode, { finding_classes: ["lint"], artifact_scope: ["secrets/**"] });
    expect(cycle).toEqual({ kind: "expansion", decision_type: "workspace_change" });
  });

  test("an unnamed finding class takes precedence when both scopes are exceeded", () => {
    const cycle = buildRemediationCycle(remediateNode, { finding_classes: ["security"], artifact_scope: ["secrets/**"] });
    expect(cycle).toEqual({ kind: "expansion", decision_type: "capability_change" });
  });
});

describe("assertRemediationIndependence", () => {
  test("the verifier may not repair its own finding on the same route", () => {
    expect(() => assertRemediationIndependence({ verifier_route: route("openai", "codex"), remediation_route: route("openai", "codex") })).toThrow(/independ/i);
  });

  test("a remediation route sharing the provider with the verifier is rejected", () => {
    expect(() => assertRemediationIndependence({ verifier_route: route("openai", "codex"), remediation_route: route("openai", "claude-code") })).toThrow(/provider/i);
  });

  test("a remediation route sharing the outer harness with the verifier is rejected", () => {
    expect(() => assertRemediationIndependence({ verifier_route: route("openai", "codex"), remediation_route: route("anthropic", "codex") })).toThrow(/harness/i);
  });

  test("a fully independent remediation route is accepted", () => {
    expect(() => assertRemediationIndependence({ verifier_route: route("openai", "codex"), remediation_route: route("anthropic", "claude-code") })).not.toThrow();
  });
});
