export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getStatusWithProbe } from "@/server/opencode/server-manager"
import { ptyAvailability } from "@/server/hermes/pty"
import { buildMissionControlHealth } from "@/server/mission-control/policy/health"
import { getMissionControlController } from "@/server/mission-control/runtime/composition"

export async function GET() {
  const [oc, pty] = await Promise.all([getStatusWithProbe(), ptyAvailability()])
  // The mode actually in force, not the raw env var: MISSION_CONTROL_DISPATCH may
  // only RESTRICT the durable promotion record, so reporting it directly let health
  // claim `enabled` while the controller was `disabled`.
  const controller = await getMissionControlController().catch(() => null)
  const missionControl = buildMissionControlHealth({
    now: new Date().toISOString(),
    dispatch_mode: controller?.mode ?? "disabled",
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
