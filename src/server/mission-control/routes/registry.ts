import "server-only";

import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  GetActivationQualificationInputSchema,
  GetActivationQualificationResultSchema,
  RouteEvidenceV1Schema,
  TimestampSchema,
  canonicalDigest,
  canonicalizeActivationRoutes,
  type ExactRouteV1,
  type GetActivationQualificationInput,
  type GetActivationQualificationResult,
  type RouteEvidenceV1,
  type RouteId,
  type TaskClass,
  type Timestamp,
} from "../../../lib/mission-control/contracts";
import type { RouteRegistryPort } from "../ports";
import {
  QualificationEvidenceV1Schema,
  QualificationRevocationV1Schema,
  canonicalQualificationEvidenceDigest,
  canonicalQualificationRevocationDigest,
  type QualificationEvidenceV1,
  type QualificationRevocationV1,
} from "./evaluator";
import type { RouteInventory } from "./inventory";

export type RouteEligibilityStatus = "canary_only" | "production" | "denied";

export class RouteEvidenceError extends Error {}

export function buildIndependentVerifierQuery(inventory: RouteInventory, realizedMutatingRoutes: readonly ExactRouteV1[]): {
  excluded_outer_harnesses: string[];
  excluded_providers: string[];
  candidate_route_ids: string[];
} {
  const excludedHarnesses = new Set(realizedMutatingRoutes.map((route) => route.outer_harness));
  const excludedProviders = new Set(realizedMutatingRoutes.map((route) => route.provider));
  const candidateRouteIds = inventory.entries
    .filter((entry) => entry.status === "candidate"
      && entry.outer_harness !== null
      && entry.task_classes.includes("independent_review")
      && !excludedHarnesses.has(entry.outer_harness)
      && !excludedProviders.has(entry.provider))
    .map((entry) => entry.route_id)
    .sort();
  return {
    excluded_outer_harnesses: [...excludedHarnesses].sort(),
    excluded_providers: [...excludedProviders].sort(),
    candidate_route_ids: candidateRouteIds,
  };
}

function withoutEvidenceDigest(evidence: QualificationEvidenceV1): Omit<QualificationEvidenceV1, "evidence_digest"> {
  const { evidence_digest: _evidenceDigest, ...subject } = evidence;
  return subject;
}

function toLevel5Evidence(evidence: QualificationEvidenceV1): RouteEvidenceV1 {
  if (evidence.level !== 5) throw new RouteEvidenceError("A current level-5 route proof is required.");
  return RouteEvidenceV1Schema.parse({
    schema_version: "agentdash.route-evidence/v1",
    route_proof_id: evidence.route_proof_id,
    route_id: evidence.route_id,
    task_class: evidence.task_class,
    level: 5,
    status: evidence.status,
    ...evidence.exact_route,
    fixture_set_version: evidence.fixture_set_version,
    scoring_rubric_version: evidence.scoring_rubric_version,
    evaluator_version: evidence.evaluator_version,
    policy_version: evidence.policy_version,
    minimum_sample_count: evidence.minimum_sample_count,
    minimum_fixture_shapes: evidence.minimum_fixture_shapes,
    confidence_threshold: evidence.confidence_threshold,
    max_cost_usd: evidence.max_cost_usd,
    max_runtime_ms: evidence.max_runtime_ms,
    safety_gates: evidence.safety_gates,
    observed_sample_count: evidence.observed_sample_count,
    observed_fixture_shapes: evidence.observed_fixture_shapes,
    observed_wilson_lower_bound: evidence.observed_wilson_lower_bound,
    observed_max_cost_usd: evidence.observed_max_cost_usd,
    observed_max_runtime_ms: evidence.observed_max_runtime_ms,
    safety_gate_results: evidence.safety_gate_results,
    raw_receipt_digest: evidence.raw_receipt_digest,
    score_digest: evidence.score_digest,
    environment_digest: evidence.environment_digest,
    evidence_digest: evidence.evidence_digest,
    evaluated_at: evidence.evaluated_at,
    expires_at: evidence.expires_at,
    revocation_reason: evidence.revocation_reason,
    critical_failure: evidence.critical_failure,
    drift_detected: evidence.drift_detected,
  });
}

export class RouteRegistry implements RouteRegistryPort {
  private readonly evidenceDir: string;
  private readonly revocationDir: string;

  constructor(private readonly options: { stateDir: string; inventory: RouteInventory }) {
    this.evidenceDir = join(options.stateDir, "route-evidence");
    this.revocationDir = join(options.stateDir, "route-revocations");
  }

  private async loadRevocations(): Promise<QualificationRevocationV1[]> {
    let entries;
    try {
      const stats = await lstat(this.revocationDir);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new RouteEvidenceError("Route revocation directory is not a real directory.");
      entries = await readdir(this.revocationDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      if (error instanceof RouteEvidenceError) throw error;
      throw new RouteEvidenceError("Route revocations could not be read.");
    }
    const revocations: QualificationRevocationV1[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) throw new RouteEvidenceError("Route revocation is not digest-addressed.");
      let parsed: QualificationRevocationV1;
      try {
        parsed = QualificationRevocationV1Schema.parse(JSON.parse(await readFile(join(this.revocationDir, entry.name), "utf8")));
      } catch {
        throw new RouteEvidenceError("Route revocation failed strict schema validation.");
      }
      const { revocation_digest: _digest, ...subject } = parsed;
      const digest = canonicalQualificationRevocationDigest(subject);
      if (parsed.revocation_digest !== digest || entry.name !== `${digest}.json`) throw new RouteEvidenceError("Route revocation digest does not match its immutable content.");
      revocations.push(parsed);
    }
    return revocations;
  }

  private async loadAll(): Promise<QualificationEvidenceV1[]> {
    let directoryEntries;
    try {
      const stats = await lstat(this.evidenceDir);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new RouteEvidenceError("Route evidence directory is not a real directory.");
      directoryEntries = await readdir(this.evidenceDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      if (error instanceof RouteEvidenceError) throw error;
      throw new RouteEvidenceError("Route evidence could not be read.");
    }

    const evidence: QualificationEvidenceV1[] = [];
    for (const entry of directoryEntries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) {
        throw new RouteEvidenceError("Route evidence directory contains a non-digest-addressed entry.");
      }
      const path = join(this.evidenceDir, entry.name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink() || !stats.isFile()) throw new RouteEvidenceError("Route evidence must be an immutable regular file.");
      let parsed: QualificationEvidenceV1;
      try {
        parsed = QualificationEvidenceV1Schema.parse(JSON.parse(await readFile(path, "utf8")));
      } catch {
        throw new RouteEvidenceError("Route evidence failed strict schema validation.");
      }
      const digest = canonicalQualificationEvidenceDigest(withoutEvidenceDigest(parsed));
      if (parsed.evidence_digest !== digest || entry.name !== `${digest}.json`) {
        throw new RouteEvidenceError("Route evidence digest or filename does not match its immutable content.");
      }
      evidence.push(parsed);
    }
    return evidence;
  }

  private async active(routeId: string, taskClass: TaskClass, at: string): Promise<QualificationEvidenceV1[]> {
    const instant = Date.parse(TimestampSchema.parse(at));
    const candidate = this.options.inventory.requireCandidate(routeId);
    const [all, revocations] = await Promise.all([this.loadAll(), this.loadRevocations()]);
    const latestRevocation = revocations.filter((revocation) => revocation.route_id === candidate.route_id
      && revocation.task_class === taskClass
      && canonicalDigest(revocation.exact_route) === canonicalDigest(candidate.exact_route)
      && Date.parse(revocation.revoked_at) <= instant)
      .sort((left, right) => Date.parse(right.revoked_at) - Date.parse(left.revoked_at))[0];
    return all.filter((evidence) => evidence.route_id === candidate.route_id
      && evidence.task_class === taskClass
      && canonicalDigest(evidence.exact_route) === canonicalDigest(candidate.exact_route)
      && Date.parse(evidence.evaluated_at) <= instant
      && Date.parse(evidence.expires_at) >= instant
      && (!latestRevocation || Date.parse(evidence.evaluated_at) > Date.parse(latestRevocation.revoked_at)))
      .sort((left, right) => Date.parse(right.evaluated_at) - Date.parse(left.evaluated_at));
  }

  async status(routeId: string, taskClass: TaskClass, at: string): Promise<RouteEligibilityStatus> {
    try {
      const active = await this.active(routeId, taskClass, at);
      if (active.some((evidence) => evidence.level === 5)) return "production";
      if (active.some((evidence) => evidence.level === 4)) return "canary_only";
      return "denied";
    } catch {
      return "denied";
    }
  }

  async requireLevel5(route_id: RouteId, task_class: TaskClass, at: Timestamp): Promise<RouteEvidenceV1> {
    let active: QualificationEvidenceV1[];
    try {
      active = await this.active(route_id, task_class, at);
    } catch (error) {
      if (error instanceof RouteEvidenceError) throw error;
      throw new RouteEvidenceError("Route evidence is unavailable.");
    }
    const level5 = active.find((evidence) => evidence.level === 5);
    if (!level5) throw new RouteEvidenceError("A current level-5 route proof is required for production dispatch.");
    return toLevel5Evidence(level5);
  }

  async qualifyActivation(rawInput: GetActivationQualificationInput): Promise<GetActivationQualificationResult> {
    const input = GetActivationQualificationInputSchema.parse(rawInput);
    const routes: RouteEvidenceV1[] = [];
    for (const requirement of input.requirements) {
      let evidence: RouteEvidenceV1;
      try {
        evidence = await this.requireLevel5(requirement.route_id, requirement.task_class, input.at);
      } catch (error) {
        return GetActivationQualificationResultSchema.parse({ status: "unavailable", reason: error instanceof Error ? error.message.slice(0, 512) : "Route evidence is unavailable." });
      }
      if (evidence.route_proof_id !== requirement.route_proof_id || evidence.evidence_digest !== requirement.route_proof_digest) {
        return GetActivationQualificationResultSchema.parse({ status: "conflict" });
      }
      routes.push(evidence);
    }
    const canonicalRoutes = canonicalizeActivationRoutes(routes);
    return GetActivationQualificationResultSchema.parse({
      status: "qualified",
      route_registry_revision: this.options.inventory.revision,
      route_registry_snapshot_token: canonicalDigest({ revision: this.options.inventory.revision, routes: canonicalRoutes }),
      routes: canonicalRoutes,
    });
  }
}
