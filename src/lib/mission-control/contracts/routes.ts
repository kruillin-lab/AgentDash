import { z } from "zod";
import { DigestSchema, RouteIdSchema, RouteProofIdSchema, TimestampSchema } from "./common";

export const TaskClassSchema = z.enum(["intake_microtask", "bounded_coding", "general_implementation", "hard_engineering", "independent_review", "long_horizon_repository", "frontend_ci_data", "multimodal_ui_document", "long_tool_chain_research", "current_web_research"]);
export type TaskClass = z.infer<typeof TaskClassSchema>;
export const ExactRouteV1Schema = z.object({ outer_harness: z.string().min(1), provider: z.string().min(1), model: z.string().min(1), agent_type: z.string().min(1), config_digest: DigestSchema }).strict();
export type ExactRouteV1 = z.infer<typeof ExactRouteV1Schema>;
export const RouteEvaluationPolicyV1Schema = z.object({ schema_version: z.literal("agentdash.route-evaluation-policy/v1"), task_class: TaskClassSchema, fixture_set_version: z.string().min(1), scoring_rubric_version: z.string().min(1), minimum_sample_count: z.number().int().positive(), confidence_threshold: z.number().min(0).max(1), max_cost_usd: z.number().finite().nonnegative(), max_runtime_ms: z.number().int().positive(), expires_at: TimestampSchema }).strict();
export type RouteEvaluationPolicyV1 = z.infer<typeof RouteEvaluationPolicyV1Schema>;
export const RouteEvidenceV1Schema = z.object({ schema_version: z.literal("agentdash.route-evidence/v1"), route_proof_id: RouteProofIdSchema, route_id: RouteIdSchema, task_class: TaskClassSchema, level: z.literal(5), outer_harness: z.string().min(1), provider: z.string().min(1), model: z.string().min(1), agent_type: z.string().min(1), config_digest: DigestSchema, evidence_digest: DigestSchema, evaluated_at: TimestampSchema, expires_at: TimestampSchema }).strict().superRefine((value, context) => { if (Date.parse(value.expires_at) <= Date.parse(value.evaluated_at)) context.addIssue({ code: z.ZodIssueCode.custom, message: "route evidence must expire after evaluation", path: ["expires_at"] }); });
export type RouteEvidenceV1 = z.infer<typeof RouteEvidenceV1Schema>;
