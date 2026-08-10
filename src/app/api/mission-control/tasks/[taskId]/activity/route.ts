export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { projectActivity, type ActivityPageV1 } from "../../../../../../server/mission-control/activity/projector";
import type { CodeGActivityPageResultV1 } from "../../../../../../lib/mission-control/contracts";

// The activity page is served only from original CodeG/ACP activity through a
// proven adapter. While the runtime is dormant and no live CodeG bridge is
// connected, the route returns an honest empty page plus an unavailable reason
// and never fabricates a transcript.
const ActivityPageResponseV1Schema = z.object({
  items: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
  unavailable_reason: z.string().min(1).nullable(),
}).strict();

const unavailableCodeG = {
  activityAfter: async (): Promise<CodeGActivityPageResultV1> => ({ status: "unknown" as const, reason: "CodeG activity bridge is not configured." }),
};

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  await params; // taskId is accepted but not dereferenced while the bridge is unavailable.
  const result = await unavailableCodeG.activityAfter();
  const page: ActivityPageV1 = result.status === "ok" ? projectActivity(result.binding, [], result.events) : { items: [], next_cursor: null };
  const unavailable_reason = result.status === "unknown" ? result.reason : null;
  return NextResponse.json(ActivityPageResponseV1Schema.parse({ items: page.items, next_cursor: page.next_cursor, unavailable_reason }));
}
