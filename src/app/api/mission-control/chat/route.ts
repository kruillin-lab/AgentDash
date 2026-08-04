export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { getPMChatDependencies, PMOutputError, PMTurnOutputV1Schema, PMUnavailableError, type PMChatDependencies } from "../../../../server/hermes/pm";
import { PMTurnInputV1Schema } from "../../../../server/mission-control/pm-prompt";
import { validateLocalMissionControlAuthority } from "../../../../server/mission-control/security/local-origin";

const REQUEST_BODY_MAX_BYTES = 64 * 1024;

function error(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function createChatPost(dependencies: PMChatDependencies) {
  return async function post(request: Request): Promise<NextResponse> {
    const authority = validateLocalMissionControlAuthority(request.headers);
    if (!authority.ok) return error(authority.code, "Local Mission Control authority is required.", 403);

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return error("unsupported_media_type", "application/json is required.", 415);

    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > REQUEST_BODY_MAX_BYTES) {
      return error("request_too_large", "Chat request is too large.", 413);
    }

    let input: unknown;
    try {
      const body = await request.text();
      if (Buffer.byteLength(body, "utf8") > REQUEST_BODY_MAX_BYTES) return error("request_too_large", "Chat request is too large.", 413);
      input = PMTurnInputV1Schema.parse(JSON.parse(body) as unknown);
    } catch {
      return error("invalid_request", "Invalid chat request.", 400);
    }

    try {
      const output = PMTurnOutputV1Schema.parse(await dependencies.pm.turn(PMTurnInputV1Schema.parse(input), { signal: request.signal }));
      if (output.proposal.intent === "create_task") {
        if (!dependencies.proposalHandoff) return error("proposal_handoff_unavailable", "Executable proposal intake is unavailable.", 503);
        await dependencies.proposalHandoff(output.proposal);
      }
      return NextResponse.json(output);
    } catch (caught) {
      if (caught instanceof PMUnavailableError) return error(caught.code, caught.message, 503);
      if (caught instanceof PMOutputError) return error(caught.code, caught.message, 502);
      return error("pm_request_failed", "The project manager request failed.", 502);
    }
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  return createChatPost(getPMChatDependencies())(request);
}
