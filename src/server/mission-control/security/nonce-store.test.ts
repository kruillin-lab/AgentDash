import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createNonceStore } from "./nonce-store";

const now = 1_725_000_000_000;
const temporaryDirectories: string[] = [];
const binding_digest = "a".repeat(64);

async function temporaryStateDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentdash-nonce-"));
  temporaryDirectories.push(directory);
  return directory;
}

function nonceDestination(stateDirectory: string, input: { session_id: string; nonce: string }): string {
  const identifier = createHash("sha256").update(input.session_id).update("\0").update(input.nonce).digest("hex");
  return path.join(stateDirectory, "security", `nonce-${identifier}.json`);
}

async function directoryLink(target: string, link: string): Promise<void> {
  await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("persistent nonce consumption", () => {
  test("looks up an active replay binding without creating a missing nonce record", async () => {
    const state_directory = await temporaryStateDirectory();
    const nonces = createNonceStore({ state_directory, now: () => now });
    const input = { session_id: "session-1234567890", nonce: "nonce-read-only-123", expires_at: now + 60_000, binding_digest };
    const lookup = (nonces as typeof nonces & { lookup?: (value: typeof input) => Promise<unknown> }).lookup;

    expect(lookup).toBeTypeOf("function");
    await expect(lookup!(input)).resolves.toEqual({ status: "missing" });
    await expect(nonces.consume(input)).resolves.toEqual({ status: "consumed", consumed_at: now });
    await expect(lookup!(input)).resolves.toEqual({ status: "replayed_same", consumed_at: now });
  });

  test("consumes a nonce once and then reports its replay", async () => {
    const state_directory = await temporaryStateDirectory();
    const nonces = createNonceStore({ state_directory, now: () => now });
    const input = { session_id: "session-1234567890", nonce: "nonce-1234567890", expires_at: now + 60_000, binding_digest };

    await expect(nonces.consume(input)).resolves.toEqual({ status: "consumed", consumed_at: now });
    await expect(nonces.consume(input)).resolves.toEqual({ status: "replayed_same", consumed_at: now });
  });

  test("persists a consumed nonce across store instances", async () => {
    const state_directory = await temporaryStateDirectory();
    const input = { session_id: "session-1234567890", nonce: "nonce-1234567890", expires_at: now + 60_000, binding_digest };

    await expect(createNonceStore({ state_directory, now: () => now }).consume(input)).resolves.toEqual({ status: "consumed", consumed_at: now });
    await expect(createNonceStore({ state_directory, now: () => now + 1 }).consume(input)).resolves.toEqual({ status: "replayed_same", consumed_at: now });
  });

  test("allows exactly one consumer and reports every concurrent loser as replayed", async () => {
    const state_directory = await temporaryStateDirectory();
    const input = { session_id: "session-1234567890", nonce: "nonce-concurrent-1234", expires_at: now + 60_000, binding_digest };
    const stores = Array.from({ length: 32 }, () => createNonceStore({ state_directory, now: () => now }));

    const results = await Promise.all(stores.map((store) => store.consume(input)));

    expect(results.filter((result) => result.status === "consumed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "replayed_same")).toHaveLength(stores.length - 1);
    expect(new Set(results.flatMap((result) => "consumed_at" in result ? [result.consumed_at] : []))).toEqual(new Set([now]));
  });

  test("treats a pre-existing regular nonce destination as replayed without changing it", async () => {
    const state_directory = await temporaryStateDirectory();
    const input = { session_id: "session-1234567890", nonce: "nonce-file-attack-1", expires_at: now + 60_000, binding_digest };
    const destination = nonceDestination(state_directory, input);
    const sentinel = "outside-content-must-not-change";
    await mkdir(path.dirname(destination));
    await writeFile(destination, sentinel, "utf8");

    await expect(createNonceStore({ state_directory, now: () => now }).consume(input)).resolves.toEqual({ status: "expired" });
    expect((await readFile(destination, "utf8")) === sentinel).toBe(true);
  });

  test("fails closed for an expired nonce", async () => {
    const state_directory = await temporaryStateDirectory();
    const nonces = createNonceStore({ state_directory, now: () => now });

    await expect(
      nonces.consume({ session_id: "session-1234567890", nonce: "nonce-1234567890", expires_at: now - 1, binding_digest }),
    ).resolves.toEqual({ status: "expired" });
  });

  test("rejects repository-local state without creating it", async () => {
    const state_directory = path.join(process.cwd(), ".task-2-rejected-nonce-state");
    const nonces = createNonceStore({ state_directory, now: () => now });

    await expect(
      nonces.consume({ session_id: "session-1234567890", nonce: "nonce-repo-local-01", expires_at: now + 60_000, binding_digest }),
    ).resolves.toEqual({ status: "expired" });
    let stateWasNotCreated = false;
    try {
      await lstat(state_directory);
    } catch (error) {
      stateWasNotCreated = (error as NodeJS.ErrnoException).code === "ENOENT";
    }
    expect(stateWasNotCreated).toBe(true);
  });

  test("rejects a state-root junction without changing its target", async () => {
    const temporary_root = await temporaryStateDirectory();
    const target = path.join(temporary_root, "target");
    const state_directory = path.join(temporary_root, "state-link");
    const sentinel = path.join(target, "sentinel.txt");
    await mkdir(target);
    await writeFile(sentinel, "unchanged", "utf8");
    await directoryLink(target, state_directory);

    await expect(
      createNonceStore({ state_directory, now: () => now }).consume({
        session_id: "session-1234567890",
        nonce: "nonce-state-link-01",
        expires_at: now + 60_000,
        binding_digest,
      }),
    ).resolves.toEqual({ status: "expired" });
    expect((await readFile(sentinel, "utf8")) === "unchanged").toBe(true);
  });

  test("rejects a security-directory junction without changing outside files", async () => {
    const state_directory = await temporaryStateDirectory();
    const outside = await temporaryStateDirectory();
    const sentinel = path.join(outside, "sentinel.txt");
    await writeFile(sentinel, "unchanged", "utf8");
    await directoryLink(outside, path.join(state_directory, "security"));

    await expect(
      createNonceStore({ state_directory, now: () => now }).consume({
        session_id: "session-1234567890",
        nonce: "nonce-security-link",
        expires_at: now + 60_000,
        binding_digest,
      }),
    ).resolves.toEqual({ status: "expired" });
    expect((await readFile(sentinel, "utf8")) === "unchanged").toBe(true);
  });

  test("rejects a junction at the nonce destination without changing outside files", async () => {
    const state_directory = await temporaryStateDirectory();
    const outside = await temporaryStateDirectory();
    const input = { session_id: "session-1234567890", nonce: "nonce-dest-link-001", expires_at: now + 60_000, binding_digest };
    const destination = nonceDestination(state_directory, input);
    const sentinel = path.join(outside, "sentinel.txt");
    await mkdir(path.dirname(destination));
    await writeFile(sentinel, "unchanged", "utf8");
    await directoryLink(outside, destination);

    await expect(createNonceStore({ state_directory, now: () => now }).consume(input)).resolves.toEqual({ status: "expired" });
    expect((await readFile(sentinel, "utf8")) === "unchanged").toBe(true);
  });

  test("fails closed when the security location is an ordinary file", async () => {
    const state_directory = await temporaryStateDirectory();
    const security = path.join(state_directory, "security");
    await writeFile(security, "unchanged", "utf8");

    await expect(
      createNonceStore({ state_directory, now: () => now }).consume({
        session_id: "session-1234567890",
        nonce: "nonce-io-failure-01",
        expires_at: now + 60_000,
        binding_digest,
      }),
    ).resolves.toEqual({ status: "expired" });
    expect((await readFile(security, "utf8")) === "unchanged").toBe(true);
  });

  test("binds a consumed nonce to exactly one deterministic command", async () => {
    const state_directory = await temporaryStateDirectory();
    const nonces = createNonceStore({ state_directory, now: () => now });
    const base = { session_id: "session-1234567890", nonce: "nonce-binding-1234", expires_at: now + 60_000 };

    await expect(nonces.consume({ ...base, binding_digest })).resolves.toEqual({ status: "consumed", consumed_at: now });
    await expect(nonces.consume({ ...base, binding_digest: "b".repeat(64) })).resolves.toEqual({ status: "replayed_conflict" });
  });
});
