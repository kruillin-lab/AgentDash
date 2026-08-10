import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { GitCommitIdSchema, RequiredRouteSafetyGates, canonicalDigest } from "../../../lib/mission-control/contracts";
import { loadRouteEvaluationPolicy, type ScoredRouteRun } from "./evaluator";
import { loadRouteInventory } from "./inventory";
import {
  QualificationRunner,
  signQualificationEnvelope,
  type QualificationEnvelopeV1,
  type QualificationNonceStore,
  type UnsignedQualificationEnvelopeV1,
} from "./qualification-runner";

const secret = "qualification-operator-secret-that-is-long-enough";
const hermesCommit = GitCommitIdSchema.parse("a".repeat(40));
const codegCommit = GitCommitIdSchema.parse("b".repeat(40));
const inventoryPath = join(process.cwd(), "config", "mission-control-route-inventory.json");
const policyPath = join(process.cwd(), "config", "route-evaluation-policy.json");

function scoredRuns(): ScoredRouteRun[] {
  return Array.from({ length: 20 }, (_, index) => ({
    run_id: `run-${index}`,
    fixture_shape: `shape-${index % 5}`,
    passed: index !== 0,
    cost_usd: 0.1,
    runtime_ms: 1_000,
    provider_tokens: 1_000,
    safety_gate_results: RequiredRouteSafetyGates.map((gate) => ({ gate, passed: true, evidence_digest: canonicalDigest({ gate, index }) })),
    critical_failure: false,
    raw_receipt_digest: canonicalDigest({ receipt: index }),
    environment_digest: canonicalDigest({ environment: index }),
  }));
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "agentdash-qualification-"));
  const stateDir = join(root, "state");
  const disposableRoot = join(root, "disposable");
  const board = join(disposableRoot, "board");
  const workspace = join(disposableRoot, "workspace");
  const production = join(root, "production");
  await Promise.all([mkdir(stateDir), mkdir(board, { recursive: true }), mkdir(workspace, { recursive: true }), mkdir(production, { recursive: true })]);
  const [inventory, policy] = await Promise.all([loadRouteInventory(inventoryPath), loadRouteEvaluationPolicy(policyPath)]);
  const candidate = inventory.requireCandidate("route-codex-gpt-5-6-terra");
  const unsigned: UnsignedQualificationEnvelopeV1 = {
    schema_version: "agentdash.qualification-envelope/v1",
    origin: "operator_cli",
    operator_session_id: "operator-session-1234567890",
    route_id: candidate.route_id,
    exact_route: candidate.exact_route,
    task_class: "bounded_coding",
    level: 4,
    fixture_set_version: policy.fixture_set_version,
    disposable_board: { board_id: "qualification-board-1", path: board },
    workspace: { project_id: "agentdash", path: workspace, disposable: true },
    ceilings: { max_cost_usd: 1, max_runtime_ms: 600_000, max_provider_tokens: 100_000 },
    allowed_operations: ["read", "write_disposable", "execute_tests", "emit_receipt"],
    candidate_bridge_proofs: { hermes_commit: hermesCommit, codeg_commit: codegCommit },
    mode: "qualification",
    issued_at: "2026-08-06T12:00:00.000Z",
    expires_at: "2026-08-06T12:10:00.000Z",
    nonce: "nonce-qualification-1234567890",
  };
  const envelope: QualificationEnvelopeV1 = { ...unsigned, signature: signQualificationEnvelope(unsigned, secret) };
  const consumed = new Set<string>();
  const nonceStore: QualificationNonceStore = { consume: async (nonce) => !consumed.has(nonce) && Boolean(consumed.add(nonce)) };
  const execute = vi.fn(async () => scoredRuns());
  const runner = new QualificationRunner({ secret, stateDir, inventory, policy, disposableRoots: [disposableRoot], expectedBridgeProofs: { hermes_commit: hermesCommit, codeg_commit: codegCommit }, nonceStore, execute, now: () => Date.parse("2026-08-06T12:01:00.000Z") });
  return { runner, envelope, unsigned, execute, production };
}

describe("qualification runner", () => {
  test("runs a signed operator level-4 canary in disposable roots and persists digest-addressed evidence", async () => {
    const { runner, envelope, execute } = await setup();
    const result = await runner.run(envelope, { source: "operator_cli" });
    expect(result).toMatchObject({ decision: "eligible", evidence: { level: 4, status: "active" } });
    expect(execute).toHaveBeenCalledOnce();
  });

  test.each(["chat", "api"] as const)("rejects %s invocation before any model work", async (source) => {
    const { runner, envelope, execute } = await setup();
    await expect(runner.run(envelope, { source })).rejects.toThrow(/operator cli/i);
    expect(execute).not.toHaveBeenCalled();
  });

  test("rejects production roots, bridge drift, signature tampering, and prohibited operations", async () => {
    const { runner, envelope, unsigned, execute, production } = await setup();
    const cases = [
      { ...unsigned, workspace: { ...unsigned.workspace, path: production } },
      { ...unsigned, candidate_bridge_proofs: { ...unsigned.candidate_bridge_proofs, codeg_commit: GitCommitIdSchema.parse("c".repeat(40)) } },
      { ...unsigned, allowed_operations: [...unsigned.allowed_operations, "network"] as UnsignedQualificationEnvelopeV1["allowed_operations"] },
    ];
    for (const changed of cases) {
      const signed = { ...changed, signature: signQualificationEnvelope(changed, secret) } as QualificationEnvelopeV1;
      await expect(runner.run(signed, { source: "operator_cli" })).rejects.toThrow();
    }
    await expect(runner.run({ ...envelope, route_id: "route-codex-gpt-5-6-luna" as never }, { source: "operator_cli" })).rejects.toThrow(/signature/i);
    expect(execute).not.toHaveBeenCalled();
  });

  test("consumes the signed nonce once and rejects replay", async () => {
    const { runner, envelope, execute } = await setup();
    await expect(runner.run(envelope, { source: "operator_cli" })).resolves.toMatchObject({ decision: "eligible" });
    await expect(runner.run(envelope, { source: "operator_cli" })).rejects.toThrow(/replay/i);
    expect(execute).toHaveBeenCalledOnce();
  });

  test("enforces the signed provider-token ceiling before evidence can be written", async () => {
    const { runner, envelope, execute } = await setup();
    execute.mockResolvedValue(scoredRuns().map((run) => ({ ...run, provider_tokens: 100_001 })));
    await expect(runner.run(envelope, { source: "operator_cli" })).rejects.toThrow(/ceiling/i);
  });
});
