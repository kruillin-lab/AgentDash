import { makeProbeResult, sourceCommit } from "./probe-utils.mjs";

export async function probePmProfile({ env = process.env, cwd = process.cwd(), now } = {}) {
  return makeProbeResult({
    gateId: "pm_isolation",
    facts: {
      binary_path: env.HERMES_PM_PROFILE_PATH ?? null,
      binary_sha256: null,
      version: null,
      source_commit: await sourceCommit(cwd),
      listener_address: null,
      feature_facts: { live_inventory: false, zero_worker_capability: false, side_effect_probe_run: false },
    },
    reasons: [
      "PM isolation has no live inventory proof.",
      "No side-effect probe was run because this baseline is read-only.",
      "Only typed fixture proposals are safe until PM isolation is proven.",
    ],
    now,
  });
}

if (import.meta.main) console.log(JSON.stringify(await probePmProfile(), null, 2));
