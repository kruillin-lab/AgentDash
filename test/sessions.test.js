'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sessions = require('../lib/sessions');

const {
  buildCommand,
  captureNativeSessionId,
  chooseResume,
  commandForCandidate,
  exitState,
  getAgent,
  isValidNativeSessionId,
  normalizeSession,
} = sessions._internals;

test('agent registry exposes five resumable agents and launch-only Codex ACP', () => {
  const agents = sessions.getAgents();
  assert.equal(agents.claude.resumable, true);
  assert.equal(agents.hermes.resumable, true);
  assert.equal(agents.opencode.resumable, true);
  assert.equal(agents.kimi.resumable, true);
  assert.equal(agents.agy.resumable, true);
  assert.equal(agents.codex.resumable, false);
  assert.equal('candidates' in agents.claude, false);
  assert.equal(getAgent('__proto__'), null);
  assert.equal(getAgent('constructor'), null);
});

test('resume commands use verified agent flags', () => {
  assert.deepEqual(buildCommand('claude', { resumeMode: 'latest' }).args, ['--continue']);
  assert.deepEqual(
    buildCommand('claude', {
      resumeMode: 'byId',
      nativeSessionId: '123e4567-e89b-42d3-a456-426614174000',
    }).args,
    ['--resume', '123e4567-e89b-42d3-a456-426614174000'],
  );
  assert.deepEqual(buildCommand('hermes', { resumeMode: 'latest' }).args, ['chat', '--cli', '--continue']);
  assert.deepEqual(
    buildCommand('opencode', { resumeMode: 'byId', nativeSessionId: 'ses_12345678' }).args,
    ['--session', 'ses_12345678'],
  );
  assert.deepEqual(buildCommand('kimi', { resumeMode: 'latest' }).args, ['--continue']);
  assert.deepEqual(
    buildCommand('agy', { resumeMode: 'byId', nativeSessionId: 'conversation_1234' }).args,
    ['--conversation', 'conversation_1234'],
  );
  assert.throws(
    () => buildCommand('codex', { resumeMode: 'latest' }),
    { code: 'NOT_RESUMABLE' },
  );
});

test('shell-backed commands use a transient fixed cmd wrapper', () => {
  const result = commandForCandidate(
    { file: 'C:\\Fixed Tools\\agent.cmd', args: ['--cli'], shell: true },
    ['--continue'],
  );
  assert.match(result.file.toLowerCase(), /cmd\.exe$/);
  assert.deepEqual(result.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(result.args[3], '"C:\\Fixed Tools\\agent.cmd" --cli --continue');
});

test('native IDs are context-captured and validated per agent', () => {
  const claudeId = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal(captureNativeSessionId('claude', `Session ID: ${claudeId}`), claudeId);
  assert.equal(captureNativeSessionId('claude', `unrelated ${claudeId}`), null);
  assert.equal(captureNativeSessionId('opencode', 'session id: ses_12345678'), 'ses_12345678');
  assert.equal(
    captureNativeSessionId('hermes', 'Session: 20260612_154952_3e9064data-science'),
    '20260612_154952_3e9064',
  );
  assert.equal(isValidNativeSessionId('claude', 'not-an-id'), false);
  assert.equal(isValidNativeSessionId('hermes', 'short'), false);
});

test('legacy records gain additive lifecycle fields', () => {
  assert.deepEqual(
    normalizeSession({
      id: 1,
      agentKey: 'claude',
      status: 'exited',
      cwd: 'C:\\Projects',
      startedAt: '2026-06-12T10:00:00.000Z',
    }),
    {
      id: 1,
      agentKey: 'claude',
      status: 'exited',
      cwd: 'C:\\Projects',
      startedAt: '2026-06-12T10:00:00.000Z',
      endedAt: null,
      nativeSessionId: null,
      resumable: true,
      resumedFrom: null,
      resumeMode: null,
      exitCode: null,
      exitReason: null,
    },
  );
});

test('malformed stored native IDs are discarded during normalization', () => {
  const normalized = normalizeSession({
    id: 2,
    agentKey: 'hermes',
    status: 'exited',
    cwd: 'C:\\Projects',
    startedAt: '2026-06-12T10:00:00.000Z',
    nativeSessionId: '20260612_154952_3e9064data-science',
  });
  assert.equal(normalized.nativeSessionId, null);
});

test('exit states distinguish normal exit, failure, and user kill', () => {
  assert.deepEqual(exitState(0, false), { status: 'exited', exitReason: 'process_exit' });
  assert.deepEqual(exitState(7, false), { status: 'failed', exitReason: 'process_error' });
  assert.deepEqual(exitState(1, true), { status: 'killed', exitReason: 'user_kill' });
});

test('latest-mode resume rejects a newer same-agent same-CWD session', () => {
  const source = normalizeSession({
    id: 1,
    agentKey: 'claude',
    agentLabel: 'Claude Code',
    cwd: 'C:\\Projects\\AgentDash',
    status: 'exited',
    startedAt: '2026-06-12T10:00:00.000Z',
  });
  const newer = normalizeSession({
    id: 2,
    agentKey: 'claude',
    cwd: 'c:\\projects\\agentdash',
    status: 'exited',
    startedAt: '2026-06-12T11:00:00.000Z',
  });
  assert.equal(chooseResume(source, [source, newer]).error.code, 'AMBIGUOUS_LATEST');
});

test('valid native ID selects deterministic by-ID resume', () => {
  const source = normalizeSession({
    id: 3,
    agentKey: 'claude',
    cwd: 'C:\\Projects\\AgentDash',
    status: 'exited',
    startedAt: '2026-06-12T10:00:00.000Z',
    nativeSessionId: '123e4567-e89b-42d3-a456-426614174000',
  });
  assert.deepEqual(chooseResume(source, [source]), {
    mode: 'byId',
    nativeSessionId: '123e4567-e89b-42d3-a456-426614174000',
    error: null,
  });
});
