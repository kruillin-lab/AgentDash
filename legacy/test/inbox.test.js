'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { _internals } = require('../lib/inbox');

test('readInbox filters README files and traverses only one folder level', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdash-inbox-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.mkdir(path.join(root, 'Zeta'));
  await fs.mkdir(path.join(root, 'alpha'));
  await fs.mkdir(path.join(root, 'alpha', 'nested'));
  await fs.writeFile(path.join(root, 'README.md'), 'policy');
  await fs.writeFile(path.join(root, 'Zulu.txt'), 'z');
  await fs.writeFile(path.join(root, 'alpha.txt'), 'alpha');
  await fs.writeFile(path.join(root, 'alpha', 'README-notes.md'), 'notes');
  await fs.writeFile(path.join(root, 'alpha', 'Beta.md'), 'beta');
  await fs.writeFile(path.join(root, 'alpha', 'aardvark.md'), 'aardvark');
  await fs.writeFile(path.join(root, 'alpha', 'nested', 'ignored.md'), 'ignored');

  const payload = await _internals.readInbox(root);

  assert.equal(payload.error, null);
  assert.equal(payload.total, 4);
  assert.deepEqual(payload.looseFiles.map((file) => file.name), ['alpha.txt', 'Zulu.txt']);
  assert.deepEqual(payload.folders.map((folder) => folder.name), ['alpha', 'Zeta']);
  assert.deepEqual(payload.folders[0].files.map((file) => file.name), ['aardvark.md', 'Beta.md']);
  assert.equal(payload.folders[0].count, 2);
  assert.equal(payload.folders[1].count, 0);
  assert.equal(
    payload.folders[0].files[0].relPath,
    path.join('alpha', 'aardvark.md'),
  );
  assert.equal(payload.folders[0].files[0].size, Buffer.byteLength('aardvark'));
  assert.match(payload.folders[0].files[0].mtime, /^\d{4}-\d{2}-\d{2}T/);
});

test('readInbox reports a structured missing-root error', async () => {
  const root = path.join(os.tmpdir(), `agentdash-inbox-missing-${Date.now()}`);
  const payload = await _internals.readInbox(root);

  assert.deepEqual(payload, {
    root,
    folders: [],
    looseFiles: [],
    total: 0,
    error: {
      code: 'NO_INBOX',
      message: `Inbox root does not exist: ${root}`,
    },
  });
});

test('createInboxReader caches inbox reads for the configured TTL', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdash-inbox-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const readCached = _internals.createInboxReader(root, 30_000);

  await fs.writeFile(path.join(root, 'first.txt'), 'first');
  assert.equal((await readCached()).total, 1);

  await fs.writeFile(path.join(root, 'second.txt'), 'second');
  assert.equal((await readCached()).total, 1);

  readCached.bust();
  assert.equal((await readCached()).total, 2);
});
