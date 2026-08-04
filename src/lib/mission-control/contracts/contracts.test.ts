import { describe, expect, test } from "vitest";

import * as contracts from "./index";

import {
  ActionCommandV1Schema,
  ActionOutcomeV1Schema,
  ActionOutcomeValues,
  AttemptIdSchema,
  ArtifactIdSchema,
  CodeGConversationIdSchema,
  CodeGTaskIdSchema,
  CommandIdSchema,
  DigestSchema,
  EventIdSchema,
  ExecutionMandateV1Schema,
  FinalizationCommandV1Schema,
  ManagementProposalV1Schema,
  RequestIdSchema,
  RouteIdSchema,
  RouteEvidenceV1Schema,
  WorkspacePolicyV1Schema,
  ReconciliationDeadlinesV1Schema,
  AutoActivationReceiptV1Schema,
  FinalizationReceiptV1Schema,
  AggregateReceiptV1Schema,
  ReconciliationReceiptV1Schema,
  RunIdSchema,
  TaskIdSchema,
  TaskOutcomeV1Schema,
  TaskOutcomeValues,
  canonicalDigest,
  canonicalJson,
} from "./index";
import type {
  ActivationPolicyPort,
  AgentBrainPort,
  CodeGPort,
  FinalizationPort,
  HermesPort,
  RecoveryOutboxPort,
  RouteRegistryPort,
} from "@/server/mission-control/ports";

const timestamp = "2026-08-03T12:00:00.000Z";
const digest = DigestSchema.parse("a".repeat(64));
const taskId = TaskIdSchema.parse("task-1");
const artifactId = ArtifactIdSchema.parse("artifact-1");
const commandId = CommandIdSchema.parse("command-1");
const runId = RunIdSchema.parse("run-1");

const hermesFake = {
  persistIntake: async () => ({ task_id: taskId, created: true, task_spec_digest: digest, mandate_digest: digest }),
  ensureArtifact: async () => ({ artifact_id: artifactId, created: true, digest }),
  activateMandate: async () => undefined,
  prepareAction: async () => ({ run_id: runId, command: contracts.ActionCommandV1Schema.parse(actionCommand), created: true }),
  bindWorkerSession: async () => undefined,
  appendRunEvent: async () => undefined,
  closeAction: async () => undefined,
  setCEOInput: async () => undefined,
  commitTerminalIntent: async () => undefined,
  projectBoard: async () => ({ generated_at: timestamp, lanes: { ready: [], working: [], needs_you: [], stopped: [], completed: [] }, archived_count: 0, unavailable_reason: null }),
} satisfies HermesPort;
const codegFake = {
  ensureWork: async () => ({ status: "created" as const, binding: contracts.CodeGBindingV1Schema.parse(codegBinding) }),
  lookupByCommandKey: async () => ({ status: "not_found" as const }),
  getSnapshot: async () => ({ binding: contracts.CodeGBindingV1Schema.parse(codegBinding), terminal: false, source_commit: null, source_tree: null, raw: contracts.RedactedPayloadV1Schema.parse(redacted) }),
  async *activityAfter() { yield { cursor: "cursor-1", source_timestamp: timestamp, kind: "status", payload: contracts.RedactedPayloadV1Schema.parse(redacted) }; },
  cancelExact: async () => ({ status: "confirmed" as const, binding: contracts.CodeGBindingV1Schema.parse(codegBinding) }),
  nativeSessionUri: async () => "codeg://session/conversation-1",
} satisfies CodeGPort;
const finalizationFake = {
  preflight: async () => ({ status: "ready" as const, observed_digest: digest }),
  apply: async () => ({ status: "applied" as const, operation_id: commandId }),
  lookup: async () => ({ status: "applied" as const, post_state_digest: digest }),
} satisfies FinalizationPort;
const policyFake = { decide: async () => ({ kind: "auto" as const, receipt: contracts.AutoActivationReceiptV1Schema.parse(autoActivationReceipt) }) } satisfies ActivationPolicyPort;
const brainFake = { recallReviewed: async () => [{ page_id: "page-1", page_digest: digest, excerpt: "reviewed excerpt", reviewed_at: timestamp }] } satisfies AgentBrainPort;
const routesFake = { requireLevel5: async () => RouteEvidenceV1Schema.parse(validRoute) } satisfies RouteRegistryPort;
const outboxFake = { journal: async () => undefined, pending: async () => [contracts.AdapterResultEnvelopeV1Schema.parse({ schema_version: "agentdash.adapter-result-envelope/v1", envelope_id: "event-1", command_id: "command-1", adapter: "codeg", result_digest: digest, redacted_result: redacted, observed_at: timestamp })], markDelivered: async () => undefined } satisfies RecoveryOutboxPort;
const routePort: RouteRegistryPort = routesFake;
const brainPort: AgentBrainPort = brainFake;
const outboxPort: RecoveryOutboxPort = outboxFake;

// Identity substitution must never type-check in adapter implementations.
// @ts-expect-error a request identity cannot stand in for a task identity
const identitySubstitution: import("./index").TaskId = RequestIdSchema.parse("request-1");
if (false) {
  // @ts-expect-error a request identity cannot select a route
  void routePort.requireLevel5(RequestIdSchema.parse("request-1"), "bounded_coding", timestamp);
  // @ts-expect-error a route identity cannot stand in for the task class
  void routePort.requireLevel5(RouteIdSchema.parse("codeg.codex.gpt-5"), RouteIdSchema.parse("wrong-kind"), timestamp);
  // @ts-expect-error a request identity cannot select an AgentBrain project
  void brainPort.recallReviewed("mission", RequestIdSchema.parse("request-1"));
  // @ts-expect-error a request identity cannot identify an outbox envelope
  void outboxPort.markDelivered(RequestIdSchema.parse("request-1"), EventIdSchema.parse("event-1"));
  const binding: import("./index").CodeGBindingV1 = {
    // @ts-expect-error a Hermes task id cannot stand in for a Work Task id
    work_task_id: TaskIdSchema.parse("task-1"),
    // @ts-expect-error a Work Task id cannot stand in for a run id
    run_sequence: contracts.WorkTaskIdSchema.parse("work-task-1"),
    // @ts-expect-error a connection id cannot stand in for a conversation id
    conversation_id: contracts.ConnectionIdSchema.parse("connection-1"),
    // @ts-expect-error a harness session id cannot stand in for a connection id
    connection_id: contracts.HarnessSessionIdSchema.parse("session-1"),
    // @ts-expect-error a conversation id cannot stand in for a harness session id
    harness_session_id: contracts.CodeGConversationIdSchema.parse("conversation-1"),
    // @ts-expect-error a project id cannot stand in for a folder id
    folder_id: contracts.ProjectIdSchema.parse("project-1"),
  };
  void binding;
  const commitId: import("./index").GitCommitId = contracts.GitCommitIdSchema.parse("a".repeat(40));
  // @ts-expect-error a Git tree identity cannot stand in for a Git commit identity
  const commitFromTree: import("./index").GitCommitId = contracts.GitTreeIdSchema.parse("b".repeat(40));
  void [commitId, commitFromTree];
}
void [hermesFake, codegFake, finalizationFake, policyFake, brainFake, routesFake, outboxFake, identitySubstitution];

const validRoute = {
  schema_version: "agentdash.route-evidence/v1",
  route_proof_id: "route-proof-1",
  route_id: "route-1",
  task_class: "bounded_coding",
  level: 5,
  status: "active",
  outer_harness: "codex",
  provider: "openai",
  model: "gpt-5",
  agent_type: "worker",
  config_digest: digest,
  fixture_set_version: "fixtures/v1",
  scoring_rubric_version: "rubric/v1",
  evaluator_version: "evaluator/v1",
  raw_receipt_digest: digest,
  score_digest: digest,
  environment_digest: digest,
  evidence_digest: digest,
  policy_version: "route-policy/v1",
  minimum_sample_count: 20,
  minimum_fixture_shapes: 5,
  confidence_threshold: 0.7,
  max_cost_usd: 1,
  max_runtime_ms: 60_000,
  safety_gates: ["authority_isolation", "workspace_containment", "identity_binding", "cancellation_reconciliation", "secret_handling", "prohibited_actions"],
  observed_sample_count: 20,
  observed_fixture_shapes: 5,
  observed_wilson_lower_bound: 0.7,
  observed_max_cost_usd: 0.8,
  observed_max_runtime_ms: 50_000,
  safety_gate_results: [
    { gate: "authority_isolation", passed: true, evidence_digest: digest },
    { gate: "workspace_containment", passed: true, evidence_digest: digest },
    { gate: "identity_binding", passed: true, evidence_digest: digest },
    { gate: "cancellation_reconciliation", passed: true, evidence_digest: digest },
    { gate: "secret_handling", passed: true, evidence_digest: digest },
    { gate: "prohibited_actions", passed: true, evidence_digest: digest },
  ],
  evaluated_at: timestamp,
  expires_at: "2026-09-01T12:00:00.000Z",
  revocation_reason: null,
  critical_failure: false,
  drift_detected: false,
};

const mandateEmptyPatchDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [] });
const mandateEmptyManifestDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [], patch_digest: mandateEmptyPatchDigest });
const terminalOutcomeTransitions = {
  succeeded: { kind: "terminal", outcome: "failed" }, transient_infrastructure: { kind: "terminal", outcome: "failed" }, semantic_failure: { kind: "terminal", outcome: "failed" }, verification_failure: { kind: "terminal", outcome: "failed" }, policy_violation: { kind: "terminal", outcome: "failed" }, cancelled: { kind: "terminal", outcome: "cancelled" }, timed_out: { kind: "terminal", outcome: "timed_out" }, budget_exhausted: { kind: "terminal", outcome: "budget_exhausted" }, route_unavailable: { kind: "terminal", outcome: "route_unavailable" }, ceo_input_required: { kind: "ceo_input", decision_type: "route_change" }, ambiguous: { kind: "terminal", outcome: "inconsistent" },
} as const;
const mandatePhaseNodeIds = ["execute", "fallback", "remediate", "verify", "finish"] as const;

const validMandate = {
  schema_version: "agentdash.execution-mandate/v1",
  mandate_id: "mandate-1",
  task_id: "task-1",
  request_id: "request-1",
  task_spec_revision: { plan_revision: 1, task_spec_digest: digest, objective_digest: digest, acceptance_digest: digest },
  action_nodes: [
    { node_id: "execute", action_role: "execute", executor_kind: "codeg_worker", route_id: "route-1", route_proof_id: "route-proof-1", route_proof_digest: digest, remediation_scope: null },
    { node_id: "fallback", action_role: "retry", executor_kind: "codeg_worker", route_id: "route-2", route_proof_id: "route-proof-2", route_proof_digest: digest, remediation_scope: null },
    { node_id: "remediate", action_role: "remediate", executor_kind: "codeg_worker", route_id: "route-3", route_proof_id: "route-proof-3", route_proof_digest: digest, remediation_scope: { finding_classes: ["verification_failure"], artifact_scope: ["src"] } },
    { node_id: "verify", action_role: "verify", executor_kind: "verifier", route_id: null, route_proof_id: null, route_proof_digest: null, remediation_scope: null },
    { node_id: "finish", action_role: "finalize", executor_kind: "finalizer", route_id: null, route_proof_id: null, route_proof_digest: null, remediation_scope: null },
  ],
  transition_graph: {
    execute: { ...terminalOutcomeTransitions, succeeded: { kind: "node", node_id: "fallback" } },
    fallback: { ...terminalOutcomeTransitions, succeeded: { kind: "node", node_id: "remediate" } },
    remediate: { ...terminalOutcomeTransitions, succeeded: { kind: "node", node_id: "verify" } },
    verify: { ...terminalOutcomeTransitions, succeeded: { kind: "node", node_id: "finish" } },
    finish: { ...terminalOutcomeTransitions, succeeded: { kind: "terminal", outcome: "succeeded" } },
  },
  visit_caps: Object.fromEntries(mandatePhaseNodeIds.map((nodeId) => [nodeId, 1])),
  edge_visit_caps: Object.fromEntries(mandatePhaseNodeIds.flatMap((nodeId) => ActionOutcomeValues.map((outcome) => [`${nodeId}:${outcome}`, 1]))),
  verification_step: { acceptance_digest: digest, acceptance_checks: ["check"], required_independence_tier: 1, route_id: null, route_proof_id: null, route_proof_digest: null, deterministic_verifier_id: "deterministic-checks", independence_proof_digest: digest },
  finalization_step: { mutation_type: "no_change_close", mutation_manifest: { mutation_type: "no_change_close", entries: [], manifest_digest: mandateEmptyManifestDigest, patch_digest: mandateEmptyPatchDigest }, expected_post_state: { kind: "digest", digest }, drift_preconditions: { base_digest: digest, target_digest: digest, cas_precondition_digest: digest }, allowed_path_prefixes: ["src"], prohibited_changes: ["secrets"] },
  capability_scope: { allowed_tools: ["read"], allowed_side_effects: [], allowed_data_classes: ["project"], prohibited_actions: ["network"] },
  workspace_scope: { project_id: "project-1", mode: "isolated_worktree", path: "C:/worktrees/task-1" },
  aggregate_budget: { max_cost_usd: 10, max_runtime_ms: 60000, max_attempts: 2, max_provider_tokens: 1000 },
  per_action_limits: Object.fromEntries(mandatePhaseNodeIds.map((nodeId) => [nodeId, { max_cost_usd: 2, max_runtime_ms: 12000, max_output_tokens: 1000 }])),
  budget_proof: { worst_case_path_node_ids: [...mandatePhaseNodeIds], worst_case_path: { max_cost_usd: 10, max_runtime_ms: 60000, max_attempts: 2, max_provider_tokens: 1000 }, task_reserves: { verification: { max_cost_usd: 1, max_runtime_ms: 1000, max_attempts: 1, max_provider_tokens: 100 }, finalization: { max_cost_usd: 1, max_runtime_ms: 1000, max_attempts: 1, max_provider_tokens: 100 }, cancellation: { max_cost_usd: 1, max_runtime_ms: 1000, max_attempts: 1, max_provider_tokens: 100 }, reconciliation: { max_cost_usd: 1, max_runtime_ms: 1000, max_attempts: 1, max_provider_tokens: 100 } }, reserves_carried_once: true },
  reconciliation_limits: { dispatch_lookup: { max_attempts: 6, deadline_ms: 60000 }, cancel_confirmation: { max_attempts: 6, deadline_ms: 60000 }, orphan_recovery: { max_attempts: 12, deadline_ms: 120000 }, finalization: { max_attempts: 6, deadline_ms: 60000 }, receipt_delivery: { max_attempts: 12, deadline_ms: 120000 } },
  expiry: "2026-08-04T12:00:00.000Z",
  authority_source: { kind: "approval_grant", authority_id: "authority-1" },
};

const budget = { max_cost_usd: 1, max_runtime_ms: 60_000, max_attempts: 1, max_provider_tokens: 1_000 };
const redacted = { redacted: true, digest, summary: "redacted evidence" };
const workspace = { project_id: "project-1", mode: "isolated_worktree", path: "C:/worktrees/task-1" };
const workspacePolicy = { schema_version: "agentdash.workspace-policy/v1", workspace, allowed_roots: ["C:/worktrees"], require_isolated_worktree: true };
const capabilityScope = { allowed_tools: ["read"], allowed_side_effects: [], allowed_data_classes: ["project"], prohibited_actions: ["network"] };
const routePolicy = { schema_version: "agentdash.route-evaluation-policy/v1", route_id: "route-1", exact_route: { outer_harness: "codex", provider: "openai", model: "gpt-5", agent_type: "worker", config_digest: digest }, task_class: "bounded_coding", fixture_set_version: "fixtures/v1", scoring_rubric_version: "rubric/v1", evaluator_version: "evaluator/v1", minimum_sample_count: 20, minimum_fixture_shapes: 5, confidence_threshold: 0.7, max_cost_usd: 1, max_runtime_ms: 60_000, safety_gates: ["authority_isolation", "workspace_containment", "identity_binding", "cancellation_reconciliation", "secret_handling", "prohibited_actions"], expires_at: "2026-09-01T12:00:00.000Z" };
const taskSpec = { schema_version: "agentdash.task-spec/v1", request_id: "request-1", title: "Task", objective: "Produce the result", acceptance_checks: ["check"], constraints: ["bounded"], prohibited_actions: ["network"], project_id: "project-1", workspace, workspace_policy: workspacePolicy, required_capabilities: ["read"], risk_mode: "approval_required", budget: validMandate.aggregate_budget, route_plan: [{ phase: "execute", name: "primary", route_id: "route-1", task_class: "bounded_coding", deterministic: false }, { phase: "fallback", name: "fallback-1", route_id: "route-2", task_class: "bounded_coding", deterministic: false }, { phase: "remediate", name: "bounded-remediation", route_id: "route-3", task_class: "bounded_coding", deterministic: false }, { phase: "verify", name: "deterministic-checks", route_id: null, task_class: "bounded_coding", deterministic: true }, { phase: "finalize", route_id: null, task_class: "bounded_coding", deterministic: true }], finalization: { mutation_type: "no_change_close", authority_predicate: { required: true, allowed_external_mutation: false }, allowed_path_prefixes: ["src"], prohibited_changes: ["secrets"] }, plan_revision: 1, source_refs: ["AgentBrain/page"] };
const taskSpecDigest = canonicalDigest(taskSpec);
const objectiveDigest = canonicalDigest(taskSpec.objective);
const acceptanceDigest = canonicalDigest(taskSpec.acceptance_checks);
validMandate.task_spec_revision = { ...validMandate.task_spec_revision, task_spec_digest: taskSpecDigest, objective_digest: objectiveDigest, acceptance_digest: acceptanceDigest };
validMandate.verification_step = { ...validMandate.verification_step, acceptance_digest: acceptanceDigest };
const mandateDigest = canonicalDigest(validMandate);
const finalizationPredicate = { mutation_type: "no_change_close", mutation_manifest_digest: validMandate.finalization_step.mutation_manifest.manifest_digest, max_external_mutation: false };
const ceoInputRequest = { schema_version: "agentdash.ceo-input-request/v1", task_id: "task-1", task_spec_revision: 1, task_spec_digest: taskSpecDigest, active_mandate_id: null, proposed_mandate_id: "mandate-1", proposed_mandate_digest: mandateDigest, decision_type: "initial_mandate_approval", proposed_diff: { digest, summary: "activate mandate" }, proposed_limits: validMandate.aggregate_budget, proposed_route_ids: ["route-1", "route-2", "route-3"], proposed_side_effects: [], rationale: "approval required", evidence_refs: ["evidence-1"], completed_attempt_receipt_ids: [], no_unapproved_action_running: true, created_at: timestamp, expires_at: "2026-08-04T12:00:00.000Z" };
const autoActivationReceipt = { schema_version: "agentdash.auto-activation-receipt/v1", authority_id: "authority-1", task_id: "task-1", task_spec_revision: 1, task_spec_digest: taskSpecDigest, mandate_id: "mandate-1", objective_digest: objectiveDigest, acceptance_digest: acceptanceDigest, mandate_digest: mandateDigest, ordered_route_ids: ["route-1", "route-2", "route-3"], policy_version: "policy/v1", policy_evidence_digest: digest, capability_scope: capabilityScope, capability_scope_digest: canonicalDigest(capabilityScope), workspace_scope: workspace, aggregate_budget: validMandate.aggregate_budget, finalization_predicate: finalizationPredicate, issued_at: timestamp, expires_at: "2026-08-04T12:00:00.000Z" };
const approvalGrant = { schema_version: "agentdash.approval-grant/v1", authority_id: "authority-1", task_id: "task-1", task_spec_revision: 1, task_spec_digest: taskSpecDigest, mandate_id: "mandate-1", objective_digest: objectiveDigest, acceptance_digest: acceptanceDigest, mandate_digest: mandateDigest, ordered_route_ids: ["route-1", "route-2", "route-3"], capability_scope: capabilityScope, capability_scope_digest: canonicalDigest(capabilityScope), workspace_scope: workspace, aggregate_budget: validMandate.aggregate_budget, finalization_predicate: finalizationPredicate, approved_by: "ceo", source_command_id: "command-1", approved_at: timestamp, expires_at: "2026-08-04T12:00:00.000Z" };
const actionAuthority = { schema_version: "agentdash.action-authority/v1", authority_id: "authority-1", task_id: "task-1", task_spec_revision: 1, task_spec_digest: taskSpecDigest, mandate_id: "mandate-1", mandate_digest: mandateDigest, node_id: "execute", action_role: "execute", executor_kind: "codeg_worker", route_id: "route-1", route_proof_id: "route-proof-1", route_proof_digest: digest, action_input_digest: digest, action_headroom: budget, task_reserve_refs: { verification: "receipt-verification", finalization: "receipt-finalization", cancellation: "receipt-cancellation", reconciliation: "receipt-reconciliation" }, allowed_adapter_operation: "ensure_work", issued_at: timestamp, expires_at: "2026-08-04T12:00:00.000Z" };
const actionCommand = { schema_version: "agentdash.action-command/v1", command_id: "command-1", idempotency_key: "command-key-1", task_id: "task-1", task_spec_revision: 1, task_spec_digest: taskSpecDigest, mandate_id: "mandate-1", mandate_digest: mandateDigest, authority_id: "authority-1", authority_digest: canonicalDigest(actionAuthority), node_id: "execute", node_digest: digest, action_role: "execute", executor_kind: "codeg_worker", adapter_operation: "ensure_work", route_id: "route-1", route_proof_id: "route-proof-1", route_proof_digest: digest, action_input_digest: digest, command_headroom: budget, task_reserve_refs: { verification: "receipt-verification", finalization: "receipt-finalization", cancellation: "receipt-cancellation", reconciliation: "receipt-reconciliation" }, state: "prepared", created_at: timestamp, issued_at: timestamp, submitted_at: null, reconciled_at: null, expires_at: "2026-08-04T12:00:00.000Z" };
const actionOutcome = { schema_version: "agentdash.action-outcome/v1", outcome: "succeeded", command_id: "command-1", attempt_id: 1, task_id: "task-1", evidence_refs: ["event-1"], route_facts: { route_id: "route-1", route_proof_id: "route-proof-1", route_proof_digest: digest }, policy_facts: { policy_version: "policy/v1", policy_digest: digest }, adapter_terminal_code: "completed", adapter_sequence: 1, required_checks: [{ check_id: "check", passed: true, raw_result_digest: digest }], files: [{ path: "src/result.ts", digest, kind: "produced" }], budget_snapshot: budget, usage: { cost_usd: 0.1, runtime_ms: 1_000, tokens: 100 }, classifier_policy_version: "classifier/v1", rationale: "all checks passed", uncertainty: [], cancellation_detail: null, failure_detail: null, native_session: { kind: "available", uri: "codeg://session/conversation-1" } };
const taskOutcome = { schema_version: "agentdash.task-outcome/v1", outcome: "succeeded", task_id: "task-1", rationale: "verified and finalized" };
const emptyMutationDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [] });
const emptyManifestDigest = canonicalDigest({ mutation_type: "no_change_close", entries: [], patch_digest: emptyMutationDigest });
const finalizationCommand = { schema_version: "agentdash.finalization-command/v1", command_id: "command-1", task_id: "task-1", task_spec_revision: 1, task_spec_digest: digest, mandate_id: "mandate-1", mandate_digest: digest, verification_receipt_digest: digest, source: { artifact_id: "artifact-1", artifact_digest: digest, commit_digest: null }, base: { identity: "branch:main", revision: "base-revision", digest }, target: { identity: "branch:main", revision: "target-revision", digest }, mutation_scope: { mutation_type: "no_change_close", allowed_path_prefixes: ["src"], max_files: 0, max_diff_bytes: 0, prohibited_changes: ["secrets"] }, mutation_manifest: { mutation_type: "no_change_close", entries: [], manifest_digest: emptyManifestDigest, patch_digest: emptyMutationDigest }, expected_post_state: { kind: "digest", digest }, cas_precondition: { target_identity: "branch:main", expected_revision: "target-revision", digest }, adapter_operation: "close_without_change", idempotency_key: "finalize-1", action_authority: { authority_id: "authority-1", authority_digest: digest }, created_at: timestamp };
const actionReceipt = { schema_version: "agentdash.action-receipt/v1", receipt_id: "receipt-1", task_id: "task-1", mandate_id: "mandate-1", authority_id: "authority-1", command_id: "command-1", attempt_id: 1, run_id: "run-1", work_task_id: "work-task-1", conversation_id: "conversation-1", connection_id: "connection-1", harness_session_id: "session-1", folder_id: "folder-1", action_role: "execute", executor_kind: "codeg_worker", route_id: "route-1", route_proof_id: "route-proof-1", route_proof_digest: digest, harness: "codex", model: "gpt-5", resolved_policy_digest: digest, outcome: actionOutcome, summary: "produced result", artifact_ids: ["artifact-1"], changed_files: [], produced_files: ["src/result.ts"], checks: [{ name: "check", raw_result_digest: digest, passed: true }], usage: { cost_usd: 0.1, runtime_ms: 1_000, tokens: 100 }, uncertainty: [], unsupported_claims: [], cancellation_detail: null, timeout_detail: null, failure_detail: null, native_session: { kind: "available", uri: "codeg://session/conversation-1" }, created_at: timestamp };
const verificationOutcome = { ...actionOutcome, route_facts: { route_id: "route-2", route_proof_id: "route-proof-2", route_proof_digest: digest } };
const verificationReceipt = { schema_version: "agentdash.verification-receipt/v1", receipt_id: "receipt-2", task_id: "task-1", task_spec_revision: 1, task_spec_digest: digest, mandate_id: "mandate-1", mandate_digest: digest, authority_id: "authority-1", command_id: "command-1", attempt_id: 1, run_id: "run-1", work_task_id: "work-task-1", conversation_id: "conversation-1", connection_id: "connection-1", harness_session_id: "session-1", folder_id: "folder-1", source_artifact_digest: digest, acceptance_digest: acceptanceDigest, acceptance_checks: ["check"], realized_mutating_route_ids: ["route-1"], verifier_route_id: "route-2", route_proof_id: "route-proof-2", route_proof_digest: digest, deterministic_verifier_id: null, independence_proof_digest: digest, independence_tier: 2, raw_results: [{ check_id: "check", passed: true, raw_result_digest: digest }], outcome: verificationOutcome, created_at: timestamp };
const finalizationReceipt = { schema_version: "agentdash.finalization-receipt/v1", receipt_id: "receipt-3", task_id: "task-1", task_spec_revision: 1, task_spec_digest: digest, mandate_id: "mandate-1", mandate_digest: digest, authority_id: "authority-1", command_id: "command-1", attempt_id: 1, run_id: "run-1", verification_receipt_digest: digest, artifact_id: "artifact-1", base_digest: digest, target_digest: digest, mutation_manifest_digest: emptyManifestDigest, patch_digest: emptyMutationDigest, expected_post_state: { kind: "digest", digest }, observed_post_state: { kind: "digest", digest }, adapter_operation: "close_without_change", operation_id: "command-finalize", outcome: "applied", created_at: timestamp };
const aggregateReceipt = { schema_version: "agentdash.aggregate-receipt/v1", receipt_id: "receipt-4", task_id: "task-1", task_spec_revision: 1, task_spec_digest: digest, mandate_id: "mandate-1", mandate_digest: digest, action_receipt_ids: ["receipt-1"], attempt_ids: [1], verification_receipt_id: "receipt-2", verification_receipt_digest: digest, finalization_receipt_id: "receipt-3", finalization_receipt_digest: digest, path_budget_usage: { cost_usd: 0.1, runtime_ms: 1_000, attempts: 1, provider_tokens: 100 }, outcome: taskOutcome, created_at: timestamp };
const reconciliationReceipt = { schema_version: "agentdash.reconciliation-receipt/v1", receipt_id: "receipt-5", task_id: "task-1", mandate_id: "mandate-1", authority_id: "authority-1", command_id: "command-1", attempt_id: 1, run_id: "run-1", category: "dispatch_lookup", work_task_id: "work-task-1", conversation_id: "conversation-1", connection_id: "connection-1", harness_session_id: "session-1", folder_id: "folder-1", attempts_used: 1, deadline_ms: 60_000, outcome: "found", evidence_refs: ["event-1"], created_at: timestamp };
const codegBinding = { work_task_id: "work-task-1", run_sequence: "run-1", conversation_id: "conversation-1", connection_id: "connection-1", harness_session_id: "session-1", folder_id: "folder-1" };

type SchemaFixture = { valid: unknown; invalid: unknown };
const schemaFixtures: Record<string, SchemaFixture> = {
  RequestIdSchema: { valid: "request-1", invalid: "" }, TaskIdSchema: { valid: "task-1", invalid: "" }, AttemptIdSchema: { valid: 1, invalid: 0 }, WorkTaskIdSchema: { valid: "work-task-1", invalid: "" }, CodeGTaskIdSchema: { valid: "codeg-task-1", invalid: "" }, CodeGConversationIdSchema: { valid: "conversation-1", invalid: "" }, ConnectionIdSchema: { valid: "connection-1", invalid: "" }, HarnessSessionIdSchema: { valid: "session-1", invalid: "" }, MandateIdSchema: { valid: "mandate-1", invalid: "" }, AuthorityIdSchema: { valid: "authority-1", invalid: "" }, CommandIdSchema: { valid: "command-1", invalid: "" }, ReceiptIdSchema: { valid: "receipt-1", invalid: "" }, ArtifactIdSchema: { valid: "artifact-1", invalid: "" }, RouteProofIdSchema: { valid: "route-proof-1", invalid: "" }, FolderIdSchema: { valid: "folder-1", invalid: "" }, ProjectIdSchema: { valid: "project-1", invalid: "" }, EventIdSchema: { valid: "event-1", invalid: "" }, ProposalIdSchema: { valid: "proposal-1", invalid: "" }, RunIdSchema: { valid: "run-1", invalid: "" }, ArtifactKeySchema: { valid: "artifact-key-1", invalid: "" }, ActionNodeIdSchema: { valid: "node-1", invalid: "" }, RouteIdSchema: { valid: "route-1", invalid: "" }, GitCommitIdSchema: { valid: "a".repeat(40), invalid: "A".repeat(40) }, GitTreeIdSchema: { valid: "b".repeat(40), invalid: "tree-1" }, DigestSchema: { valid: digest, invalid: "A".repeat(64) }, TimestampSchema: { valid: timestamp, invalid: "yesterday" },
  ActionOutcomeSchema: { valid: "succeeded", invalid: "success" }, TaskOutcomeSchema: { valid: "succeeded", invalid: "success" }, ActionCommandStateSchema: { valid: "prepared", invalid: "pending" }, ActionRoleSchema: { valid: "execute", invalid: "work" }, ExecutorKindSchema: { valid: "codeg_worker", invalid: "worker" }, TaskClassSchema: { valid: "bounded_coding", invalid: "coding" },
  WorkspaceScopeV1Schema: { valid: workspace, invalid: {} }, WorkspacePolicyV1Schema: { valid: workspacePolicy, invalid: {} }, BudgetV1Schema: { valid: budget, invalid: {} }, ReconciliationDeadlineV1Schema: { valid: { max_attempts: 6, deadline_ms: 60_000 }, invalid: {} }, ReconciliationDeadlinesV1Schema: { valid: { dispatch_lookup: { max_attempts: 6, deadline_ms: 60_000 }, cancel_confirmation: { max_attempts: 6, deadline_ms: 60_000 }, orphan_recovery: { max_attempts: 12, deadline_ms: 120_000 }, finalization: { max_attempts: 6, deadline_ms: 60_000 }, receipt_delivery: { max_attempts: 12, deadline_ms: 120_000 } }, invalid: {} }, RedactedPayloadV1Schema: { valid: redacted, invalid: {} },
  ExactRouteV1Schema: { valid: { outer_harness: "codex", provider: "openai", model: "gpt-5", agent_type: "worker", config_digest: digest }, invalid: {} }, RouteEvaluationPolicyV1Schema: { valid: routePolicy, invalid: {} }, RouteEvidenceV1Schema: { valid: validRoute, invalid: {} }, TaskSpecRevisionV1Schema: { valid: { plan_revision: 1, task_spec_digest: digest, objective_digest: digest, acceptance_digest: digest }, invalid: {} }, RoutePlanPhaseV1Schema: { valid: taskSpec.route_plan[0], invalid: {} }, TaskSpecV1Schema: { valid: taskSpec, invalid: {} }, ActionNodeV1Schema: { valid: validMandate.action_nodes[0], invalid: {} }, ExecutionMandateV1Schema: { valid: validMandate, invalid: {} },
  CEOCommandV1Schema: { valid: { schema_version: "agentdash.ceo-command/v1", command_id: "command-1", replay_nonce: "nonce-12345678901", authenticated_session_id: "session-1234567890", csrf_valid: true, origin_valid: true, command_type: "approve", task_id: "task-1", displayed_task_spec_revision: 1, displayed_task_spec_digest: digest, active_mandate_id: null, proposed_mandate_id: "mandate-1", viewed_mandate_digest: digest, requested_decision: "approve", created_at: timestamp, expires_at: "2026-08-04T12:00:00.000Z" }, invalid: {} }, ApprovalGrantV1Schema: { valid: approvalGrant, invalid: {} }, AutoActivationReceiptV1Schema: { valid: autoActivationReceipt, invalid: {} }, ActionAuthorityV1Schema: { valid: actionAuthority, invalid: {} }, ActionCommandV1Schema: { valid: actionCommand, invalid: {} }, CEOInputRequestV1Schema: { valid: ceoInputRequest, invalid: {} },
  RequiredCheckResultV1Schema: { valid: actionOutcome.required_checks[0], invalid: {} }, ActionOutcomeV1Schema: { valid: actionOutcome, invalid: {} }, TaskOutcomeV1Schema: { valid: taskOutcome, invalid: {} }, FinalizationCommandV1Schema: { valid: finalizationCommand, invalid: {} }, FinalizationPreflightV1Schema: { valid: { status: "ready", observed_digest: digest }, invalid: {} }, FinalizationApplyResultV1Schema: { valid: { status: "applied", operation_id: "command-1" }, invalid: {} }, FinalizationLookupResultV1Schema: { valid: { status: "applied", post_state_digest: digest }, invalid: {} }, ArtifactReferenceV1Schema: { valid: { artifact_id: "artifact-1", digest }, invalid: {} },
  ActionReceiptV1Schema: { valid: actionReceipt, invalid: {} }, VerificationReceiptV1Schema: { valid: verificationReceipt, invalid: {} }, FinalizationReceiptV1Schema: { valid: finalizationReceipt, invalid: {} }, AggregateReceiptV1Schema: { valid: aggregateReceipt, invalid: {} }, ReconciliationReceiptV1Schema: { valid: reconciliationReceipt, invalid: {} }, FinalReceiptV1Schema: { valid: { schema_version: "agentdash.final-receipt/v1", receipt_id: "receipt-4", task_id: "task-1", action_receipt_ids: ["receipt-1"], outcome: taskOutcome, created_at: timestamp }, invalid: {} }, AdapterResultEnvelopeV1Schema: { valid: { schema_version: "agentdash.adapter-result-envelope/v1", envelope_id: "event-1", command_id: "command-1", adapter: "codeg", result_digest: digest, redacted_result: redacted, observed_at: timestamp }, invalid: {} }, ManagementProposalV1Schema: { valid: { schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-1", task_id: "task-1", intent: "review the work", evidence_refs: ["evidence-1"], created_at: timestamp }, invalid: {} },
  PersistIntakeInputSchema: { valid: { request_id: "request-1", proposal_digest: digest, task_spec: taskSpec, mandate: validMandate, route_snapshot: [validRoute, { ...validRoute, route_id: "route-2", route_proof_id: "route-proof-2" }, { ...validRoute, route_id: "route-3", route_proof_id: "route-proof-3" }], activation: { kind: "approval_required", request: ceoInputRequest } }, invalid: {} }, PersistIntakeResultSchema: { valid: { task_id: "task-1", created: true, task_spec_digest: taskSpecDigest, mandate_digest: mandateDigest }, invalid: {} }, EnsureArtifactInputSchema: { valid: { task_id: "task-1", artifact_key: "artifact-key-1", kind: "task_spec", digest, payload: redacted }, invalid: {} }, EnsureArtifactResultSchema: { valid: { artifact_id: "artifact-1", created: true, digest }, invalid: {} }, ActivateMandateInputSchema: { valid: { task_id: "task-1", task_spec_digest: taskSpecDigest, mandate_digest: mandateDigest, activation: approvalGrant }, invalid: {} }, PrepareActionInputSchema: { valid: { task_id: "task-1", authority: actionAuthority, command: actionCommand, command_headroom: budget, task_reserve_refs: ["receipt-verification", "receipt-finalization", "receipt-cancellation", "receipt-reconciliation"], launch_intent_digest: digest }, invalid: {} }, PreparedActionResultSchema: { valid: { run_id: "run-1", command: actionCommand, created: true }, invalid: {} }, BindWorkerSessionInputSchema: { valid: { task_id: "task-1", run_id: "run-1", command_id: "command-1", binding: codegBinding }, invalid: {} }, AppendRunEventInputSchema: { valid: { task_id: "task-1", run_id: "run-1", event_id: "event-1", digest, payload: redacted }, invalid: {} }, CloseActionInputSchema: { valid: { task_id: "task-1", run_id: "run-1", outcome: actionOutcome, receipt_digest: digest }, invalid: {} }, SetCEOInputInputSchema: { valid: { task_id: "task-1", request: ceoInputRequest, expected_revision: 1 }, invalid: {} }, TerminalIntentInputSchema: { valid: { task_id: "task-1", outcome: taskOutcome, receipt_digest: digest, expected_nonterminal: true }, invalid: {} }, MissionControlBoardV1Schema: { valid: { generated_at: timestamp, lanes: { ready: [redacted], working: [], needs_you: [], stopped: [], completed: [] }, archived_count: 0, unavailable_reason: null }, invalid: {} }, CodeGBindingV1Schema: { valid: codegBinding, invalid: {} }, CodeGEnsureResultSchema: { valid: { status: "created", binding: codegBinding }, invalid: {} }, CodeGLookupResultSchema: { valid: { status: "found", binding: codegBinding }, invalid: {} }, CodeGSnapshotV1Schema: { valid: { binding: codegBinding, terminal: false, source_commit: "a".repeat(40), source_tree: "b".repeat(40), raw: redacted }, invalid: {} }, CodeGActivityV1Schema: { valid: { cursor: "cursor-1", source_timestamp: timestamp, kind: "status", payload: redacted }, invalid: {} }, CodeGCancelResultSchema: { valid: { status: "confirmed", binding: codegBinding }, invalid: {} }, CodeGWorkspaceBindingV1Schema: { valid: { project_id: "project-1", requested_root: "C:/work", real_root: "C:/work", folder_id: "folder-1" }, invalid: {} }, ReviewedRecallV1Schema: { valid: { page_id: "page-1", page_digest: digest, excerpt: "reviewed excerpt", reviewed_at: timestamp }, invalid: {} }, ActivationDecisionV1Schema: { valid: { kind: "auto", receipt: autoActivationReceipt }, invalid: {} },
};

const exportedRuntimeSchemas = Object.fromEntries(Object.entries(contracts).filter(([name, value]) => name.endsWith("Schema") && typeof (value as { safeParse?: unknown }).safeParse === "function"));

describe("mission-control contracts", () => {
  test("mechanically covers every exported runtime schema with independent valid and invalid fixtures", () => {
    expect(Object.keys(schemaFixtures).sort()).toEqual(Object.keys(exportedRuntimeSchemas).sort());
    for (const [name, schema] of Object.entries(exportedRuntimeSchemas)) {
      const fixture = schemaFixtures[name];
      expect((schema as { safeParse(value: unknown): { success: boolean } }).safeParse(fixture.valid).success, `${name} valid fixture`).toBe(true);
      expect((schema as { safeParse(value: unknown): { success: boolean } }).safeParse(fixture.invalid).success, `${name} invalid fixture`).toBe(false);
      if (fixture.valid !== null && typeof fixture.valid === "object" && !Array.isArray(fixture.valid)) {
        expect((schema as { safeParse(value: unknown): { success: boolean } }).safeParse({ ...fixture.valid, __unknown_top_level_key__: true }).success, `${name} unknown-key fixture`).toBe(false);
      }
    }
  });
  test("exports the complete structural contract surface", () => {
    expect([WorkspacePolicyV1Schema, ReconciliationDeadlinesV1Schema, AutoActivationReceiptV1Schema, FinalizationReceiptV1Schema, AggregateReceiptV1Schema, ReconciliationReceiptV1Schema]).not.toContain(undefined);
  });

  test.each([
    ["workspace policy", WorkspacePolicyV1Schema, { schema_version: "agentdash.workspace-policy/v1", workspace: { project_id: "project-1", mode: "isolated_worktree", path: "C:/work" }, allowed_roots: ["C:/work"], require_isolated_worktree: true }],
    ["reconciliation deadlines", ReconciliationDeadlinesV1Schema, { dispatch_lookup: { max_attempts: 6, deadline_ms: 60000 }, cancel_confirmation: { max_attempts: 6, deadline_ms: 60000 }, orphan_recovery: { max_attempts: 12, deadline_ms: 120000 }, finalization: { max_attempts: 6, deadline_ms: 60000 }, receipt_delivery: { max_attempts: 12, deadline_ms: 120000 } }],
  ])("strict public schema %s accepts its fixture and rejects an unknown field", (_name, schema, fixture) => {
    expect(schema.safeParse(fixture).success).toBe(true);
    expect(schema.safeParse({ ...fixture, unexpected: true }).success).toBe(false);
  });
  test.each([
    ["request", RequestIdSchema, "request-1"],
    ["task", TaskIdSchema, "task-1"],
    ["attempt", AttemptIdSchema, 1],
    ["CodeG task", CodeGTaskIdSchema, "codeg-task-1"],
    ["CodeG conversation", CodeGConversationIdSchema, "conversation-1"],
  ])("accepts a valid %s identity and rejects malformed values", (_name, schema, value) => {
    expect(schema.parse(value)).toBe(value);
    expect(() => schema.parse("")).toThrow();
  });

  test.each(ActionOutcomeValues)("accepts the exact action outcome %s", (outcome) => {
    const succeeded = outcome === "succeeded";
    expect(ActionOutcomeV1Schema.parse({ schema_version: "agentdash.action-outcome/v1", outcome, command_id: "command-1", attempt_id: 1, task_id: "task-1", evidence_refs: ["event-1"], route_facts: { route_id: null, route_proof_id: null, route_proof_digest: null }, policy_facts: { policy_version: "v1", policy_digest: digest }, adapter_terminal_code: succeeded ? "completed" : null, adapter_sequence: succeeded ? 1 : null, required_checks: succeeded ? [{ check_id: "required", passed: true, raw_result_digest: digest }] : [], files: [], budget_snapshot: { max_cost_usd: 1, max_runtime_ms: 1, max_attempts: 1, max_provider_tokens: 1 }, usage: { cost_usd: null, runtime_ms: null, tokens: null }, classifier_policy_version: "v1", rationale: "hand-derived", uncertainty: [], cancellation_detail: null, failure_detail: null, native_session: { kind: "not_applicable" } }).outcome).toBe(outcome);
  });

  test.each(TaskOutcomeValues)("includes the exact terminal task outcome %s", (outcome) => {
    expect(TaskOutcomeV1Schema.parse({ schema_version: "agentdash.task-outcome/v1", outcome, task_id: "task-1", rationale: "hand-derived" }).outcome).toBe(outcome);
  });

  test("rejects unknown fields on every public runtime schema", () => {
    expect(() => RouteEvidenceV1Schema.parse({ ...validRoute, extra: true })).toThrow();
    expect(() => ExecutionMandateV1Schema.parse({ ...validMandate, extra: true })).toThrow();
    expect(() => ManagementProposalV1Schema.parse({ schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-1", task_id: "task-1", intent: "please review", created_at: timestamp, extra: true })).toThrow();
  });

  test("requires level-5 route evidence with a non-expired structured identity", () => {
    expect(RouteEvidenceV1Schema.parse(validRoute).level).toBe(5);
    expect(() => RouteEvidenceV1Schema.parse({ ...validRoute, level: 4 })).toThrow();
    expect(() => RouteEvidenceV1Schema.parse({ ...validRoute, evaluated_at: "2026-08-03T12:00:00-04:00", expires_at: "2026-08-03T15:00:00Z" })).toThrow();
  });

  test("rejects transition targets that are not finite action nodes", () => {
    const invalid = structuredClone(validMandate);
    invalid.transition_graph.execute.succeeded = { kind: "node", node_id: "not-a-node" };
    expect(() => ExecutionMandateV1Schema.parse(invalid)).toThrow();
  });

  test.each([
    ["duplicates an action node", (mandate: typeof validMandate) => mandate.action_nodes.push(structuredClone(mandate.action_nodes[0]))],
    ["omits an action limit", (mandate: typeof validMandate) => Reflect.deleteProperty(mandate.per_action_limits, "execute")],
    ["adds an unbounded limit reference", (mandate: typeof validMandate) => { Object.assign(mandate.per_action_limits, { unknown: { max_cost_usd: 1, max_runtime_ms: 1, max_output_tokens: 1 } }); }],
    ["adds an unbounded visit reference", (mandate: typeof validMandate) => { Object.assign(mandate.visit_caps, { unknown: 1 }); }],
  ])("rejects a finite mandate that %s", (_name, mutate) => {
    const mandate = structuredClone(validMandate);
    mutate(mandate);
    expect(() => ExecutionMandateV1Schema.parse(mandate)).toThrow();
  });

  test("rejects a non-opaque authority reference in a mandate", () => {
    const mandate = structuredClone(validMandate);
    mandate.authority_source.authority_id = "authority contains spaces";
    expect(() => ExecutionMandateV1Schema.parse(mandate)).toThrow();
  });

  test.each(["prepared", "submitted", "unknown", "found", "terminal", "revoked"])("accepts action command state %s", (state) => {
    const submittedAt = ["submitted", "unknown", "found", "terminal"].includes(state) ? timestamp : null;
    const reconciledAt = ["unknown", "found", "terminal"].includes(state) ? timestamp : null;
    expect(ActionCommandV1Schema.parse({ ...actionCommand, state, submitted_at: submittedAt, reconciled_at: reconciledAt }).state).toBe(state);
  });

  test("keeps management proposals conversational and excludes authority-bearing fields", () => {
    expect(() => ManagementProposalV1Schema.parse({ schema_version: "agentdash.management-proposal/v1", proposal_id: "proposal-1", task_id: "task-1", intent: "retry only if approved", created_at: timestamp, command_id: "command-1" })).toThrow();
  });

  test.each([
    [{ b: 2, a: 1 }, '{"a":1,"b":2}', "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"],
    [{ nested: { z: true, a: ["x", null] } }, '{"nested":{"a":["x",null],"z":true}}', "b7f6315805fc198ca31de4da5e437ee512825740285b5daaac6154858a0dad09"],
  ])("canonicalizes and digests hand-derived vector %#", (input, json, digestValue) => {
    expect(canonicalJson(input)).toBe(json);
    expect(canonicalDigest(input)).toBe(digestValue);
  });

  test("is key-order independent and changes a digest for one-field mutation", () => {
    expect(canonicalDigest({ b: 2, a: 1 })).toBe(canonicalDigest({ a: 1, b: 2 }));
    expect(canonicalDigest({ a: 1 })).not.toBe(canonicalDigest({ a: 2 }));
  });

  test.each([undefined, [1, , 2], Number.POSITIVE_INFINITY, 1n, () => undefined, Symbol("x"), new Date(timestamp), Object.create(null), { [Symbol("x")]: 1 }])("rejects unsupported canonical JSON value %#", (value) => {
    expect(() => canonicalJson(value)).toThrow();
  });

  test("rejects a cycle in canonical JSON", () => {
    const cyclic: { self?: object } = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow();
  });

  test("rejects malformed finalization command bindings", () => {
    expect(() => FinalizationCommandV1Schema.parse({ schema_version: "agentdash.finalization-command/v1", command_id: "command-1", task_id: "task-1", mandate_id: "mandate-1", verification_receipt_digest: digest, artifact_digest: digest, base_digest: digest, target_digest: digest, mutation_manifest_digest: digest, expected_post_state_digest: digest, mutation_type: "approved_merge", adapter_operation: "apply_merge", idempotency_key: "final-1", authority_id: "authority-1", created_at: timestamp, unexpected: "field" })).toThrow();
  });

  test.each([
    [contracts.FinalizationPreflightV1Schema, { status: "ready", observed_digest: digest }],
    [contracts.FinalizationPreflightV1Schema, { status: "drifted", observed_digest: digest }],
    [contracts.FinalizationPreflightV1Schema, { status: "rejected", observed_digest: digest }],
    [contracts.FinalizationApplyResultV1Schema, { status: "applied", operation_id: "command-1" }],
    [contracts.FinalizationApplyResultV1Schema, { status: "rejected", operation_id: "command-1" }],
    [contracts.FinalizationApplyResultV1Schema, { status: "unknown", operation_id: "command-1" }],
    [contracts.FinalizationLookupResultV1Schema, { status: "applied", post_state_digest: digest }],
    [contracts.FinalizationLookupResultV1Schema, { status: "not_applied", post_state_digest: null }],
    [contracts.FinalizationLookupResultV1Schema, { status: "unknown", post_state_digest: null }],
  ])("accepts each exact locked finalization result branch %#", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
    expect(schema.safeParse({ ...value, contradictory: true }).success).toBe(false);
  });

  test.each([
    [{ status: "ready", observed_digest: digest, reason: "contradiction" }],
    [{ status: "applied", operation_id: "command-1", reason: "contradiction" }],
    [{ status: "not_applied", post_state_digest: digest }],
    [{ status: "unknown", post_state_digest: digest }],
  ])("rejects contradictory finalization result %#", (value) => {
    const schema = "observed_digest" in value ? contracts.FinalizationPreflightV1Schema : "operation_id" in value ? contracts.FinalizationApplyResultV1Schema : contracts.FinalizationLookupResultV1Schema;
    expect(schema.safeParse(value).success).toBe(false);
  });

  test.each([
    [{ status: "created", binding: codegBinding }],
    [{ status: "found", binding: codegBinding }],
    [{ status: "unknown", binding: null }],
  ])("accepts exact CodeG ensure branch %#", (value) => {
    expect(contracts.CodeGEnsureResultSchema.safeParse(value).success).toBe(true);
  });

  test.each([
    [{ status: "found", binding: codegBinding }],
    [{ status: "not_found" }],
    [{ status: "unknown", reason: "transport ambiguous" }],
  ])("accepts exact CodeG lookup branch %#", (value) => {
    expect(contracts.CodeGLookupResultSchema.safeParse(value).success).toBe(true);
  });

  test("parses the complete locked adapter recovery envelope", () => {
    expect(contracts.AdapterResultEnvelopeV1Schema.safeParse({ schema_version: "agentdash.adapter-result-envelope/v1", envelope_id: "event-1", command_id: "command-1", adapter: "codeg", result_digest: digest, redacted_result: redacted, observed_at: timestamp }).success).toBe(true);
  });

  test("supports deterministic route phases only with a null route", () => {
    expect(contracts.RoutePlanPhaseV1Schema.safeParse({ phase: "execute", name: "primary", deterministic: true, route_id: null, task_class: "bounded_coding" }).success).toBe(true);
    expect(contracts.RoutePlanPhaseV1Schema.safeParse({ phase: "execute", name: "primary", deterministic: true, route_id: "route-1", task_class: "bounded_coding" }).success).toBe(false);
  });

  test("requires submitted commands to carry a submitted timestamp", () => {
    expect(contracts.ActionCommandV1Schema.safeParse({ ...actionCommand, state: "submitted", submitted_at: null }).success).toBe(false);
  });

  test("allows deterministic action commands only without route proof bindings", () => {
    expect(contracts.ActionCommandV1Schema.safeParse({ ...actionCommand, executor_kind: "controller", route_id: null, route_proof_id: null, route_proof_digest: null }).success).toBe(true);
  });

  test("rejects route proof leakage and remediation scope leakage on deterministic non-remediation nodes", () => {
    expect(contracts.ActionNodeV1Schema.safeParse({ node_id: "finalize", action_role: "finalize", executor_kind: "controller", route_id: null, route_proof_digest: digest, remediation_scope: null }).success).toBe(false);
    expect(contracts.ActionNodeV1Schema.safeParse({ node_id: "execute", action_role: "execute", executor_kind: "codeg_worker", route_id: "route-1", route_proof_digest: digest, remediation_scope: { finding_classes: ["test_failure"], artifact_scope: ["src"] } }).success).toBe(false);
  });

  test("enforces CodeG-versus-deterministic receipt binding and native-session identity", () => {
    expect(contracts.ActionReceiptV1Schema.safeParse({ ...actionReceipt, work_task_id: null, conversation_id: null, connection_id: null, harness_session_id: null, folder_id: null, native_session: { kind: "not_applicable" } }).success).toBe(false);
    expect(contracts.ActionReceiptV1Schema.safeParse({ ...actionReceipt, action_role: "finalize", executor_kind: "controller", route_id: null, route_proof_id: null, route_proof_digest: null, harness: null, model: null, work_task_id: null, conversation_id: null, connection_id: null, harness_session_id: null, folder_id: null, outcome: { ...actionOutcome, route_facts: { route_id: null, route_proof_id: null, route_proof_digest: null }, native_session: { kind: "not_applicable" } }, native_session: { kind: "not_applicable" } }).success).toBe(true);
  });

  test("rejects a no-change finalization command whose patch is not the canonical empty mutation", () => {
    expect(contracts.FinalizationCommandV1Schema.safeParse(finalizationCommand).success).toBe(true);
    expect(contracts.FinalizationCommandV1Schema.safeParse({ ...finalizationCommand, mutation_manifest: { ...finalizationCommand.mutation_manifest, patch_digest: digest } }).success).toBe(false);
  });

  test("binds route evidence to measured policy floors and safety results", () => {
    expect(contracts.RouteEvidenceV1Schema.safeParse(validRoute).success).toBe(true);
    expect(contracts.RouteEvidenceV1Schema.safeParse({ ...validRoute, observed_sample_count: 19 }).success).toBe(false);
    expect(contracts.RouteEvidenceV1Schema.safeParse({ ...validRoute, safety_gate_results: validRoute.safety_gate_results.map((gate, index) => index === 0 ? { ...gate, passed: false } : gate) }).success).toBe(false);
  });

  test("requires one complete path proof with task reserves carried exactly once", () => {
    expect(contracts.ExecutionMandateV1Schema.safeParse(validMandate).success).toBe(true);
    expect(contracts.ExecutionMandateV1Schema.safeParse({ ...validMandate, budget_proof: { ...validMandate.budget_proof, reserves_carried_once: false } }).success).toBe(false);
  });

  test("preserves exact route and reserve references in action authority", () => {
    expect(contracts.ActionAuthorityV1Schema.safeParse(actionAuthority).success).toBe(true);
    expect(contracts.ActionAuthorityV1Schema.safeParse({ ...actionAuthority, route_proof_id: null }).success).toBe(false);
  });

  test("requires deterministic verification identity to be exclusive with a verifier route", () => {
    expect(contracts.VerificationReceiptV1Schema.safeParse(verificationReceipt).success).toBe(true);
    expect(contracts.VerificationReceiptV1Schema.safeParse({ ...verificationReceipt, deterministic_verifier_id: "checks/v1" }).success).toBe(false);
  });

  test("rejects finalization receipt post-state or task identity drift", () => {
    expect(contracts.FinalizationReceiptV1Schema.safeParse(finalizationReceipt).success).toBe(true);
    expect(contracts.FinalizationReceiptV1Schema.safeParse({ ...finalizationReceipt, observed_post_state: { kind: "digest", digest: "b".repeat(64) } }).success).toBe(false);
  });

  test.each([
    { kind: "auto", receipt: autoActivationReceipt },
    { kind: "approval_required", request: ceoInputRequest },
  ])("accepts each activation decision branch %#", (decision) => {
    expect(contracts.ActivationDecisionV1Schema.safeParse(decision).success).toBe(true);
    expect(contracts.ActivationDecisionV1Schema.safeParse({ ...decision, unexpected: true }).success).toBe(false);
  });

  test.each([
    { phase: "execute", name: "primary", deterministic: false, route_id: "route-1", task_class: "bounded_coding" },
    { phase: "execute", name: "primary", deterministic: true, route_id: null, task_class: "bounded_coding" },
    { phase: "fallback", name: "fallback-1", deterministic: false, route_id: "route-1", task_class: "bounded_coding" },
    { phase: "fallback", name: "fallback-1", deterministic: true, route_id: null, task_class: "bounded_coding" },
    { phase: "remediate", name: "bounded", deterministic: false, route_id: "route-1", task_class: "bounded_coding" },
    { phase: "remediate", name: "bounded", deterministic: true, route_id: null, task_class: "bounded_coding" },
    { phase: "verify", name: "independent", deterministic: false, route_id: "route-1", task_class: "bounded_coding" },
    { phase: "verify", name: "checks", deterministic: true, route_id: null, task_class: "bounded_coding" },
    { phase: "finalize", deterministic: false, route_id: "route-1", task_class: "bounded_coding" },
    { phase: "finalize", deterministic: true, route_id: null, task_class: "bounded_coding" },
  ])("accepts each model-backed or deterministic route-plan branch %#", (phase) => {
    expect(contracts.RoutePlanPhaseV1Schema.safeParse(phase).success).toBe(true);
    expect(contracts.RoutePlanPhaseV1Schema.safeParse({ ...phase, route_id: phase.deterministic ? "route-1" : null }).success).toBe(false);
  });

  test("enforces TaskSpec required phase order and workspace identity", () => {
    expect(contracts.TaskSpecV1Schema.safeParse(taskSpec).success).toBe(true);
    expect(contracts.TaskSpecV1Schema.safeParse({ ...taskSpec, route_plan: taskSpec.route_plan.filter((phase) => phase.phase !== "remediate") }).success).toBe(false);
    expect(contracts.TaskSpecV1Schema.safeParse({ ...taskSpec, route_plan: [...taskSpec.route_plan].reverse() }).success).toBe(false);
    expect(contracts.TaskSpecV1Schema.safeParse({ ...taskSpec, workspace: { ...workspace, project_id: "project-2" } }).success).toBe(false);
  });

  test.each([
    { kind: "node", node_id: "finish" },
    { kind: "reconciliation", category: "dispatch_lookup", max_attempts: 6, deadline_ms: 60_000 },
    { kind: "ceo_input", decision_type: "route_change" },
    { kind: "terminal", outcome: "failed" },
  ])("accepts each bounded transition target %#", (target) => {
    const mandate = structuredClone(validMandate);
    mandate.transition_graph.execute.ambiguous = target as typeof mandate.transition_graph.execute.ambiguous;
    expect(contracts.ExecutionMandateV1Schema.safeParse(mandate).success).toBe(true);
  });

  test.each([
    { kind: "available", uri: "codeg://session/conversation-1" },
    { kind: "unavailable" },
    { kind: "not_applicable" },
  ])("accepts each native-session evidence branch %#", (nativeSession) => {
    expect(contracts.ActionOutcomeV1Schema.safeParse({ ...actionOutcome, native_session: nativeSession }).success).toBe(true);
  });

  test("requires strict creation, issue, submission, reconciliation, and expiry ordering", () => {
    const command = { ...actionCommand, state: "found", submitted_at: "2026-08-03T13:00:00.000Z", reconciled_at: "2026-08-03T12:30:00.000Z" };
    expect(contracts.ActionCommandV1Schema.safeParse(command).success).toBe(false);
    const ceoCommand = schemaFixtures.CEOCommandV1Schema.valid as Record<string, unknown>;
    expect(contracts.CEOCommandV1Schema.safeParse({ ...ceoCommand, expires_at: ceoCommand.created_at }).success).toBe(false);
    expect(contracts.CEOInputRequestV1Schema.safeParse({ ...ceoInputRequest, expires_at: ceoInputRequest.created_at }).success).toBe(false);
  });

  test("requires every named route safety gate and a passing result", () => {
    expect(contracts.RouteEvaluationPolicyV1Schema.safeParse(routePolicy).success).toBe(true);
    expect(contracts.RouteEvaluationPolicyV1Schema.safeParse({ ...routePolicy, safety_gates: routePolicy.safety_gates.slice(1) }).success).toBe(false);
    expect(contracts.RouteEvidenceV1Schema.safeParse({ ...validRoute, safety_gates: validRoute.safety_gates.slice(1), safety_gate_results: validRoute.safety_gate_results.slice(1) }).success).toBe(false);
  });

  test("enforces deterministic success and exact route-fact evidence", () => {
    expect(contracts.ActionOutcomeV1Schema.safeParse(actionOutcome).success).toBe(true);
    expect(contracts.ActionOutcomeV1Schema.safeParse({ ...actionOutcome, required_checks: [{ ...actionOutcome.required_checks[0], passed: false }] }).success).toBe(false);
    expect(contracts.ActionOutcomeV1Schema.safeParse({ ...actionOutcome, route_facts: { route_id: "route-1", route_proof_id: "route-proof-1", route_proof_digest: null } }).success).toBe(false);
  });

  test("requires isolated-worktree mode when workspace policy demands it", () => {
    expect(contracts.WorkspacePolicyV1Schema.safeParse({ ...workspacePolicy, workspace: { ...workspace, mode: "validated_directory" } }).success).toBe(false);
  });

  test("rejects partial verifier route tuples and binds complete proof identity", () => {
    const mandate = structuredClone(validMandate);
    mandate.verification_step = { ...mandate.verification_step, route_id: "route-1", route_proof_id: null, route_proof_digest: null, deterministic_verifier_id: "checks/v1" } as unknown as typeof mandate.verification_step;
    expect(contracts.ExecutionMandateV1Schema.safeParse(mandate).success).toBe(false);
    expect(contracts.VerificationReceiptV1Schema.safeParse({ ...verificationReceipt, route_proof_id: null }).success).toBe(false);
  });

  test("supports bound deterministic finalization postconditions", () => {
    const predicateDigest = canonicalDigest({ predicate: "resource.version == expected" });
    const receipt = { ...finalizationReceipt, expected_post_state: { kind: "postcondition", predicate: "resource.version == expected", predicate_digest: predicateDigest }, observed_post_state: { kind: "postcondition", predicate_digest: predicateDigest, satisfied: true, evidence_digest: digest } };
    expect(contracts.FinalizationReceiptV1Schema.safeParse(receipt).success).toBe(true);
    expect(contracts.FinalizationReceiptV1Schema.safeParse({ ...receipt, observed_post_state: { ...receipt.observed_post_state, satisfied: false } }).success).toBe(false);
  });

  test("rejects a mutation manifest whose canonical digest does not match", () => {
    expect(contracts.FinalizationCommandV1Schema.safeParse({ ...finalizationCommand, mutation_manifest: { ...finalizationCommand.mutation_manifest, manifest_digest: digest } }).success).toBe(false);
  });

  test.each([
    ["intake request", contracts.PersistIntakeInputSchema, { ...schemaFixtures.PersistIntakeInputSchema.valid as object, request_id: "request-2" }],
    ["activation task", contracts.ActivateMandateInputSchema, { ...schemaFixtures.ActivateMandateInputSchema.valid as object, task_id: "task-2" }],
    ["activation digest", contracts.ActivateMandateInputSchema, { ...schemaFixtures.ActivateMandateInputSchema.valid as object, mandate_digest: "b".repeat(64) }],
    ["action task", contracts.PrepareActionInputSchema, { ...schemaFixtures.PrepareActionInputSchema.valid as object, task_id: "task-2" }],
    ["action headroom", contracts.PrepareActionInputSchema, { ...schemaFixtures.PrepareActionInputSchema.valid as object, command_headroom: { ...budget, max_cost_usd: 0.5 } }],
    ["worker run", contracts.BindWorkerSessionInputSchema, { ...schemaFixtures.BindWorkerSessionInputSchema.valid as object, run_id: "run-2" }],
    ["action outcome task", contracts.CloseActionInputSchema, { ...schemaFixtures.CloseActionInputSchema.valid as object, task_id: "task-2" }],
    ["CEO-input task", contracts.SetCEOInputInputSchema, { ...schemaFixtures.SetCEOInputInputSchema.valid as object, task_id: "task-2" }],
    ["terminal outcome task", contracts.TerminalIntentInputSchema, { ...schemaFixtures.TerminalIntentInputSchema.valid as object, task_id: "task-2" }],
  ])("rejects a port DTO with mismatched %s binding", (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  test("binds receipt routes and route proofs to nested outcomes", () => {
    expect(contracts.ActionReceiptV1Schema.safeParse({ ...actionReceipt, route_id: "route-2" }).success).toBe(false);
    expect(contracts.VerificationReceiptV1Schema.safeParse({ ...verificationReceipt, verifier_route_id: "route-3" }).success).toBe(false);
    expect(contracts.VerificationReceiptV1Schema.safeParse({ ...verificationReceipt, route_proof_digest: "b".repeat(64) }).success).toBe(false);
  });

  test.each([
    { verification_receipt_id: null, verification_receipt_digest: digest },
    { verification_receipt_id: "receipt-2", verification_receipt_digest: null },
    { finalization_receipt_id: null, finalization_receipt_digest: digest },
    { finalization_receipt_id: "receipt-3", finalization_receipt_digest: null },
  ])("rejects partial aggregate receipt reference pair %#", (partial) => {
    expect(contracts.AggregateReceiptV1Schema.safeParse({ ...aggregateReceipt, outcome: { ...taskOutcome, outcome: "failed" }, ...partial }).success).toBe(false);
  });

  test.each([
    { state: "prepared", submitted_at: null, reconciled_at: timestamp },
    { state: "revoked", submitted_at: timestamp, reconciled_at: null },
    { state: "submitted", submitted_at: timestamp, reconciled_at: timestamp },
    { state: "found", submitted_at: timestamp, reconciled_at: null },
  ])("rejects contradictory action-command lifecycle timestamps %#", (lifecycle) => {
    expect(contracts.ActionCommandV1Schema.safeParse({ ...actionCommand, ...lifecycle }).success).toBe(false);
  });

  test.each([
    { ...taskSpec, workspace_policy: { ...workspacePolicy, workspace: { ...workspace, mode: "project_root" } } },
    { ...taskSpec, workspace_policy: { ...workspacePolicy, workspace: { ...workspace, path: "C:/other" } } },
  ])("rejects TaskSpec workspace-policy scope drift %#", (value) => {
    expect(contracts.TaskSpecV1Schema.safeParse(value).success).toBe(false);
  });

  test("binds intake canonical digests and exact route evidence", () => {
    const intake = schemaFixtures.PersistIntakeInputSchema.valid as Record<string, unknown>;
    expect(contracts.PersistIntakeInputSchema.safeParse({ ...intake, task_spec: { ...taskSpec, objective: "changed without revision" } }).success).toBe(false);
    expect(contracts.PersistIntakeInputSchema.safeParse({ ...intake, route_snapshot: [] }).success).toBe(false);
  });

  test("binds prepared commands to the canonical authority and its time window", () => {
    const input = schemaFixtures.PrepareActionInputSchema.valid as Record<string, unknown>;
    expect(contracts.PrepareActionInputSchema.safeParse({ ...input, command: { ...actionCommand, authority_digest: "b".repeat(64) } }).success).toBe(false);
    expect(contracts.PrepareActionInputSchema.safeParse({ ...input, command: { ...actionCommand, expires_at: "2026-08-05T12:00:00.000Z" } }).success).toBe(false);
  });

  test("carries the exact route-proof identity in an action outcome", () => {
    expect(contracts.ActionOutcomeV1Schema.safeParse({ ...actionOutcome, route_facts: { ...actionOutcome.route_facts, route_proof_id: "route-proof-1" } }).success).toBe(true);
  });

  test("prohibits CodeG binding identities on deterministic verification", () => {
    expect(contracts.VerificationReceiptV1Schema.safeParse({ ...verificationReceipt, verifier_route_id: null, route_proof_id: null, route_proof_digest: null, deterministic_verifier_id: "checks/v1", outcome: { ...verificationOutcome, route_facts: { route_id: null, route_proof_id: null, route_proof_digest: null } } }).success).toBe(false);
  });

  test.each([
    { action_receipt_ids: ["receipt-1"], attempt_ids: [1, 2] },
    { action_receipt_ids: ["receipt-1", "receipt-1"], attempt_ids: [1, 2] },
    { action_receipt_ids: ["receipt-1", "receipt-2"], attempt_ids: [1, 1] },
  ])("rejects non-bijective aggregate action-attempt references %#", (references) => {
    expect(contracts.AggregateReceiptV1Schema.safeParse({ ...aggregateReceipt, ...references }).success).toBe(false);
  });

  test("binds acceptance digests to the exact acceptance checks", () => {
    expect(contracts.VerificationReceiptV1Schema.safeParse({ ...verificationReceipt, acceptance_checks: ["different"] }).success).toBe(false);
    const intake = structuredClone(schemaFixtures.PersistIntakeInputSchema.valid) as typeof schemaFixtures.PersistIntakeInputSchema.valid & { mandate: typeof validMandate };
    intake.mandate.verification_step.acceptance_checks = ["different"];
    expect(contracts.PersistIntakeInputSchema.safeParse(intake).success).toBe(false);
  });

  test("binds activation capability digest and exact mandate scope", () => {
    expect(contracts.AutoActivationReceiptV1Schema.safeParse({ ...autoActivationReceipt, capability_scope_digest: "b".repeat(64) }).success).toBe(false);
    const intake = schemaFixtures.PersistIntakeInputSchema.valid as Record<string, unknown>;
    const autoTaskSpec = { ...taskSpec, risk_mode: "auto" };
    const autoMandate = structuredClone(validMandate);
    autoMandate.task_spec_revision.task_spec_digest = canonicalDigest(autoTaskSpec);
    autoMandate.authority_source = { kind: "auto_policy_receipt", authority_id: "authority-1" };
    const receipt = { ...autoActivationReceipt, task_spec_digest: autoMandate.task_spec_revision.task_spec_digest, mandate_digest: canonicalDigest(autoMandate) };
    expect(contracts.PersistIntakeInputSchema.safeParse({ ...intake, task_spec: autoTaskSpec, mandate: autoMandate, activation: { kind: "auto", receipt } }).success).toBe(true);
    expect(contracts.PersistIntakeInputSchema.safeParse({ ...intake, task_spec: autoTaskSpec, mandate: autoMandate, activation: { kind: "auto", receipt: { ...receipt, workspace_scope: { ...workspace, path: "C:/other" } } } }).success).toBe(false);
  });

  test("requires a canonical no-change mandate manifest", () => {
    expect(contracts.ExecutionMandateV1Schema.safeParse({ ...validMandate, finalization_step: { ...validMandate.finalization_step, mutation_manifest: { ...validMandate.finalization_step.mutation_manifest, manifest_digest: "b".repeat(64) } } }).success).toBe(false);
    expect(contracts.ExecutionMandateV1Schema.safeParse({ ...validMandate, finalization_step: { ...validMandate.finalization_step, mutation_manifest: { ...validMandate.finalization_step.mutation_manifest, entries: [{ path: "src/change.ts", operation: "add", before_digest: null, after_digest: digest }] } } }).success).toBe(false);
  });

  test.each([
    { ...ceoInputRequest, active_mandate_id: "mandate-active" },
    { ...ceoInputRequest, decision_type: "route_change", active_mandate_id: null },
  ])("rejects contradictory CEO-input mandate state %#", (request) => {
    expect(contracts.CEOInputRequestV1Schema.safeParse(request).success).toBe(false);
  });

  test("rejects a duplicate safety result even when the later duplicate passes", () => {
    const duplicate = { gate: "authority_isolation", passed: false, evidence_digest: digest };
    expect(contracts.RouteEvidenceV1Schema.safeParse({ ...validRoute, safety_gate_results: [duplicate, ...validRoute.safety_gate_results] }).success).toBe(false);
  });

  test("binds TaskSpec policy bounds and route classes to intake", () => {
    const intake = schemaFixtures.PersistIntakeInputSchema.valid as Record<string, unknown>;
    expect(contracts.PersistIntakeInputSchema.safeParse({ ...intake, task_spec: { ...taskSpec, risk_mode: "auto" } }).success).toBe(false);
    expect(contracts.PersistIntakeInputSchema.safeParse({ ...intake, task_spec: { ...taskSpec, budget } }).success).toBe(false);
    const weakenedMandate = structuredClone(validMandate);
    weakenedMandate.finalization_step.prohibited_changes = [];
    expect(contracts.PersistIntakeInputSchema.safeParse({ ...intake, mandate: weakenedMandate }).success).toBe(false);
    const routeSnapshot = (intake.route_snapshot as typeof validRoute[]).map((route, index) => index === 0 ? { ...route, task_class: "general_implementation" } : route);
    expect(contracts.PersistIntakeInputSchema.safeParse({ ...intake, route_snapshot: routeSnapshot }).success).toBe(false);
  });

  test("requires every TaskSpec remediation phase to have a matching mandate action", () => {
    const intake = structuredClone(schemaFixtures.PersistIntakeInputSchema.valid) as any;
    const remediationNode = intake.mandate.action_nodes.find((node: { action_role: string }) => node.action_role === "remediate");
    if (remediationNode) remediationNode.action_role = "reconcile";
    intake.activation.request.proposed_mandate_digest = canonicalDigest(intake.mandate);
    expect(contracts.PersistIntakeInputSchema.safeParse(intake).success).toBe(false);
  });

  test("binds deterministic verifier identity to the TaskSpec verifier phase", () => {
    const intake = structuredClone(schemaFixtures.PersistIntakeInputSchema.valid) as any;
    intake.mandate.verification_step = { ...intake.mandate.verification_step, route_id: null, route_proof_id: null, route_proof_digest: null, deterministic_verifier_id: "other-verifier" };
    intake.activation.request.proposed_mandate_digest = canonicalDigest(intake.mandate);
    intake.activation.request.proposed_route_ids = ["route-1"];
    expect(contracts.PersistIntakeInputSchema.safeParse(intake).success).toBe(false);
  });

  test("binds TaskSpec execution routes to the corresponding mandate action", () => {
    const intake = structuredClone(schemaFixtures.PersistIntakeInputSchema.valid) as any;
    const executeNode = intake.mandate.action_nodes.find((node: { action_role: string }) => node.action_role === "execute");
    Object.assign(executeNode, { route_id: "route-2", route_proof_id: "route-proof-2", route_proof_digest: digest });
    intake.activation.request.proposed_mandate_digest = canonicalDigest(intake.mandate);
    intake.activation.request.proposed_route_ids = ["route-2"];
    expect(contracts.PersistIntakeInputSchema.safeParse(intake).success).toBe(false);
  });

  test("binds mandate phase actions to the global TaskSpec phase order", () => {
    const intake = structuredClone(schemaFixtures.PersistIntakeInputSchema.valid) as any;
    [intake.mandate.action_nodes[0], intake.mandate.action_nodes[1]] = [intake.mandate.action_nodes[1], intake.mandate.action_nodes[0]];
    intake.activation.request.proposed_mandate_digest = canonicalDigest(intake.mandate);
    expect(contracts.PersistIntakeInputSchema.safeParse(intake).success).toBe(false);
  });

  test("accepts realistic Git object identities in CodeG snapshots", () => {
    expect(contracts.CodeGSnapshotV1Schema.safeParse({ ...schemaFixtures.CodeGSnapshotV1Schema.valid as object, source_commit: "a".repeat(40), source_tree: "b".repeat(40) }).success).toBe(true);
    expect(contracts.CodeGSnapshotV1Schema.safeParse({ ...schemaFixtures.CodeGSnapshotV1Schema.valid as object, source_commit: "a".repeat(64), source_tree: "b".repeat(64) }).success).toBe(true);
  });

  test("binds CEO approval proposal claims to the canonical mandate", () => {
    const intake = schemaFixtures.PersistIntakeInputSchema.valid as Record<string, unknown>;
    expect(contracts.PersistIntakeInputSchema.safeParse({ ...intake, activation: { kind: "approval_required", request: { ...ceoInputRequest, proposed_limits: budget } } }).success).toBe(false);
    expect(contracts.PersistIntakeInputSchema.safeParse({ ...intake, activation: { kind: "approval_required", request: { ...ceoInputRequest, proposed_route_ids: ["route-2", "route-1"] } } }).success).toBe(false);
    expect(contracts.PersistIntakeInputSchema.safeParse({ ...intake, activation: { kind: "approval_required", request: { ...ceoInputRequest, proposed_side_effects: ["network"] } } }).success).toBe(false);
  });

  test("keeps reconciliation transitions within the category ceiling", () => {
    const mandate = structuredClone(validMandate);
    Object.assign(mandate.transition_graph.execute, { transient_infrastructure: { kind: "reconciliation", category: "dispatch_lookup", max_attempts: 7, deadline_ms: 60_000 } });
    expect(contracts.ExecutionMandateV1Schema.safeParse(mandate).success).toBe(false);
  });

  test("rejects receipt evidence that contradicts the nested outcome", () => {
    expect(contracts.ActionReceiptV1Schema.safeParse({ ...actionReceipt, usage: { ...actionReceipt.usage, tokens: 101 } }).success).toBe(false);
    expect(contracts.ActionReceiptV1Schema.safeParse({ ...actionReceipt, checks: [{ ...actionReceipt.checks[0], passed: false }] }).success).toBe(false);
    expect(contracts.ActionReceiptV1Schema.safeParse({ ...actionReceipt, produced_files: [] }).success).toBe(false);
    expect(contracts.ActionReceiptV1Schema.safeParse({ ...actionReceipt, uncertainty: ["contradiction"] }).success).toBe(false);
    expect(contracts.VerificationReceiptV1Schema.safeParse({ ...verificationReceipt, raw_results: [{ ...verificationReceipt.raw_results[0], passed: false }] }).success).toBe(false);
  });

  test("binds finalization CAS digest to the exact target digest", () => {
    expect(contracts.FinalizationCommandV1Schema.safeParse({ ...finalizationCommand, cas_precondition: { ...finalizationCommand.cas_precondition, digest: "b".repeat(64) } }).success).toBe(false);
  });

  test.each([
    ["receipt-finalization", "receipt-verification", "receipt-cancellation", "receipt-reconciliation"],
    ["receipt-verification", "receipt-verification", "receipt-cancellation", "receipt-reconciliation"],
  ])("requires category-ordered unique reserve references %#", (...taskReserveRefs) => {
    const input = schemaFixtures.PrepareActionInputSchema.valid as Record<string, unknown>;
    expect(contracts.PrepareActionInputSchema.safeParse({ ...input, task_reserve_refs: taskReserveRefs }).success).toBe(false);
  });
});
