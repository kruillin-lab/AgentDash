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

  test("rejects Host values coalesced by the Headers implementation", () => {
    const headers = new Headers({ Host: "127.0.0.1:3007", Origin: "http://127.0.0.1:3007" });
    headers.append("Host", "127.0.0.1:3007");

    expect(validateLocalMissionControlAuthority(headers)).toEqual({ ok: false, code: "invalid_local_authority" });
  });

  test("rejects Origin values coalesced by the Headers implementation", () => {
    const headers = new Headers({ Host: "127.0.0.1:3007", Origin: "http://127.0.0.1:3007" });
    headers.append("Origin", "http://127.0.0.1:3007");

    expect(validateLocalMissionControlAuthority(headers)).toEqual({ ok: false, code: "invalid_local_authority" });
  });

  test("rejects IPv6 loopback and wildcard authorities", () => {
    const rejectedHosts = ["[::1]:3007", "0.0.0.0:3007"];

    for (const host of rejectedHosts) {
      expect(
        validateLocalMissionControlAuthority(new Headers({ Host: host, Origin: `http://${host}` })),
      ).toEqual({ ok: false, code: "invalid_local_authority" });
    }
  });

  // Both loopback names are accepted, but only paired with themselves. A page served on
  // one name driving the other is a genuinely cross-origin request that the browser would
  // send without a preflight, so the mismatch has to stay fatal.
  test("rejects a loopback Origin that does not name the Host it was sent to", () => {
    const crossed = [
      { Host: "localhost:3007", Origin: "http://127.0.0.1:3007" },
      { Host: "127.0.0.1:3007", Origin: "http://localhost:3007" },
    ];

    for (const headers of crossed) {
      expect(validateLocalMissionControlAuthority(new Headers(headers))).toEqual({ ok: false, code: "invalid_local_authority" });
    }
  });

  test("accepts either loopback name when the Origin names that same Host", () => {
    const accepted = [
      { Host: "127.0.0.1:3007", Origin: "http://127.0.0.1:3007" },
      { Host: "localhost:3007", Origin: "http://localhost:3007" },
    ];

    for (const headers of accepted) {
      expect(validateLocalMissionControlAuthority(new Headers(headers))).toEqual({ ok: true });
    }
  });
});
