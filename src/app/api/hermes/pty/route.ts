export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { listLive, ptyAvailability, spawnHermes } from "@/server/hermes/pty"

export async function GET() {
  const avail = await ptyAvailability()
  return NextResponse.json({ available: avail.available, reason: avail.reason, sessions: listLive() })
}

// POST /api/hermes/pty { cwd?: string, resumeSession?: string }
export async function POST(req: Request) {
  let body: { cwd?: string; resumeSession?: string }
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const res = await spawnHermes({ cwd: body?.cwd, resumeSession: body?.resumeSession })
  if (res.ok) return NextResponse.json(res)
  return NextResponse.json(res, { status: 400 })
}