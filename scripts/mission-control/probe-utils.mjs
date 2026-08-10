import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(?:^|[._-])(token|secret|password|api[_-]?key)(?:$|[._-])/i;
const SENSITIVE_VALUE = /\b(?:authorization\s*:\s*bearer\s+\S+|bearer\s+\S+|api[_-]?key\s*[=:]\s*\S+|token\s*[=:]\s*\S+|secret\s*[=:]\s*\S+|password\s*[=:]\s*\S+|sk-[a-z0-9_-]+)/i;

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
    const withoutRedactions = value.replaceAll(REDACTED, "").trim();
    return (SENSITIVE_KEY.test(keyPath) && withoutRedactions.length > 0) || SENSITIVE_VALUE.test(withoutRedactions);
  }
  if (Array.isArray(value)) return value.some((entry, index) => containsUnredactedSecret(entry, `${keyPath}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, entry]) => containsUnredactedSecret(entry, keyPath ? `${keyPath}.${key}` : key));
  }
  return false;
}

export function sanitizeEvidence(value, keyPath = "") {
  if (typeof value === "string") {
    const sanitized = SENSITIVE_KEY.test(keyPath) && !value.includes(REDACTED) ? REDACTED : redactDiagnostic(value);
    return { value: sanitized, redacted: sanitized !== value };
  }
  if (Array.isArray(value)) {
    let redacted = false;
    const sanitized = value.map((entry, index) => {
      const result = sanitizeEvidence(entry, `${keyPath}[${index}]`);
      redacted ||= result.redacted;
      return result.value;
    });
    return { value: sanitized, redacted };
  }
  if (value && typeof value === "object") {
    let redacted = false;
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
      const result = sanitizeEvidence(entry, keyPath ? `${keyPath}.${key}` : key);
      redacted ||= result.redacted;
      sanitized[key] = result.value;
    }
    return { value: sanitized, redacted };
  }
  return { value, redacted: false };
}

export function proofDigestMaterial(proof) {
  return {
    gate_id: proof.gate_id,
    status: proof.status,
    facts: proof.facts,
    reasons: proof.reasons,
    observed_at: proof.observed_at,
    expires_at: proof.expires_at,
  };
}

export function computeProofSourceDigest(proof) {
  return sha256(canonicalJson(proofDigestMaterial(proof)));
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

export async function snapshotBinary(binaryPath) {
  const configuredPath = path.resolve(binaryPath);
  try {
    await access(configuredPath);
    const actualPath = await realpath(configuredPath);
    const details = await stat(actualPath);
    if (!details.isFile()) {
      return { path: actualPath, exists: true, sha256: null, version: null, diagnostic: "Configured path is not a file." };
    }
    const digest = await fileSha256(actualPath);
    return {
      path: actualPath,
      exists: true,
      sha256: digest,
      version: null,
      diagnostic: "Version execution disabled until artifact provenance is independently trusted.",
    };
  } catch (error) {
    return { path: configuredPath, exists: false, sha256: null, version: null, diagnostic: redactDiagnostic(error?.message) };
  }
}

export async function sourceCommit(cwd) {
  if (!cwd) return null;
  try {
    const { stdout } = await execFile("git", ["-C", cwd, "rev-parse", "HEAD"], {
      timeout: 5000,
      windowsHide: true,
      shell: false,
    });
    const commit = stdout.trim();
    return /^[a-f0-9]{40}$/i.test(commit) ? commit : null;
  } catch {
    return null;
  }
}

export function makeProbeResult({ gateId, status = "no_go", facts, reasons, now = new Date(), ttlSeconds = 900 }) {
  const observedAt = new Date(now).toISOString();
  const expiresAt = new Date(new Date(now).getTime() + ttlSeconds * 1000).toISOString();
  const sanitizedFacts = sanitizeEvidence(facts, "facts");
  const sanitizedReasons = sanitizeEvidence(reasons, "reasons");
  const redacted = sanitizedFacts.redacted || sanitizedReasons.redacted;
  const safeFacts = sanitizedFacts.value;
  if (redacted) safeFacts.redacted_evidence = true;
  const safeReasons = [...sanitizedReasons.value];
  if (redacted) safeReasons.push("Unsafe evidence was redacted before probe construction.");
  const proof = {
    gate_id: gateId,
    status: redacted ? "no_go" : status,
    facts: safeFacts,
    reasons: safeReasons,
    observed_at: observedAt,
    expires_at: expiresAt,
  };
  return { ...proof, source_digest: computeProofSourceDigest(proof) };
}

export function isMainModule(moduleUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(fileURLToPath(moduleUrl)) === normalize(argvPath);
}
