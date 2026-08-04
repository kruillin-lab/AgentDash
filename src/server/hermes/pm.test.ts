import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  PM_RESPONSE_TEXT,
  PMIsolationProofV2Schema,
  PMOutputError,
  PMUnavailableError,
  VerifiedHermesExecutionReceiptV1Schema,
  capturePMRuntimeBindings,
  computePMEvidenceDigest,
  createHermesPM,
  parsePMTurnOutputForInput,
  serializePMIsolationProofSigningPayload,
  serializeVerifiedHermesReceiptSigningPayload,
  type CreateHermesPMOptions,
  type PMIsolationProofV2,
  type PMProfileEntryV2,
  type VerifiedHermesExecutionReceiptV1,
  type VerifiedHermesLaunchPort,
  type VerifiedHermesLaunchRequestV1,
} from "./pm";
import type { PMTurnInputV1 } from "../mission-control/pm-prompt";

const now = new Date("2026-08-04T10:00:00.000Z");
const inferenceModel = "gpt-5.6-terra";
const inferenceProvider = "openai";
const executableVersion = "1.2.3";
const credentialSetRef = "credential-set-7";
const credentialAttestationSha256 = "c".repeat(64);
const issuerKeyId = "pm-isolation-test-issuer";
const issuerKeys = generateKeyPairSync("ed25519");
const trustedIssuer = {
  keyId: issuerKeyId,
  publicKeyPem: issuerKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const launcherKeyId = "pm-launcher-test-issuer";
const launcherKeys = generateKeyPairSync("ed25519");
const trustedLauncher = {
  keyId: launcherKeyId,
  publicKeyPem: launcherKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
const turnInput: PMTurnInputV1 = { message: "Please implement the release checklist.", history: [], reviewed_recall: [], capability_facts: [] };
const statusTurnInput: PMTurnInputV1 = {
  message: "What is the release status and what should the plan focus on?",
  history: [],
  reviewed_recall: [{
    page_id: "release-policy",
    page_digest: "f".repeat(64),
    excerpt: "Production release requires independent verification.",
    reviewed_at: "2026-08-04T09:59:00.000Z",
  }],
  capability_facts: [{
    capability_id: "route-codex-terra",
    summary: "Candidate only; dispatch disabled.",
    available: false,
    verified_at: "2026-08-04T09:59:00.000Z",
  }],
  status_facts: [{
    status_id: "release",
    subject: "release",
    state: "in_progress",
    verified_at: "2026-08-04T09:59:00.000Z",
  }],
};
const temporaryDirectories: string[] = [];

let root: string;
let executable: string;
let profileHome: string;
let isolationProofPath: string;
let validProof: PMIsolationProofV2;
let profileEntries: PMProfileEntryV2[];
let environmentSource: Record<string, string>;

function fileDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function signedProof(proof: PMIsolationProofV2, privateKey = issuerKeys.privateKey): PMIsolationProofV2 {
  const signature = sign(null, Buffer.from(serializePMIsolationProofSigningPayload(proof), "utf8"), privateKey).toString("base64url");
  return PMIsolationProofV2Schema.parse({ ...proof, issuer: { ...proof.issuer, signature } });
}

function proposal(intent: "conversation_only" | "create_task" = "create_task", proposalId = "proposal-1") {
  return {
    schema_version: "agentdash.management-proposal/v1" as const,
    proposal_id: proposalId,
    task_id: null,
    intent,
    created_at: "2026-08-04T10:00:00.000Z",
  };
}

function signedReceipt(receipt: VerifiedHermesExecutionReceiptV1): VerifiedHermesExecutionReceiptV1 {
  const signature = sign(null, Buffer.from(serializeVerifiedHermesReceiptSigningPayload(receipt), "utf8"), launcherKeys.privateKey).toString("base64url");
  return VerifiedHermesExecutionReceiptV1Schema.parse({ ...receipt, issuer: { ...receipt.issuer, signature } });
}

type FakeLaunchPort = VerifiedHermesLaunchPort & ReturnType<typeof vi.fn>;

function fakeHermes(
  modelOutput: unknown,
  inference: Record<string, unknown> = {},
  mutateReceipt?: (receipt: VerifiedHermesExecutionReceiptV1) => void,
): FakeLaunchPort {
  const launch = vi.fn(async (request: VerifiedHermesLaunchRequestV1) => {
    const proof = PMIsolationProofV2Schema.parse(JSON.parse(request.signed_proof_json) as unknown);
    const receiptDraft = VerifiedHermesExecutionReceiptV1Schema.parse({
      schema_version: "agentdash.verified-hermes-execution-receipt/v1",
      request_id: request.request_id,
      proof_sha256: request.proof_sha256,
      invocation_sha256: request.invocation_sha256,
      turn_input_sha256: request.turn_input_sha256,
      output_sha256: computePMEvidenceDigest(modelOutput),
      executable: proof.executable,
      profile: { home: proof.profile.home, manifest_sha256: proof.profile.manifest_sha256 },
      inference: { ...proof.inference, ...inference },
      credentials: proof.credentials,
      session_ref: "pm-session-1",
      started_at: request.requested_at,
      completed_at: request.requested_at,
      issuer: { key_id: launcherKeyId, algorithm: "ed25519", signature: "A".repeat(86) },
    });
    mutateReceipt?.(receiptDraft);
    const receipt = signedReceipt(VerifiedHermesExecutionReceiptV1Schema.parse(receiptDraft));
    return { output: modelOutput, receipt };
  });
  return Object.assign(launch, { launch }) as FakeLaunchPort;
}

function pmOptions(launchPort: CreateHermesPMOptions["launchPort"], overrides: Partial<CreateHermesPMOptions> = {}): CreateHermesPMOptions {
  return {
    executable,
    allowedExecutables: [executable],
    executableVersion,
    profileHome,
    isolationProofPath,
    inferenceModel,
    inferenceProvider,
    credentialSetRef,
    credentialAttestationSha256,
    trustedIssuer,
    launchPort,
    trustedLauncher,
    environmentSource,
    now: () => now,
    ...overrides,
  };
}

async function clientTurn(pm: ReturnType<typeof createHermesPM>, input: PMTurnInputV1 = turnInput) {
  return parsePMTurnOutputForInput(input, await pm.turn(input));
}

async function persistProof(proof: PMIsolationProofV2 = validProof): Promise<void> {
  await writeFile(isolationProofPath, JSON.stringify(proof), "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agentdash-pm-test-"));
  temporaryDirectories.push(root);
  executable = join(root, process.platform === "win32" ? "hermes.exe" : "hermes");
  profileHome = join(root, "profile");
  isolationProofPath = join(root, "isolation-proof.json");
  environmentSource = { SystemRoot: "C:\\Windows", TEMP: join(root, "temp"), TMP: join(root, "tmp") };
  await writeFile(executable, "fixture-hermes-binary-v1", "utf8");
  await mkdir(profileHome);
  const profileConfig = JSON.stringify({ safe_mode: true });
  await writeFile(join(profileHome, "config.json"), profileConfig, "utf8");
  profileEntries = [{
    path: "config.json",
    type: "file",
    size: Buffer.byteLength(profileConfig),
    sha256: fileDigest(profileConfig),
    classification: "non_secret",
  }];
  const bindings = await capturePMRuntimeBindings({
    executable,
    executableVersion,
    profileHome,
    inferenceModel,
    inferenceProvider,
    credentialSetRef,
    credentialAttestationSha256,
    environmentSource,
  }, profileEntries);
  const inventoryEvidence = {
      probe_args: ["--safe-mode", "--ignore-user-config", "--ignore-rules", "prompt-size", "--platform", "cli", "--json"],
      tool_count: 0 as const,
      toolsets_breakdown: [] as Array<{ toolset: string; tool_count: 0 }>,
      runtime_binding_sha256: bindings.invocation_sha256,
      raw_receipt_sha256: "a".repeat(64),
      observed_at: "2026-08-04T09:55:00.000Z",
  };
  const sideEffectEvidence = {
      cases: ["file_write", "command_execution", "browser", "research", "delegation"] as const,
      observed_side_effects: 0 as const,
      runtime_binding_sha256: bindings.invocation_sha256,
      transcript_sha256: "b".repeat(64),
      target_receipt_sha256: "d".repeat(64),
      observed_at: "2026-08-04T09:58:00.000Z",
  };
  validProof = signedProof(PMIsolationProofV2Schema.parse({
    schema_version: "agentdash.pm-isolation-proof/v2",
    level: 5,
    status: "passed",
    run_id: "qualification-run-1",
    executable: { path: bindings.executable_path, sha256: bindings.executable_sha256, version: executableVersion },
    profile: {
      home: bindings.profile_home,
      manifest_revision: "agentdash.pm-profile-manifest/v1",
      entries: profileEntries,
      manifest_sha256: bindings.profile_manifest_sha256,
    },
    invocation: { policy_revision: "agentdash.pm-invocation/v2", sha256: bindings.invocation_sha256 },
    inventory: { evidence: inventoryEvidence, sha256: computePMEvidenceDigest(inventoryEvidence) },
    side_effects: { evidence: sideEffectEvidence, sha256: computePMEvidenceDigest(sideEffectEvidence) },
    inference: { model: inferenceModel, provider: inferenceProvider },
    credentials: { credential_set_ref: credentialSetRef, attestation_sha256: credentialAttestationSha256 },
    issuer: { key_id: issuerKeyId, algorithm: "ed25519", signature: "A".repeat(86) },
    verified_at: "2026-08-04T09:59:00.000Z",
    expires_at: "2026-08-04T10:14:00.000Z",
  }));
  await persistProof();
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("HermesPM", () => {
  // Production break caught: finite codes collapsed planning/status conversation into one
  // canned acknowledgement instead of rendering bounded facts from the exact turn input.
  test("renders a substantive proposal-only planning and status response from finite atoms", async () => {
    const run = fakeHermes({
      response_code: "conversation_acknowledged",
      conversation_atoms: [
        { kind: "planning_focus", focus: "release_readiness" },
        { kind: "status_reference", status_id: "release" },
        { kind: "recall_reference", page_id: "release-policy" },
        { kind: "capability_reference", capability_id: "route-codex-terra" },
      ],
      proposal: proposal("conversation_only"),
    });
    const pm = createHermesPM(pmOptions(run));

    await expect(clientTurn(pm, statusTurnInput)).resolves.toMatchObject({
      text: "Proposal-only planning view; no lifecycle action: Focus: release readiness. Release status: in progress. Reviewed context release-policy included. Capability route-codex-terra: unavailable.",
      session_ref: "pm-session-1",
      proposal: { intent: "conversation_only" },
    });
  });

  // Production break caught: contradictory facts for one current status subject could
  // cross the proof boundary and let exact refs produce mutually exclusive claims.
  test("rejects conflicting current status subjects before trusted launch", async () => {
    const launchPort = fakeHermes({
      response_code: "proposal_drafted",
      conversation_atoms: [],
      proposal: proposal("create_task"),
    });
    const pm = createHermesPM(pmOptions(launchPort));
    const conflictingInput: PMTurnInputV1 = {
      ...statusTurnInput,
      status_facts: [
        {
          status_id: "release-complete",
          subject: "release",
          state: "complete",
          verified_at: "2026-08-04T09:59:00.000Z",
        },
        {
          status_id: "release-blocked",
          subject: "release",
          state: "blocked",
          verified_at: "2026-08-04T09:59:00.000Z",
        },
      ],
    };

    await expect(pm.turn(conflictingInput)).rejects.toMatchObject({ name: "ZodError" });
    expect(launchPort.launch).not.toHaveBeenCalled();
  });

  test("renders fixed server-owned conversation text from a structured response code", async () => {
    const run = fakeHermes({
      response_code: "clarification_required",
      conversation_atoms: [{ kind: "clarification", field: "scope" }],
      proposal: proposal("conversation_only"),
    });
    const pm = createHermesPM(pmOptions(run));

    const input = { ...turnInput, message: "Hello, can we talk about priorities?" };
    await expect(clientTurn(pm, input)).resolves.toEqual({
      text: `${PM_RESPONSE_TEXT.clarification_required} What should be included in the project scope?`,
      session_ref: "pm-session-1",
      proposal: proposal("conversation_only"),
    });
  });

  test("renders fixed server-owned proposal text with strict create_task data", async () => {
    const run = fakeHermes({ response_code: "proposal_drafted", conversation_atoms: [], proposal: proposal("create_task", "proposal-2") });
    const pm = createHermesPM(pmOptions(run));

    await expect(clientTurn(pm)).resolves.toMatchObject({
      text: PM_RESPONSE_TEXT.proposal_drafted,
      session_ref: "pm-session-1",
      proposal: { proposal_id: "proposal-2", intent: "create_task", task_id: null },
    });
  });

  // Production break caught: the in-process adapter could replace a verified executable or
  // profile after hashing because it received caller-selected filesystem paths for spawn.
  test("never enters the path-based run adapter after proof verification", async () => {
    const launchPort = fakeHermes({ response_code: "proposal_drafted", conversation_atoms: [], proposal: proposal("create_task") });
    const pathBasedRun = vi.fn();
    const pm = createHermesPM({ ...pmOptions(launchPort), run: pathBasedRun } as unknown as CreateHermesPMOptions);

    await pm.turn(turnInput);

    expect(pathBasedRun).not.toHaveBeenCalled();
    expect(launchPort.launch).toHaveBeenCalledOnce();
  });

  test("rejects a same-size executable swap reported by the atomic launcher receipt", async () => {
    const swappedBytes = "fixture-hermes-binary-v2";
    expect(Buffer.byteLength(swappedBytes)).toBe(Buffer.byteLength("fixture-hermes-binary-v1"));
    const boundPort = fakeHermes(
      { response_code: "proposal_drafted", conversation_atoms: [], proposal: proposal("create_task") },
      {},
      (receipt) => { receipt.executable.sha256 = fileDigest(swappedBytes); },
    );
    const launchPort: VerifiedHermesLaunchPort = {
      launch: vi.fn(async (request, options) => {
        await writeFile(executable, swappedBytes, "utf8");
        return boundPort.launch(request, options);
      }),
    };
    const pm = createHermesPM(pmOptions(launchPort));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(launchPort.launch).toHaveBeenCalledOnce();
  });

  test.each([
    ["request", (receipt: VerifiedHermesExecutionReceiptV1) => { receipt.request_id = "00000000-0000-4000-8000-000000000000"; }],
    ["proof", (receipt: VerifiedHermesExecutionReceiptV1) => { receipt.proof_sha256 = "0".repeat(64); }],
    ["invocation", (receipt: VerifiedHermesExecutionReceiptV1) => { receipt.invocation_sha256 = "0".repeat(64); }],
    ["turn input", (receipt: VerifiedHermesExecutionReceiptV1) => { receipt.turn_input_sha256 = "0".repeat(64); }],
    ["output", (receipt: VerifiedHermesExecutionReceiptV1) => { receipt.output_sha256 = "0".repeat(64); }],
    ["executable", (receipt: VerifiedHermesExecutionReceiptV1) => { receipt.executable.path += ".swapped"; }],
    ["profile", (receipt: VerifiedHermesExecutionReceiptV1) => { receipt.profile.home += ".swapped"; }],
    ["model", (receipt: VerifiedHermesExecutionReceiptV1) => { receipt.inference.model = "different-model"; }],
    ["provider", (receipt: VerifiedHermesExecutionReceiptV1) => { receipt.inference.provider = "different-provider"; }],
    ["credentials", (receipt: VerifiedHermesExecutionReceiptV1) => { receipt.credentials.credential_set_ref = "different-set"; }],
  ] as const)("rejects a trusted receipt with mismatched %s identity", async (_label, mutateReceipt) => {
    const launchPort = fakeHermes(
      { response_code: "proposal_drafted", conversation_atoms: [], proposal: proposal("create_task") },
      {},
      mutateReceipt,
    );

    await expect(createHermesPM(pmOptions(launchPort)).turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
  });

  test("rejects missing, tampered-signature, and output-swapped launcher receipts", async () => {
    const output = { response_code: "proposal_drafted", conversation_atoms: [], proposal: proposal("create_task") };
    const validPort = fakeHermes(output);
    const missingReceipt: VerifiedHermesLaunchPort = {
      launch: vi.fn(async () => ({ output, receipt: undefined as never })),
    };
    const tamperedSignature: VerifiedHermesLaunchPort = {
      launch: vi.fn(async (request, options) => {
        const result = await validPort.launch(request, options);
        return { ...result, receipt: { ...result.receipt, issuer: { ...result.receipt.issuer, signature: "B".repeat(86) } } };
      }),
    };
    const swappedOutput: VerifiedHermesLaunchPort = {
      launch: vi.fn(async (request, options) => {
        const result = await validPort.launch(request, options);
        return {
          ...result,
          output: {
            response_code: "conversation_acknowledged",
            conversation_atoms: [{ kind: "planning_focus", focus: "scope" }],
            proposal: proposal("conversation_only"),
          },
        };
      }),
    };

    for (const launchPort of [missingReceipt, tamperedSignature, swappedOutput]) {
      await expect(createHermesPM(pmOptions(launchPort)).turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    }
  });

  test("rejects a receipt whose signature is not from the configured launcher issuer", async () => {
    const attackerKeys = generateKeyPairSync("ed25519");
    const launchPort = fakeHermes({ response_code: "proposal_drafted", conversation_atoms: [], proposal: proposal("create_task") });
    const pm = createHermesPM(pmOptions(launchPort, {
      trustedLauncher: {
        keyId: launcherKeyId,
        publicKeyPem: attackerKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      },
    }));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
  });

  test.each([
    "Approved. The task has been dispatched.",
    "I’ve authorized it.",
  ])("rejects every model-authored free-text authority paraphrase: %s", async (text) => {
    const run = fakeHermes({ text, proposal: proposal("create_task") });
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMOutputError);
  });

  test("rejects a model text field even when the structured response is otherwise valid", async () => {
    const run = fakeHermes({
      response_code: "proposal_drafted",
      conversation_atoms: [],
      text: "Approved.",
      proposal: proposal("create_task"),
    });

    await expect(createHermesPM(pmOptions(run)).turn(turnInput)).rejects.toBeInstanceOf(PMOutputError);
  });

  test.each([
    ["status", { kind: "status_reference", status_id: "different-status" }],
    ["recall", { kind: "recall_reference", page_id: "different-page" }],
    ["capability", { kind: "capability_reference", capability_id: "different-capability" }],
  ])("rejects a %s atom that does not exactly reference the turn input", async (_label, atom) => {
    const run = fakeHermes({
      response_code: "conversation_acknowledged",
      conversation_atoms: [atom],
      proposal: proposal("conversation_only"),
    });

    await expect(createHermesPM(pmOptions(run)).turn(statusTurnInput)).rejects.toBeInstanceOf(PMOutputError);
  });

  test.each([
    ["duplicate", [
      { kind: "planning_focus", focus: "scope" },
      { kind: "planning_focus", focus: "scope" },
    ]],
    ["conflicting", [
      { kind: "planning_focus", focus: "scope" },
      { kind: "planning_focus", focus: "risks" },
    ]],
  ])("rejects %s conversation atoms", async (_label, conversationAtoms) => {
    const run = fakeHermes({
      response_code: "conversation_acknowledged",
      conversation_atoms: conversationAtoms,
      proposal: proposal("conversation_only"),
    });

    await expect(createHermesPM(pmOptions(run)).turn(turnInput)).rejects.toBeInstanceOf(PMOutputError);
  });

  test("preserves the exact receipt-bound session reference through server rendering", async () => {
    const run = fakeHermes(
      { response_code: "proposal_drafted", conversation_atoms: [], proposal: proposal("create_task") },
      {},
      (receipt) => { receipt.session_ref = "pm-session.exact-42"; },
    );

    await expect(clientTurn(createHermesPM(pmOptions(run)))).resolves.toMatchObject({ session_ref: "pm-session.exact-42" });
  });

  test("rejects unknown response codes and code/intent mismatches", async () => {
    const unknown = createHermesPM(pmOptions(fakeHermes({ response_code: "task_authorized", proposal: proposal("create_task") })));
    const mismatched = createHermesPM(pmOptions(fakeHermes({
      response_code: "conversation_acknowledged",
      conversation_atoms: [{ kind: "planning_focus", focus: "scope" }],
      proposal: proposal("create_task"),
    })));

    await expect(unknown.turn(turnInput)).rejects.toBeInstanceOf(PMOutputError);
    await expect(mismatched.turn(turnInput)).rejects.toBeInstanceOf(PMOutputError);
  });

  test.each([
    { adapter_command: { adapter: "codeg", action: "dispatch" } },
    { approval_grant: { approved: true } },
    { authority: "ceo" },
  ])("rejects forbidden proposal fields instead of stripping them", async (forbiddenField) => {
    const run = fakeHermes({ response_code: "proposal_drafted", conversation_atoms: [], proposal: { ...proposal("create_task"), ...forbiddenField } });
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMOutputError);
  });

  test("rejects the replayable path-only V1 isolation proof before launch", async () => {
    await writeFile(isolationProofPath, JSON.stringify({
      schema_version: "agentdash.pm-isolation-proof/v1",
      level: 5,
      status: "passed",
      executable,
      profile_home: profileHome,
      verified_at: "2026-08-04T09:00:00.000Z",
      expires_at: "2026-08-04T11:00:00.000Z",
    }), "utf8");
    const run = fakeHermes({});
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(run).not.toHaveBeenCalled();
  });

  test.each([
    ["executable bytes", async () => writeFile(executable, "fixture-hermes-binary-v2", "utf8")],
    ["profile manifest", async () => writeFile(join(profileHome, "config.json"), JSON.stringify({ safe_mode: false }), "utf8")],
  ] as const)("fails closed before launch after %s drift", async (_label, mutate) => {
    await mutate();
    const run = fakeHermes({});
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(run).not.toHaveBeenCalled();
  });

  test.each([
    ["model", { inferenceModel: "different-model" }],
    ["provider", { inferenceProvider: "different-provider" }],
    ["executable version", { executableVersion: "1.2.4" }],
    ["credential attestation", { credentialAttestationSha256: "d".repeat(64) }],
  ] as const)("fails closed before launch after %s invocation drift", async (_label, override) => {
    const run = fakeHermes({});
    const pm = createHermesPM(pmOptions(run, override));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(run).not.toHaveBeenCalled();
  });

  test.each(["inventory", "invocation"] as const)("fails closed when the %s evidence digest drifts", async (field) => {
    const tampered = structuredClone(validProof);
    if (field === "inventory") tampered.inventory.sha256 = "0".repeat(64);
    else tampered.invocation.sha256 = "0".repeat(64);
    await persistProof(signedProof(tampered));
    const run = fakeHermes({});
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(run).not.toHaveBeenCalled();
  });

  test("fails closed without launching when the profile contains a sensitive file", async () => {
    const sensitivePath = join(profileHome, ".env");
    const sensitiveValue = "DO_NOT_READ_OR_HASH=this-secret";
    await writeFile(sensitivePath, sensitiveValue, "utf8");
    const run = fakeHermes({});
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(run).not.toHaveBeenCalled();
    await expect(readFile(sensitivePath, "utf8")).resolves.toBe(sensitiveValue);
  });

  test("fails closed on every profile entry not explicitly signed as non-secret", async () => {
    await writeFile(join(profileHome, "ordinary-config.json"), "secret hidden under an ordinary name", "utf8");
    const run = fakeHermes({});
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(run).not.toHaveBeenCalled();
  });

  test("rejects a well-formed proof signed by an untrusted issuer", async () => {
    const attackerKeys = generateKeyPairSync("ed25519");
    await persistProof(signedProof(validProof, attackerKeys.privateKey));
    const run = fakeHermes({});
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(run).not.toHaveBeenCalled();
  });

  test("rejects an issuer-authenticated proof whose TTL exceeds 900 seconds", async () => {
    await persistProof(signedProof({ ...validProof, expires_at: "2026-08-04T10:14:00.001Z" }));
    const run = fakeHermes({});
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(run).not.toHaveBeenCalled();
  });

  test("accepts qualification evidence at 900 seconds and rejects it one millisecond later", async () => {
    const proofWithEvidenceObservedAt = (observedAt: string): PMIsolationProofV2 => {
      const inventoryEvidence = { ...validProof.inventory.evidence, observed_at: observedAt };
      const sideEffectEvidence = { ...validProof.side_effects.evidence, observed_at: observedAt };
      return signedProof({
        ...validProof,
        inventory: { evidence: inventoryEvidence, sha256: computePMEvidenceDigest(inventoryEvidence) },
        side_effects: { evidence: sideEffectEvidence, sha256: computePMEvidenceDigest(sideEffectEvidence) },
      });
    };

    await persistProof(proofWithEvidenceObservedAt("2026-08-04T09:45:00.000Z"));
    const boundaryRun = fakeHermes({ response_code: "proposal_drafted", conversation_atoms: [], proposal: proposal("create_task") });
    const boundaryPM = createHermesPM(pmOptions(boundaryRun));
    await expect(clientTurn(boundaryPM)).resolves.toMatchObject({
      text: PM_RESPONSE_TEXT.proposal_drafted,
    });

    await persistProof(proofWithEvidenceObservedAt("2026-08-04T09:44:59.999Z"));
    const staleRun = fakeHermes({});
    await expect(createHermesPM(pmOptions(staleRun)).turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(staleRun).not.toHaveBeenCalled();
  });

  test("sends only the immutable signed proof and invocation identity to the launch port", async () => {
    const profileAlias = join(root, "profile-alias");
    await symlink(profileHome, profileAlias, process.platform === "win32" ? "junction" : "dir");
    const run = fakeHermes({ response_code: "proposal_drafted", conversation_atoms: [], proposal: proposal("create_task") });
    const pm = createHermesPM(pmOptions(run, { profileHome: profileAlias }));

    await expect(clientTurn(pm)).resolves.toMatchObject({ text: PM_RESPONSE_TEXT.proposal_drafted });
    const request = run.mock.calls[0][0] as VerifiedHermesLaunchRequestV1;
    expect(Object.keys(request).sort()).toEqual([
      "invocation_sha256",
      "proof_sha256",
      "request_id",
      "requested_at",
      "schema_version",
      "signed_proof_json",
      "turn_input_json",
      "turn_input_sha256",
    ]);
    expect(PMIsolationProofV2Schema.parse(JSON.parse(request.signed_proof_json))).toEqual(validProof);
    expect(request).not.toHaveProperty("executable");
    expect(request).not.toHaveProperty("profileHome");
    expect(request).not.toHaveProperty("args");
    expect(request).not.toHaveProperty("env");
    expect(request).not.toHaveProperty("cwd");
  });

  test("fails closed before launch when the V2 proof is stale or future-dated", async () => {
    const run = fakeHermes({});
    for (const proof of [
      { ...validProof, expires_at: "2026-08-04T09:30:00.000Z" },
      { ...validProof, verified_at: "2026-08-04T10:30:00.000Z" },
    ]) {
      await persistProof(signedProof(proof));
      const pm = createHermesPM(pmOptions(run));
      await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    }
    expect(run).not.toHaveBeenCalled();
  });

  test.each([
    ["model", { model: "different-model" }],
    ["provider", { provider: "different-provider" }],
  ] as const)("rejects a signed launcher receipt with a mismatched %s identity", async (_label, usage) => {
    const run = fakeHermes({ response_code: "proposal_drafted", conversation_atoms: [], proposal: proposal("create_task") }, usage);
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
  });

  test("maps trusted launcher failures to fixed PM unavailability", async () => {
    const launchPort = { launch: vi.fn().mockRejectedValue(new Error("launcher detail must not escape")) };
    const pm = createHermesPM(pmOptions(launchPort));

    await expect(pm.turn(turnInput)).rejects.toEqual(new PMUnavailableError());
  });
});
