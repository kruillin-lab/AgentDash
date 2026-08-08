import React from "react";

import type { ActivityPageV1, ActivityTab } from "../../server/mission-control/activity/projector";
import { Empty } from "../ui";

const TABS: Array<{ id: ActivityTab | "receipt"; label: string }> = [
  { id: "live", label: "Live" },
  { id: "files", label: "Files" },
  { id: "checks", label: "Checks" },
  { id: "receipt", label: "Receipt" },
];

/**
 * Append-only worker activity tabs. Consumes a projected ActivityPageV1 with no
 * transport-specific fields. Never invents activity: an empty tab says plainly
 * that CodeG has not reported that kind of item.
 */
export function ActivityTabs({ page, receipt }: { page: ActivityPageV1; receipt?: React.ReactNode }) {
  const [active, setActive] = React.useState<(typeof TABS)[number]["id"]>("live");

  return (
    <div>
      <div role="tablist" aria-label="Attempt activity" className="flex gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition focus-ring ${active === tab.id ? "bg-neon-cyan/15 text-neon-cyan" : "text-white/45 hover:text-white/75"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-3">
        {active === "receipt" ? (
          receipt ?? <Empty title="No receipt yet" sub="Immutable receipts appear once the attempt produces them." />
        ) : (
          <ActivityList page={page} tab={active} />
        )}
      </div>
    </div>
  );
}

function ActivityList({ page, tab }: { page: ActivityPageV1; tab: ActivityTab }) {
  const items = page.items.filter((item) => item.tab === tab);
  if (items.length === 0) {
    return <Empty title={`No ${tab} activity`} sub="CodeG has not reported this kind of item for the selected attempt." />;
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.cursor} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-white/35">
            <span>{item.kind}</span>
            <time dateTime={item.observed_at}>{item.observed_at}</time>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-white/70">{item.payload.summary}</p>
        </li>
      ))}
    </ul>
  );
}
