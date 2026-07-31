'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sessions = require('../lib/sessions');

const {
  buildCommand,
  captureNativeSessionId,
  captureTrustedNativeSessionId,
  chooseResume,
  commandForCandidate,
  conversationKey,
  exitState,
  getAgent,
  isValidNativeSessionId,
  isValidDeliveryId,
  normalizeSession,
  normalizeInputDeliveries,
  prepareInputDelivery,
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
    null,
  );
  assert.equal(
    captureNativeSessionId('hermes', 'Session: 20260612_154952_3e9064'),
    '20260612_154952_3e9064',
  );
  assert.equal(
    captureNativeSessionId('claude', `Session ID: ${claudeId}\nSession ID: 223e4567-e89b-42d3-a456-426614174000`),
    null,
  );
  assert.equal(isValidNativeSessionId('claude', 'not-an-id'), false);
  assert.equal(isValidNativeSessionId('hermes', 'short'), false);
  assert.equal(captureTrustedNativeSessionId('claude', `Session ID: ${claudeId}`, false), null);
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
      inputDeliveries: [],
      conversationId: null,
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

test('resume rejects an active descendant anywhere in the resume chain', () => {
  const source = normalizeSession({
    id: 10,
    agentKey: 'claude',
    cwd: 'C:\\Projects\\AgentDash',
    status: 'exited',
    startedAt: '2026-06-12T10:00:00.000Z',
    nativeSessionId: '123e4567-e89b-42d3-a456-426614174000',
  });
  const child = normalizeSession({
    ...source,
    id: 11,
    resumedFrom: 10,
    status: 'exited',
  });
  const grandchild = normalizeSession({
    ...source,
    id: 12,
    resumedFrom: 11,
    status: 'running',
  });
  assert.equal(chooseResume(source, [source, child, grandchild]).error.code, 'RESUME_ALREADY_ACTIVE');
});

test('resume rejects another active record with the same native conversation ID', () => {
  const nativeSessionId = '123e4567-e89b-42d3-a456-426614174000';
  const source = normalizeSession({
    id: 20,
    agentKey: 'claude',
    cwd: 'C:\\Projects\\AgentDash',
    status: 'exited',
    startedAt: '2026-06-12T10:00:00.000Z',
    nativeSessionId,
  });
  const active = normalizeSession({
    ...source,
    id: 21,
    status: 'running',
  });
  assert.equal(chooseResume(source, [source, active]).error.code, 'RESUME_ALREADY_ACTIVE');
});

test('resume rejects an active sibling sharing the same root conversation', () => {
  const root = normalizeSession({
    id: 30,
    agentKey: 'claude',
    cwd: 'C:\\Projects\\AgentDash',
    status: 'exited',
    startedAt: '2026-06-12T10:00:00.000Z',
  });
  const source = normalizeSession({ ...root, id: 31, resumedFrom: 30, status: 'exited' });
  const sibling = normalizeSession({ ...root, id: 32, resumedFrom: 30, status: 'running' });
  assert.equal(chooseResume(source, [root, source, sibling]).error.code, 'RESUME_ALREADY_ACTIVE');
});

test('conversation keys are stable across ancestry and cycles', () => {
  const root = { id: 40, resumedFrom: null, conversationId: null };
  const child = { id: 41, resumedFrom: 40, conversationId: null };
  const map = new Map([[40, root], [41, child]]);
  assert.equal(conversationKey(child, map), 'root:40');
  const cycleA = { id: 50, resumedFrom: 51, conversationId: null };
  const cycleB = { id: 51, resumedFrom: 50, conversationId: null };
  const cycleMap = new Map([[50, cycleA], [51, cycleB]]);
  assert.equal(conversationKey(cycleA, cycleMap), 'cycle:50,51');
});

test('delivery IDs are validated, normalized, bounded, and deduplicated', () => {
  assert.equal(isValidDeliveryId('prompt_12345678'), true);
  assert.equal(isValidDeliveryId('short'), false);
  const ids = Array.from({ length: 105 }, (_, index) => `delivery_${String(index).padStart(3, '0')}`);
  const normalized = normalizeInputDeliveries([
    'bad',
    'delivery_010',
    ...ids,
    'delivery_104',
  ]);
  assert.equal(normalized.length, 100);
  assert.equal(normalized[0].id, 'delivery_004');
  assert.equal(normalized.at(-1).id, 'delivery_104');

  const first = prepareInputDelivery([], 'prompt_12345678', 'hello');
  assert.equal(first.duplicate, false);
  assert.equal(first.next[0].id, 'prompt_12345678');
  assert.equal(first.next[0].status, 'reserved');
  const retry = prepareInputDelivery(first.next, 'prompt_12345678', 'hello');
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.next, first.next);
  assert.equal(
    prepareInputDelivery(first.next, 'prompt_12345678', 'different').error.code,
    'DELIVERY_PAYLOAD_MISMATCH',
  );
  assert.equal(prepareInputDelivery([], 'short', 'hello').error.code, 'INVALID_DELIVERY_ID');
});
