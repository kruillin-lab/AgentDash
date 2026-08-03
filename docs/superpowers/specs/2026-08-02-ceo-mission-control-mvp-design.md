---
tags:
  - type/spec
  - project/agentdash
  - status/active
  - workflow/brainstorming
  - stage/design
type: spec
project: agentdash
status: active
aliases:
  - CEO Mission Control MVP Design
---

# CEO Mission Control MVP Design

## Decision status

The product direction and repository are approved.

- Product home: AgentDash.
- Interface direction: one three-pane CEO workspace.
- Scope: one complete executable-task lifecycle.
- Implementation status: design only. Implementation planning starts after the
  user reviews this document.

This document is the implementation authority for the MVP. AgentBrain remains
the cross-project durable context authority; Hermes Kanban remains task and run
lifecycle authority; CodeG remains worker-session authority.

## Product statement

CEO Mission Control gives one person a normal conversation with a project
manager that turns executable requests into visible, governed work.

The user acts as CEO. A dedicated Hermes profile acts as the project manager.
The PM understands the request, creates or updates the work plan, chooses an
appropriate harness/model route, and reports results. It never performs the
requested worker task itself. CodeG creates and manages the actual worker
session. Every executable request is visible on the Hermes Kanban board before
execution, and every running card can reveal the exact CodeG session doing the
work.

## MVP slice

The first implementation proves this single vertical slice:

```text
natural-language request
  → durable Hermes task card
  → deterministic risk and approval decision
  → one Hermes task run / attempt
  → one CodeG worker session
  → live worker activity in AgentDash
  → original terminal receipt
  → PM summary linked to that receipt
```

The MVP is not a broad autonomous-company platform. It establishes the
authority boundaries, identifiers, recovery behavior, and interaction model
needed to add more workflows safely later.

## Goals

1. Give the CEO one conversational entry point for assigning and following
   work.
2. Create a Hermes Kanban card before any executable request is launched.
3. Auto-launch only work that passes a narrow low-risk, low-cost policy.
4. Require a detailed, stepwise routing plan and explicit approval for all
   other work.
5. Make the selected card show actual CodeG worker activity, not a generic
   “in progress” label.
6. Preserve an auditable identity chain from request to task, attempt, CodeG
   delegation, native CodeG conversation, optional harness session, and
   receipt.
7. Make restart, retry, cancellation, and partial failure behavior explicit.
8. Enforce the rule that the PM manages work but never executes worker work.

## Non-goals

- Buzz chat integration. Buzz remains an optional future transport.
- A company-wide portfolio, CRM, calendar, or team-management suite.
- Unbounded autonomous work or self-granted permissions.
- Automatic production deployment, external publishing, financial actions, or
  credential changes.
- A universal model benchmark or self-optimizing router.
- Migrating the preserved legacy AgentOS runtime back into the active app.
- Replacing Hermes Kanban, CodeG, or AgentBrain with AgentDash-owned lifecycle
  storage.
- Supporting every CodeG harness on day one. The adapter is generic, but each
  enabled route must pass a capability proof before it can launch.

## Existing foundations

AgentDash already provides the right UI and server boundaries:

- The current Next.js application keeps credentials and process access
  server-side.
- The OpenCode surface demonstrates a three-column session interface and live
  event projection.
- The Hermes surface demonstrates defensive CLI parsing and local session
  access.
- [ChatShell](../../../src/components/ChatShell.tsx) and the current visual
  primitives provide the conversation foundation.
- [AppShell](../../../src/components/AppShell.tsx) provides the active local
  Mission Control shell.

The preserved legacy runtime is precedent, not authority. Its useful contracts
are restart orphaning, interrupt-versus-kill semantics, exact-once initial
prompt delivery, bounded activity logs, CWD containment, and receipts with
changed files, commands, evidence, verification, and completion judgment.
Retired memory paths and legacy GoalBuddy lifecycle states are not reused.

## System ownership

| Component | Owns | Must not own |
| --- | --- | --- |
| CEO | Goals, priorities, approvals, cancellations, final judgment | Harness mechanics or worker supervision |
| AgentDash | Three-pane UI, deterministic policy enforcement, adapter coordination, projections, reconciliation | Canonical task lifecycle or worker execution |
| Hermes PM | Conversation, clarification, decomposition, routing proposal, status explanation, result summary | Filesystem edits, terminal work, research deliverables, browser work, deployment, or repair |
| Hermes Kanban | Tasks, statuses, attempts/runs, events, comments, attachments, receipts, dependencies | CodeG process/session truth |
| CodeG | Harness selection endpoint, worker session creation, worker activity, cancellation, native session view | Business priority, approval policy, or task lifecycle |
| AgentBrain | Durable cross-project context and reviewed recall | Transient task state, live logs, credentials, or automatic promotion of worker output |
| Buzz | Optional future conversation transport | PM runtime, lifecycle authority, or automatic dispatch |

## Direction A interaction contract

The primary route is a full-height three-pane workspace.

### Left: Project Manager

- A normal-language conversation with the dedicated Hermes PM profile.
- PM responses state what card was created or updated, the proposed
  harness/model route, limits, and whether approval is required.
- The PM pane exposes management actions only: clarify, plan, approve, cancel,
  retry, reprioritize, and request status.
- It does not expose the current Hermes PTY spawn/input/interrupt/kill controls.
- Worker results shown by the PM are summaries with links to the original
  attempt receipt.

### Center: Work board

- Renders Hermes Kanban state; it does not maintain a client-only task model.
- Every executable request gets a card before launch.
- Clarification replies, casual conversation, status questions, approvals, and
  cancellations update existing context and do not create duplicate cards.
- Cards show the exact harness, model/config, policy mode, current activity,
  elapsed time, and cost when known.
- Selecting a card changes the right pane immediately and visibly.

### Right: Selected attempt and session

- Shows the selected task, attempt, CodeG delegation, native conversation, and
  underlying harness-session identity when CodeG exposes one.
- Header identity is always visible:
  `task_id → run_id/attempt_id → codeg_task_id → codeg_conversation_id`, plus
  `harness_session_id` when available.
- Tabs:
  - **Live** — timestamped original worker messages, tool activity, and checks.
  - **Files** — worker-reported changed or produced files.
  - **Checks** — tests, validations, policy ceilings, and their current state.
  - **Receipt** — the original terminal worker receipt.
- **Open in CodeG** uses the exact URI returned by the proven CodeG adapter.
  AgentDash never constructs a URI by guessing which identifier belongs in
  `codeg://session/<id>`.
- Before CodeG supplies a native conversation and usable URI, the button reads
  **No session yet** and is disabled.
- A high-risk unapproved card shows its detailed plan in this pane and confirms
  that no CodeG session exists.

The pane must never invent activity. If CodeG has not reported a message, tool
event, check, or terminal result, AgentDash says so plainly.

## Canonical data model

### TaskSpec

A versioned TaskSpec is generated for every executable request.

| Field | Meaning |
| --- | --- |
| `schema_version` | Starts at `agentdash.task-spec/v1` |
| `request_id` | Stable idempotency id for the originating CEO request |
| `title` | Short card title |
| `objective` | Outcome the worker must produce |
| `acceptance_checks` | Observable completion criteria |
| `constraints` | User and project restrictions |
| `prohibited_actions` | Explicitly disallowed capabilities |
| `project_id` | Hermes project or AgentDash workspace reference |
| `workspace` | Validated directory or isolated-worktree policy |
| `required_capabilities` | Capabilities needed to perform the task |
| `risk_mode` | `auto` or `approval_required` |
| `budget` | Maximum cost and runtime |
| `route` | Selected harness, model/config, provider if required, and rationale |
| `plan_revision` | Monotonic revision used by approval grants |
| `source_refs` | AgentBrain pages or user-supplied inputs, never secrets |

Hermes Kanban fields remain canonical for title, body, assignee, project,
workspace, priority, model/provider overrides when applicable, and runtime
limit. The complete versioned TaskSpec and policy snapshot are attached to the
card before it can leave a non-runnable state. AgentDash does not create a
second task database.

### Attempt and CodeG binding

- Hermes `task_runs.id` is the canonical `attempt_id`.
- A CodeG dispatch has an opaque `codeg_task_id`.
- A native CodeG conversation has a separate opaque
  `codeg_conversation_id`.
- The underlying harness may expose a third opaque `harness_session_id`; it is
  optional and must not be substituted for the CodeG conversation id.
- The binding is scoped to exactly one Hermes run.
- A typed, append-only Kanban event records the delegation immediately after
  dispatch returns. If CodeG resolves the conversation later, a second event
  records that resolution without rewriting the first.
- The same binding and final route facts are copied into the closing run's
  structured metadata.
- A retry creates a new Hermes run and a new CodeG binding. It never overwrites
  an earlier attempt.

The required binding event is:

```json
{
  "schema": "agentdash.external-session/v1",
  "phase": "conversation_resolved",
  "task_id": "t_example",
  "attempt_id": 42,
  "executor": "codeg",
  "codeg_task_id": "opaque-delegation-id",
  "codeg_conversation_id": "opaque-conversation-id",
  "harness_session_id": "opaque-harness-session-id",
  "native_uri": "adapter-returned-native-uri",
  "harness": "codex",
  "model": "resolved-model",
  "policy_snapshot_id": "policy-id"
}
```

Hermes Kanban already supports run-scoped events and free-form closing-run
metadata. The MVP may add one narrow supported adapter operation for binding an
external session; AgentDash must not write directly to `kanban.db`. During a
`delegation_bound` event, unresolved optional fields are `null`; a later
`conversation_resolved` event supplies only values CodeG actually returned.
All CodeG identifiers are persisted and compared as opaque strings.

### ApprovalGrant

An approval is one-time and narrowly scoped:

- task id;
- next attempt ordinal and eventual run id;
- plan revision;
- harness/model route;
- allowed capabilities and resource/workspace;
- cost and runtime ceiling;
- expiry;
- approving user and timestamp.

A changed route, broader capability, different resource, expired grant, or new
plan revision requires a new approval.

### Receipt

The original terminal receipt contains:

- task, attempt, and CodeG identities;
- harness/model route and resolved policy;
- outcome and concise worker summary;
- changed/produced files;
- checks and their raw results;
- cost, runtime, and token data when CodeG exposes them;
- unresolved gaps, uncertainty, and unsupported claims;
- cancellation, timeout, or failure detail;
- a link to the native CodeG session.

The PM may summarize this receipt but may not replace or silently rewrite it.

## Hermes Kanban state projection

Hermes states remain canonical:
`triage`, `todo`, `scheduled`, `ready`, `running`, `blocked`,
`review`, `done`, and `archived`.

The simple board groups them for the CEO:

| CEO lane | Hermes state | Presentation |
| --- | --- | --- |
| Ready | `triage`, `todo`, `scheduled`, `ready` | Preserve the exact source state as a chip |
| Working | `running` | Show current CodeG activity, attempt, elapsed time, and cost |
| Needs you | `blocked`, `review` | Show approval, capability, input, or review reason |
| Completed filter | `done` | Show receipt and verification result |
| Archive | `archived` | Hidden by default |

`cancelling` is a temporary UI action state only. The canonical task remains
`running` until CodeG confirms cancellation and Hermes closes or reclaims the
run.

## PM capability isolation

The dedicated `luisos-pm` Hermes profile is capability-limited.

Allowed:

- conversation and clarification;
- AgentBrain recall;
- TaskSpec and plan drafting;
- risk classification and route proposal;
- capability-registry reads;
- create/update/comment/attach actions through the Kanban adapter;
- approval, dispatch, status, retry, and cancellation intents through the
  deterministic AgentDash controller;
- summarization of original worker receipts.

Forbidden:

- filesystem mutation;
- shell or terminal execution;
- code editing;
- requested research or deliverable production;
- browser/computer actions;
- deployment or external business mutations;
- credentials and secret management;
- diagnosing or repairing worker output by doing the worker's task.

The restriction is enforced by tool availability and controller validation,
not by prompt text alone.

## Capability registry and routing

Routing happens in two stages:

1. Choose the harness whose execution environment and tools fit the TaskSpec.
2. Choose the model/provider/config available inside that harness.

The PM reads a server-owned capability registry. It cannot add capabilities or
declare a route healthy. Each entry records:

- CodeG harness id;
- available model/config choices;
- supported task classes and required workspace mode;
- tool/capability set;
- cost class and default ceilings;
- current health and last verification;
- whether cancellation, activity inspection, and native deep-linking are
  proven.

The selected route is persisted with the TaskSpec and receipt. Runtime
availability may invalidate a route, but the PM cannot silently substitute a
route whose capabilities, resources, or approval scope differ.

## Risk and launch policy

The MVP has only two policy modes.

### Auto

A task auto-launches only when every condition is true:

- estimated total cost is at most **$1.00**;
- runtime ceiling is at most **30 minutes**;
- the controller can enforce the runtime ceiling with its own watchdog and a
  proven CodeG cancellation or safe-stop path with bounded stop latency;
- the controller can enforce the cost ceiling using current telemetry plus a
  cancellation path whose worst-case lag cannot exceed the remaining budget,
  or a conservative prepaid/request bound that cannot exceed $1.00; an estimate
  alone never qualifies;
- work is read-only or confined to a validated local workspace/isolated
  worktree;
- no production, deployment, publishing, messaging, payment, credential,
  permission, destructive-delete, or sensitive-data capability is required;
- no new capability grant is needed;
- acceptance checks and prohibited actions are explicit;
- the chosen CodeG route has a current capability proof;
- the card, TaskSpec, policy snapshot, and launch intent are durable before
  dispatch.

### Approval required

Anything else is created in a non-runnable blocked state. The PM presents an
ordered plan whose every step names:

- objective and expected artifact;
- harness and model/config;
- required capabilities;
- workspace/resource;
- cost and runtime ceiling;
- acceptance check;
- rollback or safe-stop point.

No CodeG task or session is created until a valid ApprovalGrant is bound.

## End-to-end flows

### New executable request

1. AgentDash assigns a `request_id` and sends the message to the Hermes PM.
2. The PM returns conversational text plus a structured management proposal.
3. The deterministic controller validates the proposal.
4. Hermes Kanban atomically creates or returns the one non-runnable card for
   the `request_id` before any dispatch.
5. AgentDash persists the TaskSpec, route, policy snapshot, and limits on the
   card.
6. Auto tasks are released to the CodeG execution bridge. Approval-required
   tasks remain blocked.
7. Hermes creates the canonical run when the bridge claims the task.
8. The bridge delegates the TaskSpec to CodeG and binds the returned CodeG
   identities to that run.
9. AgentDash projects CodeG activity into the selected session pane.
10. The bridge closes the Hermes run with the original receipt and structured
    metadata.
11. The PM posts a concise summary linked to the receipt.

### Non-executable message

Clarification, casual conversation, a status request, approval, cancellation,
or retry instruction updates the relevant conversation/task. It does not create
a new card unless the CEO clearly introduces a new deliverable.

### High-risk approval

1. Card exists in `blocked` with no CodeG session.
2. The PM presents the detailed plan in conversation and the selected-card
   pane.
3. The CEO approves the current plan revision.
4. AgentDash validates and records the ApprovalGrant.
5. The card becomes runnable and follows the normal execution flow.

### Cancellation

1. AgentDash records `cancel_requested` against the active run and shows the
   temporary cancelling projection.
2. CodeG receives cancellation for the exact delegation/session.
3. Until confirmation, the task remains canonically running.
4. On confirmation, Hermes reclaims/closes the run with a user-cancelled reason
   and blocks the task for an explicit retry-or-archive decision.
5. A late worker completion is recorded as a race diagnostic; it does not
   silently change the task to done.

## CodeG adapter contract

AgentDash depends on behavior, not guessed HTTP method names.

Required operations:

- `dispatch(TaskSpec, route, idempotency_key)`;
- `lookupDispatch(idempotency_key)` with definitive `found`, `not_found`, or
  `unknown` results;
- `observe(codeg_task_id, cursor)`;
- `resolveConversation(codeg_task_id)`;
- `inspectConversation(codeg_conversation_id)`;
- `cancel(binding)`, using the exact known delegation, conversation, and
  harness identities;
- `nativeUri(binding)`, returning a verified adapter value or unavailable
  rather than guessing which identifier the native URI accepts.

Local capability discovery on 2026-08-02 confirmed that the installed CodeG
companion exposes asynchronous delegation, delegation status, cancellation,
and read-only session inspection. It documents
`codeg://session/<id>`-shaped references but does not prove which identifier
fills `<id>`. It also advertises multiple harness types, including Codex,
Claude Code, OpenCode, Gemini, Hermes, Kimi Code, and others.

Evidence for these claims is the read-only 2026-08-02 `--help` and MCP tool
schema probe of
`C:\Users\kruil\AppData\Local\codeg\codeg-mcp.exe`, which exposed
`delegate_to_agent`, `get_delegation_status`, `cancel_delegation`, and
`get_session_info`. This local probe is not an API-stability guarantee.

Four facts remain implementation gates rather than assumptions:

1. Determine when the asynchronous delegation exposes the native conversation
   id, whether it also exposes a harness session id, and which identifier the
   native URI accepts.
2. Prove an activity stream or bounded incremental message/tool snapshot that
   can drive the Live pane.
3. Prove lookup and reconciliation by dispatch idempotency key after an
   ambiguous transport outcome.
4. Prove enforceable runtime and cost ceilings for every auto-capable route.

Auto-launch remains disabled until the adapter proves idempotent dispatch,
lookup/reconciliation, cancellation, identity resolution, orphan
reconciliation, and budget enforcement. A generic `running` status alone does
not satisfy the Live-pane acceptance criterion.

## Hermes integration contract

- Use supported Hermes Kanban CLI/REST/WebSocket/plugin interfaces; never write
  directly to the SQLite database.
- Create cards with a supported atomic create-if-absent operation keyed by
  `request_id`, initially non-runnable while TaskSpec and policy artifacts are
  attached. A preflight lookup plus create, or an in-memory lock, is not
  sufficient because it can race across processes or restarts.
- If Hermes does not expose that atomic operation, add one narrow supported
  extension before dispatch is enabled; never simulate it with direct SQLite
  writes.
- Use the canonical Kanban run id as the attempt id.
- Emit the external-session binding as a run-scoped typed event.
- Heartbeat the active bridge run while CodeG is working.
- Close runs with CodeG receipt metadata.
- Use the real Kanban failure outcomes and typed block reasons.
- Preserve append-only prior attempts.

The CodeG execution bridge is separate from `luisos-pm`. It may delegate and
monitor work but has no authority to reinterpret the CEO's goal, expand
capabilities, or approve itself.

## AgentBrain contract

- PM recall reads reviewed AgentBrain pages only.
- AgentBrain references in TaskSpec are provenance, not copied secrets or raw
  transcripts.
- Live activity, task status, CodeG messages, and receipts remain in their
  operational systems.
- A completed receipt may produce a proposal for durable memory, but nothing is
  promoted into AgentBrain automatically.

The existing
[LuisOS PM through Buzz](../../../../AgentBrain/pages/luisos-pm-through-buzz.md)
page remains authoritative for Buzz. In particular, Buzz-originated mutations
and dispatch require explicit approval. Therefore MVP auto-launch applies only
to the local AgentDash CEO interface.

## Failure, retry, and restart behavior

| Failure | Required behavior |
| --- | --- |
| Kanban card or TaskSpec persistence fails | Do not call CodeG; report the management failure |
| Concurrent card creation for one request | Atomic create-if-absent returns the winner; bind both callers to it and never create a second card |
| CodeG rejects dispatch | Close/block the attempt with the error; do not show a fake session |
| CodeG dispatch result is unknown | Quarantine the run, look up by idempotency key, and never redispatch until CodeG proves the prior delegation exists or does not exist |
| Binding persistence fails after CodeG starts | Cancel CodeG immediately, record an orphan diagnostic, and block the task |
| CodeG activity connection drops | Keep identities visible, show disconnected, and reconcile without creating another session |
| AgentDash restarts | Rehydrate from Kanban, resolve every active CodeG binding, and never dispatch merely because the UI reloaded |
| Active run has no binding | Mark it inconsistent and block automated continuation |
| Worker times out or crashes | One automatic retry is allowed only for an auto-mode task with a classified transient infrastructure failure; approval-required work blocks for a new grant |
| Worker produces a semantic or quality failure | No automatic retry; move to review/blocked with evidence |
| Receipt persistence fails | Keep the task out of done; preserve CodeG result and retry receipt attachment |
| Cost or runtime ceiling is reached | Request cancellation and block for CEO review |

Hermes's default consecutive-failure circuit breaker is compatible with one
automatic retry for eligible auto-mode work followed by a block on the second
transient failure.

## Idempotency and race rules

- One CEO request id maps to at most one Hermes task for its lifetime, including
  after archive. An intentional repeat receives a new request id and may link
  back to the prior task.
- That invariant depends on atomic Hermes create-if-absent semantics. A
  lookup-then-create implementation is not assumed safe; controller
  serialization is only an optimization, not the correctness boundary.
- A launch-intent event is durable before CodeG dispatch.
- The CodeG adapter receives an idempotency key derived from task and attempt.
- Every dispatch attempt is followed by lookup using that key when its outcome
  is ambiguous. The run is quarantined while lookup remains `unknown`.
- Redispatch is permitted only after CodeG authoritatively reports
  `not_found`; a transient listing absence is not sufficient. A `found`
  result binds the existing delegation to the run.
- Terminal outcomes use compare-and-set semantics: the first accepted terminal
  transition wins; later conflicting signals become diagnostics.
- Approval is consumed by one attempt only.

## Security and cost boundaries

- Bind AgentDash and supporting local services to `127.0.0.1`.
- Keep provider credentials, CodeG connection tokens, and Hermes secrets
  server-side.
- Validate real workspace paths and allowlisted project roots before launch.
- Use a fixed harness/capability registry; never execute an arbitrary command
  supplied by the PM.
- Do not place secrets in prompts, Kanban bodies, comments, attachments,
  AgentBrain, logs, or receipts.
- Require explicit approval for capability expansion or external side effects.
- Enforce budget and timeout in the deterministic controller and in Hermes or
  CodeG where supported. If cost telemetry, a conservative prepaid bound, or a
  proven cancellation/safe-stop path is missing, fail closed to approval
  required.
- Preserve the legacy distinction between interrupt/cancel and kill/forced
  termination.

## Testing strategy

### Contract tests

- Hermes adapter: atomic create-if-absent, attach, block/unblock, claim/run
  identity, events, comments, receipts, retries, and reconnect.
- CodeG adapter: dispatch, lookup by idempotency key, status/activity cursor,
  opaque conversation and harness-session resolution, verified native URI,
  cancel, terminal result, and missing-session behavior.
- AgentBrain adapter: reviewed-page recall and failure without mutation.

### Policy tests

- Auto policy accepts only the complete low-risk predicate.
- Unenforceable cost or runtime ceilings always require approval.
- Every prohibited capability forces approval.
- Route or plan revision invalidates prior approval.
- PM output cannot bypass controller validation.
- Non-executable conversation does not create cards.

### State-machine tests

- Duplicate request and duplicate dispatch.
- Concurrent request creation and atomic winner selection.
- Unknown dispatch outcome, quarantine, lookup, and safe resolution.
- Dispatch failure before and after CodeG starts.
- AgentDash restart during running work.
- Missing binding, orphaned CodeG session, and stale heartbeat.
- Cancellation/completion race.
- Eligible auto-mode transient retry followed by success.
- Repeated transient failure followed by block.
- Semantic failure with no retry.
- Receipt failure before done.

### UI tests

- Selecting each card visibly changes the active card and right pane.
- Live, Files, Checks, and Receipt tabs show the selected attempt only.
- High-risk cards show a detailed plan and no CodeG session.
- Open in CodeG points to the exact session and is keyboard accessible.
- No control looks active without a visible consequence.
- PM summaries link to original receipts.

### End-to-end acceptance

Run with a test board and harmless local workspaces:

1. Low-risk read/research task creates a card, auto-launches through CodeG, and
   exposes real activity and its native session.
2. Low-risk isolated code task respects the $1/30-minute/no-deploy limits and
   reports files and checks.
3. Production-migration request creates a detailed blocked plan and no session.
4. Approval launches exactly the approved route once.
5. Restart during a live task reconnects to the same CodeG session.
6. Cancellation reaches the exact session and leaves an auditable outcome.
7. A terminal receipt appears before the task becomes done.
8. The PM cannot perform the requested work when CodeG is unavailable.

## Implementation boundaries

The implementation plan should remain a sequence of thin slices:

1. Prove CodeG delegation, idempotency lookup, activity, opaque conversation
   and harness identities, verified native URI, enforceable ceilings, cancel,
   and reconnect behavior.
2. Add read-only Hermes Kanban projection to the Direction A layout.
3. Add PM structured-intent conversation with capability isolation.
4. Add durable TaskSpec/policy creation with all tasks initially non-runnable.
5. Add the external CodeG bridge and run/session binding.
6. Add low-risk auto-launch and high-risk approval.
7. Add live activity, files, checks, receipts, and native deep links.
8. Add restart, retry, cancellation, diagnostics, and end-to-end verification.

Each slice must end in observable behavior and preserve existing OpenCode,
Hermes, Agent Fleet, and legacy-reference surfaces.

## Acceptance definition

The MVP is accepted only when the CEO can type a normal executable request and
observe one durable card travel through the governed lifecycle into one exact
CodeG session, watch original worker activity, inspect the original receipt,
and recover correctly from restart or cancellation—while the Hermes PM remains
technically unable to do the worker task itself.
