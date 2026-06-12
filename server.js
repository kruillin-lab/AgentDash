'use strict';

const express = require('express');
const http = require('http');
const path = require('path');

const sessions = require('./lib/sessions');
const storage = require('./lib/storage');
const gates = require('./lib/gates');
const goals = require('./lib/goals');
const schedules = require('./lib/schedules');

const app = express();
const server = http.createServer(app);

const AUTH_USER = process.env.AGENTDASH_USER;
const AUTH_PASS = process.env.AGENTDASH_PASS;
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

function isLoopbackHost(host) {
  return ['127.0.0.1', 'localhost', '::1'].includes(String(host).toLowerCase());
}

if (!isLoopbackHost(HOST) && (!AUTH_USER || !AUTH_PASS)) {
  throw new Error('Non-loopback HOST requires AGENTDASH_USER and AGENTDASH_PASS');
}

function basicAuth(req, res, next) {
  if (!AUTH_USER || !AUTH_PASS) return next();

  const auth = req.headers['authorization'];
  if (!auth) {
    res.set('WWW-Authenticate', 'Basic realm="AgentDash"');
    return res.status(401).send('Authentication required');
  }

  const parts = auth.split(' ');
  if (parts[0] !== 'Basic' || !parts[1]) {
    res.set('WWW-Authenticate', 'Basic realm="AgentDash"');
    return res.status(401).send('Authentication required');
  }

  const decoded = Buffer.from(parts[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const user = separator >= 0 ? decoded.slice(0, separator) : decoded;
  const pass = separator >= 0 ? decoded.slice(separator + 1) : '';
  if (user !== AUTH_USER || pass !== AUTH_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="AgentDash"');
    return res.status(401).send('Authentication required');
  }

  next();
}

app.use(basicAuth);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

sessions.reconcileOnBoot();

app.get('/api/agents', (_req, res) => {
  res.json(sessions.getAgents());
});

app.get('/api/sessions', (_req, res) => {
  res.json(sessions.listSessions());
});

app.post('/api/sessions', (req, res) => {
  const { agentKey, cwd } = req.body || {};
  try {
    const sess = sessions.spawn({ agentKey, cwd });
    res.json(sess);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ok = sessions.kill(id);
  if (!ok) return res.status(404).json({ error: 'Session not running' });
  res.json({ ok: true });
});

app.get('/api/sessions/:id/output', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const raw = sessions.getOutput(id);
  const lines = raw.split(/\r?\n/).slice(-400);
  res.json({ raw, lines });
});

app.post('/api/sessions/:id/input', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { data } = req.body || {};
  if (typeof data !== 'string') return res.status(400).json({ error: 'data must be string' });
  const ok = sessions.writeInput(id, data);
  if (!ok) return res.status(404).json({ error: 'Session not running' });
  res.json({ ok: true });
});

app.get('/api/cwd-history', (_req, res) => {
  res.json(storage.getCwdHistory());
});

app.get('/api/activity', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  res.json(storage.getActivity(limit));
});

app.get('/api/projects', async (_req, res) => {
  res.json(await gates.getProjectHealth());
});

app.get('/api/goals', async (_req, res) => {
  try {
    res.json(await goals.listGoals());
  } catch (err) {
    res.json({
      goals: [],
      scanned: { rootsWalked: 0, stateFilesFound: 0, tookMs: 0 },
      error: { code: 'GOAL_SCAN_FAILED', message: err.message },
    });
  }
});

app.get('/api/schedules', async (_req, res) => {
  try {
    res.json(await schedules.getSchedules());
  } catch (err) {
    res.json({
      routines: [],
      tookMs: 0,
      error: { code: 'SCHEDULE_QUERY_FAILED', message: err.message },
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dataFile: storage.DATA_FILE });
});

server.listen(PORT, HOST, () => {
  const localUrl = `http://localhost:${PORT}`;
  const bindUrl = `http://${HOST}:${PORT}`;
  console.log(`AgentDash running at ${localUrl} (local)`);
  if (HOST !== '127.0.0.1') {
    console.log(`AgentDash bound to ${bindUrl} (remote)`);
  }
  console.log(`Data file: ${storage.DATA_FILE}`);
  if (AUTH_USER && AUTH_PASS) {
    console.log(`Basic auth enabled for user: ${AUTH_USER}`);
  }
});

function shutdown() {
  console.log('[server] shutting down');
  sessions.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('message', (msg) => {
  if (msg === 'shutdown') shutdown();
});
