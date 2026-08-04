import { fileSha256, makeProbeResult, sourceCommit } from "./probe-utils.mjs";

export async function probeAgentDash({ env = process.env, cwd = process.cwd(), now } = {}) {
  const packagePath = `${cwd}/package.json`;
  let packageDigest = null;
  try {
    packageDigest = await fileSha256(packagePath);
  } catch {
    // Missing source evidence is reflected in the fail-closed result below.
  }
  const listenerAddress = env.AGENTDASH_LISTENER_ADDRESS ?? null;
  const reasons = [
    "No verified same-origin command session evidence is available.",
    "No durable nonce persistence evidence is available.",
    "No single controller-owner evidence is available.",
  ];
  if (listenerAddress !== "127.0.0.1") reasons.unshift("Listener address is not the required exact 127.0.0.1 boundary.");
  if (!packageDigest) reasons.unshift("AgentDash package source digest is unavailable.");
  return makeProbeResult({
    gateId: "agentdash_local_authority",
    facts: {
      binary_path: packagePath,
      binary_sha256: packageDigest,
      version: null,
      source_commit: await sourceCommit(cwd),
      listener_address: listenerAddress,
      feature_facts: { same_origin_command_session: false, nonce_persistence: false, single_controller_owner: false },
    },
    reasons,
    now,
  });
}

if (import.meta.main) console.log(JSON.stringify(await probeAgentDash(), null, 2));
