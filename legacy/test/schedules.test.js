'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../lib/schedules');

const {
  POWERSHELL_SCRIPT,
  ROUTINES,
  mapTaskResult,
  mergeRoutines,
  normalizeDate,
  normalizeJsonOutput,
  readSchedules,
} = _internals;

test('normalizeDate handles ISO offsets and legacy Microsoft JSON dates', () => {
  assert.equal(
    normalizeDate('2026-06-12T08:30:00-04:00'),
    '2026-06-12T12:30:00.000Z',
  );
  assert.equal(
    normalizeDate('/Date(1781267400000)/'),
    '2026-06-12T12:30:00.000Z',
  );
  assert.equal(normalizeDate(null), null);
});

test('mapTaskResult distinguishes success, never-run, and error codes', () => {
  assert.deepEqual(mapTaskResult(0), {
    code: 0,
    ok: true,
    neverRun: false,
  });
  assert.deepEqual(mapTaskResult(267011), {
    code: 267011,
    ok: false,
    neverRun: true,
  });
  assert.deepEqual(mapTaskResult(5), {
    code: 5,
    ok: false,
    neverRun: false,
    hex: '0x5',
  });
  assert.equal(mapTaskResult(-1).hex, '0xFFFFFFFF');
});

test('normalizeJsonOutput wraps a single object and preserves arrays', () => {
  const row = {
    TaskName: 'GraphifyWeekly',
    TaskPath: '\\',
  };

  assert.deepEqual(normalizeJsonOutput(JSON.stringify(row)), [row]);
  assert.deepEqual(normalizeJsonOutput(JSON.stringify([row])), [row]);
  assert.deepEqual(normalizeJsonOutput('null'), []);
});

test('mergeRoutines preserves all pinned routines when a task is missing', () => {
  const records = [{
    TaskName: 'GraphifyWeekly',
    TaskPath: '\\',
    State: 'Ready',
    LastRunTime: '2026-06-09T03:00:00-04:00',
    NextRunTime: '/Date(1781593200000)/',
    LastTaskResult: 0,
  }];

  const routines = mergeRoutines(records);
  assert.equal(routines.length, 6);
  assert.deepEqual(
    ROUTINES.map(({ label, taskName, taskPath }) => ({ label, taskName, taskPath })),
    [
      { label: 'GraphifyWeekly', taskName: 'GraphifyWeekly', taskPath: '\\' },
      { label: 'CogneeDaily', taskName: 'CogneeDaily', taskPath: '\\' },
      { label: 'VaultAuditMonthly', taskName: 'VaultAuditMonthly', taskPath: '\\' },
      { label: 'ArchiveWeekly', taskName: 'ArchiveWeekly', taskPath: '\\' },
      { label: 'ArchiveQuarterly', taskName: 'ArchiveQuarterly', taskPath: '\\' },
      { label: 'ArchiveAnnual', taskName: 'ArchiveAnnual', taskPath: '\\' },
    ],
  );

  assert.equal(routines[0].found, true);
  assert.equal(routines[0].lastRunTime, '2026-06-09T07:00:00.000Z');
  assert.equal(routines[1].found, false);
  assert.equal(routines[1].lastResult, null);
});

test('readSchedules uses one read-only PowerShell call with a 15-second timeout', async () => {
  const calls = [];
  const fakeExecFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    callback(null, '[]', '');
  };

  const result = await readSchedules(fakeExecFile, () => 100);

  assert.equal(result.error, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'powershell.exe');
  assert.equal(calls[0].options.timeout, 15_000);
  assert.match(POWERSHELL_SCRIPT, /\bGet-ScheduledTask\b/);
  assert.match(POWERSHELL_SCRIPT, /\bGet-ScheduledTaskInfo\b/);
  assert.doesNotMatch(
    POWERSHELL_SCRIPT,
    /\b(?:Register|Set|Unregister|Start|Stop|Disable|Enable)-ScheduledTask\b/,
  );

  for (const routine of ROUTINES) {
    assert.match(POWERSHELL_SCRIPT, new RegExp(routine.taskName));
  }
});

test('readSchedules contains shell and parse failures in structured payloads', async (t) => {
  await t.test('shell failure', async () => {
    const fakeExecFile = (_file, _args, _options, callback) => {
      callback(new Error('scheduler unavailable'), '', '');
    };

    const result = await readSchedules(fakeExecFile, () => 100);
    assert.deepEqual(result.routines, []);
    assert.deepEqual(result.error, {
      code: 'SCHEDULE_QUERY_FAILED',
      message: 'scheduler unavailable',
    });
  });

  await t.test('parse failure', async () => {
    const fakeExecFile = (_file, _args, _options, callback) => {
      callback(null, '{not json', '');
    };

    const result = await readSchedules(fakeExecFile, () => 100);
    assert.deepEqual(result.routines, []);
    assert.equal(result.error.code, 'SCHEDULE_PARSE_FAILED');
    assert.match(result.error.message, /JSON/);
  });
});
