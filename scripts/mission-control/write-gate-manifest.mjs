import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, containsUnredactedSecret, sha256 } from "./probe-utils.mjs";
import { probeAgentDash } from "./probe-agentdash.mjs";
import { probeHermes } from "./probe-hermes.mjs";
import { probeCodeG } from "./probe-codeg.mjs";
import { probePmProfile } from "./probe-pm-profile.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CONFIG_PATH = path.join(ROOT, "config", "mission-control-gates.json");
const SHA256 = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;

const gateConfig = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
export const GATE_IDS = Object.freeze(gateConfig.gates.map((gate) => gate.id));

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function resultProblems(result, now) {
  const problems = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) return ["malformed ProbeResultV1 evidence"];
  if (typeof result.gate_id !== "string" || !GATE_IDS.includes(result.gate_id)) problems.push("malformed gate identifier");
  if (!["pass", "no_go"].includes(result.status)) problems.push(`malformed status for ${result.gate_id ?? "unknown gate"}`);
  if (!result.facts || typeof result.facts !== "object" || Array.isArray(result.facts)) problems.push(`malformed facts for ${result.gate_id ?? "unknown gate"}`);
  if (!Array.isArray(result.reasons) || result.reasons.some((reason) => typeof reason !== "string")) problems.push(`malformed reasons for ${result.gate_id ?? "unknown gate"}`);
  if (!SHA256.test(result.source_digest ?? "")) problems.push(`malformed source digest for ${result.gate_id ?? "unknown gate"}`);
  const observedAt = timestamp(result.observed_at);
  const expiresAt = timestamp(result.expires_at);
  if (observedAt === null || expiresAt === null || expiresAt <= observedAt || observedAt > now) problems.push(`malformed or future timestamps for ${result.gate_id ?? "unknown gate"}`);
  if (expiresAt !== null && expiresAt <= now) problems.push(`stale evidence for ${result.gate_id ?? "unknown gate"}`);
  if (result.facts && typeof result.facts === "object" && !Array.isArray(result.facts)) {
    if (!COMMIT.test(result.facts.source_commit ?? "")) problems.push(`missing or unknown source commit for ${result.gate_id ?? "unknown gate"}`);
    if (result.facts.current_source_commit && result.facts.current_source_commit !== result.facts.source_commit) problems.push(`stale source commit for ${result.gate_id ?? "unknown gate"}`);
    if (Object.hasOwn(result.facts, "listener_address") && result.facts.listener_address !== null && result.facts.listener_address !== "127.0.0.1") problems.push(`unsafe listener address for ${result.gate_id ?? "unknown gate"}; exact 127.0.0.1 is required`);
    if (result.gate_id === "agentdash_local_authority" && result.facts.listener_address !== "127.0.0.1") problems.push("AgentDash local authority lacks the required exact loopback listener address");
    if (containsUnredactedSecret(result.facts)) problems.push(`unredacted secret or token in ${result.gate_id ?? "unknown gate"} evidence`);
  }
  return problems;
}

function dispatchReasons(proofs, now) {
  const reasons = ["No reviewed signing authority is configured; this GateManifestV1 is unverifiable and dispatch is denied."];
  const byGate = new Map();
  for (const proof of proofs) {
    const gateId = proof?.gate_id;
    if (typeof gateId === "string" && GATE_IDS.includes(gateId)) {
      if (byGate.has(gateId)) {
        reasons.push(`duplicate evidence for ${gateId}`);
        continue;
      }
      byGate.set(gateId, proof);
    }
    const problems = resultProblems(proof, now);
    if (problems.length > 0) {
      reasons.push(...problems);
      continue;
    }
    if (proof.status !== "pass") {
      reasons.push(...proof.reasons.map((reason) => `${proof.gate_id}: ${reason}`));
    }
  }
  for (const gateId of GATE_IDS) {
    if (!byGate.has(gateId)) reasons.push(`missing capability proof for ${gateId}`);
  }
  return [...new Set(reasons)];
}

export function buildManifest(proofs, { now = new Date().toISOString() } = {}) {
  const nowMs = timestamp(now);
  if (nowMs === null) throw new TypeError("now must be an ISO-8601 timestamp");
  const evidence = Array.isArray(proofs) ? proofs : [];
  const reasons = Array.isArray(proofs) ? dispatchReasons(evidence, nowMs) : ["malformed collection of ProbeResultV1 evidence"];
  if (!Array.isArray(proofs)) reasons.unshift("No reviewed signing authority is configured; this GateManifestV1 is unverifiable and dispatch is denied.");
  const expiryCandidates = evidence.map((proof) => timestamp(proof?.expires_at)).filter((value) => value !== null);
  const expiresAt = expiryCandidates.length > 0 ? new Date(Math.min(...expiryCandidates)).toISOString() : now;
  return {
    schema_version: "gate_manifest_v1",
    observed_at: now,
    expires_at: expiresAt,
    proofs: evidence,
    dispatch: { status: "no_go", reasons },
    signature: {
      status: "unverifiable",
      reason: "No reviewed signing authority or key lifecycle is configured.",
    },
  };
}

async function writeManifest(manifest, stateDirectory) {
  const evidenceDirectory = path.join(path.resolve(stateDirectory), "evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  const encoded = `${canonicalJson(manifest)}\n`;
  const destination = path.join(evidenceDirectory, `gate-manifest-${sha256(encoded)}.json`);
  try {
    await writeFile(destination, encoded, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return destination;
}

export async function runProbe({ env = process.env, cwd = process.cwd(), now } = {}) {
  const stateDirectory = env.AGENTDASH_STATE_DIR;
  if (!stateDirectory) {
    return { manifest: buildManifest([], { now }), evidencePath: null, error: "AGENTDASH_STATE_DIR is required; no evidence was written." };
  }
  const probes = await Promise.all([
    probeAgentDash({ env, cwd, now }),
    probeHermes({ env, cwd, now }),
    probeCodeG({ env, cwd, now }),
    probePmProfile({ env, cwd, now }),
  ]);
  const manifest = buildManifest(probes, { now });
  return { manifest, evidencePath: await writeManifest(manifest, stateDirectory), error: null };
}

if (import.meta.main) {
  const { manifest, evidencePath, error } = await runProbe();
  console.error("Mission Control capability gates: NO-GO");
  for (const reason of manifest.dispatch.reasons) console.error(`- ${reason}`);
  if (evidencePath) console.error(`Evidence: ${evidencePath}`);
  if (error) console.error(`- ${error}`);
  process.exitCode = 1;
}
