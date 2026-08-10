import { isMainModule, redactDiagnostic } from "./probe-utils.mjs";
import { runProbe } from "./write-gate-manifest.mjs";

// ---------------------------------------------------------------------------
// refresh-gates: re-run every capability proof against the exact committed
// candidates and write a fresh unsigned gate snapshot. This refreshes evidence
// only; it never promotes dispatch (that is promote-gates.mjs, which requires
// the full conjunction plus an explicit operator action).
// ---------------------------------------------------------------------------

async function main() {
  try {
    const { snapshot, evidencePath, error } = await runProbe();
    const status = snapshot.dispatch.status === "go" ? "GO" : "NO-GO";
    console.error(`Mission Control gate refresh: ${status}`);
    for (const reason of snapshot.dispatch.reasons) console.error(`- ${reason}`);
    if (evidencePath) console.error(`Evidence: ${evidencePath}`);
    if (error) console.error(`- ${error}`);
    if (status !== "go") process.exitCode = 1;
  } catch (error) {
    console.error("Mission Control gate refresh: NO-GO");
    console.error(`- Refresh failed safely: ${redactDiagnostic(error?.message)}`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
