# Archive Version Control Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side archive version control with content-addressable blob storage, automatic versioning on upload, and a library UI for browsing/restoring/comparing/cherry-picking versions.

**Architecture:** On each archive upload, meta-server.js unpacks the ZIP, stores each file by SHA-256 hash in a blob store, and records a version in SQLite. The library detail pane gets a collapsible "Version History" section for browsing, comparing, restoring, and cherry-picking versions. Archives remain portable `.ddim` ZIPs — versioning is server-side only.

**Tech Stack:** Node.js (meta-server.js), better-sqlite3, zip/unzip CLI (already in Docker alpine image), existing library-panel.ts + editor/index.html

**Spec:** `docs/superpowers/specs/2026-03-10-archive-version-control-design.md`

---

## File Structure

### New Files
- `docker/lib/blob-store.js` — Content-addressable blob storage (unpack, store, retrieve, GC)
- `docker/lib/version-manager.js` — Version CRUD, diff generation, restore, cherry-pick, retention

### Modified Files
- `docker/meta-server.js` — New tables, new route handlers, modified upload handlers (409→version), settings
- `docker/Dockerfile` — Add `COPY docker/lib/ /opt/lib/` for blob-store and version-manager
- `src/editor/index.html` — New "Version History" collapsible section in library detail pane
- `src/modules/library-panel.ts` — Version history UI rendering, fetch, actions

---

## Chunk 1: Blob Store & SQLite Schema

### Task 1: Create new SQLite tables

**Files:**
- Modify: `docker/meta-server.js:363-435` (inside `initDb()` function)

- [ ] **Step 1: Add version control tables to initDb()**

After the existing `CREATE TABLE IF NOT EXISTS settings` block (line ~434), add:

```javascript
        -- Version control: content-addressable blob store
        CREATE TABLE IF NOT EXISTS blobs (
            hash       TEXT PRIMARY KEY,
            size       INTEGER NOT NULL,
            ref_count  INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS archive_versions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            archive_id      INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
            version_number  INTEGER NOT NULL,
            total_size      INTEGER NOT NULL DEFAULT 0,
            manifest        TEXT,
            summary         TEXT,
            parent_version_id INTEGER REFERENCES archive_versions(id),
            restored_from   INTEGER REFERENCES archive_versions(id),
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(archive_id, version_number)
        );
        CREATE INDEX IF NOT EXISTS idx_av_archive ON archive_versions(archive_id);

        CREATE TABLE IF NOT EXISTS version_assets (
            version_id INTEGER NOT NULL REFERENCES archive_versions(id) ON DELETE CASCADE,
            asset_path TEXT NOT NULL,
            blob_hash  TEXT NOT NULL REFERENCES blobs(hash),
            PRIMARY KEY (version_id, asset_path)
        );
        CREATE INDEX IF NOT EXISTS idx_va_blob ON version_assets(blob_hash);
```

- [ ] **Step 2: Add max_versions setting to SETTINGS_DEFAULTS**

In `SETTINGS_DEFAULTS` (line ~61), add after the last entry:

```javascript
    'version.maxPerArchive': { default: '5', type: 'number', label: 'Max Versions Per Archive', group: 'Storage', description: 'Number of versions to keep per archive (v1 always preserved)', min: 2, max: 100 },
```

- [ ] **Step 3: Verify tables are created**

Run the server and check SQLite:
```bash
cd docker && node -e "
const Database = require('better-sqlite3');
const db = new Database('/tmp/test-version.db');
// Paste the CREATE TABLE statements and verify they execute
db.exec('CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, size INTEGER NOT NULL, ref_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime(\"now\")))');
db.exec('CREATE TABLE IF NOT EXISTS archive_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, archive_id INTEGER NOT NULL, version_number INTEGER NOT NULL, total_size INTEGER NOT NULL DEFAULT 0, manifest TEXT, summary TEXT, parent_version_id INTEGER, restored_from INTEGER, created_at TEXT NOT NULL DEFAULT (datetime(\"now\")), UNIQUE(archive_id, version_number))');
db.exec('CREATE TABLE IF NOT EXISTS version_assets (version_id INTEGER NOT NULL, asset_path TEXT NOT NULL, blob_hash TEXT NOT NULL, PRIMARY KEY (version_id, asset_path))');
console.log('All tables created successfully');
db.close();
"
```
Expected: "All tables created successfully"

- [ ] **Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(version): add SQLite tables for blob store and version tracking"
```

---

### Task 2: Create blob-store.js

**Files:**
- Create: `docker/lib/blob-store.js`

This module handles content-addressable blob storage: storing files by SHA-256 hash, retrieving them, and garbage collection.

- [ ] **Step 1: Create docker/lib/ directory**

```bash
mkdir -p docker/lib
```

- [ ] **Step 2: Write blob-store.js**

```javascript
/**
 * Content-addressable blob store.
 *
 * Files are stored at: BLOBS_DIR/{first-2-chars}/{full-hash}
 * Deduplication is automatic — identical files share one blob.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let db = null;
let BLOBS_DIR = '';

/**
 * Initialize the blob store.
 * @param {import('better-sqlite3').Database} database
 * @param {string} blobsDir - Root directory for blob storage
 */
function init(database, blobsDir) {
    db = database;
    BLOBS_DIR = blobsDir;
    if (!fs.existsSync(BLOBS_DIR)) {
        fs.mkdirSync(BLOBS_DIR, { recursive: true });
    }
}

/**
 * Compute SHA-256 hash of a file.
 * @param {string} filePath
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    const data = fs.readFileSync(filePath);
    hash.update(data);
    return hash.digest('hex');
}

/**
 * Compute SHA-256 hash of a buffer.
 * @param {Buffer} buffer
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashBuffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Get the filesystem path for a blob hash.
 * @param {string} hash
 * @returns {string}
 */
function blobPath(hash) {
    return path.join(BLOBS_DIR, hash.substring(0, 2), hash);
}

/**
 * Store a buffer as a blob. Returns the hash.
 * Does NOT update ref_count — caller must do that via incrementRefs().
 * @param {Buffer} buffer
 * @returns {string} hash
 */
function storeBuffer(buffer) {
    const hash = hashBuffer(buffer);
    const dest = blobPath(hash);

    // Check if blob already exists on disk
    if (!fs.existsSync(dest)) {
        const dir = path.dirname(dest);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(dest, buffer);
    }

    // Upsert into blobs table (ref_count not touched here)
    db.prepare(`
        INSERT INTO blobs (hash, size) VALUES (?, ?)
        ON CONFLICT(hash) DO NOTHING
    `).run(hash, buffer.length);

    return hash;
}

/**
 * Store a file as a blob (reads file, stores by hash). Returns the hash.
 * @param {string} filePath
 * @returns {string} hash
 */
function storeFile(filePath) {
    const buffer = fs.readFileSync(filePath);
    return storeBuffer(buffer);
}

/**
 * Read a blob by hash. Returns the buffer or null if not found.
 * @param {string} hash
 * @returns {Buffer | null}
 */
function readBlob(hash) {
    const p = blobPath(hash);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
}

/**
 * Get a readable stream for a blob.
 * @param {string} hash
 * @returns {fs.ReadStream | null}
 */
function readBlobStream(hash) {
    const p = blobPath(hash);
    if (!fs.existsSync(p)) return null;
    return fs.createReadStream(p);
}

/**
 * Increment ref_count for a list of blob hashes (within caller's transaction).
 * @param {string[]} hashes
 */
function incrementRefs(hashes) {
    const stmt = db.prepare('UPDATE blobs SET ref_count = ref_count + 1 WHERE hash = ?');
    for (const hash of hashes) {
        stmt.run(hash);
    }
}

/**
 * Decrement ref_count for a list of blob hashes (within caller's transaction).
 * @param {string[]} hashes
 */
function decrementRefs(hashes) {
    const stmt = db.prepare('UPDATE blobs SET ref_count = ref_count - 1 WHERE hash = ?');
    for (const hash of hashes) {
        stmt.run(hash);
    }
}

/**
 * Delete blobs with ref_count <= 0 from disk and DB.
 * Call after decrementing refs (within same transaction or after commit).
 * @returns {number} Number of blobs deleted
 */
function garbageCollect() {
    const orphans = db.prepare('SELECT hash FROM blobs WHERE ref_count <= 0').all();
    let deleted = 0;
    for (const { hash } of orphans) {
        const p = blobPath(hash);
        try { fs.unlinkSync(p); } catch {}
        // Try to remove empty subdirectory
        try { fs.rmdirSync(path.dirname(p)); } catch {}
        deleted++;
    }
    db.prepare('DELETE FROM blobs WHERE ref_count <= 0').run();
    return deleted;
}

/**
 * Get total size of all blobs on disk (from DB).
 * @returns {number} Total bytes
 */
function totalSize() {
    const row = db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM blobs WHERE ref_count > 0').get();
    return row.total;
}

module.exports = {
    init,
    hashFile,
    hashBuffer,
    blobPath,
    storeBuffer,
    storeFile,
    readBlob,
    readBlobStream,
    incrementRefs,
    decrementRefs,
    garbageCollect,
    totalSize,
};
```

- [ ] **Step 3: Verify module loads**

```bash
cd docker && node -e "const bs = require('./lib/blob-store'); console.log(Object.keys(bs));"
```
Expected: Array of exported function names

- [ ] **Step 4: Commit**

```bash
git add docker/lib/blob-store.js
git commit -m "feat(version): add content-addressable blob store module"
```

---

### Task 3: Create version-manager.js

**Files:**
- Create: `docker/lib/version-manager.js`

This module handles version CRUD: creating versions from unpacked archives, generating diffs/summaries, restore, cherry-pick, and retention pruning.

- [ ] **Step 1: Write version-manager.js**

```javascript
/**
 * Archive version manager.
 *
 * Creates versions from uploaded archives, generates change summaries,
 * handles restore/cherry-pick, and enforces retention limits.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const blobStore = require('./blob-store');

let db = null;
let getSetting = null;

/**
 * Initialize the version manager.
 * @param {import('better-sqlite3').Database} database
 * @param {Function} getSettingFn - The getSetting(key) function from meta-server
 */
function init(database, getSettingFn) {
    db = database;
    getSetting = getSettingFn;
}

/**
 * Unpack a .ddim/.a3d/.a3z archive and create a new version.
 * Returns the created version row, or null if the archive is identical to the previous version.
 *
 * @param {number} archiveId - The archives.id
 * @param {string} archivePath - Absolute path to the archive file on disk
 * @returns {{ id: number, version_number: number, summary: string } | null}
 */
function createVersionFromArchive(archiveId, archivePath) {
    // Unpack archive to temp dir
    const tmpDir = path.join('/tmp', 'v3d_unpack_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
        execSync(`unzip -o -q "${archivePath}" -d "${tmpDir}"`, { timeout: 60000 });
    } catch (err) {
        // Clean up on failure
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        throw new Error('Failed to unpack archive: ' + err.message);
    }

    try {
        // Walk the unpacked directory and store each file as a blob
        const assets = {}; // { relativePath: { hash, size } }
        walkDir(tmpDir, tmpDir, assets);

        // Check if identical to previous version
        const prevVersion = db.prepare(
            'SELECT id, version_number FROM archive_versions WHERE archive_id = ? ORDER BY version_number DESC LIMIT 1'
        ).get(archiveId);

        if (prevVersion) {
            const prevAssets = db.prepare(
                'SELECT asset_path, blob_hash FROM version_assets WHERE version_id = ?'
            ).all(prevVersion.id);

            const prevMap = {};
            for (const pa of prevAssets) prevMap[pa.asset_path] = pa.blob_hash;

            // Compare: same keys, same hashes
            const currentKeys = Object.keys(assets).sort();
            const prevKeys = Object.keys(prevMap).sort();
            if (currentKeys.length === prevKeys.length &&
                currentKeys.every((k, i) => k === prevKeys[i] && assets[k].hash === prevMap[k])) {
                return null; // Identical — skip version creation
            }
        }

        // Read manifest for storage
        let manifest = null;
        const manifestPath = path.join(tmpDir, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            manifest = fs.readFileSync(manifestPath, 'utf8');
        }

        // Create version in a transaction
        const newVersion = db.transaction(() => {
            const versionNumber = prevVersion ? prevVersion.version_number + 1 : 1;

            // Calculate total size
            let totalSize = 0;
            for (const a of Object.values(assets)) totalSize += a.size;

            const result = db.prepare(`
                INSERT INTO archive_versions (archive_id, version_number, total_size, manifest, summary, parent_version_id)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                archiveId,
                versionNumber,
                totalSize,
                manifest,
                versionNumber === 1 ? 'Initial version' : null, // Summary filled below for v2+
                prevVersion ? prevVersion.id : null
            );

            const versionId = result.lastInsertRowid;

            // Insert version_assets and increment blob ref counts
            const insertAsset = db.prepare(
                'INSERT INTO version_assets (version_id, asset_path, blob_hash) VALUES (?, ?, ?)'
            );
            const hashes = [];
            for (const [assetPath, info] of Object.entries(assets)) {
                insertAsset.run(versionId, assetPath, info.hash);
                hashes.push(info.hash);
            }
            blobStore.incrementRefs(hashes);

            return { id: Number(versionId), version_number: versionNumber, total_size: totalSize };
        })();

        // Generate summary for v2+ (outside transaction for simplicity)
        if (newVersion.version_number > 1 && prevVersion) {
            const summary = generateSummary(newVersion.id, prevVersion.id);
            db.prepare('UPDATE archive_versions SET summary = ? WHERE id = ?').run(summary, newVersion.id);
            newVersion.summary = summary;
        } else {
            newVersion.summary = 'Initial version';
        }

        // Enforce retention
        enforceRetention(archiveId);

        return newVersion;
    } finally {
        // Clean up temp dir
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
}

/**
 * Recursively walk a directory and store all files as blobs.
 * @param {string} dir - Current directory
 * @param {string} baseDir - Root of the unpacked archive
 * @param {Object} assets - Output map: { relativePath: { hash, size } }
 */
function walkDir(dir, baseDir, assets) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDir(fullPath, baseDir, assets);
        } else if (entry.isFile()) {
            const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
            const hash = blobStore.storeFile(fullPath);
            const size = fs.statSync(fullPath).size;
            assets[relativePath] = { hash, size };
        }
    }
}

/**
 * Generate a human-readable change summary between two versions.
 * @param {number} newVersionId
 * @param {number} oldVersionId
 * @returns {string}
 */
function generateSummary(newVersionId, oldVersionId) {
    const diff = diffVersions(newVersionId, oldVersionId);
    const parts = [];

    // Asset changes
    if (diff.assets.added.length > 0) {
        parts.push(diff.assets.added.length + ' asset(s) added');
    }
    if (diff.assets.removed.length > 0) {
        parts.push(diff.assets.removed.length + ' asset(s) removed');
    }
    if (diff.assets.changed.length > 0) {
        for (const c of diff.assets.changed) {
            // Try to give a meaningful description
            if (c.path.startsWith('assets/')) {
                const name = c.path.replace('assets/', '');
                const oldSize = formatBytes(c.oldSize || 0);
                const newSize = formatBytes(c.newSize || 0);
                parts.push(name + ' replaced (' + oldSize + ' → ' + newSize + ')');
            }
        }
        if (parts.length === 0) {
            parts.push(diff.assets.changed.length + ' asset(s) changed');
        }
    }

    // Manifest changes (if both versions have manifests)
    if (diff.manifest) {
        const m = diff.manifest;
        if (m.annotations) parts.push(m.annotations);
        if (m.walkthrough) parts.push(m.walkthrough);
        if (m.alignment) parts.push('Alignment updated');
        if (m.viewerSettings) parts.push('Viewer settings changed');
        if (m.project) parts.push(m.project);
        if (m.provenance) parts.push('Provenance updated');
        if (m.quality) parts.push('Quality metrics updated');
    }

    return parts.length > 0 ? parts.join(', ') : 'Minor changes';
}

/**
 * Compute a structured diff between two versions.
 * @param {number} versionIdA - Newer version
 * @param {number} versionIdB - Older version
 * @returns {Object} Diff structure
 */
function diffVersions(versionIdA, versionIdB) {
    const assetsA = db.prepare('SELECT asset_path, blob_hash FROM version_assets WHERE version_id = ?').all(versionIdA);
    const assetsB = db.prepare('SELECT asset_path, blob_hash FROM version_assets WHERE version_id = ?').all(versionIdB);

    const mapA = {};
    for (const a of assetsA) mapA[a.asset_path] = a.blob_hash;
    const mapB = {};
    for (const b of assetsB) mapB[b.asset_path] = b.blob_hash;

    const added = [];
    const removed = [];
    const changed = [];

    // Find added and changed
    for (const [pathKey, hashA] of Object.entries(mapA)) {
        if (!(pathKey in mapB)) {
            const blob = db.prepare('SELECT size FROM blobs WHERE hash = ?').get(hashA);
            added.push({ path: pathKey, hash: hashA, size: blob ? blob.size : 0 });
        } else if (mapB[pathKey] !== hashA) {
            const blobA = db.prepare('SELECT size FROM blobs WHERE hash = ?').get(hashA);
            const blobB = db.prepare('SELECT size FROM blobs WHERE hash = ?').get(mapB[pathKey]);
            changed.push({
                path: pathKey,
                oldHash: mapB[pathKey],
                newHash: hashA,
                oldSize: blobB ? blobB.size : 0,
                newSize: blobA ? blobA.size : 0,
            });
        }
    }

    // Find removed
    for (const pathKey of Object.keys(mapB)) {
        if (!(pathKey in mapA)) {
            const blob = db.prepare('SELECT size FROM blobs WHERE hash = ?').get(mapB[pathKey]);
            removed.push({ path: pathKey, hash: mapB[pathKey], size: blob ? blob.size : 0 });
        }
    }

    // Manifest diff
    const verA = db.prepare('SELECT manifest FROM archive_versions WHERE id = ?').get(versionIdA);
    const verB = db.prepare('SELECT manifest FROM archive_versions WHERE id = ?').get(versionIdB);

    let manifestDiff = null;
    if (verA?.manifest && verB?.manifest) {
        try {
            const mA = JSON.parse(verA.manifest);
            const mB = JSON.parse(verB.manifest);
            manifestDiff = diffManifests(mA, mB);
        } catch {}
    }

    return {
        assets: { added, removed, changed },
        manifest: manifestDiff,
    };
}

/**
 * Diff two parsed manifest objects, returning human-readable change descriptions.
 * @param {Object} mNew
 * @param {Object} mOld
 * @returns {Object}
 */
function diffManifests(mNew, mOld) {
    const result = {};

    // Annotations
    const annNew = (mNew.annotations || []).length;
    const annOld = (mOld.annotations || []).length;
    if (annNew !== annOld) {
        const added = Math.max(0, annNew - annOld);
        const removed = Math.max(0, annOld - annNew);
        const parts = [];
        if (added) parts.push(added + ' added');
        if (removed) parts.push(removed + ' removed');
        result.annotations = parts.join(', ') + ' annotation(s)';
    } else if (annNew > 0 && JSON.stringify(mNew.annotations) !== JSON.stringify(mOld.annotations)) {
        result.annotations = 'Annotations modified';
    }

    // Walkthrough
    const walkNew = (mNew.walkthrough || []).length;
    const walkOld = (mOld.walkthrough || []).length;
    if (walkNew !== walkOld || (walkNew > 0 && JSON.stringify(mNew.walkthrough) !== JSON.stringify(mOld.walkthrough))) {
        result.walkthrough = 'Walkthrough updated';
    }

    // Alignment
    if (JSON.stringify(mNew.alignment) !== JSON.stringify(mOld.alignment)) {
        result.alignment = true;
    }

    // Viewer settings
    if (JSON.stringify(mNew.viewer_settings) !== JSON.stringify(mOld.viewer_settings)) {
        result.viewerSettings = true;
    }

    // Project metadata
    const projNew = mNew.project || {};
    const projOld = mOld.project || {};
    const projChanges = [];
    if (projNew.title !== projOld.title) projChanges.push("Title changed to '" + projNew.title + "'");
    if (projNew.description !== projOld.description) projChanges.push('Description updated');
    if (JSON.stringify(projNew.tags) !== JSON.stringify(projOld.tags)) projChanges.push('Tags updated');
    if (projChanges.length) result.project = projChanges.join(', ');

    // Provenance
    if (JSON.stringify(mNew.provenance) !== JSON.stringify(mOld.provenance)) {
        result.provenance = true;
    }

    // Quality
    if (JSON.stringify(mNew.quality_metrics) !== JSON.stringify(mOld.quality_metrics)) {
        result.quality = true;
    }

    return Object.keys(result).length > 0 ? result : null;
}

/**
 * List all versions for an archive.
 * @param {number} archiveId
 * @returns {Array}
 */
function listVersions(archiveId) {
    return db.prepare(`
        SELECT id, version_number, total_size, summary, restored_from, created_at
        FROM archive_versions
        WHERE archive_id = ?
        ORDER BY version_number DESC
    `).all(archiveId);
}

/**
 * Get a single version with full detail.
 * @param {number} archiveId
 * @param {number} versionNumber
 * @returns {Object | null}
 */
function getVersion(archiveId, versionNumber) {
    const version = db.prepare(`
        SELECT * FROM archive_versions
        WHERE archive_id = ? AND version_number = ?
    `).get(archiveId, versionNumber);
    if (!version) return null;

    const assets = db.prepare(`
        SELECT va.asset_path, va.blob_hash, b.size
        FROM version_assets va
        JOIN blobs b ON b.hash = va.blob_hash
        WHERE va.version_id = ?
    `).all(version.id);

    return { ...version, assets };
}

/**
 * Restore a previous version (creates a new version with the old version's state).
 * @param {number} archiveId
 * @param {number} sourceVersionNumber - The version number to restore from
 * @param {string} archivesDir - Path to /archives/ directory for rebuilding the .ddim
 * @param {string} filename - Archive filename for rebuilding
 * @returns {Object} The new version row
 */
function restoreVersion(archiveId, sourceVersionNumber, archivesDir, filename) {
    const source = db.prepare(`
        SELECT id, version_number, manifest FROM archive_versions
        WHERE archive_id = ? AND version_number = ?
    `).get(archiveId, sourceVersionNumber);
    if (!source) throw new Error('Source version not found');

    const sourceAssets = db.prepare(
        'SELECT asset_path, blob_hash FROM version_assets WHERE version_id = ?'
    ).all(source.id);

    const newVersion = db.transaction(() => {
        const latest = db.prepare(
            'SELECT version_number FROM archive_versions WHERE archive_id = ? ORDER BY version_number DESC LIMIT 1'
        ).get(archiveId);
        const newNum = (latest ? latest.version_number : 0) + 1;

        // Calculate total size
        let totalSize = 0;
        const hashes = sourceAssets.map(a => a.blob_hash);
        for (const hash of hashes) {
            const blob = db.prepare('SELECT size FROM blobs WHERE hash = ?').get(hash);
            if (blob) totalSize += blob.size;
        }

        const result = db.prepare(`
            INSERT INTO archive_versions (archive_id, version_number, total_size, manifest, summary, parent_version_id, restored_from)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            archiveId, newNum, totalSize, source.manifest,
            'Restored from v' + source.version_number,
            latest ? latest.version_number : null,
            source.id
        );

        const versionId = result.lastInsertRowid;

        const insertAsset = db.prepare(
            'INSERT INTO version_assets (version_id, asset_path, blob_hash) VALUES (?, ?, ?)'
        );
        for (const a of sourceAssets) {
            insertAsset.run(versionId, a.asset_path, a.blob_hash);
        }
        blobStore.incrementRefs(hashes);

        return { id: Number(versionId), version_number: newNum, summary: 'Restored from v' + source.version_number };
    })();

    // Rebuild the .ddim on disk from the restored version's blobs
    rebuildArchiveFile(newVersion.id, archivesDir, filename);

    // Enforce retention
    enforceRetention(archiveId);

    return newVersion;
}

/**
 * Cherry-pick sections from a source version into the current version.
 * @param {number} archiveId
 * @param {number} sourceVersionNumber
 * @param {string[]} sections - Manifest sections to cherry-pick
 * @param {string} archivesDir
 * @param {string} filename
 * @returns {Object} The new version row
 */
function cherryPick(archiveId, sourceVersionNumber, sections, archivesDir, filename) {
    const source = db.prepare(`
        SELECT id, version_number, manifest FROM archive_versions
        WHERE archive_id = ? AND version_number = ?
    `).get(archiveId, sourceVersionNumber);
    if (!source) throw new Error('Source version not found');

    const latest = db.prepare(`
        SELECT id, version_number, manifest FROM archive_versions
        WHERE archive_id = ? ORDER BY version_number DESC LIMIT 1
    `).get(archiveId);
    if (!latest) throw new Error('No current version exists');

    let newManifest = null;
    try {
        const currentManifest = latest.manifest ? JSON.parse(latest.manifest) : {};
        const sourceManifest = source.manifest ? JSON.parse(source.manifest) : {};

        // Merge selected sections from source into current
        for (const section of sections) {
            if (section === 'annotations') {
                currentManifest.annotations = sourceManifest.annotations;
                currentManifest.walkthrough = sourceManifest.walkthrough;
            } else if (section === 'alignment') {
                currentManifest.alignment = sourceManifest.alignment;
            } else if (section === 'viewer_settings') {
                currentManifest.viewer_settings = sourceManifest.viewer_settings;
            } else if (section === 'data_entries') {
                currentManifest.data_entries = sourceManifest.data_entries;
            } else if (section === 'project') {
                currentManifest.project = sourceManifest.project;
            } else if (section === 'provenance') {
                currentManifest.provenance = sourceManifest.provenance;
            } else if (section === 'quality_metrics') {
                currentManifest.quality_metrics = sourceManifest.quality_metrics;
            }
        }
        newManifest = JSON.stringify(currentManifest, null, 2);
    } catch {
        throw new Error('Failed to merge manifests');
    }

    // Determine which asset set to use
    const useSourceAssets = sections.includes('data_entries');
    const assetSource = useSourceAssets ? source : latest;
    const sourceAssets = db.prepare(
        'SELECT asset_path, blob_hash FROM version_assets WHERE version_id = ?'
    ).all(assetSource.id);

    // If cherry-picking data_entries, also need to swap non-manifest files (assets/)
    // If NOT cherry-picking data_entries, keep current version's asset blobs but update manifest.json blob
    let finalAssets;
    if (useSourceAssets) {
        // Use source version's asset blobs + new merged manifest
        finalAssets = sourceAssets.filter(a => a.asset_path !== 'manifest.json');
    } else {
        // Use current version's asset blobs + new merged manifest
        const currentAssets = db.prepare(
            'SELECT asset_path, blob_hash FROM version_assets WHERE version_id = ?'
        ).all(latest.id);
        finalAssets = currentAssets.filter(a => a.asset_path !== 'manifest.json');
    }

    // Store the new manifest as a blob
    const manifestHash = blobStore.storeBuffer(Buffer.from(newManifest, 'utf8'));
    finalAssets.push({ asset_path: 'manifest.json', blob_hash: manifestHash });

    const sectionNames = sections.join(', ');
    const newVersion = db.transaction(() => {
        const newNum = latest.version_number + 1;

        let totalSize = 0;
        const hashes = finalAssets.map(a => a.blob_hash);
        for (const hash of hashes) {
            const blob = db.prepare('SELECT size FROM blobs WHERE hash = ?').get(hash);
            if (blob) totalSize += blob.size;
        }

        const result = db.prepare(`
            INSERT INTO archive_versions (archive_id, version_number, total_size, manifest, summary, parent_version_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            archiveId, newNum, totalSize, newManifest,
            'Cherry-picked ' + sectionNames + ' from v' + source.version_number,
            latest.id
        );

        const versionId = result.lastInsertRowid;
        const insertAsset = db.prepare(
            'INSERT INTO version_assets (version_id, asset_path, blob_hash) VALUES (?, ?, ?)'
        );
        for (const a of finalAssets) {
            insertAsset.run(versionId, a.asset_path, a.blob_hash);
        }
        blobStore.incrementRefs(hashes);

        return { id: Number(versionId), version_number: newNum, summary: 'Cherry-picked ' + sectionNames + ' from v' + source.version_number };
    })();

    // Rebuild the .ddim on disk
    rebuildArchiveFile(newVersion.id, archivesDir, filename);

    enforceRetention(archiveId);

    return newVersion;
}

/**
 * Rebuild a .ddim archive file on disk from a version's blobs.
 * Synchronous: writes blobs to a temp dir, then shells out to `zip`.
 * @param {number} versionId
 * @param {string} archivesDir
 * @param {string} filename
 */
function rebuildArchiveFile(versionId, archivesDir, filename) {
    const assets = db.prepare(
        'SELECT asset_path, blob_hash FROM version_assets WHERE version_id = ?'
    ).all(versionId);

    const tmpDir = path.join('/tmp', 'v3d_rebuild_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
        // Write each blob to its asset path in the temp dir
        for (const { asset_path, blob_hash } of assets) {
            const dest = path.join(tmpDir, asset_path);
            const dir = path.dirname(dest);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const data = blobStore.readBlob(blob_hash);
            if (data) fs.writeFileSync(dest, data);
        }

        // Create ZIP using shell (matches the unzip pattern used in createVersionFromArchive)
        const outputPath = path.join(archivesDir, filename);
        const tmpZip = outputPath + '.tmp';
        execSync(`cd "${tmpDir}" && zip -r -1 -q "${tmpZip}" .`, { timeout: 120000 });

        // Atomic replace
        fs.renameSync(tmpZip, outputPath);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
}

/**
 * Enforce version retention limit. Prunes oldest versions (except v1).
 * @param {number} archiveId
 */
function enforceRetention(archiveId) {
    const maxVersions = parseInt(getSetting('version.maxPerArchive'), 10) || 5;

    const versions = db.prepare(`
        SELECT id, version_number FROM archive_versions
        WHERE archive_id = ?
        ORDER BY version_number ASC
    `).all(archiveId);

    if (versions.length <= maxVersions) return;

    // Keep v1 (first) + the (maxVersions - 1) most recent
    const toKeep = new Set();
    toKeep.add(versions[0].id); // v1 always kept
    const recent = versions.slice(-(maxVersions - 1));
    for (const v of recent) toKeep.add(v.id);

    const toPrune = versions.filter(v => !toKeep.has(v.id));

    db.transaction(() => {
        for (const v of toPrune) {
            // Get blob hashes for this version
            const assets = db.prepare(
                'SELECT blob_hash FROM version_assets WHERE version_id = ?'
            ).all(v.id);
            const hashes = assets.map(a => a.blob_hash);

            // Delete version_assets (CASCADE would handle this, but we need hashes first)
            db.prepare('DELETE FROM version_assets WHERE version_id = ?').run(v.id);

            // Decrement ref counts
            blobStore.decrementRefs(hashes);

            // Delete version row
            db.prepare('DELETE FROM archive_versions WHERE id = ?').run(v.id);
        }
    })();

    // GC orphaned blobs
    blobStore.garbageCollect();
}

/**
 * Delete all versions and blobs for an archive (called when archive is deleted).
 * @param {number} archiveId
 */
function deleteAllVersions(archiveId) {
    const versions = db.prepare(
        'SELECT id FROM archive_versions WHERE archive_id = ?'
    ).all(archiveId);

    db.transaction(() => {
        for (const v of versions) {
            const assets = db.prepare(
                'SELECT blob_hash FROM version_assets WHERE version_id = ?'
            ).all(v.id);
            const hashes = assets.map(a => a.blob_hash);
            db.prepare('DELETE FROM version_assets WHERE version_id = ?').run(v.id);
            blobStore.decrementRefs(hashes);
        }
        db.prepare('DELETE FROM archive_versions WHERE archive_id = ?').run(archiveId);
    })();

    blobStore.garbageCollect();
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

module.exports = {
    init,
    createVersionFromArchive,
    listVersions,
    getVersion,
    diffVersions,
    restoreVersion,
    cherryPick,
    rebuildArchiveFile,
    enforceRetention,
    deleteAllVersions,
};
```

- [ ] **Step 2: Verify module loads**

```bash
cd docker && node -e "const vm = require('./lib/version-manager'); console.log(Object.keys(vm));"
```
Expected: Array of exported function names

- [ ] **Step 3: Commit**

```bash
git add docker/lib/version-manager.js
git commit -m "feat(version): add version manager with diff, restore, cherry-pick, retention"
```

---

## Chunk 2: Server Integration & API Endpoints

### Task 4: Wire blob store and version manager into meta-server.js

**Files:**
- Modify: `docker/meta-server.js`

- [ ] **Step 1: Add requires at top of file**

After the existing requires (around line ~10), add:

```javascript
const blobStore = require('./lib/blob-store');
const versionManager = require('./lib/version-manager');
```

- [ ] **Step 2: Initialize modules in initDb()**

After the schema creation in `initDb()` (around line ~435), add:

```javascript
    // Initialize version control modules
    const blobsDir = path.join(HTML_ROOT, 'blobs');
    blobStore.init(db, blobsDir);
    versionManager.init(db, getSetting);
```

- [ ] **Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(version): wire blob store and version manager into meta-server"
```

---

### Task 5: Modify upload handlers to create versions

**Files:**
- Modify: `docker/meta-server.js:1269-1350` (handleUploadArchive)
- Modify: `docker/meta-server.js:2301-2405` (handleCompleteChunk)

- [ ] **Step 1: Modify handleUploadArchive — change 409 to version-creation**

Replace the duplicate check block (lines 1281-1285):

```javascript
        // Check for duplicate
        if (fs.existsSync(finalPath)) {
            try { fs.unlinkSync(tmpPath); } catch {}
            return sendJson(res, 409, { error: 'File already exists: ' + filename });
        }
```

With:

```javascript
        // Re-uploads are allowed — versioning handles history.
        // The ON CONFLICT(hash) DO UPDATE upsert below handles the DB side.
        // fs.renameSync will overwrite the existing file on disk.
```

Then after the DB upsert (around line 1333), before the audit log, add:

```javascript
        // Create version from the uploaded archive
        const archiveRow = db.prepare('SELECT id FROM archives WHERE hash = ?').get(hash);
        if (archiveRow) {
            try {
                const version = versionManager.createVersionFromArchive(archiveRow.id, finalPath);
                if (version) {
                    console.log('[version] Created v' + version.version_number + ' for ' + filename + ': ' + version.summary);
                }
            } catch (err) {
                console.warn('[version] Failed to create version for ' + filename + ':', err.message);
                // Non-fatal — upload still succeeds
            }
        }
```

- [ ] **Step 2: Modify handleCompleteChunk — same changes**

Replace the duplicate check block (lines 2325-2327):

```javascript
        if (fs.existsSync(finalPath)) {
            return sendJson(res, 409, { error: 'File already exists: ' + filename });
        }
```

With:

```javascript
        const isReUpload = fs.existsSync(finalPath);
```

And add the same version creation block after the DB upsert (around line 2393):

```javascript
        // Create version from the uploaded archive
        const archiveRow = db.prepare('SELECT id FROM archives WHERE hash = ?').get(chunkHash);
        if (archiveRow) {
            try {
                const version = versionManager.createVersionFromArchive(archiveRow.id, finalPath);
                if (version) {
                    console.log('[version] Created v' + version.version_number + ' for ' + filename + ': ' + version.summary);
                }
            } catch (err) {
                console.warn('[version] Failed to create version for ' + filename + ':', err.message);
            }
        }
```

- [ ] **Step 3: Modify handleDeleteArchive to clean up versions**

In `handleDeleteArchive` (line ~1382), inside the transaction, add before the DELETE:

```javascript
        // Clean up all version data
        const archiveRow = db.prepare('SELECT id FROM archives WHERE hash = ?').get(hash);
        if (archiveRow) {
            versionManager.deleteAllVersions(archiveRow.id);
        }
```

- [ ] **Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(version): auto-create versions on upload, clean up on delete"
```

---

### Task 6: Add version API endpoints

**Files:**
- Modify: `docker/meta-server.js` (new handler functions + route registration)

- [ ] **Step 1: Add handler functions**

Add these new functions after the existing archive handlers (after `handleRenameArchive`, around line ~1540):

```javascript
// --- Version Control API ---

/**
 * GET /api/archives/:hash/versions — list all versions
 */
function handleListVersions(req, res, hash) {
    const row = db.prepare('SELECT id FROM archives WHERE hash = ?').get(hash);
    if (!row) return sendJson(res, 404, { error: 'Archive not found' });

    const versions = versionManager.listVersions(row.id);
    sendJson(res, 200, { versions });
}

/**
 * GET /api/archives/:hash/versions/:num — version detail
 */
function handleGetVersion(req, res, hash, num) {
    const row = db.prepare('SELECT id FROM archives WHERE hash = ?').get(hash);
    if (!row) return sendJson(res, 404, { error: 'Archive not found' });

    const version = versionManager.getVersion(row.id, num);
    if (!version) return sendJson(res, 404, { error: 'Version not found' });

    sendJson(res, 200, { version });
}

/**
 * GET /api/archives/:hash/versions/:num/download — download version as .ddim
 */
function handleDownloadVersion(req, res, hash, num) {
    const row = db.prepare('SELECT id, filename FROM archives WHERE hash = ?').get(hash);
    if (!row) return sendJson(res, 404, { error: 'Archive not found' });

    const version = versionManager.getVersion(row.id, num);
    if (!version) return sendJson(res, 404, { error: 'Version not found' });

    // For the latest version, serve the .ddim directly from disk (fast path)
    const latest = db.prepare(
        'SELECT version_number FROM archive_versions WHERE archive_id = ? ORDER BY version_number DESC LIMIT 1'
    ).get(row.id);
    if (latest && latest.version_number === num) {
        const filePath = path.join(ARCHIVES_DIR, row.filename);
        if (fs.existsSync(filePath)) {
            res.writeHead(200, {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="' + row.filename + '"',
                'Content-Length': fs.statSync(filePath).size,
            });
            fs.createReadStream(filePath).pipe(res);
            return;
        }
    }

    // For older versions, rebuild a temp ZIP and stream it
    const tmpZip = path.join('/tmp', 'v3d_download_' + Date.now() + '.zip');
    try {
        versionManager.rebuildArchiveFile(version.id, '/tmp', 'v3d_download_' + Date.now() + '.ddim');
        // rebuildArchiveFile writes to the given dir — read it back
        // Actually, let's use a dedicated rebuild-to-temp approach:
        const assets = db.prepare(
            'SELECT asset_path, blob_hash FROM version_assets WHERE version_id = ?'
        ).all(version.id);

        const tmpDir = path.join('/tmp', 'v3d_dl_' + Date.now());
        fs.mkdirSync(tmpDir, { recursive: true });
        for (const { asset_path, blob_hash } of assets) {
            const dest = path.join(tmpDir, asset_path);
            const dir = path.dirname(dest);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const data = blobStore.readBlob(blob_hash);
            if (data) fs.writeFileSync(dest, data);
        }
        require('child_process').execSync(`cd "${tmpDir}" && zip -r -1 -q "${tmpZip}" .`, { timeout: 120000 });
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

        const stat = fs.statSync(tmpZip);
        res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="' + row.filename + '"',
            'Content-Length': stat.size,
        });
        const stream = fs.createReadStream(tmpZip);
        stream.on('end', () => { try { fs.unlinkSync(tmpZip); } catch {} });
        stream.pipe(res);
    } catch (err) {
        try { fs.unlinkSync(tmpZip); } catch {}
        sendJson(res, 500, { error: 'Failed to rebuild version: ' + err.message });
    }
}

/**
 * GET /api/archives/:hash/versions/:v1/diff/:v2 — diff two versions
 */
function handleDiffVersions(req, res, hash, v1, v2) {
    const row = db.prepare('SELECT id FROM archives WHERE hash = ?').get(hash);
    if (!row) return sendJson(res, 404, { error: 'Archive not found' });

    const ver1 = db.prepare(
        'SELECT id FROM archive_versions WHERE archive_id = ? AND version_number = ?'
    ).get(row.id, v1);
    const ver2 = db.prepare(
        'SELECT id FROM archive_versions WHERE archive_id = ? AND version_number = ?'
    ).get(row.id, v2);

    if (!ver1 || !ver2) return sendJson(res, 404, { error: 'Version not found' });

    const diff = versionManager.diffVersions(ver1.id, ver2.id);
    sendJson(res, 200, { diff });
}

/**
 * POST /api/archives/:hash/versions/:num/restore — restore a version
 */
function handleRestoreVersion(req, res, hash, num) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;

    const row = db.prepare('SELECT id, filename FROM archives WHERE hash = ?').get(hash);
    if (!row) return sendJson(res, 404, { error: 'Archive not found' });

    try {
        const newVersion = versionManager.restoreVersion(row.id, num, ARCHIVES_DIR, row.filename);
        const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
        db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
          .run(actor, 'version_restore', hash, JSON.stringify({ restored_from: num, new_version: newVersion.version_number }), req.headers['x-real-ip'] || null);

        sendJson(res, 200, { version: newVersion });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * POST /api/archives/:hash/versions/:num/cherry-pick — cherry-pick sections
 */
function handleCherryPick(req, res, hash, num) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;

    let body = '';
    req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4096) { req.destroy(); return sendJson(res, 413, { error: 'Body too large' }); }
    });
    req.on('end', () => {
        try {
            const { sections } = JSON.parse(body);
            if (!Array.isArray(sections) || sections.length === 0) {
                return sendJson(res, 400, { error: 'Missing sections array' });
            }

            const validSections = ['annotations', 'alignment', 'viewer_settings', 'data_entries', 'project', 'provenance', 'quality_metrics'];
            for (const s of sections) {
                if (!validSections.includes(s)) return sendJson(res, 400, { error: 'Invalid section: ' + s });
            }

            const row = db.prepare('SELECT id, filename FROM archives WHERE hash = ?').get(hash);
            if (!row) return sendJson(res, 404, { error: 'Archive not found' });

            const newVersion = versionManager.cherryPick(row.id, num, sections, ARCHIVES_DIR, row.filename);

            const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
            db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
              .run(actor, 'version_cherry_pick', hash, JSON.stringify({ from: num, sections, new_version: newVersion.version_number }), req.headers['x-real-ip'] || null);

            sendJson(res, 200, { version: newVersion });
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
    });
}
```

- [ ] **Step 2: Register routes**

In the route dispatch section (after the regenerate match at line ~2836, before the hashMatch block), add:

```javascript
        // Version control routes: /api/archives/:hash/versions/...
        const versionsMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions$/);
        if (versionsMatch && req.method === 'GET') {
            return handleListVersions(req, res, versionsMatch[1]);
        }

        const versionDiffMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions\/(\d+)\/diff\/(\d+)$/);
        if (versionDiffMatch && req.method === 'GET') {
            return handleDiffVersions(req, res, versionDiffMatch[1], parseInt(versionDiffMatch[2], 10), parseInt(versionDiffMatch[3], 10));
        }

        const versionRestoreMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions\/(\d+)\/restore$/);
        if (versionRestoreMatch && req.method === 'POST') {
            return handleRestoreVersion(req, res, versionRestoreMatch[1], parseInt(versionRestoreMatch[2], 10));
        }

        const versionCherryPickMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions\/(\d+)\/cherry-pick$/);
        if (versionCherryPickMatch && req.method === 'POST') {
            return handleCherryPick(req, res, versionCherryPickMatch[1], parseInt(versionCherryPickMatch[2], 10));
        }

        const versionDownloadMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions\/(\d+)\/download$/);
        if (versionDownloadMatch && req.method === 'GET') {
            return handleDownloadVersion(req, res, versionDownloadMatch[1], parseInt(versionDownloadMatch[2], 10));
        }

        const versionDetailMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions\/(\d+)$/);
        if (versionDetailMatch && req.method === 'GET') {
            return handleGetVersion(req, res, versionDetailMatch[1], parseInt(versionDetailMatch[2], 10));
        }
```

Also add a blob storage stats route (for the settings UI):

```javascript
        if (pathname === '/api/version-stats' && req.method === 'GET') {
            const blobsSize = blobStore.totalSize();
            const versionCount = db.prepare('SELECT COUNT(*) as count FROM archive_versions').get().count;
            const blobCount = db.prepare('SELECT COUNT(*) as count FROM blobs WHERE ref_count > 0').get().count;
            return sendJson(res, 200, { blobs_size: blobsSize, version_count: versionCount, blob_count: blobCount });
        }
```

**Important:** These routes MUST come before the existing `hashMatch` block (line ~2839) since the regex patterns overlap. More specific patterns first.

- [ ] **Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(version): add version API endpoints (list, detail, download, diff, restore, cherry-pick)"
```

---

## Chunk 3: Library UI — Version History Panel

### Task 7: Add Version History HTML section

**Files:**
- Modify: `src/editor/index.html:2917-2923` (after the Metadata section, before closing `</div>`)

- [ ] **Step 1: Add collapsible Version History section**

After the Metadata section (line ~2923) and before the closing `</div>` of `library-detail` (line ~2924), add:

```html
                    <div class="prop-section" id="library-versions-section" style="display:none">
                        <div class="prop-section-hd">
                            <span class="prop-section-title">Version History</span>
                            <span class="prop-section-chevron">&#9654;</span>
                        </div>
                        <div class="prop-section-body">
                            <div id="library-versions-list"></div>
                            <div id="library-versions-compare" style="display:none">
                                <button class="prop-btn" id="library-versions-compare-btn" style="width:100%; margin-top:4px;" disabled>Compare Selected (0/2)</button>
                            </div>
                        </div>
                    </div>
```

Note: The section starts without the `open` class (collapsed by default). The existing `setupCollapsibles()` in `ui-controller.ts` will automatically handle the click-to-toggle behavior.

- [ ] **Step 2: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(version): add Version History section to library detail pane"
```

---

### Task 8: Add version history rendering to library-panel.ts

**Files:**
- Modify: `src/modules/library-panel.ts`

- [ ] **Step 1: Add DOM refs for version section**

After the existing DOM ref declarations (around line ~104), add:

```typescript
let versionsSection: HTMLElement | null = null;
let versionsList: HTMLElement | null = null;
let versionsCompare: HTMLElement | null = null;
let versionsCompareBtn: HTMLElement | null = null;
```

- [ ] **Step 2: Add version state variables**

After the existing state variables (around line ~80), add:

```typescript
let versionCache: Map<string, VersionEntry[]> = new Map();
let selectedVersions: Set<number> = new Set(); // For compare mode (version numbers)

interface VersionEntry {
    id: number;
    version_number: number;
    total_size: number;
    summary: string | null;
    restored_from: number | null;
    created_at: string;
}

interface VersionDiff {
    assets: {
        added: Array<{ path: string; size: number }>;
        removed: Array<{ path: string; size: number }>;
        changed: Array<{ path: string; oldSize: number; newSize: number }>;
    };
    manifest: Record<string, unknown> | null;
}
```

- [ ] **Step 3: Add fetchVersions function**

After the existing `fetchMedia` function (around line ~573), add:

```typescript
async function fetchVersions(archiveHash: string): Promise<VersionEntry[]> {
    try {
        const res = await apiFetch('/api/archives/' + encodeURIComponent(archiveHash) + '/versions');
        if (!res.ok) return [];
        const data = await res.json() as { versions: VersionEntry[] };
        return data.versions || [];
    } catch {
        log.warn('Failed to fetch versions for', archiveHash);
        return [];
    }
}
```

- [ ] **Step 4: Add renderVersions function**

```typescript
function renderVersions(versions: VersionEntry[]): void {
    if (!versionsList || !versionsSection) return;

    selectedVersions.clear();
    updateCompareButton();

    if (versions.length === 0) {
        versionsSection.style.display = 'none';
        return;
    }
    versionsSection.style.display = '';
    if (versionsCompare) versionsCompare.style.display = versions.length >= 2 ? '' : 'none';

    let html = '';
    for (const v of versions) {
        const timeAgo = formatRelativeTime(v.created_at);
        const sizeDelta = ''; // Could be calculated from previous version
        const restoredBadge = v.restored_from
            ? ' <span class="library-version-restored">↩ Restored</span>'
            : '';

        html += '<div class="library-version-entry" data-version="' + v.version_number + '">' +
            '<div class="library-version-header">' +
                '<label class="library-version-check"><input type="checkbox" data-version="' + v.version_number + '"> </label>' +
                '<span class="library-version-num">v' + v.version_number + '</span>' +
                '<span class="library-version-time">' + escapeHtml(timeAgo) + '</span>' +
                restoredBadge +
            '</div>' +
            '<div class="library-version-summary">' + escapeHtml(v.summary || 'No summary') + '</div>' +
            '<div class="library-version-actions">' +
                '<button class="library-version-btn" data-action="view" data-version="' + v.version_number + '">View</button>' +
                '<button class="library-version-btn" data-action="download" data-version="' + v.version_number + '">Download</button>' +
                '<button class="library-version-btn" data-action="restore" data-version="' + v.version_number + '">Restore</button>' +
                '<button class="library-version-btn" data-action="cherry-pick" data-version="' + v.version_number + '">Cherry-pick</button>' +
            '</div>' +
        '</div>';
    }
    versionsList.innerHTML = html;

    // Wire up checkbox events for compare mode
    versionsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const vNum = parseInt((e.target as HTMLInputElement).dataset.version || '0', 10);
            if ((e.target as HTMLInputElement).checked) {
                if (selectedVersions.size >= 2) {
                    // Uncheck oldest selection
                    const first = selectedVersions.values().next().value;
                    selectedVersions.delete(first);
                    const oldCb = versionsList?.querySelector('input[data-version="' + first + '"]') as HTMLInputElement | null;
                    if (oldCb) oldCb.checked = false;
                }
                selectedVersions.add(vNum);
            } else {
                selectedVersions.delete(vNum);
            }
            updateCompareButton();
        });
    });

    // Wire up action buttons
    versionsList.querySelectorAll('.library-version-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const action = target.dataset.action;
            const vNum = parseInt(target.dataset.version || '0', 10);
            if (!selectedHash || !action) return;

            switch (action) {
                case 'view': handleViewVersion(vNum); break;
                case 'download': handleDownloadVersion(vNum); break;
                case 'restore': handleRestoreVersion(vNum); break;
                case 'cherry-pick': handleCherryPickVersion(vNum); break;
            }
        });
    });
}

function updateCompareButton(): void {
    if (!versionsCompareBtn) return;
    versionsCompareBtn.textContent = 'Compare Selected (' + selectedVersions.size + '/2)';
    (versionsCompareBtn as HTMLButtonElement).disabled = selectedVersions.size !== 2;
}

function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr + 'Z'); // UTC
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return diffMins + 'm ago';
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return diffHours + 'h ago';
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return diffDays + 'd ago';
    return date.toLocaleDateString();
}
```

- [ ] **Step 5: Add version action handlers**

```typescript
async function handleViewVersion(vNum: number): Promise<void> {
    if (!selectedHash) return;
    try {
        const res = await apiFetch('/api/archives/' + selectedHash + '/versions/' + vNum);
        if (!res.ok) throw new Error('Failed to fetch version');
        const data = await res.json();
        // Show version detail in an alert for now (could be a modal later)
        const v = data.version;
        const assetList = v.assets.map((a: { asset_path: string; size: number }) =>
            a.asset_path + ' (' + formatBytes(a.size) + ')'
        ).join('\n');
        alert('Version ' + v.version_number + '\n\n' +
            'Created: ' + v.created_at + '\n' +
            'Summary: ' + (v.summary || 'N/A') + '\n' +
            'Total size: ' + formatBytes(v.total_size) + '\n\n' +
            'Assets:\n' + assetList);
    } catch (err) {
        notify.error('Failed to load version details');
    }
}

async function handleDownloadVersion(vNum: number): Promise<void> {
    if (!selectedHash) return;
    const url = '/api/archives/' + selectedHash + '/versions/' + vNum + '/download';
    window.open(url, '_blank');
}

async function handleRestoreVersion(vNum: number): Promise<void> {
    if (!selectedHash) return;
    if (!confirm('Restore version ' + vNum + '? This will create a new version based on v' + vNum + '.')) return;

    try {
        const res = await apiFetch('/api/archives/' + selectedHash + '/versions/' + vNum + '/restore', {
            method: 'POST',
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Restore failed');
        }
        notify.success('Restored from v' + vNum);
        // Refresh version list
        const versions = await fetchVersions(selectedHash);
        versionCache.set(selectedHash, versions);
        renderVersions(versions);
    } catch (err) {
        notify.error('Restore failed: ' + (err as Error).message);
    }
}

async function handleCherryPickVersion(vNum: number): Promise<void> {
    if (!selectedHash) return;

    const sections = ['annotations', 'alignment', 'viewer_settings', 'data_entries', 'project', 'provenance', 'quality_metrics'];
    const labels: Record<string, string> = {
        annotations: 'Annotations + Walkthrough',
        alignment: 'Alignment',
        viewer_settings: 'Viewer Settings',
        data_entries: 'Assets (data entries)',
        project: 'Project Metadata',
        provenance: 'Provenance',
        quality_metrics: 'Quality Metrics',
    };

    const selected: string[] = [];
    const msg = 'Cherry-pick from v' + vNum + '.\n\nSelect sections to pull (comma-separated numbers):\n' +
        sections.map((s, i) => (i + 1) + '. ' + labels[s]).join('\n');
    const input = prompt(msg);
    if (!input) return;

    const nums = input.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n >= 1 && n <= sections.length);
    for (const n of nums) selected.push(sections[n - 1]);

    if (selected.length === 0) { notify.warning('No sections selected'); return; }

    if (!confirm('Cherry-pick ' + selected.join(', ') + ' from v' + vNum + '?')) return;

    try {
        const res = await apiFetch('/api/archives/' + selectedHash + '/versions/' + vNum + '/cherry-pick', {
            method: 'POST',
            body: JSON.stringify({ sections: selected }),
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Cherry-pick failed');
        }
        notify.success('Cherry-picked from v' + vNum);
        const versions = await fetchVersions(selectedHash);
        versionCache.set(selectedHash, versions);
        renderVersions(versions);
    } catch (err) {
        notify.error('Cherry-pick failed: ' + (err as Error).message);
    }
}

async function handleCompareVersions(): Promise<void> {
    if (!selectedHash || selectedVersions.size !== 2) return;
    const [v1, v2] = Array.from(selectedVersions).sort((a, b) => b - a); // Newer first

    try {
        const res = await apiFetch('/api/archives/' + selectedHash + '/versions/' + v1 + '/diff/' + v2);
        if (!res.ok) throw new Error('Failed to fetch diff');
        const data = await res.json();
        const diff = data.diff as VersionDiff;

        let msg = 'Diff: v' + v1 + ' vs v' + v2 + '\n\n';
        if (diff.assets.added.length) msg += 'Added:\n' + diff.assets.added.map(a => '  + ' + a.path + ' (' + formatBytes(a.size) + ')').join('\n') + '\n\n';
        if (diff.assets.removed.length) msg += 'Removed:\n' + diff.assets.removed.map(a => '  - ' + a.path + ' (' + formatBytes(a.size) + ')').join('\n') + '\n\n';
        if (diff.assets.changed.length) msg += 'Changed:\n' + diff.assets.changed.map(a => '  ~ ' + a.path + ' (' + formatBytes(a.oldSize) + ' → ' + formatBytes(a.newSize) + ')').join('\n') + '\n\n';
        if (diff.manifest) msg += 'Manifest changes: ' + Object.keys(diff.manifest).join(', ');
        if (!diff.assets.added.length && !diff.assets.removed.length && !diff.assets.changed.length && !diff.manifest) {
            msg += 'No differences found.';
        }
        alert(msg);
    } catch (err) {
        notify.error('Compare failed: ' + (err as Error).message);
    }
}
```

- [ ] **Step 6: Wire versions into selectArchive**

In `selectArchive()` (around line ~436, after `renderMetadata(archive);`), add:

```typescript
    // Fetch and render version history
    const cachedVersions = versionCache.get(hash);
    if (cachedVersions) renderVersions(cachedVersions);
    else renderVersions([]);
    fetchVersions(hash).then(versions => {
        versionCache.set(hash, versions);
        if (selectedHash === hash) renderVersions(versions);
    });
```

- [ ] **Step 7: Cache DOM refs in initLibraryPanel**

In `initLibraryPanel()`, after the existing DOM ref caching (around line ~1167), add:

```typescript
    versionsSection = document.getElementById('library-versions-section');
    versionsList = document.getElementById('library-versions-list');
    versionsCompare = document.getElementById('library-versions-compare');
    versionsCompareBtn = document.getElementById('library-versions-compare-btn');

    versionsCompareBtn?.addEventListener('click', handleCompareVersions);
```

- [ ] **Step 8: Add apiFetch CSRF header support**

Check that the existing `apiFetch` function sends the CSRF token header for POST requests. If it already does (check the function), no changes needed. If not, ensure POST/DELETE requests include the `X-CSRF-Token` header and `Content-Type: application/json` for the cherry-pick body.

- [ ] **Step 9: Commit**

```bash
git add src/modules/library-panel.ts
git commit -m "feat(version): add version history UI with view, download, restore, cherry-pick, compare"
```

---

### Task 9: Add CSS for version entries

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add version entry styles**

At the end of the library panel styles section in `styles.css`, add:

```css
/* ── Version History ── */

.library-version-entry {
    padding: 6px 0;
    border-bottom: 1px solid var(--border-subtle);
}
.library-version-entry:last-child { border-bottom: none; }

.library-version-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
}

.library-version-check input {
    margin: 0;
    width: 12px;
    height: 12px;
}

.library-version-num {
    font-weight: 600;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
}

.library-version-time {
    color: var(--text-faint);
    margin-left: auto;
}

.library-version-restored {
    font-size: 9px;
    color: var(--accent);
    font-weight: 500;
}

.library-version-summary {
    font-size: 10px;
    color: var(--text-secondary);
    padding: 2px 0 4px 20px;
    line-height: 1.3;
}

.library-version-actions {
    display: flex;
    gap: 4px;
    padding-left: 20px;
}

.library-version-btn {
    font-size: 9px;
    padding: 1px 6px;
    border: 1px solid var(--border-subtle);
    border-radius: 3px;
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
}

.library-version-btn:hover {
    background: var(--bg-raised);
    color: var(--text-primary);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "feat(version): add version history CSS styles"
```

---

## Chunk 4: Build Verification & Docker

### Task 10: Update Docker build

**Files:**
- Modify: `docker/Dockerfile` (if `docker/lib/` needs to be copied)

- [ ] **Step 1: Add COPY for docker/lib/ in Dockerfile**

The Dockerfile copies individual files (line 39-44). Add after `COPY docker/meta-server.js /opt/meta-server.js` (line 39):

```dockerfile
COPY docker/lib/ /opt/lib/
```

The `require('./lib/blob-store')` paths in meta-server.js resolve relative to the script location (`/opt/`), so `docker/lib/` must be at `/opt/lib/` in the container.

- [ ] **Step 2: Verify blobs directory is writable**

Ensure the Docker container creates `/usr/share/nginx/html/blobs/` with correct permissions. The blob-store `init()` creates it with `mkdirSync`, but the nginx user may need write access. Check if the existing `archives/` directory pattern works the same way.

- [ ] **Step 3: Commit if changes needed**

```bash
git add docker/Dockerfile
git commit -m "feat(version): ensure blob store directory in Docker build"
```

---

### Task 11: Verify build

- [ ] **Step 1: Run Vite build**

```bash
npm run build
```
Expected: Build succeeds with no errors (the library-panel.ts changes compile)

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Expected: 0 errors

- [ ] **Step 3: Run tests**

```bash
npm test
```
Expected: All existing tests pass

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(version): archive version control — complete implementation"
```
