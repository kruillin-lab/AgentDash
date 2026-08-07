import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { canonicalDigest } from "../../lib/mission-control/contracts";
import type { CommandOptions, CommandResult } from "./command";
import {
  HermesControllerAdmin,
  HermesControllerAdminDomainError,
  HermesControllerAdminTransportError,
} from "./controller-admin";

const executableBytes = Buffer.from("sealed Hermes admin launcher");
const executableSha256 = createHash("sha256").update(executableBytes).digest("hex");
const protocol = "hermes-kanban-controller-admin/1";
const observedAt = "2026-08-07T04:30:00.000Z";
const boardUuid = "123e4567-e89b-12d3-a456-426614174000";
const activeToken = Buffer.alloc(32, 0x61).toString("base64url");
const stagedToken = Buffer.alloc(32, 0x62).toString("base64url");
const activeAuthorization = {
  kind: "active_capability" as const,
  capability_id: "capability_00001",
  generation: 1,
  token: activeToken,
};
const stagedAuthorization = {
  kind: "staged_capability" as const,
  capability_id: "capability_00002",
  generation: 2,
  token: stagedToken,
};

type ResultFactory = (operation: string, request: Record<string, unknown>) => unknown;

function cleanResult(stdout: string, overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    stdout,
    stderr: "",
    code: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    outputLimitExceeded: false,
    ...overrides,
  };
}

function harness(resultFor: ResultFactory) {
  const runner = vi.fn(async (command: CommandOptions) => {
    const request = JSON.parse(command.stdin ?? "null") as Record<string, unknown>;
    const operation = String(request.operation);
    const result = resultFor(operation, request);
    return cleanResult(JSON.stringify({
      protocol,
      request_id: request.request_id,
      operation,
      ok: true,
      result_digest: canonicalDigest(result),
      result,
      error: null,
      observed_at: observedAt,
    }));
  });
  const admin = new HermesControllerAdmin({
    executable: "C:\\trusted\\hermes-kanban-controller-admin.exe",
    expectedExecutableSha256: executableSha256,
    expectedBoardUuid: boardUuid,
    cwd: "C:\\trusted",
      readExecutable: async () => executableBytes,
      assertExecutableProtected: vi.fn(async () => undefined),
    runner,
    requestId: () => "request_00000001",
  });
  return { admin, runner };
}

const bootstrapPayload = {
  board_uuid: boardUuid,
  candidate_commit: "a".repeat(40),
  candidate_tree: "b".repeat(40),
  executable_sha256: executableSha256,
  capability_id: "capability_00001",
  generation: 1 as const,
  token: activeToken,
  allowed_operation_digest: "c".repeat(64),
  not_before: "2026-08-07T04:00:00.000Z",
  not_after: "2026-08-08T04:00:00.000Z",
};

describe("HermesControllerAdmin", () => {
  test("bootstraps only through the fixed admin operation with the token confined to redacted stdin", async () => {
    const bootstrapResult = {
      board_uuid: boardUuid,
      capability_id: "capability_00001",
      generation: 1,
      state: "active",
      schema_version: 1,
      candidate_commit: bootstrapPayload.candidate_commit,
      candidate_tree: bootstrapPayload.candidate_tree,
      executable_sha256: executableSha256,
    };
    const { admin, runner } = harness(() => bootstrapResult);

    await expect(admin.bootstrap(bootstrapPayload)).resolves.toEqual(bootstrapResult);

    const invocation = runner.mock.calls[0][0];
    const request = JSON.parse(invocation.stdin ?? "null");
    expect(invocation.args).toEqual(["capability-bootstrap"]);
    expect(request).toEqual({
      protocol,
      request_id: "request_00000001",
      operation: "capability-bootstrap",
      authorization: { kind: "os_identity_bootstrap" },
      payload_digest: canonicalDigest(bootstrapPayload),
      payload: bootstrapPayload,
    });
    expect(invocation.redactValues).toEqual([activeToken]);
    expect(JSON.stringify(invocation.args)).not.toContain(activeToken);
    expect(JSON.stringify(invocation.env)).not.toContain(activeToken);
    expect(JSON.stringify(bootstrapResult)).not.toContain(activeToken);
    expect(JSON.stringify(bootstrapResult)).not.toContain("token_hash");
  });

  test("handles rotate-stage, rotate-probe, revoke, and status with exact operation-specific contracts", async () => {
    const results: Record<string, unknown> = {
      "capability-rotate-stage": { board_uuid: boardUuid, capability_id: "capability_00002", generation: 2, state: "staged" },
      "capability-rotate-probe": { board_uuid: boardUuid, capability_id: "capability_00002", generation: 2, state: "active", revoked_capability_id: "capability_00001", revoked_generation: 1 },
      "capability-revoke": { board_uuid: boardUuid, capability_id: "capability_00001", generation: 1, state: "revoked" },
      "capability-status": {
        board_uuid: boardUuid,
        schema_version: 1,
        candidate_commit: bootstrapPayload.candidate_commit,
        candidate_tree: bootstrapPayload.candidate_tree,
        executable_sha256: executableSha256,
        active_generation: 2,
        capabilities: [
          { capability_id: "capability_00001", generation: 1, state: "revoked", allowed_operation_digest: "c".repeat(64), not_before: bootstrapPayload.not_before, not_after: bootstrapPayload.not_after },
          { capability_id: "capability_00002", generation: 2, state: "active", allowed_operation_digest: "c".repeat(64), not_before: bootstrapPayload.not_before, not_after: bootstrapPayload.not_after },
        ],
      },
    };
    const { admin, runner } = harness((operation) => results[operation]);

    const stagePayload = {
      new_capability_id: "capability_00002",
      new_generation: 2,
      new_token: stagedToken,
      allowed_operation_digest: "c".repeat(64),
      not_before: bootstrapPayload.not_before,
      not_after: bootstrapPayload.not_after,
      expected_active_generation: 1,
    };
    const probePayload = { expected_previous_capability_id: "capability_00001", expected_previous_generation: 1 };
    const revokePayload = { target_capability_id: "capability_00001", target_generation: 1, reason_code: "rotated" as const, expected_active_generation: 2 };

    await expect(admin.rotateStage(activeAuthorization, stagePayload)).resolves.toEqual(results["capability-rotate-stage"]);
    await expect(admin.rotateProbe(stagedAuthorization, probePayload)).resolves.toEqual(results["capability-rotate-probe"]);
    await expect(admin.revoke({ ...activeAuthorization, capability_id: "capability_00002", generation: 2 }, revokePayload)).resolves.toEqual(results["capability-revoke"]);
    await expect(admin.status({ ...activeAuthorization, capability_id: "capability_00002", generation: 2 })).resolves.toEqual(results["capability-status"]);

    expect(runner.mock.calls.map(([call]) => call.args)).toEqual([
      ["capability-rotate-stage"],
      ["capability-rotate-probe"],
      ["capability-revoke"],
      ["capability-status"],
    ]);
    expect(JSON.parse(runner.mock.calls[0][0].stdin ?? "null")).toMatchObject({ authorization: activeAuthorization, payload: stagePayload });
    expect(runner.mock.calls[0][0].redactValues).toEqual([activeToken, stagedToken]);
    expect(JSON.parse(runner.mock.calls[3][0].stdin ?? "null").payload).toEqual({});
    expect(JSON.stringify(results["capability-status"])).not.toContain("token");
  });

  test("rejects invalid operation-specific authorization and generation transitions before execution", async () => {
    const { admin, runner } = harness(() => ({}));

    await expect(admin.status({ ...activeAuthorization, kind: "staged_capability" } as never)).rejects.toThrow(/authorization/i);
    await expect(admin.rotateStage(activeAuthorization, {
      new_capability_id: "capability_00002",
      new_generation: 3,
      new_token: stagedToken,
      allowed_operation_digest: "c".repeat(64),
      not_before: bootstrapPayload.not_before,
      not_after: bootstrapPayload.not_after,
      expected_active_generation: 1,
    })).rejects.toThrow(/generation/i);
    await expect(admin.bootstrap({ ...bootstrapPayload, generation: 2 } as never)).rejects.toThrow(/request/i);
    expect(runner).not.toHaveBeenCalled();
  });

  test("refuses a separately pinned admin executable whose bytes changed", async () => {
    const { admin } = harness(() => ({}));
    (admin as unknown as { readExecutable: () => Promise<Uint8Array> }).readExecutable = async () => Buffer.from("replaced admin launcher");

    await expect(admin.status(activeAuthorization)).rejects.toThrow(/executable/i);
  });

  test("refuses to launch unless the reviewed admin executable is protected against replacement", async () => {
    const { admin, runner } = harness(() => ({}));
    (admin as unknown as { assertExecutableProtected: () => Promise<void> }).assertExecutableProtected = vi.fn(async () => {
      throw new Error("unprotected");
    });

    await expect(admin.status(activeAuthorization)).rejects.toThrow(/protected/i);
    expect(runner).not.toHaveBeenCalled();
  });

  test("rejects bootstrap input and operation results for any board other than the pinned board", async () => {
    const wrongBoardUuid = "223e4567-e89b-12d3-a456-426614174000";
    const { admin, runner } = harness(() => ({
      board_uuid: wrongBoardUuid,
      schema_version: 1,
      candidate_commit: bootstrapPayload.candidate_commit,
      candidate_tree: bootstrapPayload.candidate_tree,
      executable_sha256: executableSha256,
      active_generation: 1,
      capabilities: [{
        capability_id: activeAuthorization.capability_id,
        generation: 1,
        state: "active",
        allowed_operation_digest: "c".repeat(64),
        not_before: bootstrapPayload.not_before,
        not_after: bootstrapPayload.not_after,
      }],
    }));

    await expect(admin.bootstrap({ ...bootstrapPayload, board_uuid: wrongBoardUuid })).rejects.toThrow(/board/i);
    expect(runner).not.toHaveBeenCalled();

    await expect(admin.status(activeAuthorization)).rejects.toBeInstanceOf(HermesControllerAdminTransportError);
  });

  test("rejects response identity, digest, and strict-result violations", async () => {
    const { admin, runner } = harness(() => ({}));
    const valid = { board_uuid: boardUuid, capability_id: "capability_00001", generation: 1, state: "revoked" };
    runner.mockImplementation(async (command) => {
      const request = JSON.parse(command.stdin ?? "null");
      return cleanResult(JSON.stringify({ protocol, request_id: "different_request", operation: request.operation, ok: true, result_digest: canonicalDigest(valid), result: valid, error: null, observed_at: observedAt }));
    });
    await expect(admin.revoke(activeAuthorization, { target_capability_id: "capability_00001", target_generation: 1, reason_code: "rotated", expected_active_generation: 1 })).rejects.toThrow(/response/i);

    runner.mockImplementation(async (command) => {
      const request = JSON.parse(command.stdin ?? "null");
      return cleanResult(JSON.stringify({ protocol, request_id: request.request_id, operation: request.operation, ok: true, result_digest: "0".repeat(64), result: valid, error: null, observed_at: observedAt }));
    });
    await expect(admin.revoke(activeAuthorization, { target_capability_id: "capability_00001", target_generation: 1, reason_code: "rotated", expected_active_generation: 1 })).rejects.toThrow(/digest/i);

    runner.mockImplementation(async (command) => {
      const request = JSON.parse(command.stdin ?? "null");
      const polluted = { ...valid, token_hash: "0".repeat(64) };
      return cleanResult(JSON.stringify({ protocol, request_id: request.request_id, operation: request.operation, ok: true, result_digest: canonicalDigest(polluted), result: polluted, error: null, observed_at: observedAt }));
    });
    await expect(admin.revoke(activeAuthorization, { target_capability_id: "capability_00001", target_generation: 1, reason_code: "rotated", expected_active_generation: 1 })).rejects.toThrow(/result/i);

    runner.mockImplementation(async (command) => {
      const request = JSON.parse(command.stdin ?? "null");
      const response = JSON.stringify({ protocol, request_id: request.request_id, operation: request.operation, ok: true, result_digest: canonicalDigest(valid), result: valid, error: null, observed_at: observedAt });
      return cleanResult(response.replace(`"request_id":"${request.request_id}"`, `"request_id":"${request.request_id}","request_id":"${request.request_id}"`));
    });
    await expect(admin.revoke(activeAuthorization, { target_capability_id: "capability_00001", target_generation: 1, reason_code: "rotated", expected_active_generation: 1 })).rejects.toBeInstanceOf(HermesControllerAdminTransportError);
  });

  test("maps nonzero, timeout, malformed, and polluted transport outcomes to one redacted unknown error", async () => {
    const { admin, runner } = harness(() => ({}));
    for (const outcome of [
      cleanResult("", { code: 70, stderr: "controller_internal_unknown" }),
      cleanResult("", { code: null, timedOut: true }),
      cleanResult(`{"token":"${activeToken}"`),
    ]) {
      runner.mockResolvedValueOnce(outcome);
      const error = await admin.status(activeAuthorization).catch((caught) => caught);
      expect(error).toBeInstanceOf(HermesControllerAdminTransportError);
      expect(error).toMatchObject({ code: "unknown" });
      expect(String(error)).not.toContain(activeToken);
      expect(String(error)).not.toContain("controller_internal_unknown");
    }
  });

  test("returns only fixed typed domain errors from an otherwise trustworthy envelope", async () => {
    const { admin, runner } = harness(() => ({}));
    runner.mockImplementation(async (command) => {
      const request = JSON.parse(command.stdin ?? "null");
      return cleanResult(JSON.stringify({
        protocol,
        request_id: request.request_id,
        operation: request.operation,
        ok: false,
        result_digest: null,
        result: null,
        error: { code: "unauthorized", message: "The controller capability is not authorized.", disposition: "operator_action" },
        observed_at: observedAt,
      }));
    });

    const error = await admin.status(activeAuthorization).catch((caught) => caught);
    expect(error).toBeInstanceOf(HermesControllerAdminDomainError);
    expect(error).toMatchObject({ code: "unauthorized", disposition: "operator_action" });
    expect(String(error)).toBe("HermesControllerAdminDomainError: The controller capability is not authorized.");
  });
});
