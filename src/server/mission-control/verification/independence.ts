import "server-only";

import { canonicalDigest, type Digest, type ExactRouteV1 } from "../../../lib/mission-control/contracts";

// ---------------------------------------------------------------------------
// Path-specific verifier independence
//
// The controller maintains the realized mutating-route set: every model-backed
// route that changed the candidate artifact since the last accepted immutable
// baseline (a remediation that mutates adds its route and invalidates earlier
// verification). Runtime verification re-proves independence against that set.
//
//  - Tier 1: a separate read-only verifier that cannot mutate the deliverable.
//  - Tier 2: a trusted deterministic verifier, OR a model route whose provider
//    AND outer harness each differ from every realized mutating route.
// ---------------------------------------------------------------------------

export type VerifierCandidate =
  | { kind: "deterministic"; verifier_id: string }
  | { kind: "model"; route: ExactRouteV1 };

export type IndependenceTier = "tier_1" | "tier_2";

export interface VerifierIndependenceProof {
  tier: 1 | 2;
  independent: true;
  verifier_digest: Digest;
  realized_route_digests: Digest[];
  proof_digest: Digest;
}

export function proveVerifierIndependence(
  realizedRoutes: ExactRouteV1[],
  candidate: VerifierCandidate,
  tier: IndependenceTier,
): VerifierIndependenceProof {
  const tierNumber = tier === "tier_1" ? 1 : 2;
  const realizedDigests = realizedRoutes.map((route) => canonicalDigest(route));

  if (candidate.kind === "deterministic") {
    // A trusted deterministic verifier is read-only and satisfies both tiers.
    const verifierDigest = canonicalDigest({ kind: "deterministic", verifier_id: candidate.verifier_id });
    return { tier: tierNumber, independent: true, verifier_digest: verifierDigest, realized_route_digests: realizedDigests, proof_digest: canonicalDigest({ tier: tierNumber, verifier_digest: verifierDigest, realized_route_digests: realizedDigests }) };
  }

  // candidate.kind === "model"
  if (tierNumber === 1) {
    throw new Error("Tier 1 verification requires a separate read-only deterministic verifier, not a model-backed route.");
  }

  // Tier 2: the verifier's provider AND outer harness must each differ from
  // every route in the realized mutating-route set.
  for (const realized of realizedRoutes) {
    if (candidate.route.provider === realized.provider) {
      throw new Error(`Verifier is not independent: it shares a provider (${realized.provider}) with a realized mutating route.`);
    }
    if (candidate.route.outer_harness === realized.outer_harness) {
      throw new Error(`Verifier is not independent: it shares an outer harness (${realized.outer_harness}) with a realized mutating route.`);
    }
  }

  const verifierDigest = canonicalDigest({ kind: "model", route: candidate.route });
  return { tier: 2, independent: true, verifier_digest: verifierDigest, realized_route_digests: realizedDigests, proof_digest: canonicalDigest({ tier: 2, verifier_digest: verifierDigest, realized_route_digests: realizedDigests }) };
}
