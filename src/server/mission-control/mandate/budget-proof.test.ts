import { describe, expect, test } from "vitest";

import { canonicalDigest } from "../../../lib/mission-control/contracts/common";
import { proveMandateBudget, type BudgetProofInput } from "./budget-proof";

const actionLimit = { max_cost_usd: 1, max_runtime_ms: 1_000, max_output_tokens: 100, max_provider_tokens: 200 };
const reserve = { max_cost_usd: 1, max_runtime_ms: 500, max_attempts: 1, max_provider_tokens: 50 };

function validInput(): BudgetProofInput {
  const policy = {
    schema_version: "agentdash.budget-policy-snapshot/v1" as const,
    action_limits: { execute: actionLimit, verify: actionLimit, finalize: actionLimit },
    task_reserves: { verification: reserve, finalization: reserve, cancellation: reserve, reconciliation: reserve },
  };
  return {
    paths: [{ node_ids: ["execute", "verify", "finalize"] }],
    aggregate_budget: { max_cost_usd: 7, max_runtime_ms: 5_000, max_attempts: 7, max_provider_tokens: 800 },
    mandate_action_limits: structuredClone(policy.action_limits),
    mandate_budget_policy_digest: canonicalDigest(policy),
    claimed_task_reserves: structuredClone(policy.task_reserves),
    policy,
  };
}

const codes = (input: BudgetProofInput) => proveMandateBudget(input).reasons.map((reason) => reason.code);

describe("all-path mandate budget proof", () => {
  test("charges each action visit and the four task reserves exactly once", () => {
    const result = proveMandateBudget(validInput());

    expect(result.ok).toBe(true);
    expect(result.component_maxima).toEqual({ max_cost_usd: 7, max_runtime_ms: 5_000, max_attempts: 7, max_provider_tokens: 800 });
  });

  test.each([
    ["max_cost_usd", 6, "budget_path_exceeds_cost"],
    ["max_runtime_ms", 4_999, "budget_path_exceeds_runtime"],
    ["max_attempts", 6, "budget_path_exceeds_attempts"],
    ["max_provider_tokens", 799, "budget_path_exceeds_provider_tokens"],
  ] as const)("rejects every path that exceeds aggregate %s", (field, ceiling, reason) => {
    const input = validInput();
    input.aggregate_budget[field] = ceiling;

    expect(codes(input)).toContain(reason);
  });

  test("checks every reachable capped path rather than one claimed worst case", () => {
    const input = validInput();
    input.policy.action_limits.remediate = { ...actionLimit, max_cost_usd: 20 };
    input.mandate_action_limits.remediate = { ...actionLimit, max_cost_usd: 20 };
    input.paths.push({ node_ids: ["execute", "remediate", "verify", "finalize"] });
    input.mandate_budget_policy_digest = canonicalDigest(input.policy);

    expect(codes(input)).toContain("budget_path_exceeds_cost");
  });

  test("rejects missing provider-token ceilings and reserves not bound to policy", () => {
    const missingTokens = validInput();
    delete (missingTokens.mandate_action_limits.execute as Partial<typeof actionLimit>).max_provider_tokens;
    expect(codes(missingTokens)).toContain("budget_action_limits_unbound");

    const reserveMismatch = validInput();
    reserveMismatch.claimed_task_reserves.verification.max_attempts = 2;
    expect(codes(reserveMismatch)).toContain("budget_reserves_unbound");
  });

  test("fails closed on a missing policy digest or unsafe arithmetic", () => {
    const missingDigest = validInput();
    missingDigest.mandate_budget_policy_digest = null;
    expect(codes(missingDigest)).toContain("budget_policy_unbound");

    const overflow = validInput();
    overflow.policy.action_limits.execute.max_runtime_ms = Number.MAX_SAFE_INTEGER;
    overflow.mandate_action_limits.execute.max_runtime_ms = Number.MAX_SAFE_INTEGER;
    overflow.mandate_budget_policy_digest = canonicalDigest(overflow.policy);
    expect(codes(overflow)).toContain("budget_arithmetic_overflow");
  });
});
