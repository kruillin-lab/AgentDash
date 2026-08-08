import "server-only";

import {
  ActionOutcomeV1Schema,
  type ActionOutcome,
  type ActionOutcomeV1,
  type BudgetV1,
  type Digest,
  type EventId,
  type RequiredCheckResultV1,
  type RouteId,
  type RouteProofId,
} from "../../../lib/mission-control/contracts";

/**
 * The closed allowlist of adapter/provider failure codes that may be classified as
 * `transient_infrastructure`. Evidence precedence rule 4 permits only an allowlisted code; test
 * failure, rejected output, missing artifact, and model-reported difficulty are semantic or
 * verification failures. Membership is exact — never a prefix or substring match — so a new or
 * unrecognized provider code degrades to a semantic failure rather than silently earning a retry.
 */
export const TRANSIENT_INFRASTRUCTURE_CODES = Object.freeze([
  "codeg_unavailable",
  "connection_reset",
  "gateway_error",
  "provider_overloaded",
  "provider_rate_limited",
  "provider_timeout",
] as const);

const TRANSIENT_CODE_SET: ReadonlySet<string> = new Set(TRANSIENT_INFRASTRUCTURE_CODES);

/** True only for an exact allowlisted infrastructure failure code. */
export function isTransientInfrastructureCode(code: string | null): boolean {
  return code !== null && TRANSIENT_CODE_SET.has(code);
}

export interface ActionClassificationEvidence {
  command_id: string;
  attempt_id: number;
  task_id: string;
  evidence_refs: EventId[];
  route_facts: { route_id: RouteId | null; route_proof_id: RouteProofId | null; route_proof_digest: Digest | null };
  policy_facts: { policy_version: string; policy_digest: Digest };
  adapter_terminal_code: string | null;
  adapter_sequence: number | null;
  required_checks: RequiredCheckResultV1[];
  files: Array<{ path: string; digest: Digest; kind: "changed" | "produced" | "missing" }>;
  budget_snapshot: BudgetV1;
  usage: { cost_usd: number | null; runtime_ms: number | null; tokens: number | null };
  observed_terminal_at: string | null;
  classified_at: string;
  deadline_at: string;
  cancellation_confirmed_at: string | null;
  policy_violation: boolean;
  budget_exhausted: boolean;
  route_available: boolean;
  ceo_input_required: boolean;
  transport_ambiguous: boolean;
  // NOTE: there is deliberately no caller-supplied `transient_infrastructure` flag. That outcome is
  // derived from `adapter_terminal_code` against TRANSIENT_INFRASTRUCTURE_CODES, so an adapter or
  // worker cannot declare its own failure retryable.
  semantic_failure: boolean;
}

function chooseOutcome(evidence: ActionClassificationEvidence): ActionOutcome {
  if (evidence.policy_violation) return "policy_violation";
  if (evidence.ceo_input_required) return "ceo_input_required";
  if (evidence.budget_exhausted) return "budget_exhausted";
  if (!evidence.route_available) return "route_unavailable";

  const terminalAt = evidence.observed_terminal_at === null ? null : Date.parse(evidence.observed_terminal_at);
  const cancellationAt = evidence.cancellation_confirmed_at === null ? null : Date.parse(evidence.cancellation_confirmed_at);
  const deadlineAt = Date.parse(evidence.deadline_at);
  if (cancellationAt !== null && cancellationAt <= deadlineAt && (terminalAt === null || cancellationAt <= terminalAt)) return "cancelled";
  if ((terminalAt !== null && terminalAt > deadlineAt) || (terminalAt === null && Date.parse(evidence.classified_at) >= deadlineAt)) return "timed_out";
  // Only an exact allowlisted adapter/provider failure code is transient infrastructure.
  if (isTransientInfrastructureCode(evidence.adapter_terminal_code)) return "transient_infrastructure";
  if (evidence.transport_ambiguous || terminalAt === null || evidence.adapter_terminal_code === null) return "ambiguous";
  if (evidence.semantic_failure || evidence.adapter_terminal_code !== "success") return "semantic_failure";
  // A failed OR MISSING required check overrides a claim of success: an empty check set is not
  // success evidence, so it classifies as a verification failure rather than falling through.
  if (evidence.required_checks.length === 0 || evidence.required_checks.some((check) => !check.passed)) return "verification_failure";
  return "succeeded";
}

export function classifyAction(evidence: ActionClassificationEvidence): ActionOutcomeV1 {
  const outcome = chooseOutcome(evidence);
  return ActionOutcomeV1Schema.parse({
    schema_version: "agentdash.action-outcome/v1",
    outcome,
    command_id: evidence.command_id,
    attempt_id: evidence.attempt_id,
    task_id: evidence.task_id,
    evidence_refs: evidence.evidence_refs,
    route_facts: evidence.route_facts,
    policy_facts: evidence.policy_facts,
    adapter_terminal_code: evidence.adapter_terminal_code,
    adapter_sequence: evidence.adapter_sequence,
    required_checks: evidence.required_checks,
    files: evidence.files,
    budget_snapshot: evidence.budget_snapshot,
    usage: evidence.usage,
    classifier_policy_version: "action-classifier/v1",
    rationale: `Deterministic evidence precedence classified ${outcome}.`,
    uncertainty: outcome === "ambiguous" ? ["Authoritative terminal evidence is incomplete."] : [],
    cancellation_detail: outcome === "cancelled" ? "Cancellation was confirmed before authoritative completion." : null,
    failure_detail: ["succeeded", "cancelled"].includes(outcome) ? null : `Action classified ${outcome}.`,
    native_session: { kind: "not_applicable" },
  });
}
