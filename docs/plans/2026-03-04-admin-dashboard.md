# Admin Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the duplicate library page at `/admin` with a genuine operations dashboard (Activity + Storage tabs), adding new API endpoints to surface audit log and storage data.

**Architecture:** Two files modified: `docker/meta-server.js` (new API endpoints + audit gap fixes) and `docker/admin.html` (full rewrite as tabbed dashboard SPA). No build step, no framework — vanilla JS, self-contained HTML served by meta-server.js. Dark theme, hash-based tab navigation.

**Tech Stack:** Node.js HTTP server (meta-server.js), SQLite (better-sqlite3), vanilla JS/CSS/HTML

**Design doc:** `docs/plans/2026-03-04-admin-dashboard-design.md`

---

## Task 1: Add audit entries for regenerate and chunk completion

**Files:**
- Modify: `docker/meta-server.js:724-766` (handleRegenerateArchive)
- Modify: `docker/meta-server.js:1127-1154` (handleCompleteChunk, inside the DB insert block)

**Step 1: Add audit log entry to handleRegenerateArchive**

In `docker/meta-server.js`, after the DB UPDATE statement runs (after line 762, before `const updatedRow`), add:

```js
    db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
      .run(
        req.headers['cf-access-authenticated-user-email'] || 'unknown',
        'regenerate',
        hash,
        JSON.stringify({ filename: row.filename }),
        req.headers['x-real-ip'] || null
      );
```

**Step 2: Add audit log entry to handleCompleteChunk**

In `docker/meta-server.js`, after the DB INSERT/UPSERT runs (after line 1151, before `const assembledRow`), add:

```js
        db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
          .run(
            req.headers['cf-access-authenticated-user-email'] || 'unknown',
            'upload',
            chunkHash,
            JSON.stringify({ filename, size: fs.statSync(finalPath).size, chunked: true }),
            req.headers['x-real-ip'] || null
          );
```

**Step 3: Verify no syntax errors**

Run: `node -c docker/meta-server.js`
Expected: No output (clean parse)

**Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "fix: add audit log entries for regenerate and chunked upload"
```

---

## Task 2: Add GET /api/audit-log endpoint

**Files:**
- Modify: `docker/meta-server.js` — new handler function + route registration

**Step 1: Add handleAuditLog function**

Add this function after `handleListArchives` (after line 594):

```js
/**
 * GET /api/audit-log — paginated, filterable audit log
 */
function handleAuditLog(req, res) {
    if (!requireAuth(req, res)) return;
    try {
        const parsed = url.parse(req.url, true);
        const q = parsed.query;
        const limit = Math.min(Math.max(parseInt(q.limit) || 50, 1), 200);
        const offset = Math.max(parseInt(q.offset) || 0, 0);

        let where = [];
        let params = [];
        if (q.actor) { where.push('actor = ?'); params.push(q.actor); }
        if (q.action) { where.push('action = ?'); params.push(q.action); }
        if (q.from) { where.push('created_at >= ?'); params.push(q.from); }
        if (q.to) { where.push('created_at <= ?'); params.push(q.to); }

        const whereClause = where.length ? ' WHERE ' + where.join(' AND ') : '';
        const total = db.prepare('SELECT COUNT(*) as cnt FROM audit_log' + whereClause).get(...params).cnt;
        const entries = db.prepare(
            'SELECT * FROM audit_log' + whereClause + ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(...params, limit, offset);

        // Also return distinct actors and actions for filter dropdowns
        const actors = db.prepare('SELECT DISTINCT actor FROM audit_log ORDER BY actor').all().map(r => r.actor);
        const actions = db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all().map(r => r.action);

        sendJson(res, 200, { entries, total, limit, offset, actors, actions });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}
```

**Step 2: Register the route**

In the admin routes block (around line 1191), add after the `GET /api/archives` route:

```js
        if (pathname === '/api/audit-log' && req.method === 'GET') {
            return handleAuditLog(req, res);
        }
```

**Step 3: Verify no syntax errors**

Run: `node -c docker/meta-server.js`
Expected: No output (clean parse)

**Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat: add GET /api/audit-log endpoint with pagination and filters"
```

---

## Task 3: Add GET /api/storage endpoint

**Files:**
- Modify: `docker/meta-server.js` — new handler function + route registration

**Step 1: Add handleStorage function**

Add after `handleAuditLog`:

```js
/**
 * GET /api/storage — storage overview with orphan detection
 */
function handleStorage(req, res) {
    if (!requireAuth(req, res)) return;
    try {
        const archives = db.prepare(
            'SELECT hash, filename, size, asset_types, created_at FROM archives ORDER BY size DESC'
        ).all();

        const totalUsed = archives.reduce((sum, r) => sum + (r.size || 0), 0);

        // Disk stats (Node 18.15+)
        let diskFree = null, diskTotal = null;
        try {
            const stats = fs.statfsSync(ARCHIVES_DIR);
            diskTotal = stats.bsize * stats.blocks;
            diskFree = stats.bsize * stats.bfree;
        } catch {}

        // DB file size
        let dbSize = null;
        try { dbSize = fs.statSync(DB_PATH).size; } catch {}

        // Orphan detection: files in archives dir not in DB
        const dbFilenames = new Set(archives.map(a => a.filename));
        let orphans = [];
        try {
            const files = fs.readdirSync(ARCHIVES_DIR);
            for (const f of files) {
                if (!dbFilenames.has(f)) {
                    try {
                        const stat = fs.statSync(path.join(ARCHIVES_DIR, f));
                        if (stat.isFile()) {
                            orphans.push({ filename: f, size: stat.size });
                        }
                    } catch {}
                }
            }
        } catch {}

        sendJson(res, 200, { archives, totalUsed, diskFree, diskTotal, dbSize, orphans });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}
```

**Step 2: Register the route**

In the admin routes block, add after the audit-log route:

```js
        if (pathname === '/api/storage' && req.method === 'GET') {
            return handleStorage(req, res);
        }
```

**Step 3: Verify no syntax errors**

Run: `node -c docker/meta-server.js`
Expected: No output (clean parse)

**Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat: add GET /api/storage endpoint with orphan detection"
```

---

## Task 4: Add DELETE /api/storage/orphans/:filename endpoint

**Files:**
- Modify: `docker/meta-server.js` — new handler function + route registration

**Step 1: Add handleDeleteOrphan function**

Add after `handleStorage`:

```js
/**
 * DELETE /api/storage/orphans/:filename — remove an orphaned archive file
 */
function handleDeleteOrphan(req, res, filename) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;

    // Validate filename: no path separators, must end with archive extension
    if (/[\/\\]/.test(filename) || !(filename.endsWith('.a3d') || filename.endsWith('.a3z'))) {
        return sendJson(res, 400, { error: 'Invalid filename' });
    }

    const filePath = path.join(ARCHIVES_DIR, filename);

    // Path traversal protection
    try {
        const realPath = fs.realpathSync(filePath);
        const realArchivesDir = fs.realpathSync(ARCHIVES_DIR);
        if (!realPath.startsWith(realArchivesDir + '/') && realPath !== realArchivesDir) {
            return sendJson(res, 403, { error: 'Access denied' });
        }
    } catch {
        return sendJson(res, 404, { error: 'File not found' });
    }

    // Verify it's actually an orphan (not in DB)
    const row = db.prepare('SELECT id FROM archives WHERE filename = ?').get(filename);
    if (row) {
        return sendJson(res, 409, { error: 'File is tracked in database — not an orphan' });
    }

    try { fs.unlinkSync(filePath); } catch (err) {
        return sendJson(res, 500, { error: 'Failed to delete: ' + err.message });
    }

    const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
    db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
      .run(actor, 'delete_orphan', filename, JSON.stringify({ orphan: true }), req.headers['x-real-ip'] || null);

    sendJson(res, 200, { deleted: true, filename });
}
```

**Step 2: Register the route**

In the admin routes block, add after the storage route:

```js
        const orphanMatch = pathname.match(/^\/api\/storage\/orphans\/(.+)$/);
        if (orphanMatch && req.method === 'DELETE') {
            return handleDeleteOrphan(req, res, decodeURIComponent(orphanMatch[1]));
        }
```

**Step 3: Verify no syntax errors**

Run: `node -c docker/meta-server.js`
Expected: No output (clean parse)

**Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat: add DELETE /api/storage/orphans endpoint for orphan cleanup"
```

---

## Task 5: Rewrite admin.html — shell, stats bar, and tab navigation

**Files:**
- Rewrite: `docker/admin.html`

This is the largest task. Build the HTML/CSS/JS shell with stats bar and tab navigation. The Activity and Storage tab content will be added in Tasks 6 and 7.

**Step 1: Write the new admin.html**

Replace the entire file with the dashboard shell. Key structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vitrine3D — Admin</title>
<style>
/* Reuse the existing CSS custom properties from the current admin.html
   (--bg-deep, --bg-panel, --bg-surface, --accent, --text-primary, etc.)
   These are already a dark theme and well-designed. */

/* Header bar: site name left, user email right */
/* Stats bar: 4 stat cards in a flex row */
/* Tab nav: horizontal buttons with .active state */
/* Tab content: divs toggled via .active class */
/* Table styles for audit log */
/* Progress bar for disk usage */
/* Filter bar styles */
</style>
</head>
<body>
    <header class="header">
        <span class="header-title">Vitrine3D Admin</span>
        <span class="header-user" id="header-user"></span>
    </header>

    <div class="stats-bar" id="stats-bar">
        <div class="stat-card">
            <span class="stat-label">Archives</span>
            <span class="stat-value" id="stat-archives">—</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Storage Used</span>
            <span class="stat-value" id="stat-storage">—</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Last Activity</span>
            <span class="stat-value" id="stat-last-activity">—</span>
        </div>
        <div class="stat-card">
            <span class="stat-label">Database</span>
            <span class="stat-value" id="stat-db-size">—</span>
        </div>
    </div>

    <nav class="tab-nav">
        <button class="tab-btn active" data-tab="activity">Activity</button>
        <button class="tab-btn" data-tab="storage">Storage</button>
        <button class="tab-btn disabled" data-tab="system" title="Coming soon">System</button>
        <button class="tab-btn disabled" data-tab="settings" title="Coming soon">Settings</button>
    </nav>

    <main>
        <div class="tab-content active" id="tab-activity">
            <!-- Filled in Task 6 -->
        </div>
        <div class="tab-content" id="tab-storage">
            <!-- Filled in Task 7 -->
        </div>
        <div class="tab-content" id="tab-system">
            <div class="placeholder">System monitoring — coming in Phase 2</div>
        </div>
        <div class="tab-content" id="tab-settings">
            <div class="placeholder">Settings — coming in Phase 2</div>
        </div>
    </main>

<script>
    // --- Auth & CSRF ---
    let csrfToken = '';
    async function initAuth() {
        const meRes = await fetch('/api/me');
        if (!meRes.ok) { document.body.innerHTML = '<h1>Unauthorized</h1>'; return; }
        const me = await meRes.json();
        document.getElementById('header-user').textContent = me.email;
        const csrfRes = await fetch('/api/csrf-token');
        if (csrfRes.ok) csrfToken = (await csrfRes.json()).token;
    }

    // --- Tab Navigation ---
    function initTabs() {
        const btns = document.querySelectorAll('.tab-btn:not(.disabled)');
        btns.forEach(btn => btn.addEventListener('click', () => {
            document.querySelector('.tab-btn.active')?.classList.remove('active');
            document.querySelector('.tab-content.active')?.classList.remove('active');
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab)?.classList.add('active');
            location.hash = btn.dataset.tab;
        }));
        // Restore tab from hash
        const hash = location.hash.slice(1);
        if (hash && document.getElementById('tab-' + hash)) {
            const btn = document.querySelector(`[data-tab="${hash}"]`);
            if (btn && !btn.classList.contains('disabled')) btn.click();
        }
    }

    // --- Stats Bar ---
    async function loadStats() { /* fetches /api/storage + /api/audit-log?limit=1 */ }

    // --- Formatting helpers ---
    function formatBytes(bytes) { /* human-readable size */ }
    function timeAgo(isoString) { /* relative timestamp */ }

    // --- Init ---
    (async () => {
        await initAuth();
        initTabs();
        await loadStats();
        // Tab-specific loaders called from Task 6 and 7
    })();
</script>
</body>
</html>
```

**Important CSS notes:** Reuse the existing CSS custom properties from the current `docker/admin.html` (lines 7-36) — they're already a well-designed dark theme with `--bg-deep`, `--bg-panel`, `--bg-surface`, `--accent`, `--text-primary`, `--text-secondary`, `--danger`, etc. Keep these verbatim.

**Step 2: Verify the file is valid HTML**

Open `docker/admin.html` in a browser locally (it won't have API endpoints, but structure should render).

**Step 3: Commit**

```bash
git add docker/admin.html
git commit -m "feat: rewrite admin.html as tabbed dashboard shell with stats bar"
```

---

## Task 6: Implement Activity tab UI

**Files:**
- Modify: `docker/admin.html` — fill in `#tab-activity` content and JS

**Step 1: Add Activity tab HTML**

Inside `<div class="tab-content active" id="tab-activity">`:

```html
<div class="filter-bar">
    <select id="filter-action"><option value="">All actions</option></select>
    <select id="filter-actor"><option value="">All users</option></select>
    <input type="date" id="filter-from" title="From date">
    <input type="date" id="filter-to" title="To date">
    <label class="auto-refresh">
        <input type="checkbox" id="auto-refresh" checked> Auto-refresh
    </label>
</div>
<table class="audit-table">
    <thead>
        <tr>
            <th>Time</th>
            <th>User</th>
            <th>Action</th>
            <th>Target</th>
            <th>Details</th>
        </tr>
    </thead>
    <tbody id="audit-body"></tbody>
</table>
<div class="pagination">
    <button id="audit-prev" disabled>Previous</button>
    <span id="audit-info"></span>
    <button id="audit-next" disabled>Next</button>
</div>
```

**Step 2: Add Activity tab JavaScript**

Add these functions to the `<script>` block:

```js
let auditOffset = 0;
const AUDIT_LIMIT = 50;
let autoRefreshTimer = null;

async function loadAuditLog() {
    const params = new URLSearchParams({ limit: AUDIT_LIMIT, offset: auditOffset });
    const action = document.getElementById('filter-action').value;
    const actor = document.getElementById('filter-actor').value;
    const from = document.getElementById('filter-from').value;
    const to = document.getElementById('filter-to').value;
    if (action) params.set('action', action);
    if (actor) params.set('actor', actor);
    if (from) params.set('from', from + 'T00:00:00');
    if (to) params.set('to', to + 'T23:59:59');

    const res = await fetch('/api/audit-log?' + params);
    if (!res.ok) return;
    const data = await res.json();

    // Populate filter dropdowns (only on first load)
    populateFilterDropdowns(data.actors, data.actions);

    // Render table rows
    const tbody = document.getElementById('audit-body');
    tbody.innerHTML = data.entries.map(e => `
        <tr>
            <td title="${e.created_at}">${timeAgo(e.created_at)}</td>
            <td>${escapeHtml(e.actor)}</td>
            <td><span class="badge badge-${e.action}">${e.action}</span></td>
            <td class="mono">${escapeHtml(e.target || '—')}</td>
            <td class="detail">${e.detail ? escapeHtml(e.detail) : '—'}</td>
        </tr>
    `).join('');

    // Pagination
    const showing = Math.min(data.offset + data.limit, data.total);
    document.getElementById('audit-info').textContent =
        `${data.offset + 1}–${showing} of ${data.total}`;
    document.getElementById('audit-prev').disabled = data.offset === 0;
    document.getElementById('audit-next').disabled = data.offset + data.limit >= data.total;
}

function populateFilterDropdowns(actors, actions) { /* populate select options */ }

function setupAutoRefresh() {
    const cb = document.getElementById('auto-refresh');
    function toggle() {
        clearInterval(autoRefreshTimer);
        if (cb.checked) autoRefreshTimer = setInterval(loadAuditLog, 30000);
    }
    cb.addEventListener('change', toggle);
    toggle();
}

// Wire up filter changes and pagination
document.getElementById('filter-action').addEventListener('change', () => { auditOffset = 0; loadAuditLog(); });
document.getElementById('filter-actor').addEventListener('change', () => { auditOffset = 0; loadAuditLog(); });
document.getElementById('filter-from').addEventListener('change', () => { auditOffset = 0; loadAuditLog(); });
document.getElementById('filter-to').addEventListener('change', () => { auditOffset = 0; loadAuditLog(); });
document.getElementById('audit-prev').addEventListener('click', () => { auditOffset = Math.max(0, auditOffset - AUDIT_LIMIT); loadAuditLog(); });
document.getElementById('audit-next').addEventListener('click', () => { auditOffset += AUDIT_LIMIT; loadAuditLog(); });
```

**Step 3: Add action badge CSS**

```css
.badge { padding: 1px 6px; border-radius: 2px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
.badge-upload { background: rgba(90, 158, 151, 0.2); color: var(--accent-text); }
.badge-delete { background: rgba(196, 92, 92, 0.2); color: var(--danger); }
.badge-rename { background: rgba(196, 160, 92, 0.2); color: var(--warning); }
.badge-regenerate { background: rgba(140, 140, 180, 0.2); color: #aab; }
.badge-delete_orphan { background: rgba(196, 92, 92, 0.15); color: #c88; }
```

**Step 4: Commit**

```bash
git add docker/admin.html
git commit -m "feat: implement Activity tab with filterable audit log viewer"
```

---

## Task 7: Implement Storage tab UI

**Files:**
- Modify: `docker/admin.html` — fill in `#tab-storage` content and JS

**Step 1: Add Storage tab HTML**

Inside `<div class="tab-content" id="tab-storage">`:

```html
<div class="storage-overview">
    <div class="disk-usage">
        <div class="disk-label">
            <span>Disk Usage</span>
            <span id="disk-usage-text">—</span>
        </div>
        <div class="disk-bar">
            <div class="disk-fill" id="disk-fill"></div>
        </div>
    </div>
</div>

<h3 class="section-title">Archives by Size</h3>
<table class="storage-table">
    <thead>
        <tr>
            <th>Filename</th>
            <th>Size</th>
            <th>Assets</th>
            <th>Created</th>
        </tr>
    </thead>
    <tbody id="storage-body"></tbody>
</table>

<div id="orphan-section" style="display:none">
    <h3 class="section-title warning-title">Orphaned Files</h3>
    <p class="orphan-desc">Files in the archives directory with no database record.</p>
    <table class="storage-table">
        <thead>
            <tr>
                <th>Filename</th>
                <th>Size</th>
                <th></th>
            </tr>
        </thead>
        <tbody id="orphan-body"></tbody>
    </table>
</div>
```

**Step 2: Add Storage tab JavaScript**

```js
async function loadStorage() {
    const res = await fetch('/api/storage');
    if (!res.ok) return;
    const data = await res.json();

    // Disk usage bar
    if (data.diskTotal) {
        const used = data.diskTotal - data.diskFree;
        const pct = (used / data.diskTotal * 100).toFixed(1);
        document.getElementById('disk-usage-text').textContent =
            `${formatBytes(used)} / ${formatBytes(data.diskTotal)} (${pct}%)`;
        const fill = document.getElementById('disk-fill');
        fill.style.width = pct + '%';
        fill.classList.toggle('warning', parseFloat(pct) > 80);
        fill.classList.toggle('danger', parseFloat(pct) > 95);
    }

    // Archive table
    document.getElementById('storage-body').innerHTML = data.archives.map(a => `
        <tr>
            <td class="mono">${escapeHtml(a.filename)}</td>
            <td>${formatBytes(a.size)}</td>
            <td>${formatAssetTypes(a.asset_types)}</td>
            <td title="${a.created_at}">${new Date(a.created_at).toLocaleDateString()}</td>
        </tr>
    `).join('');

    // Orphans
    const orphanSection = document.getElementById('orphan-section');
    if (data.orphans.length > 0) {
        orphanSection.style.display = '';
        document.getElementById('orphan-body').innerHTML = data.orphans.map(o => `
            <tr>
                <td class="mono">${escapeHtml(o.filename)}</td>
                <td>${formatBytes(o.size)}</td>
                <td><button class="btn-danger-sm" onclick="deleteOrphan('${escapeHtml(o.filename)}')">Remove</button></td>
            </tr>
        `).join('');
    } else {
        orphanSection.style.display = 'none';
    }
}

async function deleteOrphan(filename) {
    if (!confirm('Delete orphaned file: ' + filename + '?')) return;
    const res = await fetch('/api/storage/orphans/' + encodeURIComponent(filename), {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken }
    });
    if (res.ok) loadStorage();
    else alert('Failed to delete: ' + (await res.json()).error);
}

function formatAssetTypes(json) {
    if (!json) return '—';
    try {
        const types = JSON.parse(json);
        return types.map(t => t.role || t.type || '?').join(', ');
    } catch { return '—'; }
}
```

**Step 3: Add disk usage bar CSS**

```css
.disk-bar { height: 8px; background: var(--bg-input); border-radius: 4px; overflow: hidden; }
.disk-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.3s; }
.disk-fill.warning { background: var(--warning); }
.disk-fill.danger { background: var(--danger); }
```

**Step 4: Commit**

```bash
git add docker/admin.html
git commit -m "feat: implement Storage tab with disk usage and orphan detection"
```

---

## Task 8: Wire up stats bar and init sequence

**Files:**
- Modify: `docker/admin.html` — complete the `loadStats()` and init functions

**Step 1: Implement loadStats()**

```js
async function loadStats() {
    try {
        const [storageRes, auditRes] = await Promise.all([
            fetch('/api/storage'),
            fetch('/api/audit-log?limit=1')
        ]);
        if (storageRes.ok) {
            const s = await storageRes.json();
            document.getElementById('stat-archives').textContent = s.archives.length;
            document.getElementById('stat-storage').textContent = formatBytes(s.totalUsed);
            document.getElementById('stat-db-size').textContent = s.dbSize ? formatBytes(s.dbSize) : '—';
        }
        if (auditRes.ok) {
            const a = await auditRes.json();
            document.getElementById('stat-last-activity').textContent =
                a.entries.length ? timeAgo(a.entries[0].created_at) : 'None';
        }
    } catch {}
}
```

**Step 2: Complete the init sequence**

```js
(async () => {
    await initAuth();
    initTabs();
    await loadStats();
    loadAuditLog();
    setupAutoRefresh();
    // Load storage when tab is first clicked
    let storageLoaded = false;
    document.querySelector('[data-tab="storage"]').addEventListener('click', () => {
        if (!storageLoaded) { storageLoaded = true; loadStorage(); }
    });
})();
```

**Step 3: Implement formatBytes and timeAgo helpers**

```js
function formatBytes(bytes) {
    if (bytes == null) return '—';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(isoString) {
    const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
    return new Date(isoString).toLocaleDateString();
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

**Step 4: Verify the complete page renders**

Open `docker/admin.html` in a browser (APIs won't work locally, but the structure, tabs, and styles should render correctly).

**Step 5: Commit**

```bash
git add docker/admin.html
git commit -m "feat: wire up stats bar, helpers, and init sequence for admin dashboard"
```

---

## Task 9: Final verification

**Step 1: Syntax-check meta-server.js**

Run: `node -c docker/meta-server.js`
Expected: No output (clean parse)

**Step 2: Build the project**

Run: `npm run build`
Expected: Vite builds successfully (admin.html is not part of Vite build — it's a Docker-only file, but build should still pass)

**Step 3: Run existing tests**

Run: `npm test`
Expected: All 90 tests pass (admin changes are server-side only, no client test impact)

**Step 4: Verify Docker copy path is correct**

Check `docker/Dockerfile` still copies `admin.html`:

```dockerfile
COPY admin.html /opt/admin.html
```

This line already exists — no change needed.

**Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: admin dashboard final verification pass"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `docker/meta-server.js` | +audit entries for regenerate/chunk, +`GET /api/audit-log`, +`GET /api/storage`, +`DELETE /api/storage/orphans/:filename`, +3 route registrations |
| `docker/admin.html` | Full rewrite: tabbed dashboard with Activity (audit log viewer) and Storage (disk usage, orphan detection) tabs |

## Phase 2 (Future)

- System tab: `GET /api/system` endpoint, service health, memory/uptime stats
- Settings tab: `GET/PATCH /api/settings` endpoints, `settings` SQLite table, runtime config UI
