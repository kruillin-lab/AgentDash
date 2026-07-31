"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Panel, PanelHeader, Button, StatusPill, Spinner, Empty, Stat } from "@/components/ui"
import { Avatar, AGENT_PALETTE } from "@/components/Avatar"
import { ChatShell, ChatHeader, ChatComposer } from "@/components/ChatShell"
import { MessageList, MessageBubble, TypingIndicator } from "@/components/MessageBubble"

type ServerStatus = {
  running: boolean
  reachable: boolean
  authRequired: boolean
  pid: number | null
  baseUrl: string
  port: number | null
  startedAt: number | null
  managed: boolean
  passwordConfigured: boolean
}

type Session = {
  id: string
  title?: string
  model?: { id?: string; providerID?: string; variant?: string } | string
  time?: { created?: number; updated?: number; archived?: number | null }
  created?: number | string
  updated?: number | string
  location?: { directory?: string; workspaceID?: string | null }
  cwd?: string
  path?: string
  agent?: string
  [key: string]: unknown
}

type SessionsResponse = { items: Session[]; cursor?: { previous?: string; next?: string } }

type Model = { id: string; name?: string; providerID?: string; family?: string; status?: string; enabled?: boolean; cost?: Array<{ input?: number; output?: number }>; limit?: { context?: number; input?: number | null; output?: number | null }; [k: string]: unknown }
type Provider = { id: string; name?: string; [k: string]: unknown }

type RawMessage = {
  id?: string
  role?: string
  type?: string
  content?: unknown
  text?: string
  [key: string]: unknown
}

type EventItem = {
  type: string
  properties?: Record<string, unknown>
  raw?: string
  at: number
}

export default function OpenCodePage() {
  const [server, setServer] = useState<ServerStatus | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<"models" | "providers" | "events">("models")
  const [error, setError] = useState<string | null>(null)

  const refreshServer = useCallback(async () => {
    try {
      const r = await fetch("/api/opencode/server")
      const d = await r.json()
      setServer(d)
      return d?.reachable ?? false
    } catch {
      setServer(null)
      return false
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      const r = await fetch("/api/opencode/sessions?limit=40&order=desc")
      if (!r.ok) { setSessions([]); return }
      const d: SessionsResponse = await r.json()
      setSessions(d.items ?? [])
    } catch {
      setSessions([])
    }
  }, [])

  const refreshCatalog = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([
        fetch("/api/opencode/models").then((r) => r.json()).catch(() => ({ items: [] })),
        fetch("/api/opencode/providers").then((r) => r.json()).catch(() => ({ items: [] })),
      ])
      setModels(m.items ?? [])
      setProviders(p.items ?? [])
    } catch {
      /* ignore */
    }
  }, [])

  const reachable = server?.reachable ?? false
  const authBlocked = reachable && !!server?.authRequired && !server?.passwordConfigured
  const canUseApi = reachable && !authBlocked

  useEffect(() => {
    refreshServer().then((r) => {
      if (r) {
        refreshSessions()
        refreshCatalog()
      }
    })
  }, [refreshServer, refreshSessions, refreshCatalog])

  useEffect(() => {
    const id = setInterval(() => {
      refreshServer().then((r) => {
        if (r) refreshSessions()
      })
    }, 6000)
    return () => clearInterval(id)
  }, [refreshServer, refreshSessions])

  useEffect(() => {
    if (!canUseApi) return
    let es: EventSource | null = null
    try {
      es = new EventSource("/api/opencode/events")
      es.onmessage = (e) => pushEvent(e, "message")
      es.onerror = () => { /* auto-reconnect */ }
      const handler = (e: MessageEvent) => pushEvent(e, e.type)
      for (const t of ["session", "message", "tool", "agent", "error", "info", "notification", "diagnostics"]) {
        es.addEventListener(t, handler as any)
      }
    } catch { /* ignore */ }
    function pushEvent(e: MessageEvent, type: string) {
      try {
        const parsed = JSON.parse(e.data)
        setEvents((prev) => [...prev.slice(-120), { type: parsed.type ?? type, properties: parsed.properties ?? parsed, raw: e.data, at: Date.now() }])
      } catch {
        setEvents((prev) => [...prev.slice(-120), { type, raw: e.data, at: Date.now() }])
      }
    }
    return () => { try { es?.close() } catch {} }
  }, [canUseApi])

  async function ensureServer() {
    setBusy(true); setError(null)
    try {
      const r = await fetch("/api/opencode/server", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ensure" }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message ?? "failed")
      await refreshServer()
      await refreshSessions()
      await refreshCatalog()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function stopServer() {
    setBusy(true); setError(null)
    try {
      await fetch("/api/opencode/server", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) })
      await refreshServer()
      setEvents([])
    } finally {
      setBusy(false)
    }
  }

  const selectedSession = useMemo(() => sessions.find((s) => s.id === selected) ?? null, [sessions, selected])

  return (
    <div className="flex flex-col gap-3 h-full min-h-0 overflow-hidden">
      <ServerControl server={server} reachable={reachable} authBlocked={authBlocked} busy={busy} onEnsure={ensureServer} onStop={stopServer} error={error} />

      <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)_360px] flex-1 min-h-0">
        <SessionsRail
          sessions={sessions}
          selected={selected}
          onSelect={setSelected}
          canUseApi={canUseApi}
          authBlocked={authBlocked}
          onRefresh={refreshSessions}
        />

        {selectedSession ? (
          <Console session={selectedSession} canUseApi={canUseApi} authBlocked={authBlocked} />
        ) : (
          <EmptyConsole canUseApi={canUseApi} authBlocked={authBlocked} />
        )}

        <ContextPanel
          tab={tab}
          setTab={setTab}
          models={models}
          providers={providers}
          events={events}
          canUseApi={canUseApi}
        />
      </div>
    </div>
  )
}

function ServerControl({ server, reachable, authBlocked, busy, onEnsure, onStop, error }: { server: ServerStatus | null; reachable: boolean; authBlocked: boolean; busy: boolean; onEnsure: () => void; onStop: () => void; error: string | null }) {
  return (
    <div className="glass-strong rounded-2xl p-4 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-3">
        <Avatar agent="opencode" size={44} online={reachable && !authBlocked} />
        <div>
          <div className="text-sm font-semibold text-white">OpenCode HTTP bridge</div>
          <div className="text-xs text-white/45">{server?.baseUrl ?? "http://127.0.0.1:4096"}{server?.managed ? ` · managed pid ${server.pid}` : server?.reachable ? " · external" : " · not running"}</div>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <StatusPill on={reachable && !authBlocked} label={authBlocked ? "auth needed" : reachable ? "reachable" : "offline"} color={authBlocked ? "#ffb454" : "#22e3ff"} />
        {!reachable ? (
          <Button onClick={onEnsure} disabled={busy}>{busy ? <Spinner /> : null} Start server</Button>
        ) : (
          <Button variant="ghost" onClick={onStop} disabled={busy || !server?.managed}>Stop</Button>
        )}
      </div>
      {authBlocked && (
        <div className="w-full rounded-xl px-3 py-2 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-200">
          An OpenCode server is running at {server?.baseUrl} but requires a password, and <span className="font-mono">OPENCODE_SERVER_PASSWORD</span> is not set. Set it in your environment and restart the dashboard, or stop the external server and use Start server to spawn a managed one with the password you set.
        </div>
      )}
      {error && (
        <div className="w-full rounded-xl px-3 py-2 text-xs bg-rose-500/10 border border-rose-500/30 text-rose-200">
          {error}
        </div>
      )}
    </div>
  )
}

function SessionsRail({ sessions, selected, onSelect, canUseApi, authBlocked, onRefresh }: { sessions: Session[]; selected: string | null; onSelect: (id: string) => void; canUseApi: boolean; authBlocked: boolean; onRefresh: () => void }) {
  const [creating, setCreating] = useState(false)
  async function createNew() {
    if (!canUseApi || creating) return
    setCreating(true)
    try {
      const r = await fetch("/api/opencode/sessions/create", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      if (r.ok) {
        const d = await r.json()
        const id = d?.session?.id
        await onRefresh()
        if (id) onSelect(id)
      }
    } finally { setCreating(false) }
  }
  return (
    <aside className="rounded-2xl glass-strong flex flex-col overflow-hidden h-full min-h-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Avatar agent="opencode" size={26} online={canUseApi} />
          <div className="text-sm font-semibold">Sessions</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} className="text-[10px] uppercase tracking-wider text-white/40 hover:text-white">refresh</button>
          <button
            onClick={createNew}
            disabled={!canUseApi || creating}
            className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md bg-neon-cyan/15 text-neon-cyan hover:bg-neon-cyan/25 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {creating ? "…" : "+ new"}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {!canUseApi && (
          <div className="p-4">
            <Empty
              glyph="⌬"
              title={authBlocked ? "Auth required" : "Server offline"}
              sub={authBlocked ? "Set OPENCODE_SERVER_PASSWORD in .env." : "Press Start server above."}
            />
          </div>
        )}
        {canUseApi && sessions.length === 0 && (
          <div className="p-4"><Empty glyph="◯" title="No sessions yet" sub="Click + new to start a chat." /></div>
        )}
        {canUseApi && sessions.map((s) => (
          <SessionRow key={s.id} session={s} active={selected === s.id} onSelect={() => onSelect(s.id)} />
        ))}
      </div>
    </aside>
  )
}

function SessionRow({ session, active, onSelect }: { session: Session; active: boolean; onSelect: () => void }) {
  const title = session.title || session.id
  const modelId = typeof session.model === "string" ? session.model : session.model?.id
  const updatedMs = session.time?.updated ?? (typeof session.updated === "number" ? session.updated : null)
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-xl px-3 py-2.5 transition-all focus-ring border ${active ? "bg-white/10 border-white/30" : "bg-transparent border-transparent hover:bg-white/5"}`}
    >
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <Avatar agent={modelId ? "opencode" : "system"} size={34} online />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-white truncate">{title}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-white/40 truncate">
            {modelId && <span className="px-1.5 rounded bg-white/5 text-white/55">{modelId}</span>}
            {updatedMs && <span className="text-white/30">· {relativeTime(updatedMs)}</span>}
          </div>
        </div>
      </div>
    </button>
  )
}

function EmptyConsole({ canUseApi, authBlocked }: { canUseApi: boolean; authBlocked: boolean }) {
  return (
    <ChatShell
      header={{
        agent: "opencode",
        title: authBlocked ? "OpenCode — auth required" : "OpenCode",
        subtitle: authBlocked ? "Set OPENCODE_SERVER_PASSWORD" : "Pick a session to start chatting",
        presence: authBlocked ? "busy" : canUseApi ? "online" : "offline",
      }}
    >
      <MessageList className="absolute inset-0">
        <div className="flex flex-col items-center justify-center h-full text-center px-6">
          <Avatar agent="opencode" size={72} />
          <div className="mt-4 text-base font-semibold text-white">{authBlocked ? "Auth required" : canUseApi ? "Select a session" : "Bridge offline"}</div>
          <div className="mt-1 max-w-sm text-xs text-white/45">
            {authBlocked
              ? "Set OPENCODE_SERVER_PASSWORD in your .env and restart the dashboard, or stop the external server and press Start server."
              : canUseApi
              ? "Pick a session on the left to view messages and send prompts."
              : "Press Start server above to launch opencode serve."}
          </div>
        </div>
      </MessageList>
    </ChatShell>
  )
}

function Console({ session, canUseApi, authBlocked }: { session: Session; canUseApi: boolean; authBlocked: boolean }) {
  const sessionId = session.id
  const [messages, setMessages] = useState<RawMessage[]>([])
  const [prompt, setPrompt] = useState("")
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const modelId = typeof session.model === "string" ? session.model : session.model?.id
  const providerId = typeof session.model === "string" ? undefined : session.model?.providerID

  const [pendingEcho, setPendingEcho] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/opencode/sessions/${encodeURIComponent(sessionId)}/messages?order=asc`)
      if (!r.ok) { setMessages([]); return }
      const d = await r.json()
      const items: RawMessage[] = d.items ?? []
      setMessages(items)
      // If the server echoed back our pending prompt, clear the optimistic echo.
      if (pendingEcho) {
        const echoed = items.some((m) => {
          const c = (m as any).content
          if (typeof c === "string") return c.includes(pendingEcho)
          if (Array.isArray(c)) return c.some((p) => p?.text?.includes?.(pendingEcho))
          if (c && typeof c === "object" && "text" in c && typeof (c as any).text === "string") return (c as any).text.includes(pendingEcho)
          return false
        })
        if (echoed) setPendingEcho(null)
      }
    } catch {
      setMessages([])
    }
  }, [sessionId, pendingEcho])

  useEffect(() => { load() }, [load])

  // Adaptive polling: fast right after sending (until server echoes back or
  // assistant responds), then slow when idle.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = () => {
      if (cancelled) return
      load().then(() => {
        const delay = pendingEcho || sending ? 900 : 3500
        timer = setTimeout(tick, delay)
      })
    }
    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [load, pendingEcho, sending])

  async function send() {
    const text = prompt.trim()
    if (!text) return
    setSending(true); setErr(null)
    // Optimistic echo so the user immediately sees their prompt and a
    // thinking indicator while the agent processes.
    setPendingEcho(text)
    try {
      const r = await fetch(`/api/opencode/sessions/${encodeURIComponent(sessionId)}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d?.error?.message ?? `prompt failed (${r.status})`)
      }
      setPrompt("")
      await load()
    } catch (e: any) {
      setErr(e.message)
      setPendingEcho(null) // server rejected; drop the echo
    } finally {
      setSending(false)
    }
  }

  return (
    <ChatShell
      header={{
        agent: "opencode",
        title: session.title || "OpenCode session",
        subtitle: modelId ? `${providerId ? providerId + " · " : ""}${modelId}` : "coding agent",
        meta: sessionId,
        presence: canUseApi ? "online" : authBlocked ? "busy" : "offline",
        actions: (
          <div className="flex items-center gap-2">
            <StatusPill on={canUseApi} label={canUseApi ? "live" : "offline"} color="#22e3ff" />
            <a
              href="http://127.0.0.1:4096/"
              target="_blank"
              rel="noreferrer"
              className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md bg-neon-cyan/15 text-neon-cyan hover:bg-neon-cyan/25 border border-neon-cyan/30 transition"
              title="Opens the opencode web UI directly. Auth prompt will appear — use the credentials shown below."
            >
              Open in opencode ↗
            </a>
          </div>
        ),
      }}
    >
      {err && (
        <div className="absolute top-3 left-3 right-3 z-20 rounded-lg px-3 py-1.5 text-xs bg-rose-500/10 border border-rose-500/30 text-rose-200">
          {err}
        </div>
      )}
      <MessageList
        className="absolute inset-0"
        footer={
          <ChatComposer
            value={prompt}
            onChange={setPrompt}
            onSend={send}
            sending={sending}
            disabled={!canUseApi}
            placeholder={canUseApi ? "Ask OpenCode anything…  (⌘/Ctrl+Enter to send)" : "Bridge offline — cannot send."}
            hint={canUseApi ? `session ${sessionId} · agent is listening` : "Reconnect the bridge to send prompts."}
            agent="opencode"
          />
        }
      >
        {(() => {
          const chatMsgs = messages.filter(isChatMessage)
          const metaMsgs = messages.filter((m) => !isChatMessage(m))
          if (chatMsgs.length === 0 && metaMsgs.length === 0 && !pendingEcho) {
            return (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <Avatar agent="opencode" size={56} online />
                <div className="mt-3 text-sm text-white/55">No messages yet in this session.</div>
                <div className="mt-1 text-xs text-white/35">Type a prompt below to start chatting.</div>
              </div>
            )
          }
          if (chatMsgs.length === 0 && !pendingEcho) {
            return (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <Avatar agent="opencode" size={56} />
                <div className="mt-3 text-sm text-white/55">No chat history in this session.</div>
                <div className="mt-1 text-xs text-white/35 max-w-sm">
                  {metaMsgs.length > 0
                    ? `This session only has metadata (${metaMsgs.length} events). Send a prompt below to start the conversation. The opencode serve API queues prompts; the agent loop runs when an opencode client (web UI or TUI) is active.`
                    : `Send a prompt below to start the conversation. The opencode serve API queues prompts; the agent loop runs when an opencode client is active.`}
                </div>
                <a href="http://127.0.0.1:4096/" target="_blank" rel="noreferrer" className="mt-3 text-[11px] text-neon-cyan hover:underline focus-ring rounded-md px-2 py-1">
                  Open this session in opencode UI ↗
                </a>
                <div className="mt-2 text-[10px] text-white/40">
                  When the browser asks for a login, use:  <span className="text-white/60 font-mono">opencode</span> / <span className="text-white/60 font-mono">(your .env password)</span>
                </div>
              </div>
            )
          }
          return (
            <>
              {messages.map((m, i) => (
                isChatMessage(m)
                  ? <BubbleFromRaw key={(m.id as string) ?? i} raw={m} />
                  : <MetaChip key={(m.id as string) ?? i} raw={m} />
              ))}
            </>
          )
        })()}
        {pendingEcho && (
          <MessageBubble
            m={{
              id: `pending-${Date.now()}`,
              role: "user",
              agent: "user",
              author: "you",
              content: pendingEcho,
              time: Date.now(),
              meta: "sending…",
            }}
          />
        )}
        {(sending || pendingEcho) && <TypingIndicator agent="opencode" />}
      </MessageList>
    </ChatShell>
  )
}

const META_TYPES = new Set(["model-switched", "agent-switched", "session-info", "session-meta"])

function MetaChip({ raw }: { raw: RawMessage }) {
  const summary = summarizeMeta(raw)
  const fallback = summarizeMeta(raw) ?? `${(raw as any).type ?? "event"}`
  return (
    <div className="flex justify-center">
      <div className="rounded-full px-3 py-1 text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-white/45 inline-flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/30" />
        {summary ?? fallback}
      </div>
    </div>
  )
}

function BubbleFromRaw({ raw }: { raw: RawMessage }) {
  const t = ((raw as any).type as string | undefined)?.toLowerCase() ?? ""
  const role = ((raw.role as string) ?? t ?? "assistant").toLowerCase()
  const content = renderMessageContent(raw)
  const agentId = role.includes("user") ? "user" : role.includes("tool") ? "system" : "opencode"
  const author = role.includes("tool") ? "tool" : role.includes("user") ? "you" : "opencode"
  const time = (raw as any).time?.created ?? (raw as any).created ?? undefined
  return (
    <MessageBubble
      m={{
        id: (raw.id as string) ?? Math.random().toString(36).slice(2),
        role: agentId === "user" ? "user" : "assistant",
        agent: agentId,
        author,
        content,
        time: typeof time === "number" ? time : undefined,
        meta: (raw as any).type ? String((raw as any).type) : undefined,
      }}
    />
  )
}

function isChatMessage(raw: RawMessage): boolean {
  const t = ((raw as any).type as string | undefined)?.toLowerCase() ?? ""
  if (META_TYPES.has(t)) return false
  // User or assistant messages (or anything with text content) is chat.
  if (t === "user" || t === "assistant" || t === "tool_result" || t === "tool_use") return true
  const role = ((raw.role as string) ?? "").toLowerCase()
  if (role === "user" || role === "assistant") return true
  // Has text-y content?
  const c: any = (raw as any).content
  if (typeof c === "string" && c.trim().length > 0) return true
  if (typeof (raw as any).text === "string" && (raw as any).text.trim().length > 0) return true
  if (Array.isArray(c) && c.length > 0) return true
  return false
}

function renderMessageContent(raw: RawMessage): string {
  const c: any = raw.content
  if (typeof c === "string") return c
  if (typeof raw.text === "string") return raw.text
  if (Array.isArray(c)) {
    return c.map((part: any) => {
      if (typeof part === "string") return part
      if (part?.text) return part.text
      if (part?.type === "tool_use" || part?.type === "tool_use") return `[tool_use ${part.name ?? ""}] ${JSON.stringify(part.input ?? {}).slice(0, 280)}`
      if (part?.type === "tool_result") return `[tool_result] ${typeof part.content === "string" ? part.content.slice(0, 280) : JSON.stringify(part.content ?? {}).slice(0, 280)}`
      return JSON.stringify(part)
    }).join("\n")
  }
  if (c && typeof c === "object") return JSON.stringify(c, null, 2)
  if (raw.model && typeof raw.model === "object") return `Model: ${(raw.model as any).id ?? ""}${(raw.model as any).providerID ? ` (${(raw.model as any).providerID})` : ""}`
  return JSON.stringify(raw)
}

function summarizeMeta(raw: RawMessage): string | null {
  const t = ((raw as any).type as string | undefined)?.toLowerCase() ?? ""
  if (t === "model-switched" && (raw as any).model) return `Switched model → ${(raw as any).model.id ?? "?"}${(raw as any).model.providerID ? ` (${(raw as any).model.providerID})` : ""}`
  if (t === "agent-switched" && (raw as any).agent) return `Switched agent → ${(raw as any).agent}`
  return null
}

function ContextPanel({ tab, setTab, models, providers, events, canUseApi }: { tab: "models" | "providers" | "events"; setTab: (t: "models" | "providers" | "events") => void; models: Model[]; providers: Provider[]; events: EventItem[]; canUseApi: boolean }) {
  return (
    <aside className="rounded-2xl glass-strong flex flex-col overflow-hidden h-full min-h-0">
      <div className="flex items-center gap-1 px-3 pt-3 border-b border-white/10">
        <TabButton active={tab === "models"} onClick={() => setTab("models")} label="Models" agent="opencode" />
        <TabButton active={tab === "providers"} onClick={() => setTab("providers")} label="Providers" agent="opencode" />
        <TabButton active={tab === "events"} onClick={() => setTab("events")} label="Events" agent="opencode" badge={events.length} />
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {!canUseApi && <Empty glyph="⌬" title="Catalog offline" />}
        {canUseApi && tab === "models" && (models.length === 0 ? <Empty glyph="◯" title="No models" /> : models.slice(0, 80).map((m) => (
          <CatalogRow key={m.id} id={m.id} name={m.name ?? m.id} sub={[m.providerID, m.status].filter(Boolean).join(" · ") || undefined} cost={m.cost?.[0] ? `$${m.cost[0].input}/$${m.cost[0].output} per 1M` : undefined} limit={m.limit?.context ? `${Math.round((m.limit.context || 0) / 1000)}k ctx` : undefined} />
        )))}
        {canUseApi && tab === "providers" && (providers.length === 0 ? <Empty glyph="◯" title="No providers" /> : providers.slice(0, 80).map((p) => (
          <CatalogRow key={p.id} id={p.id} name={p.name ?? p.id} />
        )))}
        {canUseApi && tab === "events" && (events.length === 0 ? <Empty glyph="—" title="Waiting for events" sub="Session updates, tool calls, and agent turns will stream here." /> : events.slice(-80).reverse().map((e, i) => (
          <div key={`${e.at}-${i}`} className="rounded-lg px-3 py-1.5 text-xs font-mono bg-white/[0.03] border border-white/5 flex items-start gap-2">
            <span className="text-white/30 tabular-nums shrink-0">{new Date(e.at).toLocaleTimeString([], { hour12: false })}</span>
            <span className="shrink-0 px-1.5 rounded text-[10px] uppercase tracking-wider" style={{ color: eventColor(e.type), background: `${eventColor(e.type)}14` }}>{e.type}</span>
            <span className="text-white/55 truncate">{eventSummary(e)}</span>
          </div>
        )))}
      </div>
    </aside>
  )
}

function TabButton({ active, onClick, label, agent, badge }: { active: boolean; onClick: () => void; label: string; agent: string; badge?: number }) {
  const palette = AGENT_PALETTE[agent]
  const c = palette?.c1 ?? "#22e3ff"
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all focus-ring inline-flex items-center gap-1.5 ${active ? "" : "text-white/50 hover:text-white/80"}`}
      style={active ? { color: c, background: `${c}14`, border: `1px solid ${c}44` } : { background: "transparent", border: "1px solid transparent" }}
    >
      {label}
      {badge != null && badge > 0 && <span className="text-[9px] rounded-full px-1.5 py-0.5" style={{ background: `${c}33` }}>{badge}</span>}
    </button>
  )
}

function CatalogRow({ id, name, sub, cost, limit }: { id: string; name: string; sub?: string; cost?: string; limit?: string }) {
  return (
    <div className="rounded-lg px-3 py-2 bg-white/[0.03] border border-white/5 hover-lift">
      <div className="flex items-center gap-2">
        <span className="status-dot" style={{ background: "#22e3ff" }} />
        <span className="text-xs text-white/85 truncate">{name}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-white/35 font-mono truncate">
        <span className="truncate">{id}</span>
        {sub && <span className="text-white/30">· {sub}</span>}
        {limit && <span className="text-white/45">· {limit}</span>}
      </div>
      {cost && <div className="mt-0.5 text-[10px] text-white/45">{cost}</div>}
    </div>
  )
}

function eventColor(type: string): string {
  const t = type.toLowerCase()
  if (t.includes("session")) return "#22e3ff"
  if (t.includes("message") || t.includes("agent")) return "#a78bfa"
  if (t.includes("tool")) return "#9dff5b"
  if (t.includes("error")) return "#ff6b8b"
  if (t.includes("diagnostic")) return "#ffb454"
  return "#8892b0"
}

function eventSummary(e: EventItem): string {
  const p = e.properties ?? {}
  const keys = Object.keys(p).filter((k) => !["type"].includes(k))
  if (typeof p.id === "string") return `${p.id}${keys.length > 1 ? ` · ${keys.slice(1, 4).join(", ")}` : ""}`
  if (typeof p.sessionID === "string") return `session ${p.sessionID}`
  return keys.slice(0, 3).join(", ") || e.raw?.slice(0, 80) || ""
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}