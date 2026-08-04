import type { ActivationSnapshotV1 } from "../../../lib/mission-control/contracts";
import { CEOCommandError, CEOCommandService } from "./ceo-command";
import { createNonceStore } from "../security/nonce-store";

export interface CommandSessionRouteDependencies {
  secret: string;
  now: () => number;
}

export interface CEOCommandRouteDependencies extends CommandSessionRouteDependencies {
  service: CEOCommandService;
}

const unavailableHermesAuthority = {
  async getActivationSnapshot(): Promise<ActivationSnapshotV1> {
    throw new CEOCommandError("activation_unavailable", "Durable activation persistence is unavailable.");
  },
  async qualifyActivation(): Promise<never> {
    throw new CEOCommandError("activation_unavailable", "Coordinated current-route qualification is unavailable.");
  },
  async lookupActivationByCommand(): Promise<never> {
    throw new CEOCommandError("activation_unavailable", "Durable activation persistence is unavailable.");
  },
  async activateMandate(): Promise<never> {
    throw new CEOCommandError("activation_unavailable", "Durable activation persistence is unavailable.");
  },
};

export function getCommandSessionRouteDependencies(): CommandSessionRouteDependencies {
  return { secret: process.env.AGENTDASH_COMMAND_SESSION_SECRET ?? "", now: Date.now };
}

/** Task 7/9 replace the fail-closed authority port with the atomic Hermes adapter. */
export function getCEOCommandRouteDependencies(): CEOCommandRouteDependencies {
  const base = getCommandSessionRouteDependencies();
  return {
    ...base,
    service: new CEOCommandService({ hermes: unavailableHermesAuthority, nonces: createNonceStore() }),
  };
}
