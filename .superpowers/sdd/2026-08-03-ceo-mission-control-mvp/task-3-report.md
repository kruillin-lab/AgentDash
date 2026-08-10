---
tags:
  - type/report
  - project/agentdash
  - status/complete
  - stage/task-3
type: report
project: agentdash
status: complete
aliases: []
---

# Task 3 Report — Mission Control Contracts and Ports

## Status

Complete. The hardened terminal, route, and finalization contract surface is contained in the atomic correction commit named `fix: harden terminal and route contracts`.

- Correction base: `eb1cc2f2ebe1dfc24fd70b66f49ab192614c4d61` (`fix: complete mission control contract surface`).
- Production dispatch remains disabled; this task contains pure schemas, types, tests, and interfaces only.
- Final fresh read-only contract audit: `READY`.

## Delivered Surface

- Completed the public schemas in `src/lib/mission-control/contracts/`, including the full Hermes boundary DTO surface in `contracts/ports.ts`.
- Kept `src/server/mission-control/ports.ts` abstract and dependent only on public contract types, with no concrete adapter imports.
- Added strict, separately branded identities, including distinct Git commit and tree identities that accept realistic 40-character SHA-1 and 64-character SHA-256 object IDs.
- Kept management proposals conversational and structurally unable to carry authenticated commands, approvals, authority, adapter operations, or lifecycle mutations.
- Mechanically enumerated every exported runtime schema and supplied independent valid, invalid, and unknown-key fixtures.
- Added one internal mutation-contract module shared by mandate and finalization-command parsing so the two authority layers enforce identical path, ceiling, manifest, and digest-state rules.

## Contract Guarantees

- Canonical JSON recursively sorts plain-object keys, preserves array order, and rejects undefined values, holes, non-finite numbers, bigint, functions, symbols, cycles, and non-plain objects. Digests are lowercase SHA-256 over UTF-8 canonical JSON.
- Request, task, attempt, Work Task, CodeG task/conversation, connection, harness session, mandate, authority, command, receipt, artifact, route proof, folder, project, event, proposal, action-node, route, Git commit, Git tree, and digest identities remain compile-time non-interchangeable.
- Mandates require finite one-to-one structural maps, complete outcome transitions, bounded reconciliation, canonical mutation manifests, and coherent route-proof tuples.
- Mutation paths and allowed prefixes must be normalized safe relative POSIX paths. Segment-aware containment rejects traversal, absolute paths, backslashes, and prefix confusion such as `src2` under `src`.
- Manifest digests bind patch-wide `diff_bytes`; both mandates and commands enforce file and byte ceilings, unique paths, and exact add/modify/delete before/after digest states.
- Intake binds canonical TaskSpec/objective/acceptance/mandate digests, workspace and capability limits, verification and finalization claims, activation authority, and exact active route evidence. Revoked and expired-status proofs fail closed.
- Time-based route freshness remains deterministic at `RouteRegistryPort.requireLevel5(route_id, task_class, at)` because the locked `PersistIntakeInput` DTO has no validation timestamp; no wall clock is consulted by schema parsing.
- TaskSpec phases compare positionally with the ordered phase-bearing mandate nodes: `execute → execute`, `fallback → retry`, `remediate → remediate`, `verify → verify`, and `finalize → finalize`. Missing, extra, reordered, executor-mismatched, and route-mismatched actions fail closed.
- Deterministic verifier identity and deterministic finalizer executors are exact; routed verifier and action proofs bind to the route snapshot. Activation route order is derived directly from the validated TaskSpec phase plan.
- Receipt, finalization, authority, and port envelopes reject identity, digest, budget, timing, evidence, and nested-outcome contradictions.
- Terminal completion has one strict public schema: `AggregateReceiptV1`. The weaker compatibility-only `FinalReceiptV1` surface was removed, and successful aggregate receipts require verification and finalization references.
- `RouteProofStatusSchema` and its inferred `RouteProofStatus` type are public and are used directly by route evidence.

## TDD and Review Evidence

- Hardening RED: the focused suite exited 1 with 13 failures and 163 passing tests. Expected failures covered the missing route-status export, still-public weak final receipt, and the not-yet-supported bounded mutation fixtures.
- Hardening GREEN: the focused contract suite passes 183 of 183 tests, including traversal, POSIX/Windows absolute paths, backslashes, segment-prefix confusion, unsafe prefixes, file/byte ceilings, zero-byte ceilings, valid and invalid add/modify/delete digest states, inactive intake proofs, and strict terminal aggregates.
- Git identity RED/GREEN: a realistic 40-character object-ID test first failed against the digest-only schema, then passed after adding dedicated Git identity schemas; explicit 64-character acceptance and compile-time commit/tree separation are also covered.
- Earlier correction regressions cover missing remediation actions, mismatched deterministic verifier identity, execution-route mismatch, canonical digest bindings, exact activation claims, route evidence, receipts, CAS, budgets, and finite graph structure.
- The prior full-range audit's three high findings and one medium finding were converted into regressions before their fixes. A fresh read-only re-audit of the completed diff returned `READY`.

## Verification

- `npm run test:unit -- --run src/lib/mission-control/contracts/contracts.test.ts` — PASS (183 tests).
- `npm run typecheck` — PASS.
- `npm test` — PASS (213 tests across 4 files).
- `npm run check` — PASS (lint, typecheck, production build).
- `npm run mission-control:probe` — expected exit 1 / NO-GO because no external authority or operational evidence is configured; no external state was enabled.
- `git diff --check` — PASS.
- Changed-file scope — only Task 3-owned contract, port, test, and report paths.
- Secret scan — no credential-like additions.
- Normal quality gate — `PASS_WITH_WARNINGS`; all build, lint, typecheck, and 213 unit tests passed. Report: `C:\Users\kruil\Documents\Projects\.worktrees\agentdash-ceo-mission-control\.quality-gate\reports\gate-20260804T062423Z-6820825e.md`.
- Gate warning — unregistered test-hack notice because the task intentionally changes the contract test file; no exception was used.
- Markdown audit — this report now satisfies the stage-3 metadata convention. Repository-wide worktree validation still reports six pre-existing unowned Markdown files plus absent worktree vault scaffolding.

## Concerns

- The capability probe intentionally remains NO-GO until external authority, Hermes atomicity, CodeG replay safety, PM isolation, and other operational evidence exist. This is the required fail-closed state, not a contract/build failure.
- A manifest-level byte count is an authority-bound claim, not a substitute for adapter verification of the actual patch bytes. Finalization adapters must recompute the patch digest and measured byte count before application.
- The remaining Markdown-auditor findings are outside Task 3 ownership and were not modified.
- Future adapters must parse untrusted transport data through these public schemas and preserve branded identities at every boundary.
