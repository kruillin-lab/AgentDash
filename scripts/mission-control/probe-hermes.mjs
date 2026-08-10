import path from "node:path";
import { readFile } from "node:fs/promises";

import { isMainModule, makeProbeResult, snapshotBinary, sourceCommit } from "./probe-utils.mjs";

const DEFAULT_HERMES_ROOT = "C:\\Users\\kruil\\AppData\\Local\\hermes\\hermes-agent";
const DEFAULT_HERMES_BINARY = path.join(DEFAULT_HERMES_ROOT, "venv", "Scripts", "hermes.exe");

async function metadataVersion(installRoot) {
  try {
    const metadata = await readFile(path.join(installRoot, "pyproject.toml"), "utf8");
    return metadata.match(/^version\s*=\s*["']([^"']+)["']/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function probeHermes({ env = process.env, installRoot = DEFAULT_HERMES_ROOT, now } = {}) {
  const [binary, commit, version] = await Promise.all([
    snapshotBinary(env.HERMES_BINARY_PATH ?? DEFAULT_HERMES_BINARY),
    sourceCommit(installRoot),
    metadataVersion(installRoot),
  ]);
  const reasons = [
    binary.exists ? "Hermes atomic lifecycle capabilities are not independently proven." : "Hermes binary is unavailable.",
    "Lifetime task identity, digest artifacts, CAS, and terminal-event support require proof.",
  ];
  if (!commit) reasons.unshift("Hermes source commit provenance is unavailable.");
  if (!version) reasons.unshift("Hermes version metadata is unavailable; the untrusted binary was not executed.");
  return makeProbeResult({
    gateId: "hermes_atomicity",
    facts: {
      binary_path: binary.path,
      binary_sha256: binary.sha256,
      version,
      provenance: { artifact_path: binary.path, artifact_sha256: binary.sha256, source_commit: commit },
      configured_listener_address: null,
      observed_listener_address: null,
      feature_facts: { lifetime_task_identity: false, digest_artifacts: false, action_command_run_cas: false, terminal_event_support: false },
      diagnostic: binary.diagnostic,
    },
    reasons,
    now,
  });
}

if (isMainModule(import.meta.url)) console.log(JSON.stringify(await probeHermes(), null, 2));
