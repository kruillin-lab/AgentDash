import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { register } from "./instrumentation";

const ENV_KEYS = ["MISSION_CONTROL_DISPATCH"] as const;
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
