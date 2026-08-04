import { z } from "zod";

import {
  DigestSchema,
  IntakeReadinessV1Schema,
  RequestIdSchema,
  TimestampSchema,
  canonicalCardAuthorizationDigest,
  canonicalDigest,
} from "../../../lib/mission-control/contracts";
import { IntakeAckV1Schema, type IntakeAckV1 } from "../../../lib/mission-control/intake-api";
import { PMTurnOutputV1Schema, type PMTurnOutputV1 } from "../../hermes/pm";
import { PMConversationMessageV1Schema, type PMTurnInputV1 } from "../pm-prompt";

const claimId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
const generation = z.number().int().positive().safe();

export const AuthorizedIntakeArtifactV1Schema = z.object({
  request_digest: DigestSchema,
  staged_pm_digest: DigestSchema,
  artifact_digest: DigestSchema,
  readiness: IntakeReadinessV1Schema,
}).strict().superRefine((value, context) => {
  if (value.request_digest !== value.readiness.request_digest
    || value.artifact_digest !== value.readiness.artifact_digest
    || value.staged_pm_digest !== canonicalDigest(value.readiness.pm)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "authorized intake artifact digests must bind the exact readiness" });
  }
});
export type AuthorizedIntakeArtifactV1 = z.infer<typeof AuthorizedIntakeArtifactV1Schema>;

export const CEOConversationClaimResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("claimed"), request_digest: DigestSchema, claim_id: claimId, claim_generation: generation, lease_expires_at: TimestampSchema, mode: z.literal("initial_inference") }).strict(),
  z.object({ status: z.literal("existing"), request_digest: DigestSchema, ack: IntakeAckV1Schema, ack_digest: DigestSchema }).strict(),
  z.object({ status: z.literal("conflict") }).strict(),
  z.object({ status: z.literal("pending"), request_digest: DigestSchema, claim_id: claimId, observed_generation: generation, lease_expires_at: TimestampSchema, staged_pm: PMTurnOutputV1Schema.nullable(), staged_pm_digest: DigestSchema.nullable(), authorized_artifact: AuthorizedIntakeArtifactV1Schema.nullable() }).strict(),
]).superRefine((value, context) => {
  if (value.status === "existing" && value.ack_digest !== canonicalDigest(value.ack)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["ack_digest"], message: "existing acknowledgement digest must bind the exact acknowledgement" });
  if (value.status !== "pending") return;
  if ((value.staged_pm === null) !== (value.staged_pm_digest === null)) context.addIssue({ code: z.ZodIssueCode.custom, message: "pending staged PM value and digest must appear together" });
  if (value.staged_pm && value.staged_pm_digest !== canonicalDigest(value.staged_pm)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["staged_pm_digest"], message: "pending staged PM digest must be canonical" });
  if (value.authorized_artifact && (!value.staged_pm || value.authorized_artifact.request_digest !== value.request_digest || value.authorized_artifact.staged_pm_digest !== value.staged_pm_digest)) context.addIssue({ code: z.ZodIssueCode.custom, message: "pending authorized artifact must bind the staged claim" });
});
export type CEOConversationClaimResult = z.infer<typeof CEOConversationClaimResultSchema>;

export const TakeoverTurnResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("resume_staged"), request_digest: DigestSchema, claim_id: claimId, claim_generation: generation, lease_expires_at: TimestampSchema, staged_pm: PMTurnOutputV1Schema, staged_pm_digest: DigestSchema, authorized_artifact: AuthorizedIntakeArtifactV1Schema.nullable() }).strict(),
  z.object({ status: z.literal("retry_inference_after_uncertain_failure"), request_digest: DigestSchema, claim_id: claimId, claim_generation: generation, lease_expires_at: TimestampSchema }).strict(),
  z.object({ status: z.literal("rejected") }).strict(),
]).superRefine((value, context) => {
  if (value.status !== "resume_staged") return;
  if (value.staged_pm_digest !== canonicalDigest(value.staged_pm)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["staged_pm_digest"], message: "takeover staged PM digest must be canonical" });
  if (value.authorized_artifact && (value.authorized_artifact.request_digest !== value.request_digest || value.authorized_artifact.staged_pm_digest !== value.staged_pm_digest)) context.addIssue({ code: z.ZodIssueCode.custom, message: "takeover artifact must bind the resumed staged claim" });
});
export type TakeoverTurnResult = z.infer<typeof TakeoverTurnResultSchema>;

export const StagePMResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("staged"), claim_id: claimId, claim_generation: generation, request_digest: DigestSchema, staged_pm_digest: DigestSchema }).strict(),
  z.object({ status: z.literal("existing"), claim_id: claimId, claim_generation: generation, request_digest: DigestSchema, staged_pm_digest: DigestSchema }).strict(),
  z.object({ status: z.literal("stale_generation") }).strict(),
  z.object({ status: z.literal("conflict") }).strict(),
]);
export type StagePMResult = z.infer<typeof StagePMResultSchema>;

export const AuthorizeCardInputSchema = z.object({ claim_id: claimId, claim_generation: generation, artifact: AuthorizedIntakeArtifactV1Schema }).strict();
export type AuthorizeCardInput = z.infer<typeof AuthorizeCardInputSchema>;
export const AuthorizeCardResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("authorized"), claim_id: claimId, claim_generation: generation, card_authorization_digest: DigestSchema, authorized_artifact: AuthorizedIntakeArtifactV1Schema }).strict(),
  z.object({ status: z.literal("existing"), claim_id: claimId, claim_generation: generation, card_authorization_digest: DigestSchema, authorized_artifact: AuthorizedIntakeArtifactV1Schema }).strict(),
  z.object({ status: z.literal("stale_generation") }).strict(),
  z.object({ status: z.literal("conflict") }).strict(),
]).superRefine((value, context) => {
  if ((value.status === "authorized" || value.status === "existing")
    && value.card_authorization_digest !== canonicalCardAuthorizationDigest({ claim_id: value.claim_id, claim_generation: value.claim_generation, ...value.authorized_artifact })) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["card_authorization_digest"], message: "card authorization must bind the exact claim generation and artifact" });
  }
});
export type AuthorizeCardResult = z.infer<typeof AuthorizeCardResultSchema>;
export type CardExistingAckV1 = IntakeAckV1 & { result: Extract<IntakeAckV1["result"], { kind: "card_existing" }> };
export type ReconcileCommittedCardInput = AuthorizeCardInput & { ack: CardExistingAckV1 };
export const ReconcileCommittedCardResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("created"), claim_id: claimId, claim_generation: generation, artifact_digest: DigestSchema, authorized_artifact: AuthorizedIntakeArtifactV1Schema, ack: IntakeAckV1Schema, ack_digest: DigestSchema }).strict(),
  z.object({ status: z.literal("existing"), claim_id: claimId, claim_generation: generation, artifact_digest: DigestSchema, authorized_artifact: AuthorizedIntakeArtifactV1Schema, ack: IntakeAckV1Schema, ack_digest: DigestSchema }).strict(),
  z.object({ status: z.literal("stale_generation") }).strict(),
  z.object({ status: z.literal("conflict") }).strict(),
]).superRefine((value, context) => {
  if ((value.status === "created" || value.status === "existing")
    && (value.artifact_digest !== value.authorized_artifact.artifact_digest || value.ack_digest !== canonicalDigest(value.ack))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "reconciled result must bind its exact artifact and acknowledgement" });
  }
});
export type ReconcileCommittedCardResult = z.infer<typeof ReconcileCommittedCardResultSchema>;
export const CompleteTurnResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("created"), claim_id: claimId, claim_generation: generation, ack: IntakeAckV1Schema, ack_digest: DigestSchema }).strict(),
  z.object({ status: z.literal("existing"), claim_id: claimId, claim_generation: generation, ack: IntakeAckV1Schema, ack_digest: DigestSchema }).strict(),
  z.object({ status: z.literal("stale_generation") }).strict(),
  z.object({ status: z.literal("conflict") }).strict(),
]).superRefine((value, context) => {
  if ((value.status === "created" || value.status === "existing") && value.ack_digest !== canonicalDigest(value.ack)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["ack_digest"], message: "completion digest must bind the exact acknowledgement" });
});
export type CompleteTurnResult = z.infer<typeof CompleteTurnResultSchema>;

export interface CEOConversationPort {
  claimTurn(input: { request_id: z.infer<typeof RequestIdSchema>; request_digest: z.infer<typeof DigestSchema> }): Promise<CEOConversationClaimResult>;
  committedHistory(): Promise<z.infer<typeof PMConversationMessageV1Schema>[]>;
  takeoverTurn(claim_id: string, observed_generation: number): Promise<TakeoverTurnResult>;
  stagePMResult(claim_id: string, claim_generation: number, request_digest: string, pm_output: PMTurnOutputV1): Promise<StagePMResult>;
  authorizeCardPersistence(input: AuthorizeCardInput): Promise<AuthorizeCardResult>;
  reconcileCommittedCard(input: ReconcileCommittedCardInput): Promise<ReconcileCommittedCardResult>;
  completeTurn(claim_id: string, claim_generation: number, ack: IntakeAckV1): Promise<CompleteTurnResult>;
}

export class IntakeConversationUnavailableError extends Error {
  readonly code = "intake_unavailable";
  constructor() {
    super("Durable CEO conversation persistence is unavailable.");
    this.name = "IntakeConversationUnavailableError";
  }
}

const unavailable = async (): Promise<never> => { throw new IntakeConversationUnavailableError(); };

export const unavailableCEOConversationPort: CEOConversationPort = {
  claimTurn: unavailable,
  committedHistory: unavailable,
  takeoverTurn: unavailable,
  stagePMResult: unavailable,
  authorizeCardPersistence: unavailable,
  reconcileCommittedCard: unavailable,
  completeTurn: unavailable,
};

export type { IntakeAckV1, PMTurnInputV1 };
