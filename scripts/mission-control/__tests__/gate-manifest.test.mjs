import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { probeAgentDash } from "../probe-agentdash.mjs";
import { probeCodeG } from "../probe-codeg.mjs";
import { probeHermes } from "../probe-hermes.mjs";
import * as utils from "../probe-utils.mjs";
import * as gates from "../write-gate-manifest.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CLI_PATH = path.join(ROOT, "scripts", "mission-control", "write-gate-manifest.mjs");
const NOW = "2026-08-03T12:00:00.000Z";
const LATER = "2026-08-03T12:15:00.000Z";
const ARTIFACT_DIGEST = "1".repeat(64);
const SOURCE_COMMIT = "a".repeat(40);
const ARTIFACT_PATH = "C:\\trusted\\artifact.exe";
const UNSAFE_FIXTURE_VALUE = ["task1", "seeded", "regression", "value"].join("-");

const REQUIRED_FACTS = {
  agentdash_local_authority: {
    configured_listener_address: "127.0.0.1",
    observed_listener_address: "127.0.0.1",
    feature_facts: {
      same_origin_command_session: true,
      nonce_persistence: true,
      single_controller_owner: true,
    },
  },
  hermes_atomicity: {
    feature_facts: {
      lifetime_task_identity: true,
      digest_artifacts: true,
      action_command_run_cas: true,
      terminal_event_support: true,
    },
  },
  codeg_replay_safety: {
    feature_facts: {
      unique_ensure: true,
      definitive_lookup: true,
      cursor_transcript: true,
      exact_identity_cancel_runtime_activity: true,
    },
  },
  pm_isolation: {
    feature_facts: {
      live_inventory: true,
      side_effect_probe_completed: true,
      zero_worker_capability: true,
    },
  },
  workspace_containment: {
    configured_codeg_path: "C:\\trusted\\workspace",
    canonical_real_path: "C:\\trusted\\workspace",
    feature_facts: { mutation_containment_enforced: true },
  },
  route_qualification: {
    feature_facts: {
      qualification_level: 5,
      exact_route_task_class: true,
      current_evidence: true,
      no_silent_substitution: true,
    },
  },
  budget_enforcement: {
    feature_facts: {
      aggregate_worst_case_enforced: true,
      one_time_reserves_enforced: true,
      approval_dispatch_enforced: true,
    },
  },
  verification_independence: {
    feature_facts: { every_success_path_has_independent_tier_verifier: true },
  },
  finalization_exactness: {
    feature_facts: {
      mutation_bound: true,
      expected_post_state_bound: true,
      cas_safe: true,
      reconcilable: true,
    },
  },
  reconciliation: {
    feature_facts: {
      uncertain_operations_deadline_enforced: true,
      working_exit_deadline_ms: 30000,
      uncertainty_ends_inconsistent: true,
    },
  },
};

const EXPECTED_PROVENANCE = Object.fromEntries(
  Object.keys(REQUIRED_FACTS).map((gateId) => [gateId, {
    artifact_path: ARTIFACT_PATH,
    artifact_sha256: ARTIFACT_DIGEST,
    source_commit: SOURCE_COMMIT,
  }]),
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function passingProof(gateId, { facts = {}, now = NOW, ttlSeconds = 900 } = {}) {
  return utils.makeProbeResult({
    gateId,
    status: "pass",
    facts: {
      provenance: clone(EXPECTED_PROVENANCE[gateId]),
      ...clone(REQUIRED_FACTS[gateId]),
      ...facts,
    },
    reasons: [],
    now: new Date(now),
    ttlSeconds,
  });
}

function fixtureProofs() {
  return gates.GATE_IDS.map((gateId) => passingProof(gateId));
}

function buildSnapshot(proofs, options = {}) {
  const builder = gates.buildUnsignedGateSnapshot ?? gates.buildManifest;
  return builder(proofs, {
    now: NOW,
    expectedProvenanceByGate: EXPECTED_PROVENANCE,
    ...options,
  });
}

function refreshDigest(proof) {
  proof.source_digest = typeof utils.computeProofSourceDigest === "function"
    ? utils.computeProofSourceDigest(proof)
    : "d".repeat(64);
  return proof;
}

function setFact(facts, factPath, value) {
  const parts = factPath.split(".");
  const key = parts.pop();
  let cursor = facts;
  for (const part of parts) cursor = cursor[part];
  cursor[key] = value;
}

// Mutation caught: labeling an unsigned snapshot as a signed manifest.
test("unsigned evidence is explicitly an UnsignedGateSnapshotV1", () => {
  const snapshot = buildSnapshot(fixtureProofs());

  assert.equal(snapshot.schema_version, "unsigned_gate_snapshot_v1");
  assert.equal(Object.hasOwn(snapshot, "signature"), false);
  assert.equal(snapshot.dispatch.status, "no_go");
  assert.match(snapshot.dispatch.reasons[0], /signing authority/i);
});

// Mutation caught: changing the canonical proof material or digest algorithm.
test("proof source digest covers the defined canonical material", () => {
  const material = {
    gate_id: "hermes_atomicity",
    status: "no_go",
    facts: { alpha: true },
    reasons: ["unproven"],
    observed_at: NOW,
    expires_at: LATER,
  };

  assert.equal(typeof utils.computeProofSourceDigest, "function");
  const expectedDigest = ["a87b4a4f", "32e592eb", "aa048d27", "8588bfc6", "2a9cac2a", "7c439afd", "5cf76798", "67647fc6"].join("");
  assert.equal(utils.computeProofSourceDigest(material), expectedDigest);
});

// Mutation caught: accepting facts changed after the source digest was issued.
test("tampered proof material is omitted and blocks dispatch", () => {
  const proofs = fixtureProofs();
  proofs[1].facts.feature_facts.terminal_event_support = false;

  const snapshot = buildSnapshot(proofs);

  assert.match(snapshot.dispatch.reasons.join("\n"), /digest mismatch/i);
  assert.equal(snapshot.proofs.some((proof) => proof.gate_id === "hermes_atomicity"), false);
});

// Mutation caught: trusting provenance comparisons supplied entirely by the proof.
test("proof provenance must match controller-supplied expectations", () => {
  const proofs = fixtureProofs();
  proofs[1] = passingProof("hermes_atomicity", {
    facts: { provenance: { ...EXPECTED_PROVENANCE.hermes_atomicity, source_commit: "c".repeat(40) } },
  });

  const snapshot = buildSnapshot(proofs);

  assert.match(snapshot.dispatch.reasons.join("\n"), /trusted provenance.*hermes/i);
});

// Mutation caught: treating absent controller provenance as trustworthy.
test("missing trusted provenance blocks the affected gate", () => {
  const expected = { ...EXPECTED_PROVENANCE };
  delete expected.codeg_replay_safety;

  const snapshot = buildSnapshot(fixtureProofs(), { expectedProvenanceByGate: expected });

  assert.match(snapshot.dispatch.reasons.join("\n"), /trusted provenance.*codeg/i);
});

// Mutation caught: retaining a credential even after marking the proof NO-GO.
test("unsafe proof content never reaches serialized output", () => {
  const proofs = fixtureProofs();
  proofs[2] = passingProof("codeg_replay_safety", {
    facts: { diagnostic: `Authorization: Bearer ${UNSAFE_FIXTURE_VALUE}` },
  });

  const snapshot = buildSnapshot(proofs);
  const serialized = JSON.stringify(snapshot);

  assert.equal(serialized.includes(UNSAFE_FIXTURE_VALUE), false);
  assert.match(snapshot.dispatch.reasons.join("\n"), /unsafe|secret|credential/i);
  assert.equal(snapshot.proofs.some((proof) => proof.gate_id === "codeg_replay_safety"), false);
});

// Mutation caught: a redaction marker hiding a second unsafe value from validation.
test("partially redacted evidence cannot bypass unsafe-proof omission", () => {
  const proofs = fixtureProofs();
  proofs[2].facts.diagnostic = `Authorization: Bearer [REDACTED]; token=${UNSAFE_FIXTURE_VALUE}`;
  refreshDigest(proofs[2]);

  const snapshot = buildSnapshot(proofs);

  assert.equal(JSON.stringify(snapshot).includes(UNSAFE_FIXTURE_VALUE), false);
  assert.equal(snapshot.proofs.some((proof) => proof.gate_id === "codeg_replay_safety"), false);
  assert.match(snapshot.dispatch.reasons.join("\n"), /unsafe|secret|credential/i);
});

// Mutation caught: duplicate short-circuiting before validation of later evidence.
test("every duplicate is validated before duplicate handling", () => {
  const proofs = fixtureProofs();
  proofs.push(passingProof("hermes_atomicity", {
    facts: { diagnostic: `token=${UNSAFE_FIXTURE_VALUE}` },
  }));

  const snapshot = buildSnapshot(proofs);
  const serialized = JSON.stringify(snapshot);

  assert.equal(serialized.includes(UNSAFE_FIXTURE_VALUE), false);
  assert.match(snapshot.dispatch.reasons.join("\n"), /unsafe|secret|credential/i);
  assert.match(snapshot.dispatch.reasons.join("\n"), /duplicate.*hermes/i);
});

// Mutation caught: accepting Date.parse-compatible but non-canonical timestamps.
test("timestamps must be canonical millisecond UTC ISO strings", () => {
  const proofs = fixtureProofs();
  proofs[0].observed_at = "2026-08-03T12:00:00Z";
  refreshDigest(proofs[0]);

  const snapshot = buildSnapshot(proofs);

  assert.match(snapshot.dispatch.reasons.join("\n"), /canonical.*timestamp|timestamp.*canonical/i);
});

// Mutation caught: allowing proof lifetime to exceed configured TTL.
test("proof expiry cannot exceed the configured 900 second TTL", () => {
  const proofs = fixtureProofs();
  proofs[0] = passingProof("agentdash_local_authority", { ttlSeconds: 901 });

  const snapshot = buildSnapshot(proofs);

  assert.match(snapshot.dispatch.reasons.join("\n"), /ttl/i);
});

// Mutation caught: accepting evidence older than the configured maximum age.
test("old observations cannot be kept fresh by a distant expiry", () => {
  const proofs = fixtureProofs();
  proofs[0] = passingProof("agentdash_local_authority", {
    now: "2026-08-03T11:44:59.000Z",
    ttlSeconds: 1800,
  });

  const snapshot = buildSnapshot(proofs);

  assert.match(snapshot.dispatch.reasons.join("\n"), /maximum age/i);
  assert.match(snapshot.dispatch.reasons.join("\n"), /ttl/i);
});

// Mutation caught: treating a missing proof as an implicit pass.
test("missing Hermes capability proof blocks dispatch", () => {
  const proofs = fixtureProofs().filter((proof) => proof.gate_id !== "hermes_atomicity");

  const snapshot = buildSnapshot(proofs);

  assert.equal(snapshot.dispatch.status, "no_go");
  assert.match(snapshot.dispatch.reasons.join("\n"), /missing capability proof.*hermes/i);
});

// Mutation caught: retaining malformed evidence in a persisted snapshot.
test("malformed evidence is omitted and blocks dispatch", () => {
  const proofs = fixtureProofs();
  proofs[3].source_digest = "not-a-sha256";

  const snapshot = buildSnapshot(proofs);

  assert.match(snapshot.dispatch.reasons.join("\n"), /malformed.*digest/i);
  assert.equal(snapshot.proofs.some((proof) => proof.gate_id === "pm_isolation"), false);
});

const SEMANTIC_MUTATIONS = [
  ["agentdash_local_authority", "observed_listener_address", "localhost"],
  ["hermes_atomicity", "feature_facts.lifetime_task_identity", false],
  ["codeg_replay_safety", "feature_facts.definitive_lookup", false],
  ["pm_isolation", "feature_facts.zero_worker_capability", false],
  ["workspace_containment", "canonical_real_path", "C:\\other\\workspace"],
  ["route_qualification", "feature_facts.qualification_level", 4],
  ["budget_enforcement", "feature_facts.one_time_reserves_enforced", false],
  ["verification_independence", "feature_facts.every_success_path_has_independent_tier_verifier", false],
  ["finalization_exactness", "feature_facts.expected_post_state_bound", false],
  ["reconciliation", "feature_facts.working_exit_deadline_ms", 0],
];

for (const [gateId, factPath, invalidValue] of SEMANTIC_MUTATIONS) {
  // Mutation caught: trusting status:"pass" without the gate's required proof fact.
  test(`${gateId} enforces required fact ${factPath}`, () => {
    const proofs = fixtureProofs();
    const facts = clone(proofs.find((proof) => proof.gate_id === gateId).facts);
    setFact(facts, factPath, invalidValue);
    proofs[proofs.findIndex((proof) => proof.gate_id === gateId)] = passingProof(gateId, { facts });

    const snapshot = buildSnapshot(proofs);

    assert.match(snapshot.dispatch.reasons.join("\n"), new RegExp(`${gateId}.*${factPath.replaceAll(".", "\\.")}`, "i"));
  });
}

// Mutation caught: configuration or validator making a valid required fact impossible.
test("all ten complete gate proofs pass semantic validation before the unsigned stop", () => {
  const snapshot = buildSnapshot(fixtureProofs());

  assert.equal(snapshot.dispatch.status, "no_go");
  assert.equal(snapshot.dispatch.reasons.length, 1);
  assert.match(snapshot.dispatch.reasons[0], /signing authority/i);
});

// Mutation caught: permitting state/evidence inside the source repository.
test("evidence writer rejects a state root inside the repository", async () => {
  assert.equal(typeof gates.writeUnsignedGateSnapshot, "function");
  const snapshot = buildSnapshot(fixtureProofs());

  await assert.rejects(
    gates.writeUnsignedGateSnapshot(snapshot, ROOT, { repoRoot: ROOT }),
    /inside.*repository|repository.*inside/i,
  );
});

// Mutation caught: lexical containment ignoring a junction or symlink escape.
test("evidence writer rejects a reparse path that escapes the canonical state root", async () => {
  assert.equal(typeof gates.writeUnsignedGateSnapshot, "function");
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "agentdash-gate-containment-"));
  try {
    const stateRoot = path.join(temporaryRoot, "state");
    const outside = path.join(temporaryRoot, "outside");
    await mkdir(stateRoot);
    await mkdir(outside);
    await symlink(outside, path.join(stateRoot, "evidence"), process.platform === "win32" ? "junction" : "dir");

    await assert.rejects(
      gates.writeUnsignedGateSnapshot(buildSnapshot(fixtureProofs()), stateRoot, { repoRoot: ROOT }),
      /escape|reparse|junction|symlink|contain/i,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

// Mutation caught: an EEXIST collision following a destination symlink.
test("evidence writer rejects a destination-file symlink even when bytes match", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "agentdash-gate-destination-"));
  try {
    const stateRoot = path.join(temporaryRoot, "state");
    const snapshot = buildSnapshot(fixtureProofs());
    const destination = await gates.writeUnsignedGateSnapshot(snapshot, stateRoot, { repoRoot: ROOT });
    const encoded = await readFile(destination);
    const outsideFile = path.join(temporaryRoot, "outside-snapshot.json");
    await writeFile(outsideFile, encoded);
    await rm(destination);
    await symlink(outsideFile, destination, "file");

    await assert.rejects(
      gates.writeUnsignedGateSnapshot(snapshot, stateRoot, { repoRoot: ROOT }),
      /symlink|reparse|regular file|contain/i,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

// Mutation caught: executing an installed artifact before provenance is trusted.
test("binary inventory hashes without executing the configured artifact", async () => {
  const inventory = await utils.snapshotBinary(process.execPath);

  assert.equal(inventory.exists, true);
  assert.match(inventory.sha256, /^[a-f0-9]{64}$/);
  assert.equal(inventory.version, null);
  assert.match(inventory.diagnostic, /execution disabled|not executed|untrusted/i);
});

// Mutation caught: treating configured listener text as an observed socket fact.
test("AgentDash probe records package version and keeps listener observation unknown", async () => {
  const proof = await probeAgentDash({
    env: { AGENTDASH_LISTENER_ADDRESS: "127.0.0.1" },
    cwd: ROOT,
    now: new Date(NOW),
  });

  assert.equal(proof.facts.version, "2.0.0");
  assert.equal(proof.facts.configured_listener_address, "127.0.0.1");
  assert.equal(proof.facts.observed_listener_address, null);
  assert.match(proof.reasons.join("\n"), /observed listener/i);
});

// Mutation caught: assigning AgentDash HEAD to the Hermes installation.
test("Hermes probe derives version and commit from a temporary install fixture", async () => {
  const installRoot = await mkdtemp(path.join(tmpdir(), "agentdash-hermes-install-"));
  try {
    const binaryPath = path.join(installRoot, "venv", "Scripts", "hermes.exe");
    await mkdir(path.dirname(binaryPath), { recursive: true });
    await writeFile(binaryPath, "fixture binary bytes");
    await writeFile(path.join(installRoot, "pyproject.toml"), '[project]\nname = "hermes-agent"\nversion = "9.8.7"\n');
    for (const args of [
      ["-C", installRoot, "init"],
      ["-C", installRoot, "config", "user.email", "fixture@example.invalid"],
      ["-C", installRoot, "config", "user.name", "Fixture"],
      ["-C", installRoot, "add", "."],
      ["-C", installRoot, "commit", "-m", "fixture"],
    ]) {
      const result = spawnSync("git", args, { encoding: "utf8", shell: false });
      assert.equal(result.status, 0, result.stderr);
    }
    const expectedCommit = spawnSync("git", ["-C", installRoot, "rev-parse", "HEAD"], { encoding: "utf8", shell: false }).stdout.trim();

    const proof = await probeHermes({
      env: { HERMES_BINARY_PATH: binaryPath },
      installRoot,
      now: new Date(NOW),
    });

    assert.equal(proof.facts.binary_path, await realpath(binaryPath));
    assert.equal(proof.facts.version, "9.8.7");
    assert.equal(proof.facts.provenance.source_commit, expectedCommit);
  } finally {
    await rm(installRoot, { recursive: true, force: true });
  }
});

// Mutation caught: assigning AgentDash HEAD to a CodeG binary-only install.
test("CodeG probe leaves unavailable install source commit unknown", async () => {
  const installRoot = await mkdtemp(path.join(tmpdir(), "agentdash-codeg-install-"));
  try {
    const binaryPath = path.join(installRoot, "codeg.exe");
    await writeFile(binaryPath, "fixture binary bytes");
    const proof = await probeCodeG({
      env: { CODEG_BINARY_PATH: binaryPath },
      installRoot,
      now: new Date(NOW),
    });

    assert.equal(proof.facts.binary_path, await realpath(binaryPath));
    assert.equal(proof.facts.provenance.source_commit, null);
    assert.match(proof.reasons.join("\n"), /provenance|source commit/i);
  } finally {
    await rm(installRoot, { recursive: true, force: true });
  }
});

// Mutation caught: relying on import.meta.main on supported Node releases.
test("portable CLI exits nonzero, reports NO-GO, and writes only an unsigned snapshot", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "agentdash-gate-cli-"));
  try {
    const result = spawnSync(process.execPath, [CLI_PATH], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENTDASH_STATE_DIR: stateRoot,
        AGENTDASH_LISTENER_ADDRESS: "127.0.0.1",
        HERMES_BINARY_PATH: path.join(stateRoot, "missing-hermes.exe"),
        CODEG_BINARY_PATH: path.join(stateRoot, "missing-codeg.exe"),
      },
      shell: false,
    });

    assert.equal(result.status, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /NO-GO/i);
    const files = await readdir(path.join(stateRoot, "evidence"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^unsigned-gate-snapshot-[a-f0-9]{64}\.json$/);
    const snapshot = JSON.parse(await readFile(path.join(stateRoot, "evidence", files[0]), "utf8"));
    assert.equal(snapshot.schema_version, "unsigned_gate_snapshot_v1");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
