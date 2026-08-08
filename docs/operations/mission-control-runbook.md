---
tags:
  - type/documentation
  - project/agentdash
  - status/active
type: documentation
project: agentdash
status: active
---

# Mission Control Runbook

Operational guide for the CEO Mission Control workspace. Mission Control is
local-only and single-operator. AgentDash is the sole controller, policy,
command, and reconciliation authority; Hermes owns the canonical task/run
lifecycle; CodeG owns every model-backed worker session. Production dispatch is
**disabled by default** and stays that way until every gate is proven.

## Startup

```powershell
npm run build
npm start        # serves http://127.0.0.1:3007, loopback only
```

At server startup `src/instrumentation.ts` normalizes
`MISSION_CONTROL_DISPATCH` to an exact fail-closed mode
(`disabled|qualification|candidate|enabled`; anything else becomes `disabled`)
and, on the Node.js runtime, starts the dormant controller runtime, which
acquires the single controller-owner lease under `AGENTDASH_STATE_DIR`. Exactly
one server process can own the scheduler; a second process stays a non-owner.

Required environment:

| Variable | Purpose |
|---|---|
| `AGENTDASH_STATE_DIR` | Machine-local state root (outbox, owner lease, evidence). Never inside the repository. |
| `MISSION_CONTROL_DISPATCH` | Dispatch mode. Default/unknown → `disabled`. |
| `AGENTDASH_LISTENER_ADDRESS` | Must be `127.0.0.1`. |

## Gate inspection

```powershell
npm run mission-control:probe        # or: node scripts/mission-control/refresh-gates.mjs
```

This re-runs every capability proof against the exact committed binaries and
writes a digest-addressed snapshot under `AGENTDASH_STATE_DIR/evidence`. The
conjunction is NO-GO until all ten gates pass; the command exits non-zero and
prints each NO-GO reason. Health is projected at `/api/mission-control/health`
(redacted dispatch mode, auto-launch eligibility, proof ids/expiries) and on
`/api/health` under `mission_control`.

## Approval dispatch

Approval-required work is created in a non-runnable blocked state and surfaces
in **Needs you** with the exact decision and proposed TaskSpec revision. One
CEO approval activates exactly one immutable mandate revision; every action
inside it consumes separate one-time authority without another CEO
interruption. Approval requires the authenticated command route (loopback,
same-origin session, CSRF, single-use nonce, exact displayed digests).

## Auto eligibility

Auto-launch is allowed only when the complete low-risk predicate holds:
aggregate cost ≤ $1.00, runtime ≤ 30 minutes, enforceable cost/runtime/cancel,
safe local workspace, no risky capability, complete terminal path, held
reserves, current level-5 route, current proof, and present verification and
finalization. `evaluateAutoEligibility` returns the exhaustive reason list; one
failure makes the snapshot ineligible. Auto skips only the CEO activation
command — never validation, authority, observability, verification,
finalization, receipts, or reconciliation.

## Cancellation

Cancellation is a UI action state while the canonical task remains `running`.
A confirmed exact stop yields `cancelled`. An ambiguous result stays pending
inside the numeric cancel-confirmation deadline; deadline expiry terminalizes
`inconsistent` and never claims a false cancellation.

## Reconciliation-pending response

Every uncertain external operation must leave **Working** by its numeric
deadline. On expiry the task moves to **Stopped**, a durable `inconsistent`
terminal intent records the unresolved external activity, and — while Hermes
delivery is still queued — the board shows **Stopped — reconciliation pending**
from the non-authoritative outbox overlay. A read-only quarantined monitor may
keep looking up or exactly cancelling, but it can never revise the accepted
terminal outcome.

## Evidence refresh and promotion

```powershell
node scripts/mission-control/refresh-gates.mjs
node scripts/mission-control/promote-gates.mjs --evidence=<snapshot> --mode=<mode> [--promote]
```

`promote-gates.mjs` promotes only when the full conjunction passes with verified
evidence digests and external commits, as a compare-and-set from the current
mode, and only with the explicit `--promote` operator action. Without
`--promote` it is a dry run. It cannot manufacture evidence or promote a
partial conjunction.

## Rollback

Set `MISSION_CONTROL_DISPATCH=disabled` and restart. The board returns to
read-only, activation and dispatch are denied, and the dormant runtime holds no
live dispatch. Rollback never requires editing a database.

## Recovery without database editing

- The recovery outbox under `AGENTDASH_STATE_DIR/outbox` holds immutable,
  canonical, redacted result envelopes. On restart the controller rehydrates
  from Hermes plus the outbox, redelivers any journaled-but-undelivered receipt,
  and reconciles each command by its stable idempotency key.
- A crashed owner's stale lease is reclaimed by quarantine after its heartbeat
  expires; PID reuse is defended by the process-start token.
- Never repeat an ambiguous mutating call: reconcile by the stable command key
  and exact bound state until the numeric deadline, then terminate
  `inconsistent` and quarantine the unresolved external activity.
- The fault harness (`node scripts/mission-control/fault-harness.mjs`) injects
  response loss and restart at every command boundary and must report GO before
  any promotion.
