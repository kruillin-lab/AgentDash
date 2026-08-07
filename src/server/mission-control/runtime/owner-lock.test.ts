import { fork } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";
import { afterEach, describe, expect, test } from "vitest";

import { ControllerOwner } from "./owner-lock";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function stateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentdash-owner-"));
  roots.push(root);
  return root;
}

describe("ControllerOwner", () => {
  test("allows only one process identity to schedule controller work", async () => {
    const root = await stateRoot();
    const first = new ControllerOwner({ stateDir: root, pid: 101, processStartToken: "start-a" });
    const second = new ControllerOwner({ stateDir: root, pid: 202, processStartToken: "start-b" });

    const lease = await first.acquire();

    expect(lease).not.toBeNull();
    expect(await second.acquire()).toBeNull();
    await lease?.release();
  });

  test("does not create a second scheduler during a same-process dev reload", async () => {
    const root = await stateRoot();
    const first = new ControllerOwner({ stateDir: root, pid: 101, processStartToken: "same-start" });
    const reload = new ControllerOwner({ stateDir: root, pid: 101, processStartToken: "same-start" });

    const lease = await first.acquire();

    expect(await reload.acquire()).toBeNull();
    await lease?.release();
  });

  test("reclaims a crashed owner's stale lock", async () => {
    const root = await stateRoot();
    let now = 1_000;
    const crashed = new ControllerOwner({ stateDir: root, pid: 101, processStartToken: "start-a", now: () => now, staleAfterMs: 500 });
    const successor = new ControllerOwner({ stateDir: root, pid: 202, processStartToken: "start-b", now: () => now, staleAfterMs: 500 });

    expect(await crashed.acquire()).not.toBeNull();
    now = 1_501;

    const replacement = await successor.acquire();
    expect(replacement).not.toBeNull();
    await replacement?.release();
  });

  test("a reclaimed PID cannot let the old lease remove the new owner's lock", async () => {
    const root = await stateRoot();
    let now = 1_000;
    const oldProcess = new ControllerOwner({ stateDir: root, pid: 101, processStartToken: "old-start", now: () => now, staleAfterMs: 500 });
    const reusedPid = new ControllerOwner({ stateDir: root, pid: 101, processStartToken: "new-start", now: () => now, staleAfterMs: 500 });
    const contender = new ControllerOwner({ stateDir: root, pid: 303, processStartToken: "start-c", now: () => now, staleAfterMs: 500 });

    const oldLease = await oldProcess.acquire();
    now = 1_501;
    const newLease = await reusedPid.acquire();
    expect(newLease).not.toBeNull();

    await oldLease?.release();
    expect(await contender.acquire()).toBeNull();
    await newLease?.release();
  });

  test("heartbeat prevents takeover and graceful release permits it", async () => {
    const root = await stateRoot();
    let now = 1_000;
    const first = new ControllerOwner({ stateDir: root, pid: 101, processStartToken: "start-a", now: () => now, staleAfterMs: 500 });
    const second = new ControllerOwner({ stateDir: root, pid: 202, processStartToken: "start-b", now: () => now, staleAfterMs: 500 });
    const lease = await first.acquire();

    now = 1_400;
    await lease?.heartbeat();
    now = 1_800;
    expect(await second.acquire()).toBeNull();

    await lease?.release();
    expect(await second.acquire()).not.toBeNull();
  });

  test("two real OS processes against one state dir produce exactly one owner", async () => {
    const root = await stateRoot();
    const serverOnlyStub = join(root, "server-only-stub.js");
    const bundle = join(root, "owner-child.cjs");
    await writeFile(serverOnlyStub, "module.exports = {};\n", "utf8");
    await build({
      entryPoints: [join(__dirname, "owner-child.entry.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: bundle,
      alias: { "server-only": serverOnlyStub },
      logLevel: "silent",
    });

    const run = (pid: number, token: string, holdMs: number): Promise<{ pid: number; acquired: boolean }> =>
      new Promise((resolvePromise, rejectPromise) => {
        const child = fork(bundle, [root, String(pid), token, String(holdMs)], { silent: true });
        let out = "";
        let err = "";
        child.stdout?.on("data", (chunk) => { out += chunk; });
        child.stderr?.on("data", (chunk) => { err += chunk; });
        child.on("error", rejectPromise);
        child.on("close", (code) => {
          const line = out.trim().split("\n").filter(Boolean).pop();
          if (!line) { rejectPromise(new Error(`child ${pid} emitted no result (exit ${code}): ${err}`)); return; }
          resolvePromise(JSON.parse(line) as { pid: number; acquired: boolean });
        });
      });

    // The winner holds the lease long enough that the loser's acquire overlaps a
    // fresh heartbeat and is refused.
    const [a, b] = await Promise.all([run(501, "proc-a", 800), run(502, "proc-b", 0)]);

    expect([a.acquired, b.acquired].filter(Boolean)).toHaveLength(1);
  }, 30_000);
});
