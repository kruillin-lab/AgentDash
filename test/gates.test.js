'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { _internals } = require('../lib/gates');

function sampleRun(overrides = {}) {
  return {
    run_id: 'run-new',
    task: 'test',
    level: 'normal',
    mode: 'global',
    started: '2026-06-12T12:00:00Z',
    finished: '2026-06-12T12:01:00Z',
    result: 'PASS_WITH_WARNINGS',
    report_path: 'C:\\reports\\latest.md',
    project_groups: [
      {
        key: 'GLOBAL ROOT',
        label: 'GLOBAL ROOT',
        project_path: 'C:\\Projects',
        changed_file_count: 1,
        gate_critical_count: 1,
        test_critical_count: 0,
        has_quality_gate_config: true,
        per_project_gate_result: 'NOT_RUN',
      },
      {
        key: 'PROJECT: AgentDash',
        label: 'PROJECT: AgentDash',
        project_path: 'C:\\Projects\\AgentDash',
        changed_file_count: 4,
        gate_critical_count: 2,
        test_critical_count: 1,
        has_quality_gate_config: true,
        per_project_gate_result: 'PASS_WITH_WARNINGS',
        per_project_report_path: 'C:\\reports\\agentdash.md',
      },
    ],
    warnings: [
      { project: 'AgentDash', registry_status: 'UNREGISTERED' },
      { project: 'AgentDash', registry_status: 'REGISTERED_RESOLVED' },
    ],
    ...overrides,
  };
}

test('rollupProjects normalizes PROJECT labels for warning joins', () => {
  const payload = _internals.rollupProjects(sampleRun(), 'C:\\runs\\run-new.json');

  assert.equal(payload.error, null);
  assert.equal(payload.projects.length, 2);
  assert.equal(payload.projects[1].label, 'AgentDash');
  assert.equal(payload.projects[1].openWarnings, 1);
  assert.deepEqual(payload.run.counts, {
    projects: 2,
    pass: 0,
    passWithWarnings: 1,
    fail: 0,
    missingConfig: 0,
    notRun: 1,
    openWarnings: 1,
  });
});

test('readProjectHealth selects the newest started run and contains failures', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdash-gates-'));
  await fs.writeFile(
    path.join(dir, '20260612T120000Z-old.json'),
    JSON.stringify(sampleRun({ run_id: 'old', started: '2026-06-12T12:00:00Z' })),
  );
  await fs.writeFile(
    path.join(dir, '20260612T130000Z-new.json'),
    JSON.stringify(sampleRun({ run_id: 'new', started: '2026-06-12T13:00:00Z' })),
  );

  const payload = await _internals.readProjectHealth(dir);
  assert.equal(payload.run.runId, 'new');
  assert.equal(payload.error, null);

  const missing = await _internals.readProjectHealth(path.join(dir, 'missing'));
  assert.equal(missing.run, null);
  assert.equal(missing.error.code, 'ENOENT');
});
