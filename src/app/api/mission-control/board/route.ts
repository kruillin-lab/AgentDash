export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { MissionControlBoardV1Schema } from "../../../../lib/mission-control/contracts";
import { loadBoardFromHermes, unavailableBoard } from "../../../../server/mission-control/read-model";

const BoardResponseSchema = z.object({
  board: MissionControlBoardV1Schema,
  unavailable_reason: z.string().min(1).nullable(),
}).strict();

const unavailableHermes = {
  projectBoard: async () => unavailableBoard("Hermes board bridge is not configured."),
};

export async function GET() {
  const board = await loadBoardFromHermes(unavailableHermes);
  return NextResponse.json(BoardResponseSchema.parse({ board, unavailable_reason: board.unavailable_reason }));
}
