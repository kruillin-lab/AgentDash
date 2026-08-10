import { join } from "node:path";

import { describe, expect, test } from "vitest";

// The operator helper is intentionally plain Node ESM so it can run before the app build.
// @ts-expect-error The repository does not type-check scripts/*.mjs as application source.
import { sealQualificationEnvelope, validateUnsignedEnvelope } from "../../../../scripts/mission-control/evaluate-route.mjs";

function unsignedEnvelope() {
  return {
    schema_version: "agentdash.qualification-envelope/v1",
    origin: "operator_cli",
    operator_session_id: "operator-session-1234567890",
    route_id: "route-codex-gpt-5-6-terra",
    exact_route: { outer_harness: "codex", provider: "openai", model: "gpt-5.6-terra", agent_type: "worker", mode: "standard", config_digest: "1".repeat(64) },
    task_class: "bounded_coding",
    level: 4,
    fixture_set_version: "mission-control-fixtures/v1",
    disposable_board: { board_id: "qualification-board-1", path: join(process.cwd(), ".disposable", "board") },
    workspace: { project_id: "agentdash", path: join(process.cwd(), ".disposable", "workspace"), disposable: true },
    ceilings: { max_cost_usd: 1, max_runtime_ms: 600_000, max_provider_tokens: 100_000 },
    allowed_operations: ["read", "write_disposable", "execute_tests", "emit_receipt"],
    candidate_bridge_proofs: { hermes_commit: "a".repeat(40), codeg_commit: "b".repeat(40) },
    mode: "qualification",
    issued_at: "2026-08-06T12:00:00.000Z",
    expires_at: "2026-08-06T12:10:00.000Z",
    nonce: "nonce-qualification-1234567890",
  };
}

describe("route qualification operator script", () => {
  test("seals only the complete operator qualification envelope", () => {
    const unsigned = unsignedEnvelope();
    expect(validateUnsignedEnvelope(unsigned)).toEqual([]);
    expect(sealQualificationEnvelope(unsigned, "qualification-operator-secret-that-is-long-enough")).toMatchObject({ ...unsigned, signature: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  test("rejects unknown fields, prohibited operations, and non-disposable workspaces", () => {
    expect(validateUnsignedEnvelope({ ...unsignedEnvelope(), surprise: true })).toContain("Envelope has missing or unknown top-level fields.");
    expect(validateUnsignedEnvelope({ ...unsignedEnvelope(), allowed_operations: ["read", "network"] })).toContain("Allowed operations exceed the qualification allowlist.");
    expect(validateUnsignedEnvelope({ ...unsignedEnvelope(), workspace: { ...unsignedEnvelope().workspace, disposable: false } })).toContain("Workspace must be explicitly disposable and absolute.");
  });
});
