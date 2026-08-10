'use strict';

function ttl(producerFn, ttlMs) {
  if (typeof producerFn !== 'function') {
    throw new TypeError('producerFn must be a function');
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new TypeError('ttlMs must be a non-negative number');
  }

  const entries = new Map();

  async function wrapped(...args) {
    const key = JSON.stringify(args);
    const now = Date.now();
    const cached = entries.get(key);

    if (cached && cached.expiresAt > now) {
      return cached.promise || cached.value;
    }

    const promise = Promise.resolve().then(() => producerFn(...args));
    entries.set(key, { expiresAt: now + ttlMs, promise });

    try {
      const value = await promise;
      entries.set(key, { expiresAt: Date.now() + ttlMs, value });
      return value;
    } catch (err) {
      entries.delete(key);
      throw err;
    }
  }

  wrapped.bust = (...args) => {
    if (args.length === 0) {
      entries.clear();
      return;
    }
    entries.delete(JSON.stringify(args));
  };

  return wrapped;
}

module.exports = { ttl };
