export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { CEOIntakeRequestV1Schema, IntakeAckV1Schema } from "../../../../lib/mission-control/intake-api";
import { getIntakeControllerDependencies } from "../../../../server/mission-control/intake/dependencies";
import { IntakeController } from "../../../../server/mission-control/intake/intake";
import { validateLocalMissionControlAuthority } from "../../../../server/mission-control/security/local-origin";

const REQUEST_BODY_MAX_BYTES = 64 * 1024;

class RequestBodyTooLargeError extends Error {}

async function readBoundedRequestBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > REQUEST_BODY_MAX_BYTES) {
        void reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function error(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function mappedError(caught: unknown): NextResponse {
  const code = caught instanceof Error && "code" in caught ? caught.code : null;
  if (code === "request_id_conflict") return error(code, "This request ID is already bound to different content.", 409);
  if (code === "intake_pending") return error(code, "This intake request is already being processed.", 409);
  if (code === "invalid_request") return error(code, "Invalid chat request.", 400);
  if (code === "invalid_pm_output") return error(code, "Invalid PM output.", 502);
  if (code === "pm_unavailable") return error(code, "The isolated project manager is unavailable.", 503);
  if (code === "intake_unavailable") return error(code, "The durable intake service is unavailable.", 503);
  return error("intake_unavailable", "The durable intake service is unavailable.", 503);
}

export async function POST(request: Request): Promise<NextResponse> {
  const authority = validateLocalMissionControlAuthority(request.headers);
  if (!authority.ok) return error(authority.code, "Local Mission Control authority is required.", 403);

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return error("unsupported_media_type", "application/json is required.", 415);

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > REQUEST_BODY_MAX_BYTES) {
    return error("request_too_large", "Chat request is too large.", 413);
  }

  let body: string;
  try {
    body = await readBoundedRequestBody(request);
  } catch (caught) {
    if (caught instanceof RequestBodyTooLargeError) return error("request_too_large", "Chat request is too large.", 413);
    return error("invalid_request", "Invalid chat request.", 400);
  }

  const parsed = CEOIntakeRequestV1Schema.safeParse((() => {
    try { return JSON.parse(body) as unknown; } catch { return null; }
  })());
  if (!parsed.success) return error("invalid_request", "Invalid chat request.", 400);

  try {
    const controller = new IntakeController(getIntakeControllerDependencies());
    const acknowledgement = IntakeAckV1Schema.parse(await controller.handle(parsed.data));
    return NextResponse.json(acknowledgement, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    return mappedError(caught);
  }
}
