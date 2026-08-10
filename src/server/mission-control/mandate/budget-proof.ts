import { canonicalDigest, type BudgetV1, type Digest } from "../../../lib/mission-control/contracts/common";

export interface ActionBudgetLimitV1 {
  max_cost_usd: number;
  max_runtime_ms: number;
  max_output_tokens: number;
  max_provider_tokens: number;
}

export interface BudgetPolicySnapshotShapeV1 {
  schema_version: "agentdash.budget-policy-snapshot/v1";
  action_limits: Record<string, ActionBudgetLimitV1>;
  task_reserves: Record<"verification" | "finalization" | "cancellation" | "reconciliation", BudgetV1>;
}

export interface BudgetProofInput {
  paths: Array<{ node_ids: string[] }>;
  aggregate_budget: BudgetV1;
  mandate_action_limits: Record<string, ActionBudgetLimitV1>;
  mandate_budget_policy_digest: Digest | string | null;
  claimed_task_reserves: BudgetPolicySnapshotShapeV1["task_reserves"];
  policy: BudgetPolicySnapshotShapeV1;
}

export interface BudgetProofReason {
  code: string;
  message: string;
}

export interface BudgetProofResult {
  ok: boolean;
  reasons: BudgetProofReason[];
  component_maxima: BudgetV1 | null;
}

const reserveKeys = ["verification", "finalization", "cancellation", "reconciliation"] as const;
const aggregateKeys = ["max_cost_usd", "max_runtime_ms", "max_attempts", "max_provider_tokens"] as const;
const actionKeys = ["max_cost_usd", "max_runtime_ms", "max_output_tokens", "max_provider_tokens"] as const;

function addReason(reasons: BudgetProofReason[], code: string, message: string): void {
  if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, message });
}

function validNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function validSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validActionLimit(value: ActionBudgetLimitV1 | undefined): value is ActionBudgetLimitV1 {
  return !!value && validNonnegative(value.max_cost_usd) && validSafeInteger(value.max_runtime_ms) && value.max_runtime_ms > 0 && validSafeInteger(value.max_output_tokens) && validSafeInteger(value.max_provider_tokens);
}

function validBudget(value: BudgetV1 | undefined): value is BudgetV1 {
  return !!value && validNonnegative(value.max_cost_usd) && validSafeInteger(value.max_runtime_ms) && value.max_runtime_ms > 0 && validSafeInteger(value.max_attempts) && value.max_attempts > 0 && validSafeInteger(value.max_provider_tokens);
}

function sameRecord(left: Record<string, ActionBudgetLimitV1>, right: Record<string, ActionBudgetLimitV1>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && actionKeys.every((field) => left[key]?.[field] === right[key]?.[field]));
}

function sameBudget(left: BudgetV1, right: BudgetV1): boolean {
  return aggregateKeys.every((field) => left[field] === right[field]);
}

function checkedAdd(left: number, right: number): number | null {
  const result = left + right;
  return Number.isFinite(result) && Math.abs(result) <= Number.MAX_SAFE_INTEGER ? result : null;
}

function addComponent(target: BudgetV1, field: keyof BudgetV1, value: number): boolean {
  const next = checkedAdd(target[field], value);
  if (next === null || (field !== "max_cost_usd" && !Number.isSafeInteger(next))) return false;
  target[field] = next;
  return true;
}

export function proveMandateBudget(input: BudgetProofInput): BudgetProofResult {
  const reasons: BudgetProofReason[] = [];
  const policyActionIds = Object.keys(input.policy.action_limits);
  if (!input.mandate_budget_policy_digest || input.mandate_budget_policy_digest !== canonicalDigest(input.policy)) {
    addReason(reasons, "budget_policy_unbound", "The mandate does not bind the exact independent budget policy snapshot.");
  }
  if (policyActionIds.length === 0 || policyActionIds.some((id) => !validActionLimit(input.policy.action_limits[id])) || Object.values(input.mandate_action_limits).some((limit) => !validActionLimit(limit)) || !sameRecord(input.mandate_action_limits, input.policy.action_limits)) {
    addReason(reasons, "budget_action_limits_unbound", "Mandate action ceilings must exactly match the independent budget policy.");
  }
  const policyReservesValid = reserveKeys.every((key) => validBudget(input.policy.task_reserves[key]));
  const reservesMatch = policyReservesValid && reserveKeys.every((key) => validBudget(input.claimed_task_reserves[key]) && sameBudget(input.claimed_task_reserves[key], input.policy.task_reserves[key]));
  if (!reservesMatch) addReason(reasons, "budget_reserves_unbound", "Mandate task reserves must exactly match the independent budget policy.");
  if (!validBudget(input.aggregate_budget)) addReason(reasons, "budget_aggregate_invalid", "Aggregate budget is not finite and enforceable.");

  if (reasons.some((reason) => ["budget_action_limits_unbound", "budget_reserves_unbound", "budget_aggregate_invalid"].includes(reason.code))) {
    return { ok: false, reasons, component_maxima: null };
  }

  const reserveTotal: BudgetV1 = { max_cost_usd: 0, max_runtime_ms: 0, max_attempts: 0, max_provider_tokens: 0 };
  for (const reserveKey of reserveKeys) {
    const reserve = input.policy.task_reserves[reserveKey];
    for (const field of aggregateKeys) {
      if (!addComponent(reserveTotal, field, reserve[field])) {
        addReason(reasons, "budget_arithmetic_overflow", "Budget reserve arithmetic exceeded safe finite bounds.");
        return { ok: false, reasons, component_maxima: null };
      }
    }
  }

  const componentMaxima: BudgetV1 = { ...reserveTotal };
  if (input.paths.length === 0) addReason(reasons, "budget_missing_paths", "Budget proof requires every finite reachable path.");
  for (const path of input.paths) {
    const total: BudgetV1 = { ...reserveTotal };
    for (const nodeId of path.node_ids) {
      const limit = input.policy.action_limits[nodeId];
      if (!limit) {
        addReason(reasons, "budget_unknown_node", "A reachable path names an action without a bound ceiling.");
        continue;
      }
      const additions: Array<[keyof BudgetV1, number]> = [
        ["max_cost_usd", limit.max_cost_usd],
        ["max_runtime_ms", limit.max_runtime_ms],
        ["max_attempts", 1],
        ["max_provider_tokens", limit.max_provider_tokens],
      ];
      for (const [field, value] of additions) {
        if (!addComponent(total, field, value)) addReason(reasons, "budget_arithmetic_overflow", "Path budget arithmetic exceeded safe finite bounds.");
      }
    }
    for (const field of aggregateKeys) componentMaxima[field] = Math.max(componentMaxima[field], total[field]);
    if (total.max_cost_usd > input.aggregate_budget.max_cost_usd) addReason(reasons, "budget_path_exceeds_cost", "A reachable path exceeds aggregate cost.");
    if (total.max_runtime_ms > input.aggregate_budget.max_runtime_ms) addReason(reasons, "budget_path_exceeds_runtime", "A reachable path exceeds aggregate runtime.");
    if (total.max_attempts > input.aggregate_budget.max_attempts) addReason(reasons, "budget_path_exceeds_attempts", "A reachable path exceeds aggregate attempts.");
    if (total.max_provider_tokens > input.aggregate_budget.max_provider_tokens) addReason(reasons, "budget_path_exceeds_provider_tokens", "A reachable path exceeds aggregate provider tokens.");
  }

  return { ok: reasons.length === 0, reasons, component_maxima: componentMaxima };
}
