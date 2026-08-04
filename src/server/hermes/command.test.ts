import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, test, vi } from "vitest";

import { CommandTerminationError, createCommandRunner, launchDetachedCommand, runCommand } from "./command";

const executable = process.execPath;
const allowedExecutables = [executable];
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentdash-command-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("runCommand", () => {
  // Production break caught: timeout/abort/output stops used to resolve immediately after sending
  // a direct-child signal, before either process-tree termination or the child's close event.
  test("does not resolve a stopped command until termination is confirmed and close is observed", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: PassThrough;
      stderr: PassThrough;
      stdin: PassThrough;
    };
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    const terminateTree = vi.fn().mockResolvedValue(undefined);
    const runner = createCommandRunner({
      spawnProcess: vi.fn(() => child as never),
      terminateTree,
      terminationGraceMs: 1_000,
      terminationForceMs: 1_000,
    });
    const controller = new AbortController();
    let settled = false;

    const pending = runner({ executable, allowedExecutables, args: [], env: {}, signal: controller.signal });
    void pending.finally(() => { settled = true; });
    controller.abort();
    await vi.waitFor(() => expect(terminateTree).toHaveBeenCalled());

    expect(settled).toBe(false);
    child.emit("close", null, null);
    await expect(pending).resolves.toMatchObject({ aborted: true });
  });

  // Production break caught: a graceful tree-stop acknowledgement without child close could be
  // mistaken for completion instead of escalating to a bounded forced tree termination.
  test("escalates once when graceful tree termination does not produce close", async () => {
    const child = new EventEmitter() as EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough; stdin: PassThrough };
    Object.assign(child, { pid: 4243, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
    const terminateTree = vi.fn(async (_child: unknown, force: boolean) => {
      if (force) queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    });
    const runner = createCommandRunner({
      spawnProcess: vi.fn(() => child as never),
      terminateTree,
      terminationGraceMs: 5,
      terminationForceMs: 100,
    });
    const controller = new AbortController();

    const pending = runner({ executable, allowedExecutables, args: [], env: {}, signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toMatchObject({ aborted: true, signal: "SIGKILL" });
    expect(terminateTree.mock.calls.map((call) => call[1])).toEqual([false, true]);
  });

  // Production break caught: taskkill can transiently miss a just-spawned Windows PID/tree;
  // retrying immediately preserved the race and rejected an otherwise bounded stop.
  test("retries transient process-tree termination failures with bounded backoff", async () => {
    const child = new EventEmitter() as EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough; stdin: PassThrough };
    Object.assign(child, { pid: 4245, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
    const terminateTree = vi.fn()
      .mockRejectedValueOnce(new Error("PID tree is not registered yet"))
      .mockImplementationOnce(async () => { queueMicrotask(() => child.emit("close", null, "SIGKILL")); });
    const runner = createCommandRunner({
      spawnProcess: vi.fn(() => child as never),
      terminateTree,
      terminationGraceMs: 100,
      terminationForceMs: 100,
      terminationAttempts: 2,
      terminationRetryMs: 1,
    });
    const controller = new AbortController();

    const pending = runner({ executable, allowedExecutables, args: [], env: {}, signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toMatchObject({ aborted: true, signal: "SIGKILL" });
    expect(terminateTree.mock.calls.map((call) => call[1])).toEqual([false, false]);
  });

  // Production break caught: swallowed kill failures previously returned a successful-looking
  // stopped result even though the process tree could still be using the disposable directory.
  test("rejects with a fixed error when both process-tree termination attempts fail", async () => {
    const child = new EventEmitter() as EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough; stdin: PassThrough };
    Object.assign(child, { pid: 4244, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
    const terminateTree = vi.fn().mockRejectedValue(new Error("kill failed: sensitive detail"));
    const runner = createCommandRunner({
      spawnProcess: vi.fn(() => child as never),
      terminateTree,
      terminationGraceMs: 5,
      terminationForceMs: 5,
      terminationAttempts: 1,
    });
    const controller = new AbortController();

    const pending = runner({ executable, allowedExecutables, args: [], env: {}, signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toEqual(new CommandTerminationError());
    expect(terminateTree.mock.calls.map((call) => call[1])).toEqual([false, true]);
  });

  // Production break caught: a PATH-relative binary could select an attacker-controlled executable.
  test("rejects relative executable paths", async () => {
    await expect(runCommand({ executable: "node", allowedExecutables: ["node"], args: [], env: {} }))
      .rejects.toMatchObject({ code: "invalid_executable" });
  });

  // Production break caught: Windows command wrappers could reintroduce implicit shell execution.
  test.each(["hermes.cmd", "hermes.bat"])("rejects the %s executable extension", async (name) => {
    const path = join(await temporaryDirectory(), name);
    await writeFile(path, "exit /b 0", "utf8");

    await expect(runCommand({ executable: path, allowedExecutables: [path], args: [], env: {} }))
      .rejects.toMatchObject({ code: "invalid_executable" });
  });

  // Production break caught: an absolute binary outside policy could execute merely because a caller supplied it.
  test("rejects an executable outside the explicit allowlist", async () => {
    await expect(runCommand({ executable, allowedExecutables: [join(await temporaryDirectory(), "other.exe")], args: [], env: {} }))
      .rejects.toMatchObject({ code: "executable_not_allowed" });
  });

  // Production break caught: CEO punctuation could be interpreted as shell grammar instead of one literal argument.
  test("passes shell metacharacters literally without creating their requested side effect", async () => {
    const directory = await temporaryDirectory();
    const sentinel = join(directory, "injected.txt");
    const punctuation = `hello & echo injected > ${sentinel} | (whoami); \`ignored\``;

    const result = await runCommand({
      executable,
      allowedExecutables,
      args: ["-e", "process.stdout.write(process.argv[1])", punctuation],
      env: {},
    });

    expect(result).toMatchObject({ code: 0, stdout: punctuation, timedOut: false, aborted: false });
    await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  // Production break caught: a wedged Hermes process could outlive its bounded turn deadline.
  test("terminates a command at its timeout", async () => {
    const result = await runCommand({
      executable,
      allowedExecutables,
      args: ["-e", "setInterval(() => {}, 1_000)"],
      env: {},
      timeoutMs: 25,
    });

    expect(result).toMatchObject({ code: null, timedOut: true, aborted: false });
  });

  // Production break caught: killing only the direct Hermes child could let a delegated grandchild
  // survive the timeout and mutate state after the command promise had already resolved.
  test("confirms the complete process tree is gone before a timeout resolves", async () => {
    const directory = await temporaryDirectory();
    const sentinel = join(directory, "grandchild-survived.txt");
    const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'survived'), 1_500)`;
    const parent = [
      "const { spawn } = require('node:child_process')",
      `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' })`,
      "setInterval(() => {}, 1_000)",
    ].join(";");

    const result = await runCommand({
      executable,
      allowedExecutables,
      args: ["-e", parent],
      env: {},
      timeoutMs: 750,
    });

    expect(result.timedOut).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1_700));
    await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("confirms the complete process tree is gone before abort resolution", async () => {
    const directory = await temporaryDirectory();
    const ready = join(directory, "parent-ready.txt");
    const sentinel = join(directory, "abort-grandchild-survived.txt");
    const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'survived'), 800)`;
    const parent = [
      "const { spawn } = require('node:child_process')",
      "const fs = require('node:fs')",
      `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' })`,
      `fs.writeFileSync(${JSON.stringify(ready)}, 'ready')`,
      "setInterval(() => {}, 1_000)",
    ].join(";");
    const controller = new AbortController();
    const pending = runCommand({
      executable,
      allowedExecutables,
      args: ["-e", parent],
      env: {},
      signal: controller.signal,
    });
    await expect.poll(async () => {
      try { return await readFile(ready, "utf8"); } catch { return null; }
    }, { timeout: 2_000 }).toBe("ready");

    controller.abort();
    await expect(pending).resolves.toMatchObject({ aborted: true });
    await new Promise((resolve) => setTimeout(resolve, 900));
    await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("confirms the complete process tree is gone before output-limit resolution", async () => {
    const directory = await temporaryDirectory();
    const sentinel = join(directory, "output-grandchild-survived.txt");
    const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'survived'), 800)`;
    const parent = [
      "const { spawn } = require('node:child_process')",
      `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' })`,
      "process.stdout.write('x'.repeat(4_096))",
      "setInterval(() => {}, 1_000)",
    ].join(";");

    const result = await runCommand({
      executable,
      allowedExecutables,
      args: ["-e", parent],
      env: {},
      maxOutputBytes: 64,
    });

    expect(result.outputLimitExceeded).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  // Production break caught: unbounded model output could exhaust server memory.
  test("terminates and caps combined output", async () => {
    const result = await runCommand({
      executable,
      allowedExecutables,
      args: ["-e", "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1_000)"],
      env: {},
      maxOutputBytes: 64,
    });

    expect(result.outputLimitExceeded).toBe(true);
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(64);
  });

  // Production break caught: a cancelled HTTP request could leave Hermes running in the background.
  test("terminates a command when its abort signal fires", async () => {
    const controller = new AbortController();
    const pending = runCommand({
      executable,
      allowedExecutables,
      args: ["-e", "setInterval(() => {}, 1_000)"],
      env: {},
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 25);

    await expect(pending).resolves.toMatchObject({ code: null, timedOut: false, aborted: true });
  });

  // Production break caught: a forbidden credential in the parent environment could leak into Hermes by inheritance.
  test("does not inherit forbidden parent environment keys", async () => {
    const original = process.env.CODEG_TOKEN;
    process.env.CODEG_TOKEN = "must-not-reach-child";
    try {
      const result = await runCommand({
        executable,
        allowedExecutables,
        args: ["-e", "process.stdout.write(String(process.env.CODEG_TOKEN))"],
        env: {},
      });
      expect(result.stdout).toBe("undefined");
    } finally {
      if (original === undefined) delete process.env.CODEG_TOKEN;
      else process.env.CODEG_TOKEN = original;
    }
  });

  // Production break caught: Hermes could inherit the AgentDash workspace and discover project-local instructions or files.
  test("runs in an explicit disposable working directory", async () => {
    const directory = await temporaryDirectory();
    const result = await runCommand({
      executable,
      allowedExecutables,
      args: ["-e", "process.stdout.write(process.cwd())"],
      env: {},
      cwd: directory,
    });

    expect(result.stdout.toLowerCase()).toBe(directory.toLowerCase());
  });

  // Production break caught: case changes could bypass the forbidden child-environment policy.
  test("rejects forbidden child environment keys case-insensitively", async () => {
    await expect(runCommand({
      executable,
      allowedExecutables,
      args: [],
      env: { cOdEg_ToKeN: "must-not-reach-child" },
    })).rejects.toSatisfy((error: unknown) => {
      expect(error).toMatchObject({ code: "forbidden_environment" });
      expect(String(error)).not.toContain("must-not-reach-child");
      return true;
    });
  });

  // Production break caught: model or process errors could echo credential-shaped values to an API consumer.
  test("redacts credential-shaped command output", async () => {
    const secret = "sk-test_abcdefghijklmnopqrstuvwxyz";
    const result = await runCommand({
      executable,
      allowedExecutables,
      args: ["-e", `process.stderr.write(${JSON.stringify(secret)}); process.exit(1)`],
      env: {},
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[REDACTED]");
    expect(result.stderr).not.toContain(secret);
  });
});

describe("launchDetachedCommand", () => {
  // Production break caught: detached dashboard launches could bypass the same shell and allowlist controls.
  test("launches an allowlisted executable through the hardened detached path", async () => {
    const directory = await temporaryDirectory();
    const sentinel = join(directory, "detached.txt");

    const result = launchDetachedCommand({
      executable,
      allowedExecutables,
      args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'started')`],
      env: {},
    });

    expect(result.pid).toBeTypeOf("number");
    await expect.poll(async () => {
      try { return await readFile(sentinel, "utf8"); } catch { return null; }
    }, { timeout: 2_000 }).toBe("started");
  });
});
