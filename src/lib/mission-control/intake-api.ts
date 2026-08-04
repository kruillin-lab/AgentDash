import { z } from "zod";

import { CEORequestIdSchema } from "./request-id";

const publicReference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const taskId = z.string().regex(/^task-[a-f0-9]{64}$/);

export const CEOIntakeRequestV1Schema = z.object({
  request_id: CEORequestIdSchema,
  message: z.string().min(1).max(4_096).refine((value) => value.trim().length > 0, "message must contain text"),
}).strict();
export type CEOIntakeRequestV1 = z.infer<typeof CEOIntakeRequestV1Schema>;

const ManagementProposalV1BrowserSchema = z.object({
  schema_version: z.literal("agentdash.management-proposal/v1"),
  proposal_id: publicReference,
  task_id: taskId.nullable(),
  intent: z.enum(["conversation_only", "create_task"]),
  evidence_refs: z.array(z.string().min(1).max(1_024)).max(32).optional(),
  created_at: z.string().datetime({ offset: true }),
}).strict();

export const PMTurnOutputV1BrowserSchema = z.object({
  text: z.string().min(1).max(4_096),
  session_ref: publicReference,
  proposal: ManagementProposalV1BrowserSchema,
}).strict();
export type PMTurnOutputV1Browser = z.infer<typeof PMTurnOutputV1BrowserSchema>;

export const PublicReasonV1Schema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
  message: z.string().min(1).max(512),
}).strict();
export type PublicReasonV1 = z.infer<typeof PublicReasonV1Schema>;

export const IntakeReadinessBrowserSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("blocked_no_start"), reasons: z.array(PublicReasonV1Schema).min(1).max(64) }).strict(),
  z.object({ kind: z.literal("approval_required"), reasons: z.array(PublicReasonV1Schema).max(64), decision_type: z.literal("initial_mandate_approval") }).strict(),
  z.object({ kind: z.literal("auto_activated"), reasons: z.array(PublicReasonV1Schema).max(64), authority_id: publicReference }).strict(),
]);
export type IntakeReadinessBrowser = z.infer<typeof IntakeReadinessBrowserSchema>;

const IntakeResultBrowserSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("conversation_only") }).strict(),
  z.object({ kind: z.literal("clarification_required"), reasons: z.array(PublicReasonV1Schema).min(1).max(64) }).strict(),
  z.object({ kind: z.literal("card_created"), task_id: taskId, readiness: IntakeReadinessBrowserSchema }).strict(),
  z.object({ kind: z.literal("card_existing"), task_id: taskId, readiness: IntakeReadinessBrowserSchema }).strict(),
]);

export const IntakeAckV1Schema = z.object({
  schema_version: z.literal("agentdash.intake-ack/v1"),
  request_id: CEORequestIdSchema,
  pm: PMTurnOutputV1BrowserSchema,
  result: IntakeResultBrowserSchema,
  board_refresh: z.boolean(),
  select_task_id: taskId.nullable(),
}).strict().superRefine((value, context) => {
  if (value.result.kind === "card_created" || value.result.kind === "card_existing") {
    if (value.pm.proposal.intent !== "create_task") context.addIssue({ code: z.ZodIssueCode.custom, path: ["pm", "proposal", "intent"], message: "card acknowledgement requires create_task evidence" });
    if (!value.board_refresh || value.select_task_id !== value.result.task_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "card acknowledgement must refresh and select its exact task" });
  } else {
    if (value.board_refresh || value.select_task_id !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: "non-card acknowledgement cannot refresh or select a task" });
    if (value.result.kind === "conversation_only" && value.pm.proposal.intent !== "conversation_only") context.addIssue({ code: z.ZodIssueCode.custom, path: ["pm", "proposal", "intent"], message: "conversation acknowledgement requires conversation_only evidence" });
  }
});
export type IntakeAckV1 = z.infer<typeof IntakeAckV1Schema>;

export const IntakeErrorV1Schema = z.object({
  error: z.object({
    code: z.enum(["invalid_local_authority", "unsupported_media_type", "request_too_large", "invalid_request", "request_id_conflict", "intake_pending", "pm_unavailable", "invalid_pm_output", "intake_unavailable"]),
    message: z.string().min(1).max(256),
  }).strict(),
}).strict();
export type IntakeErrorV1 = z.infer<typeof IntakeErrorV1Schema>;

export const IntakeDigestBrowserSchema = digest;
