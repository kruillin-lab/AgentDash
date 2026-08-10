// Mutation sweep for the HTTP AUTHORITY GUARD on every state-changing API route.
//
// Origin/host validation is the whole defence against browser CSRF here. Any page the
// user visits can POST to 127.0.0.1 with a simple request - no preflight, and the side
// effect lands whether or not the attacker can read the response. `POST /api/hermes/pty`
// followed by `/api/hermes/pty/:id {action:"input"}` spawned an agent PTY and wrote raw
// keystrokes into it, with no check at all.
//
// The guard is one line repeated per route, which is exactly the shape that rots: it is
// easy to add a handler and forget it. src/app/api/local-authority.contract.test.ts
// discovers routes from disk so a new one cannot ship unguarded, and this sweep proves
// that discovery actually FAILS when a guard is removed rather than merely passing.
//
// Run: node scripts/mission-control/mutation-sweep-api.cjs
const { sweep, report, VITEST } = require("./mutation-runner.cjs");

const CONTRACT = ["src/app/api/local-authority.contract.test.ts"];
const GUARD = '  if (!authority.ok) return NextResponse.json({ error: { code: authority.code, message: "Local Mission Control authority is required." } }, { status: 403 })';

const GUARDED_ROUTES = [
  ["pty spawn", "src/app/api/hermes/pty/route.ts"],
  ["pty input", "src/app/api/hermes/pty/[id]/route.ts"],
  ["claw migrate/cleanup", "src/app/api/hermes/claw/route.ts"],
  ["hermes dashboard", "src/app/api/hermes/dashboard/route.ts"],
  ["opencode server start/stop", "src/app/api/opencode/server/route.ts"],
  ["opencode session create", "src/app/api/opencode/sessions/create/route.ts"],
  ["opencode prompt", "src/app/api/opencode/sessions/[id]/prompt/route.ts"],
];

const TARGETS = GUARDED_ROUTES.map(([label, file]) => [file, [
  [`${label} requires local authority`, GUARD, "", VITEST, CONTRACT],
]]);

process.exitCode = report(sweep(TARGETS)) > 0 ? 1 : 0;
