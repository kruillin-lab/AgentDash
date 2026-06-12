'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let win = null;
let tray = null;
let serverProcess = null;

const PORT = 3001;
const SERVER_URL = `http://localhost:${PORT}`;

function startServer() {
  serverProcess = fork(path.join(__dirname, 'server.js'), [], {
    env: { ...process.env, PORT: String(PORT) },
    silent: false,
  });
  serverProcess.on('error', (err) => console.error('Server error:', err));
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
    { type: 'separator' },
    { label: 'Quit', click: () => {
      win.removeAllListeners('close');
      if (serverProcess) serverProcess.kill();
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

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});

app.on('activate', () => {
  win.show();
  win.focus();
});
