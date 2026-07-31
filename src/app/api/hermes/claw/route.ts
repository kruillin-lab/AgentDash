export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { clawCleanup, clawMigratePreview, clawMigrateRun } from "@/server/hermes/cli"

export async function GET() {
  return NextResponse.json(await clawMigratePreview())
}

// POST /api/hermes/claw { action: "migrate" | "cleanup" }
export async function POST(req: Request) {
  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: "BAD_BODY", message: "Invalid JSON body." } }, { status: 400 })
  }
  try {
    if (body?.action === "migrate") return NextResponse.json(await clawMigrateRun())
    if (body?.action === "cleanup") return NextResponse.json(await clawCleanup())
    return NextResponse.json({ error: { code: "BAD_ACTION", message: "action must be migrate or cleanup" } }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: { code: "HERMES_CLAW_FAILED", message: err?.message ?? String(err) } }, { status: 502 })
  }
}