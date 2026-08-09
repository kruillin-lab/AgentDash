// Mutation sweep for the PROMOTION path (evaluate, manifest, compare-and-set).
//
// Scope: scripts/mission-control/promote-gates.mjs only. The runtime dispatch path
// is swept by mutation-sweep-runtime.cjs, the signing authority by
// mutation-sweep-signing.cjs. Shared harness core in mutation-runner.cjs, which
// byte-verifies each mutation actually applied (these files are CRLF) and refuses to
// score a parse-time crash as a caught guard.
//
// Run: node scripts/mission-control/mutation-sweep.cjs
const { sweep, report, NODE_TEST } = require("./mutation-runner.cjs");

const FILE = "scripts/mission-control/promote-gates.mjs";
const SUITES = ["scripts/mission-control/__tests__/promote-gates.test.mjs"];

// [label, exact source substring, replacement]
const MUTATIONS = [
  ["snapshot expiry", 'reasons.push("The gate snapshot has expired; refresh the evidence before promoting.");', "", NODE_TEST, SUITES],
  ["per-proof expiry", 'reasons.push(`Expired evidence for ${proof?.gate_id ?? "unknown gate"}; refresh the evidence before promoting.`);', "", NODE_TEST, SUITES],
  ["NaN clock fallback", "const effectiveNow = Number.isFinite(now) ? now : Date.now();", "const effectiveNow = now;", NODE_TEST, SUITES],
  ["missing gate proof", 'if (!provenGateIds.has(gateId)) reasons.push(`Missing gate proof for ${gateId}.`);', "", NODE_TEST, SUITES],
  ["evidence digest shape", 'if (!SHA256.test(proof?.source_digest ?? "")) reasons.push(`Malformed evidence digest for ${proof?.gate_id ?? "unknown gate"}.`);', "", NODE_TEST, SUITES],
  ["provenance commit", "if (typeof commit !== \"string\" || !COMMIT.test(commit)) reasons.push(`Unknown external commit for ${proof?.gate_id ?? \"unknown gate\"}.`);", "", NODE_TEST, SUITES],
  ["conjunction go", 'if (snapshot.dispatch?.status !== "go") reasons.push("The gate conjunction is not go; a partial conjunction cannot be promoted.");', "", NODE_TEST, SUITES],
  ["receipt digest (manifest)", 'if (!SHA256.test(receipt?.digest ?? "")) throw new Error("Every qualification receipt must carry a canonical digest.");', "", NODE_TEST, SUITES],
  ["enabled needs receipt", 'throw new Error("Promotion to enabled requires at least one qualification receipt.");', "void 0;", NODE_TEST, SUITES],
  ["operator command required", 'throw new Error("PromotionManifestV1 requires the explicit local operator command.");', "void 0;", NODE_TEST, SUITES],
  ["argv redaction (flag)", 'return MODES.includes(value) ? token : `${flag}=[redacted]`;', "return token;", NODE_TEST, SUITES],
  ["argv redaction (positional)", 'return token.startsWith("--") || token === "promote-gates" ? token : "[redacted]";', "return token;", NODE_TEST, SUITES],
  ["artifact_path stripped", "artifact_path_present: typeof provenance.artifact_path === \"string\" && provenance.artifact_path !== \"\",", "artifact_path: provenance.artifact_path ?? null,", NODE_TEST, SUITES],
  ["auto off by default", "let autoActivation = { enabled: false,", "let autoActivation = { enabled: true,", NODE_TEST, SUITES],
  ["auto needs eligibility", "if (eligibility.eligible !== true) {", "if (false) {", NODE_TEST, SUITES],
  ["auto needs enabled mode", 'if (target_mode !== "enabled") throw new Error("Auto activation cannot be enabled for a mode below enabled.");', "", NODE_TEST, SUITES],
  ["CAS mismatch", "if (!transition.ok) throw new Error(transition.reason);", "", NODE_TEST, SUITES],
  ["CAS no-op", 'if (stored === target_mode) return { ok: false, reason: `Dispatch is already ${stored}; promotion would be a no-op.` };', "", NODE_TEST, SUITES],
  ["promote lock O_EXCL", "fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY", "fsConstants.O_CREAT | fsConstants.O_WRONLY", NODE_TEST, SUITES],
  ["record manifest digest", 'if (!SHA256.test(raw.manifest_digest ?? "")) return null;', "", NODE_TEST, SUITES],
  ["record expiry", 'if (typeof raw.expires_at === "string" && Date.parse(raw.expires_at) <= now) return null;', "", NODE_TEST, SUITES],
  ["evidence symlink guard", "if (stats.isSymbolicLink() || !stats.isFile()) {", "if (false) {", NODE_TEST, SUITES],
  ["evidence schema shape", 'throw new Error("Qualification evidence failed strict validation.");', "void 0;", NODE_TEST, SUITES],
  ["evidence expired", 'if (expiresAt < now) throw new Error("Qualification evidence has expired; re-qualify the route before promoting.");', "", NODE_TEST, SUITES],
  ["evidence not yet valid", 'if (evaluatedAt > now) throw new Error("Qualification evidence is not yet valid.");', "", NODE_TEST, SUITES],
  ["revocation supersedes", "if (superseding) throw new Error(\"The qualification route was revoked after this evidence was produced; re-qualify before promoting.\");", "", NODE_TEST, SUITES],
  ["revocations fail closed", 'if (error && error.code === "ENOENT") return [];', "return [];", NODE_TEST, SUITES],
  ["readLatestSnapshot", "export async function readLatestSnapshot(evidencePath) {", "export async function UNUSED_readLatestSnapshot(evidencePath) {", NODE_TEST, SUITES],
];

process.exitCode = report(sweep([[FILE, MUTATIONS]])) > 0 ? 1 : 0;
