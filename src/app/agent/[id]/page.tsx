"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { notFound, useParams } from "next/navigation"
import { motion } from "framer-motion"
import { Avatar, AGENT_PALETTE } from "@/components/Avatar"
import { Button, StatusPill, Empty, Spinner } from "@/components/ui"
import { ChatShell, ChatComposer } from "@/components/ChatShell"
import { MessageList, MessageBubble } from "@/components/MessageBubble"

type AgentEntry = {
  id: string
  label: string
  kind: "primary" | "native" | "extensible"
  color: string
  description: string
  category?: string
  launchCommand?: string[]
  url?: string
  cwd?: string
  probeCommand?: string[]
}

const KNOWN_IDS = ["claude", "kimi", "agy", "codex", "openclaw"]

export default function AgentPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState<Array<{ id: string; role: string; content: string; time: number }>>([])
  const [draft, setDraft] = useState("")
  const [probe, setProbe] = useState<{ online: boolean; reason?: string } | null>(null)
  const [probeBusy, setProbeBusy] = useState(false)

  useEffect(() => {
    fetch("/api/agents").then((r) => r.json()).then((d) => setAgents(d.items ?? [])).finally(() => setLoading(false))
  }, [])

  const agent = agents.find((a) => a.id === id)

  useEffect(() => {
    if (!agent) return
    setMessages([
      { id: "sys-1", role: "system", content: `Connected to ${agent.label} profile.`, time: Date.now() - 60000 },
      { id: "sys-2", role: "assistant", content: agent.description, time: Date.now() - 50000 },
    ])
  }, [agent])

  if (loading) return <Centered><Spinner /></Centered>
  if (!agent || !KNOWN_IDS.includes(agent.id)) return notFound()

  const palette = AGENT_PALETTE[agent.id]
  const presence = probe?.online ? "online" : probe ? "offline" : "online"

  async function sendDraft() {
    const text = draft.trim()
    if (!text) return
    const now = Date.now()
    setMessages((m) => [...m, { id: `u-${now}`, role: "user", content: text, time: now }])
    setDraft("")
    const ackId = `a-${now + 1}`
    setMessages((m) => [...m, { id: ackId, role: "assistant", content: "Queued. Mission Control doesn’t drive this agent over an HTTP bridge yet — use the launch command or extend the bridge.", time: now + 800 }])
  }

  async function runProbe() {
    if (!agent?.probeCommand) return
    setProbeBusy(true); setProbe({ online: false })
    try {
      // Best-effort probe: if the command's binary is on PATH, treat as available.
      const bin = agent.probeCommand[0]
      // We can't reliably shell out from the browser; just show the command.
      setProbe({ online: false, reason: `Run \`${agent.probeCommand.join(" ")}\` to verify.` })
    } finally { setProbeBusy(false) }
  }

  return (
    <div className="flex flex-col gap-3 h-full min-h-0 overflow-hidden">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="relative overflow-hidden rounded-2xl glass-strong p-6 sm:p-8">
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full" style={{ background: `radial-gradient(closest-side, ${palette?.c1 ?? agent.color}33, transparent)`, filter: "blur(24px)" }} />
        <div className="relative flex flex-wrap items-center gap-4">
          <Avatar agent={agent.id} size={64} online={probe?.online} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.4em] text-white/40">{agent.kind} · {agent.category ?? "general"}</div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight"><span className="neon-text">{agent.label}</span></h1>
            <p className="mt-2 max-w-2xl text-sm text-white/55">{agent.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill on={!!probe?.online} label={probe?.online ? "online" : "not probed"} color={palette?.c1 ?? "#22e3ff"} />
            {agent.probeCommand && (
              <Button variant="ghost" onClick={runProbe} disabled={probeBusy}>{probeBusy ? <Spinner /> : null} Probe</Button>
            )}
          </div>
        </div>
        {probe?.reason && <div className="relative mt-3 text-xs text-white/55">{probe.reason}</div>}
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] flex-1 min-h-[520px]">
        <ChatShell
          header={{
            agent: agent.id,
            title: `${agent.label} chat`,
            subtitle: "Local-only · extend the bridge to drive this agent",
            presence,
          }}
        >
          <MessageList
            className="absolute inset-0"
            footer={
              <ChatComposer
                value={draft}
                onChange={setDraft}
                onSend={sendDraft}
                placeholder={`Message ${agent.label}… (⌘/Ctrl+Enter)`}
                agent={agent.id}
              />
            }
          >
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                m={{
                  id: m.id,
                  role: m.role,
                  agent: m.role === "user" ? "user" : m.role === "system" ? "system" : agent.id,
                  author: m.role === "user" ? "you" : m.role === "system" ? "system" : agent.label,
                  content: m.content,
                  time: m.time,
                }}
              />
            ))}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <Avatar agent={agent.id} size={72} />
                <div className="mt-3 text-sm text-white/55">No messages yet.</div>
              </div>
            )}
          </MessageList>
        </ChatShell>

        <aside className="rounded-2xl glass-strong p-4 space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">Launch</div>
            {agent.launchCommand ? (
              <pre className="term-area text-[11px] text-white/65 overflow-auto">{`$ ${agent.launchCommand.join(" ")}${agent.cwd ? `\n  cwd: ${agent.cwd}` : ""}`}</pre>
            ) : (
              <div className="text-xs text-white/40">No launch command defined.</div>
            )}
            {agent.launchCommand && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => setMessages((m) => [...m, { id: `note-${Date.now()}`, role: "system", content: `Run \`${agent.launchCommand!.join(" ")}\` in a terminal to start ${agent.label}.`, time: Date.now() }])}>Show command</Button>
              </div>
            )}
          </div>
          {agent.url && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">External</div>
              <a className="text-sm text-neon-cyan hover:underline focus-ring" href={agent.url} target="_blank" rel="noreferrer">Open {agent.label} →</a>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-2">Configure</div>
            <div className="text-xs text-white/55">
              Edit <span className="font-mono text-white/70">~/.agentdash/agents.json</span> to add probe commands, working directory, or external URLs for this agent.
            </div>
            <Link href="/agents" className="mt-3 inline-block text-xs text-white/60 hover:text-white">← Back to fleet</Link>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center min-h-[60vh]">{children}</div>
}