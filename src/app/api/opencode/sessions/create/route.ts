export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { OpenCodeClient } from "@/server/opencode/client"

// POST /api/opencode/sessions  { title?: string, parentID?: string }
// Creates a new opencode session and returns its info.
export async function POST(req: Request) {
  let body: { title?: string; parentID?: string } = {}
  try { body = await req.json() } catch { /* empty body is OK */ }
  try {
    const session = await OpenCodeClient.fromEnv().createSession(body)
    return NextResponse.json({ session })
  } catch (err: any) {
    return NextResponse.json({ error: { code: "OPENCODE_CREATE_FAILED", message: err?.message ?? String(err) } }, { status: 502 })
  }
}