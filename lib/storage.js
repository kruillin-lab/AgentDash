'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'AgentDash');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

const DEFAULT_STATE = {
  sessions: [],
  activity: [],
  cwdHistory: [],
  nextSessionId: 1,
};

const MAX_ACTIVITY = 500;
const MAX_CWD_HISTORY = 20;
const SAVE_DEBOUNCE_MS = 500;

let state = null;
let saveTimer = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load() {
  if (state) return state;
  ensureDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } else {
      state = { ...DEFAULT_STATE };
    }
  } catch (err) {
    console.error('[storage] load failed, resetting:', err.message);
    state = { ...DEFAULT_STATE };
  }
  return state;
}

function persistNow() {
  if (!state) return true;
  ensureDir();
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, DATA_FILE);
    return true;
  } catch (err) {
    console.error('[storage] save failed:', err.message);
    return false;
  }
}

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, SAVE_DEBOUNCE_MS);
}

function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return persistNow();
}

function getSessions() {
  return load().sessions;
}

function getActivity(limit) {
  const a = load().activity;
  if (!limit) return a;
  return a.slice(-limit);
}

function addSession(sess) {
  const s = load();
  s.sessions.push(sess);
  save();
  return sess;
}

function updateSession(id, patch) {
  const s = load();
  const idx = s.sessions.findIndex((x) => x.id === id);
  if (idx === -1) return null;
  s.sessions[idx] = { ...s.sessions[idx], ...patch };
  save();
  return s.sessions[idx];
}

function addActivity(event) {
  const s = load();
  s.activity.push(event);
  if (s.activity.length > MAX_ACTIVITY) {
    s.activity = s.activity.slice(-MAX_ACTIVITY);
  }
  save();
  return event;
}

function nextSessionId() {
  const s = load();
  const id = s.nextSessionId++;
  save();
  return id;
}

function getCwdHistory() {
  const s = load();
  if (!Array.isArray(s.cwdHistory)) s.cwdHistory = [];
  return s.cwdHistory;
}

function addCwdHistory(cwd) {
  if (!cwd || typeof cwd !== 'string') return;
  const s = load();
  if (!Array.isArray(s.cwdHistory)) s.cwdHistory = [];
  s.cwdHistory = [cwd, ...s.cwdHistory.filter((x) => x !== cwd)].slice(0, MAX_CWD_HISTORY);
  save();
}

module.exports = {
  DATA_FILE,
  DATA_DIR,
  load,
  flush,
  getSessions,
  getActivity,
  addSession,
  updateSession,
  addActivity,
  nextSessionId,
  getCwdHistory,
  addCwdHistory,
};
