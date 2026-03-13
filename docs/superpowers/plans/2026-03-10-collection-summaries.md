# Collection Summaries & Preview Images Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add collection summary editing and auto-generated mosaic preview images to the editorial Tauri app's browse collections page.

**Architecture:** Server-side mosaic generation with Sharp in meta-server.js. A new collection detail panel in the library sidebar for editing name, description, and thumbnail. Three new API endpoints for thumbnail upload, delete, and force-regenerate. Auto-regeneration on archive membership changes.

**Tech Stack:** Sharp (Node.js image compositing), busboy (multipart upload), SQLite (existing), TypeScript (client modules)

---

## File Structure

| File | Role |
|------|------|
| `docker/package.json` | Add `sharp` dependency |
| `docker/meta-server.js` | Mosaic generation function, 3 new endpoints, auto-regeneration hooks on membership changes |
| `src/modules/collection-manager.ts` | New collection detail panel UI (name, description, thumbnail editing) |
| `src/modules/library-panel.ts` | Wire sidebar ↔ detail panel toggle when collection vs archive is selected |
| `src/modules/collection-page.ts` | Verify full description renders in `.cp-header` on collection detail page |
| `src/modules/collections-browser.ts` | Minimal — verify thumbnail/description rendering works with new server data |

---

## Chunk 1: Server-side Mosaic Generation & API Endpoints

### Task 1: Add Sharp dependency

**Files:**
- Modify: `docker/package.json`

- [ ] **Step 1: Add sharp to docker/package.json**

In `docker/package.json`, add `sharp` to the `dependencies` object:

```json
{
  "dependencies": {
    "better-sqlite3": "9.4.3",
    "busboy": "1.6.0",
    "sharp": "^0.33.0"
  }
}
```

- [ ] **Step 2: Verify Docker build still works**

Run: `cd c:/Users/Jake/Git/Vitrine3D && npm run docker:build`
Expected: Build completes. Sharp installs in the `api-deps` stage (already has `python3 make g++` for native modules). Sharp ships prebuilt binaries for `linuxmusl-x64` (Alpine).

- [ ] **Step 3: Commit**

```bash
git add docker/package.json
git commit -m "chore: add sharp dependency for collection thumbnail generation"
```

---

### Task 2: Implement mosaic generation function in meta-server.js

**Files:**
- Modify: `docker/meta-server.js` (add near top, after requires)

- [ ] **Step 1: Add sharp require and generateCollectionMosaic function**

Add after the existing `require` block (around line 15) in `docker/meta-server.js`:

```javascript
const sharp = require('sharp');
```

Then add the mosaic generation function. Place it after the helper functions section (after `extractArchiveParam()`, which ends around line 540):

```javascript
/**
 * Generate a mosaic thumbnail for a collection from its archive thumbnails.
 * Layout: 2x2 for 4+ archives, 2x1 for 2-3, single centered for 1, branded placeholder for 0.
 * Output: 640x360 JPEG at 85% quality.
 */
async function generateCollectionMosaic(collectionId, slug) {
    const WIDTH = 640, HEIGHT = 360;
    const NAVY = { r: 8, g: 24, b: 42 };
    const autoPath = path.join(THUMBS_DIR, `collection-${slug}-auto.jpg`);

    // Get archive thumbnails in sort order
    const rows = db.prepare(`
        SELECT a.thumbnail FROM archives a
        JOIN collection_archives ca ON ca.archive_id = a.id
        WHERE ca.collection_id = ?
        ORDER BY ca.sort_order ASC
    `).all(collectionId);

    // Resolve to file paths, filter to those that exist
    const thumbPaths = [];
    for (const row of rows) {
        if (!row.thumbnail) continue;
        const p = path.join(HTML_ROOT, row.thumbnail);
        if (fs.existsSync(p)) thumbPaths.push(p);
        if (thumbPaths.length >= 4) break;
    }

    try {
        if (thumbPaths.length === 0) {
            // Branded placeholder: navy with collection name in gold
            const name = db.prepare('SELECT name FROM collections WHERE id = ?').get(collectionId)?.name || '';
            const escapedName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
            const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="#08182a"/>
                <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
                    font-family="sans-serif" font-size="28" fill="#FEC03A">${escapedName}</text>
            </svg>`;
            await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(autoPath);
        } else if (thumbPaths.length === 1) {
            // Single image, resized to fill
            await sharp(thumbPaths[0])
                .resize(WIDTH, HEIGHT, { fit: 'cover' })
                .jpeg({ quality: 85 })
                .toFile(autoPath);
        } else if (thumbPaths.length <= 3) {
            // 2x1 layout (first two images side by side)
            const halfW = WIDTH / 2;
            const tiles = await Promise.all(
                thumbPaths.slice(0, 2).map(p =>
                    sharp(p).resize(Math.round(halfW), HEIGHT, { fit: 'cover' }).toBuffer()
                )
            );
            await sharp({
                create: { width: WIDTH, height: HEIGHT, channels: 3, background: NAVY }
            })
                .composite([
                    { input: tiles[0], left: 0, top: 0 },
                    { input: tiles[1], left: Math.round(halfW), top: 0 },
                ])
                .jpeg({ quality: 85 })
                .toFile(autoPath);
        } else {
            // 2x2 grid
            const halfW = Math.round(WIDTH / 2);
            const halfH = Math.round(HEIGHT / 2);
            const tiles = await Promise.all(
                thumbPaths.slice(0, 4).map(p =>
                    sharp(p).resize(halfW, halfH, { fit: 'cover' }).toBuffer()
                )
            );
            await sharp({
                create: { width: WIDTH, height: HEIGHT, channels: 3, background: NAVY }
            })
                .composite([
                    { input: tiles[0], left: 0, top: 0 },
                    { input: tiles[1], left: halfW, top: 0 },
                    { input: tiles[2], left: 0, top: halfH },
                    { input: tiles[3], left: halfW, top: halfH },
                ])
                .jpeg({ quality: 85 })
                .toFile(autoPath);
        }
        log.info(`Generated mosaic for collection "${slug}" at ${autoPath}`);
        return `/thumbs/collection-${slug}-auto.jpg`;
    } catch (err) {
        log.error(`Failed to generate mosaic for collection "${slug}":`, err);
        return null;
    }
}
```

- [ ] **Step 2: Add helper to conditionally regenerate mosaic**

Add directly after `generateCollectionMosaic`:

```javascript
/**
 * Regenerate auto-mosaic only if the collection has no manual thumbnail.
 */
async function maybeRegenerateMosaic(collectionId, slug) {
    const row = db.prepare('SELECT thumbnail FROM collections WHERE id = ?').get(collectionId);
    if (!row) return;
    // Manual thumbnails use /thumbs/collection-{slug}.jpg (no "-auto" suffix)
    const isManual = row.thumbnail && row.thumbnail.includes(`collection-${slug}.jpg`) && !row.thumbnail.includes('-auto');
    if (isManual) return;
    const autoPath = await generateCollectionMosaic(collectionId, slug);
    if (autoPath) {
        db.prepare('UPDATE collections SET thumbnail = ?, updated_at = datetime(\'now\') WHERE id = ?').run(autoPath, collectionId);
    }
}
```

- [ ] **Step 3: Verify meta-server still starts**

Run: `cd c:/Users/Jake/Git/Vitrine3D && npm run docker:build && npm run docker:run`
Expected: Container starts without errors. `docker logs` shows no sharp import failures.

- [ ] **Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(server): add mosaic thumbnail generation for collections"
```

---

### Task 3: Add thumbnail API endpoints

**Files:**
- Modify: `docker/meta-server.js` (add endpoints in the collections admin section)

- [ ] **Step 1: Add POST /api/collections/:slug/thumbnail endpoint**

Add after the existing `handleReorderCollection` function (ends around line 1753). This handles custom thumbnail upload via multipart form:

```javascript
async function handleUploadCollectionThumbnail(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    const row = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
    if (!row) return sendJson(res, 404, { error: 'Collection not found' });

    try {
        const { tmpPath, filename } = await parseMultipartUpload(req);
        const ext = path.extname(filename).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            fs.unlinkSync(tmpPath);
            return sendJson(res, 400, { error: 'Image must be .jpg, .png, or .webp' });
        }

        const destName = `collection-${slug}.jpg`;
        const destPath = path.join(THUMBS_DIR, destName);

        // Convert to JPEG, resize to standard dimensions
        await sharp(tmpPath)
            .resize(640, 360, { fit: 'cover' })
            .jpeg({ quality: 85 })
            .toFile(destPath);

        fs.unlinkSync(tmpPath);

        const thumbUrl = `/thumbs/${destName}`;
        db.prepare('UPDATE collections SET thumbnail = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(thumbUrl, row.id);

        auditLog(actor, 'update_collection', slug, { field: 'thumbnail', value: thumbUrl }, req);
        sendJson(res, 200, { thumbnail: thumbUrl });
    } catch (err) {
        log.error('Collection thumbnail upload failed:', err);
        sendJson(res, 500, { error: 'Upload failed' });
    }
}
```

- [ ] **Step 2: Add DELETE /api/collections/:slug/thumbnail endpoint**

Add directly after the upload handler:

```javascript
async function handleDeleteCollectionThumbnail(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    const row = db.prepare('SELECT id, thumbnail FROM collections WHERE slug = ?').get(slug);
    if (!row) return sendJson(res, 404, { error: 'Collection not found' });

    // Delete manual thumbnail file if it exists
    const manualName = `collection-${slug}.jpg`;
    const manualPath = path.join(THUMBS_DIR, manualName);
    try { fs.unlinkSync(manualPath); } catch (_) { /* ignore */ }

    // Regenerate auto-mosaic
    const autoPath = await generateCollectionMosaic(row.id, slug);
    db.prepare('UPDATE collections SET thumbnail = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(autoPath, row.id);

    auditLog(actor, 'update_collection', slug, { field: 'thumbnail', value: 'reset_to_auto' }, req);
    sendJson(res, 200, { thumbnail: autoPath });
}
```

- [ ] **Step 3: Add POST /api/collections/:slug/generate-thumbnail endpoint**

Add directly after the delete handler:

```javascript
async function handleGenerateCollectionThumbnail(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    const row = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
    if (!row) return sendJson(res, 404, { error: 'Collection not found' });

    const autoPath = await generateCollectionMosaic(row.id, slug);
    if (autoPath) {
        db.prepare('UPDATE collections SET thumbnail = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(autoPath, row.id);
    }

    auditLog(actor, 'update_collection', slug, { field: 'thumbnail', value: 'regenerated' }, req);
    sendJson(res, 200, { thumbnail: autoPath });
}
```

- [ ] **Step 4: Wire up routes in the request dispatcher**

In the routing section (around line 2600+), find the collection admin route block and add the new routes. Add these BEFORE the existing `PATCH /api/collections/:slug` route so the more specific paths match first:

```javascript
// Collection thumbnail management
if (method === 'POST' && (m = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})\/thumbnail$/))) {
    return handleUploadCollectionThumbnail(req, res, m[1]);
}
if (method === 'DELETE' && (m = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})\/thumbnail$/))) {
    return handleDeleteCollectionThumbnail(req, res, m[1]);
}
if (method === 'POST' && (m = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})\/generate-thumbnail$/))) {
    return handleGenerateCollectionThumbnail(req, res, m[1]);
}
```

- [ ] **Step 5: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(server): add collection thumbnail upload, delete, and generate endpoints"
```

---

### Task 4: Hook auto-regeneration into archive membership changes

**Files:**
- Modify: `docker/meta-server.js` (modify existing handlers)

- [ ] **Step 1: Update handleAddCollectionArchives to regenerate mosaic**

Find the `handleAddCollectionArchives` function (around line 1642). This function uses a `readJsonBody` callback pattern — the `sendJson` call is inside the callback. The collection row is stored as `coll` (from `db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug)` at line ~1656). After the existing `sendJson(res, 200, { added: added })` line inside the callback, add the async regeneration:

```javascript
sendJson(res, 200, { added: added });

// Regenerate auto-mosaic in the background (fire-and-forget)
maybeRegenerateMosaic(coll.id, slug).catch(err =>
    log.error('Auto-mosaic regeneration failed after adding archives:', err)
);
```

Note: `maybeRegenerateMosaic` is async but called in a synchronous callback — the `.catch()` fire-and-forget pattern is intentional. The response is already sent; mosaic generation happens in the background.

- [ ] **Step 2: Update handleRemoveCollectionArchive to regenerate mosaic**

Find the `handleRemoveCollectionArchive` function (around line 1691). The collection row is stored as `coll` (from `db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug)` at line ~1697). The existing response is `sendJson(res, 200, { ok: true })` at line ~1711. After that line, add:

```javascript
// Regenerate auto-mosaic in the background (fire-and-forget)
maybeRegenerateMosaic(coll.id, slug).catch(err =>
    log.error('Auto-mosaic regeneration failed after removing archive:', err)
);
```

Do NOT change the existing `{ ok: true }` response shape — client code in `collection-manager.ts` depends on it.

- [ ] **Step 3: Remove the old first-archive thumbnail fallback**

In `handleGetCollection` (around line 1487-1488), remove or comment out:

```javascript
// OLD: if (!collection.thumbnail && collection.archives.length > 0) {
//     collection.thumbnail = collection.archives[0].thumbnail;
// }
```

This is now handled by the auto-generated mosaic. The `thumbnail` field in the DB is kept up-to-date by `maybeRegenerateMosaic`.

Also check `handleListCollections` (the list endpoint, around line 1443) for a similar fallback pattern — if it exists there too, remove it.

- [ ] **Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(server): auto-regenerate collection mosaic on membership changes"
```

---

## Chunk 2: Collection Manager Sidebar Panel

### Task 5: Add collection detail panel to collection-manager.ts

**Files:**
- Modify: `src/modules/collection-manager.ts`

- [ ] **Step 1: Add DOM references for the new detail panel**

The collection detail panel will reuse the existing `#library-detail` container — when a collection is selected in the sidebar, we hide the archive-specific content and show collection editing fields instead. Add new module-level variables after the existing DOM refs (around line 50):

```typescript
let detailPanel: HTMLElement | null = null;
let collectionDetailEl: HTMLElement | null = null;
```

- [ ] **Step 2: Create the collection detail panel HTML**

Add a function to create and inject the collection detail panel. Place it after the existing `renderSidebar` function:

```typescript
function createCollectionDetailPanel(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'collection-detail-panel';
    el.className = 'hidden';
    el.innerHTML = `
        <div class="collection-detail-header">
            <h3 class="collection-detail-title">Edit Collection</h3>
        </div>
        <div class="collection-detail-body">
            <label class="collection-field-label">Name</label>
            <input type="text" id="collection-edit-name" class="collection-field-input" placeholder="Collection name" />

            <label class="collection-field-label">Description</label>
            <textarea id="collection-edit-desc" class="collection-field-textarea" rows="4" placeholder="Collection summary..."></textarea>

            <label class="collection-field-label">Preview Image</label>
            <div id="collection-thumb-preview" class="collection-thumb-preview">
                <img id="collection-thumb-img" src="" alt="" />
                <div id="collection-thumb-placeholder" class="collection-thumb-placeholder">No image</div>
            </div>
            <div class="collection-thumb-actions">
                <button id="collection-thumb-upload" class="collection-btn-secondary" type="button">Upload Image</button>
                <button id="collection-thumb-pick" class="collection-btn-secondary" type="button">Choose from Archives</button>
                <button id="collection-thumb-generate" class="collection-btn-secondary" type="button">Auto-generate</button>
            </div>
            <div id="collection-thumb-reset" class="collection-thumb-reset hidden">
                <a href="#" id="collection-thumb-reset-link">Reset to auto-generated</a>
            </div>

            <div id="collection-archive-thumbs" class="collection-archive-thumbs hidden">
                <label class="collection-field-label">Pick an archive thumbnail</label>
                <div id="collection-archive-thumb-grid" class="collection-archive-thumb-grid"></div>
            </div>

            <input type="file" id="collection-thumb-file" accept="image/*" style="display:none" />

            <div class="collection-detail-footer">
                <button id="collection-save-btn" class="collection-btn-primary" type="button">Save</button>
            </div>
        </div>
    `;
    return el;
}
```

- [ ] **Step 3: Inject the panel into the DOM on init**

In `initCollectionManager`, after caching the existing DOM refs (around line 288), add:

```typescript
// Create and inject collection detail panel into the library detail area
detailPanel = document.getElementById('library-detail');
if (detailPanel) {
    collectionDetailEl = createCollectionDetailPanel();
    detailPanel.parentElement?.appendChild(collectionDetailEl);
    wireCollectionDetailEvents();
}
```

- [ ] **Step 4: Add state for currently-editing collection**

Add near the other module-level state variables:

```typescript
let editingCollection: (Collection & { archives?: { hash: string; thumbnail: string | null }[] }) | null = null;
let isManualThumb = false;
```

- [ ] **Step 5: Add function to show collection detail panel**

This is called when a collection is clicked in the sidebar. It fetches the full collection data, populates the form, and swaps the detail pane:

```typescript
async function showCollectionDetail(slug: string): Promise<void> {
    if (!collectionDetailEl || !detailPanel) return;

    try {
        const res = await apiFetch(`/api/collections/${slug}`);
        if (!res.ok) throw new Error(`Failed to fetch collection: ${res.status}`);
        const data = await res.json();
        editingCollection = data;

        // Populate form fields
        const nameInput = document.getElementById('collection-edit-name') as HTMLInputElement;
        const descInput = document.getElementById('collection-edit-desc') as HTMLTextAreaElement;
        const thumbImg = document.getElementById('collection-thumb-img') as HTMLImageElement;
        const thumbPlaceholder = document.getElementById('collection-thumb-placeholder') as HTMLElement;
        const resetEl = document.getElementById('collection-thumb-reset') as HTMLElement;

        if (nameInput) nameInput.value = data.name || '';
        if (descInput) descInput.value = data.description || '';

        // Determine if thumbnail is manual or auto
        isManualThumb = !!(data.thumbnail && data.thumbnail.includes(`collection-${slug}.jpg`) && !data.thumbnail.includes('-auto'));

        if (data.thumbnail) {
            if (thumbImg) { thumbImg.src = data.thumbnail; thumbImg.style.display = ''; }
            if (thumbPlaceholder) thumbPlaceholder.style.display = 'none';
        } else {
            if (thumbImg) thumbImg.style.display = 'none';
            if (thumbPlaceholder) thumbPlaceholder.style.display = '';
        }

        if (resetEl) resetEl.classList.toggle('hidden', !isManualThumb);

        // Hide archive detail, show collection detail
        detailPanel.classList.add('hidden');
        collectionDetailEl.classList.remove('hidden');

        // Hide the archive picker grid initially
        const archiveThumbsEl = document.getElementById('collection-archive-thumbs');
        if (archiveThumbsEl) archiveThumbsEl.classList.add('hidden');

    } catch (err) {
        log.error('Failed to load collection detail:', err);
        notify.error('Failed to load collection details');
    }
}
```

- [ ] **Step 6: Add function to hide collection detail panel**

```typescript
function hideCollectionDetail(): void {
    if (collectionDetailEl) collectionDetailEl.classList.add('hidden');
    if (detailPanel) detailPanel.classList.remove('hidden');
    editingCollection = null;
}
```

- [ ] **Step 7: Wire up collection detail events**

```typescript
function wireCollectionDetailEvents(): void {
    // Save button
    const saveBtn = document.getElementById('collection-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', handleSaveCollection);

    // Upload button → trigger file input
    const uploadBtn = document.getElementById('collection-thumb-upload');
    const fileInput = document.getElementById('collection-thumb-file') as HTMLInputElement;
    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleThumbFileSelected);
    }

    // Pick from archives button
    const pickBtn = document.getElementById('collection-thumb-pick');
    if (pickBtn) pickBtn.addEventListener('click', handleShowArchiveThumbs);

    // Auto-generate button
    const genBtn = document.getElementById('collection-thumb-generate');
    if (genBtn) genBtn.addEventListener('click', handleGenerateMosaic);

    // Reset to auto link
    const resetLink = document.getElementById('collection-thumb-reset-link');
    if (resetLink) resetLink.addEventListener('click', (e) => {
        e.preventDefault();
        handleResetThumb();
    });
}
```

- [ ] **Step 8: Implement save handler**

```typescript
async function handleSaveCollection(): Promise<void> {
    if (!editingCollection) return;
    const slug = editingCollection.slug;

    const nameInput = document.getElementById('collection-edit-name') as HTMLInputElement;
    const descInput = document.getElementById('collection-edit-desc') as HTMLTextAreaElement;

    const body: Record<string, string> = {};
    if (nameInput && nameInput.value !== editingCollection.name) body.name = nameInput.value;
    if (descInput && descInput.value !== (editingCollection.description || '')) body.description = descInput.value;

    if (Object.keys(body).length === 0) {
        notify.info('No changes to save');
        return;
    }

    try {
        const res = await apiFetch(`/api/collections/${slug}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
        notify.success('Collection updated');
        await refreshCollections();
    } catch (err) {
        log.error('Failed to save collection:', err);
        notify.error('Failed to save collection');
    }
}
```

- [ ] **Step 9: Implement thumbnail upload handler**

```typescript
async function handleThumbFileSelected(): Promise<void> {
    if (!editingCollection) return;
    const fileInput = document.getElementById('collection-thumb-file') as HTMLInputElement;
    if (!fileInput?.files?.length) return;

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file, file.name);

    // IMPORTANT: Cannot use apiFetch() here — it is a thin wrapper that spreads
    // opts.headers and may set Content-Type. For FormData uploads, Content-Type
    // must NOT be set (the browser auto-generates the multipart boundary).
    // Use raw fetch() with auth headers from authHeadersGetter() instead.
    try {
        const headers: Record<string, string> = authHeadersGetter ? authHeadersGetter() : {};
        if (_csrfTokenGetter) {
            const token = _csrfTokenGetter();
            if (token) headers['x-csrf-token'] = token;
        }
        // Do NOT set Content-Type — browser sets it with boundary for FormData
        const res = await fetch(`/api/collections/${editingCollection.slug}/thumbnail`, {
            method: 'POST',
            headers,
            body: formData,
            credentials: 'include',
        });
        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
        const data = await res.json();
        updateThumbPreview(data.thumbnail);
        isManualThumb = true;
        const resetEl = document.getElementById('collection-thumb-reset');
        if (resetEl) resetEl.classList.remove('hidden');
        notify.success('Thumbnail uploaded');
    } catch (err) {
        log.error('Thumbnail upload failed:', err);
        notify.error('Failed to upload thumbnail');
    }

    fileInput.value = '';
}
```

Note: `apiFetch()` in this module (line ~42) is a thin wrapper over `fetch` that spreads `opts.headers` and adds `credentials: 'include'`. It does NOT force `Content-Type: application/json`, but to be safe with FormData (where Content-Type must be unset so the browser adds the multipart boundary), we use raw `fetch` directly here. The `authHeadersGetter` and `_csrfTokenGetter` are module-level callbacks set during `initCollectionManager`.

- [ ] **Step 10: Implement archive thumbnail picker**

```typescript
function handleShowArchiveThumbs(): void {
    if (!editingCollection?.archives) return;
    const container = document.getElementById('collection-archive-thumbs');
    const grid = document.getElementById('collection-archive-thumb-grid');
    if (!container || !grid) return;

    grid.innerHTML = '';
    const archivesWithThumbs = editingCollection.archives.filter(a => a.thumbnail);

    if (archivesWithThumbs.length === 0) {
        grid.innerHTML = '<p style="color: rgba(232,236,240,0.5); font-size: 0.8rem;">No archive thumbnails available</p>';
        container.classList.remove('hidden');
        return;
    }

    for (const archive of archivesWithThumbs) {
        const img = document.createElement('img');
        img.src = archive.thumbnail!;
        img.alt = '';
        img.className = 'collection-archive-thumb-option';
        img.addEventListener('click', () => handlePickArchiveThumb(archive.thumbnail!));
        grid.appendChild(img);
    }

    container.classList.remove('hidden');
}

async function handlePickArchiveThumb(thumbUrl: string): Promise<void> {
    if (!editingCollection) return;

    try {
        const res = await apiFetch(`/api/collections/${editingCollection.slug}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ thumbnail: thumbUrl }),
        });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        updateThumbPreview(thumbUrl);
        isManualThumb = true;
        const resetEl = document.getElementById('collection-thumb-reset');
        if (resetEl) resetEl.classList.remove('hidden');
        const archiveThumbsEl = document.getElementById('collection-archive-thumbs');
        if (archiveThumbsEl) archiveThumbsEl.classList.add('hidden');
        notify.success('Thumbnail updated');
    } catch (err) {
        log.error('Failed to set archive thumbnail:', err);
        notify.error('Failed to update thumbnail');
    }
}
```

- [ ] **Step 11: Implement auto-generate and reset handlers**

```typescript
async function handleGenerateMosaic(): Promise<void> {
    if (!editingCollection) return;

    try {
        const res = await apiFetch(`/api/collections/${editingCollection.slug}/generate-thumbnail`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error(`Generate failed: ${res.status}`);
        const data = await res.json();
        updateThumbPreview(data.thumbnail);
        isManualThumb = false;
        const resetEl = document.getElementById('collection-thumb-reset');
        if (resetEl) resetEl.classList.add('hidden');
        notify.success('Mosaic generated');
    } catch (err) {
        log.error('Mosaic generation failed:', err);
        notify.error('Failed to generate mosaic');
    }
}

async function handleResetThumb(): Promise<void> {
    if (!editingCollection) return;

    try {
        const res = await apiFetch(`/api/collections/${editingCollection.slug}/thumbnail`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error(`Reset failed: ${res.status}`);
        const data = await res.json();
        updateThumbPreview(data.thumbnail);
        isManualThumb = false;
        const resetEl = document.getElementById('collection-thumb-reset');
        if (resetEl) resetEl.classList.add('hidden');
        notify.success('Thumbnail reset to auto-generated');
    } catch (err) {
        log.error('Thumbnail reset failed:', err);
        notify.error('Failed to reset thumbnail');
    }
}

function updateThumbPreview(url: string | null): void {
    const img = document.getElementById('collection-thumb-img') as HTMLImageElement;
    const placeholder = document.getElementById('collection-thumb-placeholder');
    if (url) {
        if (img) { img.src = url + '?t=' + Date.now(); img.style.display = ''; }
        if (placeholder) placeholder.style.display = 'none';
    } else {
        if (img) img.style.display = 'none';
        if (placeholder) placeholder.style.display = '';
    }
}
```

- [ ] **Step 12: Update setActiveCollection to show detail panel**

Modify the existing `setActiveCollection` function. Currently:

```typescript
function setActiveCollection(slug: string): void {
    activeSlug = slug;
    renderSidebar();
    if (onFilterChange) onFilterChange(slug);
}
```

Change to:

```typescript
function setActiveCollection(slug: string): void {
    activeSlug = slug;
    renderSidebar();
    if (onFilterChange) onFilterChange(slug);

    // Show collection detail panel when a collection is selected
    if (slug) {
        showCollectionDetail(slug);
    } else {
        hideCollectionDetail();
    }
}
```

- [ ] **Step 13: Export hideCollectionDetail for library-panel integration**

Add `hideCollectionDetail` to the module exports so library-panel can hide the collection panel when an archive is selected:

```typescript
export { hideCollectionDetail };
```

- [ ] **Step 14: Commit**

```bash
git add src/modules/collection-manager.ts
git commit -m "feat(editor): add collection detail panel for editing name, description, and thumbnail"
```

---

### Task 6: Add CSS for collection detail panel

**Files:**
- Modify: `src/styles.css` (add at end of library panel section)

- [ ] **Step 1: Add collection detail panel styles**

Find the library panel CSS section in `src/styles.css` (search for `.collection-sidebar` styles) and add after them:

```css
/* Collection detail panel */
#collection-detail-panel {
    padding: 16px;
    overflow-y: auto;
    max-height: calc(100vh - 120px);
}
#collection-detail-panel.hidden { display: none; }

.collection-detail-header {
    margin-bottom: 12px;
}
.collection-detail-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: rgba(232, 236, 240, 0.95);
    margin: 0;
}

.collection-field-label {
    display: block;
    font-size: 0.75rem;
    color: rgba(232, 236, 240, 0.6);
    margin: 12px 0 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.collection-field-input,
.collection-field-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    font-size: 0.85rem;
    color: rgba(232, 236, 240, 0.95);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    outline: none;
    font-family: inherit;
    resize: vertical;
}
.collection-field-input:focus,
.collection-field-textarea:focus {
    border-color: rgba(254, 192, 58, 0.5);
}

.collection-thumb-preview {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 4px;
    overflow: hidden;
    margin-top: 4px;
}
.collection-thumb-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.collection-thumb-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: rgba(232, 236, 240, 0.3);
    font-size: 0.8rem;
}

.collection-thumb-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
}

.collection-btn-secondary {
    padding: 5px 10px;
    font-size: 0.75rem;
    color: rgba(232, 236, 240, 0.8);
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
}
.collection-btn-secondary:hover {
    background: rgba(255, 255, 255, 0.12);
}

.collection-btn-primary {
    width: 100%;
    padding: 8px;
    font-size: 0.85rem;
    color: #08182a;
    background: #FEC03A;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    font-family: inherit;
}
.collection-btn-primary:hover {
    background: #ffd060;
}

.collection-thumb-reset {
    margin-top: 6px;
    font-size: 0.75rem;
}
.collection-thumb-reset.hidden { display: none; }
.collection-thumb-reset a {
    color: rgba(254, 192, 58, 0.7);
    text-decoration: none;
}
.collection-thumb-reset a:hover {
    color: #FEC03A;
}

.collection-archive-thumbs {
    margin-top: 10px;
}
.collection-archive-thumbs.hidden { display: none; }

.collection-archive-thumb-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: 6px;
    margin-top: 6px;
}
.collection-archive-thumb-option {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 3px;
    cursor: pointer;
    border: 2px solid transparent;
    transition: border-color 0.15s;
}
.collection-archive-thumb-option:hover {
    border-color: #FEC03A;
}

.collection-detail-footer {
    margin-top: 16px;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "feat(editor): add CSS for collection detail panel"
```

---

### Task 7: Wire library-panel to toggle between archive and collection detail

**Files:**
- Modify: `src/modules/library-panel.ts`

- [ ] **Step 1: Import hideCollectionDetail from collection-manager**

Add to the existing imports from collection-manager (around line 15):

```typescript
import {
    initCollectionManager,
    getActiveCollectionSlug,
    getActiveCollectionArchives,
    updateChipsForArchive,
    refreshCollections,
    hideCollectionDetail,   // ← add this
} from './collection-manager.js';
```

- [ ] **Step 2: Call hideCollectionDetail when an archive is selected**

In the `selectArchive` function (search for `function selectArchive`), add at the top before showing archive details:

```typescript
hideCollectionDetail();
```

This ensures clicking an archive in the gallery hides the collection editing panel and shows the archive detail pane.

- [ ] **Step 3: Verify build**

Run: `cd c:/Users/Jake/Git/Vitrine3D && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/library-panel.ts
git commit -m "feat(editor): toggle between collection and archive detail panels"
```

---

## Chunk 3: Collection Page Description & Verification

### Task 8: Show full description on collection detail page

**Files:**
- Modify: `src/modules/collection-page.ts`

The spec requires `collection-page.ts` to render the full description in the `.cp-header` area. The `renderPage` function already has a `.cp-description` element — verify it renders `data.description` and is not conditional on a missing field.

- [ ] **Step 1: Verify description rendering in renderPage**

Read `src/modules/collection-page.ts` and find the `renderPage` function. Check the `.cp-header` section for description rendering. It should already include:

```html
<p class="cp-description">${escapeHtml(data.description || '')}</p>
```

If the description is only shown conditionally (e.g., wrapped in `if (data.description)`) or is missing entirely, update it to always render the `<p>` element (empty if no description).

- [ ] **Step 2: Commit if changed**

```bash
git add src/modules/collection-page.ts
git commit -m "feat(kiosk): ensure collection description renders in collection page header"
```

---

### Task 9: Verify archive thumbnails in collection detail API response

**Files:**
- Modify: `docker/meta-server.js`

The `GET /api/collections/:slug` response includes archives, but we need to confirm each archive object includes its `thumbnail` field so the "Choose from archives" picker works.

- [ ] **Step 1: Verify archive thumbnail is included in collection detail response**

Check the `handleGetCollection` function. The archives query should already join with the `archives` table and include `thumbnail`. If it doesn't, add `a.thumbnail` to the SELECT clause:

```sql
SELECT a.hash, a.uuid, a.filename, a.path, a.title, a.size, a.modified, a.thumbnail, ...
FROM archives a
JOIN collection_archives ca ON ca.archive_id = a.id
WHERE ca.collection_id = ?
ORDER BY ca.sort_order ASC
```

- [ ] **Step 2: Commit if changed**

```bash
git add docker/meta-server.js
git commit -m "fix(server): ensure archive thumbnails included in collection detail response"
```

---

### Task 10: Verify collections browser renders thumbnails and descriptions correctly

**Files:**
- Review: `src/modules/collections-browser.ts`

- [ ] **Step 1: Verify renderCollectionCard handles thumbnails correctly**

Read `collections-browser.ts` around the `renderCollectionCard` function (line 484-511). Confirm:
- `coll.thumbnail` is used for the `<img src>` — this already works since the server now resolves manual/auto thumbnails
- `coll.description` is rendered with `line-clamp: 2` — already implemented
- CSS placeholder shown when `thumbnail` is null — already implemented

No code changes expected. If any issues found, fix them.

- [ ] **Step 2: Verify the aspect ratio matches**

Confirm `.cb-coll-thumb` uses `aspect-ratio: 16 / 9` (line 253) and generated mosaics are 640x360 (16:9). These should match.

---

### Task 11: Full build verification

- [ ] **Step 1: Run full build**

Run: `cd c:/Users/Jake/Git/Vitrine3D && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run lint**

Run: `cd c:/Users/Jake/Git/Vitrine3D && npm run lint`
Expected: 0 errors (warnings OK).

- [ ] **Step 3: Run tests**

Run: `cd c:/Users/Jake/Git/Vitrine3D && npm test`
Expected: All existing tests pass. No new tests needed (this feature is UI + API, not security-critical logic).
