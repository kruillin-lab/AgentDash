'use strict';

const state = {
  agents: {},
  sessions: [],
  activity: [],
  projects: null,
  goals: null,
  schedules: null,
  recall: null,
  inbox: null,
  view: 'projects',
  detailId: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function loadAgents() {
  state.agents = await api('/api/agents');
  const sel = $('#agent-select');
  sel.innerHTML = '';
  for (const [key, a] of Object.entries(state.agents)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = a.label;
    sel.appendChild(o);
  }
}

async function loadCwdHistory() {
  try {
    const list = await api('/api/cwd-history');
    const dl = $('#cwd-history');
    dl.innerHTML = '';
    for (const cwd of list) {
      const o = document.createElement('option');
      o.value = cwd;
      dl.appendChild(o);
    }
    if (list.length > 0 && !$('#cwd-input').value) {
      $('#cwd-input').placeholder = list[0];
    }
  } catch (err) {
    console.error('cwd history load failed', err);
  }
}

async function refresh() {
  try {
    const [sessions, activity] = await Promise.all([
      api('/api/sessions'),
      api('/api/activity?limit=100'),
    ]);
    state.sessions = sessions;
    state.activity = activity;
    render();
    if (state.view === 'detail' && state.detailId) {
      loadDetail(state.detailId);
    }
  } catch (err) {
    console.error('refresh failed', err);
  }
}

async function loadProjects() {
  try {
    state.projects = await api('/api/projects');
  } catch (err) {
    state.projects = {
      run: null,
      projects: [],
      error: { code: 'NETWORK_ERROR', message: err.message },
    };
  }
  renderProjects(state.projects);
}

async function loadGoals() {
  try {
    state.goals = await api('/api/goals');
  } catch (err) {
    state.goals = {
      goals: [],
      scanned: { rootsWalked: 0, stateFilesFound: 0, tookMs: 0 },
      error: { code: 'NETWORK_ERROR', message: err.message },
    };
  }
  renderGoals(state.goals);
}

async function loadSchedules() {
  const summary = $('#schedules-summary');
  if (summary) {
    summary.innerHTML = '<div class="loading-panel">Loading scheduled routines…</div>';
  }
  try {
    state.schedules = await api('/api/schedules');
  } catch (err) {
    state.schedules = {
      routines: [],
      tookMs: 0,
      error: { code: 'NETWORK_ERROR', message: err.message },
    };
  }
  renderSchedules(state.schedules);
}

async function searchRecall(query) {
  const summary = $('#recall-summary');
  const results = $('#recall-results');
  summary.innerHTML = '<div class="loading-panel">Searching local recall index…</div>';
  results.innerHTML = '';

  try {
    state.recall = await api(`/api/recall?q=${encodeURIComponent(query)}`);
  } catch (err) {
    state.recall = {
      query,
      engine: 'fts5',
      results: [],
      tookMs: 0,
      error: { code: 'NETWORK_ERROR', message: err.message },
    };
  }
  renderRecall(state.recall);
}

async function loadInbox() {
  try {
    state.inbox = await api('/api/inbox');
  } catch (err) {
    state.inbox = {
      root: '',
      folders: [],
      looseFiles: [],
      total: 0,
      error: { code: 'NETWORK_ERROR', message: err.message },
    };
  }
  renderInbox(state.inbox);
}

function fmtTime(iso) {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function fmtRelative(iso) {
  if (!iso) return 'unknown';
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(deltaMs)) return 'unknown';
  const isFuture = deltaMs < 0;
  const seconds = Math.floor(Math.abs(deltaMs) / 1000);
  if (seconds < 60) return isFuture ? `in ${seconds}s` : `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return isFuture ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return isFuture ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return isFuture ? `in ${days}d` : `${days}d ago`;
}

function fmtDuration(start, end) {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const sec = Math.floor((endMs - startMs) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function agentInfo(key) {
  return state.agents[key] || { label: key, color: '#888' };
}

function render() {
  renderStats();
  renderActiveSessions();
  renderDashboardActivity();
  renderAllSessions();
  renderFullActivity();
}

function resultClass(result) {
  return `result-${String(result || 'INCOMPLETE').replace(/[^A-Z_]/gi, '').toUpperCase()}`;
}

function renderProjects(data) {
  const header = $('#projects-header');
  const grid = $('#projects-grid');
  if (!header || !grid) return;

  if (!data || data.error) {
    const error = data?.error || { code: 'NO_DATA', message: 'Project health is unavailable.' };
    header.innerHTML = `
      <div class="error-panel">
        <b>${escape(error.code)}</b>
        <span>${escape(error.message)}</span>
      </div>
    `;
    grid.innerHTML = '';
    return;
  }

  const { run, projects } = data;
  const counts = run.counts || {};
  header.innerHTML = `
    <div class="projects-summary ${resultClass(run.result)}">
      <div>
        <div class="eyebrow">Latest global quality gate</div>
        <div class="projects-result">${escape(run.result)}</div>
        <div class="projects-run">${escape(run.runId)} · ${fmtRelative(run.finished || run.started)}</div>
      </div>
      <div class="summary-counts">
        <span><b>${counts.projects || 0}</b> projects</span>
        <span><b>${counts.pass || 0}</b> pass</span>
        <span><b>${counts.passWithWarnings || 0}</b> warnings</span>
        <span><b>${counts.fail || 0}</b> failed</span>
        <span><b>${counts.openWarnings || 0}</b> open</span>
      </div>
      ${run.reportPath ? `<button class="btn btn-ghost path-copy" data-copy="${escapeAttr(run.reportPath)}">Copy report path</button>` : ''}
    </div>
  `;

  grid.innerHTML = '';
  for (const project of projects) {
    const card = document.createElement('article');
    card.className = `card project-card ${resultClass(project.result)}`;
    card.innerHTML = `
      <div class="card-header project-card-header">
        <h2>${escape(project.label)}</h2>
        <span class="status-badge ${resultClass(project.result)}">${escape(project.result)}</span>
      </div>
      <div class="project-card-body">
        <div class="project-stats">
          <span><b>${project.changedFiles}</b> changed</span>
          <span><b>${project.gateCritical}</b> gate-critical</span>
          <span><b>${project.testCritical}</b> test-critical</span>
          <span><b>${project.openWarnings}</b> open warnings</span>
        </div>
        <div class="project-meta">
          <span>${project.hasConfig ? 'Quality gate configured' : 'Missing quality-gate config'}</span>
          ${project.notes ? `<span>${escape(project.notes)}</span>` : ''}
        </div>
        ${project.projectPath ? `<button class="btn btn-ghost path-copy" data-copy="${escapeAttr(project.projectPath)}">${escape(project.projectPath)}</button>` : ''}
        ${project.reportPath ? `<button class="btn btn-ghost path-copy" data-copy="${escapeAttr(project.reportPath)}">Copy project report</button>` : ''}
      </div>
    `;
    grid.appendChild(card);
  }
}

function statusBadge(status) {
  const value = String(status || 'unknown');
  return `<span class="status-badge status-${escapeAttr(value)}">${escape(value)}</span>`;
}

function renderGoals(data) {
  const summary = $('#goals-summary');
  const grid = $('#goals-grid');
  if (!summary || !grid) return;

  if (!data || data.error) {
    const error = data?.error || { code: 'NO_DATA', message: 'Goals are unavailable.' };
    summary.innerHTML = `
      <div class="error-panel">
        <b>${escape(error.code)}</b>
        <span>${escape(error.message)}</span>
      </div>
    `;
    grid.innerHTML = '';
    return;
  }

  const goals = Array.isArray(data.goals) ? data.goals : [];
  const active = goals.filter((goal) => goal.status === 'active').length;
  const blocked = goals.filter((goal) => goal.status === 'blocked').length;
  summary.innerHTML = `
    <div class="zone-summary">
      <div>
        <div class="eyebrow">GoalBuddy across Projects</div>
        <div class="zone-summary-title">${goals.length} goals discovered</div>
      </div>
      <div class="summary-counts">
        <span><b>${active}</b> active</span>
        <span><b>${blocked}</b> blocked</span>
        <span><b>${data.scanned?.stateFilesFound || 0}</b> state files</span>
        <span><b>${data.scanned?.tookMs || 0}ms</b> scan</span>
      </div>
    </div>
  `;

  grid.innerHTML = '';
  if (goals.length === 0) {
    grid.innerHTML = '<div class="empty card">No GoalBuddy goals found.</div>';
    return;
  }

  goals.forEach((goal, index) => {
    const counts = goal.taskCounts || {};
    const activeTask = goal.activeTask
      ? `${goal.activeTask.id} · ${goal.activeTask.type || 'task'}`
      : 'No active task';
    const card = document.createElement('article');
    card.className = `card goal-card status-border-${escapeAttr(goal.status || 'unknown')}`;
    card.innerHTML = `
      <div class="card-header goal-card-header">
        <div>
          <div class="eyebrow">${escape(goal.project)}</div>
          <h2>${escape(goal.title || goal.slug)}</h2>
        </div>
        ${statusBadge(goal.status)}
      </div>
      <div class="goal-card-body">
        ${goal.parseError ? `<div class="error-panel compact"><b>Parse error</b><span>${escape(goal.parseError)}</span></div>` : ''}
        <div class="goal-active-task">
          <span>Active task</span>
          <b>${escape(activeTask)}</b>
        </div>
        <div class="task-counts">
          <span class="status-done">${counts.done || 0} done</span>
          <span class="status-active">${counts.active || 0} active</span>
          <span class="status-queued">${counts.queued || 0} queued</span>
          <span class="status-blocked">${counts.blocked || 0} blocked</span>
        </div>
        <div class="goal-meta">
          <span>Last verification: ${escape(goal.lastVerification?.result || 'unknown')}</span>
          <span>${goal.lastVerification?.at ? fmtRelative(goal.lastVerification.at) : 'No timestamp recorded'}</span>
        </div>
        <button class="btn" data-goal-index="${index}">View tasks</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function openGoalModal(index) {
  const goal = state.goals?.goals?.[index];
  if (!goal) return;

  $('#goal-modal-title').textContent = goal.title || goal.slug;
  $('#goal-modal-project').textContent = `${goal.project} · ${goal.slug}`;
  $('#goal-modal-meta').innerHTML = `
    ${statusBadge(goal.status)}
    <button class="btn btn-ghost path-copy" data-copy="${escapeAttr(goal.statePath || '')}">Copy state path</button>
    <button class="btn btn-ghost path-copy" data-copy="${escapeAttr(goal.goalDocPath || '')}">Copy goal path</button>
  `;

  const tasks = Array.isArray(goal.tasks) ? goal.tasks : [];
  const table = $('#goal-modal-tasks');
  table.innerHTML = `
    <div class="task-row task-head">
      <span>ID</span><span>Type</span><span>Status</span><span>Objective</span>
    </div>
  `;
  for (const task of tasks) {
    const row = document.createElement('div');
    row.className = `task-row ${task.id === goal.activeTask?.id ? 'task-current' : ''}`;
    row.innerHTML = `
      <span class="mono">${escape(task.id)}</span>
      <span>${escape(task.type || '')}</span>
      <span>${statusBadge(task.status)}</span>
      <span>${escape(task.objective || '')}</span>
    `;
    table.appendChild(row);
  }
  if (tasks.length === 0) {
    table.innerHTML += '<div class="empty">No tasks recorded.</div>';
  }

  $('#goal-modal').classList.add('visible');
}

function formatScheduleResult(result) {
  if (!result) return '<span class="schedule-result muted">unknown</span>';
  if (result.ok) return '<span class="schedule-result good">OK</span>';
  if (result.neverRun) return '<span class="schedule-result muted">never run</span>';
  return `<span class="schedule-result bad">${escape(result.hex || String(result.code))}</span>`;
}

function renderSchedules(data) {
  const summary = $('#schedules-summary');
  const table = $('#schedules-table');
  if (!summary || !table) return;

  if (!data || data.error) {
    const error = data?.error || { code: 'NO_DATA', message: 'Schedules are unavailable.' };
    summary.innerHTML = `
      <div class="error-panel">
        <b>${escape(error.code)}</b>
        <span>${escape(error.message)}</span>
      </div>
    `;
    table.innerHTML = '';
    return;
  }

  const routines = Array.isArray(data.routines) ? data.routines : [];
  const healthy = routines.filter((routine) => routine.found && routine.lastResult?.ok).length;
  const errors = routines.filter((routine) => routine.found && routine.lastResult && !routine.lastResult.ok && !routine.lastResult.neverRun).length;
  const missing = routines.filter((routine) => !routine.found).length;
  summary.innerHTML = `
    <div class="zone-summary">
      <div>
        <div class="eyebrow">Windows Task Scheduler · read-only</div>
        <div class="zone-summary-title">${routines.length} maintenance routines</div>
      </div>
      <div class="summary-counts">
        <span><b>${healthy}</b> healthy</span>
        <span><b>${errors}</b> errors</span>
        <span><b>${missing}</b> missing</span>
        <span><b>${data.tookMs || 0}ms</b> query</span>
      </div>
    </div>
  `;

  table.innerHTML = `
    <div class="schedule-row schedule-head">
      <span>Routine</span><span>Task</span><span>State</span><span>Last run</span><span>Result</span><span>Next fire</span>
    </div>
  `;
  for (const routine of routines) {
    const row = document.createElement('div');
    row.className = 'schedule-row';
    row.innerHTML = `
      <span><b>${escape(routine.label)}</b></span>
      <span class="mono">${escape(routine.taskPath)}${escape(routine.taskName)}</span>
      <span>${routine.found ? statusBadge(routine.state || 'unknown') : statusBadge('not-found')}</span>
      <span class="mono">${routine.found && routine.lastResult?.neverRun ? '—' : escape(routine.lastRunTime ? fmtRelative(routine.lastRunTime) : '—')}</span>
      <span>${routine.found ? formatScheduleResult(routine.lastResult) : '<span class="schedule-result bad">not found</span>'}</span>
      <span class="mono">${escape(routine.nextRunTime ? fmtRelative(routine.nextRunTime) : '—')}</span>
    `;
    table.appendChild(row);
  }
}

function renderRecall(data) {
  const summary = $('#recall-summary');
  const results = $('#recall-results');
  if (!summary || !results) return;

  if (!data || data.error) {
    const error = data?.error || { code: 'NO_DATA', message: 'Recall is unavailable.' };
    summary.innerHTML = `
      <div class="error-panel">
        <b>${escape(error.code)}</b>
        <span>${escape(error.message)}</span>
      </div>
    `;
    results.innerHTML = '';
    return;
  }

  const hits = Array.isArray(data.results) ? data.results : [];
  summary.innerHTML = `
    <div class="zone-summary">
      <div>
        <div class="eyebrow">${escape(data.engine || 'fts5')} local recall</div>
        <div class="zone-summary-title">${hits.length} results for “${escape(data.query)}”</div>
      </div>
      <div class="summary-counts">
        <span><b>${data.tookMs || 0}ms</b> search</span>
      </div>
    </div>
  `;

  results.innerHTML = '';
  if (hits.length === 0) {
    results.innerHTML = '<div class="empty card">No recall matches found.</div>';
    return;
  }

  hits.forEach((hit, index) => {
    const item = document.createElement('article');
    item.className = 'card recall-result';
    item.innerHTML = `
      <div class="recall-rank">#${index + 1}</div>
      <div class="recall-body">
        <h2>${escape(hit.title || hit.path)}</h2>
        <button class="btn btn-ghost path-copy" data-copy="${escapeAttr(hit.path)}">${escape(hit.path)}</button>
        ${hit.meta ? `<div class="recall-meta">${escape(hit.meta)}</div>` : ''}
        <p>${escape(hit.snippet || '')}</p>
      </div>
      <div class="recall-score">${hit.rank == null ? '' : escape(hit.rank)}</div>
    `;
    results.appendChild(item);
  });
}

function fmtBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function inboxFileRow(file) {
  return `
    <div class="inbox-file-row">
      <span>${escape(file.name)}</span>
      <span class="mono">${fmtBytes(file.size)}</span>
      <span>${fmtRelative(file.mtime)}</span>
      <button class="btn btn-ghost path-copy" data-copy="${escapeAttr(file.relPath)}">Copy relative path</button>
    </div>
  `;
}

function renderInbox(data) {
  const summary = $('#inbox-summary');
  const content = $('#inbox-content');
  if (!summary || !content) return;

  if (!data || data.error) {
    const error = data?.error || { code: 'NO_DATA', message: 'Inbox is unavailable.' };
    summary.innerHTML = `
      <div class="error-panel">
        <b>${escape(error.code)}</b>
        <span>${escape(error.message)}</span>
      </div>
    `;
    content.innerHTML = '';
    return;
  }

  const folders = Array.isArray(data.folders) ? data.folders : [];
  const looseFiles = Array.isArray(data.looseFiles) ? data.looseFiles : [];
  summary.innerHTML = `
    <div class="zone-summary">
      <div>
        <div class="eyebrow">Projects inbox · read-only</div>
        <div class="zone-summary-title">${data.total || 0} queued files</div>
      </div>
      <div class="summary-counts">
        <span><b>${folders.length}</b> folders</span>
        <span><b>${looseFiles.length}</b> loose files</span>
      </div>
      <button class="btn btn-ghost path-copy" data-copy="${escapeAttr(data.root || '')}">Copy inbox root</button>
    </div>
  `;

  content.innerHTML = '';
  if (looseFiles.length > 0) {
    const loose = document.createElement('section');
    loose.className = 'card inbox-folder';
    loose.innerHTML = `
      <div class="card-header"><h2>Loose files</h2><span class="count-pill">${looseFiles.length}</span></div>
      <div class="inbox-file-list">${looseFiles.map(inboxFileRow).join('')}</div>
    `;
    content.appendChild(loose);
  }

  for (const folder of folders) {
    const section = document.createElement('section');
    section.className = 'card inbox-folder';
    section.innerHTML = `
      <div class="card-header"><h2>${escape(folder.name)}</h2><span class="count-pill">${folder.count}</span></div>
      <div class="inbox-file-list">
        ${folder.files.length > 0 ? folder.files.map(inboxFileRow).join('') : '<div class="empty">Empty folder</div>'}
      </div>
    `;
    content.appendChild(section);
  }

  if (folders.length === 0 && looseFiles.length === 0) {
    content.innerHTML = '<div class="empty card">Inbox is empty.</div>';
  }
}

function renderStats() {
  const active = state.sessions.filter((s) => s.status === 'running').length;
  $('#stat-active').textContent = active;
  $('#stat-total').textContent = state.sessions.length;
  const dayAgo = Date.now() - 86400000;
  const recent = state.activity.filter((a) => new Date(a.ts).getTime() >= dayAgo).length;
  $('#stat-activity').textContent = recent;
  $('#topbar-meta').textContent = `${active} active · ${state.sessions.length} total`;
}

function sessionRow(s) {
  const agent = agentInfo(s.agentKey);
  const div = document.createElement('div');
  div.className = 'session-row';
  div.dataset.id = s.id;
  div.innerHTML = `
    <span class="session-dot ${s.status}" style="background:${agent.color}"></span>
    <div class="session-meta">
      <div class="session-title">${agent.label} #${s.id}</div>
      <div class="session-sub">${s.cwd}</div>
    </div>
    <div class="session-last">${s.lastOutput ? escape(s.lastOutput.split('\n').pop()) : ''}</div>
    <div class="session-actions">
      ${s.status === 'running' ? `<button class="btn btn-danger" data-kill="${s.id}">Kill</button>` : ''}
    </div>
  `;
  div.addEventListener('click', (e) => {
    if (e.target.dataset.kill) return;
    openDetail(s.id);
  });
  const killBtn = div.querySelector('[data-kill]');
  if (killBtn) {
    killBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api(`/api/sessions/${s.id}`, { method: 'DELETE' });
      refresh();
    });
  }
  return div;
}

function renderActiveSessions() {
  const list = $('#active-sessions');
  list.innerHTML = '';
  const active = state.sessions.filter((s) => s.status === 'running').reverse();
  if (active.length === 0) {
    list.innerHTML = '<div class="empty">No active sessions. Click "+ New Session" to launch.</div>';
    return;
  }
  for (const s of active) list.appendChild(sessionRow(s));
}

function renderAllSessions() {
  const list = $('#all-sessions');
  list.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'session-table-row head';
  head.innerHTML = `<span></span><span>Agent</span><span>Working Dir</span><span>Status</span><span>Duration</span><span>Started</span>`;
  list.appendChild(head);
  if (state.sessions.length === 0) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'No sessions yet.';
    list.appendChild(e);
    return;
  }
  const sorted = [...state.sessions].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  for (const s of sorted) {
    const agent = agentInfo(s.agentKey);
    const row = document.createElement('div');
    row.className = 'session-table-row';
    row.innerHTML = `
      <span class="session-dot ${s.status}" style="background:${agent.color}"></span>
      <span><b>${agent.label}</b> <span class="mono">#${s.id}</span></span>
      <span class="mono">${s.cwd}</span>
      <span><span class="status-badge ${s.status}">${s.status}</span></span>
      <span class="mono">${fmtDuration(s.startedAt, s.endedAt)}</span>
      <span class="mono">${fmtTime(s.startedAt)}</span>
    `;
    row.addEventListener('click', () => openDetail(s.id));
    list.appendChild(row);
  }
}

function activityRow(a) {
  const sess = state.sessions.find((s) => s.id === a.sessionId);
  const agent = sess ? agentInfo(sess.agentKey) : { label: 'Unknown' };
  const div = document.createElement('div');
  div.className = 'activity-row';
  div.innerHTML = `
    <span class="activity-time">${fmtTime(a.ts)}</span>
    <span class="activity-kind ${a.kind}"></span>
    <span class="activity-text">
      <span class="activity-session">${agent.label} #${a.sessionId}</span>${escape(a.text)}
    </span>
  `;
  return div;
}

function renderDashboardActivity() {
  const list = $('#dashboard-activity');
  list.innerHTML = '';
  const recent = state.activity.slice(-30).reverse();
  if (recent.length === 0) {
    list.innerHTML = '<div class="empty">No activity yet.</div>';
    return;
  }
  for (const a of recent) list.appendChild(activityRow(a));
}

function renderFullActivity() {
  const list = $('#full-activity');
  list.innerHTML = '';
  if (state.activity.length === 0) {
    list.innerHTML = '<div class="empty">No activity yet.</div>';
    return;
  }
  const sorted = [...state.activity].reverse();
  for (const a of sorted) list.appendChild(activityRow(a));
}

let activeTerminal = null;
let lastLogLength = 0;

async function openDetail(id) {
  state.detailId = id;
  lastLogLength = 0;
  
  if (activeTerminal) {
    try { activeTerminal.dispose(); } catch (_) {}
    activeTerminal = null;
  }
  
  switchView('detail');
  
  const container = document.getElementById('terminal-container');
  if (container) {
    container.innerHTML = '';
    
    activeTerminal = new Terminal({
      cols: 120,
      rows: 35,
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      theme: {
        background: '#0d0d0f',
        foreground: '#e4e4e7',
        cursor: '#a78bfa',
        black: '#18181b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#a78bfa',
        cyan: '#2dd4bf',
        white: '#e4e4e7',
      }
    });
    
    activeTerminal.open(container);
    
    activeTerminal.onData(async (data) => {
      if (!state.detailId) return;
      try {
        await api(`/api/sessions/${state.detailId}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data }),
        });
        await loadDetail(state.detailId);
      } catch (err) {
        console.error('Failed to send terminal input:', err);
      }
    });
  }
  
  await loadDetail(id);
}

async function loadDetail(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  const agent = agentInfo(s.agentKey);
  $('#detail-title').textContent = `${agent.label} #${s.id}`;
  $('#detail-meta').innerHTML = `
    <span><b>Status:</b> ${s.status}</span>
    <span><b>CWD:</b> ${s.cwd}</span>
    <span><b>Duration:</b> ${fmtDuration(s.startedAt, s.endedAt)}</span>
    <span><b>PID:</b> ${s.pid || '—'}</span>
  `;
  try {
    const { raw } = await api(`/api/sessions/${id}/output`);
    if (activeTerminal && state.detailId === id) {
      if (raw.length < lastLogLength) {
        activeTerminal.reset();
        lastLogLength = 0;
      }
      const newChunk = raw.slice(lastLogLength);
      if (newChunk) {
        activeTerminal.write(newChunk);
        lastLogLength = raw.length;
      }
    }
  } catch (err) {
    console.error('Failed to load detail output:', err);
  }
}

function switchView(view) {
  state.view = view;
  $$('.view').forEach((el) => el.classList.remove('visible'));
  const target = $(`#view-${view}`);
  if (target) target.classList.add('visible');
  $$('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  const titles = {
    projects: 'Projects',
    goals: 'Goals',
    schedules: 'Schedules',
    recall: 'Recall',
    inbox: 'Inbox',
    dashboard: 'Dashboard',
    sessions: 'Sessions',
    activity: 'Activity Feed',
    detail: 'Session Detail',
  };
  $('#view-title').textContent = titles[view] || view;
  setActiveZonePolling(view);
  if (view === 'projects') loadProjects();
  if (view === 'goals') loadGoals();
  if (view === 'schedules') loadSchedules();
  if (view === 'inbox') loadInbox();
}

function escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escape(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let activeZoneInterval = null;

function setActiveZonePolling(viewName) {
  if (activeZoneInterval) {
    clearInterval(activeZoneInterval);
    activeZoneInterval = null;
  }
  if (viewName === 'projects') {
    activeZoneInterval = setInterval(loadProjects, 30_000);
  } else if (viewName === 'goals') {
    activeZoneInterval = setInterval(loadGoals, 30_000);
  } else if (viewName === 'schedules') {
    activeZoneInterval = setInterval(loadSchedules, 60_000);
  } else if (viewName === 'inbox') {
    activeZoneInterval = setInterval(loadInbox, 30_000);
  }
}

function bindEvents() {
  $$('.nav-item').forEach((el) => {
    el.addEventListener('click', () => {
      state.detailId = null;
      if (activeTerminal) {
        try { activeTerminal.dispose(); } catch (_) {}
        activeTerminal = null;
      }
      switchView(el.dataset.view);
    });
  });
  
  $('#back-btn').addEventListener('click', () => {
    state.detailId = null;
    if (activeTerminal) {
      try { activeTerminal.dispose(); } catch (_) {}
      activeTerminal = null;
    }
    switchView('dashboard');
  });
  
  $('#open-launch').addEventListener('click', () => {
    loadCwdHistory();
    $('#launch-modal').classList.add('visible');
    setTimeout(() => $('#cwd-input').focus(), 50);
  });
  
  $('#cancel-launch').addEventListener('click', () => {
    $('#launch-modal').classList.remove('visible');
  });

  $('#close-goal-modal').addEventListener('click', () => {
    $('#goal-modal').classList.remove('visible');
  });

  $('#recall-form').addEventListener('submit', (event) => {
    event.preventDefault();
    searchRecall($('#recall-query').value);
  });
  
  $('#confirm-launch').addEventListener('click', async () => {
    const agentKey = $('#agent-select').value;
    const cwd = $('#cwd-input').value.trim() || undefined;
    try {
      await api('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentKey, cwd }),
      });
      $('#launch-modal').classList.remove('visible');
      $('#cwd-input').value = '';
      loadCwdHistory();
      refresh();
    } catch (err) {
      alert('Launch failed: ' + err.message);
    }
  });

  document.addEventListener('click', async (event) => {
    const goalButton = event.target.closest('[data-goal-index]');
    if (goalButton) {
      openGoalModal(Number(goalButton.dataset.goalIndex));
      return;
    }

    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const value = button.dataset.copy;
    try {
      await navigator.clipboard.writeText(value);
      const original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = original; }, 1200);
    } catch (_) {
      window.prompt('Copy path:', value);
    }
  });
}

async function init() {
  bindEvents();
  await loadAgents();
  await loadCwdHistory();
  await refresh();
  await loadProjects();
  setActiveZonePolling(state.view);
  setInterval(refresh, 2000);
}

init();
