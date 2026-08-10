import React from "react";
import type { MissionControlCardViewV1 } from "../../lib/mission-control/board-view";
import type { ActivityPageV1 } from "../../server/mission-control/activity/projector";
import { ActivityTabs } from "./ActivityTabs";
import { Empty, Panel, PanelHeader, StatusPill } from "../ui";

/**
 * The native CodeG session for one attempt. AgentDash never constructs a URI by
 * guessing an identifier; it renders only the exact URI the proven CodeG
 * adapter returned.
 */
export type AttemptSessionV1 =
  | { kind: "available"; uri: string }
  | { kind: "not_yet" }
  | { kind: "not_applicable" };

export function AttemptInspector({ card, session, activity }: { card: MissionControlCardViewV1 | null; session?: AttemptSessionV1; activity?: ActivityPageV1 }) {
  return (
    <Panel strong className="min-h-[18rem] p-4" role="region" aria-label="Selected attempt">
      <PanelHeader title="Selected attempt" subtitle="Read-only session inspector" accent="#a78bfa" glyph="⌁" />
      {card ? (
        <div className="mt-5 space-y-4 px-1">
          <StatusPill on label="Inspection only" color="#a78bfa" />
          <div><div className="text-sm font-semibold text-white/90">{card.title}</div><p className="mt-1 text-xs leading-relaxed text-white/55">{card.detail}</p></div>
          <dl className="space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-white/40">Task</dt><dd className="font-mono text-right text-white/70">{card.task_id}</dd></div><div className="flex justify-between gap-3"><dt className="text-white/40">Attempt</dt><dd className="text-right text-white/70">{card.attempt ?? "No attempt recorded"}</dd></div></dl>
          <NativeSessionLink session={session ?? { kind: "not_yet" }} />
          {activity ? <ActivityTabs page={activity} /> : null}
          <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/45">Commands, approvals, and launches are disabled in this read-only workspace.</p>
        </div>
      ) : <Empty title="Select a task card" sub="Its recorded attempt details will appear here. No task action can be taken from this pane." />}
    </Panel>
  );
}

function NativeSessionLink({ session }: { session: AttemptSessionV1 }) {
  if (session.kind === "available") {
    return (
      <a
        href={session.uri}
        target="_blank"
        rel="noreferrer"
        className="inline-block rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-1.5 text-[11px] font-semibold text-neon-cyan transition hover:bg-neon-cyan/20 focus-ring"
      >
        Open in CodeG
      </a>
    );
  }
  if (session.kind === "not_applicable") {
    return <p className="text-[11px] text-white/45">No worker session for this action.</p>;
  }
  return (
    <button type="button" disabled className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/35">
      No session yet
    </button>
  );
}
