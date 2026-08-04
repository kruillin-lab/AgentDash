import React from "react";
import type { MissionControlBoardV1 } from "../../lib/mission-control/contracts";
import { Panel, PanelHeader } from "../ui";
import { TaskCard, cardFromPayload, type MissionControlCard } from "./TaskCard";

const LANE_META = [
  ["ready", "Ready", "#22e3ff"],
  ["working", "Working", "#a78bfa"],
  ["needs_you", "Needs you", "#ffb454"],
  ["stopped", "Stopped", "#ff6b8b"],
  ["completed", "Completed", "#9dff5b"],
] as const;

export function WorkBoard({ board, selectedTaskId, onSelect }: { board: MissionControlBoardV1; selectedTaskId: string | null; onSelect: (card: MissionControlCard) => void }) {
  return (
    <section aria-label="Work board" className="min-w-0">
      <div className="mb-3 flex items-center justify-between px-1">
        <div><div className="text-[10px] uppercase tracking-[0.28em] text-white/40">Read-only work board</div><h1 className="text-lg font-semibold text-white/90">CEO Mission Control</h1></div>
        <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">No command surface</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-5">
        {LANE_META.map(([key, label, accent]) => {
          const cards = board.lanes[key].map(cardFromPayload).filter((card): card is MissionControlCard => card !== null);
          return (
            <Panel key={key} strong className="min-h-[13rem] p-3" role="region" aria-label={label}>
              <PanelHeader title={label} subtitle={`${cards.length} item${cards.length === 1 ? "" : "s"}`} accent={accent} glyph="◈" />
              <div className="mt-3 space-y-2">
                {cards.length === 0 ? <p className="px-2 text-[11px] text-white/35">No read-only items.</p> : cards.map((card) => <TaskCard key={card.task_id} card={card} selected={selectedTaskId === card.task_id} onSelect={() => onSelect(card)} />)}
              </div>
            </Panel>
          );
        })}
      </div>
    </section>
  );
}
