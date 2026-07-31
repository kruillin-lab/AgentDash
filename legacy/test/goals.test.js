'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { listGoals, _internals } = require('../lib/goals');

async function makeTempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdash-goals-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function writeGoal(root, relativeDir, stateYaml) {
  const goalDir = path.join(root, relativeDir);
  await fs.mkdir(goalDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(goalDir, 'state.yaml'), stateYaml),
    fs.writeFile(path.join(goalDir, 'goal.md'), '# Test goal\n'),
  ]);
  return path.join(goalDir, 'state.yaml');
}

function validState(overrides = '') {
  return `
version: 2
goal:
  title: Test goal
  slug: test-goal
  status: active
active_task: T002
tasks:
  - id: T001
    type: scout
    status: done
    objective: Discover
  - id: T002
    type: worker
    status: active
    objective: Implement
  - id: T003
    type: worker
    status: queued
    objective: Follow up
  - id: T004
    type: judge
    status: blocked
    objective: Review
checks:
  last_verification:
    result: pass
    task: T001
${overrides}`;
}

test('discovery is depth-capped and skips every protected directory', async (t) => {
  const root = await makeTempRoot(t);
  const included = await writeGoal(
    root,
    path.join('ProjectA', 'docs', 'goals', 'included'),
    validState(),
  );

  for (const excluded of _internals.EXCLUDE_DIRS) {
    await writeGoal(
      root,
      path.join(excluded, 'docs', 'goals', `ignored-${excluded.replace(/\W/g, '')}`),
      validState(),
    );
  }

  await writeGoal(
    root,
    path.join('CodexBrain', 'raw', 'imported', 'Frozen', 'docs', 'goals', 'ignored-frozen'),
    validState(),
  );
  await writeGoal(
    root,
    path.join('Too', 'Deep', 'For', 'The', 'Default', 'Walk', 'docs', 'goals', 'ignored-depth'),
    validState(),
  );

  const found = await _internals.discoverGoalStatePaths(root);
  assert.deepEqual(found, [included]);
});

test('listGoalsFromRoot resolves active task and counts v2 statuses', async (t) => {
  const root = await makeTempRoot(t);
  const statePath = await writeGoal(
    root,
    path.join('ProjectA', 'docs', 'goals', 'test-goal'),
    validState(),
  );

  const payload = await _internals.listGoalsFromRoot(root);
  assert.equal(payload.error, null);
  assert.equal(payload.scanned.rootsWalked, 1);
  assert.equal(payload.scanned.stateFilesFound, 1);
  assert.ok(payload.scanned.tookMs >= 0);

  const [goal] = payload.goals;
  assert.equal(goal.project, 'ProjectA');
  assert.equal(goal.projectPath, path.join(root, 'ProjectA'));
  assert.equal(goal.slug, 'test-goal');
  assert.equal(goal.title, 'Test goal');
  assert.equal(goal.status, 'active');
  assert.equal(goal.statePath, statePath);
  assert.equal(goal.goalDocPath, path.join(path.dirname(statePath), 'goal.md'));
  assert.equal(goal.parseError, null);
  assert.deepEqual(goal.taskCounts, {
    done: 1,
    active: 1,
    queued: 1,
    blocked: 1,
  });
  assert.equal(goal.activeTask, goal.tasks[1]);
  assert.deepEqual(goal.activeTask, {
    id: 'T002',
    type: 'worker',
    assignee: '',
    status: 'active',
    objective: 'Implement',
  });
  assert.deepEqual(goal.lastVerification, {
    result: 'pass',
    task: 'T001',
  });
});

test('broken YAML becomes one parse-error goal without hiding valid goals', async (t) => {
  const root = await makeTempRoot(t);
  await writeGoal(
    root,
    path.join('GoodProject', 'docs', 'goals', 'good-goal'),
    validState(),
  );
  const brokenPath = await writeGoal(
    root,
    path.join('BrokenProject', 'docs', 'goals', 'broken-goal'),
    'version: 2\ngoal: [\n',
  );

  const payload = await _internals.listGoalsFromRoot(root);
  assert.equal(payload.goals.length, 2);
  assert.equal(payload.scanned.stateFilesFound, 2);

  const good = payload.goals.find((goal) => goal.project === 'GoodProject');
  const broken = payload.goals.find((goal) => goal.project === 'BrokenProject');

  assert.equal(good.parseError, null);
  assert.equal(broken.slug, 'broken-goal');
  assert.equal(broken.statePath, brokenPath);
  assert.equal(typeof broken.parseError, 'string');
  assert.ok(broken.parseError.length > 0);
  assert.deepEqual(broken.tasks, []);
});

test('whole-root traversal failures return a structured route payload', async (t) => {
  const root = await makeTempRoot(t);
  await fs.rm(root, { recursive: true, force: true });

  const payload = await _internals.listGoalsFromRoot(root);
  assert.deepEqual(payload.goals, []);
  assert.equal(payload.scanned.rootsWalked, 0);
  assert.equal(payload.scanned.stateFilesFound, 0);
  assert.equal(payload.error.code, 'NO_PROJECTS_ROOT');
});

test('public listGoals uses the shared TTL wrapper', () => {
  assert.equal(typeof listGoals, 'function');
  assert.equal(typeof listGoals.bust, 'function');
});
