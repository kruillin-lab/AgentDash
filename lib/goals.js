'use strict';

const fs = require('fs/promises');
const path = require('path');
const yaml = require('js-yaml');
const { ttl } = require('./cache');

/*
GoalBuddy v2 shape observed in ParseLord5:
- goal: { title, slug, status, ... }
- active_task: task ID or null
- tasks: [{ id, type, assignee, status, objective, receipt, ... }]
- checks.last_verification: verification object or null
*/

const PROJECTS_ROOT = 'C:\\Users\\kruil\\Documents\\Projects';
const MAX_DEPTH = 6;
const CACHE_TTL_MS = 30_000;
const TASK_STATUSES = ['done', 'active', 'queued', 'blocked'];
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.worktrees',
  'imported',
  '_brain-2026-06-09',
  'dist',
  'build',
  '.venv',
  'venv',
]);

function pathParts(value) {
  return path.normalize(value).split(path.sep).filter(Boolean);
}

function isGoalStatePath(filePath) {
  const parts = pathParts(filePath);
  if (parts.length < 4) return false;

  const tail = parts.slice(-4).map((part) => part.toLowerCase());
  return (
    tail[0] === 'docs'
    && tail[1] === 'goals'
    && tail[2] !== ''
    && tail[3] === 'state.yaml'
  );
}

function isExcludedDirectory(root, directoryPath, name = path.basename(directoryPath)) {
  if (EXCLUDE_DIRS.has(String(name).toLowerCase())) return true;

  const relative = path.relative(root, directoryPath);
  const parts = pathParts(relative).map((part) => part.toLowerCase());
  return (
    parts.length >= 3
    && parts[0] === 'codexbrain'
    && parts[1] === 'raw'
    && parts[2] === 'imported'
  );
}

async function discoverGoalStatePaths(root = PROJECTS_ROOT, maxDepth = MAX_DEPTH) {
  const statePaths = [];

  async function walk(directory, depth) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (
          depth < maxDepth
          && !isExcludedDirectory(root, fullPath, entry.name)
        ) {
          await walk(fullPath, depth + 1);
        }
        continue;
      }

      if (entry.isFile() && isGoalStatePath(fullPath)) {
        statePaths.push(fullPath);
      }
    }
  }

  await walk(root, 0);
  return statePaths;
}

function goalLocation(statePath, projectsRoot) {
  const relative = path.relative(projectsRoot, statePath);
  const relativeParts = pathParts(relative);
  const project = relativeParts[0] || path.basename(projectsRoot);

  return {
    project,
    projectPath: path.join(projectsRoot, project),
    inferredSlug: path.basename(path.dirname(statePath)),
    statePath,
    goalDocPath: path.join(path.dirname(statePath), 'goal.md'),
  };
}

function normalizeTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return null;

  return {
    ...task,
    id: String(task.id || ''),
    type: String(task.type || ''),
    assignee: String(task.assignee || ''),
    status: String(task.status || '').toLowerCase(),
    objective: String(task.objective || ''),
  };
}

function countTasks(tasks) {
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]));

  for (const task of tasks) {
    if (Object.hasOwn(counts, task.status)) {
      counts[task.status] += 1;
    }
  }

  return counts;
}

function mapGoalState(state, location) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('GoalBuddy state must be a YAML mapping');
  }
  if (Number(state.version) !== 2) {
    throw new Error(`Unsupported GoalBuddy state version: ${state.version ?? 'missing'}`);
  }

  const goal = state.goal && typeof state.goal === 'object' ? state.goal : {};
  const tasks = Array.isArray(state.tasks)
    ? state.tasks.map(normalizeTask).filter(Boolean)
    : [];
  const activeTaskId = state.active_task == null ? null : String(state.active_task);
  const activeTask = activeTaskId == null
    ? null
    : tasks.find((task) => task.id === activeTaskId) || null;
  const lastVerification = (
    state.checks
    && typeof state.checks === 'object'
    && state.checks.last_verification
    && typeof state.checks.last_verification === 'object'
  )
    ? { ...state.checks.last_verification }
    : null;

  return {
    project: location.project,
    projectPath: location.projectPath,
    slug: String(goal.slug || location.inferredSlug),
    title: String(goal.title || goal.slug || location.inferredSlug),
    status: String(goal.status || ''),
    activeTask,
    taskCounts: countTasks(tasks),
    lastVerification,
    tasks,
    statePath: location.statePath,
    goalDocPath: location.goalDocPath,
    parseError: null,
  };
}

function failedGoal(location, err) {
  return {
    project: location.project,
    projectPath: location.projectPath,
    slug: location.inferredSlug,
    title: location.inferredSlug,
    status: '',
    activeTask: null,
    taskCounts: countTasks([]),
    lastVerification: null,
    tasks: [],
    statePath: location.statePath,
    goalDocPath: location.goalDocPath,
    parseError: err instanceof Error ? err.message : String(err),
  };
}

async function parseGoal(statePath, projectsRoot = PROJECTS_ROOT) {
  const location = goalLocation(statePath, projectsRoot);

  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const state = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
    return mapGoalState(state, location);
  } catch (err) {
    return failedGoal(location, err);
  }
}

async function listGoalsFromRoot(root = PROJECTS_ROOT, maxDepth = MAX_DEPTH) {
  const started = process.hrtime.bigint();
  let statePaths;

  try {
    statePaths = await discoverGoalStatePaths(root, maxDepth);
  } catch (err) {
    return {
      goals: [],
      scanned: {
        rootsWalked: 0,
        stateFilesFound: 0,
        tookMs: Number(process.hrtime.bigint() - started) / 1e6,
      },
      error: {
        code: err && err.code === 'ENOENT' ? 'NO_PROJECTS_ROOT' : 'GOAL_SCAN_FAILED',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const goals = await Promise.all(statePaths.map((statePath) => parseGoal(statePath, root)));

  goals.sort((a, b) => (
    a.project.localeCompare(b.project)
    || a.slug.localeCompare(b.slug)
    || a.statePath.localeCompare(b.statePath)
  ));

  return {
    goals,
    scanned: {
      rootsWalked: 1,
      stateFilesFound: statePaths.length,
      tookMs: Number(process.hrtime.bigint() - started) / 1e6,
    },
    error: null,
  };
}

const listGoals = ttl(() => listGoalsFromRoot(PROJECTS_ROOT), CACHE_TTL_MS);

module.exports = {
  PROJECTS_ROOT,
  listGoals,
  _internals: {
    EXCLUDE_DIRS,
    MAX_DEPTH,
    countTasks,
    discoverGoalStatePaths,
    isExcludedDirectory,
    isGoalStatePath,
    listGoalsFromRoot,
    mapGoalState,
    parseGoal,
  },
};
