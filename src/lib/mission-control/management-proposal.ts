import { z } from "zod";

const opaqueId = <Brand extends string>() => z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/).brand<Brand>();

/** Browser-safe, untrusted conversational intent only; authority and controller state are absent. */
export const ManagementProposalV1Schema = z.object({
  schema_version: z.literal("agentdash.management-proposal/v1"),
  proposal_id: opaqueId<"ProposalId">(),
  task_id: opaqueId<"TaskId">().nullable(),
  intent: z.string().min(1),
  evidence_refs: z.array(z.string().min(1)).optional(),
  created_at: z.string().datetime({ offset: true }),
}).strict();
export type ManagementProposalV1 = z.infer<typeof ManagementProposalV1Schema>;
