import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  ActionAuthorityV1Schema,
  ActionCommandV1Schema,
  CodeGBindingV1Schema,
  PrepareActionInputSchema,
  canonicalDigest,
  type PrepareActionInput,
} from "../../../lib/mission-control/contracts";
import { RecoveryOutbox } from "./outbox";
import { ActionCommandRunner, CommandProposalJournal } from "./action-command";

const roots: string[] = [];
const digest = "a".repeat(64);
const timestamp = "2026-08-06T12:00:00.000Z";
const expires = "2026-08-06T13:00:00.000Z";
const budget = { max_cost_usd: 1, max_runtime_ms: 60_000, max_attempts: 1, max_provider_tokens: 1_000 };
const reserves = { verification: "receipt-verification", finalization: "receipt-finalization", cancellation: "receipt-cancellation", reconciliation: "receipt-reconciliation" };
const binding = CodeGBindingV1Schema.parse({ work_task_id: "work-task-1", run_sequence: 1, conversation_id: "conversation-1", connection_id: "connection-1", harness_session_id: "session-1", folder_id: "folder-1" });

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function stateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentdash-command-"));
  roots.push(root);
  return root;
}

function proposal(overrides: { expiresAt?: string } = {}): PrepareActionInput {
  const authority = ActionAuthorityV1Schema.parse({
    schema_version: "agentdash.action-authority/v1",
    authority_id: "authority-1",
    task_id: "task-1",
    task_spec_revision: 1,
    task_spec_digest: digest,
    mandate_id: "mandate-1",
    mandate_digest: digest,
    node_id: "execute",
    action_role: "execute",
    executor_kind: "codeg_worker",
    route_id: "route-1",
    route_proof_id: "route-proof-1",
    route_proof_digest: digest,
    action_input_digest: digest,
    action_headroom: budget,
    task_reserve_refs: reserves,
    allowed_adapter_operation: "ensure_work",
    issued_at: timestamp,
    expires_at: overrides.expiresAt ?? expires,
  });
  const command = ActionCommandV1Schema.parse({
    schema_version: "agentdash.action-command/v1",
    command_id: "command-1",
    idempotency_key: "command-key-1",
    task_id: "task-1",
    task_spec_revision: 1,
    task_spec_digest: digest,
    mandate_id: "mandate-1",
    mandate_digest: digest,
    authority_id: "authority-1",
    authority_digest: canonicalDigest(authority),
    node_id: "execute",
    node_digest: digest,
    action_role: "execute",
    executor_kind: "codeg_worker",
    adapter_operation: "ensure_work",
    route_id: "route-1",
    route_proof_id: "route-proof-1",
    route_proof_digest: digest,
    action_input_digest: digest,
    command_headroom: budget,
    task_reserve_refs: reserves,
    state: "prepared",
    created_at: timestamp,
    issued_at: timestamp,
    submitted_at: null,
    reconciled_at: null,
    expires_at: overrides.expiresAt ?? expires,
  });
  return PrepareActionInputSchema.parse({
    task_id: "task-1",
    authority,
    command,
    command_headroom: budget,
    task_reserve_refs: Object.values(reserves),
    launch_intent_digest: digest,
  });
}

function harness(input: PrepareActionInput, options: {
  lookup?: ReturnType<typeof vi.fn>;
  ensure?: ReturnType<typeof vi.fn>;
  snapshot?: ReturnType<typeof vi.fn>;
  append?: ReturnType<typeof vi.fn>;
} = {}) {
  const prepareAction = vi.fn(async () => ({ run_id: "run-1", command: input.command, created: true }));
  const appendRunEvent = options.append ?? vi.fn(async () => undefined);
  const bindWorkerSession = vi.fn(async () => undefined);
  const lookupByCommandKey = options.lookup ?? vi.fn(async () => ({ status: "not_found" as const }));
  const ensureWork = options.ensure ?? vi.fn(async () => ({ status: "created" as const, binding }));
  const getSnapshot = options.snapshot ?? vi.fn(async () => ({ binding, terminal: false, source_commit: null, source_tree: null, raw: { redacted: true as const, digest, summary: "running" } }));
  return {
    hermes: { prepareAction, appendRunEvent, bindWorkerSession },
    codeg: { lookupByCommandKey, ensureWork, getSnapshot },
    spies: { prepareAction, appendRunEvent, bindWorkerSession, lookupByCommandKey, ensureWork, getSnapshot },
  };
}

describe("CommandProposalJournal", () => {
  test("persists the exact proposal before Hermes and reloads it after restart", async () => {
    const root = await stateRoot();
    const journal = new CommandProposalJournal({ stateDir: root });
    const input = proposal();

    await journal.stage(input);

    expect(await new CommandProposalJournal({ stateDir: root }).load("command-1")).toEqual(input);
    expect(await journal.pendingCommandIds()).toEqual(["command-1"]);
  });

  test("rejects a conflicting or tampered proposal instead of authorizing it", async () => {
    const root = await stateRoot();
    const journal = new CommandProposalJournal({ stateDir: root });
    const input = proposal();
    await journal.stage(input);
    await expect(journal.stage({ ...input, launch_intent_digest: "b".repeat(64) })).rejects.toThrow(/conflict/i);

    const path = join(root, "mission-control", "commands", "command-1.json");
    const stored = (await readFile(path, "utf8")).replace("ensure_work", "other_action");
    await writeFile(path, stored);
    await expect(journal.load("command-1")).rejects.toThrow(/digest|canonical|valid/i);
  });
});

describe("ActionCommandRunner", () => {
  test("a lost submission response is reconciled by key and is never submitted twice", async () => {
    const root = await stateRoot();
    const input = proposal();
    const journal = new CommandProposalJournal({ stateDir: root });
    await journal.stage(input);
    const lookup = vi.fn()
      .mockResolvedValueOnce({ status: "not_found" })
      .mockResolvedValueOnce({ status: "found", binding });
    const ensure = vi.fn(async () => ({ status: "unknown" as const, binding: null }));
    const parts = harness(input, { lookup, ensure });
    const runner = new ActionCommandRunner({ proposals: journal, outbox: new RecoveryOutbox({ stateDir: root }), ...parts, now: () => new Date("2026-08-06T12:01:00.000Z") });

    expect(await runner.advance("command-1")).toMatchObject({ state: "unknown" });
    expect(await runner.advance("command-1")).toMatchObject({ state: "found", binding });
    expect(parts.spies.ensureWork).toHaveBeenCalledTimes(1);
    expect(parts.spies.lookupByCommandKey).toHaveBeenNthCalledWith(2, "command-key-1");
  });

  test("an ambiguous lookup never reaches the submission transport", async () => {
    const root = await stateRoot();
    const input = proposal();
    const journal = new CommandProposalJournal({ stateDir: root });
    await journal.stage(input);
    const parts = harness(input, { lookup: vi.fn(async () => ({ status: "unknown" as const, reason: "lookup timed out" })) });
    const runner = new ActionCommandRunner({ proposals: journal, outbox: new RecoveryOutbox({ stateDir: root }), ...parts, now: () => new Date("2026-08-06T12:01:00.000Z") });

    expect(await runner.advance("command-1")).toMatchObject({ state: "unknown" });
    expect(parts.spies.ensureWork).not.toHaveBeenCalled();
  });

  test("an expired command is revoked only after authoritative proof it was not submitted", async () => {
    const root = await stateRoot();
    const input = proposal({ expiresAt: "2026-08-06T12:00:30.000Z" });
    const journal = new CommandProposalJournal({ stateDir: root });
    await journal.stage(input);
    const parts = harness(input);
    const runner = new ActionCommandRunner({ proposals: journal, outbox: new RecoveryOutbox({ stateDir: root }), ...parts, now: () => new Date("2026-08-06T12:01:00.000Z") });

    expect(await runner.advance("command-1")).toMatchObject({ state: "revoked" });
    expect(parts.spies.ensureWork).not.toHaveBeenCalled();
  });

  test("journals adapter evidence before Hermes delivery and resumes after a delivery crash", async () => {
    const root = await stateRoot();
    const input = proposal();
    const journal = new CommandProposalJournal({ stateDir: root });
    await journal.stage(input);
    const lookup = vi.fn()
      .mockResolvedValueOnce({ status: "not_found" })
      .mockResolvedValueOnce({ status: "found", binding });
    const append = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Hermes unavailable"))
      .mockResolvedValue(undefined);
    const parts = harness(input, { lookup, append });
    const outbox = new RecoveryOutbox({ stateDir: root });
    const runner = new ActionCommandRunner({ proposals: journal, outbox, ...parts, now: () => new Date("2026-08-06T12:01:00.000Z") });

    await expect(runner.advance("command-1")).rejects.toThrow("Hermes unavailable");
    expect((await outbox.pending()).length).toBe(1);

    expect(await runner.advance("command-1")).toMatchObject({ state: "found", binding });
    expect(parts.spies.ensureWork).toHaveBeenCalledTimes(1);
    expect(parts.spies.appendRunEvent.mock.invocationCallOrder[1]).toBeGreaterThan(parts.spies.ensureWork.mock.invocationCallOrder[0]);
  });

  test("reports terminal only from a bound CodeG snapshot", async () => {
    const root = await stateRoot();
    const input = proposal();
    const journal = new CommandProposalJournal({ stateDir: root });
    await journal.stage(input);
    const parts = harness(input, {
      lookup: vi.fn(async () => ({ status: "found" as const, binding })),
      snapshot: vi.fn(async () => ({ binding, terminal: true, source_commit: "b".repeat(40), source_tree: "c".repeat(40), raw: { redacted: true as const, digest, summary: "complete" } })),
    });
    const runner = new ActionCommandRunner({ proposals: journal, outbox: new RecoveryOutbox({ stateDir: root }), ...parts, now: () => new Date("2026-08-06T12:01:00.000Z") });

    expect(await runner.advance("command-1")).toMatchObject({ state: "terminal", binding });
  });

  test("a thrown submission response is reconciled by key on the next advance, never resubmitted", async () => {
    const root = await stateRoot();
    const input = proposal();
    const journal = new CommandProposalJournal({ stateDir: root });
    await journal.stage(input);
    // Round 1: lookup says the work does not exist, then the ensure transport throws
    // (a lost response, not a clean `unknown`). Round 2: lookup finds the work.
    const lookup = vi.fn()
      .mockResolvedValueOnce({ status: "not_found" })
      .mockResolvedValueOnce({ status: "found", binding });
    const ensure = vi.fn(async () => { throw new Error("connection reset"); });
    const parts = harness(input, { lookup, ensure });
    const runner = new ActionCommandRunner({ proposals: journal, outbox: new RecoveryOutbox({ stateDir: root }), ...parts, now: () => new Date("2026-08-06T12:01:00.000Z") });

    await expect(runner.advance("command-1")).rejects.toThrow("connection reset");
    expect(await runner.advance("command-1")).toMatchObject({ state: "found", binding });
    expect(parts.spies.ensureWork).toHaveBeenCalledTimes(1);
    expect(parts.spies.lookupByCommandKey).toHaveBeenNthCalledWith(2, "command-key-1");
  });

  test("a full restart over shared durable state preserves one logical command and one key", async () => {
    const root = await stateRoot();
    const input = proposal();

    // A tiny shared stand-in for CodeG's durable state across the two processes.
    const codegStore: { binding: typeof binding | null } = { binding: null };
    const makeCodeg = () => ({
      lookupByCommandKey: vi.fn(async () => (codegStore.binding ? { status: "found" as const, binding: codegStore.binding } : { status: "not_found" as const })),
      ensureWork: vi.fn(async () => { codegStore.binding = binding; return { status: "created" as const, binding }; }),
      getSnapshot: vi.fn(async () => ({ binding, terminal: false, source_commit: null, source_tree: null, raw: { redacted: true as const, digest, summary: "running" } })),
    });

    // Process 1: stage, prepare, submit, then crash after the first receipt delivery.
    const journal1 = new CommandProposalJournal({ stateDir: root });
    await journal1.stage(input);
    const append1 = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("process died"));
    const runner1 = new ActionCommandRunner({
      proposals: journal1,
      outbox: new RecoveryOutbox({ stateDir: root }),
      hermes: { prepareAction: vi.fn(async () => ({ run_id: "run-1", command: input.command, created: true })), appendRunEvent: append1, bindWorkerSession: vi.fn(async () => undefined) },
      codeg: makeCodeg(),
      now: () => new Date("2026-08-06T12:01:00.000Z"),
    });
    await expect(runner1.advance("command-1")).rejects.toThrow("process died");
    expect(codegStore.binding).not.toBeNull();

    // Process 2: brand-new journal/outbox/runner instances over the SAME state dir.
    const journal2 = new CommandProposalJournal({ stateDir: root });
    const codeg2 = makeCodeg();
    const runner2 = new ActionCommandRunner({
      proposals: journal2,
      outbox: new RecoveryOutbox({ stateDir: root }),
      hermes: { prepareAction: vi.fn(async () => ({ run_id: "run-1", command: input.command, created: false })), appendRunEvent: vi.fn(async () => undefined), bindWorkerSession: vi.fn(async () => undefined) },
      codeg: codeg2,
      now: () => new Date("2026-08-06T12:02:00.000Z"),
    });

    expect(await runner2.advance("command-1")).toMatchObject({ state: "found", binding });
    // The recovered process reconciled by the same key and never created a second command.
    expect(codeg2.ensureWork).not.toHaveBeenCalled();
    expect(codeg2.lookupByCommandKey).toHaveBeenCalledWith("command-key-1");
  });
});
