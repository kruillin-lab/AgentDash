'use strict';

const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const { ActivityParser, stripAnsi } = require('./activity');

const AGENTS = {
  claude:    { label: 'Claude Code',          cmd: 'claude',   color: '#a78bfa' },
  codex:     { label: 'Codex',                cmd: 'codex-acp.cmd', color: '#34d399' },
  opencode:  { label: 'opencode',             cmd: 'opencode', color: '#60a5fa' },
  kimi:      { label: 'Kimi',                 cmd: 'kimi',     color: '#2dd4bf' },
  agy:       { label: 'Antigravity',          cmd: 'C:\\Users\\kruil\\AppData\\Local\\agy\\bin\\agy.exe', color: '#facc15' },
};

const LOGS_DIR = path.join(storage.DATA_DIR, 'logs');

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function writeLog(id, data) {
  try {
    ensureLogsDir();
    fs.appendFileSync(path.join(LOGS_DIR, `${id}.log`), data, 'utf8');
  } catch (err) {
    console.error(`[sessions] Failed to write log for session ${id}:`, err.message);
  }
}

function readLog(id) {
  try {
    const logFile = path.join(LOGS_DIR, `${id}.log`);
    if (!fs.existsSync(logFile)) return '';
    return fs.readFileSync(logFile, 'utf8');
  } catch (err) {
    console.error(`[sessions] Failed to read log for session ${id}:`, err.message);
    return '';
  }
}

const RING_SIZE = 1000;
const live = new Map(); // sessionId -> { pty, ring, parser }

function getAgents() {
  return AGENTS;
}

function reconcileOnBoot() {
  const sessions = storage.getSessions();
  for (const s of sessions) {
    if (s.status === 'running') {
      let alive = false;
      if (s.pid) {
        try { process.kill(s.pid, 0); alive = true; } catch (_) {}
      }
      if (!alive) {
        storage.updateSession(s.id, { status: 'exited', endedAt: new Date().toISOString() });
      }
    }
  }
}

function listSessions() {
  return storage.getSessions().map((s) => ({
    ...s,
    isLive: live.has(s.id),
    lastOutput: live.has(s.id) ? live.get(s.id).ring.slice(-3).join('\n') : null,
  }));
}

function getOutput(id) {
  return readLog(id);
}

function spawn({ agentKey, cwd }) {
  const agent = AGENTS[agentKey];
  if (!agent) throw new Error('Unknown agent: ' + agentKey);

  const workDir = cwd || process.env.USERPROFILE || process.cwd();
  const id = storage.nextSessionId();

  // Use PowerShell so both .exe and .ps1 agents launch consistently.
  // -NoExit keeps shell alive after agent exits so output stays visible.
  const term = pty.spawn('powershell.exe', [
    '-NoLogo',
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
  ], {
    name: 'xterm-256color',
    cols: 120,
    rows: 35,
    cwd: workDir,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
    },
  });

  // Execute the agent command interactively in the newly spawned shell
  term.write(agent.cmd + '\r\n');

  const session = {
    id,
    agentKey,
    agentLabel: agent.label,
    agentColor: agent.color,
    cwd: workDir,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'running',
    pid: term.pid,
  };
  storage.addSession(session);
  storage.addCwdHistory(workDir);

  const ring = [];
  const parser = new ActivityParser(id, (event) => {
    storage.addActivity(event);
  });

  term.onData((data) => {
    writeLog(id, data);

    const clean = stripAnsi(data);
    const chunks = clean.split(/\r?\n/);
    for (const c of chunks) {
      if (c) {
        ring.push(c);
        if (ring.length > RING_SIZE) ring.shift();
      }
    }
    parser.feed(data);
  });

  term.onExit(() => {
    storage.updateSession(id, {
      status: 'exited',
      endedAt: new Date().toISOString(),
    });
    storage.addActivity({
      id: `${id}-${Date.now()}-exit`,
      sessionId: id,
      ts: new Date().toISOString(),
      kind: 'exit',
      text: `Session ${id} exited`,
    });
    live.delete(id);
  });

  live.set(id, { pty: term, ring, parser });
  return session;
}

function writeInput(id, data) {
  const entry = live.get(id);
  if (!entry) return false;
  entry.pty.write(data);
  return true;
}

function kill(id) {
  const entry = live.get(id);
  if (!entry) return false;
  try { entry.pty.kill(); } catch (_) {}
  return true;
}

function shutdown() {
  for (const [id, entry] of live) {
    try { entry.pty.kill(); } catch (_) {}
    storage.updateSession(id, {
      status: 'exited',
      endedAt: new Date().toISOString(),
    });
  }
  live.clear();
  storage.flush();
}

module.exports = {
  AGENTS,
  getAgents,
  reconcileOnBoot,
  listSessions,
  getOutput,
  spawn,
  writeInput,
  kill,
  shutdown,
};
