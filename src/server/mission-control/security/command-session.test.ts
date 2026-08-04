import { describe, expect, test } from "vitest";

import { issueCommandSession, verifyCommandSession } from "./command-session";

const signingSecret = "seeded-test-secret-that-must-never-appear-in-output";
const now = 1_725_000_000_000;

describe("command sessions", () => {
  test("issues an HttpOnly SameSite=Strict cookie without leaking the signing secret", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });

    expect(issued.set_cookie).toContain("HttpOnly");
    expect(issued.set_cookie).toContain("SameSite=Strict");
    expect(issued.set_cookie).not.toContain(signingSecret);
    expect(issued.csrf_token).not.toContain(signingSecret);
    expect(issued.session.csrf_digest).not.toContain(signingSecret);
  });

  test("rejects a missing SameSite session cookie", () => {
    const result = verifyCommandSession({ secret: signingSecret, csrf_token: "any-csrf-value" }, now);

    expect(result).toBeNull();
  });

  test("rejects a missing CSRF header", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });
    const result = verifyCommandSession({ secret: signingSecret, cookie: issued.cookie }, now + 1);

    expect(result).toBeNull();
  });

  test("rejects a mismatched CSRF header", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });
    const result = verifyCommandSession(
      { secret: signingSecret, cookie: issued.cookie, csrf_token: "different-csrf-value" },
      now + 1,
    );

    expect(result).toBeNull();
  });

  test("rejects an expired or tampered signed session", () => {
    const issued = issueCommandSession({ secret: signingSecret, now, ttl_ms: 1_000 });
    const expired = verifyCommandSession(
      { secret: signingSecret, cookie: issued.cookie, csrf_token: issued.csrf_token },
      now + 1_001,
    );
    const tampered = verifyCommandSession(
      { secret: signingSecret, cookie: `${issued.cookie}x`, csrf_token: issued.csrf_token },
      now + 1,
    );

    expect(expired).toBeNull();
    expect(tampered).toBeNull();
  });

  test("verifies a session only with its matching signed cookie and CSRF header", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });
    const verified = verifyCommandSession(
      { secret: signingSecret, cookie: issued.cookie, csrf_token: issued.csrf_token },
      now + 1,
    );

    expect(verified).toEqual(issued.session);
  });
});
