import "server-only";

import { isAbsolute } from "node:path";

import { ActionCommandRunner, CommandProposalJournal, type ActionCommandCodeG, type ActionCommandHermes } from "./action-command";
import { MissionControlController, parseDispatchMode } from "./controller";
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

  const mode = parseDispatchMode(process.env.MISSION_CONTROL_DISPATCH);
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
