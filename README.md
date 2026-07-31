---
tags:
  - type/documentation
  - project/agentdash
  - status/active
  - domain/os
  - domain/ai-agents
type: documentation
project: agentdash
status: active
aliases: []
---

# Mission Control — OpenCode OS

A local, dopamine-grade mission control dashboard for **OpenCode** and your other AI agents (Hermes, OpenClaw migration, and an extensible fleet). Runs entirely on `127.0.0.1`.

> This is the v2 Next.js rewrite of AgentDash. The legacy Node/Express/Electron pty launcher is preserved under `legacy/` for reference.

## Stack

- **Next.js 14** (App Router, Node.js runtime for API routes)
- **Tailwind CSS 3** with a custom neon-mission-control theme
- **Framer Motion** for aurora background, page transitions, and micro-interactions
- **node-pty** (optional, for the Hermes interactive PTY chat sidecar)
- **TypeScript** (strict)

## What it does

### OpenCode section (`/opencode`) — primary
- Connects to a running `opencode serve` instance over the v2 HTTP API (`/api/session`, `/api/session/:id/prompt`, `/api/session/:id/message`, `/api/model`, `/api/provider`).
- **Server manager**: if no server is reachable at `OPENCODE_BASE_URL` (default `http://127.0.0.1:4096`), the dashboard can spawn one for you via `opencode serve --port 4096`. Connect-first policy — never spawns a second server if one is already listening.
- **Live event stream**: proxies OpenCode's `/event` SSE server-side so the browser never sees the OpenCode password.
- Session list, message viewer, prompt composer (⌘/Ctrl+Enter to send), models & providers catalog.

### Hermes section (`/hermes`) — native
- Shells out to the `hermes` CLI for `status`, `sessions list`, `sessions stats`.
- **Dashboard launcher**: starts/stops `hermes dashboard --port 9119`.
- **OpenClaw migration**: `hermes claw migrate` and `hermes claw cleanup` (OpenClaw isn't installed separately; Hermes ships the migration tool).
- **PTY chat sidecar**: a real `node-pty` terminal running `hermes chat --cli`, with input, interrupt, resize, and kill. The only way to do interactive Hermes chat from a browser since Hermes has no HTTP API.

### Agent Fleet (`/agents`) — extensible
- Renders every agent the dashboard knows about, grouped by kind (primary / native / extensible).
- Extend by creating `~/.agentdash/agents.json` with an array of agent entries. Overrides built-ins by `id` or adds new ones.

## Run

```powershell
npm install
npm run dev    # http://localhost:3007
```

For production:

```powershell
npm run build
npm start      # http://localhost:3007
```

## Configuration (env)

| Variable | Default | Purpose |
|---|---|---|
| `OPENCODE_BASE_URL` | `http://127.0.0.1:4096` | OpenCode HTTP server base URL |
| `OPENCODE_SERVER_PASSWORD` | (none) | Basic-auth password for `opencode serve` |
| `OPENCODE_BIN` | `opencode` | Path to the opencode binary |
| `OPENCODE_DIRECTORY` | (none) | Optional `directory` query param for v2 routes |
| `OPENCODE_WORKSPACE` | (none) | Optional `workspace` query param for v2 routes |
| `HERMES_BIN` | `hermes` | Path to the hermes binary |
| `AGENTDASH_CONFIG_DIR` | `~/.agentdash` | Where `agents.json` is read/written |

## Architecture

```
Browser (Framer Motion UI)
   │  fetch /api/...
   ▼
Next.js Route Handlers (Node runtime, server-side)
   │
   ├── /api/opencode/*  ──►  OpenCodeClient ──►  opencode serve (HTTP v2 API + SSE /event)
   │                        └── ServerManager (spawn/stop/ensure opencode serve)
   ├── /api/hermes/*    ──►  hermes CLI (spawn: status, sessions, dashboard, claw)
   │                        └── HermesPty (node-pty: hermes chat --cli)
   ├── /api/agents      ──►  Agent registry (~/.agentdash/agents.json + defaults)
   └── /api/health      ──►  probes OpenCode + Hermes pty availability
```

The browser never talks to `opencode serve` or the `hermes` CLI directly. All credentials stay server-side.

## Quality gate

`quality-gate.json` runs `npm run lint`, `npm run typecheck`, and `npm run build` at the `normal` level. App-critical files are `src/**/*.{ts,tsx,css}` and the build configs; gate-critical files are `quality-gate.json`, `package.json`, `package-lock.json`, `.eslintrc.json`, `.gitignore`.

## Safety boundaries

- Bind to `127.0.0.1` only. Do not expose this dashboard on a network.
- The OpenCode password is passed to the managed `opencode serve` child via the `OPENCODE_SERVER_PASSWORD` env var, never on the command line.
- The legacy Electron/Express app under `legacy/` is preserved but not wired into the Next.js build.