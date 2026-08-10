"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { Button, StatusPill, Spinner, Empty, Stat } from "@/components/ui"
import { Avatar, AGENT_PALETTE } from "@/components/Avatar"
import { ChatShell, ChatHeader, ChatComposer } from "@/components/ChatShell"
import { MessageList, MessageBubble } from "@/components/MessageBubble"

type HermesStatus = {
  reachable: boolean
  model: string | null
  provider: string | null
  pythonVersion: string | null
  envFileExists: boolean | null
  apiKeys: { name: string; configured: boolean }[]
  authProviders: { name: string; loggedIn: boolean; detail?: string }[]
}

type HermesSession = { id: string; preview: string; lastActive: string; source: string }
type SessionStats = { totalSessions: number | null; totalMessages: number | null; bySource: { source: string; sessions: number }[]; databaseSize: string | null }

type PtySession = { id: number; pid: number; cwd: string; startedAt: number; lastLines: string[] }
type PtyState = { available: boolean; reason?: string; sessions: PtySession[] }

type Tab = "chat" | "sessions" | "credentials" | "tools"

export default function HermesPage() {
  const [status, setStatus] = useState<HermesStatus | null>(null)
  const [sessions, setSessions] = useState<HermesSession[]>([])
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [pty, setPty] = useState<PtyState | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("chat")

  const refresh = useCallback(async () => {
    try {
      const [s, sess, st, p] = await Promise.all([
        fetch("/api/hermes?what=status").then((r) => r.json()),
        fetch("/api/hermes?what=sessions").then((r) => r.json()),
        fetch("/api/hermes?what=stats").then((r) => r.json()),
        fetch("/api/hermes/pty").then((r) => r.json()),
      ])
      setStatus(s)
      setSessions(sess?.ok ? sess.data : [])
      setStats(st)
      setPty(p)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 8000)
    return () => clearInterval(id)
  }, [refresh])

  return (
    <div className="flex flex-col gap-3 h-full min-h-0 overflow-hidden">
      <Hero status={status} loading={loading} />

      <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat label="Sessions" value={stats?.totalSessions ?? "—"} accent="#ff6b8b" sub="SQLite store" />
        <Stat label="Messages" value={stats?.totalMessages ?? "—"} accent="#a78bfa" />
        <Stat label="DB size" value={stats?.databaseSize ?? "—"} accent="#9dff5b" />
        <Stat label="PTY" value={pty?.available ? "ready" : "n/a"} accent="#22e3ff" sub={pty?.reason} />
      </section>

      <div className="rounded-2xl glass-strong overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-1 px-3 pt-3 border-b border-white/10 overflow-x-auto">
          <Tab active={tab === "chat"} onClick={() => setTab("chat")} label="Chat" agent="hermes" />
          <Tab active={tab === "sessions"} onClick={() => setTab("sessions")} label="Sessions" agent="hermes" badge={sessions.length} />
          <Tab active={tab === "credentials"} onClick={() => setTab("credentials")} label="Credentials" agent="hermes" />
          <Tab active={tab === "tools"} onClick={() => setTab("tools")} label="Tools" agent="hermes" />
        </div>
        <div className="p-4 flex-1 min-h-0 flex flex-col">
          {tab === "chat" && <ChatTab status={status} pty={pty} onRefresh={refresh} />}
          {tab === "sessions" && <SessionsTab sessions={sessions} stats={stats} />}
          {tab === "credentials" && <CredentialsTab status={status} />}
          {tab === "tools" && <ToolsTab />}
        </div>
      </div>
    </div>
  )
}

function Hero({ status, loading }: { status: HermesStatus | null; loading: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="relative overflow-hidden rounded-2xl glass-strong p-6 sm:p-8"
    >
      <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(255,107,139,0.3), transparent)", filter: "blur(24px)" }} />
      <div className="relative flex flex-wrap items-center gap-4">
        <Avatar agent="hermes" size={56} online={!!status?.reachable} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.4em] text-white/40">Native agent</div>
          <div className="text-2xl sm:text-3xl font-bold tracking-tight"><span className="neon-text">Hermes</span></div>
          <div className="mt-1 text-sm text-white/55">
            {loading ? "Probing…" : status?.reachable
              ? `${status.model ?? "unknown model"} · ${status.provider ?? "unknown provider"} · Python ${status.pythonVersion ?? "?"}`
              : "hermes CLI not reachable"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill on={!!status?.reachable} label={status?.reachable ? "online" : "offline"} color="#ff6b8b" />
        </div>
      </div>
    </motion.div>
  )
}

function Tab({ active, onClick, label, agent, badge }: { active: boolean; onClick: () => void; label: string; agent: string; badge?: number }) {
  const palette = AGENT_PALETTE[agent]
  const c = palette?.c1 ?? "#22e3ff"
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-t-lg text-xs font-semibold transition-all focus-ring inline-flex items-center gap-1.5 ${active ? "" : "text-white/50 hover:text-white/80"}`}
      style={active ? { color: c, background: `linear-gradient(180deg, transparent, ${c}10)`, borderBottom: `2px solid ${c}` } : { borderBottom: "2px solid transparent" }}
    >
      {label}
      {badge != null && badge > 0 && <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-white/10">{badge}</span>}
    </button>
  )
}

function ChatTab({ status, pty, onRefresh }: { status: HermesStatus | null; pty: PtyState | null; onRefresh: () => void }) {
  const [cwd, setCwd] = useState("")
  const [activeId, setActiveId] = useState<number | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [input, setInput] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  const pollOutput = useCallback(async (id: number) => {
    try {
      const r = await fetch(`/api/hermes/pty/${id}`)
      if (r.status === 404) { setActiveId(null); setLines([]); return }
      const d = await r.json()
      setLines(d.lines ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (activeId == null) {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
      return
    }
    pollOutput(activeId)
    pollRef.current = setInterval(() => pollOutput(activeId), 1500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeId, pollOutput])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (lines.length !== lastCount.current) {
      lastCount.current = lines.length
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
      })
    }
  }, [lines])

  async function spawn() {
    const r = await fetch("/api/hermes/pty", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: cwd || undefined }) })
    const d = await r.json()
    if (d.ok) {
      setActiveId(d.session.id)
      onRefresh()
    }
  }

  async function send() {
    if (activeId == null || !input) return
    await fetch(`/api/hermes/pty/${activeId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "input", data: input + "\n" }) })
    setInput("")
    setTimeout(() => pollOutput(activeId), 300)
  }

  async function interrupt() {
    if (activeId == null) return
    await fetch(`/api/hermes/pty/${activeId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "interrupt" }) })
    setTimeout(() => pollOutput(activeId), 300)
  }
  async function kill() {
    if (activeId == null) return
    await fetch(`/api/hermes/pty/${activeId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "kill" }) })
    setActiveId(null); setLines([])
    onRefresh()
  }

  const available = !!pty?.available
  const presence: "online" | "offline" | "busy" = activeId != null ? "online" : available ? "online" : "offline"

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] h-full min-h-[520px]">
      <aside className="rounded-2xl glass flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Avatar agent="hermes" size={26} online={available} />
            <div className="text-sm font-semibold">PTY sessions</div>
          </div>
        </div>
        <div className="p-3 space-y-2">
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="cwd (optional)"
            className="w-full rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs text-white/80 placeholder:text-white/30 focus-ring"
          />
          <Button onClick={spawn} disabled={!available || activeId != null} className="w-full">{activeId != null ? "Chat active" : "New chat"}</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 pt-0 space-y-1.5">
          {!available && <Empty glyph="▮" title="PTY unavailable" sub={pty?.reason} />}
          {available && activeId != null && (
            <div className="rounded-xl p-3 bg-white/5 border border-white/10">
              <div className="flex items-center gap-2">
                <Avatar agent="hermes" size={28} online />
                <div className="min-w-0">
                  <div className="text-xs font-semibold">session #{activeId}</div>
                  <div className="text-[10px] text-white/45">pid {pty?.sessions.find(s => s.id === activeId)?.pid ?? "—"}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      <ChatShell
        header={{
          agent: "hermes",
          title: activeId != null ? `Hermes chat · #${activeId}` : "Hermes chat",
          subtitle: activeId != null ? "real terminal · hermes chat --cli" : "Press New chat to start",
          presence,
          actions: activeId != null ? (
            <>
              <Button variant="ghost" onClick={interrupt}>Interrupt</Button>
              <Button variant="danger" onClick={kill}>Kill</Button>
            </>
          ) : undefined,
        }}
      >
        <MessageList
          ref={listRef}
          className="absolute inset-0 font-mono"
          footer={
            activeId != null ? (
              <ChatComposer
                value={input}
                onChange={setInput}
                onSend={send}
                placeholder="Type a message and press Enter…"
                agent="hermes"
              />
            ) : undefined
          }
        >
          {activeId == null && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <Avatar agent="hermes" size={72} online={available} />
              <div className="mt-4 text-base font-semibold text-white">{available ? "No active chat" : "PTY unavailable"}</div>
              <div className="mt-1 max-w-sm text-xs text-white/45">{available ? "Press New chat to launch hermes chat --cli in a real PTY." : pty?.reason}</div>
            </div>
          )}
          {activeId != null && lines.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <Avatar agent="hermes" size={56} online />
              <div className="mt-3 text-sm text-white/55">Waiting for Hermes…</div>
            </div>
          )}
          {activeId != null && lines.map((l, i) => (
            <div key={i} className="text-[12.5px] leading-relaxed whitespace-pre-wrap font-mono text-white/85">{l || "\u00a0"}</div>
          ))}
        </MessageList>
      </ChatShell>
    </div>
  )
}

function SessionsTab({ sessions, stats }: { sessions: HermesSession[]; stats: SessionStats | null }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-2xl glass p-4 min-h-[400px]">
        <div className="flex items-center gap-2 mb-3">
          <Avatar agent="hermes" size={26} online />
          <div className="text-sm font-semibold">Recent sessions</div>
          <span className="ml-auto text-[10px] text-white/35">hermes sessions list</span>
        </div>
        <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
          {sessions.length === 0 && <Empty glyph="◷" title="No sessions" />}
          {sessions.map((s) => (
            <div key={s.id} className="rounded-xl px-3 py-2 bg-white/[0.03] border border-white/5 hover-lift">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider px-1.5 rounded bg-neon-rose/15 text-neon-rose">{s.source}</span>
                <span className="text-[10px] text-white/40">{s.lastActive}</span>
                <span className="ml-auto font-mono text-[10px] text-white/35">{s.id}</span>
              </div>
              <div className="mt-1 text-xs text-white/70 line-clamp-1">{s.preview}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl glass p-4">
        <div className="flex items-center gap-2 mb-3">
          <Avatar agent="hermes" size={26} />
          <div className="text-sm font-semibold">Storage</div>
        </div>
        <div className="space-y-3">
          <Row label="Total sessions" value={stats?.totalSessions ?? "—"} />
          <Row label="Total messages" value={stats?.totalMessages ?? "—"} />
          <Row label="DB size" value={stats?.databaseSize ?? "—"} />
          {stats?.bySource && stats.bySource.length > 0 && (
            <div className="pt-2 border-t border-white/5">
              <div className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">By source</div>
              {stats.bySource.map((s) => (
                <div key={s.source} className="flex items-center justify-between text-xs py-1">
                  <span className="text-white/70">{s.source}</span>
                  <span className="font-mono text-white/55">{s.sessions}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-white/60">{label}</span>
      <span className="font-mono text-white/90">{value}</span>
    </div>
  )
}

function CredentialsTab({ status }: { status: HermesStatus | null }) {
  if (!status?.reachable) return <Empty glyph="✶" title="Hermes not reachable" />
  return (
    <div className="grid gap-4 lg:grid-cols-2 min-h-[400px]">
      <div className="rounded-2xl glass p-4">
        <div className="flex items-center gap-2 mb-3">
          <Avatar agent="hermes" size={26} />
          <div className="text-sm font-semibold">API keys</div>
        </div>
        <div className="space-y-1.5">
          {status.apiKeys.map((k) => (
            <div key={k.name} className="flex items-center gap-2 rounded-lg px-3 py-2 bg-white/[0.03] border border-white/5">
              <Avatar agent="system" size={26} online={k.configured} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-white/80">{k.name}</div>
                <div className="text-[10px] text-white/35 font-mono">{k.configured ? "configured" : "missing"}</div>
              </div>
              <StatusPill on={k.configured} label={k.configured ? "set" : "missing"} color="#9dff5b" />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl glass p-4">
        <div className="flex items-center gap-2 mb-3">
          <Avatar agent="hermes" size={26} />
          <div className="text-sm font-semibold">Auth providers</div>
        </div>
        <div className="space-y-1.5">
          {status.authProviders.length === 0 && <Empty glyph="◯" title="None reported" />}
          {status.authProviders.map((a) => (
            <div key={a.name} className="flex items-center gap-2 rounded-lg px-3 py-2 bg-white/[0.03] border border-white/5">
              <Avatar agent="hermes" size={26} online={a.loggedIn} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-white/80">{a.name}</div>
                {a.detail && <div className="text-[10px] text-white/35 truncate">{a.detail}</div>}
              </div>
              <StatusPill on={a.loggedIn} label={a.loggedIn ? "logged in" : "—"} color="#22e3ff" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ToolsTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-2 min-h-[400px]">
      <DashboardPanel />
      <ClawPanel />
    </div>
  )
}

function DashboardPanel() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [running, setRunning] = useState<boolean | null>(null)
  async function check() {
    try {
      const r = await fetch("/api/hermes/dashboard")
      const d = await r.json()
      setRunning(d.running)
    } catch { setRunning(false) }
  }
  useEffect(() => { check() }, [])
  async function launch() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch("/api/hermes/dashboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "launch", port: 9119 }) })
      const d = await r.json()
      setMsg(d.message)
      await check()
    } finally { setBusy(false) }
  }
  async function stop() {
    setBusy(true); setMsg(null)
    try {
      await fetch("/api/hermes/dashboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) })
      setMsg("Hermes dashboard stopped.")
      await check()
    } finally { setBusy(false) }
  }
  return (
    <div className="rounded-2xl glass p-4">
      <div className="flex items-center gap-3 mb-3">
        <Avatar agent="hermes" size={36} online={running ?? false} />
        <div>
          <div className="text-sm font-semibold">Hermes dashboard</div>
          <div className="text-[11px] text-white/45">native web UI on http://127.0.0.1:9119</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill on={!!running} label={running ? "running" : "stopped"} color="#ff6b8b" />
        <div className="ml-auto flex gap-2">
          <Button onClick={launch} disabled={busy || !running ? false : true}>{busy ? <Spinner /> : null} Launch</Button>
          <Button variant="ghost" onClick={stop} disabled={busy || !running}>Stop</Button>
        </div>
      </div>
      {msg && <div className="mt-3 text-xs text-white/70 rounded-lg px-3 py-2 bg-white/5 border border-white/10">{msg}</div>}
    </div>
  )
}

function ClawPanel() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [raw, setRaw] = useState<string | null>(null)
  async function run(action: "migrate" | "cleanup") {
    setBusy(true); setMsg(null); setRaw(null)
    try {
      const r = await fetch("/api/hermes/claw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) })
      const d = await r.json()
      setMsg(d.message)
      if (d.raw) setRaw(typeof d.raw === "string" ? d.raw : JSON.stringify(d.raw, null, 2))
    } finally { setBusy(false) }
  }
  return (
    <div className="rounded-2xl glass p-4">
      <div className="flex items-center gap-3 mb-3">
        <Avatar agent="openclaw" size={36} />
        <div>
          <div className="text-sm font-semibold">OpenClaw migration</div>
          <div className="text-[11px] text-white/45">hermes claw migrate / cleanup</div>
        </div>
      </div>
      <p className="text-xs text-white/55">
        OpenClaw isn't installed separately on this machine. Hermes ships a migration tool that imports OpenClaw settings, memories, skills, and API keys, then archives leftover directories.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={() => run("migrate")} disabled={busy}>{busy ? <Spinner /> : null} Migrate OpenClaw → Hermes</Button>
        <Button variant="ghost" onClick={() => run("cleanup")} disabled={busy}>Cleanup leftovers</Button>
      </div>
      {msg && <div className="mt-3 text-xs text-white/70 rounded-lg px-3 py-2 bg-white/5 border border-white/10">{msg}</div>}
      {raw && (
        <details className="mt-2">
          <summary className="text-[11px] text-white/40 cursor-pointer">raw output</summary>
          <pre className="mt-2 term-area max-h-48 overflow-auto text-[11px] text-white/60">{raw}</pre>
        </details>
      )}
    </div>
  )
}