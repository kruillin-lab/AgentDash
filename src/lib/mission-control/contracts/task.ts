import { z } from "zod";
import { BudgetV1Schema, DigestSchema, ProjectIdSchema, RequestIdSchema, RouteIdSchema, WorkspaceScopeV1Schema } from "./common";
import { TaskClassSchema } from "./routes";

export const TaskSpecRevisionV1Schema = z.object({ plan_revision: z.number().int().nonnegative(), task_spec_digest: DigestSchema, objective_digest: DigestSchema, acceptance_digest: DigestSchema }).strict();
export type TaskSpecRevisionV1 = z.infer<typeof TaskSpecRevisionV1Schema>;
export const TaskSpecV1Schema = z.object({ schema_version: z.literal("agentdash.task-spec/v1"), request_id: RequestIdSchema, title: z.string().min(1).max(256), objective: z.string().min(1), acceptance_checks: z.array(z.string().min(1)).min(1), constraints: z.array(z.string().min(1)), prohibited_actions: z.array(z.string().min(1)), project_id: ProjectIdSchema, workspace: WorkspaceScopeV1Schema, required_capabilities: z.array(z.string().min(1)), risk_mode: z.enum(["auto", "approval_required"]), budget: BudgetV1Schema, route_plan: z.array(z.object({ action_role: z.enum(["execute", "retry", "remediate", "verify", "finalize"]), route_id: RouteIdSchema.nullable(), task_class: TaskClassSchema }).strict()).min(1), finalization: z.object({ mutation_type: z.enum(["no_change_close", "artifact_delivery", "local_patch", "approved_merge"]), required_authority: z.string().min(1) }).strict(), plan_revision: z.number().int().nonnegative(), source_refs: z.array(z.string().min(1)) }).strict();
export type TaskSpecV1 = z.infer<typeof TaskSpecV1Schema>;
