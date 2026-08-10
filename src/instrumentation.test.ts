import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { register } from "./instrumentation";

const ENV_KEYS = ["MISSION_CONTROL_DISPATCH", "AGENTDASH_STATE_DIR", "NEXT_RUNTIME"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("mission control instrumentation", () => {
  test("normalizes a hostile dispatch mode to disabled", () => {
    process.env.MISSION_CONTROL_DISPATCH = "production";
    register();
    expect(process.env.MISSION_CONTROL_DISPATCH).toBe("disabled");

    // Case-sensitive: an exact match is required, so "ENABLED" is not `enabled`.
    process.env.MISSION_CONTROL_DISPATCH = "ENABLED";
    register();
    expect(process.env.MISSION_CONTROL_DISPATCH).toBe("disabled");
  });

  test("a non-nodejs runtime never acquires the controller lease", async () => {
    // An independent mutation sweep found deleting the NEXT_RUNTIME guard changed no
    // test result. The edge/client graphs must never load the Node-only composition
    // root or contend the single controller-owner lease. Observable contract: on a
    // non-nodejs runtime, register() writes no lease file into the state dir.
    const saved = process.env.NEXT_RUNTIME;
    const stateDir = await mkdtemp(join(tmpdir(), "agentdash-instr-"));
    try {
      process.env.NEXT_RUNTIME = "edge";
      process.env.AGENTDASH_STATE_DIR = stateDir;
      await register();
      // A nodejs register() acquires the lease under mission-control/controller-owner.
      await expect(stat(join(stateDir, "mission-control", "controller-owner", "owner.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (saved === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = saved;
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  test("an absent dispatch mode stays absent so it restricts nothing", () => {
    // This test previously asserted the OPPOSITE — that an absent variable becomes
    // the literal "disabled" — and that assertion encoded a real bug. Because
    // resolveDispatchMode treats a PRESENT env value as a restriction, writing
    // "disabled" for a variable nobody set made the env var always restrict, so a
    // legitimately promoted `candidate`/`enabled` record could never take effect.
    // Fail-closed is still preserved: resolveDispatchMode defaults the stored mode to
    // `disabled`, so an absent env plus no promotion is still `disabled`.
    delete process.env.MISSION_CONTROL_DISPATCH;
    register();
    expect(process.env.MISSION_CONTROL_DISPATCH).toBeUndefined();

    // An empty string is equally "unset" and must not become a restriction either.
    process.env.MISSION_CONTROL_DISPATCH = "";
    register();
    expect(process.env.MISSION_CONTROL_DISPATCH).toBe("");
  });

  test("preserves the four exact modes", () => {
    for (const mode of ["disabled", "qualification", "candidate", "enabled"] as const) {
      process.env.MISSION_CONTROL_DISPATCH = mode;
      register();
      expect(process.env.MISSION_CONTROL_DISPATCH).toBe(mode);
    }
  });
});
