import "server-only";

import {
  VerificationReceiptV1Schema,
  canonicalDigest,
  type ActionOutcomeV1,
  type Digest,
  type RouteId,
  type VerificationReceiptV1,
} from "../../../lib/mission-control/contracts";

// ---------------------------------------------------------------------------
// Verification receipt
//
// Binds the TaskSpec/mandate revisions, immutable acceptance checks, source
// artifact digest, the complete realized mutating-route set, the verifier
// identity (deterministic or model route), the path-specific independence
// proof, the tier, raw results, and outcome. A remediation that mutates the
// artifact grows the realized set and invalidates the prior receipt.
// ---------------------------------------------------------------------------

export interface BuildVerificationReceiptInput {
  receipt_id: string;
  task_id: string;
  task_spec_revision: number;
  task_spec_digest: string;
  mandate_id: string;
  mandate_digest: string;
  authority_id: string;
  run_id: string;
  source_artifact_digest: string;
  acceptance_checks: string[];
  realized_mutating_route_ids: string[];
  deterministic_verifier_id: string;
  independence_proof_digest: string;
  independence_tier: 1 | 2;
  outcome: ActionOutcomeV1;
  created_at: string;
}

export function buildVerificationReceipt(input: BuildVerificationReceiptInput): VerificationReceiptV1 {
  return VerificationReceiptV1Schema.parse({
    schema_version: "agentdash.verification-receipt/v1",
    receipt_id: input.receipt_id,
    task_id: input.task_id,
    task_spec_revision: input.task_spec_revision,
    task_spec_digest: input.task_spec_digest,
    mandate_id: input.mandate_id,
    mandate_digest: input.mandate_digest,
    authority_id: input.authority_id,
    command_id: input.outcome.command_id,
    attempt_id: input.outcome.attempt_id,
    run_id: input.run_id,
    work_task_id: null,
    conversation_id: null,
    connection_id: null,
    harness_session_id: null,
    folder_id: null,
    source_artifact_digest: input.source_artifact_digest,
    acceptance_digest: canonicalDigest(input.acceptance_checks),
    acceptance_checks: input.acceptance_checks,
    realized_mutating_route_ids: input.realized_mutating_route_ids,
    verifier_route_id: null,
    route_proof_id: null,
    route_proof_digest: null,
    deterministic_verifier_id: input.deterministic_verifier_id,
    independence_proof_digest: input.independence_proof_digest,
    independence_tier: input.independence_tier,
    raw_results: input.outcome.required_checks,
    outcome: input.outcome,
    created_at: input.created_at,
  });
}

/**
 * True when the current realized mutating-route set contains any route the
 * receipt's verification did not account for — i.e. a remediation mutated the
 * artifact after this verification, invalidating it. Set comparison, so pure
 * reordering of the same lineage is not stale.
 */
export function isVerificationStale(receiptRealizedRouteIds: RouteId[] | string[], currentRealizedRouteIds: RouteId[] | string[]): boolean {
  const accounted = new Set(receiptRealizedRouteIds);
  return currentRealizedRouteIds.some((routeId) => !accounted.has(routeId));
}
