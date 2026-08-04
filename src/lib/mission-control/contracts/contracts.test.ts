import { describe, expect, test } from "vitest";

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

const hermesFake = {
  persistIntake: async () => ({ task_id: taskId, created: true }),
  ensureArtifact: async () => ({ artifact_id: artifactId, digest }),
  activateMandate: async () => undefined,
  prepareAction: async () => ({ command_id: commandId, state: "prepared" as const }),
  bindWorkerSession: async () => undefined,
  appendRunEvent: async () => undefined,
  closeAction: async () => undefined,
  setCEOInput: async () => undefined,
  commitTerminalIntent: async () => undefined,
  projectBoard: async () => ({ schema_version: "agentdash.mission-control-board/v1", tasks: [] }),
} satisfies HermesPort;
const codegFake = {
  ensureWork: async () => ({ kind: "found" as const, binding: null }),
  lookupByCommandKey: async () => ({ kind: "not_found" as const }),
  getSnapshot: async () => ({ schema_version: "agentdash.codeg-snapshot/v1", state: "unknown", binding: null }),
  async *activityAfter() {},
  cancelExact: async () => ({ state: "cancelled" as const }),
  nativeSessionUri: async () => null,
} satisfies CodeGPort;
const finalizationFake = {
  preflight: async () => ({ allowed: true, reason: null }),
  apply: async () => ({ state: "applied" as const, receipt_digest: digest }),
  lookup: async () => ({ kind: "not_found" as const }),
} satisfies FinalizationPort;
const policyFake = { decide: async () => ({ decision: "approval_required" as const, reason: "hand-derived" }) } satisfies ActivationPolicyPort;
const brainFake = { recallReviewed: async () => [] } satisfies AgentBrainPort;
const routesFake = { requireLevel5: async () => RouteEvidenceV1Schema.parse(validRoute) } satisfies RouteRegistryPort;
const outboxFake = { journal: async () => undefined, pending: async () => [], markDelivered: async () => undefined } satisfies RecoveryOutboxPort;
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
}
void [hermesFake, codegFake, finalizationFake, policyFake, brainFake, routesFake, outboxFake, identitySubstitution];

const validRoute = {
  schema_version: "agentdash.route-evidence/v1",
  route_proof_id: "route-proof-1",
  route_id: "codeg.codex.gpt-5",
  task_class: "bounded_coding",
  level: 5,
  outer_harness: "codex",
  provider: "openai",
  model: "gpt-5",
  agent_type: "worker",
  config_digest: digest,
  evidence_digest: digest,
  evaluated_at: timestamp,
  expires_at: "2026-09-01T12:00:00.000Z",
};

const validMandate = {
  schema_version: "agentdash.execution-mandate/v1",
  mandate_id: "mandate-1",
  task_id: "task-1",
  request_id: "request-1",
  task_spec_revision: { plan_revision: 1, task_spec_digest: digest, objective_digest: digest, acceptance_digest: digest },
  action_nodes: [
    { node_id: "execute", action_role: "execute", executor_kind: "codeg_worker", route_id: "codeg.codex.gpt-5" },
    { node_id: "finish", action_role: "finalize", executor_kind: "controller", route_id: null },
  ],
  transition_graph: {
    execute: { succeeded: { kind: "node", node_id: "finish" }, transient_infrastructure: { kind: "terminal", outcome: "failed" }, semantic_failure: { kind: "terminal", outcome: "failed" }, verification_failure: { kind: "terminal", outcome: "failed" }, policy_violation: { kind: "terminal", outcome: "failed" }, cancelled: { kind: "terminal", outcome: "cancelled" }, timed_out: { kind: "terminal", outcome: "timed_out" }, budget_exhausted: { kind: "terminal", outcome: "budget_exhausted" }, route_unavailable: { kind: "terminal", outcome: "route_unavailable" }, ceo_input_required: { kind: "ceo_input" }, ambiguous: { kind: "terminal", outcome: "inconsistent" } },
    finish: { succeeded: { kind: "terminal", outcome: "succeeded" }, transient_infrastructure: { kind: "terminal", outcome: "failed" }, semantic_failure: { kind: "terminal", outcome: "failed" }, verification_failure: { kind: "terminal", outcome: "failed" }, policy_violation: { kind: "terminal", outcome: "failed" }, cancelled: { kind: "terminal", outcome: "cancelled" }, timed_out: { kind: "terminal", outcome: "timed_out" }, budget_exhausted: { kind: "terminal", outcome: "budget_exhausted" }, route_unavailable: { kind: "terminal", outcome: "route_unavailable" }, ceo_input_required: { kind: "ceo_input" }, ambiguous: { kind: "terminal", outcome: "inconsistent" } },
  },
  visit_caps: { execute: 1, finish: 1 },
  verification_step: { acceptance_digest: digest, required_independence_tier: 1, route_id: "codeg.codex.gpt-5", independence_proof_digest: digest },
  finalization_step: { mutation_type: "no_change_close", mutation_manifest_digest: digest, expected_post_state_digest: digest },
  capability_scope: { allowed_tools: ["read"], allowed_side_effects: [], allowed_data_classes: ["project"], prohibited_actions: ["network"] },
  workspace_scope: { project_id: "project-1", mode: "isolated_worktree", path: "C:/worktrees/task-1" },
  aggregate_budget: { max_cost_usd: 10, max_runtime_ms: 60000, max_attempts: 2, max_provider_tokens: 1000 },
  per_action_limits: { execute: { max_cost_usd: 5, max_runtime_ms: 30000, max_output_tokens: 1000 }, finish: { max_cost_usd: 5, max_runtime_ms: 30000, max_output_tokens: 1000 } },
  budget_proof: { worst_case_cost_usd: 10, worst_case_runtime_ms: 60000, worst_case_attempts: 2, verification_reserve_usd: 1, finalization_reserve_usd: 1, recovery_reserve_usd: 1 },
  reconciliation_limits: { lookup_attempts: 1, cancellation_attempts: 1, orphan_attempts: 1, finalization_attempts: 1, receipt_delivery_attempts: 1, deadline_ms: 60000 },
  expiry: "2026-08-04T12:00:00.000Z",
  authority_source: { kind: "approval_grant", authority_id: "authority-1" },
};

describe("mission-control contracts", () => {
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
    expect(ActionOutcomeV1Schema.parse({ schema_version: "agentdash.action-outcome/v1", outcome, command_id: "command-1", attempt_id: 1, task_id: "task-1", evidence_refs: ["event-1"], classifier_policy_version: "v1", rationale: "hand-derived" }).outcome).toBe(outcome);
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
    expect(ActionCommandV1Schema.parse({ schema_version: "agentdash.action-command/v1", command_id: "command-1", idempotency_key: "command-key-1", task_id: "task-1", mandate_id: "mandate-1", authority_id: "authority-1", node_id: "execute", action_role: "execute", executor_kind: "codeg_worker", adapter_operation: "ensure_work", task_spec_digest: digest, mandate_digest: digest, route_proof_digest: digest, action_input_digest: digest, state, created_at: timestamp, submitted_at: null, reconciled_at: null, expires_at: "2026-08-04T12:00:00.000Z" }).state).toBe(state);
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
});
