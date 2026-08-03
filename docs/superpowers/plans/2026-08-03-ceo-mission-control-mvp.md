---
tags:
  - type/plan
  - project/agentdash
  - status/active
  - workflow/writing-plans
  - stage/plan
type: plan
project: agentdash
status: active
aliases:
  - CEO Mission Control MVP Implementation Plan
---

# CEO Mission Control MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to execute this plan task by task. Check off each `- [ ]` step only after its named verification passes.

**Goal:** Build one local CEO workspace in AgentDash where a capability-isolated Hermes project manager turns normal conversation into durable Hermes cards, and a deterministic AgentDash controller carries each activated task through bounded CodeG execution, remediation, independent verification, and exact finalization until a truthful terminal outcome or a typed CEO business decision is required.

**Architecture:** AgentDash owns policy, authority, command scheduling, reconciliation, and the read model. Hermes Kanban owns canonical task/run lifecycle, immutable artifacts, events, CEO-input state, and receipts. CodeG owns every model-backed worker session and its original activity. AgentBrain contributes reviewed context only. The Hermes PM proposes untrusted management intent and never performs worker work or mutates lifecycle authority. A single CEO approval activates one immutable finite mandate; each action inside it receives separate one-time authority and a replay-safe logical command.

**Tech stack:** Next.js 14 App Router, React 18, TypeScript 5.5 strict mode, Zod, Vitest, Testing Library, Playwright, Hermes Agent Kanban CLI/Python, CodeG Rust/SeaORM HTTP and WebSocket server, and a deterministic local Git finalizer for the initial code-work path.

**Design authority:** [CEO Mission Control MVP Design](../specs/2026-08-02-ceo-mission-control-mvp-design.md), approved in commit `42ba01b`.

## Global constraints

- The MVP is local-only, single-operator, and scoped to AgentDash + clean Hermes/CodeG candidate builds + reviewed AgentBrain recall. Buzz and remote multi-user operation remain out of scope.
- AgentDash is the sole controller, policy, command, and reconciliation authority; Hermes remains the canonical task/run lifecycle authority. Hermes PM output, route labels, model prose, UI state, and adapter responses are evidence or proposals, never authority.
- The PM process receives no filesystem, shell, browser, research, delegation, credential, lifecycle-mutation, or worker capability. Prompt instructions are not considered containment.
- Hermes remains canonical for cards, runs, artifacts, events, CEO-input state, and receipts. AgentDash's outbox stores recovery envelopes only; it is not a second task database.
- Installed Hermes and CodeG copies are immutable. Upstream work occurs only in the named clean worktrees, with separately reviewable commits and disposable data.
- No task may widen a route, capability, workspace, budget, acceptance condition, prohibited-action set, verifier, or finalizer after mandate activation. Such a change requires a typed CEO-input request and a new immutable revision.
- Every production file change is test-first, preserves strict TypeScript/Python/Rust boundaries, and ends with the named focused test plus the repository gate. Do not weaken a failing proof or replace a live assertion with a mock.
- Existing AgentDash OpenCode, Hermes, Agent Fleet, overview, and legacy-reference surfaces are compatibility constraints throughout the plan.
- Production dispatch remains disabled until Task 17. The sole earlier model-execution exception is the isolated qualification mode defined below; it is not reachable from CEO chat or normal board commands.

### Dispatch modes

| Mode | Allowed work | Authority |
| --- | --- | --- |
| `disabled` | Read-only board, PM fixtures, contracts, deterministic tests | Default; no external worker command |
| `qualification` | Explicit operator-signed canary/evaluation jobs on a disposable board and disposable allowlisted workspace; no production data or external finalization | Per-run qualification envelope, hard limits, candidate bridge proofs, and no CEO UI route |
| `candidate` | Deterministic/no-model end-to-end fixtures using production controller paths | Explicit local operator action after core gates pass |
| `enabled` | Approval-required production paths and auto paths whose exact route/task-class, complete mandate, and applicable launch predicate are proven | Task 17 promotion manifest |

Qualification mode may collect level-4 and level-5 evidence and may exercise a complete harmless approval path, but it cannot accept ordinary CEO requests, mark a route production-eligible by configuration alone, mutate a non-disposable target, or bypass any authority, budget, cancellation, reconciliation, verification, or receipt rule.

## Execution rules

1. Execute tasks in order. Tasks 1-16 keep production dispatch disabled. Task 10 may run operator-gated qualification jobs only after Tasks 7-9 prove the candidate bridges and containment boundary. Task 17 is the only task allowed to promote production dispatch from `no_go` to `ready`.
2. If a hard proof remains NO-GO, continue only its remediation, contracts, PM planning, read-only UI, fixtures, and deterministic tests. Do not create a production CodeG Work Task or model session.
3. Keep installed Hermes and CodeG copies read-only. Make upstream changes only in clean isolated worktrees and commit them separately from AgentDash.
4. Never write directly to Hermes or CodeG databases from AgentDash. Use supported authenticated operations whose concurrency and replay behavior have passing proofs.
5. Treat PM output as untrusted data. The controller recomputes policy, route eligibility, graph completeness, budgets, authority, and every lifecycle mutation.
6. Persist the card, TaskSpec, complete mandate, route-evidence snapshot, activation receipt, action authority redemption, command headroom, and launch intent before an external mutation.
7. Treat task, run, Work Task, conversation, connection, harness-session, command, and receipt identifiers as separate opaque identities.
8. Render only original CodeG/ACP activity. Work Task lifecycle events alone are not a worker transcript.
9. Never repeat an ambiguous mutating call. Reconcile by the stable command key and exact bound state until a numeric deadline; then terminate as `inconsistent` and quarantine unresolved external activity.
10. Bind AgentDash and candidate Hermes/CodeG services to `127.0.0.1`. Keep credentials server-side, validate Origin/Host/CSRF, validate real workspace paths, and redact secrets from prompts, events, receipts, and evidence.
11. `Needs you` is reserved for an active typed `CEOInputRequestV1`. Technical ambiguity, exhausted limits, and reconciliation expiry go to `Stopped` with a truthful terminal outcome.
12. A task reaches `done` only after original action receipts, a valid path-specific verification receipt, an exact finalization receipt, and an aggregate receipt are durable in Hermes.

## Current evidence and hard gates

Planning-time inspection establishes the following baseline. Re-run every proof against the exact binaries and commits selected during implementation; these observations are not permission to dispatch.

| Boundary | Current evidence | Required proof before dispatch |
| --- | --- | --- |
| AgentDash | Next 14 app; scripts use port 3007 but do not force loopback; no Mission Control code or test stack | Loopback bind, one controller owner, authenticated CEO-command boundary, durable outbox recovery |
| Hermes installed copy | `v0.19.1`, repo `87bc7106`, heavily user-modified | Clean build; lifetime-unique task ensure including archives; digest-CAS artifacts; external action-run/event/CAS operations; zero-execution PM profile |
| CodeG installed copy | `v0.22.2`, listens on `0.0.0.0:3080`, no source checkout | Clean compatible `v0.23.0+` build on loopback; unique command-key ensure; definitive lookup; cursor replay; exact cancel; runtime/cost facts; exact identity/native URI |
| CodeG `v0.23.0` source | Work Task create/start/cancel/merge and task events exist; no external key, ensure, runtime ceiling, transcript cursor, or restart-safe finalization guarantee | Narrow extension and behavior tests; no assumption that current endpoints are sufficient |
| Route inventory | 21 requested entries: 15 fully specified candidates, five incomplete Ollama Cloud templates, one disabled item | Current level-5 proof for each exact route/task-class pair used by a mandate |
| Finalization | CodeG merge is asynchronous and not artifact/post-state bound | Deterministic no-change or fast-forward Git finalizer with command idempotency, CAS, exact mutation digest, expected post-state, and lookup |

Dispatch promotion is a conjunction: all proofs needed by the selected path must pass. One unavailable inventory entry does not block an otherwise proven exact route/task-class pair.

## Repository and worktree map

| Name | Execution path | Rule |
| --- | --- | --- |
| AgentDash | `C:\Users\kruil\Documents\Projects\AgentDash` | Main product work; one focused commit per task |
| Hermes installed copy | `C:\Users\kruil\AppData\Local\hermes\hermes-agent` | Read-only; never clean, reset, or edit |
| Hermes bridge worktree | `C:\Users\kruil\Documents\Projects\.worktrees\hermes-agentdash-bridge` | Create from reviewed clean upstream commit; separate venv and commits |
| CodeG installed binaries | `C:\Users\kruil\AppData\Local\codeg` | Read-only; never replace in place |
| CodeG bridge worktree | `C:\Users\kruil\Documents\Projects\.worktrees\codeg-agentdash-bridge` | Create from reviewed `v0.23.0+` source; separate Rust/TypeScript commits |
| AgentBrain | `C:\Users\kruil\Documents\Projects\AgentBrain` | Read reviewed `pages/` through the approved recall boundary; no automatic durable writes |
| Generated proof evidence | configured `AGENTDASH_STATE_DIR\evidence` | Machine-local, redacted, digest-addressed, not committed |
| Controller recovery outbox | configured `AGENTDASH_STATE_DIR\outbox` | Machine-local immutable envelopes; not a second task database |

## Locked implementation contracts

Implement all schemas as strict Zod objects and export inferred TypeScript types. Canonical JSON uses sorted keys and SHA-256 digests. Unknown fields, non-canonical digests, stale revisions, and identifier substitution fail closed.

### Contract modules

| Module | Required exports |
| --- | --- |
| `src/lib/mission-control/contracts/common.ts` | opaque id schemas, canonical digest, `BudgetV1`, `WorkspacePolicyV1`, `ReconciliationDeadlinesV1` |
| `contracts/routes.ts` | `ExactRouteV1`, `RouteEvidenceV1`, `RouteEvaluationPolicyV1`, task-class enum, proof status |
| `contracts/task.ts` | `TaskSpecV1`, phase-specific route plan, acceptance/prohibition fields, immutable revision/digest |
| `contracts/mandate.ts` | `ExecutionMandateV1`, finite action nodes, typed outcome edges, visit caps, task-level reserves, path proof |
| `contracts/authority.ts` | `CEOCommandV1`, `ApprovalGrantV1`, `AutoActivationReceiptV1`, `ActionAuthorityV1`, `ActionCommandV1`, `CEOInputRequestV1` |
| `contracts/outcomes.ts` | `ActionOutcomeV1`, `TaskOutcomeV1`, deterministic evidence precedence |
| `contracts/finalization.ts` | `FinalizationCommandV1`, exact mutation manifest, expected post-state/postcondition, preflight/apply/lookup results |
| `contracts/receipts.ts` | `ActionReceiptV1`, `VerificationReceiptV1`, `FinalizationReceiptV1`, `AggregateReceiptV1`, and `ReconciliationReceiptV1` |
| `contracts/proposals.ts` | conversational `ManagementProposalV1`; no authority-bearing fields |

`ActionOutcomeV1` is exactly: `succeeded`, `transient_infrastructure`, `semantic_failure`, `verification_failure`, `policy_violation`, `cancelled`, `timed_out`, `budget_exhausted`, `route_unavailable`, `ceo_input_required`, or `ambiguous`.

`ActionCommandV1.state` is exactly: `prepared`, `submitted`, `unknown`, `found`, `terminal`, or `revoked`. Its stable idempotency key names one logical command across transport attempts. Task-level verification, finalization, cancellation, and reconciliation reserves are held once for the active mandate; a command adds only its own worst-case headroom. Before submission, `aggregate_limit - observed_spend - held_task_reserves - active_command_headroom` must remain nonnegative. Definitive command completion may release its unused headroom, and proven-unsubmitted revocation may do the same; observed spend is never refunded and task-level reserves remain until their phase completes or the mandate terminates.

The initial reconciliation defaults are explicit mandate values, not hidden polling behavior:

| Deadline | Default maximum | Maximum observations |
| --- | ---: | ---: |
| Dispatch lookup | 60 seconds | 6 |
| Cancel confirmation | 60 seconds | 6 |
| Orphan/binding recovery | 120 seconds | 12 |
| Finalization reconciliation | 60 seconds | 6 |
| Receipt/event delivery | 120 seconds | 12 |

### Server ports

```ts
export interface PersistIntakeInput {
  request_id: string;
  proposal_digest: string;
  task_spec: TaskSpecV1;
  mandate: ExecutionMandateV1;
  route_snapshot: RouteEvidenceV1[];
  activation: { kind: "auto"; receipt: AutoActivationReceiptV1 }
    | { kind: "approval_required"; request: CEOInputRequestV1 };
}

export interface PersistIntakeResult {
  task_id: string;
  created: boolean;
  task_spec_digest: string;
  mandate_digest: string;
}

export type EnsureArtifactInput = {
  task_id: string; artifact_key: string; kind: string; digest: string; payload: unknown;
};
export type EnsureArtifactResult = { artifact_id: string; created: boolean; digest: string };
export type ActivateMandateInput = {
  task_id: string; task_spec_digest: string; mandate_digest: string;
  activation: ApprovalGrantV1 | AutoActivationReceiptV1;
};
export type PrepareActionInput = {
  task_id: string; authority: ActionAuthorityV1; command: ActionCommandV1;
  command_headroom: BudgetV1; task_reserve_refs: string[]; launch_intent_digest: string;
};
export type PreparedActionResult = { run_id: string; command: ActionCommandV1; created: boolean };
export type BindWorkerSessionInput = { task_id: string; run_id: string; command_id: string; binding: CodeGBindingV1 };
export type AppendRunEventInput = { task_id: string; run_id: string; event_id: string; digest: string; payload: unknown };
export type CloseActionInput = { task_id: string; run_id: string; outcome: ActionOutcomeV1; receipt_digest: string };
export type SetCEOInputInput = { task_id: string; request: CEOInputRequestV1 | null; expected_revision: number };
export type TerminalIntentInput = { task_id: string; outcome: TaskOutcomeV1; receipt_digest: string; expected_nonterminal: true };

export interface HermesPort {
  persistIntake(input: PersistIntakeInput): Promise<PersistIntakeResult>;
  ensureArtifact(input: EnsureArtifactInput): Promise<EnsureArtifactResult>;
  activateMandate(input: ActivateMandateInput): Promise<void>;
  prepareAction(input: PrepareActionInput): Promise<PreparedActionResult>;
  bindWorkerSession(input: BindWorkerSessionInput): Promise<void>;
  appendRunEvent(input: AppendRunEventInput): Promise<void>;
  closeAction(input: CloseActionInput): Promise<void>;
  setCEOInput(input: SetCEOInputInput): Promise<void>;
  commitTerminalIntent(input: TerminalIntentInput): Promise<void>;
  projectBoard(): Promise<MissionControlBoardV1>;
}

export interface CodeGPort {
  ensureWork(command: ActionCommandV1): Promise<CodeGEnsureResult>;
  lookupByCommandKey(key: string): Promise<CodeGLookupResult>;
  getSnapshot(binding: CodeGBindingV1): Promise<CodeGSnapshotV1>;
  activityAfter(binding: CodeGBindingV1, cursor: string | null): AsyncIterable<CodeGActivityV1>;
  cancelExact(binding: CodeGBindingV1, reason: string): Promise<CodeGCancelResult>;
  nativeSessionUri(binding: CodeGBindingV1): Promise<string | null>;
}

export type CodeGBindingV1 = {
  work_task_id: string; run_sequence: string; conversation_id: string;
  connection_id: string | null; harness_session_id: string | null; folder_id: string;
};
export type CodeGEnsureResult = { status: "created" | "found" | "unknown"; binding: CodeGBindingV1 | null };
export type CodeGLookupResult = { status: "found"; binding: CodeGBindingV1 }
  | { status: "not_found" } | { status: "unknown"; reason: string };
export type CodeGSnapshotV1 = { binding: CodeGBindingV1; terminal: boolean; source_commit: string | null; source_tree: string | null; raw: unknown };
export type CodeGActivityV1 = { cursor: string; source_timestamp: string; kind: string; payload: unknown };
export type CodeGCancelResult = { status: "confirmed" | "not_active" | "unknown"; binding: CodeGBindingV1 };
export type CodeGWorkspaceBindingV1 = { project_id: string; requested_root: string; real_root: string; folder_id: string };
export type MissionControlBoardV1 = {
  generated_at: string;
  lanes: { ready: unknown[]; working: unknown[]; needs_you: unknown[]; stopped: unknown[]; completed: unknown[] };
  archived_count: number;
  unavailable_reason: string | null;
};

export interface FinalizationPort {
  preflight(command: FinalizationCommandV1): Promise<FinalizationPreflightV1>;
  apply(command: FinalizationCommandV1): Promise<FinalizationApplyResultV1>;
  lookup(command: FinalizationCommandV1): Promise<FinalizationLookupResultV1>;
}

export type FinalizationPreflightV1 = { status: "ready" | "drifted" | "rejected"; observed_digest: string };
export type FinalizationApplyResultV1 = { status: "applied" | "rejected" | "unknown"; operation_id: string };
export type FinalizationLookupResultV1 = { status: "applied" | "not_applied" | "unknown"; post_state_digest: string | null };

export type ReviewedRecallV1 = { page_id: string; page_digest: string; excerpt: string; reviewed_at: string };
export type AdapterResultEnvelopeV1 = {
  envelope_id: string; command_id: string; adapter: string; result_digest: string;
  redacted_result: unknown; observed_at: string;
};
export type ActivationDecisionV1 = { kind: "auto"; receipt: AutoActivationReceiptV1 }
  | { kind: "approval_required"; request: CEOInputRequestV1 };
export interface ActivationPolicyPort {
  decide(task: TaskSpecV1, mandate: ExecutionMandateV1, routes: RouteEvidenceV1[]): Promise<ActivationDecisionV1>;
}
export interface AgentBrainPort { recallReviewed(query: string, project_id: string): Promise<ReviewedRecallV1[]>; }
export interface RouteRegistryPort { requireLevel5(route_id: string, task_class: string, at: string): Promise<RouteEvidenceV1>; }
export interface RecoveryOutboxPort {
  journal(result: AdapterResultEnvelopeV1): Promise<void>;
  pending(): Promise<AdapterResultEnvelopeV1[]>;
  markDelivered(envelope_id: string, hermes_event_id: string): Promise<void>;
}
```

CodeG is never the universal finalization authority. The MVP supports only canonical no-change close and validated local Git fast-forward. Any broader merge, deployment, publication, message, payment, or external mutation requires a later typed TaskSpec revision and adapter-specific design.

The CEO board projection is also locked: Hermes `triage`, `todo`, `scheduled`, and `ready` map to Ready; `running` maps to Working; `blocked` or `review` maps to Needs you only while an active typed CEO-input request exists; terminal `blocked` with no CEO request maps to Stopped; `done` maps to Completed; and `archived` is hidden by default. Between actions, a task remains Working only when its next authorized action or reconciliation is durably scheduled.

## Task 1: Capture the capability baseline and permanent NO-GO gate

**Files:**

- Create: `.env.example`
- Create: `config/mission-control-gates.json`
- Create: `scripts/mission-control/probe-agentdash.mjs`
- Create: `scripts/mission-control/probe-hermes.mjs`
- Create: `scripts/mission-control/probe-codeg.mjs`
- Create: `scripts/mission-control/probe-pm-profile.mjs`
- Create: `scripts/mission-control/write-gate-manifest.mjs`
- Create: `scripts/mission-control/probe-utils.mjs`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:** `ProbeResultV1` is `{ gate_id, status, facts, reasons, source_digest, observed_at, expires_at }`; `GateManifestV1` is the canonical signed collection consumed by health and promotion. Probe functions are read-only and return data rather than changing configuration.

```js
assert.equal(buildManifest([missingHermesProof]).dispatch.status, "no_go");
assert.match(buildManifest([missingHermesProof]).dispatch.reasons[0], /hermes/i);
```

- [ ] Write fixture-driven Node tests inside `scripts/mission-control/__tests__/` proving a missing capability, non-loopback listener, stale source commit, unredacted token, or malformed evidence makes the aggregate gate `no_go`.
- [ ] Run `node --test scripts/mission-control/__tests__/*.test.mjs`; confirm failure because the probes do not exist.
- [ ] Implement read-only probes. Record binary path, version/commit, SHA-256, listener address, feature facts, timestamp, expiry, and redacted diagnostics. Never mutate installed copies.
- [ ] Encode the ten gates from “Proof matrix and stop conditions.” The initial real manifest must truthfully report NO-GO for Hermes atomic identity, CodeG command replay/runtime/activity, PM isolation, and finalization.
- [ ] Add `npm run mission-control:probe`; write generated evidence only beneath `AGENTDASH_STATE_DIR`.
- [ ] Run `node --test scripts/mission-control/__tests__/*.test.mjs` and `npm run mission-control:probe`; verify tests pass and the real command exits non-zero with a readable NO-GO report.
- [ ] Commit: `git add .env.example .gitignore package.json config scripts/mission-control && git commit -m "chore: add mission control capability gates"`.

## Task 2: Add the test foundation and local security boundary

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `quality-gate.json`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `playwright.config.ts`
- Create: `src/server/mission-control/security/local-origin.ts`
- Create: `src/server/mission-control/security/local-origin.test.ts`
- Create: `src/server/mission-control/security/command-session.ts`
- Create: `src/server/mission-control/security/command-session.test.ts`
- Create: `src/server/mission-control/security/nonce-store.ts`
- Create: `src/server/mission-control/security/nonce-store.test.ts`

**Interfaces:** `CommandSessionV1` binds a random session id, CSRF digest, issued/expiry times, and HttpOnly cookie signature. `NonceStore.consume({ session_id, nonce, expires_at })` atomically returns `consumed`, `replayed`, or `expired` using `AGENTDASH_STATE_DIR\security`; only `consumed` may authenticate a CEO command.

```ts
await expect(nonces.consume(input)).resolves.toBe("consumed");
await expect(nonces.consume(input)).resolves.toBe("replayed");
```

- [ ] Install Zod, Vitest, jsdom, Testing Library, user-event, and Playwright test dependencies. Add `test`, `test:unit`, `test:live`, and `test:e2e` scripts; keep live tests opt-in.
- [ ] Write failing tests for non-loopback Host, foreign Origin, missing SameSite session cookie, missing/mismatched CSRF header, replayed nonce, expired nonce, and output containing seeded secret values.
- [ ] Run `npm run test:unit -- local-origin command-session`; confirm failure because the security modules are missing.
- [ ] Implement exact `127.0.0.1:3007` Host/Origin validation, a server-generated HttpOnly `SameSite=Strict` command session, a session-bound CSRF value, single-use persisted nonce consumption, bounded TTL, and constant-time digest comparison. Use atomic exclusive nonce-consumption records so replay protection survives restart and multiple server workers.
- [ ] Change `dev` and `start` scripts to pass `-H 127.0.0.1 -p 3007`. Do not accept `localhost`, wildcard, LAN, or forwarded-host authority in the MVP.
- [ ] Add unit tests to `quality-gate.json`; run `npm run test:unit`, `npm run lint`, `npm run typecheck`, and `npm run build`.
- [ ] Commit: `git add package.json package-lock.json quality-gate.json vitest.config.ts vitest.setup.ts playwright.config.ts src/server/mission-control/security && git commit -m "test: establish mission control safety boundary"`.

## Task 3: Implement strict contracts, digests, and adapter ports

**Files:**

- Create: `src/lib/mission-control/contracts/common.ts`
- Create: `src/lib/mission-control/contracts/routes.ts`
- Create: `src/lib/mission-control/contracts/task.ts`
- Create: `src/lib/mission-control/contracts/mandate.ts`
- Create: `src/lib/mission-control/contracts/authority.ts`
- Create: `src/lib/mission-control/contracts/outcomes.ts`
- Create: `src/lib/mission-control/contracts/finalization.ts`
- Create: `src/lib/mission-control/contracts/receipts.ts`
- Create: `src/lib/mission-control/contracts/proposals.ts`
- Create: `src/lib/mission-control/contracts/index.ts`
- Create: `src/lib/mission-control/contracts/contracts.test.ts`
- Create: `src/server/mission-control/ports.ts`

**Interfaces:** This task owns every schema and DTO shown in “Locked implementation contracts.” All downstream tasks import from `contracts/index.ts` and `ports.ts`; none redeclare or structurally widen these types.

```ts
expect(() => ExecutionMandateV1Schema.parse({ ...validMandate, extra: true })).toThrow();
expect(canonicalDigest({ b: 2, a: 1 })).toBe(canonicalDigest({ a: 1, b: 2 }));
```

- [ ] Write table-driven failing tests for every strict schema, every outcome value, phase-specific routes, finite-node references, action-command states, exact identity separation, and rejection of unknown fields.
- [ ] Add golden canonical-JSON vectors proving key-order-independent digests and one-field mutation digest changes.
- [ ] Run `npm run test:unit -- contracts`; confirm failure.
- [ ] Implement the modules listed in “Locked implementation contracts.” Keep PM proposals free of authenticated command, approval, authority, and adapter-call fields.
- [ ] Add compile-time port fakes that satisfy `HermesPort`, `CodeGPort`, `FinalizationPort`, `ActivationPolicyPort`, `AgentBrainPort`, `RouteRegistryPort`, and `RecoveryOutboxPort` without importing concrete adapters.
- [ ] Run `npm run test:unit -- contracts` and `npm run typecheck`.
- [ ] Commit: `git add src/lib/mission-control src/server/mission-control/ports.ts && git commit -m "feat: define mission control contracts and ports"`.

## Task 4: Build the read-only Direction A workspace

**Files:**

- Create from current root: `src/app/overview/page.tsx`
- Replace: `src/app/page.tsx`
- Modify: `src/components/AppShell.tsx`
- Create: `src/components/mission-control/MissionControlShell.tsx`
- Create: `src/components/mission-control/PMPanel.tsx`
- Create: `src/components/mission-control/WorkBoard.tsx`
- Create: `src/components/mission-control/TaskCard.tsx`
- Create: `src/components/mission-control/AttemptInspector.tsx`
- Create: `src/components/mission-control/mission-control.test.tsx`
- Create: `src/app/api/mission-control/board/route.ts`
- Create: `src/server/mission-control/read-model.ts`
- Create: `src/server/mission-control/read-model.test.ts`

**Interfaces:** `buildBoardProjection(source: HermesBoardSnapshotV1, outbox: OutboxOverlayV1): MissionControlBoardV1` is pure. `GET /api/mission-control/board` returns that strict schema plus an unavailable reason; it exposes no mutation control.

```tsx
render(<MissionControlShell board={fixtureWithTypedCEOInput} />);
expect(screen.getByRole("region", { name: "Needs you" })).toHaveTextContent("Choose target environment");
```

- [ ] Write failing UI tests asserting the five projections `ready`, `working`, `needs_you`, `stopped`, and `completed`; selecting a card must visibly update the right pane.
- [ ] Prove `needs_you` requires an active typed CEO-input request, `completed` requires task success, and a reconciliation-pending overlay remains in `stopped`.
- [ ] Run `npm run test:unit -- mission-control read-model`; confirm failure.
- [ ] Move the existing overview content to `/overview`, make `/` Mission Control, and update `AppShell` navigation without changing the existing OpenCode, Hermes, Agent Fleet, or legacy routes.
- [ ] Build the three-column layout from existing `ChatShell`, `MessageBubble`, and `ui.tsx` primitives. At this slice, chat and commands are visibly disabled and the board is read-only.
- [ ] Inject `HermesPort` into the read model. Use board fixtures only in tests/story data; when the real bridge is unavailable, production shows a truthful unavailable/empty state and never fabricated cards.
- [ ] Add responsive and keyboard-selection tests; run `npm run test:unit -- mission-control read-model`, `npm run lint`, and `npm run typecheck`.
- [ ] Commit: `git add src/app src/components src/server/mission-control/read-model* && git commit -m "feat: add read-only CEO mission control"`.

## Task 5: Isolate the Hermes PM and accept structured proposals

**Files:**

- Create: `src/server/hermes/command.ts`
- Create: `src/server/hermes/command.test.ts`
- Modify: `src/server/hermes/cli.ts`
- Create: `src/server/hermes/pm-environment.ts`
- Create: `src/server/hermes/pm-environment.test.ts`
- Create: `src/server/hermes/pm.ts`
- Create: `src/server/hermes/pm.test.ts`
- Create: `src/server/hermes/pm.live.test.ts`
- Create: `src/server/mission-control/pm-prompt.ts`
- Create: `src/server/mission-control/pm-prompt.test.ts`
- Create: `src/app/api/mission-control/chat/route.ts`
- Create: `docs/operations/luisos-pm-profile.md`

**Interfaces:** `PMTurnInputV1` contains conversational history, reviewed recall, and read-only capability facts. `PMTurnOutputV1` is `{ text, session_ref, proposal: ManagementProposalV1 }`. The chat route returns this output and passes executable proposals to the intake controller; it cannot accept adapter commands.

```ts
expect(profile.tools).not.toEqual(expect.arrayContaining(["shell", "files", "browser", "delegate"]));
expect((await pm.turn(executableRequest)).proposal.intent).toBe("create_task");
```

- [ ] Write failing runner tests for relative paths, `.cmd`/`.bat`, shell metacharacters, timeout, output cap, abort, inherited forbidden environment keys, and secret redaction.
- [ ] Run `npm run test:unit -- command`; confirm failure because the hardened runner does not exist.
- [ ] Implement `command.ts` with an allowlisted absolute executable, argument array, `shell: false`, explicit environment, bounded output, timeout, and redacted errors. Refactor existing non-PTY Hermes CLI callers to use it without changing their public results; leave `pty.ts` untouched.
- [ ] Write failing PM tests proving `conversation_only` creates no card and executable requests return conversational text plus strict `ManagementProposalV1` data.
- [ ] Run `npm run test:unit -- pm-environment pm-prompt pm`; confirm failure before adding the PM adapter and profile.
- [ ] Configure the dedicated `luisos-pm` profile with preferred candidate inference `gpt-5.6-terra` and candidate fallback `claude-sonnet-5`. Neither is active until its PM-specific level-5 proof passes.
- [ ] Construct the PM environment by allowlist. Exclude CodeG tokens, controller command secrets, workspace credentials, browser/computer/file/shell/research/delegation tools, and mutation-capable memory.
- [ ] Add opt-in live containment probes that ask the PM to write a file, run a command, browse, research, and delegate while CodeG is unavailable; require zero side effects and management proposals only.
- [ ] Run `npm run test:unit -- command pm-environment pm-prompt pm` and the mocked API test. Keep the real PM gate NO-GO until `npm run test:live -- pm.live` passes in the isolated profile.
- [ ] Commit: `git add src/server/hermes src/server/mission-control/pm-prompt* src/app/api/mission-control/chat docs/operations/luisos-pm-profile.md && git commit -m "feat: isolate the Hermes project manager"`.

## Task 6: Persist intake, validate finite mandates, and authenticate activation

**Files:**

- Create: `src/server/mission-control/mandate/graph.ts`
- Create: `src/server/mission-control/mandate/graph.test.ts`
- Create: `src/server/mission-control/mandate/budget-proof.ts`
- Create: `src/server/mission-control/mandate/budget-proof.test.ts`
- Create: `src/server/mission-control/mandate/no-start.ts`
- Create: `src/server/mission-control/mandate/no-start.test.ts`
- Create: `src/server/mission-control/authority/ceo-command.ts`
- Create: `src/server/mission-control/authority/ceo-command.test.ts`
- Create: `src/lib/mission-control/request-id.ts`
- Create: `src/lib/mission-control/request-id.test.ts`
- Create: `src/server/mission-control/intake/intake.ts`
- Create: `src/server/mission-control/intake/intake.test.ts`
- Modify: `src/components/mission-control/PMPanel.tsx`
- Modify: `src/app/api/mission-control/chat/route.ts`
- Create: `src/app/api/mission-control/chat/route.test.ts`
- Create: `src/app/api/mission-control/commands/route.ts`
- Create: `src/app/api/mission-control/commands/route.test.ts`

**Interfaces:** The AgentDash PM panel assigns one UUID `request_id` when the user submits a message and retains it across HTTP retry until acknowledged. `POST /api/mission-control/chat` is `{ request_id, message }`. `IntakeController.handle({ request_id, message, pm_output })` validates the proposal, constructs and digests TaskSpec/mandate/route snapshot, runs no-start, then calls `HermesPort.persistIntake` exactly once. It returns `conversation_only`, `card_created`, or `card_existing`. `ActivationPolicyPort.decide` is injected; production returns approval-required until Task 17 installs the proven auto policy.

```ts
const [a, b] = await Promise.all([intake.handle(sameRequest), intake.handle(sameRequest)]);
expect(new Set([a.task_id, b.task_id]).size).toBe(1);
expect(codeg.ensureWork).not.toHaveBeenCalled();
```

- [ ] Write failing graph tests for missing outcome edges, dangling nodes, unreachable nodes, unbounded cycles, exceeded visit caps, open-ended remediation, missing verification/finalization, and success paths with no exact terminal action.
- [ ] Write failing budget tests that enumerate all paths through visit caps and reject any whose worst-case action headroom plus one-time task reserves exceeds aggregate cost, time, or attempts.
- [ ] Write failing CEO-command tests for foreign Origin, PM-authored “approved” text, replayed nonce, stale displayed TaskSpec revision/digest, wrong mandate digest, expired command, and a second activation of the same mandate.
- [ ] Write failing intake tests for invalid PM output, conversation-only messages, duplicate/concurrent request ids, digest mismatch on reuse, auto receipt, typed `initial_mandate_approval`, crash/retry between each persistence boundary, and zero CodeG calls.
- [ ] Run `npm run test:unit -- graph budget-proof no-start ceo-command intake request-id`; confirm failure.
- [ ] Implement a closed graph validator over every `ActionOutcomeV1`, a path-specific verifier proof for every success-capable path, current route proof checks, enforceable ceilings, and exact finalization preconditions.
- [ ] Implement the stable intake sequence: assign/retain `request_id` in the AgentDash PM panel before PM inference, validate it server-side, validate `ManagementProposalV1`, construct TaskSpec/mandate/route evidence, run no-start, and atomically persist the lifetime card plus immutable artifacts and either an auto activation receipt or typed `initial_mandate_approval` request. A reused request id with different content fails closed.
- [ ] Implement `CEOCommandV1` creation only inside the authenticated route. One `initial_mandate_approval` creates one immutable `ApprovalGrantV1` and calls `activateMandate` for the bound digests. Neither approval nor auto activation grants per-attempt authority directly.
- [ ] Return typed, visible no-start reasons without creating CodeG work. Run the focused tests and `npm run typecheck`.
- [ ] Commit: `git add src/lib/mission-control/request-id* src/server/mission-control/mandate src/server/mission-control/authority src/server/mission-control/intake src/components/mission-control/PMPanel.tsx src/app/api/mission-control/chat src/app/api/mission-control/commands && git commit -m "feat: persist intake and activate finite mandates"`.

## Task 7: Add atomic external-controller operations to clean Hermes

**Worktree:** `C:\Users\kruil\Documents\Projects\.worktrees\hermes-agentdash-bridge`

**Files in the Hermes worktree:**

- Modify: `hermes_cli/kanban_db.py`
- Modify: `hermes_cli/kanban.py`
- Modify: `tests/hermes_cli/test_kanban_db.py`
- Modify: `tests/hermes_cli/test_kanban_cli.py`
- Modify: `tests/plugins/test_kanban_attachments.py`
- Modify: `tests/plugins/test_kanban_worker_runs.py`
- Modify: `website/docs/user-guide/features/kanban.md`

**Interfaces:** The supported JSON bridge exposes `intake-persist`, `artifact-ensure`, `mandate-activate`, `action-prepare`, `run-bind`, `run-event`, `run-close`, `ceo-input-set`, and `terminal-intent`. `intake-persist` is one database transaction over lifetime request identity, TaskSpec, mandate, route snapshot, and initial activation/request artifact.

```py
results = concurrently(lambda: db.persist_intake(same_request), count=8)
assert len({result.task_id for result in results}) == 1
assert db.count_artifact_set(result.task_id, intake_digest) == 1
```

- [ ] Create the clean worktree from a reviewed upstream commit and record the source commit in gate evidence. Do not copy changes from the installed dirty checkout.
- [ ] Add failing concurrency tests: eight creators with one request id must return one lifetime task even after archive; same artifact key/digest must be idempotent; mismatched digest must fail; one action authority must create one logical command and one external run.
- [ ] Add crash/race tests around authority redemption, command preparation, per-command headroom, task-reserve references, launch intent, session binding, event append, close, CEO-input state, and terminal intent CAS.
- [ ] Run the focused Pytest suite and confirm the new tests fail against upstream.
- [ ] Implement transactional supported CLI/DB operations for `intake-persist`, `artifact-ensure`, `mandate-activate`, `action-prepare`, `run-bind`, `run-event`, `run-close`, `ceo-input-set`, and `terminal-intent`. Every operation returns strict JSON; do not parse human text in AgentDash.
- [ ] Add a migration/preflight that detects existing duplicate idempotency keys before adding the uniqueness guarantee; fail with recovery instructions instead of silently choosing a task.
- [ ] Prove archives retain request identity and external-controller operations never invoke Hermes's own worker dispatcher.
- [ ] Run `python -m pytest tests/hermes_cli/test_kanban_db.py tests/hermes_cli/test_kanban_cli.py tests/plugins/test_kanban_attachments.py tests/plugins/test_kanban_worker_runs.py -q`.
- [ ] Commit in the Hermes worktree: `git add hermes_cli tests website/docs/user-guide/features/kanban.md && git commit -m "feat: add atomic external controller bridge"`.

## Task 8: Add replay-safe Work Task operations to clean CodeG

**Worktree:** `C:\Users\kruil\Documents\Projects\.worktrees\codeg-agentdash-bridge`

**Files in the CodeG worktree:**

- Create: `src-tauri/src/db/migration/m20260803_000004_work_task_external_key.rs`
- Modify: `src-tauri/src/db/migration/mod.rs`
- Modify: `src-tauri/src/db/entities/work_task.rs`
- Modify: `src-tauri/src/models/work_task.rs`
- Modify: `src-tauri/src/db/service/work_task_service.rs`
- Modify: `src-tauri/src/commands/work_task.rs`
- Modify: `src-tauri/src/web/handlers/work_task.rs`
- Modify: `src-tauri/src/web/router.rs`
- Modify: `src-tauri/src/work_task/engine.rs`
- Modify: `src/lib/types.ts`

**Interfaces:** Authenticated bridge operations are `ensure_external`, `lookup_external`, `snapshot_exact`, `activity_after`, `cancel_exact`, and `native_session`. `external_key` is the ActionCommand idempotency key; lookup returns only `found`, authoritative `not_found`, or transport-level `unknown`.

```rust
let results = join_all((0..8).map(|_| service.ensure_external(input.clone()))).await;
assert_eq!(results.iter().map(|r| r.task_id).collect::<HashSet<_>>().len(), 1);
assert_eq!(service.lookup_external(&key).await?, Lookup::Found(results[0].binding()));
```

- [ ] Create the clean worktree from reviewed `v0.23.0+` source and record the exact commit. Configure the candidate server for bearer auth, exact Origin allowlist, and `127.0.0.1` only.
- [ ] Add failing Rust tests for atomic unique `external_key`, duplicate immutable-input mismatch, archived lookup, authoritative `found`/`not_found`, timeout-after-create, and concurrent ensure.
- [ ] Add failing tests for a separate opaque Work Task id, run sequence, conversation id, connection id, harness-session id, native URI, and validated folder id/real path.
- [ ] Add failing activity tests proving original ACP/model/tool/file/check events have a monotonic resumable cursor. Do not treat `work_task_events` as the transcript.
- [ ] Add failing watchdog/cancel tests for engine runtime ceiling, usage/cost facts, exact generation-aware cancellation, cancellation latency, restart, and absence of a second Work Task after an ambiguous ensure.
- [ ] Run the focused Rust and TypeScript bridge tests; confirm the new ensure, cursor, watchdog, and identity cases fail against the clean upstream baseline.
- [ ] Implement narrow authenticated endpoints for ensure, lookup by external key, exact snapshot, cursor activity, exact cancel, and native-session resolution. Preserve existing APIs and bearer middleware.
- [ ] Keep successful worker output in a reviewable isolated worktree with source commit/tree and changed-file facts. Do not auto-merge; finalization belongs to AgentDash's deterministic finalizer.
- [ ] Run focused `cargo test` and frontend type checks from the CodeG worktree, then its full repository gate.
- [ ] Commit in the CodeG worktree: `git add src-tauri/src src/lib/types.ts && git commit -m "feat: add replay-safe external work task bridge"`.

## Task 9: Implement hardened Hermes, CodeG, workspace, and AgentBrain adapters

**Files:**

- Create: `src/server/hermes/kanban-adapter.ts`
- Create: `src/server/hermes/kanban-adapter.contract.test.ts`
- Create: `src/server/codeg/client.ts`
- Create: `src/server/codeg/client.contract.test.ts`
- Create: `src/server/codeg/schemas.ts`
- Create: `src/server/agentbrain/recall.ts`
- Create: `src/server/agentbrain/recall.test.ts`
- Create: `src/server/mission-control/workspaces/registry.ts`
- Create: `src/server/mission-control/workspaces/registry.test.ts`
- Create: `config/mission-control-projects.json`

**Interfaces:** `HermesKanbanAdapter implements HermesPort`, `CodeGClient implements CodeGPort`, `ReviewedAgentBrain implements AgentBrainPort`, and `WorkspaceRegistry.resolve(project_id, requested_root): Promise<CodeGWorkspaceBindingV1>`. Concrete adapters return strict port DTOs and never leak transport response shapes.

```ts
await expect(codeg.ensureWork(commandWithDroppedResponse)).resolves.toEqual({ status: "unknown", binding: null });
await expect(workspaces.resolve("agentdash", junctionEscape)).rejects.toThrow(/real path/i);
```

- [ ] Write contract tests against fakes for atomic Hermes ensure/artifacts/action preparation and CodeG ensure/lookup/activity/cancel. Explicitly test timeout mapping to `unknown`, never to a retryable absence.
- [ ] Write path tests for symlinks/junctions, case normalization, missing/duplicate CodeG folders, stale folder ids, UNC paths, non-allowlisted roots, and workspace changes between approval and submission.
- [ ] Run `npm run test:unit -- kanban-adapter client.contract registry recall`; confirm failure.
- [ ] Implement the Hermes adapter through the strict JSON bridge and the existing shell-free runner. Implement the CodeG client with `server-only`, loopback URL validation, bearer auth, Origin, timeout, response caps, strict schemas, and secret-redacted errors.
- [ ] Require real-path equality between validated project root and CodeG folder immediately before every mutating call. Preserve each returned identity independently.
- [ ] Implement AgentBrain recall as read-only reviewed-page retrieval. Reject state, raw, dream, retired stores, writes, and transcript substitution.
- [ ] Run focused unit/contract tests against disposable local services. Keep production dispatch disabled if either candidate bridge is absent or its commit differs from gate evidence; the qualification runner is likewise denied until both exact candidate bridge proofs pass.
- [ ] Commit: `git add src/server/hermes/kanban-adapter* src/server/codeg src/server/agentbrain src/server/mission-control/workspaces config/mission-control-projects.json && git commit -m "feat: add mission control adapters"`.

## Task 10: Build the route inventory, evaluator, and production registry

**Files:**

- Create: `config/mission-control-route-inventory.json`
- Create: `config/route-evaluation-policy.json`
- Create: `src/server/mission-control/routes/inventory.ts`
- Create: `src/server/mission-control/routes/inventory.test.ts`
- Create: `src/server/mission-control/routes/evaluator.ts`
- Create: `src/server/mission-control/routes/evaluator.test.ts`
- Create: `src/server/mission-control/routes/registry.ts`
- Create: `src/server/mission-control/routes/registry.test.ts`
- Create: `scripts/mission-control/evaluate-route.mjs`
- Create: `src/server/mission-control/routes/qualification-runner.ts`
- Create: `src/server/mission-control/routes/qualification-runner.test.ts`
- Create: `docs/operations/route-qualification.md`

**Interfaces:** `QualificationEnvelopeV1` binds operator session, exact route tuple, task class, fixture set, disposable board/workspace, ceilings, allowed operations, issued/expiry times, and nonce. `QualificationRunner.run(envelope)` is the sole pre-promotion model path and rejects calls originating from chat/API. `RouteRegistry.requireLevel5` consumes immutable evidence only.

```ts
expect(await registry.status(level4Route, "bounded_coding")).toBe("canary_only");
await expect(qualification.run({ ...envelope, workspace: productionRoot })).rejects.toThrow(/disposable/i);
```

Seed these exact inventory groups; only the first 15 are evaluation candidates, the next five are incomplete templates, and the last is disabled:

```text
specified: codex/gpt-5.6-sol, codex/gpt-5.6-terra, codex/gpt-5.6-luna,
  opencode-go/deepseek-v4-flash, opencode-go/deepseek-v4-pro, opencode-go/glm-5.2,
  opencode-go/hy3, opencode-go/minimax-m3, opencode-go/qwen3.7-max,
  opencode-go/qwen3.7-plus, claude-code/claude-opus-5,
  claude-code/claude-sonnet-5, claude-code/claude-haiku-4-5-20251001,
  kimi-code/kimi-k3, grok-build/grok-4.5
templates: ollama-cloud/deepseek-v4-flash:cloud, ollama-cloud/deepseek-v4-pro:cloud,
  ollama-cloud/glm-5.2:cloud, ollama-cloud/minimax-m3:cloud,
  ollama-cloud/nemotron-3-ultra:cloud
disabled: ollama-cloud/hy3:cloud
```

- [ ] Seed exactly those 21 entries. Candidate roles are hypotheses, templates cannot qualify without a named outer harness, and the disabled item cannot run a canary.
- [ ] Write failing tests for exact tuple identity: outer harness + provider + exact model + agent type + mode/config digest. A provider/model pair alone must not qualify.
- [ ] Write failing policy tests for the ten task classes, level-4 canary-only status, level-5 production status, sample/fixture minimums, Wilson bounds, 100% hard safety tests, cost/runtime ceilings, provenance, 30-day expiry, config drift, and critical-failure revocation.
- [ ] Use at least 20 scored runs across five fixture shapes and 95% Wilson lower bound ≥0.70 for standard classes; use 30 and ≥0.80 for `hard_engineering` and `independent_review`.
- [ ] Run `npm run test:unit -- inventory evaluator registry`; confirm failure before implementing evidence loading or eligibility.
- [ ] Implement digest-addressed evidence loading from `AGENTDASH_STATE_DIR`. Qualification is per exact route/task-class pair; an expired proof blocks new commands without rewriting already-submitted command history.
- [ ] Add evaluator fixtures for PM Terra/Sonnet configurations separately from worker roles. Add path-specific verifier queries that can exclude every provider and outer harness in the realized mutating-route set for each success-capable path.
- [ ] Run `npm run test:unit -- inventory evaluator registry qualification-runner`, then an operator-signed harmless level-4 canary in `qualification` mode after the Task 7-9 candidate bridge gates pass. Verify the chat/API cannot invoke qualification and no entry becomes production eligible without level-5 evidence.
- [ ] Commit: `git add config/mission-control-route-inventory.json config/route-evaluation-policy.json src/server/mission-control/routes scripts/mission-control/evaluate-route.mjs docs/operations/route-qualification.md && git commit -m "feat: add evidence-gated route registry"`.

## Task 11: Implement the deterministic state machine and budget ledger

**Files:**

- Create: `src/server/mission-control/controller/state.ts`
- Create: `src/server/mission-control/controller/state.test.ts`
- Create: `src/server/mission-control/controller/classifier.ts`
- Create: `src/server/mission-control/controller/classifier.test.ts`
- Create: `src/server/mission-control/controller/ledger.ts`
- Create: `src/server/mission-control/controller/ledger.test.ts`
- Create: `src/server/mission-control/controller/next-action.ts`
- Create: `src/server/mission-control/controller/next-action.test.ts`

**Interfaces:** `classifyAction(evidence): ActionOutcomeV1`, `ledger.reserve(command)`, `ledger.settle(command, observed)`, `ledger.revokeUnsubmitted(command)`, and `nextAction(state, mandate): NextMechanismV1` are deterministic pure/domain operations over persisted inputs.

```ts
const settled = ledger.settle(reserved, { observed_cost_usd: 0.12, terminal: true });
expect(settled.observed_cost_usd).toBe(0.12);
expect(settled.held_command_headroom_usd).toBe(0);
expect(settled.held_task_reserves_usd).toBe(reserved.held_task_reserves_usd);
```

- [ ] Write transition-table tests for every action outcome, terminal first-writer-wins CAS, completion/cancel races, timeout/success precedence, and conflicting verifier/check evidence.
- [ ] Write ledger tests proving observed spend is monotonic across restart, task reserves are held once, each command adds only its own headroom, definitive command completion releases unused command headroom, and proven-unsubmitted revocation releases its unused headroom. Neither path refunds observed spend or prematurely releases task reserves.
- [ ] Write a property-style test: every reachable nonterminal state has exactly one authorized next action, a scheduled bounded reconciliation, or an active typed CEO-input request.
- [ ] Run `npm run test:unit -- state classifier ledger next-action`; confirm failure.
- [ ] Implement deterministic evidence precedence and separate `ActionOutcomeV1` from aggregate `TaskOutcomeV1`. The PM is not imported by any controller module.
- [ ] Implement graph-node visit accounting and immutable realized mutating-route accumulation. Any remediation mutation invalidates prior verification.
- [ ] Run the focused suite with fake clocks and `npm run typecheck`.
- [ ] Commit: `git add src/server/mission-control/controller && git commit -m "feat: add deterministic mission control state machine"`.

## Task 12: Build the dormant command journal, recovery outbox, and controller owner

**Files:**

- Create: `src/server/mission-control/runtime/owner-lock.ts`
- Create: `src/server/mission-control/runtime/owner-lock.test.ts`
- Create: `src/server/mission-control/runtime/outbox.ts`
- Create: `src/server/mission-control/runtime/outbox.test.ts`
- Create: `src/server/mission-control/runtime/action-command.ts`
- Create: `src/server/mission-control/runtime/action-command.test.ts`
- Create: `src/server/mission-control/runtime/controller.ts`
- Create: `src/server/mission-control/runtime/controller.test.ts`
- Create: `src/instrumentation.ts`

**Interfaces:** `ControllerOwner.acquire(): OwnerLease`, `RecoveryOutbox.journal/pending/markDelivered`, and `ActionCommandRunner.advance(command_id)` implement the port contracts. `DispatchMode` is `disabled | qualification | candidate | enabled`; normal controller intake accepts model-backed work only in `enabled`.

```ts
await runner.advance(command.id); // adapter response is lost
await runner.advance(command.id); // restart
expect(codeg.ensureWork).toHaveBeenCalledTimes(1);
expect(codeg.lookupByCommandKey).toHaveBeenCalledWith(command.idempotency_key);
```

- [ ] Write crash-point tests before/after Hermes action preparation, adapter submission, adapter response, outbox journal, and Hermes receipt delivery. Every replay must preserve one logical command and one command key.
- [ ] Write owner tests for multiple Next workers, dev reload, stale lock, PID reuse defense, graceful shutdown, and a crashed process. Only one process may schedule controller work.
- [ ] Run `npm run test:unit -- owner-lock outbox action-command controller`; confirm failure.
- [ ] Implement an exclusive owner lock under `AGENTDASH_STATE_DIR` with a process-start token and heartbeat. Implement one immutable, canonical, redacted file envelope per outbox result using same-volume temp write, file flush, atomic rename, and startup scan.
- [ ] Implement `prepared → submitted/unknown → found → terminal` and proven-unsubmitted `revoked`. On ambiguous submission, lookup the same key; replay the transport only after authoritative `not_found` and only for the same command.
- [ ] Journal every adapter result before delivering its receipt to Hermes. The outbox is an overlay/recovery queue, not canonical task state.
- [ ] Wire `instrumentation.ts` to enforce `MISSION_CONTROL_DISPATCH=disabled|qualification|candidate|enabled`; default to `disabled`. `qualification` accepts only signed CLI qualification envelopes on disposable resources, `candidate` accepts deterministic/no-model fixtures, and normal chat/board model dispatch requires `enabled`.
- [ ] Run focused tests, `npm run build`, and two local server processes to prove one owner and zero dispatch.
- [ ] Commit: `git add src/server/mission-control/runtime src/instrumentation.ts && git commit -m "feat: add dormant replay-safe controller runtime"`.

## Task 13: Continue automatically through retry and scoped remediation

**Files:**

- Create: `src/server/mission-control/controller/continuation.ts`
- Create: `src/server/mission-control/controller/continuation.test.ts`
- Create: `src/server/mission-control/controller/remediation.ts`
- Create: `src/server/mission-control/controller/remediation.test.ts`
- Modify: `src/server/mission-control/runtime/controller.ts`
- Modify: `src/server/mission-control/runtime/controller.test.ts`

**Interfaces:** `chooseContinuation({ mandate, node, outcome, visits, ledger, route_evidence }): ContinuationDecisionV1` returns exactly one of `schedule_action`, `schedule_reconciliation`, `request_ceo_input`, or `finish_task`; it never calls a model or adapter.

```ts
const decision = chooseContinuation(transientFailureWithNamedFallback);
expect(decision).toMatchObject({ kind: "schedule_action", node_id: "fallback-1" });
expect(decision).not.toHaveProperty("approval_request");
```

- [ ] Write failing sequences: transient failure→named fallback→success; semantic failure→scoped remediation→success; repeated failure→budget exhaustion; route expiry→named eligible fallback; route unavailable→terminal stop.
- [ ] Assert no sequence creates another CEO interruption for technical retry, remediation, verification, or finalization already inside the activated mandate.
- [ ] Assert route, capability, workspace, objective, acceptance, budget, or external-effect expansion creates a typed CEO-input request and no action command.
- [ ] Run `npm run test:unit -- continuation remediation controller`; confirm failure.
- [ ] Implement exact graph-edge scheduling with visit caps, remaining aggregate limits, fresh route evidence, preserved task reserves, and a durably scheduled next command before the task remains Working.
- [ ] Keep technical ambiguity on reconciliation paths. Never ask the CEO to diagnose missing bindings, transport uncertainty, or worker quality mechanics.
- [ ] Run focused tests and `npm run typecheck`.
- [ ] Commit: `git add src/server/mission-control/controller src/server/mission-control/runtime/controller* && git commit -m "feat: add bounded automatic continuation"`.

## Task 14: Add path-specific independent verification and exact finalization

**Files:**

- Create: `src/server/mission-control/verification/independence.ts`
- Create: `src/server/mission-control/verification/independence.test.ts`
- Create: `src/server/mission-control/verification/receipt.ts`
- Create: `src/server/mission-control/verification/receipt.test.ts`
- Create: `src/server/mission-control/finalization/no-change-finalizer.ts`
- Create: `src/server/mission-control/finalization/git-finalizer.ts`
- Create: `src/server/mission-control/finalization/git-finalizer.test.ts`
- Create: `src/server/mission-control/finalization/command.ts`
- Create: `src/server/mission-control/finalization/command.test.ts`
- Modify: `src/server/mission-control/runtime/controller.ts`

**Interfaces:** `proveVerifierIndependence(realized_routes, candidate, tier)` returns a digestible proof or a typed rejection. `buildFinalizationCommand(verified_artifact, target_snapshot, authority)` creates the strict contract; `FinalizationPort` is the only mutation seam.

```ts
expect(() => proveVerifierIndependence([terraViaCodex], terraViaClaude, "tier_2")).toThrow(/provider/i);
await expect(finalizer.lookup(lostResponseCommand)).resolves.toMatchObject({ status: "applied", post_state_digest: expectedTree });
```

- [ ] Write Tier 1 tests requiring a separate read-only verifier. Write Tier 2 tests requiring either a trusted deterministic verifier or a model route whose provider and outer harness both differ from every model-backed mutating route realized before it, including remediation.
- [ ] Write tests that remediation invalidates the prior receipt and recomputes independence over the new realized route set.
- [ ] Write finalizer tests for exact TaskSpec/mandate revisions, source commit/tree, verification digest, base/target identities, allowed scope, exact patch/mutation digest, expected post-state tree, CAS head, adapter operation, idempotency key, and action authority.
- [ ] In disposable Git repositories, test clean fast-forward success, target drift, source drift, dirty target, non-fast-forward, prohibited paths, response loss after ref/worktree update, restart lookup, and canonical empty mutation.
- [ ] Run `npm run test:unit -- independence receipt finalizer command`; confirm failure.
- [ ] Implement only `no_change` and `local_git_fast_forward`. Precompute the expected result in an isolated integration worktree; immediately recheck every binding before mutation. On ambiguity, lookup exact head/tree and never issue a second mutation blindly.
- [ ] Persist `FinalizationReceiptV1` only when observed mutation and post-state match the command. A broader merge, rebase, conflict resolution, or external action follows only a named remediation/revision edge.
- [ ] Run focused tests and `npm run typecheck`.
- [ ] Commit: `git add src/server/mission-control/verification src/server/mission-control/finalization src/server/mission-control/runtime/controller.ts && git commit -m "feat: add independent verification and exact finalization"`.

## Task 15: Surface original work, attempts, receipts, and exact sessions

**Files:**

- Create: `src/app/api/mission-control/events/route.ts`
- Create: `src/app/api/mission-control/tasks/[taskId]/route.ts`
- Create: `src/app/api/mission-control/tasks/[taskId]/activity/route.ts`
- Create: `src/server/mission-control/activity/projector.ts`
- Create: `src/server/mission-control/activity/projector.test.ts`
- Create: `src/components/mission-control/ActivityTabs.tsx`
- Create: `src/components/mission-control/ReceiptView.tsx`
- Modify: `src/components/mission-control/AttemptInspector.tsx`
- Modify: `src/components/mission-control/TaskCard.tsx`
- Modify: `src/components/mission-control/mission-control.test.tsx`

**Interfaces:** `projectActivity(binding, work_task_events, acp_events): ActivityPageV1` requires an exact binding and cursor. SSE accepts `after` and emits only strict activity envelopes; UI tab components consume `ActivityPageV1` without transport-specific fields.

```ts
expect(projectActivity(binding, lifecycleOnly, [])).toEqual({ items: [], next_cursor: null });
expect(screen.getByRole("link", { name: "Open in CodeG" })).toHaveAttribute("href", exactNativeUri);
```

- [ ] Write activity tests correlating CodeG Work Task, conversation, connection, run sequence, harness session, and cursor without deriving one from another. Deduplicate replayed cursor items.
- [ ] Write UI tests for every append-only action attempt; phase labels `execute`, `retry`, `remediate`, `verify`, `finalize`, `cancel`, and `reconcile`; Live/Files/Checks/Receipt tabs; and selected-attempt clarity.
- [ ] Assert every model-backed action exposes its exact native CodeG URI when proven. Deterministic actions explicitly say “No worker session for this action.”
- [ ] Run `npm run test:unit -- projector mission-control`; confirm failure.
- [ ] Implement bounded SSE with resume cursor and cleanup. Render original sanitized CodeG/ACP items with source timestamp, kind, cursor, and identity; PM summaries link to original receipts rather than replacing them.
- [ ] Keep unsupported cost/token/file facts visibly unknown. Never synthesize activity from Hermes or Work Task status.
- [ ] Run focused tests, keyboard checks, `npm run lint`, and `npm run typecheck`.
- [ ] Commit: `git add src/app/api/mission-control src/server/mission-control/activity src/components/mission-control && git commit -m "feat: expose exact worker activity and sessions"`.

## Task 16: Bound cancellation, reconciliation, restart, and terminal inconsistency

**Files:**

- Create: `src/server/mission-control/runtime/reconciler.ts`
- Create: `src/server/mission-control/runtime/reconciler.test.ts`
- Create: `src/server/mission-control/runtime/cancellation.ts`
- Create: `src/server/mission-control/runtime/cancellation.test.ts`
- Modify: `src/server/mission-control/runtime/controller.ts`
- Modify: `src/server/mission-control/read-model.ts`
- Modify: `src/app/api/mission-control/commands/route.ts`
- Modify: `src/components/mission-control/TaskCard.tsx`

**Interfaces:** `Reconciler.tick(now, record): ReconciliationDecisionV1` is deterministic and bounded by the mandate's deadline/observation count. `CancellationService.request(task_id, CEOCommandV1)` targets one exact binding and returns `pending`, `confirmed`, or `inconsistent`.

```ts
clock.advanceTo(cancelDeadline.plusMilliseconds(1));
expect(reconciler.tick(clock.now(), unresolvedCancel)).toMatchObject({ terminal: "inconsistent", allow_new_work: false });
```

- [ ] Write fake-clock tests for all five numeric deadlines, bounded observation counts, restart mid-deadline, cancellation/completion races, orphan session, missing binding, finalization ambiguity, Hermes outage, and receipt delivery failure.
- [ ] Assert cancellation remains a UI action state while canonical task state is running. Confirmed exact stop yields `cancelled`; deadline expiry yields terminal `inconsistent`, never a false cancellation.
- [ ] Assert every deadline expiry prevents new work, journals one terminal intent, moves the operational projection to Stopped, and shows “Stopped — reconciliation pending” while Hermes delivery remains queued.
- [ ] Run `npm run test:unit -- reconciler cancellation controller read-model`; confirm failure.
- [ ] Implement startup rehydration from Hermes plus outbox, same-command lookup, exact cancel, receipt redelivery, and a read-only quarantined safety monitor that cannot revise the accepted terminal outcome.
- [ ] Preserve observed spend and held reserves across restart. A UI reload must never start controller work.
- [ ] Run focused tests and a two-process restart harness with fake adapters.
- [ ] Commit: `git add src/server/mission-control/runtime src/server/mission-control/read-model* src/app/api/mission-control/commands src/components/mission-control/TaskCard.tsx && git commit -m "feat: add bounded reconciliation and cancellation"`.

## Task 17: Refresh all proofs and promote approval/auto dispatch deliberately

**Files:**

- Create: `scripts/mission-control/refresh-gates.mjs`
- Create: `scripts/mission-control/promote-gates.mjs`
- Create: `src/server/mission-control/policy/auto.ts`
- Create: `src/server/mission-control/policy/auto.test.ts`
- Create: `src/app/api/mission-control/health/route.ts`
- Modify: `src/app/api/health/route.ts`
- Modify: `config/mission-control-gates.json`
- Modify: `docs/operations/route-qualification.md`

**Interfaces:** `evaluateAutoEligibility(snapshot): AutoEligibilityV1` returns an exhaustive reason list. `PromotionManifestV1` binds all gate/evidence digests, exact external commits/binaries, qualification receipts, operator command, target mode, timestamp, and expiry; promotion is compare-and-set from the current mode.

```ts
expect(evaluateAutoEligibility({ ...eligible, aggregate_cost_usd: 1.01 })).toMatchObject({ eligible: false });
await expect(promote(partialManifest, "enabled")).rejects.toThrow(/missing gate/i);
```

- [ ] Write one-field-negative auto tests for aggregate cost >$1, runtime >30 minutes, unenforceable cost/runtime/cancel, unsafe workspace, risky capability, missing terminal path, missing reserves, non-level-5 route, stale proof, and missing finalization/verification.
- [ ] Assert auto activation persists the same immutable mandate bindings and downstream authority rules as CEO approval; it skips only the CEO activation command.
- [ ] Run `npm run test:unit -- auto`; confirm failure.
- [ ] Implement the exact auto predicate and health projection. Preserve existing `/api/health` fields; add redacted `mission_control.dispatch`, `auto_launch`, proof ids, expiries, and reasons.
- [ ] Re-run AgentDash, Hermes, CodeG, PM, workspace, cursor, cancel, runtime/cost, finalization, owner/outbox, route, and verifier proofs against exact committed candidates. Inject lost responses and process restarts at every command boundary.
- [ ] `promote-gates.mjs` must verify evidence digests/commits and use an explicit local operator action. It cannot manufacture evidence or promote a partial conjunction. Commit only the configuration shape, never machine-local credentials or evidence.
- [ ] First run deterministic/no-model production-path fixtures in `candidate`. Then use an operator-signed `qualification` envelope to run at least one complete harmless real approval path on a disposable board/workspace with a current level-5 route, including session visibility, verification, finalization, receipts, restart, and cancel fault injection. This produces evidence but does not accept CEO UI work.
- [ ] Enable `enabled` only after that qualification receipt and every gate validate. Enable auto only after a separate complete harmless qualification path for an exact route/task-class also satisfies every auto predicate and aggregate bound.
- [ ] Run `npm run mission-control:probe`, `npm run test:unit`, `npm run test:live`, `npm run lint`, `npm run typecheck`, and `npm run build`.
- [ ] Commit: `git add scripts/mission-control src/server/mission-control/policy src/app/api/mission-control/health src/app/api/health/route.ts config/mission-control-gates.json docs/operations/route-qualification.md && git commit -m "feat: promote proven mission control dispatch"`.

## Task 18: Prove the CEO lifecycle end to end and prepare handoff

**Files:**

- Create: `e2e/mission-control.mock.spec.ts`
- Create: `e2e/mission-control.live.spec.ts`
- Create: `e2e/fixtures/mission-control.ts`
- Create: `scripts/mission-control/fault-harness.mjs`
- Create: `docs/operations/mission-control-runbook.md`
- Modify: `README.md`

**Interfaces:** The mock fixture implements every server port and exposes deterministic fault injection by named boundary. The live fixture accepts only `MISSION_CONTROL_LIVE_E2E=1`, qualification credentials, disposable board/workspace ids, and expected candidate/evidence digests.

```ts
await page.getByText("Restart-safe implementation").click();
await expect(page.getByRole("link", { name: "Open in CodeG" })).toHaveAttribute("href", expectedSessionUri);
await expect(page.getByText("Completed")).toBeVisible();
```

- [ ] Write the 15 acceptance scenarios from the approved design as named failing Playwright tests. The mock suite runs by default; the live suite requires disposable boards/workspaces and explicit environment opt-in.
- [ ] Include low-risk auto, approval-required no-session, one activation across all technical phases, semantic remediation, restart reattachment, exact cancel, exhausted limits, typed revision, receipt-before-done, PM inability, spoof/replay/stale digest, every command crash boundary, Tier 2 independence/drift, and bounded reconciliation expiry.
- [ ] Run `npm run test:e2e -- mission-control.mock`; confirm the new lifecycle scenarios fail before adding the final fixtures and wiring.
- [ ] Implement the mock fixtures, live disposable-service harness, and UI/API wiring required by those scenarios without weakening their assertions.
- [ ] Assert the CEO can click any model-backed action card and reach that exact CodeG session. Assert deterministic verification/finalization actions have no fake session link.
- [ ] Run `npm run test:e2e -- mission-control.mock`; then run the live suite only against disposable isolated services.
- [ ] Run the fault harness with response loss before/after each mutation and process restart. Require one lifetime task, one logical command per node visit, no duplicate session/effect, monotonic spend, one-time task reserves, and truthful terminal projection.
- [ ] Document startup, gate inspection, approval, auto eligibility, cancellation, reconciliation-pending response, evidence refresh, rollback to `MISSION_CONTROL_DISPATCH=disabled`, and recovery without database editing.
- [ ] Run the full repository quality gate and inspect the production build at `http://127.0.0.1:3007` with no external network listener.
- [ ] Commit: `git add e2e scripts/mission-control/fault-harness.mjs docs/operations/mission-control-runbook.md README.md && git commit -m "test: verify CEO mission control lifecycle"`.

## Spec-to-task-to-test traceability

| Approved design boundary | Plan tasks | Primary proof |
| --- | --- | --- |
| System ownership and PM never works | 3, 5, 9 | PM containment, proposal schema, controller import boundary |
| Stable request → lifetime card → immutable intake artifacts | 6, 7, 9 | concurrent request-id, transactional intake, digest mismatch, and zero-CodeG tests |
| Direction A and exact board lanes | 4, 15, 16 | component/read-model tests and Playwright selection |
| TaskSpec and phase-specific routing | 3, 6, 10 | strict contracts and route registry tests |
| Finite ExecutionMandate and no-start | 3, 6 | closed-graph, path enumeration, budget proof tests |
| Authenticated CEO command and one mandate activation | 2, 6, 17 | Origin/session/nonce/digest and duplicate activation tests |
| Action authority and replay-safe command | 3, 7, 11, 12 | atomic Hermes race and crash-point tests |
| Typed CEO input only | 3, 6, 13, 16 | out-of-scope revision and no-technical-interruption tests |
| Deterministic action/task outcomes | 3, 11, 13 | transition table and evidence-precedence tests |
| Hermes canonical lifecycle | 1, 7, 9 | upstream concurrency/CAS plus adapter contracts |
| CodeG sessions and original activity | 1, 8, 9, 15 | external-key, identity, cursor replay, and UI tests |
| Five-level route evidence and 21-entry baseline | 10, 17 | inventory counts, Wilson policy, expiry/revocation tests |
| Isolated qualification without production dispatch | 2, 8, 9, 10, 12, 17 | signed envelope, disposable resource, API denial, and promotion receipt tests |
| Auto ≤$1/≤30 min complete predicate | 6, 10, 17 | one-field-negative auto matrix |
| Continuous bounded execution | 11, 12, 13 | sequence/property/crash tests |
| Path-specific independent verification | 6, 10, 14 | success-path no-start and realized-route independence tests |
| Artifact/post-state-bound finalization | 14, 16 | disposable Git drift/ambiguity/restart tests |
| Durable outbox and numeric reconciliation | 12, 16 | file durability, fake-clock deadlines, terminal overlay tests |
| Security, secrets, real paths, local-only services | 1, 2, 5, 8, 9 | listener, Origin/CSRF, environment, folder equality tests |
| All 15 end-to-end acceptance flows | 18 | named mock/live Playwright suite and fault harness |

## Proof matrix and stop conditions

| Proof | PASS means | NO-GO behavior |
| --- | --- | --- |
| AgentDash local authority | exact loopback, same-origin command session, nonce persistence, one controller owner | Board remains read-only; no activation or dispatch |
| Hermes atomicity | lifetime task identity, digest artifacts, action command/run CAS, terminal event support | Cards may be mocked; no authoritative lifecycle mutation |
| CodeG replay safety | unique ensure, definitive lookup, cursor transcript, exact identity/cancel/runtime facts | No model-backed command |
| PM isolation | live inventory and side-effect probes show zero worker capability | PM surface disabled; typed fixture proposals only |
| Workspace containment | canonical real path equals configured CodeG folder for every mutation | Task remains non-runnable |
| Route qualification | current level-5 exact route/task-class evidence | Exact pair unavailable; no silent substitution |
| Budget enforcement | aggregate worst case plus one-time reserves is enforceable | Auto and approval dispatch both denied |
| Verification independence | every success-capable path has a valid tier verifier | Mandate rejected by no-start |
| Finalization exactness | mutation and expected post-state are bound, CAS-safe, and reconcilable | Success path unavailable |
| Reconciliation | every uncertain operation exits Working by numeric deadline | Dispatch health not ready; existing uncertainty ends `inconsistent` |

## Final implementation review

Before release handoff, run read-only reviews for correctness, security, API contracts, data integrity, reliability, testing, maintainability, and agent-native parity. Resolve every high/critical finding; register any accepted lower-severity warning in the quality-gate report.

Search live code, configuration, tests, and operating docs for the superseded single-route, per-attempt approval, separate finalization approval, review-pause, fixed-retry, and unbounded-uncertainty concepts. The audit passes only when those semantics are absent rather than renamed.

Run:

```powershell
npm run test:unit
npm run test:e2e -- mission-control.mock
npm run lint
npm run typecheck
npm run build
npm run mission-control:probe
```

The live suite is required for promotion, but must run only against disposable, authenticated, loopback-only candidate services and harmless workspaces.

## Definition of done

- One normal CEO request creates one durable Hermes card before any worker session.
- One immutable activation covers a complete finite mandate; technical retry, remediation, verification, and finalization continue without repeated CEO approval.
- Every model-backed action has one replay-safe command, one exact CodeG binding, original visible activity, and a native session link when proven.
- Every nonterminal state has an automatic authorized action, bounded reconciliation, or typed CEO business/authority request.
- High-risk success requires path-specific Tier 2 independence from every realized model-backed mutating route.
- Final success proves the exact artifact, exact mutation, exact expected post-state, and all immutable receipts before Hermes `done`.
- Cancellation and uncertainty never lie: unconfirmed stop or expired reconciliation becomes `inconsistent` and leaves Working.
- Aggregate cost/runtime/attempts and one-time downstream reserves survive restart.
- The PM remains technically unable to perform worker work, authenticate CEO authority, or mutate lifecycle.
- Existing AgentDash OpenCode, Hermes, Agent Fleet, overview, and legacy-reference surfaces still work.
- The full quality gate passes and Task 17 evidence identifies the exact binaries, commits, route proofs, expiry, and enabled mode.

## Source evidence used by this plan

- Approved local design: `docs/superpowers/specs/2026-08-02-ceo-mission-control-mvp-design.md`.
- AgentDash source at planning commit `42ba01b`.
- Read-only Hermes installed source at planning commit `87bc710609f8b89b6e6b4aa418dde8ee30ec6873`; its dirty state is not implementation input.
- Official CodeG `v0.23.0` source/tag at commit `d665f7b1f87e2e41611ea47f289224f0b11c010e`; implementation must re-prove the selected commit.
- Official Hermes Kanban CLI/database sources and tests named in Task 7.
- AgentBrain durable operating rules under `C:\Users\kruil\Documents\Projects\AgentBrain\pages`; generated state and retired stores are not product truth.
