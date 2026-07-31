import { config as loadEnv } from "dotenv"
import path from "node:path"
import { existsSync } from "node:fs"

/**
 * Load `.env` (and `.env.local`) with `override: true` so a project-local
 * password wins over a stale shell/system OPENCODE_SERVER_PASSWORD export.
 *
 * Idempotent — calling more than once is safe (dotenv's `config` just
 * re-applies the same values).
 */
export function loadEnvOverride() {
  const cwd = process.cwd()
  for (const name of [".env.local", ".env"]) {
    const p = path.join(cwd, name)
    if (existsSync(p)) loadEnv({ path: p, override: true, quiet: true })
  }
}

loadEnvOverride()