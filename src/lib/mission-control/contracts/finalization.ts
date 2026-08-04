import { z } from "zod";

import { ArtifactIdSchema, AuthorityIdSchema, CommandIdSchema, DigestSchema, MandateIdSchema, TaskIdSchema, TimestampSchema } from "./common";
import { MutationManifestInternalSchema, MutationScopeInternalSchema, validateMutationEnvelope } from "./mutation";

const identityRevisionShape = z.object({ identity: z.string().min(1), revision: z.string().min(1), digest: DigestSchema }).strict();
const expectedPostStateShape = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("digest"), digest: DigestSchema }).strict(),
  z.object({ kind: z.literal("postcondition"), predicate: z.string().min(1), predicate_digest: DigestSchema }).strict(),
]);

export const FinalizationCommandV1Schema = z.object({
  schema_version: z.literal("agentdash.finalization-command/v1"),
  command_id: CommandIdSchema,
  task_id: TaskIdSchema,
  task_spec_revision: z.number().int().nonnegative(),
  task_spec_digest: DigestSchema,
  mandate_id: MandateIdSchema,
  mandate_digest: DigestSchema,
  verification_receipt_digest: DigestSchema,
  source: z.object({ artifact_id: ArtifactIdSchema, artifact_digest: DigestSchema, commit_digest: DigestSchema.nullable() }).strict(),
  base: identityRevisionShape,
  target: identityRevisionShape,
  mutation_scope: MutationScopeInternalSchema,
  mutation_manifest: MutationManifestInternalSchema,
  expected_post_state: expectedPostStateShape,
  cas_precondition: z.object({ target_identity: z.string().min(1), expected_revision: z.string().min(1), digest: DigestSchema }).strict(),
  adapter_operation: z.string().min(1),
  idempotency_key: z.string().min(1),
  action_authority: z.object({ authority_id: AuthorityIdSchema, authority_digest: DigestSchema }).strict(),
  created_at: TimestampSchema,
}).strict().superRefine((value, context) => {
  validateMutationEnvelope({ ...value.mutation_scope, mutation_manifest: value.mutation_manifest }, context);
  if (value.cas_precondition.target_identity !== value.target.identity || value.cas_precondition.expected_revision !== value.target.revision || value.cas_precondition.digest !== value.target.digest) context.addIssue({ code: z.ZodIssueCode.custom, message: "CAS precondition does not bind the exact target" });
});
export type FinalizationCommandV1 = z.infer<typeof FinalizationCommandV1Schema>;

export const FinalizationPreflightV1Schema = z.discriminatedUnion("status", [z.object({ status: z.literal("ready"), observed_digest: DigestSchema }).strict(), z.object({ status: z.literal("drifted"), observed_digest: DigestSchema }).strict(), z.object({ status: z.literal("rejected"), observed_digest: DigestSchema }).strict()]);
export type FinalizationPreflightV1 = z.infer<typeof FinalizationPreflightV1Schema>;
export const FinalizationApplyResultV1Schema = z.discriminatedUnion("status", [z.object({ status: z.literal("applied"), operation_id: CommandIdSchema }).strict(), z.object({ status: z.literal("rejected"), operation_id: CommandIdSchema }).strict(), z.object({ status: z.literal("unknown"), operation_id: CommandIdSchema }).strict()]);
export type FinalizationApplyResultV1 = z.infer<typeof FinalizationApplyResultV1Schema>;
export const FinalizationLookupResultV1Schema = z.discriminatedUnion("status", [z.object({ status: z.literal("applied"), post_state_digest: DigestSchema }).strict(), z.object({ status: z.literal("not_applied"), post_state_digest: z.null() }).strict(), z.object({ status: z.literal("unknown"), post_state_digest: z.null() }).strict()]);
export type FinalizationLookupResultV1 = z.infer<typeof FinalizationLookupResultV1Schema>;
export const ArtifactReferenceV1Schema = z.object({ artifact_id: ArtifactIdSchema, digest: DigestSchema }).strict();
export type ArtifactReferenceV1 = z.infer<typeof ArtifactReferenceV1Schema>;
