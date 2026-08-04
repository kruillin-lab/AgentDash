import { describe, expect, test } from "vitest";

import { CEOConversationClaimResultSchema, IntakeConversationUnavailableError, unavailableCEOConversationPort } from "./conversation";

describe("single-CEO conversation port contract", () => {
  test("requires a positive safe monotonic claim generation", () => {
    const claim = { status: "claimed", claim_id: "claim-1", claim_generation: 1, lease_expires_at: "2026-08-04T10:01:00.000Z", mode: "initial_inference" };
    expect(CEOConversationClaimResultSchema.parse(claim)).toEqual(claim);
    expect(CEOConversationClaimResultSchema.safeParse({ ...claim, claim_generation: 0 }).success).toBe(false);
    expect(CEOConversationClaimResultSchema.safeParse({ ...claim, claim_generation: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  });

  test("keeps pending staged output explicit without granting a newer generation", () => {
    const pending = CEOConversationClaimResultSchema.parse({ status: "pending", claim_id: "claim-1", observed_generation: 3, lease_expires_at: "2026-08-04T10:01:00.000Z", staged_pm: null, authorized_artifact: null });
    expect(pending).toMatchObject({ status: "pending", observed_generation: 3, staged_pm: null, authorized_artifact: null });
    expect("claim_generation" in pending).toBe(false);
  });

  test("fails closed when no durable production conversation adapter exists", async () => {
    await expect(unavailableCEOConversationPort.claimTurn({ request_id: "123e4567-e89b-42d3-a456-426614174000", request_digest: "a".repeat(64) })).rejects.toBeInstanceOf(IntakeConversationUnavailableError);
  });
});
