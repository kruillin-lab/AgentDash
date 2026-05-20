'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Agent definitions — edit commands/args as needed
const AGENTS = {
  claude: {
    label: 'Claude Code',
    cmd: 'claude',
    args: [],
    color: '#a78bfa',
  },
  codex: {
    label: 'Codex',
    cmd: 'codex',
    args: [],
    color: '#34d399',
  },
  opencode: {
    label: 'opencode',
    cmd: 'opencode',
    args: [],
    color: '#60a5fa',
  },
  hermes: {
    label: 'Hermes',
    cmd: 'hermes',
    args: [],
    color: '#fb923c',
  },
  kimi: {
    label: 'Kimi',
    cmd: 'kimi',
    args: [],
    color: '#2dd4bf',
  },
  gemini: {
    label: 'Gemini (Antigravity)',
    cmd: 'gemini',
    args: [],
    color: '#facc15',
  },
};

// Active sessions: id -> { pty, ws, agentKey, cwd }
const sessions = new Map();
let nextId = 1;

app.get('/api/agents', (_req, res) => {
  res.json(AGENTS);
});

app.get('/api/sessions', (_req, res) => {
  const list = [];
  for (const [id, s] of sessions) {
    list.push({ id, agentKey: s.agentKey, cwd: s.cwd, alive: !s.pty.killed });
  }
  res.json(list);
});

app.post('/api/sessions', (req, res) => {
  const { agentKey, cwd } = req.body;
  const agent = AGENTS[agentKey];
  if (!agent) return res.status(400).json({ error: 'Unknown agent' });

  const workDir = cwd || process.env.USERPROFILE || process.cwd();
  const id = nextId++;

  const term = pty.spawn(agent.cmd, agent.args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 35,
    cwd: workDir,
    env: process.env,
  });

  sessions.set(id, { pty: term, ws: null, agentKey, cwd: workDir });

  term.onData((data) => {
    const s = sessions.get(id);
    if (s && s.ws && s.ws.readyState === WebSocket.OPEN) {
      s.ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  term.onExit(() => {
    const s = sessions.get(id);
    if (s && s.ws && s.ws.readyState === WebSocket.OPEN) {
      s.ws.send(JSON.stringify({ type: 'exit' }));
    }
  });

  res.json({ id, agentKey, cwd: workDir });
});

app.delete('/api/sessions/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = sessions.get(id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  try { s.pty.kill(); } catch (_) {}
  sessions.delete(id);
  res.json({ ok: true });
});

// WebSocket: client sends { type: 'attach', sessionId } then { type: 'input', data }
wss.on('connection', (ws) => {
  let attachedId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    if (msg.type === 'attach') {
      attachedId = msg.sessionId;
      const s = sessions.get(attachedId);
      if (s) s.ws = ws;
    } else if (msg.type === 'input' && attachedId !== null) {
      const s = sessions.get(attachedId);
      if (s) s.pty.write(msg.data);
    } else if (msg.type === 'resize' && attachedId !== null) {
      const s = sessions.get(attachedId);
      if (s) s.pty.resize(msg.cols, msg.rows);
    }
  });

  ws.on('close', () => {
    if (attachedId !== null) {
      const s = sessions.get(attachedId);
      if (s) s.ws = null;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`AgentDash running at http://localhost:${PORT}`);
});
