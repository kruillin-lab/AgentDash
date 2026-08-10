'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

function loadInternals() {
  const originalLoad = Module._load;
  const app = new EventEmitter();
  app.whenReady = () => new Promise(() => {});
  app.quit = () => {};

  Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app,
        BrowserWindow: class {},
        Tray: class {},
        Menu: {},
        nativeImage: {},
        shell: {},
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require('../electron')._internals;
  } finally {
    Module._load = originalLoad;
  }
}

function createChild() {
  const child = new EventEmitter();
  child.connected = true;
  child.exitCode = null;
  child.signalCode = null;
  child.sent = [];
  child.killCalls = 0;
  child.send = (message, callback) => {
    child.sent.push(message);
    if (callback) callback(null);
  };
  child.kill = () => {
    child.killCalls += 1;
  };
  return child;
}

const { createQuitCoordinator, requestServerShutdown } = loadInternals();

test('requestServerShutdown waits for child exit after IPC request', async () => {
  const child = createChild();
  const shutdown = requestServerShutdown(child, { timeoutMs: 100 });

  assert.deepEqual(child.sent, ['shutdown']);
  assert.equal(child.killCalls, 0);

  child.emit('exit', 0, null);
  await shutdown;

  assert.equal(child.killCalls, 0);
});

test('requestServerShutdown force-kills after the bounded wait', async () => {
  const child = createChild();
  const callbacks = [];

  const shutdown = requestServerShutdown(child, {
    setTimer: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    clearTimer: () => {},
  });

  callbacks[0]();
  assert.equal(child.killCalls, 1);
  child.emit('exit', 1, 'SIGTERM');
  await shutdown;

  assert.deepEqual(child.sent, ['shutdown']);
  assert.equal(child.killCalls, 1);
});

test('requestServerShutdown has a final bound when a killed child never exits', async () => {
  const child = createChild();
  const callbacks = [];
  const shutdown = requestServerShutdown(child, {
    setTimer: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    clearTimer: () => {},
  });
  callbacks[0]();
  callbacks[1]();
  await shutdown;
  assert.equal(child.killCalls, 1);
});

test('quit coordinator prevents duplicate shutdown and allows final quit', async () => {
  const app = { quitCalls: 0, quit() { this.quitCalls += 1; } };
  const window = new EventEmitter();
  let stopCalls = 0;
  let finishShutdown;
  const stopServer = () => {
    stopCalls += 1;
    return new Promise((resolve) => {
      finishShutdown = resolve;
    });
  };
  const coordinator = createQuitCoordinator({
    electronApp: app,
    getWindow: () => window,
    getServerProcess: () => createChild(),
    stopServer,
  });
  const firstEvent = { prevented: 0, preventDefault() { this.prevented += 1; } };
  const secondEvent = { prevented: 0, preventDefault() { this.prevented += 1; } };

  coordinator.handleBeforeQuit(firstEvent);
  coordinator.handleBeforeQuit(secondEvent);
  await Promise.resolve();

  assert.equal(firstEvent.prevented, 1);
  assert.equal(secondEvent.prevented, 1);
  assert.equal(stopCalls, 1);

  finishShutdown();
  await coordinator.beginShutdown();

  assert.equal(app.quitCalls, 1);

  const finalEvent = { prevented: 0, preventDefault() { this.prevented += 1; } };
  coordinator.handleBeforeQuit(finalEvent);
  assert.equal(finalEvent.prevented, 0);
  assert.equal(stopCalls, 1);
});
