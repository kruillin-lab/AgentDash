'use strict';

const { execFile } = require('child_process');
const { ttl } = require('./cache');

const ROUTINES = Object.freeze([
  { label: 'GraphifyWeekly', taskName: 'GraphifyWeekly', taskPath: '\\' },
  { label: 'CogneeDaily', taskName: 'CogneeDaily', taskPath: '\\' },
  { label: 'VaultAuditMonthly', taskName: 'VaultAuditMonthly', taskPath: '\\' },
  { label: 'ArchiveWeekly', taskName: 'ArchiveWeekly', taskPath: '\\' },
  { label: 'ArchiveQuarterly', taskName: 'ArchiveQuarterly', taskPath: '\\' },
  { label: 'ArchiveAnnual', taskName: 'ArchiveAnnual', taskPath: '\\' },
]);

function powerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const targetRows = ROUTINES
  .map(({ taskName, taskPath }) => (
    `  [pscustomobject]@{ TaskName = ${powerShellLiteral(taskName)}; TaskPath = ${powerShellLiteral(taskPath)} }`
  ))
  .join('\n');

const POWERSHELL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$targets = @(',
  targetRows,
  ')',
  '$rows = foreach ($target in $targets) {',
  '  $task = Get-ScheduledTask -TaskName $target.TaskName -TaskPath $target.TaskPath -ErrorAction SilentlyContinue',
  '  if ($null -eq $task) { continue }',
  '  $info = Get-ScheduledTaskInfo -InputObject $task -ErrorAction Stop',
  '  [pscustomobject]@{',
  '    TaskName = $task.TaskName',
  '    TaskPath = $task.TaskPath',
  '    State = [string]$task.State',
  '    LastRunTime = $info.LastRunTime',
  '    NextRunTime = $info.NextRunTime',
  '    LastTaskResult = $info.LastTaskResult',
  '  }',
  '}',
  '$rows | ConvertTo-Json -Depth 3 -Compress',
].join('\n');

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const text = String(value).trim();
  const legacy = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(text);
  const timestamp = legacy ? Number(legacy[1]) : Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;

  return new Date(timestamp).toISOString();
}

function resultHex(code) {
  return `0x${(code >>> 0).toString(16).toUpperCase()}`;
}

function mapTaskResult(value) {
  const code = Number(value);
  if (!Number.isFinite(code)) {
    return { code: null, ok: false, neverRun: false, hex: null };
  }

  if (code === 0) {
    return { code, ok: true, neverRun: false };
  }

  if (code === 267011) {
    return { code, ok: false, neverRun: true };
  }

  return {
    code,
    ok: false,
    neverRun: false,
    hex: resultHex(code),
  };
}

function normalizeJsonOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return [];

  const parsed = JSON.parse(text);
  if (parsed === null) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function routineKey(taskName, taskPath) {
  return `${String(taskPath || '').toLowerCase()}\0${String(taskName || '').toLowerCase()}`;
}

function mergeRoutines(records, routines = ROUTINES) {
  const recordsByTask = new Map(
    records.map((record) => [
      routineKey(record.TaskName, record.TaskPath),
      record,
    ]),
  );

  return routines.map((routine) => {
    const record = recordsByTask.get(routineKey(routine.taskName, routine.taskPath));
    if (!record) {
      return {
        ...routine,
        found: false,
        state: null,
        lastRunTime: null,
        nextRunTime: null,
        lastResult: null,
      };
    }

    return {
      ...routine,
      found: true,
      state: record.State === null || record.State === undefined
        ? null
        : String(record.State),
      lastRunTime: normalizeDate(record.LastRunTime),
      nextRunTime: normalizeDate(record.NextRunTime),
      lastResult: mapTaskResult(record.LastTaskResult),
    };
  });
}

function executeScheduleQuery(execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    execFileImpl(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SCRIPT],
      {
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }

        const message = String(stderr || error.message || '').trim();
        reject(new Error(message || 'PowerShell schedule query failed'));
      },
    );
  });
}

function errorPayload(code, error) {
  return {
    code,
    message: error && error.message ? error.message : String(error),
  };
}

async function readSchedules(execFileImpl = execFile, now = Date.now) {
  const startedAt = now();
  let stdout;

  try {
    stdout = await executeScheduleQuery(execFileImpl);
  } catch (error) {
    return {
      routines: [],
      tookMs: Math.max(0, now() - startedAt),
      error: errorPayload('SCHEDULE_QUERY_FAILED', error),
    };
  }

  try {
    const records = normalizeJsonOutput(stdout);
    return {
      routines: mergeRoutines(records),
      tookMs: Math.max(0, now() - startedAt),
      error: null,
    };
  } catch (error) {
    return {
      routines: [],
      tookMs: Math.max(0, now() - startedAt),
      error: errorPayload('SCHEDULE_PARSE_FAILED', error),
    };
  }
}

const getSchedules = ttl(() => readSchedules(), 60_000);

module.exports = {
  getSchedules,
  _internals: {
    POWERSHELL_SCRIPT,
    ROUTINES,
    executeScheduleQuery,
    mapTaskResult,
    mergeRoutines,
    normalizeDate,
    normalizeJsonOutput,
    readSchedules,
    resultHex,
  },
};
