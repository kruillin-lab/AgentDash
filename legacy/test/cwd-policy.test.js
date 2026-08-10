'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCwd, _internals } = require('../lib/cwd-policy');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdash-cwd-'));
  const root = path.join(base, 'Projects');
  const child = path.join(root, 'AgentDash');
  const outside = path.join(base, 'Outside');
  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  return { base, root, child, outside };
}

test('resolveCwd accepts existing local directories outside remote roots', () => {
  const { base, root, outside } = fixture();
  try {
    assert.equal(
      resolveCwd({
        cwd: outside,
        remote: false,
        env: { AGENTDASH_CWD_ROOTS: root },
      }),
      fs.realpathSync.native(outside),
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('resolveCwd requires absolute existing directories', () => {
  assert.throws(
    () => resolveCwd({ cwd: 'relative\\path', remote: false }),
    { code: 'CWD_NOT_ABSOLUTE' },
  );
  assert.throws(
    () => resolveCwd({ cwd: 'C:\\definitely-missing-agentdash-path', remote: false }),
    { code: 'CWD_NOT_FOUND' },
  );
});

test('remote CWD containment is boundary-aware and case-insensitive', () => {
  const { base, root, child, outside } = fixture();
  try {
    const alternateCaseRoot = root.toUpperCase();
    assert.equal(
      resolveCwd({
        cwd: child,
        remote: true,
        env: { AGENTDASH_CWD_ROOTS: alternateCaseRoot },
      }),
      fs.realpathSync.native(child),
    );
    assert.throws(
      () => resolveCwd({
        cwd: outside,
        remote: true,
        env: { AGENTDASH_CWD_ROOTS: root },
      }),
      { code: 'CWD_OUTSIDE_ROOTS' },
    );
    assert.equal(_internals.isContained('c:\\root', 'c:\\rooted', path.win32), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('remote CWD rejects UNC and device paths before filesystem access', () => {
  assert.throws(
    () => resolveCwd({ cwd: '\\\\server\\share', remote: true }),
    { code: 'CWD_REMOTE_PATH_UNSUPPORTED' },
  );
  assert.throws(
    () => resolveCwd({ cwd: '\\\\?\\C:\\Projects', remote: true }),
    { code: 'CWD_REMOTE_PATH_UNSUPPORTED' },
  );
});

test('remote CWD resolves junctions before containment checks', () => {
  const { base, root, outside } = fixture();
  const link = path.join(root, 'Escaped');
  try {
    fs.symlinkSync(outside, link, 'junction');
    assert.throws(
      () => resolveCwd({
        cwd: link,
        remote: true,
        env: { AGENTDASH_CWD_ROOTS: root },
      }),
      { code: 'CWD_OUTSIDE_ROOTS' },
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
