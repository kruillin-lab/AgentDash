import { z } from "zod";
import { ProposalIdSchema, TaskIdSchema, TimestampSchema } from "./common";

/** Untrusted conversational intent only; controller state and authority are intentionally absent. */
export const ManagementProposalV1Schema = z.object({ schema_version: z.literal("agentdash.management-proposal/v1"), proposal_id: ProposalIdSchema, task_id: TaskIdSchema.nullable(), intent: z.string().min(1), evidence_refs: z.array(z.string().min(1)).optional(), created_at: TimestampSchema }).strict();
export type ManagementProposalV1 = z.infer<typeof ManagementProposalV1Schema>;
