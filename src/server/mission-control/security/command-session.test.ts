import { createHash, createHmac } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { describe, expect, test } from "vitest";

import { MAX_COMMAND_SESSION_TTL_MS, issueCommandSession, verifyCommandSession } from "./command-session";

const signingSecret = "seeded-test-secret-that-must-never-appear-in-output";
const now = 1_725_000_000_000;
const base64urlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function signSession(session: Record<string, unknown>): string {
  const encodedSession = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signature = createHmac("sha256", signingSecret).update(encodedSession, "utf8").digest("base64url");
  return `${encodedSession}.${signature}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function noncanonicalTrailingBits(encoded: string): string {
  const canonicalIndex = base64urlAlphabet.indexOf(encoded.at(-1) ?? "");
  if (canonicalIndex < 0 || (canonicalIndex & 0b11) !== 0) throw new Error("expected a canonical 32-byte base64url value");
  return `${encoded.slice(0, -1)}${base64urlAlphabet[canonicalIndex | 0b01]}`;
}

describe("command sessions", () => {
  test("issues an HttpOnly SameSite=Strict cookie without leaking the signing secret", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });

    expect(issued.set_cookie.includes("HttpOnly")).toBe(true);
    expect(issued.set_cookie.includes("SameSite=Strict")).toBe(true);
    expect(issued.set_cookie.includes(signingSecret)).toBe(false);
    expect(issued.csrf_token.includes(signingSecret)).toBe(false);
    expect(issued.session.csrf_digest.includes(signingSecret)).toBe(false);
  });

  test("evaluates seeded command material through an opaque report-safety predicate", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });
    const seededValues = [
      issued.set_cookie,
      issued.cookie,
      issued.csrf_token,
      issued.session.session_id,
      issued.session.csrf_digest,
    ];
    const valuesStayOpaque = seededValues.every((value) => value.length > 0 && !value.includes(signingSecret));

    expect(valuesStayOpaque).toBe(true);
  });

  test("rejects a missing session cookie", () => {
    const result = verifyCommandSession({ secret: signingSecret, csrf_token: "any-csrf-value" }, now);

    expect(result === null).toBe(true);
  });

  test("rejects a missing CSRF header", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });
    const result = verifyCommandSession({ secret: signingSecret, cookie: issued.cookie }, now + 1);

    expect(result === null).toBe(true);
  });

  test("rejects a mismatched CSRF header", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });
    const result = verifyCommandSession(
      { secret: signingSecret, cookie: issued.cookie, csrf_token: "different-csrf-value" },
      now + 1,
    );

    expect(result === null).toBe(true);
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

    expect(expired === null).toBe(true);
    expect(tampered === null).toBe(true);
  });

  test("rejects a byte-equivalent signature with noncanonical trailing bits", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });
    const [encodedSession, signature] = issued.cookie.split(".");
    const noncanonicalSignature = noncanonicalTrailingBits(signature);
    const noncanonicalCookie = `${encodedSession}.${noncanonicalSignature}`;

    expect(Buffer.from(noncanonicalSignature, "base64url").equals(Buffer.from(signature, "base64url"))).toBe(true);
    expect(
      verifyCommandSession(
        { secret: signingSecret, cookie: noncanonicalCookie, csrf_token: issued.csrf_token },
        now + 1,
      ) === null,
    ).toBe(true);
  });

  test("rejects malformed signed-session cookie encodings", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });
    const malformedCookies = ["", ".", `${issued.cookie}.extra`, `!${issued.cookie.slice(1)}`];

    for (const cookie of malformedCookies) {
      expect(verifyCommandSession({ secret: signingSecret, cookie, csrf_token: issued.csrf_token }, now + 1) === null).toBe(true);
    }
  });

  test("rejects a validly signed session with excessive TTL", () => {
    const csrfToken = "csrf-token-for-valid-signed-fixture";
    const cookie = signSession({
      schema_version: "command_session_v1",
      session_id: "session-id-with-at-least-thirty-two-chars",
      csrf_digest: sha256(csrfToken),
      issued_at: now,
      expires_at: now + MAX_COMMAND_SESSION_TTL_MS + 1,
    });

    expect(verifyCommandSession({ secret: signingSecret, cookie, csrf_token: csrfToken }, now + 1) === null).toBe(true);
  });

  test("rejects a validly signed session with an unknown payload field", () => {
    const csrfToken = "csrf-token-for-strict-schema-fixture";
    const cookie = signSession({
      schema_version: "command_session_v1",
      session_id: "session-id-with-at-least-thirty-two-chars",
      csrf_digest: sha256(csrfToken),
      issued_at: now,
      expires_at: now + 60_000,
      unexpected: "must-fail-closed",
    });

    expect(verifyCommandSession({ secret: signingSecret, cookie, csrf_token: csrfToken }, now + 1) === null).toBe(true);
  });

  test("rejects a canonical signature with the wrong HMAC bytes", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });
    const [encodedSession, signature] = issued.cookie.split(".");
    const wrongSignature = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    const wrongCookie = `${encodedSession}.${wrongSignature}`;

    expect(Buffer.from(wrongSignature, "base64url").toString("base64url") === wrongSignature).toBe(true);
    expect(
      verifyCommandSession({ secret: signingSecret, cookie: wrongCookie, csrf_token: issued.csrf_token }, now + 1) === null,
    ).toBe(true);
  });

  test("verifies a session only with its matching signed cookie and CSRF header", () => {
    const issued = issueCommandSession({ secret: signingSecret, now });
    const verified = verifyCommandSession(
      { secret: signingSecret, cookie: issued.cookie, csrf_token: issued.csrf_token },
      now + 1,
    );

    const matchesIssuedSession = isDeepStrictEqual(verified, issued.session);
    const rejectsAdditionalFields = !isDeepStrictEqual(
      { ...issued.session, unexpected: "must-remain-a-mismatch" },
      issued.session,
    );

    expect(matchesIssuedSession).toBe(true);
    expect(rejectsAdditionalFields).toBe(true);
  });
});
