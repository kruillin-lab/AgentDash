'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let win = null;
let tray = null;
let serverProcess = null;

const PORT = 3001;
const SERVER_URL = `http://localhost:${PORT}`;
const SERVER_SHUTDOWN_TIMEOUT_MS = 3000;

function requestServerShutdown(child, {
  timeoutMs = SERVER_SHUTDOWN_TIMEOUT_MS,
  killWaitMs = 1000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let killTimer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimer(timer);
      if (killTimer) clearTimer(killTimer);
      child.removeListener('exit', finish);
      resolve();
    };

    const forceKill = () => {
      if (settled) return;
      try {
        child.kill();
      } catch (err) {
        console.error('Failed to force-stop server:', err);
        finish();
        return;
      }
      killTimer = setTimer(finish, killWaitMs);
    };

    child.once('exit', finish);
    timer = setTimer(forceKill, timeoutMs);

    if (!child.connected || typeof child.send !== 'function') {
      forceKill();
      return;
    }

    try {
      child.send('shutdown', (err) => {
        if (err) forceKill();
      });
    } catch (err) {
      console.error('Failed to request server shutdown:', err);
      forceKill();
    }
  });
}

function createQuitCoordinator({
  electronApp,
  getWindow,
  getServerProcess,
  stopServer = requestServerShutdown,
}) {
  let shutdownPromise = null;
  let quitReady = false;

  const beginShutdown = () => {
    if (shutdownPromise) return shutdownPromise;

    const currentWindow = getWindow();
    if (currentWindow) currentWindow.removeAllListeners('close');

    shutdownPromise = Promise.resolve()
      .then(() => stopServer(getServerProcess()))
      .catch((err) => console.error('Server shutdown failed:', err))
      .finally(() => {
        quitReady = true;
        electronApp.quit();
      });

    return shutdownPromise;
  };

  const handleBeforeQuit = (event) => {
    if (quitReady) return;
    event.preventDefault();
    beginShutdown();
  };

  return { beginShutdown, handleBeforeQuit };
}

const quitCoordinator = createQuitCoordinator({
  electronApp: app,
  getWindow: () => win,
  getServerProcess: () => serverProcess,
});

function startServer() {
  serverProcess = fork(path.join(__dirname, 'server.js'), [], {
    env: { ...process.env, PORT: String(PORT) },
    silent: false,
  });
  serverProcess.on('error', (err) => console.error('Server error:', err));
  serverProcess.on('exit', () => {
    serverProcess = null;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 500,
    title: 'AgentDash',
    backgroundColor: '#0d0d0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'public', 'icon.png'),
    show: false,
    titleBarStyle: 'default',
  });

  // Wait for server to be ready then load
  const tryLoad = (retries = 20) => {
    const http = require('http');
    http.get(SERVER_URL, () => {
      win.loadURL(SERVER_URL);
    }).on('error', () => {
      if (retries > 0) setTimeout(() => tryLoad(retries - 1), 300);
      else win.loadURL(SERVER_URL); // load anyway, show error
    });
  };
  tryLoad();

  win.once('ready-to-show', () => win.show());

  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
  });

  win.on('query-session-end', (event) => {
    event.preventDefault();
    quitCoordinator.beginShutdown();
  });
  win.on('session-end', () => {
    quitCoordinator.beginShutdown();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  // Use a blank icon if none exists
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const menu = Menu.buildFromTemplate([
    { label: 'Show AgentDash', click: () => { win.show(); win.focus(); } },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          path: process.execPath,
        });
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => {
      app.quit();
    }},
  ]);

  tray.setToolTip('AgentDash');
  tray.setContextMenu(menu);
  tray.on('click', () => { win.show(); win.focus(); });
}

app.whenReady().then(() => {
  startServer();
  createWindow();
  createTray();
});

app.on('window-all-closed', (e) => e.preventDefault());

app.on('before-quit', quitCoordinator.handleBeforeQuit);

app.on('activate', () => {
  win.show();
  win.focus();
});

module.exports = {
  _internals: {
    createQuitCoordinator,
    requestServerShutdown,
  },
};
