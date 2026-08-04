import assert from "node:assert/strict";
import test from "node:test";

import { buildManifest, GATE_IDS } from "../write-gate-manifest.mjs";

const NOW = "2026-08-03T12:00:00.000Z";
const LATER = "2026-08-03T12:15:00.000Z";

function passingProof(gateId) {
  return {
    gate_id: gateId,
    status: "pass",
    facts: {
      source_commit: "a".repeat(40),
      listener_address: "127.0.0.1",
      capabilities: ["fixture-proof"],
    },
    reasons: [],
    source_digest: "b".repeat(64),
    observed_at: NOW,
    expires_at: LATER,
  };
}

function fixtureProofs() {
  return GATE_IDS.map(passingProof);
}

// Mutation caught: treating a missing proof as an implicit pass.
test("missing Hermes capability proof blocks dispatch", () => {
  const proofs = fixtureProofs().filter((proof) => proof.gate_id !== "hermes_atomicity");

  const manifest = buildManifest(proofs, { now: NOW });

  assert.equal(manifest.dispatch.status, "no_go");
  assert.match(manifest.dispatch.reasons.join("\n"), /hermes/i);
});

// Mutation caught: accepting localhost, wildcard, or LAN listener authority.
test("a non-loopback listener blocks dispatch", () => {
  const proofs = fixtureProofs();
  proofs[0].facts.listener_address = "localhost";

  const manifest = buildManifest(proofs, { now: NOW });

  assert.equal(manifest.dispatch.status, "no_go");
  assert.match(manifest.dispatch.reasons.join("\n"), /listener|loopback/i);
});

// Mutation caught: accepting source evidence from a commit other than the current one.
test("a stale source commit blocks dispatch", () => {
  const proofs = fixtureProofs();
  proofs[1].facts.current_source_commit = "c".repeat(40);

  const manifest = buildManifest(proofs, { now: NOW });

  assert.equal(manifest.dispatch.status, "no_go");
  assert.match(manifest.dispatch.reasons.join("\n"), /source commit/i);
});

// Mutation caught: allowing credentials to enter durable gate evidence.
test("an unredacted token blocks dispatch", () => {
  const proofs = fixtureProofs();
  proofs[2].facts.diagnostic = "Authorization: Bearer live-secret-token";

  const manifest = buildManifest(proofs, { now: NOW });

  assert.equal(manifest.dispatch.status, "no_go");
  assert.match(manifest.dispatch.reasons.join("\n"), /secret|credential|token/i);
});

// Mutation caught: treating an invalid ProbeResultV1 shape as usable evidence.
test("malformed evidence blocks dispatch", () => {
  const proofs = fixtureProofs();
  proofs[3].source_digest = "not-a-sha256";

  const manifest = buildManifest(proofs, { now: NOW });

  assert.equal(manifest.dispatch.status, "no_go");
  assert.match(manifest.dispatch.reasons.join("\n"), /malformed/i);
});
