export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { getCommandSessionRouteDependencies } from "../../../../server/mission-control/authority/dependencies";
import { issueCommandSession } from "../../../../server/mission-control/security/command-session";
import { validateLocalMissionControlAuthority } from "../../../../server/mission-control/security/local-origin";

const BODY_MAX_BYTES = 1_024;

function error(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function boundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_MAX_BYTES) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function POST(request: Request): Promise<NextResponse> {
  const authority = validateLocalMissionControlAuthority(request.headers);
  if (!authority.ok) return error(authority.code, "Local Mission Control authority is required.", 403);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return error("unsupported_media_type", "application/json is required.", 415);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) return error("request_too_large", "Session request is too large.", 413);
  let body: string | null;
  try { body = await boundedBody(request); } catch { return error("invalid_request", "Invalid session request.", 400); }
  if (body === null) return error("request_too_large", "Session request is too large.", 413);
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return error("invalid_request", "Invalid session request.", 400); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || Object.keys(parsed).length !== 0) return error("invalid_request", "Invalid session request.", 400);

  const dependencies = getCommandSessionRouteDependencies();
  if (dependencies.secret.length < 32) return error("session_unavailable", "Command sessions are unavailable.", 503);
  try {
    const issued = issueCommandSession({ secret: dependencies.secret, now: dependencies.now() });
    return NextResponse.json({ schema_version: "agentdash.command-session/v1", csrf_token: issued.csrf_token, expires_at: new Date(issued.session.expires_at).toISOString() }, { headers: { "Cache-Control": "no-store", "Set-Cookie": issued.set_cookie } });
  } catch {
    return error("session_unavailable", "Command sessions are unavailable.", 503);
  }
}
