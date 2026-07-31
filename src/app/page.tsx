"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { useEffect, useState } from "react"
import { Avatar, AGENT_PALETTE } from "@/components/Avatar"
import { ChatShell, ChatHeader } from "@/components/ChatShell"
import { MessageList, MessageBubble } from "@/components/MessageBubble"
import { Stat, Spinner } from "@/components/ui"

type HealthData = {
  opencode?: { reachable: boolean; running: boolean; pid: number | null; baseUrl: string; port: number | null; managed: boolean; authRequired?: boolean; passwordConfigured?: boolean }
  hermesPty?: { available: boolean; reason?: string }
  version?: string
}

type AgentEntry = {
  id: string
  label: string
  kind: "primary" | "native" | "extensible"
  color: string
  description: string
  category?: string
  launchCommand?: string[]
  url?: string
}

const PRIMARY_AGENT_IDS = ["opencode", "hermes"]
const SECONDARY_AGENT_IDS = ["claude", "kimi", "agy", "codex", "openclaw"]

export default function OverviewPage() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [h, a] = await Promise.all([
          fetch("/api/health").then((r) => r.json()),
          fetch("/api/agents").then((r) => r.json()),
        ])
        if (cancelled) return
        setHealth(h)
        setAgents(a?.items ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 7000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const oc = health?.opencode
  const pty = health?.hermesPty
  const primaryCount = agents.filter((a) => a.kind === "primary").length
  const nativeCount = agents.filter((a) => a.kind === "native").length
  const extCount = agents.filter((a) => a.kind === "extensible").length

  return (
    <div className="space-y-6">
      <Hero />

      <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat label="OpenCode" value={loading ? <Spinner /> : oc?.reachable ? "online" : "offline"} accent="#22e3ff" sub={oc?.baseUrl} />
        <Stat label="Hermes PTY" value={loading ? <Spinner /> : pty?.available ? "ready" : "n/a"} accent="#ff6b8b" sub={pty?.reason} />
        <Stat label="Primary agents" value={primaryCount} accent="#a78bfa" sub="built-in sections" />
        <Stat label="Extensible slots" value={extCount} accent="#9dff5b" sub="agent fleet" />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <SectionTitle>Primary agents</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {PRIMARY_AGENT_IDS.map((id) => {
              const a = agents.find((x) => x.id === id)
              if (!a) return null
              return <PrimaryAgentCard key={id} agent={a} presence={presenceFor(id, health)} />
            })}
          </div>

          <SectionTitle>More agents</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SECONDARY_AGENT_IDS.map((id) => {
              const a = agents.find((x) => x.id === id)
              if (!a) return null
              return <SecondaryAgentCard key={id} agent={a} />
            })}
          </div>
        </div>

        <div className="space-y-4">
          <SectionTitle>System status</SectionTitle>
          <ChatShell
            className="min-h-[420px]"
            header={{
              agent: "system",
              title: "Mission control",
              subtitle: "Local services",
              presence: "online",
            }}
          >
            <MessageList className="absolute inset-0">
              <MessageBubble m={{ id: "h-oc", role: "system", content: "Bridge status", time: Date.now() - 60000 }} />
              <MessageBubble
                m={{
                  id: "h-oc-2",
                  role: "assistant",
                  agent: "opencode",
                  author: "opencode",
                  time: Date.now() - 50000,
                  content: oc?.reachable ? `Reachable at ${oc?.baseUrl}` : "Offline — start server in OpenCode section.",
                  meta: oc?.managed ? `managed pid ${oc?.pid}` : oc?.reachable ? "external" : "—",
                }}
              />
              <MessageBubble m={{ id: "h-pty", role: "system", content: "PTY sidecar", time: Date.now() - 40000 }} />
              <MessageBubble
                m={{
                  id: "h-pty-2",
                  role: "assistant",
                  agent: "hermes",
                  author: "hermes",
                  time: Date.now() - 30000,
                  content: pty?.available ? "node-pty loaded — interactive chat available." : (pty?.reason ?? "PTY not loaded."),
                  meta: pty?.available ? "ready" : "n/a",
                }}
              />
              <MessageBubble m={{ id: "h-ver", role: "system", content: "Runtime", time: Date.now() - 20000 }} />
              <MessageBubble
                m={{
                  id: "h-ver-2",
                  role: "assistant",
                  agent: "system",
                  time: Date.now() - 10000,
                  content: `Mission Control v${health?.version ?? "2.0.0"} · Next.js · Tailwind · Framer Motion`,
                  meta: "all checks green",
                }}
              />
            </MessageList>
          </ChatShell>
        </div>
      </section>
    </div>
  )
}

function Hero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="relative overflow-hidden rounded-2xl glass-strong p-6 sm:p-10"
    >
      <div className="absolute -right-24 -top-28 h-80 w-80 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(34,227,255,0.32), transparent)", filter: "blur(28px)" }} />
      <div className="absolute -left-20 -bottom-32 h-80 w-80 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(255,68,216,0.22), transparent)", filter: "blur(28px)" }} />
      <div className="relative max-w-3xl">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.4em] text-white/40">
          <span className="inline-block w-6 h-px bg-white/30" />
          Local mission control
        </div>
        <h1 className="mt-3 text-3xl sm:text-5xl font-bold tracking-tight">
          <span className="neon-text">OpenCode</span> <span className="text-white/95">Operating System</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm sm:text-base text-white/55 leading-relaxed">
          A messenger-grade dashboard for your AI agents. Drive OpenCode over its HTTP bridge, run Hermes from a real PTY, and extend the fleet with one config file. Everything stays on 127.0.0.1.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/opencode" className="rounded-xl px-4 py-2 text-sm font-semibold text-void-950 bg-gradient-to-br from-neon-cyan to-blue-500 hover:opacity-95 focus-ring inline-flex items-center gap-2">
            <span>Open OpenCode</span>
            <span>→</span>
          </Link>
          <Link href="/hermes" className="rounded-xl px-4 py-2 text-sm font-semibold text-white/90 bg-white/5 hover:bg-white/10 border border-white/10 focus-ring inline-flex items-center gap-2">
            <span>Open Hermes</span>
            <span>→</span>
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-1 text-[10px] uppercase tracking-[0.28em] text-white/40">{children}</div>
}

function PrimaryAgentCard({ agent, presence }: { agent: AgentEntry; presence?: boolean }) {
  const palette = AGENT_PALETTE[agent.id]
  return (
    <Link
      href={`/${agent.id}`}
      className="group rounded-2xl glass-strong hover-lift p-4 block focus-ring relative overflow-hidden"
      style={{ borderColor: presence ? (palette?.c1 + "44") : "rgba(120,160,255,0.14)" }}
    >
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-60" style={{ background: `radial-gradient(closest-side, ${palette?.c1}33, transparent)` }} />
      <div className="relative">
        <div className="flex items-start gap-3">
          <Avatar agent={agent.id} size={48} online={presence} />
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-white">{agent.label}</div>
            <div className="text-[11px] text-white/45 mt-0.5 capitalize">{agent.kind} · {agent.category ?? "general"}</div>
          </div>
          <div className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider" style={{ background: presence ? `${palette?.c1}1a` : "rgba(75,85,117,0.18)", color: presence ? palette?.c1 : "#8892b0" }}>
            {presence ? "online" : "offline"}
          </div>
        </div>
        <p className="mt-3 text-xs text-white/55 leading-relaxed">{agent.description}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-[10px] text-white/35">Open agent →</div>
          <div className="text-white/30 group-hover:text-white group-hover:translate-x-0.5 transition">→</div>
        </div>
      </div>
    </Link>
  )
}

function SecondaryAgentCard({ agent }: { agent: AgentEntry }) {
  return (
    <Link
      href={`/agent/${agent.id}`}
      className="group rounded-2xl glass hover-lift p-3.5 block focus-ring relative overflow-hidden"
    >
      <div className="flex items-center gap-3">
        <Avatar agent={agent.id} size={40} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white/95 truncate">{agent.label}</div>
          <div className="text-[10px] text-white/40 truncate capitalize">{agent.kind} · {agent.category ?? "general"}</div>
        </div>
        <span className="text-white/25 group-hover:text-white/70 group-hover:translate-x-0.5 transition">→</span>
      </div>
      <p className="mt-2 text-[11px] text-white/45 line-clamp-2 leading-relaxed">{agent.description}</p>
    </Link>
  )
}

function presenceFor(id: string, health: HealthData | null): boolean | undefined {
  if (id === "opencode") return health?.opencode?.reachable
  if (id === "hermes") return health?.hermesPty?.available
  return undefined
}