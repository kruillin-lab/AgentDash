import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createNonceStore } from "./nonce-store";

const now = 1_725_000_000_000;
const temporaryDirectories: string[] = [];

async function temporaryStateDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentdash-nonce-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("persistent nonce consumption", () => {
  test("consumes a nonce once and then reports its replay", async () => {
    const state_directory = await temporaryStateDirectory();
    const nonces = createNonceStore({ state_directory, now: () => now });
    const input = { session_id: "session-1234567890", nonce: "nonce-1234567890", expires_at: now + 60_000 };

    await expect(nonces.consume(input)).resolves.toBe("consumed");
    await expect(nonces.consume(input)).resolves.toBe("replayed");
  });

  test("persists a consumed nonce across store instances", async () => {
    const state_directory = await temporaryStateDirectory();
    const input = { session_id: "session-1234567890", nonce: "nonce-1234567890", expires_at: now + 60_000 };

    await expect(createNonceStore({ state_directory, now: () => now }).consume(input)).resolves.toBe("consumed");
    await expect(createNonceStore({ state_directory, now: () => now }).consume(input)).resolves.toBe("replayed");
  });

  test("fails closed for an expired nonce", async () => {
    const state_directory = await temporaryStateDirectory();
    const nonces = createNonceStore({ state_directory, now: () => now });

    await expect(
      nonces.consume({ session_id: "session-1234567890", nonce: "nonce-1234567890", expires_at: now - 1 }),
    ).resolves.toBe("expired");
  });
});
