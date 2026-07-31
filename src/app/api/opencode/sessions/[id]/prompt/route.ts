export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { OpenCodeClient, type OpenCodeError } from "@/server/opencode/client"

function errorResponse(err: unknown) {
  const e = err as OpenCodeError
  return NextResponse.json(
    { error: { code: "OPENCODE_REQUEST_FAILED", message: e?.message ?? String(err), body: e?.body } },
    { status: typeof e?.status === "number" ? e.status : 502 },
  )
}

// POST /api/opencode/sessions/:id/prompt  { prompt: string, delivery?: "queue" | "steer" }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let body: { prompt?: string; delivery?: "queue" | "steer" }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: "BAD_BODY", message: "Invalid JSON body." } }, { status: 400 })
  }
  if (!body?.prompt || typeof body.prompt !== "string") {
    return NextResponse.json({ error: { code: "MISSING_PROMPT", message: "prompt is required." } }, { status: 400 })
  }
  const delivery: "queue" | "steer" = body.delivery ?? "queue"
  try {
    const data = await OpenCodeClient.fromEnv().prompt(params.id, body.prompt, delivery)
    return NextResponse.json({ data, delivery })
  } catch (err) {
    return errorResponse(err)
  }
}