import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { MISSION_CONTROL_HOST, MISSION_CONTROL_ORIGIN } from "../../server/mission-control/security/local-origin";

// Every state-changing API route must reject a request that does not carry exact local
// Mission Control authority. Without it, any page the user visits can POST to the local
// server: the browser sends the request, and a side effect does not need the response to
// be readable. `POST /api/hermes/pty` + `/api/hermes/pty/:id {action:"input"}` was the
// worst case - spawn an agent PTY, then write raw keystrokes into it.
//
// Routes are DISCOVERED from disk rather than listed. A hand-maintained list only pins the
// routes someone remembered to add, and the gap this closes was six handlers written
// beside three correct ones. A new unguarded POST now fails here on the day it lands.
const API_ROOT = dirname(fileURLToPath(import.meta.url));
const MINIMUM_EXPECTED_POST_ROUTES = 7;

function routeModulePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return routeModulePaths(full);
    return entry.isFile() && entry.name === "route.ts" ? [full] : [];
  });
}

type RouteHandler = (request: Request, context: unknown) => Promise<Response>;

// Imported by raw absolute path, not pathToFileURL: Next's dynamic segments are literal
// "[id]" directories, and percent-encoding those brackets into a file:// URL produces a
// specifier Vite cannot resolve back to the file.
const discovered = await Promise.all(
  routeModulePaths(API_ROOT).map(async (file) => ({
    name: relative(API_ROOT, file).replace(/\\/g, "/"),
    post: (await import(file.replace(/\\/g, "/"))).POST as RouteHandler | undefined,
  })),
);
const postRoutes = discovered.filter((route) => typeof route.post === "function");

function request(headers: Record<string, string>): Request {
  return new Request(`${MISSION_CONTROL_ORIGIN}/api/probe`, {
    method: "POST",
    headers: { Host: MISSION_CONTROL_HOST, "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ action: "input", data: "probe", prompt: "probe" }),
  });
}

describe("local Mission Control authority", () => {
  // Guards the discovery itself: a walker that silently finds nothing would make every
  // assertion below vacuous and report green.
  test("discovers every POST route on disk", () => {
    expect(postRoutes.length).toBeGreaterThanOrEqual(MINIMUM_EXPECTED_POST_ROUTES);
    expect(postRoutes.map((route) => route.name)).toContain("hermes/pty/route.ts");
    expect(postRoutes.map((route) => route.name)).toContain("hermes/pty/[id]/route.ts");
  });

  test.each(postRoutes.map((route) => [route.name, route] as const))(
    "%s rejects a request without exact local authority",
    async (_name, route) => {
      const context = { params: { id: "1", taskId: `task-${"a".repeat(64)}` } };
      const foreignOrigin = await route.post!(request({ Origin: "http://evil.example" }), context);
      const absentOrigin = await route.post!(request({}), context);
      const forwarded = await route.post!(request({ Origin: MISSION_CONTROL_ORIGIN, "X-Forwarded-Host": "evil.example" }), context);

      expect(foreignOrigin.status).toBe(403);
      expect(absentOrigin.status).toBe(403);
      expect(forwarded.status).toBe(403);
    },
  );
});
