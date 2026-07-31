'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ttl } = require('../lib/cache');

test('ttl caches by argument list and supports bust', async () => {
  let calls = 0;
  const cached = ttl(async (value) => {
    calls += 1;
    return `${value}:${calls}`;
  }, 10_000);

  assert.equal(await cached('alpha'), 'alpha:1');
  assert.equal(await cached('alpha'), 'alpha:1');
  assert.equal(await cached('beta'), 'beta:2');
  assert.equal(calls, 2);

  cached.bust('alpha');
  assert.equal(await cached('alpha'), 'alpha:3');

  cached.bust();
  assert.equal(await cached('beta'), 'beta:4');
});

test('ttl shares an in-flight producer and does not cache rejection', async () => {
  let calls = 0;
  const cached = ttl(async () => {
    calls += 1;
    if (calls === 1) throw new Error('first failure');
    return calls;
  }, 10_000);

  await assert.rejects(cached(), /first failure/);
  assert.equal(await cached(), 2);
  assert.equal(await cached(), 2);
});
