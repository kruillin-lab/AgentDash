'use strict';

const express = require('express');
const http = require('http');
const path = require('path');

const sessions = require('./lib/sessions');
const storage = require('./lib/storage');
const gates = require('./lib/gates');
const goals = require('./lib/goals');
const schedules = require('./lib/schedules');
const recall = require('./lib/recall');
const inbox = require('./lib/inbox');
const { requestSecurity } = require('./lib/request-security');
const runtimeContext = require('./lib/runtime-context');

const app = express();
const server = http.createServer(app);

const AUTH_USER = process.env.AGENTDASH_USER;
const AUTH_PASS = process.env.AGENTDASH_PASS;
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

function isLoopbackHost(host) {
  return ['127.0.0.1', 'localhost', '::1'].includes(String(host).toLowerCase());
}

function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase();
  return value === '127.0.0.1'
    || value === '::1'
    || value === '::ffff:127.0.0.1';
}

function parseSessionId(value) {
  if (!/^[1-9]\d*$/.test(String(value || ''))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
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
app.use(requestSecurity({ host: HOST }));
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
    const sess = sessions.spawn({
      agentKey,
      cwd,
      remote: !isLoopbackAddress(req.socket.remoteAddress),
    });
    res.json(sess);
  } catch (err) {
    res.status(400).json({
      error: {
        code: err.code || 'SESSION_LAUNCH_FAILED',
        message: err.message,
      },
    });
  }
});

app.delete('/api/sessions/:id', (req, res) => {
  const id = parseSessionId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid session ID' });
  const ok = sessions.kill(id);
  if (!ok) return res.status(404).json({ error: 'Session not running' });
  res.json({ ok: true });
});

app.get('/api/sessions/:id/output', (req, res) => {
  const id = parseSessionId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid session ID' });
  const raw = sessions.getOutput(id);
  const lines = raw.split(/\r?\n/).slice(-400);
  res.json({ raw, lines });
});

app.post('/api/sessions/:id/input', (req, res) => {
  const id = parseSessionId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid session ID' });
  const { data, deliveryId = null } = req.body || {};
  if (typeof data !== 'string') return res.status(400).json({ error: 'data must be string' });
  const result = sessions.writeInput(id, data, { deliveryId });
  if (result.error?.code === 'SESSION_NOT_LIVE') return res.status(404).json(result);
  if (result.error && !result.ok) return res.status(400).json(result);
  return res.json(result);
});

app.post('/api/sessions/:id/interrupt', (req, res) => {
  const id = parseSessionId(req.params.id);
  if (!id) {
    return res.json({
      ok: false,
      error: { code: 'INVALID_SESSION_ID', message: 'Session ID must be a positive integer.' },
    });
  }
  return res.json(sessions.interrupt(id));
});

app.post('/api/sessions/:id/resume', (req, res) => {
  const id = parseSessionId(req.params.id);
  if (!id) {
    return res.json({
      session: null,
      mode: null,
      error: { code: 'INVALID_SESSION_ID', message: 'Session ID must be a positive integer.' },
    });
  }
  return res.json(sessions.resumeSession(id, {
    remote: !isLoopbackAddress(req.socket.remoteAddress),
  }));
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

app.get('/api/recall', async (req, res) => {
  try {
    res.json(await recall.search(req.query.q));
  } catch (err) {
    res.json({
      query: typeof req.query.q === 'string' ? req.query.q : '',
      engine: 'fts5',
      results: [],
      tookMs: 0,
      error: { code: 'RECALL_FAILED', message: err.message },
    });
  }
});

app.get('/api/inbox', async (_req, res) => {
  try {
    res.json(await inbox.listInbox());
  } catch (err) {
    res.json({
      root: inbox._internals.INBOX_ROOT,
      folders: [],
      looseFiles: [],
      total: 0,
      error: { code: 'INBOX_READ_FAILED', message: err.message },
    });
  }
});

app.get('/api/health', (_req, res) => {
  const agentLaunchSupported = !runtimeContext.isSystemAccount();
  res.json({
    ok: true,
    dataFile: storage.DATA_FILE,
    agentLaunchSupported,
    agentLaunchError: agentLaunchSupported
      ? null
      : {
        code: 'SERVICE_ACCOUNT_UNSUPPORTED',
        message: 'Agent launch requires a logged-in user profile.',
      },
  });
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

module.exports = {
  app,
  server,
  _internals: {
    isLoopbackAddress,
    isLoopbackHost,
    parseSessionId,
  },
};
