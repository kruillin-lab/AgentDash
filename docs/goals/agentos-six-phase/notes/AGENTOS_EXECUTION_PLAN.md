# AgentOS — Six-Phase Execution Plan
**Planner:** Fable 5 · **Date:** 2026-06-12 · **Executor:** Claude Opus or Sonnet
**Repo:** `C:\Users\kruil\Documents\Projects\AgentDash` (directory and package name stay; UI may brand as "AgentOS")
**Locked decisions honored:** D1 extend-in-place · D2 build order Z1→Z2→Z4→Z5→Z3-upgrades→glue · D3 keep path/name · D4 read-only first, writes are later gated sub-steps · D5 keep JSON store (SQLite noted as future option only — do not plan it)

---

## 0. Up-Front Notes (read once, apply everywhere)

### 0.1 Dependencies
- **One new npm package maximum: `js-yaml`** (needed for Zone 2 `state.yaml` parsing). Before adding it, run `npm ls --depth=0` and check `package.json` — if any YAML parser is already present (e.g., as a transitive top-level dep), use that instead. Everything else uses built-ins: `child_process`, `fs`, `fs/promises`, `path`, `os`.
- Do **not** add: React, Vite, TypeScript, any bundler, any HTTP client lib, any glob lib (write a small recursive walker in `lib/` instead), any SQLite driver.

### 0.2 Do-Not-Touch List (hard guardrails)
1. `CodexBrain\` durable content — read-only everywhere. The **only** permitted write, ever, is the optional P6 append to `_brain\state\log.md` / `handoffs\` using their existing formats, behind a default-off flag.
2. `_brain\quality-gates\` internals — runner scripts, `warning-registry.md`, `index.md`. Read-only.
3. `CodexBrain\raw\imported\_brain-2026-06-09\...` — frozen migration snapshot. Never read it as live data; exclude it from every directory walk.
4. GoalBuddy internals — `state.yaml`, `goal.md`, `.goalbuddy-board\` are read-only. Never write a goal file.
5. Windows Task Scheduler — never `Register-ScheduledTask`, never modify or duplicate a job. The only future write is `Start-ScheduledTask` (P3-write, deferred, confirm-gated).
6. Existing AgentDash session/storage logic — untouched except the targeted P5 edits listed in P5.
7. Secrets stay in env (`AGENTDASH_USER`/`AGENTDASH_PASS`); nothing credential-like in code or `data.json`.

### 0.3 Shared Conventions (establish in P1, reuse in P2–P6)
- **Route error convention:** every new `/api/*` route always responds `200` with a body containing `"error": null` on success or `"error": { "code": string, "message": string }` on failure (missing dir, shell-out failure, parse failure). Lib modules never throw into Express — wrap in try/catch, return typed payloads. The server must never crash because a data source is absent.
- **TTL cache helper:** create `lib/cache.js` in P1 and reuse it everywhere a directory scan or shell-out is involved.
- **Frontend zone pattern (exact, matches existing code):** one sidebar nav item + one `<section class="view" id="view-<zone>">` in `public/index.html` + `render<Zone>()` / `load<Zone>()` fns in `public/app.js` + styles appended to `public/styles.css` reusing the existing card/badge/table classes and dark palette (#0b0d10/#181c22 surfaces, JetBrains Mono accents, per-agent color dots). No framework, no build step.
- **Polling discipline:** the existing 2000 ms poll stays for sessions+activity only. New zones fetch **on view-enter** plus a per-zone refresh interval **only while their view is active** (Projects/Goals/Inbox: 30 s; Schedules: 60 s — PowerShell shell-out is slow; Recall: on-demand only, never polled). Implement one `setActiveZonePolling(viewName)` helper in `app.js` that clears the previous zone interval and starts the new one.
- **Executor work rules:** read every file before editing it. Deliver each phase as **complete file replacements or a ZIP of all changed files — never partial snippets.** There are no automated tests in this repo: run `npm run app` (or `node server.js` + browser at `http://localhost:3001`) and click through every new view before declaring a phase done.

---

## P1 — Zone 1: Projects & Gate Health (read-only)

**Goal:** One "Projects" view rendering the newest quality-gate run: a global header (overall result + counts) and one color-coded card per `project_groups[]` entry.

### Files to CREATE

**`lib/cache.js`**
```js
// Tiny in-memory TTL cache for async producers.
module.exports = { ttl };
function ttl(producerFn, ttlMs)
// returns async wrapped(...args) -> cached value within ttlMs, else re-runs producerFn.
// also exposes wrapped.bust() to force refresh. Key on JSON.stringify(args).
```

**`lib/gates.js`**
```js
module.exports = { getProjectHealth };

const RUNS_DIR = 'C:\\Users\\kruil\\Documents\\Projects\\_brain\\quality-gates\\runs';

async function getProjectHealth()
// 1. findNewestRunFile(): fs.readdir RUNS_DIR, filter *.json, pick newest.
//    Primary sort key: the `started` field inside the JSON of the lexicographically
//    newest filenames; tie-break by file mtime. (Verify in 1.R below.)
// 2. parseRun(file): JSON.parse; tolerate missing keys with defaults.
// 3. rollupProjects(run): map project_groups[] -> card payload (shape in 1.D);
//    openWarnings per project = count of warnings[] where warning.project matches
//    the group AND registry_status is UNREGISTERED or REGISTERED_OPEN.
// 4. Wrapped in cache.ttl(..., 30_000).
// Returns the 1.D contract. On any failure returns { run:null, projects:[], error:{...} }.
```

### Files to EDIT

- **`server.js`** — mount one route next to the existing route block:
  `GET /api/projects` → `res.json(await gates.getProjectHealth())`. Add `const gates = require('./lib/gates')` with the other lib requires. Add the route to the printed/route list if one exists.

### Frontend changes

- **`public/index.html`** — sidebar: add nav item **"Projects"** (place it first, above Dashboard, per Zone 1 primacy — or after Dashboard if the existing active-view logic assumes Dashboard is index 0; executor checks `app.js` view switcher first). Add:
  ```html
  <section class="view" id="view-projects">
    <div id="projects-header"></div>   <!-- global result banner + counts -->
    <div id="projects-grid" class="card-grid"></div>
  </section>
  ```
- **`public/app.js`** — add `loadProjects()` (fetch `/api/projects`), `renderProjects(data)` (header banner: global `result` color-coded + counts; one card per project: name, per-project result badge, `changedFiles`, `gateCritical`, `openWarnings`, last-run time, a link rendered for `reportPath` — open via `file://` is unreliable in browsers, so render the path as click-to-copy text instead). Register the view in the switcher; wire `setActiveZonePolling('projects')` at 30 s.
- **`public/styles.css`** — add result classes mapping to the existing palette: `.result-PASS` (existing good/green), `.result-PASS_WITH_WARNINGS` (warn/amber), `.result-FAIL`/`.result-EXCEPTION` (bad/red), `.result-INCOMPLETE`/`.result-NOT_RUN`/`.result-MISSING_CONFIG` (dim/gray). Reuse `.card`, `.badge`, stat-card styles.

### 1.D Data contract — `GET /api/projects`
```json
{
  "run": {
    "runId": "…", "task": "…", "level": "…", "mode": "…",
    "started": "…", "finished": "…", "result": "PASS_WITH_WARNINGS",
    "counts": {
      "projects": 0, "pass": 0, "passWithWarnings": 0, "fail": 0,
      "missingConfig": 0, "notRun": 0, "openWarnings": 0
    },
    "reportPath": "…", "sourceFile": "…"
  },
  "projects": [
    {
      "key": "…", "label": "…", "projectPath": "…",
      "result": "PASS", "changedFiles": 0, "gateCritical": 0, "testCritical": 0,
      "openWarnings": 0, "hasConfig": true, "reportPath": "…", "notes": "…"
    }
  ],
  "error": null
}
```

### Acceptance checks
1. The Projects view lists **every** entry in the newest run's `project_groups[]`, color-coded by `per_project_gate_result`.
2. Global result + project counts **match `_brain\quality-gates\index.md`** (counts + recent-runs table) for the same run.
3. Renaming `RUNS_DIR` temporarily (simulate missing source) yields a friendly in-view error, server stays up.

### Risks / executor must verify BEFORE coding
- **1.R1:** Open 2–3 real run JSONs in `runs\`. Confirm filename timestamp convention vs `started` field; pin the newest-run selection rule.
- **1.R2:** Confirm `warnings[].project` values actually match `project_groups[].key` or `.label` (pick the real join key).
- **1.R3:** Confirm the run dir size; if it holds hundreds of files, the 30 s TTL cache + readdir-only (no full-content scan) approach in `gates.js` stands.

### Build order within P1
`lib/cache.js` → `lib/gates.js` (verify with a quick `node -e "require('./lib/gates').getProjectHealth().then(console.log)"`) → `server.js` route (curl it) → `index.html` + `app.js` + `styles.css` → click-through vs `index.md`.

---

## P2 — Zone 2: Active Goals (read-only)

**Goal:** A "Goals" view: one card per GoalBuddy goal across all projects (title, status, active task, task counts, last verification), with a detail modal listing the goal's tasks.

### Mandatory first step (before any code)
Open `C:\Users\kruil\Documents\Projects\ParseLord5\docs\goals\smart-mit-tank-cd-helper\state.yaml` **and** its `goal.md`. Pin the exact key names (the expected shape — `goal{title,slug,status,oracle}`, `tasks[]{id,type,status}`, `active_task`, `checks.last_verification` — is **unverified**). Write the discovered shape as a comment block at the top of `lib/goals.js`. Do not assume.

### Files to CREATE

**`lib/goals.js`**
```js
module.exports = { listGoals };

const PROJECTS_ROOT = 'C:\\Users\\kruil\\Documents\\Projects';
const EXCLUDE_DIRS = new Set(['node_modules', '.git', '.worktrees', 'imported',
                              '_brain-2026-06-09', 'dist', 'build', '.venv', 'venv']);

async function listGoals()
// 1. walkForGoalStates(): hand-rolled recursive walk of PROJECTS_ROOT, depth-capped
//    (suggest 6), skipping EXCLUDE_DIRS and anything under CodexBrain\raw\imported.
//    Match paths ending \docs\goals\<slug>\state.yaml.
// 2. parseGoal(file): js-yaml safeLoad; map to the 2.D shape using the keys pinned
//    in the mandatory first step; derive taskCounts by grouping tasks[].status.
// 3. project name = first path segment after PROJECTS_ROOT.
// 4. cache.ttl(..., 30_000). Per-file parse failures become per-goal
//    { parseError: "…" } entries, never a whole-route failure.
```

### Files to EDIT
- **`package.json`** — add `js-yaml` (only if no YAML parser already exists; see 0.1). `npm install js-yaml`.
- **`server.js`** — `GET /api/goals` → `goals.listGoals()`.

### Frontend changes
- **`public/index.html`** — nav item **"Goals"**; `<section class="view" id="view-goals"><div id="goals-grid" class="card-grid"></div></section>`; one reusable detail modal container `<div id="goal-modal" class="modal hidden">…</div>` (mirror the existing launch-modal markup pattern).
- **`public/app.js`** — `loadGoals()`, `renderGoals(data)` (card per goal: title, project tag, status badge, active-task one-liner, task-count pills by status, last-verification result), `openGoalModal(goal)` (task list table: id, type, status — **match the GoalBuddy board's card-per-task idiom**: one row/chip per task with a status color). 30 s zone polling.
- **`public/styles.css`** — `.goal-card`, status pills reusing badge styles; modal styles reuse launch-modal classes.

### 2.D Data contract — `GET /api/goals`
```json
{
  "goals": [
    {
      "project": "ParseLord5", "slug": "smart-mit-tank-cd-helper",
      "title": "…", "status": "…",
      "activeTask": { "id": "…", "type": "…", "status": "…" },
      "taskCounts": { "done": 0, "in_progress": 0, "pending": 0, "blocked": 0 },
      "lastVerification": { "result": "…", "at": "…" },
      "tasks": [ { "id": "…", "type": "…", "status": "…" } ],
      "statePath": "…", "goalDocPath": "…", "parseError": null
    }
  ],
  "scanned": { "rootsWalked": 0, "stateFilesFound": 0, "tookMs": 0 },
  "error": null
}
```
*(Field names inside `activeTask`/`tasks`/`taskCounts` adjust to the real `state.yaml` keys pinned in the first step — update this contract in the plan file if they differ, and keep frontend/backend in lockstep.)*

### Acceptance checks
1. The **smart-mit-tank-cd-helper** goal renders with the correct active task and task counts (cross-check by opening its `state.yaml`).
2. The walk finds goals in other projects if present, and finds **zero** under `node_modules`, `.git`, `.worktrees`, or the frozen import snapshot.
3. A deliberately broken YAML (test against a copy in a scratch dir, not a real goal file) renders as a card with a parse-error badge; route still returns the other goals.

### Risks / executor must verify
- **2.R1:** Real `state.yaml` key names (mandatory first step).
- **2.R2:** Walk cost over ~30 project dirs — confirm `tookMs` is acceptable (<1 s warm); if not, raise depth cap discipline or persist a found-paths memo inside the TTL cache entry.
- **2.R3:** Whether multiple goals per project exist and whether any `status` value indicates archived/done goals that should be visually de-emphasized (don't filter them out in v1; badge them).

### Build order within P2
Read real `state.yaml` → pin keys → `lib/goals.js` + node-eval test → route → UI → click-through against the known goal.

---

## P3 — Zone 4: Scheduled Routines (read-only)

**Goal:** A "Schedules" view: the six maintenance routines with state, last run, last result, next fire — sourced live from Windows Task Scheduler.

### Mandatory first step (before any code)
Discover the **real registered task names**. In PowerShell:
```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -match 'graphify|cognee|vault|archive' } |
  Select TaskName, TaskPath, State
```
The friendly labels (GraphifyWeekly Mon 03:00, CogneeDaily ~03:30, VaultAuditMonthly 1st 04:00, ArchiveWeekly Sun 04:00, ArchiveQuarterly, ArchiveAnnual — from `CodexBrain\sop-index.md` "Scheduled Routines") may differ from `TaskName`/`TaskPath`. Pin the mapping as a constant.

### Files to CREATE

**`lib/schedules.js`**
```js
module.exports = { getSchedules };

const ROUTINES = [ // label -> EXACT discovered TaskName/TaskPath (mandatory first step)
  { label: 'GraphifyWeekly',    taskName: '<pinned>', taskPath: '<pinned>' },
  { label: 'CogneeDaily',       taskName: '<pinned>', taskPath: '<pinned>' },
  { label: 'VaultAuditMonthly', taskName: '<pinned>', taskPath: '<pinned>' },
  { label: 'ArchiveWeekly',     taskName: '<pinned>', taskPath: '<pinned>' },
  { label: 'ArchiveQuarterly',  taskName: '<pinned>', taskPath: '<pinned>' },
  { label: 'ArchiveAnnual',     taskName: '<pinned>', taskPath: '<pinned>' }
];

async function getSchedules()
// ONE PowerShell shell-out for all routines (not six):
//   child_process.execFile('powershell.exe',
//     ['-NoProfile','-NonInteractive','-Command', SCRIPT], { timeout: 15000 })
// SCRIPT: foreach pinned name -> Get-ScheduledTask + Get-ScheduledTaskInfo,
//   emit [pscustomobject]{TaskName,TaskPath,State,LastRunTime,NextRunTime,LastTaskResult}
//   | ConvertTo-Json -AsArray (handle the single-item-not-array PS quirk in JS too).
// Map LastTaskResult: 0 -> ok; 267011 (0x41303, never run) -> neverRun; else error code hex.
// Dates: ConvertTo-Json emits /Date(ms)/ or ISO depending on PS version — normalize
//   to ISO in JS (verify actual format in 3.R1).
// cache.ttl(..., 60_000). Missing task -> per-routine { found:false }, not a route error.
// HARD RULE in this module: read-only cmdlets only. Never Register/Set/Unregister.
```

### Files to EDIT
- **`server.js`** — `GET /api/schedules` → `schedules.getSchedules()`.

### Frontend changes
- **`public/index.html`** — nav item **"Schedules"**; `<section class="view" id="view-schedules"><table id="schedules-table">…</table></section>` (table fits better than cards here; reuse the sessions-table classes).
- **`public/app.js`** — `loadSchedules()`, `renderSchedules(data)`: rows = label, task name (mono, dim), state badge (Ready/Running/Disabled), last run (relative time), last result (✓ / never-ran / hex code in red), next fire. Zone polling at 60 s.
- **`public/styles.css`** — state badges reuse existing status badge classes.

### 3.D Data contract — `GET /api/schedules`
```json
{
  "routines": [
    {
      "label": "GraphifyWeekly", "taskName": "…", "taskPath": "…",
      "found": true, "state": "Ready",
      "lastRunTime": "2026-06-08T03:00:11Z", "nextRunTime": "2026-06-15T03:00:00Z",
      "lastResult": { "code": 0, "ok": true, "neverRun": false }
    }
  ],
  "tookMs": 0,
  "error": null
}
```

### Deferred sub-step **P3-write** (plan now, build later, D4)
`POST /api/schedules/:label/run` → `Start-ScheduledTask` on the pinned name, **only after** read view is trusted. Frontend: a "Run now" button behind a confirm dialog stating the task name. Guardrail restated in code comment: trigger-only; never create/duplicate jobs. Not part of P3 acceptance.

### Acceptance checks
1. All **six** routines render with state + last/next run; values match `Get-ScheduledTaskInfo` run manually for one of them.
2. A routine whose task is missing/renamed shows a "not found" row; route still returns the other five.
3. Two rapid view entries within 60 s cause exactly **one** PowerShell shell-out (cache verified via a temporary console.log).

### Risks / executor must verify
- **3.R1:** `ConvertTo-Json` date format on this machine's PowerShell (5.1 vs 7.x) — run the script once standalone and look.
- **3.R2:** Real task names/paths (mandatory first step).
- **3.R3:** Shell-out latency; if >2 s, keep 60 s TTL and consider warming the cache on server boot.

### Build order within P3
PS discovery → pin `ROUTINES` → standalone-test the PS script → `lib/schedules.js` → route → UI → click-through.

---

## P4 — Zone 5: Recall + Inbox (read-only)

**Goal:** (a) a "Recall" view with a search box that shells the existing recall script and renders ranked hits; (b) an "Inbox" view listing the queued files in `Projects\inbox\` with counts.

### Mandatory first step (before any code)
Run the existing recall entry point once by hand with a known query, e.g.:
```powershell
powershell -NoProfile -File C:\Users\kruil\Documents\Projects\CodexBrain\recall.ps1 "test query"
```
(Existing entry points, in preference order: `CodexBrain\recall.ps1`, root `recall.ps1`/`recall.cmd`, `CodexBrain\scripts\local_recall.py`.) Record the **exact stdout format** (plain lines? path:snippet? JSON?) — the parser in `lib/recall.js` is written against that observed format, and a copy of a sample output goes in a comment at the top of the module. **Prefer shelling the existing script over opening `CodexBrain\state\local-recall.sqlite` directly** — indexing logic stays single-sourced, and it keeps us at zero SQLite deps (D5-consistent).

### Files to CREATE

**`lib/recall.js`**
```js
module.exports = { search };

const RECALL_ENTRY = '<pinned in first step>';
const COGNEE_ENABLED = process.env.AGENTOS_COGNEE === '1'; // default OFF (flagged unhealthy)

async function search(query)
// Validate query (non-empty, length cap 200). execFile powershell/python per pinned
// entry point, args = [query], timeout 20s, maxBuffer 4MB.
// parseResults(stdout): per the observed format -> [{ path, snippet, rank }].
// Never interpolate the query into a shell string — always argv array (injection-safe).
// No caching (on-demand, query-keyed results are low-value to cache).
// If COGNEE_ENABLED, this is where a future semantic pass would hang — leave a
// commented stub only; do not implement.
```

**`lib/inbox.js`**
```js
module.exports = { listInbox };

const INBOX_ROOT = 'C:\\Users\\kruil\\Documents\\Projects\\inbox';

async function listInbox()
// readdir INBOX_ROOT: top-level files + one level of subfolders (expect scans/drafts/
// ideas per the routing cheatsheet; discover whatever actually exists, don't hardcode).
// Skip README*. Per file: { name, relPath, size, mtime }. Per folder: { name, count, files[] }.
// cache.ttl(..., 30_000). Missing root -> { folders:[], total:0, error:{code:'NO_INBOX'...} }.
```

### Files to EDIT
- **`server.js`** — `GET /api/recall?q=` → `recall.search(req.query.q)`; `GET /api/inbox` → `inbox.listInbox()`.

### Frontend changes
- **`public/index.html`** — **two** nav items, **"Recall"** and **"Inbox"**. Recall view: search input + button + results list container. Inbox view: folder sections with file tables.
- **`public/app.js`** — Recall: submit handler → `fetch('/api/recall?q='+encodeURIComponent(q))` → `renderRecallResults()` (path as click-to-copy mono text + snippet, ranked order; show `tookMs`); **no polling**. Inbox: `loadInbox()`/`renderInbox()` (folder header with count pill + rows: name, size, mtime relative); 30 s zone polling.
- **`public/styles.css`** — `.recall-result` (mono path, dim snippet), count pills.

### 4.D Data contracts
`GET /api/recall?q=…`
```json
{ "query": "…", "engine": "fts5",
  "results": [ { "path": "…", "snippet": "…", "rank": 1 } ],
  "tookMs": 0, "error": null }
```
`GET /api/inbox`
```json
{ "root": "C:\\Users\\kruil\\Documents\\Projects\\inbox",
  "folders": [ { "name": "scans", "count": 0, "files": [ { "name": "…", "relPath": "…", "size": 0, "mtime": "…" } ] } ],
  "looseFiles": [ ], "total": 0, "error": null }
```

### Deferred sub-step **P4-write** (plan now, build later, D4)
Inbox triage = moving files between inbox subfolders / out to project dirs. `POST /api/inbox/move { relPath, dest }`, confirm-gated in UI, allowlist of destination roots. Not part of P4 acceptance.

### Acceptance checks
1. A query known to exist in the recall index returns ranked hits whose paths open to real files; output matches running the script by hand.
2. Inbox view shows the current folder structure and counts; dropping a test file into `inbox\` appears within one refresh.
3. An empty/missing query returns a clean validation error, not a shell-out.
4. With `AGENTOS_COGNEE` unset, no Cognee code path executes.

### Risks / executor must verify
- **4.R1:** Recall script stdout format + exit codes (mandatory first step). If the script proves interactive-only, fall back to `scripts\local_recall.py` via `python`; verify python is on PATH.
- **4.R2:** Recall latency — if >3 s, show a spinner state in the Recall view (simple "Searching…" text swap).
- **4.R3:** Actual inbox subfolder names.

### Build order within P4
Recall by hand → pin format → `lib/recall.js` + node-eval test → `lib/inbox.js` → routes → UIs → click-through.

---

## P5 — Zone 3 Upgrades: Hermes Agent, Resume, Interrupt

**Goal:** Add Hermes to the agent registry; add native session **resume** (relaunch an agent with its own resume mechanism, persisting agent-native session ids on the session record); add **interrupt** (Ctrl-C to the pty) distinct from kill.

### Mandatory first steps (before any code)
1. Verify the Hermes binary: does `C:\Users\kruil\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe acp` start an interactive session in a plain PowerShell window? If not, test `hermes.cmd`. Pin the working command. Note its resume flag by running `hermes --help` (expected `--resume`, verify).
2. Verify Claude Code resume semantics on this install: run `claude --help`; confirm `--continue` (resume most recent session in cwd) and `--resume <sessionId>` / `-r` exist. Launch one short session and check whether a session id is visible in interactive output (it usually is **not** in interactive mode — which is why the fallback below exists).

### Files to EDIT (this phase is edits-only; no new lib modules)

**`lib/sessions.js`** — four targeted changes:
1. **AGENTS registry:** add
   ```js
   hermes: { name: 'Hermes', cmd: '<pinned hermes command> ', color: '#a78bfa',
             resume: { byId: '<cmd> --resume {id}', latest: null } }
   ```
   and extend the existing entries with a `resume` descriptor:
   `claude: { …, resume: { byId: 'claude --resume {id}', latest: 'claude --continue' } }`. Agents with no known resume support get `resume: null` (codex/opencode/kimi/agy — verify each with `--help`; set honestly).
2. **Session record fields** (additive to the storage shape — `lib/storage.js` is schema-less JSON, so no storage.js edit needed): `nativeSessionId: null`, `resumable: bool` (derived from agent's `resume` descriptor), `resumedFrom: sessionId|null`.
3. **`interrupt(id)`** export: look up live pty, `pty.write('\x03')`. Does **not** dispose the pty, does not change session status. Returns `{ ok }`.
4. **`resumeSession(id)`** export: load the (exited or live-but-stale) record; build the resume command — `resume.byId` with `{id}` if `nativeSessionId` is set, else `resume.latest` (for claude, `--continue` keyed on the same `cwd` — this is the **reliable baseline** since interactive Claude doesn't print its session id), else error `NOT_RESUMABLE`. Spawn through the existing spawn path (same PowerShell bootstrap, same ring/parser/log wiring) with the original `cwd`; new record gets `resumedFrom: <old id>`.
5. **Native session-id capture (best-effort enhancement):** in the spawn path, register a one-shot regex listener on early pty output per agent (`claude`: UUID pattern if `--resume` picker or any banner exposes it; `hermes`: verify what it prints). If captured, set `nativeSessionId` via `storage.updateSession`. If nothing matches in the first ~200 lines, leave null — `latest`-mode resume still works for claude/hermes-if-supported. Do not block or delay spawn on this.

**`lib/activity.js`** — only if the capture regexes fit naturally into `ActivityParser`; otherwise leave untouched and keep capture inside `sessions.js`. Executor's call after reading both files.

**`server.js`** — two routes:
- `POST /api/sessions/:id/interrupt` → `sessions.interrupt(id)`
- `POST /api/sessions/:id/resume` → `sessions.resumeSession(id)` → returns the **new** session record `{ session, error }`.

**`public/index.html`** — detail view: add **Interrupt** button next to the existing kill control. Sessions table: add **Resume** action on rows where `resumable && !isLive`.

**`public/app.js`** — wire both buttons; on resume success, navigate to the new session's detail view (existing detail-open code path). Add the Hermes color dot to the agent color map if it's frontend-side.

**`public/styles.css`** — Hermes accent color (#a78bfa or pick an unused hue), Interrupt button style (amber, visually distinct from kill-red).

### 5.D Data contract — `POST /api/sessions/:id/resume`
```json
{ "session": { "id": 0, "agentKey": "claude", "cwd": "…", "resumedFrom": 0,
               "nativeSessionId": null, "isLive": true },
  "mode": "byId | latest", "error": null }
```

### Acceptance checks
1. Hermes appears in the launch modal, spawns, streams output in the terminal, accepts input, and is killable — same bar as existing agents.
2. **Resume:** start a claude session in a test cwd, exit it, click Resume → a new session opens with `claude --continue` in the same cwd and the prior conversation context is visibly restored. Same test for Hermes if its resume flag verified.
3. **Interrupt:** during a long-running agent operation, Interrupt stops the operation (agent shows its interrupted state) but the session stays live and accepts further input; Kill still fully terminates.
4. `data.json` records show the new fields; `reconcileOnBoot()` still works (restart the server with a live session and confirm dead-PID marking is unaffected).

### Risks / executor must verify
- **5.R1:** Exact Hermes command + resume flag (mandatory first step). If Hermes has no resume, ship it with `resume: null` and say so in the phase report — do not fake it.
- **5.R2:** Whether `\x03` reaches the agent or is eaten by the PowerShell host shell — test interactively; if the shell intercepts, write `\x03` may still propagate via conpty (node-pty uses ConPTY on Win11) — verify empirically, this is the phase's biggest unknown.
- **5.R3:** Session-id capture regex viability per agent — best-effort only; `latest` mode is the guaranteed path for claude.
- **5.R4:** `--continue` resumes the most recent session **for that cwd** — if two AgentDash sessions shared a cwd, resume may pick the newer one. Acceptable for v1; note it in the UI tooltip.

### Build order within P5
Verify Hermes + claude flags → AGENTS entry + spawn smoke test → interrupt (smallest change, test it) → resume `latest` mode → resume `byId` + capture → routes → UI → full acceptance pass.

---

## P6 — Cross-Zone Glue

**Goal:** One click from a Zone 1 project card or Zone 2 goal card opens the Zone 3 launch modal pre-filled with that project's cwd (and optionally a prefilled prompt). Optional, flag-gated run-summary append to `_brain\state\log.md`.

### Files to EDIT

**`public/app.js`**
1. Refactor the existing launch-modal opener into `openLaunchModal(prefill = {})` where `prefill = { cwd?, agentKey?, prompt? }`: sets the cwd input value, preselects the agent if given, and stores `prefill.prompt` on the modal element's dataset.
2. After a spawn initiated from a prefilled modal succeeds **and** `prompt` was provided: send the prompt as a normal input write (`POST /api/sessions/:id/input`) after a **settle delay** (default 4000 ms, constant at top of file) so the agent's REPL is up. Show a small "queued prompt will be sent in 4 s — cancel" affordance, because blind-firing into a booting agent is the known weak point. (If this proves flaky in testing, ship cwd-prefill only and leave prompt-prefill behind a UI checkbox default-off.)
3. Zone 1 `renderProjects()`: add a **"Launch agent"** button per card → `openLaunchModal({ cwd: project.projectPath })`.
4. Zone 2 `renderGoals()`: same button per goal card → `openLaunchModal({ cwd: <project root of that goal>, prompt: 'Open goal: ' + goal.slug })` — prompt text is a starting suggestion; keep it editable in the modal.

**`public/index.html`** — launch modal: add an optional **"Initial prompt"** textarea (collapsed/secondary styling) so prefilled prompts are visible and editable before launch.

**Optional flag-gated sub-step — `lib/brainlog.js`** (only if Luis turns it on)
```js
module.exports = { appendRunSummary };
// Enabled only when process.env.AGENTOS_BRAINLOG === '1' (default OFF).
// MANDATORY first step: read _brain\state\log.md and handoffs\ to copy the EXACT
// existing entry format — append-only, matching format, never restructure.
// appendRunSummary({ ts, sessionId, agentKey, cwd, summaryLine }) -> fs.appendFile.
```
Called (when enabled) from the session-exit path in `sessions.js` with a one-line summary. This is the **only** sanctioned `_brain` write in the entire system (per 0.2 item 1).

### Data contract
No new routes required for the core glue (it is frontend composition over existing `POST /api/sessions`). If brainlog ships: no route either — it's an internal hook.

### Acceptance checks
1. From a Projects card: one click → launch modal opens with that project's path already in the cwd field → launching lands a live session in that cwd.
2. Same from a Goals card, with the editable prefilled prompt visible; after launch + settle delay the prompt appears in the agent terminal as sent input.
3. With `AGENTOS_BRAINLOG` unset, zero writes occur anywhere under `_brain` (verify by mtime check after a full session lifecycle).

### Risks / executor must verify
- **6.R1:** Settle delay sufficiency varies by agent boot time — test claude and hermes; make the constant per-agent if needed.
- **6.R2:** If brainlog is enabled: the exact `log.md` entry format (mandatory read-first).

### Build order within P6
`openLaunchModal` refactor (regression-test the existing plain launch first) → cwd-prefill buttons (Z1 then Z2) → prompt-prefill + settle → optional brainlog last.

---

## Cross-Phase Dependency & Risk Summary

| Phase | Depends on | Biggest risk | Mitigation |
|---|---|---|---|
| P1 | — | run-JSON join key for warnings (1.R2) | read real files first |
| P2 | P1 (cache.js, conventions) | unverified `state.yaml` keys | mandatory read-first step |
| P3 | P1 (conventions) | task-name mismatch, PS JSON dates | mandatory discovery step |
| P4 | P1 (conventions) | recall stdout format unknown | mandatory run-by-hand step |
| P5 | none of P1–P4 (touches Zone 3 only) | Ctrl-C propagation through ConPTY (5.R2) | empirical test before building resume |
| P6 | P1, P2, P5 | prompt-prefill timing | settle delay + cancel affordance; cwd-only fallback |

**Executor delivery convention (restated):** every phase ships as complete file replacements or a ZIP of all changed files — never partial snippets. Read every file before editing. Verify in the running app (`npm run app` → click through the new view) before marking a phase complete. Tag/commit the working state before starting the next phase.
