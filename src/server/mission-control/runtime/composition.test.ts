import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getMissionControlController, stopMissionControlController } from "./composition";
import { MissionControlController } from "./controller";
import { RecoveryOutbox } from "./outbox";
import { ControllerOwner } from "./owner-lock";

const roots: string[] = [];
const ENV_KEYS = ["MISSION_CONTROL_DISPATCH", "AGENTDASH_STATE_DIR"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(async () => {
  await stopMissionControlController();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function stateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentdash-composition-"));
  roots.push(root);
  return root;
}

describe("mission control composition root", () => {
  test("builds a dormant controller that owns the lease and refuses model dispatch", async () => {
    process.env.AGENTDASH_STATE_DIR = await stateRoot();
    process.env.MISSION_CONTROL_DISPATCH = "enabled";

    const controller = await getMissionControlController();

    expect(controller).not.toBeNull();
    expect(controller?.isOwner).toBe(true);
    // Even wired and owning the lease, no command can reach a worker transport:
    // there is no staged proposal and the dormant adapters fail closed.
    await expect(controller?.advanceCommand("command-1")).rejects.toThrow();
  });

  test("returns one shared controller and never a second owner for the same state dir", async () => {
    process.env.AGENTDASH_STATE_DIR = await stateRoot();
    process.env.MISSION_CONTROL_DISPATCH = "enabled";

    const first = await getMissionControlController();
    expect(await getMissionControlController()).toBe(first);

    // A separate process identity against the same live state dir cannot own it.
    const contender = new MissionControlController({
      mode: "enabled",
      owner: new ControllerOwner({ stateDir: process.env.AGENTDASH_STATE_DIR, pid: 999_999, processStartToken: "other-process" }),
      outbox: new RecoveryOutbox({ stateDir: process.env.AGENTDASH_STATE_DIR }),
      runner: { advance: async () => ({ state: "found" as const, binding: null }) },
    });
    expect(await contender.start()).toBe(false);
  });

  test("stays unwired and fail-closed without a configured state directory", async () => {
    delete process.env.AGENTDASH_STATE_DIR;
    process.env.MISSION_CONTROL_DISPATCH = "enabled";

    expect(await getMissionControlController()).toBeNull();
  });
});
