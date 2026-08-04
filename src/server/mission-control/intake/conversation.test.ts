import { describe, expect, test } from "vitest";

import { DigestSchema, RequestIdSchema, canonicalDigest } from "../../../lib/mission-control/contracts";
import { CompleteTurnResultSchema, CEOConversationClaimResultSchema, IntakeConversationUnavailableError, StagePMResultSchema, TakeoverTurnResultSchema, unavailableCEOConversationPort } from "./conversation";

const digest = "a".repeat(64);
const pm = {
  text: "Conversation acknowledged. Focus: scope.",
  session_ref: "pm-session-1",
  proposal: { schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-1", task_id: null, intent: "conversation_only", created_at: "2026-08-04T10:00:00.000Z" },
};
const ack = { schema_version: "agentdash.intake-ack/v1", request_id: "123e4567-e89b-42d3-a456-426614174000", pm, result: { kind: "conversation_only" }, board_refresh: false, select_task_id: null };

describe("single-CEO conversation port contract", () => {
  test("requires a positive safe monotonic claim generation", () => {
    const claim = { status: "claimed", request_digest: digest, claim_id: "claim-1", claim_generation: 1, lease_expires_at: "2026-08-04T10:01:00.000Z", mode: "initial_inference" };
    expect(CEOConversationClaimResultSchema.parse(claim)).toEqual(claim);
    expect(CEOConversationClaimResultSchema.safeParse({ ...claim, claim_generation: 0 }).success).toBe(false);
    expect(CEOConversationClaimResultSchema.safeParse({ ...claim, claim_generation: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  });

  test("keeps pending staged output explicit without granting a newer generation", () => {
    const pending = CEOConversationClaimResultSchema.parse({ status: "pending", request_digest: digest, claim_id: "claim-1", observed_generation: 3, lease_expires_at: "2026-08-04T10:01:00.000Z", staged_pm: null, staged_pm_digest: null, authorized_artifact: null });
    expect(pending).toMatchObject({ status: "pending", observed_generation: 3, staged_pm: null, authorized_artifact: null });
    expect("claim_generation" in pending).toBe(false);
  });

  test("requires canonical evidence on every successful or existing conversation result", () => {
    expect(StagePMResultSchema.safeParse({ status: "staged", claim_id: "claim-1", claim_generation: 1, request_digest: digest, staged_pm_digest: canonicalDigest(pm) }).success).toBe(true);
    expect(StagePMResultSchema.safeParse({ status: "staged" }).success).toBe(false);
    expect(TakeoverTurnResultSchema.safeParse({ status: "retry_inference_after_uncertain_failure", request_digest: digest, claim_id: "claim-1", claim_generation: 2, lease_expires_at: "2026-08-04T10:01:00.000Z" }).success).toBe(true);
    expect(TakeoverTurnResultSchema.safeParse({ status: "retry_inference_after_uncertain_failure", claim_id: "claim-1", claim_generation: 2, lease_expires_at: "2026-08-04T10:01:00.000Z" }).success).toBe(false);
    expect(CompleteTurnResultSchema.safeParse({ status: "created", claim_id: "claim-1", claim_generation: 1, ack, ack_digest: canonicalDigest(ack) }).success).toBe(true);
    expect(CompleteTurnResultSchema.safeParse({ status: "existing", claim_id: "claim-1", claim_generation: 1, ack, ack_digest: "b".repeat(64) }).success).toBe(false);
    expect(CompleteTurnResultSchema.safeParse({ status: "conflict", ack }).success).toBe(false);
  });

  test("binds an existing acknowledgement to its durable request digest", () => {
    const existing = { status: "existing", request_digest: digest, ack, ack_digest: canonicalDigest(ack) };
    expect(CEOConversationClaimResultSchema.safeParse(existing).success).toBe(true);
    expect(CEOConversationClaimResultSchema.safeParse({ ...existing, ack_digest: "b".repeat(64) }).success).toBe(false);
    expect(CEOConversationClaimResultSchema.safeParse({ ...existing, extra: true }).success).toBe(false);
  });

  test("fails closed when no durable production conversation adapter exists", async () => {
    await expect(unavailableCEOConversationPort.claimTurn({ request_id: RequestIdSchema.parse("123e4567-e89b-42d3-a456-426614174000"), request_digest: DigestSchema.parse("a".repeat(64)) })).rejects.toBeInstanceOf(IntakeConversationUnavailableError);
  });
});
