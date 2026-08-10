import path from "node:path";

import { fileSha256, isMainModule, makeProbeResult, sourceCommit } from "./probe-utils.mjs";

const DEFAULT_HERMES_ROOT = "C:\\Users\\kruil\\AppData\\Local\\hermes\\hermes-agent";

export async function probePmProfile({ env = process.env, installRoot = DEFAULT_HERMES_ROOT, now } = {}) {
  const profilePath = env.HERMES_PM_PROFILE_PATH ? path.resolve(env.HERMES_PM_PROFILE_PATH) : null;
  let profileDigest = null;
  if (profilePath) {
    try {
      profileDigest = await fileSha256(profilePath);
    } catch {
      // Missing profile evidence is represented by a null digest and NO-GO.
    }
  }
  const commit = await sourceCommit(installRoot);
  return makeProbeResult({
    gateId: "pm_isolation",
    facts: {
      binary_path: profilePath,
      binary_sha256: profileDigest,
      version: null,
      provenance: { artifact_path: profilePath, artifact_sha256: profileDigest, source_commit: commit },
      configured_listener_address: null,
      observed_listener_address: null,
      feature_facts: { live_inventory: false, side_effect_probe_completed: false, zero_worker_capability: false },
    },
    reasons: [
      "PM isolation has no live inventory proof.",
      "No side-effect probe was run because this baseline is read-only.",
      "Only typed fixture proposals are safe until PM isolation is proven.",
    ],
    now,
  });
}

if (isMainModule(import.meta.url)) console.log(JSON.stringify(await probePmProfile(), null, 2));
