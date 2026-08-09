// Shared mutation-harness core.
//
// A mutation sweep only means something if three things are true, and each one has
// already failed in this project at least once:
//
//  1. The mutation was ACTUALLY APPLIED. These files are CRLF, so a `\n`-anchored
//     regex silently matches nothing and reports success while changing zero bytes.
//     That produced a false "uncaught guard" AND a false "mutation applied" here.
//     Every mutation is therefore byte-verified: the content must differ from the
//     original, or the result is reported as NO-OP rather than counted.
//  2. "Caught" must mean a test FAILED, not that the runner crashed. A malformed
//     mutation that breaks the parse makes every suite exit non-zero, which looks
//     identical to a pinned guard. Output is inspected for a real test failure, and
//     a load/parse-time crash is reported as CRASH so it gets fixed, not counted.
//  3. The file is restored afterward, byte-for-byte. An earlier auditor left two
//     production guards stubbed to `if(false)` in the real repo.
//
// Invoke Node directly for runners. `npx vitest` / `vitest.cmd` throws EINVAL when
// spawned this way on Windows, and an auditor's harness mis-scored 14 mutations as
// "caught" off exactly that spawn-level artifact.
const { execFileSync } = require("child_process");
const fs = require("fs");

const NODE_TEST = "node-test";
const VITEST = "vitest";

/** Run one suite. Returns { failed, crashed, output }. */
function runSuite(runner, targets) {
  const argv = runner === VITEST
    ? ["node_modules/vitest/dist/cli.js", "run", "--config", "vitest.config.ts", ...targets]
    : ["--test", ...targets];
  // Strip the parent's test-runner context. When a sweep is invoked from inside
  // `node --test`, NODE_TEST_CONTEXT=child-v8 is inherited and switches the CHILD to
  // the V8 serialization protocol, so its human-readable output disappears entirely —
  // every regex below then matches nothing and a broken guard scores as UNCAUGHT.
  // Verified: the harness self-tests fail without this.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;

  let output = "";
  let exited = 0;
  try {
    output = execFileSync("node", argv, { encoding: "utf8", stdio: "pipe", env });
  } catch (error) {
    exited = error.status ?? 1;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  if (exited === 0) return { failed: false, crashed: false, output };

  // CRASH IS CHECKED FIRST, and that order is load-bearing. `node --test` reports a
  // module that fails to PARSE as a failing test (`ℹ fail 1`), which is
  // indistinguishable from a pinned guard by exit code or failure count alone. Testing
  // "did it fail?" before "did it crash?" scored a deliberate SyntaxError as `caught`
  // — verified against real output. A genuine assertion failure never emits a
  // SyntaxError or module-resolution error, so their presence means the mutation
  // broke the load rather than tripping a guard.
  // Only LOAD-TIME signals count, and only when nothing ran. A ReferenceError or
  // similar can legitimately appear inside a failing test — verified: renaming an
  // export makes a test throw ReferenceError, which is a real caught failure, and
  // matching that name alone produced a false CRASH. A module that fails to parse,
  // by contrast, runs zero tests, so "no test passed" is the discriminator.
  const ranSomething = runner === VITEST
    ? /\d+ passed|Tests\s+\d+\s+passed/.test(output)
    : /ℹ pass [1-9]/.test(output);
  const loadError = /SyntaxError|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_INVALID_ARG|EINVAL|Unexpected token|Unexpected end of input/.test(output);
  if (loadError && !ranSomething) return { failed: false, crashed: true, output };

  const failed = runner === VITEST
    ? /Tests\s+\d*\s*failed|✕|×|AssertionError/.test(output)
    : /^not ok |ℹ fail [1-9]|AssertionError/m.test(output);
  return { failed, crashed: false, output };
}

/**
 * Apply each mutation, run its suite, restore, and score it.
 * Each entry: [label, exactNeedle, replacement, runner, suiteTargets, kind?]
 *
 * kind "redundant" marks a guard VERIFIED to be unreachable-to-fail because another
 * check independently covers it. Those are expected to survive, so they are reported
 * separately instead of inflating the caught count — a sweep that claimed to pin them
 * would be making exactly the overstated coverage claim these sweeps exist to catch.
 * If one ever becomes catchable, that is surfaced too: the redundancy is gone.
 */
function sweep(targets) {
  const results = [];
  for (const [file, mutations] of targets) {
    const backup = fs.readFileSync(file, "utf8");
    try {
      for (const [label, needle, replacement, runner, suites, kind] of mutations) {
        if (!backup.includes(needle)) { results.push([label, "ANCHOR-MISSING", kind]); continue; }
        const mutated = backup.replace(needle, replacement);
        // Byte-verify: an unchanged file means the mutation never happened.
        if (mutated === backup) { results.push([label, "NO-OP", kind]); continue; }
        fs.writeFileSync(file, mutated);
        let verdict;
        try {
          const { failed, crashed } = runSuite(runner ?? NODE_TEST, suites);
          verdict = failed ? "caught" : crashed ? "CRASH" : "UNCAUGHT";
        } finally {
          fs.writeFileSync(file, backup);
        }
        results.push([label, verdict, kind]);
      }
    } finally {
      // Restore unconditionally: a throw must never leave a guard stubbed out.
      fs.writeFileSync(file, backup);
    }
  }
  return results;
}

function report(results) {
  const graded = results.filter(([, , kind]) => kind !== "redundant");
  const redundant = results.filter(([, , kind]) => kind === "redundant");

  const bad = graded.filter(([, verdict]) => verdict !== "caught");
  for (const [label, verdict] of bad) console.log(`  ${verdict.padEnd(15)} ${label}`);

  // A redundant guard that suddenly IS caught means its cover disappeared.
  for (const [label, verdict] of redundant) {
    if (verdict === "caught") console.log(`  ${"NOW-PINNED".padEnd(15)} ${label} (was redundant; a covering check may have changed)`);
    else if (verdict !== "UNCAUGHT") console.log(`  ${verdict.padEnd(15)} ${label}`);
  }

  console.log(`\n${graded.length} mutations | ${graded.length - bad.length} caught | ${bad.length} needing attention`);
  if (redundant.length > 0) {
    console.log(`${redundant.length} redundant-by-design guard(s) excluded from the count (verified covered by another check).`);
  }
  return bad.length;
}

module.exports = { sweep, report, NODE_TEST, VITEST };
