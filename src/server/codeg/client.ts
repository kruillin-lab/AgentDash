import "server-only";

import type { ActionCommandV1, CodeGActivityV1, CodeGBindingV1, CodeGCancelResult, CodeGEnsureResult, CodeGLookupResult, CodeGSnapshotV1, CodeGWorkspaceBindingV1 } from "../../lib/mission-control/contracts";
import { canonicalDigest, CodeGActivityV1Schema, CodeGBindingV1Schema, CodeGSnapshotV1Schema, RedactedPayloadV1Schema } from "../../lib/mission-control/contracts";
import type { CodeGPort } from "@/server/mission-control/ports";

import { CodeGActivityResponseSchema, CodeGEnsureResponseSchema, CodeGLookupResponseSchema, CodeGRawBindingSchema, CodeGSnapshotResponseSchema, type CodeGRawBinding } from "./schemas";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const COMMIT = /^[0-9a-f]{40}$/;
const TERMINAL = new Set(["review", "done", "failed", "canceled"]);
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;"}]+/gi,
  /\b(?:sk|rk|pk)-(?:test_|live_)?[A-Za-z0-9_-]{12,}\b/g,
];

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
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
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

function redactSummary(value: unknown, explicitSecrets: readonly string[]): string {
  let summary: string;
  try {
    summary = JSON.stringify(value);
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
    if (!options.bearerToken.trim()) throw new CodeGClientConfigurationError("Codeg bearer token is required.");
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
      const advertised = Number(response.headers.get("content-length"));
      if (Number.isFinite(advertised) && advertised > this.maxResponseBytes) throw new Error("Codeg response exceeded the configured cap.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > this.maxResponseBytes) throw new Error("Codeg response exceeded the configured cap.");
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireExpectedFolder(raw: CodeGRawBinding): void {
    if (raw.folderId !== this.options.workspace.folder_id || raw.folderRealPath !== this.options.workspace.real_root) throw new CodeGWorkspaceMismatchError();
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
      this.requireExpectedFolder(raw.binding);
      const binding = bindingFromRaw(raw.binding);
      return binding ? { status: "found", binding } : { status: "unknown", reason: "Codeg work task has not launched yet." };
    } catch {
      return { status: "unknown", reason: "Codeg lookup result is unavailable or ambiguous." };
    }
  }

  async getSnapshot(binding: CodeGBindingV1): Promise<CodeGSnapshotV1> {
    const raw = CodeGSnapshotResponseSchema.parse(await this.post("work_task_snapshot_exact", exactReference(binding)));
    this.requireExpectedFolder(raw.binding);
    const observedBinding = bindingFromRaw(raw.binding);
    if (!observedBinding || observedBinding.work_task_id !== binding.work_task_id || observedBinding.run_sequence !== binding.run_sequence) throw new Error("Codeg snapshot did not preserve the exact task generation.");
    const sourceCommit = raw.task.merge_commit ?? raw.task.base_sha;
    return CodeGSnapshotV1Schema.parse({
      binding: observedBinding,
      terminal: TERMINAL.has(raw.task.status),
      source_commit: sourceCommit,
      source_tree: null,
      raw: redactedPayload(raw, [this.options.bearerToken]),
    });
  }

  async *activityAfter(binding: CodeGBindingV1, cursor: string | null): AsyncIterable<CodeGActivityV1> {
    const afterCursor = cursor === null ? 0 : Number(cursor);
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0) throw new Error("Codeg activity cursor is invalid.");
    const raw = CodeGActivityResponseSchema.parse(await this.post("work_task_activity_after", { ...exactReference(binding), afterCursor }));
    this.requireExpectedFolder(raw.binding);
    if (raw.binding.workTaskId !== binding.work_task_id || raw.binding.runSeq !== binding.run_sequence) throw new Error("Codeg activity did not preserve the exact task generation.");
    for (const event of raw.events) {
      yield CodeGActivityV1Schema.parse({
        cursor: String(event.seq),
        source_timestamp: this.now().toISOString(),
        kind: event.type,
        payload: redactedPayload(event, [this.options.bearerToken]),
      });
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
    const raw = CodeGRawBindingSchema.parse(await this.post("work_task_native_session", exactReference(binding)));
    this.requireExpectedFolder(raw);
    if (raw.workTaskId !== binding.work_task_id || raw.runSeq !== binding.run_sequence) throw new Error("Codeg native session did not preserve the exact task generation.");
    return raw.nativeUri === null ? null : new URL(raw.nativeUri, `${this.baseUrl}/`).toString();
  }
}
