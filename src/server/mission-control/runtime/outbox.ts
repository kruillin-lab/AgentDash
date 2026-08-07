import "server-only";

import { randomUUID } from "node:crypto";
import { open, mkdir, readFile, readdir, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import {
  AdapterResultEnvelopeV1Schema,
  EventIdSchema,
  canonicalJson,
  type AdapterResultEnvelopeV1,
} from "../../../lib/mission-control/contracts";
import type { RecoveryOutboxPort } from "../ports";

const DeliveryMarkerSchema = z.object({
  schema_version: z.literal("agentdash.outbox-delivery/v1"),
  envelope_id: EventIdSchema,
  hermes_event_id: EventIdSchema,
}).strict();

async function exists(path: string): Promise<boolean> {
  try { await readFile(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

async function atomicCanonicalWrite(tempDir: string, destination: string, value: unknown): Promise<void> {
  const temporary = join(tempDir, `${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, destination);
  await syncDirectory(tempDir);
  await syncDirectory(join(destination, ".."));
}

function safeName(id: string): string {
  const parsed = EventIdSchema.parse(id);
  if (!/^[A-Za-z0-9_-]+$/.test(parsed)) throw new TypeError("Outbox event identity is not safe for local storage.");
  return parsed;
}

export class RecoveryOutbox implements RecoveryOutboxPort {
  readonly stateDir: string;
  private readonly root: string;
  private readonly pendingDir: string;
  private readonly deliveredDir: string;
  private readonly tempDir: string;

  constructor(options: Readonly<{ stateDir: string }>) {
    if (!isAbsolute(options.stateDir)) throw new TypeError("Recovery outbox state directory must be absolute.");
    this.stateDir = options.stateDir;
    this.root = join(options.stateDir, "mission-control", "outbox");
    this.pendingDir = join(this.root, "pending");
    this.deliveredDir = join(this.root, "delivered");
    this.tempDir = join(this.root, "tmp");
  }

  private async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.pendingDir, { recursive: true }),
      mkdir(this.deliveredDir, { recursive: true }),
      mkdir(this.tempDir, { recursive: true }),
    ]);
  }

  async journal(raw: unknown): Promise<void> {
    const envelope = AdapterResultEnvelopeV1Schema.parse(raw);
    await this.initialize();
    const destination = join(this.pendingDir, `${safeName(envelope.envelope_id)}.json`);
    if (await exists(destination)) {
      const existing = await this.readEnvelope(destination, envelope.envelope_id);
      if (canonicalJson(existing) !== canonicalJson(envelope)) throw new Error("Outbox envelope identity conflict.");
      return;
    }
    await atomicCanonicalWrite(this.tempDir, destination, envelope);
  }

  async pending(): Promise<AdapterResultEnvelopeV1[]> {
    await this.initialize();
    const names = (await readdir(this.pendingDir)).filter((name) => name.endsWith(".json")).sort();
    const result: AdapterResultEnvelopeV1[] = [];
    for (const name of names) {
      const envelopeId = name.slice(0, -5);
      safeName(envelopeId);
      if (await exists(join(this.deliveredDir, `${envelopeId}.json`))) continue;
      result.push(await this.readEnvelope(join(this.pendingDir, name), envelopeId));
    }
    return result;
  }

  async markDelivered(envelope_id: string, hermes_event_id: string): Promise<void> {
    await this.initialize();
    const envelopeId = safeName(envelope_id);
    const marker = DeliveryMarkerSchema.parse({ schema_version: "agentdash.outbox-delivery/v1", envelope_id: envelopeId, hermes_event_id });
    const destination = join(this.deliveredDir, `${envelopeId}.json`);
    if (await exists(destination)) {
      const raw = await readFile(destination, "utf8");
      const existing = DeliveryMarkerSchema.parse(JSON.parse(raw));
      if (`${canonicalJson(existing)}\n` !== raw || canonicalJson(existing) !== canonicalJson(marker)) throw new Error("Outbox delivery marker conflict.");
      return;
    }
    if (!await exists(join(this.pendingDir, `${envelopeId}.json`))) throw new Error("Outbox cannot deliver an envelope that was not journaled.");
    await atomicCanonicalWrite(this.tempDir, destination, marker);
  }

  private async readEnvelope(path: string, expectedId: string): Promise<AdapterResultEnvelopeV1> {
    const raw = await readFile(path, "utf8");
    const envelope = AdapterResultEnvelopeV1Schema.parse(JSON.parse(raw));
    if (envelope.envelope_id !== expectedId) throw new Error("Outbox envelope file identity does not match its content.");
    if (`${canonicalJson(envelope)}\n` !== raw) throw new Error("Outbox envelope is not canonical.");
    return envelope;
  }
}
