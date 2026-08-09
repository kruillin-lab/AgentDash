import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GATE_MANIFEST_SCHEMA_VERSION,
  buildGateManifest,
  loadSigningKey,
  signGateManifest,
  verifyGateManifest,
} from "../sign-gate-manifest.mjs";
import { canonicalJson } from "../probe-utils.mjs";

const DIGEST = "a".repeat(64);
const COMMIT = "b".repeat(40);
const NOW = "2026-08-06T12:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";
const SECRET = "s".repeat(64);
const KEY = { key_id: "signing_key_00001", generation: 1, secret: SECRET };

const GATE_IDS = [
  "agentdash_local_authority", "hermes_atomicity", "codeg_replay_safety", "pm_isolation",
  "workspace_containment", "route_qualification", "budget_enforcement",
  "verification_independence", "finalization_exactness", "reconciliation",
];

function proof(gateId) {
  return {
    gate_id: gateId,
    status: "pass",
    source_digest: DIGEST,
    facts: { provenance: { artifact_path: "/x", artifact_sha256: DIGEST, source_commit: COMMIT } },
    reasons: [],
    observed_at: NOW,
    expires_at: FUTURE,
  };
}

function snapshot(overrides = {}) {
  return {
    schema_version: "unsigned_gate_snapshot_v1",
    observed_at: NOW,
    expires_at: FUTURE,
    proofs: GATE_IDS.map(proof),
    dispatch: { status: "no_go", reasons: ["No reviewed signing authority is configured; unsigned evidence cannot be promoted or authorize dispatch."] },
    consumer_acceptance: { health: "rejected", promotion: "rejected", reason: "unsigned" },
    ...overrides,
  };
}

function reviewed(overrides = {}) {
  return { operator_id: "operator-luis", reviewed_at: NOW, ...overrides };
}

// ---------------------------------------------------------------------------
// The signature attests to the exact reviewed evidence
// ---------------------------------------------------------------------------

test("a signed manifest binds every gate's digest, commit, and binary", () => {
  const manifest = buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });

  assert.equal(manifest.schema_version, GATE_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.dispatch.status, "go");
  assert.equal(manifest.gate_evidence.length, GATE_IDS.length);
  for (const entry of manifest.gate_evidence) {
    assert.ok(GATE_IDS.includes(entry.gate_id));
    assert.match(entry.source_digest, /^[a-f0-9]{64}$/);
    assert.match(entry.source_commit, /^[a-f0-9]{40}$/);
    assert.match(entry.artifact_sha256, /^[a-f0-9]{64}$/);
  }
  // The reviewer and key are bound, and the signature verifies.
  assert.equal(manifest.reviewed_by.operator_id, "operator-luis");
  assert.equal(manifest.signing_key.key_id, KEY.key_id);
  assert.equal(manifest.signing_key.generation, 1);
  assert.match(manifest.signature, /^[a-f0-9]{64}$/);
  assert.equal(verifyGateManifest(manifest, KEY, Date.parse(NOW)).ok, true);
});

test("the manifest never persists a machine-local path or the secret", () => {
  const withPath = snapshot();
  withPath.proofs = withPath.proofs.map((p) => ({
    ...p,
    facts: { provenance: { artifact_path: String.raw`C:\Users\LEAKMARKER\hermes.exe`, artifact_sha256: DIGEST, source_commit: COMMIT } },
  }));
  const manifest = buildGateManifest({ snapshot: withPath, reviewer: reviewed(), key: KEY, now: NOW });
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /LEAKMARKER/);
  assert.doesNotMatch(serialized, new RegExp(SECRET));
});

// ---------------------------------------------------------------------------
// Signing is a SEPARATE reviewed operator action over a complete conjunction
// ---------------------------------------------------------------------------

test("a partial conjunction cannot be signed", () => {
  const partial = snapshot();
  partial.proofs = partial.proofs.filter((p) => p.gate_id !== "reconciliation");
  assert.throws(() => buildGateManifest({ snapshot: partial, reviewer: reviewed(), key: KEY, now: NOW }), /missing gate|partial/i);
});

test("a failed gate proof cannot be signed", () => {
  const failing = snapshot();
  failing.proofs[2] = { ...failing.proofs[2], status: "no_go" };
  assert.throws(() => buildGateManifest({ snapshot: failing, reviewer: reviewed(), key: KEY, now: NOW }), /not pass|no_go|gate/i);
});

test("stale evidence cannot be signed", () => {
  const stale = snapshot({ expires_at: "2020-01-01T00:00:00.000Z" });
  stale.proofs = stale.proofs.map((p) => ({ ...p, expires_at: "2020-01-01T00:00:00.000Z" }));
  assert.throws(() => buildGateManifest({ snapshot: stale, reviewer: reviewed(), key: KEY, now: NOW }), /expired|stale/i);
});

test("signing requires a named reviewer", () => {
  assert.throws(() => buildGateManifest({ snapshot: snapshot(), reviewer: { reviewed_at: NOW }, key: KEY, now: NOW }), /operator|reviewer/i);
  assert.throws(() => buildGateManifest({ snapshot: snapshot(), reviewer: reviewed({ operator_id: "   " }), key: KEY, now: NOW }), /operator|reviewer/i);
});

test("a weak signing secret is refused", () => {
  assert.throws(() => buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: { ...KEY, secret: "short" }, now: NOW }), /32|secret/i);
});

// ---------------------------------------------------------------------------
// Verification fails closed on every distinguishable failure
// ---------------------------------------------------------------------------

test("a tampered manifest fails verification", () => {
  const manifest = buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });
  // Flip a bound gate digest without re-signing.
  const tampered = { ...manifest, gate_evidence: manifest.gate_evidence.map((e, i) => (i === 0 ? { ...e, source_digest: "c".repeat(64) } : e)) };
  const result = verifyGateManifest(tampered, KEY, Date.parse(NOW));
  assert.equal(result.ok, false);
  assert.match(result.reason, /signature/i);
});

test("a manifest signed by a different key fails verification", () => {
  const manifest = buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });
  const result = verifyGateManifest(manifest, { ...KEY, secret: "t".repeat(64) }, Date.parse(NOW));
  assert.equal(result.ok, false);
  assert.match(result.reason, /signature/i);
});

test("a rotated key generation invalidates an older manifest", () => {
  const manifest = buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });
  const result = verifyGateManifest(manifest, { ...KEY, generation: 2 }, Date.parse(NOW));
  assert.equal(result.ok, false);
  assert.match(result.reason, /generation|rotat/i);
});

test("an absent signature is distinguishable from a malformed one", () => {
  const manifest = buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });
  const { signature, ...unsigned } = manifest;
  assert.match(verifyGateManifest(unsigned, KEY, Date.parse(NOW)).reason, /absent|missing/i);
  assert.match(verifyGateManifest({ ...manifest, signature: "not-hex" }, KEY, Date.parse(NOW)).reason, /malformed/i);
});

test("an expired manifest fails verification even with a valid signature", () => {
  const manifest = buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });
  const result = verifyGateManifest(manifest, KEY, Date.parse("2099-06-01T00:00:00.000Z"));
  assert.equal(result.ok, false);
  assert.match(result.reason, /expired/i);
});

test("a non-object manifest fails closed", () => {
  for (const raw of [null, undefined, 7, "signed", []]) {
    assert.equal(verifyGateManifest(raw, KEY, Date.parse(NOW)).ok, false);
  }
});

// ---------------------------------------------------------------------------
// The key is machine-local and never committed
// ---------------------------------------------------------------------------

test("loadSigningKey reads a machine-local key and refuses a weak one", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "sign-key-"));
  try {
    const dir = join(stateDir, "security");
    await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));

    // Absent key: fail closed with a clear reason.
    await assert.rejects(loadSigningKey(stateDir), /no signing key|not configured/i);

    await writeFile(join(dir, "gate-signing-key.json"), JSON.stringify({ key_id: KEY.key_id, generation: 1, secret: SECRET }), "utf8");
    const loaded = await loadSigningKey(stateDir);
    assert.equal(loaded.key_id, KEY.key_id);
    assert.equal(loaded.generation, 1);

    // A weak secret is refused rather than used.
    await writeFile(join(dir, "gate-signing-key.json"), JSON.stringify({ key_id: KEY.key_id, generation: 1, secret: "short" }), "utf8");
    await assert.rejects(loadSigningKey(stateDir), /32|secret/i);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("signGateManifest writes the manifest and no secret to disk", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "sign-write-"));
  try {
    const written = await signGateManifest({ stateDir, snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });
    const body = await readFile(written.manifest_path, "utf8");
    assert.doesNotMatch(body, new RegExp(SECRET));
    const parsed = JSON.parse(body);
    assert.equal(parsed.schema_version, GATE_MANIFEST_SCHEMA_VERSION);
    assert.equal(verifyGateManifest(parsed, KEY, Date.parse(NOW)).ok, true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Each guard must be individually load-bearing, asserted by its exact reason so
// a neighbouring check cannot silently cover for a deleted one.
// ---------------------------------------------------------------------------

test("a signing key without a key id is refused", () => {
  assert.throws(() => buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: { generation: 1, secret: SECRET }, now: NOW }), /key id/i);
});

test("a non-positive signing key generation is refused", () => {
  for (const generation of [0, -1, 1.5, "1"]) {
    assert.throws(() => buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: { ...KEY, generation }, now: NOW }), /generation/i);
  }
});

test("a malformed evidence digest cannot be signed", () => {
  const bad = snapshot();
  bad.proofs[1] = { ...bad.proofs[1], source_digest: "not-a-digest" };
  assert.throws(() => buildGateManifest({ snapshot: bad, reviewer: reviewed(), key: KEY, now: NOW }), /evidence digest/i);
});

test("a missing provenance commit cannot be signed", () => {
  const bad = snapshot();
  bad.proofs[2] = { ...bad.proofs[2], facts: { provenance: { artifact_sha256: DIGEST, source_commit: "nope" } } };
  assert.throws(() => buildGateManifest({ snapshot: bad, reviewer: reviewed(), key: KEY, now: NOW }), /external commit/i);
});

test("a single expired proof cannot be signed even when the snapshot is current", () => {
  const bad = snapshot({ expires_at: FUTURE });
  bad.proofs[4] = { ...bad.proofs[4], expires_at: "2020-01-01T00:00:00.000Z" };
  assert.throws(() => buildGateManifest({ snapshot: bad, reviewer: reviewed(), key: KEY, now: NOW }), /Expired evidence for workspace_containment/i);
});

test("a stale snapshot expiry cannot be signed even when every proof is current", () => {
  const bad = snapshot({ expires_at: "2020-01-01T00:00:00.000Z" });
  assert.throws(() => buildGateManifest({ snapshot: bad, reviewer: reviewed(), key: KEY, now: NOW }), /snapshot has expired/i);
});

test("an unrecognized schema version is refused by name", () => {
  const manifest = buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });
  const result = verifyGateManifest({ ...manifest, schema_version: "agentdash.gate-manifest/v2" }, KEY, Date.parse(NOW));
  assert.equal(result.ok, false);
  assert.match(result.reason, /schema version/i);
});

test("a different key id is refused by name, distinctly from a bad signature", () => {
  const manifest = buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });
  const result = verifyGateManifest(manifest, { ...KEY, key_id: "signing_key_00002" }, Date.parse(NOW));
  assert.equal(result.ok, false);
  assert.match(result.reason, /key id/i);
});

test("a signed manifest whose conjunction is not go is refused by name", () => {
  const manifest = buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });
  // Re-sign a no_go body so the signature itself is valid and only the status is wrong.
  const { signature, ...body } = manifest;
  const downgraded = { ...body, dispatch: { status: "no_go", reasons: ["forced"] } };
  const resigned = buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });
  // Swap in the no_go dispatch and recompute nothing: the signature check fires first,
  // which is itself the correct fail-closed order.
  const result = verifyGateManifest({ ...resigned, dispatch: downgraded.dispatch }, KEY, Date.parse(NOW));
  assert.equal(result.ok, false);
  assert.match(result.reason, /signature|not go/i);
});

// The conjunction guard, isolated. buildGateManifest will not produce a no_go
// manifest, so the body is signed directly with the same HMAC scheme: the signature
// is genuinely VALID and only dispatch.status is wrong. Without this, the signature
// check masks the conjunction check and the latter could be deleted unnoticed.
test("a validly signed no_go conjunction is still refused", () => {
  const manifest = buildGateManifest({ snapshot: snapshot(), reviewer: reviewed(), key: KEY, now: NOW });
  const { signature, ...body } = manifest;
  const forged = { ...body, dispatch: { status: "no_go", reasons: ["deliberately downgraded"] } };
  const validSignature = createHmac("sha256", SECRET).update(canonicalJson(forged), "utf8").digest("hex");

  const result = verifyGateManifest({ ...forged, signature: validSignature }, KEY, Date.parse(NOW));
  assert.equal(result.ok, false);
  assert.match(result.reason, /not go/i);
});
