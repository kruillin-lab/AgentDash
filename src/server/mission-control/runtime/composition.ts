import "server-only";

import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { ActionCommandRunner, CommandProposalJournal, type ActionCommandCodeG, type ActionCommandHermes } from "./action-command";
import { MissionControlController } from "./controller";
import { DispatchModeSchema, resolveDispatchMode, type DispatchMode } from "./dispatch-mode";
import { RecoveryOutbox } from "./outbox";
import { ControllerOwner } from "./owner-lock";

// ---------------------------------------------------------------------------
// Node-side composition root for the dormant controller runtime
//
// This module is `server-only` and imports Node builtins, so it must only be
// loaded from Node server code (API routes, server components, the Node
// instrumentation branch) — never from edge or client graphs. It builds the
// dormant runtime from machine-local env: exactly one process owns the
// controller lease, and the dispatch gate fails closed unless the mode is
// `enabled`. No intake route is connected yet; that arrives with later tasks.
// ---------------------------------------------------------------------------

let activeController: MissionControlController | null = null;
let starting: Promise<MissionControlController | null> | null = null;

function stateDirFromEnv(): string | null {
  const value = process.env.AGENTDASH_STATE_DIR;
  if (!value || !isAbsolute(value)) return null;
  return value;
}

/**
 * Read the durable mode written by `promote-gates --promote`. This is the record
 * produced by a compare-and-set against a proven gate conjunction and bound to a
 * PromotionManifestV1. Anything missing, unreadable, or malformed returns null,
 * which resolves to `disabled`.
 */
async function readPromotedDispatchMode(stateDir: string): Promise<DispatchMode | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(stateDir, "dispatch", "mode.json"), "utf8"));
    if (typeof raw !== "object" || raw === null) return null;
    const record = raw as { mode?: unknown; manifest_digest?: unknown; expires_at?: unknown };
    // A promotion never outlives the evidence that justified it.
    if (typeof record.expires_at === "string" && Date.parse(record.expires_at) <= Date.now()) return null;
    // Authority requires the bound manifest digest; a bare mode is not a promotion.
    if (typeof record.manifest_digest !== "string" || !/^[a-f0-9]{64}$/i.test(record.manifest_digest)) return null;
    const parsed = DispatchModeSchema.safeParse(record.mode);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// A port whose every method fails closed. Used for the dormant runtime so no
// code path can reach a worker transport before the live adapters are wired.
function dormantPort<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, property) {
      if (property === "then") return undefined;
      return () => { throw new Error(`Mission control runtime is dormant: the ${name} adapter is not connected.`); };
    },
  });
}

/**
 * Build (once) and return the dormant controller for this Node process, or null
 * when no absolute AGENTDASH_STATE_DIR is configured. The first caller acquires
 * the single controller-owner lease; later callers share the same instance.
 */
export async function getMissionControlController(): Promise<MissionControlController | null> {
  if (activeController !== null) return activeController;
  starting ??= start().catch((error: unknown) => {
    // A failed start must not poison later callers: reset so the next call can
    // retry, then surface the original failure to this caller.
    starting = null;
    throw error;
  });
  return starting;
}

async function start(): Promise<MissionControlController | null> {
  const stateDir = stateDirFromEnv();
  if (stateDir === null) return null;

  // The durable promotion record is the only thing that GRANTS authority; the env
  // var may only restrict it further (see resolveDispatchMode). A missing or
  // unreadable record reads as `disabled`, so an un-promoted system stays dormant
  // no matter what the environment claims.
  const mode = resolveDispatchMode({
    storedMode: await readPromotedDispatchMode(stateDir),
    envMode: process.env.MISSION_CONTROL_DISPATCH,
  });
  const outbox = new RecoveryOutbox({ stateDir });
  const owner = new ControllerOwner({ stateDir });
  const proposals = new CommandProposalJournal({ stateDir });
  const runner = new ActionCommandRunner({
    proposals,
    outbox,
    hermes: dormantPort<ActionCommandHermes>("Hermes"),
    codeg: dormantPort<ActionCommandCodeG>("CodeG"),
  });
  const controller = new MissionControlController({ mode, owner, outbox, runner });

  // Acquire the single scheduler lease for this process. If another live server
  // process already owns it, this process stays a non-owner and never schedules.
  await controller.start();
  activeController = controller;
  return activeController;
}

/** Release the lease and clear the cached controller (graceful shutdown). */
export async function stopMissionControlController(): Promise<void> {
  const controller = activeController;
  activeController = null;
  starting = null;
  await controller?.stop();
}
