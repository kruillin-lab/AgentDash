import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CommandTerminationError, type CommandOptions, type CommandResult } from "./command";
import {
  PM_RESPONSE_TEXT,
  PMIsolationProofV2Schema,
  PMOutputError,
  PMUnavailableError,
  capturePMRuntimeBindings,
  computePMEvidenceDigest,
  createHermesPM,
  serializePMIsolationProofSigningPayload,
  type CreateHermesPMOptions,
  type PMIsolationProofV2,
  type PMProfileEntryV2,
} from "./pm";

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
const turnInput = { message: "Please implement the release checklist.", history: [], reviewed_recall: [], capability_facts: [] };
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

function commandResult(stdout: string): CommandResult {
  return { stdout, stderr: "", code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false };
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

function fakeHermes(modelOutput: unknown, usage: Record<string, unknown> = {}) {
  return vi.fn(async (options: CommandOptions) => {
    const usageIndex = options.args.indexOf("--usage-file");
    await writeFile(options.args[usageIndex + 1], JSON.stringify({
      session_id: "pm-session-1",
      model: inferenceModel,
      provider: inferenceProvider,
      ...usage,
    }), "utf8");
    return commandResult(JSON.stringify(modelOutput));
  });
}

function pmOptions(run: CreateHermesPMOptions["run"], overrides: Partial<CreateHermesPMOptions> = {}): CreateHermesPMOptions {
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
    environmentSource,
    now: () => now,
    run,
    ...overrides,
  };
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
  test("renders fixed server-owned conversation text from a structured response code", async () => {
    const run = fakeHermes({ response_code: "clarification_required", proposal: proposal("conversation_only") });
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn({ ...turnInput, message: "Hello, can we talk about priorities?" })).resolves.toEqual({
      text: PM_RESPONSE_TEXT.clarification_required,
      session_ref: "pm-session-1",
      proposal: proposal("conversation_only"),
    });
  });

  test("renders fixed server-owned proposal text with strict create_task data", async () => {
    const run = fakeHermes({ response_code: "proposal_drafted", proposal: proposal("create_task", "proposal-2") });
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).resolves.toMatchObject({
      text: PM_RESPONSE_TEXT.proposal_drafted,
      session_ref: "pm-session-1",
      proposal: { proposal_id: "proposal-2", intent: "create_task", task_id: null },
    });
  });

  test.each([
    "Approved. The task has been dispatched.",
    "I’ve authorized it.",
  ])("rejects every model-authored free-text authority paraphrase: %s", async (text) => {
    const run = fakeHermes({ text, proposal: proposal("create_task") });
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMOutputError);
  });

  test("rejects unknown response codes and code/intent mismatches", async () => {
    const unknown = createHermesPM(pmOptions(fakeHermes({ response_code: "task_authorized", proposal: proposal("create_task") })));
    const mismatched = createHermesPM(pmOptions(fakeHermes({ response_code: "conversation_acknowledged", proposal: proposal("create_task") })));

    await expect(unknown.turn(turnInput)).rejects.toBeInstanceOf(PMOutputError);
    await expect(mismatched.turn(turnInput)).rejects.toBeInstanceOf(PMOutputError);
  });

  test.each([
    { adapter_command: { adapter: "codeg", action: "dispatch" } },
    { approval_grant: { approved: true } },
    { authority: "ceo" },
  ])("rejects forbidden proposal fields instead of stripping them", async (forbiddenField) => {
    const run = fakeHermes({ response_code: "proposal_drafted", proposal: { ...proposal("create_task"), ...forbiddenField } });
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
    const boundaryRun = fakeHermes({ response_code: "proposal_drafted", proposal: proposal("create_task") });
    await expect(createHermesPM(pmOptions(boundaryRun)).turn(turnInput)).resolves.toMatchObject({
      text: PM_RESPONSE_TEXT.proposal_drafted,
    });

    await persistProof(proofWithEvidenceObservedAt("2026-08-04T09:44:59.999Z"));
    const staleRun = fakeHermes({});
    await expect(createHermesPM(pmOptions(staleRun)).turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    expect(staleRun).not.toHaveBeenCalled();
  });

  test("launches only the canonical profile and exact environment bound by the signed invocation", async () => {
    const profileAlias = join(root, "profile-alias");
    await symlink(profileHome, profileAlias, process.platform === "win32" ? "junction" : "dir");
    const run = fakeHermes({ response_code: "proposal_drafted", proposal: proposal("create_task") });
    const pm = createHermesPM(pmOptions(run, { profileHome: profileAlias }));

    await expect(pm.turn(turnInput)).resolves.toMatchObject({ text: PM_RESPONSE_TEXT.proposal_drafted });
    const invocation = run.mock.calls[0][0];
    expect(invocation.executable).toBe(await realpath(executable));
    expect(invocation.env).toEqual({
      SystemRoot: "C:\\Windows",
      TEMP: join(root, "temp"),
      TMP: join(root, "tmp"),
      HERMES_HOME: await realpath(profileHome),
      HERMES_INFERENCE_MODEL: inferenceModel,
      HERMES_INFERENCE_PROVIDER: inferenceProvider,
    });
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
  ] as const)("rejects usage/session provenance with a mismatched %s", async (_label, usage) => {
    const run = fakeHermes({ response_code: "proposal_drafted", proposal: proposal("create_task") }, usage);
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMOutputError);
  });

  test("keeps the disposable working directory until the command boundary resolves", async () => {
    let commandOptions: CommandOptions | undefined;
    let release!: () => void;
    const held = new Promise<void>((resolveHeld) => { release = resolveHeld; });
    const run = vi.fn(async (options: CommandOptions) => {
      commandOptions = options;
      await held;
      const usageIndex = options.args.indexOf("--usage-file");
      await writeFile(options.args[usageIndex + 1], JSON.stringify({ session_id: "pm-session-1", model: inferenceModel, provider: inferenceProvider }), "utf8");
      return commandResult(JSON.stringify({ response_code: "proposal_drafted", proposal: proposal("create_task") }));
    });
    const pending = createHermesPM(pmOptions(run)).turn(turnInput);
    await vi.waitFor(() => expect(commandOptions?.cwd).toBeTruthy());

    await expect(stat(commandOptions!.cwd!)).resolves.toMatchObject({});
    release();
    await expect(pending).resolves.toMatchObject({ text: PM_RESPONSE_TEXT.proposal_drafted });
    await expect(stat(commandOptions!.cwd!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("retains the disposable directory when process-tree termination is unconfirmed", async () => {
    let commandOptions: CommandOptions | undefined;
    const run = vi.fn(async (options: CommandOptions): Promise<CommandResult> => {
      commandOptions = options;
      throw new CommandTerminationError();
    });
    const pm = createHermesPM(pmOptions(run));

    await expect(pm.turn(turnInput)).rejects.toBeInstanceOf(PMUnavailableError);
    await expect(stat(commandOptions!.cwd!)).resolves.toMatchObject({});
    await rm(commandOptions!.cwd!, { force: true, recursive: true });
  });
});
