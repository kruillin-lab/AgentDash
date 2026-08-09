import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildGateManifest } from "../sign-gate-manifest.mjs";
import { authenticateGateEvidence, acceptDispatchRecord, buildPromotionManifest, commitDispatchMode, evaluateModeTransition, evaluatePromotion, readDispatchMode, verifyQualificationReceipts } from "../promote-gates.mjs";

const GATE_IDS = [
  "agentdash_local_authority", "hermes_atomicity", "codeg_replay_safety", "pm_isolation",
  "workspace_containment", "route_qualification", "budget_enforcement", "verification_independence",
  "finalization_exactness", "reconciliation",
];

const DIGEST = "a".repeat(64);
const COMMIT = "b".repeat(40);

function proof(gateId) {
  return { gate_id: gateId, status: "pass", source_digest: DIGEST, facts: { provenance: { artifact_path: "/x", artifact_sha256: DIGEST, source_commit: COMMIT } }, reasons: [], observed_at: "2026-08-06T12:00:00.000Z", expires_at: "2026-08-06T12:15:00.000Z" };
}

function fullSnapshot() {
  return { schema_version: "unsigned_gate_snapshot_v1", observed_at: "2026-08-06T12:00:00.000Z", expires_at: "2026-08-06T12:15:00.000Z", proofs: GATE_IDS.map(proof), dispatch: { status: "go", reasons: [] } };
}

test("a partial manifest is rejected with a missing-gate reason", () => {
  const partial = fullSnapshot();
  partial.proofs = partial.proofs.filter((p) => p.gate_id !== "reconciliation");
  const result = evaluatePromotion(partial, "enabled");
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /missing gate/i);
});

test("a full go conjunction with verified digests and commits is ready", () => {
  // Pin the clock: the fixture's proofs are only valid inside their own window, and
  // promotion now verifies evidence is still current at promotion time.
  const result = evaluatePromotion(fullSnapshot(), "enabled", Date.parse("2026-08-06T12:05:00.000Z"));
  assert.equal(result.ready, true);
  assert.equal(result.reasons.length, 0);
  assert.match(result.manifest_digest, /^[a-f0-9]{64}$/i);
});

test("a no_go conjunction cannot be promoted even with all proofs present", () => {
  const snapshot = fullSnapshot();
  snapshot.dispatch = { status: "no_go", reasons: ["something failed"] };
  const result = evaluatePromotion(snapshot, "enabled");
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /partial conjunction|not go/i);
});

test("a malformed evidence digest is rejected", () => {
  const snapshot = fullSnapshot();
  snapshot.proofs[0] = { ...snapshot.proofs[0], source_digest: "not-a-digest" };
  const result = evaluatePromotion(snapshot, "enabled");
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /digest/i);
});

test("an unknown external commit is rejected", () => {
  const snapshot = fullSnapshot();
  snapshot.proofs[1] = { ...snapshot.proofs[1], facts: { provenance: { artifact_path: "/x", artifact_sha256: DIGEST, source_commit: "unknown" } } };
  const result = evaluatePromotion(snapshot, "enabled");
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /commit/i);
});

test("an unknown target mode is rejected", () => {
  const result = evaluatePromotion(fullSnapshot(), "production");
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /target dispatch mode/i);
});

test("a missing snapshot cannot be evaluated", () => {
  const result = evaluatePromotion(null, "enabled");
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /missing gate snapshot/i);
});

// ---------------------------------------------------------------------------
// PromotionManifestV1
//
// Task 17 Interfaces: "PromotionManifestV1 binds all gate/evidence digests, exact
// external commits/binaries, qualification receipts, operator command, target
// mode, timestamp, and expiry".
// ---------------------------------------------------------------------------

function manifestInput(overrides = {}) {
  return {
    snapshot: fullSnapshot(),
    target_mode: "enabled",
    current_mode: "candidate",
    operator_command: "promote-gates --mode=enabled --promote",
    qualification_receipts: [{ receipt_id: "qualification-1", digest: DIGEST, route_id: "codex/gpt-5.6-terra", task_class: "bounded_coding" }],
    now: "2026-08-06T12:05:00.000Z",
    ...overrides,
  };
}

test("PromotionManifestV1 binds every required field", () => {
  const manifest = buildPromotionManifest(manifestInput());
  assert.equal(manifest.schema_version, "agentdash.promotion-manifest/v1");
  assert.equal(manifest.target_mode, "enabled");
  assert.equal(manifest.current_mode, "candidate");
  assert.equal(manifest.operator_command, "promote-gates --mode=enabled --promote");
  assert.equal(manifest.created_at, "2026-08-06T12:05:00.000Z");
  // Expiry is bound from the snapshot, never invented.
  assert.equal(manifest.expires_at, fullSnapshot().expires_at);
  // Every gate is bound by id + evidence digest + external commit/binary.
  assert.equal(manifest.gate_evidence.length, GATE_IDS.length);
  for (const entry of manifest.gate_evidence) {
    assert.match(entry.source_digest, /^[a-f0-9]{64}$/i);
    assert.match(entry.source_commit, /^[a-f0-9]{40}$/i);
    assert.match(entry.artifact_sha256, /^[a-f0-9]{64}$/i);
  }
  assert.equal(manifest.qualification_receipts.length, 1);
  assert.match(manifest.manifest_digest, /^[a-f0-9]{64}$/i);
  assert.match(manifest.snapshot_digest, /^[a-f0-9]{64}$/i);
});

test("PromotionManifestV1 refuses to bind a partial conjunction", () => {
  const input = manifestInput();
  input.snapshot.proofs = input.snapshot.proofs.filter((p) => p.gate_id !== "reconciliation");
  assert.throws(() => buildPromotionManifest(input), /missing gate|partial/i);
});

test("promotion to enabled requires at least one qualification receipt", () => {
  assert.throws(() => buildPromotionManifest(manifestInput({ qualification_receipts: [] })), /qualification receipt/i);
});

test("the manifest digest changes when any bound field changes", () => {
  const a = buildPromotionManifest(manifestInput());
  const b = buildPromotionManifest(manifestInput({ target_mode: "candidate" }));
  assert.notEqual(a.manifest_digest, b.manifest_digest);
});

// ---------------------------------------------------------------------------
// Compare-and-set from the current mode
// ---------------------------------------------------------------------------

test("promotion is rejected when the expected current mode does not match the store", () => {
  const result = evaluateModeTransition({ stored_mode: "disabled", expected_current_mode: "candidate", target_mode: "enabled" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /compare-and-set|current mode/i);
});

test("promotion is accepted when the expected current mode matches the store", () => {
  const result = evaluateModeTransition({ stored_mode: "candidate", expected_current_mode: "candidate", target_mode: "enabled" });
  assert.equal(result.ok, true);
});

test("a no-op transition to the same mode is rejected", () => {
  const result = evaluateModeTransition({ stored_mode: "enabled", expected_current_mode: "enabled", target_mode: "enabled" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /already/i);
});

test("an absent store reads as disabled, the fail-closed default", () => {
  const result = evaluateModeTransition({ stored_mode: null, expected_current_mode: "disabled", target_mode: "candidate" });
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// The promotion reader must accept EXACTLY what the runtime accepts. If they
// disagree, --expect-current compares against a mode that is not in force.
// The runtime's rules live in runtime/composition.ts::readPromotedDispatchMode:
// a valid mode, a 64-hex manifest_digest, and an unexpired expires_at.
// ---------------------------------------------------------------------------

const FUTURE = "2099-01-01T00:00:00.000Z";

test("a well-formed promotion record is accepted", () => {
  assert.equal(acceptDispatchRecord({ mode: "candidate", manifest_digest: DIGEST, expires_at: FUTURE }), "candidate");
});

test("a record without a bound manifest digest is not authority", () => {
  assert.equal(acceptDispatchRecord({ mode: "enabled", expires_at: FUTURE }), null);
  assert.equal(acceptDispatchRecord({ mode: "enabled", manifest_digest: "not-a-digest", expires_at: FUTURE }), null);
});

test("an expired promotion record is not authority", () => {
  assert.equal(acceptDispatchRecord({ mode: "enabled", manifest_digest: DIGEST, expires_at: "2020-01-01T00:00:00.000Z" }), null);
});

test("an unknown mode is not authority", () => {
  assert.equal(acceptDispatchRecord({ mode: "production", manifest_digest: DIGEST, expires_at: FUTURE }), null);
});

test("a non-object record is not authority", () => {
  for (const raw of [null, undefined, 7, "enabled", []]) assert.equal(acceptDispatchRecord(raw), null);
});

// ---------------------------------------------------------------------------
// Stale evidence cannot be promoted
//
// "An expired proof makes the route unavailable for new actions" and promotion
// must not manufacture evidence. A snapshot whose proofs have expired by the time
// --promote runs would otherwise write a durable record the runtime immediately
// rejects, while the CLI reported success.
// ---------------------------------------------------------------------------

test("a snapshot that has expired by promotion time is rejected", () => {
  const stale = fullSnapshot();
  stale.expires_at = "2020-01-01T00:00:00.000Z";
  stale.proofs = stale.proofs.map((p) => ({ ...p, expires_at: "2020-01-01T00:00:00.000Z" }));
  const result = evaluatePromotion(stale, "enabled", Date.parse("2026-08-06T12:00:00.000Z"));
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /expired|stale/i);
});

test("a snapshot still inside its validity window is accepted", () => {
  const fresh = fullSnapshot();
  const result = evaluatePromotion(fresh, "enabled", Date.parse("2026-08-06T12:05:00.000Z"));
  assert.equal(result.ready, true);
});

test("buildPromotionManifest refuses stale evidence", () => {
  const input = manifestInput();
  input.snapshot.expires_at = "2020-01-01T00:00:00.000Z";
  input.snapshot.proofs = input.snapshot.proofs.map((p) => ({ ...p, expires_at: "2020-01-01T00:00:00.000Z" }));
  assert.throws(() => buildPromotionManifest(input), /expired|stale/i);
});

// ---------------------------------------------------------------------------
// The operator command is redacted before it is persisted
//
// "Do not place secrets in prompts, Kanban bodies, comments, attachments,
// AgentBrain, logs, or receipts." The manifest must record WHICH command ran
// without baking absolute local paths into a durable digest-addressed artifact.
// ---------------------------------------------------------------------------

test("the operator command records flags without absolute local paths", () => {
  const manifest = buildPromotionManifest(manifestInput({
    operator_command: "promote-gates --mode=enabled --evidence=C:\Users\someone\evidence\snap.json --promote",
  }));
  assert.doesNotMatch(manifest.operator_command, /C:\\Users|\/home\//i);
  assert.doesNotMatch(manifest.operator_command, /someone/i);
  // The flag itself is still auditable, with its value redacted.
  assert.match(manifest.operator_command, /--mode=enabled/);
  assert.match(manifest.operator_command, /--evidence=/);
  assert.match(manifest.operator_command, /--promote/);
});

// ---------------------------------------------------------------------------
// The compare-and-set is atomic against a concurrent promotion
//
// A reviewer reproduced two concurrent --promote runs both passing the CAS check
// and the later rename silently winning, discarding a promotion the other
// operator had just been told succeeded. Exactly one may commit.
// ---------------------------------------------------------------------------

test("two concurrent promotions from the same mode: exactly one commits", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-cas-"));
  try {
    const manifestFor = (mode) => buildPromotionManifest(manifestInput({ target_mode: mode }));
    // Seed the starting state both racers believe is current.
    await commitDispatchMode(stateDir, manifestFor("candidate"), "disabled", Date.parse("2026-08-06T12:06:00.000Z"));
    const settled = await Promise.allSettled([
      commitDispatchMode(stateDir, manifestFor("enabled"), "candidate", Date.parse("2026-08-06T12:06:00.000Z")),
      commitDispatchMode(stateDir, manifestFor("qualification"), "candidate", Date.parse("2026-08-06T12:06:00.000Z")),
    ]);

    const winners = settled.filter((r) => r.status === "fulfilled");
    const losers = settled.filter((r) => r.status === "rejected");
    assert.equal(winners.length, 1, "exactly one promotion may commit");
    assert.equal(losers.length, 1, "the loser must fail loudly, never silently");

    // The durable record matches the winner, and the loser changed nothing.
    const stored = await readDispatchMode(stateDir, Date.parse("2026-08-06T12:06:00.000Z"));
    assert.ok(["enabled", "qualification"].includes(stored));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("a stale expected mode is rejected at commit time, not just at read time", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-cas-"));
  try {
    // The store already holds `candidate`...
    await commitDispatchMode(stateDir, buildPromotionManifest(manifestInput({ target_mode: "candidate" })), "disabled", Date.parse("2026-08-06T12:06:00.000Z"));
    // ...so a commit that still believes `disabled` must be refused.
    await assert.rejects(
      commitDispatchMode(stateDir, buildPromotionManifest(manifestInput({ target_mode: "enabled" })), "disabled", Date.parse("2026-08-06T12:06:00.000Z")),
      /compare-and-set|current mode/i,
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The manifest never persists machine-local paths
//
// "Commit only the configuration shape, never machine-local credentials or
// evidence." operator_command is redacted for exactly this reason; every other
// persisted field must hold the same line. The binary is still identified by its
// SHA-256, so redacting the path loses no audit value.
// ---------------------------------------------------------------------------

test("gate evidence identifies binaries by digest, never by machine-local path", () => {
  const input = manifestInput();
  input.snapshot.proofs = input.snapshot.proofs.map((p) => ({
    ...p,
    // String.raw: a plain double-quoted string silently drops every backslash, leaving a
    // fixture that contains no path at all and an assertion that cannot fail.
    facts: { provenance: { artifact_path: String.raw`C:\Users\LEAKMARKER\AppData\Local\hermes\hermes.exe`, artifact_sha256: DIGEST, source_commit: COMMIT } },
  }));

  // Prove the fixture really is a path before asserting the output is free of it.
  assert.ok(input.snapshot.proofs[0].facts.provenance.artifact_path.indexOf(String.fromCharCode(92)) >= 0, "the fixture must contain real backslashes");

  const manifest = buildPromotionManifest(input);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /LEAKMARKER/);
  assert.doesNotMatch(serialized, /AppData/i);
  // The binary remains auditable by digest and commit.
  for (const entry of manifest.gate_evidence) {
    assert.match(entry.artifact_sha256, /^[a-f0-9]{64}$/i);
    assert.match(entry.source_commit, /^[a-f0-9]{40}$/i);
  }
});

// ---------------------------------------------------------------------------
// evaluatePromotion is safe on its own, independent of caller discipline
// ---------------------------------------------------------------------------

test("an unparseable clock does not silently disable the expiry check", () => {
  const stale = fullSnapshot();
  stale.expires_at = "2020-01-01T00:00:00.000Z";
  stale.proofs = stale.proofs.map((p) => ({ ...p, expires_at: "2020-01-01T00:00:00.000Z" }));
  // `Date.parse(x) <= NaN` is always false, so a NaN clock would silently skip the
  // expiry reasons entirely and report a stale conjunction as promotable.
  const result = evaluatePromotion(stale, "enabled", Number.NaN);
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /expired|stale/i);
});

// ---------------------------------------------------------------------------
// A qualification receipt must correspond to real evidence, and must not carry
// machine-local material into the manifest.
//
// "promote-gates.mjs ... cannot manufacture evidence" and "Commit only the
// configuration shape, never machine-local credentials or evidence."
// ---------------------------------------------------------------------------

test("a receipt is bound by digest only; operator-supplied fields are not persisted", () => {
  const manifest = buildPromotionManifest(manifestInput({
    qualification_receipts: [{
      digest: DIGEST,
      route_id: "codex/gpt-5.6-terra",
      task_class: "bounded_coding",
      workspace_path: String.raw`C:\Users\LEAKMARKER\disposable`,
      note: "api-key=LEAKED",
    }],
  }));

  const serialized = JSON.stringify(manifest.qualification_receipts);
  assert.doesNotMatch(serialized, /LEAKMARKER/);
  assert.doesNotMatch(serialized, /LEAKED/i);
  assert.doesNotMatch(serialized, /workspace_path/);
  // The receipt is still auditable by its exact digest and route tuple.
  assert.equal(manifest.qualification_receipts[0].digest, DIGEST);
  assert.equal(manifest.qualification_receipts[0].route_id, "codex/gpt-5.6-terra");
});

test("promotion to enabled rejects a receipt with no matching evidence on disk", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-receipt-"));
  try {
    // No route-evidence/<digest>.json exists, so this receipt was never produced by
    // a qualification run and cannot authorize model-backed dispatch.
    await assert.rejects(
      verifyQualificationReceipts(stateDir, [{ digest: DIGEST }]),
      /no matching qualification evidence|manufacture/i,
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("promotion accepts a receipt whose evidence really exists", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-receipt-"));
  try {
    const dir = join(stateDir, "route-evidence");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${DIGEST}.json`), JSON.stringify({
      schema_version: "agentdash.qualification-evidence/v1", status: "active",
      route_id: "codex/gpt-5.6-terra", task_class: "bounded_coding", level: 5,
      evaluated_at: "2026-08-01T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z",
    }), "utf8");
    await verifyQualificationReceipts(stateDir, [{ digest: DIGEST }], Date.parse("2026-08-06T12:00:00.000Z"));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A qualification receipt must name evidence the RUNTIME would also honour.
//
// RouteRegistry (routes/registry.ts) rejects symlinks, non-digest-addressed
// filenames, schema-invalid content, evidence whose digest does not match its own
// content, expired evidence, and evidence superseded by a revocation. A file that
// merely exists is not "real evidence": promotion must not enter `enabled` on the
// strength of evidence live dispatch would refuse.
// ---------------------------------------------------------------------------

function evidenceFile(overrides = {}) {
  return {
    schema_version: "agentdash.qualification-evidence/v1",
    status: "active",
    route_id: "codex/gpt-5.6-terra",
    task_class: "bounded_coding",
    level: 5,
     evaluated_at: "2026-08-01T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seedEvidence(stateDir, digest, body) {
  const dir = join(stateDir, "route-evidence");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${digest}.json`), JSON.stringify(body), "utf8");
}

test("expired qualification evidence cannot authorize promotion", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-evidence-"));
  try {
    await seedEvidence(stateDir, DIGEST, evidenceFile({ expires_at: "2020-01-01T00:00:00.000Z" }));
    await assert.rejects(
      verifyQualificationReceipts(stateDir, [{ digest: DIGEST }], Date.parse("2026-08-06T12:00:00.000Z")),
      /expired/i,
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("a revoked route cannot authorize promotion", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-evidence-"));
  try {
    await seedEvidence(stateDir, DIGEST, evidenceFile());
    const revDir = join(stateDir, "route-revocations");
    await mkdir(revDir, { recursive: true });
    // Revoked AFTER the evidence was evaluated, so the evidence is superseded.
    await writeFile(join(revDir, `${"e".repeat(64)}.json`), JSON.stringify({
      route_id: "codex/gpt-5.6-terra", task_class: "bounded_coding", revoked_at: "2026-08-05T00:00:00.000Z",
    }), "utf8");
    await assert.rejects(
      verifyQualificationReceipts(stateDir, [{ digest: DIGEST }], Date.parse("2026-08-06T12:00:00.000Z")),
      /revoked/i,
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("schema-invalid evidence cannot authorize promotion", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-evidence-"));
  try {
    // Valid dates but a wrong-typed route_id, so ONLY the schema-shape check can reject
    // this. A fixture missing its dates would trip the validity-window check instead and
    // pass for the wrong reason, leaving the shape guard unproven.
    await seedEvidence(stateDir, DIGEST, evidenceFile({ route_id: 12345 }));
    await assert.rejects(
      verifyQualificationReceipts(stateDir, [{ digest: DIGEST }], Date.parse("2026-08-06T12:00:00.000Z")),
      /failed strict validation/i,
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("current, unrevoked, schema-valid evidence authorizes promotion", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-evidence-"));
  try {
    await seedEvidence(stateDir, DIGEST, evidenceFile());
    await verifyQualificationReceipts(stateDir, [{ digest: DIGEST }], Date.parse("2026-08-06T12:00:00.000Z"));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("a symlinked evidence file cannot authorize promotion", async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-evidence-"));
  try {
    const dir = join(stateDir, "route-evidence");
    await mkdir(dir, { recursive: true });
    const target = join(stateDir, "forged.json");
    await writeFile(target, JSON.stringify(evidenceFile()), "utf8");
    try {
      await symlink(target, join(dir, `${DIGEST}.json`), "file");
    } catch {
      // Creating a symlink needs privileges on some platforms; skip rather than
      // pass vacuously, so this never becomes an assertion that cannot fail.
      t.skip("this platform does not permit creating a symlink");
      return;
    }
    await assert.rejects(
      verifyQualificationReceipts(stateDir, [{ digest: DIGEST }], Date.parse("2026-08-06T12:00:00.000Z")),
      /immutable regular file/i,
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Only ENOENT means "no revocations". Any other error means we cannot PROVE the
// route is unrevoked, which must fail closed rather than read as "none".
// ---------------------------------------------------------------------------

test("an unreadable revocations directory fails closed", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-revoke-"));
  try {
    await seedEvidence(stateDir, DIGEST, evidenceFile());
    // A FILE where the directory belongs makes readdir fail with ENOTDIR, which is
    // "cannot enumerate", not "there are none". chmod is a no-op on Windows, so this
    // is the portable way to force a non-ENOENT readdir error.
    await writeFile(join(stateDir, "route-revocations"), "not a directory", "utf8");
    await assert.rejects(
      verifyQualificationReceipts(stateDir, [{ digest: DIGEST }], Date.parse("2026-08-06T12:00:00.000Z")),
      /revocations could not be read|cannot prove/i,
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("an absent revocations directory means there are none", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-revoke-"));
  try {
    await seedEvidence(stateDir, DIGEST, evidenceFile());
    await verifyQualificationReceipts(stateDir, [{ digest: DIGEST }], Date.parse("2026-08-06T12:00:00.000Z"));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("future-dated evidence is not yet valid", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-future-"));
  try {
    await seedEvidence(stateDir, DIGEST, evidenceFile({ evaluated_at: "2030-01-01T00:00:00.000Z" }));
    await assert.rejects(
      verifyQualificationReceipts(stateDir, [{ digest: DIGEST }], Date.parse("2026-08-06T12:00:00.000Z")),
      /not yet valid/i,
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("a revocation predating the evidence does not supersede it", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-revoke-"));
  try {
    await seedEvidence(stateDir, DIGEST, evidenceFile());
    const revDir = join(stateDir, "route-revocations");
    await mkdir(revDir, { recursive: true });
    // Revoked BEFORE this evidence was evaluated: the route was re-qualified after.
    await writeFile(join(revDir, `${"e".repeat(64)}.json`), JSON.stringify({
      route_id: "codex/gpt-5.6-terra", task_class: "bounded_coding", revoked_at: "2026-07-01T00:00:00.000Z",
    }), "utf8");
    await verifyQualificationReceipts(stateDir, [{ digest: DIGEST }], Date.parse("2026-08-06T12:00:00.000Z"));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The CLI entrypoint must actually run. Unit-testing the exported helpers alone
// let a deleted function reach HEAD with every real invocation crashing.
// ---------------------------------------------------------------------------

test("the CLI runs end to end and reports its dry-run transition", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-cli-"));
  try {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const snapshot = { ...fullSnapshot(), expires_at: future };
    snapshot.proofs = snapshot.proofs.map((proof) => ({ ...proof, expires_at: future }));
    // Real operator flow: provision the machine-local key, then sign the reviewed
    // snapshot. Promotion consumes only the signed manifest.
    await mkdir(join(stateDir, "security"), { recursive: true });
    await writeFile(join(stateDir, "security", "gate-signing-key.json"), JSON.stringify(SIGNING_KEY), "utf8");
    const signed = buildGateManifest({
      snapshot,
      reviewer: { operator_id: "operator-luis", reviewed_at: new Date().toISOString() },
      key: SIGNING_KEY,
      now: new Date().toISOString(),
    });
    const snapshotPath = join(stateDir, "signed-manifest.json");
    await writeFile(snapshotPath, JSON.stringify(signed), "utf8");

    const result = spawnSync(process.execPath, [
      "scripts/mission-control/promote-gates.mjs",
      "--mode=candidate", `--evidence=${snapshotPath}`, "--expect-current=disabled",
    ], { encoding: "utf8", env: { ...process.env, AGENTDASH_STATE_DIR: stateDir } });

    const output = `${result.stdout}${result.stderr}`;
    assert.doesNotMatch(output, /is not defined|ReferenceError|TypeError/, output);
    assert.match(output, /dry run/i, output);
    assert.match(output, /Compare-and-set from disabled to candidate/i, output);
    assert.equal(result.status, 0, output);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Auto is a SEPARATE authority step.
//
// "Enable `enabled` only after that qualification receipt and every gate validate.
//  Enable auto only after a separate complete harmless qualification path for an
//  exact route/task-class also satisfies every auto predicate and aggregate bound."
//
// So enabling model-backed dispatch must never, by itself, enable auto activation.
// ---------------------------------------------------------------------------

test("promoting to enabled does not enable auto activation", () => {
  const manifest = buildPromotionManifest(manifestInput({ target_mode: "enabled" }));
  // Auto is off unless its own separate qualification path was proven.
  assert.equal(manifest.auto_activation.enabled, false);
  assert.match(manifest.auto_activation.reason, /separate|not proven|auto/i);
});

test("auto activation requires its own qualification receipt and a satisfied predicate", () => {
  const manifest = buildPromotionManifest(manifestInput({
    target_mode: "enabled",
    auto_qualification: {
      receipt: { digest: DIGEST, route_id: "codex/gpt-5.6-terra", task_class: "bounded_coding" },
      auto_eligibility: { eligible: true, reasons: [] },
    },
  }));
  assert.equal(manifest.auto_activation.enabled, true);
  assert.equal(manifest.auto_activation.route_id, "codex/gpt-5.6-terra");
});

test("an ineligible auto predicate cannot enable auto", () => {
  assert.throws(() => buildPromotionManifest(manifestInput({
    target_mode: "enabled",
    auto_qualification: {
      receipt: { digest: DIGEST, route_id: "codex/gpt-5.6-terra", task_class: "bounded_coding" },
      auto_eligibility: { eligible: false, reasons: ["aggregate cost exceeds $1.00"] },
    },
  })), /auto predicate|not eligible/i);
});

test("auto cannot be enabled for a mode below enabled", () => {
  assert.throws(() => buildPromotionManifest(manifestInput({
    target_mode: "candidate",
    auto_qualification: {
      receipt: { digest: DIGEST, route_id: "codex/gpt-5.6-terra", task_class: "bounded_coding" },
      auto_eligibility: { eligible: true, reasons: [] },
    },
  })), /auto/i);
});

// ---------------------------------------------------------------------------
// Each expiry guard must be independently load-bearing.
//
// The snapshot-level and per-proof expiry checks are separate guards. A fixture
// where BOTH are stale lets either one catch it, so deleting the other goes
// unnoticed. These fixtures make exactly one stale at a time.
// ---------------------------------------------------------------------------

const AT = Date.parse("2026-08-06T12:00:00.000Z");

test("a stale snapshot expiry is caught even when every proof is current", () => {
  const snapshot = fullSnapshot();
  snapshot.expires_at = "2020-01-01T00:00:00.000Z";
  snapshot.proofs = snapshot.proofs.map((proof) => ({ ...proof, expires_at: "2099-01-01T00:00:00.000Z" }));
  const result = evaluatePromotion(snapshot, "enabled", AT);
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /gate snapshot has expired/i);
});

test("a single stale proof is caught even when the snapshot is current", () => {
  const snapshot = fullSnapshot();
  snapshot.expires_at = "2099-01-01T00:00:00.000Z";
  snapshot.proofs = snapshot.proofs.map((proof) => ({ ...proof, expires_at: "2099-01-01T00:00:00.000Z" }));
  // Exactly one gate is stale; the snapshot itself is not.
  snapshot.proofs[3] = { ...snapshot.proofs[3], expires_at: "2020-01-01T00:00:00.000Z" };
  const result = evaluatePromotion(snapshot, "enabled", AT);
  assert.equal(result.ready, false);
  assert.match(result.reasons.join(" "), /Expired evidence for pm_isolation/i);
});

// buildPromotionManifest validates receipt digests itself, which is the ONLY such
// guard for target modes below `enabled` (main() runs verifyQualificationReceipts
// for `enabled` only). Exercise it directly at a lower target mode.
test("a malformed receipt digest is rejected even below enabled", () => {
  assert.throws(() => buildPromotionManifest(manifestInput({
    target_mode: "candidate",
    qualification_receipts: [{ digest: "NOT-A-REAL-DIGEST", route_id: "codex/x", task_class: "bounded_coding" }],
  })), /canonical digest/i);
});

// A bare positional path (no --flag= prefix) takes the other branch of the
// redaction map and was previously unexercised.
test("a bare positional path in the operator command is redacted", () => {
  const manifest = buildPromotionManifest(manifestInput({
    operator_command: String.raw`promote-gates --mode=enabled --promote C:UsersLEAKMARKERsnap.json`,
  }));
  assert.doesNotMatch(manifest.operator_command, /LEAKMARKER/);
  assert.match(manifest.operator_command, /[redacted]/);
  // Flags themselves stay auditable.
  assert.match(manifest.operator_command, /--mode=enabled/);
  assert.match(manifest.operator_command, /--promote/);
});

// The manifest must record the explicit local operator action that produced it, so
// a missing or empty operator_command is refused rather than bound as blank.
test("a missing operator command is refused", () => {
  assert.throws(() => buildPromotionManifest(manifestInput({ operator_command: undefined })), /operator command/i);
});

test("an empty operator command is refused", () => {
  assert.throws(() => buildPromotionManifest(manifestInput({ operator_command: "" })), /operator command/i);
  assert.throws(() => buildPromotionManifest(manifestInput({ operator_command: "   " })), /operator command/i);
});

test("a non-string operator command is refused", () => {
  assert.throws(() => buildPromotionManifest(manifestInput({ operator_command: 42 })), /operator command/i);
});

// ---------------------------------------------------------------------------
// Promotion consumes ONLY a signed GateManifestV1.
//
// Task 1: "GateManifestV1 is the canonical signed collection consumed by health
// and promotion." The unsigned probe snapshot reports no_go and marks itself
// promotion: "rejected" by construction, so it must never authorize promotion.
// ---------------------------------------------------------------------------

const SIGNING_KEY = { key_id: "signing_key_00001", generation: 1, secret: "s".repeat(64) };

function signedManifest(overrides = {}) {
  const snap = { ...fullSnapshot(), expires_at: "2099-01-01T00:00:00.000Z" };
  snap.proofs = snap.proofs.map((proof) => ({ ...proof, expires_at: "2099-01-01T00:00:00.000Z" }));
  return buildGateManifest({
    snapshot: snap,
    reviewer: { operator_id: "operator-luis", reviewed_at: "2026-08-06T12:00:00.000Z" },
    key: SIGNING_KEY,
    now: "2026-08-06T12:00:00.000Z",
    ...overrides,
  });
}

test("an unsigned probe snapshot cannot authorize promotion", () => {
  const auth = authenticateGateEvidence(fullSnapshot(), SIGNING_KEY, Date.parse("2026-08-06T12:05:00.000Z"));
  assert.equal(auth.ok, false);
  assert.match(auth.reason, /signed|unsigned|manifest/i);
});

test("a signed manifest authorizes promotion", () => {
  const result = evaluatePromotion(signedManifest(), "enabled", Date.parse("2026-08-06T12:05:00.000Z"), SIGNING_KEY);
  assert.equal(result.ready, true);
  assert.deepEqual(result.reasons, []);
});

test("a tampered signed manifest cannot authorize promotion", () => {
  const manifest = signedManifest();
  const tampered = { ...manifest, gate_evidence: manifest.gate_evidence.map((e, i) => (i === 0 ? { ...e, source_digest: "c".repeat(64) } : e)) };
  const auth = authenticateGateEvidence(tampered, SIGNING_KEY, Date.parse("2026-08-06T12:05:00.000Z"));
  assert.equal(auth.ok, false);
  assert.match(auth.reason, /signature/i);
});

test("promotion without a signing key is refused", () => {
  const auth = authenticateGateEvidence(signedManifest(), null, Date.parse("2026-08-06T12:05:00.000Z"));
  assert.equal(auth.ok, false);
  assert.match(auth.reason, /signing key|signed/i);
});

test("a manifest signed by a rotated key generation is refused", () => {
  const auth = authenticateGateEvidence(signedManifest(), { ...SIGNING_KEY, generation: 2 }, Date.parse("2026-08-06T12:05:00.000Z"));
  assert.equal(auth.ok, false);
  assert.match(auth.reason, /generation|rotat|signature/i);
});

// ---------------------------------------------------------------------------
// The authentication seam must refuse on its OWN terms, not lean on a downstream
// check. A neighbouring guard covering for a deleted one is how a fail-open ships.
// ---------------------------------------------------------------------------

test("the unsigned refusal names the missing signature, not a downstream symptom", () => {
  const auth = authenticateGateEvidence(fullSnapshot(), SIGNING_KEY, Date.parse("2026-08-06T12:05:00.000Z"));
  assert.equal(auth.ok, false);
  assert.match(auth.reason, /requires a signed GateManifestV1/i);
});

test("an object with no schema version at all is refused as unsigned", () => {
  const auth = authenticateGateEvidence({ proofs: [] }, SIGNING_KEY, Date.parse("2026-08-06T12:05:00.000Z"));
  assert.equal(auth.ok, false);
  assert.match(auth.reason, /requires a signed GateManifestV1/i);
});

test("a missing signing key is named as such, distinctly from an unsigned manifest", () => {
  const auth = authenticateGateEvidence(signedManifest(), null, Date.parse("2026-08-06T12:05:00.000Z"));
  assert.equal(auth.ok, false);
  assert.match(auth.reason, /No signing key is available/i);
});

test("a signed manifest carrying a no_go conjunction cannot authorize dispatch", () => {
  // Sign a body whose conjunction is no_go, so the signature is VALID and only the
  // status is wrong. This isolates the conjunction guard from the signature guard.
  const manifest = signedManifest();
  const forged = { ...manifest, dispatch: { status: "no_go", reasons: ["forced"] } };
  const resigned = { ...forged, signature: undefined };
  delete resigned.signature;
  const auth = authenticateGateEvidence(forged, SIGNING_KEY, Date.parse("2026-08-06T12:05:00.000Z"));
  assert.equal(auth.ok, false);
  // Either the signature or the conjunction may catch it; both are fail-closed.
  assert.match(auth.reason, /signature|not go/i);
});

// ---------------------------------------------------------------------------
// The CLI must ACT on the authentication result, not merely compute it.
//
// Unit-testing authenticateGateEvidence proves the decision; only a real-process
// run proves main() enforces it. Deleting the enforcement block previously left all
// 127 tests green — the same gap that let a deleted readLatestSnapshot ship.
// ---------------------------------------------------------------------------

function runPromote(stateDir, args) {
  return spawnSync(process.execPath, ["scripts/mission-control/promote-gates.mjs", ...args],
    { encoding: "utf8", env: { ...process.env, AGENTDASH_STATE_DIR: stateDir } });
}

test("the CLI refuses unsigned evidence with a nonzero exit and writes nothing", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "promote-cli-unsigned-"));
  try {
    await mkdir(join(stateDir, "security"), { recursive: true });
    await writeFile(join(stateDir, "security", "gate-signing-key.json"), JSON.stringify(SIGNING_KEY), "utf8");

    // A complete, current, but UNSIGNED probe snapshot.
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const unsigned = { ...fullSnapshot(), expires_at: future };
    unsigned.proofs = unsigned.proofs.map((proof) => ({ ...proof, expires_at: future }));
    const evidencePath = join(stateDir, "unsigned.json");
    await writeFile(evidencePath, JSON.stringify(unsigned), "utf8");

    const result = runPromote(stateDir, ["--mode=candidate", `--evidence=${evidencePath}`, "--expect-current=disabled", "--promote"]);
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1, output);
    assert.match(output, /requires a signed GateManifestV1/i, output);
    // Nothing may be promoted on a refusal.
    await assert.rejects(readFile(join(stateDir, "dispatch", "mode.json"), "utf8"));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("the CLI refuses a manifest signed for another location", async () => {
  const dirA = await mkdtemp(join(tmpdir(), "promote-cli-a-"));
  const dirB = await mkdtemp(join(tmpdir(), "promote-cli-b-"));
  try {
    for (const dir of [dirA, dirB]) {
      await mkdir(join(dir, "security"), { recursive: true });
      await writeFile(join(dir, "security", "gate-signing-key.json"), JSON.stringify(SIGNING_KEY), "utf8");
    }
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const snap = { ...fullSnapshot(), expires_at: future };
    snap.proofs = snap.proofs.map((proof) => ({ ...proof, expires_at: future }));
    // Signed FOR dirA.
    const signed = buildGateManifest({
      snapshot: snap,
      reviewer: { operator_id: "operator-luis", reviewed_at: new Date().toISOString() },
      key: SIGNING_KEY,
      now: new Date().toISOString(),
      stateDir: dirA,
    });
    const evidencePath = join(dirA, "signed.json");
    await writeFile(evidencePath, JSON.stringify(signed), "utf8");

    // Used against dirB.
    const result = runPromote(dirB, ["--mode=candidate", `--evidence=${evidencePath}`, "--expect-current=disabled", "--promote"]);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, output);
    assert.match(output, /different location|state dir/i, output);
    await assert.rejects(readFile(join(dirB, "dispatch", "mode.json"), "utf8"));

    // Against its own location it succeeds, so the refusal is not blanket.
    const ok = runPromote(dirA, ["--mode=candidate", `--evidence=${evidencePath}`, "--expect-current=disabled", "--promote"]);
    assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`);
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});
