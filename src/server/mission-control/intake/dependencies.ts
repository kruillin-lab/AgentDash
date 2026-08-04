import { unavailableHermesPM } from "../../hermes/pm";
import { unavailableServerIntakeContextPort } from "./context";
import { unavailableCEOConversationPort } from "./conversation";
import { IntakeControllerError, type IntakeControllerDependencies } from "./intake";

const unavailableHermesIntakePort: IntakeControllerDependencies["hermes"] = {
  async lookupIntake(): Promise<never> {
    throw new IntakeControllerError("intake_unavailable", "Durable intake persistence is unavailable.");
  },
  async persistIntake(): Promise<never> {
    throw new IntakeControllerError("intake_unavailable", "Durable intake persistence is unavailable.");
  },
};

/** Task 7/9 replace these fail-closed seams with qualified durable adapters. */
export function getIntakeControllerDependencies(): IntakeControllerDependencies {
  return {
    conversation: unavailableCEOConversationPort,
    context: unavailableServerIntakeContextPort,
    pm: unavailableHermesPM,
    hermes: unavailableHermesIntakePort,
  };
}
