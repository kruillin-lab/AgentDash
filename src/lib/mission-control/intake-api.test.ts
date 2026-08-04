import { describe, expect, test } from "vitest";

import { CEOIntakeRequestV1Schema, IntakeAckV1Schema } from "./intake-api";

const request_id = "123e4567-e89b-42d3-a456-426614174000";
const pm = {
  text: "I drafted a bounded proposal for controller review.",
  session_ref: "pm-session-1",
  proposal: {
    schema_version: "agentdash.management-proposal/v1",
    proposal_id: "proposal-1",
    task_id: null,
    intent: "create_task",
    evidence_refs: ["status:scope"],
    created_at: "2026-08-04T10:00:00.000Z",
  },
};

describe("browser-safe intake API", () => {
  test("accepts only the stable public request and never client context or authority", () => {
    expect(CEOIntakeRequestV1Schema.parse({ request_id, message: "Build the release checklist." })).toEqual({
      request_id,
      message: "Build the release checklist.",
    });

    for (const forwarded of ["history", "route_snapshot", "authority", "adapter_command"]) {
      expect(CEOIntakeRequestV1Schema.safeParse({ request_id, message: "Build it.", [forwarded]: [] }).success).toBe(false);
    }
  });

  test("retains the exact PM presentation while exposing only typed card readiness", () => {
    const acknowledgement = IntakeAckV1Schema.parse({
      schema_version: "agentdash.intake-ack/v1",
      request_id,
      pm,
      result: {
        kind: "card_created",
        task_id: `task-${"a".repeat(64)}`,
        readiness: {
          kind: "approval_required",
          reasons: [],
          decision_type: "initial_mandate_approval",
        },
      },
      board_refresh: true,
      select_task_id: `task-${"a".repeat(64)}`,
    });

    expect(acknowledgement.pm).toEqual(pm);
    expect(IntakeAckV1Schema.safeParse({ ...acknowledgement, authority: { approved: true } }).success).toBe(false);
    expect(IntakeAckV1Schema.safeParse({ ...acknowledgement, pm: { ...pm, csrf_valid: true } }).success).toBe(false);
  });

  test("binds refresh and selection to the exact result kind", () => {
    const conversation = {
      schema_version: "agentdash.intake-ack/v1" as const,
      request_id,
      pm: { ...pm, proposal: { ...pm.proposal, intent: "conversation_only" } },
      result: { kind: "conversation_only" as const },
      board_refresh: false,
      select_task_id: null,
    };

    expect(IntakeAckV1Schema.parse(conversation)).toEqual(conversation);
    expect(IntakeAckV1Schema.safeParse({ ...conversation, board_refresh: true }).success).toBe(false);
    expect(IntakeAckV1Schema.safeParse({ ...conversation, select_task_id: `task-${"a".repeat(64)}` }).success).toBe(false);
  });
});
