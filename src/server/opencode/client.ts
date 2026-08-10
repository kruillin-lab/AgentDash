import "./env"

/**
 * OpenCode HTTP bridge — talks to a running `opencode serve` instance via the v2 HTTP API.
 *
 * Env loading is centralized in `./env.ts` so the same `.env` precedence
 * rules apply to the client, the SSE event proxy, and the opencode web UI
 * reverse-proxy route.
 */

/**
 * OpenCode HTTP bridge — talks to a running `opencode serve` instance via the v2 HTTP API.
 *
 * Endpoints used (confirmed in opencode-source/packages/opencode/src/server/routes/instance/httpapi/groups/v2):
 *   GET    /api/session                      list sessions
 *   POST   /api/session/:sessionID/prompt    send a prompt to a session
 *   GET    /api/session/:sessionID/message   list messages for a session
 *   GET    /api/session/:sessionID/context   active context after last compaction
 *   POST   /api/session/:sessionID/compact   compact a session
 *   POST   /api/session/:sessionID/wait      wait for idle
 *   GET    /api/model                        list models
 *   GET    /api/provider                     list providers
 *   GET    /event                            SSE event stream (instance events)
 *
 * Auth: basic auth password via -p / OPENCODE_SERVER_PASSWORD.
 * The browser never sees the password — all calls go through Next.js route handlers.
 */

export type OpenCodeConfig = {
  baseUrl: string
  password?: string
  directory?: string
  workspace?: string
}

const DEFAULT_BASE_URL = "http://127.0.0.1:4096"

export function resolveConfig(overrides?: Partial<OpenCodeConfig>): OpenCodeConfig {
  const baseUrl = (overrides?.baseUrl ?? process.env.OPENCODE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "")
  const password = overrides?.password ?? process.env.OPENCODE_SERVER_PASSWORD
  const directory = overrides?.directory ?? process.env.OPENCODE_DIRECTORY
  const workspace = overrides?.workspace ?? process.env.OPENCODE_WORKSPACE
  return { baseUrl, password, directory, workspace }
}

function authHeader(password?: string): string | undefined {
  if (!password) return undefined
  return "Basic " + Buffer.from(`opencode:${password}`).toString("base64")
}

function buildUrl(config: OpenCodeConfig, path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(path, config.baseUrl)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value)
    }
  }
  if (config.directory) url.searchParams.set("directory", config.directory)
  if (config.workspace) url.searchParams.set("workspace", config.workspace)
  return url.toString()
}

export type OpenCodeError = {
  status: number
  message: string
  body: unknown
}

async function request<T>(
  config: OpenCodeConfig,
  method: string,
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<T> {
  const url = buildUrl(config, path, opts.query)
  const headers: Record<string, string> = { accept: "application/json" }
  const auth = authHeader(config.password)
  if (auth) headers.authorization = auth
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json"
  }

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    // Local-only; never redirect to the network.
    redirect: "error",
  })

  const text = await res.text()
  const parsed = safeJson(text)
  if (!res.ok) {
    const err: OpenCodeError = {
      status: res.status,
      message: `OpenCode ${method} ${path} -> ${res.status}`,
      body: parsed ?? text,
    }
    throw err
  }
  return (parsed ?? text) as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// --- typed shapes (loose — opencode schemas are large; we take what we need) ---
// The installed v2 API (1.17.x) returns sessions as { data, cursor } and
// models/providers as { items: { location, project, data: [...] } }. We keep
// parsing tolerant of both this and the source-tree shape ({ items: [...] }).

export type OpenCodeSession = {
  id: string
  title?: string
  model?: { id?: string; providerID?: string; variant?: string } | string
  provider?: string
  created?: number | string
  updated?: number | string
  time?: { created?: number; updated?: number; archived?: number | null }
  cwd?: string
  path?: string
  location?: { directory?: string; workspaceID?: string | null }
  agent?: string
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
  cost?: number
  [key: string]: unknown
}

export type OpenCodeSessionsResponse = {
  data?: OpenCodeSession[]
  items?: OpenCodeSession[]
  cursor?: { previous?: string; next?: string }
}

export type OpenCodeMessage = {
  id?: string
  role?: string
  type?: string
  content?: unknown
  text?: string
  [key: string]: unknown
}

export type OpenCodeModel = {
  id: string
  name?: string
  providerID?: string
  family?: string
  status?: string
  enabled?: boolean
  cost?: Array<{ input?: number; output?: number; cache?: { read?: number; write?: number } }>
  limit?: { context?: number; input?: number | null; output?: number | null }
  capabilities?: { tools?: boolean; input?: string[]; output?: string[] }
  time?: { released?: number }
  [key: string]: unknown
}

export type OpenCodeProvider = {
  id: string
  name?: string
  [key: string]: unknown
}

export type OpenCodePromptResponse = OpenCodeMessage

// --- high-level client ---

export class OpenCodeClient {
  constructor(private config: OpenCodeConfig) {}

  static fromEnv(overrides?: Partial<OpenCodeConfig>) {
    return new OpenCodeClient(resolveConfig(overrides))
  }

  async health(): Promise<{ ok: boolean; baseUrl: string; version?: string; status?: number }> {
    try {
      const res = await fetch(this.config.baseUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
      })
      // 401/403 means the server is alive but requires auth — still "reachable".
      // 404 is the opencode root behavior on some builds — also reachable.
      const reachable = res.ok || res.status === 401 || res.status === 403 || res.status === 404
      return { ok: reachable, baseUrl: this.config.baseUrl, status: res.status }
    } catch {
      return { ok: false, baseUrl: this.config.baseUrl }
    }
  }

  listSessions(query?: { limit?: number; order?: "asc" | "desc"; search?: string; cursor?: string }) {
    return request<OpenCodeSessionsResponse>(this.config, "GET", "/api/session", {
      query: {
        limit: query?.limit?.toString(),
        order: query?.order,
        search: query?.search,
        cursor: query?.cursor,
      },
    })
  }

  /**
   * Create a new session via opencode's legacy `POST /session` endpoint (1.17.x).
   * The v2 `/api/session` only lists; creation is on the unversioned route.
   */
  createSession(input: { title?: string; parentID?: string } = {}) {
    return request<{ id: string; title?: string; slug?: string; projectID?: string; directory?: string; parentID?: string; [k: string]: unknown }>(
      this.config,
      "POST",
      "/session",
      { body: input },
    )
  }

  getMessages(sessionId: string, query?: { limit?: number; order?: "asc" | "desc" }) {
    return request<{ data?: OpenCodeMessage[]; items?: OpenCodeMessage[]; cursor?: { previous?: string; next?: string } }>(
      this.config,
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}/message`,
      { query: { limit: query?.limit?.toString(), order: query?.order } },
    )
  }

  getContext(sessionId: string) {
    return request<OpenCodeMessage[] | { data?: OpenCodeMessage[]; items?: OpenCodeMessage[] }>(
      this.config,
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}/context`,
    )
  }

  /**
   * Send a prompt to a session. The v2 API expects a structured Prompt object:
   *   { prompt: { text: string, files?: FileAttachment[], agents?: AgentAttachment[], references?: ReferenceAttachment[] }, delivery?: string }
   * The dashboard accepts a plain string for convenience and wraps it.
   *
   * `delivery` defaults to "queue" so the message is processed by the agent
   * loop on the next idle. Use "steer" to adjust a run already in flight.
   * (opencode v1.17.x: accepts "queue" | "steer".)
   */
  prompt(sessionId: string, prompt: string | { text: string; files?: unknown[]; agents?: unknown[]; references?: unknown[] }, delivery: "queue" | "steer" = "queue") {
    const body = typeof prompt === "string" ? { text: prompt } : prompt
    return request<OpenCodePromptResponse>(this.config, "POST", `/api/session/${encodeURIComponent(sessionId)}/prompt`, {
      body: { prompt: body, delivery },
    })
  }

  compact(sessionId: string) {
    return request<void>(this.config, "POST", `/api/session/${encodeURIComponent(sessionId)}/compact`)
  }

  wait(sessionId: string) {
    return request<void>(this.config, "POST", `/api/session/${encodeURIComponent(sessionId)}/wait`)
  }

  listModels() {
    // v2 returns { items: { location, project, data: Model[] } } on installed builds;
    // source-tree shape is { items: Model[] }. Normalize to the models array.
    return request<{ items: OpenCodeModel[] | { data?: OpenCodeModel[]; location?: unknown; project?: unknown }; data?: OpenCodeModel[] }>(
      this.config,
      "GET",
      "/api/model",
    )
  }

  listProviders() {
    return request<{ items: OpenCodeProvider[] | { data?: OpenCodeProvider[]; location?: unknown; project?: unknown }; data?: OpenCodeProvider[] }>(
      this.config,
      "GET",
      "/api/provider",
    )
  }

  /** Raw URL for SSE proxying (server-side). */
  eventStreamUrl(): string {
    return buildUrl(this.config, "/event")
  }

  get config_() {
    return this.config
  }
}

export type OpenCodeEvent = {
  type: string
  properties?: Record<string, unknown>
  [key: string]: unknown
}

/** Parse one SSE chunk into discrete events. */
export function parseSseChunk(chunk: string): OpenCodeEvent[] {
  const events: OpenCodeEvent[] = []
  const blocks = chunk.split(/\r?\n\r?\n/)
  for (const block of blocks) {
    if (!block.trim()) continue
    const dataLines: string[] = []
    let event = ""
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":")) continue
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length === 0) continue
    const dataStr = dataLines.join("\n")
    const parsed = safeJson(dataStr)
    events.push({
      type: event || (typeof parsed === "object" && parsed && "type" in parsed ? String((parsed as any).type) : "message"),
      properties: typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : { raw: dataStr },
      raw: dataStr,
    })
  }
  return events
}