import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { canonicalDigest } from "../../../lib/mission-control/contracts/common";
import { buildMissionControlHealth } from "../policy/health";
import { getMissionControlController, stopMissionControlController } from "./composition";
import { MissionControlController } from "./controller";
import { RecoveryOutbox } from "./outbox";
import { ControllerOwner } from "./owner-lock";

const roots: string[] = [];
const ENV_KEYS = ["MISSION_CONTROL_DISPATCH", "AGENTDASH_STATE_DIR"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(async () => {
  await stopMissionControlController();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function stateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentdash-composition-"));
  roots.push(root);
  return root;
}

// Write the durable record `promote-gates --promote` produces, so these tests
// exercise the same authority path production reads.
/**
 * Write a promotion the way `promote-gates --promote` does: a PromotionManifestV1
 * whose digest is computed over its own canonical body, then the record naming it.
 *
 * This helper previously wrote `manifest_digest: "a".repeat(64)` — a digest bound to
 * nothing — and the runtime accepted it, because the digest was only checked for
 * SHAPE. An independent audit reproduced exactly that as a real gap. The record is
 * now only authority if the manifest it names actually backs it, so a legitimate
 * fixture has to write both.
 */
async function writePromotion(stateDir: string, mode: string, overrides: Record<string, unknown> = {}) {
  const dir = join(stateDir, "dispatch");
  await mkdir(dir, { recursive: true });
  const expiresAt = typeof overrides.expires_at === "string" ? overrides.expires_at : "2099-01-01T00:00:00.000Z";
  const manifestBody = {
    schema_version: "agentdash.promotion-manifest/v1",
    current_mode: "disabled",
    target_mode: mode,
    operator_command: "promote-gates --mode=" + mode + " --promote",
    created_at: "2026-08-06T12:00:00.000Z",
    expires_at: expiresAt,
  };
  const manifestDigest = canonicalDigest(manifestBody);
  await writeFile(join(dir, `promotion-${manifestDigest}.json`), JSON.stringify({ ...manifestBody, manifest_digest: manifestDigest }), "utf8");

  const record = {
    schema_version: "agentdash.dispatch-mode/v1",
    mode,
    manifest_digest: manifestDigest,
    promoted_at: "2026-08-06T12:00:00.000Z",
    expires_at: expiresAt,
    ...overrides,
  };
  await writeFile(join(dir, "mode.json"), JSON.stringify(record), "utf8");
}

describe("mission control composition root", () => {
  test("builds a dormant controller that owns the lease and refuses model dispatch", async () => {
    process.env.AGENTDASH_STATE_DIR = await stateRoot();
    process.env.MISSION_CONTROL_DISPATCH = "enabled";

    const controller = await getMissionControlController();

    expect(controller).not.toBeNull();
    expect(controller?.isOwner).toBe(true);
    // Even wired and owning the lease, no command can reach a worker transport:
    // there is no staged proposal and the dormant adapters fail closed.
    await expect(controller?.advanceCommand("command-1")).rejects.toThrow();
  });

  // The durable promotion record is the only grant of authority. An env var alone
  // must never reach `enabled`, or promotion would not be a compare-and-set at all.
  test("an env var alone never grants enabled without a promotion record", async () => {
    process.env.AGENTDASH_STATE_DIR = await stateRoot();
    process.env.MISSION_CONTROL_DISPATCH = "enabled";

    const controller = await getMissionControlController();

    expect(controller?.gate("model_backed").allowed).toBe(false);
    expect(controller?.gate("candidate").allowed).toBe(false);
  });

  test("a durable promotion record grants exactly the promoted mode", async () => {
    const stateDir = await stateRoot();
    process.env.AGENTDASH_STATE_DIR = stateDir;
    delete process.env.MISSION_CONTROL_DISPATCH;
    await writePromotion(stateDir, "enabled");

    const controller = await getMissionControlController();

    expect(controller?.gate("model_backed").allowed).toBe(true);
  });

  test("a record naming a manifest that does not exist grants nothing", async () => {
    const stateDir = await stateRoot();
    process.env.AGENTDASH_STATE_DIR = stateDir;
    delete process.env.MISSION_CONTROL_DISPATCH;
    // Shape-valid in every respect, and bound to nothing. This is the exact record
    // the runtime used to accept as full production dispatch authority.
    const dir = join(stateDir, "dispatch");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "mode.json"), JSON.stringify({
      schema_version: "agentdash.dispatch-mode/v1", mode: "enabled",
      manifest_digest: "a".repeat(64), promoted_at: "2026-08-06T12:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z",
    }), "utf8");

    const controller = await getMissionControlController();

    expect(controller?.gate("model_backed").allowed).toBe(false);
    expect(controller?.gate("candidate").allowed).toBe(false);
  });

  test("a genuine manifest cannot authorize a mode it did not promote", async () => {
    const stateDir = await stateRoot();
    process.env.AGENTDASH_STATE_DIR = stateDir;
    delete process.env.MISSION_CONTROL_DISPATCH;
    // A real, internally consistent `candidate` promotion whose record is then
    // edited to claim `enabled`. The manifest still verifies against its own digest,
    // so only the target_mode binding catches this.
    await writePromotion(stateDir, "candidate");
    const modePath = join(stateDir, "dispatch", "mode.json");
    const record = JSON.parse(await readFile(modePath, "utf8")) as Record<string, unknown>;
    record.mode = "enabled";
    await writeFile(modePath, JSON.stringify(record), "utf8");

    const controller = await getMissionControlController();

    expect(controller?.gate("model_backed").allowed).toBe(false);
  });

  test("a tampered manifest cannot match the digest that names it", async () => {
    const stateDir = await stateRoot();
    process.env.AGENTDASH_STATE_DIR = stateDir;
    delete process.env.MISSION_CONTROL_DISPATCH;
    await writePromotion(stateDir, "enabled");
    // Edit the manifest in place, keeping its filename and claimed digest.
    const record = JSON.parse(await readFile(join(stateDir, "dispatch", "mode.json"), "utf8")) as { manifest_digest: string };
    const manifestPath = join(stateDir, "dispatch", `promotion-${record.manifest_digest}.json`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.operator_command = "promote-gates --mode=enabled --promote --forged";
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    const controller = await getMissionControlController();

    expect(controller?.gate("model_backed").allowed).toBe(false);
  });

  test("a promoted mode survives instrumentation's normalization when no env var is set", async () => {
    // Found by testing a RUNNING server: instrumentation unconditionally assigned
    // process.env.MISSION_CONTROL_DISPATCH = parseDispatchMode(...), which wrote the
    // literal "disabled" when the variable was absent. resolveDispatchMode treats a
    // PRESENT env value as a restriction, so the env var always restricted and a
    // legitimately promoted mode could never take effect. Run the real register()
    // exactly as the server does, then assert the promotion still holds.
    const stateDir = await stateRoot();
    process.env.AGENTDASH_STATE_DIR = stateDir;
    delete process.env.MISSION_CONTROL_DISPATCH;
    await writePromotion(stateDir, "candidate");

    const { register } = await import("../../../instrumentation");
    await register();

    const controller = await getMissionControlController();
    expect(controller?.mode).toBe("candidate");
    expect(controller?.gate("candidate").allowed).toBe(true);
    // Still fail-closed for model-backed work, which requires `enabled`.
    expect(controller?.gate("model_backed").allowed).toBe(false);
  });

  test("an env var may narrow a promoted mode for rollback", async () => {
    const stateDir = await stateRoot();
    process.env.AGENTDASH_STATE_DIR = stateDir;
    process.env.MISSION_CONTROL_DISPATCH = "disabled";
    await writePromotion(stateDir, "enabled");

    const controller = await getMissionControlController();

    expect(controller?.gate("model_backed").allowed).toBe(false);
  });

  test("an expired promotion record grants nothing", async () => {
    const stateDir = await stateRoot();
    process.env.AGENTDASH_STATE_DIR = stateDir;
    delete process.env.MISSION_CONTROL_DISPATCH;
    await writePromotion(stateDir, "enabled", { expires_at: "2020-01-01T00:00:00.000Z" });

    const controller = await getMissionControlController();

    expect(controller?.gate("model_backed").allowed).toBe(false);
  });

  test("a record without a bound manifest digest grants nothing", async () => {
    const stateDir = await stateRoot();
    process.env.AGENTDASH_STATE_DIR = stateDir;
    delete process.env.MISSION_CONTROL_DISPATCH;
    await writePromotion(stateDir, "enabled", { manifest_digest: "not-a-digest" });

    const controller = await getMissionControlController();

    expect(controller?.gate("model_backed").allowed).toBe(false);
  });

  test("returns one shared controller and never a second owner for the same state dir", async () => {
    process.env.AGENTDASH_STATE_DIR = await stateRoot();
    process.env.MISSION_CONTROL_DISPATCH = "enabled";

    const first = await getMissionControlController();
    expect(await getMissionControlController()).toBe(first);

    // A separate process identity against the same live state dir cannot own it.
    const contender = new MissionControlController({
      mode: "enabled",
      owner: new ControllerOwner({ stateDir: process.env.AGENTDASH_STATE_DIR, pid: 999_999, processStartToken: "other-process" }),
      outbox: new RecoveryOutbox({ stateDir: process.env.AGENTDASH_STATE_DIR }),
      runner: { advance: async () => ({ state: "found" as const, binding: null }) },
    });
    expect(await contender.start()).toBe(false);
  });

  test("stays unwired and fail-closed without a configured state directory", async () => {
    delete process.env.AGENTDASH_STATE_DIR;
    process.env.MISSION_CONTROL_DISPATCH = "enabled";

    expect(await getMissionControlController()).toBeNull();
  });

  test("the env var alone never puts a mode in force, so health cannot report one", async () => {
    // Found by testing a RUNNING server, not by the suite: the health routes read
    // process.env.MISSION_CONTROL_DISPATCH directly and reported `enabled` from the
    // env var alone while the controller was `disabled`. Health must project the
    // mode actually in force.
    const stateDir = await stateRoot();
    process.env.AGENTDASH_STATE_DIR = stateDir;
    process.env.MISSION_CONTROL_DISPATCH = "enabled";
    // No promotion record at all, plus a fabricated one — neither may grant.
    const controller = await getMissionControlController();
    expect(controller?.mode).toBe("disabled");
    expect(buildMissionControlHealth({
      now: "2026-08-09T00:00:00.000Z",
      dispatch_mode: controller?.mode ?? "disabled",
      proofs: [],
      auto_snapshot: null,
    }).dispatch.mode).toBe("disabled");
  });
});
