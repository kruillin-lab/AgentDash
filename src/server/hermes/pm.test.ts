import { writeFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

import type { CommandOptions, CommandResult } from "./command";
import { PMUnavailableError, createHermesPM } from "./pm";

const executable = process.execPath;
const profileHome = "C:\\isolated\\luisos-pm";
const now = new Date("2026-08-04T10:00:00.000Z");
const validProof = {
  schema_version: "agentdash.pm-isolation-proof/v1" as const,
  level: 5 as const,
  status: "passed" as const,
  executable,
  profile_home: profileHome,
  verified_at: "2026-08-04T09:00:00.000Z",
  expires_at: "2026-08-05T09:00:00.000Z",
};
const turnInput = { message: "Please implement the release checklist.", history: [], reviewed_recall: [], capability_facts: [] };

function commandResult(stdout: string): CommandResult {
  return { stdout, stderr: "", code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false };
}

function fakeHermes(modelOutput: unknown) {
  return vi.fn(async (options: CommandOptions) => {
    const usageIndex = options.args.indexOf("--usage-file");
    await writeFile(options.args[usageIndex + 1], JSON.stringify({ session_id: "pm-session-1", model: "fixture" }), "utf8");
    return commandResult(JSON.stringify(modelOutput));
  });
}

describe("HermesPM", () => {
  // Production break caught: a casual or clarifying turn could be mislabeled as executable work with a task identity.
  test("returns conversation_only with no task identity", async () => {
    const run = fakeHermes({
      text: "I can help clarify the release goal.",
      proposal: {
        schema_version: "agentdash.management-proposal/v1",
        proposal_id: "proposal-1",
        task_id: null,
        intent: "conversation_only",
        created_at: "2026-08-04T10:00:00.000Z",
      },
    });
    const pm = createHermesPM({ executable, allowedExecutables: [executable], profileHome, isolationProof: validProof, now: () => now, run });

    await expect(pm.turn({ ...turnInput, message: "Hello, can we talk about priorities?" })).resolves.toEqual({
      text: "I can help clarify the release goal.",
      session_ref: "pm-session-1",
      proposal: {
        schema_version: "agentdash.management-proposal/v1",
        proposal_id: "proposal-1",
        task_id: null,
        intent: "conversation_only",
        created_at: "2026-08-04T10:00:00.000Z",
      },
    });
  });

  // Production break caught: an executable request could lose its conversational explanation or strict proposal contract.
  test("returns conversational text plus strict create_task proposal data", async () => {
    const run = fakeHermes({
      text: "I drafted a bounded implementation proposal for controller review.",
      proposal: {
        schema_version: "agentdash.management-proposal/v1",
        proposal_id: "proposal-2",
        task_id: null,
        intent: "create_task",
        evidence_refs: ["release-policy"],
        created_at: "2026-08-04T10:00:00.000Z",
      },
    });
    const pm = createHermesPM({ executable, allowedExecutables: [executable], profileHome, isolationProof: validProof, now: () => now, run });

    const output = await pm.turn(turnInput);

    expect(output.text).toBe("I drafted a bounded implementation proposal for controller review.");
    expect(output.session_ref).toBe("pm-session-1");
    expect(output.proposal.intent).toBe("create_task");
  });

  // Production break caught: model-authored adapter or authority claims could be stripped and accidentally accepted.
  test.each([
    { adapter_command: { adapter: "codeg", action: "dispatch" } },
    { approval_grant: { approved: true } },
    { authority: "ceo" },
  ])("rejects forbidden proposal fields instead of stripping them", async (forbiddenField) => {
    const run = fakeHermes({
      text: "Approved and dispatched.",
      proposal: {
        schema_version: "agentdash.management-proposal/v1",
        proposal_id: "proposal-3",
        task_id: null,
        intent: "create_task",
        created_at: "2026-08-04T10:00:00.000Z",
        ...forbiddenField,
      },
    });
    const pm = createHermesPM({ executable, allowedExecutables: [executable], profileHome, isolationProof: validProof, now: () => now, run });

    await expect(pm.turn(turnInput)).rejects.toThrow(/invalid PM output/i);
  });

  // Production break caught: an unrecognized intent could smuggle a lifecycle mutation through an open string field.
  test("rejects unknown management intents", async () => {
    const run = fakeHermes({
      text: "I ran it.",
      proposal: {
        schema_version: "agentdash.management-proposal/v1",
        proposal_id: "proposal-4",
        task_id: null,
        intent: "dispatch",
        created_at: "2026-08-04T10:00:00.000Z",
      },
    });
    const pm = createHermesPM({ executable, allowedExecutables: [executable], profileHome, isolationProof: validProof, now: () => now, run });

    await expect(pm.turn(turnInput)).rejects.toThrow(/invalid PM output/i);
  });

  // Production break caught: conversational text could claim approval or dispatch while the proposal object looks valid.
  test("rejects authority and adapter-action claims in PM text", async () => {
    const run = fakeHermes({
      text: "I approved and dispatched the task through CodeG.",
      proposal: {
        schema_version: "agentdash.management-proposal/v1",
        proposal_id: "proposal-5",
        task_id: null,
        intent: "create_task",
        created_at: "2026-08-04T10:00:00.000Z",
      },
    });
    const pm = createHermesPM({ executable, allowedExecutables: [executable], profileHome, isolationProof: validProof, now: () => now, run });

    await expect(pm.turn(turnInput)).rejects.toThrow(/invalid PM output/i);
  });

  // Production break caught: a stale or mismatched containment proof could permit a live PM invocation.
  test("fails closed before process launch when level-5 isolation proof is not current", async () => {
    const run = fakeHermes({});
    const pm = createHermesPM({
      executable,
      allowedExecutables: [executable],
      profileHome,
      isolationProof: { ...validProof, expires_at: "2026-08-04T09:30:00.000Z" },
      now: () => now,
      run,
    });

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(run).not.toHaveBeenCalled();
  });
});
