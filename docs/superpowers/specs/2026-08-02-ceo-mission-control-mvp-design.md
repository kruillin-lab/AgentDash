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

The product direction, repository, model-role evaluation baseline, and bounded
continuous-execution amendment are approved in conversation.

- Product home: AgentDash.
- Interface direction: one three-pane CEO workspace.
- Scope: one complete executable-task lifecycle that continues automatically
  from dispatch to a truthful terminal result.
- PM inference: GPT-5.6 Terra inside the isolated Hermes PM profile, with
  Claude Sonnet 5 as the candidate fallback.
- Model routing: the 21 user-requested inventory entries in this document are
  an evaluation baseline, not live routes.
- Implementation status: design only. The existing implementation plan must be
  revised only after the user reviews this amended document.

This document is the implementation authority for the MVP. AgentBrain remains
the cross-project durable context authority; Hermes Kanban remains task and run
lifecycle authority; CodeG remains worker-session authority.

## Product statement

CEO Mission Control gives one person a normal conversation with a project
manager that turns executable requests into visible, governed work.

The user acts as CEO. A dedicated Hermes profile acts as the project manager.
The PM understands the request, proposes creation or revision of the work plan,
chooses an appropriate harness/model route, and reports results. It never
performs the requested worker task itself. CodeG creates and manages the actual
worker session. Every executable request is visible on the Hermes Kanban board
before execution, and every running card can reveal the exact CodeG session
doing the work. Once AgentDash dispatches a task, its deterministic controller
continues through bounded retries, remediation, verification, and finalization
until the task reaches a terminal result or a typed CEO decision is genuinely
required.

## MVP slice

The first implementation proves this single vertical slice:

```text
natural-language request
  → durable Hermes task card
  → complete bounded execution mandate
  → deterministic auto-policy decision or one CEO approval
  → append-only Hermes action attempts / CodeG sessions where applicable
  → live activity and exact session links in AgentDash
  → bounded retry or remediation when needed
  → independent verification
  → authorized finalization
  → original worker, verification, and finalization receipts
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
9. Refuse dispatch unless the approved or auto-authorized mandate already
   contains a complete bounded path through verification and finalization.
10. After dispatch, continue automatically until success or a truthful terminal
    failure, without turning technical uncertainty or exhausted limits into a
    vague approval pause.

## Non-goals

- Buzz chat integration. Buzz remains an optional future transport.
- A company-wide portfolio, CRM, calendar, or team-management suite.
- Unbounded autonomous work, arbitrary fallback selection, or self-granted
  permissions.
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
| CEO | Goals, priorities, mandate approval, business/product decisions, cancellations, final judgment | Harness mechanics or worker supervision |
| AgentDash | Three-pane UI, deterministic policy enforcement, mandate validation, one-time action authority, adapter coordination, projections, reconciliation | Canonical task lifecycle or worker execution |
| Hermes PM | Conversation, clarification, decomposition, untrusted routing proposal, status explanation, result summary | Direct task/state/authority mutation, filesystem edits, terminal work, research deliverables, browser work, deployment, or repair |
| Hermes Kanban | Tasks, statuses, attempts/runs, events, comments, attachments, receipts, dependencies | CodeG process/session truth |
| CodeG | Harness selection endpoint, worker session creation, worker activity, cancellation, native session view | Business priority, approval policy, or task lifecycle |
| AgentBrain | Durable cross-project context and reviewed recall | Transient task state, live logs, credentials, or automatic promotion of worker output |
| Buzz | Optional future conversation transport | PM runtime, lifecycle authority, or automatic dispatch |

## Direction A interaction contract

The primary route is a full-height three-pane workspace.

### Left: Project Manager

- A normal-language conversation with the dedicated Hermes PM profile.
- PM responses state what card was created or updated, the proposed
  harness/model route for every lifecycle phase, aggregate limits, terminal
  action, and whether mandate approval is required.
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
  lifecycle phase, aggregate attempts, elapsed time, and cost when known.
- One card persists for the task's lifetime. Execution, remediation,
  verification, and finalization appear as append-only attempts on that card.
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
  - **Receipt** — immutable worker, verification, finalization, and aggregate
    terminal receipts.
- **Open in CodeG** uses the exact URI returned by the proven CodeG adapter.
  AgentDash never constructs a URI by guessing which identifier belongs in
  `codeg://session/<id>`.
- Before CodeG supplies a native conversation and usable URI, the button reads
  **No session yet** and is disabled.
- A deterministic controller or CodeG-engine action with no model conversation
  reads **No worker session for this action** rather than inventing one.
- A high-risk unapproved card shows its detailed plan in this pane and confirms
  that no CodeG session exists.
- Between attempts, the pane shows the controller's exact next scheduled
  action. It never collapses a retry, remediation, verification, or
  finalization phase into a generic “in progress” label.

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
| `budget` | Aggregate cost, runtime, and attempt ceilings for the complete terminal path |
| `route_plan` | Ordered execution, fallback, remediation, verification, and finalization routes |
| `finalization` | Exact terminal action and its required authority |
| `plan_revision` | Monotonic revision bound to the active execution mandate |
| `source_refs` | AgentBrain pages or user-supplied inputs, never secrets |

`TaskSpec revision` elsewhere in this document means the exact
`TaskSpec.plan_revision` value plus the serialized TaskSpec digest.

Hermes Kanban fields remain canonical for title, body, assignee, project,
workspace, priority, model/provider overrides when applicable, and runtime
limit. The complete versioned TaskSpec and policy snapshot are attached to the
card before it can leave a non-runnable state. AgentDash does not create a
second task database.

### ExecutionMandateV1

Every runnable task has one immutable active mandate revision. The mandate is
the bounded authority envelope for the complete terminal path, not permission
for the PM or a worker to choose new work.

| Field | Meaning |
| --- | --- |
| `schema_version` | `agentdash.execution-mandate/v1` |
| `mandate_id` | Stable opaque id for this mandate revision |
| `task_id` / `request_id` | Canonical Hermes task and originating CEO request |
| `task_spec_revision` | Exact TaskSpec revision and objective/acceptance hashes |
| `action_nodes` | Primary, retry, fallback, remediation, verification, and finalization actions with executor kind and exact route when model-backed |
| `transition_graph` | Closed mapping from every typed action outcome to one next action, bounded reconciliation node, typed CEO-input leaf, or terminal leaf |
| `visit_caps` | Maximum visits per action/edge; the graph must mechanically expand to a finite state space |
| `verification_step` | Independent route, immutable acceptance checks, required independence tier, and path-specific independence proof |
| `finalization_step` | Exact no-change close, artifact delivery, local patch, or approved merge action with mutation-manifest, expected-post-state, and drift preconditions |
| `capability_scope` | Allowed tools, side effects, data classes, and prohibited actions |
| `workspace_scope` | Canonical project/resource and validated path or worktree boundary |
| `aggregate_budget` | Maximum total cost, elapsed runtime, action attempts, and provider usage |
| `per_action_limits` | Tighter route-specific timeout, cost, and output limits |
| `budget_proof` | Worst-case reachable-path calculation with task-level downstream and recovery reserves carried once per mandate |
| `reconciliation_limits` | Numeric lookup, cancellation, orphan, finalization, and receipt-delivery attempts/deadlines |
| `expiry` | Last time a new action may begin under this mandate |
| `authority_source` | One CEO ApprovalGrant or one current auto-policy receipt |

AgentDash enforces a **no-start invariant**: it refuses dispatch unless the
mandate already authorizes a complete, bounded path through required
verification and finalization. Known missing authority is obtained before
launch, not discovered as a planned approval pause after work has started.

The validator mechanically expands the graph using its visit caps. Every
possible `ActionOutcomeV1` from every action node must have exactly one edge.
Every expanded path must end at an action, bounded reconciliation node, typed
CEO-input leaf, or terminal task outcome. A remediation action must name the
finding classes and artifact scope it may address; “fix findings” is not a
valid open-ended action.

For every reachable path, worst-case cost, runtime, attempts, and provider use
must fit the aggregate ceiling. The task ledger carries verification,
finalization, cancellation, and reconciliation reserves once for the active
mandate; sequential commands reference rather than duplicate those reserves.
Success-capable branches preserve the full task-level verification and
finalization reserve before another worker action starts. Every branch
preserves cancellation and reconciliation reserve. A path that cannot preserve
those reserves is not runnable.

The mandate does not directly authorize an adapter call. Before each launch,
resume, retry, remediation, verification, or finalization action, the
controller validates current route proof, graph reachability, and remaining
aggregate reserves, then issues one durable action-scoped authority. That
authority may be redeemed once into one replay-safe ActionCommandV1; transport
retries reuse the command rather than authority. The PM cannot create, grant,
widen, redeem, or consume either form of authority.

### Action attempt and CodeG binding

- Hermes `task_runs.id` is the canonical `attempt_id` for each controller
  action.
- A model-backed CodeG dispatch has an opaque `codeg_task_id`.
- Its native CodeG conversation has a separate opaque
  `codeg_conversation_id`.
- The underlying harness may expose a third opaque `harness_session_id`; it is
  optional and must not be substituted for the CodeG conversation id.
- The CodeG binding is scoped to exactly one Hermes run. Deterministic
  controller or CodeG-engine finalization actions still receive an attempt,
  action authority, event trail, and receipt, but no fake conversation id.
- Every run declares an `action_role`: `execute`, `retry`, `remediate`,
  `verify`, or `finalize`.
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
  "executor_kind": "codeg_worker",
  "codeg_task_id": "opaque-delegation-id",
  "codeg_conversation_id": "opaque-conversation-id",
  "harness_session_id": "opaque-harness-session-id",
  "native_uri": "adapter-returned-native-uri",
  "harness": "codex",
  "model": "resolved-model",
  "policy_snapshot_id": "policy-id",
  "mandate_id": "mandate-id",
  "action_role": "verify",
  "action_authority_id": "one-time-action-authority-id"
}
```

Hermes Kanban already supports run-scoped events and free-form closing-run
metadata. The MVP may add one narrow supported adapter operation for binding an
external session; AgentDash must not write directly to `kanban.db`. During a
`delegation_bound` event, unresolved optional fields are `null`; a later
`conversation_resolved` event supplies only values CodeG actually returned.
All CodeG identifiers are persisted and compared as opaque strings.

### CEOCommandV1

Only an authenticated command from the local AgentDash CEO interface can
express approval, cancellation, retry, or another authority-bearing decision.
The controller—not the PM—renders the actionable command from current
server-owned state. A `CEOCommandV1` records:

- `command_id` and a single-use replay nonce;
- authenticated local CEO session and CSRF/origin validation result;
- command type and exact task id;
- currently displayed TaskSpec revision and proposed/active mandate id;
- digest of the complete controller-rendered mandate the CEO saw;
- exact requested decision and timestamp.

The controller accepts the command only while its nonce is unused and its
displayed revision/digest still matches server state. A natural-language CEO
reply may trigger this command flow, but PM text, PM-produced markup, tool
output, or PM-interpreted semantics can never count as the command. The PM may
ask for a decision; it cannot originate, authenticate, replay, or consume one.

### ApprovalGrant

A CEO ApprovalGrant is one-time and narrowly scoped to activation of one exact
ExecutionMandateV1 revision:

- task id, TaskSpec revision, and mandate id;
- immutable objective and acceptance hashes;
- ordered primary, fallback, remediation, verification, and finalization
  routes;
- capability and workspace scope;
- aggregate cost, runtime, and attempt ceilings;
- authorized finalization predicate and maximum external or irreversible
  mutation, if any;
- expiry, approving user, timestamp, and source `CEOCommandV1.command_id`.

The controller derives an ApprovalGrant only from a valid `CEOCommandV1`.
The grant is consumed when the mandate becomes active; it is not consumed once
per worker attempt. Auto-mode activation uses a durable auto-policy receipt
with the same immutable mandate binding.

Any change to the objective or acceptance criteria requires typed CEO input, a
new TaskSpec revision, and a new mandate approval. The same is true for an
unforeseen business/product decision, a route/capability/workspace/budget
change outside the active mandate, or a new external or irreversible action.
An exact named fallback already present in the mandate is not a change, but it
must still have current level-5 route proof and fit the remaining aggregate
limits.

### ActionAuthorityV1 and ActionCommandV1

The controller may issue an `ActionAuthorityV1` only for one reachable
transition-graph node under the active mandate. It binds the task/mandate
revision, node id and action role, exact executor/route proof, immutable action
input digest, that action's worst-case headroom plus references to the
task-level downstream/recovery reserves, expiry, and allowed adapter operation.

Redeeming the authority does not make a one-shot transport call. It creates one
durable logical `ActionCommandV1` with:

- a stable command id and idempotency key;
- the authority, TaskSpec, mandate, transition-node, route-proof, and action
  input digests;
- executor kind and exact adapter operation;
- its own worst-case cost/runtime/attempt headroom plus references to the
  mandate's task-level verification, finalization, cancellation, and
  reconciliation reserves;
- state: `prepared`, `submitted`, `unknown`, `found`, `terminal`, or
  `revoked`;
- creation, submission, reconciliation, and expiry timestamps.

The controller persists the command and budget reservation through a supported
atomic Hermes operation before transport, and mirrors delivery/result material
in a durable controller recovery outbox. A prepared outbox entry without a
matching Hermes redemption is never dispatchable. A matching Hermes command
can reconstruct a lost local outbox marker after restart.

Transport may repeat only the same logical command with the same idempotency
key. If a crash occurs after redemption but before or during dispatch, restart
performs lookup first. A definitive `not_found` may replay that same command
while it remains valid; `found` binds the existing work; `unknown`
quarantines it. Only a command proven unsubmitted may be revoked. Submitted or
unknown commands must be reconciled or cancelled; mandate supersession or CEO
cancellation revokes future authorities and proven-unsubmitted commands, never
an uncertain external effect.

The recovery outbox is operational delivery state, not a second task database.
It stores only the minimum redacted command/result material needed to deliver
Hermes events and receipts, has bounded retention, and cannot override Hermes
task/run lifecycle truth.

### CEOInputRequestV1

A typed CEO input request is not authority. It records:

- `schema_version: agentdash.ceo-input-request/v1`;
- task and current TaskSpec revision;
- `active_mandate_id`, which is null for initial approval, and the exact
  `proposed_mandate_id`;
- decision type: `initial_mandate_approval`, `objective_change`,
  `acceptance_change`,
  `business_product_decision`, `route_change`, `capability_change`,
  `workspace_change`, `budget_change`, or `new_external_action`;
- the exact proposed diff and why the current mandate cannot complete it;
- original evidence and completed-attempt receipts;
- proof that no unapproved action is running;
- the proposed new limits, routes, or side effects;
- creation time and expiry.

For initial approval, the request binds the complete proposed mandate digest.
For later decisions, the CEO's response creates or rejects a proposed TaskSpec
revision through the controller. It never edits the active mandate in place.

### ActionOutcomeV1 and TaskOutcomeV1

The controller never asks a model to decide what happened. It derives one
`ActionOutcomeV1` from adapter evidence, required checks, durable controller
events, and server-owned classification rules:

- `succeeded`;
- `transient_infrastructure`;
- `semantic_failure`;
- `verification_failure`;
- `policy_violation`;
- `cancelled`;
- `timed_out`;
- `budget_exhausted`;
- `route_unavailable`;
- `ceo_input_required`; or
- `ambiguous`.

The outcome records command/attempt identities, raw evidence references,
adapter terminal code and sequence when available, required-check results,
budget snapshot, classifier-policy version, and classification rationale.
Evidence precedence is deterministic:

1. An authority, workspace, capability, or prohibited-action violation wins
   over a model or worker claim of success.
2. A CodeG terminal event accepted before a durable cancel/timeout intent may
   win terminal CAS. Once cancel/timeout intent is durable, a later or
   unordered completion cannot become success; it is a race diagnostic.
3. `unknown` transport state remains `ambiguous` until bounded lookup. A
   definitive `not_found` permits replay of the same ActionCommandV1; it is
   not proof of action failure or permission to create a new command.
4. Only an allowlisted adapter/provider failure code is
   `transient_infrastructure`. Test failure, rejected output, missing
   artifact, and model-reported difficulty are semantic or verification
   failures.
5. A failed or missing required check overrides a verifier's prose “pass.” A
   verifier failure with evidence overrides worker self-assessment. Unresolved
   verifier/check disagreement is `verification_failure`, never success.
6. `ceo_input_required` requires a typed proposed change that maps to a
   CEOInputRequestV1 decision type and controller proof that the current
   TaskSpec/mandate cannot decide it. Model prose alone is insufficient.
7. `succeeded` requires the authoritative adapter terminal signal and every
   action-specific required check.

Model summaries are non-authoritative evidence only. The finite mandate graph
maps each action outcome to its sole permitted next node.

`TaskOutcomeV1` is separate. It may become `succeeded` only after the
required verification and finalization receipts match the active TaskSpec,
mandate, and artifact identities. Other terminal values are `failed`,
`timed_out`, `budget_exhausted`, `cancelled`, `route_unavailable`, or
`inconsistent`. Terminal task outcome uses compare-and-set; later signals are
diagnostics and cannot reopen the task.

### Receipts

Each controller action produces an immutable action receipt containing:

- task, mandate, action authority, and attempt identities, plus CodeG identities
  when applicable;
- action role, executor kind, harness/model route when applicable, and resolved
  policy;
- outcome and concise worker summary;
- changed/produced files;
- checks and their raw results;
- cost, runtime, and token data when CodeG exposes them;
- unresolved gaps, uncertainty, and unsupported claims;
- cancellation, timeout, or failure detail;
- a link to the native CodeG session for model-backed worker actions, or an
  explicit not-applicable marker for deterministic actions.

The controller preserves worker receipts and adds separate verification and
finalization receipts. A final aggregate receipt references every attempt,
reports path-wide budget use, and records one truthful terminal outcome:
`succeeded`, `failed`, `timed_out`, `budget_exhausted`, `cancelled`,
`route_unavailable`, or `inconsistent`. The PM may summarize these receipts
but may not replace or silently rewrite them.

### Verification independence and artifact-bound finalization

The mandate declares one minimum verification independence tier. The
controller also maintains the **realized mutating-route set**: every
model-backed route that has changed the candidate artifact since its last
accepted immutable artifact baseline. A remediation that mutates the artifact
adds its route to this set, invalidates any earlier verification receipt, and
requires verification of the new artifact lineage.

- **Tier 1** — a separate read-only verifier session that cannot mutate the
  deliverable or share any mutating worker's session authority. The same
  provider may be used only for low-risk work.
- **Tier 2** — when model-based, a verifier whose provider **and** outer harness
  are each different from every route in the realized mutating-route set, or an
  independently trusted deterministic verifier whose checks completely decide
  the acceptance criteria.

High-risk work requires Tier 2 and fails the no-start invariant when no current
proven verifier satisfies it. The no-start validator checks every expanded
success-capable path, including each permitted remediation path, and requires a
path-specific Tier 2 verifier that would remain independent from all mutating
routes preceding verification on that path. Runtime verification repeats this
check against the actual realized mutating-route set. CEO approval cannot waive
this MVP safety floor.

`VerificationReceiptV1` binds the TaskSpec and mandate revisions, immutable
acceptance checks, source artifact-set digest, the complete realized
mutating-route set, verifier route/proof or deterministic-check identity,
path-specific independence proof, independence tier, raw results, and outcome.

The approved mandate contains a finalization predicate, not permission to merge
an arbitrary future artifact. After successful verification, the controller
may create one `FinalizationCommandV1` only when it binds:

- the exact TaskSpec and mandate revisions;
- source artifact/commit digest and matching VerificationReceiptV1 digest;
- expected base and target identities/revisions;
- allowed mutation type, path/diff scope, and prohibited changes;
- the exact mutation manifest and patch/diff digest, including a canonical
  empty-mutation digest for a no-change close;
- the exact expected post-state artifact/tree/resource digest, or a
  deterministic postcondition when the adapter cannot expose a stable digest;
- target-head or external-resource compare-and-set precondition;
- exact adapter operation, idempotency key, and action authority.

The finalizer rechecks all bindings immediately before mutation and records an
immutable finalization receipt after it. The receipt must prove that the
adapter applied the exact mutation manifest and that the observed post-state
matches the bound digest or deterministic postcondition before the task can
succeed. A mutation can be inside the allowed scope and still fail
finalization when its exact patch or post-state differs. Artifact, base, target,
mutation-manifest, expected-post-state, or external-resource drift prevents
finalization. The transition graph may then follow only a named
reverify/remediate path or a terminal outcome. It never invents an automatic
rebase, broader diff, or replacement external action.

## Hermes Kanban state projection

Hermes states remain canonical:
`triage`, `todo`, `scheduled`, `ready`, `running`, `blocked`,
`review`, `done`, and `archived`.

The simple board groups them for the CEO:

| CEO lane | Hermes state | Presentation |
| --- | --- | --- |
| Ready | `triage`, `todo`, `scheduled`, `ready` | Preserve the exact source state as a chip |
| Working | `running` | Show exact controller phase, CodeG activity or next scheduled action, attempts, elapsed time, and aggregate cost |
| Needs you | `blocked` or `review` with an active typed CEO input request | Show the exact decision and proposed TaskSpec revision; never use this lane for technical ambiguity |
| Stopped | `blocked` with a terminal outcome and no CEO input request | Show `failed`, `timed_out`, `budget_exhausted`, `cancelled`, `route_unavailable`, or `inconsistent` plus receipts |
| Completed filter | `done` | Show successful aggregate receipt and verification/finalization results |
| Archive | `archived` | Hidden by default |

`cancelling` is a temporary UI action state only. The canonical task remains
`running` until either CodeG confirms cancellation or the numeric
cancellation deadline expires. Confirmation closes/reclaims the run as
`cancelled`; deadline expiry quarantines the unresolved binding and wins
terminal CAS as `inconsistent` without claiming cancellation succeeded.
Controller-managed CodeG review, remediation, verification, and finalization
remain in the Working lane; they do not create a fake CEO review pause. Between
action attempts, the task stays `running` only when the next action is durably
scheduled and still authorized.

## PM capability isolation

The dedicated `luisos-pm` Hermes profile is capability-limited.

Allowed:

- conversation and clarification;
- AgentBrain recall;
- TaskSpec and plan drafting;
- risk classification and route proposal;
- capability-registry reads;
- read-only task, attempt, receipt, and status projections;
- structured create/update/comment/attach, approval, dispatch, retry,
  finalization, and cancellation **proposals** to the deterministic AgentDash
  controller;
- summarization of original worker receipts.

Forbidden:

- filesystem mutation;
- shell or terminal execution;
- code editing;
- requested research or deliverable production;
- browser/computer actions;
- deployment or external business mutations;
- credentials and secret management;
- originating or authenticating CEOCommandV1, ApprovalGrant, action authority,
  or adapter commands;
- diagnosing or repairing worker output by doing the worker's task.

The restriction is enforced by tool availability and controller validation,
not by prompt text alone. PM output is always untrusted. Only the controller
may validate a proposal, mutate Hermes state, activate a mandate, or issue and
consume action authority.

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

### Route evidence gate

The registry distinguishes discovery from operational proof:

1. user-supplied candidate label;
2. official exact identity and documented capabilities;
3. exact local catalog discovery;
4. authenticated, non-material runtime canary proving completion, tool use,
   continuation, cancellation, and observable activity;
5. representative task-class evaluation proving quality, cost, latency,
   safety, context behavior, and harness behavior.

Level 4 is canary-only. Only a current level-5 proof may make an exact route
production-eligible or give it an operational role. Proof is tied to:

`outer harness + provider + exact model + agent type + mode/config digest`

Published context windows, token prices, and provider usage tiers are reference
inputs only. The effective served context, quota behavior, latency, and
completion cost of the full route must be measured. An expired proof makes the
route unavailable for new actions. The controller may select an exact named
fallback only when that fallback is already inside the active mandate, has a
current level-5 proof, and fits remaining aggregate limits.

#### RouteEvaluationPolicyV1

Level-5 proof follows a versioned, task-class-specific policy. The initial
taxonomy is:

- `intake_microtask`;
- `bounded_coding`;
- `general_implementation`;
- `hard_engineering`;
- `independent_review`;
- `long_horizon_repository`;
- `frontend_ci_data`;
- `multimodal_ui_document`;
- `long_tool_chain_research`; and
- `current_web_research`.

For each exact route/task-class pair, `RouteEvaluationPolicyV1` records the
fixture-set version, scoring rubric, minimum sample count, confidence threshold,
hard cost/latency ceilings, safety gates, and proof expiry. The MVP minimum is:

- standard classes: at least 20 scored runs across at least five fixture shapes
  and a 95% Wilson lower confidence bound of at least 0.70 for accepted task
  outcomes;
- high-stakes `hard_engineering` and `independent_review`: at least 30
  scored runs and a 95% Wilson lower bound of at least 0.80;
- 100% pass on authority isolation, workspace containment, identity/session
  binding, cancellation/reconciliation, secret handling, and prohibited-action
  tests; and
- observed worst-case cost/runtime inside the registry ceiling.

Evidence provenance includes the exact route tuple/config digest, task-class
and fixture-set versions, evaluator version, raw action/check receipts, score
digest, timestamp, and environment fingerprint. A level-5 proof is valid for
at most 30 days. It is invalidated immediately by any route/model/harness/config
digest change, critical authority/safety failure, broken cancellation or
identity proof, or a production critical failure. Revocation disables new
actions; active uncertain work follows reconciliation rather than substitution.
Routine time expiry does not retroactively invalidate an already submitted
ActionCommandV1, but a critical safety/authority revocation requests exact
cancellation and quarantine within the route's reconciliation limits.

### Approved model-role evaluation baseline

The isolated Hermes PM profile remains the manager harness. Its preferred
candidate inference model is `gpt-5.6-terra`; `claude-sonnet-5` is the
candidate fallback. Both configurations produce untrusted management proposals
only and must independently pass the PM-specific level-5 evaluation.

The following 21 entries define the requested worker-route inventory: **15
fully specified candidates, five incomplete Ollama provider/model templates,
and one disabled catalog item**. “Candidate role” means the role the evaluation
suite should attempt to prove, not permission to dispatch.

The Ollama Cloud entries are incomplete route templates until AgentDash names
and proves the outer execution harness. They cannot satisfy exact local
discovery or production eligibility as provider-plus-model pairs alone.

| Inventory entry | Evaluation hypothesis | Important constraint |
| --- | --- | --- |
| Codex + `gpt-5.6-sol` | Principal engineer, hard implementation, technical adjudication, cross-provider review | Reserve for ambiguous or high-stakes work |
| Codex + `gpt-5.6-terra` | Default senior builder, debugging, test/fix loops | PM use is a separate isolated Hermes configuration |
| Codex + `gpt-5.6-luna` | Intake, extraction, summaries, bounded microtasks | Never sole high-stakes reviewer |
| OpenCode Go + `opencode-go/deepseek-v4-flash` | Cheap bounded coding, tests, docs, repetitive tool work | No open-ended architecture or final authority |
| OpenCode Go + `opencode-go/deepseek-v4-pro` | Value-oriented senior implementation and difficult debugging | Use Flash when it already meets the task class |
| OpenCode Go + `opencode-go/glm-5.2` | Long-horizon repository integration, refactors, complex debugging | Avoid tiny latency-sensitive tasks |
| OpenCode Go + `opencode-go/hy3` | Frontend, CI/CD, data/storage, and tool-recovery work | Native context and served context must not be conflated |
| OpenCode Go + `opencode-go/minimax-m3` | Long-context coding, browsing, and agentic decomposition | Vision and served context remain route-level proof items |
| OpenCode Go + `opencode-go/qwen3.7-max` | Hard open-model reasoning and cross-file review | Not the economical Qwen tier |
| OpenCode Go + `opencode-go/qwen3.7-plus` | Balanced daily coding, planning, documentation, and research | Do not treat as equivalent to Max on the hardest work |
| Proven outer harness + Ollama Cloud `deepseek-v4-flash:cloud` | Provider-diverse throughput fallback | Ollama Cloud alone is not an agent harness |
| Proven outer harness + Ollama Cloud `deepseek-v4-pro:cloud` | Alternate deep-coding and review route | Never silently substitute for OpenCode Go |
| Proven outer harness + Ollama Cloud `glm-5.2:cloud` | Alternate long-horizon route | Outer harness and effective limits require proof |
| Proven outer harness + Ollama Cloud `minimax-m3:cloud` | Multimodal UI/document work and long-context coding | Use Ollama's served limit, not the native maximum |
| Proven outer harness + Ollama Cloud `nemotron-3-ultra:cloud` | Long tool chains, deep research, and workflow verification | Not a PM or lifecycle authority |
| Ollama Cloud `hy3:cloud` | None; disabled | Official catalog route absent as of 2026-08-03 |
| Claude Code + `claude-opus-5` | Architecture/refactor lead and independent high-stakes reviewer | Do not make it the only reviewer of its own work |
| Claude Code + `claude-sonnet-5` | Alternate default builder, brownfield debugging, UI/vision work | PM fallback is a separate isolated Hermes configuration |
| Claude Code + `claude-haiku-4-5-20251001` (alias `claude-haiku-4-5`) | Fast triage, classification, extraction, and bounded subagent work | User-approved identity; runtime and lifecycle proof still required |
| Kimi Code + `kimi-code/k3` (underlying API model `kimi-k3`) | Massive-repository work, long-horizon engineering, deep research, multimodal artifacts | Preserve required reasoning history; re-prove the CodeG route |
| Grok Build + `grok-4.5` | Current-web/X investigation and cross-functional engineering | Current research requires search; sensitive work requires storage controls |

Role-evaluation hypotheses:

- Evaluate Luna and resolved Haiku 4.5 for cheap intake and microtasks.
- Evaluate DeepSeek V4 Flash for cheap bounded coding.
- Evaluate Terra as the normal production builder and Sonnet 5 as the
  alternate.
- Evaluate DeepSeek V4 Pro and Qwen3.7 Plus as value-oriented senior routes.
- Evaluate Sol and Opus 5 for the hardest work and cross-provider review.
- Evaluate GLM-5.2 and Kimi K3 for long-horizon repository work.
- Evaluate Hy3 for frontend, CI/CD, and data/storage work.
- Evaluate Qwen3.7 Max for hard open-model reasoning and Plus as the economical
  balanced tier.
- Evaluate MiniMax M3 for multimodal UI/document work.
- Evaluate Nemotron 3 Ultra for long tool-chain workflows.
- Evaluate Grok 4.5 for current web/X research when its search tools are
  enabled.

## Risk and launch policy

The MVP has only two policy modes.

### Auto

A task auto-launches only when every condition is true:

- aggregate cost across execution, fallback, remediation, verification, and
  finalization is hard-bounded at **$1.00**;
- aggregate elapsed runtime ceiling is at most **30 minutes**;
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
- every possible model-backed route in the mandate has a current level-5
  task-class proof, and every deterministic action has current capability,
  idempotency, cancellation, and reconciliation proof;
- the complete terminal path, attempt ceilings, and safe finalization action
  are explicit and auto-policy eligible;
- the card, TaskSpec, execution mandate, policy snapshot, activation receipt,
  and first launch intent are durable before dispatch.

Auto mode skips only CEO mandate approval. It never skips card creation,
mandate validation, one-time action authority, live observability,
verification, finalization, receipts, or terminal reconciliation.

### Approval required

Anything else is created in a non-runnable blocked state. The PM presents an
ordered complete-terminal-path plan whose every step names:

- objective and expected artifact;
- harness and model/config;
- exact named fallback and remediation route, when permitted;
- required capabilities;
- workspace/resource;
- per-action and aggregate cost, runtime, and attempt ceilings;
- acceptance check;
- rollback or safe-stop point;
- independent verification route;
- exact finalization action and any external or irreversible effect.

No CodeG task or session is created until a valid ApprovalGrant activates the
exact mandate revision. The one approval covers that complete bounded path; it
does not permit the controller, PM, or worker to invent a new route, weaken an
acceptance check, or add an unlisted finalization action.

## End-to-end flows

### New executable request

1. AgentDash assigns a `request_id` and sends the message to the Hermes PM.
2. The PM returns conversational text plus a structured management proposal.
3. The deterministic controller validates the proposal.
4. Hermes Kanban atomically creates or returns the one non-runnable card for
   the `request_id` before any dispatch.
5. AgentDash constructs and persists the TaskSpec, complete ExecutionMandateV1,
   route evidence snapshot, and aggregate limits on the card.
6. The no-start validator proves a complete terminal path. A missing
   verification/finalization route or known missing authority keeps the task
   non-runnable.
7. Auto tasks receive a current auto-policy activation receipt.
   Approval-required tasks receive a typed `initial_mandate_approval` request
   and remain blocked until one authenticated CEOCommandV1 produces an
   ApprovalGrant that activates the exact mandate revision.
8. The controller validates graph reachability, preserved downstream/recovery
   reserves, and current route proof, then issues ActionAuthorityV1 and redeems
   it into one durable replay-safe ActionCommandV1 for the first action.
9. Hermes creates the canonical run when the bridge claims that action.
10. The bridge delegates the TaskSpec plus immutable mandate/action context to
    CodeG and binds the returned identities to the run.
11. AgentDash projects original CodeG activity into the selected session pane.
12. The bridge closes the run with its immutable action receipt.
13. The deterministic controller—not the PM—classifies the result and schedules
    the next authorized retry, remediation, verification, or finalization
    action.
14. Successful finalization produces the aggregate receipt and moves the task
    to `done`. Exhausted limits or an unrecoverable result produce a truthful
    Stopped outcome.
15. The PM posts a concise summary linked to all original receipts.

A deterministic finalization action uses its typed engine/controller adapter
instead of creating a model conversation. It still receives one-time action
authority, an append-only attempt/event trail, idempotent reconciliation, and
an immutable receipt.

### Non-executable message

Clarification, casual conversation, a status request, approval, cancellation,
or retry instruction updates the relevant conversation/task. It does not create
a new card unless the CEO clearly introduces a new deliverable.

### Continuous execution

After the first dispatch, every nonterminal controller phase must have exactly
one of these durable next conditions:

1. an already authorized action scheduled with a fresh one-time action
   authority;
2. a technical reconciliation operation with a bounded next lookup/cancel
   deadline;
3. a typed CEO input request that names the proposed TaskSpec revision and
   guarantees no unapproved action is running; or
4. a truthful terminal outcome.

Transient infrastructure failures use only the mandate's named retry route and
attempt allowance. Semantic or quality failures use only a named remediation
step, followed by the independent verification step. Verification never edits
the deliverable it judges. Successful verification advances directly to the
typed finalization step when that action is already authorized.

Any objective or acceptance change, unforeseen business/product decision,
out-of-mandate route/capability/workspace/budget proposal, or new external or
irreversible action creates a typed CEO input request and a new TaskSpec
revision. The controller never presents technical uncertainty, expired route
proof, or exhausted limits as if it were a CEO approval decision.

### High-risk approval

1. Card exists in `blocked` with no CodeG session and an active
   `CEOInputRequestV1` of type `initial_mandate_approval`.
2. The PM presents the detailed plan in conversation and the selected-card
   pane.
3. AgentDash renders an authenticated approval command bound to the current
   TaskSpec, complete mandate digest, and single-use nonce.
4. The CEO approves that command once; PM text cannot produce the command.
5. AgentDash validates CEOCommandV1, derives and consumes the ApprovalGrant, and
   activates that mandate.
6. The controller issues one-time action authority as each named step becomes
   eligible; retries, remediation, verification, and finalization inside the
   mandate do not ask again.
7. A proposed revision follows the no-start gate again before any new action.

### Cancellation

1. AgentDash records `cancel_requested` against the active run and shows the
   temporary cancelling projection.
2. CodeG receives cancellation for the exact delegation/session.
3. Until confirmation, the task remains canonically running only until the
   mandate's numeric cancellation deadline, with the deadline visible.
4. On confirmation, Hermes reclaims/closes the run with a user-cancelled reason,
   records the aggregate `cancelled` receipt, and places the task in Stopped.
5. If the deadline expires first, AgentDash quarantines the binding, records
   unresolved external activity, and terminalizes as `inconsistent` rather
   than claiming cancellation.
6. A late worker completion is recorded as a race diagnostic; it does not
   silently change the task to done.

Cancellation is an exact CEO command, not an escalation or approval request. A
later retry requires a new TaskSpec/mandate revision and never reopens or
overwrites the cancelled attempt.

## CodeG adapter contract

AgentDash depends on behavior, not guessed HTTP method names.

Required operations:

- `dispatch(TaskSpec, mandate_context, action_spec, route, idempotency_key)`;
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

Five facts remain implementation gates rather than assumptions:

1. Determine when the asynchronous delegation exposes the native conversation
   id, whether it also exposes a harness session id, and which identifier the
   native URI accepts.
2. Prove an activity stream or bounded incremental message/tool snapshot that
   can drive the Live pane.
3. Prove lookup and reconciliation by dispatch idempotency key after an
   ambiguous transport outcome.
4. Prove enforceable runtime and cost ceilings for every auto-capable route.
5. Prove that every CodeG launch carries the immutable mandate/action identity
   and that retries, remediation, verification, and finalization receive
   distinct idempotency keys and sessions.

Auto-launch remains disabled until the adapter proves idempotent dispatch,
lookup/reconciliation, cancellation, identity resolution, orphan
reconciliation, action-role propagation, aggregate budget enforcement, and a
complete terminal path. A generic `running` status alone does not satisfy the
Live-pane acceptance criterion.

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
- Keep one lifetime task while creating append-only runs for execution, retry,
  remediation, verification, and finalization actions.
- Emit the external-session binding as a run-scoped typed event.
- Persist the active immutable mandate, activation receipt, action role, and
  one-time action-authority reference through supported Kanban operations.
- Require one supported atomic operation that validates the active mandate,
  redeems ActionAuthorityV1, reserves monotonic aggregate budget, and appends
  the complete ActionCommandV1/launch intent. If Hermes lacks it, add one narrow
  supported extension; never emulate it with direct SQLite writes or a
  lookup-then-update sequence.
- Heartbeat the active bridge run while CodeG is working.
- Close every run with its original CodeG action-receipt metadata, then attach
  the aggregate terminal receipt before a successful `done` transition.
- Use the real Kanban failure outcomes and typed block reasons.
- Preserve append-only prior attempts.

The CodeG execution bridge is separate from `luisos-pm`. It may delegate and
monitor work but has no authority to reinterpret the CEO's goal, expand
capabilities, choose an unlisted route, weaken acceptance, or approve itself.

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
| CodeG rejects dispatch | Close the attempt with the original error; schedule an exact named level-5 fallback only when the mandate and remaining limits allow it, otherwise finish `route_unavailable` or `failed` |
| CodeG dispatch result is unknown | Quarantine the run and perform lookup with the same command/idempotency key until its numeric deadline; replay only after definitive `not_found`; finish `inconsistent` when the deadline expires |
| Binding persistence fails after CodeG starts | Cancel CodeG immediately, record an orphan diagnostic, reconcile to a known terminal state, and finish `inconsistent` if safe ownership cannot be restored |
| CodeG activity connection drops | Keep identities visible, show disconnected, and reconcile within the numeric orphan/activity deadline without creating another session; finish `inconsistent` if ownership cannot be proven |
| AgentDash restarts | Rehydrate from Kanban, resolve every active CodeG binding, and never dispatch merely because the UI reloaded |
| Active run has no binding | Reconcile by idempotency key, cancel/quarantine when needed, and finish `inconsistent` if unresolved; do not ask the CEO to diagnose it |
| Worker times out or crashes | Cancel or confirm terminal state, then use the next named transient retry only within remaining mandate attempts, runtime, and cost; otherwise finish `timed_out` or `failed` |
| Worker produces a semantic or quality failure | Preserve evidence, run the next named remediation action within aggregate limits, then independently verify; otherwise finish `failed` |
| Verification fails | Run only a named remediation cycle still inside the mandate and aggregate limits; never let the verifier repair its own finding |
| Finalization fails | Reconcile the typed finalization action without repeating an ambiguous external/irreversible operation; finish `failed` or `inconsistent` if it cannot be proven |
| Receipt persistence fails | Journal the redacted result in the durable recovery outbox, stop new actions, and retry Hermes delivery within the numeric receipt deadline; then queue a terminal `inconsistent` intent and show reconciliation pending until Hermes accepts it |
| Aggregate cost, runtime, or attempt ceiling is reached | Cancel the exact active action, persist evidence, and finish `budget_exhausted` or `timed_out`; a larger ceiling requires a later CEO-approved revision |
| Current route proof expires before an action | Use a current exact named fallback if permitted; otherwise finish `route_unavailable` without blind substitution |
| An unforeseen business/product decision or out-of-mandate action is required | Safely stop before that action, create a typed CEO input request and proposed TaskSpec revision, and launch nothing until the revision is approved |

Hermes's consecutive-failure circuit breaker is an additional upper bound, not
an allowance to exceed the mandate. Technical ambiguity always follows bounded
lookup, reattachment, cancellation, or quarantine. It never becomes a generic
CEO approval request, and the controller never blind-redispatches to make
progress appear continuous.

### Bounded reconciliation

Every mandate carries numeric maximum attempts and elapsed deadlines for
dispatch lookup, cancel confirmation, orphan/binding recovery, finalization
reconciliation, and receipt/event delivery. The no-start proof reserves their
worst-case budget. “Retry until available” is invalid.

Every adapter result is durably journaled in the controller recovery outbox
before AgentDash attempts to attach its receipt to Hermes. When a reconciliation
deadline expires:

- no new worker or finalization action may start;
- the task's operational projection leaves Working;
- a durable `inconsistent` terminal intent records unresolved external
  activity and all last-known identities;
- a quarantined safety monitor may continue read-only lookup or exact
  cancellation, but it cannot change the accepted terminal outcome; and
- if Hermes is unavailable, the UI says **Stopped — reconciliation pending**
  from the non-authoritative outbox overlay until Hermes accepts the queued
  event and receipt.

AgentDash never labels this state `cancelled`, `failed`, or `succeeded`
without the corresponding authoritative evidence. Dispatch health remains
not-ready while terminal events are queued.

## Idempotency and race rules

- One CEO request id maps to at most one Hermes task for its lifetime, including
  after archive. An intentional repeat receives a new request id and may link
  back to the prior task.
- That invariant depends on atomic Hermes create-if-absent semantics. A
  lookup-then-create implementation is not assumed safe; controller
  serialization is only an optimization, not the correctness boundary.
- A mandate-activation receipt is durable before the first action, and a
  prepared ActionCommandV1, budget reservation, and launch-intent event are
  durable before every mutating adapter call.
- The adapter receives the stable idempotency key from ActionCommandV1.
- Every dispatch attempt is followed by lookup using that key when its outcome
  is ambiguous. The run is quarantined while lookup remains `unknown`.
- Transport replay is permitted only for the same ActionCommandV1 after CodeG
  authoritatively reports `not_found`; a transient listing absence is not
  sufficient. A `found` result binds the existing delegation to the run.
- Terminal outcomes use compare-and-set semantics: the first accepted terminal
  transition wins; later conflicting signals become diagnostics.
- A CEO ApprovalGrant or auto-policy receipt activates one immutable mandate
  revision exactly once. Each action authority is redeemed into one logical
  command only; transport retries never create a second command.
- Mandate supersession and CEO cancellation atomically revoke future
  authorities and commands proven unsubmitted. Submitted or unknown commands
  remain quarantined until lookup/cancel reconciliation is definitive.
- Observed aggregate spend is monotonic across all attempts and survives
  AgentDash restart. Verification, finalization, cancellation, and
  reconciliation reserves are carried once at task level for the active
  mandate; sequential commands reference rather than duplicate them. Before
  submission, each command reserves only its own worst-case action headroom.
  Definitive command completion may release unused per-command headroom with an
  append-only audit event, but observed spend is never refunded. Revoking a
  proven-unsubmitted command likewise releases only its unused command
  headroom; task-level reserves remain held until their corresponding
  downstream phase completes or the mandate reaches a terminal outcome.
- Finalization intent is durable before the finalization adapter call. An
  ambiguous response is reconciled against observed state and is never
  repeated merely because AgentDash restarted.

## Security and cost boundaries

- Bind AgentDash and supporting local services to `127.0.0.1`.
- Keep provider credentials, CodeG connection tokens, and Hermes secrets
  server-side.
- Validate real workspace paths and allowlisted project roots before launch.
- Use a fixed harness/capability registry; never execute an arbitrary command
  supplied by the PM.
- Do not place secrets in prompts, Kanban bodies, comments, attachments,
  AgentBrain, logs, or receipts.
- Require typed CEO input, a new TaskSpec revision, and a new mandate approval
  for any objective or acceptance change, an unforeseen business/product
  decision, any route/capability/workspace/budget change outside the active
  mandate, or a new external/irreversible action.
- Enforce budget and timeout in the deterministic controller and in Hermes or
  CodeG where supported. If cost telemetry, a conservative prepaid bound, or a
  proven cancellation/safe-stop path is missing before launch, fail the
  no-start invariant. If a bound is exhausted after launch, cancel and finish
  with a truthful terminal outcome rather than silently extending authority.
- The verifier cannot mutate the deliverable it judges, and a worker cannot
  approve its own output or finalization.
- Preserve the legacy distinction between interrupt/cancel and kill/forced
  termination.

## Testing strategy

### Contract tests

- Hermes adapter: atomic create-if-absent, attach, block/unblock, claim/run
  identity, mandate/action-authority events, comments, append-only action
  receipts, aggregate receipts, retries, and reconnect.
- CodeG adapter: dispatch, lookup by idempotency key, status/activity cursor,
  opaque conversation and harness-session resolution, verified native URI,
  action-role propagation, cancel, terminal result, and missing-session
  behavior.
- AgentBrain adapter: reviewed-page recall and failure without mutation.
- Capability registry: exact route identity, proof level/expiry, named-fallback
  eligibility, and provider-versus-harness distinction.
- CEO command boundary: authenticated origin, single-use nonce, displayed
  mandate digest, stale-revision rejection, and PM-output spoof rejection.
- Action command/outbox: authority redemption, atomic command/reservation,
  one-time task-level reserves, per-command headroom, same-key replay,
  proven-unsubmitted revocation, unknown-command quarantine, result journaling,
  and eventual Hermes delivery.

### Policy tests

- Auto policy accepts only the complete low-risk predicate.
- No-start rejects any mandate missing a complete verification/finalization
  path, hard aggregate limits, or current route proof.
- No-start rejects an incomplete outcome edge, unbounded visit, open-ended
  remediation action, worst-case branch over budget, or missing downstream and
  recovery reserve.
- Unenforceable cost or runtime ceilings keep the task non-runnable.
- Every prohibited capability forces approval.
- Any objective/acceptance revision invalidates prior authority.
- An out-of-mandate route, capability, workspace, budget, or external action
  invalidates prior authority; an exact named fallback inside the mandate does
  not.
- Level 4 routes can run controlled canaries only; production dispatch requires
  current level-5 task-class proof.
- Route evaluation enforces task-class sample/confidence thresholds, provenance
  digests, 30-day maximum validity, and immediate critical-failure/config-change
  revocation.
- High-risk work requires a path-specific Tier 2 verifier independent from
  every preceding model-backed mutating route, including remediation, plus
  exact-mutation and expected-post-state finalization preconditions; none can
  be waived by a general approval.
- PM output cannot bypass controller validation.
- Non-executable conversation does not create cards.

### State-machine tests

- Duplicate request and duplicate dispatch.
- Concurrent request creation and atomic winner selection.
- Unknown dispatch outcome, quarantine, lookup, and safe resolution.
- Crash before/after authority redemption and before/after adapter submission
  produces one logical ActionCommand and no duplicate work.
- Dispatch failure before and after CodeG starts.
- AgentDash restart during running work.
- Missing binding, orphaned CodeG session, and stale heartbeat.
- Cancellation/completion race.
- Timeout/success, verifier/check disagreement, and `unknown`/`not_found`
  precedence produce deterministic ActionOutcomeV1 values.
- Approved-mandate transient retry followed by success without another CEO
  approval.
- Semantic failure followed by named remediation, recomputation of the realized
  mutating-route set, independent verification, and authorized finalization.
- Repeated transient or semantic failure followed by truthful terminal failure
  when aggregate limits are exhausted.
- Route-proof expiry followed by an exact named fallback or
  `route_unavailable`.
- Any post-dispatch nonterminal state has an automatic action, scheduled
  reconciliation, or typed CEO input request.
- Objective/acceptance change and unforeseen product decision require a new
  TaskSpec revision.
- Receipt failure before done.
- Ambiguous finalization response plus restart produces no duplicate external
  action.
- A remediation mutation invalidates prior verification; high-risk verification
  fails when its model-backed route shares either provider or outer harness
  with any route in the realized mutating-route set.
- Artifact, verification-receipt, base/target, exact-mutation,
  expected-post-state, and target-head drift prevent finalization and follow
  only named graph edges. An in-scope but non-matching mutation cannot succeed.
- Lookup, cancellation, orphan, finalization, and receipt-delivery deadlines
  leave Working and produce a durable `inconsistent` intent with quarantined
  external activity.

### UI tests

- Selecting each card visibly changes the active card and right pane.
- Live, Files, Checks, and Receipt tabs show the selected attempt only.
- The card exposes every append-only attempt and exact CodeG session while the
  selected attempt remains visually unambiguous.
- High-risk cards show a detailed plan and no CodeG session.
- Working cards show `execute`, `retry`, `remediate`, `verify`, or
  `finalize` rather than a blanket progress tag.
- Needs you appears only with a typed CEO input request; exhausted limits appear
  in Stopped.
- Open in CodeG points to the exact session and is keyboard accessible.
- No control looks active without a visible consequence.
- PM summaries link to original receipts.

### End-to-end acceptance

Run with a test board and harmless local workspaces:

1. Low-risk read/research task creates a card, passes the complete-path
   no-start gate, auto-launches through CodeG, exposes original activity and its
   native session, verifies, finalizes, and reaches done.
2. Low-risk isolated code task respects one aggregate $1/30-minute/no-deploy
   mandate across execution, remediation, verification, and finalization.
3. Production-migration request creates a complete detailed blocked plan and no
   session because its mandate is not approved.
4. One approval activates exactly one mandate revision; every action consumes
   separate one-time authority without another CEO interruption.
5. A semantic failure launches the exact named remediation route, then an
   independent verifier and authorized finalizer, with every model-backed
   session visible.
6. Restart during live work reattaches to the same CodeG session and resumes the
   same mandate without duplicate dispatch or budget reset.
7. Cancellation reaches the exact session and leaves an aggregate
   `cancelled` receipt.
8. Exhausted limits produce Stopped with `budget_exhausted` or `timed_out`,
   not a generic approval card.
9. A proposed acceptance change produces a typed CEO input request, a new
   revision, and no unapproved action.
10. Original action, verification, finalization, and aggregate receipts exist
    before the task becomes done.
11. The PM cannot perform the requested work or mutate authority when CodeG is
    unavailable.
12. PM-authored “approved” text, a replayed CEO nonce, and a stale displayed
    mandate digest all create zero grants and zero CodeG work.
13. A crash in every action-command boundary replays one logical command with
    one idempotency key, carries task-level downstream reserves once, preserves
    observed spend and per-command headroom, and creates no duplicate session
    or finalization effect.
14. High-risk work no-starts unless every success-capable path has a Tier 2
    verifier independent from all preceding mutating routes, including
    remediation; a verified artifact cannot finalize after source/target,
    exact-mutation, or expected-post-state drift.
15. Bounded lookup, cancellation, and receipt-store failures leave Working by
    their deadlines and expose an auditable `inconsistent` result or
    reconciliation-pending overlay.

## Implementation boundaries

The implementation plan should remain a sequence of thin slices:

1. Prove CodeG delegation, idempotency lookup, activity, opaque conversation
   and harness identities, verified native URI, enforceable ceilings, cancel,
   and reconnect behavior.
2. Add read-only Hermes Kanban projection to the Direction A layout.
3. Add PM structured-intent conversation with capability isolation.
4. Add durable TaskSpec, finite ExecutionMandateV1 transition graph,
   CEOCommandV1 boundary, complete-path/budget validation, ActionAuthorityV1,
   and replay-safe ActionCommandV1 with all tasks initially non-runnable.
5. Add the external CodeG bridge, append-only action-role runs, and exact
   run/session binding where a worker session exists.
6. Add the five-level route evidence gate and qualify each fully specified
   route/task-class pair independently. Enable only pairs with current level-5
   proof; first resolve an outer harness for incomplete templates, and keep
   disabled catalog items disabled. One unqualified inventory entry does not
   block an otherwise proven route/task-class pair.
7. Add low-risk auto activation and one-approval high-risk mandate activation.
8. Add the deterministic ActionOutcomeV1 classifier and continuation loop for
   bounded retry, scoped remediation, tiered independent verification,
   artifact-bound finalization, and truthful TaskOutcomeV1 failure.
9. Add live activity, files, checks, phase labels, immutable receipts, and
   native deep links for every attempt.
10. Add the durable recovery outbox, numeric reconciliation deadlines, restart,
    cancellation, quarantine diagnostics, aggregate budget recovery, and
    end-to-end verification.

Each slice must end in observable behavior and preserve existing OpenCode,
Hermes, Agent Fleet, and legacy-reference surfaces.

## Acceptance definition

The MVP is accepted only when the CEO can type one normal executable request
and observe one durable card follow a complete, bounded mandate through exact
CodeG execution, remediation when needed, independent verification, and
authorized finalization without repeated approval pauses. Every attempt must
show original activity, and every model-backed attempt must link to its exact
CodeG session; deterministic actions must explicitly state that no worker
session applies. Aggregate budgets must survive restart; technical ambiguity
must reconcile or terminate without blind redispatch; exhausted limits must be
truthful terminal outcomes; and any objective/acceptance or business/product
revision must stop before action for typed CEO input. The Hermes PM must remain
technically unable to do worker work or mutate lifecycle authority.
