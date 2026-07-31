'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CWD_ROOT = 'C:\\Users\\kruil\\Documents\\Projects';

class CwdPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CwdPolicyError';
    this.code = code;
  }
}

function parseRoots(value = process.env.AGENTDASH_CWD_ROOTS) {
  const roots = String(value || DEFAULT_CWD_ROOT)
    .split(';')
    .map((root) => root.trim())
    .filter(Boolean);
  return roots.length > 0 ? roots : [DEFAULT_CWD_ROOT];
}

function isRemoteUnsafePath(value) {
  return /^\\\\/.test(value) || /^\\\\[.?]\\/.test(value);
}

function isContained(root, target, pathApi = path.win32) {
  const relative = pathApi.relative(root, target);
  return relative === '' || (
    !relative.startsWith(`..${pathApi.sep}`)
    && relative !== '..'
    && !pathApi.isAbsolute(relative)
  );
}

function realDirectory(value, fsApi = fs) {
  let resolved;
  try {
    resolved = fsApi.realpathSync.native
      ? fsApi.realpathSync.native(value)
      : fsApi.realpathSync(value);
  } catch (_) {
    throw new CwdPolicyError('CWD_NOT_FOUND', `Working directory does not exist: ${value}`);
  }

  let stat;
  try {
    stat = fsApi.statSync(resolved);
  } catch (_) {
    throw new CwdPolicyError('CWD_NOT_FOUND', `Working directory does not exist: ${value}`);
  }
  if (!stat.isDirectory()) {
    throw new CwdPolicyError('CWD_NOT_DIRECTORY', `Working directory is not a directory: ${value}`);
  }
  return resolved;
}

function resolveCwd(options = {}) {
  const {
    cwd,
    remote = false,
    env = process.env,
    fsApi = fs,
    pathApi = path.win32,
  } = options;
  const roots = parseRoots(env.AGENTDASH_CWD_ROOTS);
  const fallback = remote
    ? roots[0]
    : (env.AGENTDASH_DEFAULT_CWD || env.USERPROFILE || process.cwd());
  const requested = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : fallback;

  if (typeof requested !== 'string' || !requested) {
    throw new CwdPolicyError('CWD_REQUIRED', 'A working directory is required.');
  }
  if (!pathApi.isAbsolute(requested)) {
    throw new CwdPolicyError('CWD_NOT_ABSOLUTE', 'Working directory must be an absolute path.');
  }
  if (remote && isRemoteUnsafePath(requested)) {
    throw new CwdPolicyError('CWD_REMOTE_PATH_UNSUPPORTED', 'Remote sessions cannot use UNC or device paths.');
  }

  const resolved = realDirectory(requested, fsApi);
  if (!remote) return resolved;

  const allowed = roots.map((root) => {
    if (!pathApi.isAbsolute(root) || isRemoteUnsafePath(root)) {
      throw new CwdPolicyError('CWD_ROOT_INVALID', `Invalid AGENTDASH_CWD_ROOTS entry: ${root}`);
    }
    return realDirectory(root, fsApi);
  });
  const normalizedTarget = resolved.toLowerCase();
  const permitted = allowed.some((root) => isContained(root.toLowerCase(), normalizedTarget, pathApi));
  if (!permitted) {
    throw new CwdPolicyError('CWD_OUTSIDE_ROOTS', 'Remote session CWD is outside AGENTDASH_CWD_ROOTS.');
  }
  return resolved;
}

module.exports = {
  DEFAULT_CWD_ROOT,
  CwdPolicyError,
  parseRoots,
  resolveCwd,
  _internals: {
    isContained,
    isRemoteUnsafePath,
    realDirectory,
  },
};
