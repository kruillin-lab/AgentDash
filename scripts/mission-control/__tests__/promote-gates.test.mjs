import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePromotion } from "../promote-gates.mjs";

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
  const result = evaluatePromotion(fullSnapshot(), "enabled");
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
