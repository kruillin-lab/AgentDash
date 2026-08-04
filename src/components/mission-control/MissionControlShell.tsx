"use client";

import React, { useEffect, useState } from "react";

import type { MissionControlBoardV1 } from "../../lib/mission-control/contracts";
import { AttemptInspector } from "./AttemptInspector";
import { PMPanel } from "./PMPanel";
import { type MissionControlCard } from "./TaskCard";
import { WorkBoard } from "./WorkBoard";

const loadingBoard = (): MissionControlBoardV1 => ({ generated_at: new Date().toISOString(), lanes: { ready: [], working: [], needs_you: [], stopped: [], completed: [] }, archived_count: 0, unavailable_reason: "Checking read-only Hermes board availability…" });

export function MissionControlShell({ board: providedBoard }: { board?: MissionControlBoardV1 }) {
  const [board, setBoard] = useState<MissionControlBoardV1>(providedBoard ?? loadingBoard);
  const [selected, setSelected] = useState<MissionControlCard | null>(null);

  useEffect(() => {
    if (providedBoard) return;
    let cancelled = false;
    fetch("/api/mission-control/board")
      .then((response) => response.json())
      .then((response) => { if (!cancelled) setBoard(response.board); })
      .catch(() => { if (!cancelled) setBoard({ ...loadingBoard(), unavailable_reason: "Unable to load the read-only Hermes board." }); });
    return () => { cancelled = true; };
  }, [providedBoard]);

  return (
    <div data-testid="mission-control-layout" className="grid min-h-[calc(100vh-5.5rem)] gap-4 xl:grid-cols-[minmax(16rem,0.85fr)_minmax(34rem,2fr)_minmax(18rem,0.9fr)]">
      <aside className="min-w-0"><PMPanel /></aside>
      <main className="min-w-0 space-y-3">
        {board.unavailable_reason && <p role="status" className="rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-xs text-amber-100/75">{board.unavailable_reason}</p>}
        <WorkBoard board={board} selectedTaskId={selected?.task_id ?? null} onSelect={setSelected} />
      </main>
      <aside className="min-w-0"><AttemptInspector card={selected} /></aside>
    </div>
  );
}
