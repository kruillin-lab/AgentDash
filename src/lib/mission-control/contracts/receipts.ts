import { z } from "zod";
import { ActionRoleSchema, ArtifactIdSchema, AttemptIdSchema, CommandIdSchema, DigestSchema, EventIdSchema, MandateIdSchema, ReceiptIdSchema, RouteIdSchema, TaskIdSchema, TimestampSchema } from "./common";
import { ActionOutcomeV1Schema, TaskOutcomeV1Schema } from "./outcomes";

export const ActionReceiptV1Schema = z.object({ schema_version: z.literal("agentdash.action-receipt/v1"), receipt_id: ReceiptIdSchema, task_id: TaskIdSchema, mandate_id: MandateIdSchema, attempt_id: AttemptIdSchema, action_role: ActionRoleSchema, outcome: ActionOutcomeV1Schema, artifact_ids: z.array(ArtifactIdSchema), created_at: TimestampSchema }).strict();
export type ActionReceiptV1 = z.infer<typeof ActionReceiptV1Schema>;
export const VerificationReceiptV1Schema = z.object({ schema_version: z.literal("agentdash.verification-receipt/v1"), receipt_id: ReceiptIdSchema, task_id: TaskIdSchema, mandate_id: MandateIdSchema, source_artifact_digest: DigestSchema, realized_mutating_route_ids: z.array(RouteIdSchema), independence_tier: z.union([z.literal(1), z.literal(2)]), outcome: ActionOutcomeV1Schema, created_at: TimestampSchema }).strict();
export type VerificationReceiptV1 = z.infer<typeof VerificationReceiptV1Schema>;
export const FinalReceiptV1Schema = z.object({ schema_version: z.literal("agentdash.final-receipt/v1"), receipt_id: ReceiptIdSchema, task_id: TaskIdSchema, action_receipt_ids: z.array(ReceiptIdSchema), outcome: TaskOutcomeV1Schema, created_at: TimestampSchema }).strict();
export type FinalReceiptV1 = z.infer<typeof FinalReceiptV1Schema>;
export const AdapterResultEnvelopeV1Schema = z.object({ schema_version: z.literal("agentdash.adapter-result-envelope/v1"), envelope_id: EventIdSchema, command_id: CommandIdSchema, result_digest: DigestSchema, created_at: TimestampSchema }).strict();
export type AdapterResultEnvelopeV1 = z.infer<typeof AdapterResultEnvelopeV1Schema>;
