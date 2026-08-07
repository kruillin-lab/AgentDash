import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { EnsureArtifactInputSchema, canonicalDigest } from "../../lib/mission-control/contracts";

import { HermesKanbanAdapter } from "./kanban-adapter";
import type { CommandOptions } from "./command";

const executableBytes = Buffer.from("sealed Hermes launcher");
const executableSha256 = createHash("sha256").update(executableBytes).digest("hex");
const observedAt = "2026-08-04T13:14:15.123Z";

function options(resultFor: (operation: string, payload: any) => unknown) {
  const runner = vi.fn(async (command: CommandOptions) => {
    const request = JSON.parse(command.stdin ?? "null");
    const result = resultFor(request.operation, request.payload);
    return {
      stdout: JSON.stringify({ protocol: "hermes-kanban-controller/1", request_id: request.request_id, operation: request.operation, ok: true, result_digest: canonicalDigest(result), result, error: null, observed_at: observedAt }),
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      outputLimitExceeded: false,
    };
  });
  return {
    adapter: new HermesKanbanAdapter({
      executable: "C:\\trusted\\hermes-kanban-controller.exe",
      expectedExecutableSha256: executableSha256,
      cwd: "C:\\trusted",
      boardId: "123e4567-e89b-12d3-a456-426614174000",
      capability: { capabilityId: "capability_00001", generation: 1, token: "eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg" },
      readExecutable: async () => executableBytes,
      runner,
    }),
    runner,
  };
}

describe("HermesKanbanAdapter", () => {
  test("looks up the durable intake by CEO request identity through the sealed bridge", async () => {
    const { adapter, runner } = options(() => ({ found: false, request_id: "request-1" }));

    await expect(adapter.lookupIntake("request-1")).resolves.toEqual({ status: "not_found" });
    const invocation = runner.mock.calls[0][0];
    const request = JSON.parse(invocation.stdin ?? "null");
    expect(invocation.args).toEqual(["intake-lookup"]);
    expect(request.payload).toEqual({ request_id: "request-1" });
    expect(request.authorization.token).toBe("eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg");
    expect(invocation.redactValues).toContain(request.authorization.token);
  });

  test("accepts only digest-bound exact bridge responses", async () => {
    const { adapter, runner } = options(() => ({ status: "not_found" }));
    runner.mockImplementationOnce(async (command) => {
      const request = JSON.parse(command.stdin ?? "null");
      return { stdout: JSON.stringify({ protocol: "hermes-kanban-controller/1", request_id: request.request_id, operation: request.operation, ok: true, result_digest: "0".repeat(64), result: { status: "not_found" }, error: null, observed_at: observedAt }), stderr: "", code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false };
    });

    await expect(adapter.getActivationSnapshot(`task-${"a".repeat(64)}`)).rejects.toThrow("digest");
  });

  test("ensures one immutable artifact and returns only the strict port DTO", async () => {
    const payload = { redacted: true as const, digest: "a".repeat(64), summary: "sealed task specification" };
    const digest = canonicalDigest(payload);
    const { adapter } = options((_operation, request) => ({ created: true, task_id: request.task_id, artifact_id: request.artifact_id, artifact_key: request.artifact_key, digest: request.digest }));

    const input = EnsureArtifactInputSchema.parse({ task_id: "task-1", artifact_key: "task-spec-v1", kind: "task_spec", digest, payload });
    await expect(adapter.ensureArtifact(input)).resolves.toEqual({ artifact_id: expect.stringMatching(/^artifact_/), created: true, digest });
  });

  test("projects exact controller rows into CEO board lanes without leaking transport rows", async () => {
    const task = { task_id: "task-1", title: "Approve release", body: "Review the proposed release.", status: "blocked", priority: 1, created_at: 1, updated_at: observedAt, request_digest: "a".repeat(64), revision: 2, ceo_input: { question: "Approve?" }, ceo_input_digest: "b".repeat(64), terminal_state: "nonterminal", terminal_intent: null, terminal_intent_digest: null, terminal_receipt_digest: null, runs: [] };
    const { adapter } = options(() => ({ generated_at: observedAt, tasks: [task], archived_count: 0 }));

    const board = await adapter.projectBoard();
    expect(board.lanes.needs_you).toHaveLength(1);
    expect(board.lanes.ready).toEqual([]);
    expect(board.lanes.needs_you[0]).toMatchObject({ redacted: true, summary: "Approve release — blocked" });
    expect(board.lanes.needs_you[0]).not.toHaveProperty("body");
  });

  test("refuses an executable whose current bytes no longer match the reviewed launcher", async () => {
    const { adapter } = options(() => ({ found: false, request_id: "request-1" }));
    (adapter as any).readExecutable = async () => Buffer.from("replaced launcher");
    await expect(adapter.lookupIntake("request-1")).rejects.toThrow("executable");
  });
});
