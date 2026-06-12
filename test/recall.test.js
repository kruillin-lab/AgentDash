'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../lib/recall');

const SAMPLE_OUTPUT = `
======================================================================
 LOCAL RECALL: SQLite FTS
======================================================================
Query: AgentDash
DB:    C:\\Users\\kruil\\Documents\\Projects\\CodexBrain\\state\\local-recall.sqlite
Docs:  856
Mode:  AND

1. Quality Gates Dashboard
   Path:   CodexBrain/quality-gates/index.md
   Meta:   project=projects type=index status=active
   Rank:   -9.742126
   Snip:   ...actionstacksex, [agentdash], emotify...

2. AgentOS Plan
   Path:   AgentDash/docs/plan.md
   Meta:   project=agentdash type=plan status=active
   Rank:   -7.25
   Snip:   First line of the snippet
           continued on the next line.

Open source Markdown before acting on recall hits.
======================================================================
`;

test('search validation trims queries and rejects empty or oversized input before execution', async () => {
  let calls = 0;
  const executor = () => {
    calls += 1;
  };

  const empty = await _internals.searchWithExecutor('   ', executor);
  assert.equal(empty.error.code, 'INVALID_QUERY');
  assert.deepEqual(empty.results, []);

  const oversized = await _internals.searchWithExecutor('x'.repeat(201), executor);
  assert.equal(oversized.error.code, 'QUERY_TOO_LONG');
  assert.equal(calls, 0);
});

test('parseResults reads observed formatted FTS blocks in ranked order', () => {
  assert.deepEqual(_internals.parseResults(SAMPLE_OUTPUT), [
    {
      path: 'CodexBrain/quality-gates/index.md',
      snippet: '...actionstacksex, [agentdash], emotify...',
      rank: -9.742126,
      title: 'Quality Gates Dashboard',
      meta: 'project=projects type=index status=active',
    },
    {
      path: 'AgentDash/docs/plan.md',
      snippet: 'First line of the snippet continued on the next line.',
      rank: -7.25,
      title: 'AgentOS Plan',
      meta: 'project=agentdash type=plan status=active',
    },
  ]);
});

test('search passes the trimmed query as one execFile argv value', async () => {
  const dangerousQuery = '  alpha"; Write-Output HACK; #  ';
  let invocation;
  const executor = (file, args, options, callback) => {
    invocation = { file, args, options };
    callback(null, SAMPLE_OUTPUT, '');
  };

  const payload = await _internals.searchWithExecutor(dangerousQuery, executor);

  assert.equal(payload.error, null);
  assert.equal(payload.query, 'alpha"; Write-Output HACK; #');
  assert.equal(invocation.file, 'powershell.exe');
  assert.equal(invocation.args.at(-1), payload.query);
  assert.equal(invocation.args.at(-2), _internals.RECALL_ENTRY);
  assert.equal(invocation.options.timeout, 20_000);
  assert.equal(invocation.options.maxBuffer, 4 * 1024 * 1024);
  assert.equal(Object.hasOwn(invocation.options, 'shell'), false);
  assert.equal(invocation.args.includes('-Cognee'), false);
  assert.equal(invocation.args.includes('-CogneeOnly'), false);
});

test('search returns structured execution errors instead of rejecting', async () => {
  const executor = (_file, _args, _options, callback) => {
    const err = new Error('process failed');
    err.code = 1;
    callback(err, '', 'failure');
  };

  const payload = await _internals.searchWithExecutor('AgentDash', executor);
  assert.equal(payload.query, 'AgentDash');
  assert.equal(payload.engine, 'fts5');
  assert.deepEqual(payload.results, []);
  assert.deepEqual(payload.error, {
    code: 'RECALL_FAILED',
    message: 'process failed',
  });
});
