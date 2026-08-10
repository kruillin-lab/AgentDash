import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { AdapterResultEnvelopeV1Schema, canonicalJson } from "../../../lib/mission-control/contracts";
import { RecoveryOutbox } from "./outbox";

const roots: string[] = [];
const digest = "a".repeat(64);
const envelope = AdapterResultEnvelopeV1Schema.parse({
  schema_version: "agentdash.adapter-result-envelope/v1",
  envelope_id: "event-1",
  command_id: "command-1",
  adapter: "codeg",
  result_digest: digest,
  redacted_result: { redacted: true, digest, summary: "CodeG created the bound work task." },
  observed_at: "2026-08-06T12:00:00.000Z",
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function outbox(): Promise<{ root: string; value: RecoveryOutbox }> {
  const root = await mkdtemp(join(tmpdir(), "agentdash-outbox-"));
  roots.push(root);
  return { root, value: new RecoveryOutbox({ stateDir: root }) };
}

describe("RecoveryOutbox", () => {
  test("journals one canonical immutable redacted envelope before delivery", async () => {
    const { root, value } = await outbox();

    await value.journal(envelope);

    expect(await value.pending()).toEqual([envelope]);
    expect(await readFile(join(root, "mission-control", "outbox", "pending", "event-1.json"), "utf8")).toBe(`${canonicalJson(envelope)}\n`);
  });

  test("replaying the same result is idempotent but conflicting content fails closed", async () => {
    const { value } = await outbox();
    await value.journal(envelope);

    await expect(value.journal(envelope)).resolves.toBeUndefined();
    await expect(value.journal({ ...envelope, result_digest: "b".repeat(64) })).rejects.toThrow(/conflict/i);
    expect(await value.pending()).toEqual([envelope]);
  });

  test("delivery writes a separate durable marker and startup scan omits delivered results", async () => {
    const { value } = await outbox();
    await value.journal(envelope);

    await value.markDelivered("event-1", "hermes-event-1");

    expect(await value.pending()).toEqual([]);
    expect(await new RecoveryOutbox({ stateDir: value.stateDir }).pending()).toEqual([]);
  });

  test("startup scan ignores abandoned temp files and orders pending envelopes deterministically", async () => {
    const { root, value } = await outbox();
    await value.journal({ ...envelope, envelope_id: "event-2" });
    await value.journal(envelope);
    const temp = join(root, "mission-control", "outbox", "tmp");
    await mkdir(temp, { recursive: true });
    await writeFile(join(temp, "abandoned.tmp"), "partial");

    expect((await value.pending()).map((item) => item.envelope_id)).toEqual(["event-1", "event-2"]);
    expect(await readdir(temp)).toEqual(["abandoned.tmp"]);
  });

  test("tampered or misnamed pending files stop recovery instead of being trusted", async () => {
    const { root, value } = await outbox();
    const pending = join(root, "mission-control", "outbox", "pending");
    await mkdir(pending, { recursive: true });
    await writeFile(join(pending, "other-event.json"), `${canonicalJson(envelope)}\n`);

    await expect(value.pending()).rejects.toThrow(/identity/i);
  });
});
