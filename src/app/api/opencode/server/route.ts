export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { ensureServer, getStatusWithProbe, startServer, stopServer, type ServerStatus } from "@/server/opencode/server-manager"

export async function GET(): Promise<Response> {
  const status = await getStatusWithProbe()
  return NextResponse.json(status)
}

// POST /api/opencode/server { action: "ensure" | "start" | "stop" }
export async function POST(req: Request): Promise<Response> {
  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: "BAD_BODY", message: "Invalid JSON body." } }, { status: 400 })
  }
  try {
    let status: ServerStatus
    if (body?.action === "stop") {
      status = await stopServer()
    } else if (body?.action === "start") {
      status = await startServer()
    } else {
      // default: "ensure"
      status = await ensureServer()
    }
    const probed = await getStatusWithProbe()
    return NextResponse.json({ ...status, reachable: probed.reachable })
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "OPENCODE_SERVER_MANAGER_FAILED", message: err?.message ?? String(err) } },
      { status: 502 },
    )
  }
}