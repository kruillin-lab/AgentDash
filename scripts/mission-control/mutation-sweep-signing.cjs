// Mutation sweep for the SIGNING authority.
//
// Scope note, because an overstated coverage claim is exactly what these sweeps
// exist to catch: this file covers scripts/mission-control/*.mjs ONLY. The runtime
// dispatch path (composition.ts, dispatch-mode.ts, instrumentation.ts) is swept by
// mutation-sweep-runtime.cjs. For a while neither file covered the runtime, and the
// "24 of 24" here was a true statement about a scope that excluded the code actually
// deciding whether the live server dispatches.
//
// Run: node scripts/mission-control/mutation-sweep-signing.cjs
const { sweep, report, NODE_TEST } = require("./mutation-runner.cjs");

const SUITES = [
  "scripts/mission-control/__tests__/sign-gate-manifest.test.mjs",
  "scripts/mission-control/__tests__/promote-gates.test.mjs",
];

const TARGETS = [
  ["scripts/mission-control/sign-gate-manifest.mjs", [
    ["min secret length", "key.secret.length < MIN_SECRET_LENGTH", "false", NODE_TEST, SUITES],
    ["key id required", 'if (!IDENTIFIER.test(key.key_id ?? "")) throw new TypeError("The gate signing key requires a key id.");', "", NODE_TEST, SUITES],
    ["generation positive", "if (!Number.isSafeInteger(key.generation) || key.generation <= 0) {", "if (false) {", NODE_TEST, SUITES],
    ["named reviewer", "if (!IDENTIFIER.test(operatorId)) {", "if (false) {", NODE_TEST, SUITES],
    ["missing gate", 'if (!proof) throw new Error(`Missing gate proof for ${gateId}; a partial conjunction cannot be signed.`);', "", NODE_TEST, SUITES],
    ["gate must pass", 'if (proof.status !== "pass") throw new Error(`Gate ${gateId} did not pass; a failed conjunction cannot be signed.`);', "", NODE_TEST, SUITES],
    ["evidence digest", 'if (!SHA256.test(proof.source_digest ?? "")) throw new Error(`Malformed evidence digest for ${gateId}.`);', "", NODE_TEST, SUITES],
    ["provenance commit", 'if (!COMMIT.test(provenance.source_commit ?? "")) throw new Error(`Unknown external commit for ${gateId}.`);', "", NODE_TEST, SUITES],
    ["proof expiry", "if (typeof proof.expires_at === \"string\" && Date.parse(proof.expires_at) <= nowMs) {", "if (false) {", NODE_TEST, SUITES],
    ["snapshot expiry", 'if (typeof snapshot.expires_at === "string" && Date.parse(snapshot.expires_at) <= nowMs) {', "if (false) {", NODE_TEST, SUITES],
    ["artifact path stripped", 'artifact_path_present: typeof provenance.artifact_path === "string" && provenance.artifact_path !== "",', "artifact_path: provenance.artifact_path ?? null,", NODE_TEST, SUITES],
    ["schema version check", "if (manifest.schema_version !== GATE_MANIFEST_SCHEMA_VERSION) {", "if (false) {", NODE_TEST, SUITES],
    ["absent signature", 'if (!("signature" in manifest) || manifest.signature === undefined || manifest.signature === null) {', "if (false) {", NODE_TEST, SUITES],
    ["malformed signature", 'if (typeof manifest.signature !== "string" || !SHA256.test(manifest.signature)) {', "if (false) {", NODE_TEST, SUITES],
    ["key id match", "if (manifest.signing_key?.key_id !== key.key_id) {", "if (false) {", NODE_TEST, SUITES],
    ["generation match", "if (manifest.signing_key?.generation !== key.generation) {", "if (false) {", NODE_TEST, SUITES],
    ["constant-time compare", "if (left.length !== right.length || !timingSafeEqual(left, right)) {", "if (false) {", NODE_TEST, SUITES],
    ["manifest expiry", 'if (typeof manifest.expires_at === "string" && Date.parse(manifest.expires_at) <= nowMs) {', "if (false) {", NODE_TEST, SUITES],
    ["signed conjunction go", 'if (manifest.dispatch?.status !== "go") {', "if (false) {", NODE_TEST, SUITES],
    ["state dir binding", 'if (typeof manifest.state_dir_digest === "string") {', "if (false) {", NODE_TEST, SUITES],
    ["key file symlink guard", "if (stats.isSymbolicLink() || !stats.isFile()) {", "if (false) {", NODE_TEST, SUITES],
  ]],
  ["scripts/mission-control/promote-gates.mjs", [
    ["unsigned refusal", "if (!isSignedManifest) {", "if (false) {", NODE_TEST, SUITES],
    ["signing key required", "if (!signingKey) {", "if (false) {", NODE_TEST, SUITES],
    ["CLI enforces authentication", "if (!authenticated.ok) {", "if (false) {", NODE_TEST, SUITES],
  ]],
];

process.exitCode = report(sweep(TARGETS)) > 0 ? 1 : 0;
