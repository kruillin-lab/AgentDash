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
  test("normalizes a hostile or missing dispatch mode to disabled", () => {
    process.env.MISSION_CONTROL_DISPATCH = "production";
    register();
    expect(process.env.MISSION_CONTROL_DISPATCH).toBe("disabled");

    delete process.env.MISSION_CONTROL_DISPATCH;
    register();
    expect(process.env.MISSION_CONTROL_DISPATCH).toBe("disabled");

    process.env.MISSION_CONTROL_DISPATCH = "ENABLED";
    register();
    expect(process.env.MISSION_CONTROL_DISPATCH).toBe("disabled");
  });

  test("preserves the four exact modes", () => {
    for (const mode of ["disabled", "qualification", "candidate", "enabled"] as const) {
      process.env.MISSION_CONTROL_DISPATCH = mode;
      register();
      expect(process.env.MISSION_CONTROL_DISPATCH).toBe(mode);
    }
  });
});
