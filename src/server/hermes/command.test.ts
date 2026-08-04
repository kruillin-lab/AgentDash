import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { launchDetachedCommand, runCommand } from "./command";

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

  // Production break caught: unbounded model output could exhaust server memory.
  test("terminates and caps combined output", async () => {
    const result = await runCommand({
      executable,
      allowedExecutables,
      args: ["-e", "process.stdout.write('x'.repeat(4096))"],
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
