import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_ARGUMENTS = 128;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const DEFAULT_TERMINATION_GRACE_MS = 10_000;
const DEFAULT_TERMINATION_FORCE_MS = 10_000;
const DEFAULT_TERMINATION_ATTEMPTS = 3;
const DEFAULT_TERMINATION_RETRY_MS = 100;
const FORBIDDEN_EXECUTABLE_EXTENSIONS = new Set([".bat", ".cmd"]);
const FORBIDDEN_ENVIRONMENT_KEY = /(?:^|_)(?:CODEG|CONTROLLER|WORKSPACE|BROWSER|COMPUTER|FILES?|SHELL|RESEARCH|DELEGATE|DELEGATION|TOOLS?)(?:_|$)|(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|COOKIE|CREDENTIAL)/i;
const CREDENTIAL_SHAPES = [
  /\b(?:sk|rk|pk)-(?:test_|live_)?[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
];

export type CommandResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
  outputLimitExceeded: boolean;
};

export type CommandOptions = {
  executable: string;
  allowedExecutables: readonly string[];
  args: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  redactValues?: readonly string[];
};

export type DetachedCommandOptions = Pick<CommandOptions, "executable" | "allowedExecutables" | "args" | "env">;

export class CommandPolicyError extends Error {
  constructor(public readonly code: "invalid_executable" | "executable_not_allowed" | "invalid_arguments" | "forbidden_environment", message: string) {
    super(message);
    this.name = "CommandPolicyError";
  }
}

export class CommandTerminationError extends Error {
  readonly code = "termination_unconfirmed";

  constructor() {
    super("Command process-tree termination could not be confirmed.");
    this.name = "CommandTerminationError";
  }
}

type SpawnProcess = typeof spawn;
type TerminateTree = (child: ChildProcess, force: boolean) => Promise<void>;

export type CommandRunnerDependencies = {
  spawnProcess?: SpawnProcess;
  terminateTree?: TerminateTree;
  terminationGraceMs?: number;
  terminationForceMs?: number;
  terminationAttempts?: number;
  terminationRetryMs?: number;
};

function executableExtension(executable: string): string {
  const match = /\.[^.\\/]+$/.exec(executable);
  return match?.[0].toLowerCase() ?? "";
}

function normalizedExecutable(executable: string): string {
  return process.platform === "win32" ? resolve(executable).toLowerCase() : resolve(executable);
}

function validateExecutable(executable: string, allowedExecutables: readonly string[]): void {
  if (!executable || !isAbsolute(executable) || FORBIDDEN_EXECUTABLE_EXTENSIONS.has(executableExtension(executable))) {
    throw new CommandPolicyError("invalid_executable", "Command executable must be an absolute non-script path.");
  }
  if (!allowedExecutables.some((allowed) => isAbsolute(allowed) && normalizedExecutable(allowed) === normalizedExecutable(executable))) {
    throw new CommandPolicyError("executable_not_allowed", "Command executable is not allowlisted.");
  }
}

function validateArguments(args: readonly string[]): void {
  if (args.length > MAX_ARGUMENTS || args.some((arg) => typeof arg !== "string" || arg.includes("\0") || Buffer.byteLength(arg) > MAX_ARGUMENT_BYTES)) {
    throw new CommandPolicyError("invalid_arguments", "Command arguments exceed the validated array bounds.");
  }
}

function validatedEnvironment(source: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(source)) {
    if (FORBIDDEN_ENVIRONMENT_KEY.test(key)) {
      throw new CommandPolicyError("forbidden_environment", `Child environment key ${key} is forbidden.`);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value === undefined) continue;
    env[key] = value;
  }
  return env;
}

function redact(text: string, explicitValues: readonly string[]): string {
  let redacted = text;
  for (const value of explicitValues) {
    if (value.length >= 6) redacted = redacted.split(value).join("[REDACTED]");
  }
  for (const pattern of CREDENTIAL_SHAPES) redacted = redacted.replace(pattern, "[REDACTED]");
  return redacted;
}

function validate(options: Pick<CommandOptions, "executable" | "allowedExecutables" | "args" | "env">): NodeJS.ProcessEnv {
  validateExecutable(options.executable, options.allowedExecutables);
  validateArguments(options.args);
  return validatedEnvironment(options.env);
}

function deadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolveWork, rejectWork) => {
    const timeout = setTimeout(() => rejectWork(new CommandTerminationError()), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timeout);
        resolveWork(value);
      },
      () => {
        clearTimeout(timeout);
        rejectWork(new CommandTerminationError());
      },
    );
  });
}

async function terminateWithTaskkill(child: ChildProcess, _force: boolean): Promise<void> {
  if (!child.pid) throw new CommandTerminationError();
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !isAbsolute(systemRoot)) throw new CommandTerminationError();
  const taskkill = join(systemRoot, "System32", "taskkill.exe");
  // Windows has no reliable process-group SIGTERM equivalent. taskkill /T /F is the
  // reviewed tree boundary for both attempts; the state machine still bounds and retries it.
  const args = ["/PID", String(child.pid), "/T", "/F"];
  const env: NodeJS.ProcessEnv = { SystemRoot: systemRoot, WINDIR: systemRoot, NODE_ENV: "production" };

  await new Promise<void>((resolveTermination, rejectTermination) => {
    const terminator = spawn(taskkill, args, {
      env,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    terminator.once("error", () => rejectTermination(new CommandTerminationError()));
    terminator.once("close", (code) => {
      if (code === 0) resolveTermination();
      else rejectTermination(new CommandTerminationError());
    });
  });
}

async function terminateProcessTree(child: ChildProcess, force: boolean): Promise<void> {
  if (process.platform === "win32") {
    await terminateWithTaskkill(child, force);
    return;
  }
  if (!child.pid) throw new CommandTerminationError();
  try {
    process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new CommandTerminationError();
  }
}

/** Runs one allowlisted executable directly. No shell or inherited environment is available. */
export function createCommandRunner(dependencies: CommandRunnerDependencies = {}): (options: CommandOptions) => Promise<CommandResult> {
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const terminateTree = dependencies.terminateTree ?? terminateProcessTree;
  const terminationGraceMs = dependencies.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  const terminationForceMs = dependencies.terminationForceMs ?? DEFAULT_TERMINATION_FORCE_MS;
  const terminationAttempts = dependencies.terminationAttempts ?? DEFAULT_TERMINATION_ATTEMPTS;
  const terminationRetryMs = dependencies.terminationRetryMs ?? DEFAULT_TERMINATION_RETRY_MS;

  return async function run(options: CommandOptions): Promise<CommandResult> {
    const env = validate(options);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0
      || !Number.isSafeInteger(terminationGraceMs) || terminationGraceMs <= 0
      || !Number.isSafeInteger(terminationForceMs) || terminationForceMs <= 0
      || !Number.isSafeInteger(terminationAttempts) || terminationAttempts <= 0
      || !Number.isSafeInteger(terminationRetryMs) || terminationRetryMs <= 0
      || (options.cwd !== undefined && !isAbsolute(options.cwd))) {
      throw new CommandPolicyError("invalid_arguments", "Command timeout and output cap must be positive safe integers.");
    }

    return new Promise<CommandResult>((resolveResult, rejectResult) => {
      const child = spawnProcess(options.executable, [...options.args], {
        detached: process.platform !== "win32",
        env,
        cwd: options.cwd,
        shell: false,
        stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      let stopping = false;
      let stopPromise: Promise<void> | undefined;
      let timedOut = false;
      let aborted = false;
      let outputLimitExceeded = false;
      let spawnError: Error | undefined;
      let closeResult: { code: number | null; signal: NodeJS.Signals | null } | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let resolveClose!: () => void;
      const closed = new Promise<void>((resolveClosed) => { resolveClose = resolveClosed; });

      const cleanListeners = () => {
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        cleanListeners();
        const explicitValues = options.redactValues ?? [];
        const capturedStderr = Buffer.concat(stderr).toString("utf8") + (spawnError ? `\n${spawnError.message}` : "");
        resolveResult({
          stdout: redact(Buffer.concat(stdout).toString("utf8"), explicitValues),
          stderr: redact(capturedStderr, explicitValues),
          code,
          signal,
          timedOut,
          aborted,
          outputLimitExceeded,
        });
      };
      const failTermination = () => {
        if (settled) return;
        settled = true;
        cleanListeners();
        rejectResult(new CommandTerminationError());
      };
      const waitForClose = async (waitMs: number): Promise<boolean> => {
        if (closeResult) return true;
        try {
          await deadline(closed, waitMs);
          return true;
        } catch {
          return false;
        }
      };
      const waitBeforeTerminationRetry = async (): Promise<void> => {
        if (closeResult) throw new CommandTerminationError();
        await Promise.race([
          new Promise<void>((resolveDelay) => setTimeout(resolveDelay, terminationRetryMs)),
          closed.then(() => { throw new CommandTerminationError(); }),
        ]);
      };
      const terminateWithRetries = async (force: boolean): Promise<void> => {
        for (let attempt = 1; attempt <= terminationAttempts; attempt += 1) {
          if (closeResult) throw new CommandTerminationError();
          try {
            await terminateTree(child, force);
            return;
          } catch {
            if (attempt === terminationAttempts || closeResult) throw new CommandTerminationError();
            await waitBeforeTerminationRetry();
          }
        }
      };
      const stop = () => {
        if (stopPromise || settled) return;
        stopping = true;
        stopPromise = (async () => {
          let gracefulConfirmed = true;
          try {
            await deadline(terminateWithRetries(false), terminationGraceMs);
          } catch {
            gracefulConfirmed = false;
          }

          if (!gracefulConfirmed) {
            if (closeResult) throw new CommandTerminationError();
          } else if (await waitForClose(terminationGraceMs)) {
            finish(null, closeResult?.signal ?? null);
            return;
          }

          await deadline(terminateWithRetries(true), terminationForceMs);
          if (!await waitForClose(terminationForceMs)) throw new CommandTerminationError();
          finish(null, closeResult?.signal ?? null);
        })().catch(failTermination);
      };
      const onAbort = () => {
        aborted = true;
        stop();
      };
      const capture = (target: Buffer[], chunk: Buffer | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = maxOutputBytes - outputBytes;
        if (remaining > 0) {
          const captured = buffer.subarray(0, remaining);
          target.push(captured);
          outputBytes += captured.length;
        }
        if (buffer.length > remaining) {
          outputLimitExceeded = true;
          stop();
        }
      };

      child.stdout?.on("data", (chunk) => capture(stdout, chunk));
      child.stderr?.on("data", (chunk) => capture(stderr, chunk));
      child.once("close", (code, signal) => {
        closeResult = { code, signal };
        resolveClose();
        if (!stopping) finish(code, signal);
      });
      child.once("error", (error) => {
        spawnError = error;
        if (!child.pid && !stopping) finish(null, null);
      });

      timeout = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      if (options.stdin !== undefined && !settled) child.stdin?.end(options.stdin, "utf8");
    });
  };
}

export const runCommand = createCommandRunner();

/** Starts a detached allowlisted executable under the same policy as runCommand. */
export function launchDetachedCommand(options: DetachedCommandOptions): { pid: number | undefined } {
  const env = validate(options);
  const child = spawn(options.executable, [...options.args], {
    detached: true,
    env,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {});
  child.unref();
  return { pid: child.pid };
}
