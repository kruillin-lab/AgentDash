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

Net effect: **when a terminate attempt fails while the parent has already closed, the
retry budget is cancelled and termination reports `termination_unconfirmed`** — even
though the tree really was killed. `taskkill` exits non-zero whenever a tree member it
enumerated exits on its own before it gets to kill it, which is common precisely when
the whole tree is dying at once, so this is reachable in production.

## Correction: this is not what was failing the tests

The paragraph above is right about the code and wrong about the symptom. The three
tests do not fail with `termination_unconfirmed` — `expect(pending).resolves` passes
and the sentinel assertion after it fails, so the runner reported success and the
grandchild had written its file.

Measured on this machine, 2026-08-09, spawning `taskkill.exe` exactly the way
`terminateWithTaskkill` does:

```text
taskkill /PID <parent> /T /F   cost: 844-1436 ms over 5 clean trials, exit 0 in 5/5
grandchild dead when taskkill returned: 5/5     sentinel never written: 5/5
```

The cost is process creation for the helper, not the kill. The three tests gave the
grandchild an 800 ms fuse (1500 ms against a 750 ms timeout, so a 750 ms budget), which
is **shorter than the terminator's own latency under load**. The grandchild therefore
raced the mechanism, not the guarantee, and won whenever the box was busy. That is the
real reason the failure count tracked CPU load.

An earlier probe of my own reproduced "grandchild survives, taskkill exits 255" and
looked like proof that `/T` does not reap grandchildren. It was the same artifact: the
fuse was still shorter than the terminator, so the grandchild had already written and
exited before the kill phase. With a fuse clear of the measured cost the effect
disappears entirely. The 255 exits are real but mean something narrower — a member that
exited between `taskkill`'s enumeration and its kill, reported as "There is no running
instance of the task". That is exactly the partial failure that trips the ordering race
above.

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
`taskkill /PID <pid> /T` dry probe) and treat verified-extinct as confirmed regardless
of close ordering. ~~Closes the race without weakening the guarantee.~~ **That sentence
was wrong.** Neither seam it proposes verifies what the guard protects:

- There are no "recorded grandchild PIDs". Nothing in this process observes the tree —
  the child is spawned with piped stdio and no enumeration, so the only PID we ever
  hold is the parent's, and descendants spawned after any hypothetical snapshot are
  invisible by construction.
- A `taskkill /PID <pid> /T` dry probe reports on the root, not the tree. Once the
  parent is gone it returns "not found" whether or not descendants are still running —
  which is precisely the unverified state the guard exists for, answered as if it were
  the verified one.

So A does not close the race *without* weakening the guarantee; it needs real tree
enumeration first, and with `/T` replaced by explicit per-PID kills it would also have
to enumerate before killing rather than after. That is a materially larger change than
the race warrants.

**B. Order the wait so a fast close is not fatal.** `taskkill` exiting 0 already
means the tree was signalled. Await both the close and the terminator, then decide,
rather than letting whichever fires first determine the verdict.

**C. Leave it and mark the tests as Windows-conditional.** Cheapest, and dishonest:
it hides a production path that reports failure on a successful kill. Every abort
that loses this coin flip surfaces as `termination_unconfirmed` to the operator.

## Resolution

**B, implemented.** The four `closeResult` short-circuits are gone from
`terminateWithRetries`; the bounded attempt budget always plays out and `stop()` decides
from both facts afterwards. The fail-closed intent is untouched and now pinned: a parent
that closed with no attempt ever confirming a signal still rejects, in `stop()`.

Both halves are mutation-pinned in `scripts/mission-control/mutation-sweep-hermes.cjs`
(`win32 close does not cancel retries`, `unconfirmed win32 close fails closed`) —
restoring either short-circuit fails a test. That sweep was added because this file was
the last unswept boundary in the product: nothing else turns an authorized decision into
a real OS process, and none of its controls — allowlist, argument bounds, environment
policy, output redaction, detached-launch validation — had ever been mutation-tested.

Separately, the three tree tests now give the grandchild a 5 s fuse instead of 800 ms.
The assertion is unchanged — the grandchild must never get to act — but it no longer
encodes an undocumented 800 ms termination deadline that the mechanism cannot meet.
Termination stays bounded by `DEFAULT_TERMINATION_GRACE_MS`.

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

Before the fix: failed 1-3 of 24 non-deterministically, always in the three
abort/timeout/output-limit tree tests. After: 26 of 26, stable across repeated runs
under the same load. The extra two are the guards pinning this fix.
