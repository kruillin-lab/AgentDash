import "server-only";

// ---------------------------------------------------------------------------
// Auto-dispatch eligibility
//
// A task auto-launches only when EVERY low-risk, low-cost condition holds. The
// predicate is exhaustive: each failed condition appends a reason, and one
// failure makes the whole snapshot ineligible. Auto mode skips only the CEO
// activation command — it never skips card creation, mandate validation,
// one-time action authority, observability, verification, finalization,
// receipts, or terminal reconciliation.
// ---------------------------------------------------------------------------

export const AUTO_MAX_AGGREGATE_COST_USD = 1.0;
export const AUTO_MAX_AGGREGATE_RUNTIME_MS = 30 * 60 * 1_000;

export interface AutoEligibilitySnapshotV1 {
  aggregate_cost_usd: number;
  aggregate_runtime_ms: number;
  /** Cost ceiling is enforceable via telemetry + a bounded-lag cancellation path. */
  cost_enforceable: boolean;
  /** Runtime ceiling is enforceable via the controller's own watchdog. */
  runtime_enforceable: boolean;
  /** A proven CodeG cancellation / safe-stop path with bounded latency exists. */
  cancel_enforceable: boolean;
  /** Work is read-only or confined to a validated local workspace/isolated worktree. */
  workspace_safe: boolean;
  /** True when any production/deploy/publish/payment/credential/destructive capability is required. */
  capability_risk: boolean;
  /** The complete terminal path, attempt ceilings, and safe finalization are explicit. */
  terminal_path_complete: boolean;
  /** Verification/finalization/cancellation/reconciliation reserves are held once. */
  reserves_held: boolean;
  /** Every model-backed route has a current level-5 task-class proof. */
  route_level5: boolean;
  /** No proof is stale or expired. */
  proof_current: boolean;
  verification_present: boolean;
  finalization_present: boolean;
}

export interface AutoEligibilityV1 {
  eligible: boolean;
  reasons: string[];
}

export function evaluateAutoEligibility(snapshot: AutoEligibilitySnapshotV1): AutoEligibilityV1 {
  const reasons: string[] = [];

  if (!(snapshot.aggregate_cost_usd >= 0 && snapshot.aggregate_cost_usd <= AUTO_MAX_AGGREGATE_COST_USD)) {
    reasons.push(`Aggregate cost must be hard-bounded at $${AUTO_MAX_AGGREGATE_COST_USD.toFixed(2)}.`);
  }
  if (!(snapshot.aggregate_runtime_ms >= 0 && snapshot.aggregate_runtime_ms <= AUTO_MAX_AGGREGATE_RUNTIME_MS)) {
    reasons.push("Aggregate runtime ceiling must be at most 30 minutes.");
  }
  if (!snapshot.cost_enforceable) reasons.push("The cost ceiling is not enforceable; an estimate alone never qualifies.");
  if (!snapshot.runtime_enforceable) reasons.push("The runtime ceiling is not enforceable by a controller watchdog.");
  if (!snapshot.cancel_enforceable) reasons.push("There is no proven cancellation / safe-stop path with bounded latency.");
  if (!snapshot.workspace_safe) reasons.push("Work must be read-only or confined to a validated local workspace.");
  if (snapshot.capability_risk) reasons.push("A production, deployment, publishing, payment, credential, or destructive capability is required.");
  if (!snapshot.terminal_path_complete) reasons.push("The complete terminal path and safe finalization action are not explicit.");
  if (!snapshot.reserves_held) reasons.push("Task-level verification/finalization/cancellation/reconciliation reserves are not held.");
  if (!snapshot.route_level5) reasons.push("Every model-backed route requires a current level-5 task-class proof.");
  if (!snapshot.proof_current) reasons.push("A required proof is stale or expired.");
  if (!snapshot.verification_present) reasons.push("Independent verification is not present.");
  if (!snapshot.finalization_present) reasons.push("Exact finalization is not present.");

  return { eligible: reasons.length === 0, reasons };
}
