import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

type OwnerRecord = Readonly<{
  schema_version: "agentdash.controller-owner/v1";
  pid: number;
  process_start_token: string;
  lease_id: string;
  heartbeat_at_ms: number;
}>;

export interface OwnerLease {
  readonly leaseId: string;
  heartbeat(): Promise<void>;
  release(): Promise<void>;
}

export type ControllerOwnerOptions = Readonly<{
  stateDir: string;
  pid?: number;
  processStartToken?: string;
  now?: () => number;
  staleAfterMs?: number;
  heartbeatIntervalMs?: number;
}>;

const localLeases = new Set<string>();

function ownerKey(lockDir: string, pid: number, token: string): string {
  return `${lockDir}\0${pid}\0${token}`;
}

function parseOwner(raw: string): OwnerRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<OwnerRecord>;
    if (value.schema_version !== "agentdash.controller-owner/v1"
      || !Number.isSafeInteger(value.pid) || (value.pid ?? 0) <= 0
      || typeof value.process_start_token !== "string" || value.process_start_token.length < 1
      || typeof value.lease_id !== "string" || value.lease_id.length < 1
      || !Number.isSafeInteger(value.heartbeat_at_ms) || (value.heartbeat_at_ms ?? -1) < 0) return null;
    return value as OwnerRecord;
  } catch {
    return null;
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

async function writeRecord(lockDir: string, record: OwnerRecord): Promise<void> {
  const temporary = join(lockDir, `.owner-${record.lease_id}-${randomUUID()}.tmp`);
  const destination = join(lockDir, "owner.json");
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, destination);
  await syncDirectory(lockDir);
}

async function readRecord(lockDir: string): Promise<OwnerRecord | null> {
  try { return parseOwner(await readFile(join(lockDir, "owner.json"), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sameLease(left: OwnerRecord | null, right: OwnerRecord): boolean {
  return left !== null
    && left.pid === right.pid
    && left.process_start_token === right.process_start_token
    && left.lease_id === right.lease_id;
}

export class ControllerOwner {
  private readonly stateDir: string;
  private readonly pid: number;
  private readonly processStartToken: string;
  private readonly now: () => number;
  private readonly staleAfterMs: number;
  private readonly heartbeatIntervalMs: number;

  constructor(options: ControllerOwnerOptions) {
    if (!isAbsolute(options.stateDir)) throw new TypeError("Controller owner state directory must be absolute.");
    this.stateDir = options.stateDir;
    this.pid = options.pid ?? process.pid;
    this.processStartToken = options.processStartToken ?? process.env.AGENTDASH_PROCESS_START_TOKEN ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.staleAfterMs = options.staleAfterMs ?? 30_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(1_000, Math.floor(this.staleAfterMs / 3));
    if (!Number.isSafeInteger(this.pid) || this.pid <= 0 || this.processStartToken.length < 1
      || !Number.isSafeInteger(this.staleAfterMs) || this.staleAfterMs <= 0
      || !Number.isSafeInteger(this.heartbeatIntervalMs) || this.heartbeatIntervalMs <= 0) {
      throw new TypeError("Controller owner identity and timing bounds are invalid.");
    }
  }

  async acquire(): Promise<OwnerLease | null> {
    const parent = join(this.stateDir, "mission-control");
    const lockDir = join(parent, "controller-owner");
    const key = ownerKey(lockDir, this.pid, this.processStartToken);
    if (localLeases.has(key)) return null;
    await mkdir(parent, { recursive: true });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const record: OwnerRecord = {
        schema_version: "agentdash.controller-owner/v1",
        pid: this.pid,
        process_start_token: this.processStartToken,
        lease_id: randomUUID(),
        heartbeat_at_ms: this.now(),
      };
      try {
        await mkdir(lockDir);
        await writeRecord(lockDir, record);
        await syncDirectory(parent);
        localLeases.add(key);
        return this.lease(lockDir, key, record);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }
      }

      const existing = await readRecord(lockDir);
      let heartbeatAt = existing?.heartbeat_at_ms;
      if (heartbeatAt === undefined) {
        try { heartbeatAt = Math.floor((await stat(lockDir)).mtimeMs); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
      }
      if (this.now() - heartbeatAt <= this.staleAfterMs) return null;

      const quarantine = join(dirname(lockDir), `.controller-owner-reclaim-${randomUUID()}`);
      try { await rename(lockDir, quarantine); }
      catch (error) {
        if (["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
        throw error;
      }
      await rm(quarantine, { recursive: true, force: true });
      await syncDirectory(parent);
    }
    return null;
  }

  private lease(lockDir: string, key: string, initial: OwnerRecord): OwnerLease {
    let released = false;
    let current = initial;
    const heartbeat = async (): Promise<void> => {
      if (released) throw new Error("Controller owner lease is no longer active.");
      if (!sameLease(await readRecord(lockDir), current)) throw new Error("Controller owner lease was lost.");
      current = { ...current, heartbeat_at_ms: this.now() };
      await writeRecord(lockDir, current);
    };
    const timer = setInterval(() => {
      void heartbeat().catch(() => {
        released = true;
        localLeases.delete(key);
        clearInterval(timer);
      });
    }, this.heartbeatIntervalMs);
    timer.unref();

    return {
      leaseId: initial.lease_id,
      heartbeat,
      release: async () => {
        if (released) return;
        released = true;
        clearInterval(timer);
        localLeases.delete(key);
        if (!sameLease(await readRecord(lockDir), current)) return;
        const releasedDir = join(dirname(lockDir), `.controller-owner-release-${current.lease_id}`);
        try { await rename(lockDir, releasedDir); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
          throw error;
        }
        await rm(releasedDir, { recursive: true, force: true });
        await syncDirectory(dirname(lockDir));
      },
    };
  }
}
