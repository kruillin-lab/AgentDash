---
tags:
  - type/spec
  - project/agentdash
  - status/active
type: spec
project: agentdash
status: active
aliases:
  - CEO Mission Control session state 2026-08-08
---

# Session state — 2026-08-08

Written before a strategic compact. Everything below is either verified in this
session or reproducible from the repo; nothing here is a guess.

## Where the project stands

The MVP is **built and audited through Task 17's machinery**. Dispatch is still
`disabled`: no promotion has been performed against real services, and no live
qualification run exists.

Baseline (re-verify with the commands below, do not trust these numbers blind):

- 909 unit tests / 56 files
- 129 script tests
- 15 mock e2e scenarios
- 35 fault-injection proofs
- typecheck, lint, build clean
- mutation sweeps: 28/28 promotion guards, 24/24 signing guards

```bash
npm run test:unit
node --test scripts/mission-control/__tests__/*.test.mjs
npx playwright test --config playwright.config.ts mission-control.mock
node scripts/mission-control/fault-harness.mjs
node scripts/mission-control/mutation-sweep.cjs
node scripts/mission-control/mutation-sweep-signing.cjs
```

## What was done in this session

1. **Audited all 18 tasks** against the two approved documents with auditor + harsh
   critic pairs per group, looping until fresh critics found nothing. 17 real
   defects fixed. Converged after four consecutive clean read-only critics.
2. **Closed the two recorded Task 17 gaps**: `PromotionManifestV1` did not exist,
   and "compare-and-set" was a console message with no durable store.
3. **Discovered and closed the signing blocker** (see
   `2026-08-08-gate-manifest-signing-gap.md`): the probe emits an unsigned snapshot
   that can never authorize dispatch, so `candidate`/`qualification`/`enabled` were
   all unreachable. Built `GateManifestV1` + a reviewed signing authority, then had
   it adversarially audited; five findings fixed.

## The next step

`candidate` mode is now reachable. Task 17 says to *"first run deterministic/no-model
production-path fixtures in `candidate`"* before any qualification run. That is the
next action, and it needs real disposable services.

Working operator flow, verified end to end in a scratch state dir:

```bash
# 1. collect evidence (exits 1 while gates are unproven — that is correct)
AGENTDASH_STATE_DIR=<dir> npm run mission-control:probe

# 2. provision the machine-local signing key (once)
#    <dir>/security/gate-signing-key.json
#    { "key_id": "signing_key_00001", "generation": 1, "secret": "<>=32 chars>" }

# 3. a named operator reviews the snapshot and signs it
#    scripts/mission-control/sign-gate-manifest.mjs :: signGateManifest({ stateDir, snapshot, reviewer, key, now })

# 4. promote by compare-and-set from the mode you believe is current
AGENTDASH_STATE_DIR=<dir> node scripts/mission-control/promote-gates.mjs \
  --mode=candidate --expect-current=disabled --evidence=<signed manifest> --promote
```

## Non-obvious facts worth keeping

These cost real time to discover and are not visible from the code alone.

- **The files are CRLF.** A `\n`-based regex replacement silently patches NOTHING.
  This produced at least one false "uncaught guard" result and could equally produce
  a false "caught". Mutate by exact substring or line index and verify the file
  actually changed. Both sweep harnesses now do this.
- **Git Bash `ln -s` copies on Windows** (`lstat().isSymbolicLink()` is false), so a
  symlink test built on `ln -s` proves nothing. Use `fs.symlinkSync` and assert
  `isSymbolicLink()` in the fixture first. One reviewer's "symlink accepted" finding
  did not reproduce for exactly this reason.
- **`chmod` is a no-op on Windows**, so permission-based fail-closed tests are
  meaningless here. Force a non-`ENOENT` `readdir` error portably instead — e.g. put
  a FILE where the directory belongs (`ENOTDIR`).
- **A plain JS `"C:\Users\x"` silently drops its backslashes.** One of my own leak
  tests could not fail because of this. Use `String.raw` for path fixtures and assert
  the fixture really contains a backslash.
- **The git-finalizer and process-tree suites are timing sensitive** and can fail
  under concurrent load (e.g. running the suite alongside a mutation sweep). Three
  consecutive isolated runs are clean at 909/909. Not a regression.
- **Authority rule:** the durable promotion record is the only thing that GRANTS
  dispatch authority; `MISSION_CONTROL_DISPATCH` may only RESTRICT it. This is why
  `candidate` was unreachable without a promotion, which was not obvious.

## Open items

- **The third signing audit lens stalled** (mutation-testing) and never reported. I
  ran that sweep myself — 24/24 clean — but an independent pass on the signing code
  has not completed. Given this is the boundary authorizing production dispatch, one
  is worth doing before relying on it.
- The plan's "Final implementation review" asks for read-only reviews across eight
  dimensions before handoff. The superseded-concept sweep is done and clean; the rest
  of that review is not.
- `npm run test:live` has never run (correctly opt-in; needs disposable services).
- Auto activation is gated as its own authority step and is OFF. Enabling it needs a
  separate complete harmless qualification path whose auto predicate is satisfied.

## Authority documents

- Plan: `docs/superpowers/plans/2026-08-03-ceo-mission-control-mvp.md`
- Design: `docs/superpowers/specs/2026-08-02-ceo-mission-control-mvp-design.md`
- Signing design + audit trail: `docs/superpowers/specs/2026-08-08-gate-manifest-signing-gap.md`
- Runbook: `docs/operations/mission-control-runbook.md`
