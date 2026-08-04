import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

const execFile = promisify(execFileCallback);
const REDACTED = "[REDACTED]";
const SENSITIVE_VALUE = /\b(?:authorization\s*:\s*bearer|bearer\s+|api[_-]?key\s*[=:]|token\s*[=:]|secret\s*[=:]|password\s*[=:]|sk-[a-z0-9_-]+)/i;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function redactDiagnostic(value) {
  return String(value ?? "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/\b(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi, "$1=" + REDACTED)
    .replace(/\bsk-[a-z0-9_-]+/gi, REDACTED)
    .slice(0, 1000);
}

export function containsUnredactedSecret(value, keyPath = "") {
  if (typeof value === "string") {
    return (/(token|secret|password|api[_-]?key)/i.test(keyPath) && value !== REDACTED) || SENSITIVE_VALUE.test(value);
  }
  if (Array.isArray(value)) return value.some((entry, index) => containsUnredactedSecret(entry, `${keyPath}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, entry]) => containsUnredactedSecret(entry, keyPath ? `${keyPath}.${key}` : key));
  }
  return false;
}

export async function fileSha256(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

export async function readOnlyCommandVersion(binaryPath) {
  try {
    const { stdout, stderr } = await execFile(binaryPath, ["--version"], {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 16 * 1024,
      shell: false,
    });
    return { value: redactDiagnostic(stdout || stderr).trim() || null, diagnostic: null };
  } catch (error) {
    return { value: null, diagnostic: redactDiagnostic(error?.message) };
  }
}

export async function snapshotBinary(binaryPath) {
  const absolutePath = path.resolve(binaryPath);
  try {
    await access(absolutePath);
    const details = await stat(absolutePath);
    if (!details.isFile()) {
      return { path: absolutePath, exists: true, sha256: null, version: null, diagnostic: "Configured path is not a file." };
    }
    const [digest, version] = await Promise.all([fileSha256(absolutePath), readOnlyCommandVersion(absolutePath)]);
    return { path: absolutePath, exists: true, sha256: digest, version: version.value, diagnostic: version.diagnostic };
  } catch (error) {
    return { path: absolutePath, exists: false, sha256: null, version: null, diagnostic: redactDiagnostic(error?.message) };
  }
}

export async function sourceCommit(cwd = process.cwd()) {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd, timeout: 5000, windowsHide: true, shell: false });
    const commit = stdout.trim();
    return /^[a-f0-9]{40}$/i.test(commit) ? commit : "unknown";
  } catch {
    return "unknown";
  }
}

export function makeProbeResult({ gateId, status = "no_go", facts, reasons, now = new Date(), ttlSeconds = 900 }) {
  const observedAt = new Date(now).toISOString();
  const expiresAt = new Date(new Date(now).getTime() + ttlSeconds * 1000).toISOString();
  const safeFacts = JSON.parse(JSON.stringify(facts));
  return {
    gate_id: gateId,
    status,
    facts: safeFacts,
    reasons: reasons.map(redactDiagnostic),
    source_digest: sha256(canonicalJson({ gate_id: gateId, facts: safeFacts })),
    observed_at: observedAt,
    expires_at: expiresAt,
  };
}
