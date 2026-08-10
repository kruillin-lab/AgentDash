import React from "react";

import { Empty } from "../ui";

export interface ReceiptSummaryV1 {
  receipt_id: string;
  kind: "action" | "verification" | "finalization" | "aggregate";
  outcome: string;
  digest: string;
  created_at: string;
  summary: string;
}

/**
 * Renders immutable receipts. PM summaries link to original receipts rather
 * than replacing them; unsupported facts stay visibly unknown.
 */
export function ReceiptView({ receipts }: { receipts: ReceiptSummaryV1[] }) {
  if (receipts.length === 0) {
    return <Empty title="No receipts" sub="Immutable worker, verification, finalization, and aggregate receipts appear here once durable." />;
  }
  return (
    <ul className="space-y-2">
      {receipts.map((receipt) => (
        <li key={receipt.receipt_id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neon-cyan">{receipt.kind}</span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">{receipt.outcome}</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-white/70">{receipt.summary}</p>
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-white/35">
            <time dateTime={receipt.created_at}>{receipt.created_at}</time>
            <span className="font-mono" title={receipt.digest}>{receipt.digest.slice(0, 12)}…</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
