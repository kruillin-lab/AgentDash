export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getStatusWithProbe } from "@/server/opencode/server-manager"
import { ptyAvailability } from "@/server/hermes/pty"
import { buildMissionControlHealth } from "@/server/mission-control/policy/health"

export async function GET() {
  const [oc, pty] = await Promise.all([getStatusWithProbe(), ptyAvailability()])
  const missionControl = buildMissionControlHealth({
    now: new Date().toISOString(),
    dispatch_env: process.env.MISSION_CONTROL_DISPATCH,
    proofs: [],
    auto_snapshot: null,
  })
  return NextResponse.json({
    ok: true,
    opencode: oc,
    hermesPty: pty,
    version: "2.0.0",
    mission_control: {
      dispatch: missionControl.dispatch,
      auto_launch: missionControl.auto_launch,
      proofs: missionControl.proofs,
    },
  })
}
