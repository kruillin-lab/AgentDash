'use strict';

const fs = require('fs/promises');
const path = require('path');
const { ttl } = require('./cache');

const RUNS_DIR = 'C:\\Users\\kruil\\Documents\\Projects\\CodexBrain\\quality-gates\\runs';
const OPEN_WARNING_STATUSES = new Set(['UNREGISTERED', 'REGISTERED_OPEN']);
const RUN_CANDIDATE_LIMIT = 10;

function errorPayload(code, message) {
  return { code, message };
}

function normalizeProjectName(value) {
  return String(value || '')
    .replace(/^PROJECT:\s*/i, '')
    .trim()
    .toLowerCase();
}

async function findNewestRunFile(runsDir = RUNS_DIR) {
  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, RUN_CANDIDATE_LIMIT);

  if (names.length === 0) {
    const err = new Error(`No quality-gate run JSON files found in ${runsDir}`);
    err.code = 'NO_GATE_RUNS';
    throw err;
  }

  const candidates = [];
  for (const name of names) {
    const fullPath = path.join(runsDir, name);
    try {
      const [raw, stat] = await Promise.all([
        fs.readFile(fullPath, 'utf8'),
        fs.stat(fullPath),
      ]);
      const parsed = JSON.parse(raw);
      candidates.push({
        fullPath,
        startedMs: Date.parse(parsed.started || '') || 0,
        mtimeMs: stat.mtimeMs,
      });
    } catch (_) {
      // A damaged candidate should not hide a valid neighboring run.
    }
  }

  if (candidates.length === 0) {
    const err = new Error(`Recent quality-gate run files in ${runsDir} could not be parsed`);
    err.code = 'INVALID_GATE_RUNS';
    throw err;
  }

  candidates.sort((a, b) => b.startedMs - a.startedMs || b.mtimeMs - a.mtimeMs);
  return candidates[0].fullPath;
}

async function parseRun(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function rollupProjects(run, sourceFile) {
  const groups = Array.isArray(run.project_groups) ? run.project_groups : [];
  const warnings = Array.isArray(run.warnings) ? run.warnings : [];
  const openWarningsByProject = new Map();

  for (const warning of warnings) {
    if (!OPEN_WARNING_STATUSES.has(String(warning.registry_status || '').toUpperCase())) {
      continue;
    }
    const key = normalizeProjectName(warning.project);
    openWarningsByProject.set(key, (openWarningsByProject.get(key) || 0) + 1);
  }

  const projects = groups.map((group) => {
    const result = String(group.per_project_gate_result || 'NOT_RUN').toUpperCase();
    const matchKey = normalizeProjectName(group.label || group.key);
    return {
      key: group.key || group.label || '',
      label: String(group.label || group.key || '').replace(/^PROJECT:\s*/i, ''),
      projectPath: group.project_path || '',
      result,
      changedFiles: Number(group.changed_file_count || 0),
      gateCritical: Number(group.gate_critical_count || 0),
      testCritical: Number(group.test_critical_count || 0),
      openWarnings: openWarningsByProject.get(matchKey) || 0,
      hasConfig: Boolean(group.has_quality_gate_config),
      reportPath: group.per_project_report_path || '',
      notes: group.per_project_gate_notes || '',
    };
  });

  const counts = {
    projects: projects.length,
    pass: projects.filter((project) => project.result === 'PASS').length,
    passWithWarnings: projects.filter((project) => project.result === 'PASS_WITH_WARNINGS').length,
    fail: projects.filter((project) => ['FAIL', 'EXCEPTION'].includes(project.result)).length,
    missingConfig: projects.filter((project) => project.result === 'MISSING_CONFIG').length,
    notRun: projects.filter((project) => ['NOT_RUN', 'INCOMPLETE'].includes(project.result)).length,
    openWarnings: projects.reduce((total, project) => total + project.openWarnings, 0),
  };

  return {
    run: {
      runId: run.run_id || '',
      task: run.task || '',
      level: run.level || '',
      mode: run.mode || '',
      started: run.started || null,
      finished: run.finished || null,
      result: String(run.result || 'INCOMPLETE').toUpperCase(),
      counts,
      reportPath: run.report_path || '',
      sourceFile,
    },
    projects,
    error: null,
  };
}

async function readProjectHealth(runsDir = RUNS_DIR) {
  try {
    const sourceFile = await findNewestRunFile(runsDir);
    const run = await parseRun(sourceFile);
    return rollupProjects(run, sourceFile);
  } catch (err) {
    return {
      run: null,
      projects: [],
      error: errorPayload(err.code || 'GATE_READ_FAILED', err.message),
    };
  }
}

const getProjectHealth = ttl(() => readProjectHealth(RUNS_DIR), 30_000);

module.exports = {
  RUNS_DIR,
  getProjectHealth,
  _internals: {
    findNewestRunFile,
    normalizeProjectName,
    parseRun,
    readProjectHealth,
    rollupProjects,
  },
};
