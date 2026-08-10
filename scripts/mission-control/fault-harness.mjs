import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule, redactDiagnostic } from "./probe-utils.mjs";

// ---------------------------------------------------------------------------
// fault-harness: inject response loss and process restart at every command
// boundary and prove the replay-safety invariants hold.
//
// The harness drives the focused runtime fault-injection suites (the
// action-command crash boundaries, the two-process owner proof, and the
// bounded reconciliation deadlines) and reports one truthful result. It
// requires: one lifetime task, one logical command per node visit, no duplicate
// session/effect, monotonic spend, one-time task reserves, and a truthful
// terminal projection. Any failure is a hard NO-GO.
// ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const FAULT_SUITES = [
  "src/server/mission-control/runtime/action-command.test.ts",
  "src/server/mission-control/runtime/owner-lock.test.ts",
  "src/server/mission-control/runtime/reconciler.test.ts",
  "src/server/mission-control/runtime/cancellation.test.ts",
  "src/server/mission-control/runtime/outbox.test.ts",
];

// Strip ANSI escape codes so the pass/fail summary parses cleanly.
function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

export function runFaultHarness({ cwd = ROOT } = {}) {
  const vitestEntry = path.join(cwd, "node_modules", "vitest", "vitest.mjs");
  const result = spawnSync(process.execPath, [vitestEntry, "run", "--config", "vitest.config.ts", ...FAULT_SUITES], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: stripAnsi(result.stdout ?? ""), stderr: stripAnsi(result.stderr ?? "") };
}

async function main() {
  console.error("Mission Control fault harness: injecting response loss and restart at every command boundary.");
  const result = runFaultHarness();
  const output = `${result.stdout}\n${result.stderr}`;
  const passMatch = output.match(/Tests\s+(\d+) passed/);
  const failMatch = output.match(/Tests\s+\d+ passed.*?(\d+) failed|(\d+) failed/);

  if (result.status === 0 && passMatch) {
    console.error(`Mission Control fault harness: GO — ${passMatch[1]} fault-injection proofs passed.`);
    console.error("- one lifetime task / one logical command per node visit / no duplicate session or effect / monotonic spend / one-time reserves / truthful terminal projection.");
    return;
  }

  console.error("Mission Control fault harness: NO-GO");
  const summary = output.split("\n").filter((line) => /failed|FAIL|Error/i.test(line)).slice(0, 20);
  for (const line of summary) console.error(`- ${redactDiagnostic(line.trim())}`);
  if (summary.length === 0) console.error(`- Harness exited ${result.status}; see test output above.`);
  process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error("Mission Control fault harness: NO-GO");
    console.error(`- Harness failed safely: ${redactDiagnostic(error?.message)}`);
    process.exitCode = 1;
  });
}
