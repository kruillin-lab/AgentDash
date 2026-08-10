import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ExactRouteV1Schema } from "../../../lib/mission-control/contracts";
import { loadRouteInventory } from "./inventory";

const configPath = join(process.cwd(), "config", "mission-control-route-inventory.json");

describe("route inventory", () => {
  test("loads the approved 15 candidates, five incomplete templates, and one disabled item", async () => {
    const inventory = await loadRouteInventory(configPath);
    expect(inventory.entries).toHaveLength(21);
    expect(inventory.entries.filter((entry) => entry.status === "candidate")).toHaveLength(15);
    expect(inventory.entries.filter((entry) => entry.status === "template")).toHaveLength(5);
    expect(inventory.entries.filter((entry) => entry.status === "disabled")).toHaveLength(1);
    expect(inventory.entries.map((entry) => `${entry.outer_harness ?? "template"}/${entry.model}`)).toEqual(expect.arrayContaining([
      "codex/gpt-5.6-sol",
      "codex/gpt-5.6-terra",
      "codex/gpt-5.6-luna",
      "opencode-go/deepseek-v4-flash",
      "opencode-go/qwen3.7-plus",
      "claude-code/claude-opus-5",
      "kimi-code/kimi-k3",
      "grok-build/grok-4.5",
      "template/nemotron-3-ultra:cloud",
      "template/hy3:cloud",
    ]));
  });

  test("qualifies candidates only by the complete harness/provider/model/agent/mode/config tuple", async () => {
    const inventory = await loadRouteInventory(configPath);
    const sol = inventory.requireCandidate("route-codex-gpt-5-6-sol");
    expect(inventory.matchExact(sol.exact_route)?.route_id).toBe(sol.route_id);
    expect(inventory.matchExact({ ...sol.exact_route, outer_harness: "claude-code" })).toBeNull();
    expect(inventory.matchExact({ ...sol.exact_route, mode: "different" })).toBeNull();
    const drifted = ExactRouteV1Schema.parse({ ...sol.exact_route, config_digest: "0".repeat(64) });
    expect(inventory.matchExact(drifted)).toBeNull();
  });

  test("never resolves templates or disabled catalog items as executable routes", async () => {
    const inventory = await loadRouteInventory(configPath);
    for (const entry of inventory.entries.filter((candidate) => candidate.status !== "candidate")) {
      expect(() => inventory.requireCandidate(entry.route_id)).toThrow(/not an executable candidate/i);
    }
  });
});
