# Collections Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the auth-gated "Browse Library" flow in the Tauri app with a public Collections browser that uses only the unauthenticated `/api/collections` and `/api/collections/:slug` endpoints.

**Architecture:** A new `collections-browser.ts` module manages a 4-level navigation state machine (file picker → collections list → collection detail → archive viewer). It overlays a `#collections-browser` container div on top of the kiosk app shell. Two functions replace the old auth flow in `kiosk-main.ts`: `initCollectionsBrowser()` (called once at startup) and `showCollectionsBrowser()` (called by the "Browse Library" button click).

**Tech Stack:** TypeScript, plain `fetch()` (no auth), Three.js kiosk shell DOM manipulation, existing `collection-page.ts` styles and helpers.

---

## Context: What Already Exists

- `src/modules/collection-page.ts` — exports `injectStyles()`, `renderCard()`, `escapeHtml()`, `formatBytes()`, `formatDate()`, `ASSET_LABELS`, `getLogoSrc()`, and the `CollectionArchive` type. All reused directly.
- `src/modules/library-page.ts` — has `lp-coll-*` CSS for collection grid cards. Copy the relevant ~80 lines of CSS into the new module. **Do not modify this file** — it still serves the web `/library` route.
- `src/modules/kiosk-main.ts` — the file to modify. Key locations:
  - Line 63-65: imports to change
  - Lines 263–321: `_launchedFromLibrary`, `showLibraryInApp()`, `returnToLibrary()` — delete entirely
  - Lines 722–784: `injectLibraryButton()` — simplify click handler
  - Lines 3010–3016: `#kiosk-back-library` button creation — change listener
- `VITE_APP_LIBRARY_URL` — env var with the remote server base URL (e.g. `https://jakemarino.fyi`). Already used in `kiosk-main.ts`.

## API Endpoints (both public, no auth)

```
GET {VITE_APP_LIBRARY_URL}/api/collections
→ { collections: CollectionItem[] }

GET {VITE_APP_LIBRARY_URL}/api/collections/:slug
→ { id, slug, name, description, thumbnail, archiveCount, archives: CollectionArchive[] }
```

---

## Task 1: Create `collections-browser.ts` — skeleton, types, styles, container

**Files:**
- Create: `src/modules/collections-browser.ts`

**Step 1: Create the file with types, style injection, and container helpers**

```typescript
/**
 * Collections Browser Module
 *
 * Public-only in-app collections browser for the Tauri kiosk.
 * Fetches /api/collections and /api/collections/:slug (both unauthenticated).
 * Manages a 4-level navigation stack:
 *   file picker → collections list → collection detail → archive viewer
 */

import { Logger } from './utilities.js';
import {
    injectStyles as injectCardStyles,
    renderCard,
    escapeHtml,
    getLogoSrc,
} from './collection-page.js';
import type { CollectionArchive } from './collection-page.js';

const log = Logger.getLogger('collections-browser');

// ── Types ──

interface CollectionItem {
    id: number;
    slug: string;
    name: string;
    description: string;
    thumbnail: string | null;
    archiveCount: number;
}

interface CollectionDetail {
    slug: string;
    name: string;
    description: string;
    thumbnail: string | null;
    archiveCount: number;
    archives: CollectionArchive[];
}

type BrowserView =
    | { kind: 'collections' }
    | { kind: 'collection'; slug: string; name: string };

// ── Module state ──

export interface CollectionsBrowserOpts {
    loadArchiveFromUrl: (url: string) => void;
    libraryBaseUrl: string;
}

let _opts: CollectionsBrowserOpts | null = null;
let _currentView: BrowserView = { kind: 'collections' };
let _cachedCollection: CollectionDetail | null = null;
let _containerEl: HTMLElement | null = null;

// ── Style injection ──

function injectCollectionCardStyles(): void {
    if (document.getElementById('coll-browser-styles')) return;
    const style = document.createElement('style');
    style.id = 'coll-browser-styles';
    style.textContent = `
/* Collections browser overlay */
#collections-browser {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: #08182a;
    color: rgba(232, 236, 240, 0.95);
    font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    z-index: 200;
}

/* Nav bar at top of browser */
.cb-nav {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 48px;
    background: rgba(8, 24, 42, 0.9);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(254, 192, 58, 0.08);
}

.cb-nav-back {
    background: none;
    border: none;
    color: rgba(140, 160, 180, 0.8);
    font-family: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    padding: 6px 0;
    transition: color 0.2s ease;
    outline: none;
    white-space: nowrap;
}

.cb-nav-back:hover { color: rgba(232, 236, 240, 0.95); }

.cb-nav-sep {
    color: rgba(140, 160, 180, 0.3);
    font-size: 0.7rem;
}

.cb-nav-crumb {
    font-size: 0.72rem;
    font-weight: 500;
    color: rgba(232, 236, 240, 0.55);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.cb-close {
    margin-left: auto;
    background: none;
    border: none;
    color: rgba(140, 160, 180, 0.6);
    font-size: 1.2rem;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
    transition: color 0.2s ease;
    outline: none;
}

.cb-close:hover { color: rgba(232, 236, 240, 0.9); }

/* Loading / error states */
.cb-loading, .cb-error {
    max-width: 960px;
    margin: 0 auto;
    padding: 80px 48px;
    text-align: center;
    font-size: 0.85rem;
    color: rgba(140, 160, 180, 0.55);
}

.cb-retry {
    margin-top: 16px;
    background: none;
    border: 1px solid rgba(254, 192, 58, 0.2);
    color: rgba(254, 192, 58, 0.8);
    font-family: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 8px 16px;
    cursor: pointer;
    transition: border-color 0.2s ease, color 0.2s ease;
    outline: none;
}

.cb-retry:hover {
    border-color: rgba(254, 192, 58, 0.5);
    color: #FEC03A;
}

/* Collection cards grid */
.cb-coll-grid {
    max-width: 960px;
    margin: 0 auto;
    padding: 40px 48px 48px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 24px;
}

.cb-coll-card {
    display: block;
    text-decoration: none;
    color: inherit;
    background: rgba(17, 48, 78, 0.6);
    border: 1px solid rgba(254, 192, 58, 0.08);
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    animation: cpSlideUp 0.4s ease-out both;
}

.cb-coll-card:hover {
    border-color: rgba(254, 192, 58, 0.25);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

.cb-coll-card:hover .cb-coll-thumb img { transform: scale(1.03); }

.cb-coll-thumb {
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: rgba(8, 24, 42, 0.8);
    position: relative;
}

.cb-coll-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.4s ease;
}

.cb-coll-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(17, 48, 78, 0.5), rgba(8, 24, 42, 0.8));
}

.cb-coll-body {
    padding: 14px 16px 16px;
    border-top: 1px solid rgba(254, 192, 58, 0.1);
}

.cb-coll-name {
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: rgba(232, 236, 240, 0.95);
    margin-bottom: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.cb-coll-desc {
    font-size: 0.72rem;
    line-height: 1.5;
    color: rgba(170, 185, 200, 0.75);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 8px;
}

.cb-coll-count {
    font-size: 0.6rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(140, 160, 180, 0.55);
}

@media (max-width: 768px) {
    .cb-nav { padding: 10px 24px; }
    .cb-coll-grid { padding: 32px 24px; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
}

@media (max-width: 480px) {
    .cb-nav { padding: 8px 16px; }
    .cb-coll-grid { padding: 24px 16px; grid-template-columns: 1fr; }
}
`;
    document.head.appendChild(style);
}

// ── Container helpers ──

function getContainer(): HTMLElement {
    if (_containerEl) return _containerEl;
    let el = document.getElementById('collections-browser');
    if (!el) {
        el = document.createElement('div');
        el.id = 'collections-browser';
        document.body.appendChild(el);
    }
    _containerEl = el;
    return el;
}

function showBrowserContainer(): void {
    const el = getContainer();
    el.style.display = '';
}

function hideBrowserContainer(): void {
    const el = getContainer();
    el.style.display = 'none';
}

function getBackButtonEl(): HTMLElement | null {
    return document.getElementById('kiosk-back-library');
}
```

**Step 2: Verify the file compiles (no errors yet — just check imports resolve)**

```bash
cd c:/Users/Jake/Git/Vitrine3D && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors only about incomplete module (missing exports) — that's fine at this stage.

**Step 3: Commit**

```bash
git add src/modules/collections-browser.ts
git commit -m "feat(collections-browser): scaffold module with types, styles, container helpers"
```

---

## Task 2: Implement collections list fetch and render

**Files:**
- Modify: `src/modules/collections-browser.ts`

**Step 1: Add collections list fetch and render functions**

Add these functions after the container helpers section:

```typescript
// ── Fetch ──

async function fetchCollections(): Promise<CollectionItem[]> {
    const url = (_opts?.libraryBaseUrl || '') + '/api/collections';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch collections (' + res.status + ')');
    const data = await res.json() as { collections: CollectionItem[] };
    return data.collections;
}

async function fetchCollection(slug: string): Promise<CollectionDetail> {
    const url = (_opts?.libraryBaseUrl || '') + '/api/collections/' + encodeURIComponent(slug);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Collection not found (' + res.status + ')');
    return res.json() as Promise<CollectionDetail>;
}

// ── Render: nav bar ──

function renderNavBar(opts: {
    backLabel?: string;
    onBack?: () => void;
    crumb?: string;
    onClose: () => void;
}): HTMLElement {
    const nav = document.createElement('div');
    nav.className = 'cb-nav';

    if (opts.backLabel && opts.onBack) {
        const back = document.createElement('button');
        back.className = 'cb-nav-back';
        back.textContent = '\u2190 ' + opts.backLabel;
        back.addEventListener('click', opts.onBack);
        nav.appendChild(back);

        if (opts.crumb) {
            const sep = document.createElement('span');
            sep.className = 'cb-nav-sep';
            sep.textContent = '/';
            nav.appendChild(sep);

            const crumb = document.createElement('span');
            crumb.className = 'cb-nav-crumb';
            crumb.textContent = opts.crumb;
            nav.appendChild(crumb);
        }
    }

    const close = document.createElement('button');
    close.className = 'cb-close';
    close.title = 'Return to main menu';
    close.textContent = '\u00d7';
    close.addEventListener('click', opts.onClose);
    nav.appendChild(close);

    return nav;
}

// ── Render: collection card ──

function renderCollectionCard(coll: CollectionItem, index: number, onClick: () => void): HTMLElement {
    const card = document.createElement('div');
    card.className = 'cb-coll-card';
    card.style.animationDelay = (0.1 + index * 0.05) + 's';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.addEventListener('click', onClick);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); });

    const thumbHtml = coll.thumbnail
        ? '<img src="' + escapeHtml(coll.thumbnail) + '" alt="" loading="lazy">'
        : '<div class="cb-coll-placeholder"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="rgba(254,192,58,0.2)" stroke-width="0.8"><rect x="4" y="8" width="24" height="18" rx="1"/><path d="M8 8V6a1 1 0 011-1h14a1 1 0 011 1v2"/></svg></div>';

    const descHtml = coll.description
        ? '<div class="cb-coll-desc">' + escapeHtml(coll.description) + '</div>'
        : '';

    const countText = coll.archiveCount + ' Archive' + (coll.archiveCount !== 1 ? 's' : '');

    card.innerHTML =
        '<div class="cb-coll-thumb">' + thumbHtml + '</div>' +
        '<div class="cb-coll-body">' +
            '<div class="cb-coll-name">' + escapeHtml(coll.name) + '</div>' +
            descHtml +
            '<div class="cb-coll-count">' + escapeHtml(countText) + '</div>' +
        '</div>';

    return card;
}

// ── Render: collections list page ──

function renderCollectionsPage(collections: CollectionItem[]): void {
    const container = getContainer();
    container.innerHTML = '';

    // Gold spine
    const spine = document.createElement('div');
    spine.className = 'cp-spine';
    container.appendChild(spine);

    // Nav bar — no back button at top level; close returns to file picker
    container.appendChild(renderNavBar({
        onClose: closeCollectionsBrowser,
    }));

    // Editorial header
    const logoSrc = getLogoSrc();
    const header = document.createElement('div');
    header.className = 'cp-header';
    header.innerHTML =
        '<img class="cp-logo" src="' + logoSrc + '" alt="" onerror="this.style.display=\'none\'">' +
        '<div class="cp-eyebrow">Collections</div>' +
        '<h1 class="cp-title">Browse Collections</h1>' +
        '<div class="cp-rule"></div>' +
        '<span class="cp-count">' + collections.length + ' Collection' + (collections.length !== 1 ? 's' : '') + '</span>';
    container.appendChild(header);

    if (collections.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cb-loading';
        empty.textContent = 'No collections available.';
        container.appendChild(empty);
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'cb-coll-grid';
    collections.forEach((coll, i) => {
        grid.appendChild(renderCollectionCard(coll, i, () => navigateToCollection(coll.slug, coll.name)));
    });
    container.appendChild(grid);
}
```

**Step 2: Add `navigateToCollections()` and `closeCollectionsBrowser()`**

```typescript
// ── Navigation ──

function closeCollectionsBrowser(): void {
    hideBrowserContainer();
    const picker = document.getElementById('kiosk-file-picker');
    if (picker) picker.classList.remove('hidden');
    log.info('Closed collections browser');
}

async function navigateToCollections(): Promise<void> {
    _currentView = { kind: 'collections' };
    const container = getContainer();

    // Show loading state
    container.innerHTML = '<div class="cb-loading">Loading collections\u2026</div>';
    showBrowserContainer();

    try {
        const collections = await fetchCollections();
        renderCollectionsPage(collections);
        log.info('Collections loaded:', collections.length);
    } catch (err) {
        log.error('Failed to load collections:', err);
        container.innerHTML =
            '<div class="cb-error">' +
                '<p>Failed to load collections.</p>' +
                '<button class="cb-retry">Try again</button>' +
            '</div>';
        container.querySelector('.cb-retry')?.addEventListener('click', () => navigateToCollections());
    }
}
```

**Step 3: Commit**

```bash
git add src/modules/collections-browser.ts
git commit -m "feat(collections-browser): implement collections list fetch and render"
```

---

## Task 3: Implement collection detail view

**Files:**
- Modify: `src/modules/collections-browser.ts`

**Step 1: Add `renderCollectionDetailPage()` and `navigateToCollection()`**

Add after `navigateToCollections()`:

```typescript
// ── Render: collection detail page ──

function renderCollectionDetailPage(data: CollectionDetail): void {
    const container = getContainer();
    container.innerHTML = '';

    // Gold spine
    const spine = document.createElement('div');
    spine.className = 'cp-spine';
    container.appendChild(spine);

    // Nav bar with ← Collections back button
    container.appendChild(renderNavBar({
        backLabel: 'Collections',
        onBack: () => navigateToCollections(),
        crumb: data.name,
        onClose: closeCollectionsBrowser,
    }));

    // Editorial header
    const logoSrc = getLogoSrc();
    const header = document.createElement('div');
    header.className = 'cp-header';
    header.innerHTML =
        '<img class="cp-logo" src="' + logoSrc + '" alt="" onerror="this.style.display=\'none\'">' +
        '<div class="cp-eyebrow">Collection</div>' +
        '<h1 class="cp-title">' + escapeHtml(data.name) + '</h1>' +
        '<div class="cp-rule"></div>' +
        (data.description ? '<p class="cp-description">' + escapeHtml(data.description) + '</p>' : '') +
        '<span class="cp-count">' + data.archiveCount + ' Archive' + (data.archiveCount !== 1 ? 's' : '') + '</span>';
    container.appendChild(header);

    if (data.archives.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cb-loading';
        empty.textContent = 'This collection is empty.';
        container.appendChild(empty);
        return;
    }

    // Archive grid — reuse existing cp-card poster style from collection-page.ts
    const libraryBaseUrl = _opts?.libraryBaseUrl || '';
    const grid = document.createElement('div');
    grid.className = 'cp-grid';
    data.archives.forEach((archive, i) => {
        // renderCard from collection-page.ts with a custom click handler
        const card = renderCard(archive, i, (a) => openArchive(a, data.name));
        grid.appendChild(card);
    });
    container.appendChild(grid);

    // Store for return-from-viewer navigation
    _cachedCollection = data;
    void libraryBaseUrl; // suppress unused warning if not used here
}

async function navigateToCollection(slug: string, name: string): Promise<void> {
    _currentView = { kind: 'collection', slug, name };
    const container = getContainer();

    // Show loading state while keeping nav accessible
    container.innerHTML = '<div class="cb-loading">Loading\u2026</div>';

    try {
        // Use cache if we have the same collection (e.g. returning from viewer)
        const data = (_cachedCollection?.slug === slug)
            ? _cachedCollection!
            : await fetchCollection(slug);
        renderCollectionDetailPage(data);
        log.info('Collection loaded:', data.name, '(' + data.archives.length + ' archives)');
    } catch (err) {
        log.error('Failed to load collection:', err);
        container.innerHTML =
            '<div class="cb-error">' +
                '<p>Failed to load collection.</p>' +
                '<button class="cb-retry">Try again</button>' +
                '<br><button class="cb-nav-back" style="margin-top:12px">\u2190 Collections</button>' +
            '</div>';
        container.querySelector('.cb-retry')?.addEventListener('click', () => navigateToCollection(slug, name));
        container.querySelector('.cb-nav-back')?.addEventListener('click', () => navigateToCollections());
    }
}
```

**Step 2: Verify no TypeScript errors**

```bash
cd c:/Users/Jake/Git/Vitrine3D && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors only about missing exports (public API not yet added).

**Step 3: Commit**

```bash
git add src/modules/collections-browser.ts
git commit -m "feat(collections-browser): implement collection detail view with archive grid"
```

---

## Task 4: Implement archive viewer transition and public API

**Files:**
- Modify: `src/modules/collections-browser.ts`

**Step 1: Add `openArchive()` (transitions to viewer)**

Add after `navigateToCollection()`:

```typescript
// ── Archive viewer transition ──

function openArchive(archive: CollectionArchive, collectionName: string): void {
    if (!_opts) return;

    const libraryBaseUrl = _opts.libraryBaseUrl;
    const fullUrl = archive.path.startsWith('http')
        ? archive.path
        : libraryBaseUrl + archive.path;

    // Hide browser, show app
    hideBrowserContainer();
    const app = document.getElementById('app');
    if (app) app.style.display = '';

    // Relabel the kiosk-back-library button and show it
    const backBtn = getBackButtonEl();
    if (backBtn) {
        backBtn.textContent = '\u2190 ' + collectionName;
        backBtn.classList.remove('hidden');
    }

    // Hide file picker (it may be visible if no archive was loaded yet)
    const picker = document.getElementById('kiosk-file-picker');
    if (picker) picker.classList.add('hidden');

    log.info('Opening archive:', fullUrl);
    _opts.loadArchiveFromUrl(fullUrl);
}
```

**Step 2: Add `handleViewerBack()` — called when `#kiosk-back-library` is clicked**

```typescript
/**
 * Called when the viewer's back button is clicked.
 * Returns to the collection detail that launched the current archive.
 */
export function handleViewerBack(): void {
    const backBtn = getBackButtonEl();
    if (backBtn) backBtn.classList.add('hidden');

    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    // Return to collection detail (uses cache — no re-fetch)
    if (_currentView.kind === 'collection') {
        showBrowserContainer();
        if (_cachedCollection) {
            renderCollectionDetailPage(_cachedCollection);
        } else {
            navigateToCollection(_currentView.slug, _currentView.name);
        }
    } else {
        // Fallback: return to collections list
        navigateToCollections();
    }

    log.info('Returned from viewer to collection browser');
}
```

**Step 3: Add the two public entry points at the bottom of the file**

```typescript
// ── Public API ──

/**
 * Initialize the collections browser. Call once during kiosk init.
 * Sets up the overlay container and injects styles.
 */
export function initCollectionsBrowser(opts: CollectionsBrowserOpts): void {
    _opts = opts;
    injectCardStyles();          // cp-* styles from collection-page.ts
    injectCollectionCardStyles(); // cb-* / lp-coll-* styles
    const container = getContainer();
    container.style.display = 'none'; // hidden until Browse Library clicked
    log.info('Collections browser initialized, base URL:', opts.libraryBaseUrl);
}

/**
 * Show the collections list. Called by the "Browse Library" button.
 */
export async function showCollectionsBrowser(): Promise<void> {
    // Hide the file picker while browser is open
    const picker = document.getElementById('kiosk-file-picker');
    if (picker) picker.classList.add('hidden');

    await navigateToCollections();
}
```

**Step 4: Verify the full module compiles**

```bash
cd c:/Users/Jake/Git/Vitrine3D && npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 errors (or only errors in other files unrelated to this module).

**Step 5: Commit**

```bash
git add src/modules/collections-browser.ts
git commit -m "feat(collections-browser): add archive viewer transition and public API"
```

---

## Task 5: Modify `kiosk-main.ts`

**Files:**
- Modify: `src/modules/kiosk-main.ts`

This task makes the new module active. Make all changes carefully — `kiosk-main.ts` is ~3000 lines.

**Step 1: Update imports (lines 63–65)**

Replace:
```typescript
import { hasCfToken } from './tauri-auth.js';
import { initLibraryPage, setOnArchiveSelect } from './library-page.js';
import type { CollectionArchive } from './collection-page.js';
```

With:
```typescript
import { initCollectionsBrowser, showCollectionsBrowser, handleViewerBack } from './collections-browser.js';
```

(The `CollectionArchive` type import is no longer needed in kiosk-main since it was only used inside `showLibraryInApp`. The `hasCfToken` import may still be needed for other things — check by running `npm run lint` after. If it's unused, remove it.)

**Step 2: Delete the library integration block (lines 263–321)**

Delete this entire block — `_launchedFromLibrary`, `showLibraryInApp()`, and `returnToLibrary()`:

```typescript
// LIBRARY INTEGRATION — in-app library with CF Access auth
// =============================================================================

let _launchedFromLibrary = false;

async function showLibraryInApp(): Promise<void> { ... }

function returnToLibrary(): void { ... }
```

**Step 3: Replace `injectLibraryButton()` click handler (lines 749–781)**

The button creation (lines 733–747) stays unchanged. Only replace the click handler and the "auto-show" block at the bottom.

Replace the entire click handler + bottom block:
```typescript
    btn.addEventListener('click', async () => {
        if (hasCfToken()) {
            await showLibraryInApp();
            return;
        }
        const authUrl = libraryUrl + '/api/auth-callback';
        if ((window as any).__TAURI__) {
            try {
                log.info('Opening browser for CF Access auth:', authUrl);
                const { open } = await import('@tauri-apps/plugin-shell');
                await open(authUrl);
            } catch (err) {
                log.warn('shell.open failed, using window.open fallback:', (err as Error).message);
                window.open(authUrl, '_blank');
            }
        } else {
            window.location.href = libraryUrl + '/library';
        }
    });

    // If token was already received (e.g. deep link fired before this module loaded),
    // show library immediately. Otherwise listen for the auth callback.
    if (hasCfToken()) {
        showLibraryInApp();
    } else {
        window.addEventListener('vitrine3d:auth', () => {
            showLibraryInApp();
        }, { once: true });
    }
```

With:
```typescript
    btn.addEventListener('click', () => { void showCollectionsBrowser(); });
```

**Step 4: Wire `initCollectionsBrowser()` into the init sequence**

Find where `injectLibraryButton()` is called (~line 518). Add `initCollectionsBrowser` call just before it:

```typescript
    // Initialize collections browser (public, no auth required)
    if (config.home && libraryUrl) {
        initCollectionsBrowser({
            loadArchiveFromUrl,
            libraryBaseUrl: libraryUrl,
        });
    }

    // Inject library button after layout module may have replaced picker HTML
    injectLibraryButton();
```

Note: `libraryUrl` is already defined above this point as `(import.meta.env.VITE_APP_LIBRARY_URL as string | undefined) || ''`. Check the exact variable name in scope at line 518 and match it.

**Step 5: Replace `returnToLibrary` listener on the back button (~line 3015)**

Replace:
```typescript
    backBtn.addEventListener('click', returnToLibrary);
```

With:
```typescript
    backBtn.addEventListener('click', handleViewerBack);
```

**Step 6: Run lint to catch any remaining unused imports**

```bash
cd c:/Users/Jake/Git/Vitrine3D && npm run lint 2>&1 | grep -E "error|warn.*tauri-auth|warn.*CollectionArchive"
```

Remove any newly-unused imports flagged by ESLint.

**Step 7: Verify build**

```bash
cd c:/Users/Jake/Git/Vitrine3D && npm run build 2>&1 | tail -20
```

Expected: successful build, no TypeScript errors.

**Step 8: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(kiosk): replace auth-gated library with public collections browser"
```

---

## Task 6: Manual verification

**Step 1: Run dev server**

```bash
cd c:/Users/Jake/Git/Vitrine3D && npm run dev
```

**Step 2: Test in browser at `http://localhost:8080/?home=true`**

The kiosk file picker should show the "Browse Library" button. Click it — the collections browser overlay should appear with the editorial header and a grid of collection cards (requires `VITE_APP_LIBRARY_URL` to be set in `.env.local` pointing to your dev/staging server, or mock the response).

**Step 3: Verify navigation**

- [ ] "Browse Library" click → collections list renders (no auth prompt)
- [ ] Collection card click → collection detail renders with archive poster cards
- [ ] "← Collections" nav button → returns to collections list
- [ ] Archive card click → browser hides, `#app` shows, back button labeled "← [Collection Name]"
- [ ] "← [Collection Name]" back button → browser re-appears at collection detail (no re-fetch if cached)
- [ ] "✕" close button → browser hides, file picker reappears

**Step 4: Final commit if any tweaks were needed**

```bash
git add -p
git commit -m "fix(collections-browser): tweak navigation after manual testing"
```
