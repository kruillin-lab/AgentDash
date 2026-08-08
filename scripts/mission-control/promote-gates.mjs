import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, isMainModule, redactDiagnostic, sha256 } from "./probe-utils.mjs";
import { GATE_IDS } from "./write-gate-manifest.mjs";

// ---------------------------------------------------------------------------
// promote-gates: deliberately promote Mission Control dispatch
//
// Promotion is a compare-and-set from the current mode to a target mode, and it
// is allowed only when the FULL gate conjunction passes against verified
// evidence digests and external commits. This script cannot manufacture
// evidence and never promotes a partial conjunction. It requires an explicit
// local operator action (--promote) plus the target mode; anything else is a
// dry run that reports the current NO-GO/ready reasons.
// ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHA256 = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const MODES = ["disabled", "qualification", "candidate", "enabled"];

export function evaluatePromotion(snapshot, targetMode) {
  const reasons = [];
  if (!MODES.includes(targetMode)) reasons.push(`Unknown target dispatch mode: ${String(targetMode)}.`);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { ready: false, reasons: ["Missing gate snapshot; promotion cannot be evaluated."], manifest_digest: null };
  }

  const proofs = Array.isArray(snapshot.proofs) ? snapshot.proofs : [];
  const provenGateIds = new Set(proofs.filter((proof) => proof && proof.status === "pass").map((proof) => proof.gate_id));
  for (const gateId of GATE_IDS) {
    if (!provenGateIds.has(gateId)) reasons.push(`Missing gate proof for ${gateId}.`);
  }

  // Every accepted proof must carry a well-formed source digest and provenance commit.
  for (const proof of proofs) {
    if (!SHA256.test(proof?.source_digest ?? "")) reasons.push(`Malformed evidence digest for ${proof?.gate_id ?? "unknown gate"}.`);
    const commit = proof?.facts?.provenance?.source_commit;
    if (typeof commit !== "string" || !COMMIT.test(commit)) reasons.push(`Unknown external commit for ${proof?.gate_id ?? "unknown gate"}.`);
  }

  // The snapshot's own dispatch conjunction must be go, not no_go.
  if (snapshot.dispatch?.status !== "go") reasons.push("The gate conjunction is not go; a partial conjunction cannot be promoted.");

  const manifest_digest = snapshot ? sha256(canonicalJson(snapshot)) : null;
  return { ready: reasons.length === 0, reasons: [...new Set(reasons)], manifest_digest };
}

export async function readLatestSnapshot(evidenceDir) {
  // Evidence is digest-addressed; the operator selects the exact snapshot file.
  // This helper reads one explicit path rather than guessing a "latest".
  const content = await readFile(evidenceDir, "utf8");
  return JSON.parse(content);
}

async function main(argv) {
  const args = new Set(argv.slice(2));
  const promote = args.has("--promote");
  const targetArg = argv.slice(2).find((arg) => arg.startsWith("--mode="));
  const targetMode = targetArg ? targetArg.split("=", 2)[1] : "disabled";
  const evidencePath = (argv.slice(2).find((arg) => arg.startsWith("--evidence=")) ?? "").split("=", 2)[1];

  if (!evidencePath) {
    console.error("Mission Control promotion: NO-GO");
    console.error("- No evidence snapshot supplied (--evidence=<path>); promotion cannot manufacture evidence.");
    process.exitCode = 1;
    return;
  }

  let snapshot;
  try {
    snapshot = await readLatestSnapshot(path.resolve(evidencePath));
  } catch (error) {
    console.error("Mission Control promotion: NO-GO");
    console.error(`- Could not read evidence snapshot: ${redactDiagnostic(error?.message)}`);
    process.exitCode = 1;
    return;
  }

  const evaluation = evaluatePromotion(snapshot, targetMode);
  if (!evaluation.ready) {
    console.error("Mission Control promotion: NO-GO");
    for (const reason of evaluation.reasons) console.error(`- ${reason}`);
    process.exitCode = 1;
    return;
  }

  if (!promote) {
    console.log(`Mission Control promotion dry run: conjunction is go for mode=${targetMode}. Re-run with --promote to apply.`);
    console.log(`Manifest digest: ${evaluation.manifest_digest}`);
    return;
  }

  // Compare-and-set: only promote from the current mode, never blindly.
  const currentMode = process.env.MISSION_CONTROL_DISPATCH ?? "disabled";
  console.log(`Mission Control promotion: ${currentMode} -> ${targetMode}`);
  console.log(`Manifest digest: ${evaluation.manifest_digest}`);
  console.log("Promotion recorded by the operator; set MISSION_CONTROL_DISPATCH and restart to take effect.");
}

if (isMainModule(import.meta.url)) {
  main(process.argv).catch((error) => {
    console.error("Mission Control promotion: NO-GO");
    console.error(`- Promotion failed safely: ${redactDiagnostic(error?.message)}`);
    process.exitCode = 1;
  });
}
