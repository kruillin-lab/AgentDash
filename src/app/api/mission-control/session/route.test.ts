import { beforeEach, describe, expect, test, vi } from "vitest";

import { getCommandSessionRouteDependencies } from "../../../../server/mission-control/authority/dependencies";
import { COMMAND_SESSION_COOKIE_NAME, verifyCommandSession } from "../../../../server/mission-control/security/command-session";
import { POST } from "./route";

vi.mock("../../../../server/mission-control/authority/dependencies", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../server/mission-control/authority/dependencies")>(),
  getCommandSessionRouteDependencies: vi.fn(),
}));

const secret = "session-route-test-secret-with-32-bytes-minimum";
const now = Date.parse("2026-08-04T10:00:00.000Z");
const headers = { Host: "127.0.0.1:3007", Origin: "http://127.0.0.1:3007", "Content-Type": "application/json" };
const request = (body: string, extra: Record<string, string> = {}) => new Request("http://127.0.0.1:3007/api/mission-control/session", { method: "POST", headers: { ...headers, ...extra }, body });

beforeEach(() => vi.mocked(getCommandSessionRouteDependencies).mockReturnValue({ secret, now: () => now }));

describe("POST /api/mission-control/session", () => {
  test("requires exact local authority and JSON", async () => {
    expect((await POST(request("{}", { Origin: "http://evil.example" }))).status).toBe(403);
    expect((await POST(request("{}", { "Content-Type": "text/plain" }))).status).toBe(415);
  });

  test.each(["{\"extra\":true}", "[]", "null"])("accepts only exact empty object: %s", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
  });

  test("rejects raw body overflow", async () => {
    expect((await POST(request(`{}${" ".repeat(2_048)}`))).status).toBe(413);
  });

  test.each(["", "short-secret"])("fails closed for missing or short signing secret", async (badSecret) => {
    vi.mocked(getCommandSessionRouteDependencies).mockReturnValue({ secret: badSecret, now: () => now });
    expect((await POST(request("{}"))).status).toBe(503);
  });

  test("sets one strict HttpOnly cookie and returns only memory-held CSRF metadata", async () => {
    const response = await POST(request("{}"));
    const body = await response.json() as { schema_version: string; csrf_token: string; expires_at: string };
    const setCookie = response.headers.get("set-cookie") ?? "";
    const opaqueCookie = setCookie.match(new RegExp(`${COMMAND_SESSION_COOKIE_NAME}=([^;]+)`))?.[1];

    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["csrf_token", "expires_at", "schema_version"]);
    expect(body.schema_version).toBe("agentdash.command-session/v1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(verifyCommandSession({ secret, cookie: opaqueCookie, csrf_token: body.csrf_token }, now + 1)).not.toBeNull();
  });
});
