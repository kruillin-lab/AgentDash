// Mutation sweep for the HERMES COMMAND BOUNDARY: src/server/hermes/command.ts.
//
// This is the only place in the product that turns a controller decision into a real
// OS process. Everything it enforces is a boundary control - which binary may run, what
// may be passed to it, what environment it may see, what may come back out, and whether
// the tree it started is actually dead - and all of it was previously unswept. The other
// three sweeps target scripts/mission-control/*.mjs and the runtime dispatch path, so
// their green counts were true statements about a scope that excluded this file. That is
// the exact miss mutation-sweep-runtime.cjs was created for; this file closes the same
// gap one layer down.
//
// Run: node scripts/mission-control/mutation-sweep-hermes.cjs
const fs = require("fs");
const { sweep, report, VITEST } = require("./mutation-runner.cjs");

// The `runner never uses a shell` mutation genuinely hands arguments to cmd.exe, which is
// the point - but several tests pass arrow functions, so `=>` parses as a redirect and
// cmd.exe creates junk files named after the rest of the expression in the repo root.
// mutation-runner restores source byte-for-byte; it cannot know about side-effect files.
// So this sweep removes exactly what appeared in the root during its own run: new plain
// files only, never directories, never anything that existed before it started.
function rootFiles() {
  return new Set(fs.readdirSync(".", { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name));
}

function removeStrays(before) {
  const strays = [...rootFiles()].filter((name) => !before.has(name));
  for (const name of strays) {
    fs.rmSync(name, { force: true });
    console.log(`  removed stray file left by a mutated run: ${name}`);
  }
  return strays.length;
}

const COMMAND = ["src/server/hermes/command.test.ts"];

// Needles are single-line wherever a single line is unique. Where it is not - `const env
// = validate(options)` appears in both the runner and the detached launcher - the needle
// carries an explicit \r\n, because these files are CRLF and a "\n" would match nothing.
const DETACHED_VALIDATE = "export function launchDetachedCommand(options: DetachedCommandOptions): { pid: number | undefined } {\r\n  const env = validate(options);";
const RUN_SPAWN_OPTIONS = "        shell: false,\r\n        stdio: [options.stdin === undefined ? \"ignore\" : \"pipe\", \"pipe\", \"pipe\"],";

const EXECUTABLE_GATE = "  if (!executable || !isAbsolute(executable) || FORBIDDEN_EXECUTABLE_EXTENSIONS.has(executableExtension(executable))) {";
// String.raw, deliberately: the NUL check is the two characters \ and 0 in the source.
// Hand-escaping it as "\\0" survives here but not through every editor and shell in this
// repo's history - one pass through a shell turned it into a real NUL byte, and the needle
// then matched nothing while looking correct. String.raw removes the escaping layer.
const ARGUMENT_GATE = String.raw`  if (args.length > MAX_ARGUMENTS || args.some((arg) => typeof arg !== "string" || arg.includes("\0") || Buffer.byteLength(arg) > MAX_ARGUMENT_BYTES)) {`;
const ARG_NO_COUNT = String.raw`  if (args.some((arg) => typeof arg !== "string" || arg.includes("\0") || Buffer.byteLength(arg) > MAX_ARGUMENT_BYTES)) {`;
const ARG_NO_NUL = String.raw`  if (args.length > MAX_ARGUMENTS || args.some((arg) => typeof arg !== "string" || Buffer.byteLength(arg) > MAX_ARGUMENT_BYTES)) {`;
const ARG_NO_SIZE = String.raw`  if (args.length > MAX_ARGUMENTS || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {`;

const TARGETS = [
  ["src/server/hermes/command.ts", [
    // Which binary may run at all.
    ["executable must be absolute", EXECUTABLE_GATE, "  if (!executable || FORBIDDEN_EXECUTABLE_EXTENSIONS.has(executableExtension(executable))) {", VITEST, COMMAND],
    ["script wrappers rejected", EXECUTABLE_GATE, "  if (!executable || !isAbsolute(executable)) {", VITEST, COMMAND],
    ["allowlist membership enforced", "  if (!allowedExecutables.some((allowed) => isAbsolute(allowed) && normalizedExecutable(allowed) === normalizedExecutable(executable))) {", "  if (!allowedExecutables.some((allowed) => isAbsolute(allowed))) {", VITEST, COMMAND],
    // What may be passed to it.
    ["argument count bounded", ARGUMENT_GATE, ARG_NO_COUNT, VITEST, COMMAND],
    ["argument NUL rejected", ARGUMENT_GATE, ARG_NO_NUL, VITEST, COMMAND],
    ["argument size bounded", ARGUMENT_GATE, ARG_NO_SIZE, VITEST, COMMAND],
    // No implicit shell: the whole reason arguments can carry CEO punctuation safely.
    ["runner never uses a shell", RUN_SPAWN_OPTIONS, "        shell: true,\r\n        stdio: [options.stdin === undefined ? \"ignore\" : \"pipe\", \"pipe\", \"pipe\"],", VITEST, COMMAND],
    // What environment it may see.
    ["forbidden env keys rejected", "    if (FORBIDDEN_ENVIRONMENT_KEY.test(key)) {", "    if (false) {", VITEST, COMMAND],
    ["env key shape enforced", "    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value === undefined) continue;", "    if (value === undefined) continue;", VITEST, COMMAND],
    // What may come back out. redactValues carries live capability tokens from
    // controller-admin.ts and kanban-adapter.ts, so this is a credential path.
    ["caller-supplied secrets redacted", '    if (value.length >= 6) redacted = redacted.split(value).join("[REDACTED]");', "", VITEST, COMMAND],
    ["credential shapes redacted", '  for (const pattern of CREDENTIAL_SHAPES) redacted = redacted.replace(pattern, "[REDACTED]");', "", VITEST, COMMAND],
    ["stdout is redacted", "          stdout: redact(Buffer.concat(stdout).toString(\"utf8\"), explicitValues),", '          stdout: Buffer.concat(stdout).toString("utf8"),', VITEST, COMMAND],
    ["stderr is redacted", "          stderr: redact(capturedStderr, explicitValues),", "          stderr: capturedStderr,", VITEST, COMMAND],
    // The detached launcher runs under the same policy, or it is a hole beside the door.
    ["detached launch is validated", DETACHED_VALIDATE, "export function launchDetachedCommand(options: DetachedCommandOptions): { pid: number | undefined } {\r\n  const env = validatedEnvironment(options.env);", VITEST, COMMAND],
    // Whether the tree it started is actually dead. A wrong answer here terminalizes
    // `inconsistent`, durably recording a successful cancel as unresolved activity.
    ["win32 close does not cancel retries", "            if (attempt === terminationAttempts) throw new CommandTerminationError();", '            if (attempt === terminationAttempts || (platform === "win32" && closeResult)) throw new CommandTerminationError();', VITEST, COMMAND],
    ["unconfirmed win32 close fails closed", "              if (closeResult) throw new CommandTerminationError();", "", VITEST, COMMAND],
  ]],
];

const before = rootFiles();
let results;
try {
  results = sweep(TARGETS);
} finally {
  removeStrays(before);
}
process.exitCode = report(results) > 0 ? 1 : 0;
