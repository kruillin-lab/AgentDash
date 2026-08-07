import { describe, expect, test, vi } from "vitest";

import type { ActionCommandV1, CodeGBindingV1, CodeGWorkspaceBindingV1 } from "@/lib/mission-control/contracts";

import { CodeGClient, CodeGClientConfigurationError, CodeGWorkspaceMismatchError } from "./client";

const workspace = {
  project_id: "agentdash",
  requested_root: "C:\\work\\AgentDash",
  real_root: "C:\\work\\AgentDash",
  folder_id: "folder:42",
} as CodeGWorkspaceBindingV1;

const command = {
  command_id: "command-1",
  idempotency_key: "command-key-1",
  task_id: "task-1",
  route_id: "route-1",
  command_headroom: { max_runtime_ms: 60_000 },
} as unknown as ActionCommandV1;

const binding = {
  workTaskId: "work_task:7",
  runSeq: 3,
  conversationId: "conversation:9",
  connectionId: "connection-1",
  harnessSessionId: "session-1",
  nativeUri: "/workspace?folderId=42&conversationId=9&agent=codex",
  folderId: "folder:42",
  folderRealPath: "C:\\work\\AgentDash",
};

const task = {
  id: 7,
  external_key: "command-key-1",
  folder_id: 42,
  title: "Execute task-1",
  config: {},
  status: "running",
  failure_reason: null,
  last_error: null,
  run_seq: 3,
  sort_order: 1,
  worktree_folder_id: 43,
  conversation_id: 9,
  connection_id: "connection-1",
  base_branch: "main",
  base_sha: "a".repeat(40),
  work_branch: "agentdash/task-1",
  cleanup_state: null,
  verdict: null,
  result_summary: null,
  files_changed: null,
  additions: null,
  deletions: null,
  merge_commit: null,
  preflight: null,
  archived_at: null,
  latest_progress: "editing app.ts",
  created_at: "2026-08-06T12:00:00.000Z",
  updated_at: "2026-08-06T12:01:00.000Z",
  started_at: "2026-08-06T12:00:10.000Z",
  settled_at: null,
  finished_at: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function client(fetcher: typeof fetch, overrides: Partial<ConstructorParameters<typeof CodeGClient>[0]> = {}) {
  return new CodeGClient({
    baseUrl: "http://127.0.0.1:4310",
    origin: "http://127.0.0.1:3007",
    bearerToken: "controller-secret-value",
    workspace,
    expectedBridgeCommit: "b".repeat(40),
    provenBridgeCommit: "b".repeat(40),
    fetcher,
    assertWorkspaceCurrent: vi.fn(async () => undefined),
    draftFor: () => ({
      title: "Execute task-1",
      config: {
        prompt_blocks: [{ type: "text", text: "Execute the authenticated command." }],
        display_text: "Execute the authenticated command.",
        agent_type: "codex",
        mode_id: null,
        config_values: {},
        max_runtime_ms: 60_000,
      },
    }),
    ...overrides,
  });
}

describe("CodeGClient contract", () => {
  test.each(["http://localhost:4310", "http://0.0.0.0:4310", "https://127.0.0.1:4310", "http://192.168.1.5:4310", "http://127.1:4310", "http://2130706433:4310", "http://0x7f000001:4310", "http://[::1]:4310"])(
    "rejects non-exact-loopback base URL %s",
    (baseUrl) => {
      expect(() => client(vi.fn(), { baseUrl })).toThrow(CodeGClientConfigurationError);
    },
  );

  test("disables dispatch when the proven bridge commit differs", () => {
    expect(() => client(vi.fn(), { provenBridgeCommit: "c".repeat(40) })).toThrow(/bridge proof/i);
  });

  test.each(["short", "contains whitespace", "contains\nnewline"])("rejects an unsafe bearer secret %j", (bearerToken) => {
    expect(() => client(vi.fn(), { bearerToken })).toThrow(/bearer token/i);
  });

  test("ensures one work task with exact bearer, origin, folder, and idempotency key", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => json({ created: true, task, binding }));
    const assertWorkspaceCurrent = vi.fn(async () => undefined);
    const codeg = client(fetcher as typeof fetch, { assertWorkspaceCurrent });

    await expect(codeg.ensureWork(command)).resolves.toEqual({
      status: "created",
      binding: {
        work_task_id: "work_task:7",
        run_sequence: 3,
        conversation_id: "conversation:9",
        connection_id: "connection-1",
        harness_session_id: "session-1",
        folder_id: "folder:42",
      },
    });
    expect(assertWorkspaceCurrent).toHaveBeenCalledWith(workspace);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:4310/api/work_task_ensure_external");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer controller-secret-value", Origin: "http://127.0.0.1:3007" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ externalKey: "command-key-1", folderId: 42, title: "Execute task-1" });
  });

  test("maps a dropped ensure response to unknown and never to absence", async () => {
    const fetcher = vi.fn(async () => { throw new DOMException("timed out", "AbortError"); });
    await expect(client(fetcher as typeof fetch).ensureWork(command)).resolves.toEqual({ status: "unknown", binding: null });
  });

  test("maps a non-JSON ensure response to unknown", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ created: true, task, binding }), {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));
    await expect(client(fetcher as typeof fetch).ensureWork(command)).resolves.toEqual({ status: "unknown", binding: null });
  });

  test("stops reading a chunked response when the configured byte cap is crossed", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("{\"created\":"));
        controller.enqueue(encoder.encode("true," + "x".repeat(256)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetcher = vi.fn(async () => new Response(responseBody, { status: 200, headers: { "content-type": "application/json" } }));

    await expect(client(fetcher as typeof fetch, { maxResponseBytes: 32 }).ensureWork(command)).resolves.toEqual({ status: "unknown", binding: null });
    expect(cancelled).toBe(true);
  });

  test("cancels an advertised oversized response before rejecting it", async () => {
    let cancelled = false;
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetcher = vi.fn(async () => new Response(responseBody, {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "4096" },
    }));

    await expect(client(fetcher as typeof fetch, { maxResponseBytes: 32 }).ensureWork(command)).resolves.toEqual({ status: "unknown", binding: null });
    expect(cancelled).toBe(true);
  });

  test("does not bind the unstable pre-launch generation zero", async () => {
    const fetcher = vi.fn(async () => json({ created: true, task: { ...task, status: "todo", run_seq: 0 }, binding: { ...binding, runSeq: 0, conversationId: null, connectionId: null, harnessSessionId: null, nativeUri: null } }));
    await expect(client(fetcher as typeof fetch).ensureWork(command)).resolves.toEqual({ status: "unknown", binding: null });
  });

  test("maps a task/binding identity disagreement during ensure to unknown", async () => {
    const fetcher = vi.fn(async () => json({ created: true, task: { ...task, id: 8 }, binding }));
    await expect(client(fetcher as typeof fetch).ensureWork(command)).resolves.toEqual({ status: "unknown", binding: null });
  });

  test("fails closed when a mutating ensure returns a different workspace", async () => {
    const fetcher = vi.fn(async () => json({ created: true, task, binding: { ...binding, folderRealPath: "C:\\work\\Other" } }));
    await expect(client(fetcher as typeof fetch).ensureWork(command)).rejects.toBeInstanceOf(CodeGWorkspaceMismatchError);
  });

  test("accepts Windows path case differences for the same canonical workspace", async () => {
    const fetcher = vi.fn(async () => json({ created: true, task, binding: { ...binding, folderRealPath: "c:\\WORK\\agentdash" } }));
    await expect(client(fetcher as typeof fetch).ensureWork(command)).resolves.toMatchObject({ status: "created" });
  });

  test("returns not_found only from an authoritative lookup response", async () => {
    const fetcher = vi.fn(async () => json({ status: "not_found" }));
    await expect(client(fetcher as typeof fetch).lookupByCommandKey("missing-key")).resolves.toEqual({ status: "not_found" });
  });

  test("maps a task/binding identity disagreement during lookup to unknown", async () => {
    const fetcher = vi.fn(async () => json({ status: "found", task: { ...task, external_key: "other-key" }, binding }));
    await expect(client(fetcher as typeof fetch).lookupByCommandKey("command-key-1")).resolves.toEqual({ status: "unknown", reason: "Codeg lookup result is unavailable or ambiguous." });
  });

  test("preserves Task 8 snapshot commit and tree provenance", async () => {
    const fetcher = vi.fn(async () => json({
      binding,
      task: { ...task, base_sha: "a".repeat(40), merge_commit: "e".repeat(40) },
      sourceCommit: "c".repeat(40),
      sourceTree: "d".repeat(40),
      worktreeRealPath: "C:\\worktrees\\task-7",
      changedFiles: [{ file: "src/app.ts", additions: 3, deletions: 1 }],
    }));

    await expect(client(fetcher as typeof fetch).getSnapshot({
      work_task_id: "work_task:7",
      run_sequence: 3,
      conversation_id: "conversation:9",
      connection_id: "connection-1",
      harness_session_id: "session-1",
      folder_id: "folder:42",
    } as CodeGBindingV1)).resolves.toMatchObject({
      source_commit: "c".repeat(40),
      source_tree: "d".repeat(40),
    });
  });

  test("returns original Codeg activity with resumable page facts and redacted summaries", async () => {
    const fetcher = vi.fn(async () => json({
      binding,
      live: true,
      resetRequired: false,
      nextCursor: 2,
      facts: { runtimeMs: 2_000, runtimeLimitMs: 60_000, contextTokensUsed: 1_200, contextWindowSize: 32_000, observedCostUsd: null },
      events: [
        { seq: 1, connection_id: "connection-1", type: "content_delta", text: "Editing app.ts" },
        { seq: 2, connection_id: "connection-1", type: "tool_call", tool_call_id: "tool-1", title: "read", kind: "read", status: "running", content: "Bearer top-secret-token-value", raw_input: null, raw_output: null },
      ],
    }));
    const page = await client(fetcher as typeof fetch, { now: () => new Date("2026-08-06T12:02:00.000Z") }).activityAfter({
      work_task_id: "work_task:7",
      run_sequence: 3,
      conversation_id: "conversation:9",
      connection_id: "connection-1",
      harness_session_id: "session-1",
      folder_id: "folder:42",
    } as CodeGBindingV1, "0");

    expect(page).toMatchObject({
      status: "ok",
      live: true,
      reset_required: false,
      next_cursor: "2",
      facts: {
        runtime_ms: 2_000,
        runtime_limit_ms: 60_000,
        context_tokens_used: 1_200,
        context_window_size: 32_000,
        observed_cost_usd: null,
      },
    });
    if (page.status !== "ok") throw new Error("expected an activity page");
    expect(page.events.map((entry) => [entry.cursor, entry.kind, entry.observed_at])).toEqual([
      ["1", "content_delta", "2026-08-06T12:02:00.000Z"],
      ["2", "tool_call", "2026-08-06T12:02:00.000Z"],
    ]);
    expect(page.events[0].payload.summary).toContain("Editing app.ts");
    expect(page.events[1].payload.summary).not.toContain("top-secret-token-value");
  });

  test("preserves Task 8 activity reset pages and never turns malformed activity into empty success", async () => {
    const resetFetcher = vi.fn(async () => json({
      binding,
      live: false,
      resetRequired: true,
      nextCursor: 9,
      facts: { runtimeMs: null, runtimeLimitMs: 60_000, contextTokensUsed: null, contextWindowSize: null, observedCostUsd: null },
      events: [],
    }));
    await expect(client(resetFetcher as typeof fetch).activityAfter({
      work_task_id: "work_task:7",
      run_sequence: 3,
      conversation_id: "conversation:9",
      connection_id: "connection-1",
      harness_session_id: "session-1",
      folder_id: "folder:42",
    } as CodeGBindingV1, "99")).resolves.toMatchObject({ status: "ok", reset_required: true, next_cursor: "9", events: [] });

    const malformedFetcher = vi.fn(async () => json({ binding, live: false, events: [] }));
    await expect(client(malformedFetcher as typeof fetch).activityAfter({
      work_task_id: "work_task:7",
      run_sequence: 3,
      conversation_id: "conversation:9",
      connection_id: "connection-1",
      harness_session_id: "session-1",
      folder_id: "folder:42",
    } as CodeGBindingV1, "0")).resolves.toEqual({ status: "unknown", reason: "Codeg activity result is unavailable or ambiguous." });
  });

  test("cancels only the exact generation after revalidating the workspace", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(null));
    const assertWorkspaceCurrent = vi.fn(async () => undefined);
    const exact = {
      work_task_id: "work_task:7",
      run_sequence: 3,
      conversation_id: "conversation:9",
      connection_id: "connection-1",
      harness_session_id: "session-1",
      folder_id: "folder:42",
    } as CodeGBindingV1;
    await expect(client(fetcher as typeof fetch, { assertWorkspaceCurrent }).cancelExact(exact, "budget ceiling")).resolves.toEqual({ status: "confirmed", binding: exact });
    expect(assertWorkspaceCurrent).toHaveBeenCalledWith(workspace);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ workTaskId: "work_task:7", runSeq: 3 });
  });

  test("resolves the native Codeg session to an exact local URL", async () => {
    const fetcher = vi.fn(async () => json(binding));
    await expect(client(fetcher as typeof fetch).nativeSessionUri({
      work_task_id: "work_task:7",
      run_sequence: 3,
      conversation_id: "conversation:9",
      connection_id: "connection-1",
      harness_session_id: "session-1",
      folder_id: "folder:42",
    } as CodeGBindingV1)).resolves.toBe("http://127.0.0.1:4310/workspace?folderId=42&conversationId=9&agent=codex");
  });

  test.each([
    "javascript:alert(1)",
    "data:text/html,owned",
    "https://127.0.0.1:4310/workspace?folderId=42&conversationId=9&agent=codex",
    "http://evil.example/workspace?folderId=42&conversationId=9&agent=codex",
    "//evil.example/workspace?folderId=42&conversationId=9&agent=codex",
    "http://user:pass@127.0.0.1:4310/workspace?folderId=42&conversationId=9&agent=codex",
    "/admin?folderId=42&conversationId=9&agent=codex",
    "/workspace?folderId=99&conversationId=9&agent=codex",
  ])("rejects an untrusted native session URI %s", async (nativeUri) => {
    const fetcher = vi.fn(async () => json({ ...binding, nativeUri }));
    await expect(client(fetcher as typeof fetch).nativeSessionUri({
      work_task_id: "work_task:7",
      run_sequence: 3,
      conversation_id: "conversation:9",
      connection_id: "connection-1",
      harness_session_id: "session-1",
      folder_id: "folder:42",
    } as CodeGBindingV1)).rejects.toThrow(/native session/i);
  });
});
