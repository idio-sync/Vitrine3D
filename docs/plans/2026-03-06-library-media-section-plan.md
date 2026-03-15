# Library Media Section Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show recordings attached to archives in the library detail pane with inline playback, GIF hover previews, and copy/delete actions.

**Architecture:** New "Recordings" collapsible section in the library detail pane (right sidebar), positioned after Actions and before Assets. Media data fetched from existing `GET /api/media?archive_hash=` API, cached per-hash. All rendering logic stays in `library-panel.ts` following the existing `renderAssets`/`renderMetadata` pattern.

**Tech Stack:** TypeScript, DOM APIs, existing `/api/media` REST endpoints, CSS matching existing `prop-section` / `prop-row` patterns.

---

### Task 1: Add HTML skeleton for Recordings section

**Files:**
- Modify: `src/editor/index.html:2635` (insert after Actions section closing `</div>`, before Assets section)

**Step 1: Add the Recordings section HTML**

Insert this block between the Actions section (ends at line 2635) and the Assets section (starts at line 2636):

```html
                    <div class="prop-section open" id="library-recordings-section" style="display:none">
                        <div class="prop-section-hd">
                            <span class="prop-section-title">Recordings</span>
                            <span class="prop-section-chevron">&#9654;</span>
                        </div>
                        <div class="prop-section-body" id="library-detail-recordings"></div>
                    </div>
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(library): add recordings section HTML skeleton"
```

---

### Task 2: Add CSS styles for media cards

**Files:**
- Modify: `src/styles.css` (append after existing `.library-asset-icon` block, around line 5168)

**Step 1: Add media card styles**

Append these styles after the existing library detail styles:

```css
/* Library recordings */
.library-media-card {
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
}
.library-media-card:last-child { margin-bottom: 0; }

.library-media-thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    background: var(--bg-surface);
    cursor: pointer;
    overflow: hidden;
}
.library-media-thumb img,
.library-media-thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.library-media-info {
    padding: 6px 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: var(--text-secondary);
}
.library-media-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
    font-size: 11px;
}
.library-media-badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--bg-surface);
    color: var(--text-secondary);
    white-space: nowrap;
}
.library-media-duration {
    font-family: monospace;
    font-size: 10px;
    white-space: nowrap;
}

.library-media-actions {
    display: flex;
    gap: 4px;
    padding: 0 8px 6px;
}
.library-media-actions button {
    flex: 1;
    font-size: 9px;
    padding: 3px 0;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
}
.library-media-actions button:hover {
    background: var(--bg-surface);
    color: var(--text-primary);
}
.library-media-actions button.danger:hover {
    background: rgba(220, 60, 60, 0.15);
    color: #dc3c3c;
}

/* Status states */
.library-media-status {
    position: absolute;
    top: 4px;
    right: 4px;
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 3px;
    color: #fff;
}
.library-media-status.processing {
    background: rgba(90, 158, 151, 0.8);
    animation: media-pulse 1.5s ease-in-out infinite;
}
.library-media-status.error {
    background: rgba(220, 60, 60, 0.8);
    cursor: help;
}
@keyframes media-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.library-media-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-muted);
    font-size: 10px;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/styles.css
git commit -m "feat(library): add recordings media card CSS"
```

---

### Task 3: Add MediaItem type, cache state, and DOM refs

**Files:**
- Modify: `src/modules/library-panel.ts:15-88` (types section and DOM refs section)

**Step 1: Add MediaItem interface**

After the `ArchiveListResponse` interface (line 41), add:

```typescript
interface MediaItem {
    id: string;
    archive_hash: string | null;
    title: string | null;
    mode: string | null;
    duration_ms: number;
    status: string;
    error_msg: string | null;
    mp4_path: string | null;
    gif_path: string | null;
    thumb_path: string | null;
    share_url: string;
    created_at: string | null;
}
```

**Step 2: Add media cache and poll state**

After `let csrfToken: string | null = null;` (line 56), add:

```typescript
const mediaCache = new Map<string, MediaItem[]>();
let mediaPollTimers: number[] = [];
```

**Step 3: Add DOM refs for recordings section**

After `let detailMetadataSection: HTMLElement | null = null;` (line 87), add:

```typescript
let recordingsSection: HTMLElement | null = null;
let recordingsBody: HTMLElement | null = null;
```

**Step 4: Cache the DOM refs in initLibraryPanel**

After the line `detailMetadataSection = document.getElementById('library-metadata-section');` (line 899), add:

```typescript
    recordingsSection = document.getElementById('library-recordings-section');
    recordingsBody = document.getElementById('library-detail-recordings');
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add src/modules/library-panel.ts
git commit -m "feat(library): add MediaItem type, cache, and DOM refs"
```

---

### Task 4: Implement fetchMedia and renderRecordings

**Files:**
- Modify: `src/modules/library-panel.ts` (add after `renderMetadata` function, around line 529)

**Step 1: Add fetchMedia function**

After the `renderMetadata` closing brace, add:

```typescript
// ── Recordings ──

async function fetchMedia(archiveHash: string): Promise<MediaItem[]> {
    try {
        const res = await apiFetch('/api/media?archive_hash=' + encodeURIComponent(archiveHash));
        if (!res.ok) return [];
        const data = await res.json() as { media: MediaItem[] };
        return data.media || [];
    } catch {
        log.warn('Failed to fetch media for', archiveHash);
        return [];
    }
}

function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
```

**Step 2: Add renderRecordings function**

```typescript
function renderRecordings(items: MediaItem[]): void {
    if (!recordingsBody || !recordingsSection) return;

    // Clear any active poll timers
    for (const t of mediaPollTimers) clearInterval(t);
    mediaPollTimers = [];

    if (items.length === 0) {
        recordingsSection.style.display = 'none';
        return;
    }
    recordingsSection.style.display = '';
    recordingsBody.innerHTML = '';

    for (const item of items) {
        recordingsBody.appendChild(renderMediaCard(item));
    }
}

function renderMediaCard(item: MediaItem): HTMLElement {
    const card = document.createElement('div');
    card.className = 'library-media-card';
    card.dataset.mediaId = item.id;

    const isReady = item.status === 'ready';
    const isError = item.status === 'error';
    const isProcessing = !isReady && !isError;

    // Thumbnail area
    const thumbArea = document.createElement('div');
    thumbArea.className = 'library-media-thumb';

    if (isReady && item.thumb_path) {
        const img = document.createElement('img');
        img.src = item.thumb_path;
        img.alt = item.title || 'Recording';
        img.loading = 'lazy';

        // GIF hover preview
        if (item.gif_path) {
            const thumbSrc = item.thumb_path;
            img.addEventListener('mouseenter', () => { img.src = item.gif_path!; });
            img.addEventListener('mouseleave', () => { img.src = thumbSrc; });
        }

        // Click to expand inline video player
        img.addEventListener('click', () => {
            if (item.mp4_path) expandVideoPlayer(thumbArea, item);
        });
        thumbArea.appendChild(img);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'library-media-placeholder';
        placeholder.textContent = isProcessing ? 'Processing…' : 'Error';
        thumbArea.appendChild(placeholder);
    }

    // Status badge
    if (isProcessing) {
        const badge = document.createElement('span');
        badge.className = 'library-media-status processing';
        badge.textContent = 'Processing';
        thumbArea.appendChild(badge);

        // Start polling for this item
        const timer = window.setInterval(async () => {
            try {
                const res = await apiFetch('/api/media/' + item.id);
                if (!res.ok) return;
                const updated = await res.json() as MediaItem;
                if (updated.status === 'ready' || updated.status === 'error') {
                    clearInterval(timer);
                    mediaPollTimers = mediaPollTimers.filter(t => t !== timer);
                    // Update cache and re-render
                    if (selectedHash) {
                        const cached = mediaCache.get(selectedHash);
                        if (cached) {
                            const idx = cached.findIndex(m => m.id === item.id);
                            if (idx !== -1) cached[idx] = updated;
                            renderRecordings(cached);
                        }
                    }
                }
            } catch { /* ignore poll errors */ }
        }, 3000);
        mediaPollTimers.push(timer);
    } else if (isError) {
        const badge = document.createElement('span');
        badge.className = 'library-media-status error';
        badge.textContent = 'Error';
        badge.title = item.error_msg || 'Transcode failed';
        thumbArea.appendChild(badge);
    }

    card.appendChild(thumbArea);

    // Info line
    const info = document.createElement('div');
    info.className = 'library-media-info';

    const title = document.createElement('span');
    title.className = 'library-media-title';
    title.textContent = item.title || 'Untitled';
    info.appendChild(title);

    if (item.mode) {
        const modeBadge = document.createElement('span');
        modeBadge.className = 'library-media-badge';
        modeBadge.textContent = item.mode.charAt(0).toUpperCase() + item.mode.slice(1);
        info.appendChild(modeBadge);
    }

    if (item.duration_ms > 0) {
        const dur = document.createElement('span');
        dur.className = 'library-media-duration';
        dur.textContent = formatDuration(item.duration_ms);
        info.appendChild(dur);
    }

    card.appendChild(info);

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'library-media-actions';

    if (isReady) {
        const shareBtn = document.createElement('button');
        shareBtn.textContent = 'Share Link';
        shareBtn.addEventListener('click', () => copyToClipboard(location.origin + item.share_url, 'Share link copied'));
        actions.appendChild(shareBtn);

        if (item.gif_path) {
            const gifBtn = document.createElement('button');
            gifBtn.textContent = 'Copy GIF';
            gifBtn.addEventListener('click', () => copyToClipboard(location.origin + item.gif_path!, 'GIF URL copied'));
            actions.appendChild(gifBtn);
        }
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => handleDeleteMedia(item));
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    return card;
}
```

**Step 3: Add helper functions**

```typescript
function expandVideoPlayer(container: HTMLElement, item: MediaItem): void {
    // If already playing, collapse
    const existing = container.querySelector('video');
    if (existing) {
        existing.pause();
        container.innerHTML = '';
        const img = document.createElement('img');
        img.src = item.thumb_path!;
        img.alt = item.title || 'Recording';
        if (item.gif_path) {
            const thumbSrc = item.thumb_path!;
            img.addEventListener('mouseenter', () => { img.src = item.gif_path!; });
            img.addEventListener('mouseleave', () => { img.src = thumbSrc; });
        }
        img.addEventListener('click', () => expandVideoPlayer(container, item));
        container.appendChild(img);
        return;
    }

    container.innerHTML = '';
    const video = document.createElement('video');
    video.src = item.mp4_path!;
    video.controls = true;
    video.autoplay = true;
    video.style.cssText = 'width:100%; height:100%; object-fit:contain; background:#000;';
    video.addEventListener('ended', () => expandVideoPlayer(container, item)); // collapse on end
    container.appendChild(video);
}

async function copyToClipboard(text: string, successMsg: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        notify.success(successMsg);
    } catch {
        notify.error('Copy failed');
    }
}

async function handleDeleteMedia(item: MediaItem): Promise<void> {
    if (!confirm('Delete recording "' + (item.title || 'Untitled') + '"? This cannot be undone.')) return;
    try {
        const res = await apiFetch('/api/media/' + item.id, { method: 'DELETE' });
        if (res.status === 401) { showAuth(); return; }
        if (!res.ok) {
            const data = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(data.error || 'Delete failed');
        }
        // Remove from cache
        if (selectedHash) {
            const cached = mediaCache.get(selectedHash);
            if (cached) {
                mediaCache.set(selectedHash, cached.filter(m => m.id !== item.id));
                renderRecordings(mediaCache.get(selectedHash)!);
            }
        }
        notify.success('Recording deleted');
    } catch (err) {
        if (err instanceof AuthError) { showAuth(); return; }
        notify.error('Delete failed: ' + (err as Error).message);
    }
}
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add src/modules/library-panel.ts
git commit -m "feat(library): implement media fetch, render, player, and actions"
```

---

### Task 5: Wire renderRecordings into selectArchive

**Files:**
- Modify: `src/modules/library-panel.ts:389-421` (selectArchive function)

**Step 1: Add media fetch call to selectArchive**

After `updateChipsForArchive(hash);` (line 420), add:

```typescript
    // Fetch and render recordings
    const cached = mediaCache.get(hash);
    if (cached) {
        renderRecordings(cached);
    } else {
        // Show section as loading, then fetch
        renderRecordings([]);
        fetchMedia(hash).then(items => {
            mediaCache.set(hash, items);
            // Only render if still selected
            if (selectedHash === hash) renderRecordings(items);
        });
    }
```

**Step 2: Clear recordings in showDetailEmpty**

In `showDetailEmpty()` (around line 423), add after the existing lines:

```typescript
    // Clear recordings
    renderRecordings([]);
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/modules/library-panel.ts
git commit -m "feat(library): wire recordings fetch into archive selection"
```

---

### Task 6: Final integration test and cleanup

**Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK).

**Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass.

**Step 4: Final commit with all files**

If any fixups were needed:
```bash
git add -A
git commit -m "feat(library): library media recordings section - final polish"
```
