# Admin Settings Panel — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the "Settings" tab in the Docker admin panel with savable application settings stored in SQLite, exposed via API, and consumed by both the admin UI and the frontend.

**Architecture:** SQLite key-value `settings` table with a `SETTINGS_DEFAULTS` registry in `meta-server.js`. Three API endpoints (GET/PUT/DELETE). Admin UI tab in `docker/admin.html`. Frontend reads client-relevant settings into `APP_CONFIG` at boot. Resolution chain: SQLite → env var → hardcoded default.

**Tech Stack:** Node.js (meta-server.js), better-sqlite3, vanilla HTML/CSS/JS (admin.html), Vite (config.js)

---

### Task 1: Add `settings` table and `SETTINGS_DEFAULTS` registry to meta-server.js

**Files:**
- Modify: `docker/meta-server.js:148-214` (initDb function)
- Modify: `docker/meta-server.js:35-55` (config section, add SETTINGS_DEFAULTS after existing env vars)

**Step 1: Add `SETTINGS_DEFAULTS` object after the env config block (~line 55)**

Insert after `const DB_PATH = ...` (line 55):

```js
// --- Settings defaults registry ---
// Resolution: SQLite row → env var → hardcoded default
const SETTINGS_DEFAULTS = {
    'video.crf':              { default: '18',      type: 'number', label: 'Video CRF',              group: 'Video Transcode',  description: 'H.264 quality (0=lossless, 51=worst)', min: 0, max: 51 },
    'video.preset':           { default: 'fast',    type: 'select', label: 'Encoding Preset',         group: 'Video Transcode',  description: 'FFmpeg speed/quality tradeoff', options: ['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'] },
    'recording.bitrate':      { default: '5000000', type: 'number', label: 'Recording Bitrate (bps)', group: 'Video Recording',  description: 'WebM capture bitrate' },
    'recording.framerate':    { default: '30',      type: 'number', label: 'Recording FPS',           group: 'Video Recording',  description: 'Capture frame rate', min: 15, max: 60 },
    'recording.maxDuration':  { default: '60',      type: 'number', label: 'Max Recording Duration (s)', group: 'Video Recording', description: 'Maximum recording length', min: 10, max: 300 },
    'gif.fps':                { default: '15',      type: 'number', label: 'GIF FPS',                 group: 'GIF Generation',   description: 'GIF animation frame rate', min: 5, max: 30 },
    'gif.width':              { default: '480',     type: 'number', label: 'GIF Width (px)',           group: 'GIF Generation',   description: 'GIF output width (height auto)', min: 240, max: 1280 },
    'thumbnail.size':         { default: '512',     type: 'number', label: 'Thumbnail Size (px)',      group: 'Media Output',     description: 'Video thumbnail dimensions', min: 128, max: 1024 },
    'upload.maxSizeMb':       { default: '1024',    type: 'number', label: 'Max Upload Size (MB)',     group: 'Upload',           description: 'Maximum archive upload size', min: 1 },
    'lod.budgetSd':           { default: '1000000', type: 'number', label: 'LOD Budget — SD',         group: 'Renderer',         description: 'Max splats per frame (SD tier)' },
    'lod.budgetHd':           { default: '5000000', type: 'number', label: 'LOD Budget — HD',         group: 'Renderer',         description: 'Max splats per frame (HD tier)' },
    'renderer.maxPixelRatio': { default: '2',       type: 'number', label: 'Max Pixel Ratio',         group: 'Renderer',         description: 'Cap for high-DPI displays', min: 1, max: 4 },
};

// Env var mapping for settings (key → env var name)
const SETTINGS_ENV_MAP = {
    'upload.maxSizeMb': 'MAX_UPLOAD_SIZE',
    'video.crf':        'VIDEO_CRF',
    'video.preset':     'VIDEO_PRESET',
    'gif.fps':          'GIF_FPS',
    'gif.width':        'GIF_WIDTH',
    'thumbnail.size':   'THUMBNAIL_SIZE',
};

// In-memory cache: { key: { value, expiry } }
const _settingsCache = {};
const SETTINGS_CACHE_TTL = 5000; // 5 seconds
```

**Step 2: Add `settings` table creation inside `initDb()` (~line 213, before the closing `}`)**

Insert after the `CREATE INDEX IF NOT EXISTS idx_media_status` line:

```js
        CREATE TABLE IF NOT EXISTS settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
```

**Step 3: Add `getSetting()` and `getAllSettings()` helper functions**

Insert after the `SETTINGS_CACHE_TTL` constant:

```js
/**
 * Resolve a single setting value: SQLite → env var → hardcoded default.
 * Cached for SETTINGS_CACHE_TTL ms.
 */
function getSetting(key) {
    const def = SETTINGS_DEFAULTS[key];
    if (!def) return undefined;

    const cached = _settingsCache[key];
    if (cached && Date.now() < cached.expiry) return cached.value;

    // 1. SQLite
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) {
        _settingsCache[key] = { value: row.value, expiry: Date.now() + SETTINGS_CACHE_TTL };
        return row.value;
    }

    // 2. Environment variable
    const envName = SETTINGS_ENV_MAP[key];
    if (envName && process.env[envName]) {
        const envVal = process.env[envName];
        _settingsCache[key] = { value: envVal, expiry: Date.now() + SETTINGS_CACHE_TTL };
        return envVal;
    }

    // 3. Hardcoded default
    _settingsCache[key] = { value: def.default, expiry: Date.now() + SETTINGS_CACHE_TTL };
    return def.default;
}

/**
 * Build the full settings response object for the API.
 * Returns all settings with resolved values, defaults, and metadata.
 */
function getAllSettings() {
    const dbRows = {};
    for (const row of db.prepare('SELECT key, value FROM settings').all()) {
        dbRows[row.key] = row.value;
    }

    const result = {};
    for (const [key, def] of Object.entries(SETTINGS_DEFAULTS)) {
        const dbVal = dbRows[key];
        const envName = SETTINGS_ENV_MAP[key];
        const envVal = envName && process.env[envName] ? process.env[envName] : null;
        const resolved = dbVal ?? envVal ?? def.default;

        result[key] = {
            value: resolved,
            default: def.default,
            isCustom: dbVal !== undefined,
            label: def.label,
            group: def.group,
            type: def.type,
        };
        if (def.description) result[key].description = def.description;
        if (def.min !== undefined) result[key].min = def.min;
        if (def.max !== undefined) result[key].max = def.max;
        if (def.options) result[key].options = def.options;
    }
    return result;
}

/**
 * Validate a setting value against its definition.
 * Returns null if valid, or an error string.
 */
function validateSetting(key, value) {
    const def = SETTINGS_DEFAULTS[key];
    if (!def) return `Unknown setting: ${key}`;

    if (def.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) return `${key}: must be a number`;
        if (def.min !== undefined && num < def.min) return `${key}: minimum is ${def.min}`;
        if (def.max !== undefined && num > def.max) return `${key}: maximum is ${def.max}`;
    }
    if (def.type === 'select') {
        if (!def.options.includes(value)) return `${key}: must be one of ${def.options.join(', ')}`;
    }
    return null;
}
```

**Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(settings): add settings table, defaults registry, and getSetting helper"
```

---

### Task 2: Add API endpoints for settings

**Files:**
- Modify: `docker/meta-server.js` (add handler functions + routes)

**Step 1: Add the three handler functions**

Insert after the `validateSetting` function (from Task 1):

```js
// --- Settings API handlers ---

function handleGetSettings(req, res) {
    sendJson(res, 200, getAllSettings());
}

function handlePutSettings(req, res) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        let updates;
        try {
            updates = JSON.parse(body);
        } catch {
            return sendJson(res, 400, { error: 'Invalid JSON' });
        }

        if (typeof updates !== 'object' || Array.isArray(updates)) {
            return sendJson(res, 400, { error: 'Expected object of key-value pairs' });
        }

        const errors = [];
        const valid = {};
        for (const [key, value] of Object.entries(updates)) {
            const err = validateSetting(key, String(value));
            if (err) errors.push(err);
            else valid[key] = String(value);
        }

        if (errors.length > 0) {
            return sendJson(res, 400, { error: 'Validation failed', details: errors });
        }

        const upsert = db.prepare(
            'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ' +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
        );
        const tx = db.transaction(() => {
            for (const [key, value] of Object.entries(valid)) {
                upsert.run(key, value);
                delete _settingsCache[key]; // invalidate cache
            }
        });
        tx();

        // Audit log
        db.prepare(
            'INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)'
        ).run(actor, 'update_settings', null, JSON.stringify(valid), req.headers['x-real-ip'] || req.socket.remoteAddress);

        sendJson(res, 200, getAllSettings());
    });
}

function handleDeleteSetting(req, res, key) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    if (!SETTINGS_DEFAULTS[key]) {
        return sendJson(res, 400, { error: `Unknown setting: ${key}` });
    }

    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    delete _settingsCache[key];

    // Audit log
    db.prepare(
        'INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)'
    ).run(actor, 'reset_setting', key, null, req.headers['x-real-ip'] || req.socket.remoteAddress);

    // Return the resolved (now default) value
    const settings = getAllSettings();
    sendJson(res, 200, settings[key]);
}
```

**Step 2: Add routes inside the `ADMIN_ENABLED` block**

Insert after the `/api/storage` route (~line 2294), before the orphan match:

```js
        if (pathname === '/api/settings' && req.method === 'GET') {
            return handleGetSettings(req, res);
        }
        if (pathname === '/api/settings' && req.method === 'PUT') {
            return handlePutSettings(req, res);
        }
        const settingKeyMatch = pathname.match(/^\/api\/settings\/(.+)$/);
        if (settingKeyMatch && req.method === 'DELETE') {
            return handleDeleteSetting(req, res, decodeURIComponent(settingKeyMatch[1]));
        }
```

**Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(settings): add GET/PUT/DELETE API endpoints for settings"
```

---

### Task 3: Replace hardcoded values with getSetting() calls

**Files:**
- Modify: `docker/meta-server.js` (~lines 1960-2015, transcode pipeline)
- Modify: `docker/meta-server.js` (~line 44, MAX_UPLOAD_SIZE)

**Step 1: Replace ffmpeg CRF and preset in the transcode function**

Find the MP4 transcode args (~line 1960):

Before:
```js
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
```

After:
```js
        '-c:v', 'libx264',
        '-preset', getSetting('video.preset'),
        '-crf', getSetting('video.crf'),
```

**Step 2: Replace GIF fps and width**

Find GIF palette args (~line 1995):

Before:
```js
                '-vf', 'fps=15,scale=480:-1:flags=lanczos,palettegen',
```

After:
```js
                '-vf', `fps=${getSetting('gif.fps')},scale=${getSetting('gif.width')}:-1:flags=lanczos,palettegen`,
```

Find GIF encode args (~line 2011):

Before:
```js
                    '-lavfi', 'fps=15,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse',
```

After:
```js
                    '-lavfi', `fps=${getSetting('gif.fps')},scale=${getSetting('gif.width')}:-1:flags=lanczos[x];[x][1:v]paletteuse`,
```

**Step 3: Replace thumbnail size**

Find thumbnail args (~line 1982):

Before:
```js
            '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2',
```

After:
```js
            '-vf', `scale=${getSetting('thumbnail.size')}:${getSetting('thumbnail.size')}:force_original_aspect_ratio=decrease,pad=${getSetting('thumbnail.size')}:${getSetting('thumbnail.size')}:(ow-iw)/2:(oh-ih)/2`,
```

**Step 4: Make MAX_UPLOAD_SIZE dynamic**

The existing `MAX_UPLOAD_SIZE` is used at line 44 and referenced in upload handlers. Since `getSetting` isn't available until after `initDb()`, change the upload handler to use `getSetting` at request time instead of the module-level constant.

Find the busboy limits (~line 618):

Before:
```js
            bb = busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD_SIZE } });
```

After:
```js
            bb = busboy({ headers: req.headers, limits: { fileSize: parseInt(getSetting('upload.maxSizeMb'), 10) * 1024 * 1024 } });
```

Also update the error message (~line 962) that references `MAX_UPLOAD_SIZE`:

Before:
```js
            sendJson(res, 413, { error: 'Upload exceeds maximum size (' + Math.round(MAX_UPLOAD_SIZE / 1024 / 1024) + ' MB)' });
```

After:
```js
            sendJson(res, 413, { error: 'Upload exceeds maximum size (' + getSetting('upload.maxSizeMb') + ' MB)' });
```

**Step 5: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(settings): replace hardcoded transcode/upload values with getSetting()"
```

---

### Task 4: Add Settings tab UI to admin.html

**Files:**
- Modify: `docker/admin.html:439` (enable Settings button)
- Modify: `docker/admin.html:529` (add tab-settings div before `<script>`)

**Step 1: Enable the Settings tab button**

Find line 439:

Before:
```html
    <button class="tab-btn" disabled data-tooltip="Coming soon">Settings</button>
```

After:
```html
    <button class="tab-btn" data-tab="settings">Settings</button>
```

**Step 2: Add the Settings tab content panel**

Insert before `<script>` (~line 531):

```html
<!-- Settings Tab -->
<div id="tab-settings" class="tab-content">
    <div id="settings-container">
        <div class="state-row" style="padding:20px;color:var(--text-secondary)">Loading settings&hellip;</div>
    </div>
    <div class="settings-actions" id="settings-actions" style="display:none">
        <button class="btn-primary" id="btn-save-settings">Save Changes</button>
        <span class="settings-status" id="settings-status"></span>
    </div>
</div>
```

**Step 3: Add CSS for settings layout**

Insert in the `<style>` block (before the closing `</style>`):

```css
/* Settings tab */
.settings-group { margin-bottom: 24px; }
.settings-group-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    padding-bottom: 8px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--border-subtle);
}
.setting-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 0;
}
.setting-label-col { flex: 1; min-width: 0; }
.setting-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
}
.setting-desc {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
}
.setting-default {
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 2px;
    font-family: var(--font-mono);
}
.setting-input-col {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}
.setting-input-col input[type="number"],
.setting-input-col select {
    width: 120px;
    padding: 4px 8px;
    background: var(--bg-input);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 12px;
    font-family: var(--font-mono);
}
.setting-input-col input:focus,
.setting-input-col select:focus {
    outline: none;
    border-color: var(--accent);
}
.setting-input-col input.modified,
.setting-input-col select.modified {
    border-color: var(--accent);
    background: var(--accent-muted);
}
.btn-reset-setting {
    background: none;
    border: 1px solid var(--border-subtle);
    color: var(--text-muted);
    cursor: pointer;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    visibility: hidden;
}
.btn-reset-setting.visible { visibility: visible; }
.btn-reset-setting:hover { color: var(--text-primary); border-color: var(--border-default); }
.settings-actions {
    padding: 16px 0;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    gap: 12px;
}
.settings-status { font-size: 11px; color: var(--accent-text); }
```

**Step 4: Commit**

```bash
git add docker/admin.html
git commit -m "feat(settings): add Settings tab HTML and CSS to admin panel"
```

---

### Task 5: Add Settings tab JavaScript to admin.html

**Files:**
- Modify: `docker/admin.html` (inside `<script>` block)

**Step 1: Add `settingsLoaded` flag to state**

Find the state section (~line 538, after `let storageLoaded = false;`):

```js
let settingsLoaded = false;
let settingsData = {};
```

**Step 2: Add lazy-load trigger in `activateTab()`**

Find the `activateTab` function (~line 884, after `if (name === 'storage' && !storageLoaded) loadStorageTab();`):

```js
    if (name === 'settings' && !settingsLoaded) loadSettingsTab();
```

**Step 3: Add settings tab JS functions**

Insert before the closing `</script>` tag:

```js
// ── Settings tab ──────────────────────────────────────────────────────────

async function loadSettingsTab() {
    settingsLoaded = true;
    try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error(res.statusText);
        settingsData = await res.json();
        renderSettings();
    } catch (err) {
        document.getElementById('settings-container').innerHTML =
            '<div class="state-row" style="padding:20px;color:var(--danger)">Failed to load settings: ' + err.message + '</div>';
    }
}

function renderSettings() {
    const container = document.getElementById('settings-container');
    const groups = {};

    // Group settings by group name
    for (const [key, def] of Object.entries(settingsData)) {
        const g = def.group || 'Other';
        if (!groups[g]) groups[g] = [];
        groups[g].push({ key, ...def });
    }

    let html = '';
    for (const [groupName, settings] of Object.entries(groups)) {
        html += '<div class="settings-group">';
        html += '<div class="settings-group-title">' + escapeHtml(groupName) + '</div>';
        for (const s of settings) {
            html += renderSettingRow(s);
        }
        html += '</div>';
    }
    container.innerHTML = html;
    document.getElementById('settings-actions').style.display = 'flex';

    // Wire up reset buttons
    container.querySelectorAll('.btn-reset-setting').forEach(btn => {
        btn.addEventListener('click', () => resetSetting(btn.dataset.key));
    });

    // Wire up change detection on inputs
    container.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('input', () => {
            const key = el.dataset.key;
            const def = settingsData[key];
            const isModified = el.value !== def.value;
            el.classList.toggle('modified', isModified);
        });
    });
}

function renderSettingRow(s) {
    let inputHtml = '';
    if (s.type === 'select') {
        inputHtml = '<select data-key="' + s.key + '">';
        for (const opt of (s.options || [])) {
            const sel = opt === s.value ? ' selected' : '';
            inputHtml += '<option value="' + escapeHtml(opt) + '"' + sel + '>' + escapeHtml(opt) + '</option>';
        }
        inputHtml += '</select>';
    } else {
        let attrs = 'type="number" value="' + escapeHtml(s.value) + '"';
        if (s.min !== undefined) attrs += ' min="' + s.min + '"';
        if (s.max !== undefined) attrs += ' max="' + s.max + '"';
        inputHtml = '<input data-key="' + s.key + '" ' + attrs + '>';
    }

    const resetVisible = s.isCustom ? ' visible' : '';
    const desc = s.description ? '<div class="setting-desc">' + escapeHtml(s.description) + '</div>' : '';

    return '<div class="setting-row">' +
        '<div class="setting-label-col">' +
            '<div class="setting-label">' + escapeHtml(s.label) + '</div>' +
            desc +
            '<div class="setting-default">Default: ' + escapeHtml(s.default) + '</div>' +
        '</div>' +
        '<div class="setting-input-col">' +
            inputHtml +
            '<button class="btn-reset-setting' + resetVisible + '" data-key="' + s.key + '" title="Reset to default">&#8635;</button>' +
        '</div>' +
    '</div>';
}

async function resetSetting(key) {
    try {
        const res = await fetch('/api/settings/' + encodeURIComponent(key), {
            method: 'DELETE',
            headers: { 'x-csrf-token': csrfToken }
        });
        if (!res.ok) throw new Error((await res.json()).error || res.statusText);
        // Reload settings to reflect reset
        settingsLoaded = false;
        loadSettingsTab();
        showSettingsStatus('Reset to default');
    } catch (err) {
        showSettingsStatus('Error: ' + err.message, true);
    }
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const updates = {};
    document.querySelectorAll('#settings-container input, #settings-container select').forEach(el => {
        const key = el.dataset.key;
        if (el.value !== settingsData[key].value) {
            updates[key] = el.value;
        }
    });

    if (Object.keys(updates).length === 0) {
        showSettingsStatus('No changes to save');
        return;
    }

    try {
        const res = await fetch('/api/settings', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'x-csrf-token': csrfToken
            },
            body: JSON.stringify(updates)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.details ? err.details.join(', ') : err.error);
        }
        settingsData = await res.json();
        renderSettings();
        showSettingsStatus('Settings saved');
    } catch (err) {
        showSettingsStatus('Error: ' + err.message, true);
    }
});

function showSettingsStatus(msg, isError) {
    const el = document.getElementById('settings-status');
    el.textContent = msg;
    el.style.color = isError ? 'var(--danger)' : 'var(--accent-text)';
    setTimeout(() => { el.textContent = ''; }, 3000);
}
```

**Step 4: Verify `escapeHtml` exists in admin.html**

The admin panel already has an `escapeHtml` function — verify by searching for it. If it exists, no action needed.

Run: `grep -n "escapeHtml" docker/admin.html`

**Step 5: Commit**

```bash
git add docker/admin.html
git commit -m "feat(settings): add settings tab JavaScript with save/reset functionality"
```

---

### Task 6: Add client-side settings fetch to config.js

**Files:**
- Modify: `src/config.js` (add async settings fetch at end of IIFE)
- Modify: `docker/config.js.template` (same change, if it differs)

**Step 1: Check if `docker/config.js.template` exists and how it differs from `src/config.js`**

Run: `diff src/config.js docker/config.js.template 2>/dev/null || echo "template not found"`

**Step 2: Add settings fetch to config.js**

`config.js` is a synchronous IIFE that runs before ES modules. We can't make it async, so add a fetch that stores a promise on `APP_CONFIG` for modules to await:

Insert at the end of the IIFE (before the closing `})();`):

```js
    // Fetch server-managed settings (non-blocking — modules await this promise)
    window.APP_CONFIG.settingsReady = fetch('/api/settings')
        .then(function(res) { return res.ok ? res.json() : Promise.reject(res.statusText); })
        .then(function(settings) {
            // Merge client-relevant settings into APP_CONFIG
            var s = settings;
            if (s['lod.budgetSd'])           window.APP_CONFIG.lodBudgetSd = Number(s['lod.budgetSd'].value);
            if (s['lod.budgetHd'])           window.APP_CONFIG.lodBudgetHd = Number(s['lod.budgetHd'].value);
            if (s['renderer.maxPixelRatio']) window.APP_CONFIG.maxPixelRatio = Number(s['renderer.maxPixelRatio'].value);
            if (s['recording.bitrate'])      window.APP_CONFIG.recordingBitrate = Number(s['recording.bitrate'].value);
            if (s['recording.framerate'])    window.APP_CONFIG.recordingFramerate = Number(s['recording.framerate'].value);
            if (s['recording.maxDuration'])  window.APP_CONFIG.recordingMaxDuration = Number(s['recording.maxDuration'].value);
        })
        .catch(function() {
            // Silently fail — local dev / Tauri won't have this endpoint
        });
```

**Step 3: Apply the same change to `docker/config.js.template` if it exists**

**Step 4: Commit**

```bash
git add src/config.js docker/config.js.template
git commit -m "feat(settings): fetch server settings into APP_CONFIG at boot"
```

---

### Task 7: Wire client-side modules to read APP_CONFIG settings

**Files:**
- Modify: `src/modules/recording-manager.ts:100,118,46` (framerate, bitrate, max duration)
- Modify: `src/modules/scene-manager.ts` (max pixel ratio — find `MAX_PIXEL_RATIO` usage)

**Step 1: Update recording-manager.ts to read APP_CONFIG values**

Find the `captureStream(30)` call (~line 100):

Before:
```js
    _compositeStream = _compositeCanvas.captureStream(30);
```

After:
```js
    const fps = (window as any).APP_CONFIG?.recordingFramerate || 30;
    _compositeStream = _compositeCanvas.captureStream(fps);
```

Find the `videoBitsPerSecond` (~line 118):

Before:
```js
        videoBitsPerSecond: 5_000_000, // 5 Mbps
```

After:
```js
        videoBitsPerSecond: (window as any).APP_CONFIG?.recordingBitrate || 5_000_000,
```

Find `MAX_DURATION` (~line 46):

Before:
```js
const MAX_DURATION = 60_000; // 60 seconds
```

After:
```js
const MAX_DURATION = ((window as any).APP_CONFIG?.recordingMaxDuration || 60) * 1000;
```

**Step 2: Update scene-manager.ts to read maxPixelRatio**

Find the `MAX_PIXEL_RATIO` usage in scene-manager.ts:

Before:
```js
    Math.min(window.devicePixelRatio, RENDERER.MAX_PIXEL_RATIO)
```

After:
```js
    Math.min(window.devicePixelRatio, (window as any).APP_CONFIG?.maxPixelRatio || RENDERER.MAX_PIXEL_RATIO)
```

**Step 3: Verify quality-tier.ts already reads APP_CONFIG**

`quality-tier.ts` already reads `cfg.lodBudgetSd` and `cfg.lodBudgetHd` from `APP_CONFIG` (lines 147-148). The config.js fetch in Task 6 sets these same keys — no change needed.

**Step 4: Commit**

```bash
git add src/modules/recording-manager.ts src/modules/scene-manager.ts
git commit -m "feat(settings): wire recording and renderer modules to APP_CONFIG settings"
```

---

### Task 8: Build verification

**Step 1: Run the Vite build**

Run: `npm run build`

Expected: Build succeeds with no errors.

**Step 2: Run lint**

Run: `npm run lint`

Expected: 0 errors (warnings OK).

**Step 3: Run tests**

Run: `npm test`

Expected: All existing tests pass (settings changes don't touch test-covered code paths).

**Step 4: Commit any fixes if needed**

---

### Task 9: Final commit and summary

**Step 1: Verify all changes with `git diff --stat`**

Expected files changed:
- `docker/meta-server.js` — settings table, defaults, helpers, API routes, getSetting replacements
- `docker/admin.html` — Settings tab HTML, CSS, JS
- `src/config.js` — Settings fetch
- `docker/config.js.template` — Settings fetch (if applicable)
- `src/modules/recording-manager.ts` — APP_CONFIG reads
- `src/modules/scene-manager.ts` — APP_CONFIG maxPixelRatio

**Step 2: Verify no sensitive data committed**

Run: `git diff --cached | grep -i 'password\|secret\|token\|apikey' || echo "Clean"`
