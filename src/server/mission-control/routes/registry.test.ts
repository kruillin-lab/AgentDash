import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { canonicalDigest } from "../../../lib/mission-control/contracts";
import { evaluateRoute, loadRouteEvaluationPolicy, type QualificationEvidenceV1, type ScoredRouteRun } from "./evaluator";
import { loadRouteInventory } from "./inventory";
import { RouteRegistry, buildIndependentVerifierQuery } from "./registry";

const inventoryPath = join(process.cwd(), "config", "mission-control-route-inventory.json");
const policyPath = join(process.cwd(), "config", "route-evaluation-policy.json");
const now = "2026-08-06T12:00:00.000Z";

function runs(): ScoredRouteRun[] {
  const gates = ["authority_isolation", "workspace_containment", "identity_binding", "cancellation_reconciliation", "secret_handling", "prohibited_actions"] as const;
  return Array.from({ length: 20 }, (_, index) => ({
    run_id: `run-${index}`,
    fixture_shape: `shape-${index % 5}`,
    passed: index !== 0,
    cost_usd: 0.1,
    runtime_ms: 1_000,
    provider_tokens: 1_000,
    safety_gate_results: gates.map((gate) => ({ gate, passed: true, evidence_digest: canonicalDigest({ gate, index }) })),
    critical_failure: false,
    raw_receipt_digest: canonicalDigest({ receipt: index }),
    environment_digest: canonicalDigest({ environment: index }),
  }));
}

async function setup(level: 4 | 5) {
  const stateDir = await mkdtemp(join(tmpdir(), "agentdash-routes-"));
  const evidenceDir = join(stateDir, "route-evidence");
  await mkdir(evidenceDir, { recursive: true });
  const [inventory, policy] = await Promise.all([loadRouteInventory(inventoryPath), loadRouteEvaluationPolicy(policyPath)]);
  const candidate = inventory.requireCandidate("route-codex-gpt-5-6-terra");
  const result = evaluateRoute({ candidate, policy, task_class: "bounded_coding", level, evaluated_at: now, current_config_digest: candidate.exact_route.config_digest, runs: runs() });
  if (result.decision !== "eligible") throw new Error("test qualification unexpectedly failed");
  await writeFile(join(evidenceDir, `${result.evidence.evidence_digest}.json`), `${JSON.stringify(result.evidence)}\n`, "utf8");
  return { registry: new RouteRegistry({ stateDir, inventory }), candidate, evidence: result.evidence, evidenceDir };
}

describe("route registry", () => {
  test("builds a path-specific verifier query excluding every mutating provider and outer harness", async () => {
    const inventory = await loadRouteInventory(inventoryPath);
    const terra = inventory.requireCandidate("route-codex-gpt-5-6-terra");
    const qwen = inventory.requireCandidate("route-opencode-go-qwen3-7-max");
    const query = buildIndependentVerifierQuery(inventory, [terra.exact_route, qwen.exact_route]);
    expect(query.excluded_outer_harnesses).toEqual(["codex", "opencode-go"]);
    expect(query.excluded_providers).toEqual(["alibaba", "openai"]);
    expect(query.candidate_route_ids).toContain("route-claude-code-opus-5");
    expect(query.candidate_route_ids).not.toContain(terra.route_id);
    expect(query.candidate_route_ids).not.toContain(qwen.route_id);
  });

  test("reports level 4 as canary-only and refuses production dispatch", async () => {
    const { registry, candidate } = await setup(4);
    await expect(registry.status(candidate.route_id, "bounded_coding", now)).resolves.toBe("canary_only");
    await expect(registry.requireLevel5(candidate.route_id, "bounded_coding", now)).rejects.toThrow(/level-5/i);
  });

  test("returns exact active level-5 evidence for production dispatch", async () => {
    const { registry, candidate, evidence } = await setup(5);
    await expect(registry.status(candidate.route_id, "bounded_coding", now)).resolves.toBe("production");
    await expect(registry.requireLevel5(candidate.route_id, "bounded_coding", now)).resolves.toMatchObject({
      route_id: candidate.route_id,
      mode: candidate.exact_route.mode,
      evidence_digest: evidence.evidence_digest,
    });
  });

  test("revokes older production evidence after a later critical qualification failure", async () => {
    const { registry, candidate, evidenceDir } = await setup(5);
    const policy = await loadRouteEvaluationPolicy(policyPath);
    const criticalRuns = runs().map((run) => ({ ...run, critical_failure: true }));
    const result = evaluateRoute({ candidate, policy, task_class: "bounded_coding", level: 5, evaluated_at: "2026-08-07T12:00:00.000Z", current_config_digest: candidate.exact_route.config_digest, runs: criticalRuns });
    if (result.decision !== "denied" || !result.revocation) throw new Error("critical failure must emit revocation evidence");
    const revocationDir = join(evidenceDir, "..", "route-revocations");
    await mkdir(revocationDir, { recursive: true });
    await writeFile(join(revocationDir, `${result.revocation.revocation_digest}.json`), `${JSON.stringify(result.revocation)}\n`, "utf8");
    await expect(registry.status(candidate.route_id, "bounded_coding", "2026-08-08T12:00:00.000Z")).resolves.toBe("denied");
  });

  test("rejects expired, tampered, and non-digest-addressed evidence", async () => {
    const { registry, candidate, evidence, evidenceDir } = await setup(5);
    await expect(registry.status(candidate.route_id, "bounded_coding", "2026-09-30T12:00:00.000Z")).resolves.toBe("denied");
    const tampered = { ...evidence, exact_route: { ...evidence.exact_route, model: "substituted-model" } } satisfies QualificationEvidenceV1;
    await writeFile(join(evidenceDir, `${evidence.evidence_digest}.json`), `${JSON.stringify(tampered)}\n`, "utf8");
    await expect(registry.status(candidate.route_id, "bounded_coding", now)).resolves.toBe("denied");
    await writeFile(join(evidenceDir, `not-the-digest.json`), `${JSON.stringify(evidence)}\n`, "utf8");
    await expect(registry.requireLevel5(candidate.route_id, "bounded_coding", now)).rejects.toThrow(/evidence/i);
  });

  test("qualifies an activation only when proof id and digest match immutable level-5 evidence", async () => {
    const { registry, candidate, evidence } = await setup(5);
    const qualified = await registry.qualifyActivation({
      source_snapshot_digest: canonicalDigest({ snapshot: 1 }),
      request_digest: canonicalDigest({ request: 1 }),
      task_id: "task-1" as never,
      task_spec_digest: canonicalDigest({ spec: 1 }),
      mandate_digest: canonicalDigest({ mandate: 1 }),
      approval_request_digest: canonicalDigest({ approval: 1 }),
      budget_policy_digest: canonicalDigest({ budget: 1 }),
      at: now as never,
      requirements: [{ route_id: candidate.route_id as never, task_class: "bounded_coding", route_proof_id: evidence.route_proof_id as never, route_proof_digest: evidence.evidence_digest }],
    });
    expect(qualified).toMatchObject({ status: "qualified", routes: [{ route_id: candidate.route_id }] });
    await expect(registry.qualifyActivation({
      source_snapshot_digest: canonicalDigest({ snapshot: 1 }), request_digest: canonicalDigest({ request: 1 }), task_id: "task-1" as never,
      task_spec_digest: canonicalDigest({ spec: 1 }), mandate_digest: canonicalDigest({ mandate: 1 }), approval_request_digest: canonicalDigest({ approval: 1 }), budget_policy_digest: canonicalDigest({ budget: 1 }), at: now as never,
      requirements: [{ route_id: candidate.route_id as never, task_class: "bounded_coding", route_proof_id: evidence.route_proof_id as never, route_proof_digest: canonicalDigest({ wrong: true }) }],
    })).resolves.toMatchObject({ status: "conflict" });
  });
});
