import { z } from "zod";

/** Browser-safe lexical equivalent of the locked TaskId schema. */
export const MissionControlTaskIdSchema = z.string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/)
  .brand<"MissionControlTaskId">();
export type MissionControlTaskId = z.infer<typeof MissionControlTaskIdSchema>;

export const MissionControlCardViewV1Schema = z.object({
  schema_version: z.literal("agentdash.mission-control-card-view/v1"),
  task_id: MissionControlTaskIdSchema,
  title: z.string().min(1).max(256),
  detail: z.string().min(1).max(4096),
  attempt: z.string().min(1).max(256).nullable(),
}).strict();
export type MissionControlCardViewV1 = z.infer<typeof MissionControlCardViewV1Schema>;

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

function parseSummary(summary: string): unknown {
  try {
    return JSON.parse(summary);
  } catch {
    return undefined;
  }
}

export const MissionControlCardPayloadV1Schema = z.object({
  redacted: z.literal(true),
  digest: DigestSchema,
  summary: z.string().min(1).max(4096),
}).strict().superRefine((payload, context) => {
  const card = MissionControlCardViewV1Schema.safeParse(parseSummary(payload.summary));
  if (!card.success) context.addIssue({ code: z.ZodIssueCode.custom, path: ["summary"], message: "card summary must contain a renderable mission-control card/v1" });
});
export type MissionControlCardPayloadV1 = z.infer<typeof MissionControlCardPayloadV1Schema>;

export function parseMissionControlCardPayload(payload: MissionControlCardPayloadV1): MissionControlCardViewV1 {
  const checked = MissionControlCardPayloadV1Schema.parse(payload);
  return MissionControlCardViewV1Schema.parse(parseSummary(checked.summary));
}

const BoardLanesV1Schema = z.object({
  ready: z.array(MissionControlCardPayloadV1Schema),
  working: z.array(MissionControlCardPayloadV1Schema),
  needs_you: z.array(MissionControlCardPayloadV1Schema),
  stopped: z.array(MissionControlCardPayloadV1Schema),
  completed: z.array(MissionControlCardPayloadV1Schema),
}).strict();

export const MissionControlServedBoardV1Schema = z.object({
  generated_at: TimestampSchema,
  lanes: BoardLanesV1Schema,
  archived_count: z.number().int().nonnegative(),
  unavailable_reason: z.string().min(1).nullable(),
}).strict().superRefine((board, context) => {
  const seen = new Set<string>();
  for (const [lane, payloads] of Object.entries(board.lanes)) {
    payloads.forEach((payload, index) => {
      const card = MissionControlCardViewV1Schema.safeParse(parseSummary(payload.summary));
      if (!card.success) return;
      if (seen.has(card.data.task_id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["lanes", lane, index, "summary"], message: "served card task identities must be unique" });
      seen.add(card.data.task_id);
    });
  }
});
export type MissionControlServedBoardV1 = z.infer<typeof MissionControlServedBoardV1Schema>;

export const MissionControlBoardResponseV1Schema = z.object({
  board: MissionControlServedBoardV1Schema,
  unavailable_reason: z.string().min(1).nullable(),
}).strict().superRefine((response, context) => {
  if (response.unavailable_reason !== response.board.unavailable_reason) context.addIssue({ code: z.ZodIssueCode.custom, path: ["unavailable_reason"], message: "availability metadata must match the served board" });
});
export type MissionControlBoardResponseV1 = z.infer<typeof MissionControlBoardResponseV1Schema>;
