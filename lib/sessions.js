'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const pty = require('node-pty');
const storage = require('./storage');
const { ActivityParser, stripAnsi } = require('./activity');
const cwdPolicy = require('./cwd-policy');
const runtimeContext = require('./runtime-context');

const USER_HOME = process.env.USERPROFILE || os.homedir();
const COMSPEC = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
const PROJECTS_ROOT = path.join(USER_HOME, 'Documents', 'Projects');

const AGENTS = {
  claude: {
    label: 'Claude Code',
    color: '#a78bfa',
    candidates: [{ file: path.join(USER_HOME, '.local', 'bin', 'claude.exe'), args: [] }],
    resume: { byId: ['--resume'], latest: ['--continue'] },
  },
  hermes: {
    label: 'Hermes',
    color: '#fb923c',
    candidates: [
      {
        file: path.join(USER_HOME, 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
        args: ['chat', '--cli'],
      },
      {
        file: path.join(USER_HOME, 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
        args: ['--cli'],
      },
      { file: path.join(USER_HOME, '.local', 'bin', 'hermes.cmd'), args: ['--cli'], shell: true },
    ],
    resume: { byId: ['--resume'], latest: ['--continue'] },
  },
  opencode: {
    label: 'OpenCode',
    color: '#60a5fa',
    candidates: [{ file: path.join(USER_HOME, '.bun', 'bin', 'opencode.exe'), args: [] }],
    resume: { byId: ['--session'], latest: ['--continue'] },
  },
  kimi: {
    label: 'Kimi',
    color: '#2dd4bf',
    candidates: [{ file: path.join(USER_HOME, '.local', 'bin', 'kimi.exe'), args: [] }],
    resume: { byId: ['--session'], latest: ['--continue'] },
  },
  agy: {
    label: 'Antigravity',
    color: '#facc15',
    candidates: [{
      file: path.join(USER_HOME, 'AppData', 'Local', 'agy', 'bin', 'agy.exe'),
      args: [],
    }],
    resume: { byId: ['--conversation'], latest: ['--continue'] },
  },
  codex: {
    label: 'Codex ACP',
    color: '#34d399',
    candidates: [{
      file: path.join(PROJECTS_ROOT, 'codex-acp.cmd'),
      args: [],
      shell: true,
    }],
    resume: null,
  },
};

const LOGS_DIR = path.join(storage.DATA_DIR, 'logs');
const RING_SIZE = 1000;
const CAPTURE_LINE_LIMIT = 200;
const INPUT_DELIVERY_LIMIT = 100;
const LIVE_STATUSES = new Set(['starting', 'running']);
const live = new Map();

function structuredError(code, message) {
  return { code, message };
}

function getAgent(agentKey) {
  return typeof agentKey === 'string' && Object.hasOwn(AGENTS, agentKey)
    ? AGENTS[agentKey]
    : null;
}

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
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
    return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  } catch (err) {
    console.error(`[sessions] Failed to read log for session ${id}:`, err.message);
    return '';
  }
}

function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (_) {
    return false;
  }
}

function chooseCandidate(agent) {
  const candidate = agent.candidates.find((item) => fileExists(item.file));
  if (!candidate) {
    throw Object.assign(new Error(`Agent executable not found for ${agent.label}.`), {
      code: 'AGENT_NOT_FOUND',
    });
  }
  return candidate;
}

function commandForCandidate(candidate, extraArgs = []) {
  const args = [...candidate.args, ...extraArgs];
  if (!candidate.shell) return { file: candidate.file, args };

  const command = `"${candidate.file}"${args.length ? ` ${args.map(quoteCmdArg).join(' ')}` : ''}`;
  return { file: COMSPEC, args: ['/d', '/s', '/c', command] };
}

function quoteCmdArg(value) {
  const stringValue = String(value);
  if (!/[\s"&|<>^]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function buildCommand(agentKey, options = {}) {
  const agent = getAgent(agentKey);
  if (!agent) {
    throw Object.assign(new Error(`Unknown agent: ${agentKey}`), { code: 'UNKNOWN_AGENT' });
  }
  const candidate = chooseCandidate(agent);
  const { resumeMode = null, nativeSessionId = null } = options;
  let resumeArgs = [];
  if (resumeMode) {
    if (!agent.resume || !agent.resume[resumeMode]) {
      throw Object.assign(new Error(`${agent.label} does not support ${resumeMode} resume.`), {
        code: 'NOT_RESUMABLE',
      });
    }
    resumeArgs = [...agent.resume[resumeMode]];
    if (resumeMode === 'byId') {
      if (!isValidNativeSessionId(agentKey, nativeSessionId)) {
        throw Object.assign(new Error('Native session ID is invalid.'), {
          code: 'INVALID_NATIVE_SESSION_ID',
        });
      }
      resumeArgs.push(nativeSessionId);
    }
  }
  return commandForCandidate(candidate, resumeArgs);
}

function getAgents() {
  return Object.fromEntries(Object.entries(AGENTS).map(([key, agent]) => [
    key,
    {
      label: agent.label,
      color: agent.color,
      resumable: Boolean(agent.resume),
    },
  ]));
}

function normalizeSession(session) {
  const agent = getAgent(session.agentKey);
  const nativeSessionId = isValidNativeSessionId(session.agentKey, session.nativeSessionId)
    ? session.nativeSessionId
    : null;
  return {
    ...session,
    endedAt: session.endedAt || null,
    nativeSessionId,
    resumable: session.resumable ?? Boolean(agent?.resume),
    resumedFrom: session.resumedFrom ?? null,
    resumeMode: session.resumeMode ?? null,
    exitCode: Number.isInteger(session.exitCode) ? session.exitCode : null,
    exitReason: session.exitReason || null,
    inputDeliveries: normalizeInputDeliveries(session.inputDeliveries),
    conversationId: session.conversationId || null,
  };
}

function normalizeInputDeliveries(value) {
  if (!Array.isArray(value)) return [];
  const records = new Map();
  for (const item of value) {
    const record = typeof item === 'string'
      ? { id: item, hash: null, status: 'delivered', at: null }
      : item;
    if (!record || !isValidDeliveryId(record.id)) continue;
    if (record.hash != null && !/^[0-9a-f]{64}$/.test(record.hash)) continue;
    if (!['reserved', 'delivered', 'uncertain'].includes(record.status)) continue;
    records.set(record.id, {
      id: record.id,
      hash: record.hash || null,
      status: record.status,
      at: record.at || null,
    });
  }
  return [...records.values()].slice(-INPUT_DELIVERY_LIMIT);
}

function reconcileOnBoot() {
  const now = new Date().toISOString();
  for (const raw of storage.getSessions()) {
    const session = normalizeSession(raw);
    const patch = {};
    for (const [key, value] of Object.entries(session)) {
      if (!(key in raw)) patch[key] = value;
    }
    if (raw.nativeSessionId !== session.nativeSessionId) {
      patch.nativeSessionId = session.nativeSessionId;
    }
    if (LIVE_STATUSES.has(session.status)) {
      Object.assign(patch, {
        status: 'orphaned',
        endedAt: now,
        exitCode: null,
        exitReason: 'server_restart',
      });
    }
    if (Object.keys(patch).length > 0) storage.updateSession(session.id, patch);
  }
  storage.flush();
}

function listSessions() {
  return storage.getSessions().map((raw) => {
    const session = normalizeSession(raw);
    const entry = live.get(session.id);
    return {
      ...session,
      isLive: Boolean(entry),
      lastOutput: entry ? entry.ring.slice(-3).join('\n') : null,
    };
  });
}

function getOutput(id) {
  return readLog(id);
}

function findSession(id) {
  return storage.getSessions().find((session) => session.id === id) || null;
}

function isValidNativeSessionId(agentKey, value) {
  if (typeof value !== 'string' || value.length > 160) return false;
  if (agentKey === 'claude') {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
  if (agentKey === 'opencode') return /^ses_[A-Za-z0-9_-]{6,128}$/.test(value);
  if (agentKey === 'hermes') return /^\d{8}_\d{6}_[0-9a-f]{6}$/i.test(value);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
}

function captureNativeSessionId(agentKey, text) {
  const matches = [];
  const collect = (pattern) => {
    for (const match of text.matchAll(pattern)) {
      if (isValidNativeSessionId(agentKey, match[1])) matches.push(match[1]);
    }
  };
  if (agentKey === 'claude') {
    collect(
      /^\s*(?:session\s+id|resume\s+with)\s*:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*$/gim,
    );
  } else if (agentKey === 'hermes') {
    collect(/^\s*session\s*:\s*(\d{8}_\d{6}_[0-9a-f]{6})\s*$/gim);
  } else if (agentKey === 'opencode') {
    collect(/^\s*session(?:\s+id)?\s*:\s*(ses_[A-Za-z0-9_-]{6,128})\s*$/gim);
  } else {
    collect(/^\s*session(?:\s+id)?\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]{7,127})\s*$/gim);
    collect(/^\s*resume(?:\s+with)?\s*:\s*([A-Za-z0-9][A-Za-z0-9_-]{7,127})\s*$/gim);
  }
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}

function captureTrustedNativeSessionId(agentKey, text, captureOpen = true) {
  if (!captureOpen) return null;
  return captureNativeSessionId(agentKey, text);
}

function isValidDeliveryId(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(value);
}

function prepareInputDelivery(current, deliveryId, data) {
  const inputDeliveries = normalizeInputDeliveries(current);
  if (!isValidDeliveryId(deliveryId)) {
    return {
      duplicate: false,
      next: inputDeliveries,
      error: structuredError('INVALID_DELIVERY_ID', 'Delivery ID is invalid.'),
    };
  }
  const hash = crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  const existing = inputDeliveries.find((record) => record.id === deliveryId);
  if (existing) {
    if (existing.hash && existing.hash !== hash) {
      return {
        duplicate: false,
        next: inputDeliveries,
        error: structuredError('DELIVERY_PAYLOAD_MISMATCH', 'Delivery ID was already used for different input.'),
      };
    }
    return { duplicate: true, next: inputDeliveries, error: null };
  }
  return {
    duplicate: false,
    next: [...inputDeliveries, {
      id: deliveryId,
      hash,
      status: 'reserved',
      at: new Date().toISOString(),
    }].slice(-INPUT_DELIVERY_LIMIT),
    error: null,
  };
}

function conversationKey(session, sessionsById) {
  const visited = new Set();
  let current = session;
  while (current) {
    if (current.conversationId) return String(current.conversationId);
    if (visited.has(current.id)) {
      return `cycle:${[...new Set([...visited, current.id])].sort((a, b) => a - b).join(',')}`;
    }
    visited.add(current.id);
    if (current.resumedFrom == null) return `root:${current.id}`;
    current = sessionsById.get(current.resumedFrom);
  }
  return `root:${session.id}`;
}

function exitState(exitCode, requestedKill) {
  if (requestedKill) return { status: 'killed', exitReason: 'user_kill' };
  if (exitCode === 0) return { status: 'exited', exitReason: 'process_exit' };
  return { status: 'failed', exitReason: 'process_error' };
}

function createSession(options) {
  const {
    agentKey,
    cwd,
    remote = false,
    resumedFrom = null,
    resumeMode = null,
    nativeSessionId = null,
  } = options;
  const agent = getAgent(agentKey);
  if (!agent) {
    throw Object.assign(new Error(`Unknown agent: ${agentKey}`), { code: 'UNKNOWN_AGENT' });
  }
  runtimeContext.assertInteractiveAgentContext();
  const workDir = cwdPolicy.resolveCwd({ cwd, remote });
  const command = buildCommand(agentKey, { resumeMode, nativeSessionId });
  const id = storage.nextSessionId();
  const startedAt = new Date().toISOString();
  const term = pty.spawn(command.file, command.args, {
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

  const session = {
    id,
    agentKey,
    agentLabel: agent.label,
    agentColor: agent.color,
    cwd: workDir,
    startedAt,
    endedAt: null,
    status: 'starting',
    pid: term.pid,
    nativeSessionId: nativeSessionId || null,
    resumable: Boolean(agent.resume),
    resumedFrom,
    resumeMode,
    exitCode: null,
    exitReason: null,
    inputDeliveries: [],
    conversationId: options.conversationId || `session:${id}`,
  };
  storage.addSession(session);
  storage.addCwdHistory(workDir);

  const ring = [];
  const parser = new ActivityParser(id, (event) => storage.addActivity(event));
  const entry = {
    pty: term,
    ring,
    parser,
    requestedKill: false,
    finalized: false,
    captureLines: 0,
    captureBuffer: '',
    captureOpen: nativeSessionId == null,
  };
  live.set(id, entry);

  const markRunning = () => {
    const current = findSession(id);
    if (current?.status === 'starting' && live.has(id)) {
      storage.updateSession(id, { status: 'running' });
    }
  };

  term.onData((data) => {
    markRunning();
    writeLog(id, data);
    const clean = stripAnsi(data);
    const chunks = clean.split(/\r?\n/);
    for (const chunk of chunks) {
      if (!chunk) continue;
      ring.push(chunk);
      if (ring.length > RING_SIZE) ring.shift();
    }
    parser.feed(data);

    if (entry.captureOpen && !findSession(id)?.nativeSessionId && entry.captureLines < CAPTURE_LINE_LIMIT) {
      entry.captureLines += Math.max(1, chunks.length - 1);
      entry.captureBuffer = `${entry.captureBuffer}\n${clean}`.slice(-12000);
      const captured = captureTrustedNativeSessionId(agentKey, entry.captureBuffer, entry.captureOpen);
      if (captured) {
        entry.captureOpen = false;
        storage.updateSession(id, { nativeSessionId: captured });
      }
    }
  });

  term.onExit((event = {}) => {
    if (entry.finalized) return;
    entry.finalized = true;
    const exitCode = Number.isInteger(event.exitCode) ? event.exitCode : null;
    const final = exitState(exitCode, entry.requestedKill);
    const endedAt = new Date().toISOString();
    storage.updateSession(id, {
      ...final,
      exitCode,
      endedAt,
    });
    storage.addActivity({
      id: `${id}-${Date.now()}-exit`,
      sessionId: id,
      ts: endedAt,
      kind: 'exit',
      text: `Session ${id} ${final.status}${exitCode == null ? '' : ` with code ${exitCode}`}`,
    });
    live.delete(id);
  });

  setImmediate(markRunning);
  return normalizeSession(session);
}

function spawn(options) {
  return createSession(options);
}

function writeInput(id, data, options = {}) {
  const entry = live.get(id);
  if (!entry) {
    return { ok: false, duplicate: false, error: structuredError('SESSION_NOT_LIVE', 'Session is not live.') };
  }

  const deliveryId = options.deliveryId ?? null;
  const session = normalizeSession(findSession(id) || {});
  let delivery = null;
  if (deliveryId != null) {
    delivery = prepareInputDelivery(session.inputDeliveries, deliveryId, data);
    if (delivery.error) {
      return {
        ok: false,
        duplicate: false,
        error: delivery.error,
      };
    }
    if (delivery.duplicate) {
      return { ok: true, duplicate: true, error: null };
    }
    storage.updateSession(id, { inputDeliveries: delivery.next });
    if (!storage.flush()) {
      storage.updateSession(id, { inputDeliveries: session.inputDeliveries });
      return {
        ok: false,
        duplicate: false,
        error: structuredError('DELIVERY_RESERVATION_FAILED', 'Could not persist the input delivery reservation.'),
      };
    }
  }

  entry.captureOpen = false;
  try {
    entry.pty.write(data);
  } catch (err) {
    if (deliveryId != null) {
      const uncertain = delivery.next.map((record) => (
        record.id === deliveryId ? { ...record, status: 'uncertain' } : record
      ));
      storage.updateSession(id, { inputDeliveries: uncertain });
      storage.flush();
    }
    return { ok: false, duplicate: false, error: structuredError('INPUT_WRITE_FAILED', err.message) };
  }

  if (deliveryId != null) {
    const delivered = delivery.next.map((record) => (
      record.id === deliveryId ? { ...record, status: 'delivered' } : record
    ));
    storage.updateSession(id, {
      inputDeliveries: delivered,
    });
    if (!storage.flush()) {
      return {
        ok: true,
        duplicate: false,
        error: structuredError(
          'DELIVERY_STATUS_UNCERTAIN',
          'Input was written, but its delivered status could not be persisted.',
        ),
      };
    }
  }
  return { ok: true, duplicate: false, error: null };
}

function interrupt(id) {
  const entry = live.get(id);
  if (!entry) return { ok: false, error: structuredError('SESSION_NOT_LIVE', 'Session is not live.') };
  try {
    entry.pty.write('\x03');
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: structuredError('INTERRUPT_FAILED', err.message) };
  }
}

function kill(id) {
  const entry = live.get(id);
  if (!entry) return false;
  entry.requestedKill = true;
  try {
    entry.pty.kill();
    return true;
  } catch (_) {
    entry.requestedKill = false;
    return false;
  }
}

function chooseResume(source, allSessions) {
  const agent = getAgent(source.agentKey);
  if (!agent?.resume) {
    return { error: structuredError('NOT_RESUMABLE', `${source.agentLabel || source.agentKey} cannot be resumed.`) };
  }
  if (live.has(source.id) || LIVE_STATUSES.has(source.status)) {
    return { error: structuredError('SESSION_STILL_LIVE', 'Exit or kill the session before resuming it.') };
  }
  const sessionsById = new Map(allSessions.map((session) => [session.id, session]));
  const sourceConversation = conversationKey(source, sessionsById);
  const activeResume = allSessions.find((session) => {
    if (!(live.has(session.id) || LIVE_STATUSES.has(session.status))) return false;
    if (conversationKey(session, sessionsById) === sourceConversation) return true;
    return Boolean(
      source.nativeSessionId
      && session.agentKey === source.agentKey
      && session.nativeSessionId === source.nativeSessionId,
    );
  });
  if (activeResume) {
    return {
      error: structuredError(
        'RESUME_ALREADY_ACTIVE',
        `Session ${activeResume.id} already has this conversation active.`,
      ),
    };
  }
  if (source.nativeSessionId && agent.resume.byId) {
    if (!isValidNativeSessionId(source.agentKey, source.nativeSessionId)) {
      return { error: structuredError('INVALID_NATIVE_SESSION_ID', 'Stored native session ID is invalid.') };
    }
    return { mode: 'byId', nativeSessionId: source.nativeSessionId, error: null };
  }
  if (!agent.resume.latest) {
    return { error: structuredError('NATIVE_SESSION_ID_REQUIRED', 'This agent requires a native session ID to resume.') };
  }
  const sourceTime = new Date(source.startedAt).getTime();
  const newer = allSessions.find((session) => (
    session.id !== source.id
    && session.agentKey === source.agentKey
    && String(session.cwd).toLowerCase() === String(source.cwd).toLowerCase()
    && new Date(session.startedAt).getTime() > sourceTime
  ));
  if (newer) {
    return {
      error: structuredError(
        'AMBIGUOUS_LATEST',
        `Session ${newer.id} is newer for this agent and CWD. Resume that session instead.`,
      ),
    };
  }
  return { mode: 'latest', nativeSessionId: null, error: null };
}

function resumeSession(id, options = {}) {
  const source = findSession(id);
  if (!source) {
    return { session: null, mode: null, error: structuredError('SESSION_NOT_FOUND', 'Session not found.') };
  }
  const normalized = normalizeSession(source);
  const allSessions = storage.getSessions().map(normalizeSession);
  const choice = chooseResume(normalized, allSessions);
  if (choice.error) return { session: null, mode: null, error: choice.error };

  try {
    const session = createSession({
      agentKey: normalized.agentKey,
      cwd: normalized.cwd,
      remote: Boolean(options.remote),
      resumedFrom: normalized.id,
      resumeMode: choice.mode,
      nativeSessionId: choice.nativeSessionId,
      conversationId: normalized.conversationId
        || conversationKey(normalized, new Map(allSessions.map((session) => [session.id, session]))),
    });
    return { session: { ...session, isLive: true }, mode: choice.mode, error: null };
  } catch (err) {
    return {
      session: null,
      mode: choice.mode,
      error: structuredError(err.code || 'RESUME_FAILED', err.message),
    };
  }
}

function shutdown() {
  const endedAt = new Date().toISOString();
  for (const [id, entry] of live) {
    entry.finalized = true;
    storage.updateSession(id, {
      status: 'killed',
      endedAt,
      exitCode: null,
      exitReason: 'server_shutdown',
    });
    try {
      entry.pty.kill();
    } catch (_) {}
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
  interrupt,
  kill,
  resumeSession,
  shutdown,
  _internals: {
    buildCommand,
    captureNativeSessionId,
    captureTrustedNativeSessionId,
    chooseResume,
    commandForCandidate,
    exitState,
    getAgent,
    isValidNativeSessionId,
    isValidDeliveryId,
    conversationKey,
    normalizeSession,
    normalizeInputDeliveries,
    prepareInputDelivery,
    quoteCmdArg,
  },
};
