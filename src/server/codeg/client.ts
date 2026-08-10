import "server-only";

import { win32 } from "node:path";

import type { ActionCommandV1, CodeGActivityPageResultV1, CodeGBindingV1, CodeGCancelResult, CodeGEnsureResult, CodeGLookupResult, CodeGSnapshotV1, CodeGWorkspaceBindingV1 } from "../../lib/mission-control/contracts";
import { canonicalDigest, CodeGActivityPageResultV1Schema, CodeGActivityV1Schema, CodeGBindingV1Schema, CodeGSnapshotV1Schema, RedactedPayloadV1Schema } from "../../lib/mission-control/contracts";
import type { CodeGPort } from "@/server/mission-control/ports";

import { CodeGActivityResponseSchema, CodeGEnsureResponseSchema, CodeGLookupResponseSchema, CodeGRawBindingSchema, CodeGSnapshotResponseSchema, type CodeGRawBinding, type CodeGRawTask } from "./schemas";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const COMMIT = /^[0-9a-f]{40}$/;
const TERMINAL = new Set(["review", "done", "failed", "canceled"]);
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;"}]+/gi,
  /\b(?:sk|rk|pk)-(?:test_|live_)?[A-Za-z0-9_-]{12,}\b/g,
];
const SENSITIVE_KEY = /(?:^|[_-])(?:authorization|cookie|credential|password|secret|token|api[_-]?key)(?:$|[_-])/i;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type CodeGWorkDraft = Readonly<{ title: string; config: unknown }>;

export type CodeGClientOptions = Readonly<{
  baseUrl: string;
  origin: string;
  bearerToken: string;
  workspace: CodeGWorkspaceBindingV1;
  expectedBridgeCommit: string;
  provenBridgeCommit: string;
  draftFor: (command: ActionCommandV1) => CodeGWorkDraft;
  assertWorkspaceCurrent: (workspace: CodeGWorkspaceBindingV1) => Promise<void>;
  fetcher?: Fetcher;
  timeoutMs?: number;
  maxResponseBytes?: number;
  now?: () => Date;
}>;

export class CodeGClientConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeGClientConfigurationError";
  }
}

export class CodeGWorkspaceMismatchError extends Error {
  constructor() {
    super("Codeg returned a stale or different workspace binding.");
    this.name = "CodeGWorkspaceMismatchError";
  }
}

class CodeGHttpError extends Error {
  constructor(readonly status: number) {
    super(`Codeg returned HTTP ${status}`);
    this.name = "CodeGHttpError";
  }
}

function exactLoopbackOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CodeGClientConfigurationError(`${label} must be an absolute URL.`);
  }
  if ((value !== url.origin && value !== `${url.origin}/`) || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new CodeGClientConfigurationError(`${label} must be an exact HTTP 127.0.0.1 origin.`);
  }
  return url.origin;
}

function folderNumber(folderId: string): number {
  const match = /^folder:([1-9]\d*)$/.exec(folderId);
  if (!match) throw new CodeGClientConfigurationError("Codeg folder identity is invalid.");
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value)) throw new CodeGClientConfigurationError("Codeg folder identity exceeds the safe integer range.");
  return value;
}

function bindingFromRaw(value: CodeGRawBinding): CodeGBindingV1 | null {
  if (value.runSeq <= 0) return null;
  return CodeGBindingV1Schema.parse({
    work_task_id: value.workTaskId,
    run_sequence: value.runSeq,
    conversation_id: value.conversationId,
    connection_id: value.connectionId,
    harness_session_id: value.harnessSessionId,
    folder_id: value.folderId,
  });
}

function exactReference(binding: CodeGBindingV1): { workTaskId: string; runSeq: number } {
  return { workTaskId: binding.work_task_id, runSeq: binding.run_sequence };
}

function requireTaskMatchesBinding(task: CodeGRawTask, binding: CodeGRawBinding, expectedExternalKey?: string): void {
  if (`work_task:${task.id}` !== binding.workTaskId
    || `folder:${task.folder_id}` !== binding.folderId
    || task.run_seq !== binding.runSeq
    || (task.conversation_id === null ? null : `conversation:${task.conversation_id}`) !== binding.conversationId
    || task.connection_id !== binding.connectionId
    || (expectedExternalKey !== undefined && task.external_key !== expectedExternalKey)) {
    throw new Error("Codeg task and binding identities disagree.");
  }
}

function redactSummary(value: unknown, explicitSecrets: readonly string[]): string {
  function sanitize(input: unknown, key?: string): unknown {
    if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
    if (typeof input === "string") {
      let redacted = input;
      for (const secret of explicitSecrets) if (secret.length >= 6) redacted = redacted.split(secret).join("[REDACTED]");
      for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, "[REDACTED]");
      return redacted;
    }
    if (Array.isArray(input)) return input.map((entry) => sanitize(entry));
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).map(([nestedKey, nestedValue]) => [nestedKey, sanitize(nestedValue, nestedKey)]));
    }
    return input;
  }
  let summary: string;
  try {
    summary = JSON.stringify(sanitize(value));
  } catch {
    summary = "[unserializable Codeg event]";
  }
  for (const secret of explicitSecrets) if (secret.length >= 6) summary = summary.split(secret).join("[REDACTED]");
  for (const pattern of SECRET_PATTERNS) summary = summary.replace(pattern, "[REDACTED]");
  return summary.slice(0, 4096) || "[empty Codeg event]";
}

function redactedPayload(value: unknown, secrets: readonly string[]) {
  return RedactedPayloadV1Schema.parse({ redacted: true, digest: canonicalDigest(value), summary: redactSummary(value, secrets) });
}

export class CodeGClient implements CodeGPort {
  private readonly baseUrl: string;
  private readonly origin: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly folderId: number;
  private readonly now: () => Date;

  constructor(private readonly options: CodeGClientOptions) {
    this.baseUrl = exactLoopbackOrigin(options.baseUrl, "Codeg base URL");
    this.origin = exactLoopbackOrigin(options.origin, "AgentDash Origin");
    if (options.bearerToken.length < 16 || !/^[!-~]+$/.test(options.bearerToken)) throw new CodeGClientConfigurationError("Codeg bearer token must be a nontrivial visible-ASCII secret without whitespace.");
    if (!COMMIT.test(options.expectedBridgeCommit) || options.expectedBridgeCommit !== options.provenBridgeCommit) throw new CodeGClientConfigurationError("Codeg bridge proof does not match the expected commit.");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || !Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes <= 0) throw new CodeGClientConfigurationError("Codeg transport bounds are invalid.");
    this.folderId = folderNumber(options.workspace.folder_id);
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}/api/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.bearerToken}`,
          Origin: this.origin,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) throw new CodeGHttpError(response.status);
      const discardResponse = async (message: string): Promise<never> => {
        try {
          await response.body?.cancel(message);
        } catch {
          // The abort below is the final transport-level stop if cancellation races the body.
        }
        controller.abort();
        throw new Error(message);
      };
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json" && !contentType?.endsWith("+json")) return await discardResponse("Codeg response was not JSON.");
      const advertisedHeader = response.headers.get("content-length");
      if (advertisedHeader !== null) {
        const advertised = Number(advertisedHeader);
        if (!Number.isSafeInteger(advertised) || advertised < 0 || advertised > this.maxResponseBytes) return await discardResponse("Codeg response exceeded the configured cap.");
      }
      if (!response.body) return await discardResponse("Codeg response body was unavailable.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.maxResponseBytes) {
          await reader.cancel("Codeg response exceeded the configured cap.");
          controller.abort();
          throw new Error("Codeg response exceeded the configured cap.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireExpectedFolder(raw: CodeGRawBinding): void {
    if (raw.folderId !== this.options.workspace.folder_id || win32.normalize(raw.folderRealPath).toLocaleLowerCase("en-US") !== win32.normalize(this.options.workspace.real_root).toLocaleLowerCase("en-US")) throw new CodeGWorkspaceMismatchError();
  }

  private requireExactBinding(raw: CodeGRawBinding, expected: CodeGBindingV1): CodeGBindingV1 {
    this.requireExpectedFolder(raw);
    const observed = bindingFromRaw(raw);
    if (!observed
      || observed.work_task_id !== expected.work_task_id
      || observed.run_sequence !== expected.run_sequence
      || observed.folder_id !== expected.folder_id
      || observed.conversation_id !== expected.conversation_id
      || observed.connection_id !== expected.connection_id
      || observed.harness_session_id !== expected.harness_session_id) {
      throw new Error("Codeg response did not preserve the exact task-generation binding.");
    }
    return observed;
  }

  async ensureWork(command: ActionCommandV1): Promise<CodeGEnsureResult> {
    await this.options.assertWorkspaceCurrent(this.options.workspace);
    const draft = this.options.draftFor(command);
    try {
      const raw = CodeGEnsureResponseSchema.parse(await this.post("work_task_ensure_external", {
        externalKey: command.idempotency_key,
        folderId: this.folderId,
        title: draft.title,
        config: draft.config,
      }));
      requireTaskMatchesBinding(raw.task, raw.binding, command.idempotency_key);
      this.requireExpectedFolder(raw.binding);
      const binding = bindingFromRaw(raw.binding);
      if (!binding) return { status: "unknown", binding: null };
      return { status: raw.created ? "created" : "found", binding };
    } catch (error) {
      if (error instanceof CodeGWorkspaceMismatchError) throw error;
      return { status: "unknown", binding: null };
    }
  }

  async lookupByCommandKey(key: string): Promise<CodeGLookupResult> {
    try {
      const raw = CodeGLookupResponseSchema.parse(await this.post("work_task_lookup_external", { externalKey: key }));
      if (raw.status === "not_found") return { status: "not_found" };
      requireTaskMatchesBinding(raw.task, raw.binding, key);
      this.requireExpectedFolder(raw.binding);
      const binding = bindingFromRaw(raw.binding);
      return binding ? { status: "found", binding } : { status: "unknown", reason: "Codeg work task has not launched yet." };
    } catch {
      return { status: "unknown", reason: "Codeg lookup result is unavailable or ambiguous." };
    }
  }

  async getSnapshot(binding: CodeGBindingV1): Promise<CodeGSnapshotV1> {
    try {
      const raw = CodeGSnapshotResponseSchema.parse(await this.post("work_task_snapshot_exact", exactReference(binding)));
      requireTaskMatchesBinding(raw.task, raw.binding);
      const observedBinding = this.requireExactBinding(raw.binding, binding);
      return CodeGSnapshotV1Schema.parse({
        binding: observedBinding,
        terminal: TERMINAL.has(raw.task.status),
        source_commit: raw.sourceCommit,
        source_tree: raw.sourceTree,
        raw: redactedPayload(raw, [this.options.bearerToken]),
      });
    } catch (error) {
      if (error instanceof CodeGWorkspaceMismatchError) throw error;
      throw new Error("Codeg snapshot result is unavailable or invalid.");
    }
  }

  async activityAfter(binding: CodeGBindingV1, cursor: string | null): Promise<CodeGActivityPageResultV1> {
    const afterCursor = cursor === null ? 0 : Number(cursor);
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0) throw new Error("Codeg activity cursor is invalid.");
    try {
      const raw = CodeGActivityResponseSchema.parse(await this.post("work_task_activity_after", { ...exactReference(binding), afterCursor }));
      const observedBinding = this.requireExactBinding(raw.binding, binding);
      let prior = afterCursor;
      for (const event of raw.events) {
        if (event.seq <= prior || (raw.binding.connectionId !== null && event.connection_id !== raw.binding.connectionId)) throw new Error("Codeg activity sequence or connection identity was invalid.");
        prior = event.seq;
      }
      if (!raw.resetRequired && raw.nextCursor < prior) throw new Error("Codeg activity cursor regressed behind returned events.");
      const observedAt = this.now().toISOString();
      return CodeGActivityPageResultV1Schema.parse({
        status: "ok",
        binding: observedBinding,
        live: raw.live,
        reset_required: raw.resetRequired,
        next_cursor: String(raw.nextCursor),
        facts: {
          runtime_ms: raw.facts.runtimeMs,
          runtime_limit_ms: raw.facts.runtimeLimitMs,
          context_tokens_used: raw.facts.contextTokensUsed,
          context_window_size: raw.facts.contextWindowSize,
          observed_cost_usd: raw.facts.observedCostUsd,
        },
        events: raw.events.map((event) => CodeGActivityV1Schema.parse({
          cursor: String(event.seq),
          observed_at: observedAt,
          kind: event.type,
          payload: redactedPayload(event, [this.options.bearerToken]),
        })),
      });
    } catch (error) {
      if (error instanceof CodeGWorkspaceMismatchError) throw error;
      return { status: "unknown", reason: "Codeg activity result is unavailable or ambiguous." };
    }
  }

  async cancelExact(binding: CodeGBindingV1, _reason: string): Promise<CodeGCancelResult> {
    await this.options.assertWorkspaceCurrent(this.options.workspace);
    try {
      await this.post("work_task_cancel_exact", exactReference(binding));
      return { status: "confirmed", binding };
    } catch (error) {
      return { status: error instanceof CodeGHttpError && error.status === 409 ? "not_active" : "unknown", binding };
    }
  }

  async nativeSessionUri(binding: CodeGBindingV1): Promise<string | null> {
    try {
      const raw = CodeGRawBindingSchema.parse(await this.post("work_task_native_session", exactReference(binding)));
      this.requireExactBinding(raw, binding);
      if (raw.nativeUri === null) return null;
      const uri = new URL(raw.nativeUri, `${this.baseUrl}/`);
      const conversationNumber = raw.conversationId === null ? null : /^conversation:([1-9]\d*)$/.exec(raw.conversationId)?.[1];
      const keys = [...uri.searchParams.keys()].sort();
      if (uri.origin !== this.baseUrl
        || uri.protocol !== "http:"
        || uri.username
        || uri.password
        || uri.hash
        || uri.pathname !== "/workspace"
        || keys.join(",") !== "agent,conversationId,folderId"
        || uri.searchParams.getAll("folderId").length !== 1
        || uri.searchParams.get("folderId") !== String(this.folderId)
        || conversationNumber === null
        || uri.searchParams.getAll("conversationId").length !== 1
        || uri.searchParams.get("conversationId") !== conversationNumber
        || uri.searchParams.getAll("agent").length !== 1
        || !uri.searchParams.get("agent")) {
        throw new Error("Codeg native session URI failed same-origin validation.");
      }
      return uri.toString();
    } catch (error) {
      if (error instanceof CodeGWorkspaceMismatchError) throw error;
      throw new Error("Codeg native session result is unavailable or invalid.");
    }
  }
}
