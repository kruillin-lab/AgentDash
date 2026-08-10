/**
 * OpenCode server manager — ensures a single `opencode serve` process is running
 * on the configured port, and gives the dashboard a way to start/stop/inspect it.
 *
 * Policy (per advisor review):
 *  - Connect-first: if a server is already reachable at the configured base URL,
 *    we never spawn a second one. "Reachable" includes 401/403 (server alive,
 *    auth required) so we don't double-spawn onto a port that's already owned.
 *  - Explicit lifecycle: spawn is a dedicated action, not an implicit side effect
 *    of every API request.
 *  - Port ownership: if the desired port is busy but not opencode, fail loudly
 *    with a clear error rather than silently picking a random port.
 *  - Auth: opencode serve requires a password (returns 401 without one). When
 *    spawning, we require OPENCODE_SERVER_PASSWORD to be set and pass it to the
 *    child via env, never on the command line.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import { OpenCodeClient, resolveConfig, type OpenCodeConfig } from "./client"

const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "opencode"

type ManagedServer = {
  pid: number
  baseUrl: string
  port: number
  startedAt: number
  child: ChildProcess
}

let managed: ManagedServer | null = null

export type ServerStatus = {
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

export function getServerStatus(): ServerStatus {
  const config = resolveConfig()
  const port = parsePortFromUrl(config.baseUrl)
  return {
    running: managed !== null && !managed.child.killed,
    reachable: false,
    authRequired: false,
    pid: managed?.child.pid ?? null,
    baseUrl: config.baseUrl,
    port,
    startedAt: managed?.startedAt ?? null,
    managed: managed !== null,
    passwordConfigured: Boolean(config.password),
  }
}

export async function getStatusWithProbe(): Promise<ServerStatus> {
  const status = getServerStatus()
  const config = resolveConfig()
  const client = new OpenCodeClient(config)
  const health = await client.health()
  // 401/403 means reachable but auth required.
  const authRequired = health.status === 401 || health.status === 403
  return { ...status, reachable: health.ok, authRequired }
}

function parsePortFromUrl(url: string): number | null {
  try {
    return Number(new URL(url).port) || null
  } catch {
    return null
  }
}

function parsePortOrDefault(config: OpenCodeConfig): number {
  const port = parsePortFromUrl(config.baseUrl)
  if (!port) throw new Error(`OPENCODE_BASE_URL must include an explicit port: ${config.baseUrl}`)
  return port
}

/**
 * Start `opencode serve` on the configured port if nothing is already listening there.
 * Throws if the port is busy with a non-opencode process.
 */
export async function ensureServer(): Promise<ServerStatus> {
  const config = resolveConfig()
  const client = new OpenCodeClient(config)
  const health = await client.health()
  if (health.ok) {
    // Already reachable (possibly auth-required). Don't spawn.
    return await getStatusWithProbe()
  }

  if (managed && !managed.child.killed) {
    // We own a process but it isn't responding yet — give it a moment.
    await delay(800)
    const rechecked = await client.health()
    if (rechecked.ok) return await getStatusWithProbe()
  }

  return startServer(config)
}

export async function startServer(overrides?: Partial<OpenCodeConfig>): Promise<ServerStatus> {
  const config = resolveConfig(overrides)
  const port = parsePortOrDefault(config)

  if (managed && !managed.child.killed) {
    throw new Error(`A managed opencode server is already running on pid ${managed.child.pid}.`)
  }

  if (!config.password) {
    throw new Error(
      "OPENCODE_SERVER_PASSWORD is not set. opencode serve requires a password for basic auth — set it in your environment before starting the managed server.",
    )
  }

  const client = new OpenCodeClient(config)
  const existing = await client.health()
  if (existing.ok) {
    // Something is already serving on this port. Don't spawn — adopt it.
    return await getStatusWithProbe()
  }

  const args = ["serve", "--port", String(port), "--hostname", new URL(config.baseUrl).hostname]
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (config.password) env.OPENCODE_SERVER_PASSWORD = config.password

  const child = spawn(OPENCODE_BIN, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    windowsHide: true,
  })

  const startedAt = Date.now()
  managed = { pid: 0, baseUrl: config.baseUrl, port, startedAt, child }
  if (child.pid) managed.pid = child.pid

  child.stdout?.on("data", () => { /* dashboard polls health */ })
  child.stderr?.on("data", () => { /* swallow */ })
  child.on("exit", () => {
    if (managed?.child === child) managed = null
  })

  // Wait for the server to come up (max ~15s). opencode serve can take a few
  // seconds to bind on Windows.
  for (let i = 0; i < 30; i++) {
    await delay(500)
    const probe = await client.health()
    if (probe.ok) return await getStatusWithProbe()
    if (child.exitCode !== null && child.exitCode !== 0) {
      managed = null
      throw new Error(`opencode serve exited with code ${child.exitCode} before becoming healthy.`)
    }
  }
  try { child.kill() } catch {}
  managed = null
  throw new Error(`opencode serve did not become healthy at ${config.baseUrl} within 15s.`)
}

export async function stopServer(): Promise<ServerStatus> {
  if (!managed || managed.child.killed) {
    managed = null
    return getServerStatus()
  }
  try {
    managed.child.kill()
  } catch {}
  await delay(400)
  managed = null
  return getServerStatus()
}