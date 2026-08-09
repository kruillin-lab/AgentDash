export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { buildMissionControlHealth } from "../../../../server/mission-control/policy/health";
import { getMissionControlController } from "../../../../server/mission-control/runtime/composition";

// Redacted Mission Control health: dispatch mode, auto-launch eligibility, and
// proof identifiers/expiries. Truthful and fail-closed; never manufactures
// evidence or exposes credentials.
export async function GET() {
  // Report the mode actually IN FORCE. Reading MISSION_CONTROL_DISPATCH directly
  // made health display `enabled` from an env var alone, while the controller —
  // which grants authority only from the durable promotion record — was
  // `disabled`. A null controller means no state dir is configured, so nothing is
  // in force: `disabled` is the truthful fail-closed answer.
  const controller = await getMissionControlController().catch(() => null);
  const health = buildMissionControlHealth({
    now: new Date().toISOString(),
    dispatch_mode: controller?.mode ?? "disabled",
    proofs: [],
    auto_snapshot: null,
  });
  return NextResponse.json(health, { headers: { "Cache-Control": "no-store" } });
}
