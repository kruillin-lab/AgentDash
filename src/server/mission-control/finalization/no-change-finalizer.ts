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
// No-change finalizer
//
// The canonical empty mutation: the task's verified artifact is already the
// exact expected post-state, so finalization moves nothing. It only proves the
// target head matches the CAS precondition and that the observed tree equals
// the bound expected post-state digest. Any drift is rejected; there is never
// a mutation to retry.
// ---------------------------------------------------------------------------

const run = promisify(execFile);

async function defaultGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: repoPath, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

export type NoChangeFinalizerOptions = Readonly<{
  repoPath: string;
  ref: string;
  git?: (args: string[]) => Promise<string>;
}>;

export class NoChangeFinalizer {
  private readonly git: (args: string[]) => Promise<string>;
  private readonly ref: string;

  constructor(options: NoChangeFinalizerOptions) {
    this.ref = options.ref;
    this.git = options.git ?? ((args) => defaultGit(options.repoPath, args));
  }

  private async observed(): Promise<{ head: string; tree: Digest }> {
    const head = await this.git(["rev-parse", this.ref]);
    const tree = DigestSchema.parse(await this.git(["rev-parse", `${head}^{tree}`]));
    return { head, tree };
  }

  private matches(command: FinalizationCommandV1, observed: { head: string; tree: string }): boolean {
    if (command.mutation_manifest.mutation_type !== "no_change_close") return false;
    if (observed.head !== command.cas_precondition.expected_revision) return false;
    // This finalizer observes only a Git tree digest and has no predicate evaluator, so a
    // `postcondition` expected post-state is unprovable here and must fail closed rather than be
    // accepted as applied.
    if (command.expected_post_state.kind !== "digest") return false;
    if (observed.tree !== command.expected_post_state.digest) return false;
    return true;
  }

  async preflight(command: FinalizationCommandV1): Promise<FinalizationPreflightV1> {
    const observed = await this.observed();
    return this.matches(command, observed) ? { status: "ready", observed_digest: observed.tree } : { status: "drifted", observed_digest: observed.tree };
  }

  async apply(command: FinalizationCommandV1): Promise<FinalizationApplyResultV1> {
    const operationId = command.command_id;
    try {
      const observed = await this.observed();
      // The canonical empty mutation "applies" only when the state already matches.
      return this.matches(command, observed) ? { status: "applied", operation_id: operationId } : { status: "rejected", operation_id: operationId };
    } catch {
      return { status: "unknown", operation_id: operationId };
    }
  }

  async lookup(command: FinalizationCommandV1): Promise<FinalizationLookupResultV1> {
    try {
      const observed = await this.observed();
      return this.matches(command, observed) ? { status: "applied", post_state_digest: observed.tree } : { status: "not_applied", post_state_digest: null };
    } catch {
      return { status: "unknown", post_state_digest: null };
    }
  }
}
