import { z } from "zod";

import {
  DigestSchema,
  IntakeReadinessV1Schema,
  TimestampSchema,
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
  z.object({ status: z.literal("claimed"), claim_id: claimId, claim_generation: generation, lease_expires_at: TimestampSchema, mode: z.literal("initial_inference") }).strict(),
  z.object({ status: z.literal("existing"), ack: IntakeAckV1Schema }).strict(),
  z.object({ status: z.literal("conflict") }).strict(),
  z.object({ status: z.literal("pending"), claim_id: claimId, observed_generation: generation, lease_expires_at: TimestampSchema, staged_pm: PMTurnOutputV1Schema.nullable(), authorized_artifact: AuthorizedIntakeArtifactV1Schema.nullable() }).strict(),
]);
export type CEOConversationClaimResult = z.infer<typeof CEOConversationClaimResultSchema>;

export type TakeoverTurnResult =
  | { status: "resume_staged"; claim_id: string; claim_generation: number; lease_expires_at: string; staged_pm: PMTurnOutputV1; authorized_artifact: AuthorizedIntakeArtifactV1 | null }
  | { status: "retry_inference_after_uncertain_failure"; claim_id: string; claim_generation: number; lease_expires_at: string }
  | { status: "rejected" };

export type StagePMResult = { status: "staged" | "existing" | "stale_generation" | "conflict"; staged_pm_digest?: string };
export type AuthorizeCardInput = {
  claim_id: string;
  claim_generation: number;
  artifact: AuthorizedIntakeArtifactV1;
};
export type AuthorizeCardResult =
  | { status: "authorized" | "existing"; card_authorization_digest: string; authorized_artifact: AuthorizedIntakeArtifactV1 }
  | { status: "stale_generation" | "conflict" };
export type CardExistingAckV1 = IntakeAckV1 & { result: Extract<IntakeAckV1["result"], { kind: "card_existing" }> };
export type ReconcileCommittedCardInput = AuthorizeCardInput & { ack: CardExistingAckV1 };
export type ReconcileCommittedCardResult =
  | { status: "created" | "existing"; authorized_artifact: AuthorizedIntakeArtifactV1; ack: IntakeAckV1 }
  | { status: "stale_generation" | "conflict" };
export type CompleteTurnResult = { status: "created" | "existing" | "stale_generation" | "conflict"; ack?: IntakeAckV1 };

export interface CEOConversationPort {
  claimTurn(input: { request_id: string; request_digest: string }): Promise<CEOConversationClaimResult>;
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
