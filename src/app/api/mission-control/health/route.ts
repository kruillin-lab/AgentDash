export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { buildMissionControlHealth } from "../../../../server/mission-control/policy/health";

// Redacted Mission Control health: dispatch mode, auto-launch eligibility, and
// proof identifiers/expiries. Truthful and fail-closed; never manufactures
// evidence or exposes credentials.
export async function GET() {
  const health = buildMissionControlHealth({
    now: new Date().toISOString(),
    dispatch_env: process.env.MISSION_CONTROL_DISPATCH,
    proofs: [],
    auto_snapshot: null,
  });
  return NextResponse.json(health, { headers: { "Cache-Control": "no-store" } });
}
