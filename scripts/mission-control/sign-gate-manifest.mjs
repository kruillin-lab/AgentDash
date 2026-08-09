import { createHmac, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { canonicalJson, sha256 } from "./probe-utils.mjs";
import { GATE_IDS } from "./write-gate-manifest.mjs";

// ---------------------------------------------------------------------------
// GateManifestV1: the canonical SIGNED collection consumed by health and promotion
//
// The probe produces an `unsigned_gate_snapshot_v1`, which deliberately can never
// authorize dispatch: it reports `no_go` and tells both consumers to reject it
// until a reviewed signing authority exists. This module is that authority.
//
// Signing is a SEPARATE explicit operator action, never something the probe does
// to its own output. The probe collects evidence; a named operator reviews it and
// signs. If the same automation could mint the signature, it would attest to
// nothing — which is exactly what the unsigned snapshot's own refusal says.
//
// The signature is an HMAC-SHA256 over the canonical JSON of the unsigned manifest
// body, mirroring the qualification-envelope scheme already used for operator-signed
// canaries (routes/qualification-runner.ts) rather than inventing a second scheme.
// It attests to: every accepted gate id with its evidence digest and external
// commit/binary digest, the computed conjunction, the validity window, the named
// reviewer, and the key id/generation.
// ---------------------------------------------------------------------------

export const GATE_MANIFEST_SCHEMA_VERSION = "agentdash.gate-manifest/v1";

const SHA256 = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const IDENTIFIER = /^[A-Za-z0-9._:-]{3,128}$/;
const MIN_SECRET_LENGTH = 32;

/**
 * Bind a manifest to the exact location it was reviewed for. Normalized so the same
 * directory written differently (trailing slash, separator style, case on Windows)
 * still matches, while a genuinely different location does not.
 */
function stateDirDigest(stateDir) {
  if (typeof stateDir !== "string" || stateDir.trim() === "") return null;
  const normalized = resolve(stateDir).replace(/[\/]+$/, "").split(sep).join("/").toLowerCase();
  return sha256(normalized);
}

function requireKey(key) {
  if (typeof key !== "object" || key === null) throw new TypeError("A signing key is required.");
  if (typeof key.secret !== "string" || key.secret.length < MIN_SECRET_LENGTH) {
    throw new TypeError(`The gate signing secret must be at least ${MIN_SECRET_LENGTH} characters.`);
  }
  if (!IDENTIFIER.test(key.key_id ?? "")) throw new TypeError("The gate signing key requires a key id.");
  if (!Number.isSafeInteger(key.generation) || key.generation <= 0) {
    throw new TypeError("The gate signing key requires a positive generation.");
  }
  return key;
}

/** HMAC over the canonical unsigned body. The secret never enters the manifest. */
function computeSignature(body, key) {
  return createHmac("sha256", requireKey(key).secret).update(canonicalJson(body), "utf8").digest("hex");
}

/**
 * Build a signed GateManifestV1 from a probe snapshot a named operator has
 * reviewed. Throws rather than signing anything incomplete, failed, or stale — a
 * signature over unproven evidence is worse than no signature at all.
 */
export function buildGateManifest({ snapshot, reviewer, key, now, stateDir = null }) {
  requireKey(key);

  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
    throw new TypeError("A gate snapshot is required.");
  }
  const nowMs = typeof now === "string" ? Date.parse(now) : Number(now);
  if (!Number.isFinite(nowMs)) throw new TypeError("Signing requires an exact current timestamp.");

  const operatorId = typeof reviewer?.operator_id === "string" ? reviewer.operator_id.trim() : "";
  if (!IDENTIFIER.test(operatorId)) {
    throw new TypeError("Signing requires the named reviewing operator; automation may not sign its own evidence.");
  }

  const proofs = Array.isArray(snapshot.proofs) ? snapshot.proofs : [];
  const byGate = new Map();
  for (const proof of proofs) {
    if (typeof proof?.gate_id === "string" && !byGate.has(proof.gate_id)) byGate.set(proof.gate_id, proof);
  }

  // Every gate must be present AND passing. A partial or failed conjunction is
  // never signable; the plan requires promotion be a conjunction.
  const gateEvidence = [];
  for (const gateId of GATE_IDS) {
    const proof = byGate.get(gateId);
    if (!proof) throw new Error(`Missing gate proof for ${gateId}; a partial conjunction cannot be signed.`);
    if (proof.status !== "pass") throw new Error(`Gate ${gateId} did not pass; a failed conjunction cannot be signed.`);
    if (!SHA256.test(proof.source_digest ?? "")) throw new Error(`Malformed evidence digest for ${gateId}.`);

    const provenance = proof.facts?.provenance ?? {};
    if (!COMMIT.test(provenance.source_commit ?? "")) throw new Error(`Unknown external commit for ${gateId}.`);

    // Evidence must still be current at signing time.
    if (typeof proof.expires_at === "string" && Date.parse(proof.expires_at) <= nowMs) {
      throw new Error(`Expired evidence for ${gateId}; refresh the evidence before signing.`);
    }

    gateEvidence.push({
      gate_id: gateId,
      source_digest: proof.source_digest,
      source_commit: provenance.source_commit,
      // The binary is identified by digest; the absolute path is machine-local and
      // is never persisted into a signed, digest-addressed artifact.
      artifact_path_present: typeof provenance.artifact_path === "string" && provenance.artifact_path !== "",
      artifact_sha256: SHA256.test(provenance.artifact_sha256 ?? "") ? provenance.artifact_sha256 : proof.source_digest,
      observed_at: proof.observed_at ?? null,
      expires_at: proof.expires_at ?? null,
    });
  }

  if (typeof snapshot.expires_at === "string" && Date.parse(snapshot.expires_at) <= nowMs) {
    throw new Error("The gate snapshot has expired; refresh the evidence before signing.");
  }

  // A signed manifest never outlives the evidence it attests to.
  const expiries = gateEvidence.map((entry) => Date.parse(entry.expires_at)).filter(Number.isFinite);
  const expiresAt = expiries.length > 0 ? new Date(Math.min(...expiries)).toISOString() : snapshot.expires_at;

  const body = {
    schema_version: GATE_MANIFEST_SCHEMA_VERSION,
    snapshot_digest: sha256(canonicalJson(snapshot)),
    gate_evidence: gateEvidence,
    // The conjunction is COMPUTED here from reviewed evidence, not copied from the
    // unsigned snapshot (which is hardcoded no_go by construction).
    dispatch: { status: "go", reasons: [] },
    reviewed_by: { operator_id: operatorId, reviewed_at: typeof reviewer.reviewed_at === "string" ? reviewer.reviewed_at : new Date(nowMs).toISOString() },
    signing_key: { key_id: key.key_id, generation: key.generation },
    // Null when unbound (older callers); a bound manifest cannot be moved.
    state_dir_digest: stateDirDigest(stateDir),
    signed_at: new Date(nowMs).toISOString(),
    expires_at: expiresAt,
  };

  return { ...body, signature: computeSignature(body, key) };
}

/**
 * Verify a signed manifest. Every failure mode is distinguishable, and anything
 * unverifiable is a refusal — never a pass.
 */
export function verifyGateManifest(manifest, key, now = Date.now(), stateDir = null) {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return { ok: false, reason: "The gate manifest is not an object." };
  }
  if (manifest.schema_version !== GATE_MANIFEST_SCHEMA_VERSION) {
    return { ok: false, reason: "The gate manifest schema version is unrecognized." };
  }
  if (!("signature" in manifest) || manifest.signature === undefined || manifest.signature === null) {
    return { ok: false, reason: "The gate manifest signature is absent." };
  }
  if (typeof manifest.signature !== "string" || !SHA256.test(manifest.signature)) {
    return { ok: false, reason: "The gate manifest signature is malformed." };
  }

  let expected;
  try {
    requireKey(key);
    // A rotated key generation must invalidate manifests signed by an older one.
    if (manifest.signing_key?.key_id !== key.key_id) {
      return { ok: false, reason: "The gate manifest was signed by a different key id." };
    }
    if (manifest.signing_key?.generation !== key.generation) {
      return { ok: false, reason: "The gate manifest signing key generation was rotated." };
    }
    const { signature, ...body } = manifest;
    expected = computeSignature(body, key);
  } catch (error) {
    return { ok: false, reason: `The gate manifest could not be verified: ${error?.message ?? "unknown"}` };
  }

  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(manifest.signature, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, reason: "The gate manifest signature does not match its content." };
  }

  const nowMs = Number.isFinite(now) ? now : Date.now();
  if (typeof manifest.expires_at === "string" && Date.parse(manifest.expires_at) <= nowMs) {
    return { ok: false, reason: "The gate manifest has expired; refresh and re-sign the evidence." };
  }
  if (manifest.dispatch?.status !== "go") {
    return { ok: false, reason: "The signed gate conjunction is not go." };
  }
  // A manifest bound to one state dir may not authorize a different location.
  if (typeof manifest.state_dir_digest === "string") {
    const observed = stateDirDigest(stateDir);
    if (observed !== manifest.state_dir_digest) {
      return { ok: false, reason: "The gate manifest was signed for a different location (state dir mismatch)." };
    }
  }
  return { ok: true, reason: "The gate manifest signature and validity window verify." };
}

/**
 * Load the machine-local signing key. It lives beside the other machine-local
 * security material and is never committed. An absent key is a distinct refusal
 * from a weak one.
 */
export async function loadSigningKey(stateDir) {
  const file = join(stateDir, "security", "gate-signing-key.json");

  // The key is the most sensitive artifact here, so it gets at least the handle
  // discipline the evidence path already applies: it must be a real regular file,
  // never a symlink redirecting the read somewhere an attacker controls.
  let stats;
  try {
    stats = await lstat(file);
  } catch {
    throw new Error("No signing key is configured; unsigned evidence cannot authorize dispatch.");
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("The signing key must be an immutable regular file, never a symlink.");
  }

  let raw;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error("No signing key is configured; unsigned evidence cannot authorize dispatch.");
  }
  // Own-property reads only. JSON.parse already makes a literal "__proto__" key an own
  // data property that does not affect prototype lookup, so this is defence in depth
  // with no reachable failure today — deliberately untested rather than covered by an
  // assertion that cannot fail. It guards a future switch to a non-JSON parser.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("The signing key file is malformed.");
  }
  const own = (field) => (Object.prototype.hasOwnProperty.call(raw, field) ? raw[field] : undefined);
  return requireKey({ key_id: own("key_id"), generation: own("generation"), secret: own("secret") });
}

/** Sign a reviewed snapshot and write the manifest atomically beside the evidence. */
export async function signGateManifest({ stateDir, snapshot, reviewer, key, now }) {
  const manifest = buildGateManifest({ snapshot, reviewer, key, now, stateDir });
  const dir = join(stateDir, "evidence");
  await mkdir(dir, { recursive: true });

  const manifestPath = join(dir, `gate-manifest-${sha256(canonicalJson(manifest))}.json`);
  const temporary = `${manifestPath}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(manifest)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, manifestPath);
  return { manifest, manifest_path: manifestPath };
}
