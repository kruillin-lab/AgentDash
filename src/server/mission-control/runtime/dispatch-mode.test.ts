import { describe, expect, test } from "vitest";

import { gateDecision, parseDispatchMode, resolveDispatchMode } from "./dispatch-mode";

describe("parseDispatchMode", () => {
  test.each(["disabled", "qualification", "candidate", "enabled"])("accepts the exact mode %s", (mode) => {
    expect(parseDispatchMode(mode)).toBe(mode);
  });

  // Anything unrecognized fails closed rather than inheriting a permissive value.
  test.each([undefined, null, "", "ENABLED", "production", "enabled ", 1, {}, []])("fails closed for %o", (raw) => {
    expect(parseDispatchMode(raw)).toBe("disabled");
  });
});

// ---------------------------------------------------------------------------
// The durable promotion record is authoritative, but the env var can only ever
// RESTRICT it further: promotion is a deliberate operator action recorded by
// compare-and-set, and an env var must never widen authority past the mode the
// promotion manifest actually proved.
// ---------------------------------------------------------------------------
describe("resolveDispatchMode", () => {
  test("uses the durable promoted mode when no env override narrows it", () => {
    expect(resolveDispatchMode({ storedMode: "enabled", envMode: "enabled" })).toBe("enabled");
    expect(resolveDispatchMode({ storedMode: "candidate", envMode: undefined })).toBe("candidate");
  });

  test("an env var can never widen authority beyond the promoted mode", () => {
    // Nothing was ever promoted, so an env var claiming `enabled` grants nothing.
    expect(resolveDispatchMode({ storedMode: null, envMode: "enabled" })).toBe("disabled");
    // A candidate promotion cannot be escalated to enabled by environment alone.
    expect(resolveDispatchMode({ storedMode: "candidate", envMode: "enabled" })).toBe("candidate");
  });

  test("an env var may narrow authority for a local rollback", () => {
    // The runbook's rollback path: MISSION_CONTROL_DISPATCH=disabled must win.
    expect(resolveDispatchMode({ storedMode: "enabled", envMode: "disabled" })).toBe("disabled");
    expect(resolveDispatchMode({ storedMode: "enabled", envMode: "candidate" })).toBe("candidate");
  });

  test("an unreadable or absent store is disabled", () => {
    expect(resolveDispatchMode({ storedMode: null, envMode: undefined })).toBe("disabled");
    expect(resolveDispatchMode({ storedMode: "garbage" as never, envMode: "enabled" })).toBe("disabled");
  });
});

describe("gateDecision", () => {
  test("only enabled admits model-backed work", () => {
    expect(gateDecision("enabled", "model_backed").allowed).toBe(true);
    for (const mode of ["disabled", "qualification", "candidate"] as const) {
      expect(gateDecision(mode, "model_backed").allowed).toBe(false);
    }
  });

  test("qualification and candidate admit only their own work kind", () => {
    expect(gateDecision("qualification", "qualification").allowed).toBe(true);
    expect(gateDecision("qualification", "candidate").allowed).toBe(false);
    expect(gateDecision("candidate", "candidate").allowed).toBe(true);
    expect(gateDecision("candidate", "qualification").allowed).toBe(false);
  });

  test("disabled admits nothing", () => {
    for (const kind of ["model_backed", "qualification", "candidate"] as const) {
      expect(gateDecision("disabled", kind).allowed).toBe(false);
    }
  });
});
