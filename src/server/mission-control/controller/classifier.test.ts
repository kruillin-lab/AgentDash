import { describe, expect, test } from "vitest";

import { canonicalDigest } from "../../../lib/mission-control/contracts";
import { classifyAction, type ActionClassificationEvidence } from "./classifier";

function evidence(overrides: Partial<ActionClassificationEvidence> = {}): ActionClassificationEvidence {
  return {
    command_id: "command-1",
    attempt_id: 1,
    task_id: "task-1",
    evidence_refs: [],
    route_facts: { route_id: null, route_proof_id: null, route_proof_digest: null },
    policy_facts: { policy_version: "policy/v1", policy_digest: canonicalDigest({ policy: 1 }) },
    adapter_terminal_code: "success",
    adapter_sequence: 1,
    required_checks: [{ check_id: "acceptance", passed: true, raw_result_digest: canonicalDigest({ check: 1 }) }],
    files: [],
    budget_snapshot: { max_cost_usd: 1, max_runtime_ms: 60_000, max_attempts: 1, max_provider_tokens: 1_000 },
    usage: { cost_usd: 0.1, runtime_ms: 1_000, tokens: 100 },
    observed_terminal_at: "2026-08-06T12:00:10.000Z",
    classified_at: "2026-08-06T12:00:30.000Z",
    deadline_at: "2026-08-06T12:01:00.000Z",
    cancellation_confirmed_at: null,
    policy_violation: false,
    budget_exhausted: false,
    route_available: true,
    ceo_input_required: false,
    transport_ambiguous: false,
    semantic_failure: false,
    ...overrides,
  };
}

describe("action classifier", () => {
  test.each([
    ["succeeded", {}],
    ["transient_infrastructure", { adapter_terminal_code: "provider_rate_limited", observed_terminal_at: null }],
    ["semantic_failure", { semantic_failure: true }],
    ["verification_failure", { required_checks: [{ check_id: "acceptance", passed: false, raw_result_digest: canonicalDigest({ failed: true }) }] }],
    ["policy_violation", { policy_violation: true }],
    ["cancelled", { cancellation_confirmed_at: "2026-08-06T12:00:05.000Z" }],
    ["timed_out", { observed_terminal_at: "2026-08-06T12:02:00.000Z" }],
    ["budget_exhausted", { budget_exhausted: true }],
    ["route_unavailable", { route_available: false, adapter_terminal_code: null, observed_terminal_at: null }],
    ["ceo_input_required", { ceo_input_required: true }],
    ["ambiguous", { adapter_terminal_code: null, observed_terminal_at: null, transport_ambiguous: true }],
  ] as const)("classifies %s deterministically", (expected, overrides) => {
    expect(classifyAction(evidence(overrides as Partial<ActionClassificationEvidence>)).outcome).toBe(expected);
  });

  // Spec evidence precedence: "A failed or MISSING required check overrides a verifier's prose
  // 'pass'", and success "requires the authoritative adapter terminal signal and every
  // action-specific required check". An empty check set is therefore not success evidence — the
  // classifier itself must not return `succeeded`, independently of the schema's own guard.
  test("treats a missing required check as verification failure, never success", () => {
    expect(classifyAction(evidence({ required_checks: [] })).outcome).toBe("verification_failure");
  });

  // Spec evidence precedence rule 4: "Only an allowlisted adapter/provider failure code is
  // transient_infrastructure. Test failure, rejected output, missing artifact, and model-reported
  // difficulty are semantic or verification failures." The classification is derived from the exact
  // adapter failure code, never asserted by the caller.
  test.each([
    "codeg_unavailable",
    "connection_reset",
    "provider_rate_limited",
    "provider_overloaded",
    "provider_timeout",
    "gateway_error",
  ])("classifies the allowlisted infrastructure code %s as transient", (code) => {
    expect(classifyAction(evidence({ adapter_terminal_code: code, observed_terminal_at: null })).outcome).toBe("transient_infrastructure");
  });

  test.each([
    "test_failed",
    "output_rejected",
    "artifact_missing",
    "model_reported_difficulty",
    "unknown_provider_code",
  ])("never treats the non-allowlisted failure code %s as transient", (code) => {
    expect(classifyAction(evidence({ adapter_terminal_code: code, observed_terminal_at: null })).outcome).not.toBe("transient_infrastructure");
  });

  test("a semantic failure code is a semantic failure even when the adapter reports a terminal signal", () => {
    expect(classifyAction(evidence({ adapter_terminal_code: "test_failed" })).outcome).toBe("semantic_failure");
  });

  test("lets authoritative success beat a later cancellation but not an earlier confirmed cancellation", () => {
    expect(classifyAction(evidence({ cancellation_confirmed_at: "2026-08-06T12:00:20.000Z" })).outcome).toBe("succeeded");
    expect(classifyAction(evidence({ cancellation_confirmed_at: "2026-08-06T12:00:05.000Z" })).outcome).toBe("cancelled");
    expect(classifyAction(evidence({ observed_terminal_at: "2026-08-06T12:02:00.000Z", cancellation_confirmed_at: "2026-08-06T12:01:30.000Z", classified_at: "2026-08-06T12:02:10.000Z" })).outcome).toBe("timed_out");
  });
});
