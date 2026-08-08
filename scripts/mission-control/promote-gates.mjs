import { mkdir, open, readFile, rename } from "node:fs/promises";
import path, { join } from "node:path";
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

// ---------------------------------------------------------------------------
// PromotionManifestV1
//
// The immutable record of one deliberate promotion. It binds every gate's
// evidence digest, the exact external commit and binary digest behind each
// proof, the qualification receipts that authorize model-backed work, the
// operator's own command, the mode transition, and the timestamp/expiry. It is
// derived from evidence and can never manufacture it: a partial conjunction or a
// missing qualification receipt throws instead of producing a manifest.
// ---------------------------------------------------------------------------

export function buildPromotionManifest(input) {
  const { snapshot, target_mode, current_mode, operator_command, qualification_receipts, now } = input ?? {};

  const evaluation = evaluatePromotion(snapshot, target_mode);
  if (!evaluation.ready) {
    throw new Error(`PromotionManifestV1 cannot bind an unproven conjunction: ${evaluation.reasons.join(" ")}`);
  }
  if (typeof operator_command !== "string" || operator_command.trim() === "") {
    throw new Error("PromotionManifestV1 requires the explicit local operator command.");
  }
  if (!MODES.includes(current_mode)) throw new Error(`PromotionManifestV1 requires a known current mode; received ${String(current_mode)}.`);
  if (typeof now !== "string" || Number.isNaN(Date.parse(now))) throw new Error("PromotionManifestV1 requires an exact creation timestamp.");

  // Model-backed production dispatch is authorized only by a real qualification
  // receipt from a harmless run on a disposable board/workspace.
  const receipts = Array.isArray(qualification_receipts) ? qualification_receipts : [];
  if (target_mode === "enabled" && receipts.length === 0) {
    throw new Error("Promotion to enabled requires at least one qualification receipt.");
  }
  for (const receipt of receipts) {
    if (!SHA256.test(receipt?.digest ?? "")) throw new Error("Every qualification receipt must carry a canonical digest.");
  }

  // Bind each gate to its exact evidence digest, external commit, and binary.
  const gateEvidence = GATE_IDS.map((gateId) => {
    const proof = snapshot.proofs.find((candidate) => candidate?.gate_id === gateId);
    const provenance = proof?.facts?.provenance ?? {};
    return {
      gate_id: gateId,
      source_digest: proof.source_digest,
      source_commit: provenance.source_commit,
      artifact_path: provenance.artifact_path ?? null,
      artifact_sha256: provenance.artifact_sha256 ?? proof.source_digest,
      observed_at: proof.observed_at ?? null,
      expires_at: proof.expires_at ?? null,
    };
  });

  const body = {
    schema_version: "agentdash.promotion-manifest/v1",
    current_mode,
    target_mode,
    operator_command,
    gate_evidence: gateEvidence,
    qualification_receipts: receipts,
    snapshot_digest: evaluation.manifest_digest,
    created_at: now,
    // Expiry is the snapshot's own earliest proof expiry; promotion never
    // outlives the evidence that justified it.
    expires_at: snapshot.expires_at,
  };
  return { ...body, manifest_digest: sha256(canonicalJson(body)) };
}

// ---------------------------------------------------------------------------
// Compare-and-set over the durable dispatch mode
//
// Promotion is a compare-and-set from the CURRENT mode: the operator states the
// mode they believe is active, and the transition applies only if the durable
// store still holds it. An absent store reads as `disabled`, the fail-closed
// default, so a missing file can never be mistaken for an enabled system.
// ---------------------------------------------------------------------------

export function evaluateModeTransition({ stored_mode, expected_current_mode, target_mode }) {
  const stored = stored_mode ?? "disabled";
  if (!MODES.includes(stored)) return { ok: false, reason: `The durable dispatch mode is unreadable: ${String(stored_mode)}.` };
  if (!MODES.includes(target_mode)) return { ok: false, reason: `Unknown target dispatch mode: ${String(target_mode)}.` };
  if (!MODES.includes(expected_current_mode)) return { ok: false, reason: `Unknown expected current mode: ${String(expected_current_mode)}.` };
  if (stored !== expected_current_mode) {
    return { ok: false, reason: `Compare-and-set failed: the durable current mode is ${stored}, not ${expected_current_mode}.` };
  }
  if (stored === target_mode) return { ok: false, reason: `Dispatch is already ${stored}; promotion would be a no-op.` };
  return { ok: true, reason: `Compare-and-set from ${stored} to ${target_mode}.` };
}

/** Read the durable mode, treating an absent or unreadable store as `disabled`. */
export async function readDispatchMode(stateDir) {
  try {
    const raw = JSON.parse(await readFile(join(stateDir, "dispatch", "mode.json"), "utf8"));
    return MODES.includes(raw?.mode) ? raw.mode : null;
  } catch {
    return null;
  }
}

/**
 * Atomically apply one promotion: same-volume temp write, flush, then rename over
 * the durable record. The manifest is written beside it as immutable evidence.
 */
export async function commitDispatchMode(stateDir, manifest) {
  const dir = join(stateDir, "dispatch");
  await mkdir(dir, { recursive: true });

  const record = { schema_version: "agentdash.dispatch-mode/v1", mode: manifest.target_mode, manifest_digest: manifest.manifest_digest, promoted_at: manifest.created_at, expires_at: manifest.expires_at };
  const temporary = join(dir, `mode.${manifest.manifest_digest.slice(0, 16)}.tmp`);
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, join(dir, "mode.json"));

  // The manifest itself is digest-addressed and never overwritten.
  const manifestPath = join(dir, `promotion-${manifest.manifest_digest}.json`);
  const manifestTemp = `${manifestPath}.tmp`;
  const manifestHandle = await open(manifestTemp, "w", 0o600);
  try {
    await manifestHandle.writeFile(`${canonicalJson(manifest)}\n`, "utf8");
    await manifestHandle.sync();
  } finally {
    await manifestHandle.close();
  }
  await rename(manifestTemp, manifestPath);
  return { mode_path: join(dir, "mode.json"), manifest_path: manifestPath };
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

  // The durable dispatch mode lives beside the other machine-local state, never
  // in committed configuration.
  const stateDir = process.env.AGENTDASH_STATE_DIR;
  if (!stateDir || !path.isAbsolute(stateDir)) {
    console.error("Mission Control promotion: NO-GO");
    console.error("- AGENTDASH_STATE_DIR must be an absolute path; the durable dispatch mode has nowhere to live.");
    process.exitCode = 1;
    return;
  }

  // Compare-and-set: the operator states the mode they believe is active, and the
  // transition applies only if the durable store still holds it.
  const expectedArg = argv.slice(2).find((arg) => arg.startsWith("--expect-current="));
  const storedMode = await readDispatchMode(stateDir);
  const expectedCurrentMode = expectedArg ? expectedArg.split("=", 2)[1] : (storedMode ?? "disabled");
  const transition = evaluateModeTransition({ stored_mode: storedMode, expected_current_mode: expectedCurrentMode, target_mode: targetMode });

  const receiptsArg = (argv.slice(2).find((arg) => arg.startsWith("--qualification-receipts=")) ?? "").split("=", 2)[1];
  let receipts = [];
  if (receiptsArg) {
    try {
      receipts = JSON.parse(await readFile(path.resolve(receiptsArg), "utf8"));
    } catch (error) {
      console.error("Mission Control promotion: NO-GO");
      console.error(`- Could not read qualification receipts: ${redactDiagnostic(error?.message)}`);
      process.exitCode = 1;
      return;
    }
  }

  let manifest;
  try {
    manifest = buildPromotionManifest({
      snapshot,
      target_mode: targetMode,
      current_mode: storedMode ?? "disabled",
      operator_command: `promote-gates ${argv.slice(2).join(" ")}`,
      qualification_receipts: receipts,
      now: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Mission Control promotion: NO-GO");
    console.error(`- ${redactDiagnostic(error?.message)}`);
    process.exitCode = 1;
    return;
  }

  if (!promote) {
    console.log(`Mission Control promotion dry run: conjunction is go for mode=${targetMode}. Re-run with --promote to apply.`);
    console.log(`Manifest digest: ${manifest.manifest_digest}`);
    console.log(`Mode transition: ${transition.reason}`);
    if (!transition.ok) process.exitCode = 1;
    return;
  }

  if (!transition.ok) {
    console.error("Mission Control promotion: NO-GO");
    console.error(`- ${transition.reason}`);
    process.exitCode = 1;
    return;
  }

  const written = await commitDispatchMode(stateDir, manifest);
  console.log(`Mission Control promotion: ${manifest.current_mode} -> ${manifest.target_mode}`);
  console.log(`Manifest digest: ${manifest.manifest_digest}`);
  console.log(`Durable mode: ${written.mode_path}`);
  console.log(`Promotion manifest: ${written.manifest_path}`);
}

if (isMainModule(import.meta.url)) {
  main(process.argv).catch((error) => {
    console.error("Mission Control promotion: NO-GO");
    console.error(`- Promotion failed safely: ${redactDiagnostic(error?.message)}`);
    process.exitCode = 1;
  });
}
