export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { validateLocalMissionControlAuthority } from "@/server/mission-control/security/local-origin"
import { dashboardLaunch, dashboardStatus, dashboardStop } from "@/server/hermes/cli"

export async function GET() {
  return NextResponse.json(await dashboardStatus())
}

// POST /api/hermes/dashboard { action: "launch" | "stop", port?: number }
export async function POST(req: Request) {
  const authority = validateLocalMissionControlAuthority(req.headers)
  if (!authority.ok) return NextResponse.json({ error: { code: authority.code, message: "Local Mission Control authority is required." } }, { status: 403 })
  let body: { action?: string; port?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: "BAD_BODY", message: "Invalid JSON body." } }, { status: 400 })
  }
  try {
    if (body?.action === "launch") {
      const port = body.port && body.port > 0 ? body.port : 9119
      return NextResponse.json(await dashboardLaunch(port))
    }
    if (body?.action === "stop") {
      return NextResponse.json(await dashboardStop())
    }
    return NextResponse.json({ error: { code: "BAD_ACTION", message: "action must be launch or stop" } }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: { code: "HERMES_DASHBOARD_FAILED", message: err?.message ?? String(err) } }, { status: 502 })
  }
}