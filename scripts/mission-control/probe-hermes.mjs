import { makeProbeResult, snapshotBinary, sourceCommit } from "./probe-utils.mjs";

const DEFAULT_HERMES_BINARY = "C:\\Users\\kruil\\AppData\\Local\\hermes\\hermes-agent\\hermes.exe";

export async function probeHermes({ env = process.env, cwd = process.cwd(), now } = {}) {
  const binary = await snapshotBinary(env.HERMES_BINARY_PATH ?? DEFAULT_HERMES_BINARY);
  return makeProbeResult({
    gateId: "hermes_atomicity",
    facts: {
      binary_path: binary.path,
      binary_sha256: binary.sha256,
      version: binary.version,
      source_commit: await sourceCommit(cwd),
      listener_address: null,
      feature_facts: { lifetime_task_identity: false, digest_artifacts: false, action_command_run_cas: false, terminal_event_support: false },
      diagnostic: binary.diagnostic,
    },
    reasons: [
      binary.exists ? "Hermes atomic lifecycle capabilities are not independently proven." : "Hermes binary is unavailable.",
      "Lifetime task identity, digest artifacts, CAS, and terminal-event support require proof.",
    ],
    now,
  });
}

if (import.meta.main) console.log(JSON.stringify(await probeHermes(), null, 2));
