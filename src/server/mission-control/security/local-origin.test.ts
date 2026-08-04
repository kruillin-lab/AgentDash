import { describe, expect, test } from "vitest";

import { validateLocalMissionControlAuthority } from "./local-origin";

describe("validateLocalMissionControlAuthority", () => {
  test("rejects a non-loopback Host header", () => {
    const result = validateLocalMissionControlAuthority(
      new Headers({ Host: "192.168.1.19:3007", Origin: "http://127.0.0.1:3007" }),
    );

    expect(result).toEqual({ ok: false, code: "invalid_local_authority" });
  });

  test("rejects a foreign Origin header", () => {
    const result = validateLocalMissionControlAuthority(
      new Headers({ Host: "127.0.0.1:3007", Origin: "http://evil.example" }),
    );

    expect(result).toEqual({ ok: false, code: "invalid_local_authority" });
  });

  test("rejects a missing Origin on a mutation", () => {
    const result = validateLocalMissionControlAuthority(new Headers({ Host: "127.0.0.1:3007" }));

    expect(result).toEqual({ ok: false, code: "invalid_local_authority" });
  });

  test("rejects duplicate or forwarded authority values", () => {
    const duplicated = validateLocalMissionControlAuthority(
      new Headers({ Host: "127.0.0.1:3007, 127.0.0.1:3007", Origin: "http://127.0.0.1:3007" }),
    );
    const forwarded = validateLocalMissionControlAuthority(
      new Headers({
        Host: "127.0.0.1:3007",
        Origin: "http://127.0.0.1:3007",
        "X-Forwarded-Host": "attacker.example",
      }),
    );

    expect(duplicated).toEqual({ ok: false, code: "invalid_local_authority" });
    expect(forwarded).toEqual({ ok: false, code: "invalid_local_authority" });
  });

  test("accepts only the exact local mutation authority", () => {
    const result = validateLocalMissionControlAuthority(
      new Headers({ Host: "127.0.0.1:3007", Origin: "http://127.0.0.1:3007" }),
    );

    expect(result).toEqual({ ok: true });
  });
});
