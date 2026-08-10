export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getStatus, getSessionStats, listSessions } from "@/server/hermes/cli"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const what = url.searchParams.get("what") ?? "status"
  try {
    if (what === "status") return NextResponse.json(await getStatus())
    if (what === "sessions") return NextResponse.json(await listSessions(25))
    if (what === "stats") return NextResponse.json(await getSessionStats())
    return NextResponse.json({ error: { code: "BAD_QUERY", message: `unknown what=${what}` } }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: { code: "HERMES_FAILED", message: err?.message ?? String(err) } }, { status: 502 })
  }
}