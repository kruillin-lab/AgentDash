/**
 * Hermes bridge — shells out to the `hermes` CLI for status, sessions, dashboard
 * control, and OpenClaw migration. Hermes has no clean HTTP API, so for
 * interactive chat we use a separate pty sidecar (see hermes-pty.ts).
 *
 * The CLI output is human-formatted text; we parse defensively and never claim
 * structured data when the CLI changes shape.
 */

import { spawn } from "node:child_process"

const HERMES_BIN = process.env.HERMES_BIN ?? "hermes"

export type HermesResult<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; error: { code: string; message: string }; raw: string }

function runCli(args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(HERMES_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch {}
      resolve({ stdout, stderr: stderr + "\n[timeout]", code: null })
    }, opts.timeoutMs ?? 30000)

    child.stdout?.on("data", (d) => { stdout += d.toString() })
    child.stderr?.on("data", (d) => { stderr += d.toString() })
    child.on("exit", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ stdout, stderr, code })
    })
    child.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ stdout, stderr: stderr + "\n" + err.message, code: null })
    })
  })
}

// --- status ---

export type HermesStatus = {
  reachable: boolean
  model: string | null
  provider: string | null
  pythonVersion: string | null
  envFileExists: boolean | null
  apiKeys: { name: string; configured: boolean }[]
  authProviders: { name: string; loggedIn: boolean; detail?: string }[]
  raw: string
}

const KEY_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "OpenRouter", re: /OpenRouter\s+(✓|✗)/ },
  { name: "OpenAI", re: /OpenAI\s+(✓|✗)/ },
  { name: "Google / Gemini", re: /Google\s*\/\s*Gemini\s+(✓|✗)/ },
  { name: "DeepSeek", re: /DeepSeek\s+(✓|✗)/ },
  { name: "xAI / Grok", re: /xAI\s*\/\s*Grok\s+(✓|✗)/ },
  { name: "Anthropic", re: /Anthropic\s+(✓|✗)/ },
  { name: "Kimi", re: /\bKimi\s+(✓|✗)/ },
]

export async function getStatus(): Promise<HermesStatus> {
  const res = await runCli(["status"], { timeoutMs: 30000 })
  if (res.code !== 0 && !res.stdout) {
    return {
      reachable: false,
      model: null,
      provider: null,
      pythonVersion: null,
      envFileExists: null,
      apiKeys: [],
      authProviders: [],
      raw: res.stderr || "[hermes status failed]",
    }
  }
  const out = res.stdout
  const model = match1(out, /Model:\s*(.+)/)
  const provider = match1(out, /Provider:\s*(.+)/)
  const pythonVersion = match1(out, /Python:\s*(.+)/)
  const envLine = match1(out, /\.env file:\s*(.+)/)
  const envFileExists = envLine ? /✓|exists/i.test(envLine) : null

  const apiKeys = KEY_PATTERNS.map(({ name, re }) => {
    const m = out.match(re)
    return { name, configured: m ? m[1] === "✓" : false }
  })

  const authProviders: HermesStatus["authProviders"] = []
  const authBlock = out.split(/Auth Providers/i)[1] ?? ""
  for (const line of authBlock.split(/\r?\n/)) {
    const m = line.match(/^\s*(Nous Portal|.+?)\s+(✓|✗)\s*(.*)$/)
    if (m) authProviders.push({ name: m[1].trim(), loggedIn: m[2] === "✓", detail: m[3].trim() || undefined })
  }

  return {
    reachable: true,
    model,
    provider,
    pythonVersion,
    envFileExists,
    apiKeys,
    authProviders,
    raw: out,
  }
}

function match1(s: string, re: RegExp): string | null {
  const m = s.match(re)
  return m ? m[1].trim() : null
}

// --- sessions ---

export type HermesSession = {
  id: string
  preview: string
  lastActive: string
  source: string
}

export async function listSessions(limit = 25): Promise<HermesResult<HermesSession[]>> {
  const res = await runCli(["sessions", "list", "--limit", String(limit)], { timeoutMs: 20000 })
  if (res.code !== 0) {
    return {
      ok: false,
      error: { code: "HERMES_SESSIONS_FAILED", message: (res.stderr || res.stdout || "failed").trim() },
      raw: res.stdout + res.stderr,
    }
  }
  const lines = res.stdout.split(/\r?\n/).filter(Boolean)
  // First non-empty line is the header, second is the rule line.
  const headerIdx = lines.findIndex((l) => /Preview\s+Last Active\s+Src\s+ID/i.test(l))
  const body = headerIdx >= 0 ? lines.slice(headerIdx + 1).filter((l) => !/^─+$/.test(l.trim())) : []
  const sessions: HermesSession[] = []
  for (const line of body) {
    // Columns are fixed-ish but can wrap; parse from the right: ID, Src, Last Active, preview.
    const idMatch = line.match(/(\d{8}_\d{6}_[0-9a-f]{6})\s*$/)
    if (!idMatch) continue
    const id = idMatch[1]
    const withoutId = line.slice(0, line.length - id.length).trimEnd()
    // src is the last token before id; last active is the token before src.
    const tokens = withoutId.split(/\s+/)
    const source = tokens.length >= 1 ? tokens[tokens.length - 1] : ""
    const lastActive = tokens.length >= 2 ? tokens[tokens.length - 2] : ""
    const preview = tokens.slice(0, -2).join(" ").trim()
    sessions.push({ id, preview, lastActive, source })
  }
  return { ok: true, data: sessions, raw: res.stdout }
}

export type HermesSessionStats = {
  totalSessions: number | null
  totalMessages: number | null
  bySource: { source: string; sessions: number }[]
  databaseSize: string | null
  raw: string
}

export async function getSessionStats(): Promise<HermesSessionStats> {
  const res = await runCli(["sessions", "stats"], { timeoutMs: 20000 })
  const out = res.stdout
  const totalSessions = num1(out, /Total sessions:\s*(\d+)/)
  const totalMessages = num1(out, /Total messages:\s*(\d+)/)
  const databaseSize = match1(out, /Database size:\s*(.+)/)
  const bySource: { source: string; sessions: number }[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*(\w[\w\s]*?):\s*(\d+)\s+sessions/i)
    if (m) bySource.push({ source: m[1].trim(), sessions: Number(m[2]) })
  }
  return { totalSessions, totalMessages, bySource, databaseSize, raw: out }
}

function num1(s: string, re: RegExp): number | null {
  const m = s.match(re)
  return m ? Number(m[1]) : null
}

// --- dashboard launcher ---

export type DashboardStatus = {
  running: boolean
  raw: string
}

export async function dashboardStatus(): Promise<DashboardStatus> {
  const res = await runCli(["dashboard", "--status"], { timeoutMs: 15000 })
  return { running: /running|pid/i.test(res.stdout) && !/no\s+running/i.test(res.stdout), raw: res.stdout }
}

export async function dashboardStop(): Promise<DashboardStatus> {
  const res = await runCli(["dashboard", "--stop"], { timeoutMs: 15000 })
  return { running: false, raw: res.stdout }
}

export type DashboardLaunchResult = {
  launched: boolean
  port: number
  message: string
}

/**
 * Launch the Hermes dashboard in the background. We use --no-open so it doesn't
 * steal focus, and --skip-build so non-interactive shells don't try to run npm.
 */
export async function dashboardLaunch(port = 9119): Promise<DashboardLaunchResult> {
  // hermes dashboard doesn't daemonize on its own; spawn detached and return.
  const child = spawn(
    HERMES_BIN,
    ["dashboard", "--port", String(port), "--no-open", "--skip-build"],
    { detached: true, stdio: "ignore", windowsHide: true, shell: process.platform === "win32" },
  )
  child.unref()
  return {
    launched: child.pid != null,
    port,
    message: child.pid != null ? `Hermes dashboard launched on port ${port} (pid ${child.pid}).` : "Failed to launch Hermes dashboard.",
  }
}

// --- OpenClaw migration ---

export type ClawMigrateResult = {
  ok: boolean
  raw: string
  message: string
}

export async function clawMigratePreview(): Promise<ClawMigrateResult> {
  // We run a dry probe: `hermes claw migrate --help` to surface what it does.
  const res = await runCli(["claw", "migrate", "--help"], { timeoutMs: 15000 })
  return { ok: res.code === 0, raw: res.stdout, message: res.stdout.split(/\r?\n/).slice(0, 1)[0] || "preview" }
}

export async function clawMigrateRun(): Promise<ClawMigrateResult> {
  const res = await runCli(["claw", "migrate"], { timeoutMs: 120000 })
  return {
    ok: res.code === 0,
    raw: res.stdout + res.stderr,
    message: res.code === 0 ? "OpenClaw settings, memories, skills, and API keys migrated to Hermes." : (res.stderr || "migration failed"),
  }
}

export async function clawCleanup(): Promise<ClawMigrateResult> {
  const res = await runCli(["claw", "cleanup"], { timeoutMs: 60000 })
  return {
    ok: res.code === 0,
    raw: res.stdout + res.stderr,
    message: res.code === 0 ? "Leftover OpenClaw directories archived." : (res.stderr || "cleanup failed"),
  }
}