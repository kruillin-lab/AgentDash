import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const COMMAND_SESSION_COOKIE_NAME = "agentdash_command_session";
export const MAX_COMMAND_SESSION_TTL_MS = 15 * 60 * 1_000;
export const DEFAULT_COMMAND_SESSION_TTL_MS = 5 * 60 * 1_000;

const commandSessionSchema = z
  .object({
    schema_version: z.literal("command_session_v1"),
    session_id: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
    csrf_digest: z.string().regex(/^[a-f0-9]{64}$/),
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().positive(),
  })
  .strict();

export type CommandSessionV1 = z.infer<typeof commandSessionSchema>;

export interface IssuedCommandSession {
  session: CommandSessionV1;
  cookie: string;
  csrf_token: string;
  set_cookie: string;
}

export interface IssueCommandSessionOptions {
  secret: string;
  now?: number;
  ttl_ms?: number;
}

export interface VerifyCommandSessionInput {
  secret: string;
  cookie?: string;
  csrf_token?: string;
}

function isValidSecret(value: string): boolean {
  return value.length >= 32;
}

function isValidTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function encodeSession(session: CommandSessionV1): string {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

function sign(encodedSession: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedSession, "utf8").digest();
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeDigestMatch(expected: string, supplied: string | undefined): boolean {
  const expectedDigest = /^[a-f0-9]{64}$/.test(expected) ? Buffer.from(expected, "hex") : Buffer.alloc(32);
  const suppliedDigest = Buffer.from(digest(supplied ?? ""), "hex");
  return timingSafeEqual(expectedDigest, suppliedDigest) && supplied !== undefined && /^[a-f0-9]{64}$/.test(expected);
}

function parseCookie(cookie: string | undefined, secret: string): CommandSessionV1 | null {
  if (!cookie || !isValidSecret(secret)) return null;
  const parts = cookie.split(".");
  const encodedSession = parts.length === 2 ? parts[0] : "";
  const encodedSignature = parts.length === 2 ? parts[1] : "";
  const signatureIsEncoded = /^[A-Za-z0-9_-]{43}$/.test(encodedSignature);
  const suppliedSignature = signatureIsEncoded ? Buffer.from(encodedSignature, "base64url") : Buffer.alloc(32);
  const expectedSignature = sign(encodedSession, secret);
  const signatureMatches = timingSafeEqual(expectedSignature, suppliedSignature) && signatureIsEncoded;
  if (!signatureMatches || !/^[A-Za-z0-9_-]{1,2048}$/.test(encodedSession)) return null;

  try {
    const parsed = commandSessionSchema.safeParse(JSON.parse(Buffer.from(encodedSession, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Creates the opaque cookie and the separate CSRF token for one command session. */
export function issueCommandSession({
  secret,
  now = Date.now(),
  ttl_ms = DEFAULT_COMMAND_SESSION_TTL_MS,
}: IssueCommandSessionOptions): IssuedCommandSession {
  if (!isValidSecret(secret) || !isValidTimestamp(now) || !Number.isSafeInteger(ttl_ms) || ttl_ms <= 0 || ttl_ms > MAX_COMMAND_SESSION_TTL_MS) {
    throw new TypeError("Invalid command session configuration.");
  }

  const csrf_token = randomBytes(32).toString("base64url");
  const session: CommandSessionV1 = {
    schema_version: "command_session_v1",
    session_id: randomBytes(32).toString("base64url"),
    csrf_digest: digest(csrf_token),
    issued_at: now,
    expires_at: now + ttl_ms,
  };
  const encodedSession = encodeSession(session);
  const cookie = `${encodedSession}.${sign(encodedSession, secret).toString("base64url")}`;
  const maxAge = Math.ceil(ttl_ms / 1_000);

  return {
    session,
    cookie,
    csrf_token,
    set_cookie: `${COMMAND_SESSION_COOKIE_NAME}=${cookie}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict`,
  };
}

/** Verifies both the signed HttpOnly cookie and the session-bound CSRF header. */
export function verifyCommandSession(input: VerifyCommandSessionInput, now = Date.now()): CommandSessionV1 | null {
  if (!isValidTimestamp(now)) return null;
  const session = parseCookie(input.cookie, input.secret);
  if (!session || session.issued_at > now || session.expires_at <= now || session.expires_at - session.issued_at > MAX_COMMAND_SESSION_TTL_MS) {
    return null;
  }

  return safeDigestMatch(session.csrf_digest, input.csrf_token) ? session : null;
}
