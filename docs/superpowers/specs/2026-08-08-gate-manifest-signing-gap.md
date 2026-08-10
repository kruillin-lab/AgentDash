---
tags:
  - type/spec
  - project/agentdash
  - status/resolved
type: spec
project: agentdash
status: active
aliases:
  - GateManifestV1 signing gap
---

# GateManifestV1 signing gap

**Status: RESOLVED (option A, approved 2026-08-08). Implemented in
`scripts/mission-control/sign-gate-manifest.mjs` and the `authenticateGateEvidence`
seam in `promote-gates.mjs`. This note is kept as the design record and the audit
trail.**

## Resolution

The five open questions were answered from the plan's own text:

1. **Attests to** — the accepted proof set (gate id + evidence digest + external
   commit + binary digest), the computed conjunction, the validity window, the named
   reviewer, and the key id/generation.
2. **Key** — machine-local at `AGENTDASH_STATE_DIR/security/gate-signing-key.json`,
   never committed, read only as a real regular file (never a symlink).
3. **"Reviewed"** — a separate explicit operator action with a named `operator_id`.
   The probe cannot sign its own output; automation signing its own evidence would
   attest to nothing, which is what `SIGNING_REASON` already said.
4. **Rotation** — key id and generation are bound; a rotated generation invalidates
   older manifests.
5. **Fail-closed** — absent, malformed, wrong-key, rotated, tampered, expired,
   not-`go`, and wrong-location are each distinct refusals. Anything unverifiable is
   a refusal, never a pass.

HMAC-SHA256 over canonical JSON with a constant-time compare, deliberately mirroring
the operator-signed qualification envelope in `routes/qualification-runner.ts` rather
than introducing a second scheme. Manifests also bind a normalized digest of the
state dir they were reviewed for, because the plan calls promotion "an explicit local
operator action".

Authentication lives in its own seam, checked once at the CLI boundary. A first
attempt buried it inside `evaluatePromotion`, which broke 32 tests and forced every
evidence-validating caller to also authenticate — the same two-layer duplication that
had already caused one real reader-divergence bug. The seam was moved rather than the
fixtures patched.

### Audit outcome

Three adversarial lenses attacked it. The cryptographic core held: no HMAC collision
between distinct bodies, canonicalization stable (key order, no type-confusion
collision, no literal `undefined` in a signed body), signature checked before the
conjunction, rotation and expiry enforced independently, no secret reaching stdout,
stderr, a stack, or any persisted artifact across four CLI failure paths, and no
prototype pollution.

Five real findings were fixed:

- the signing key was read with a bare `readFile`, following symlinks, while the
  evidence paths in the same codebase already rejected symlinked evidence;
- a manifest carried no location binding, so with the same key material in two state
  dirs a manifest signed for one promoted the other (reproduced end to end);
- the constant-time comparison was not load-bearing in the suite;
- `main()`'s enforcement of the authentication result could be deleted with all 127
  tests still green — the same class as an earlier spliced-out function that crashed
  every real CLI run;
- several guards leaned on a neighbouring check rather than being pinned individually.

Mutation swept: 24 of 24 signing guards caught, 28 of 28 promotion guards caught.
Run `node scripts/mission-control/mutation-sweep-signing.cjs`.

One guard is deliberately untested: the own-property read in `loadSigningKey`.
`JSON.parse` already makes a literal `"__proto__"` key an own data property that does
not affect prototype lookup, so it has no reachable failure today. It guards a future
non-JSON parser. The mutation was removed from the sweep rather than covered by an
assertion that cannot fail.

## Original finding (kept for the record)

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
