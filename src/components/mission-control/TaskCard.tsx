import React from "react";
import { z } from "zod";

import type { MissionControlBoardV1 } from "../../lib/mission-control/contracts";

const CardViewSchema = z.object({
  task_id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  attempt: z.string().min(1).nullable(),
}).strict();

export type MissionControlCard = z.infer<typeof CardViewSchema>;

export function cardFromPayload(payload: MissionControlBoardV1["lanes"]["ready"][number]): MissionControlCard | null {
  try {
    return CardViewSchema.safeParse(JSON.parse(payload.summary)).data ?? null;
  } catch {
    return null;
  }
}

export function TaskCard({ card, selected, onSelect }: { card: MissionControlCard; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-xl border p-3 text-left transition focus-ring ${selected ? "border-neon-cyan bg-neon-cyan/10 shadow-neon" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-white/90">{card.title}</span>
        {card.attempt && <span className="shrink-0 text-[10px] text-white/40">{card.attempt}</span>}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-white/55">{card.detail}</p>
      <span className="mt-2 block text-[10px] uppercase tracking-[0.16em] text-white/35">{selected ? "Selected" : "Inspect"}</span>
    </button>
  );
}
