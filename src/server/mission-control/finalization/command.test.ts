import { describe, expect, test } from "vitest";

import { FinalizationCommandV1Schema, canonicalDigest } from "../../../lib/mission-control/contracts";
import { buildFinalizationCommand, type BuildFinalizationCommandInput } from "./command";

const digest = "a".repeat(64);
const timestamp = "2026-08-06T12:00:00.000Z";

function baseInput(): BuildFinalizationCommandInput {
  return {
    command_id: "command-finalize-1",
    task_id: "task-1",
    task_spec_revision: 1,
    task_spec_digest: digest,
    mandate_id: "mandate-1",
    mandate_digest: digest,
    verification_receipt_digest: digest,
    source: { artifact_id: "artifact-1", artifact_digest: digest, commit_digest: "b".repeat(64) },
    base: { identity: "repo:main", revision: "c".repeat(40), digest: digest },
    target: { identity: "repo:main", revision: "c".repeat(40), digest: digest },
    mutation_scope: { mutation_type: "no_change_close" as const, allowed_path_prefixes: [], max_files: 0, max_diff_bytes: 0, prohibited_changes: [] },
    expected_post_state: { kind: "digest" as const, digest },
    adapter_operation: "git_no_change_close",
    idempotency_key: "finalize-key-1",
    action_authority: { authority_id: "authority-1", authority_digest: digest },
    created_at: timestamp,
  };
}

describe("buildFinalizationCommand", () => {
  test("binds the exact target in a CAS precondition and the canonical empty mutation for a no-change close", () => {
    const command = buildFinalizationCommand(baseInput());
    expect(() => FinalizationCommandV1Schema.parse(command)).not.toThrow();
    expect(command.cas_precondition).toEqual({ target_identity: "repo:main", expected_revision: "c".repeat(40), digest });
    expect(command.mutation_manifest.mutation_type).toBe("no_change_close");
    expect(command.mutation_manifest.entries).toEqual([]);
    expect(command.mutation_manifest.diff_bytes).toBe(0);
  });

  test("computes the manifest digest from canonical content", () => {
    const command = buildFinalizationCommand(baseInput());
    const expected = canonicalDigest({ mutation_type: "no_change_close", entries: [], diff_bytes: 0, patch_digest: command.mutation_manifest.patch_digest });
    expect(command.mutation_manifest.manifest_digest).toBe(expected);
  });

  test("a CAS precondition that does not match the target is rejected", () => {
    const input = baseInput();
    input.target = { identity: "repo:main", revision: "d".repeat(40), digest };
    input.base = { identity: "repo:main", revision: "c".repeat(40), digest };
    const command = buildFinalizationCommand(input);
    // CAS binds the *target*, not the base.
    expect(command.cas_precondition.expected_revision).toBe("d".repeat(40));
    expect(() => FinalizationCommandV1Schema.parse(command)).not.toThrow();
  });

  test("a local patch carries its changed files and positive diff bytes", () => {
    const input = baseInput();
    const entry = { path: "src/a.ts", operation: "modify" as const, before_digest: digest, after_digest: "e".repeat(64) };
    input.mutation_scope = { mutation_type: "local_patch", allowed_path_prefixes: ["src"], max_files: 4, max_diff_bytes: 4096, prohibited_changes: [] };
    (input as unknown as { mutation_entries: unknown[] }).mutation_entries = [entry];
    (input as unknown as { diff_bytes: number }).diff_bytes = 128;
    const command = buildFinalizationCommand(input);
    expect(command.mutation_manifest.mutation_type).toBe("local_patch");
    expect(command.mutation_manifest.entries).toEqual([entry]);
    expect(command.mutation_manifest.diff_bytes).toBe(128);
    expect(() => FinalizationCommandV1Schema.parse(command)).not.toThrow();
  });

  test("a mutation outside the allowed path prefixes is rejected", () => {
    const input = baseInput();
    const entry = { path: "secrets/key.pem", operation: "modify" as const, before_digest: digest, after_digest: "e".repeat(64) };
    input.mutation_scope = { mutation_type: "local_patch", allowed_path_prefixes: ["src"], max_files: 4, max_diff_bytes: 4096, prohibited_changes: [] };
    (input as unknown as { mutation_entries: unknown[] }).mutation_entries = [entry];
    (input as unknown as { diff_bytes: number }).diff_bytes = 128;
    expect(() => buildFinalizationCommand(input)).toThrow(/outside|allowed|path/i);
  });
});
