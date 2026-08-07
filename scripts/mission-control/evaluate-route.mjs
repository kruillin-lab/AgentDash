import { constants as fsConstants } from "node:fs";
import { createHmac } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, isMainModule, redactDiagnostic } from "./probe-utils.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIGEST = /^[a-f0-9]{64}$/;
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const ID = /^[A-Za-z0-9._:-]{16,128}$/;
const ALLOWED_OPERATIONS = new Set(["read", "write_disposable", "execute_tests", "emit_receipt"]);
const TOP_LEVEL_KEYS = ["allowed_operations", "candidate_bridge_proofs", "ceilings", "disposable_board", "exact_route", "expires_at", "fixture_set_version", "issued_at", "level", "mode", "nonce", "operator_session_id", "origin", "route_id", "schema_version", "task_class", "workspace"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function validateUnsignedEnvelope(value) {
  const problems = [];
  if (!hasExactKeys(value, TOP_LEVEL_KEYS)) return ["Envelope has missing or unknown top-level fields."];
  if (value.schema_version !== "agentdash.qualification-envelope/v1") problems.push("Unsupported qualification envelope schema.");
  if (value.origin !== "operator_cli" || value.mode !== "qualification") problems.push("Envelope must be operator_cli qualification mode.");
  if (!ID.test(value.operator_session_id ?? "") || !ID.test(value.nonce ?? "")) problems.push("Operator session and nonce must be opaque bounded identifiers.");
  if (typeof value.route_id !== "string" || value.route_id.length === 0 || typeof value.task_class !== "string" || value.task_class.length === 0) problems.push("Route and task class are required.");
  if (![4, 5].includes(value.level)) problems.push("Qualification level must be 4 or 5.");
  if (!hasExactKeys(value.exact_route, ["agent_type", "config_digest", "mode", "model", "outer_harness", "provider"])) problems.push("Exact route tuple is malformed.");
  else if (!DIGEST.test(value.exact_route.config_digest ?? "") || ["outer_harness", "provider", "model", "agent_type", "mode"].some((key) => typeof value.exact_route[key] !== "string" || value.exact_route[key].length === 0)) problems.push("Exact route tuple is incomplete.");
  if (!hasExactKeys(value.candidate_bridge_proofs, ["codeg_commit", "hermes_commit"]) || !COMMIT.test(value.candidate_bridge_proofs?.codeg_commit ?? "") || !COMMIT.test(value.candidate_bridge_proofs?.hermes_commit ?? "")) problems.push("Candidate bridge proofs must be exact Git object IDs.");
  if (!hasExactKeys(value.disposable_board, ["board_id", "path"]) || !path.isAbsolute(value.disposable_board?.path ?? "")) problems.push("Disposable board path must be absolute.");
  if (!hasExactKeys(value.workspace, ["disposable", "path", "project_id"]) || value.workspace?.disposable !== true || !path.isAbsolute(value.workspace?.path ?? "")) problems.push("Workspace must be explicitly disposable and absolute.");
  if (!hasExactKeys(value.ceilings, ["max_cost_usd", "max_provider_tokens", "max_runtime_ms"]) || !Number.isFinite(value.ceilings?.max_cost_usd) || value.ceilings.max_cost_usd < 0 || !Number.isSafeInteger(value.ceilings?.max_runtime_ms) || value.ceilings.max_runtime_ms <= 0 || !Number.isSafeInteger(value.ceilings?.max_provider_tokens) || value.ceilings.max_provider_tokens < 0) problems.push("Qualification ceilings are malformed.");
  if (!Array.isArray(value.allowed_operations) || value.allowed_operations.length === 0 || new Set(value.allowed_operations).size !== value.allowed_operations.length || value.allowed_operations.some((operation) => !ALLOWED_OPERATIONS.has(operation))) problems.push("Allowed operations exceed the qualification allowlist.");
  const issuedAt = Date.parse(value.issued_at);
  const expiresAt = Date.parse(value.expires_at);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > 15 * 60 * 1000) problems.push("Envelope lifetime must be positive and at most 15 minutes.");
  return problems;
}

export function sealQualificationEnvelope(unsignedEnvelope, secret) {
  const problems = validateUnsignedEnvelope(unsignedEnvelope);
  if (problems.length > 0) throw new Error(problems.join(" "));
  if (typeof secret !== "string" || secret.length < 32) throw new Error("AGENTDASH_QUALIFICATION_SECRET must contain at least 32 characters.");
  return { ...unsignedEnvelope, signature: createHmac("sha256", secret).update(canonicalJson(unsignedEnvelope), "utf8").digest("hex") };
}

function comparable(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function within(parent, child) {
  const result = path.relative(comparable(parent), comparable(child));
  return result === "" || (!result.startsWith("..") && !path.isAbsolute(result));
}

async function writeExclusiveEnvelope(envelope, destination, outputRoot) {
  if (!path.isAbsolute(destination) || !path.isAbsolute(outputRoot)) throw new Error("Input/output paths and AGENTDASH_QUALIFICATION_OUT_DIR must be absolute.");
  await mkdir(outputRoot, { recursive: true });
  const canonicalRoot = await realpath(outputRoot);
  if (within(await realpath(ROOT), canonicalRoot)) throw new Error("Qualification envelopes must be written outside the repository.");
  const parent = await realpath(path.dirname(destination));
  if (!within(canonicalRoot, parent)) throw new Error("Envelope output must stay inside AGENTDASH_QUALIFICATION_OUT_DIR.");
  try {
    if ((await lstat(destination)).isSymbolicLink()) throw new Error("Envelope output cannot be a symlink or reparse point.");
    throw new Error("Envelope output already exists; overwrite is forbidden.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const handle = await open(destination, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
  try {
    await handle.writeFile(`${canonicalJson(envelope)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== "--input" || argv[2] !== "--output") throw new Error("Usage: npm run mission-control:evaluate-route -- --input <unsigned.json> --output <sealed.json>");
  return { input: path.resolve(argv[1]), output: path.resolve(argv[3]) };
}

export async function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  const { input, output } = parseArgs(argv);
  const raw = JSON.parse(await readFile(input, "utf8"));
  const envelope = sealQualificationEnvelope(raw, env.AGENTDASH_QUALIFICATION_SECRET);
  await writeExclusiveEnvelope(envelope, output, env.AGENTDASH_QUALIFICATION_OUT_DIR ?? "");
  console.error(`Sealed qualification envelope: ${output}`);
}

if (isMainModule(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Route qualification envelope rejected: ${redactDiagnostic(error?.message)}`);
    process.exitCode = 1;
  }
}
