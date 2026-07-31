'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertInteractiveAgentContext,
  isSystemAccount,
} = require('../lib/runtime-context');

test('LocalSystem profiles are detected and refused for agent launch', () => {
  const env = {
    USERNAME: 'SYSTEM',
    USERPROFILE: 'C:\\Windows\\System32\\config\\systemprofile',
    SystemRoot: 'C:\\Windows',
  };
  assert.equal(isSystemAccount(env), true);
  assert.throws(() => assertInteractiveAgentContext(env), {
    code: 'SERVICE_ACCOUNT_UNSUPPORTED',
  });
});

test('normal user profiles support interactive agent launch', () => {
  const env = {
    USERNAME: 'kruil',
    USERPROFILE: 'C:\\Users\\kruil',
    SystemRoot: 'C:\\Windows',
  };
  assert.equal(isSystemAccount(env), false);
  assert.doesNotThrow(() => assertInteractiveAgentContext(env));
});

test('noninteractive Windows service sessions are rejected regardless of username', () => {
  const env = {
    USERNAME: 'service-user',
    USERPROFILE: 'C:\\Users\\service-user',
    SystemRoot: 'C:\\Windows',
    SESSIONNAME: 'Services',
  };
  assert.equal(isSystemAccount(env), true);
});
