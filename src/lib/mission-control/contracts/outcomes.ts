import { z } from "zod";
import { ActionOutcomeSchema, AttemptIdSchema, CommandIdSchema, EventIdSchema, TaskIdSchema, TaskOutcomeSchema } from "./common";

export { ActionOutcomeValues, TaskOutcomeValues } from "./common";
export const ActionOutcomeV1Schema = z.object({ schema_version: z.literal("agentdash.action-outcome/v1"), outcome: ActionOutcomeSchema, command_id: CommandIdSchema, attempt_id: AttemptIdSchema, task_id: TaskIdSchema, evidence_refs: z.array(EventIdSchema), classifier_policy_version: z.string().min(1), rationale: z.string().min(1) }).strict();
export type ActionOutcomeV1 = z.infer<typeof ActionOutcomeV1Schema>;
export const TaskOutcomeV1Schema = z.object({ schema_version: z.literal("agentdash.task-outcome/v1"), outcome: TaskOutcomeSchema, task_id: TaskIdSchema, rationale: z.string().min(1) }).strict();
export type TaskOutcomeV1 = z.infer<typeof TaskOutcomeV1Schema>;
