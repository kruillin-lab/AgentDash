export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getOutput, kill, resize, writeInput, interrupt } from "@/server/hermes/pty"

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: { code: "BAD_ID" } }, { status: 400 })
  const out = getOutput(id, "clean")
  if (!out) return NextResponse.json({ error: { code: "SESSION_NOT_LIVE" } }, { status: 404 })
  return NextResponse.json({ lines: out.lines })
}

// POST /api/hermes/pty/:id  { action: "input" | "interrupt" | "kill" | "resize", data?: string, cols?: number, rows?: number }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: { code: "BAD_ID" } }, { status: 400 })
  let body: { action?: string; data?: string; cols?: number; rows?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: "BAD_BODY" } }, { status: 400 })
  }
  switch (body?.action) {
    case "input":
      if (typeof body.data !== "string") return NextResponse.json({ error: { code: "MISSING_DATA" } }, { status: 400 })
      return NextResponse.json(writeInput(id, body.data))
    case "interrupt":
      return NextResponse.json(interrupt(id))
    case "resize":
      return NextResponse.json(resize(id, body.cols ?? 120, body.rows ?? 35))
    case "kill":
      return NextResponse.json({ ok: kill(id) })
    default:
      return NextResponse.json({ error: { code: "BAD_ACTION" } }, { status: 400 })
  }
}