import { makeProbeResult, snapshotBinary, sourceCommit } from "./probe-utils.mjs";

const DEFAULT_CODEG_BINARY = "C:\\Users\\kruil\\AppData\\Local\\codeg\\codeg.exe";

export async function probeCodeG({ env = process.env, cwd = process.cwd(), now } = {}) {
  const binary = await snapshotBinary(env.CODEG_BINARY_PATH ?? DEFAULT_CODEG_BINARY);
  return makeProbeResult({
    gateId: "codeg_replay_safety",
    facts: {
      binary_path: binary.path,
      binary_sha256: binary.sha256,
      version: binary.version,
      source_commit: await sourceCommit(cwd),
      listener_address: null,
      feature_facts: { unique_ensure: false, definitive_lookup: false, cursor_transcript: false, identity_cancel_runtime_activity: false },
      diagnostic: binary.diagnostic,
    },
    reasons: [
      binary.exists ? "CodeG replay and runtime capabilities are not independently proven." : "CodeG binary is unavailable.",
      "No model-backed command was created while collecting this read-only inventory.",
    ],
    now,
  });
}

if (import.meta.main) console.log(JSON.stringify(await probeCodeG(), null, 2));
