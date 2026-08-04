import { z } from "zod";

import { CEOInputRequestV1Schema, MissionControlBoardV1Schema, RedactedPayloadV1Schema, TaskOutcomeV1Schema, canonicalDigest, type MissionControlBoardV1 } from "../../lib/mission-control/contracts";
import { MissionControlCardPayloadV1Schema, MissionControlCardViewV1Schema, MissionControlTaskIdSchema } from "../../lib/mission-control/board-view";
import type { HermesPort } from "./ports";

const BoardTaskSchema = z.object({
  task_id: MissionControlTaskIdSchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  state: z.enum(["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "archived"]),
  attempt: z.string().min(1).nullable(),
  ceo_input: z.unknown().nullable(),
  task_outcome: z.unknown().nullable(),
}).strict();

export const HermesBoardSnapshotV1Schema = z.object({
  generated_at: z.string().datetime({ offset: true }),
  tasks: z.array(BoardTaskSchema),
  unavailable_reason: z.string().min(1).nullable(),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  value.tasks.forEach((task, index) => {
    if (seen.has(task.task_id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tasks", index, "task_id"], message: "snapshot task identities must be unique" });
    seen.add(task.task_id);
  });
});
export type HermesBoardSnapshotV1 = z.infer<typeof HermesBoardSnapshotV1Schema>;

export const OutboxOverlayV1Schema = z.object({
  reconciliation_pending_task_ids: z.array(MissionControlTaskIdSchema),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  value.reconciliation_pending_task_ids.forEach((taskId, index) => {
    if (seen.has(taskId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["reconciliation_pending_task_ids", index], message: "overlay task identities must be unique" });
    seen.add(taskId);
  });
});
export type OutboxOverlayV1 = z.infer<typeof OutboxOverlayV1Schema>;

function currentCEOInputForTask(value: unknown, generatedAt: string, taskId: string): boolean {
  const input = CEOInputRequestV1Schema.safeParse(value);
  if (!input.success || input.data.task_id !== taskId) return false;
  const generated = Date.parse(generatedAt);
  return Date.parse(input.data.created_at) <= generated && generated < Date.parse(input.data.expires_at);
}

function taskOutcomeForTask(value: unknown, taskId: string) {
  const outcome = TaskOutcomeV1Schema.safeParse(value);
  return outcome.success && outcome.data.task_id === taskId ? outcome.data : null;
}

function redactedCard(task: z.infer<typeof BoardTaskSchema>, detail = task.detail): MissionControlBoardV1["lanes"]["ready"][number] {
  const card = MissionControlCardViewV1Schema.parse({ schema_version: "agentdash.mission-control-card-view/v1", task_id: task.task_id, title: task.title, detail, attempt: task.attempt });
  const payload = MissionControlCardPayloadV1Schema.parse({
    redacted: true as const,
    digest: canonicalDigest(card),
    summary: JSON.stringify(card),
  });
  return RedactedPayloadV1Schema.parse(payload);
}

/** Projects a validated Hermes snapshot into the locked, redacted board contract. */
export function buildBoardProjection(source: HermesBoardSnapshotV1, outbox: OutboxOverlayV1): MissionControlBoardV1 {
  const snapshot = HermesBoardSnapshotV1Schema.parse(source);
  const overlay = OutboxOverlayV1Schema.parse(outbox);
  const pending = new Set(overlay.reconciliation_pending_task_ids);
  const lanes = { ready: [], working: [], needs_you: [], stopped: [], completed: [] } as MissionControlBoardV1["lanes"];
  let archivedCount = 0;

  for (const task of snapshot.tasks) {
    const outcome = taskOutcomeForTask(task.task_outcome, task.task_id);
    if (task.state === "archived") archivedCount += 1;
    if (pending.has(task.task_id)) {
      lanes.stopped.push(redactedCard(task, `${task.detail} Reconciliation pending: outbox state is not yet confirmed.`));
    } else if (task.state === "archived") {
      continue;
    } else if (task.state === "done" && outcome?.outcome === "succeeded") {
      lanes.completed.push(redactedCard(task));
    } else if (["blocked", "review"].includes(task.state) && currentCEOInputForTask(task.ceo_input, snapshot.generated_at, task.task_id)) {
      lanes.needs_you.push(redactedCard(task));
    } else if (["triage", "todo", "scheduled", "ready"].includes(task.state)) {
      lanes.ready.push(redactedCard(task));
    } else if (task.state === "running") {
      lanes.working.push(redactedCard(task));
    } else {
      lanes.stopped.push(redactedCard(task));
    }
  }

  return MissionControlBoardV1Schema.parse({
    generated_at: snapshot.generated_at,
    lanes,
    archived_count: archivedCount,
    unavailable_reason: snapshot.unavailable_reason,
  });
}

export function unavailableBoard(reason: string): MissionControlBoardV1 {
  return MissionControlBoardV1Schema.parse({
    generated_at: new Date().toISOString(),
    lanes: { ready: [], working: [], needs_you: [], stopped: [], completed: [] },
    archived_count: 0,
    unavailable_reason: reason,
  });
}

/** The injected port is the only production board source; fixtures stay in tests. */
export async function loadBoardFromHermes(port: Pick<HermesPort, "projectBoard">): Promise<MissionControlBoardV1> {
  return MissionControlBoardV1Schema.parse(await port.projectBoard());
}
