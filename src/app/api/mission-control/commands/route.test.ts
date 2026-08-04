import { beforeEach, describe, expect, test, vi } from "vitest";

import { getCEOCommandRouteDependencies } from "../../../../server/mission-control/authority/dependencies";
import { CEOCommandError } from "../../../../server/mission-control/authority/ceo-command";
import { COMMAND_SESSION_COOKIE_NAME, issueCommandSession } from "../../../../server/mission-control/security/command-session";
import { POST } from "./route";

vi.mock("../../../../server/mission-control/authority/dependencies", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../server/mission-control/authority/dependencies")>(),
  getCEOCommandRouteDependencies: vi.fn(),
}));

const secret = "command-route-test-secret-with-32-bytes-minimum";
const now = Date.parse("2026-08-04T10:00:00.000Z");
const issued = issueCommandSession({ secret, now: now - 1_000, ttl_ms: 60_000 });
const publicRequest = { task_id: `task-${"a".repeat(64)}`, replay_nonce: "nonce-1234567890", displayed_task_spec_revision: 0, displayed_task_spec_digest: "b".repeat(64), proposed_mandate_id: "mandate-1", proposed_mandate_digest: "c".repeat(64), decision_type: "initial_mandate_approval" };
const result = { schema_version: "agentdash.activation-result/v1", task_id: publicRequest.task_id, command_id: "command-1", authority_id: "authority-1", task_spec_digest: publicRequest.displayed_task_spec_digest, mandate_digest: publicRequest.proposed_mandate_digest, activated_at: "2026-08-04T10:00:00.000Z" };
const headers = { Host: "127.0.0.1:3007", Origin: "http://127.0.0.1:3007", "Content-Type": "application/json", Cookie: `${COMMAND_SESSION_COOKIE_NAME}=${issued.cookie}`, "X-AgentDash-CSRF": issued.csrf_token };
const request = (body: unknown, extra: Record<string, string> = {}) => new Request("http://127.0.0.1:3007/api/mission-control/commands", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });

const approveInitial = vi.fn().mockResolvedValue(result);
beforeEach(() => {
  approveInitial.mockReset().mockResolvedValue(result);
  vi.mocked(getCEOCommandRouteDependencies).mockReturnValue({ secret, now: () => now, service: { approveInitial } as never });
});

describe("POST /api/mission-control/commands", () => {
  test("requires exact local authority and JSON", async () => {
    expect((await POST(request(publicRequest, { Origin: "http://evil.example" }))).status).toBe(403);
    expect((await POST(request(publicRequest, { "X-Forwarded-Host": "evil.example" }))).status).toBe(403);
    expect((await POST(request(publicRequest, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect(approveInitial).not.toHaveBeenCalled();
  });

  test("rejects raw body overflow", async () => {
    expect((await POST(request({ ...publicRequest, padding: "x".repeat(70_000) }))).status).toBe(413);
  });

  test("requires exactly one named command cookie", async () => {
    expect((await POST(request(publicRequest, { Cookie: "other=value" }))).status).toBe(401);
    expect((await POST(request(publicRequest, { Cookie: `${COMMAND_SESSION_COOKIE_NAME}=${issued.cookie}; ${COMMAND_SESSION_COOKIE_NAME}=${issued.cookie}` }))).status).toBe(401);
    expect(approveInitial).not.toHaveBeenCalled();
  });

  test("requires the matching in-memory CSRF token and current session", async () => {
    expect((await POST(request(publicRequest, { "X-AgentDash-CSRF": "wrong-csrf-token" }))).status).toBe(401);
    vi.mocked(getCEOCommandRouteDependencies).mockReturnValue({ secret, now: () => issued.session.expires_at, service: { approveInitial } as never });
    expect((await POST(request(publicRequest))).status).toBe(401);
  });

  test.each([
    ["browser authority", { ...publicRequest, csrf_valid: true }],
    ["grant", { ...publicRequest, authority_id: "authority-client" }],
    ["budget", { ...publicRequest, aggregate_budget: {} }],
    ["wrong decision", { ...publicRequest, decision_type: "budget_change" }],
  ])("rejects client-supplied %s fields before command construction", async (_label, body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(approveInitial).not.toHaveBeenCalled();
  });

  test("passes only the strict request and verified signed session to the service", async () => {
    const response = await POST(request(publicRequest));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(approveInitial).toHaveBeenCalledWith(publicRequest, issued.session);
  });

  test.each([
    ["activation_conflict", 409],
    ["replay_conflict", 409],
    ["activation_expired", 409],
    ["activation_unavailable", 503],
  ])("maps typed service error %s", async (code, status) => {
    approveInitial.mockRejectedValue(new CEOCommandError(code as never, "internal detail"));
    const response = await POST(request(publicRequest));
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain("internal detail");
  });
});
