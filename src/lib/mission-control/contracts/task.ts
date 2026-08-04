import { z } from "zod";
import { BudgetV1Schema, DigestSchema, ProjectIdSchema, RequestIdSchema, RouteIdSchema, WorkspacePolicyV1Schema, WorkspaceScopeV1Schema } from "./common";
import { TaskClassSchema } from "./routes";

export const TaskSpecRevisionV1Schema = z.object({ plan_revision: z.number().int().nonnegative(), task_spec_digest: DigestSchema, objective_digest: DigestSchema, acceptance_digest: DigestSchema }).strict();
export type TaskSpecRevisionV1 = z.infer<typeof TaskSpecRevisionV1Schema>;
const routedPhase = (phase: "execute" | "fallback" | "remediate", deterministic: boolean) => z.object({ phase: z.literal(phase), name: phase === "execute" ? z.literal("primary") : z.string().min(1), route_id: deterministic ? z.null() : RouteIdSchema, task_class: TaskClassSchema, deterministic: z.literal(deterministic) }).strict();
const verify = z.discriminatedUnion("deterministic", [z.object({ phase: z.literal("verify"), name: z.string().min(1), deterministic: z.literal(false), route_id: RouteIdSchema, task_class: TaskClassSchema }).strict(), z.object({ phase: z.literal("verify"), name: z.string().min(1), deterministic: z.literal(true), route_id: z.null(), task_class: TaskClassSchema }).strict()]);
const finalize = z.discriminatedUnion("deterministic", [z.object({ phase: z.literal("finalize"), deterministic: z.literal(false), route_id: RouteIdSchema, task_class: TaskClassSchema }).strict(), z.object({ phase: z.literal("finalize"), deterministic: z.literal(true), route_id: z.null(), task_class: TaskClassSchema }).strict()]);
export const RoutePlanPhaseV1Schema = z.union([routedPhase("execute", false), routedPhase("execute", true), routedPhase("fallback", false), routedPhase("fallback", true), routedPhase("remediate", false), routedPhase("remediate", true), verify, finalize]);
export type RoutePlanPhaseV1 = z.infer<typeof RoutePlanPhaseV1Schema>;

const taskShape = z.object({
  schema_version: z.literal("agentdash.task-spec/v1"), request_id: RequestIdSchema, title: z.string().min(1).max(256), objective: z.string().min(1), acceptance_checks: z.array(z.string().min(1)).min(1), constraints: z.array(z.string().min(1)), prohibited_actions: z.array(z.string().min(1)), project_id: ProjectIdSchema,
  workspace: WorkspaceScopeV1Schema, workspace_policy: WorkspacePolicyV1Schema, required_capabilities: z.array(z.string().min(1)), risk_mode: z.enum(["auto", "approval_required"]), budget: BudgetV1Schema, route_plan: z.array(RoutePlanPhaseV1Schema).min(5),
  finalization: z.object({ mutation_type: z.enum(["no_change_close", "artifact_delivery", "local_patch", "approved_merge"]), authority_predicate: z.object({ required: z.boolean(), allowed_external_mutation: z.boolean() }).strict(), allowed_path_prefixes: z.array(z.string().min(1)), prohibited_changes: z.array(z.string()) }).strict(), plan_revision: z.number().int().nonnegative(), source_refs: z.array(z.string().min(1)),
}).strict();
export const TaskSpecV1Schema = taskShape.superRefine((v, c) => {
  if (v.workspace.project_id !== v.project_id || v.workspace_policy.workspace.project_id !== v.project_id || v.workspace.mode !== v.workspace_policy.workspace.mode || v.workspace.path !== v.workspace_policy.workspace.path) c.addIssue({ code: z.ZodIssueCode.custom, message: "workspace policy scope must exactly match TaskSpec" });
  const required = ["execute", "fallback", "remediate", "verify", "finalize"] as const;
  let highestRank = -1;
  for (const item of v.route_plan) {
    const rank = required.indexOf(item.phase);
    if (rank < highestRank) c.addIssue({ code: z.ZodIssueCode.custom, message: "route phases may not regress" });
    highestRank = Math.max(highestRank, rank);
  }
  for (const phase of required) if (!v.route_plan.some((item) => item.phase === phase)) c.addIssue({ code: z.ZodIssueCode.custom, message: "route plan is missing a required phase" });
});
export type TaskSpecV1 = z.infer<typeof TaskSpecV1Schema>;
