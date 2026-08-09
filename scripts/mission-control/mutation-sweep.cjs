// CRLF-safe mutation harness: replace an exact substring in a repo file, run the
// script suite, restore, and report whether the suite caught it.
const { execSync } = require("child_process");
const fs = require("fs");

const FILE = "scripts/mission-control/promote-gates.mjs";
const backup = fs.readFileSync(FILE, "utf8");

// [label, exact source substring, replacement]
const MUTATIONS = [
  ["snapshot expiry", 'reasons.push("The gate snapshot has expired; refresh the evidence before promoting.");', ""],
  ["per-proof expiry", 'reasons.push(`Expired evidence for ${proof?.gate_id ?? "unknown gate"}; refresh the evidence before promoting.`);', ""],
  ["NaN clock fallback", "const effectiveNow = Number.isFinite(now) ? now : Date.now();", "const effectiveNow = now;"],
  ["missing gate proof", 'if (!provenGateIds.has(gateId)) reasons.push(`Missing gate proof for ${gateId}.`);', ""],
  ["evidence digest shape", 'if (!SHA256.test(proof?.source_digest ?? "")) reasons.push(`Malformed evidence digest for ${proof?.gate_id ?? "unknown gate"}.`);', ""],
  ["provenance commit", "if (typeof commit !== \"string\" || !COMMIT.test(commit)) reasons.push(`Unknown external commit for ${proof?.gate_id ?? \"unknown gate\"}.`);", ""],
  ["conjunction go", 'if (snapshot.dispatch?.status !== "go") reasons.push("The gate conjunction is not go; a partial conjunction cannot be promoted.");', ""],
  ["receipt digest (manifest)", 'if (!SHA256.test(receipt?.digest ?? "")) throw new Error("Every qualification receipt must carry a canonical digest.");', ""],
  ["enabled needs receipt", 'throw new Error("Promotion to enabled requires at least one qualification receipt.");', "void 0;"],
  ["operator command required", 'throw new Error("PromotionManifestV1 requires the explicit local operator command.");', "void 0;"],
  ["argv redaction (flag)", 'return MODES.includes(value) ? token : `${flag}=[redacted]`;', "return token;"],
  ["argv redaction (positional)", 'return token.startsWith("--") || token === "promote-gates" ? token : "[redacted]";', "return token;"],
  ["artifact_path stripped", "artifact_path_present: typeof provenance.artifact_path === \"string\" && provenance.artifact_path !== \"\",", "artifact_path: provenance.artifact_path ?? null,"],
  ["auto off by default", "let autoActivation = { enabled: false,", "let autoActivation = { enabled: true,"],
  ["auto needs eligibility", "if (eligibility.eligible !== true) {", "if (false) {"],
  ["auto needs enabled mode", 'if (target_mode !== "enabled") throw new Error("Auto activation cannot be enabled for a mode below enabled.");', ""],
  ["CAS mismatch", "if (!transition.ok) throw new Error(transition.reason);", ""],
  ["CAS no-op", 'if (stored === target_mode) return { ok: false, reason: `Dispatch is already ${stored}; promotion would be a no-op.` };', ""],
  ["promote lock O_EXCL", "fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY", "fsConstants.O_CREAT | fsConstants.O_WRONLY"],
  ["record manifest digest", 'if (!SHA256.test(raw.manifest_digest ?? "")) return null;', ""],
  ["record expiry", 'if (typeof raw.expires_at === "string" && Date.parse(raw.expires_at) <= now) return null;', ""],
  ["evidence symlink guard", "if (stats.isSymbolicLink() || !stats.isFile()) {", "if (false) {"],
  ["evidence schema shape", 'throw new Error("Qualification evidence failed strict validation.");', "void 0;"],
  ["evidence expired", 'if (expiresAt < now) throw new Error("Qualification evidence has expired; re-qualify the route before promoting.");', ""],
  ["evidence not yet valid", 'if (evaluatedAt > now) throw new Error("Qualification evidence is not yet valid.");', ""],
  ["revocation supersedes", "if (superseding) throw new Error(\"The qualification route was revoked after this evidence was produced; re-qualify before promoting.\");", ""],
  ["revocations fail closed", 'if (error && error.code === "ENOENT") return [];', "return [];"],
  ["readLatestSnapshot", "export async function readLatestSnapshot(evidencePath) {", "export async function UNUSED_readLatestSnapshot(evidencePath) {"],
];

const results = [];
for (const [label, needle, replacement] of MUTATIONS) {
  if (!backup.includes(needle)) { results.push([label, "ANCHOR-MISSING"]); continue; }
  fs.writeFileSync(FILE, backup.replace(needle, replacement));
  let caught;
  try {
    execSync("node --test scripts/mission-control/__tests__/promote-gates.test.mjs", { stdio: "pipe" });
    caught = false; // suite passed => mutation NOT caught
  } catch {
    caught = true;  // suite failed => mutation caught
  }
  fs.writeFileSync(FILE, backup);
  results.push([label, caught ? "caught" : "UNCAUGHT"]);
}
fs.writeFileSync(FILE, backup);

const bad = results.filter(([, r]) => r !== "caught");
for (const [label, r] of results) if (r !== "caught") console.log(`  ${r.padEnd(15)} ${label}`);
console.log(`\n${results.length} mutations | ${results.length - bad.length} caught | ${bad.length} needing attention`);
