/**
 * Extensible agent registry — the "generic slot" in Mission Control.
 *
 * Each entry describes an agent the dashboard can surface as a card. Built-in
 * agents (opencode, hermes) have full sections; any other entry here gets a
 * lightweight card with status probe + launch action + docs link.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

export type AgentEntry = {
  id: string
  label: string
  kind: "primary" | "native" | "extensible"
  color: string
  icon?: string
  description: string
  /** Optional: command to probe availability (exit 0 = available). */
  probeCommand?: string[]
  /** Optional: command to launch the agent's own UI. */
  launchCommand?: string[]
  /** Optional: URL the "Open" button links to. */
  url?: string
  /** Optional: directory to launch the command in. */
  cwd?: string
  /** Tag for grouping in the UI. */
  category?: string
}

const DEFAULT_REGISTRY: AgentEntry[] = [
  {
    id: "opencode",
    label: "OpenCode",
    kind: "primary",
    color: "#22e3ff",
    description: "Terminal-native AI coding agent. Controlled via the local HTTP server bridge.",
    category: "coding",
    url: "http://localhost:3007/opencode",
  },
  {
    id: "hermes",
    label: "Hermes",
    kind: "native",
    color: "#ff6b8b",
    description: "Terminal-native AI assistant with tool calling, messaging gateways, and session history.",
    category: "general",
    url: "http://localhost:3007/hermes",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    kind: "extensible",
    color: "#a78bfa",
    description: "Predecessor to Hermes. Not installed separately — use the Hermes claw migrate panel to import settings, memories, skills, and API keys.",
    category: "general",
  },
  {
    id: "claude",
    label: "Claude Code",
    kind: "extensible",
    color: "#facc15",
    description: "Anthropic's terminal coding agent. Add a path/probe to enable one-click launch.",
    category: "coding",
    launchCommand: ["claude"],
  },
  {
    id: "kimi",
    label: "Kimi",
    kind: "extensible",
    color: "#9dff5b",
    description: "Moonshot's Kimi CLI. Add a path/probe to enable one-click launch.",
    category: "coding",
    launchCommand: ["kimi"],
  },
  {
    id: "agy",
    label: "Antigravity",
    kind: "extensible",
    color: "#ffb454",
    description: "Antigravity CLI. Add a path/probe to enable one-click launch.",
    category: "coding",
    launchCommand: ["agy"],
  },
]

const CONFIG_DIR = process.env.AGENTDASH_CONFIG_DIR ?? path.join(os.homedir(), ".agentdash")
const CONFIG_FILE = path.join(CONFIG_DIR, "agents.json")

export async function loadRegistry(): Promise<AgentEntry[]> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8")
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return mergeWithDefaults(parsed)
    return DEFAULT_REGISTRY
  } catch {
    return DEFAULT_REGISTRY
  }
}

export async function saveRegistry(entries: AgentEntry[]): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true })
  await fs.writeFile(CONFIG_FILE, JSON.stringify(entries, null, 2), "utf8")
}

function mergeWithDefaults(user: Partial<AgentEntry>[]): AgentEntry[] {
  const byId = new Map<string, AgentEntry>()
  for (const e of DEFAULT_REGISTRY) byId.set(e.id, e)
  for (const u of user) {
    if (!u?.id) continue
    const existing = byId.get(u.id)
    byId.set(u.id, existing ? { ...existing, ...u } as AgentEntry : (u as AgentEntry))
  }
  return [...byId.values()]
}