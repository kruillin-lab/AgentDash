// Mutation sweep for the RUNTIME dispatch-authority path.
//
// This file exists because of a specific miss. The other two sweeps target only
// scripts/mission-control/*.mjs, so their "28 of 28" and "24 of 24" were true
// statements about a scope that EXCLUDED runtime/composition.ts — the code that
// actually decides whether the live server dispatches. An independent audit found
// `manifest_digest` was validated for shape only there, and three further guards
// (dormantPort's throw, the isAbsolute state-dir check, the NEXT_RUNTIME early
// return) could be deleted with every test still green.
//
// The authority rule these guards enforce: the durable promotion record is the only
// thing that GRANTS dispatch authority, MISSION_CONTROL_DISPATCH may only RESTRICT
// it, and a record is authority only if the manifest it names actually backs it.
//
// It also covers the runtime's other terminal decision: whether a cancelled or
// aborted command's process tree was actually killed. An unconfirmed termination
// terminalizes `inconsistent`, so the two guards that decide it are pinned here for
// the same reason - a wrong answer becomes a durable record of unresolved external
// activity.
//
// Run: node scripts/mission-control/mutation-sweep-runtime.cjs
const { sweep, report, VITEST } = require("./mutation-runner.cjs");

const COMPOSITION = ["src/server/mission-control/runtime/composition.test.ts"];
const INSTRUMENTATION = ["src/instrumentation.test.ts"];
const BOTH = [...COMPOSITION, ...INSTRUMENTATION];
const HERMES_COMMAND = ["src/server/hermes/command.test.ts"];

const TARGETS = [
  ["src/server/mission-control/runtime/composition.ts", [
    // The manifest binding: shape alone must never be authority.
    ["record manifest resolved", "    return (await verifyRecordManifest(stateDir, record)) ? parsed.data : null;", "    return parsed.data;", VITEST, COMPOSITION],
    ["manifest digest recomputed", "  if (canonicalDigest(body) !== digest) return false;", "", VITEST, COMPOSITION],
    // REDUNDANT-BY-DESIGN, verified: the next line recomputes canonicalDigest(body)
    // against the same digest, so a wrong `claimed` with a body that still hashes
    // correctly is cryptographically valid anyway. Kept as defence in depth, but it
    // cannot be pinned, so it is not counted as a guard the suite protects.
    ["manifest names itself (redundant)", "  if (claimed !== digest) return false;", "", VITEST, COMPOSITION, "redundant"],
    ["manifest authorizes this mode", '  return (manifest as { target_mode?: unknown }).target_mode === record.mode;', "  return true;", VITEST, COMPOSITION],
    // Single-line needle only: these files are CRLF, so a "\n" inside a needle
    // matches nothing and the mutation silently never applies.
    ["absent manifest fails closed", '    manifest = JSON.parse(await readFile(join(stateDir, "dispatch", `promotion-${digest}.json`), "utf8"));', "    manifest = { manifest_digest: digest, target_mode: record.mode };", VITEST, COMPOSITION],
    // The record's own shape checks. Two are redundant with downstream validation —
    // verified, not assumed — so they are marked rather than counted.
    ["record digest shape (redundant)", '    if (typeof record.manifest_digest !== "string" || !/^[a-f0-9]{64}$/i.test(record.manifest_digest)) return null;', "", VITEST, COMPOSITION, "redundant"],
    ["record expiry", '    if (typeof record.expires_at === "string" && Date.parse(record.expires_at) <= Date.now()) return null;', "", VITEST, COMPOSITION],
    // An array has no `mode`, so DispatchModeSchema.safeParse rejects it anyway.
    ["record array rejection (redundant)", '    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;', "", VITEST, COMPOSITION, "redundant"],
    // State containment and the dormant backstop.
    ["state dir must be absolute", "  if (!value || !isAbsolute(value)) return null;", "  if (!value) return null;", VITEST, COMPOSITION],
    ["dormant adapter throws", "      return () => { throw new Error(`Mission control runtime is dormant: the ${name} adapter is not connected.`); };", "      return () => undefined;", VITEST, COMPOSITION],
  ]],
  ["src/server/mission-control/runtime/dispatch-mode.ts", [
    // The env var may only RESTRICT; it must never grant.
    ["env may only restrict", "  return authorityRank(env) < authorityRank(stored) ? env : stored;", "  return env;", VITEST, BOTH],
    ["absent env restricts nothing", "  if (!envPresent) return stored;", "  if (!envPresent) return parseDispatchMode(input.envMode);", VITEST, BOTH],
  ]],
  ["src/server/hermes/command.ts", [
    // The win32 ordering guard. Restoring the abort-on-close short-circuit reinstates the
    // race: taskkill's exit lands ~1ms after the close of the parent it just killed, so
    // whichever fired first decided the verdict and a successful kill reported
    // termination_unconfirmed.
    ["win32 close does not cancel retries", "            if (attempt === terminationAttempts) throw new CommandTerminationError();", '            if (attempt === terminationAttempts || (platform === "win32" && closeResult)) throw new CommandTerminationError();', VITEST, HERMES_COMMAND],
    // The guard that ordering fix must not weaken: a parent gone with nothing confirmed is
    // an unreachable, unverified tree and must stay fatal.
    ["unconfirmed win32 close fails closed", "              if (closeResult) throw new CommandTerminationError();", "", VITEST, HERMES_COMMAND],
  ]],
  ["src/instrumentation.ts", [
    ["nodejs runtime only", '  if (process.env.NEXT_RUNTIME !== "nodejs") return;', "", VITEST, INSTRUMENTATION],
    // Normalizing an ABSENT value into "disabled" made the env var always present,
    // so it always restricted and a promoted mode could never take effect.
    ["absent env stays absent", '  if (configuredDispatch !== undefined && configuredDispatch !== "") {', "  if (true) {", VITEST, INSTRUMENTATION],
  ]],
];

process.exitCode = report(sweep(TARGETS)) > 0 ? 1 : 0;
