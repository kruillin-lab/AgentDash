import "server-only";

import { z } from "zod";

import {
  FinalizationCommandV1Schema,
  canonicalDigest,
  type Digest,
  type FinalizationCommandV1,
} from "../../../lib/mission-control/contracts";
import {
  MutationManifestInternalSchema,
  MutationScopeInternalSchema,
  MutationTypeInternalSchema,
} from "../../../lib/mission-control/contracts/mutation";

type MutationManifestInternal = z.infer<typeof MutationManifestInternalSchema>;
type MutationScopeInternal = z.infer<typeof MutationScopeInternalSchema>;
type MutationTypeInternal = z.infer<typeof MutationTypeInternalSchema>;

// ---------------------------------------------------------------------------
// Finalization command
//
// The approved mandate carries a finalization predicate, not permission to
// merge an arbitrary future artifact. After successful verification the
// controller may create one FinalizationCommandV1 binding the exact TaskSpec /
// mandate revisions, source artifact/commit, base/target identities, allowed
// mutation scope, the exact mutation manifest and patch digest, the expected
// post-state, the target-head CAS precondition, the adapter operation, the
// idempotency key, and the action authority. Only `no_change_close` and
// `local_patch` (local git fast-forward) are supported in the MVP.
// ---------------------------------------------------------------------------

type MutationEntry = { path: string; operation: "add" | "modify" | "delete"; before_digest: Digest | null; after_digest: Digest | null };

export interface BuildFinalizationCommandInput {
  command_id: string;
  task_id: string;
  task_spec_revision: number;
  task_spec_digest: string;
  mandate_id: string;
  mandate_digest: string;
  verification_receipt_digest: string;
  source: { artifact_id: string; artifact_digest: string; commit_digest: string | null };
  base: { identity: string; revision: string; digest: string };
  target: { identity: string; revision: string; digest: string };
  mutation_scope: MutationScopeInternal;
  expected_post_state: { kind: "digest"; digest: string } | { kind: "postcondition"; predicate: string; predicate_digest: string };
  adapter_operation: string;
  idempotency_key: string;
  action_authority: { authority_id: string; authority_digest: string };
  created_at: string;
  // Present only for a mutating (local_patch) close.
  mutation_entries?: MutationEntry[];
  diff_bytes?: number;
}

function buildManifest(mutationType: MutationTypeInternal, entries: MutationEntry[], diffBytes: number): MutationManifestInternal {
  const patchDigest = mutationType === "no_change_close"
    ? canonicalDigest({ mutation_type: "no_change_close", entries: [] })
    : canonicalDigest({ mutation_type: mutationType, entries, diff_bytes: diffBytes });
  const manifestDigest = canonicalDigest({ mutation_type: mutationType, entries, diff_bytes: diffBytes, patch_digest: patchDigest });
  return MutationManifestInternalSchema.parse({ mutation_type: mutationType, entries, diff_bytes: diffBytes, manifest_digest: manifestDigest, patch_digest: patchDigest });
}

export function buildFinalizationCommand(input: BuildFinalizationCommandInput): FinalizationCommandV1 {
  const mutationType = input.mutation_scope.mutation_type;
  const entries = input.mutation_entries ?? [];
  const diffBytes = input.diff_bytes ?? 0;
  const manifest = buildManifest(mutationType, entries, diffBytes);

  return FinalizationCommandV1Schema.parse({
    schema_version: "agentdash.finalization-command/v1",
    command_id: input.command_id,
    task_id: input.task_id,
    task_spec_revision: input.task_spec_revision,
    task_spec_digest: input.task_spec_digest,
    mandate_id: input.mandate_id,
    mandate_digest: input.mandate_digest,
    verification_receipt_digest: input.verification_receipt_digest,
    source: input.source,
    base: input.base,
    target: input.target,
    mutation_scope: input.mutation_scope,
    mutation_manifest: manifest,
    expected_post_state: input.expected_post_state,
    // The CAS precondition binds the exact target head, never the base.
    cas_precondition: { target_identity: input.target.identity, expected_revision: input.target.revision, digest: input.target.digest },
    adapter_operation: input.adapter_operation,
    idempotency_key: input.idempotency_key,
    action_authority: input.action_authority,
    created_at: input.created_at,
  });
}
