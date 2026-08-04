import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  computeProofSourceDigest,
  containsUnredactedSecret,
  isMainModule,
  redactDiagnostic,
  sanitizeEvidence,
  sha256,
} from "./probe-utils.mjs";
import { probeAgentDash } from "./probe-agentdash.mjs";
import { probeCodeG } from "./probe-codeg.mjs";
import { probeHermes } from "./probe-hermes.mjs";
import { probePmProfile } from "./probe-pm-profile.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CONFIG_PATH = path.join(ROOT, "config", "mission-control-gates.json");
const SHA256 = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const SIGNING_REASON = "No reviewed signing authority is configured; unsigned evidence cannot be promoted or authorize dispatch.";

const gateConfig = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
export const GATE_DEFINITIONS = Object.freeze(gateConfig.gates);
export const GATE_IDS = Object.freeze(GATE_DEFINITIONS.map((gate) => gate.id));

function strictTimestamp(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  try {
    return new Date(parsed).toISOString() === value ? parsed : null;
  } catch {
    return null;
  }
}

function getFact(facts, factPath) {
  return factPath.split(".").reduce((value, key) => value?.[key], facts);
}

function valuesEqual(actual, expected) {
  if (process.platform === "win32" && typeof actual === "string" && typeof expected === "string" && /^[a-z]:\\/i.test(actual)) {
    return actual.toLowerCase() === expected.toLowerCase();
  }
  return Object.is(actual, expected);
}

function semanticProblems(gate, facts) {
  const problems = [];
  for (const requirement of gate.required_facts) {
    const actual = getFact(facts, requirement.path);
    let valid = false;
    if (Object.hasOwn(requirement, "equals")) valid = valuesEqual(actual, requirement.equals);
    if (requirement.equals_fact) valid = valuesEqual(actual, getFact(facts, requirement.equals_fact));
    if (requirement.type === "positive_integer") valid = Number.isSafeInteger(actual) && actual > 0;
    if (!valid) problems.push(`${gate.id}: required fact ${requirement.path} does not satisfy PASS criteria; ${gate.no_go_behavior}`);
  }
  return problems;
}

function provenanceProblems(gateId, facts, expectedProvenanceByGate) {
  const expected = expectedProvenanceByGate?.[gateId];
  const actual = facts?.provenance;
  if (!expected || typeof expected !== "object") return [`Trusted provenance is missing for ${gateId}.`];
  const required = ["artifact_path", "artifact_sha256", "source_commit"];
  if (required.some((field) => typeof expected[field] !== "string" || expected[field].length === 0)) {
    return [`Trusted provenance is incomplete for ${gateId}.`];
  }
  if (!actual || typeof actual !== "object") return [`Trusted provenance mismatch for ${gateId}: proof provenance is missing.`];
  const problems = [];
  for (const field of required) {
    if (!valuesEqual(actual[field], expected[field])) problems.push(`Trusted provenance mismatch for ${gateId}: ${field}.`);
  }
  if (!SHA256.test(actual.artifact_sha256 ?? "")) problems.push(`Trusted provenance mismatch for ${gateId}: artifact_sha256 is malformed.`);
  if (!COMMIT.test(actual.source_commit ?? "")) problems.push(`Trusted provenance mismatch for ${gateId}: source_commit is unknown.`);
  return problems;
}

function analyzeProof(rawProof, nowMs, expectedProvenanceByGate) {
  const gateId = typeof rawProof?.gate_id === "string" && GATE_IDS.includes(rawProof.gate_id) ? rawProof.gate_id : null;
  const problems = [];
  let fatal = false;
  if (!rawProof || typeof rawProof !== "object" || Array.isArray(rawProof)) {
    return { gateId: null, proof: null, problems: ["Malformed ProbeResultV1 evidence."], fatal: true };
  }
  const sanitizedResult = sanitizeEvidence(rawProof);
  if (containsUnredactedSecret(rawProof) || sanitizedResult.redacted) {
    problems.push(`Unsafe secret or credential evidence was rejected for ${gateId ?? "unknown gate"}.`);
    fatal = true;
  }
  if (rawProof.facts?.redacted_evidence === true) {
    problems.push(`Unsafe evidence was redacted and rejected for ${gateId ?? "unknown gate"}.`);
    fatal = true;
  }
  if (!gateId) {
    problems.push("Malformed gate identifier.");
    fatal = true;
  }
  if (!["pass", "no_go"].includes(rawProof.status)) {
    problems.push(`Malformed status for ${gateId ?? "unknown gate"}.`);
    fatal = true;
  }
  if (!rawProof.facts || typeof rawProof.facts !== "object" || Array.isArray(rawProof.facts)) {
    problems.push(`Malformed facts for ${gateId ?? "unknown gate"}.`);
    fatal = true;
  }
  if (!Array.isArray(rawProof.reasons) || rawProof.reasons.some((reason) => typeof reason !== "string")) {
    problems.push(`Malformed reasons for ${gateId ?? "unknown gate"}.`);
    fatal = true;
  }
  if (!SHA256.test(rawProof.source_digest ?? "")) {
    problems.push(`Malformed source digest for ${gateId ?? "unknown gate"}.`);
    fatal = true;
  } else if (computeProofSourceDigest(rawProof) !== rawProof.source_digest) {
    problems.push(`Source digest mismatch for ${gateId ?? "unknown gate"}.`);
    fatal = true;
  }

  const observedAt = strictTimestamp(rawProof.observed_at);
  const expiresAt = strictTimestamp(rawProof.expires_at);
  if (observedAt === null || expiresAt === null) {
    problems.push(`Canonical timestamp validation failed for ${gateId ?? "unknown gate"}.`);
  } else {
    const ttlMs = gateConfig.evidence_ttl_seconds * 1000;
    const maxAgeMs = gateConfig.evidence_max_age_seconds * 1000;
    const maxFutureMs = gateConfig.max_future_skew_seconds * 1000;
    if (expiresAt <= observedAt) problems.push(`Expiry must follow observation for ${gateId}.`);
    if (expiresAt <= nowMs) problems.push(`Stale or expired evidence for ${gateId}.`);
    if (observedAt > nowMs + maxFutureMs) problems.push(`Future observation exceeds allowed skew for ${gateId}.`);
    if (nowMs - observedAt > maxAgeMs) problems.push(`Evidence exceeds maximum age for ${gateId}.`);
    if (expiresAt - observedAt > ttlMs) problems.push(`Evidence TTL exceeds ${gateConfig.evidence_ttl_seconds} seconds for ${gateId}.`);
  }

  if (gateId && rawProof.facts && typeof rawProof.facts === "object" && !Array.isArray(rawProof.facts)) {
    const gate = GATE_DEFINITIONS.find((entry) => entry.id === gateId);
    problems.push(...provenanceProblems(gateId, rawProof.facts, expectedProvenanceByGate));
    problems.push(...semanticProblems(gate, rawProof.facts));
  }
  if (rawProof.status === "no_go") {
    if (Array.isArray(rawProof.reasons) && rawProof.reasons.length > 0) {
      problems.push(...rawProof.reasons.map((reason) => `${gateId ?? "unknown gate"}: ${reason}`));
    } else {
      problems.push(`NO-GO proof for ${gateId ?? "unknown gate"} has no reason.`);
    }
  }

  return { gateId, proof: fatal ? null : sanitizedResult.value, problems, fatal };
}

export function buildUnsignedGateSnapshot(proofs, {
  now = new Date().toISOString(),
  expectedProvenanceByGate = {},
} = {}) {
  const nowMs = strictTimestamp(typeof now === "string" ? now : new Date(now).toISOString());
  if (nowMs === null) throw new TypeError("now must be a canonical millisecond UTC ISO timestamp");
  const observedAt = typeof now === "string" ? now : new Date(now).toISOString();
  const reasons = [SIGNING_REASON];
  const evidence = Array.isArray(proofs) ? proofs : [];
  if (!Array.isArray(proofs)) reasons.push("Malformed collection of ProbeResultV1 evidence.");

  const analyses = evidence.map((proof) => analyzeProof(proof, nowMs, expectedProvenanceByGate));
  for (const analysis of analyses) reasons.push(...analysis.problems);
  const counts = new Map();
  for (const analysis of analyses) {
    if (analysis.gateId) counts.set(analysis.gateId, (counts.get(analysis.gateId) ?? 0) + 1);
  }
  for (const [gateId, count] of counts) {
    if (count > 1) reasons.push(`Duplicate evidence for ${gateId}; every duplicate was validated and dispatch is denied.`);
  }

  const acceptedByGate = new Map();
  for (const analysis of analyses) {
    if (analysis.gateId && analysis.proof && !acceptedByGate.has(analysis.gateId)) acceptedByGate.set(analysis.gateId, analysis.proof);
  }
  for (const gateId of GATE_IDS) {
    if (!acceptedByGate.has(gateId)) reasons.push(`Missing capability proof for ${gateId}.`);
  }
  const acceptedProofs = GATE_IDS.map((gateId) => acceptedByGate.get(gateId)).filter(Boolean);
  const expiries = acceptedProofs.map((proof) => strictTimestamp(proof.expires_at)).filter((value) => value !== null);
  const expiresAt = expiries.length > 0 ? new Date(Math.min(...expiries)).toISOString() : observedAt;
  return {
    schema_version: "unsigned_gate_snapshot_v1",
    observed_at: observedAt,
    expires_at: expiresAt,
    proofs: acceptedProofs,
    dispatch: { status: "no_go", reasons: [...new Set(reasons)] },
    consumer_acceptance: {
      health: "rejected",
      promotion: "rejected",
      reason: "Only a future reviewed GateManifestV1 may be consumed by health or promotion.",
    },
  };
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(parent, child) {
  const relative = path.relative(comparablePath(parent), comparablePath(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function rejectReparsePoint(target, label) {
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error(`${label} is a symlink, junction, or reparse point.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function prepareEvidenceLocation(stateDirectory, repoRoot) {
  const configuredState = path.resolve(stateDirectory);
  const canonicalRepo = await realpath(path.resolve(repoRoot));
  if (isWithin(canonicalRepo, configuredState)) throw new Error("AGENTDASH_STATE_DIR cannot be inside the repository.");
  await rejectReparsePoint(configuredState, "AGENTDASH_STATE_DIR");
  await mkdir(configuredState, { recursive: true });
  const canonicalState = await realpath(configuredState);
  if (isWithin(canonicalRepo, canonicalState)) throw new Error("Canonical AGENTDASH_STATE_DIR cannot be inside the repository.");

  const evidencePath = path.join(canonicalState, "evidence");
  await rejectReparsePoint(evidencePath, "Evidence directory");
  await mkdir(evidencePath, { recursive: true });
  await rejectReparsePoint(evidencePath, "Evidence directory");
  const canonicalEvidence = await realpath(evidencePath);
  if (!isWithin(canonicalState, canonicalEvidence)) throw new Error("Evidence reparse path escapes canonical state containment.");
  return { configuredState, canonicalState, canonicalEvidence, canonicalRepo };
}

async function recheckEvidenceLocation(location) {
  await rejectReparsePoint(location.configuredState, "AGENTDASH_STATE_DIR");
  await rejectReparsePoint(location.canonicalEvidence, "Evidence directory");
  const [stateNow, evidenceNow] = await Promise.all([realpath(location.configuredState), realpath(location.canonicalEvidence)]);
  if (comparablePath(stateNow) !== comparablePath(location.canonicalState)) throw new Error("Canonical state root changed before evidence write.");
  if (comparablePath(evidenceNow) !== comparablePath(location.canonicalEvidence)) throw new Error("Canonical evidence directory changed before evidence write.");
  if (!isWithin(stateNow, evidenceNow)) throw new Error("Evidence directory escaped canonical state containment before write.");
  if (isWithin(location.canonicalRepo, stateNow)) throw new Error("Canonical state root moved inside the repository before write.");
}

async function validateOpenEvidenceFile(handle, destination, location) {
  const linkStats = await lstat(destination);
  if (linkStats.isSymbolicLink()) throw new Error("Evidence destination is a symlink or reparse point.");
  const [handleStats, canonicalDestination] = await Promise.all([handle.stat(), realpath(destination)]);
  if (!handleStats.isFile()) throw new Error("Evidence destination is not a regular file.");
  if (comparablePath(path.dirname(canonicalDestination)) !== comparablePath(location.canonicalEvidence)) {
    throw new Error("Evidence destination escaped canonical directory containment.");
  }
  const pathStats = await stat(canonicalDestination);
  if (handleStats.dev !== pathStats.dev || handleStats.ino !== pathStats.ino) {
    throw new Error("Evidence destination identity changed after open.");
  }
  await recheckEvidenceLocation(location);
}

export async function writeUnsignedGateSnapshot(snapshot, stateDirectory, { repoRoot = ROOT } = {}) {
  const location = await prepareEvidenceLocation(stateDirectory, repoRoot);
  const encoded = `${canonicalJson(snapshot)}\n`;
  const destination = path.join(location.canonicalEvidence, `unsigned-gate-snapshot-${sha256(encoded)}.json`);
  await recheckEvidenceLocation(location);
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await open(destination, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | noFollow, 0o600);
    await validateOpenEvidenceFile(handle, destination, location);
    await handle.writeFile(encoded, { encoding: "utf8" });
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    await rejectReparsePoint(destination, "Evidence destination");
    handle = await open(destination, fsConstants.O_RDONLY | noFollow);
    await validateOpenEvidenceFile(handle, destination, location);
    const existing = await handle.readFile({ encoding: "utf8" });
    if (existing !== encoded) throw new Error("Digest-addressed evidence collision contained different bytes.");
  } finally {
    await handle?.close();
  }
  // Node has no portable openat-style directory handle on Windows. Static and ordinary
  // reparse escapes are closed here; concurrent local junction swaps are outside the
  // single-operator Task 1 threat model and require native handle-relative APIs.
  return destination;
}

function trustedProvenanceFromEnv(env, cwd) {
  const hermesPath = path.resolve(env.HERMES_BINARY_PATH ?? "C:\\Users\\kruil\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\hermes.exe");
  const codegPath = path.resolve(env.CODEG_BINARY_PATH ?? "C:\\Users\\kruil\\AppData\\Local\\codeg\\codeg.exe");
  const profilePath = env.HERMES_PM_PROFILE_PATH ? path.resolve(env.HERMES_PM_PROFILE_PATH) : "";
  return {
    agentdash_local_authority: {
      artifact_path: path.resolve(cwd, "package.json"),
      artifact_sha256: env.AGENTDASH_EXPECTED_PACKAGE_SHA256 ?? "",
      source_commit: env.AGENTDASH_EXPECTED_SOURCE_COMMIT ?? "",
    },
    hermes_atomicity: {
      artifact_path: hermesPath,
      artifact_sha256: env.HERMES_EXPECTED_BINARY_SHA256 ?? "",
      source_commit: env.HERMES_EXPECTED_SOURCE_COMMIT ?? "",
    },
    codeg_replay_safety: {
      artifact_path: codegPath,
      artifact_sha256: env.CODEG_EXPECTED_BINARY_SHA256 ?? "",
      source_commit: env.CODEG_EXPECTED_SOURCE_COMMIT ?? "",
    },
    pm_isolation: {
      artifact_path: profilePath,
      artifact_sha256: env.HERMES_PM_EXPECTED_PROFILE_SHA256 ?? "",
      source_commit: env.HERMES_PM_EXPECTED_SOURCE_COMMIT ?? "",
    },
  };
}

export async function runProbe({ env = process.env, cwd = process.cwd(), now } = {}) {
  const observedAt = now === undefined ? new Date().toISOString() : new Date(now).toISOString();
  const probes = await Promise.all([
    probeAgentDash({ env, cwd, now: observedAt }),
    probeHermes({ env, now: observedAt }),
    probeCodeG({ env, now: observedAt }),
    probePmProfile({ env, now: observedAt }),
  ]);
  const snapshot = buildUnsignedGateSnapshot(probes, {
    now: observedAt,
    expectedProvenanceByGate: trustedProvenanceFromEnv(env, cwd),
  });
  if (!env.AGENTDASH_STATE_DIR) {
    return { snapshot, evidencePath: null, error: "AGENTDASH_STATE_DIR is required; no evidence was written." };
  }
  const evidencePath = await writeUnsignedGateSnapshot(snapshot, env.AGENTDASH_STATE_DIR, { repoRoot: cwd });
  return { snapshot, evidencePath, error: null };
}

async function main() {
  try {
    const { snapshot, evidencePath, error } = await runProbe();
    console.error("Mission Control capability gates: NO-GO");
    for (const reason of snapshot.dispatch.reasons) console.error(`- ${reason}`);
    if (evidencePath) console.error(`Evidence: ${evidencePath}`);
    if (error) console.error(`- ${error}`);
  } catch (error) {
    console.error("Mission Control capability gates: NO-GO");
    console.error(`- Probe failed safely: ${redactDiagnostic(error?.message)}`);
  }
  process.exitCode = 1;
}

if (isMainModule(import.meta.url)) await main();
