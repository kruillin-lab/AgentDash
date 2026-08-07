import { z } from "zod";

import { DigestSchema, RouteIdSchema, RouteProofIdSchema, TimestampSchema } from "./common";

export const RequiredRouteSafetyGates = [
  "authority_isolation",
  "workspace_containment",
  "identity_binding",
  "cancellation_reconciliation",
  "secret_handling",
  "prohibited_actions",
] as const;

function hasExactSafetyGates(gates: string[]): boolean {
  return gates.length === RequiredRouteSafetyGates.length
    && new Set(gates).size === RequiredRouteSafetyGates.length
    && RequiredRouteSafetyGates.every((gate) => gates.includes(gate));
}

export const TaskClassSchema = z.enum([
  "intake_microtask",
  "bounded_coding",
  "general_implementation",
  "hard_engineering",
  "independent_review",
  "long_horizon_repository",
  "frontend_ci_data",
  "multimodal_ui_document",
  "long_tool_chain_research",
  "current_web_research",
]);
export type TaskClass = z.infer<typeof TaskClassSchema>;

export const RouteProofStatusSchema = z.enum(["active", "revoked", "expired"]);
export type RouteProofStatus = z.infer<typeof RouteProofStatusSchema>;

export const ExactRouteV1Schema = z.object({
  outer_harness: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  agent_type: z.string().min(1),
  mode: z.string().min(1),
  config_digest: DigestSchema,
}).strict();
export type ExactRouteV1 = z.infer<typeof ExactRouteV1Schema>;

export const RouteEvaluationPolicyV1Schema = z.object({
  schema_version: z.literal("agentdash.route-evaluation-policy/v1"),
  route_id: RouteIdSchema,
  exact_route: ExactRouteV1Schema,
  task_class: TaskClassSchema,
  fixture_set_version: z.string().min(1),
  scoring_rubric_version: z.string().min(1),
  evaluator_version: z.string().min(1),
  minimum_sample_count: z.number().int().positive(),
  minimum_fixture_shapes: z.number().int().min(5),
  confidence_threshold: z.number().min(0).max(1),
  max_cost_usd: z.number().finite().nonnegative(),
  max_runtime_ms: z.number().int().positive(),
  safety_gates: z.array(z.string().min(1)).min(1),
  expires_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  const high = value.task_class === "hard_engineering" || value.task_class === "independent_review";
  if (value.minimum_sample_count < (high ? 30 : 20)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "minimum sample count is below the policy floor" });
  }
  if (value.confidence_threshold < (high ? 0.8 : 0.7)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "confidence threshold is below the policy floor" });
  }
  if (!hasExactSafetyGates(value.safety_gates)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "route policy must require every named safety gate exactly once" });
  }
});
export type RouteEvaluationPolicyV1 = z.infer<typeof RouteEvaluationPolicyV1Schema>;

const SafetyGateResultSchema = z.object({
  gate: z.string().min(1),
  passed: z.boolean(),
  evidence_digest: DigestSchema,
}).strict();

export const RouteEvidenceV1Schema = z.object({
  schema_version: z.literal("agentdash.route-evidence/v1"),
  route_proof_id: RouteProofIdSchema,
  route_id: RouteIdSchema,
  task_class: TaskClassSchema,
  level: z.literal(5),
  status: RouteProofStatusSchema,
  outer_harness: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  agent_type: z.string().min(1),
  mode: z.string().min(1),
  config_digest: DigestSchema,
  fixture_set_version: z.string().min(1),
  scoring_rubric_version: z.string().min(1),
  evaluator_version: z.string().min(1),
  policy_version: z.string().min(1),
  minimum_sample_count: z.number().int().positive(),
  minimum_fixture_shapes: z.number().int().min(5),
  confidence_threshold: z.number().min(0).max(1),
  max_cost_usd: z.number().finite().nonnegative(),
  max_runtime_ms: z.number().int().positive(),
  safety_gates: z.array(z.string().min(1)).min(1),
  observed_sample_count: z.number().int().positive(),
  observed_fixture_shapes: z.number().int().positive(),
  observed_wilson_lower_bound: z.number().min(0).max(1),
  observed_max_cost_usd: z.number().finite().nonnegative(),
  observed_max_runtime_ms: z.number().int().positive(),
  safety_gate_results: z.array(SafetyGateResultSchema).min(1),
  raw_receipt_digest: DigestSchema,
  score_digest: DigestSchema,
  environment_digest: DigestSchema,
  evidence_digest: DigestSchema,
  evaluated_at: TimestampSchema,
  expires_at: TimestampSchema,
  revocation_reason: z.string().min(1).nullable(),
  critical_failure: z.boolean(),
  drift_detected: z.boolean(),
}).strict().superRefine((value, context) => {
  const high = value.task_class === "hard_engineering" || value.task_class === "independent_review";
  if (value.minimum_sample_count < (high ? 30 : 20)
    || value.confidence_threshold < (high ? 0.8 : 0.7)
    || value.minimum_fixture_shapes < 5) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "route policy is below the task-class floor" });
  }
  if (!hasExactSafetyGates(value.safety_gates)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "route evidence must bind every named safety gate exactly once" });
  }
  if (value.observed_sample_count < value.minimum_sample_count
    || value.observed_fixture_shapes < value.minimum_fixture_shapes
    || value.observed_wilson_lower_bound < value.confidence_threshold) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "observed evidence is below policy floor" });
  }
  if (value.observed_max_cost_usd > value.max_cost_usd || value.observed_max_runtime_ms > value.max_runtime_ms) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "observed evidence exceeds hard ceiling" });
  }
  const results = new Map(value.safety_gate_results.map((result) => [result.gate, result.passed]));
  if (value.safety_gate_results.length !== RequiredRouteSafetyGates.length
    || value.safety_gate_results.some((result) => !result.passed)
    || value.safety_gates.some((gate) => results.get(gate) !== true)
    || results.size !== value.safety_gates.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "every safety gate must have exactly one passing result" });
  }
  if (Date.parse(value.expires_at) <= Date.parse(value.evaluated_at)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "route evidence must expire after evaluation", path: ["expires_at"] });
  }
  if (Date.parse(value.expires_at) - Date.parse(value.evaluated_at) > 30 * 24 * 60 * 60 * 1000) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "route evidence may be valid for at most 30 days" });
  }
  if (value.status === "active" && (value.revocation_reason !== null || value.critical_failure || value.drift_detected)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "active proof cannot carry revocation facts" });
  }
});
export type RouteEvidenceV1 = z.infer<typeof RouteEvidenceV1Schema>;
