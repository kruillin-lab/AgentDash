import { describe, expect, test } from "vitest";

import { NoChangeFinalizer } from "./no-change-finalizer";
import { buildFinalizationCommand } from "./command";
import type { Digest } from "../../../lib/mission-control/contracts";

// The canonical empty mutation moves nothing, so every seam is a pure comparison against the
// observed head/tree. `git` is injected, which keeps these proofs deterministic and repo-free.
const digest = "a".repeat(64) as Digest;
const head = "b".repeat(64);
const tree = "c".repeat(64);

function finalizer(observedHead = head, observedTree = tree) {
  return new NoChangeFinalizer({
    repoPath: "C:\\repo",
    ref: "refs/heads/target",
    git: async (args) => (args[1] === "refs/heads/target" ? observedHead : observedTree),
  });
}

function command(input: { expectedTree?: string; postcondition?: boolean; targetRevision?: string; mutating?: boolean } = {}) {
  const mutating = input.mutating ?? false;
  return buildFinalizationCommand({
    command_id: "command-finalize-1",
    task_id: "task-1",
    task_spec_revision: 1,
    task_spec_digest: digest,
    mandate_id: "mandate-1",
    mandate_digest: digest,
    verification_receipt_digest: digest,
    source: { artifact_id: "artifact-1", artifact_digest: digest, commit_digest: head },
    base: { identity: "repo:main", revision: input.targetRevision ?? head, digest },
    target: { identity: "repo:main", revision: input.targetRevision ?? head, digest },
    mutation_scope: mutating
      ? { mutation_type: "local_patch", allowed_path_prefixes: ["src"], max_files: 8, max_diff_bytes: 8192, prohibited_changes: [] }
      : { mutation_type: "no_change_close", allowed_path_prefixes: [], max_files: 0, max_diff_bytes: 0, prohibited_changes: [] },
    expected_post_state: input.postcondition
      ? { kind: "postcondition", predicate: "target.tree == verified artifact tree", predicate_digest: digest }
      : { kind: "digest", digest: input.expectedTree ?? tree },
    adapter_operation: mutating ? "git_fast_forward" : "git_no_change_close",
    idempotency_key: "finalize-key-1",
    action_authority: { authority_id: "authority-1", authority_digest: digest },
    created_at: "2026-08-06T12:00:00.000Z",
    mutation_entries: mutating ? [{ path: "src/a.txt", operation: "add", before_digest: null, after_digest: digest }] : undefined,
    diff_bytes: mutating ? 32 : undefined,
  });
}

describe("NoChangeFinalizer", () => {
  test("applies when the target head and tree already match the bound post-state", async () => {
    const subject = finalizer();
    expect(await subject.preflight(command())).toMatchObject({ status: "ready", observed_digest: tree });
    expect(await subject.apply(command())).toMatchObject({ status: "applied" });
    expect(await subject.lookup(command())).toMatchObject({ status: "applied", post_state_digest: tree });
  });

  test("rejects a post-state digest that does not match the observed tree", async () => {
    const subject = finalizer();
    const drifted = command({ expectedTree: "d".repeat(64) });
    expect(await subject.preflight(drifted)).toMatchObject({ status: "drifted" });
    expect(await subject.apply(drifted)).toMatchObject({ status: "rejected" });
    expect(await subject.lookup(drifted)).toMatchObject({ status: "not_applied" });
  });

  test("rejects target-head drift away from the CAS precondition", async () => {
    const subject = finalizer("e".repeat(64), tree);
    expect(await subject.preflight(command())).toMatchObject({ status: "drifted" });
    expect(await subject.apply(command())).toMatchObject({ status: "rejected" });
  });

  // This finalizer observes only a tree digest and has no predicate evaluator, so an unprovable
  // postcondition post-state must fail closed instead of being reported as applied.
  test("rejects an unverifiable postcondition post-state at every seam", async () => {
    const subject = finalizer();
    const unprovable = command({ postcondition: true });
    expect(await subject.preflight(unprovable)).toMatchObject({ status: "drifted" });
    expect(await subject.apply(unprovable)).toMatchObject({ status: "rejected" });
    expect(await subject.lookup(unprovable)).toMatchObject({ status: "not_applied" });
  });

  test("refuses a mutating command: this finalizer only closes the canonical empty mutation", async () => {
    const subject = finalizer();
    const mutating = command({ mutating: true });
    expect(await subject.apply(mutating)).toMatchObject({ status: "rejected" });
    expect(await subject.lookup(mutating)).toMatchObject({ status: "not_applied" });
  });

  test("reports an unknown outcome when the observation itself fails", async () => {
    const failing = new NoChangeFinalizer({
      repoPath: "C:\\repo",
      ref: "refs/heads/target",
      git: async () => { throw new Error("git unavailable"); },
    });
    expect(await failing.apply(command())).toMatchObject({ status: "unknown" });
    expect(await failing.lookup(command())).toMatchObject({ status: "unknown", post_state_digest: null });
  });
});
