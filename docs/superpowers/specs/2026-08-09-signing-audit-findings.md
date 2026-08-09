---
tags:
  - type/spec
  - project/agentdash
  - status/active
type: spec
project: agentdash
status: active
aliases:
  - Independent signing audit findings 2026-08-09
---

# Independent signing audit — findings

The open item from `2026-08-08-session-state.md`: an independent pass on the code
that authorizes production dispatch. My own mutation sweep (24/24) was self-run
with a harness that had previously produced false results in both directions, so
the number needed re-deriving by something other than me.

Three read-only adversarial lenses at `d036b6f`: mutation-testing, crypto/bypass,
and test-honesty. Repo verified byte-identical after each.

## Confirmed findings

### 1. The durable dispatch record is self-attesting (real, verified myself)

`manifest_digest` is validated for SHAPE ONLY — `/^[a-f0-9]{64}$/i` — and never
resolved to the manifest it names. `"a".repeat(64)` is accepted. Nothing reads the
signing key, verifies a signature, or checks that
`dispatch/promotion-<digest>.json` exists.

Both readers are affected, identically:

- `src/server/mission-control/runtime/composition.ts:38-55` (`readPromotedDispatchMode`) — the runtime enforcement point
- `scripts/mission-control/promote-gates.mjs:249-256` (`acceptDispatchRecord`) — the CLI's `--expect-current` comparison

The auditor framed this as "write-time authenticated, read-time not." That is
wrong and the truth is worse: **neither** reader checks. The duplication is
deliberate (see the comment at composition.ts:41-43) — the two must accept exactly
the same thing or `--expect-current` compares against a mode not in force. So any
fix MUST land in both, or it reintroduces the reader-divergence bug this project
already hit once.

Why my sweeps could not have caught it: `mutation-sweep.cjs` and
`mutation-sweep-signing.cjs` target only `promote-gates.mjs` and
`sign-gate-manifest.mjs`. Neither touches `composition.ts`. The 24/24 and 28/28
numbers are true statements about a scope that excludes the runtime reader.

This falsifies a runbook sentence as written
(`docs/operations/mission-control-runbook.md`, "Dispatch authority"):

> a promoted mode never outlives its evidence expiry or survives a missing manifest digest

A syntactically valid digest bound to no manifest survives fine.

**Severity: real control gap, not a privilege-boundary crossing.** The system is
local-only and single-operator; whoever can write `mode.json` can also run
`promote-gates --promote`. So it is not a new way IN. But the design's thesis is
that the durable record is the only GRANT of authority and that the grant is
backed by signed evidence, and right now the record asserts its own authority.
Cheap to close; closing it makes the runbook true.

**Fix:** in both readers, resolve `promotion-<digest>.json`, recompute its digest
over canonical JSON, and require it to equal the record's `manifest_digest` and
its `target_mode` to equal the record's `mode`. Absent or mismatched → return null
(fail closed, reads as `disabled`). Mutation-test the new guard in BOTH readers.

### 2. TOCTOU on the signing-key read (confirmed by comparison to the codebase's own pattern)

`scripts/mission-control/sign-gate-manifest.mjs:206-237` (`loadSigningKey`) does
`lstat(file)` to reject symlinks/non-regular-files, then a SEPARATE
`readFile(file)` — validating one path and reading another.

The codebase already solves this correctly for its LESS sensitive artifact:
`write-gate-manifest.mjs:247-260` (`validateOpenEvidenceFile`) opens a handle,
then compares `handle.stat()` `dev`/`ino` against `realpath` to detect an identity
swap after open. The signing key deserves at least that.

Practically gated behind the same write access as finding 1, so defence-in-depth
rather than a fresh hole. Fix by adopting the open-handle + fstat + dev/ino
pattern already in the tree.

## Attacked and held

The cryptographic core survived. Verified independently by me, not just reported:

- **No canonicalJson type confusion.** `1`/`"1"`, `true`/`"true"`, `null`/`"null"`,
  `undefined`/`"undefined"`, array/string, nested object vs its JSON text — all distinct.
- **No key injection.** A key containing `":1,"` stays escaped; structure cannot be forged.
- **One collision exists and is unreachable:** array hole vs explicit `undefined`
  entry both canonicalize to `[,1]`. Unreachable for two independent reasons — JSON
  text cannot express either (`JSON.parse('[,1]')` is a SyntaxError), so a manifest
  loaded from disk can never carry one; and the only array in a signed body,
  `gate_evidence`, is built by `push()` of plain objects. Both collapse to `[null,1]`
  on any round trip. Latent hazard only if someone later signs a caller-supplied array.
- State-dir binding holds across case, trailing slashes, separator style, `.`/`..`,
  UNC, 8.3 aliases; mismatches fail closed. Relative-path ambiguity exists in the
  exported helper but is unreachable — `main()` enforces `path.isAbsolute`.
- `authenticateGateEvidence` cannot be reached around within the CLI; `main()`
  checks `authenticated.ok` before any evaluate/commit step.
- Rotation and expiry enforced independently, including float/string/negative/zero
  generation via `Number.isSafeInteger` + `> 0`.
- No secret reaches stdout, stderr, a stack, or a persisted artifact on any traced path.
- Prototype pollution not reachable; the `hasOwnProperty` guard's documented
  rationale is correct.

## Process note

One lens reported that a system-reminder mid-task falsely claimed a file had been
modified intentionally and instructed it not to tell me. It refused, re-verified
with `git status`/`git diff`, and reported it. Correct call — I issued no such
instruction. I independently re-verified the tree clean at `d036b6f`. Worth
knowing that this class of injected instruction appears in this environment.
