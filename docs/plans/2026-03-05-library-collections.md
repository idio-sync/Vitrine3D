# Library Collections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add server-side collections that group archives into named, themed sets — manageable in the editor library panel and viewable as card-grid pages in kiosk mode.

**Architecture:** Two new SQLite tables (`collections`, `collection_archives`) with REST API in `meta-server.js`. Editor gets a collection sidebar in the existing library overlay. Kiosk gets a `/collection/:slug` route that serves a card-grid page using the same `__VITRINE_CLEAN_URL` injection pattern. New modules: `collection-manager.ts` (editor), `collection-page.ts` (kiosk).

**Tech Stack:** TypeScript, SQLite (better-sqlite3), existing Vite build, existing CSS patterns

**Design doc:** `docs/plans/2026-03-05-library-collections-design.md`

---

## Phase 1: Types & Data Model

### Task 1: Add collection types to types.ts

**Files:**
- Modify: `src/types.ts` (after line 168, after AssetStore interface)

**Step 1: Add the new interfaces**

Add after the `AssetStore` interface (line 168):

```typescript
// ===== Library Collections =====

/** A named collection of archives, displayed as a group in the library and kiosk. */
export interface Collection {
    id: number;
    slug: string;
    name: string;
    description: string;
    thumbnail: string | null;
    theme: string | null;
    archiveCount: number;
    created_at: string;
    updated_at: string;
}

/** An archive's membership in a collection, with sort order. */
export interface CollectionArchive {
    collection_id: number;
    archive_id: number;
    sort_order: number;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Builds successfully (new types are unused but exported)

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(collections): add Collection and CollectionArchive types"
```

---

### Task 2: Add collections tables to meta-server.js

**Files:**
- Modify: `docker/meta-server.js` — `initDb()` function (lines 140–173)

**Step 1: Add CREATE TABLE statements**

In `initDb()`, after the `audit_log` CREATE TABLE (line 171, before the closing `);`), add:

```javascript
        CREATE TABLE IF NOT EXISTS collections (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            slug        TEXT    UNIQUE NOT NULL,
            name        TEXT    NOT NULL,
            description TEXT    DEFAULT '',
            thumbnail   TEXT,
            theme       TEXT,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_collections_slug ON collections(slug);

        CREATE TABLE IF NOT EXISTS collection_archives (
            collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            archive_id    INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
            sort_order    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (collection_id, archive_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ca_archive ON collection_archives(archive_id);
```

**Step 2: Enable foreign keys**

Add after `db.pragma('synchronous = NORMAL');` (line 143):

```javascript
    db.pragma('foreign_keys = ON');
```

**Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(collections): add collections and collection_archives tables"
```

---

## Phase 2: Server API

### Task 3: Add helper — buildCollectionObject

**Files:**
- Modify: `docker/meta-server.js` — after `buildArchiveObjectFromRow()` (line 197)

**Step 1: Add the helper function**

```javascript
/**
 * Convert a SQLite row from the collections table into the API response object.
 * Includes archive_count from a LEFT JOIN or separate query.
 */
function buildCollectionObject(row) {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description || '',
        thumbnail: row.thumbnail || null,
        theme: row.theme || null,
        archiveCount: row.archive_count || 0,
        created_at: row.created_at ? row.created_at.replace(' ', 'T') + 'Z' : row.created_at,
        updated_at: row.updated_at ? row.updated_at.replace(' ', 'T') + 'Z' : row.updated_at,
    };
}

/**
 * Generate a URL-safe slug from a name string.
 */
function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'collection';
}
```

**Step 2: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(collections): add buildCollectionObject and slugify helpers"
```

---

### Task 4: Add GET /api/collections endpoint

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add the handler function** (after the new helpers from Task 3)

```javascript
/**
 * GET /api/collections — list all collections with archive counts.
 * Public endpoint (no auth required).
 */
function handleListCollections(req, res) {
    try {
        const rows = db.prepare(`
            SELECT c.*, COUNT(ca.archive_id) AS archive_count
            FROM collections c
            LEFT JOIN collection_archives ca ON ca.collection_id = c.id
            GROUP BY c.id
            ORDER BY c.name ASC
        `).all();
        sendJson(res, 200, { collections: rows.map(buildCollectionObject) });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}
```

**Step 2: Add route** in the request handler (line ~1310 area, before the `if (ADMIN_ENABLED)` block at line 1328)

Add right before `// Admin routes (only when enabled)`:

```javascript
    // --- Collection routes (public reads) ---
    if (pathname === '/api/collections' && req.method === 'GET') {
        return handleListCollections(req, res);
    }
```

**Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(collections): add GET /api/collections endpoint"
```

---

### Task 5: Add GET /api/collections/:slug endpoint

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add the handler function**

```javascript
/**
 * GET /api/collections/:slug — get a single collection with its ordered archives.
 * Public endpoint (no auth required).
 */
function handleGetCollection(req, res, slug) {
    try {
        const row = db.prepare(`
            SELECT c.*, COUNT(ca.archive_id) AS archive_count
            FROM collections c
            LEFT JOIN collection_archives ca ON ca.collection_id = c.id
            WHERE c.slug = ?
            GROUP BY c.id
        `).get(slug);

        if (!row) {
            sendJson(res, 404, { error: 'Collection not found' });
            return;
        }

        const archiveRows = db.prepare(`
            SELECT a.* FROM archives a
            JOIN collection_archives ca ON ca.archive_id = a.id
            WHERE ca.collection_id = ?
            ORDER BY ca.sort_order ASC, a.title ASC
        `).all(row.id);

        const collection = buildCollectionObject(row);
        collection.archives = archiveRows.map(buildArchiveObjectFromRow);

        // Default thumbnail: use first archive's thumbnail if collection has none
        if (!collection.thumbnail && collection.archives.length > 0) {
            collection.thumbnail = collection.archives[0].thumbnail;
        }

        sendJson(res, 200, collection);
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}
```

**Step 2: Add route** (after the `/api/collections` GET route added in Task 4)

```javascript
    const collSlugMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})$/);
    if (collSlugMatch && req.method === 'GET') {
        return handleGetCollection(req, res, collSlugMatch[1]);
    }
```

**Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(collections): add GET /api/collections/:slug endpoint"
```

---

### Task 6: Add POST /api/collections (create)

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add the handler function**

```javascript
/**
 * POST /api/collections — create a new collection.
 * Admin-gated. Body: { name, slug?, description?, thumbnail?, theme? }
 */
function handleCreateCollection(req, res) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
        const name = (body.name || '').trim();
        if (!name) return sendJson(res, 400, { error: 'Name is required' });

        const slug = (body.slug || slugify(name)).trim();
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
            return sendJson(res, 400, { error: 'Invalid slug: lowercase alphanumeric and hyphens only, 1-80 chars' });
        }

        const description = (body.description || '').trim();
        const thumbnail = body.thumbnail || null;
        const theme = body.theme || null;

        if (theme && !['editorial', 'gallery', 'exhibit', 'minimal'].includes(theme)) {
            return sendJson(res, 400, { error: 'Invalid theme' });
        }

        try {
            const existing = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
            if (existing) return sendJson(res, 409, { error: 'A collection with this slug already exists' });

            db.prepare(`
                INSERT INTO collections (slug, name, description, thumbnail, theme)
                VALUES (?, ?, ?, ?, ?)
            `).run(slug, name, description, thumbnail, theme);

            db.prepare(`INSERT INTO audit_log (actor, action, target, ip) VALUES (?, ?, ?, ?)`)
                .run(actor, 'create_collection', slug, req.socket.remoteAddress);

            const row = db.prepare(`
                SELECT c.*, 0 AS archive_count FROM collections c WHERE slug = ?
            `).get(slug);
            sendJson(res, 201, buildCollectionObject(row));
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
    });
}
```

**Step 2: Add `readJsonBody` helper** (if not already present — add after `slugify`)

```javascript
/**
 * Read and parse a JSON request body. Calls cb(err, body).
 */
function readJsonBody(req, cb) {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
        try { cb(null, JSON.parse(data)); }
        catch (e) { cb(e, null); }
    });
    req.on('error', cb);
}
```

**Step 3: Add route** inside the `if (ADMIN_ENABLED)` block, after the existing archive routes:

```javascript
        if (pathname === '/api/collections' && req.method === 'POST') {
            return handleCreateCollection(req, res);
        }
```

**Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(collections): add POST /api/collections endpoint"
```

---

### Task 7: Add PATCH /api/collections/:slug (update)

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add the handler function**

```javascript
/**
 * PATCH /api/collections/:slug — update collection metadata.
 * Admin-gated. Body: { name?, slug?, description?, thumbnail?, theme? }
 */
function handleUpdateCollection(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });

        const row = db.prepare('SELECT * FROM collections WHERE slug = ?').get(slug);
        if (!row) return sendJson(res, 404, { error: 'Collection not found' });

        const updates = {};
        if (body.name !== undefined) updates.name = body.name.trim() || row.name;
        if (body.description !== undefined) updates.description = body.description.trim();
        if (body.thumbnail !== undefined) updates.thumbnail = body.thumbnail || null;
        if (body.theme !== undefined) {
            if (body.theme && !['editorial', 'gallery', 'exhibit', 'minimal'].includes(body.theme)) {
                return sendJson(res, 400, { error: 'Invalid theme' });
            }
            updates.theme = body.theme || null;
        }
        if (body.slug !== undefined) {
            const newSlug = body.slug.trim();
            if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(newSlug)) {
                return sendJson(res, 400, { error: 'Invalid slug' });
            }
            if (newSlug !== slug) {
                const conflict = db.prepare('SELECT id FROM collections WHERE slug = ?').get(newSlug);
                if (conflict) return sendJson(res, 409, { error: 'Slug already in use' });
                updates.slug = newSlug;
            }
        }

        if (Object.keys(updates).length === 0) {
            return sendJson(res, 200, buildCollectionObject(row));
        }

        try {
            const setClauses = Object.keys(updates).map(k => `${k} = ?`);
            setClauses.push("updated_at = datetime('now')");
            const values = Object.values(updates);
            values.push(row.id);

            db.prepare(`UPDATE collections SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

            db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
                .run(actor, 'update_collection', updates.slug || slug, JSON.stringify(updates), req.socket.remoteAddress);

            const updatedRow = db.prepare(`
                SELECT c.*, COUNT(ca.archive_id) AS archive_count
                FROM collections c
                LEFT JOIN collection_archives ca ON ca.collection_id = c.id
                WHERE c.id = ?
                GROUP BY c.id
            `).get(row.id);
            sendJson(res, 200, buildCollectionObject(updatedRow));
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
    });
}
```

**Step 2: Add route** inside `if (ADMIN_ENABLED)` block:

```javascript
        const collSlugAdminMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})$/);
        if (collSlugAdminMatch) {
            const cSlug = collSlugAdminMatch[1];
            if (req.method === 'PATCH') return handleUpdateCollection(req, res, cSlug);
            if (req.method === 'DELETE') return handleDeleteCollection(req, res, cSlug);
        }
```

**Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(collections): add PATCH /api/collections/:slug endpoint"
```

---

### Task 8: Add DELETE /api/collections/:slug

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add the handler function**

```javascript
/**
 * DELETE /api/collections/:slug — delete a collection.
 * Archives are NOT deleted, only the membership links (via CASCADE).
 */
function handleDeleteCollection(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    try {
        const row = db.prepare('SELECT * FROM collections WHERE slug = ?').get(slug);
        if (!row) return sendJson(res, 404, { error: 'Collection not found' });

        // Delete thumbnail file if it's a collection-specific one
        if (row.thumbnail && row.thumbnail.startsWith('/thumbs/collection-')) {
            const thumbPath = path.join(HTML_ROOT, row.thumbnail);
            try { fs.unlinkSync(thumbPath); } catch (_) { /* ignore */ }
        }

        db.prepare('DELETE FROM collections WHERE id = ?').run(row.id);

        db.prepare(`INSERT INTO audit_log (actor, action, target, ip) VALUES (?, ?, ?, ?)`)
            .run(actor, 'delete_collection', slug, req.socket.remoteAddress);

        sendJson(res, 200, { ok: true });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}
```

**Step 2: Route already added in Task 7** (the `if (req.method === 'DELETE')` branch)

**Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(collections): add DELETE /api/collections/:slug endpoint"
```

---

### Task 9: Add POST/DELETE for collection archive membership

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add the handler for adding archives**

```javascript
/**
 * POST /api/collections/:slug/archives — add archive(s) to a collection.
 * Body: { hashes: ["abc123..."] }
 */
function handleAddCollectionArchives(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });

        const hashes = body.hashes;
        if (!Array.isArray(hashes) || hashes.length === 0) {
            return sendJson(res, 400, { error: 'hashes array is required' });
        }

        try {
            const coll = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
            if (!coll) return sendJson(res, 404, { error: 'Collection not found' });

            // Get current max sort_order
            const maxOrder = db.prepare(
                'SELECT COALESCE(MAX(sort_order), -1) AS m FROM collection_archives WHERE collection_id = ?'
            ).get(coll.id).m;

            const insert = db.prepare(`
                INSERT OR IGNORE INTO collection_archives (collection_id, archive_id, sort_order)
                VALUES (?, ?, ?)
            `);

            let added = 0;
            for (let i = 0; i < hashes.length; i++) {
                const archive = db.prepare('SELECT id FROM archives WHERE hash = ?').get(hashes[i]);
                if (archive) {
                    const result = insert.run(coll.id, archive.id, maxOrder + 1 + i);
                    if (result.changes > 0) added++;
                }
            }

            db.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(coll.id);

            db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
                .run(actor, 'add_to_collection', slug, JSON.stringify({ hashes, added }), req.socket.remoteAddress);

            sendJson(res, 200, { ok: true, added });
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
    });
}

/**
 * DELETE /api/collections/:slug/archives/:hash — remove one archive from a collection.
 */
function handleRemoveCollectionArchive(req, res, slug, archiveHash) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    try {
        const coll = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
        if (!coll) return sendJson(res, 404, { error: 'Collection not found' });

        const archive = db.prepare('SELECT id FROM archives WHERE hash = ?').get(archiveHash);
        if (!archive) return sendJson(res, 404, { error: 'Archive not found' });

        db.prepare('DELETE FROM collection_archives WHERE collection_id = ? AND archive_id = ?')
            .run(coll.id, archive.id);

        db.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(coll.id);

        db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
            .run(actor, 'remove_from_collection', slug, archiveHash, req.socket.remoteAddress);

        sendJson(res, 200, { ok: true });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}
```

**Step 2: Add routes** inside `if (ADMIN_ENABLED)`:

```javascript
        const collArchivesMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})\/archives$/);
        if (collArchivesMatch && req.method === 'POST') {
            return handleAddCollectionArchives(req, res, collArchivesMatch[1]);
        }

        const collArchiveRemoveMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})\/archives\/([a-f0-9]{16})$/);
        if (collArchiveRemoveMatch && req.method === 'DELETE') {
            return handleRemoveCollectionArchive(req, res, collArchiveRemoveMatch[1], collArchiveRemoveMatch[2]);
        }
```

**Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(collections): add archive membership endpoints"
```

---

### Task 10: Add PATCH /api/collections/:slug/order (reorder)

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add the handler function**

```javascript
/**
 * PATCH /api/collections/:slug/order — reorder archives in a collection.
 * Body: { hashes: ["hash1", "hash2", ...] } — order defines sort_order.
 */
function handleReorderCollection(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });

        const hashes = body.hashes;
        if (!Array.isArray(hashes)) return sendJson(res, 400, { error: 'hashes array is required' });

        try {
            const coll = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
            if (!coll) return sendJson(res, 404, { error: 'Collection not found' });

            const update = db.prepare(
                'UPDATE collection_archives SET sort_order = ? WHERE collection_id = ? AND archive_id = (SELECT id FROM archives WHERE hash = ?)'
            );

            const reorder = db.transaction(() => {
                for (let i = 0; i < hashes.length; i++) {
                    update.run(i, coll.id, hashes[i]);
                }
            });
            reorder();

            db.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(coll.id);

            sendJson(res, 200, { ok: true });
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
    });
}
```

**Step 2: Add route** inside `if (ADMIN_ENABLED)`:

```javascript
        const collOrderMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})\/order$/);
        if (collOrderMatch && req.method === 'PATCH') {
            return handleReorderCollection(req, res, collOrderMatch[1]);
        }
```

**Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(collections): add reorder endpoint"
```

---

### Task 11: Add GET /collection/:slug kiosk route

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add the handler function**

```javascript
/**
 * GET /collection/:slug — serve the kiosk HTML for a collection page.
 * Injects collection slug into window.__VITRINE_CLEAN_URL for client-side rendering.
 * For bots, serves OG meta tags.
 */
function handleCollectionPage(req, res, slug) {
    const row = db.prepare(`
        SELECT c.*, COUNT(ca.archive_id) AS archive_count
        FROM collections c
        LEFT JOIN collection_archives ca ON ca.collection_id = c.id
        WHERE c.slug = ?
        GROUP BY c.id
    `).get(slug);

    if (!row) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Collection not found');
        return;
    }

    // Bot request — serve OG meta tags
    if (isBotRequest(req)) {
        // Get first archive thumbnail as fallback
        let thumb = row.thumbnail ? SITE_URL + row.thumbnail : null;
        if (!thumb) {
            const firstArchive = db.prepare(`
                SELECT a.thumbnail FROM archives a
                JOIN collection_archives ca ON ca.archive_id = a.id
                WHERE ca.collection_id = ?
                ORDER BY ca.sort_order ASC LIMIT 1
            `).get(row.id);
            if (firstArchive && firstArchive.thumbnail) thumb = SITE_URL + firstArchive.thumbnail;
        }
        return serveOgHtml(
            res,
            row.name || SITE_NAME,
            row.description || SITE_DESCRIPTION,
            thumb,
            SITE_URL + req.url,
            null
        );
    }

    const indexHtml = getIndexHtml();
    if (!indexHtml) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('index.html not found');
        return;
    }

    const inject = { collection: slug, kiosk: true };
    if (row.theme) inject.theme = row.theme;
    const injectTag = '<script>window.__VITRINE_CLEAN_URL=' + JSON.stringify(inject) + ';</script>\n';

    let html = indexHtml.replace(/<head>/i, '<head>\n<base href="/">');
    html = html.replace(/<script[\s>]/i, (m) => injectTag + m);

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(html);
}
```

**Step 2: Add route** (before the `if (ADMIN_ENABLED)` block, alongside the other public routes):

```javascript
    // Collection pages: /collection/{slug}
    const collPageMatch = pathname.match(/^\/collection\/([a-z0-9][a-z0-9-]{0,79})$/);
    if (collPageMatch && req.method === 'GET') {
        return handleCollectionPage(req, res, collPageMatch[1]);
    }
```

**Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(collections): add /collection/:slug kiosk route with OG injection"
```

---

## Phase 3: Kiosk Collection Page

### Task 12: Add collection detection to config.js

**Files:**
- Modify: `src/config.js` (around line 132)

**Step 1: Parse collection slug from injection**

After line 132 (`const _inj = window.__VITRINE_CLEAN_URL || {};`), the `_inj.collection` field is already available. Add it to `APP_CONFIG`. Find where `window.APP_CONFIG` is assigned (search for `window.APP_CONFIG = {`) and add:

```javascript
        collectionSlug: _inj.collection || null,
```

**Step 2: Commit**

```bash
git add src/config.js
git commit -m "feat(collections): pass collection slug through APP_CONFIG"
```

---

### Task 13: Add collection-page.ts kiosk module

**Files:**
- Create: `src/modules/collection-page.ts`

**Step 1: Create the module**

```typescript
/**
 * Collection Page Module
 *
 * Renders a card grid of archives belonging to a collection.
 * Used in kiosk mode when a collection slug is detected in APP_CONFIG.
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('collection-page');

interface CollectionArchive {
    hash: string;
    uuid?: string;
    filename: string;
    path: string;
    viewerUrl: string;
    title: string;
    size: number;
    modified: string;
    thumbnail: string | null;
    assets?: { key: string; type: string; format: string; size_bytes: number }[];
}

interface CollectionData {
    id: number;
    slug: string;
    name: string;
    description: string;
    thumbnail: string | null;
    theme: string | null;
    archiveCount: number;
    archives: CollectionArchive[];
}

// ── Helpers ──

function formatBytes(b: number): string {
    if (b === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return (b / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}

function escapeHtml(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

const ASSET_TYPE_ICONS: Record<string, string> = {
    splat: '\u2B24',
    mesh: '\u25B3',
    pointcloud: '\u2059',
    cad: '\u2B21',
    drawing: '\u25A1',
};

// ── Fetch ──

async function fetchCollection(slug: string): Promise<CollectionData> {
    const res = await fetch('/api/collections/' + encodeURIComponent(slug));
    if (!res.ok) throw new Error('Collection not found');
    return res.json();
}

// ── Rendering ──

function renderCard(archive: CollectionArchive): HTMLElement {
    const card = document.createElement('a');
    card.className = 'collection-card';
    card.href = archive.uuid ? '/view/' + archive.uuid : archive.viewerUrl;

    const thumbHtml = archive.thumbnail
        ? '<img src="' + escapeHtml(archive.thumbnail) + '" alt="" loading="lazy">'
        : '<div class="collection-card-placeholder"><svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1" opacity="0.25"><path d="M16 6l10 5.5v9L16 26 6 20.5v-9L16 6z"/><path d="M16 15.5V26"/><path d="M6 11.5L16 17l10-5.5"/></svg></div>';

    // Asset type badges
    let badges = '';
    if (archive.assets && archive.assets.length > 0) {
        const types = [...new Set(archive.assets.map(a => a.type))];
        badges = '<div class="collection-card-badges">' +
            types.map(t => '<span class="collection-badge" title="' + t + '">' + (ASSET_TYPE_ICONS[t] || '\u25CF') + '</span>').join('') +
            '</div>';
    }

    card.innerHTML =
        '<div class="collection-card-thumb">' + thumbHtml + badges + '</div>' +
        '<div class="collection-card-body">' +
            '<div class="collection-card-title">' + escapeHtml(archive.title || archive.filename) + '</div>' +
            '<div class="collection-card-meta">' + formatBytes(archive.size) + '</div>' +
        '</div>';

    return card;
}

function renderPage(container: HTMLElement, data: CollectionData): void {
    const header = document.createElement('div');
    header.className = 'collection-header';
    header.innerHTML =
        '<h1 class="collection-title">' + escapeHtml(data.name) + '</h1>' +
        (data.description ? '<p class="collection-description">' + escapeHtml(data.description) + '</p>' : '') +
        '<span class="collection-count">' + data.archiveCount + ' archive' + (data.archiveCount !== 1 ? 's' : '') + '</span>';

    const grid = document.createElement('div');
    grid.className = 'collection-grid';
    for (const archive of data.archives) {
        grid.appendChild(renderCard(archive));
    }

    container.appendChild(header);
    container.appendChild(grid);
}

function renderError(container: HTMLElement, message: string): void {
    container.innerHTML = '<div class="collection-error"><p>' + escapeHtml(message) + '</p></div>';
}

// ── Public API ──

/**
 * Initialize the collection page. Replaces the 3D viewport with a card grid.
 * Returns true if a collection slug was found and the page was rendered.
 */
export async function initCollectionPage(): Promise<boolean> {
    const config = (window as unknown as { APP_CONFIG?: { collectionSlug?: string } }).APP_CONFIG;
    const slug = config?.collectionSlug;
    if (!slug) return false;

    log.info('Loading collection:', slug);

    // Hide the 3D viewport and show collection container
    const viewport = document.getElementById('viewport') || document.getElementById('canvas-container');
    if (viewport) viewport.style.display = 'none';

    // Create or find collection container
    let container = document.getElementById('collection-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'collection-container';
        container.className = 'collection-container';
        document.body.appendChild(container);
    }

    try {
        const data = await fetchCollection(slug);
        renderPage(container, data);
        document.title = data.name + ' — ' + (document.title || 'Vitrine3D');
        log.info('Collection loaded:', data.name, '(' + data.archives.length + ' archives)');
    } catch (err) {
        log.error('Failed to load collection:', err);
        renderError(container, 'Collection not found');
    }

    return true;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Builds (module is tree-shaken unless imported)

**Step 3: Commit**

```bash
git add src/modules/collection-page.ts
git commit -m "feat(collections): add kiosk collection page module"
```

---

### Task 14: Wire collection page into kiosk entry point

**Files:**
- Modify: `src/kiosk-web.ts`

**Step 1: Add collection page detection before normal init**

Replace the contents of `src/kiosk-web.ts` with:

```typescript
// Kiosk bundle entry point — imports viewer layer only.
// For the full editor, see src/editor/index.html → main.ts.
import { initCollectionPage } from './modules/collection-page.js';

// If this is a collection page, render the card grid instead of the 3D viewer
initCollectionPage().then(isCollection => {
    if (!isCollection) {
        // Normal kiosk viewer — lazy import to avoid loading viewer code for collection pages
        import('./modules/kiosk-main.js').then(m => m.init());
    }
});
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Builds successfully, both entry points produce valid bundles

**Step 3: Commit**

```bash
git add src/kiosk-web.ts
git commit -m "feat(collections): wire collection page into kiosk entry point"
```

---

### Task 15: Add collection page CSS

**Files:**
- Modify: `src/styles.css`

**Step 1: Add collection page styles**

Add at the end of the file (before any closing comments):

```css
/* ===== Collection Page (Kiosk) ===== */

.collection-container {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    background: var(--bg-primary, #0a0a0a);
    color: var(--text-primary, #e0e0e0);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 2rem;
}

.collection-header {
    max-width: 1200px;
    margin: 0 auto 2rem;
    text-align: center;
}

.collection-title {
    font-size: 1.75rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
    letter-spacing: -0.02em;
}

.collection-description {
    font-size: 0.9rem;
    opacity: 0.7;
    margin: 0 0 0.5rem;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
}

.collection-count {
    font-size: 0.75rem;
    opacity: 0.5;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.collection-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1.25rem;
    max-width: 1200px;
    margin: 0 auto;
}

.collection-card {
    display: block;
    background: var(--bg-secondary, #1a1a1a);
    border-radius: 8px;
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    cursor: pointer;
}

.collection-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.collection-card-thumb {
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: var(--bg-tertiary, #222);
    position: relative;
}

.collection-card-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.collection-card-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}

.collection-card-badges {
    position: absolute;
    bottom: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
}

.collection-badge {
    background: rgba(0, 0, 0, 0.6);
    border-radius: 4px;
    padding: 2px 5px;
    font-size: 10px;
    backdrop-filter: blur(4px);
}

.collection-card-body {
    padding: 0.75rem;
}

.collection-card-title {
    font-size: 0.85rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 0.25rem;
}

.collection-card-meta {
    font-size: 0.7rem;
    opacity: 0.5;
}

.collection-error {
    text-align: center;
    padding: 4rem 2rem;
    opacity: 0.5;
}
```

**Step 2: Commit**

```bash
git add src/styles.css
git commit -m "feat(collections): add collection page styles"
```

---

## Phase 4: Editor Collection Management

### Task 16: Add collection sidebar HTML to editor

**Files:**
- Modify: `src/editor/index.html`

**Step 1: Add collection sidebar** inside `#library-overlay` (line 258), right after the opening `<div id="library-overlay" class="hidden">` and before `<div class="library-header">`:

```html
                <!-- Collection sidebar -->
                <div class="collection-sidebar" id="collection-sidebar">
                    <div class="collection-sidebar-list" id="collection-sidebar-list">
                        <button class="collection-sidebar-item active" data-slug="">All Archives</button>
                    </div>
                    <button class="collection-sidebar-add" id="collection-sidebar-add" title="New collection">+ New Collection</button>
                </div>
```

**Step 2: Add collection chips to the detail pane** in `#pane-library` (line 2356), after the "Details" prop-section (after line 2381, before the "Actions" section):

```html
                    <div class="prop-section open" id="library-collections-section">
                        <div class="prop-section-hd">
                            <span class="prop-section-title">Collections</span>
                            <span class="prop-section-chevron">&#9654;</span>
                        </div>
                        <div class="prop-section-body">
                            <div class="library-collection-chips" id="library-collection-chips"></div>
                            <select class="library-add-to-collection" id="library-add-to-collection" style="display:none">
                                <option value="">+ Add to collection…</option>
                            </select>
                        </div>
                    </div>
```

**Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(collections): add collection sidebar and chips HTML to editor"
```

---

### Task 17: Add collection sidebar CSS

**Files:**
- Modify: `src/styles.css`

**Step 1: Add collection sidebar styles** (after the library styles section):

```css
/* ===== Collection Sidebar (Editor Library) ===== */

.collection-sidebar {
    display: flex;
    flex-direction: column;
    min-width: 180px;
    max-width: 200px;
    border-right: 1px solid var(--border, rgba(255,255,255,0.08));
    padding: 8px 0;
    overflow-y: auto;
    flex-shrink: 0;
}

.collection-sidebar-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.collection-sidebar-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.1s;
}

.collection-sidebar-item:hover {
    background: rgba(255,255,255,0.04);
}

.collection-sidebar-item.active {
    background: rgba(255,255,255,0.08);
    color: var(--text-primary, #e0e0e0);
    font-weight: 500;
}

.collection-sidebar-count {
    font-size: 10px;
    opacity: 0.5;
    margin-left: 8px;
    flex-shrink: 0;
}

.collection-sidebar-add {
    margin: 8px 12px 0;
    padding: 5px 8px;
    background: none;
    border: 1px dashed rgba(255,255,255,0.15);
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    font-size: 10px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
}

.collection-sidebar-add:hover {
    border-color: rgba(255,255,255,0.3);
    color: var(--text-primary, #e0e0e0);
}

/* Make library-overlay a row layout when sidebar exists */
#library-overlay {
    display: flex;
    flex-direction: row;
}

#library-overlay > .collection-sidebar {
    flex-shrink: 0;
}

#library-overlay > .library-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

/* Collection chips in detail pane */

.library-collection-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
}

.library-collection-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: rgba(255,255,255,0.08);
    border-radius: 10px;
    font-size: 10px;
    color: var(--text-secondary, #aaa);
}

.library-collection-chip-remove {
    cursor: pointer;
    opacity: 0.5;
    font-size: 12px;
    line-height: 1;
}

.library-collection-chip-remove:hover {
    opacity: 1;
}

.library-add-to-collection {
    width: 100%;
    padding: 4px 6px;
    background: var(--bg-secondary, #1a1a1a);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    font-size: 10px;
}
```

**Step 2: Commit**

```bash
git add src/styles.css
git commit -m "feat(collections): add collection sidebar and chip styles"
```

---

### Task 18: Wrap library overlay content in .library-main

**Files:**
- Modify: `src/editor/index.html`

**Step 1:** The existing library-header, library-upload, library-gallery, library-empty, and library-auth elements need to be wrapped in a `<div class="library-main">` so the flex layout works with the new sidebar.

After the collection sidebar (added in Task 16), wrap everything else inside `#library-overlay` up to the closing `</div>` of the overlay:

Add `<div class="library-main">` after the collection sidebar closing `</div>`, and add a closing `</div>` before the `</div>` that closes `#library-overlay`.

**Step 2: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(collections): wrap library content in .library-main for flex layout"
```

---

### Task 19: Create collection-manager.ts module

**Files:**
- Create: `src/modules/collection-manager.ts`

**Step 1: Create the module**

```typescript
/**
 * Collection Manager Module
 *
 * Manages collections in the editor library panel.
 * Handles sidebar rendering, collection CRUD, archive membership,
 * and collection chip display in the archive detail pane.
 */

import { Logger, notify } from './utilities.js';
import type { Collection } from '../types.js';

const log = Logger.getLogger('collection-manager');

// ── Types ──

interface CollectionWithArchives extends Collection {
    archives?: { hash: string }[];
}

// ── State ──

let collections: Collection[] = [];
let activeSlug: string = ''; // '' = All Archives
let csrfTokenGetter: (() => string | null) | null = null;
let authHeadersGetter: (() => Record<string, string>) | null = null;
let onFilterChange: ((slug: string) => void) | null = null;

// ── DOM refs ──

let sidebarList: HTMLElement | null = null;
let addBtn: HTMLElement | null = null;
let chipsContainer: HTMLElement | null = null;
let addSelect: HTMLSelectElement | null = null;

// ── API ──

function headers(): Record<string, string> {
    const h = authHeadersGetter ? authHeadersGetter() : {};
    return h;
}

async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
    const h = { ...headers(), ...(opts.headers as Record<string, string> || {}) };
    return fetch(url, { ...opts, headers: h, credentials: 'include' });
}

async function fetchCollections(): Promise<Collection[]> {
    const res = await apiFetch('/api/collections');
    if (!res.ok) throw new Error('Failed to fetch collections');
    const data = await res.json() as { collections: Collection[] };
    return data.collections;
}

async function createCollection(name: string): Promise<Collection> {
    const res = await apiFetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Create failed');
    }
    return res.json();
}

async function deleteCollection(slug: string): Promise<void> {
    const res = await apiFetch('/api/collections/' + slug, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
}

async function addToCollection(slug: string, hashes: string[]): Promise<void> {
    const res = await apiFetch('/api/collections/' + slug + '/archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes }),
    });
    if (!res.ok) throw new Error('Failed to add to collection');
}

async function removeFromCollection(slug: string, hash: string): Promise<void> {
    const res = await apiFetch('/api/collections/' + slug + '/archives/' + hash, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to remove from collection');
}

// ── Rendering ──

function renderSidebar(): void {
    if (!sidebarList) return;
    sidebarList.innerHTML = '';

    // "All Archives" entry
    const allBtn = document.createElement('button');
    allBtn.className = 'collection-sidebar-item' + (activeSlug === '' ? ' active' : '');
    allBtn.dataset.slug = '';
    allBtn.textContent = 'All Archives';
    allBtn.addEventListener('click', () => setActiveCollection(''));
    sidebarList.appendChild(allBtn);

    // Collection entries
    for (const coll of collections) {
        const btn = document.createElement('button');
        btn.className = 'collection-sidebar-item' + (activeSlug === coll.slug ? ' active' : '');
        btn.dataset.slug = coll.slug;
        btn.innerHTML =
            '<span style="overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(coll.name) + '</span>' +
            '<span class="collection-sidebar-count">' + coll.archiveCount + '</span>';
        btn.addEventListener('click', () => setActiveCollection(coll.slug));
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            handleDeleteCollection(coll);
        });
        sidebarList.appendChild(btn);
    }
}

function renderChips(archiveHash: string, archiveCollections: Collection[]): void {
    if (!chipsContainer || !addSelect) return;

    chipsContainer.innerHTML = '';
    for (const coll of archiveCollections) {
        const chip = document.createElement('span');
        chip.className = 'library-collection-chip';
        chip.innerHTML =
            escapeHtml(coll.name) +
            '<span class="library-collection-chip-remove" data-slug="' + coll.slug + '" data-hash="' + archiveHash + '">&times;</span>';
        chipsContainer.appendChild(chip);
    }

    // Wire chip remove buttons
    chipsContainer.querySelectorAll('.library-collection-chip-remove').forEach(el => {
        el.addEventListener('click', async (e) => {
            const target = e.currentTarget as HTMLElement;
            const slug = target.dataset.slug!;
            const hash = target.dataset.hash!;
            try {
                await removeFromCollection(slug, hash);
                await refreshCollections();
                // Re-render chips for this archive
                const updated = await getArchiveCollections(hash);
                renderChips(hash, updated);
                notify.success('Removed from ' + slug);
            } catch (err) {
                notify.error('Remove failed: ' + (err as Error).message);
            }
        });
    });

    // Update add-to-collection dropdown
    const inSlugs = new Set(archiveCollections.map(c => c.slug));
    const available = collections.filter(c => !inSlugs.has(c.slug));

    if (available.length > 0) {
        addSelect.style.display = '';
        addSelect.innerHTML = '<option value="">+ Add to collection\u2026</option>';
        for (const coll of available) {
            const opt = document.createElement('option');
            opt.value = coll.slug;
            opt.textContent = coll.name;
            addSelect.appendChild(opt);
        }
    } else {
        addSelect.style.display = 'none';
    }
}

async function getArchiveCollections(archiveHash: string): Promise<Collection[]> {
    // Check which collections contain this archive by fetching each collection
    // This is simple but not efficient for many collections — could be optimized with a server endpoint later
    return collections.filter(c => {
        // We'll need to track membership client-side; for now refetch the specific archive's collections
        return false; // placeholder — see below
    });
}

// ── Actions ──

function setActiveCollection(slug: string): void {
    activeSlug = slug;
    renderSidebar();
    if (onFilterChange) onFilterChange(slug);
}

async function handleNewCollection(): Promise<void> {
    const name = prompt('Collection name:');
    if (!name || !name.trim()) return;
    try {
        await createCollection(name.trim());
        await refreshCollections();
        notify.success('Created collection: ' + name.trim());
    } catch (err) {
        notify.error('Create failed: ' + (err as Error).message);
    }
}

async function handleDeleteCollection(coll: Collection): Promise<void> {
    if (!confirm('Delete collection "' + coll.name + '"? Archives will not be deleted.')) return;
    try {
        await deleteCollection(coll.slug);
        if (activeSlug === coll.slug) setActiveCollection('');
        await refreshCollections();
        notify.success('Deleted collection: ' + coll.name);
    } catch (err) {
        notify.error('Delete failed: ' + (err as Error).message);
    }
}

async function handleAddToCollection(slug: string, hash: string): Promise<void> {
    try {
        await addToCollection(slug, [hash]);
        await refreshCollections();
        const updated = await fetchArchiveCollections(hash);
        renderChips(hash, updated);
        notify.success('Added to collection');
    } catch (err) {
        notify.error('Add failed: ' + (err as Error).message);
    }
}

// ── Data ──

async function refreshCollections(): Promise<void> {
    try {
        collections = await fetchCollections();
        renderSidebar();
    } catch (err) {
        log.error('Failed to refresh collections:', err);
    }
}

/**
 * Fetch which collections an archive belongs to.
 * Uses a lightweight approach: iterate collections and check membership.
 * TODO: Add a dedicated server endpoint for efficiency.
 */
async function fetchArchiveCollections(archiveHash: string): Promise<Collection[]> {
    const result: Collection[] = [];
    for (const coll of collections) {
        try {
            const res = await apiFetch('/api/collections/' + coll.slug);
            if (!res.ok) continue;
            const data = await res.json() as CollectionWithArchives;
            if (data.archives?.some(a => a.hash === archiveHash)) {
                result.push(coll);
            }
        } catch { /* skip */ }
    }
    return result;
}

function escapeHtml(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ── Public API ──

export interface CollectionManagerConfig {
    getAuthHeaders: () => Record<string, string>;
    getCsrfToken: () => string | null;
    onFilterChange: (slug: string) => void;
}

/**
 * Initialize the collection manager. Call after library panel init.
 */
export async function initCollectionManager(config: CollectionManagerConfig): Promise<void> {
    authHeadersGetter = config.getAuthHeaders;
    csrfTokenGetter = config.getCsrfToken;
    onFilterChange = config.onFilterChange;

    sidebarList = document.getElementById('collection-sidebar-list');
    addBtn = document.getElementById('collection-sidebar-add');
    chipsContainer = document.getElementById('library-collection-chips');
    addSelect = document.getElementById('library-add-to-collection') as HTMLSelectElement | null;

    if (addBtn) {
        addBtn.addEventListener('click', handleNewCollection);
    }

    if (addSelect) {
        addSelect.addEventListener('change', () => {
            const slug = addSelect!.value;
            if (!slug) return;
            addSelect!.value = '';
            // Need the currently selected archive hash — get from library panel
            const selected = document.querySelector('.library-card.selected') as HTMLElement | null;
            if (selected?.dataset.hash) {
                handleAddToCollection(slug, selected.dataset.hash);
            }
        });
    }

    await refreshCollections();
    log.info('Collection manager initialized with', collections.length, 'collections');
}

/**
 * Get the currently active collection slug ('' for All Archives).
 */
export function getActiveCollectionSlug(): string {
    return activeSlug;
}

/**
 * Get archives for the active collection. Returns null for All Archives.
 */
export async function getActiveCollectionArchives(): Promise<string[] | null> {
    if (!activeSlug) return null;
    try {
        const res = await apiFetch('/api/collections/' + activeSlug);
        if (!res.ok) return null;
        const data = await res.json() as CollectionWithArchives;
        return data.archives?.map(a => a.hash) || [];
    } catch {
        return null;
    }
}

/**
 * Update collection chips in the detail pane for the given archive.
 */
export async function updateChipsForArchive(archiveHash: string): Promise<void> {
    const archiveColls = await fetchArchiveCollections(archiveHash);
    renderChips(archiveHash, archiveColls);
}

/**
 * Refresh the collection list (e.g., after upload).
 */
export { refreshCollections };
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Builds successfully

**Step 3: Commit**

```bash
git add src/modules/collection-manager.ts
git commit -m "feat(collections): add collection manager module for editor library"
```

---

### Task 20: Wire collection manager into library-panel.ts

**Files:**
- Modify: `src/modules/library-panel.ts`

**Step 1: Add import** at top of file (after existing imports):

```typescript
import { initCollectionManager, getActiveCollectionArchives, updateChipsForArchive, refreshCollections as refreshCollectionList } from './collection-manager.js';
```

**Step 2: Add collection filter to `render()`**

In the `render()` function (line 319), after the `searchQuery` filter (line 337), add collection filtering:

After the `const filtered = searchQuery ? ... : archives;` block, add:

```typescript
    // Apply collection filter if active
    let collectionFiltered = filtered;
    if (activeCollectionHashes !== null) {
        const hashSet = new Set(activeCollectionHashes);
        collectionFiltered = filtered.filter(a => hashSet.has(a.hash));
    }
```

Then replace all subsequent references to `filtered` with `collectionFiltered` in the rest of the `render()` function.

**Step 3: Add collection state** to the module state section (around line 48):

```typescript
let activeCollectionHashes: string[] | null = null;
```

**Step 4: Wire collection init** in `initLibraryPanel()` (after `setupDetailActions()` at line 886):

```typescript
    // Initialize collection manager
    initCollectionManager({
        getAuthHeaders: authHeaders,
        getCsrfToken: () => csrfToken,
        onFilterChange: async (slug) => {
            if (slug) {
                activeCollectionHashes = await getActiveCollectionArchives() || [];
            } else {
                activeCollectionHashes = null;
            }
            render();
        },
    });
```

**Step 5: Wire collection chips** in `selectArchive()` (after line 403, at end of the function):

```typescript
    // Update collection chips in detail pane
    updateChipsForArchive(hash);
```

**Step 6: Verify build**

Run: `npm run build`
Expected: Builds successfully

**Step 7: Commit**

```bash
git add src/modules/library-panel.ts
git commit -m "feat(collections): integrate collection manager into library panel"
```

---

## Phase 5: Verification

### Task 21: Verify full build

**Step 1: Run build**

Run: `npm run build`
Expected: Clean build, no errors

**Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK)

**Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass (no test regressions)

**Step 4: Commit** (if any lint fixes needed)

```bash
git add -A
git commit -m "chore: fix lint issues from collections feature"
```

---

### Task 22: Manual smoke test checklist

After deploying to Docker with `ADMIN_ENABLED=true`:

1. **API**: `curl /api/collections` returns `{ collections: [] }`
2. **Create**: POST to `/api/collections` with `{ name: "Test Collection" }` returns 201
3. **List**: GET `/api/collections` shows the new collection
4. **Add archive**: POST to `/api/collections/test-collection/archives` with `{ hashes: ["<hash>"] }`
5. **View**: GET `/api/collections/test-collection` shows collection with archive
6. **Kiosk page**: Browser at `/collection/test-collection` shows card grid
7. **Editor**: Library panel shows collection sidebar, clicking filters gallery
8. **Detail pane**: Selected archive shows collection chips
9. **Delete**: DELETE `/api/collections/test-collection` removes collection, archives intact
