"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { useEffect, useState } from "react"
import { Avatar, AGENT_PALETTE } from "./Avatar"

type AgentNav = {
  id: string
  href: string
  label: string
  description?: string
  presence?: boolean
}

const NAV_MISSION_CONTROL: AgentNav = { id: "mission-control", href: "/", label: "Mission Control", description: "CEO work board" }
const NAV_OVERVIEW: AgentNav = { id: "overview", href: "/overview", label: "Overview", description: "System dashboard" }
const NAV_AGENTS: AgentNav = { id: "agents", href: "/agents", label: "Agent Fleet", description: "All agents" }

const PRIMARY_AGENTS: AgentNav[] = [
  { id: "opencode", href: "/opencode", label: "OpenCode", description: "Coding · HTTP bridge" },
  { id: "hermes", href: "/hermes", label: "Hermes", description: "General · CLI + PTY" },
]

const SECONDARY_AGENTS: AgentNav[] = [
  { id: "claude", href: "/agent/claude", label: "Claude", description: "Anthropic coding CLI" },
  { id: "kimi", href: "/agent/kimi", label: "Kimi", description: "Moonshot coding CLI" },
  { id: "agy", href: "/agent/agy", label: "Antigravity", description: "Antigravity CLI" },
  { id: "codex", href: "/agent/codex", label: "Codex", description: "Codex ACP runner" },
  { id: "openclaw", href: "/agent/openclaw", label: "OpenClaw", description: "Hermes migration source" },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [clock, setClock] = useState("")
  const [health, setHealth] = useState<{ opencode?: boolean; hermesPty?: boolean }>({})

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function probe() {
      try {
        const res = await fetch("/api/health")
        const data = await res.json()
        if (!cancelled) setHealth({ opencode: data?.opencode?.reachable, hermesPty: data?.hermesPty?.available })
      } catch {
        if (!cancelled) setHealth({})
      }
    }
    probe()
    const id = setInterval(probe, 8000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
    <div className="flex min-h-screen">
      <Sidebar pathname={pathname} health={health} />
      <main className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <TopBar clock={clock} health={health} pathname={pathname} />
        <div className="flex-1 min-w-0 overflow-y-auto px-4 pb-6 pt-4 sm:px-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}

function Sidebar({ pathname, health }: { pathname: string; health: { opencode?: boolean; hermesPty?: boolean } }) {
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href))
  return (
    <aside className="hidden md:flex w-72 shrink-0 flex-col gap-1 p-3 sticky top-0 h-screen">
      <Link href="/" className="flex items-center gap-3 px-2 pt-2 pb-4 focus-ring rounded-xl">
        <Logo />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-wide neon-text">MISSION CONTROL</div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">OpenCode OS · v2</div>
        </div>
      </Link>

      <SectionTitle>Workspace</SectionTitle>
      <NavItem agent={NAV_MISSION_CONTROL} active={isActive(NAV_MISSION_CONTROL.href)} />
      <NavItem agent={NAV_OVERVIEW} active={isActive(NAV_OVERVIEW.href)} />
      <NavItem agent={NAV_AGENTS} active={isActive(NAV_AGENTS.href)} />

      <SectionTitle className="mt-4">Primary agents</SectionTitle>
      <div className="flex flex-col gap-1">
        {PRIMARY_AGENTS.map((a) => (
          <NavItem key={a.id} agent={{ ...a, presence: presenceFor(a.id, health) }} active={isActive(a.href)} />
        ))}
      </div>

      <SectionTitle className="mt-4">More agents</SectionTitle>
      <div className="flex flex-col gap-1">
        {SECONDARY_AGENTS.map((a) => (
          <NavItem key={a.id} agent={a} active={isActive(a.href)} />
        ))}
      </div>

      <div className="mt-auto pt-4 px-2 space-y-1.5 text-[10px] text-white/40">
        <SideStat label="OpenCode" on={health.opencode} agent="opencode" />
        <SideStat label="Hermes pty" on={health.hermesPty} agent="hermes" />
      </div>
    </aside>
  )
}

function NavItem({ agent, active }: { agent: AgentNav; active: boolean }) {
  const palette = AGENT_PALETTE[agent.id]
  return (
    <Link
      href={agent.href}
      className={`group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-all focus-ring ${
        active ? "text-white" : "text-white/65 hover:text-white"
      }`}
      style={{
        background: active ? "rgba(120,160,255,0.08)" : "transparent",
        border: active ? "1px solid rgba(120,160,255,0.28)" : "1px solid transparent",
      }}
    >
      <Avatar agent={agent.id} size={32} online={agent.presence} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-tight truncate">{agent.label}</div>
        {agent.description && <div className="text-[10px] text-white/40 truncate leading-tight mt-0.5">{agent.description}</div>}
      </div>
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute -right-1 top-1/2 -translate-y-1/2 h-7 w-1 rounded-full"
          style={{ background: palette ? `linear-gradient(180deg, ${palette.c1}, ${palette.c2})` : "#22e3ff" }}
        />
      )}
    </Link>
  )
}

function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-3 pt-3 pb-1.5 text-[10px] uppercase tracking-[0.22em] text-white/35 ${className}`}>
      {children}
    </div>
  )
}

function SideStat({ label, on, agent }: { label: string; on?: boolean; agent: string }) {
  const palette = AGENT_PALETTE[agent]
  return (
    <div className="flex items-center gap-2">
      <Avatar agent={agent} size={22} online={on} />
      <span className="text-white/55">{label}</span>
      <span className="ml-auto" style={{ color: on ? palette?.c1 ?? "#9dff5b" : "#5b6480" }}>{on ? "online" : "offline"}</span>
    </div>
  )
}

function presenceFor(id: string, health: { opencode?: boolean; hermesPty?: boolean }): boolean | undefined {
  if (id === "opencode") return health.opencode
  if (id === "hermes") return health.hermesPty
  return undefined
}

function TopBar({ clock, health, pathname }: { clock: string; health: { opencode?: boolean; hermesPty?: boolean }; pathname: string }) {
  const title = pageTitle(pathname)
  return (
    <header className="sticky top-0 z-20 backdrop-blur-md bg-void-950/40 border-b border-white/5">
      <div className="flex items-center gap-4 px-4 sm:px-6 h-14">
        <div className="md:hidden flex items-center gap-2">
          <Logo small />
          <span className="neon-text text-sm font-semibold">MC</span>
        </div>
        <div className="hidden md:block min-w-0">
          <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">{title.eyebrow}</div>
          <div className="text-base font-semibold text-white/90 -mt-0.5 truncate">{title.title}</div>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <Badge on={health.opencode} label="OC" agent="opencode" />
          <Badge on={health.hermesPty} label="PTY" agent="hermes" />
          <div className="font-mono text-white/60 tabular-nums hidden sm:block">{clock}</div>
        </div>
      </div>
    </header>
  )
}

function Badge({ on, label, agent }: { on?: boolean; label: string; agent: string }) {
  const palette = AGENT_PALETTE[agent]
  const c = palette?.c1 ?? "#22e3ff"
  return (
    <div
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wider"
      style={{
        background: on ? `${c}1a` : "rgba(75,85,117,0.2)",
        color: on ? c : "#8892b0",
        border: `1px solid ${on ? c + "55" : "rgba(120,140,180,0.2)"}`,
      }}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: on ? c : "#4b5575" }} />
      {label}
    </div>
  )
}

function Logo({ small }: { small?: boolean }) {
  const size = small ? 24 : 30
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="48" y2="48">
          <stop stopColor="#22e3ff" />
          <stop offset="0.5" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#ff44d8" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="20" stroke="url(#lg)" strokeWidth="2" opacity="0.6" />
      <circle cx="24" cy="24" r="12" stroke="url(#lg)" strokeWidth="2" opacity="0.9" />
      <circle cx="24" cy="24" r="4" fill="url(#lg)" />
      <path d="M24 4 L24 10 M24 38 L24 44 M4 24 L10 24 M38 24 L44 24" stroke="url(#lg)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function pageTitle(pathname: string): { eyebrow: string; title: string } {
  if (pathname === "/") return { eyebrow: "Mission", title: "CEO Mission Control" }
  if (pathname === "/overview") return { eyebrow: "Mission", title: "Overview" }
  if (pathname.startsWith("/opencode")) return { eyebrow: "Primary agent", title: "OpenCode" }
  if (pathname.startsWith("/hermes")) return { eyebrow: "Native agent", title: "Hermes" }
  if (pathname.startsWith("/agents")) return { eyebrow: "Extensible", title: "Agent Fleet" }
  const agentMatch = pathname.match(/^\/agent\/([^/]+)/)
  if (agentMatch) {
    const id = agentMatch[1]
    const p = AGENT_PALETTE[id]
    return { eyebrow: "Agent", title: p ? id.charAt(0).toUpperCase() + id.slice(1) : id }
  }
  return { eyebrow: "", title: "Mission Control" }
}
