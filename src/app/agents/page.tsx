"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { Avatar, AGENT_PALETTE } from "@/components/Avatar"
import { Stat, Spinner } from "@/components/ui"

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

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "primary" | "native" | "extensible">("all")
  const [query, setQuery] = useState("")

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => setAgents(d.items ?? []))
      .finally(() => setLoading(false))
  }, [])

  const grouped = useMemo(() => {
    const f = (a: AgentEntry) =>
      (filter === "all" || a.kind === filter) &&
      (query.trim() === "" || a.label.toLowerCase().includes(query.toLowerCase()) || a.description.toLowerCase().includes(query.toLowerCase()))
    return {
      primary: agents.filter((a) => a.kind === "primary" && f(a)),
      native: agents.filter((a) => a.kind === "native" && f(a)),
      extensible: agents.filter((a) => a.kind === "extensible" && f(a)),
    }
  }, [agents, filter, query])

  return (
    <div className="space-y-6">
      <Hero />

      <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Stat label="Primary" value={agents.filter((a) => a.kind === "primary").length} accent="#22e3ff" />
        <Stat label="Native" value={agents.filter((a) => a.kind === "native").length} accent="#ff6b8b" />
        <Stat label="Extensible" value={agents.filter((a) => a.kind === "extensible").length} accent="#a78bfa" />
        <Stat label="Total" value={agents.length} accent="#9dff5b" />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "primary", "native", "extensible"] as const).map((k) => (
          <FilterPill key={k} active={filter === k} onClick={() => setFilter(k)} label={k} />
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter agents…"
          className="ml-auto w-full sm:w-72 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus-ring"
        />
      </div>

      {grouped.primary.length > 0 && (
        <Group title="Primary agents" subtitle="Full dedicated sections" agentId="opencode">
          {grouped.primary.map((a) => <FleetCard key={a.id} agent={a} featured />)}
        </Group>
      )}
      {grouped.native.length > 0 && (
        <Group title="Native agents" subtitle="Terminal-native, wired in" agentId="hermes">
          {grouped.native.map((a) => <FleetCard key={a.id} agent={a} featured />)}
        </Group>
      )}
      {grouped.extensible.length > 0 && (
        <Group title="Extensible slots" subtitle="One-click launch targets" agentId="claude">
          {grouped.extensible.map((a) => <FleetCard key={a.id} agent={a} />)}
        </Group>
      )}

      <HelpPanel />
    </div>
  )
}

function Hero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="relative overflow-hidden rounded-2xl glass-strong p-6 sm:p-8"
    >
      <div className="absolute -left-16 -top-24 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(167,139,250,0.28), transparent)", filter: "blur(22px)" }} />
      <div className="relative">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.4em] text-white/40">
          <span className="inline-block w-6 h-px bg-white/30" />
          Extensible
        </div>
        <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight"><span className="neon-text">Agent Fleet</span></h1>
        <p className="mt-3 max-w-2xl text-sm text-white/55">
          Every agent the dashboard knows about. Primary and native agents have dedicated sections; the rest are one-click launch targets you can extend via <span className="font-mono text-white/70">~/.agentdash/agents.json</span>.
        </p>
      </div>
    </motion.div>
  )
}

function FilterPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition focus-ring ${active ? "text-white bg-white/10 border border-white/20" : "text-white/55 hover:text-white/90 border border-white/5"}`}
    >
      {label}
    </button>
  )
}

function Group({ title, subtitle, agentId, children }: { title: string; subtitle: string; agentId: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3 px-1">
        <Avatar agent={agentId} size={22} />
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">{subtitle}</div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  )
}

function FleetCard({ agent, featured }: { agent: AgentEntry; featured?: boolean }) {
  const palette = AGENT_PALETTE[agent.id]
  return (
    <Link
      href={`/agent/${agent.id}`}
      className={`group rounded-2xl glass-strong hover-lift p-4 block focus-ring relative overflow-hidden ${featured ? "" : ""}`}
      style={featured ? { borderColor: `${agent.color}33` } : undefined}
    >
      <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-50" style={{ background: `radial-gradient(closest-side, ${agent.color}33, transparent)` }} />
      <div className="relative flex items-center gap-3">
        <Avatar agent={agent.id} size={featured ? 44 : 36} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{agent.label}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 capitalize">{agent.kind}{agent.category ? ` · ${agent.category}` : ""}</div>
        </div>
        <span className="text-white/30 group-hover:text-white/80 group-hover:translate-x-0.5 transition">→</span>
      </div>
      <p className="mt-3 text-xs text-white/55 leading-relaxed">{agent.description}</p>
      {agent.launchCommand && (
        <div className="mt-3 font-mono text-[10px] text-white/35 truncate">$ {agent.launchCommand.join(" ")}</div>
      )}
    </Link>
  )
}

function HelpPanel() {
  return (
    <div className="rounded-2xl glass-strong p-5">
      <div className="flex items-center gap-3 mb-3">
        <Avatar agent="system" size={28} />
        <div>
          <div className="text-sm font-semibold">Extending the fleet</div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">agents.json</div>
        </div>
      </div>
      <p className="text-xs text-white/55">
        Create <span className="font-mono text-white/70">~/.agentdash/agents.json</span> with an array of agent entries. Each entry overrides a built-in by <span className="font-mono">id</span> or adds a new one. Supported fields: <span className="font-mono">id, label, kind, color, description, category, launchCommand, url, cwd, probeCommand</span>.
      </p>
      <pre className="mt-3 term-area text-[11px] text-white/60 overflow-auto">{`[
  {
    "id": "codex",
    "label": "Codex ACP",
    "kind": "extensible",
    "color": "#34d399",
    "description": "Codex Agent Client Protocol runner.",
    "launchCommand": ["codex-acp"]
  }
]`}</pre>
    </div>
  )
}