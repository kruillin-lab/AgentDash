const { execSync } = require("child_process");
const fs = require("fs");

const TARGETS = [
  ["scripts/mission-control/sign-gate-manifest.mjs", [
    ["min secret length", "key.secret.length < MIN_SECRET_LENGTH", "false"],
    ["key id required", 'if (!IDENTIFIER.test(key.key_id ?? "")) throw new TypeError("The gate signing key requires a key id.");', ""],
    ["generation positive", "if (!Number.isSafeInteger(key.generation) || key.generation <= 0) {", "if (false) {"],
    ["named reviewer", "if (!IDENTIFIER.test(operatorId)) {", "if (false) {"],
    ["missing gate", 'if (!proof) throw new Error(`Missing gate proof for ${gateId}; a partial conjunction cannot be signed.`);', ""],
    ["gate must pass", 'if (proof.status !== "pass") throw new Error(`Gate ${gateId} did not pass; a failed conjunction cannot be signed.`);', ""],
    ["evidence digest", 'if (!SHA256.test(proof.source_digest ?? "")) throw new Error(`Malformed evidence digest for ${gateId}.`);', ""],
    ["provenance commit", 'if (!COMMIT.test(provenance.source_commit ?? "")) throw new Error(`Unknown external commit for ${gateId}.`);', ""],
    ["proof expiry", "if (typeof proof.expires_at === \"string\" && Date.parse(proof.expires_at) <= nowMs) {", "if (false) {"],
    ["snapshot expiry", 'if (typeof snapshot.expires_at === "string" && Date.parse(snapshot.expires_at) <= nowMs) {', "if (false) {"],
    ["artifact path stripped", 'artifact_path_present: typeof provenance.artifact_path === "string" && provenance.artifact_path !== "",', "artifact_path: provenance.artifact_path ?? null,"],
    ["schema version check", "if (manifest.schema_version !== GATE_MANIFEST_SCHEMA_VERSION) {", "if (false) {"],
    ["absent signature", 'if (!("signature" in manifest) || manifest.signature === undefined || manifest.signature === null) {', "if (false) {"],
    ["malformed signature", 'if (typeof manifest.signature !== "string" || !SHA256.test(manifest.signature)) {', "if (false) {"],
    ["key id match", "if (manifest.signing_key?.key_id !== key.key_id) {", "if (false) {"],
    ["generation match", "if (manifest.signing_key?.generation !== key.generation) {", "if (false) {"],
    ["constant-time compare", "if (left.length !== right.length || !timingSafeEqual(left, right)) {", "if (false) {"],
    ["manifest expiry", 'if (typeof manifest.expires_at === "string" && Date.parse(manifest.expires_at) <= nowMs) {', "if (false) {"],
    ["signed conjunction go", 'if (manifest.dispatch?.status !== "go") {', "if (false) {"],
  ]],
  ["scripts/mission-control/promote-gates.mjs", [
    ["unsigned refusal", "if (!isSignedManifest) {", "if (false) {"],
    ["signing key required", "if (!signingKey) {", "if (false) {"],
  ]],
];

const results = [];
for (const [file, mutations] of TARGETS) {
  const backup = fs.readFileSync(file, "utf8");
  for (const [label, needle, replacement] of mutations) {
    if (!backup.includes(needle)) { results.push([label, "ANCHOR-MISSING"]); continue; }
    fs.writeFileSync(file, backup.replace(needle, replacement));
    let caught;
    try {
      execSync("node --test scripts/mission-control/__tests__/sign-gate-manifest.test.mjs scripts/mission-control/__tests__/promote-gates.test.mjs", { stdio: "pipe" });
      caught = false;
    } catch { caught = true; }
    fs.writeFileSync(file, backup);
    results.push([label, caught ? "caught" : "UNCAUGHT"]);
  }
  fs.writeFileSync(file, backup);
}

for (const [label, r] of results) if (r !== "caught") console.log(`  ${r.padEnd(15)} ${label}`);
const bad = results.filter(([, r]) => r !== "caught");
console.log(`\n${results.length} mutations | ${results.length - bad.length} caught | ${bad.length} needing attention`);
