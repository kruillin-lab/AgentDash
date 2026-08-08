import { describe, expect, test } from "vitest";

import type { Digest, ExactRouteV1 } from "../../../lib/mission-control/contracts";
import { proveVerifierIndependence, type VerifierCandidate } from "./independence";

const route = (outer_harness: string, provider: string, model = "m"): ExactRouteV1 => ({ outer_harness, provider, model, agent_type: "worker", mode: "standard", config_digest: "d".repeat(64) as Digest });

const terraViaCodex = route("codex", "terra");
const terraViaClaude = route("claude-code", "terra");
const sonnetViaClaude = route("claude-code", "sonnet");

const deterministic: VerifierCandidate = { kind: "deterministic", verifier_id: "deterministic-verifier-1" };
const modelRoute = (r: ReturnType<typeof route>): VerifierCandidate => ({ kind: "model", route: r });

describe("proveVerifierIndependence tier 1", () => {
  test("a separate read-only deterministic verifier is accepted", () => {
    const proof = proveVerifierIndependence([terraViaCodex], deterministic, "tier_1");
    expect(proof).toMatchObject({ tier: 1, independent: true });
    expect(typeof proof.proof_digest).toBe("string");
  });

  test("a model-backed candidate is rejected for tier 1 even on an unrelated route", () => {
    expect(() => proveVerifierIndependence([terraViaCodex], modelRoute(sonnetViaClaude), "tier_1")).toThrow(/read.only|deterministic|tier 1/i);
  });
});

describe("proveVerifierIndependence tier 2", () => {
  test("a trusted deterministic verifier satisfies tier 2", () => {
    const proof = proveVerifierIndependence([terraViaCodex], deterministic, "tier_2");
    expect(proof).toMatchObject({ tier: 2, independent: true });
  });

  test("a model route sharing a provider with a realized mutating route is rejected", () => {
    expect(() => proveVerifierIndependence([terraViaCodex], modelRoute(terraViaClaude), "tier_2")).toThrow(/provider/i);
  });

  test("a model route sharing an outer harness with a realized mutating route is rejected", () => {
    expect(() => proveVerifierIndependence([terraViaCodex], modelRoute(route("codex", "sonnet")), "tier_2")).toThrow(/harness/i);
  });

  test("a model route independent in both provider and harness is accepted", () => {
    const proof = proveVerifierIndependence([terraViaCodex], modelRoute(sonnetViaClaude), "tier_2");
    expect(proof).toMatchObject({ tier: 2, independent: true });
  });

  test("independence is recomputed over the whole realized set including remediation routes", () => {
    expect(() => proveVerifierIndependence([terraViaCodex, sonnetViaClaude], modelRoute(sonnetViaClaude), "tier_2")).toThrow(/provider|harness/i);
    const proof = proveVerifierIndependence([terraViaCodex, sonnetViaClaude], modelRoute(route("kimi-code", "kimi")), "tier_2");
    expect(proof).toMatchObject({ tier: 2, independent: true });
  });
});
