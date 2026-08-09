---
tags:
  - type/spec
  - project/agentdash
  - status/open-decision
type: spec
project: agentdash
status: active
aliases:
  - GateManifestV1 signing gap
---

# GateManifestV1 signing gap

**Status: open decision. No code has been written for this. It blocks every
remaining step of the CEO Mission Control MVP.**

## The finding

`candidate`, `qualification`, and `enabled` dispatch are all unreachable today,
for a single shared reason: the signed gate manifest the plan names was never
built, and the unsigned precursor that *was* built can never authorize anything.

Task 1's Interfaces line says:

> `GateManifestV1` is the canonical signed collection consumed by health and
> promotion.

What ships is `buildUnsignedGateSnapshot`, producing `unsigned_gate_snapshot_v1`.
It is structurally incapable of authorizing dispatch:

- `scripts/mission-control/write-gate-manifest.mjs:163` seeds the NO-GO reason
  list unconditionally: `const reasons = [SIGNING_REASON]`, where
  `SIGNING_REASON` is *"No reviewed signing authority is configured; unsigned
  evidence cannot be promoted or authorize dispatch."*
- `write-gate-manifest.mjs:191` hardcodes `dispatch: { status: "no_go", ... }`.
  It is never computed from the proofs.
- `write-gate-manifest.mjs:193-196` emits
  `consumer_acceptance: { health: "rejected", promotion: "rejected" }` with the
  comment *"Only a future reviewed GateManifestV1 may be consumed by health or
  promotion."*

Meanwhile `promote-gates.mjs` requires `snapshot.dispatch.status === "go"`.

So the two consumers the plan names — health and promotion — are told by the
producer to reject its output, by design, until a signed manifest exists.

### Verified, not inferred

A real probe run against a scratch state dir:

```text
schema_version               : unsigned_gate_snapshot_v1
dispatch.status              : no_go
consumer_acceptance.promotion: rejected
proofs accepted              : 4 of 10
```

Feeding that snapshot to `promote-gates --mode=candidate` refuses with
`Missing gate proof for agentdash_local_authority` (and others).

### Why `candidate` is blocked too

`candidate` mode looked reachable, because Task 17 says to *"first run
deterministic/no-model production-path fixtures in `candidate`"* and candidate
work needs no model route. It is not reachable, because of the authority rule
added when the compare-and-set was implemented:

`src/server/mission-control/runtime/dispatch-mode.ts::resolveDispatchMode` makes
the durable promotion record the only thing that **grants** authority;
`MISSION_CONTROL_DISPATCH` may only **restrict** it. With no promoted record,
`stored` is `disabled` and the env var cannot raise it. Reaching `candidate`
therefore requires a promotion, which requires a `go` manifest.

That rule is correct and load-bearing (an env var must never reach `enabled` on
its own). The side effect is that it also gates the harmless deterministic mode
behind the same missing signature.

## What is NOT the problem

- The ten gates themselves are implemented, each with pass criteria, required
  facts, and a `no_go_behavior`. The probe correctly exits non-zero.
- The promotion path is fully verified: 28 of 28 safety mutations are caught by
  the suite (`node scripts/mission-control/mutation-sweep.cjs`).
- The upstream Hermes and CodeG bridges are real and committed.

This is a missing component, not a broken one.

## Options

### A. Build `GateManifestV1` and a local signing authority

Implement the signed manifest, a machine-local key under
`AGENTDASH_STATE_DIR/security`, and teach health and promotion to consume only
signed manifests. Plan-faithful; unblocks `candidate` and `enabled`.

Open questions this design must answer before code exists:

1. **What does the signature attest to?** The canonical digest of the accepted
   proof set, or the whole snapshot including `dispatch.status`? If the latter,
   who computes `go`, and against what?
2. **Where does the key live, and who may use it?** The plan's OS-isolation
   boundary (Task 7) runs the controller under a dedicated identity. Does the
   signing key belong to that identity, the operator, or a separate reviewer?
3. **What is "reviewed"?** `SIGNING_REASON` says *"no reviewed signing
   authority"*. Review by whom, recorded where? If a signature can be minted by
   the same automation that produced the evidence, it attests to nothing.
4. **Rotation and revocation.** Task 7 already defines a capability rotation
   protocol; should manifest signing reuse that generation model?
5. **Failure mode.** An unverifiable signature must fail closed, and be
   distinguishable from an absent one.

Risk to weigh: I would be authoring the boundary that authorizes production
dispatch. Across five adversarial rounds, reviewers found nine real defects in my
own Task 17 promotion code — including a guard I had claimed was fail-closed that
was fail-open, and a test of mine that could not fail. That code is now
mutation-verified, but the base rate argues for review before reliance, not
after.

### B. Design first, approve, then build

Same destination, with the five questions above answered and approved before any
code exists. Slower; puts the security decision with the owner.

### C. Narrow operator override for `candidate` only

Leave signing unbuilt. Add a loud, explicitly-logged override permitting
`candidate` only, so deterministic no-model fixtures can run against real
services now. Deliberately weakens the plan's gate model; must never apply to
`enabled`. Buys integration signal, adds a bypass that has to be removed later.

### D. Hand off

Treat the MVP as complete through Task 16, with Task 17 machinery built and
verified but unexercised. Document what is proven and what remains.

## Recommendation

**B, then A.** The five questions are cheap to answer and expensive to get wrong,
and answering them first is what makes A reviewable rather than trust-me work.

C is defensible only if integration signal is urgently needed, and only with a
tracked removal.

## Current state, for whoever picks this up

- 909 unit tests / 56 files, 86 script tests, 15 mock e2e scenarios, 35 fault
  proofs, typecheck, lint, build — all green.
- 28 of 28 promotion-guard mutations caught.
- `npm run mission-control:probe` exits 1 with a truthful per-gate NO-GO report.
- Dispatch mode is `disabled`; no promoted record exists anywhere.
- Known intermittent: the git-finalizer and process-tree suites are timing
  sensitive on Windows and can fail under concurrent load. Three consecutive
  isolated runs are clean at 909/909.
