export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { ActivationResultV1Schema } from "../../../../lib/mission-control/contracts";
import { getCEOCommandRouteDependencies } from "../../../../server/mission-control/authority/dependencies";
import { CEOInitialApprovalRequestV1Schema } from "../../../../server/mission-control/authority/ceo-command";
import { COMMAND_SESSION_COOKIE_NAME, verifyCommandSession } from "../../../../server/mission-control/security/command-session";
import { validateLocalMissionControlAuthority } from "../../../../server/mission-control/security/local-origin";

const BODY_MAX_BYTES = 16 * 1_024;

function error(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function commandCookie(rawCookie: string | null): string | null {
  if (!rawCookie) return null;
  const values = rawCookie.split(";").map((part) => part.trim()).flatMap((part) => {
    const separator = part.indexOf("=");
    return separator > 0 && part.slice(0, separator) === COMMAND_SESSION_COOKIE_NAME ? [part.slice(separator + 1)] : [];
  });
  return values.length === 1 && values[0].length > 0 ? values[0] : null;
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

function mappedServiceError(caught: unknown): NextResponse {
  const code = caught instanceof Error && "code" in caught ? caught.code : "activation_unavailable";
  if (code === "invalid_request") return error(code, "Invalid initial approval request.", 400);
  if (code === "activation_not_found") return error(code, "The approval target does not exist.", 404);
  if (code === "activation_conflict" || code === "replay_conflict" || code === "activation_expired") return error(String(code), "The approval command conflicts with canonical state.", 409);
  return error("activation_unavailable", "Initial activation is unavailable.", 503);
}

export async function POST(request: Request): Promise<NextResponse> {
  const authority = validateLocalMissionControlAuthority(request.headers);
  if (!authority.ok) return error(authority.code, "Local Mission Control authority is required.", 403);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return error("unsupported_media_type", "application/json is required.", 415);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) return error("request_too_large", "Command request is too large.", 413);
  let body: string | null;
  try { body = await boundedBody(request); } catch { return error("invalid_request", "Invalid initial approval request.", 400); }
  if (body === null) return error("request_too_large", "Command request is too large.", 413);
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return error("invalid_request", "Invalid initial approval request.", 400); }
  const parsed = CEOInitialApprovalRequestV1Schema.safeParse(raw);
  if (!parsed.success) return error("invalid_request", "Invalid initial approval request.", 400);

  const dependencies = getCEOCommandRouteDependencies();
  if (dependencies.secret.length < 32) return error("activation_unavailable", "Initial activation is unavailable.", 503);
  const cookie = commandCookie(request.headers.get("cookie"));
  const session = verifyCommandSession({ secret: dependencies.secret, cookie: cookie ?? undefined, csrf_token: request.headers.get("x-agentdash-csrf") ?? undefined }, dependencies.now());
  if (!session) return error("invalid_command_session", "A current command session is required.", 401);
  try {
    const result = ActivationResultV1Schema.parse(await dependencies.service.approveInitial(parsed.data, session));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    return mappedServiceError(caught);
  }
}
