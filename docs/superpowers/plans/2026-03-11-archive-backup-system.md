# Archive Backup System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic backup rotation when archives are re-uploaded to the server library, with a configurable retention limit and version history UI in admin + library pages.

**Architecture:** Server-side only — `meta-server.js` gains a `backupAndReplace` helper that moves the existing file to `archives/history/{basename}/` before accepting the replacement. A new `archive_versions` SQLite table tracks backups. Three new API endpoints serve version listing, download, and deletion. Admin panel (`admin.html`) and library panel (`library-panel.ts`) get version history UI.

**Tech Stack:** Node.js (meta-server.js), SQLite (better-sqlite3), nginx config, TypeScript (library-panel.ts)

**Spec:** `docs/superpowers/specs/2026-03-11-archive-backup-system-design.md`

---

## Chunk 1: Database + Settings + Core Helpers

### Task 1: Add `archive_versions` table and `backup.maxVersions` setting

**Files:**
- Modify: `docker/meta-server.js:61-75` (SETTINGS_DEFAULTS)
- Modify: `docker/meta-server.js:363-377` (db.exec CREATE TABLE block)

- [ ] **Step 1: Add the setting to SETTINGS_DEFAULTS**

In `docker/meta-server.js`, add to the `SETTINGS_DEFAULTS` object (after the `'renderer.maxPixelRatio'` entry around line 73):

```js
'backup.maxVersions':     { default: '5',       type: 'number', label: 'Max Backup Versions',      group: 'Storage',          description: 'Maximum backup versions kept per archive (0 to disable backups)', min: 0, max: 50 },
```

- [ ] **Step 2: Add the archive_versions table to the db.exec block**

In the `db.exec()` block (around line 363), after the `CREATE TABLE IF NOT EXISTS media` block and its indexes, add:

```sql
CREATE TABLE IF NOT EXISTS archive_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    archive_id  INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
    filename    TEXT    NOT NULL,
    size        INTEGER NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_av_archive ON archive_versions(archive_id);
```

- [ ] **Step 3: Verify Docker build succeeds**

Run: `cd docker && docker build -t vitrine3d-test .` (or just verify the JS is syntactically valid with `node -c docker/meta-server.js`)

- [ ] **Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(backup): add archive_versions table and backup.maxVersions setting"
```

---

### Task 2: Add `pruneArchiveVersions` helper function

**Files:**
- Modify: `docker/meta-server.js` (add function before `handleUploadArchive` at line ~1266)

- [ ] **Step 1: Add the pruning function**

Insert before the `handleUploadArchive` function (around line 1266):

```js
/**
 * Prune old backup versions for an archive, keeping only maxVersions most recent.
 * Must be called inside an existing db.transaction().
 * @param {number} archiveId - The archive's DB row id
 * @param {number} maxVersions - Max backups to retain
 */
function pruneArchiveVersions(archiveId, maxVersions) {
    const versions = db.prepare(
        'SELECT id, filename FROM archive_versions WHERE archive_id = ? ORDER BY created_at DESC, id DESC'
    ).all(archiveId);

    const toDelete = versions.slice(maxVersions);
    const deleteStmt = db.prepare('DELETE FROM archive_versions WHERE id = ?');

    for (const v of toDelete) {
        const fullPath = path.join(ARCHIVES_DIR, v.filename);
        deleteStmt.run(v.id);
        try { fs.unlinkSync(fullPath); } catch {}
    }

    // Clean up empty history subdirectory
    if (toDelete.length > 0 && versions.length > 0) {
        const histDir = path.dirname(path.join(ARCHIVES_DIR, versions[0].filename));
        try {
            const remaining = fs.readdirSync(histDir);
            if (remaining.length === 0) fs.rmdirSync(histDir);
        } catch {}
    }
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c docker/meta-server.js`

- [ ] **Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(backup): add pruneArchiveVersions helper"
```

---

### Task 3: Add `backupAndReplace` shared helper

**Files:**
- Modify: `docker/meta-server.js` (add function after `pruneArchiveVersions`, before `handleUploadArchive`)

- [ ] **Step 1: Add the backupAndReplace function**

Insert after `pruneArchiveVersions`:

```js
/**
 * Back up an existing archive file to history/ and replace it with a new upload.
 * Handles backup rotation, DB upsert, metadata extraction, and audit logging.
 * Called by both handleUploadArchive and handleCompleteChunk when a file already exists.
 *
 * @param {Object} existingRow - The existing archives DB row (from SELECT * WHERE filename = ?)
 * @param {string} tmpPath - Path to the newly uploaded temp file
 * @param {string} filename - The target archive filename
 * @param {Object} req - HTTP request (for actor extraction)
 * @returns {Object} The updated archive DB row
 */
function backupAndReplace(existingRow, tmpPath, filename, req) {
    const finalPath = path.join(ARCHIVES_DIR, filename);
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);
    const maxVersions = parseInt(getSetting('backup.maxVersions'), 10) || 0;

    let backupRelPath = null;
    let backupFullPath = null;
    let existingSize = 0;

    // --- Phase 1: Filesystem operations (outside transaction) ---
    // If these fail, no DB state has changed — safe to abort.

    if (maxVersions > 0) {
        const histDir = path.join(ARCHIVES_DIR, 'history', basename);
        if (!fs.existsSync(histDir)) {
            fs.mkdirSync(histDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const backupFilename = basename + '.' + timestamp + ext;
        backupRelPath = path.join('history', basename, backupFilename);
        backupFullPath = path.join(ARCHIVES_DIR, backupRelPath);

        existingSize = fs.statSync(finalPath).size;

        // Move existing file to history (rename if same FS, copy+delete otherwise)
        try {
            fs.renameSync(finalPath, backupFullPath);
        } catch {
            try {
                fs.copyFileSync(finalPath, backupFullPath);
                fs.unlinkSync(finalPath);
            } catch (copyErr) {
                // Clean up partial backup on failure
                try { fs.unlinkSync(backupFullPath); } catch {}
                throw copyErr;
            }
        }
    } else {
        // No backup — just remove existing file
        try { fs.unlinkSync(finalPath); } catch {}
    }

    // Move new upload into place
    try {
        fs.renameSync(tmpPath, finalPath);
    } catch {
        fs.copyFileSync(tmpPath, finalPath);
        try { fs.unlinkSync(tmpPath); } catch {}
    }

    // Extract metadata (slow — runs external shell script, keep outside transaction)
    const archiveUrl = '/archives/' + filename;
    const hash = archiveHash(archiveUrl);
    runExtractMeta(finalPath);

    let metaRaw = {};
    const metaJsonPath = path.join(META_DIR, hash + '.json');
    try { metaRaw = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8')); } catch (_) {}

    const thumbPath = '/thumbs/' + hash + '.jpg';
    const thumbExists = fs.existsSync(path.join(HTML_ROOT, 'thumbs', hash + '.jpg'));
    const newSize = fs.statSync(finalPath).size;

    // --- Phase 2: DB operations (inside transaction) ---
    // If the transaction fails, the file is already in place but DB is consistent.
    // Compensating FS rollback is not attempted — the file on disk is the newer version
    // which is the correct state even if the DB update needs to be retried.

    const doDbUpdates = db.transaction(() => {
        // Record backup version
        if (maxVersions > 0 && backupRelPath) {
            db.prepare(
                'INSERT INTO archive_versions (archive_id, filename, size) VALUES (?, ?, ?)'
            ).run(existingRow.id, backupRelPath, existingSize);

            pruneArchiveVersions(existingRow.id, maxVersions);
        }

        // Upsert archives row (uuid only used on first insert — preserved on conflict)
        db.prepare(`
            INSERT INTO archives
                (uuid, hash, filename, title, description, thumbnail, asset_types, metadata_raw, size, updated_at)
            VALUES
                (@uuid, @hash, @filename, @title, @description, @thumbnail, @asset_types, @metadata_raw, @size, datetime('now'))
            ON CONFLICT(hash) DO UPDATE SET
                filename    = excluded.filename,
                title       = excluded.title,
                description = excluded.description,
                thumbnail   = excluded.thumbnail,
                asset_types = excluded.asset_types,
                metadata_raw= excluded.metadata_raw,
                size        = excluded.size,
                updated_at  = excluded.updated_at
        `).run({
            uuid: crypto.randomUUID(),
            hash,
            filename,
            title: metaRaw.title || null,
            description: metaRaw.description || null,
            thumbnail: thumbExists ? thumbPath : null,
            asset_types: metaRaw.asset_types ? JSON.stringify(metaRaw.asset_types) : null,
            metadata_raw: JSON.stringify(metaRaw),
            size: newSize,
        });

        // Audit log
        const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
        db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
          .run(actor, 'upload_replace', filename, JSON.stringify({ hash, size: newSize, backed_up: maxVersions > 0 }), req.headers['x-real-ip'] || null);

        return db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
    });

    return doDbUpdates();
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c docker/meta-server.js`

- [ ] **Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(backup): add backupAndReplace shared helper for upload handlers"
```

---

## Chunk 2: Modify Upload Handlers

### Task 4: Modify `handleUploadArchive` to use `backupAndReplace`

**Files:**
- Modify: `docker/meta-server.js:1269-1350` (handleUploadArchive function)

- [ ] **Step 1: Replace the 409 duplicate check with backupAndReplace call**

In `handleUploadArchive`, replace lines 1281–1341 (from `// Check for duplicate` through the `sendJson(res, 201, ...)`) with:

```js
        // If file already exists, back it up and replace
        if (fs.existsSync(finalPath)) {
            const existingRow = db.prepare('SELECT * FROM archives WHERE filename = ?').get(filename);
            if (existingRow) {
                const updatedRow = backupAndReplace(existingRow, tmpPath, filename, req);
                return sendJson(res, 200, buildArchiveObjectFromRow(updatedRow));
            }
            // Filename exists on disk but not in DB — remove orphan and proceed with normal upload
            try { fs.unlinkSync(finalPath); } catch {}
        }

        // Move from temp to archives (rename if same filesystem, copy+delete otherwise)
        try {
            fs.renameSync(tmpPath, finalPath);
        } catch {
            // Cross-device: copy then delete
            fs.copyFileSync(tmpPath, finalPath);
            try { fs.unlinkSync(tmpPath); } catch {}
        }

        // Extract metadata
        const archiveUrl = '/archives/' + filename;
        const hash = archiveHash(archiveUrl);
        runExtractMeta(finalPath);

        // Import extracted metadata into SQLite
        let metaRaw = {};
        const metaJsonPath = path.join(META_DIR, hash + '.json');
        try { metaRaw = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8')); } catch (_) {}

        const thumbPath = '/thumbs/' + hash + '.jpg';
        const thumbExists = fs.existsSync(path.join(HTML_ROOT, 'thumbs', hash + '.jpg'));

        db.prepare(`
            INSERT INTO archives
                (uuid, hash, filename, title, description, thumbnail, asset_types, metadata_raw, size, updated_at)
            VALUES
                (@uuid, @hash, @filename, @title, @description, @thumbnail, @asset_types, @metadata_raw, @size, datetime('now'))
            ON CONFLICT(hash) DO UPDATE SET
                filename    = excluded.filename,
                title       = excluded.title,
                description = excluded.description,
                thumbnail   = excluded.thumbnail,
                asset_types = excluded.asset_types,
                metadata_raw= excluded.metadata_raw,
                size        = excluded.size,
                updated_at  = excluded.updated_at
        `).run({
            uuid: crypto.randomUUID(),
            hash,
            filename,
            title: metaRaw.title || null,
            description: metaRaw.description || null,
            thumbnail: thumbExists ? thumbPath : null,
            asset_types: metaRaw.asset_types ? JSON.stringify(metaRaw.asset_types) : null,
            metadata_raw: JSON.stringify(metaRaw),
            size: fs.statSync(finalPath).size,
        });

        // Audit log
        const uploadActor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
        db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
          .run(uploadActor, 'upload', filename, JSON.stringify({ hash, size: fs.statSync(finalPath).size }), req.headers['x-real-ip'] || null);

        const uploadedRow = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
        sendJson(res, 201, buildArchiveObjectFromRow(uploadedRow));
```

Note: the new upload path (no existing file) is kept unchanged from the original code. Only the duplicate handling is changed — from a 409 rejection to a `backupAndReplace` call.

- [ ] **Step 2: Verify syntax**

Run: `node -c docker/meta-server.js`

- [ ] **Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(backup): modify handleUploadArchive to backup on re-upload"
```

---

### Task 5: Modify `handleCompleteChunk` to use `backupAndReplace`

**Files:**
- Modify: `docker/meta-server.js:2324-2400` (handleCompleteChunk function)

- [ ] **Step 1: Replace the 409 duplicate check with backupAndReplace call**

In `handleCompleteChunk`, make two targeted modifications — the chunk assembly code (lines 2329–2348) stays completely unchanged:

**Part A:** Replace the 3-line duplicate check block (lines 2325–2327):
```js
        // OLD:
        if (fs.existsSync(finalPath)) {
            return sendJson(res, 409, { error: 'File already exists: ' + filename });
        }
```
With:
```js
        if (fs.existsSync(finalPath)) {
            const existingRow = db.prepare('SELECT * FROM archives WHERE filename = ?').get(filename);
            if (existingRow) {
                const updatedRow = backupAndReplace(existingRow, tmpPath, filename, req);
                try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch {}
                return sendJson(res, 200, buildArchiveObjectFromRow(updatedRow));
            }
            // Orphan file on disk — remove it
            try { fs.unlinkSync(finalPath); } catch {}
        }
```

**Part B:** Leave the chunk assembly (lines 2329–2348) and chunk dir cleanup (line 2347) completely untouched.

**Part C:** Replace the file move + DB insert + audit block (lines 2349–2400, from `try { fs.renameSync(tmpPath, finalPath) }` through `sendJson(res, 201, ...)`) with the same code unchanged — this block is identical to the original and only needs the `backupAndReplace` early-return above to handle the duplicate case. No changes needed to the normal (non-duplicate) path.

- [ ] **Step 2: Verify syntax**

Run: `node -c docker/meta-server.js`

- [ ] **Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(backup): modify handleCompleteChunk to backup on re-upload"
```

---

## Chunk 3: Modify Delete + Rename Handlers

### Task 6: Modify `handleDeleteArchive` to clean up history directory

**Files:**
- Modify: `docker/meta-server.js:1355-1389` (handleDeleteArchive function)

- [ ] **Step 1: Add history directory cleanup after sidecar deletion**

After the sidecar deletion lines (around line 1378 `try { fs.unlinkSync(path.join(THUMBS_DIR, hash + '.jpg')); } catch {}`), add:

```js
    // Delete backup history directory for this archive
    const histBasename = path.parse(row.filename).name;
    const historyDir = path.join(ARCHIVES_DIR, 'history', histBasename);
    try { fs.rmSync(historyDir, { recursive: true }); } catch {}
```

DB rows are cleaned up automatically via `ON DELETE CASCADE`.

- [ ] **Step 2: Verify syntax**

Run: `node -c docker/meta-server.js`

- [ ] **Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(backup): clean up history directory on archive delete"
```

---

### Task 7: Modify `handleRenameArchive` to rename history directory

**Files:**
- Modify: `docker/meta-server.js:1445-1541` (handleRenameArchive function)

- [ ] **Step 1: Add history directory conflict check and rename**

**Before** the archive file rename (`fs.renameSync(oldFilePath, newPath)`) at line 1486, add the history conflict check so we can return 409 without having moved any files:

```js
            // Check for history directory conflict before any file moves
            const oldBasename = path.parse(oldRow.filename).name;
            const newBasename = path.parse(sanitized).name;
            const oldHistDir = path.join(ARCHIVES_DIR, 'history', oldBasename);
            const newHistDir = path.join(ARCHIVES_DIR, 'history', newBasename);

            if (fs.existsSync(oldHistDir) && fs.existsSync(newHistDir)) {
                return sendJson(res, 409, { error: 'History directory conflict: ' + newBasename });
            }
```

Then **after** the file rename (`fs.renameSync(oldFilePath, newPath)`) at line 1486, and before the sidecar cleanup at line 1488, add:

```js
            // Rename history directory if it exists (conflict already checked above)
            if (fs.existsSync(oldHistDir)) {
                fs.renameSync(oldHistDir, newHistDir);
            }
```

- [ ] **Step 2: Add version filename updates inside the existing transaction**

Inside the `db.transaction()` block (around line 1509-1533), after the `UPDATE archives` statement and before the audit log INSERT, add:

```js
                // Update backup version filenames to reflect the new basename
                db.prepare(
                    'UPDATE archive_versions SET filename = replace(filename, ?, ?) WHERE archive_id = ?'
                ).run('history/' + oldBasename + '/', 'history/' + newBasename + '/', oldRow.id);
```

- [ ] **Step 3: Add `upload_replace` badge class to admin.html**

In `docker/admin.html`, find the badge map object (around line 869-874) and add:

```js
        upload_replace: 'badge-upload',
```

And add `delete_version` too:

```js
        delete_version: 'badge-delete',
```

- [ ] **Step 4: Verify syntax**

Run: `node -c docker/meta-server.js`

- [ ] **Step 5: Commit**

```bash
git add docker/meta-server.js docker/admin.html
git commit -m "feat(backup): rename history directory on archive rename, add audit badges"
```

---

## Chunk 4: New API Endpoints + Routing

### Task 8: Add version list, download, and delete endpoints

**Files:**
- Modify: `docker/meta-server.js` (add 3 handler functions before the router, and add route matching in the router)

- [ ] **Step 1: Add the three handler functions**

Insert after `backupAndReplace` and before `handleUploadArchive`:

```js
/**
 * GET /api/archives/:hash/versions — list backup versions
 */
function handleListVersions(req, res, hash) {
    if (!requireAuth(req, res)) return;
    const row = db.prepare('SELECT id FROM archives WHERE hash = ?').get(hash);
    if (!row) return sendJson(res, 404, { error: 'Archive not found' });

    const versions = db.prepare(
        'SELECT id, size, created_at FROM archive_versions WHERE archive_id = ? ORDER BY created_at DESC, id DESC'
    ).all(row.id);

    sendJson(res, 200, {
        versions: versions.map(v => ({
            id: v.id,
            size: v.size,
            created_at: v.created_at ? v.created_at.replace(' ', 'T') + 'Z' : v.created_at,
        }))
    });
}

/**
 * GET /api/archives/:hash/versions/:id/download — download a backup version
 */
function handleDownloadVersion(req, res, hash, versionId) {
    if (!requireAuth(req, res)) return;
    const archiveRow = db.prepare('SELECT id FROM archives WHERE hash = ?').get(hash);
    if (!archiveRow) return sendJson(res, 404, { error: 'Archive not found' });

    const version = db.prepare(
        'SELECT * FROM archive_versions WHERE id = ? AND archive_id = ?'
    ).get(versionId, archiveRow.id);
    if (!version) return sendJson(res, 404, { error: 'Version not found' });

    // Path traversal protection — must be under ARCHIVES_DIR/history/
    const fullPath = path.join(ARCHIVES_DIR, version.filename);
    try {
        const realPath = fs.realpathSync(fullPath);
        const historyRoot = fs.realpathSync(path.join(ARCHIVES_DIR, 'history'));
        if (!realPath.startsWith(historyRoot + '/')) {
            return sendJson(res, 403, { error: 'Access denied' });
        }
    } catch {
        return sendJson(res, 404, { error: 'Backup file not found' });
    }

    const stat = fs.statSync(fullPath);
    const downloadName = path.basename(version.filename);
    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': stat.size,
        'Content-Disposition': 'attachment; filename="' + downloadName + '"',
    });
    fs.createReadStream(fullPath).pipe(res);
}

/**
 * DELETE /api/archives/:hash/versions/:id — delete a specific backup
 */
function handleDeleteVersion(req, res, hash, versionId) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;
    const archiveRow = db.prepare('SELECT id, filename FROM archives WHERE hash = ?').get(hash);
    if (!archiveRow) return sendJson(res, 404, { error: 'Archive not found' });

    const version = db.prepare(
        'SELECT * FROM archive_versions WHERE id = ? AND archive_id = ?'
    ).get(versionId, archiveRow.id);
    if (!version) return sendJson(res, 404, { error: 'Version not found' });

    // Path traversal protection
    const fullPath = path.join(ARCHIVES_DIR, version.filename);
    try {
        const realPath = fs.realpathSync(fullPath);
        const historyRoot = fs.realpathSync(path.join(ARCHIVES_DIR, 'history'));
        if (!realPath.startsWith(historyRoot + '/')) {
            return sendJson(res, 403, { error: 'Access denied' });
        }
    } catch {
        return sendJson(res, 404, { error: 'Backup file not found' });
    }

    // Delete file + DB row
    try { fs.unlinkSync(fullPath); } catch {}
    db.prepare('DELETE FROM archive_versions WHERE id = ?').run(versionId);

    // Clean up empty history subdirectory
    const histDir = path.dirname(fullPath);
    try {
        const remaining = fs.readdirSync(histDir);
        if (remaining.length === 0) fs.rmdirSync(histDir);
    } catch {}

    // Audit log
    const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
    db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
      .run(actor, 'delete_version', hash, JSON.stringify({ version_id: versionId, filename: version.filename }), req.headers['x-real-ip'] || null);

    sendJson(res, 200, { deleted: true });
}
```

- [ ] **Step 2: Add route matching in the router**

In the router section (around line 2832-2844), add version routes **before** the existing `/api/archives/:hash` match. Insert before the `const regenMatch` line:

```js
        // Match /api/archives/:hash/versions
        const versionsMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions$/);
        if (versionsMatch && req.method === 'GET') {
            return handleListVersions(req, res, versionsMatch[1]);
        }

        // Match /api/archives/:hash/versions/:id/download
        const versionDlMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions\/(\d+)\/download$/);
        if (versionDlMatch && req.method === 'GET') {
            return handleDownloadVersion(req, res, versionDlMatch[1], parseInt(versionDlMatch[2], 10));
        }

        // Match /api/archives/:hash/versions/:id (delete)
        const versionDelMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions\/(\d+)$/);
        if (versionDelMatch && req.method === 'DELETE') {
            return handleDeleteVersion(req, res, versionDelMatch[1], parseInt(versionDelMatch[2], 10));
        }
```

- [ ] **Step 3: Verify syntax**

Run: `node -c docker/meta-server.js`

- [ ] **Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(backup): add version list, download, and delete API endpoints"
```

---

## Chunk 5: nginx Config

### Task 9: Block direct access to history/ directory

**Files:**
- Modify: `docker/nginx.conf:31-39` (archive serving section)
- Modify: `docker/nginx.conf.template` (same section, if it exists)

- [ ] **Step 1: Add deny rule to nginx.conf**

Before the existing archive extension location block (line 31), add:

```nginx
    # Block direct access to backup archive history — must use authenticated API
    # ^~ prevents regex locations (like the .ddim extension match) from overriding this
    location ^~ /archives/history/ {
        deny all;
        return 403;
    }
```

- [ ] **Step 2: Add same rule to nginx.conf.template if it exists**

Check `docker/nginx.conf.template` for the same archive location block and add the deny rule there too.

- [ ] **Step 3: Commit**

```bash
git add docker/nginx.conf docker/nginx.conf.template
git commit -m "feat(backup): block direct access to archives/history/ in nginx"
```

---

## Chunk 6: Admin Panel UI

### Task 10: Add version history section to admin panel

**Files:**
- Modify: `docker/admin.html` (add version history rendering + fetch logic)

- [ ] **Step 1: Add version count to the archive row in the Archives table**

In `renderArchiveRow` (around line 1098), the function currently renders a table row with filename, size, assets, and date. Add a `version_count` column. The version count needs to come from the API — we'll add it to the `buildArchiveObjectFromRow` response.

First, in `docker/meta-server.js`, modify `buildArchiveObjectFromRow` (around line 440) to include a version count:

```js
    // Add version count
    const versionCount = db.prepare('SELECT COUNT(*) as count FROM archive_versions WHERE archive_id = ?').get(row.id);
```

Add `version_count: versionCount ? versionCount.count : 0` to the returned object.

- [ ] **Step 2: Add version history expandable section in admin.html**

In the admin.html `<script>` section, after the `renderArchiveRow` function (around line 1114), add a function to render version history for an archive when its row is expanded:

```js
async function loadVersionHistory(hash, container) {
    container.innerHTML = '<em>Loading...</em>';
    try {
        const data = await apiFetch('/api/archives/' + hash + '/versions');
        if (!data.versions || data.versions.length === 0) {
            container.innerHTML = '<em class="td-faint">No previous versions</em>';
            return;
        }
        container.innerHTML = '<table class="data-table" style="margin:0"><thead><tr>' +
            '<th>Date</th><th>Size</th><th>Actions</th>' +
            '</tr></thead><tbody>' +
            data.versions.map(v => {
                const date = v.created_at ? new Date(v.created_at).toLocaleString() : '—';
                return '<tr>' +
                    '<td class="td-muted">' + escapeHtml(date) + '</td>' +
                    '<td class="td-muted">' + formatBytes(v.size) + '</td>' +
                    '<td>' +
                        '<a href="/api/archives/' + escapeHtml(hash) + '/versions/' + v.id + '/download" class="btn-link" style="margin-right:8px">Download</a>' +
                        '<button class="btn-danger btn-sm btn-delete-version" data-hash="' + escapeHtml(hash) + '" data-version-id="' + v.id + '">Delete</button>' +
                    '</td>' +
                '</tr>';
            }).join('') +
            '</tbody></table>';
    } catch (err) {
        container.innerHTML = '<em class="td-faint">Failed to load versions</em>';
    }
}
```

- [ ] **Step 3: Update renderArchiveRow to include expandable version history**

Modify `renderArchiveRow` to add an expandable row for version history. Update the function to:

```js
function renderArchiveRow(a) {
    let assets = '—';
    try {
        const types = typeof a.asset_types === 'string' ? JSON.parse(a.asset_types) : (a.asset_types || []);
        if (Array.isArray(types) && types.length) {
            assets = types.map(t => escapeHtml(typeof t === 'object' ? (t.role || t.type || '?') : String(t))).join(', ');
        }
    } catch (_) { /* ignore */ }

    const created = a.created_at ? new Date(a.created_at).toLocaleDateString() : '—';
    const vcCount = a.version_count || 0;
    const vcLabel = vcCount > 0 ? '<span class="badge-default" style="cursor:pointer;font-size:10px" onclick="toggleVersionHistory(this, \'' + escapeHtml(a.hash) + '\')">' + vcCount + ' backup' + (vcCount !== 1 ? 's' : '') + '</span>' : '';

    return `<tr>
        <td class="td-mono">${escapeHtml(a.filename || a.hash || '—')}</td>
        <td class="td-muted">${formatBytes(a.size)}</td>
        <td class="td-muted">${assets}</td>
        <td class="td-faint">${escapeHtml(created)}</td>
        <td>${vcLabel}</td>
    </tr>
    <tr class="version-history-row" style="display:none" data-hash="${escapeHtml(a.hash)}">
        <td colspan="5" style="padding:4px 12px">
            <div class="version-history-container"></div>
        </td>
    </tr>`;
}
```

- [ ] **Step 4: Add toggle and delete event handlers**

Add these functions in the admin.html script section:

```js
function toggleVersionHistory(badge, hash) {
    const row = document.querySelector('.version-history-row[data-hash="' + hash + '"]');
    if (!row) return;
    const isHidden = row.style.display === 'none';
    row.style.display = isHidden ? '' : 'none';
    if (isHidden) {
        loadVersionHistory(hash, row.querySelector('.version-history-container'));
    }
}

document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-delete-version');
    if (!btn) return;
    const hash = btn.dataset.hash;
    const versionId = btn.dataset.versionId;
    if (!confirm('Delete this backup version?')) return;
    try {
        await apiDelete('/api/archives/' + hash + '/versions/' + versionId);
        const container = btn.closest('.version-history-container');
        if (container) loadVersionHistory(hash, container);
    } catch (err) {
        alert('Delete failed: ' + err.message);
    }
});
```

- [ ] **Step 5: Verify the admin page loads without JS errors**

Build and test: `node -c docker/meta-server.js` to verify syntax. Full testing requires Docker deployment.

- [ ] **Step 6: Commit**

```bash
git add docker/meta-server.js docker/admin.html
git commit -m "feat(backup): add version history UI to admin panel"
```

---

## Chunk 7: Library Panel UI

### Task 11: Add version history dropdown to library panel archive cards

**Files:**
- Modify: `src/modules/library-panel.ts:309-330` (renderCard function)
- Modify: `src/modules/library-panel.ts:400-444` (selectArchive function)
- Modify: `src/styles.css` (add styles for version history dropdown)

- [ ] **Step 1: Add version history section to the detail pane**

In `src/modules/library-panel.ts`, in the `selectArchive` function (around line 430, after `renderMetadata(archive)`), add a call to fetch and render version history:

```ts
    // Fetch and render backup version history
    fetchVersionHistory(archive.hash);
```

- [ ] **Step 2: Add the fetch and render functions**

Add these functions in `library-panel.ts` (after the `renderRecordings` function or in a logical location near the detail pane code):

```ts
async function fetchVersionHistory(hash: string): Promise<void> {
    const container = document.getElementById('library-version-history');
    if (!container) return;

    try {
        const res = await fetch('/api/archives/' + encodeURIComponent(hash) + '/versions', {
            credentials: 'include',
        });
        if (!res.ok) {
            container.style.display = 'none';
            return;
        }
        const data = await res.json();
        if (!data.versions || data.versions.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = '';
        const listEl = container.querySelector('.version-list');
        if (!listEl) return;

        listEl.innerHTML = data.versions.map((v: { id: number; size: number; created_at: string }) => {
            const date = v.created_at ? formatDateRelative(v.created_at) : '—';
            return '<div class="version-item">' +
                '<span class="version-date">' + escapeHtml(date) + '</span>' +
                '<span class="version-size">' + formatBytes(v.size) + '</span>' +
                '<a href="/api/archives/' + encodeURIComponent(hash) + '/versions/' + v.id + '/download" class="version-download" title="Download">↓</a>' +
            '</div>';
        }).join('');
    } catch {
        container.style.display = 'none';
    }
}
```

- [ ] **Step 3: Add the version history container to the detail pane HTML**

In `src/editor/index.html`, find the library detail pane section. The `#library-detail-recordings` element (around line 2917) is the closest sibling. Add after it:

```html
<div id="library-version-history" style="display:none">
    <div class="library-detail-label">Backup History</div>
    <div class="version-list"></div>
</div>
```

- [ ] **Step 4: Add CSS for version history items**

In `src/styles.css`, after the `.library-card-meta` styles (around line 5186), add:

```css
/* Library version history */
.version-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: 10px;
    color: var(--text-muted);
}
.version-date { flex: 1; }
.version-size { color: var(--text-faint); }
.version-download {
    color: var(--accent-text);
    text-decoration: none;
    font-size: 12px;
    padding: 2px 4px;
}
.version-download:hover { color: var(--accent); }
```

- [ ] **Step 5: Verify build**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/modules/library-panel.ts src/editor/index.html src/styles.css
git commit -m "feat(backup): add version history to library detail pane"
```

---

## Chunk 8: Final Verification

### Task 12: Build verification and manual testing notes

- [ ] **Step 1: Run full build**

Run: `npm run build`

- [ ] **Step 2: Run lint**

Run: `npm run lint`

- [ ] **Step 3: Run tests**

Run: `npm test`

- [ ] **Step 4: Verify meta-server.js syntax**

Run: `node -c docker/meta-server.js`

- [ ] **Step 5: Document manual test procedure**

The following should be tested in a Docker deployment:

1. Upload archive → re-upload same filename → verify backup in `history/` + DB row
2. Upload N+1 times → verify oldest pruned
3. Download backup via API → verify file content
4. Delete specific backup via API → verify file + row removed
5. Delete archive → verify history dir cleaned up
6. Rename archive → verify history dir renamed
7. Set `backup.maxVersions = 0` → verify no backups on re-upload
8. Check admin panel → version count badge shows, expand shows history table
9. Check library panel → version history section shows in detail pane
10. Verify `/archives/history/` returns 403 via direct browser access

- [ ] **Step 6: Final commit if any lint/build fixes needed**

```bash
git add -A
git commit -m "fix(backup): lint and build fixes"
```
