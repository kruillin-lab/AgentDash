import { describe, expect, test } from "vitest";

import { ActionOutcomeV1Schema, VerificationReceiptV1Schema, canonicalDigest, type ActionOutcomeV1 } from "../../../lib/mission-control/contracts";
import { buildVerificationReceipt, isVerificationStale } from "./receipt";

const digest = "a".repeat(64);
const timestamp = "2026-08-06T12:00:00.000Z";
const budget = { max_cost_usd: 1, max_runtime_ms: 60_000, max_attempts: 1, max_provider_tokens: 1_000 };

function verificationOutcome(checks: { check_id: string; passed: boolean; raw_result_digest: string }[]): ActionOutcomeV1 {
  return ActionOutcomeV1Schema.parse({
    schema_version: "agentdash.action-outcome/v1",
    outcome: checks.every((check) => check.passed) ? "succeeded" : "verification_failure",
    command_id: "command-verify",
    attempt_id: 1,
    task_id: "task-1",
    evidence_refs: [],
    route_facts: { route_id: null, route_proof_id: null, route_proof_digest: null },
    policy_facts: { policy_version: "policy-1", policy_digest: digest },
    adapter_terminal_code: "success",
    adapter_sequence: 1,
    required_checks: checks,
    files: [],
    budget_snapshot: budget,
    usage: { cost_usd: 0, runtime_ms: 1, tokens: 0 },
    classifier_policy_version: "action-classifier/v1",
    rationale: "deterministic verification",
    uncertainty: [],
    cancellation_detail: null,
    failure_detail: null,
    native_session: { kind: "not_applicable" },
  });
}

function receiptInput(realized: string[], checks = [{ check_id: "check-1", passed: true, raw_result_digest: digest }]) {
  const outcome = verificationOutcome(checks);
  return {
    receipt_id: "receipt-verify-1",
    task_id: "task-1",
    task_spec_revision: 1,
    task_spec_digest: digest,
    mandate_id: "mandate-1",
    mandate_digest: digest,
    authority_id: "authority-1",
    run_id: "run-1",
    source_artifact_digest: digest,
    acceptance_checks: ["check-1"],
    realized_mutating_route_ids: realized,
    deterministic_verifier_id: "deterministic-verifier-1",
    independence_proof_digest: digest,
    independence_tier: 2 as const,
    outcome,
    created_at: timestamp,
  };
}

describe("buildVerificationReceipt", () => {
  test("builds a strict receipt binding the realized mutating-route set and independence proof", () => {
    const receipt = buildVerificationReceipt(receiptInput(["route-primary"]));
    expect(() => VerificationReceiptV1Schema.parse(receipt)).not.toThrow();
    expect(receipt.realized_mutating_route_ids).toEqual(["route-primary"]);
    expect(receipt.independence_tier).toBe(2);
    expect(receipt.deterministic_verifier_id).toBe("deterministic-verifier-1");
  });

  test("the acceptance digest binds the exact immutable checks", () => {
    const receipt = buildVerificationReceipt(receiptInput(["route-primary"]));
    expect(receipt.acceptance_digest).toBe(canonicalDigest(["check-1"]));
  });
});

describe("isVerificationStale", () => {
  test("a remediation that adds a realized mutating route invalidates the prior receipt", () => {
    expect(isVerificationStale(["route-primary"], ["route-primary", "route-remediate"])).toBe(true);
  });

  test("an unchanged realized set keeps the receipt valid", () => {
    expect(isVerificationStale(["route-primary"], ["route-primary"])).toBe(false);
  });

  test("any reordering of the same set is not stale", () => {
    expect(isVerificationStale(["route-a", "route-b"], ["route-b", "route-a"])).toBe(false);
  });
});
