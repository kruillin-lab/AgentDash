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

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one local CEO workspace in AgentDash where a capability-isolated Hermes PM turns normal conversation into durable Hermes cards, while a deterministic controller delegates approved work to one exact CodeG Work Task and exposes its real activity, session, and receipt.

**Architecture:** AgentDash is the controller and read model, not a new task database. Hermes Kanban owns cards, attempts, typed events, approval artifacts, and receipts. CodeG owns worker tasks, conversations, activity, cancellation, and native session links. AgentBrain supplies reviewed context. All mutations flow through typed server adapters; the PM proposes management intent but cannot call execution tools or do worker work.

**Tech stack:** Next.js 14 App Router, React 18, TypeScript 5.5 strict mode, Zod, Vitest, Testing Library, Playwright, Hermes Agent Kanban CLI/Python, CodeG Rust/SeaORM HTTP server and Work Task engine.

**Design authority:** [CEO Mission Control MVP Design](../specs/2026-08-02-ceo-mission-control-mvp-design.md)

## Execution rules

1. Execute dependency work in order. If a **hard gate** is NO-GO, continue only its remediation plus evidence, contracts, PM planning, and read-only UI slices; skip every CodeG-dispatching step until the gate is re-proven PASS.
2. Keep installed Hermes and CodeG copies untouched. Make upstream changes only in named clean isolated worktrees and commit them separately.
3. Never write directly to Hermes `kanban.db` or CodeG SQLite. Use supported CLI/HTTP operations.
4. Never use PM output as authority. Parse it as untrusted input, validate it with Zod, then recompute route, policy, approval, and action availability in AgentDash.
5. Create or return the lifetime-unique Hermes card and attach `TaskSpec` plus policy before any launch intent or CodeG call.
6. Treat every CodeG identifier as an opaque string. Never derive a conversation id from a task id.
7. Keep `cancelling` presentation-only until CodeG and Hermes confirm a terminal outcome.
8. Do not synthesize worker activity. The Live pane renders only CodeG-sourced items with real cursors or sequence numbers.
9. Bind local services to `127.0.0.1`; keep Hermes and CodeG credentials server-side; validate mutation origin and workspace roots.
10. If any proof or reconciliation result is unknown, fail closed: preserve the card, quarantine the attempt, and do not redispatch.

## Repository and worktree map

| Name | Path during execution | Mutation rule |
| --- | --- | --- |
| AgentDash | `C:\Users\kruil\Documents\Projects\AgentDash` | Main product work; one focused commit per task |
| Hermes installed copy | `C:\Users\kruil\AppData\Local\hermes\hermes-agent` | Read-only; currently user-modified |
| Hermes extension worktree | `C:\Users\kruil\Documents\Projects\.worktrees\hermes-agentdash-bridge` | Create from reviewed upstream commit; separate venv and commits |
| CodeG installed binaries | `C:\Users\kruil\AppData\Local\codeg` | Read-only; installed version is `0.22.2` at planning time |
| CodeG extension worktree | `C:\Users\kruil\Documents\Projects\.worktrees\codeg-agentdash-bridge` | Create from reviewed `v0.23.0` or newer compatible source; separate commits |
| AgentBrain | `C:\Users\kruil\Documents\Projects\AgentBrain` | Read reviewed `pages/` only; no automatic durable writes |

The implementation executor must record actual commits, binary paths, versions, route ids, and proof timestamps in evidence receipts. Planning-time versions are discovery evidence, not runtime guarantees.

## Locked MVP contracts

Create these schemas in `src/lib/mission-control/contracts.ts` with `z.strictObject` so unknown PM or adapter fields cannot silently widen authority:

```ts
import { z } from "zod";

export const WorkspacePolicySchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("read_only"), root: z.string().min(1) }),
  z.strictObject({ mode: z.literal("isolated_worktree"), root: z.string().min(1) }),
]);

export const BudgetSchema = z.strictObject({
  max_cost_usd: z.number().nonnegative().max(1_000),
  max_runtime_seconds: z.number().int().positive().max(86_400),
});

export const RouteSchema = z.strictObject({
  route_id: z.string().min(1),
  harness: z.string().min(1),
  agent_type: z.string().min(1),
  model: z.string().min(1),
  provider: z.string().min(1).nullable(),
  mode_id: z.string().min(1).nullable(),
  config_values: z.record(z.string(), z.string()),
  rationale: z.string().min(1),
});

export const PlanStepSchema = z.strictObject({
  objective: z.string().min(1),
  expected_artifact: z.string().min(1),
  route_id: z.string().min(1),
  required_capabilities: z.array(z.string().min(1)),
  workspace: WorkspacePolicySchema,
  budget: BudgetSchema,
  acceptance_check: z.string().min(1),
  safe_stop: z.string().min(1),
});

export const TaskSpecV1Schema = z.strictObject({
  schema_version: z.literal("agentdash.task-spec/v1"),
  request_id: z.string().uuid(),
  title: z.string().min(1).max(120),
  objective: z.string().min(1),
  acceptance_checks: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)),
  prohibited_actions: z.array(z.string().min(1)).min(1),
  project_id: z.string().min(1),
  workspace: WorkspacePolicySchema,
  required_capabilities: z.array(z.string().min(1)),
  risk_mode: z.enum(["auto", "approval_required"]),
  budget: BudgetSchema,
  route: RouteSchema,
  plan_revision: z.number().int().positive(),
  source_refs: z.array(z.string().min(1)),
  plan_steps: z.array(PlanStepSchema).min(1),
});

export type TaskSpecV1 = z.infer<typeof TaskSpecV1Schema>;

export const ProposedPlanStepV1Schema = z.strictObject({
  objective: z.string().min(1),
  expected_artifact: z.string().min(1),
  requested_route_id: z.string().min(1).nullable(),
  required_capabilities: z.array(z.string().min(1)),
  workspace: WorkspacePolicySchema,
  requested_budget: BudgetSchema.nullable(),
  acceptance_check: z.string().min(1),
  safe_stop: z.string().min(1),
});

export const ProposedTaskV1Schema = z.strictObject({
  title: z.string().min(1).max(120),
  objective: z.string().min(1),
  acceptance_checks: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)),
  prohibited_actions: z.array(z.string().min(1)).min(1),
  project_id: z.string().min(1),
  workspace: WorkspacePolicySchema,
  required_capabilities: z.array(z.string().min(1)),
  requested_budget: BudgetSchema.nullable(),
  requested_route_id: z.string().min(1).nullable(),
  source_queries: z.array(z.string().min(1)),
  plan_steps: z.array(ProposedPlanStepV1Schema).min(1),
});

const ManagementProposalCommon = {
  schema_version: z.literal("agentdash.management-proposal/v1"),
} as const;

export const ManagementProposalV1Schema = z.discriminatedUnion("intent", [
  z.strictObject({
    ...ManagementProposalCommon,
    intent: z.literal("conversation_only"),
    requested_priority: z.null(),
    target_task_id: z.null(),
    task: z.null(),
  }),
  z.strictObject({
    ...ManagementProposalCommon,
    intent: z.literal("create_task"),
    requested_priority: z.null(),
    target_task_id: z.null(),
    task: ProposedTaskV1Schema,
  }),
  z.strictObject({
    ...ManagementProposalCommon,
    intent: z.literal("revise_plan"),
    requested_priority: z.null(),
    target_task_id: z.string().min(1),
    task: ProposedTaskV1Schema,
  }),
  z.strictObject({
    ...ManagementProposalCommon,
    intent: z.literal("request_status"),
    requested_priority: z.null(),
    target_task_id: z.string().min(1),
    task: z.null(),
  }),
  z.strictObject({
    ...ManagementProposalCommon,
    intent: z.literal("request_approval"),
    requested_priority: z.null(),
    target_task_id: z.string().min(1),
    task: z.null(),
  }),
  z.strictObject({
    ...ManagementProposalCommon,
    intent: z.literal("request_cancel"),
    requested_priority: z.null(),
    target_task_id: z.string().min(1),
    task: z.null(),
  }),
  z.strictObject({
    ...ManagementProposalCommon,
    intent: z.literal("request_retry"),
    requested_priority: z.null(),
    target_task_id: z.string().min(1),
    task: z.null(),
  }),
  z.strictObject({
    ...ManagementProposalCommon,
    intent: z.literal("reprioritize"),
    requested_priority: z.number().int().min(0).max(100),
    target_task_id: z.string().min(1),
    task: z.null(),
  }),
]);

export type ManagementProposalV1 = z.infer<typeof ManagementProposalV1Schema>;
```

For the MVP, every executable `plan_step.route_id` must equal `TaskSpec.route.route_id`. Reject multi-route execution with the visible reason `multi_route_execution_not_supported`; do not silently create multiple sessions.

The controller also resolves a server-owned CodeG workspace binding after validating the TaskSpec path. The PM never supplies `codeg_folder_id`:

```ts
export const CodeGWorkspaceBindingV1Schema = z.strictObject({
  schema_version: z.literal("agentdash.codeg-workspace-binding/v1"),
  binding_id: z.string().uuid(),
  project_id: z.string().min(1),
  workspace: WorkspacePolicySchema,
  codeg_folder_id: z.string().min(1),
  codeg_folder_real_path: z.string().min(1),
  verified_at: z.string().datetime(),
  proof_id: z.string().uuid(),
});
```

```ts
export const ApprovalGrantV1Schema = z.strictObject({
  schema_version: z.literal("agentdash.approval-grant/v1"),
  grant_id: z.string().uuid(),
  task_id: z.string().min(1),
  next_attempt_ordinal: z.number().int().positive(),
  plan_revision: z.number().int().positive(),
  route: RouteSchema,
  allowed_capabilities: z.array(z.string().min(1)),
  workspace: WorkspacePolicySchema,
  budget: BudgetSchema,
  expires_at: z.string().datetime(),
  approved_by: z.string().min(1),
  approved_at: z.string().datetime(),
});

export const RunAuthorityConsumptionV1Schema = z.strictObject({
  schema_version: z.literal("agentdash.run-authority-consumption/v1"),
  authority_id: z.string().uuid(),
  authority_kind: z.enum([
    "launch_approval",
    "launch_auto_policy",
    "finalization_approval",
    "finalization_auto_policy",
  ]),
  task_id: z.string().min(1),
  attempt_id: z.number().int().positive(),
  attempt_ordinal: z.number().int().positive(),
  payload_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  consumed_at: z.string().datetime(),
});

export const FinalizationGrantV1Schema = z.strictObject({
  schema_version: z.literal("agentdash.finalization-grant/v1"),
  grant_id: z.string().uuid(),
  task_id: z.string().min(1),
  attempt_id: z.number().int().positive(),
  codeg_task_id: z.string().min(1),
  expected_codeg_run_seq: z.string().min(1),
  workspace_binding: CodeGWorkspaceBindingV1Schema,
  action: z.literal("merge_to_validated_base"),
  delete_worktree: z.literal(false),
  max_runtime_seconds: z.number().int().positive().max(1_800),
  expires_at: z.string().datetime(),
  approved_by: z.string().min(1),
  approved_at: z.string().datetime(),
});

export const FinalizationIntentV1Schema = z.strictObject({
  schema_version: z.literal("agentdash.finalization-intent/v1"),
  intent_id: z.string().uuid(),
  authority_id: z.string().uuid(),
  authority_kind: z.enum(["finalization_approval", "finalization_auto_policy"]),
  authority_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  task_id: z.string().min(1),
  attempt_id: z.number().int().positive(),
  codeg_task_id: z.string().min(1),
  expected_codeg_run_seq: z.string().min(1),
  finalization_key: z.string().min(1),
  requested_at: z.string().datetime(),
});

export const ExternalSessionBindingV1Schema = z.strictObject({
  schema: z.literal("agentdash.external-session/v1"),
  phase: z.enum(["delegation_bound", "conversation_resolved"]),
  task_id: z.string().min(1),
  attempt_id: z.number().int().positive(),
  executor: z.literal("codeg"),
  codeg_task_id: z.string().min(1),
  codeg_conversation_id: z.string().min(1).nullable(),
  harness_session_id: z.string().min(1).nullable(),
  native_uri: z.string().min(1).nullable(),
  harness: z.string().min(1),
  model: z.string().min(1),
  policy_snapshot_id: z.string().uuid(),
});
```

`WorkerReceiptV1` must preserve original worker facts and unknowns rather than laundering them through the PM:

```ts
export const WorkerReceiptV1Schema = z.strictObject({
  schema_version: z.literal("agentdash.worker-receipt/v1"),
  task_id: z.string().min(1),
  attempt_id: z.number().int().positive(),
  binding: ExternalSessionBindingV1Schema,
  route: RouteSchema,
  policy_snapshot_id: z.string().uuid(),
  outcome: z.enum(["ready_for_review", "failed", "cancelled", "timed_out"]),
  summary: z.string(),
  files: z.array(z.strictObject({ path: z.string(), status: z.string() })),
  checks: z.array(z.strictObject({ name: z.string(), status: z.string(), raw: z.string().nullable() })),
  usage: z.strictObject({
    input_tokens: z.number().int().nonnegative().nullable(),
    output_tokens: z.number().int().nonnegative().nullable(),
    cost_usd: z.number().nonnegative().nullable(),
    runtime_seconds: z.number().nonnegative(),
  }),
  unresolved_gaps: z.array(z.string()),
  terminal_detail: z.string().nullable(),
  native_uri: z.string().min(1).nullable(),
  completed_at: z.string().datetime(),
});

export const FinalizationReceiptV1Schema = z.strictObject({
  schema_version: z.literal("agentdash.finalization-receipt/v1"),
  task_id: z.string().min(1),
  attempt_id: z.number().int().positive(),
  codeg_task_id: z.string().min(1),
  codeg_run_seq: z.string().min(1),
  authority_id: z.string().uuid(),
  outcome: z.enum(["done", "returned_to_review", "cancelled", "timed_out", "failed"]),
  base_path: z.string().min(1),
  work_content_verified: z.boolean(),
  checks: z.array(z.strictObject({ name: z.string(), status: z.string(), raw: z.string().nullable() })),
  detail: z.string().nullable(),
  completed_at: z.string().datetime(),
});
```

Define the server ports in `src/server/mission-control/ports.ts` and keep orchestration dependent on these interfaces rather than CLI or HTTP response shapes:

```ts
export type DispatchLookup =
  | { status: "found"; taskId: string }
  | { status: "not_found" }
  | { status: "unknown"; reason: string };

export type FinalizeResult =
  | { status: "accepted"; codegRunSeq: string }
  | { status: "rejected"; reason: string }
  | { status: "unknown"; reason: string };

export type FinalizationReconciliation =
  | { status: "not_started"; observedRunSeq: string; proof: string }
  | { status: "merging"; codegRunSeq: string }
  | { status: "done"; codegRunSeq: string }
  | { status: "returned_to_review"; codegRunSeq: string; detail: string }
  | { status: "unknown"; reason: string };

export interface HermesKanbanPort {
  ensureTask(input: EnsureTaskInput): Promise<{ taskId: string; created: boolean }>;
  ensureJsonAttachment(input: EnsureJsonAttachmentInput): Promise<"created" | "existing_identical" | "conflict">;
  getTask(taskId: string): Promise<HermesTaskRecord>;
  listTasks(): Promise<HermesTaskRecord[]>;
  startExternalRun(input: StartExternalRunInput): Promise<{ attemptId: number; authorityConsumed: true }>;
  appendRunEvent(input: AppendRunEventInput): Promise<void>;
  heartbeatExternalRun(taskId: string, attemptId: number): Promise<void>;
  markExternalRunReview(input: MarkExternalRunReviewInput): Promise<"review" | "conflict">;
  resumeExternalRunFinalization(input: ResumeExternalRunFinalizationInput): Promise<"resumed" | "conflict">;
  closeExternalRun(input: CloseExternalRunInput): Promise<"closed" | "conflict">;
  readTaskHistory(taskId: string): Promise<HermesTaskHistory>;
}

export interface CodeGPort {
  resolveWorkspace(spec: TaskSpecV1): Promise<CodeGWorkspaceBindingV1>;
  dispatch(spec: TaskSpecV1, workspace: CodeGWorkspaceBindingV1, idempotencyKey: string): Promise<{ codegTaskId: string }>;
  lookupDispatch(idempotencyKey: string): Promise<DispatchLookup>;
  observe(codegTaskId: string, cursor: string | null): Promise<CodeGObservation>;
  resolveConversation(codegTaskId: string): Promise<ResolvedConversation | null>;
  inspectConversation(codegConversationId: string): Promise<CodeGConversationSnapshot>;
  cancel(binding: ExternalSessionBindingV1, expectedRunSeq: string, intent: "cancel_task" | "stop_finalization"): Promise<CancelResult>;
  finalize(binding: ExternalSessionBindingV1, grant: FinalizationGrantV1, intent: FinalizationIntentV1): Promise<FinalizeResult>;
  reconcileFinalization(binding: ExternalSessionBindingV1, intent: FinalizationIntentV1): Promise<FinalizationReconciliation>;
  nativeUri(binding: ExternalSessionBindingV1): Promise<string | null>;
}

export interface PmPort {
  send(input: PmTurnInput): Promise<PmTurnOutput>;
}

export interface AgentBrainPort {
  recall(query: string, projectId: string): Promise<ReviewedContext[]>;
}

export interface Clock { now(): Date; }
export interface IdFactory { uuid(): string; }
```

## Proof matrix and stop conditions

| Proof | Required evidence | Failure behavior |
| --- | --- | --- |
| Hermes lifetime atomic ensure | Two concurrent processes receive one task id, including when the task is archived | No executable card creation |
| Hermes immutable artifact ensure | Crash/race recovery yields one digest-addressed artifact; a different digest conflicts without overwrite | Card stays blocked; no dispatch |
| Hermes external run ownership | AgentDash can start, heartbeat, event, and CAS-close a run without Hermes dispatching a second worker | Board may be read-only; no CodeG launch |
| CodeG idempotent ensure/lookup | Ambiguous response can be resolved by lifetime external key | Quarantine; no redispatch |
| CodeG real activity | Snapshot/replay exposes original worker events with monotonic sequence/cursor | Live pane says unavailable; no acceptance claim |
| CodeG workspace, identities, and URI | Validated real path maps to one opaque folder id; task id, conversation id, optional harness id, and exact native URI are observed independently | Dispatch disabled or Open button disabled |
| CodeG bounded cancel/runtime | Exact task/run is cancelled and engine-enforced deadline terminates work | Auto disabled; approval alone does not bypass runtime safety |
| Finalization ambiguity/restart | Durable intent precedes merge; unknown responses are never retried; run sequence plus original events reconcile merging, review, or done after restart | Same run stays quarantined or in review; no repeated merge and no done claim |
| Cost boundary | Route has a hard dollar bound or `subscription_no_metered_fallback` proof | Auto disabled for that route |
| PM zero-execution profile | Live inventory contains no execution tool, MCP tool, plugin action, terminal, file, browser, research, or delegation capability | PM pane disabled |
| Runtime singleton/restart | One reconciler in dev/start, clean shutdown, same CodeG task after AgentDash restart | Background dispatch disabled |

## Two branches before dispatch

Task 1 intentionally begins with `executable_dispatch: NO_GO`. After that baseline, work splits without weakening the gate:

```text
Read-only product branch                 Platform-remediation branch
Tasks 2–4 → 7–10                        Tasks 5–6
tests, contracts, adapters, PM, UI,      isolated Hermes and CodeG changes
blocked cards, approvals                 with their own repository tests
                 \                      /
                  Task 11: dormant bridge/runtime
                  Task 12: rerun proofs and promote gate
                              ↓
                  Tasks 13–15: live lifecycle
```

The read-only branch may reach a usable planning workspace while either platform proof is still NO-GO. Task 11 may implement orchestration behind the enforced disabled gate and test it with fakes. Only Task 12 can promote approved dispatch in the machine-readable capability file; no sequential task number, commit, UI action, or user approval bypasses that convergence check.

## Task 1: Establish the capability baseline and hard GO/NO-GO gate

**Hard gate:** executable dispatch remains off after this task unless every required proof is PASS.

**Files:**

- Create: `scripts/spikes/codeg-capabilities.mjs`
- Create: `scripts/spikes/hermes-capabilities.mjs`
- Create: `scripts/spikes/controller-runtime.mjs`
- Create: `docs/superpowers/plans/evidence/2026-08-03-codeg-capabilities.md`
- Create: `docs/superpowers/plans/evidence/2026-08-03-hermes-capabilities.md`
- Create: `docs/superpowers/plans/evidence/2026-08-03-controller-runtime.md`
- Create: `docs/superpowers/plans/evidence/2026-08-03-mission-control-go-no-go.md`
- Create: `config/mission-control-capabilities.json`
- Modify: `.env.example`

- [ ] **Step 1: Add failing spike assertions before adding adapter code.**

`codeg-capabilities.mjs` must exit non-zero unless authenticated `127.0.0.1` CodeG exposes Work Task create/get/events/start/cancel/merge, ACP connection/session observation, exact external-key lookup, engine-enforced `max_runtime_seconds`, validated real-path-to-folder resolution, and a verified native URI.

Every spike must refuse to run unless `AGENTDASH_RUN_LIVE_SPIKES=1`, require explicitly configured isolated binary/server paths, create a disposable Hermes database/project and harmless temporary CodeG workspace under an allowlisted test root, and print the cleanup identifiers. It must never target the installed dirty Hermes tree or repurpose a token from another process.

```js
const required = [
  "work_task_ensure",
  "work_task_lookup_external",
  "work_task_get",
  "work_task_events",
  "work_task_start",
  "work_task_cancel_exact",
  "work_task_merge",
];

for (const operation of required) {
  assert.equal(probe.operations.has(operation), true, `missing ${operation}`);
}
assert.equal(probe.externalKey.concurrentWinnerCount, 1);
assert.equal(probe.runtime.enforcedByCodeG, true);
assert.equal(probe.activity.hasOriginalSequence, true);
assert.notEqual(probe.identities.taskId, probe.identities.conversationId);
assert.equal(probe.workspace.codegRealPath, probe.workspace.validatedRealPath);
assert.equal(probe.nativeUri, probe.sessionInspection.verifiedNativeUri);
assert.equal(probe.finalization.intentPrecedesMerge, true);
assert.equal(probe.finalization.unknownResponseMergeRetries, 0);
assert.equal(probe.finalization.restartUsesRunSequenceAndEvents, true);
```

Expected first run: FAIL against installed CodeG `0.22.2`; record the failure without upgrading or editing the installed copy.

- [ ] **Step 2: Record and approve the operator checkpoint.**

The evidence receipt must name the current installed version, the reviewed target release/commit, chosen clean worktree, build/install commands, rollback path, and whether the user approved using a separately built `0.23.0+` server. Do not replace installed CodeG or Hermes during the spike.

- [ ] **Step 3: Probe Hermes supported surfaces and PM inventory.**

`hermes-capabilities.mjs` invokes argument-array commands, parses JSON only, launches two concurrent ensure attempts, archives the winner, repeats ensure, proves external-run CAS, and audits `luisos-pm` tools.

```js
assert.equal(result.concurrent.taskIds.size, 1);
assert.equal(result.afterArchive.taskId, result.concurrent.taskId);
assert.equal(result.artifact.sameDigestResult, "existing_identical");
assert.equal(result.artifact.differentDigestResult, "conflict");
assert.equal(result.externalRun.attemptId > 0, true);
assert.deepEqual(result.externalRun.closeResults.sort(), ["closed", "conflict"]);
assert.deepEqual(result.pm.enabledExecutionCapabilities, []);
```

Expected first run: FAIL because the installed Hermes build lacks the atomic bridge operations and the current PM profile exposes execution capabilities.

- [ ] **Step 4: Probe the proposed local runtime lifecycle.**

The runtime spike starts a disposable Next-like process twice in development-style reload and production-style start, asserts one watchdog per process, persists a fake active binding, restarts AgentDash while the fake CodeG process remains live, and asserts no second dispatch.

```js
assert.equal(events.filter((event) => event.type === "runtime_started").length, 1);
assert.equal(codeg.dispatchCount, 1);
assert.equal(rehydrated.binding.codegTaskId, original.binding.codegTaskId);
assert.equal(events.at(-1)?.type, "runtime_stopped");
```

- [ ] **Step 5: Write evidence receipts with explicit PASS/FAIL/NOT_PROVEN values.**

Each receipt includes command, UTC time, binary/source commit, sanitized response excerpt, assertion table, and next required action. Never include bearer tokens, prompts containing secrets, or provider credentials.

- [ ] **Step 6: Write the consolidated decision.**

`2026-08-03-mission-control-go-no-go.md` must contain two independent decisions:

```yaml
planning_and_read_only_ui: GO
executable_dispatch: NO_GO
auto_launch: NO_GO
```

Change only the latter two to `GO` when all required proofs have current PASS receipts. A human approval cannot turn an unproven technical capability into PASS.

Create the machine-readable `config/mission-control-capabilities.json` with the same initial NO-GO decisions, schema version, proof ids/hashes, checked commits, UTC timestamps, expiry, and per-route cost/runtime/cancel/activity/native-link/folder-resolution/finalization-reconciliation facts. Runtime code validates this file with Zod; it does not scrape Markdown. Task 12 is the only task that may promote dispatch after rerunning the proofs.

- [ ] **Step 7: Document server-only configuration.**

Add names, never values, to `.env.example`:

```dotenv
CODEG_SERVER_URL=http://127.0.0.1:PORT
CODEG_SERVER_TOKEN=
HERMES_BIN=
HERMES_PM_BIN=
HERMES_PM_PROFILE=luisos-pm
AGENTBRAIN_ROOT=C:\Users\kruil\Documents\Projects\AgentBrain
AGENTDASH_ALLOWED_WORKSPACE_ROOTS=C:\Users\kruil\Documents\Projects
AGENTDASH_MUTATION_TOKEN=
```

- [ ] **Step 8: Verify and commit the evidence-only baseline.**

Run:

```powershell
$env:AGENTDASH_RUN_LIVE_SPIKES='1'
node scripts/spikes/codeg-capabilities.mjs
node scripts/spikes/hermes-capabilities.mjs
node scripts/spikes/controller-runtime.mjs
npm run check
```

Expected: spike commands may intentionally exit non-zero with recorded NO-GO; `npm run check` passes. Commit AgentDash changes:

```powershell
git add scripts/spikes docs/superpowers/plans/evidence config/mission-control-capabilities.json .env.example
git commit -m "test: establish mission control capability gates"
```

## Task 2: Add the test foundation and local-only process boundary

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `quality-gate.json`
- Create: `vitest.config.ts`
- Create: `vitest.live.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/setup.test.ts`

- [ ] **Step 1: Install test dependencies.**

```powershell
npm install zod
npm install --save-dev vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Add scripts that keep live adapters opt-in.**

```json
{
  "scripts": {
    "dev": "next dev -H 127.0.0.1 -p 3007",
    "start": "next start -H 127.0.0.1 -p 3007",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:live": "vitest run --config vitest.live.config.ts",
    "test:e2e": "playwright test",
    "check": "npm run test && npm run lint && npm run typecheck && npm run build"
  }
}
```

- [ ] **Step 3: Configure unit and live suites.**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": path.resolve(rootDir, "src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["**/*.live.test.ts", "tests/e2e/**", "node_modules/**"],
    coverage: { provider: "v8", reporter: ["text", "json-summary"] },
  },
});
```

```ts
// vitest.live.config.ts
import base from "./vitest.config";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(base, defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.live.test.ts"],
    testTimeout: 60_000,
  },
}));
```

- [ ] **Step 4: Prove the setup with one failing then passing test.**

```ts
// src/test/setup.ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

```ts
import { describe, expect, it } from "vitest";

describe("test setup", () => {
  it("provides a DOM", () => {
    const node = document.createElement("div");
    node.textContent = "Mission Control";
    expect(node).toHaveTextContent("Mission Control");
  });
});
```

- [ ] **Step 5: Expand the normal quality gate.**

Add `unit-test` to normal and release required checks, mapping it to `npm run test`. Keep live and E2E checks opt-in until their fixtures exist; Task 13 completes the live lifecycle path and Task 15 promotes live and E2E suites into release acceptance.

- [ ] **Step 6: Verify local binding and tests.**

```powershell
npm run test
npm run lint
npm run typecheck
npm run build
```

Expected: all pass and build output advertises only `127.0.0.1` when started with the new scripts.

- [ ] **Step 7: Commit.**

```powershell
git add package.json package-lock.json quality-gate.json vitest.config.ts vitest.live.config.ts src/test
git commit -m "test: add mission control test foundation"
```

## Task 3: Implement strict shared contracts and server ports

**Files:**

- Create: `src/lib/mission-control/contracts.ts`
- Create: `src/lib/mission-control/contracts.test.ts`
- Create: `src/server/mission-control/ports.ts`
- Create: `src/server/mission-control/fakes.ts`

- [ ] **Step 1: Write contract rejection tests first.**

```ts
import { describe, expect, it } from "vitest";
import { TaskSpecV1Schema } from "./contracts";

describe("TaskSpecV1Schema", () => {
  it("rejects authority-widening unknown fields", () => {
    const result = TaskSpecV1Schema.safeParse({ ...validTaskSpec(), shell_command: "deploy" });
    expect(result.success).toBe(false);
  });

  it("rejects a multi-route MVP plan", () => {
    const spec = validTaskSpec();
    spec.plan_steps[0].route_id = "different-route";
    expect(TaskSpecV1Schema.safeParse(spec).success).toBe(false);
  });
});
```

Add a schema-level `.superRefine` that emits `multi_route_execution_not_supported` when a step route differs from the selected route.

- [ ] **Step 2: Implement all locked schemas.**

Implement `TaskSpecV1`, `CodeGWorkspaceBindingV1`, `ApprovalGrantV1`, `RunAuthorityConsumptionV1`, `FinalizationGrantV1`, `FinalizationIntentV1`, `ExternalSessionBindingV1`, `WorkerReceiptV1`, `FinalizationReceiptV1`, `ManagementProposalV1`, `PolicySnapshotV1`, `CapabilityProof`, `MissionControlSnapshot`, `AttemptDetail`, and `ActivityItem`. Activity items require `source: "codeg"`, opaque cursor, timestamp, kind, summary, and optional sanitized raw reference.

- [ ] **Step 3: Define exact port inputs and outputs.**

In addition to the locked methods above, make terminal outcomes and adapter uncertainty explicit unions. Do not throw for an ambiguous dispatch; return `{ status: "unknown" }` so the controller can quarantine it.

- [ ] **Step 4: Create deterministic in-memory fakes.**

Fakes record every call, allow injected ambiguous/failure outcomes, retain append-only attempts, and expose helpers only to tests. They must not be imported by production routes.

- [ ] **Step 5: Run tests and type checks.**

```powershell
npm run test -- src/lib/mission-control/contracts.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```powershell
git add src/lib/mission-control src/server/mission-control/ports.ts src/server/mission-control/fakes.ts
git commit -m "feat: define mission control contracts"
```

## Task 4: Build deterministic policy, workspace, security, and state rules

**Files:**

- Create: `src/server/mission-control/capability-registry.ts`
- Create: `src/server/mission-control/capability-registry.test.ts`
- Create: `src/server/mission-control/policy.ts`
- Create: `src/server/mission-control/policy.test.ts`
- Create: `src/server/mission-control/state-machine.ts`
- Create: `src/server/mission-control/state-machine.test.ts`
- Create: `src/server/mission-control/workspace-policy.ts`
- Create: `src/server/mission-control/workspace-policy.test.ts`
- Create: `src/server/mission-control/workspace-registry.ts`
- Create: `src/server/mission-control/workspace-registry.test.ts`
- Create: `src/server/mission-control/request-security.ts`
- Create: `src/server/mission-control/request-security.test.ts`
- Create: `src/server/mission-control/local-session.ts`
- Create: `src/server/mission-control/local-session.test.ts`
- Create: `src/server/mission-control/redaction.ts`
- Create: `src/server/mission-control/redaction.test.ts`

- [ ] **Step 1: Write the fail-closed auto-policy matrix.**

```ts
it.each([
  ["cost over one dollar", { max_cost_usd: 1.01 }],
  ["runtime over thirty minutes", { max_runtime_seconds: 1801 }],
  ["cost telemetry only estimated", { cost_bound: "estimate" }],
  ["runtime not engine enforced", { runtime_enforcement: "watchdog_only" }],
  ["cancel unproven", { cancellation: "not_proven" }],
  ["route proof stale", { route_health: "stale" }],
  ["external side effect", { required_capabilities: ["external_messaging"] }],
])("requires approval when %s", (_name, override) => {
  expect(decideLaunchPolicy(makeInput(override)).mode).toBe("approval_required");
});
```

The only initially accepted cost proof is `subscription_no_metered_fallback` or a route-specific hard bound that cannot exceed the TaskSpec budget. Unknown telemetry always fails closed.

- [ ] **Step 2: Implement a server-owned fixed capability registry.**

```ts
export interface CapabilityRoute {
  routeId: string;
  harness: string;
  agentType: string;
  model: string;
  provider: string | null;
  supportedCapabilities: readonly string[];
  workspaceModes: readonly ("read_only" | "isolated_worktree")[];
  costBoundary: "subscription_no_metered_fallback" | "hard_bound" | "unproven";
  cancellation: "proven" | "not_proven";
  activity: "proven" | "not_proven";
  nativeLink: "proven" | "not_proven";
  autoFinalizeNoChanges: "proven" | "not_proven";
  runtimeEnforcement: "codeg_engine" | "not_proven";
  verifiedAt: string | null;
  proofId: string | null;
}
```

Load entries from the strictly validated `config/mission-control-capabilities.json`. PM-proposed route fields select an entry; they never create one. Reject expired proofs, commit mismatches, and missing hashes rather than inferring health from a live process alone.

- [ ] **Step 3: Encode controller states and legal transitions.**

```ts
export type AttemptControlState =
  | "planned"
  | "artifact_reconciliation"
  | "awaiting_approval"
  | "launch_intent_recorded"
  | "dispatch_unknown"
  | "delegation_bound"
  | "running"
  | "review"
  | "finalization_intent_recorded"
  | "finalization_unknown"
  | "merging"
  | "cancel_requested"
  | "receipt_pending"
  | "terminal";

export function transition(from: AttemptControlState, event: ControlEvent): AttemptControlState {
  const next = transitionTable[from]?.[event.type];
  if (!next) throw new IllegalTransitionError(from, event.type);
  return next;
}
```

Test duplicate launch, concurrent terminal signals, approval consumption, route change, plan revision change, cancellation/completion race, retry eligibility, and receipt-before-done.

- [ ] **Step 4: Validate real workspace containment.**

Resolve symlinks/junctions with `realpath`, normalize case on Windows, require the resolved path to equal or descend from an allowlisted root, reject missing roots, UNC paths unless explicitly allowlisted, device paths, and read-write work outside an isolated worktree.

```ts
expect(await validateWorkspace("C:\\allowed\\project", ["C:\\allowed"])).toMatchObject({ ok: true });
expect(await validateWorkspace("C:\\allowed-link\\..\\Windows", ["C:\\allowed"])).toMatchObject({ ok: false });
```

After containment passes, `workspace-registry.ts` resolves the validated AgentDash project/root to a configured CodeG folder candidate, loads that folder through the authenticated CodeG adapter, resolves its filesystem path, and requires case-normalized real-path equality. It returns `CodeGWorkspaceBindingV1`; a missing, duplicate, stale, or mismatched folder is a hard dispatch denial. Treat CodeG `folder_id` as an opaque string outside `client.ts`, even when the current server encodes it numerically.

- [ ] **Step 5: Enforce local mutation requests with a bound browser session.**

Require `Host` on `127.0.0.1`, an allowed exact `Origin`, and JSON content type. On the server-rendered root, mint a random local session id, place only its signed form in a `HttpOnly; SameSite=Strict; Path=/` cookie, and pass a session-bound CSRF value to `MissionControlWorkspace`. POST requests send that value as `X-AgentDash-CSRF`; `request-security.ts` verifies cookie signature, CSRF HMAC, Origin, and Host with constant-time comparisons. `AGENTDASH_MUTATION_TOKEN` is the server-only HMAC secret and is never serialized to the browser. A restart invalidates the local session and the UI refreshes it. GET snapshot/events remain local-only and never expose connector tokens.

Tests cover missing/tampered cookie, missing/tampered CSRF, wrong port/origin, cross-origin same-site requests, expired session, and a valid loopback request. Do not accept `Origin: null` for mutation routes.

- [ ] **Step 6: Add recursive redaction.**

Redact configured secrets, bearer strings, authorization headers, and key-like fields before logs, events, receipts, or API responses. Assert that redaction preserves structural diagnostics without preserving secret substrings.

- [ ] **Step 7: Verify and commit.**

```powershell
npm run test -- src/server/mission-control
npm run typecheck
git add src/server/mission-control
git commit -m "feat: enforce mission control policy boundaries"
```

## Task 5: Add the narrow Hermes Kanban external-executor bridge

**Hard gate:** AgentDash may not create executable runs until this extension passes isolated tests and the Hermes capability receipt is PASS.

**Repository:** clean Hermes worktree only.

**Files:**

- Modify: `hermes_cli/kanban_db.py`
- Modify: `hermes_cli/kanban.py`
- Modify: `tests/hermes_cli/test_kanban_db.py`
- Modify: `tests/hermes_cli/test_kanban_cli.py`
- Modify: `tests/stress/test_atypical_scenarios.py`
- Modify: `website/docs/user-guide/features/kanban.md`

- [ ] **Step 1: Create and verify a clean Hermes clone.**

```powershell
git clone https://github.com/NousResearch/hermes-agent.git C:\Users\kruil\Documents\Projects\.worktrees\hermes-agentdash-bridge
git -C C:\Users\kruil\Documents\Projects\.worktrees\hermes-agentdash-bridge checkout -b codex/agentdash-external-bridge dd600d1ace727fc9f10c9f8763f21b564e25b06f
git -C C:\Users\kruil\Documents\Projects\.worktrees\hermes-agentdash-bridge status --short
```

Expected: empty status. Stop if the target already exists, the selected commit differs from the approved evidence receipt, or the clone is dirty. Create a clone-local virtual environment; never reuse or mutate the installed Hermes environment. Do not assume a remote name from the installed dirty copy.

- [ ] **Step 2: Write bridge-scoped lifetime request race tests.**

Add a multiprocessing stress test that calls the new bridge operation concurrently, archives the resulting task, and calls it again. Leave Hermes's existing generic `idempotency_key` behavior unchanged.

```py
def test_bridge_request_is_lifetime_atomic_across_processes_and_archive(tmp_path):
    request_id = "11111111-1111-4111-8111-111111111111"
    task_ids = run_concurrently(8, lambda: db.ensure_bridge_task(request_id=request_id, title="One card"))
    assert len(set(task_ids)) == 1
    db.archive_task(task_ids[0])
    assert db.ensure_bridge_task(request_id=request_id, title="Ignored replacement") == task_ids[0]
    assert db.count_bridge_request_keys(request_id) == 1
```

Also seed duplicate values in the existing generic idempotency column and prove bridge schema initialization and unrelated Hermes behavior still succeed.

- [ ] **Step 3: Add bridge-specific request and authority tables.**

Create additive tables during the existing schema initialization path; do not drop or replace a generic Hermes index:

```sql
CREATE TABLE IF NOT EXISTS agentdash_bridge_requests (
  request_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agentdash_bridge_artifacts (
  artifact_key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  artifact_kind TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  attachment_ref TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agentdash_bridge_authorities (
  authority_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  attempt_ordinal INTEGER NOT NULL,
  run_id INTEGER NOT NULL,
  authority_kind TEXT NOT NULL CHECK (authority_kind IN (
    'launch_approval',
    'launch_auto_policy',
    'finalization_approval',
    'finalization_auto_policy'
  )),
  payload_sha256 TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agentdash_bridge_launch_authority_per_run
ON agentdash_bridge_authorities(run_id)
WHERE authority_kind IN ('launch_approval', 'launch_auto_policy');
```

`ensure_bridge_task` runs task insertion and request-key insertion in one bounded write transaction. On conflict it rolls back any losing task insertion and returns the mapped lifetime task, including archived cards. `ensure_bridge_artifact` inserts the immutable JSON attachment and its canonical SHA-256/key row in the same transaction; the same digest is idempotent and a different digest returns `conflict` without overwriting. Bridge tables are the correctness boundary; no in-memory lock or generic-key migration is involved.

- [ ] **Step 4: Write atomic run-authority, review, finalization, and terminal CAS tests.**

```py
def test_run_start_atomically_consumes_one_exact_authority(db, blocked_task, approval):
    results = run_concurrently(
        8,
        lambda: db.start_external_run_with_authority(
            blocked_task.id, owner="agentdash", authority=approval
        ),
    )
    winners = [result for result in results if result.result == "started"]
    assert len(winners) == 1
    run_id = winners[0].run_id
    assert db.authority_consumption(approval["grant_id"]).run_id == run_id
    assert db.active_external_runs(blocked_task.id) == [run_id]
```

Inject a failure between run insertion and authority insertion and prove the transaction leaves neither. Test task/grant/attempt/revision mismatch, expired authority, repeat consumption, automatic-policy authority, dispatcher exclusion, stale heartbeat/event rejection, `running → review` with the same active run, atomic `review → running` finalization-authority consumption, and first-terminal-transition-wins. Prove launch approval → review → consumed finalization grant → merge failure → review → a new finalization grant on the same `run_id`; only a second launch authority for that run is rejected.

Race artifact ensure across processes and inject a crash between generic attachment insertion and bridge-key insertion. The transaction must leave either one fully addressable attachment or none. Retry the same digest after each boundary, then prove a different digest returns `conflict` and preserves the original payload.

- [ ] **Step 5: Implement one supported JSON CLI group.**

```text
hermes kanban bridge ensure --request-id UUID --title TITLE --initial-status blocked --json
hermes kanban bridge artifact-ensure TASK_ID --artifact-key KEY --kind KIND --payload-file PATH --sha256 HASH --json
hermes kanban bridge run-start TASK_ID --owner agentdash --authority-file PATH --expected-status blocked --json
hermes kanban bridge run-event TASK_ID RUN_ID --type TYPE --payload-file PATH --json
hermes kanban bridge heartbeat TASK_ID RUN_ID --json
hermes kanban bridge run-review TASK_ID RUN_ID --receipt-file PATH --expected-active --json
hermes kanban bridge run-finalize-start TASK_ID RUN_ID --authority-file PATH --intent-file PATH --expected-status review --json
hermes kanban bridge run-close TASK_ID RUN_ID --outcome done|blocked|failed|cancelled|timed_out --metadata-file PATH --expected-active --json
```

Requirements:

- `ensure` returns `{ "task_id": "task_123", "created": true }` or `{ "task_id": "task_123", "created": false }` and never updates the mapped card from caller-supplied replacement fields.
- `artifact-ensure` returns `created`, `existing_identical`, or `conflict`; it atomically binds one canonical digest to one immutable artifact key and never replaces an existing payload.
- `run-start` validates the authority envelope and atomically creates the canonical `task_runs.id`, records the authority hash/consumption, marks the task running, and prevents normal Hermes dispatch.
- `run-review` atomically marks the task review while keeping the externally owned run active and paused for a governed decision.
- `run-finalize-start` atomically consumes a distinct finalization authority, appends the exact immutable `FinalizationIntentV1`, and resumes the same run; it never reuses the launch approval and never leaves a consumed grant without a recoverable intent.
- `run-event` and `heartbeat` target the exact active run; review-paused runs do not require heartbeats.
- `run-close` returns `{ "result": "closed"|"conflict" }`; the first terminal transition wins.
- All file arguments are owner-only UTF-8 JSON, strictly validated, hashed, and never executed.

- [ ] **Step 6: Run focused and full Hermes tests.**

```bash
python -m pytest tests/hermes_cli/test_kanban_db.py tests/hermes_cli/test_kanban_cli.py tests/stress/test_atypical_scenarios.py -q
scripts/run_tests.sh
```

Expected: PASS in the clean worktree venv. Update `2026-08-03-hermes-capabilities.md` with the exact commit and sanitized concurrent/CAS output.

- [ ] **Step 7: Commit in the Hermes worktree.**

```bash
git add hermes_cli/kanban_db.py hermes_cli/kanban.py tests/hermes_cli/test_kanban_db.py tests/hermes_cli/test_kanban_cli.py tests/stress/test_atypical_scenarios.py website/docs/user-guide/features/kanban.md
git commit -m "feat(kanban): add external executor bridge"
```

Do not install or merge this build automatically. Point AgentDash `HERMES_BIN` at the isolated, tested executable only after the operator checkpoint.

## Task 6: Add CodeG idempotent Work Task dispatch and engine runtime limits

**Hard gate:** no AgentDash CodeG mutation path may be enabled until the CodeG extension and capability receipt pass; read-only adapter development may continue against fakes.

**Repository:** clean CodeG worktree only, based on approved `v0.23.0` or a newer explicitly reviewed compatible commit.

**Files:**

- Create: `src-tauri/src/db/migration/m20260803_000004_work_task_external_key.rs`
- Modify: `src-tauri/src/db/migration/mod.rs`
- Modify: `src-tauri/src/db/entities/work_task.rs`
- Modify: `src-tauri/src/models/work_task.rs`
- Modify: `src-tauri/src/db/service/work_task_service.rs`
- Modify: `src-tauri/src/commands/work_task.rs`
- Modify: `src-tauri/src/web/handlers/work_task.rs`
- Modify: `src-tauri/src/web/router.rs`
- Modify: `src-tauri/src/work_task/engine.rs`
- Modify: `src/lib/types.ts` only if the public wire type is generated or consumed there

- [ ] **Step 1: Create and verify the isolated CodeG worktree.**

```powershell
git clone https://github.com/xintaofei/codeg.git C:\Users\kruil\Documents\Projects\.worktrees\codeg-agentdash-bridge
git -C C:\Users\kruil\Documents\Projects\.worktrees\codeg-agentdash-bridge checkout -b codex/agentdash-work-task-bridge v0.23.0
git -C C:\Users\kruil\Documents\Projects\.worktrees\codeg-agentdash-bridge status --short
```

Expected: empty status and the commit recorded in the operator checkpoint. If a newer base is chosen, rerun every source probe because endpoint and schema assumptions may have changed.

- [ ] **Step 2: Write service tests for lifetime external-key uniqueness.**

```rust
#[tokio::test]
async fn ensure_work_task_is_atomic_and_survives_archive() {
    let external_key = "agentdash:task-1:attempt-7";
    let results = join_all((0..8).map(|_| service.ensure_work_task(input(external_key)))).await;
    let ids: HashSet<_> = results.into_iter().map(|r| r.unwrap().id).collect();
    assert_eq!(ids.len(), 1);
    service.archive_work_task(*ids.iter().next().unwrap()).await.unwrap();
    assert_eq!(service.lookup_by_external_key(external_key).await.unwrap().unwrap().id, *ids.iter().next().unwrap());
}
```

Add tests for conflicting immutable payloads on the same key—including a different `folder_id`—concurrent HTTP calls, soft-deleted/archived tasks, and an unknown key.

- [ ] **Step 3: Add the schema invariant.**

The migration adds nullable `external_key` and a unique index across all rows. The unique index must not exclude archived or soft-deleted rows. Multiple `NULL` values remain allowed for legacy tasks.

```rust
manager
    .create_index(
        Index::create()
            .name("uq_work_task_external_key")
            .table(WorkTask::Table)
            .col(WorkTask::ExternalKey)
            .unique()
            .to_owned(),
    )
    .await?;
```

Expose `external_key` in server models but never display it as a user title.

- [ ] **Step 4: Add idempotent authenticated HTTP operations.**

Register:

```text
POST /api/work_task_ensure
POST /api/work_task_lookup_external
POST /api/work_task_cancel_exact
```

`work_task_ensure` requires the exact CodeG `folder_id` supplied by the validated AgentDash workspace binding, returns the existing task for a duplicate key, and reports `created: false`; it rejects a duplicate key whose immutable launch fields differ. `work_task_lookup_external` returns one of `found`, `not_found`, or a transport-level failure that the AgentDash adapter maps to `unknown`. `work_task_cancel_exact` requires `task_id`, expected `run_seq`, and intent. For a normal active generation it performs the existing cancel CAS. For a merge generation it stops the exact connection, cleans partial merge state, verifies the base/worktree state, and returns the Work Task to review before an optional second task-cancel action; it never labels an unclean merge stop as cancelled. Preserve the server's existing Bearer-token authentication.

- [ ] **Step 5: Write deadline and race tests before engine changes.**

```rust
#[tokio::test(start_paused = true)]
async fn max_runtime_cancels_only_the_matching_run_sequence() {
    let task = running_task_with_limit(30);
    engine.spawn_runtime_deadline(task.id, task.run_seq, 30).await;
    tokio::time::advance(Duration::from_secs(31)).await;
    assert_eq!(service.get(task.id).await.unwrap().status, WorkTaskStatus::Canceled);
    assert_event(task.id, task.run_seq, "runtime_limit_exceeded").await;
}
```

Test completion just before timeout, completion concurrent with timeout, retry with a new `run_seq`, merge with a new `run_seq`, stale timers, server shutdown, exact normal cancellation, merge-stop cleanup back to review, and wrong-sequence rejection. The state machine's compare-and-set decides the winner; late signals become events and never rewrite the winner.

- [ ] **Step 6: Add `max_runtime_seconds` to `WorkTaskConfig` and enforce it in the engine.**

Validate `1..=86400`. Start the deadline only after the matching generation is active. At a normal-generation expiry, request exact cancellation, emit a typed event, and preserve `runtime_limit_exceeded`. Extend `MergeParams` and persisted merge state with a separately authorized `max_runtime_seconds`; enforce it against the merge generation's exact `task_id + run_seq`. On merge expiry, use the proven merge-stop cleanup path and return to review with `finalization_runtime_limit_exceeded`. The launch budget and finalization budget are distinct, so time waiting for CEO review is not billed as worker runtime. AgentDash's watchdog remains defense-in-depth.

- [ ] **Step 7: Prove workspace, review/finalization reconciliation, replay, and exact native identity.**

Resolve the server's folder record and require its real path to equal the AgentDash-validated real path before ensure/start. Prove the native lifecycle `todo → queued → running → review → merging → done`: successful worker completion is `review`, not `done`; authenticated `/api/work_task_merge` is the separately governed finalization action and may return to review on failure. The merge transition must persist the advanced opaque `run_seq` and an original generation event before acknowledging success. Inject a dropped response after that persistence point and prove snapshot/replay exposes the same merge generation; inject a drop before mutation and prove the unchanged review sequence plus positive no-active-generation state after the deadline/stop window. These are the only facts AgentDash may use to reconcile an unknown finalization.

Use `/api/work_task_events` and `/ws/events` attach/replay with `connection_id` plus `since_seq`. Record that `WorkTaskInfo.conversation_id` is separate from task id and that the supported native link uses the returned conversation id:

```text
/workspace?folderId=<folder_id>&conversationId=<conversation_id>&agent=<agent_type>
codeg://session/<conversation_id>
```

The AgentDash adapter will use the verified browser deep link by default and retain the native URI as source truth; it must never interpolate a task id.

- [ ] **Step 8: Run CodeG's focused Rust tests and full project checks.**

Use the repository's documented commands from its current `AGENTS.md`. At minimum run the focused migration/service/handler/engine tests, Rust formatting, Clippy with warnings denied where supported, and the existing frontend type/build checks.

Expected: PASS. Update `2026-08-03-codeg-capabilities.md` with commit, endpoint schemas, concurrent winner output, replay sequence, deadline result, cancellation latency, identity values, and redacted auth details.

- [ ] **Step 9: Commit in the CodeG worktree.**

```powershell
git add src-tauri/src/db/migration src-tauri/src/db/entities/work_task.rs src-tauri/src/models/work_task.rs src-tauri/src/db/service/work_task_service.rs src-tauri/src/commands/work_task.rs src-tauri/src/web/handlers/work_task.rs src-tauri/src/web/router.rs src-tauri/src/work_task/engine.rs src/lib/types.ts
git commit -m "feat(work-task): add external idempotency and runtime limit"
```

Do not replace the installed `0.22.2` binaries automatically. Run the tested server from the isolated build after operator approval and retain the old binary path for rollback.

## Task 7: Implement hardened Hermes, CodeG, and AgentBrain adapters

**Files:**

- Create: `src/server/hermes/command.ts`
- Create: `src/server/hermes/command.test.ts`
- Modify: `src/server/hermes/cli.ts`
- Create: `src/server/hermes/kanban.ts`
- Create: `src/server/hermes/kanban.contract.test.ts`
- Create: `src/server/hermes/kanban.live.test.ts`
- Create: `src/server/codeg/types.ts`
- Create: `src/server/codeg/client.ts`
- Create: `src/server/codeg/client.contract.test.ts`
- Create: `src/server/codeg/client.live.test.ts`
- Create: `src/server/agentbrain/recall.ts`
- Create: `src/server/agentbrain/recall.test.ts`

- [ ] **Step 1: Lock the command-runner security behavior with tests.**

```ts
it("passes arguments without a shell", async () => {
  const result = await runHermes(["kanban", "show", "task;whoami", "--json"]);
  expect(spawnSpy).toHaveBeenCalledWith(expectedBinary, expect.any(Array), expect.objectContaining({ shell: false }));
  expect(spawnSpy.mock.calls[0][1]).toContain("task;whoami");
});
```

Implement `runHermes(args, options)` with `spawn`/`execFile`, `shell: false`, bounded stdout/stderr, timeout, abort signal, a configured absolute binary path, an optional explicitly constructed environment, and redacted errors. Reject `.bat`, `.cmd`, relative, or non-file executable paths. Refactor current `src/server/hermes/cli.ts` callers to use it without changing their public behavior. Leave `src/server/hermes/pty.ts` untouched.

- [ ] **Step 2: Implement the Hermes port through bridge JSON commands.**

Use temporary JSON files created with owner-only permissions for attachments, event payloads, and close metadata; delete them in `finally`. Implement `ensureJsonAttachment` only through bridge `artifact-ensure`, compute canonical JSON SHA-256 server-side, and treat a different stored digest as an immutable conflict. Parse every response with strict Zod schemas. Map CLI timeout or malformed JSON to typed adapter failures. Never fall back to direct SQLite.

```ts
const result = await runHermes([
  "kanban", "bridge", "ensure",
  "--request-id", input.requestId,
  "--title", input.title,
  "--initial-status", "blocked",
  "--json",
]);
return EnsureTaskResultSchema.parse(JSON.parse(result.stdout));
```

- [ ] **Step 3: Implement the authenticated CodeG HTTP client.**

Use `server-only`, `new URL(path, configuredBaseUrl)`, an `AbortSignal.timeout`, Bearer auth, response size limits, and strict response schemas. Reject non-loopback base URLs for the MVP. Map a merge timeout or connection loss to `FinalizeResult.status: "unknown"`; never hide it in an exception eligible for generic retry. `reconcileFinalization` reads the exact Work Task, sequence, active generation, and original events described in Task 6.

```ts
async function codegJson<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(new URL(path, config.baseUrl), {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw await toCodeGError(response);
  return schema.parse(await readBoundedJson(response, 1_000_000));
}
```

Map folder lookup, Work Task ensure/lookup/events/start/cancel/merge, and ACP inspection to the `CodeGPort`. `resolveWorkspace` compares the CodeG folder's real path to the server-validated TaskSpec path and returns the opaque binding. Map transport timeout after `ensure` to `unknown`; then use `work_task_lookup_external`. `finalize` calls authenticated `work_task_merge` only with a current `FinalizationGrantV1`, exact task/run sequence, validated base binding, `delete_worktree: false`, and its own runtime limit. `nativeUri` returns only a value tied to the resolved `conversation_id` and current capability proof.

- [ ] **Step 4: Implement replay-safe observation.**

Persist the last CodeG sequence as an opaque decimal string. Attach to `/ws/events` with the token subprotocol and `{ action: "attach", subscription_id, connection_id, since_seq }`. Convert only original Snapshot/Replay/Event records into `source: "codeg"` activity items. Deduplicate by `connection_id + seq`; cap the in-memory/API projection without truncating the durable CodeG source.

- [ ] **Step 5: Implement reviewed AgentBrain recall.**

Invoke `AgentBrain\recall.ps1` with an argument array and an explicit `-Project`; reject returned paths outside `AgentBrain\pages`, cap count and bytes, redact secrets, and expose citations rather than copying raw or state content into TaskSpec.

```ts
expect(result.every((item) => item.path.includes("\\AgentBrain\\pages\\"))).toBe(true);
expect(execSpy).not.toHaveBeenCalledWith(expect.stringContaining("capture.py"));
```

- [ ] **Step 6: Run fake contract tests, then opt-in live tests.**

```powershell
npm run test -- src/server/hermes src/server/codeg src/server/agentbrain
$env:AGENTDASH_LIVE_TESTS='1'; npm run test:live
```

Live tests use harmless disposable projects/tasks, include cleanup identifiers, never mutate installed source, and skip with a visible reason unless the approved isolated Hermes/CodeG builds are configured.

- [ ] **Step 7: Commit.**

```powershell
git add src/server/hermes src/server/codeg src/server/agentbrain
git commit -m "feat: add mission control system adapters"
```

## Task 8: Isolate the Hermes PM and parse management proposals

**Hard gate:** the PM pane stays disabled until live inventory proves zero execution capabilities on every turn.

**Files:**

- Create: `src/server/hermes/pm.ts`
- Create: `src/server/hermes/pm.test.ts`
- Create: `src/server/hermes/pm.live.test.ts`
- Create: `src/server/hermes/pm-environment.ts`
- Create: `src/server/hermes/pm-environment.test.ts`
- Create: `src/server/mission-control/pm-prompt.ts`
- Create: `src/server/mission-control/pm-prompt.test.ts`
- Create: `docs/operations/luisos-pm-profile.md`

- [ ] **Step 1: Create a dedicated profile without copying broad capabilities.**

Use Hermes profile commands to create or update `luisos-pm` in its own profile home. Disable every CLI toolset, MCP server, computer-use backend, plugin action, browser, terminal, file, code execution, web/research, delegation, cron, and mutation-capable memory tool for platform `cli`. Retain no execution tool merely for convenience; AgentDash injects reviewed recall and performs controller actions itself.

Record the exact reversible commands and profile home in `docs/operations/luisos-pm-profile.md`. Never edit another profile's settings. Treat the existing `luisos-pm.bat` as read-only configuration evidence only; do not execute a batch wrapper from the server.

- [ ] **Step 2: Write the inventory denial test first.**

```ts
it("fails closed if any execution capability is enabled", async () => {
  inventory.listEnabled.mockResolvedValue(["terminal"]);
  await expect(pm.send(turn())).rejects.toMatchObject({ code: "pm_isolation_failed" });
  expect(transport.send).not.toHaveBeenCalled();
});
```

Audit `luisos-pm tools --summary` plus enabled MCP/plugin surfaces immediately before every PM turn. Compare canonical capability ids to an empty execution allowlist. An audit error is a denial, not a warning.

- [ ] **Step 3: Define a conversational response envelope.**

The PM returns natural prose followed by exactly one delimited JSON proposal. A complete conversation-only response is:

```text
I can help turn that into a governed task. No task or worker has been created yet.
<agentdash-management-proposal>
{"schema_version":"agentdash.management-proposal/v1","intent":"conversation_only","requested_priority":null,"target_task_id":null,"task":null}
</agentdash-management-proposal>
```

`ManagementProposalV1` supports `conversation_only`, `create_task`, `revise_plan`, `request_status`, `request_approval`, `request_cancel`, `request_retry`, and `reprioritize`. It contains proposed values, not action authority. Reject missing, duplicate, oversized, malformed, or unknown-field envelopes while preserving safe conversational text.

- [ ] **Step 4: Implement a sanitized PM process environment.**

`pm-environment.ts` constructs an allowlist rather than inheriting `process.env`. Keep only Windows process essentials, the dedicated Hermes profile/config paths, locale, and explicitly named inference configuration proven necessary for that profile. Exclude CodeG token, AgentDash mutation secret, workspace secrets, Buzz keys, database passwords/URLs, cloud keys, and unrelated provider credentials. Tests seed every forbidden key and assert none reaches `spawn` or diagnostic output.

- [ ] **Step 5: Implement session continuation with the proven CLI invocation.**

Invoke the absolute `hermes.exe` selected by `HERMES_PM_BIN` with argument-array prefix `-p`, `HERMES_PM_PROFILE`, then `--oneshot`, `--usage-file`, and `--resume <session_id>` for subsequent turns. Use `shell: false` and the sanitized environment from Step 4. Capture the first turn's real session id through the exact proven Hermes session surface; do not guess from stdout. Store only the PM conversation reference as a Hermes attachment or server projection, never credentials.

```ts
const profileArgs = ["-p", config.profile];
const args = sessionId
  ? [...profileArgs, "--oneshot", prompt, "--usage-file", usagePath, "--resume", sessionId, "--no-restore-cwd"]
  : [...profileArgs, "--oneshot", prompt, "--usage-file", usagePath, "--no-restore-cwd"];
```

- [ ] **Step 6: Make the prompt enforce the ownership boundary.**

The system context says the PM may converse, clarify, plan, route, explain status, and summarize immutable receipts. It must never claim to have executed, inspected live work without supplied evidence, expanded capabilities, approved itself, or repair worker output. Include capability registry and reviewed AgentBrain excerpts as bounded read-only data.

- [ ] **Step 7: Prove the PM cannot do the requested task.**

Live tests ask the PM to create a file, browse a site, execute a shell command, and research a current fact while CodeG is unavailable. Each response must propose or explain a worker task; filesystem/process/network observations confirm no action occurred.

- [ ] **Step 8: Verify and commit.**

```powershell
npm run test -- src/server/hermes/pm.test.ts src/server/hermes/pm-environment.test.ts src/server/mission-control/pm-prompt.test.ts
$env:AGENTDASH_LIVE_TESTS='1'; npm run test:live -- src/server/hermes/pm.live.test.ts
git add src/server/hermes/pm.ts src/server/hermes/pm.test.ts src/server/hermes/pm.live.test.ts src/server/hermes/pm-environment.ts src/server/hermes/pm-environment.test.ts src/server/mission-control/pm-prompt.ts src/server/mission-control/pm-prompt.test.ts docs/operations/luisos-pm-profile.md
git commit -m "feat: isolate the mission control project manager"
```

## Task 9: Build the read-only Direction A workspace

**Outcome:** the new root screen renders the real Hermes board and selected attempt without any dispatch capability.

**Files:**

- Create: `src/app/overview/page.tsx` from the current `src/app/page.tsx` content
- Replace: `src/app/page.tsx`
- Modify: `src/components/AppShell.tsx`
- Create: `src/components/mission-control/MissionControlWorkspace.tsx`
- Create: `src/components/mission-control/MissionControlWorkspace.test.tsx`
- Create: `src/components/mission-control/ProjectManagerPane.tsx`
- Create: `src/components/mission-control/WorkBoard.tsx`
- Create: `src/components/mission-control/AttemptPane.tsx`
- Create: `src/components/mission-control/useMissionControl.ts`
- Create: `src/server/mission-control/projection.ts`
- Create: `src/server/mission-control/projection.test.ts`
- Create: `src/server/mission-control/composition.ts`
- Create: `src/server/mission-control/composition.test.ts`
- Create: `src/app/api/mission-control/snapshot/route.ts`
- Create: `src/app/api/mission-control/snapshot/route.test.ts`
- Create: `src/app/api/mission-control/events/route.ts`
- Create: `src/app/api/mission-control/events/route.test.ts`

- [ ] **Step 1: Preserve the existing overview before replacing root.**

Move the existing root page implementation byte-for-byte to `src/app/overview/page.tsx`, update only imports that become invalid, and add an Overview navigation target in `AppShell`. Update the logo destination, route title, active-route logic, and full-height shell behavior only for `/`; do not alter height or overflow behavior for `/overview`, `/hermes`, `/opencode`, Agent Fleet, or legacy-reference surfaces. Verify all preserved routes still render.

- [ ] **Step 2: Write projection tests against Hermes-shaped fixtures.**

```ts
it("projects canonical Hermes states into CEO lanes", () => {
  const snapshot = projectMissionControl(fixtureHistory());
  expect(snapshot.board.columns.map((column) => column.id)).toEqual([
    "planned", "awaiting", "working", "review", "completed",
  ]);
  expect(snapshot.board.tasks.find((task) => task.taskId === "t1")?.attemptId).toBe(42);
});

it("does not fabricate live activity", () => {
  expect(projectMissionControl(taskWithoutCodeGEvents()).selectedAttempt.activity).toEqual([]);
});
```

Project card/title/status/run identity from Hermes. `cancelling` appears only when a real `cancel_requested` event exists on the active run. Never persist a second client-side board.

- [ ] **Step 3: Add read-only snapshot and SSE endpoints.**

Both routes use `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`. Snapshot reads Hermes through `HermesKanbanPort`. SSE publishes versioned projection events with monotonic AgentDash event ids and a heartbeat; it does not run a dispatcher. Honor `Last-Event-ID` for the bounded in-process stream and force a fresh snapshot when replay is unavailable.

```ts
export async function GET(): Promise<NextResponse> {
  const snapshot = await missionControlProjection.snapshot();
  return NextResponse.json(MissionControlSnapshotSchema.parse(snapshot), {
    headers: { "cache-control": "no-store" },
  });
}
```

Route tests inject fake ports and verify `no-store`, node-safe serialization, SSE content type, replay-gap resnapshot, client abort cleanup, and that neither GET endpoint can dispatch or invoke the PM.

Each route module exports the Next `GET` wrapper plus a pure `createSnapshotHandler(deps)` or `createEventsHandler(deps)` factory for tests; production dependencies come from `composition.ts` rather than module mocks. The composition module imports `server-only`, validates configuration once, exposes read-only dependencies separately from mutation/dispatch dependencies, and must not initialize CodeG while dispatch is gated off.

- [ ] **Step 4: Write interaction tests before the workspace components.**

```tsx
it("selecting a card changes the exact attempt pane", async () => {
  render(<MissionControlWorkspace initialSnapshot={twoTaskSnapshot()} />);
  await userEvent.click(screen.getByRole("button", { name: /Migration plan/ }));
  expect(screen.getByRole("heading", { name: "Migration plan" })).toBeVisible();
  expect(screen.getByText("Attempt 8")).toBeVisible();
});

it("shows why CodeG cannot be opened", () => {
  render(<AttemptPane attempt={attemptWithoutConversation()} />);
  expect(screen.getByRole("button", { name: "Waiting for CodeG session" })).toBeDisabled();
});
```

- [ ] **Step 5: Implement the three-pane workspace.**

Desktop layout: PM conversation on the left, five-lane board in the center, selected attempt on the right. Preserve the approved Direction A information hierarchy. At narrower widths, use accessible tabs/regions while retaining all three destinations and selection state. Reuse existing AgentDash typography, colors, focus styles, and motion conventions; do not introduce a second design system.

Reuse the existing `ChatShell` presentation contract inside `ProjectManagerPane` without changing its public API; adapt Mission Control messages/actions around it so current Overview, OpenCode, Hermes, and generic-agent consumers remain unchanged. Use `src/app/opencode/page.tsx` only as a three-column/SSE interaction precedent—do not copy its page-local domain types.

The root server component creates the local signed session from Task 4 and passes only its CSRF value to the client workspace. `useMissionControl` attaches `X-AgentDash-CSRF` to mutation requests; the server-only HMAC secret never enters client code or page data.

The right pane has Live, Files, Checks, and Receipt tabs. In this task, tabs render real persisted Hermes data where available and explicit empty/unavailable states elsewhere. Do not use generic pulsing fake logs.

- [ ] **Step 6: Implement resilient snapshot/SSE state.**

`useMissionControl` loads a snapshot, subscribes to SSE, applies only newer versions, reconnects with backoff, refetches after a replay gap, and preserves the selected `taskId + attemptId` if it still exists. A disconnected banner must not imply the worker stopped.

- [ ] **Step 7: Verify accessibility and regressions.**

```powershell
npm run test -- src/server/mission-control/projection.test.ts src/server/mission-control/composition.test.ts src/app/api/mission-control/snapshot/route.test.ts src/app/api/mission-control/events/route.test.ts src/components/mission-control/MissionControlWorkspace.test.tsx
npm run lint
npm run typecheck
npm run build
```

Manually verify keyboard card selection, tab order, visible focus, readable empty states, and existing routes.

- [ ] **Step 8: Commit.**

```powershell
git add src/app/page.tsx src/app/overview/page.tsx src/app/api/mission-control src/components/AppShell.tsx src/components/mission-control src/server/mission-control/projection.ts src/server/mission-control/projection.test.ts src/server/mission-control/composition.ts src/server/mission-control/composition.test.ts
git commit -m "feat: add read-only CEO mission control workspace"
```

## Task 10: Turn PM proposals into durable non-runnable cards and approvals

**Outcome:** natural conversation can create one governed card and detailed plan, but still cannot dispatch CodeG.

**Files:**

- Create: `src/server/mission-control/controller.ts`
- Create: `src/server/mission-control/controller.test.ts`
- Create: `src/server/mission-control/task-spec.ts`
- Create: `src/server/mission-control/task-spec.test.ts`
- Create: `src/server/mission-control/approval.ts`
- Create: `src/server/mission-control/approval.test.ts`
- Create: `src/app/api/mission-control/messages/route.ts`
- Create: `src/app/api/mission-control/messages/route.test.ts`
- Create: `src/app/api/mission-control/tasks/[taskId]/actions/route.ts`
- Create: `src/app/api/mission-control/tasks/[taskId]/actions/route.test.ts`
- Modify: `src/components/mission-control/ProjectManagerPane.tsx`
- Modify: `src/components/mission-control/AttemptPane.tsx`
- Modify: `src/components/mission-control/useMissionControl.ts`

- [ ] **Step 1: Write the duplicate-request and non-executable tests.**

```ts
it("creates one blocked card for concurrent copies of one request", async () => {
  const input = message({ requestId: fixedUuid });
  const results = await Promise.all(Array.from({ length: 8 }, () => controller.handleMessage(input)));
  expect(new Set(results.map((result) => result.taskId))).toEqual(new Set(["task-1"]));
  expect(codeg.dispatches).toHaveLength(0);
});

it("does not create a card for conversation_only", async () => {
  pm.replyWith(proposal({ intent: "conversation_only" }));
  await controller.handleMessage(message());
  expect(hermes.ensureCalls).toHaveLength(0);
});
```

`ProjectManagerPane` creates `request_id` with `crypto.randomUUID()` once when the CEO submits a message and reuses that value for every transport retry until one response is acknowledged. Persist the minimal pending request envelope in `sessionStorage` before transport, restore and retry the same UUID after page reload, and delete it only after an acknowledged conversation response or canonical task id. Do not store PM output, credentials, or server artifacts there. The messages route requires that caller-stable UUID; the server validates but never replaces it. An intentional repeated request gets a new UUID. Test submit → transport loss → reload → retry and assert one UUID and one card.

- [ ] **Step 2: Build TaskSpec only from validated PM proposal plus server facts.**

The controller copies the validated caller-stable UUID into `request_id`, looks up the selected fixed registry route, validates the real workspace, clamps the budget, injects standard prohibited actions, resolves AgentBrain citations, and recomputes `risk_mode`. Reject a PM route not present and healthy in the registry. Keep the proposal and resulting TaskSpec as separate artifacts.

- [ ] **Step 3: Reconcile immutable artifacts in the safe order.**

```ts
const ensured = await hermes.ensureTask({
  requestId: taskSpec.request_id,
  title: taskSpec.title,
  initialStatus: "blocked",
});

const persistedProposal = await artifacts.reconcileOrCreate({
  taskId: ensured.taskId,
  artifactKey: `request:${taskSpec.request_id}:proposal`,
  kind: "agentdash.management-proposal/v1",
  schema: ManagementProposalV1Schema,
  create: async () => proposal,
});
const persistedTaskSpec = await artifacts.reconcileOrCreate({
  taskId: ensured.taskId,
  artifactKey: `request:${taskSpec.request_id}:task-spec:${taskSpec.plan_revision}`,
  kind: "agentdash.task-spec/v1",
  schema: TaskSpecV1Schema,
  create: async () => buildTaskSpec(persistedProposal),
});
const persistedWorkspace = await artifacts.reconcileOrCreate({
  taskId: ensured.taskId,
  artifactKey: `request:${taskSpec.request_id}:workspace:${taskSpec.plan_revision}`,
  kind: "agentdash.codeg-workspace-binding/v1",
  schema: CodeGWorkspaceBindingV1Schema,
  create: async () => codeg.resolveWorkspace(persistedTaskSpec),
});
await artifacts.reconcileOrCreate({
  taskId: ensured.taskId,
  artifactKey: `request:${taskSpec.request_id}:policy:${taskSpec.plan_revision}`,
  kind: "agentdash.policy-snapshot/v1",
  schema: PolicySnapshotV1Schema,
  create: async () => policy.evaluate(persistedTaskSpec, persistedWorkspace),
});
```

`reconcileOrCreate` first reads an existing bridge artifact by key, validates its strict schema and canonical JSON SHA-256, and returns it without running `create`. If absent, it computes the candidate, calls Hermes `artifact-ensure`, then rereads and verifies the committed digest. `existing_identical` is success; `conflict`, missing-after-success, or malformed existing content quarantines the card and never overwrites. This path runs for both `ensured.created` values.

Resolve the workspace through the read-only CodeG folder lookup only after the TaskSpec is durable. If folder resolution or any artifact boundary fails, leave the card blocked with a management-failure event and do not call a CodeG mutation. Write tests that inject a crash after card ensure and after each of proposal, TaskSpec, workspace, and policy persistence; every retry must finish one complete artifact set on the original card or surface a visible immutable conflict, never strand it silently or create a second card.

- [ ] **Step 4: Write approval scoping and invalidation tests.**

```ts
it.each(["plan_revision", "route", "workspace", "allowed_capabilities", "budget"] as const)(
  "invalidates approval after %s changes",
  (field) => expect(validateGrant(changed(field), grant())).toMatchObject({ valid: false }),
);

it("consumes a grant once", () => {
  const first = authorities.startRunWithGrant(grant(), 42, clock.now());
  expect(first.authorityConsumed).toBe(true);
  expect(() => authorities.startRunWithGrant(grant(), 43, clock.now())).toThrow("approval_already_consumed");
});
```

- [ ] **Step 5: Implement approval as a durable narrow artifact.**

The approve action loads the current TaskSpec, workspace binding, and next-attempt ordinal, computes a complete immutable `ApprovalGrantV1`, requires the authenticated local user, sets a short explicit expiry, attaches it to the task, and emits an approval event. It does not create a CodeG task. The separate `RunAuthorityConsumptionV1` is created atomically by Hermes when the run starts; AgentDash never rewrites the grant to mark it consumed. A revised plan increments `plan_revision` and returns to blocked awaiting a new grant.

- [ ] **Step 6: Add mutation routes with discriminated actions.**

```ts
const ActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("approve"), plan_revision: z.number().int().positive() }),
  z.strictObject({ action: z.literal("cancel") }),
  z.strictObject({ action: z.literal("retry") }),
  z.strictObject({ action: z.literal("finalize"), expected_codeg_run_seq: z.string().min(1) }),
  z.strictObject({ action: z.literal("reprioritize"), priority: z.number().int().min(0).max(4) }),
]);
```

Apply `assertLocalMutationRequest` before body parsing. It validates the exact Origin plus signed cookie/`X-AgentDash-CSRF` pair. Return typed `409` responses for stale plan revision, consumed/expired grant, illegal state, and conflicting terminal state.

Route tests verify invalid Origin/session/CSRF/content type, oversized or unknown-field bodies, duplicate request replay, stale approval, and controller error-to-status mapping. Export pure handler factories that receive the controller and security dependencies; the Next `POST` wrapper supplies production dependencies. No live Hermes or CodeG process runs in the normal suite.

- [ ] **Step 7: Show detailed high-risk plans and truthful action state.**

Attempt pane renders each plan step's objective, artifact, harness, model/config, capabilities, workspace, budget, acceptance check, and safe stop. It shows `No CodeG session exists` before dispatch. Approval visibly changes the card/action state; no button appears active without a resulting snapshot change or error.

- [ ] **Step 8: Verify and commit.**

```powershell
npm run test -- src/server/mission-control/controller.test.ts src/server/mission-control/task-spec.test.ts src/server/mission-control/approval.test.ts src/app/api/mission-control/messages/route.test.ts "src/app/api/mission-control/tasks/[taskId]/actions/route.test.ts" src/components/mission-control/MissionControlWorkspace.test.tsx
npm run check
git add src/server/mission-control src/app/api/mission-control src/components/mission-control
git commit -m "feat: persist governed mission control plans"
```

## Task 11: Build the dormant CodeG bridge, reconciler, and runtime

**Outcome:** orchestration exists behind the enforced `executable_dispatch: NO_GO` production gate and is proven with fakes. This task does not promote or live-enable dispatch.

**Files:**

- Create: `src/server/mission-control/bridge.ts`
- Create: `src/server/mission-control/bridge.test.ts`
- Create: `src/server/mission-control/reconciler.ts`
- Create: `src/server/mission-control/reconciler.test.ts`
- Create: `src/server/mission-control/runtime.ts`
- Create: `src/server/mission-control/runtime.test.ts`
- Create: `src/instrumentation.ts`
- Modify: `next.config.mjs` only if the proven instrumentation hook requires it
- Modify: `src/server/mission-control/controller.ts`

- [ ] **Step 1: Write the safe dispatch-order test.**

```ts
it("records durable intent before CodeG dispatch and binds the returned task", async () => {
  await bridge.launchApproved("task-1");
  expect(callOrder()).toEqual([
    "hermes.load-task-spec",
    "hermes.validate-approval",
    "codeg.validate-workspace-binding",
    "hermes.start-external-run-with-authority",
    "hermes.append-launch-intent",
    "codeg.dispatch",
    "hermes.append-delegation-bound",
  ]);
});
```

The dispatch key is deterministic and attempt-scoped:

```ts
const dispatchKey = `agentdash:${taskId}:attempt:${attemptId}`;
```

- [ ] **Step 2: Implement pre-dispatch revalidation.**

Immediately before launch, reload TaskSpec, policy, capability proof, `CodeGWorkspaceBindingV1`, approval, and next attempt. Re-resolve both filesystem paths and require exact real-path equality with the persisted CodeG folder. Refuse route substitution or capability expansion. Call Hermes `startExternalRun` once with the exact `launch_approval` or `launch_auto_policy` authority; Hermes atomically creates the run and its `RunAuthorityConsumptionV1`. After that succeeds, append `agentdash.launch-intent/v1`, then call CodeG `work_task_ensure` with the binding's opaque `folder_id` and `max_runtime_seconds` from the exact TaskSpec.

- [ ] **Step 3: Handle every dispatch outcome explicitly.**

```ts
switch (dispatch.status) {
  case "created":
  case "existing":
    await bindDelegation(dispatch.codegTaskId);
    break;
  case "unknown":
    await quarantineAttempt("dispatch_unknown");
    await reconciler.resolveUnknownDispatch(taskId, attemptId, dispatchKey);
    break;
}
```

On ambiguous transport outcome, call `lookupDispatch`. `found` binds the existing task. `not_found` permits one new ensure call only after the authoritative lookup. `unknown` remains quarantined indefinitely with visible diagnostics. A list omission is never treated as `not_found`.

- [ ] **Step 4: Persist the binding before monitoring.**

Append `agentdash.external-session/v1` phase `delegation_bound` immediately with null conversation/native fields. If persistence fails after CodeG exists, cancel the exact CodeG task, append an orphan diagnostic if possible, and block the Hermes attempt. Never show an unpersisted session as safely owned.

- [ ] **Step 5: Write restart and missing-binding tests.**

```ts
it("rehydrates the same CodeG task after AgentDash restart", async () => {
  await firstRuntime.launch("task-1");
  const id = codeg.dispatches[0].codegTaskId;
  await firstRuntime.stop();
  await secondRuntime.start();
  expect(codeg.dispatches).toHaveLength(1);
  expect(secondRuntime.activeBindings()[0].codegTaskId).toBe(id);
});

it("blocks automated continuation when an active run has no binding", async () => {
  await reconciler.rehydrate(activeRunWithoutBinding());
  expect(codeg.dispatches).toHaveLength(0);
  expect(hermes.lastEvent.type).toBe("inconsistent_active_run");
});
```

- [ ] **Step 6: Implement the reconciler.**

On start, load active Hermes external runs and append-only binding events. For each:

- binding present: lookup/observe the exact CodeG task and continue;
- launch intent without binding: lookup by dispatch key, bind if found, quarantine if unknown, dispatch only if authoritative not-found;
- active run without intent or binding: mark inconsistent and block automated continuation;
- CodeG reports interrupted after a CodeG server restart: record interruption and require retry policy; do not claim session continuity;
- CodeG review without a worker receipt: enter `receipt_pending` and finish Task 13's review-receipt path;
- terminal failed/cancelled/timed-out CodeG task without a receipt: enter `receipt_pending` and finish Task 13's terminal-receipt path.

- [ ] **Step 7: Start one observation-only runtime while dispatch remains gated.**

Use `src/instrumentation.ts` to call `startMissionControlRuntime()` for `NEXT_RUNTIME === "nodejs"`. Guard with a process-global symbol, make start idempotent, and install clean `SIGTERM`/`SIGINT` cleanup. The runtime validates `config/mission-control-capabilities.json` before every mutation cycle. While dispatch is NO-GO it may project board/readiness and observe already known bindings, but it cannot start/resume a run, call a CodeG mutation, auto launch, or parse PM prose.

```ts
const runtimeKey = Symbol.for("agentdash.mission-control.runtime");
const runtimes = globalThis as typeof globalThis & Record<symbol, MissionControlRuntime | undefined>;
runtimes[runtimeKey] ??= createMissionControlRuntime();
await runtimes[runtimeKey].start();
```

Unit tests inject an explicit PASS registry to exercise bridge logic. Production composition continues to use the checked-in NO-GO registry until Task 12 refreshes every proof.

- [ ] **Step 8: Verify and commit.**

```powershell
npm run test -- src/server/mission-control/bridge.test.ts src/server/mission-control/reconciler.test.ts src/server/mission-control/runtime.test.ts
npm run check
git add src/server/mission-control src/instrumentation.ts next.config.mjs
git commit -m "feat: build gated CodeG bridge runtime"
```

## Task 12: Refresh every proof and explicitly promote the dispatch gate

**Hard gate:** this is the only task that can change `executable_dispatch` from `NO_GO` to `GO`. If any proof is failed, stale, mismatched, or unknown, Tasks 13–15 remain unavailable while the planning/read-only product stays usable.

**Files:**

- Create: `scripts/spikes/lib/gate-decision.mjs`
- Create: `scripts/spikes/lib/gate-decision.test.mjs`
- Create: `scripts/spikes/refresh-mission-control-gates.mjs`
- Modify: `docs/superpowers/plans/evidence/2026-08-03-codeg-capabilities.md`
- Modify: `docs/superpowers/plans/evidence/2026-08-03-hermes-capabilities.md`
- Modify: `docs/superpowers/plans/evidence/2026-08-03-controller-runtime.md`
- Modify: `docs/superpowers/plans/evidence/2026-08-03-mission-control-go-no-go.md`
- Modify: `config/mission-control-capabilities.json`

- [ ] **Step 1: Write gate-decision tests before the refresh script.**

```js
test("dispatch stays NO_GO when any required proof is stale or mismatched", () => {
  const decision = decideGate(candidateProofs({
    codeg: { status: "PASS" },
    hermes: { status: "PASS" },
    pmIsolation: { status: "PASS" },
    runtime: { status: "PASS", sourceCommit: "wrong" },
  }));
  assert.equal(decision.executable_dispatch, "NO_GO");
  assert.deepEqual(decision.blockers, ["runtime_source_commit_mismatch"]);
});

test("auto is independently disabled without a hard cost boundary", () => {
  const decision = decideGate(allDispatchProofsPass({ costBoundary: "unproven" }));
  assert.equal(decision.executable_dispatch, "GO");
  assert.deepEqual(decision.auto_routes, []);
});
```

Also test expired timestamps, missing hashes, wrong binaries, dirty source trees, path/folder mismatch, non-loopback URLs, PM inventory drift, cancellation latency failure, activity replay gaps, native URI mismatch, artifact-reconciliation failure, ambiguous finalization replay failure, runtime duplicate, and a complete PASS candidate.

- [ ] **Step 2: Produce a candidate registry without changing production authority.**

`refresh-mission-control-gates.mjs --candidate PATH` reruns the three Task 1 spikes against the exact committed isolated Hermes/CodeG builds, dedicated PM profile, disposable board/workspace, and loopback services. It writes a temporary candidate JSON with proof ids, SHA-256 hashes, commits, binary paths, timestamps, expiry, and route facts. It does not modify `config/mission-control-capabilities.json`.

- [ ] **Step 3: Prove the actual dormant runtime in development and production modes.**

Point a disposable AgentDash process at the candidate registry and harmless test workspace. In both `next dev` and built `next start`, prove one runtime singleton, one approved Work Task ensure, one binding, clean SIGTERM/SIGINT, and bounded SSE cleanup. Restart AgentDash while CodeG stays live and prove the same `codeg_task_id`, folder id, conversation id, and replay sequence resume with dispatch count still one. Restart CodeG separately and prove the Work Task becomes interrupted and AgentDash records a retry decision rather than claiming continuity.

- [ ] **Step 4: Rerun PM and authority-boundary proofs at convergence.**

Immediately before promotion, audit the live PM tool/MCP/plugin inventory again, race Hermes launch-authority consumption, race digest-checked artifact ensure, race CodeG external-key ensure, verify real-path/folder equality, force one ambiguous dispatch lookup, measure exact cancellation latency, settle a harmless Work Task to CodeG review, and run a separately authorized merge to CodeG done. Inject a lost merge response and restart AgentDash while CodeG is merging; prove the persisted finalization intent and observed run sequence/events reattach without a second merge call. No provider or server token appears in the receipts.

- [ ] **Step 5: Promote only the verified candidate.**

```powershell
node --test scripts/spikes/lib/gate-decision.test.mjs
$env:AGENTDASH_RUN_LIVE_SPIKES='1'
node scripts/spikes/refresh-mission-control-gates.mjs --candidate "$env:TEMP\agentdash-mission-control-candidate.json"
node scripts/spikes/refresh-mission-control-gates.mjs --verify "$env:TEMP\agentdash-mission-control-candidate.json"
node scripts/spikes/refresh-mission-control-gates.mjs --promote "$env:TEMP\agentdash-mission-control-candidate.json"
```

`--promote` rereads every referenced receipt and hash, requires `executable_dispatch: GO`, atomically replaces only `config/mission-control-capabilities.json`, and updates the consolidated Markdown decision. Per-route auto flags remain false unless that route has the additional hard cost boundary; auto-finalization is a separate proof limited to zero-change read-only reviews. If verification fails, production stays NO-GO and the command exits non-zero.

- [ ] **Step 6: Verify the promoted readiness and commit.**

```powershell
npm run test
npm run check
git add scripts/spikes config/mission-control-capabilities.json docs/superpowers/plans/evidence
git commit -m "test: promote verified mission control dispatch"
```

Record the commit and operator checkpoint. Do not proceed to Task 13 unless the runtime health response independently reports `dispatch: ready` from the promoted file.

## Task 13: Surface real activity, review, finalization, and immutable receipts

**Files:**

- Create: `src/server/mission-control/activity.ts`
- Create: `src/server/mission-control/activity.test.ts`
- Create: `src/server/mission-control/receipt.ts`
- Create: `src/server/mission-control/receipt.test.ts`
- Create: `src/server/mission-control/finalization.ts`
- Create: `src/server/mission-control/finalization.test.ts`
- Modify: `src/server/mission-control/controller.ts`
- Modify: `src/server/mission-control/reconciler.ts`
- Modify: `src/server/mission-control/projection.ts`
- Modify: `src/app/api/mission-control/events/route.ts`
- Modify: `src/app/api/mission-control/tasks/[taskId]/actions/route.ts`
- Modify: `src/app/api/mission-control/tasks/[taskId]/actions/route.test.ts`
- Modify: `src/components/mission-control/AttemptPane.tsx`
- Modify: `src/components/mission-control/ProjectManagerPane.tsx`
- Modify: `src/components/mission-control/MissionControlWorkspace.test.tsx`

- [ ] **Step 1: Write source-integrity and cursor tests.**

```ts
it("emits only original CodeG activity and advances the opaque cursor", async () => {
  const result = await collectActivity(observationWithSeqs(["17", "18"]), "16");
  expect(result.items.every((item) => item.source === "codeg")).toBe(true);
  expect(result.items.map((item) => item.cursor)).toEqual(["17", "18"]);
  expect(result.nextCursor).toBe("18");
});

it("does not invent progress from a running status", async () => {
  expect((await collectActivity(runningWithoutEvents(), null)).items).toEqual([]);
});
```

Map worker messages, tool calls, file changes, checks, and terminal events from real CodeG Work Task/ACP data. Sanitize secrets but retain source timestamp, kind, and cursor. Deduplicate replayed sequences.

- [ ] **Step 2: Resolve conversation and native URI as a second binding event.**

When CodeG returns `conversation_id`, optional harness session, and folder/agent metadata, validate them, obtain `nativeUri`, and append phase `conversation_resolved`. Never rewrite `delegation_bound`. If URI proof is unavailable, persist null and keep the button disabled.

- [ ] **Step 3: Project Live, Files, and Checks from the selected attempt only.**

The right pane shows timestamped activity, connection state, last real event time, resolved identities, produced/changed files from CodeG, and raw check result references. A disconnected stream says `Activity connection lost — reconciling the same CodeG task`; it does not replace content with a generic in-progress animation.

- [ ] **Step 4: Write review-receipt and finalization-before-done tests.**

```ts
it("maps successful worker settlement to review, not done", async () => {
  await reconciler.onCodeGReview(successfulReview());
  expect(hermes.markExternalRunReview).toHaveBeenCalled();
  expect(hermes.closeExternalRun).not.toHaveBeenCalled();
  expect(controllerState()).toBe("review");
});

it("keeps Hermes out of review when the worker receipt is not durable", async () => {
  hermes.ensureJsonAttachment.mockRejectedValueOnce(new Error("disk full"));
  await reconciler.onCodeGReview(successfulReview());
  expect(hermes.markExternalRunReview).not.toHaveBeenCalled();
  expect(controllerState()).toBe("receipt_pending");
});

it("closes done only after CodeG done and a durable finalization receipt", async () => {
  await reconciler.onCodeGDone(mergedDone());
  expect(callOrder()).toEqual([
    "hermes.attach-finalization-receipt",
    "hermes.append-finalization-receipt-persisted",
    "hermes.close-external-run-done",
  ]);
});
```

Also test CodeG merge failure returning to review, finalization grant/run-sequence mismatch, unknown token/cost fields remaining null, worker uncertainty retention, failed checks not being rewritten by the PM, and terminal CAS conflict diagnostics. Add table-driven finalization crash tests for:

- transport timeout after `finalization_intent` but before an acknowledgement;
- AgentDash restart before the merge request, after server acceptance, and while CodeG is `merging`;
- CodeG returning to review with an advanced run sequence and a merge-failure event;
- CodeG reaching done before AgentDash persists `FinalizationReceiptV1`;
- same run receiving a new finalization grant after a failed merge without accepting a second launch authority.

Every ambiguous case must leave the attempt `finalization_unknown` or `receipt_pending`, invoke `work_task_merge` at most once for that grant, and preserve one active Hermes run.

- [ ] **Step 5: Build and persist `WorkerReceiptV1`.**

When CodeG settles a successful worker generation in `review`, read the Work Task plus conversation snapshot, files, preflight/checks, statistics, workspace binding, and resolved session binding. Preserve null cost/token values and explicit unsupported facts. Digest-ensure an immutable `WorkerReceiptV1` keyed by task and attempt with `outcome: "ready_for_review"`, append `worker_receipt_persisted`, then call Hermes `markExternalRunReview`. Keep the same external run active and review-paused. Failed, cancelled, or timed-out worker generations ensure their terminal worker receipt and CAS-close to the corresponding non-done outcome.

- [ ] **Step 6: Implement separately governed CodeG finalization.**

The selected attempt shows CodeG `review` and the immutable worker receipt. For changed work, the CEO's `finalize` action reloads the receipt, current CodeG Work Task, preflight, persisted workspace binding, exact `codeg_task_id`, and current opaque `run_seq`; it creates a short-lived `FinalizationGrantV1` for `merge_to_validated_base`, `delete_worktree: false`, and a separate runtime ceiling.

Build a deterministic `finalization_key` from task, attempt, and authority ids plus a `FinalizationIntentV1`. Hermes `resumeExternalRunFinalization` must atomically consume the approval or auto-policy authority, persist that exact intent, and resume the same attempt before any CodeG mutation. Only then may `CodeGPort.finalize` call authenticated `work_task_merge`. An accepted response binds the observed merge generation. A rejected response returns the same Hermes run to review with diagnostics. An `unknown` response appends `finalization_unknown`, quarantines the attempt, and never repeats merge with that authority.

The merge is a new CodeG generation on the same Work Task and conversation. Append a run-scoped `agentdash.codeg-generation/v1` event with opaque run sequence, connection id when resolved, kind `merge`, and the existing conversation id. If CodeG returns to review, Hermes returns to review without closing and requires a new finalization grant.

On process start and every quarantined poll, `reconcileFinalization` compares the intent's expected sequence with authoritative Work Task state, current opaque `run_seq`, and original generation events:

- advanced sequence plus merging/done evidence binds that observed generation and continues without another merge call;
- advanced sequence plus merge-failure/review evidence returns the same Hermes run to review for a new grant;
- same sequence plus positive CodeG proof that no merge generation exists after the engine deadline and stop-latency window records `finalization_not_started` and returns to review with the consumed grant unusable;
- done without a durable finalization receipt enters `receipt_pending` and rebuilds the receipt from CodeG and git truth;
- missing, contradictory, or unavailable evidence remains `finalization_unknown` indefinitely.

Absence from a list, a client timeout, or AgentDash restart is never proof that merge did not start.

- [ ] **Step 7: Persist finalization truth before done.**

When CodeG reaches native `done`, build `FinalizationReceiptV1` from CodeG state and git-truth verification, digest-ensure it by task and attempt, append `finalization_receipt_persisted`, then CAS-close the original Hermes run and task as done. A restart between any of those steps repeats the same digest-checked reconciliation, not merge. CodeG `review` is never projected as Hermes done. A zero-change read-only task may use a deterministic `finalization_auto_policy` authority only when Task 14 proves the route's `auto_finalize_no_changes` capability; otherwise it also waits for CEO finalization.

- [ ] **Step 8: Add PM summaries as derivatives.**

After worker-receipt persistence, pass a bounded immutable receipt view to the isolated PM and store its review summary separately. After finalization, it may summarize the finalization receipt. If PM summarization fails, leave original receipts visible and do not change lifecycle truth.

- [ ] **Step 9: Make Open in CodeG exact and accessible.**

Render the verified URI returned by the adapter. The control is an anchor only when the resolved binding contains a usable URI; otherwise render a disabled button with `Waiting for CodeG session` or `CodeG link unavailable`. Add accessible name, visible focus, and external-navigation disclosure.

- [ ] **Step 10: Verify and commit.**

```powershell
npm run test -- src/server/mission-control/activity.test.ts src/server/mission-control/receipt.test.ts src/server/mission-control/finalization.test.ts src/server/mission-control/reconciler.test.ts "src/app/api/mission-control/tasks/[taskId]/actions/route.test.ts" src/components/mission-control/MissionControlWorkspace.test.tsx
$env:AGENTDASH_LIVE_TESTS='1'; npm run test:live
npm run check
git add src/server/mission-control src/app/api/mission-control/events/route.ts src/components/mission-control
git commit -m "feat: expose CodeG review and governed finalization"
```

## Task 14: Enable proven auto launch, exact cancellation, and append-only retry

**Hard gate:** auto launch requires a current PASS cost-boundary receipt for the selected route. Approval does not waive missing runtime or cancellation safety.

**Files:**

- Modify: `src/server/mission-control/controller.ts`
- Modify: `src/server/mission-control/controller.test.ts`
- Modify: `src/server/mission-control/bridge.ts`
- Modify: `src/server/mission-control/bridge.test.ts`
- Modify: `src/server/mission-control/reconciler.ts`
- Modify: `src/server/mission-control/reconciler.test.ts`
- Modify: `src/server/mission-control/policy.ts`
- Modify: `src/server/mission-control/state-machine.ts`
- Create: `src/server/mission-control/diagnostics.ts`
- Create: `src/server/mission-control/diagnostics.test.ts`
- Modify: `src/components/mission-control/AttemptPane.tsx`
- Modify: `src/components/mission-control/WorkBoard.tsx`

- [ ] **Step 1: Write the complete auto predicate test.**

```ts
it("auto-launches only with every hard proof", async () => {
  const decision = decideLaunchPolicy(autoCandidate({
    maxCostUsd: 1,
    maxRuntimeSeconds: 1800,
    costBoundary: "subscription_no_metered_fallback",
    runtimeEnforcement: "codeg_engine",
    cancellation: "proven",
    activity: "proven",
    nativeLink: "proven",
    workspaceBinding: "proven",
    autoFinalizeNoChanges: "proven",
    workspaceMode: "isolated_worktree",
    riskyCapabilities: [],
    proofFresh: true,
    artifactsDurable: true,
  }));
  expect(decision).toMatchObject({ mode: "auto", runnable: true });
});
```

For every field, add a one-field-negative test that returns `approval_required` or `not_runnable` with a visible reason. A route whose marginal provider cost is unknown is not auto-capable. `autoFinalizeNoChanges` applies only after CodeG review proves zero changed files, green required checks, and a read-only route; changed work always needs a `FinalizationGrantV1`. The first fully accepted MVP requires at least one real route proven `subscription_no_metered_fallback` or an equivalent hard bound.

- [ ] **Step 2: Make auto launch use the identical bridge.**

Auto mode skips only `ApprovalGrant`; it does not skip card creation, TaskSpec/workspace/policy attachment, capability revalidation, external run creation with atomic `launch_auto_policy` consumption, launch-intent event, CodeG idempotent ensure, binding, runtime limit, activity, review receipt, finalization rules, or terminal CAS. Use one `bridge.launch` method whose authority input is either a validated one-time grant or a current launch-auto proof. A zero-change read-only review may auto-finalize through a new hashed `finalization_auto_policy` authority; it never reuses the launch authority.

- [ ] **Step 3: Write cancellation behavior and race tests.**

```ts
it("keeps the task running while cancellation is only requested", async () => {
  codeg.cancel.mockResolvedValue({ status: "requested" });
  await controller.cancel("task-1");
  expect(projection("task-1").presentationState).toBe("cancelling");
  expect(hermes.task("task-1").status).toBe("running");
});

it("records late completion without overwriting accepted cancellation", async () => {
  await race(cancelConfirmed(), completionSignal());
  expect(hermes.receipt("task-1").outcome).toBe("cancelled");
  expect(hermes.events("task-1")).toContainEqual(expect.objectContaining({ type: "late_terminal_signal" }));
});
```

- [ ] **Step 4: Implement exact cancellation.**

Load the active run's persisted binding and current opaque CodeG `run_seq`, append `cancel_requested`, then call `CodeGPort.cancel(binding, runSeq, "cancel_task")`. Present cancelling, continue observe/lookup, and CAS-close only after CodeG confirms cancellation or another terminal result wins. During `merging`, first call the exact `stop_finalization` path, require CodeG to clean and return to review, then issue the task-cancel transition from review; do not label an unclean base state cancelled. On bounded-stop failure, record `cancellation_unconfirmed`, quarantine the attempt, and disable auto for that route until a new proof passes.

- [ ] **Step 5: Implement append-only retry policy.**

A retry never reopens or overwrites a prior Hermes run. It creates the next external run and a new dispatch key/binding. Rules:

- auto-mode transient infrastructure failure: at most one automatic retry;
- second transient failure: block for CEO review;
- semantic/quality failure: no automatic retry;
- approval-required task: every retry requires a new grant scoped to the next attempt;
- a reviewed CodeG task must be explicitly cancelled/abandoned and observed terminal before a new retry Work Task is created;
- changed TaskSpec/route/workspace/capability/budget: increment revision and require new policy/approval;
- CodeG server restart interruption: classify explicitly, preserve prior attempt, then apply the rules above.

- [ ] **Step 6: Add structured diagnostics.**

Persist and project diagnostics for ambiguous dispatch, orphan cancellation, missing binding, stale heartbeat, replay gap, terminal CAS conflict, runtime expiry, cancellation lag, receipt persistence failure, and late terminal signal. Redact secrets and retain exact task/attempt/CodeG opaque ids.

- [ ] **Step 7: Verify race suites and live behavior.**

```powershell
npm run test -- src/server/mission-control/controller.test.ts src/server/mission-control/bridge.test.ts src/server/mission-control/reconciler.test.ts src/server/mission-control/diagnostics.test.ts
$env:AGENTDASH_LIVE_TESTS='1'; npm run test:live
npm run check
```

Expected: PASS. If no cost-bounded route is proven, all auto-negative tests pass but the live auto acceptance remains NOT_PROVEN and the MVP is not declared complete.

- [ ] **Step 8: Commit.**

```powershell
git add src/server/mission-control src/components/mission-control
git commit -m "feat: govern mission control launch and recovery"
```

## Task 15: Prove the CEO lifecycle end to end and prepare release handoff

**Files:**

- Create: `tests/e2e/fixtures/mission-control.ts`
- Create: `tests/e2e/mission-control.spec.ts`
- Create: `playwright.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json` if scripts or Playwright install metadata change
- Modify: `quality-gate.json`
- Modify: `src/app/api/health/route.ts`
- Create: `docs/operations/mission-control.md`
- Create: `docs/superpowers/plans/evidence/2026-08-03-mission-control-acceptance.md`
- Modify: `README.md`

- [ ] **Step 1: Add readiness that reports authority boundaries, not generic process health.**

```ts
export const MissionControlReadinessSchema = z.strictObject({
  planning: z.enum(["ready", "degraded", "disabled"]),
  dispatch: z.enum(["ready", "disabled"]),
  auto_launch: z.enum(["ready", "disabled"]),
  hermes_bridge: z.enum(["pass", "fail", "not_proven"]),
  codeg_bridge: z.enum(["pass", "fail", "not_proven"]),
  pm_isolation: z.enum(["pass", "fail", "not_proven"]),
  runtime: z.enum(["pass", "fail", "not_proven"]),
  artifact_reconciliation: z.enum(["pass", "fail", "not_proven"]),
  finalization_reconciliation: z.enum(["pass", "fail", "not_proven"]),
  auto_routes: z.array(z.string()),
  checked_at: z.string().datetime(),
});
```

Extend `/api/health` without breaking existing OpenCode/Hermes fields. `dispatch: ready` requires Hermes, CodeG, PM isolation, runtime, artifact-reconciliation, and finalization-reconciliation proofs. `auto_launch: ready` additionally requires at least one current cost-bounded route. Do not expose tokens, profile homes, or filesystem secrets.

- [ ] **Step 2: Install Playwright only for the acceptance slice.**

```powershell
npm install --save-dev @playwright/test
```

- [ ] **Step 3: Build deterministic E2E fixtures.**

The default Playwright suite uses fake ports in a spawned test process and deterministic clocks/ids. A separate live project uses only disposable Hermes project ids and harmless isolated worktrees. Configure one worker for live lifecycle/race tests to avoid fixture cross-talk.

- [ ] **Step 4: Encode the eight acceptance flows.**

```ts
test("high-risk request creates a detailed blocked plan and no CodeG session", async ({ page, mission }) => {
  await mission.open(page);
  await mission.say(page, "Plan a production database migration");
  await expect(page.getByText("Approval required")).toBeVisible();
  await expect(page.getByText("No CodeG session exists")).toBeVisible();
  expect(await mission.codegTaskCount()).toBe(0);
});

test("task card opens the exact running session", async ({ page, mission }) => {
  const run = await mission.launchApprovedHarmlessTask(page);
  await page.getByRole("button", { name: run.cardTitle }).click();
  await expect(page.getByText(run.codegConversationId)).toBeVisible();
  await expect(page.getByRole("link", { name: /Open in CodeG/ })).toHaveAttribute("href", run.nativeUri);
});
```

Cover:

1. proven low-risk read/research route creates a card, auto-launches, exposes original activity, links the exact session, reaches CodeG review, and auto-finalizes only after proving zero changes;
2. proven isolated-code route respects `$1`, 30 minutes, no-deploy constraints, reports files/checks, remains in review, then reaches done only after a separate CEO finalization grant and CodeG merge;
3. production migration stays blocked with a per-step plan and no CodeG task;
4. one approval launches exactly the approved route once;
5. AgentDash restart reattaches to the same CodeG task/conversation without redispatch;
6. cancellation reaches the exact binding and leaves an auditable result;
7. worker receipt is durable before review, and finalization receipt is durable before done;
8. PM cannot perform worker work when CodeG is unavailable.

If a second real auto route is not available, fixture flow 2 proves policy with a fake hard boundary but the live evidence marks it NOT_PROVEN; flow 1 must still pass live before MVP acceptance.

- [ ] **Step 5: Add destructive-path and security E2E checks.**

Prove a non-loopback Host, bad Origin, missing or tampered local session/CSRF pair, workspace escape/junction, PM-supplied arbitrary route, expired grant, duplicate approval, and unknown dispatch all fail closed with no extra CodeG task. Add crash-path E2E fixtures for message transport loss plus reload retaining one request UUID, failure after each card-artifact boundary completing the same card on retry, and a lost merge response plus AgentDash restart reconciling the observed generation with zero repeated merge calls. Confirm secrets never appear in API responses, SSE, Hermes attachments, receipts, screenshots, or test traces.

- [ ] **Step 6: Write the operator runbook.**

`docs/operations/mission-control.md` must include:

- how to start the approved isolated CodeG and Hermes builds on loopback;
- required environment variable names and where their values are managed;
- PM inventory audit and expected zero-execution result;
- capability receipt refresh procedure and staleness window;
- how to disable dispatch or auto launch immediately;
- restart/reconciliation behavior and CodeG-server-restart limitation;
- CodeG's review → separately governed merge → done mapping, including merge-stop cleanup;
- cancellation escalation without mislabeling a kill as cancel;
- rollback to read-only/planning mode;
- disposable test data cleanup;
- explicit warning that Buzz remains future transport and cannot bypass approval.

- [ ] **Step 7: Promote live/E2E checks to release acceptance.**

Add commands:

```json
{
  "scripts": {
    "test:e2e": "playwright test --project=mock",
    "test:e2e:live": "playwright test --project=live",
    "check:release": "npm run test && npm run test:live && npm run test:e2e && npm run test:e2e:live && npm run lint && npm run typecheck && npm run build"
  }
}
```

The release quality gate runs `check:release`, the Markdown stage-2 audit, and the acceptance receipt verifier. Mock tests never substitute for the one required live auto-route acceptance.

- [ ] **Step 8: Run the complete release gate.**

```powershell
npm run test
$env:AGENTDASH_LIVE_TESTS='1'; npm run test:live
npx playwright install chromium
npm run test:e2e
$env:AGENTDASH_LIVE_E2E='1'; npm run test:e2e:live
npm run lint
npm run typecheck
npm run build
python C:\Users\kruil\.codex\skills\obsidian-markdown-auditor\scripts\obsidian_markdown_audit.py validate --root C:\Users\kruil\Documents\Projects --stage stage2
```

Expected: every command PASS. Write `2026-08-03-mission-control-acceptance.md` with identifiers, versions/commits, sanitized evidence, all eight outcomes, known limits, and one of these exact statuses:

- `PASS` — all gates and all live acceptance flows pass, including one real auto route;
- `PASS_WITH_WARNINGS` — functional MVP passes but a registered non-safety warning has an owner and expiry;
- `NO_GO` — any authority, idempotency, artifact reconciliation, runtime, cancellation, PM isolation, restart, finalization reconciliation, receipt, security, or required live auto-route proof fails or is not proven.

Never label planning/read-only delivery as the completed executable MVP.

- [ ] **Step 9: Update user-facing documentation.**

README describes the CEO/PM/worker mental model, the three-pane root, `/overview`, authority boundaries, and setup/runbook links. It must not claim Buzz integration or multi-route execution.

- [ ] **Step 10: Commit the acceptance slice.**

```powershell
git add tests/e2e playwright.config.ts package.json package-lock.json quality-gate.json src/app/api/health/route.ts docs/operations/mission-control.md docs/superpowers/plans/evidence/2026-08-03-mission-control-acceptance.md README.md
git commit -m "test: prove CEO mission control lifecycle"
```

## Final implementation review

Before merging or installing any external build:

- [ ] Confirm AgentDash, Hermes, and CodeG worktrees are clean except for intended committed changes.
- [ ] Review the full three-repository diff against the design authority.
- [ ] Run always-on correctness, maintainability, testing, and project-standards reviews.
- [ ] Run security and reliability reviews because the change handles local authenticated APIs, credentials, subprocesses, workspaces, cancellation, timeouts, and external worker state.
- [ ] Run API-contract review for every CLI/HTTP/schema change.
- [ ] Run data-integrity review for Hermes and CodeG unique indexes/migrations.
- [ ] Verify no installed Hermes/CodeG source or unrelated user change was modified.
- [ ] Verify every acceptance statement links to an original receipt or proof rather than PM prose.
- [ ] Perform one clean-machine-style setup rehearsal using only documented configuration.
- [ ] Obtain explicit operator approval before switching AgentDash from isolated builds to installed/default binaries.

## Contract-to-test traceability

| Requirement | Primary proof |
| --- | --- |
| One normal CEO conversation | PM envelope tests and E2E message flows |
| PM never does worker work | live zero-tool inventory plus CodeG-unavailable E2E |
| Card exists before launch | controller call-order and E2E persisted-card assertion |
| One request, one lifetime card | Hermes multiprocess/archive unique-key test |
| Partial card writes recover | digest-checked artifact crash-boundary and reload tests |
| Higher stakes show exact plan | plan-schema and AttemptPane tests |
| Approval is narrow and one-time | approval invalidation/consumption tests |
| One attempt, one CodeG Work Task | CodeG external-key race and bridge restart tests |
| Real visible work | replay sequence and no-synthetic-activity tests |
| Exact session navigation | independent conversation-id/native-URI live proof |
| Review and done are truthful | worker-receipt-before-review plus finalization-receipt-before-done tests |
| Ambiguous finalization is safe | intent-before-merge, lost-response, run-sequence/event, and restart tests |
| Low-risk auto only | one-field-negative policy matrix plus live bounded route |
| Cancellation is truthful | requested/confirmed projection and terminal-race tests |
| Restart is safe | runtime singleton and same-binding rehydration tests |
| Secrets stay server-side | request-security, redaction, and E2E trace scans |

## Deliberate MVP limits

- One selected route and one CodeG Work Task per attempt; multi-route execution is rejected visibly.
- Local AgentDash UI only for auto launch; Buzz is future transport and retains explicit-approval requirements.
- AgentDash restart can reattach while CodeG remains live; a CodeG server restart interrupts current Work Tasks and produces an auditable retry decision.
- Cost auto eligibility is route-specific. An estimate or token counter without a hard dollar boundary is insufficient.
- AgentBrain recall is read-only from reviewed durable pages. Receipt-to-memory promotion remains a separate reviewed proposal workflow.
- Installed Hermes and CodeG distributions are not silently patched or upgraded.

## Source evidence used by this plan

- Approved local design: `docs/superpowers/specs/2026-08-02-ceo-mission-control-mvp-design.md`.
- CodeG `v0.23.0` release source, including the beta Work Task board: <https://github.com/xintaofei/codeg/releases/tag/v0.23.0>.
- Planning-time CodeG source inspection at commit `d665f7b1f87e2e41611ea47f289224f0b11c010e` established authenticated Work Task/ACP HTTP and WebSocket seams, independent conversation ids, replay sequence support, cancellation, and the `codeg://session/<conversation_id>` native form. Runtime implementation must re-prove these facts against its selected commit.
- Planning-time Hermes upstream inspection at commit `dd600d1ace727fc9f10c9f8763f21b564e25b06f` established the need for lifetime atomic ensure and explicit external-run ownership. Runtime implementation must re-prove these facts against its selected commit.

## Definition of done

This plan is complete only when the CEO can type one normal request, see one durable card before launch, review the deterministic route/policy, approve higher-stakes work or auto-launch a genuinely bounded route, watch original CodeG activity, open the exact CodeG conversation, inspect the immutable worker and finalization receipts, cancel or recover across AgentDash restart without duplicate work, and independently verify that the Hermes PM had no ability to perform the worker task.
