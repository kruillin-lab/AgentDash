import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { CommandProposalJournal } from "./action-command";
import { MissionControlController, parseDispatchMode } from "./controller";
import { RecoveryOutbox } from "./outbox";
import { ControllerOwner } from "./owner-lock";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function stateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentdash-controller-"));
  roots.push(root);
  return root;
}

function runtime(root: string) {
  const proposals = new CommandProposalJournal({ stateDir: root });
  const outbox = new RecoveryOutbox({ stateDir: root });
  const runner = { advance: vi.fn(async () => ({ state: "found" as const, binding: null })) };
  return { proposals, outbox, runner };
}

describe("parseDispatchMode", () => {
  test("defaults to disabled for missing, empty, or unrecognized values", () => {
    expect(parseDispatchMode(undefined)).toBe("disabled");
    expect(parseDispatchMode("")).toBe("disabled");
    expect(parseDispatchMode("production")).toBe("disabled");
    expect(parseDispatchMode("ENABLED")).toBe("disabled");
  });

  test("accepts only the four exact modes", () => {
    expect(parseDispatchMode("disabled")).toBe("disabled");
    expect(parseDispatchMode("qualification")).toBe("qualification");
    expect(parseDispatchMode("candidate")).toBe("candidate");
    expect(parseDispatchMode("enabled")).toBe("enabled");
  });
});

describe("MissionControlController dispatch gate", () => {
  test("disabled mode refuses model-backed work but keeps the board read-only", async () => {
    const root = await stateRoot();
    const parts = runtime(root);
    const controller = new MissionControlController({ mode: "disabled", ...parts });

    expect(controller.gate("model_backed")).toMatchObject({ allowed: false });
    expect(controller.gate("qualification")).toMatchObject({ allowed: false });
    expect(controller.gate("candidate")).toMatchObject({ allowed: false });
    await expect(controller.advanceCommand("command-1")).rejects.toThrow(/disabled/i);
    expect(parts.runner.advance).not.toHaveBeenCalled();
  });

  test("qualification mode accepts only operator qualification envelopes, never normal dispatch", async () => {
    const root = await stateRoot();
    const controller = new MissionControlController({ mode: "qualification", ...runtime(root) });

    expect(controller.gate("qualification")).toMatchObject({ allowed: true });
    expect(controller.gate("model_backed")).toMatchObject({ allowed: false });
    expect(controller.gate("candidate")).toMatchObject({ allowed: false });
  });

  test("candidate mode accepts deterministic fixtures but not model-backed dispatch", async () => {
    const root = await stateRoot();
    const controller = new MissionControlController({ mode: "candidate", ...runtime(root) });

    expect(controller.gate("candidate")).toMatchObject({ allowed: true });
    expect(controller.gate("model_backed")).toMatchObject({ allowed: false });
  });

  test("enabled mode accepts normal model-backed dispatch", async () => {
    const root = await stateRoot();
    const parts = runtime(root);
    const controller = new MissionControlController({ mode: "enabled", owner: new ControllerOwner({ stateDir: root, pid: 101, processStartToken: "start-a" }), ...parts });

    expect(controller.gate("model_backed")).toMatchObject({ allowed: true });
    expect(await controller.start()).toBe(true);
    await expect(controller.advanceCommand("command-1")).resolves.toMatchObject({ state: "found" });
    expect(parts.runner.advance).toHaveBeenCalledWith("command-1");
    await controller.stop();
  });
});

describe("MissionControlController ownership", () => {
  test("only the owner process may schedule controller work", async () => {
    const root = await stateRoot();
    const first = new MissionControlController({ mode: "enabled", owner: new ControllerOwner({ stateDir: root, pid: 101, processStartToken: "start-a" }), ...runtime(root) });
    const secondParts = runtime(root);
    const second = new MissionControlController({ mode: "enabled", owner: new ControllerOwner({ stateDir: root, pid: 202, processStartToken: "start-b" }), ...secondParts });

    expect(await first.start()).toBe(true);
    expect(await second.start()).toBe(false);
    await expect(second.advanceCommand("command-1")).rejects.toThrow(/owner/i);
    expect(secondParts.runner.advance).not.toHaveBeenCalled();

    await first.stop();
    expect(await second.start()).toBe(true);
    await second.stop();
  });
});

describe("MissionControlController continuation", () => {
  const mandate = {
    action_nodes: [
      { node_id: "execute", action_role: "execute" as const, route_id: "route-primary" },
      { node_id: "fallback-1", action_role: "retry" as const, route_id: "route-fallback" },
    ],
    transition_graph: { execute: { transient_infrastructure: { kind: "node" as const, node_id: "fallback-1" } } },
    visit_caps: { execute: 1, "fallback-1": 1 },
    edge_visit_caps: { "execute:transient_infrastructure": 1 },
    per_action_limits: { execute: { max_cost_usd: 0.3 }, "fallback-1": { max_cost_usd: 0.3 } },
    aggregate_budget: { max_cost_usd: 1 },
    task_reserves_usd: 0.2,
  };

  test("continueTask plans a technical retry without a CEO interruption", async () => {
    const root = await stateRoot();
    const controller = new MissionControlController({ mode: "disabled", ...runtime(root) });

    const decision = controller.continueTask({
      mandate,
      node: "execute",
      outcome: "transient_infrastructure",
      visits: { node_visits: { execute: 1 }, edge_visits: {} },
      ledger: { schema_version: "agentdash.budget-ledger/v1", aggregate_limit_usd: 1, observed_cost_usd: 0, held_task_reserves_usd: 0.2, held_command_headroom_usd: 0, commands: {} },
      routeEvidence: () => "current",
    });

    expect(decision).toEqual({ kind: "schedule_action", node_id: "fallback-1" });
    expect(decision.kind).not.toBe("request_ceo_input");
  });
});

describe("MissionControlController reconciliation", () => {
  const limits = {
    dispatch_lookup: { max_attempts: 6, deadline_ms: 60_000 },
    cancel_confirmation: { max_attempts: 6, deadline_ms: 60_000 },
    orphan_recovery: { max_attempts: 12, deadline_ms: 120_000 },
    finalization: { max_attempts: 6, deadline_ms: 60_000 },
    receipt_delivery: { max_attempts: 12, deadline_ms: 120_000 },
  };

  test("reconcileTask terminalizes inconsistent on deadline expiry and blocks new work", async () => {
    const root = await stateRoot();
    const controller = new MissionControlController({ mode: "disabled", ...runtime(root) });

    const decision = controller.reconcileTask("2026-08-06T12:01:01.000Z", { category: "dispatch_lookup", started_at: "2026-08-06T12:00:00.000Z", attempts_used: 1, resolution: null }, limits);

    expect(decision).toMatchObject({ terminal: "inconsistent", allow_new_work: false });
  });
});
