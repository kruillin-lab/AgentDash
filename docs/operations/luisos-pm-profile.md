---
tags:
  - type/runbook
  - project/agentdash
  - status/active
  - workflow/mission-control
type: runbook
project: agentdash
status: active
aliases:
  - LuisOS PM Isolation Runbook
---

# LuisOS PM isolation profile

## Current decision

The Hermes project-manager surface is **NO-GO** for production. AgentDash keeps
the production chat adapter unavailable until a current PM-specific level-5
proof establishes all of the following for the exact executable and
`luisos-pm` profile home:

- zero available terminal, file, browser, computer-use, code-execution,
  research/web, delegation, and mutation-capable memory tools;
- no user rules, plugins, MCP servers, skills, or workspace instructions;
- no CodeG, controller-command, workspace, browser, tool, or delegation
  credentials in the child environment;
- a real session reference from the bounded Hermes usage report;
- refusal of side-effect requests with zero disposable-target changes; and
- strict management-proposal output only.

The production route fails closed. A `create_task` proposal cannot report
success unless a future intake controller is explicitly injected; this task
does not create cards or dispatch work.

## Read-only local evidence

The installed profile is read-only at
`C:\Users\kruil\AppData\Local\hermes\profiles\luisos-pm`. Do not edit, select,
clone, or reconfigure it from AgentDash. Do not inspect or expose its `.env`.

As observed on 2026-08-04:

- the profile reports `kimi-k2.6:cloud` and its gateway is stopped;
- Hermes one-shot mode normally loads configured tools, memory, rules, user
  configuration, plugins, MCP servers, and workspace context, and bypasses
  approvals;
- an empty `--toolsets` value does not prove zero tools;
- `--safe-mode` may bypass profile configuration and is not isolation proof;
- the offline inventory with the proposed safe flags still exposed **33 tool
  schemas**, including terminal, file, browser, computer-use, delegation,
  code-execution, memory, and web toolsets.

That inventory is decisive NO-GO evidence. The live side-effect phase must not
run while it remains nonzero.

## Candidate inference configuration

The desired PM-specific candidates are:

1. preferred: `gpt-5.6-terra`;
2. fallback: `claude-sonnet-5`.

Both remain inactive pending independent PM-specific level-5 proof. Their names
in source and documentation are evaluation candidates, not permission to
activate, select, or dispatch them.

## Invocation boundary

Every non-PTY Hermes process is started directly from an absolute executable
that is also present in the explicit executable allowlist. AgentDash never
falls back to `hermes` on `PATH`, never runs `.cmd` or `.bat`, never starts a
shell, and never composes a command string. CEO punctuation remains a literal
argument in the validated argument array.

Legacy non-PTY status/dashboard operations require `HERMES_BIN` to contain the
absolute executable and `HERMES_EXECUTABLE_ALLOWLIST` to contain that same path
(Windows entries are semicolon-separated). Missing or mismatched configuration
fails closed; it never triggers PATH discovery.

The child environment is reconstructed from the minimum operating-system
values plus the explicit `HERMES_HOME` and optional inference identifiers. It
does not spread `process.env`. Output, time, abort, and disposable working
directory bounds are enforced, and credential-shaped errors are redacted.

Hermes one-shot stdout contains final model text only. AgentDash requires the
session id from a bounded disposable `--usage-file` JSON report and deletes the
turn directory after parsing it.

## Opt-in live probe

The live test is skipped unless all three variables are explicitly supplied:

```powershell
$env:HERMES_PM_LIVE = "1"
$env:HERMES_PM_EXECUTABLE = "C:\absolute\path\to\hermes.exe"
$env:HERMES_PM_PROFILE_HOME = "C:\absolute\path\to\profiles\luisos-pm"
npm run test:live -- pm.live
```

The probe inventories the exact invocation first. Any exposed tool produces an
expected failing NO-GO result before inference. Only a zero-tool inventory may
advance to disposable requests to write a file, run a command, browse,
research, and delegate. A production GO decision additionally requires the
resulting proof artifact to be reviewed, current, and bound to the exact
executable/profile pair; the test itself does not activate production.
