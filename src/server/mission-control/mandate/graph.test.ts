import { describe, expect, test } from "vitest";

import { ActionOutcomeValues } from "../../../lib/mission-control/contracts/common";
import { validateMandateGraph, type MandateGraphInput } from "./graph";

const terminal = (outcome: "succeeded" | "failed" = "failed") => ({ kind: "terminal" as const, outcome });
const node = (node_id: string) => ({ kind: "node" as const, node_id });
const everyOutcome = (target: ReturnType<typeof terminal> | ReturnType<typeof node>) => Object.fromEntries(ActionOutcomeValues.map((outcome) => [outcome, target]));

function validGraph(): MandateGraphInput {
  const execute = { node_id: "execute", action_role: "execute" as const, remediation_scope: null };
  const verify = { node_id: "verify", action_role: "verify" as const, remediation_scope: null };
  const finalize = { node_id: "finalize", action_role: "finalize" as const, remediation_scope: null };
  return {
    action_nodes: [execute, verify, finalize],
    transition_graph: {
      execute: { ...everyOutcome(terminal()), succeeded: node("verify") },
      verify: { ...everyOutcome(terminal()), succeeded: node("finalize") },
      finalize: { ...everyOutcome(terminal()), succeeded: terminal("succeeded") },
    },
    visit_caps: { execute: 1, verify: 1, finalize: 1 },
    edge_visit_caps: Object.fromEntries([execute, verify, finalize].flatMap(({ node_id }) => ActionOutcomeValues.map((outcome) => [`${node_id}:${outcome}`, 1]))),
  };
}

const reasonCodes = (input: MandateGraphInput) => validateMandateGraph(input).reasons.map((reason) => reason.code);

describe("finite mandate graph validation", () => {
  test("accepts a closed success path that verifies and finalizes exactly", () => {
    const result = validateMandateGraph(validGraph());

    expect(result.ok).toBe(true);
    expect(result.paths.some((path) => path.terminal_outcome === "succeeded" && path.node_ids.join(",") === "execute,verify,finalize")).toBe(true);
  });

  test("rejects missing outcome edges, dangling targets, and unreachable nodes", () => {
    const missing = validGraph();
    delete missing.transition_graph.execute.ambiguous;
    expect(reasonCodes(missing)).toContain("graph_missing_outcome_edge");

    const dangling = validGraph();
    dangling.transition_graph.execute.succeeded = node("missing");
    expect(reasonCodes(dangling)).toContain("graph_dangling_node");

    const unreachable = validGraph();
    unreachable.action_nodes.push({ node_id: "orphan", action_role: "retry", remediation_scope: null });
    unreachable.transition_graph.orphan = everyOutcome(terminal());
    unreachable.visit_caps.orphan = 1;
    for (const outcome of ActionOutcomeValues) unreachable.edge_visit_caps[`orphan:${outcome}`] = 1;
    expect(reasonCodes(unreachable)).toContain("graph_unreachable_node");
  });

  test("rejects unbounded or exceeded cycle caps and open-ended remediation", () => {
    const cycle = validGraph();
    cycle.transition_graph.execute.transient_infrastructure = node("execute");
    cycle.visit_caps.execute = Number.MAX_SAFE_INTEGER;
    expect(reasonCodes(cycle)).toContain("graph_visit_cap_exceeded");

    const edge = validGraph();
    edge.edge_visit_caps["execute:succeeded"] = 10_000;
    expect(reasonCodes(edge)).toContain("graph_edge_cap_exceeded");

    const remediation = validGraph();
    remediation.action_nodes[0] = { node_id: "execute", action_role: "remediate", remediation_scope: null };
    expect(reasonCodes(remediation)).toContain("graph_unbounded_remediation");
  });

  test("rejects success that bypasses verification, finalization, or the exact final node", () => {
    const noVerify = validGraph();
    noVerify.transition_graph.execute.succeeded = node("finalize");
    expect(reasonCodes(noVerify)).toContain("graph_success_without_verification");

    const noFinalize = validGraph();
    noFinalize.transition_graph.verify.succeeded = terminal("succeeded");
    expect(reasonCodes(noFinalize)).toEqual(expect.arrayContaining(["graph_success_without_finalization", "graph_invalid_terminal_success"]));

    const direct = validGraph();
    direct.transition_graph.execute.semantic_failure = terminal("succeeded");
    expect(reasonCodes(direct)).toContain("graph_invalid_terminal_success");
  });

  test("rejects terminal success from any non-succeeded finalization outcome", () => {
    const graph = validGraph();
    graph.transition_graph.finalize.timed_out = terminal("succeeded");

    expect(reasonCodes(graph)).toContain("graph_invalid_terminal_success");
  });

  test("rejects capped backward paths that mutate after their last verification", () => {
    const graph = validGraph();
    graph.action_nodes.splice(1, 0,
      { node_id: "retry", action_role: "retry", remediation_scope: null },
      { node_id: "remediate", action_role: "remediate", remediation_scope: { finding_classes: ["failed_check"], artifact_scope: ["src"] } },
    );
    graph.transition_graph.retry = { ...everyOutcome(terminal()), succeeded: node("finalize") };
    graph.transition_graph.remediate = { ...everyOutcome(terminal()), succeeded: node("retry") };
    graph.transition_graph.verify.semantic_failure = node("remediate");
    graph.visit_caps.retry = 1;
    graph.visit_caps.remediate = 1;
    for (const node_id of ["retry", "remediate"]) {
      for (const outcome of ActionOutcomeValues) graph.edge_visit_caps[`${node_id}:${outcome}`] = 1;
    }

    expect(reasonCodes(graph)).toContain("graph_mutation_after_verification");
  });

  test("accepts a capped verify-remediate-verify path when final verification follows every mutation", () => {
    const graph = validGraph();
    graph.action_nodes.splice(2, 0, { node_id: "remediate", action_role: "remediate", remediation_scope: { finding_classes: ["failed_check"], artifact_scope: ["src"] } });
    graph.transition_graph.verify.semantic_failure = node("remediate");
    graph.transition_graph.remediate = { ...everyOutcome(terminal()), succeeded: node("verify") };
    graph.visit_caps.verify = 2;
    graph.visit_caps.remediate = 1;
    for (const outcome of ActionOutcomeValues) graph.edge_visit_caps[`remediate:${outcome}`] = 1;

    const result = validateMandateGraph(graph);
    expect(result.reasons.map((reason) => reason.code)).not.toEqual(expect.arrayContaining(["graph_mutation_after_verification", "graph_invalid_success_boundary"]));
    expect(result.paths.some((path) => path.terminal_outcome === "succeeded" && path.node_ids.join(",") === "execute,verify,remediate,verify,finalize")).toBe(true);
  });

  test("rejects an explicit verify-execute-finalize success path", () => {
    const graph = validGraph();
    graph.action_nodes.splice(2, 0, { node_id: "execute-after-verify", action_role: "execute", remediation_scope: null });
    graph.transition_graph.verify.succeeded = node("execute-after-verify");
    graph.transition_graph["execute-after-verify"] = { ...everyOutcome(terminal()), succeeded: node("finalize") };
    graph.visit_caps["execute-after-verify"] = 1;
    for (const outcome of ActionOutcomeValues) graph.edge_visit_caps[`execute-after-verify:${outcome}`] = 1;

    expect(reasonCodes(graph)).toEqual(expect.arrayContaining(["graph_mutation_after_verification", "graph_invalid_success_boundary"]));
  });

  test("fails closed before graph or state expansion can explode", () => {
    const oversized = validGraph();
    for (let index = 0; index < 70; index += 1) {
      const node_id = `extra-${index}`;
      oversized.action_nodes.push({ node_id, action_role: "retry", remediation_scope: null });
      oversized.transition_graph[node_id] = everyOutcome(terminal());
      oversized.visit_caps[node_id] = 1;
      for (const outcome of ActionOutcomeValues) oversized.edge_visit_caps[`${node_id}:${outcome}`] = 1;
    }

    expect(reasonCodes(oversized)).toContain("graph_complexity_exceeded");
  });
});
