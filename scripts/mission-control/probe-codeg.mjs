import path from "node:path";

import { isMainModule, makeProbeResult, snapshotBinary, sourceCommit } from "./probe-utils.mjs";

const DEFAULT_CODEG_ROOT = "C:\\Users\\kruil\\AppData\\Local\\codeg";
const DEFAULT_CODEG_BINARY = path.join(DEFAULT_CODEG_ROOT, "codeg.exe");

export async function probeCodeG({ env = process.env, installRoot = DEFAULT_CODEG_ROOT, now } = {}) {
  const binary = await snapshotBinary(env.CODEG_BINARY_PATH ?? DEFAULT_CODEG_BINARY);
  const commit = await sourceCommit(installRoot);
  const reasons = [
    binary.exists ? "CodeG replay and runtime capabilities are not independently proven." : "CodeG binary is unavailable.",
    "No model-backed command was created while collecting this read-only inventory.",
  ];
  if (!commit) reasons.unshift("CodeG source commit provenance is unavailable.");
  return makeProbeResult({
    gateId: "codeg_replay_safety",
    facts: {
      binary_path: binary.path,
      binary_sha256: binary.sha256,
      version: binary.version,
      provenance: { artifact_path: binary.path, artifact_sha256: binary.sha256, source_commit: commit },
      configured_listener_address: null,
      observed_listener_address: null,
      feature_facts: { unique_ensure: false, definitive_lookup: false, cursor_transcript: false, exact_identity_cancel_runtime_activity: false },
      diagnostic: binary.diagnostic,
    },
    reasons,
    now,
  });
}

if (isMainModule(import.meta.url)) console.log(JSON.stringify(await probeCodeG(), null, 2));
