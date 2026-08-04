import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_ARGUMENTS = 128;
const MAX_ARGUMENT_BYTES = 64 * 1024;
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

/** Runs one allowlisted executable directly. No shell or inherited environment is available. */
export async function runCommand(options: CommandOptions): Promise<CommandResult> {
  const env = validate(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0 || (options.cwd !== undefined && !isAbsolute(options.cwd))) {
    throw new CommandPolicyError("invalid_arguments", "Command timeout and output cap must be positive safe integers.");
  }

  return new Promise((resolveResult) => {
    const child = spawn(options.executable, [...options.args], {
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
    let timedOut = false;
    let aborted = false;
    let outputLimitExceeded = false;

    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
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

    const stop = () => {
      try { child.kill(); } catch {}
      finish(null, null);
    };
    const onAbort = () => {
      aborted = true;
      stop();
    };
    const capture = (target: Buffer[], chunk: Buffer | string) => {
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
    child.on("close", (code, signal) => finish(code, signal));
    child.on("error", (error) => finish(null, null, error));

    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    if (options.stdin !== undefined && !settled) child.stdin?.end(options.stdin, "utf8");
  });
}

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
