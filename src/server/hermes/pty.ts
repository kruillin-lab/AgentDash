/**
 * Hermes pty sidecar — the only way to do interactive Hermes chat from the
 * dashboard, since Hermes has no HTTP API. Reuses node-pty for a real PTY.
 *
 * This is intentionally a minimal, dedicated sidecar (per advisor review), not
 * a port of the full legacy launcher. It supports exactly one agent: hermes.
 */

import type { ChildProcess } from "node:child_process"

// node-pty is an optional native dep. We lazy-require it so the Next.js build
// doesn't hard-fail if the binary isn't present on a fresh checkout; the pty
// chat section gracefully reports "unavailable" in that case.
type Pty = {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: (signal?: string) => void
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void
  pid: number
}

let ptyLoader: ((file: string, args: string[], opts: any) => Pty) | null | undefined

async function loadPty(): Promise<typeof ptyLoader> {
  if (ptyLoader !== undefined) return ptyLoader
  try {
    const mod = await import("node-pty")
    ptyLoader = (mod.spawn ?? mod.default?.spawn) as any
    if (!ptyLoader) throw new Error("node-pty.spawn not found")
    return ptyLoader
  } catch (err) {
    ptyLoader = null
    return null
  }
}

const HERMES_BIN = process.env.HERMES_BIN ?? "hermes"

type LiveSession = {
  id: number
  pty: Pty
  ring: string[]
  cwd: string
  startedAt: number
  child?: ChildProcess
}

const RING_SIZE = 800
const live = new Map<number, LiveSession>()
let nextId = 1

export type PtyAvailability = { available: boolean; reason?: string }

export async function ptyAvailability(): Promise<PtyAvailability> {
  const loader = await loadPty()
  if (!loader) return { available: false, reason: "node-pty not installed on the server." }
  return { available: true }
}

export async function spawnHermes(opts: { cwd?: string; resumeSession?: string }): Promise<
  | { ok: true; session: { id: number; pid: number; cwd: string; startedAt: number } }
  | { ok: false; error: { code: string; message: string } }
> {
  const loader = await loadPty()
  if (!loader) return { ok: false, error: { code: "PTY_UNAVAILABLE", message: "node-pty not installed on the server." } }

  const cwd = opts.cwd && opts.cwd.trim().length > 0 ? opts.cwd : process.cwd()
  const args = ["chat", "--cli"]
  if (opts.resumeSession) {
    args.push("--resume", opts.resumeSession)
  }

  try {
    const pty = loader(HERMES_BIN, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 35,
      cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", FORCE_COLOR: "1" } as any,
    } as any)

    const id = nextId++
    const session: LiveSession = { id, pty, ring: [], cwd, startedAt: Date.now() }
    live.set(id, session)

    pty.onData((data) => {
      const clean = stripAnsi(data)
      for (const chunk of clean.split(/\r?\n/)) {
        if (!chunk) continue
        session.ring.push(chunk)
        if (session.ring.length > RING_SIZE) session.ring.shift()
      }
      // Buffer raw too, for terminal rendering. We store raw in a parallel ring.
      rawRingPush(id, data)
    })
    pty.onExit(() => {
      live.delete(id)
      rawRings.delete(id)
    })

    return { ok: true, session: { id, pid: pty.pid, cwd, startedAt: session.startedAt } }
  } catch (err: any) {
    return { ok: false, error: { code: "PTY_SPAWN_FAILED", message: err?.message ?? "spawn failed" } }
  }
}

// Parallel raw ring (with ANSI) for xterm rendering.
const rawRings = new Map<number, string[]>()
const RAW_RING_SIZE = 400
function rawRingPush(id: number, data: string) {
  const arr = rawRings.get(id) ?? []
  arr.push(data)
  if (arr.length > RAW_RING_SIZE) arr.shift()
  rawRings.set(id, arr)
}

export function listLive(): { id: number; pid: number; cwd: string; startedAt: number; lastLines: string[] }[] {
  return [...live.values()].map((s) => ({
    id: s.id,
    pid: s.pty.pid,
    cwd: s.cwd,
    startedAt: s.startedAt,
    lastLines: s.ring.slice(-6),
  }))
}

export function getOutput(id: number, mode: "clean" | "raw" = "clean"): { lines: string[]; raw: string } | null {
  const session = live.get(id)
  if (!session) return null
  if (mode === "raw") {
    const raw = (rawRings.get(id) ?? []).join("")
    return { lines: session.ring.slice(-400), raw }
  }
  return { lines: session.ring.slice(-400), raw: "" }
}

export function writeInput(id: number, data: string): { ok: boolean; error?: string } {
  const session = live.get(id)
  if (!session) return { ok: false, error: "SESSION_NOT_LIVE" }
  try {
    session.pty.write(data)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "write failed" }
  }
}

export function interrupt(id: number): { ok: boolean; error?: string } {
  const session = live.get(id)
  if (!session) return { ok: false, error: "SESSION_NOT_LIVE" }
  try {
    session.pty.write("\x03")
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "interrupt failed" }
  }
}

export function kill(id: number): boolean {
  const session = live.get(id)
  if (!session) return false
  try {
    session.pty.kill()
  } catch {}
  live.delete(id)
  rawRings.delete(id)
  return true
}

export function resize(id: number, cols: number, rows: number): { ok: boolean } {
  const session = live.get(id)
  if (!session) return { ok: false }
  try {
    session.pty.resize(Math.max(20, cols), Math.max(6, rows))
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export function shutdownAll() {
  for (const session of live.values()) {
    try { session.pty.kill() } catch {}
  }
  live.clear()
  rawRings.clear()
}

// Minimal ANSI stripper (good enough for previews; raw ring preserves colors for xterm).
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[=>]|\u0008/g
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "")
}