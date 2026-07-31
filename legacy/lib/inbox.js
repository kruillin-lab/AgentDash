'use strict';

const fs = require('fs/promises');
const path = require('path');
const { ttl } = require('./cache');

const INBOX_ROOT = 'C:\\Users\\kruil\\Documents\\Projects\\inbox';
const INBOX_TTL_MS = 30_000;

function errorPayload(code, message) {
  return { code, message };
}

function isReadme(name) {
  return /^README/i.test(name);
}

function compareNames(left, right) {
  const leftFolded = left.toLowerCase();
  const rightFolded = right.toLowerCase();
  if (leftFolded < rightFolded) return -1;
  if (leftFolded > rightFolded) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function fileRecord(root, fullPath, name) {
  const stat = await fs.stat(fullPath);
  return {
    name,
    relPath: path.relative(root, fullPath),
    size: stat.size,
    mtime: stat.mtime.toISOString(),
  };
}

async function readFolder(root, folderName) {
  const folderPath = path.join(root, folderName);
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const fileEntries = entries
    .filter((entry) => entry.isFile() && !isReadme(entry.name))
    .sort((left, right) => compareNames(left.name, right.name));
  const files = await Promise.all(
    fileEntries.map((entry) => fileRecord(root, path.join(folderPath, entry.name), entry.name)),
  );

  return {
    name: folderName,
    count: files.length,
    files,
  };
}

function emptyPayload(root, error = null) {
  return {
    root,
    folders: [],
    looseFiles: [],
    total: 0,
    error,
  };
}

async function readInbox(root = INBOX_ROOT) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const visibleEntries = entries.filter((entry) => !isReadme(entry.name));
    const folders = await Promise.all(
      visibleEntries
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => compareNames(left.name, right.name))
        .map((entry) => readFolder(root, entry.name)),
    );
    const looseFiles = await Promise.all(
      visibleEntries
        .filter((entry) => entry.isFile())
        .sort((left, right) => compareNames(left.name, right.name))
        .map((entry) => fileRecord(root, path.join(root, entry.name), entry.name)),
    );

    return {
      root,
      folders,
      looseFiles,
      total: looseFiles.length + folders.reduce((sum, folder) => sum + folder.count, 0),
      error: null,
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return emptyPayload(
        root,
        errorPayload('NO_INBOX', `Inbox root does not exist: ${root}`),
      );
    }
    return emptyPayload(
      root,
      errorPayload('INBOX_READ_FAILED', err && err.message ? err.message : 'Inbox read failed'),
    );
  }
}

function createInboxReader(root = INBOX_ROOT, ttlMs = INBOX_TTL_MS) {
  return ttl(() => readInbox(root), ttlMs);
}

const listInbox = createInboxReader();

module.exports = {
  listInbox,
  _internals: {
    INBOX_ROOT,
    INBOX_TTL_MS,
    compareNames,
    createInboxReader,
    fileRecord,
    isReadme,
    readFolder,
    readInbox,
  },
};
