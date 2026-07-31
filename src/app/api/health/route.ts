export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getStatusWithProbe } from "@/server/opencode/server-manager"
import { ptyAvailability } from "@/server/hermes/pty"

export async function GET() {
  const [oc, pty] = await Promise.all([getStatusWithProbe(), ptyAvailability()])
  return NextResponse.json({
    ok: true,
    opencode: oc,
    hermesPty: pty,
    version: "2.0.0",
  })
}