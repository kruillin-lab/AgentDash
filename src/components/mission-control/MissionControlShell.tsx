"use client";

import React, { useCallback, useEffect, useState } from "react";

import { MissionControlBoardResponseV1Schema, MissionControlServedBoardV1Schema, parseMissionControlCardPayload, type MissionControlCardViewV1, type MissionControlServedBoardV1 } from "../../lib/mission-control/board-view";
import type { IntakeAckV1 } from "../../lib/mission-control/intake-api";
import { AttemptInspector } from "./AttemptInspector";
import { PMPanel } from "./PMPanel";
import { WorkBoard } from "./WorkBoard";

const emptyBoard = (reason: string): MissionControlServedBoardV1 => MissionControlServedBoardV1Schema.parse({ generated_at: new Date().toISOString(), lanes: { ready: [], working: [], needs_you: [], stopped: [], completed: [] }, archived_count: 0, unavailable_reason: reason });

export function MissionControlShell({ board: providedBoard }: { board?: unknown }) {
  const [board, setBoard] = useState<MissionControlServedBoardV1>(() => providedBoard ? MissionControlServedBoardV1Schema.parse(providedBoard) : emptyBoard("Checking read-only Hermes board availability…"));
  const [selected, setSelected] = useState<MissionControlCardViewV1 | null>(null);

  const refreshBoard = useCallback(async (): Promise<MissionControlServedBoardV1 | null> => {
    try {
      const response = await fetch("/api/mission-control/board");
      if (!response.ok) throw new Error("board request failed");
      const refreshed = MissionControlBoardResponseV1Schema.parse(await response.json()).board;
      setBoard(refreshed);
      return refreshed;
    } catch {
      setBoard((current) => ({ ...current, unavailable_reason: "Unable to refresh the read-only Hermes board." }));
      return null;
    }
  }, []);

  useEffect(() => {
    if (providedBoard) return;
    void refreshBoard();
  }, [providedBoard, refreshBoard]);

  const handleAcknowledged = useCallback(async (acknowledgement: IntakeAckV1): Promise<void> => {
    if (!acknowledgement.board_refresh || acknowledgement.select_task_id === null) return;
    const refreshed = await refreshBoard();
    if (!refreshed) return;
    const card = Object.values(refreshed.lanes)
      .flat()
      .map(parseMissionControlCardPayload)
      .find((candidate) => candidate.task_id === acknowledgement.select_task_id) ?? null;
    setSelected(card);
  }, [refreshBoard]);

  return (
    <div data-testid="mission-control-layout" className="grid min-h-[calc(100vh-5.5rem)] gap-4 xl:grid-cols-[minmax(12rem,0.75fr)_minmax(0,1.5fr)_minmax(14rem,0.8fr)]">
      <aside className="min-w-0"><PMPanel onAcknowledged={handleAcknowledged} /></aside>
      <main className="min-w-0 space-y-3">
        {board.unavailable_reason && <p role="status" className="rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-xs text-amber-100/75">{board.unavailable_reason}</p>}
        <WorkBoard board={board} selectedTaskId={selected?.task_id ?? null} onSelect={setSelected} />
      </main>
      <aside className="min-w-0"><AttemptInspector card={selected} /></aside>
    </div>
  );
}
