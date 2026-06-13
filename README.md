# AgentDash

AgentDash is a local AgentOS dashboard for project health, GoalBuddy goals, scheduled-routine status,
recall, inbox triage, and interactive agent sessions.

## Supported runtimes

- **Electron:** `npm run app` starts AgentDash in the current user session. Packaged builds expose a
  **Start at login** tray toggle so startup remains an explicit per-user choice.
- **Hosted web:** `npm start` runs the same dashboard in the current user context. Set `PORT=3000`
  for the long-running hosted mode.

Agent launching intentionally refuses to run as Windows `LocalSystem`. Claude, Hermes, OpenCode,
Kimi, and Antigravity are installed and authenticated per user; a machine service cannot safely or
reliably impersonate that profile without storing Windows credentials. The retired `node-windows`
installer was therefore removed instead of shipping a service that served pages but failed at its
core job.

## Network security

The default bind is `127.0.0.1`. A non-loopback `HOST` requires both `AGENTDASH_USER` and
`AGENTDASH_PASS`. Remote session working directories must be contained by `AGENTDASH_CWD_ROOTS`;
the default root is the current user's `Documents\Projects` directory.

## Verification

```powershell
npm test
npm run check
npm run build -- --publish=never
```
