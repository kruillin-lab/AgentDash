'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MUTATION_HEADER,
  MUTATION_HEADER_VALUE,
  mutationGuard,
  requestSecurity,
  requiresMutationHeader,
} = require('../lib/request-security');

test('only state-changing methods require the AgentDash request header', () => {
  assert.equal(requiresMutationHeader('GET'), false);
  assert.equal(requiresMutationHeader('HEAD'), false);
  assert.equal(requiresMutationHeader('OPTIONS'), false);
  assert.equal(requiresMutationHeader('POST'), true);
  assert.equal(requiresMutationHeader('DELETE'), true);
});

test('mutation guard rejects missing headers with a structured error', () => {
  let statusCode = null;
  let payload = null;
  let nextCalled = false;
  const req = { method: 'POST', get: () => undefined };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return value;
    },
  };

  mutationGuard(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.equal(payload.error.code, 'MUTATION_HEADER_REQUIRED');
});

test('mutation guard accepts the exact custom header', () => {
  let nextCalled = false;
  const req = {
    method: 'DELETE',
    get(name) {
      return name === MUTATION_HEADER ? MUTATION_HEADER_VALUE : undefined;
    },
  };
  mutationGuard(req, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

function runSecurity({ method = 'GET', host = 'localhost:3001', origin, requestHeader } = {}) {
  let statusCode = 200;
  let payload = null;
  let nextCalled = false;
  const headers = {
    host,
    origin,
    [MUTATION_HEADER]: requestHeader,
  };
  const req = {
    method,
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return value;
    },
  };
  requestSecurity({ host: '127.0.0.1' })(req, res, () => { nextCalled = true; });
  return { statusCode, payload, nextCalled };
}

test('request security rejects attacker-controlled Host headers', () => {
  const result = runSecurity({ host: 'attacker.example' });
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error.code, 'HOST_NOT_ALLOWED');
});

test('request security rejects cross-origin mutations even with the custom header', () => {
  const result = runSecurity({
    method: 'POST',
    origin: 'https://attacker.example',
    requestHeader: MUTATION_HEADER_VALUE,
  });
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error.code, 'ORIGIN_NOT_ALLOWED');
});

test('request security accepts loopback aliases and same-origin mutations', () => {
  const result = runSecurity({
    method: 'POST',
    host: 'localhost:3001',
    origin: 'http://127.0.0.1:3001',
    requestHeader: MUTATION_HEADER_VALUE,
  });
  assert.equal(result.nextCalled, true);
});
