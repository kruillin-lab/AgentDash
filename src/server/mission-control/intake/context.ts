import { z } from "zod";

import { AutoActivationSeedV1Schema, CompilationPolicySnapshotV1Schema, DigestSchema, canonicalDigest, type AutoActivationSeedV1, type CompilationPolicySnapshotV1 } from "../../../lib/mission-control/contracts";
import { PMCapabilityFactV1Schema, PMConversationMessageV1Schema, PMStatusFactV1Schema } from "../pm-prompt";

export const ServerIntakeContextV1Schema = z.object({
  pm_context: z.object({
    history: z.array(PMConversationMessageV1Schema).max(12),
    reviewed_recall: z.array(z.object({ page_id: z.string().min(1).max(256), page_digest: DigestSchema, excerpt: z.string().min(1).max(1_024), reviewed_at: z.string().datetime({ offset: true }) }).strict()).max(8),
    capability_facts: z.array(PMCapabilityFactV1Schema).max(16),
    status_facts: z.array(PMStatusFactV1Schema).max(16),
  }).strict(),
  compilation_policy: CompilationPolicySnapshotV1Schema,
  compilation_policy_digest: DigestSchema,
  activation: z.union([z.object({ kind: z.literal("approval_required") }).strict(), AutoActivationSeedV1Schema]),
}).strict().superRefine((value, context) => {
  if (value.compilation_policy_digest !== canonicalDigest(value.compilation_policy)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["compilation_policy_digest"], message: "context must bind the exact compilation policy" });
});
export type ServerIntakeContextV1 = z.infer<typeof ServerIntakeContextV1Schema>;

export interface ServerIntakeContextPort {
  load(input: { committed_history: z.infer<typeof PMConversationMessageV1Schema>[] }): Promise<ServerIntakeContextV1>;
}

export class ServerIntakeContextUnavailableError extends Error {
  readonly code = "intake_unavailable";
  constructor() {
    super("Trusted intake compilation context is unavailable.");
    this.name = "ServerIntakeContextUnavailableError";
  }
}

export const unavailableServerIntakeContextPort: ServerIntakeContextPort = {
  async load(): Promise<never> { throw new ServerIntakeContextUnavailableError(); },
};

export type { AutoActivationSeedV1, CompilationPolicySnapshotV1 };
