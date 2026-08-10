import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  AdapterResultEnvelopeV1Schema,
  CommandIdSchema,
  PrepareActionInputSchema,
  canonicalDigest,
  canonicalJson,
  type ActionCommandV1,
  type AdapterResultEnvelopeV1,
  type CodeGBindingV1,
  type CommandId,
  type PrepareActionInput,
} from "../../../lib/mission-control/contracts";
import type { RecoveryOutboxPort } from "../ports";

// ---------------------------------------------------------------------------
// CommandProposalJournal
//
// A local, immutable, redacted record of the exact PrepareActionInput proposed
// for one logical command. It is written before Hermes preparation so a crash
// can be recovered, but it never authorizes work: on every advance the exact
// proposal is replayed through Hermes' idempotent `action-prepare`, and only
// Hermes' canonical returned command may reach CodeG.
// ---------------------------------------------------------------------------

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
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(id)) throw new TypeError("Command identity is not safe for local storage.");
  return id;
}

export class CommandProposalJournal {
  readonly stateDir: string;
  private readonly commandsDir: string;
  private readonly tempDir: string;

  constructor(options: Readonly<{ stateDir: string }>) {
    if (!isAbsolute(options.stateDir)) throw new TypeError("Command proposal journal state directory must be absolute.");
    this.stateDir = options.stateDir;
    this.commandsDir = join(options.stateDir, "mission-control", "commands");
    this.tempDir = join(this.commandsDir, "tmp");
  }

  private async initialize(): Promise<void> {
    await mkdir(this.commandsDir, { recursive: true });
    await mkdir(this.tempDir, { recursive: true });
  }

  private pathFor(commandId: CommandId): string {
    return join(this.commandsDir, `${safeName(commandId)}.json`);
  }

  async stage(raw: unknown): Promise<void> {
    const input = PrepareActionInputSchema.parse(raw);
    await this.initialize();
    const destination = this.pathFor(input.command.command_id);
    let existing: string | null = null;
    try { existing = await readFile(destination, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const canonical = `${canonicalJson(input)}\n`;
    if (existing !== null) {
      if (existing !== canonical) throw new Error("Command proposal conflict: a different proposal was already staged for this command.");
      return;
    }
    await atomicCanonicalWrite(this.tempDir, destination, input);
  }

  async load(commandId: string): Promise<PrepareActionInput> {
    const destination = this.pathFor(CommandIdSchema.parse(commandId));
    const raw = await readFile(destination, "utf8");
    const input = PrepareActionInputSchema.parse(JSON.parse(raw));
    if (input.command.command_id !== CommandIdSchema.parse(commandId)) throw new Error("Command proposal file identity does not match its content.");
    if (`${canonicalJson(input)}\n` !== raw) throw new Error("Command proposal is not canonical or valid.");
    return input;
  }

  async pendingCommandIds(): Promise<string[]> {
    await this.initialize();
    const names = (await readdir(this.commandsDir)).filter((name) => name.endsWith(".json")).sort();
    return names.map((name) => safeName(name.slice(0, -5)));
  }
}

// ---------------------------------------------------------------------------
// ActionCommandRunner
//
// Drives one logical command through the replay-safe state machine
//   prepared -> submitted/unknown -> found -> terminal   (or revoked)
// using the canonical command returned by Hermes and the CodeG command-key
// lookup/ensure pair. Every adapter result is journaled to the recovery
// outbox before its receipt is delivered to Hermes, so a delivery crash
// resumes from the outbox instead of repeating a mutation.
// ---------------------------------------------------------------------------

// The full ActionCommandV1 state set. The ensure-based CodeG flow never reports
// `submitted`: `ensureWork` returns a binding on every definitive success, so a
// submitted command collapses to `found`/`terminal` within a single advance.
// `submitted` remains a valid contract state for a transport that acknowledges
// submission before binding; it is declared here for completeness.
export type ActionCommandAdvanceState = "prepared" | "submitted" | "unknown" | "found" | "terminal" | "revoked";

export type ActionCommandAdvanceResult = Readonly<{
  state: ActionCommandAdvanceState;
  binding: CodeGBindingV1 | null;
}>;

// Structural dependency boundaries. Ids and digests cross the boundary as plain
// strings (branded/validated inside the runner and adapters); the real Hermes /
// CodeG ports return branded subtypes of string, so they remain assignable.
export interface ActionCommandHermes {
  prepareAction(input: PrepareActionInput): Promise<{ run_id: string; command: ActionCommandV1; created: boolean }>;
  bindWorkerSession(input: { task_id: string; run_id: string; command_id: string; binding: CodeGBindingV1 }): Promise<void>;
  appendRunEvent(input: { task_id: string; run_id: string; event_id: string; digest: string; payload: unknown }): Promise<void>;
}

export interface ActionCommandCodeG {
  lookupByCommandKey(key: string): Promise<
    | { status: "found"; binding: CodeGBindingV1 }
    | { status: "not_found" }
    | { status: "unknown"; reason: string }
  >;
  ensureWork(command: ActionCommandV1): Promise<
    | { status: "created" | "found"; binding: CodeGBindingV1 }
    | { status: "unknown"; binding: null }
  >;
  getSnapshot(binding: CodeGBindingV1): Promise<{
    binding: CodeGBindingV1;
    terminal: boolean;
    source_commit: string | null;
    source_tree: string | null;
    raw: { redacted: true; digest: string; summary: string };
  }>;
}

export type ActionCommandRunnerOptions = Readonly<{
  proposals: CommandProposalJournal;
  outbox: RecoveryOutboxPort;
  hermes: ActionCommandHermes;
  codeg: ActionCommandCodeG;
  now?: () => Date;
}>;

export class ActionCommandRunner {
  private readonly proposals: CommandProposalJournal;
  private readonly outbox: RecoveryOutboxPort;
  private readonly hermes: ActionCommandHermes;
  private readonly codeg: ActionCommandCodeG;
  private readonly now: () => Date;

  constructor(options: ActionCommandRunnerOptions) {
    this.proposals = options.proposals;
    this.outbox = options.outbox;
    this.hermes = options.hermes;
    this.codeg = options.codeg;
    this.now = options.now ?? (() => new Date());
  }

  async advance(commandId: string): Promise<ActionCommandAdvanceResult> {
    const input = await this.proposals.load(commandId);
    // Replay the exact staged proposal through Hermes' idempotent prepare; only
    // the canonical command Hermes returns is allowed to reach CodeG.
    const prepared = await this.hermes.prepareAction(input);
    const command = prepared.command;
    const runId = prepared.run_id;
    const command_id = command.command_id;

    // Redeliver any receipts a previous crash left journaled but undelivered.
    await this.redeliver(command.task_id, runId, command_id);

    const expired = this.now().getTime() > Date.parse(command.expires_at);
    const lookup = await this.codeg.lookupByCommandKey(command.idempotency_key);

    if (lookup.status === "unknown") {
      // Ambiguous reconciliation: never reach the submission transport.
      return { state: "unknown", binding: null };
    }

    if (lookup.status === "not_found") {
      // Authoritative proof the command never reached CodeG. The design lets a
      // still-valid command replay the same logical command with the same key;
      // only a proven-unsubmitted command that is no longer valid is revoked.
      if (expired) {
        return { state: "revoked", binding: null };
      }
      const ensured = await this.codeg.ensureWork(command);
      if (ensured.status === "unknown") {
        // Submission response lost: reconcile by the same key on the next advance.
        return { state: "unknown", binding: null };
      }
      const binding = ensured.binding;
      await this.hermes.bindWorkerSession({ task_id: command.task_id, run_id: runId, command_id, binding });
      await this.publish(command.task_id, runId, command_id, "codeg", ensured, "CodeG ensured the bound work task.");
      return this.snapshot(command.task_id, runId, command_id, binding);
    }

    // lookup.status === "found": the command already exists in CodeG.
    const binding = lookup.binding;
    await this.hermes.bindWorkerSession({ task_id: command.task_id, run_id: runId, command_id, binding });
    return this.snapshot(command.task_id, runId, command_id, binding);
  }

  private async snapshot(taskId: string, runId: string, commandId: string, binding: CodeGBindingV1): Promise<ActionCommandAdvanceResult> {
    const snapshot = await this.codeg.getSnapshot(binding);
    await this.publish(taskId, runId, commandId, "codeg", snapshot, "CodeG snapshot for the bound work task.");
    return { state: snapshot.terminal ? "terminal" : "found", binding };
  }

  private async redeliver(taskId: string, runId: string, commandId: string): Promise<void> {
    const pending = await this.outbox.pending();
    for (const envelope of pending) {
      if (envelope.command_id !== commandId) continue;
      await this.deliver(taskId, runId, envelope);
    }
  }

  private async publish(taskId: string, runId: string, commandId: string, adapter: string, result: unknown, summary: string): Promise<void> {
    const redacted_result = { redacted: true as const, digest: canonicalDigest(result), summary };
    const envelope = AdapterResultEnvelopeV1Schema.parse({
      schema_version: "agentdash.adapter-result-envelope/v1",
      envelope_id: `evt-${randomUUID()}`,
      command_id: commandId,
      adapter,
      result_digest: canonicalDigest(redacted_result),
      redacted_result,
      observed_at: this.now().toISOString(),
    });
    // Journal the adapter evidence before delivering its receipt to Hermes.
    await this.outbox.journal(envelope);
    await this.deliver(taskId, runId, envelope);
  }

  private async deliver(taskId: string, runId: string, envelope: AdapterResultEnvelopeV1): Promise<void> {
    const eventId = envelope.envelope_id;
    await this.hermes.appendRunEvent({
      task_id: taskId,
      run_id: runId,
      event_id: eventId,
      digest: envelope.result_digest,
      payload: envelope.redacted_result,
    });
    await this.outbox.markDelivered(envelope.envelope_id, eventId);
  }
}
