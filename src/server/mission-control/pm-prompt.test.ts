import { describe, expect, test } from "vitest";

import { PMTurnInputV1Schema, buildPMPrompt } from "./pm-prompt";

const digest = "a".repeat(64);
const input = {
  message: "Please plan release & verification; don't run anything | $(whoami).",
  history: [
    { role: "user", content: "What remains?" },
    { role: "assistant", content: "The release plan needs verification." },
  ],
  reviewed_recall: [{
    page_id: "release-policy",
    page_digest: digest,
    excerpt: "Production release requires independent verification.",
    reviewed_at: "2026-08-04T10:00:00.000Z",
  }],
  capability_facts: [{
    capability_id: "route-codex-terra",
    summary: "Candidate only; dispatch disabled.",
    available: false,
    verified_at: "2026-08-04T10:00:00.000Z",
  }],
};

describe("PMTurnInputV1Schema", () => {
  // Production break caught: unknown adapter-command fields could cross the conversational API boundary.
  test("rejects adapter commands and unknown fields", () => {
    expect(PMTurnInputV1Schema.safeParse({ ...input, adapter_command: { adapter: "codeg", action: "dispatch" } }).success).toBe(false);
  });

  // Production break caught: unbounded history or recall could bypass the request-size policy after JSON parsing.
  test("caps conversation history and reviewed recall", () => {
    expect(PMTurnInputV1Schema.safeParse({ ...input, history: Array(25).fill(input.history[0]) }).success).toBe(false);
    expect(PMTurnInputV1Schema.safeParse({ ...input, reviewed_recall: Array(9).fill(input.reviewed_recall[0]) }).success).toBe(false);
  });

  // Production break caught: one enormous recall excerpt could bypass the aggregate recall-count limit.
  test("caps every reviewed recall excerpt", () => {
    expect(PMTurnInputV1Schema.safeParse({
      ...input,
      reviewed_recall: [{ ...input.reviewed_recall[0], excerpt: "x".repeat(2_048) }],
    }).success).toBe(false);
  });
});

describe("buildPMPrompt", () => {
  // Production break caught: normal CEO punctuation could escape into a command grammar instead of remaining JSON data.
  test("serializes the CEO message as bounded data inside the proposal-only prompt", () => {
    const prompt = buildPMPrompt(PMTurnInputV1Schema.parse(input));

    expect(prompt).toContain(JSON.stringify(input.message));
    expect(prompt).toContain('"intent":"conversation_only"');
    expect(prompt).toContain('"intent":"create_task"');
    expect(prompt).toContain("keys response_code and proposal");
    expect(prompt).toContain("proposal_drafted only with intent create_task");
    expect(prompt).not.toContain("keys text and proposal");
  });
}
);
