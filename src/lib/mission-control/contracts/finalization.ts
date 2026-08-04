import { z } from "zod";
import { ArtifactIdSchema, AuthorityIdSchema, CommandIdSchema, DigestSchema, MandateIdSchema, TaskIdSchema, TimestampSchema } from "./common";

export const FinalizationCommandV1Schema = z.object({ schema_version: z.literal("agentdash.finalization-command/v1"), command_id: CommandIdSchema, task_id: TaskIdSchema, mandate_id: MandateIdSchema, verification_receipt_digest: DigestSchema, artifact_digest: DigestSchema, base_digest: DigestSchema, target_digest: DigestSchema, mutation_manifest_digest: DigestSchema, expected_post_state_digest: DigestSchema, mutation_type: z.enum(["no_change_close", "artifact_delivery", "local_patch", "approved_merge"]), adapter_operation: z.string().min(1), idempotency_key: z.string().min(1), authority_id: AuthorityIdSchema, created_at: TimestampSchema }).strict();
export type FinalizationCommandV1 = z.infer<typeof FinalizationCommandV1Schema>;
export const FinalizationPreflightV1Schema = z.object({ allowed: z.boolean(), reason: z.string().nullable() }).strict();
export type FinalizationPreflightV1 = z.infer<typeof FinalizationPreflightV1Schema>;
export const FinalizationApplyResultV1Schema = z.object({ state: z.enum(["applied", "rejected", "unknown"]), receipt_digest: DigestSchema.nullable() }).strict();
export type FinalizationApplyResultV1 = z.infer<typeof FinalizationApplyResultV1Schema>;
export const FinalizationLookupResultV1Schema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("found"), receipt_digest: DigestSchema }).strict(), z.object({ kind: z.literal("not_found") }).strict(), z.object({ kind: z.literal("unknown"), reason: z.string().min(1) }).strict()]);
export type FinalizationLookupResultV1 = z.infer<typeof FinalizationLookupResultV1Schema>;
export const ArtifactReferenceV1Schema = z.object({ artifact_id: ArtifactIdSchema, digest: DigestSchema }).strict();
export type ArtifactReferenceV1 = z.infer<typeof ArtifactReferenceV1Schema>;
