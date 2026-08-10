import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { sweep, NODE_TEST } = require("../mutation-runner.cjs");

// ---------------------------------------------------------------------------
// The harness that grades the guards has to be graded too.
//
// Every number these sweeps report depends on the harness telling the truth, and it
// has already lied in both directions in this project: a `\n`-anchored needle
// silently matched nothing against CRLF files and was scored as a real result, and a
// deliberate SyntaxError was scored as `caught` because a parse failure looks exactly
// like a failing test to `node --test`. Both were found by hand. These tests make the
// harness fail loudly instead.
// ---------------------------------------------------------------------------

const FILE = "scripts/mission-control/promote-gates.mjs";
const SUITES = ["scripts/mission-control/__tests__/promote-gates.test.mjs"];

function verdictFor(mutation) {
  const [, verdict] = sweep([[FILE, [[...mutation, NODE_TEST, SUITES]]]])[0];
  return verdict;
}

test("a needle that does not exist is reported, never counted", () => {
  assert.equal(verdictFor(["absent", "this string does not exist anywhere", "x"]), "ANCHOR-MISSING");
});

test("a newline-anchored needle is reported: these files are CRLF", () => {
  // The exact trap that produced false results here. `const MODES = [` IS in the
  // file, but not followed by a bare "\n", so the replace silently does nothing.
  assert.equal(verdictFor(["crlf trap", "const MODES = [\n", "x"]), "ANCHOR-MISSING");
});

test("a mutation that changes no bytes is reported, never counted as caught", () => {
  assert.equal(verdictFor(["no-op", "const MODES =", "const MODES ="]), "NO-OP");
});

test("a mutation that breaks the parse is CRASH, never caught", () => {
  // `node --test` reports a module that fails to load as `ℹ fail 1`, which is
  // indistinguishable from a pinned guard by exit code alone. Scoring this as
  // `caught` would silently inflate every count.
  assert.equal(verdictFor(["syntax error", "const MODES = [", "const MODES = [[["]), "CRASH");
});

test("breaking a real guard is caught", () => {
  // The positive control: without this, all four assertions above would still pass
  // if the harness simply never reported `caught` at all.
  assert.equal(verdictFor(["real guard", 'if (!SHA256.test(raw.manifest_digest ?? "")) return null;', ""]), "caught");
});

test("an error name inside a genuinely failing test is not mistaken for a crash", () => {
  // Renaming this export makes tests throw ReferenceError while the module still
  // parses and 64 tests still pass. That is a REAL caught failure. Matching the error
  // name alone scored it as CRASH and silently dropped a guard from the count, so the
  // discriminator is whether anything ran at all, not which error appeared.
  assert.equal(
    verdictFor(["renamed export", "export async function readLatestSnapshot(evidencePath) {", "export async function UNUSED_readLatestSnapshot(evidencePath) {"]),
    "caught",
  );
});

test("the target file is restored byte-for-byte after a sweep", async () => {
  const { readFile } = await import("node:fs/promises");
  const before = await readFile(FILE, "utf8");
  verdictFor(["real guard", 'if (!SHA256.test(raw.manifest_digest ?? "")) return null;', ""]);
  assert.equal(await readFile(FILE, "utf8"), before, "a sweep must never leave a guard stubbed out");
});
