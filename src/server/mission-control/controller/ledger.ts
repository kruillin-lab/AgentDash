import "server-only";

export interface BudgetCommandReservation {
  command_id: string;
  headroom_usd: number;
  observed_cost_usd: number;
  submitted: boolean;
  state: "reserved" | "terminal" | "revoked";
}

export interface BudgetLedgerState {
  schema_version: "agentdash.budget-ledger/v1";
  aggregate_limit_usd: number;
  observed_cost_usd: number;
  held_task_reserves_usd: number;
  held_command_headroom_usd: number;
  commands: Record<string, BudgetCommandReservation>;
}

function money(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a nonnegative finite amount.`);
  return value;
}

function derive(state: BudgetLedgerState, commands: Record<string, BudgetCommandReservation>): BudgetLedgerState {
  const values = Object.values(commands);
  const observed = values.reduce((total, command) => total + command.observed_cost_usd, 0);
  const held = values.reduce((total, command) => command.state === "reserved" ? total + Math.max(0, command.headroom_usd - command.observed_cost_usd) : total, 0);
  return { ...state, commands, observed_cost_usd: observed, held_command_headroom_usd: held };
}

function requireCommand(state: BudgetLedgerState, commandId: string): BudgetCommandReservation {
  const command = state.commands[commandId];
  if (!command) throw new Error(`Unknown budget command ${commandId}.`);
  return command;
}

export const BudgetLedger = {
  create(input: { aggregate_limit_usd: number; task_reserves_usd: number }): BudgetLedgerState {
    const aggregate = money(input.aggregate_limit_usd, "aggregate limit");
    const reserves = money(input.task_reserves_usd, "task reserves");
    if (reserves > aggregate) throw new Error("Task reserves exceed the aggregate budget.");
    return { schema_version: "agentdash.budget-ledger/v1", aggregate_limit_usd: aggregate, observed_cost_usd: 0, held_task_reserves_usd: reserves, held_command_headroom_usd: 0, commands: {} };
  },

  reserve(state: BudgetLedgerState, input: { command_id: string; headroom_usd: number }): BudgetLedgerState {
    const headroom = money(input.headroom_usd, "command headroom");
    const existing = state.commands[input.command_id];
    if (existing) {
      if (existing.headroom_usd !== headroom) throw new Error("Command reservation replay conflicts with the existing headroom.");
      return state;
    }
    if (state.observed_cost_usd + state.held_task_reserves_usd + state.held_command_headroom_usd + headroom > state.aggregate_limit_usd) {
      throw new Error("Command reservation exceeds the remaining aggregate budget.");
    }
    return derive(state, { ...state.commands, [input.command_id]: { command_id: input.command_id, headroom_usd: headroom, observed_cost_usd: 0, submitted: false, state: "reserved" } });
  },

  markSubmitted(state: BudgetLedgerState, commandId: string): BudgetLedgerState {
    const command = requireCommand(state, commandId);
    if (command.state !== "reserved") throw new Error("Only a reserved command can be submitted.");
    if (command.submitted) return state;
    return derive(state, { ...state.commands, [commandId]: { ...command, submitted: true } });
  },

  observe(state: BudgetLedgerState, commandId: string, observedCostUsd: number): BudgetLedgerState {
    const command = requireCommand(state, commandId);
    const observed = money(observedCostUsd, "observed cost");
    if (observed < command.observed_cost_usd) throw new Error("Observed spend must be monotonic across restart.");
    if (observed > command.headroom_usd) throw new Error("Observed spend exceeds reserved command headroom.");
    if (observed === command.observed_cost_usd) return state;
    return derive(state, { ...state.commands, [commandId]: { ...command, observed_cost_usd: observed } });
  },

  settle(state: BudgetLedgerState, commandId: string, input: { observed_cost_usd: number; terminal: boolean }): BudgetLedgerState {
    const observed = BudgetLedger.observe(state, commandId, input.observed_cost_usd);
    if (!input.terminal) return observed;
    const command = requireCommand(observed, commandId);
    if (command.state === "terminal") return observed;
    if (command.state === "revoked") throw new Error("A revoked command cannot settle terminal.");
    return derive(observed, { ...observed.commands, [commandId]: { ...command, state: "terminal" } });
  },

  revokeUnsubmitted(state: BudgetLedgerState, commandId: string): BudgetLedgerState {
    const command = requireCommand(state, commandId);
    if (command.submitted) throw new Error("Submitted command headroom cannot be revoked as unsubmitted.");
    if (command.state === "revoked") return state;
    if (command.state === "terminal") throw new Error("Terminal command headroom cannot be revoked.");
    return derive(state, { ...state.commands, [commandId]: { ...command, state: "revoked" } });
  },
};
