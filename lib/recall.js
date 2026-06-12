'use strict';

const { execFile } = require('child_process');

// Observed FTS block:
// 1. Quality Gates Dashboard
//    Path:   CodexBrain/quality-gates/index.md
//    Meta:   project=projects type=index status=active
//    Rank:   -9.742126
//    Snip:   ...actionstacksex, [agentdash], emotify...

const RECALL_ENTRY = 'C:\\Users\\kruil\\Documents\\Projects\\recall.ps1';
const RECALL_TIMEOUT_MS = 20_000;
const RECALL_MAX_BUFFER = 4 * 1024 * 1024;
const MAX_QUERY_LENGTH = 200;
const COGNEE_ENABLED = process.env.AGENTOS_COGNEE === '1';

function errorPayload(code, message) {
  return { code, message };
}

function validateQuery(query) {
  if (typeof query !== 'string') {
    return {
      query: '',
      error: errorPayload('INVALID_QUERY', 'Recall query must be a string'),
    };
  }

  const normalized = query.trim();
  if (!normalized) {
    return {
      query: normalized,
      error: errorPayload('INVALID_QUERY', 'Recall query must not be empty'),
    };
  }
  if (normalized.length > MAX_QUERY_LENGTH) {
    return {
      query: normalized,
      error: errorPayload(
        'QUERY_TOO_LONG',
        `Recall query must be ${MAX_QUERY_LENGTH} characters or fewer`,
      ),
    };
  }

  return { query: normalized, error: null };
}

function stripAnsi(value) {
  return String(value || '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '');
}

function parseResults(stdout) {
  const results = [];
  let current = null;
  let collectingSnippet = false;

  function finishCurrent() {
    if (!current || !current.path) return;
    results.push({
      path: current.path,
      snippet: current.snippet.trim(),
      rank: current.rank,
      title: current.title,
      meta: current.meta,
    });
  }

  for (const rawLine of stripAnsi(stdout).split(/\r?\n/)) {
    const titleMatch = rawLine.match(/^\s*(\d+)\.\s+(.+?)\s*$/);
    if (titleMatch) {
      finishCurrent();
      current = {
        title: titleMatch[2],
        path: '',
        meta: '',
        rank: null,
        snippet: '',
      };
      collectingSnippet = false;
      continue;
    }

    if (!current) continue;

    const fieldMatch = rawLine.match(/^\s+(Path|Meta|Rank|Snip):\s*(.*?)\s*$/);
    if (fieldMatch) {
      const [, field, value] = fieldMatch;
      collectingSnippet = field === 'Snip';

      if (field === 'Path') current.path = value;
      if (field === 'Meta') current.meta = value;
      if (field === 'Rank') {
        const rank = Number(value);
        current.rank = Number.isFinite(rank) ? rank : null;
      }
      if (field === 'Snip') current.snippet = value;
      continue;
    }

    if (collectingSnippet) {
      const continuation = rawLine.trim();
      if (!continuation || /^=+$/.test(continuation) || /^Open source Markdown\b/.test(continuation)) {
        collectingSnippet = false;
      } else {
        current.snippet += ` ${continuation}`;
      }
    }
  }

  finishCurrent();
  return results;
}

function buildInvocation(query) {
  return {
    file: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      RECALL_ENTRY,
      query,
    ],
    options: {
      encoding: 'utf8',
      maxBuffer: RECALL_MAX_BUFFER,
      timeout: RECALL_TIMEOUT_MS,
      windowsHide: true,
    },
  };
}

function executeRecall(query, executor) {
  const invocation = buildInvocation(query);
  return new Promise((resolve, reject) => {
    executor(
      invocation.file,
      invocation.args,
      invocation.options,
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function executionError(err) {
  if (err && (err.killed || err.code === 'ETIMEDOUT')) {
    return errorPayload('RECALL_TIMEOUT', 'Recall search timed out after 20 seconds');
  }
  if (err && (
    err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    || /maxBuffer/i.test(String(err.message || ''))
  )) {
    return errorPayload('RECALL_OUTPUT_TOO_LARGE', 'Recall output exceeded the 4 MB limit');
  }
  return errorPayload('RECALL_FAILED', err && err.message ? err.message : 'Recall search failed');
}

function resultPayload(query, results, tookMs, error = null) {
  return {
    query,
    engine: 'fts5',
    results,
    tookMs,
    error,
  };
}

async function searchWithExecutor(query, executor = execFile, now = Date.now) {
  const startedAt = now();
  const validation = validateQuery(query);
  if (validation.error) {
    return resultPayload(
      validation.query,
      [],
      Math.max(0, now() - startedAt),
      validation.error,
    );
  }

  try {
    const stdout = await executeRecall(validation.query, executor);
    return resultPayload(
      validation.query,
      parseResults(stdout),
      Math.max(0, now() - startedAt),
    );
  } catch (err) {
    return resultPayload(
      validation.query,
      [],
      Math.max(0, now() - startedAt),
      executionError(err),
    );
  }
}

async function search(query) {
  return searchWithExecutor(query, execFile);
}

module.exports = {
  search,
  _internals: {
    COGNEE_ENABLED,
    MAX_QUERY_LENGTH,
    RECALL_ENTRY,
    RECALL_MAX_BUFFER,
    RECALL_TIMEOUT_MS,
    buildInvocation,
    executeRecall,
    executionError,
    parseResults,
    searchWithExecutor,
    validateQuery,
  },
};
