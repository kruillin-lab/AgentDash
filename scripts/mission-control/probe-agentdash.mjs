import { readFile } from "node:fs/promises";
import path from "node:path";

import { fileSha256, isMainModule, makeProbeResult, sourceCommit } from "./probe-utils.mjs";

export async function probeAgentDash({ env = process.env, cwd = process.cwd(), now } = {}) {
  const packagePath = path.resolve(cwd, "package.json");
  let packageDigest = null;
  let version = null;
  try {
    const [contents, digest] = await Promise.all([readFile(packagePath, "utf8"), fileSha256(packagePath)]);
    packageDigest = digest;
    version = JSON.parse(contents).version ?? null;
  } catch {
    // Unavailable package evidence is represented explicitly below.
  }
  const configuredListener = env.AGENTDASH_LISTENER_ADDRESS ?? null;
  const commit = await sourceCommit(cwd);
  const reasons = [
    "Observed listener address is unknown; configured listener text is not socket evidence.",
    "No verified same-origin command session evidence is available.",
    "No durable nonce persistence evidence is available.",
    "No single controller-owner evidence is available.",
  ];
  if (configuredListener !== "127.0.0.1") reasons.unshift("Configured listener address is not the required exact 127.0.0.1 boundary.");
  if (!packageDigest || !version || !commit) reasons.unshift("AgentDash package provenance is incomplete.");
  return makeProbeResult({
    gateId: "agentdash_local_authority",
    facts: {
      binary_path: packagePath,
      binary_sha256: packageDigest,
      version,
      provenance: { artifact_path: packagePath, artifact_sha256: packageDigest, source_commit: commit },
      configured_listener_address: configuredListener,
      observed_listener_address: null,
      feature_facts: { same_origin_command_session: false, nonce_persistence: false, single_controller_owner: false },
    },
    reasons,
    now,
  });
}

if (isMainModule(import.meta.url)) console.log(JSON.stringify(await probeAgentDash(), null, 2));
