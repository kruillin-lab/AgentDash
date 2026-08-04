export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { MissionControlBoardResponseV1Schema } from "../../../../lib/mission-control/board-view";
import { loadBoardFromHermes, unavailableBoard } from "../../../../server/mission-control/read-model";

const unavailableHermes = {
  projectBoard: async () => unavailableBoard("Hermes board bridge is not configured."),
};

export async function GET() {
  const board = await loadBoardFromHermes(unavailableHermes);
  return NextResponse.json(MissionControlBoardResponseV1Schema.parse({ board, unavailable_reason: board.unavailable_reason }));
}
