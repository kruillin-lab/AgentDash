import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { z } from "zod";

import { MAX_COMMAND_SESSION_TTL_MS } from "./command-session";

const nonceInputSchema = z
  .object({
    session_id: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    expires_at: z.number().int().positive(),
    binding_digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const nonceRecordSchema = z.object({
  schema_version: z.literal("nonce_consumption_v2"),
  binding_digest: z.string().regex(/^[a-f0-9]{64}$/),
  expires_at: z.number().int().positive(),
  consumed_at: z.number().int().nonnegative(),
}).strict();
export type NonceConsumption =
  | { status: "consumed" | "replayed_same"; consumed_at: number }
  | { status: "replayed_conflict" | "expired" };

export interface NonceStore {
  consume(input: { session_id: string; nonce: string; expires_at: number; binding_digest: string }): Promise<NonceConsumption>;
}

export interface CreateNonceStoreOptions {
  state_directory?: string;
  now?: () => number;
}

interface NonceLocation {
  canonical_repository: string;
  configured_state: string;
  canonical_state: string;
  canonical_security: string;
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(comparablePath(parent), comparablePath(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function rejectReparsePoint(target: string): Promise<void> {
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error("unsafe filesystem location");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function prepareNonceLocation(stateDirectory: string): Promise<NonceLocation> {
  const configured_state = path.resolve(stateDirectory);
  const canonical_repository = await realpath(process.cwd());
  if (isWithin(canonical_repository, configured_state)) throw new Error("unsafe filesystem location");
  await rejectReparsePoint(configured_state);
  await mkdir(configured_state, { recursive: true });
  const canonical_state = await realpath(configured_state);
  if (isWithin(canonical_repository, canonical_state)) throw new Error("unsafe filesystem location");

  const security = path.join(canonical_state, "security");
  await rejectReparsePoint(security);
  await mkdir(security, { recursive: true });
  await rejectReparsePoint(security);
  const canonical_security = await realpath(security);
  if (!isWithin(canonical_state, canonical_security)) throw new Error("unsafe filesystem location");

  return { canonical_repository, configured_state, canonical_state, canonical_security };
}

async function recheckNonceLocation(location: NonceLocation): Promise<void> {
  await rejectReparsePoint(location.configured_state);
  await rejectReparsePoint(location.canonical_security);
  const [stateNow, securityNow] = await Promise.all([realpath(location.configured_state), realpath(location.canonical_security)]);
  if (
    comparablePath(stateNow) !== comparablePath(location.canonical_state) ||
    comparablePath(securityNow) !== comparablePath(location.canonical_security) ||
    !isWithin(stateNow, securityNow) ||
    isWithin(location.canonical_repository, stateNow)
  ) {
    throw new Error("unsafe filesystem location");
  }
}

function noncePath(location: NonceLocation, sessionId: string, nonce: string): string {
  const identifier = createHash("sha256").update(sessionId).update("\0").update(nonce).digest("hex");
  return path.join(location.canonical_security, `nonce-${identifier}.json`);
}

async function existingNonceResult(
  destination: string,
  location: NonceLocation,
  input: z.infer<typeof nonceInputSchema>,
  currentTime: number,
): Promise<NonceConsumption> {
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    await recheckNonceLocation(location);
    await rejectReparsePoint(destination);
    const handle = await open(destination, fsConstants.O_RDONLY | noFollow);
    try {
      const [handleStats, canonicalDestination] = await Promise.all([handle.stat(), realpath(destination)]);
      if (!handleStats.isFile() || handleStats.size <= 0 || handleStats.size > 2_048 || comparablePath(path.dirname(canonicalDestination)) !== comparablePath(location.canonical_security)) {
        return { status: "expired" };
      }
      const pathStats = await stat(canonicalDestination);
      if (handleStats.dev !== pathStats.dev || handleStats.ino !== pathStats.ino) return { status: "expired" };
      const bytes = await handle.readFile({ encoding: "utf8" });
      const record = nonceRecordSchema.safeParse(JSON.parse(bytes));
      if (!record.success
        || record.data.expires_at <= currentTime
        || record.data.expires_at !== input.expires_at
        || record.data.consumed_at > currentTime
        || record.data.consumed_at >= record.data.expires_at) return { status: "expired" };
      await recheckNonceLocation(location);
      return record.data.binding_digest === input.binding_digest
        ? { status: "replayed_same", consumed_at: record.data.consumed_at }
        : { status: "replayed_conflict" };
    } finally {
      await handle.close();
    }
  } catch {
    return { status: "expired" };
  }
}

export function createNonceStore({ state_directory = process.env.AGENTDASH_STATE_DIR, now = Date.now }: CreateNonceStoreOptions = {}): NonceStore {
  return {
    async consume(input): Promise<NonceConsumption> {
      const currentTime = now();
      const parsed = nonceInputSchema.safeParse(input);
      if (
        !Number.isSafeInteger(currentTime) ||
        !parsed.success ||
        parsed.data.expires_at <= currentTime ||
        parsed.data.expires_at - currentTime > MAX_COMMAND_SESSION_TTL_MS ||
        !state_directory
      ) {
        return { status: "expired" };
      }

      try {
        const location = await prepareNonceLocation(state_directory);
        const destination = noncePath(location, parsed.data.session_id, parsed.data.nonce);
        await recheckNonceLocation(location);
        const noFollow = fsConstants.O_NOFOLLOW ?? 0;
        const handle = await open(destination, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | noFollow, 0o600);
        try {
          if (!(await handle.stat()).isFile()) return { status: "expired" };
          await handle.writeFile(`${JSON.stringify({ schema_version: "nonce_consumption_v2", binding_digest: parsed.data.binding_digest, expires_at: parsed.data.expires_at, consumed_at: currentTime })}\n`, "utf8");
          await handle.sync();
          await recheckNonceLocation(location);
          return { status: "consumed", consumed_at: currentTime };
        } finally {
          await handle.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          try {
            const location = await prepareNonceLocation(state_directory);
            return await existingNonceResult(noncePath(location, parsed.data.session_id, parsed.data.nonce), location, parsed.data, currentTime);
          } catch {
            return { status: "expired" };
          }
        }
        return { status: "expired" };
      }
    },
  };
}
