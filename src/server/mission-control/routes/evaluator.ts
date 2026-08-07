import "server-only";

import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  DigestSchema,
  ExactRouteV1Schema,
  RequiredRouteSafetyGates,
  RouteIdSchema,
  RouteProofIdSchema,
  TaskClassSchema,
  TimestampSchema,
  canonicalDigest,
  type Digest,
  type TaskClass,
} from "../../../lib/mission-control/contracts";
import type { CandidateRoute } from "./inventory";

const TaskClassPolicySchema = z.object({
  minimum_sample_count: z.number().int().positive(),
  confidence_threshold: z.number().min(0).max(1),
  max_cost_usd: z.number().finite().nonnegative(),
  max_runtime_ms: z.number().int().positive(),
}).strict();

const TaskClassPoliciesSchema = z.object({
  intake_microtask: TaskClassPolicySchema,
  bounded_coding: TaskClassPolicySchema,
  general_implementation: TaskClassPolicySchema,
  hard_engineering: TaskClassPolicySchema,
  independent_review: TaskClassPolicySchema,
  long_horizon_repository: TaskClassPolicySchema,
  frontend_ci_data: TaskClassPolicySchema,
  multimodal_ui_document: TaskClassPolicySchema,
  long_tool_chain_research: TaskClassPolicySchema,
  current_web_research: TaskClassPolicySchema,
}).strict();

const RouteEvaluationPolicyCatalogV1Schema = z.object({
  schema_version: z.literal("agentdash.route-evaluation-policy-catalog/v1"),
  policy_version: z.string().min(1),
  fixture_set_version: z.string().min(1),
  scoring_rubric_version: z.string().min(1),
  evaluator_version: z.string().min(1),
  validity_days: z.number().int().min(1).max(30),
  minimum_fixture_shapes: z.number().int().min(5),
  safety_gates: z.array(z.string().min(1)),
  pm_fixture_profiles: z.array(ExactRouteV1Schema).length(2),
  task_classes: TaskClassPoliciesSchema,
}).strict().superRefine((value, context) => {
  const exact = value.safety_gates.length === RequiredRouteSafetyGates.length
    && new Set(value.safety_gates).size === RequiredRouteSafetyGates.length
    && RequiredRouteSafetyGates.every((gate) => value.safety_gates.includes(gate));
  if (!exact) context.addIssue({ code: z.ZodIssueCode.custom, path: ["safety_gates"], message: "policy must require every safety gate exactly once" });
  if (value.pm_fixture_profiles.some((profile) => profile.outer_harness !== "hermes" || profile.agent_type !== "pm" || profile.mode !== "planning_only")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pm_fixture_profiles"], message: "PM fixtures must be isolated Hermes planning-only tuples" });
  }
  if (new Set(value.pm_fixture_profiles.map((profile) => canonicalDigest(profile))).size !== value.pm_fixture_profiles.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pm_fixture_profiles"], message: "PM fixture tuples must be distinct" });
  }
  for (const taskClass of TaskClassSchema.options) {
    const taskPolicy = value.task_classes[taskClass];
    const high = taskClass === "hard_engineering" || taskClass === "independent_review";
    if (taskPolicy.minimum_sample_count < (high ? 30 : 20)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["task_classes", taskClass], message: "sample count is below the task-class floor" });
    if (taskPolicy.confidence_threshold < (high ? 0.8 : 0.7)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["task_classes", taskClass], message: "confidence threshold is below the task-class floor" });
  }
});

export type RouteEvaluationPolicyCatalogV1 = z.infer<typeof RouteEvaluationPolicyCatalogV1Schema>;

const SafetyGateRunResultSchema = z.object({
  gate: z.enum(RequiredRouteSafetyGates),
  passed: z.boolean(),
  evidence_digest: DigestSchema,
}).strict();

export const ScoredRouteRunSchema = z.object({
  run_id: z.string().min(1),
  fixture_shape: z.string().min(1),
  passed: z.boolean(),
  cost_usd: z.number().finite().nonnegative(),
  runtime_ms: z.number().int().positive(),
  provider_tokens: z.number().int().nonnegative(),
  safety_gate_results: z.array(SafetyGateRunResultSchema).length(RequiredRouteSafetyGates.length),
  critical_failure: z.boolean(),
  raw_receipt_digest: DigestSchema,
  environment_digest: DigestSchema,
}).strict().superRefine((value, context) => {
  if (new Set(value.safety_gate_results.map((result) => result.gate)).size !== RequiredRouteSafetyGates.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["safety_gate_results"], message: "each run must report every safety gate exactly once" });
  }
});
export type ScoredRouteRun = z.infer<typeof ScoredRouteRunSchema>;

const QualificationSafetyGateResultSchema = z.object({
  gate: z.enum(RequiredRouteSafetyGates),
  passed: z.literal(true),
  evidence_digest: DigestSchema,
}).strict();

export const QualificationEvidenceV1Schema = z.object({
  schema_version: z.literal("agentdash.route-qualification-evidence/v1"),
  route_proof_id: RouteProofIdSchema,
  route_id: RouteIdSchema,
  task_class: TaskClassSchema,
  level: z.union([z.literal(4), z.literal(5)]),
  status: z.literal("active"),
  exact_route: ExactRouteV1Schema,
  fixture_set_version: z.string().min(1),
  scoring_rubric_version: z.string().min(1),
  evaluator_version: z.string().min(1),
  policy_version: z.string().min(1),
  minimum_sample_count: z.number().int().positive(),
  minimum_fixture_shapes: z.number().int().min(5),
  confidence_threshold: z.number().min(0).max(1),
  max_cost_usd: z.number().finite().nonnegative(),
  max_runtime_ms: z.number().int().positive(),
  safety_gates: z.array(z.enum(RequiredRouteSafetyGates)).length(RequiredRouteSafetyGates.length),
  observed_sample_count: z.number().int().positive(),
  observed_fixture_shapes: z.number().int().positive(),
  observed_wilson_lower_bound: z.number().min(0).max(1),
  observed_max_cost_usd: z.number().finite().nonnegative(),
  observed_max_runtime_ms: z.number().int().positive(),
  safety_gate_results: z.array(QualificationSafetyGateResultSchema).length(RequiredRouteSafetyGates.length),
  raw_receipt_digest: DigestSchema,
  score_digest: DigestSchema,
  environment_digest: DigestSchema,
  evidence_digest: DigestSchema,
  evaluated_at: TimestampSchema,
  expires_at: TimestampSchema,
  revocation_reason: z.null(),
  critical_failure: z.literal(false),
  drift_detected: z.literal(false),
}).strict();
export type QualificationEvidenceV1 = z.infer<typeof QualificationEvidenceV1Schema>;

export const QualificationRevocationV1Schema = z.object({
  schema_version: z.literal("agentdash.route-qualification-revocation/v1"),
  route_id: RouteIdSchema,
  task_class: TaskClassSchema,
  exact_route: ExactRouteV1Schema,
  reason: z.literal("critical_failure"),
  source_receipt_digest: DigestSchema,
  revoked_at: TimestampSchema,
  revocation_digest: DigestSchema,
}).strict();
export type QualificationRevocationV1 = z.infer<typeof QualificationRevocationV1Schema>;

export type QualificationDenialReason =
  | "route_task_class_not_hypothesized"
  | "insufficient_samples"
  | "insufficient_fixture_shapes"
  | "confidence_below_threshold"
  | "safety_gate_failed"
  | "critical_failure"
  | "cost_ceiling_exceeded"
  | "runtime_ceiling_exceeded"
  | "invalid_run_provenance"
  | "duplicate_run_provenance"
  | "config_drift";

export type RouteEvaluationResult =
  | { decision: "eligible"; evidence: QualificationEvidenceV1 }
  | { decision: "denied"; reasons: QualificationDenialReason[]; revocation?: QualificationRevocationV1 };

export function wilsonLowerBound(successes: number, sampleCount: number, zScore = 1.96): number {
  if (sampleCount <= 0) return 0;
  const proportion = successes / sampleCount;
  const zSquared = zScore * zScore;
  const denominator = 1 + zSquared / sampleCount;
  const center = proportion + zSquared / (2 * sampleCount);
  const margin = zScore * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * sampleCount)) / sampleCount);
  return (center - margin) / denominator;
}

export function canonicalQualificationEvidenceDigest(evidence: Omit<QualificationEvidenceV1, "evidence_digest">): Digest {
  return canonicalDigest(evidence);
}

export function canonicalQualificationRevocationDigest(revocation: Omit<QualificationRevocationV1, "revocation_digest">): Digest {
  return canonicalDigest(revocation);
}

function aggregateDigest(label: string, digests: readonly Digest[]): Digest {
  return canonicalDigest({ schema_version: `agentdash.${label}/v1`, digests: [...digests].sort() });
}

export function evaluateRoute(input: {
  candidate: CandidateRoute;
  policy: RouteEvaluationPolicyCatalogV1;
  task_class: TaskClass;
  level: 4 | 5;
  evaluated_at: string;
  current_config_digest: Digest;
  runs: readonly ScoredRouteRun[];
}): RouteEvaluationResult {
  const policy = RouteEvaluationPolicyCatalogV1Schema.parse(input.policy);
  const evaluatedAt = TimestampSchema.parse(input.evaluated_at);
  const taskPolicy = policy.task_classes[input.task_class];
  const reasons = new Set<QualificationDenialReason>();
  if (!input.candidate.task_classes.includes(input.task_class)) reasons.add("route_task_class_not_hypothesized");
  if (input.current_config_digest !== input.candidate.exact_route.config_digest) reasons.add("config_drift");

  const parsedRuns: ScoredRouteRun[] = [];
  for (const run of input.runs) {
    const parsed = ScoredRouteRunSchema.safeParse(run);
    if (!parsed.success) reasons.add("invalid_run_provenance");
    else parsedRuns.push(parsed.data);
  }
  if (new Set(parsedRuns.map((run) => run.run_id)).size !== parsedRuns.length
    || new Set(parsedRuns.map((run) => run.raw_receipt_digest)).size !== parsedRuns.length) {
    reasons.add("duplicate_run_provenance");
  }
  if (parsedRuns.length < taskPolicy.minimum_sample_count) reasons.add("insufficient_samples");
  const fixtureShapes = new Set(parsedRuns.map((run) => run.fixture_shape));
  if (fixtureShapes.size < policy.minimum_fixture_shapes) reasons.add("insufficient_fixture_shapes");
  const successes = parsedRuns.filter((run) => run.passed).length;
  const lowerBound = wilsonLowerBound(successes, parsedRuns.length);
  if (lowerBound < taskPolicy.confidence_threshold) reasons.add("confidence_below_threshold");
  if (parsedRuns.some((run) => run.critical_failure)) reasons.add("critical_failure");
  if (parsedRuns.some((run) => run.cost_usd > taskPolicy.max_cost_usd)) reasons.add("cost_ceiling_exceeded");
  if (parsedRuns.some((run) => run.runtime_ms > taskPolicy.max_runtime_ms)) reasons.add("runtime_ceiling_exceeded");
  if (parsedRuns.some((run) => run.safety_gate_results.some((gate) => !gate.passed))) reasons.add("safety_gate_failed");
  if (reasons.size > 0) {
    if (reasons.has("critical_failure")) {
      const withoutDigest: Omit<QualificationRevocationV1, "revocation_digest"> = {
        schema_version: "agentdash.route-qualification-revocation/v1",
        route_id: input.candidate.route_id,
        task_class: input.task_class,
        exact_route: input.candidate.exact_route,
        reason: "critical_failure",
        source_receipt_digest: aggregateDigest("route-critical-receipts", parsedRuns.filter((run) => run.critical_failure).map((run) => run.raw_receipt_digest)),
        revoked_at: evaluatedAt,
      };
      return {
        decision: "denied",
        reasons: [...reasons],
        revocation: QualificationRevocationV1Schema.parse({ ...withoutDigest, revocation_digest: canonicalQualificationRevocationDigest(withoutDigest) }),
      };
    }
    return { decision: "denied", reasons: [...reasons] };
  }

  const expiresAt = new Date(Date.parse(evaluatedAt) + policy.validity_days * 24 * 60 * 60 * 1_000).toISOString();
  const routeProofId = RouteProofIdSchema.parse(`route-proof-${canonicalDigest({ route_id: input.candidate.route_id, task_class: input.task_class, level: input.level, evaluated_at: evaluatedAt, runs: parsedRuns.map((run) => run.raw_receipt_digest) })}`);
  const safetyGateResults = RequiredRouteSafetyGates.map((gate) => ({
    gate,
    passed: true as const,
    evidence_digest: aggregateDigest(`route-safety-${gate}`, parsedRuns.map((run) => run.safety_gate_results.find((result) => result.gate === gate)!.evidence_digest)),
  }));
  const withoutDigest: Omit<QualificationEvidenceV1, "evidence_digest"> = {
    schema_version: "agentdash.route-qualification-evidence/v1",
    route_proof_id: routeProofId,
    route_id: input.candidate.route_id,
    task_class: input.task_class,
    level: input.level,
    status: "active",
    exact_route: input.candidate.exact_route,
    fixture_set_version: policy.fixture_set_version,
    scoring_rubric_version: policy.scoring_rubric_version,
    evaluator_version: policy.evaluator_version,
    policy_version: policy.policy_version,
    minimum_sample_count: taskPolicy.minimum_sample_count,
    minimum_fixture_shapes: policy.minimum_fixture_shapes,
    confidence_threshold: taskPolicy.confidence_threshold,
    max_cost_usd: taskPolicy.max_cost_usd,
    max_runtime_ms: taskPolicy.max_runtime_ms,
    safety_gates: [...RequiredRouteSafetyGates],
    observed_sample_count: parsedRuns.length,
    observed_fixture_shapes: fixtureShapes.size,
    observed_wilson_lower_bound: lowerBound,
    observed_max_cost_usd: Math.max(...parsedRuns.map((run) => run.cost_usd)),
    observed_max_runtime_ms: Math.max(...parsedRuns.map((run) => run.runtime_ms)),
    safety_gate_results: safetyGateResults,
    raw_receipt_digest: aggregateDigest("route-raw-receipts", parsedRuns.map((run) => run.raw_receipt_digest)),
    score_digest: canonicalDigest({ successes, sample_count: parsedRuns.length, fixture_shapes: [...fixtureShapes].sort(), wilson_lower_bound: lowerBound }),
    environment_digest: aggregateDigest("route-environments", parsedRuns.map((run) => run.environment_digest)),
    evaluated_at: evaluatedAt,
    expires_at: expiresAt,
    revocation_reason: null,
    critical_failure: false,
    drift_detected: false,
  };
  return { decision: "eligible", evidence: QualificationEvidenceV1Schema.parse({ ...withoutDigest, evidence_digest: canonicalQualificationEvidenceDigest(withoutDigest) }) };
}

export async function loadRouteEvaluationPolicy(path: string): Promise<RouteEvaluationPolicyCatalogV1> {
  return RouteEvaluationPolicyCatalogV1Schema.parse(JSON.parse(await readFile(path, "utf8")));
}
