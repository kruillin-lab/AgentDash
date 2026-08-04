import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { z } from "zod";

import { ManagementProposalV1Schema, type ManagementProposalV1 } from "../../lib/mission-control/contracts";
import { PMTurnInputV1Schema, buildPMPrompt, type PMTurnInputV1 } from "../mission-control/pm-prompt";
import { runCommand, type CommandOptions, type CommandResult } from "./command";
import { buildPMEnvironment } from "./pm-environment";

const PM_TIMEOUT_MS = 90_000;
const PM_OUTPUT_MAX_BYTES = 64 * 1024;
const USAGE_FILE_MAX_BYTES = 16 * 1024;
const FORBIDDEN_PM_OUTPUT_CLAIM = /\b(?:CEOCommandV1|ApprovalGrant|ActionAuthorityV1|adapter[_ -]?command)\b|\b(?:I|we)\s+(?:have\s+)?(?:approved|authorized|dispatched|executed|ran|wrote|browsed|researched|delegated|created\s+(?:the\s+)?card)\b/i;

const PMIsolationProofV1Schema = z.object({
  schema_version: z.literal("agentdash.pm-isolation-proof/v1"),
  level: z.literal(5),
  status: z.literal("passed"),
  executable: z.string().min(1),
  profile_home: z.string().min(1),
  verified_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
}).strict();
export type PMIsolationProofV1 = z.infer<typeof PMIsolationProofV1Schema>;

const ManagementProposalForTurnSchema = ManagementProposalV1Schema.superRefine((proposal, context) => {
  if (proposal.intent !== "conversation_only" && proposal.intent !== "create_task") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "unsupported management intent" });
  }
  if (proposal.task_id !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "PM proposals cannot assign task identity" });
  }
});

const PMTextSchema = z.string().min(1).max(16_384).refine((text) => !FORBIDDEN_PM_OUTPUT_CLAIM.test(text), "PM text claims forbidden authority or action");

const PMModelOutputV1Schema = z.object({
  text: PMTextSchema,
  proposal: ManagementProposalForTurnSchema,
}).strict();

export const PMTurnOutputV1Schema = z.object({
  text: PMTextSchema,
  session_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
  proposal: ManagementProposalForTurnSchema,
}).strict();
export type PMTurnOutputV1 = z.infer<typeof PMTurnOutputV1Schema>;

export interface HermesPM {
  turn(input: PMTurnInputV1, options?: { signal?: AbortSignal }): Promise<PMTurnOutputV1>;
}

export type ProposalHandoff = (proposal: ManagementProposalV1) => Promise<void>;
export type PMChatDependencies = { pm: HermesPM; proposalHandoff?: ProposalHandoff };

export class PMUnavailableError extends Error {
  readonly code = "pm_unavailable";

  constructor() {
    super("The isolated project manager is unavailable.");
    this.name = "PMUnavailableError";
  }
}

export class PMOutputError extends Error {
  readonly code = "invalid_pm_output";

  constructor() {
    super("Invalid PM output.");
    this.name = "PMOutputError";
  }
}

type RunBoundary = (options: CommandOptions) => Promise<CommandResult>;

export type CreateHermesPMOptions = {
  executable: string;
  allowedExecutables: readonly string[];
  profileHome: string;
  isolationProof: PMIsolationProofV1;
  inferenceModel?: string;
  inferenceProvider?: string;
  environmentSource?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  run?: RunBoundary;
};

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
}

function hasCurrentProof(options: CreateHermesPMOptions, now: Date): boolean {
  const result = PMIsolationProofV1Schema.safeParse(options.isolationProof);
  if (!result.success) return false;
  const proof = result.data;
  return samePath(proof.executable, options.executable)
    && samePath(proof.profile_home, options.profileHome)
    && Date.parse(proof.verified_at) <= now.getTime()
    && Date.parse(proof.expires_at) > now.getTime();
}

async function readSessionReference(path: string): Promise<string> {
  const metadata = await stat(path);
  if (metadata.size <= 0 || metadata.size > USAGE_FILE_MAX_BYTES) throw new PMOutputError();
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  return z.object({ session_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/) }).passthrough().parse(parsed).session_id;
}

export function createHermesPM(options: CreateHermesPMOptions): HermesPM {
  const now = options.now ?? (() => new Date());
  const run = options.run ?? runCommand;

  return {
    async turn(rawInput, turnOptions = {}) {
      const input = PMTurnInputV1Schema.parse(rawInput);
      if (!hasCurrentProof(options, now())) throw new PMUnavailableError();

      const directory = await mkdtemp(join(tmpdir(), "agentdash-pm-turn-"));
      const usageFile = join(directory, "usage.json");
      try {
        const result = await run({
          executable: options.executable,
          allowedExecutables: options.allowedExecutables,
          args: [
            "--safe-mode",
            "--ignore-user-config",
            "--ignore-rules",
            "--no-restore-cwd",
            "--usage-file",
            usageFile,
            "-z",
            buildPMPrompt(input),
          ],
          cwd: directory,
          env: buildPMEnvironment({
            source: options.environmentSource ?? process.env,
            profileHome: options.profileHome,
            inferenceModel: options.inferenceModel,
            inferenceProvider: options.inferenceProvider,
          }),
          timeoutMs: PM_TIMEOUT_MS,
          maxOutputBytes: PM_OUTPUT_MAX_BYTES,
          signal: turnOptions.signal,
        });
        if (result.code !== 0 || result.timedOut || result.aborted || result.outputLimitExceeded) throw new PMUnavailableError();

        let modelOutput: z.infer<typeof PMModelOutputV1Schema>;
        let sessionRef: string;
        try {
          modelOutput = PMModelOutputV1Schema.parse(JSON.parse(result.stdout) as unknown);
          sessionRef = await readSessionReference(usageFile);
        } catch {
          throw new PMOutputError();
        }
        return PMTurnOutputV1Schema.parse({ ...modelOutput, session_ref: sessionRef });
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  };
}

export const unavailableHermesPM: HermesPM = {
  async turn(): Promise<never> {
    throw new PMUnavailableError();
  },
};

/** Task 6 replaces this fail-closed production seam with the durable intake controller. */
export function getPMChatDependencies(): PMChatDependencies {
  return { pm: unavailableHermesPM };
}

export type { ManagementProposalV1 };
