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
    ceo_input: null,
    transport_ambiguous: false,
    semantic_failure: false,
    ...overrides,
  };
}

describe("action classifier", () => {
  test.each([
    ["succeeded", {}],
    ["transient_infrastructure", { adapter_terminal_code: "rate_limited", observed_terminal_at: null }],
    ["semantic_failure", { semantic_failure: true }],
    ["verification_failure", { required_checks: [{ check_id: "acceptance", passed: false, raw_result_digest: canonicalDigest({ failed: true }) }] }],
    ["policy_violation", { policy_violation: true }],
    ["cancelled", { cancellation_confirmed_at: "2026-08-06T12:00:05.000Z" }],
    ["timed_out", { observed_terminal_at: "2026-08-06T12:02:00.000Z" }],
    ["budget_exhausted", { budget_exhausted: true }],
    ["route_unavailable", { route_available: false, adapter_terminal_code: null, observed_terminal_at: null }],
    ["ceo_input_required", { ceo_input: { decision_type: "route_change", mandate_can_decide: false } }],
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
    "network_error",
    "rate_limited",
    "timeout",
    "NetworkError",
    "ExternalCommandFailed",
  ])("classifies the allowlisted infrastructure code %s as transient", (code) => {
    expect(classifyAction(evidence({ adapter_terminal_code: code, observed_terminal_at: null })).outcome).toBe("transient_infrastructure");
  });

  test.each([
    "test_failed",
    "output_rejected",
    "artifact_missing",
    "model_reported_difficulty",
    "unknown_provider_code",
    // Operator/semantic conditions from the real Hermes taxonomy are NOT retryable.
    "auth_failed",
    "invalid_config",
    "platform_fatal",
    "unknown",
    // Semantic CodeG variants.
    "TaskExecutionFailed",
    "InvalidInput",
  ])("never treats the non-allowlisted failure code %s as transient", (code) => {
    expect(classifyAction(evidence({ adapter_terminal_code: code, observed_terminal_at: null })).outcome).not.toBe("transient_infrastructure");
  });

  test("a semantic failure code is a semantic failure even when the adapter reports a terminal signal", () => {
    expect(classifyAction(evidence({ adapter_terminal_code: "test_failed" })).outcome).toBe("semantic_failure");
  });

  // Rule 3 reserves `ambiguous` for UNKNOWN transport state: "unknown transport state remains
  // ambiguous until bounded lookup". A KNOWN, named failure code is not unknown transport state, so
  // a missing terminal timestamp must not downgrade it to ambiguous and send a decided semantic
  // failure down a reconciliation path instead of remediation.
  test("a known failure code with no terminal timestamp is a semantic failure, not ambiguous", () => {
    expect(classifyAction(evidence({ adapter_terminal_code: "test_failed", observed_terminal_at: null })).outcome).toBe("semantic_failure");
  });

  // Rule 6: "`ceo_input_required` requires a typed proposed change that maps to a CEOInputRequestV1
  // decision type and controller proof that the current TaskSpec/mandate cannot decide it. Model
  // prose alone is insufficient." A bare assertion cannot express either half, so the classifier
  // requires the typed request itself.
  test("requires a typed decision and controller proof for ceo_input_required", () => {
    // A typed decision plus proof the active mandate cannot decide it.
    expect(classifyAction(evidence({
      ceo_input: { decision_type: "route_change", mandate_can_decide: false },
    })).outcome).toBe("ceo_input_required");
  });

  test("refuses ceo_input_required when the active mandate can already decide the change", () => {
    expect(classifyAction(evidence({
      ceo_input: { decision_type: "route_change", mandate_can_decide: true },
    })).outcome).not.toBe("ceo_input_required");
  });

  test("genuinely unknown transport state is still ambiguous", () => {
    // No code at all: nothing is known about the outcome.
    expect(classifyAction(evidence({ adapter_terminal_code: null, observed_terminal_at: null })).outcome).toBe("ambiguous");
    // An explicit transport-ambiguity signal wins even when a code is present.
    expect(classifyAction(evidence({ adapter_terminal_code: "test_failed", transport_ambiguous: true })).outcome).toBe("ambiguous");
  });

  test("lets authoritative success beat a later cancellation but not an earlier confirmed cancellation", () => {
    expect(classifyAction(evidence({ cancellation_confirmed_at: "2026-08-06T12:00:20.000Z" })).outcome).toBe("succeeded");
    expect(classifyAction(evidence({ cancellation_confirmed_at: "2026-08-06T12:00:05.000Z" })).outcome).toBe("cancelled");
    expect(classifyAction(evidence({ observed_terminal_at: "2026-08-06T12:02:00.000Z", cancellation_confirmed_at: "2026-08-06T12:01:30.000Z", classified_at: "2026-08-06T12:02:10.000Z" })).outcome).toBe("timed_out");
  });
});
