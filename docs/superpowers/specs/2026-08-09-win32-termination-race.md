---
tags:
  - type/spec
  - project/agentdash
  - status/active
type: spec
project: agentdash
status: active
aliases:
  - Windows process-tree termination race
---

# Windows process-tree termination race

`src/server/hermes/command.test.ts`'s three "confirms the complete process tree is
gone" tests fail intermittently on Windows. I twice called this a load-induced test
flake. **That was wrong.** It is a real ordering race in production code.

## What I got wrong first

The failure count tracked CPU load monotonically (93% → 3 failures, 79-81% → 2, 2,
1), which looked conclusive. It was a correlation with the wrong cause: load changes
which side of the race wins, but the race is what fails.

Measurement that broke the load theory — a bare 3-level Node tree on this machine:

```text
spawn latency:       ~40 ms
kill -> close:        ~4 ms
```

Nowhere near the 10 s `DEFAULT_TERMINATION_GRACE_MS`. Load cannot plausibly exhaust
a 10-second confirmation window when the operation takes milliseconds, so the
timeout was never the mechanism.

## The actual race, measured

`terminateProcessTree` spawns `taskkill.exe /PID <pid> /T /F` as a child process.
Spawning and running that helper costs far more than the target takes to die:

```text
taskkill completed at 732ms | parent close at 732ms | parent closed FIRST: false
taskkill completed at 684ms | parent close at 685ms | parent closed FIRST: false
taskkill completed at 613ms | parent close at 611ms | parent closed FIRST: true
```

The parent's `close` event and `taskkill`'s own exit land within 1-2 ms of each
other, and the order flips run to run. That coin flip decides the result:

1. `src/server/hermes/command.ts:289` — `waitBeforeTerminationRetry` begins with
   `if (platform === "win32" && closeResult) throw new CommandTerminationError();`
   The parent having already closed is treated as unconfirmable, because `taskkill
   /T` may have missed a grandchild.
2. That throw propagates out of `terminateWithRetries(false)`, so `stop()` sets
   `gracefulConfirmed = false` (command.ts:333-337).
3. `command.ts:338` — `if (!gracefulConfirmed) { if (closeResult) throw new
   CommandTerminationError(); }`. A closed parent is exactly the state reached in
   step 1, so this always throws.

Net effect: **when the parent closes before `taskkill` finishes, termination is
guaranteed to report `termination_unconfirmed`** — even though the tree really was
killed. The test asserts the happy path resolves, so it fails.

## Why the guard exists, and why it is still wrong

The intent is right and must be preserved: Windows has no reliable process-group
SIGTERM, so a parent that vanished mid-retry genuinely leaves open whether
grandchildren were reaped. Claiming a clean abort there would be a false negative on
orphaned processes, which is the more dangerous direction.

What is wrong is conflating two different states:

- **Parent closed and the tree was verified extinct** — confirmable, should succeed.
- **Parent closed with the tree unverified** — correctly unconfirmable.

The non-Windows path already makes this distinction with
`waitForTreeExtinction(...)`. The Windows path has no equivalent, so it treats every
parent-closed case as the unverified one.

## Options

**A. Verify extinction on Windows, like the POSIX path.** After `taskkill` returns 0,
poll for the tree actually being gone (the recorded grandchild PIDs, or a
`taskkill /PID <pid> /T` dry probe) and treat verified-extinct as confirmed
regardless of close ordering. Closes the race without weakening the guarantee.
Most faithful; needs a reliable Windows tree-enumeration seam.

**B. Order the wait so a fast close is not fatal.** `taskkill` exiting 0 already
means the tree was signalled. Await both the close and the terminator, then decide,
rather than letting whichever fires first determine the verdict.

**C. Leave it and mark the tests as Windows-conditional.** Cheapest, and dishonest:
it hides a production path that reports failure on a successful kill. Every abort
that loses this coin flip surfaces as `termination_unconfirmed` to the operator.

## Recommendation

**A**, with **B** as the fallback if a trustworthy enumeration seam is not available.
Not C — the flake is the symptom, and silencing the test leaves real aborts randomly
reporting failure.

## Impact

Not a dispatch-authority issue and not a security hole: it fails CLOSED, reporting
unconfirmed termination when the kill actually succeeded. The cost is operational —
`cancel` and `abort` paths intermittently report `termination_unconfirmed` on
Windows, which per the design's cancellation rules terminalizes `inconsistent`
rather than `cancelled`. So a successful cancel can be durably recorded as an
unresolved external operation.

## Reproduction

```bash
npx vitest run --config vitest.config.ts src/server/hermes/command.test.ts
```

Fails 1-3 of 24 non-deterministically. The three affected tests all take the
abort/timeout/output-limit termination path.
