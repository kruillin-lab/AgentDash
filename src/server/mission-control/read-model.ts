import { z } from "zod";

import { CEOInputRequestV1Schema, MissionControlBoardV1Schema, RedactedPayloadV1Schema, TaskOutcomeV1Schema, canonicalDigest, type MissionControlBoardV1 } from "../../lib/mission-control/contracts";
import type { HermesPort } from "./ports";

const BoardTaskSchema = z.object({
  task_id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  state: z.enum(["ready", "working", "stopped"]),
  attempt: z.string().min(1).nullable(),
  ceo_input: z.unknown().nullable(),
  task_outcome: z.unknown().nullable(),
}).strict();

export const HermesBoardSnapshotV1Schema = z.object({
  generated_at: z.string().datetime({ offset: true }),
  tasks: z.array(BoardTaskSchema),
  unavailable_reason: z.string().min(1).nullable(),
}).strict();
export type HermesBoardSnapshotV1 = z.infer<typeof HermesBoardSnapshotV1Schema>;

export const OutboxOverlayV1Schema = z.object({
  reconciliation_pending_task_ids: z.array(z.string().min(1)),
}).strict();
export type OutboxOverlayV1 = z.infer<typeof OutboxOverlayV1Schema>;

const CardViewSchema = z.object({
  task_id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  attempt: z.string().min(1).nullable(),
}).strict();

function currentCEOInputForTask(value: unknown, generatedAt: string, taskId: string): boolean {
  const input = CEOInputRequestV1Schema.safeParse(value);
  return input.success && input.data.task_id === taskId && Date.parse(input.data.expires_at) > Date.parse(generatedAt);
}

function taskOutcomeForTask(value: unknown, taskId: string) {
  const outcome = TaskOutcomeV1Schema.safeParse(value);
  return outcome.success && outcome.data.task_id === taskId ? outcome.data : null;
}

function redactedCard(task: z.infer<typeof BoardTaskSchema>, detail = task.detail): MissionControlBoardV1["lanes"]["ready"][number] {
  const card = CardViewSchema.parse({ task_id: task.task_id, title: task.title, detail, attempt: task.attempt });
  return RedactedPayloadV1Schema.parse({
    redacted: true as const,
    digest: canonicalDigest(card),
    summary: JSON.stringify(card),
  });
}

/** Projects a validated Hermes snapshot into the locked, redacted board contract. */
export function buildBoardProjection(source: HermesBoardSnapshotV1, outbox: OutboxOverlayV1): MissionControlBoardV1 {
  const snapshot = HermesBoardSnapshotV1Schema.parse(source);
  const overlay = OutboxOverlayV1Schema.parse(outbox);
  const pending = new Set(overlay.reconciliation_pending_task_ids);
  const lanes = { ready: [], working: [], needs_you: [], stopped: [], completed: [] } as MissionControlBoardV1["lanes"];

  for (const task of snapshot.tasks) {
    const outcome = taskOutcomeForTask(task.task_outcome, task.task_id);
    if (pending.has(task.task_id)) {
      lanes.stopped.push(redactedCard(task, `${task.detail} Reconciliation pending: outbox state is not yet confirmed.`));
    } else if (outcome?.outcome === "succeeded") {
      lanes.completed.push(redactedCard(task));
    } else if (outcome) {
      lanes.stopped.push(redactedCard(task));
    } else if (currentCEOInputForTask(task.ceo_input, snapshot.generated_at, task.task_id)) {
      lanes.needs_you.push(redactedCard(task));
    } else if (task.state === "ready") {
      lanes.ready.push(redactedCard(task));
    } else if (task.state === "working") {
      lanes.working.push(redactedCard(task));
    } else {
      lanes.stopped.push(redactedCard(task));
    }
  }

  return MissionControlBoardV1Schema.parse({
    generated_at: snapshot.generated_at,
    lanes,
    archived_count: 0,
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
