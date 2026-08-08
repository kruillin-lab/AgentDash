import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import { GitFastForwardFinalizer } from "./git-finalizer";
import { buildFinalizationCommand } from "./command";
import type { Digest } from "../../../lib/mission-control/contracts";

const run = promisify(execFile);
const roots: string[] = [];
const digest = "a".repeat(64) as Digest;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd });
  return stdout.trim();
}

async function commitFile(cwd: string, name: string, content: string, message: string): Promise<string> {
  const full = join(cwd, name);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
  await git(cwd, "add", name);
  await git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentdash-finalize-"));
  roots.push(root);
  // SHA-256 object format so every commit/tree id is a 64-hex Digest.
  await git(root, "init", "-q", "--object-format=sha256", "-b", "main");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "commit.gpgsign", "false");
  return root;
}

async function finalizeCommand(input: { base: string; target: string; sourceCommit: string | null; expectedTree: string; entries?: { path: string; operation: "add" | "modify" | "delete"; before_digest: Digest | null; after_digest: Digest | null }[]; diffBytes?: number }) {
  const mutating = (input.entries ?? []).length > 0;
  return buildFinalizationCommand({
    command_id: "command-finalize-1",
    task_id: "task-1",
    task_spec_revision: 1,
    task_spec_digest: digest,
    mandate_id: "mandate-1",
    mandate_digest: digest,
    verification_receipt_digest: digest,
    source: { artifact_id: "artifact-1", artifact_digest: digest, commit_digest: input.sourceCommit },
    base: { identity: "repo:main", revision: input.base, digest },
    target: { identity: "repo:main", revision: input.target, digest },
    mutation_scope: mutating
      ? { mutation_type: "local_patch", allowed_path_prefixes: ["src"], max_files: 8, max_diff_bytes: 8192, prohibited_changes: [] }
      : { mutation_type: "no_change_close", allowed_path_prefixes: [], max_files: 0, max_diff_bytes: 0, prohibited_changes: [] },
    expected_post_state: { kind: "digest", digest: input.expectedTree },
    adapter_operation: mutating ? "git_fast_forward" : "git_no_change_close",
    idempotency_key: "finalize-key-1",
    action_authority: { authority_id: "authority-1", authority_digest: digest },
    created_at: "2026-08-06T12:00:00.000Z",
    mutation_entries: input.entries,
    diff_bytes: input.diffBytes,
  });
}

describe("GitFastForwardFinalizer", () => {
  test("clean fast-forward lands the source commit and lookup proves the expected post-state", async () => {
    const root = await repo();
    const base = await commitFile(root, "base.txt", "base", "base");
    await git(root, "checkout", "-q", "-b", "target", base);
    const source = await commitFile(root, join("src", "feature.txt"), "feature", "feature");
    const expectedTree = await git(root, "rev-parse", "HEAD^{tree}");
    await git(root, "checkout", "-q", "main");
    await git(root, "branch", "-f", "target", base);

    const finalizer = new GitFastForwardFinalizer({ repoPath: root, ref: "refs/heads/target" });
    const command = await finalizeCommand({ base, target: base, sourceCommit: source, expectedTree, entries: [{ path: "src/feature.txt", operation: "add", before_digest: null, after_digest: digest }], diffBytes: 32 });

    expect(await finalizer.preflight(command)).toMatchObject({ status: "ready" });
    expect(await finalizer.apply(command)).toMatchObject({ status: "applied" });
    expect(await finalizer.lookup(command)).toMatchObject({ status: "applied", post_state_digest: expectedTree });
  });

  test("target drift before mutation is reported, never blindly mutated", async () => {
    const root = await repo();
    const base = await commitFile(root, "base.txt", "base", "base");
    await git(root, "checkout", "-q", "-b", "target", base);
    const source = await commitFile(root, join("src", "feature.txt"), "feature", "feature");
    const expectedTree = await git(root, "rev-parse", "HEAD^{tree}");
    // Move the target ref forward (drift) after the command was built.
    await git(root, "checkout", "-q", "main");
    await git(root, "branch", "-f", "target", source);

    const finalizer = new GitFastForwardFinalizer({ repoPath: root, ref: "refs/heads/target" });
    const command = await finalizeCommand({ base, target: base, sourceCommit: source, expectedTree, entries: [{ path: "src/feature.txt", operation: "add", before_digest: null, after_digest: digest }], diffBytes: 32 });

    expect(await finalizer.preflight(command)).toMatchObject({ status: "drifted" });
    expect(await finalizer.apply(command)).toMatchObject({ status: "rejected" });
  });

  test("a non-fast-forward target is rejected", async () => {
    const root = await repo();
    const base = await commitFile(root, "base.txt", "base", "base");
    await git(root, "checkout", "-q", "-b", "target", base);
    const source = await commitFile(root, join("src", "feature.txt"), "feature", "feature");
    const expectedTree = await git(root, "rev-parse", "HEAD^{tree}");
    // Diverge the target so source is no longer a descendant.
    await git(root, "checkout", "-q", "main");
    await commitFile(root, "diverge.txt", "diverge", "diverge");
    const diverged = await git(root, "rev-parse", "HEAD");
    await git(root, "branch", "-f", "target", diverged);

    const finalizer = new GitFastForwardFinalizer({ repoPath: root, ref: "refs/heads/target" });
    const command = await finalizeCommand({ base, target: diverged, sourceCommit: source, expectedTree, entries: [{ path: "src/feature.txt", operation: "add", before_digest: null, after_digest: digest }], diffBytes: 32 });

    expect(await finalizer.apply(command)).toMatchObject({ status: "rejected" });
  });

  test("a dirty target worktree blocks mutation", async () => {
    const root = await repo();
    const base = await commitFile(root, "base.txt", "base", "base");
    await git(root, "checkout", "-q", "-b", "target", base);
    const source = await commitFile(root, join("src", "feature.txt"), "feature", "feature");
    const expectedTree = await git(root, "rev-parse", "HEAD^{tree}");
    await git(root, "checkout", "-q", "target");
    await writeFile(join(root, "dirty.txt"), "untracked", "utf8");

    const finalizer = new GitFastForwardFinalizer({ repoPath: root, ref: "refs/heads/target" });
    const command = await finalizeCommand({ base, target: base, sourceCommit: source, expectedTree, entries: [{ path: "src/feature.txt", operation: "add", before_digest: null, after_digest: digest }], diffBytes: 32 });

    expect(await finalizer.apply(command)).toMatchObject({ status: "rejected" });
  });

  test("a source commit whose real diff touches an out-of-scope path is rejected on recheck", async () => {
    const root = await repo();
    const base = await commitFile(root, "base.txt", "base", "base");
    await git(root, "checkout", "-q", "-b", "target", base);
    // The source commit changes both an in-scope file and an out-of-scope file.
    await commitFile(root, join("src", "feature.txt"), "feature", "feature");
    const source = await commitFile(root, "secrets.txt", "secret", "secret");
    const expectedTree = await git(root, "rev-parse", "HEAD^{tree}");
    await git(root, "checkout", "-q", "main");
    await git(root, "branch", "-f", "target", base);

    const finalizer = new GitFastForwardFinalizer({ repoPath: root, ref: "refs/heads/target" });
    // The manifest only declares the in-scope file; the real diff carries more.
    const command = await finalizeCommand({ base, target: base, sourceCommit: source, expectedTree, entries: [{ path: "src/feature.txt", operation: "add", before_digest: null, after_digest: digest }], diffBytes: 32 });

    await expect(finalizer.apply(command)).resolves.toMatchObject({ status: "rejected" });
  });

  test("a lost apply response is recovered by lookup, never a second mutation", async () => {
    const root = await repo();
    const base = await commitFile(root, "base.txt", "base", "base");
    await git(root, "checkout", "-q", "-b", "target", base);
    const source = await commitFile(root, join("src", "feature.txt"), "feature", "feature");
    const expectedTree = await git(root, "rev-parse", "HEAD^{tree}");
    await git(root, "checkout", "-q", "main");
    await git(root, "branch", "-f", "target", base);

    const finalizer = new GitFastForwardFinalizer({ repoPath: root, ref: "refs/heads/target" });
    const command = await finalizeCommand({ base, target: base, sourceCommit: source, expectedTree, entries: [{ path: "src/feature.txt", operation: "add", before_digest: null, after_digest: digest }], diffBytes: 32 });

    await finalizer.apply(command); // the mutation lands but imagine the response was lost
    expect(await finalizer.lookup(command)).toMatchObject({ status: "applied", post_state_digest: expectedTree });
  });

  test("a canonical no-change close applies with no ref movement and a matching post-state", async () => {
    const root = await repo();
    const base = await commitFile(root, "base.txt", "base", "base");
    await git(root, "branch", "target", base);
    const expectedTree = await git(root, "rev-parse", `${base}^{tree}`);

    const finalizer = new GitFastForwardFinalizer({ repoPath: root, ref: "refs/heads/target" });
    const command = await finalizeCommand({ base, target: base, sourceCommit: base, expectedTree });

    expect(await finalizer.preflight(command)).toMatchObject({ status: "ready" });
    expect(await finalizer.apply(command)).toMatchObject({ status: "applied" });
    expect(await finalizer.lookup(command)).toMatchObject({ status: "applied", post_state_digest: expectedTree });
    expect(await git(root, "rev-parse", "target")).toBe(base);
  });
});
