import React from "react";
import { Empty, Panel, PanelHeader, StatusPill } from "../ui";
import type { MissionControlCard } from "./TaskCard";

export function AttemptInspector({ card }: { card: MissionControlCard | null }) {
  return (
    <Panel strong className="min-h-[18rem] p-4" role="region" aria-label="Selected attempt">
      <PanelHeader title="Selected attempt" subtitle="Read-only session inspector" accent="#a78bfa" glyph="⌁" />
      {card ? (
        <div className="mt-5 space-y-4 px-1">
          <StatusPill on label="Inspection only" color="#a78bfa" />
          <div><div className="text-sm font-semibold text-white/90">{card.title}</div><p className="mt-1 text-xs leading-relaxed text-white/55">{card.detail}</p></div>
          <dl className="space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-white/40">Task</dt><dd className="font-mono text-right text-white/70">{card.task_id}</dd></div><div className="flex justify-between gap-3"><dt className="text-white/40">Attempt</dt><dd className="text-right text-white/70">{card.attempt ?? "No attempt recorded"}</dd></div></dl>
          <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/45">Commands, approvals, and launches are disabled in this read-only workspace.</p>
        </div>
      ) : <Empty title="Select a task card" sub="Its recorded attempt details will appear here. No task action can be taken from this pane." />}
    </Panel>
  );
}
