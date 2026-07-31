'use strict';

const path = require('path');

function isSystemAccount(env = process.env) {
  const username = String(env.USERNAME || '').toLowerCase();
  const userProfile = String(env.USERPROFILE || '').replace(/\//g, '\\').toLowerCase();
  const systemRoot = String(env.SystemRoot || env.WINDIR || 'C:\\Windows')
    .replace(/\//g, '\\')
    .toLowerCase();
  const systemProfile = path.win32.join(systemRoot, 'System32', 'config', 'systemprofile')
    .toLowerCase();
  const sessionName = String(env.SESSIONNAME || '').toLowerCase();

  return username === 'system'
    || username === 'localsystem'
    || userProfile === systemProfile
    || userProfile.endsWith('\\system32\\config\\systemprofile')
    || sessionName === 'services';
}

function assertInteractiveAgentContext(env = process.env) {
  if (!isSystemAccount(env)) return;
  throw Object.assign(
    new Error('Agent launch requires a logged-in user profile; LocalSystem service accounts are unsupported.'),
    { code: 'SERVICE_ACCOUNT_UNSUPPORTED' },
  );
}

module.exports = {
  assertInteractiveAgentContext,
  isSystemAccount,
};
