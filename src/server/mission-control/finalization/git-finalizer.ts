import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  FinalizationCommandV1,
  FinalizationLookupResultV1,
  FinalizationPreflightV1,
  FinalizationApplyResultV1,
} from "../../../lib/mission-control/contracts";
import { DigestSchema, type Digest } from "../../../lib/mission-control/contracts";

// ---------------------------------------------------------------------------
// Local git fast-forward finalizer
//
// The only mutating finalizer in the MVP. It rechecks every binding immediately
// before mutation — target head (CAS), clean worktree, fast-forward ancestry,
// and the exact changed-path scope — then moves the target ref to the source
// commit with no merge, rebase, or broader diff. On any ambiguity it looks up
// the exact head/tree and never issues a second blind mutation. A no-change
// close applies the canonical empty mutation with no ref movement.
// ---------------------------------------------------------------------------

const run = promisify(execFile);

export interface GitRunner {
  (args: string[]): Promise<string>;
}

async function defaultGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: repoPath, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

export type GitFastForwardFinalizerOptions = Readonly<{
  repoPath: string;
  ref: string;
  git?: (args: string[]) => Promise<string>;
}>;

export class GitFastForwardFinalizer {
  private readonly repoPath: string;
  private readonly ref: string;
  private readonly git: (args: string[]) => Promise<string>;

  constructor(options: GitFastForwardFinalizerOptions) {
    this.repoPath = options.repoPath;
    this.ref = options.ref;
    this.git = options.git ?? ((args) => defaultGit(this.repoPath, args));
  }

  private async head(): Promise<string> {
    return this.git(["rev-parse", this.ref]);
  }

  private async treeOf(commit: string): Promise<Digest> {
    return DigestSchema.parse(await this.git(["rev-parse", `${commit}^{tree}`]));
  }

  private async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    try {
      await this.git(["merge-base", "--is-ancestor", ancestor, descendant]);
      return true;
    } catch {
      return false;
    }
  }

  private async isClean(): Promise<boolean> {
    return (await this.git(["status", "--porcelain"])) === "";
  }

  private async changedPaths(from: string, to: string): Promise<string[]> {
    const out = await this.git(["diff", "--name-only", from, to]);
    return out === "" ? [] : out.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  private pathAllowed(path: string, command: FinalizationCommandV1): boolean {
    const scope = command.mutation_scope;
    if (scope.prohibited_changes.some((prohibited) => path === prohibited || path.startsWith(`${prohibited}/`))) return false;
    return scope.allowed_path_prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  // This finalizer observes only a Git tree digest. It has no predicate evaluator, so a
  // `postcondition` expected post-state cannot be proven here. The spec requires the receipt prove
  // the observed post-state matches the bound digest or deterministic postcondition before success,
  // so an unverifiable post-state must fail closed instead of being accepted as applied.
  private postStateVerifiable(command: FinalizationCommandV1): boolean {
    return command.expected_post_state.kind === "digest";
  }

  private postStateMatches(command: FinalizationCommandV1, tree: string): boolean {
    return command.expected_post_state.kind === "digest" && tree === command.expected_post_state.digest;
  }

  async preflight(command: FinalizationCommandV1): Promise<FinalizationPreflightV1> {
    const head = await this.head();
    const observed = await this.treeOf(head);
    if (!this.postStateVerifiable(command)) return { status: "rejected", observed_digest: observed };
    if (head !== command.cas_precondition.expected_revision) return { status: "drifted", observed_digest: observed };
    return { status: "ready", observed_digest: observed };
  }

  async apply(command: FinalizationCommandV1): Promise<FinalizationApplyResultV1> {
    const operationId = command.command_id;
    try {
      // An unprovable expected post-state can never be finalized here.
      if (!this.postStateVerifiable(command)) return { status: "rejected", operation_id: operationId };

      // Recheck the CAS binding immediately before any mutation.
      const head = await this.head();
      if (head !== command.cas_precondition.expected_revision) return { status: "rejected", operation_id: operationId };

      const source = command.source.commit_digest;
      if (source === null) return { status: "rejected", operation_id: operationId };

      if (command.mutation_manifest.mutation_type === "no_change_close") {
        // Canonical empty mutation: the target must already be at the expected state.
        if (source !== head) return { status: "rejected", operation_id: operationId };
        const tree = await this.treeOf(head);
        if (!this.postStateMatches(command, tree)) return { status: "rejected", operation_id: operationId };
        return { status: "applied", operation_id: operationId };
      }

      // local_patch fast-forward.
      if (!await this.isClean()) return { status: "rejected", operation_id: operationId };
      if (!await this.isAncestor(head, source)) return { status: "rejected", operation_id: operationId };

      // Recheck the exact changed-path scope against the real diff.
      const changed = await this.changedPaths(head, source);
      if (changed.some((path) => !this.pathAllowed(path, command))) return { status: "rejected", operation_id: operationId };

      await this.git(["update-ref", this.ref, source]);
      return { status: "applied", operation_id: operationId };
    } catch {
      return { status: "unknown", operation_id: operationId };
    }
  }

  async lookup(command: FinalizationCommandV1): Promise<FinalizationLookupResultV1> {
    try {
      const source = command.source.commit_digest;
      const head = await this.head();
      if (source === null || head !== source) return { status: "not_applied", post_state_digest: null };
      const tree = await this.treeOf(head);
      if (!this.postStateMatches(command, tree)) return { status: "not_applied", post_state_digest: null };
      return { status: "applied", post_state_digest: tree };
    } catch {
      return { status: "unknown", post_state_digest: null };
    }
  }
}
