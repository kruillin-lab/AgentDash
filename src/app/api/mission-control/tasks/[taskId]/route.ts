export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

// Task detail is served from canonical Hermes state through a proven bridge.
// While the runtime is dormant the route returns an honest unavailable reason
// and never fabricates a task.
const TaskDetailResponseV1Schema = z.object({
  task_id: z.string().min(1).nullable(),
  unavailable_reason: z.string().min(1).nullable(),
}).strict();

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return NextResponse.json(TaskDetailResponseV1Schema.parse({ task_id: taskId ?? null, unavailable_reason: "Hermes task bridge is not configured." }));
}
