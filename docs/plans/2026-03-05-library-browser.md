# Library Browser + Tauri Home Screen — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/library` page that shows all archives (with search/sort/filter) and collections in a tabbed view, plus a Tauri desktop home screen with "Browse Library" and "Open Local File" options.

**Architecture:** New `library-page.ts` module mirrors `collection-page.ts` editorial style. Server gets a `GET /library` route (CF Access gated) that injects `window.__VITRINE_LIBRARY = true`. Kiosk boot sequence checks for this flag first. Tauri home screen is a local `?home=true` mode in the kiosk entry point.

**Tech Stack:** TypeScript, Vite, Node.js (meta-server), Tauri v2

---

### Task 1: Extract shared helpers from collection-page.ts

**Files:**
- Modify: `src/modules/collection-page.ts`

Export the helpers and constants that `library-page.ts` will reuse. Currently these are private to the module.

**Step 1: Make helpers and constants exported**

In `src/modules/collection-page.ts`, change these from plain declarations to exports:

```ts
// Line 39 — change `function` to `export function`
export function formatBytes(b: number): string { ... }

// Line 46 — change `function` to `export function`
export function escapeHtml(s: string): string { ... }

// Line 52 — change `function` to `export function`
export function formatDate(dateStr: string): string { ... }

// Line 59 — change `const` to `export const`
export const ASSET_LABELS: Record<string, string> = { ... };

// Line 77 — change `function` to `export function`
export function injectStyles(): void { ... }

// Line 324 — change `function` to `export function`
export function getLogoSrc(): string { ... }

// Line 333 — change `function` to `export function`
export function renderCard(archive: CollectionArchive, index: number): HTMLElement { ... }
```

Also export the `CollectionArchive` interface (line 13):
```ts
export interface CollectionArchive { ... }
```

**Step 2: Verify collection page still works**

Run: `npm run build`
Expected: Build succeeds. Adding `export` to existing declarations doesn't change behavior for current consumers.

**Step 3: Commit**

```bash
git add src/modules/collection-page.ts
git commit -m "refactor: export shared helpers from collection-page for reuse"
```

---

### Task 2: Add `library` flag to config.js and APP_CONFIG

**Files:**
- Modify: `src/config.js:131-224`

**Step 1: Read `__VITRINE_LIBRARY` flag**

After line 132 (`const _inj = window.__VITRINE_CLEAN_URL || {};`), add:

```js
const _libraryMode = window.__VITRINE_LIBRARY === true;
```

Then in the `APP_CONFIG` object (line 192), add after `collectionSlug` (line 217):

```js
library: _libraryMode,
```

Also add `home` mode for Tauri. After the `library` line:

```js
home: params.get('home') === 'true',
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/config.js
git commit -m "feat: add library and home flags to APP_CONFIG"
```

---

### Task 3: Create library-page.ts

**Files:**
- Create: `src/modules/library-page.ts`

This is the largest task. The module renders a full-page editorial view with two tabs: "All Archives" and "Collections".

**Step 1: Create the module**

```ts
/**
 * Library Page Module
 *
 * Renders an auth-gated, editorial-themed library browser with two tabs:
 * "All Archives" (with search/sort/filter) and "Collections".
 * Reuses card components from collection-page.ts.
 */

import { Logger } from './utilities.js';
import {
    formatBytes,
    escapeHtml,
    formatDate,
    ASSET_LABELS,
    injectStyles as injectBaseStyles,
    getLogoSrc,
    renderCard,
    type CollectionArchive,
} from './collection-page.js';

const log = Logger.getLogger('library-page');

// ── Types ──

interface CollectionSummary {
    id: number;
    slug: string;
    name: string;
    description: string;
    thumbnail: string | null;
    theme: string | null;
    archiveCount: number;
}

interface ArchivesResponse {
    archives: CollectionArchive[];
    storageUsed: number;
}

type SortField = 'name' | 'date' | 'size';
type SortDir = 'asc' | 'desc';

// ── State ──

let allArchives: CollectionArchive[] = [];
let activeTab: 'archives' | 'collections' = 'archives';
let searchQuery = '';
let sortField: SortField = 'date';
let sortDir: SortDir = 'desc';
let activeTypeFilters: Set<string> = new Set();

// ── Fetch ──

async function fetchArchives(): Promise<ArchivesResponse> {
    const res = await fetch('/api/archives');
    if (!res.ok) throw new Error('Failed to load archives');
    return res.json();
}

async function fetchCollections(): Promise<CollectionSummary[]> {
    const res = await fetch('/api/collections');
    if (!res.ok) throw new Error('Failed to load collections');
    return res.json();
}

// ── Filtering & Sorting ──

function getFilteredArchives(): CollectionArchive[] {
    let filtered = allArchives;

    // Text search
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(a =>
            (a.title || '').toLowerCase().includes(q) ||
            a.filename.toLowerCase().includes(q)
        );
    }

    // Asset type filter
    if (activeTypeFilters.size > 0) {
        filtered = filtered.filter(a => {
            if (!a.assets || a.assets.length === 0) return false;
            const types = new Set(a.assets.map(asset => asset.type));
            for (const f of activeTypeFilters) {
                if (types.has(f)) return true;
            }
            return false;
        });
    }

    // Sort
    filtered.sort((a, b) => {
        let cmp = 0;
        if (sortField === 'name') {
            cmp = (a.title || a.filename).localeCompare(b.title || b.filename);
        } else if (sortField === 'date') {
            cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime();
        } else if (sortField === 'size') {
            cmp = a.size - b.size;
        }
        return sortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
}

// ── Styles ──

function injectLibraryStyles(): void {
    if (document.getElementById('library-page-styles')) return;
    const style = document.createElement('style');
    style.id = 'library-page-styles';
    style.textContent = `
/* Tab bar */
.lp-tabs {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 48px;
    display: flex;
    gap: 24px;
    border-bottom: 1px solid rgba(254, 192, 58, 0.12);
}

.lp-tab {
    background: none;
    border: none;
    color: rgba(140, 160, 180, 0.7);
    font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 12px 0;
    cursor: pointer;
    position: relative;
    transition: color 0.2s ease;
}

.lp-tab:hover {
    color: rgba(232, 236, 240, 0.95);
}

.lp-tab.active {
    color: #FEC03A;
}

.lp-tab.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: #FEC03A;
}

/* Filter bar */
.lp-filters {
    max-width: 960px;
    margin: 0 auto;
    padding: 20px 48px 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
}

.lp-search {
    flex: 1;
    min-width: 180px;
    max-width: 320px;
    background: rgba(17, 48, 78, 0.5);
    border: 1px solid rgba(254, 192, 58, 0.12);
    color: rgba(232, 236, 240, 0.95);
    font-family: 'Source Sans 3', -apple-system, sans-serif;
    font-size: 0.78rem;
    padding: 7px 12px;
    outline: none;
    transition: border-color 0.2s ease;
}

.lp-search::placeholder {
    color: rgba(140, 160, 180, 0.5);
}

.lp-search:focus {
    border-color: rgba(254, 192, 58, 0.35);
}

.lp-sort-group {
    display: flex;
    gap: 4px;
}

.lp-sort-btn {
    background: rgba(17, 48, 78, 0.4);
    border: 1px solid rgba(254, 192, 58, 0.08);
    color: rgba(140, 160, 180, 0.7);
    font-family: 'Source Sans 3', -apple-system, sans-serif;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 5px 10px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.lp-sort-btn:hover {
    border-color: rgba(254, 192, 58, 0.2);
    color: rgba(232, 236, 240, 0.9);
}

.lp-sort-btn.active {
    background: rgba(254, 192, 58, 0.1);
    border-color: rgba(254, 192, 58, 0.3);
    color: #FEC03A;
}

.lp-type-filters {
    display: flex;
    gap: 4px;
    margin-left: auto;
}

.lp-type-pill {
    background: rgba(17, 48, 78, 0.4);
    border: 1px solid rgba(254, 192, 58, 0.08);
    color: rgba(140, 160, 180, 0.7);
    font-family: 'Source Sans 3', -apple-system, sans-serif;
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 4px 9px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.lp-type-pill:hover {
    border-color: rgba(254, 192, 58, 0.2);
    color: rgba(232, 236, 240, 0.9);
}

.lp-type-pill.active {
    background: rgba(254, 192, 58, 0.12);
    border-color: rgba(254, 192, 58, 0.35);
    color: #FEC03A;
}

/* Collection card (different from archive card) */
.lp-coll-card {
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

.lp-coll-card:hover {
    border-color: rgba(254, 192, 58, 0.25);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

.lp-coll-card-body {
    padding: 16px;
    border-top: 1px solid rgba(254, 192, 58, 0.1);
}

.lp-coll-card-name {
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: rgba(232, 236, 240, 0.95);
    margin-bottom: 4px;
}

.lp-coll-card-desc {
    font-size: 0.72rem;
    color: rgba(140, 160, 180, 0.7);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 8px;
}

.lp-coll-card-count {
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(140, 160, 180, 0.5);
}

/* Empty state */
.lp-empty {
    max-width: 960px;
    margin: 0 auto;
    padding: 80px 48px;
    text-align: center;
    color: rgba(140, 160, 180, 0.5);
    font-size: 0.85rem;
}

/* Responsive */
@media (max-width: 768px) {
    .lp-tabs { padding: 0 24px; }
    .lp-filters { padding: 16px 24px 0; flex-direction: column; align-items: stretch; }
    .lp-search { max-width: none; }
    .lp-type-filters { margin-left: 0; flex-wrap: wrap; }
}

@media (max-width: 480px) {
    .lp-tabs { padding: 0 16px; }
    .lp-filters { padding: 12px 16px 0; }
}
`;
    document.head.appendChild(style);
}

// ── Rendering ──

function renderCollectionCard(coll: CollectionSummary, index: number): HTMLElement {
    const card = document.createElement('a');
    card.className = 'lp-coll-card';
    card.href = '/collection/' + encodeURIComponent(coll.slug);
    card.style.animationDelay = (0.15 + index * 0.06) + 's';

    const thumbHtml = coll.thumbnail
        ? '<img src="' + escapeHtml(coll.thumbnail) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;">'
        : '<div class="cp-card-placeholder"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="rgba(254,192,58,0.2)" stroke-width="0.8"><path d="M16 6l10 5.5v9L16 26 6 20.5v-9L16 6z"/><path d="M16 15.5V26"/><path d="M6 11.5L16 17l10-5.5"/></svg></div>';

    card.innerHTML =
        '<div class="cp-card-thumb">' + thumbHtml + '</div>' +
        '<div class="lp-coll-card-body">' +
            '<div class="lp-coll-card-name">' + escapeHtml(coll.name) + '</div>' +
            (coll.description ? '<div class="lp-coll-card-desc">' + escapeHtml(coll.description) + '</div>' : '') +
            '<div class="lp-coll-card-count">' + coll.archiveCount + ' archive' + (coll.archiveCount !== 1 ? 's' : '') + '</div>' +
        '</div>';

    return card;
}

function renderArchiveGrid(container: HTMLElement): void {
    // Remove existing grid
    const old = container.querySelector('.cp-grid');
    if (old) old.remove();
    const oldEmpty = container.querySelector('.lp-empty');
    if (oldEmpty) oldEmpty.remove();

    const filtered = getFilteredArchives();

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'lp-empty';
        empty.textContent = searchQuery || activeTypeFilters.size > 0
            ? 'No archives match your filters'
            : 'No archives in the library';
        container.appendChild(empty);
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'cp-grid';
    filtered.forEach((archive, i) => {
        grid.appendChild(renderCard(archive, i));
    });
    container.appendChild(grid);
}

function renderCollectionsGrid(container: HTMLElement, collections: CollectionSummary[]): void {
    const old = container.querySelector('.cp-grid');
    if (old) old.remove();
    const oldEmpty = container.querySelector('.lp-empty');
    if (oldEmpty) oldEmpty.remove();

    if (collections.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'lp-empty';
        empty.textContent = 'No collections yet';
        container.appendChild(empty);
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'cp-grid';
    collections.forEach((coll, i) => {
        grid.appendChild(renderCollectionCard(coll, i));
    });
    container.appendChild(grid);
}

function renderPage(container: HTMLElement, archiveCount: number): {
    contentArea: HTMLElement;
    filtersEl: HTMLElement;
} {
    const logoSrc = getLogoSrc();

    // Header
    const header = document.createElement('div');
    header.className = 'cp-header';
    header.innerHTML =
        '<img class="cp-logo" src="' + logoSrc + '" alt="" onerror="this.style.display=\'none\'">' +
        '<div class="cp-eyebrow">Library</div>' +
        '<h1 class="cp-title">Archive Library</h1>' +
        '<div class="cp-rule"></div>' +
        '<span class="cp-count">' + archiveCount + ' Archive' + (archiveCount !== 1 ? 's' : '') + '</span>';

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'lp-tabs';
    tabs.innerHTML =
        '<button class="lp-tab active" data-tab="archives">All Archives</button>' +
        '<button class="lp-tab" data-tab="collections">Collections</button>';

    // Filter bar
    const filters = document.createElement('div');
    filters.className = 'lp-filters';

    // Collect known asset types from data
    const knownTypes = new Set<string>();
    allArchives.forEach(a => {
        if (a.assets) a.assets.forEach(asset => knownTypes.add(asset.type));
    });

    const typeFiltersHtml = Array.from(knownTypes)
        .sort()
        .map(t => '<button class="lp-type-pill" data-type="' + t + '">' + (ASSET_LABELS[t] || t) + '</button>')
        .join('');

    filters.innerHTML =
        '<input class="lp-search" type="text" placeholder="Search archives...">' +
        '<div class="lp-sort-group">' +
            '<button class="lp-sort-btn" data-sort="name">Name</button>' +
            '<button class="lp-sort-btn active" data-sort="date">Date &#9660;</button>' +
            '<button class="lp-sort-btn" data-sort="size">Size</button>' +
        '</div>' +
        '<div class="lp-type-filters">' + typeFiltersHtml + '</div>';

    // Content area (where grid goes)
    const content = document.createElement('div');
    content.id = 'lp-content';

    // Spine
    const spine = document.createElement('div');
    spine.className = 'cp-spine';

    container.appendChild(spine);
    container.appendChild(header);
    container.appendChild(tabs);
    container.appendChild(filters);
    container.appendChild(content);

    return { contentArea: content, filtersEl: filters };
}

function wireEvents(
    container: HTMLElement,
    contentArea: HTMLElement,
    filtersEl: HTMLElement,
    collections: CollectionSummary[]
): void {
    // Tab switching
    const tabs = container.querySelectorAll('.lp-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = (tab as HTMLElement).dataset.tab as 'archives' | 'collections';
            activeTab = tabName;

            // Show/hide filters (only for archives tab)
            filtersEl.style.display = tabName === 'archives' ? '' : 'none';

            if (tabName === 'archives') {
                renderArchiveGrid(contentArea);
            } else {
                renderCollectionsGrid(contentArea, collections);
            }
        });
    });

    // Search
    let debounceTimer: ReturnType<typeof setTimeout>;
    const searchInput = filtersEl.querySelector('.lp-search') as HTMLInputElement;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                searchQuery = searchInput.value.trim();
                renderArchiveGrid(contentArea);
            }, 200);
        });
    }

    // Sort buttons
    const sortBtns = filtersEl.querySelectorAll('.lp-sort-btn');
    sortBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const field = (btn as HTMLElement).dataset.sort as SortField;
            if (sortField === field) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortField = field;
                sortDir = field === 'name' ? 'asc' : 'desc';
            }
            // Update active state and arrow
            sortBtns.forEach(b => {
                b.classList.remove('active');
                b.textContent = (b as HTMLElement).dataset.sort === 'name' ? 'Name'
                    : (b as HTMLElement).dataset.sort === 'date' ? 'Date'
                    : 'Size';
            });
            btn.classList.add('active');
            const arrow = sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
            btn.textContent = btn.textContent + arrow;
            renderArchiveGrid(contentArea);
        });
    });

    // Asset type filters
    const typePills = filtersEl.querySelectorAll('.lp-type-pill');
    typePills.forEach(pill => {
        pill.addEventListener('click', () => {
            const type = (pill as HTMLElement).dataset.type!;
            if (activeTypeFilters.has(type)) {
                activeTypeFilters.delete(type);
                pill.classList.remove('active');
            } else {
                activeTypeFilters.add(type);
                pill.classList.add('active');
            }
            renderArchiveGrid(contentArea);
        });
    });
}

// ── Public API ──

/**
 * Initialize the library page. Replaces the 3D viewport with a browsable library.
 * Returns true if library mode was detected and page was rendered.
 */
export async function initLibraryPage(): Promise<boolean> {
    const config = (window as unknown as { APP_CONFIG?: { library?: boolean } }).APP_CONFIG;
    if (!config?.library) return false;

    log.info('Initializing library page');
    injectBaseStyles();
    injectLibraryStyles();

    // Hide the app shell
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    let container = document.getElementById('library-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'library-container';
        container.className = 'cp-page';
        document.body.appendChild(container);
    }

    try {
        // Fetch both data sources in parallel
        const [archivesData, collections] = await Promise.all([
            fetchArchives(),
            fetchCollections(),
        ]);

        allArchives = archivesData.archives;
        log.info('Library loaded:', allArchives.length, 'archives,', collections.length, 'collections');

        const { contentArea, filtersEl } = renderPage(container, allArchives.length);
        renderArchiveGrid(contentArea);
        wireEvents(container, contentArea, filtersEl, collections);

        document.title = 'Library \u2014 Vitrine3D';
    } catch (err) {
        log.error('Failed to load library:', err);
        container.innerHTML =
            '<div class="cp-spine"></div>' +
            '<div class="cp-error"><p>' + escapeHtml('Failed to load library') + '</p></div>';
    }

    return true;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds. The module isn't imported yet so it won't be bundled, but TypeScript should compile it.

**Step 3: Commit**

```bash
git add src/modules/library-page.ts
git commit -m "feat: add library-page module with tabbed archives/collections view"
```

---

### Task 4: Wire library-page into kiosk boot sequence

**Files:**
- Modify: `src/kiosk-web.ts`

**Step 1: Add initLibraryPage import and call**

Replace the entire content of `src/kiosk-web.ts` with:

```ts
// Kiosk bundle entry point — imports viewer layer only.
// For the full editor, see src/editor/index.html → main.ts.
import { initLibraryPage } from './modules/library-page.js';
import { initCollectionPage } from './modules/collection-page.js';

// Check page modes in priority order:
// 1. Library browser (auth-gated, /library route)
// 2. Collection page (/collection/:slug)
// 3. Normal kiosk viewer
initLibraryPage().then(isLibrary => {
    if (isLibrary) return;
    return initCollectionPage().then(isCollection => {
        if (!isCollection) {
            // Normal kiosk viewer — lazy import to avoid loading viewer code for non-viewer pages
            import('./modules/kiosk-main.js').then(m => m.init());
        }
    });
});
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds. `library-page.ts` is now bundled into the kiosk entry point.

**Step 3: Commit**

```bash
git add src/kiosk-web.ts
git commit -m "feat: wire library page into kiosk boot sequence"
```

---

### Task 5: Add GET /library route to meta-server

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add handleLibraryPage function**

After the `handleAdminPage` function (around line 641), add:

```js
/**
 * GET /library — serve the library browser page.
 * Auth-gated like /admin. Injects __VITRINE_LIBRARY flag for client-side rendering.
 */
function handleLibraryPage(req, res) {
    if (!requireAuth(req, res)) return;

    const indexHtml = getIndexHtml();
    if (!indexHtml) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('index.html not found');
        return;
    }

    const injectTag = '<script>window.__VITRINE_LIBRARY=true;</script>\n';

    let html = indexHtml.replace(/<head>/i, '<head>\n<base href="/">');
    html = html.replace(/<script[\s>]/i, (m) => injectTag + m);

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(html);
}
```

**Step 2: Add route to admin block**

In the request handler (around line 1787), inside the `if (ADMIN_ENABLED)` block, after the `/admin` route check, add:

```js
if (pathname === '/library' && req.method === 'GET') {
    return handleLibraryPage(req, res);
}
```

**Step 3: Update the JSDoc comment at the top of the file**

In the route listing comment at the top (around line 15), add:

```
 *   GET  /library            → Library browser page (auth-gated, editorial card grid)
```

**Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat: add GET /library route to meta-server (CF Access gated)"
```

---

### Task 6: Add Tauri home screen

**Files:**
- Modify: `src/modules/kiosk-main.ts` (add home screen rendering)
- Modify: `src/kiosk-web.ts` (add home check)
- Modify: `src-tauri/tauri.conf.json` (change default URL)

**Step 1: Read kiosk-main.ts to find the right insertion point**

Check the beginning of the `init()` function in `src/modules/kiosk-main.ts` to understand its structure.

**Step 2: Create home screen module**

Create `src/modules/home-screen.ts`:

```ts
/**
 * Home Screen Module
 *
 * Tauri desktop home screen with "Browse Library" and "Open Local File" cards.
 * Editorial design language (navy + gold). Only shown when ?home=true.
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('home-screen');

const SERVER_URL = (import.meta as unknown as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL || '';

function injectStyles(): void {
    if (document.getElementById('home-screen-styles')) return;
    const style = document.createElement('style');
    style.id = 'home-screen-styles';
    style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;500;600;700&display=swap');

.hs-page {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #08182a;
    color: rgba(232, 236, 240, 0.95);
    font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
}

.hs-logo {
    height: 24px;
    margin-bottom: 40px;
    opacity: 0.8;
    filter: brightness(1.5) drop-shadow(0 1px 4px rgba(0,0,0,0.5));
}

.hs-title {
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0 0 8px;
    color: rgba(245, 245, 250, 0.95);
}

.hs-subtitle {
    font-size: 0.75rem;
    font-weight: 400;
    color: rgba(140, 160, 180, 0.7);
    margin: 0 0 40px;
}

.hs-cards {
    display: flex;
    gap: 20px;
}

.hs-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 220px;
    height: 160px;
    background: rgba(17, 48, 78, 0.5);
    border: 1px solid rgba(254, 192, 58, 0.1);
    cursor: pointer;
    transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
    text-decoration: none;
    color: inherit;
}

.hs-card:hover {
    border-color: rgba(254, 192, 58, 0.3);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    transform: translateY(-2px);
}

.hs-card-icon {
    margin-bottom: 16px;
    opacity: 0.7;
}

.hs-card:hover .hs-card-icon {
    opacity: 1;
}

.hs-card-label {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

.hs-card-desc {
    font-size: 0.62rem;
    color: rgba(140, 160, 180, 0.6);
    margin-top: 4px;
}

.hs-error {
    margin-top: 16px;
    font-size: 0.72rem;
    color: rgba(220, 80, 80, 0.8);
    display: none;
}
`;
    document.head.appendChild(style);
}

// SVG icons
const LIBRARY_ICON = '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="#FEC03A" stroke-width="1.2"><rect x="5" y="6" width="7" height="24" rx="1"/><rect x="14.5" y="6" width="7" height="24" rx="1"/><rect x="24" y="6" width="7" height="24" rx="1"/></svg>';
const FILE_ICON = '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="#FEC03A" stroke-width="1.2"><path d="M10 4h12l8 8v20H10V4z"/><path d="M22 4v8h8"/><circle cx="18" cy="22" r="4"/></svg>';

/**
 * Initialize the home screen. Returns true if home mode was detected.
 */
export async function initHomeScreen(): Promise<boolean> {
    const config = (window as unknown as { APP_CONFIG?: { home?: boolean } }).APP_CONFIG;
    if (!config?.home) return false;

    log.info('Initializing home screen');
    injectStyles();

    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    const container = document.createElement('div');
    container.className = 'hs-page';
    document.body.appendChild(container);

    const logoSrc = '/themes/editorial/logo.png';

    let cardsHtml = '';

    // Browse Library card (only if server URL is configured)
    if (SERVER_URL) {
        cardsHtml += `
            <a class="hs-card" id="hs-library" href="${SERVER_URL}/library">
                <div class="hs-card-icon">${LIBRARY_ICON}</div>
                <div class="hs-card-label">Browse Library</div>
                <div class="hs-card-desc">Connect to server</div>
            </a>`;
    }

    // Open Local File card
    cardsHtml += `
        <button class="hs-card" id="hs-local-file">
            <div class="hs-card-icon">${FILE_ICON}</div>
            <div class="hs-card-label">Open Local File</div>
            <div class="hs-card-desc">.a3d / .a3z archive</div>
        </button>`;

    container.innerHTML =
        '<img class="hs-logo" src="' + logoSrc + '" alt="Vitrine3D" onerror="this.style.display=\'none\'">' +
        '<h1 class="hs-title">Vitrine3D</h1>' +
        '<p class="hs-subtitle">3D Archive Viewer</p>' +
        '<div class="hs-cards">' + cardsHtml + '</div>' +
        '<p class="hs-error" id="hs-error"></p>';

    // Wire local file button
    const localBtn = document.getElementById('hs-local-file');
    if (localBtn) {
        localBtn.addEventListener('click', async () => {
            try {
                // Check for Tauri native dialog
                if ((window as unknown as { __TAURI__?: unknown }).__TAURI__) {
                    const { open } = await import('@tauri-apps/plugin-dialog');
                    const file = await open({
                        filters: [{ name: 'Archives', extensions: ['a3d', 'a3z'] }],
                        multiple: false,
                    });
                    if (file) {
                        // Navigate to kiosk viewer with the file path
                        // The kiosk-main will handle Tauri IPC loading
                        window.location.href = 'index.html?kiosk=true&theme=editorial&tauriFile=' + encodeURIComponent(file as string);
                    }
                } else {
                    // Browser fallback — file input
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.a3d,.a3z';
                    input.addEventListener('change', () => {
                        if (input.files && input.files[0]) {
                            // Store file reference and navigate to viewer
                            // This path is unlikely in Tauri but provides a fallback
                            window.location.href = 'index.html?kiosk=true&theme=editorial';
                        }
                    });
                    input.click();
                }
            } catch (err) {
                const errorEl = document.getElementById('hs-error');
                if (errorEl) {
                    errorEl.textContent = 'Failed to open file dialog';
                    errorEl.style.display = 'block';
                }
                log.error('File dialog error:', err);
            }
        });
    }

    return true;
}
```

**Step 3: Wire home screen into kiosk-web.ts**

Update `src/kiosk-web.ts`:

```ts
// Kiosk bundle entry point — imports viewer layer only.
// For the full editor, see src/editor/index.html → main.ts.
import { initHomeScreen } from './modules/home-screen.js';
import { initLibraryPage } from './modules/library-page.js';
import { initCollectionPage } from './modules/collection-page.js';

// Check page modes in priority order:
// 1. Home screen (Tauri desktop launcher, ?home=true)
// 2. Library browser (auth-gated, /library route)
// 3. Collection page (/collection/:slug)
// 4. Normal kiosk viewer
initHomeScreen().then(isHome => {
    if (isHome) return;
    return initLibraryPage().then(isLibrary => {
        if (isLibrary) return;
        return initCollectionPage().then(isCollection => {
            if (!isCollection) {
                import('./modules/kiosk-main.js').then(m => m.init());
            }
        });
    });
});
```

**Step 4: Update tauri.conf.json**

Change the window URL and devUrl to use `?home=true`:

In `src-tauri/tauri.conf.json`:
- Line 8: change `"devUrl": "http://localhost:8080/?kiosk=true&theme=editorial"` to `"devUrl": "http://localhost:8080/?home=true&kiosk=true&theme=editorial"`
- Line 17: change `"url": "index.html?kiosk=true&theme=editorial"` to `"url": "index.html?home=true&kiosk=true&theme=editorial"`

**Step 5: Update Tauri CSP to allow server URL connections**

In `src-tauri/tauri.conf.json`, the `connect-src` CSP needs to allow HTTPS connections to the configured server. The current value already includes `https:` in `src/index.html`'s CSP (line 21: `connect-src 'self' https: blob: data:`) but the Tauri CSP (line 36) is more restrictive. Add `https:` to the Tauri CSP connect-src:

Change line 36 from:
```json
"connect-src": "'self' blob: data: ipc: http://ipc.localhost asset: https://asset.localhost"
```
to:
```json
"connect-src": "'self' blob: data: ipc: http://ipc.localhost asset: https://asset.localhost https:"
```

**Step 6: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add src/modules/home-screen.ts src/kiosk-web.ts src-tauri/tauri.conf.json
git commit -m "feat: add Tauri home screen with Browse Library and Open Local File"
```

---

### Task 7: Verify end-to-end

**Files:** None (verification only)

**Step 1: Run lint**

Run: `npm run lint`
Expected: 0 errors.

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (existing tests, no new test-worthy logic — this is UI rendering code).

**Step 3: Run build**

Run: `npm run build`
Expected: Clean build. Both kiosk and editor bundles produced.

**Step 4: Verify dev server**

Run: `npm run dev`
Visit `http://localhost:8080/?home=true` — should show the home screen (only "Open Local File" card since no VITE_SERVER_URL).
Visit `http://localhost:8080/?kiosk=true&theme=editorial` — should show normal kiosk viewer (existing behavior unchanged).

**Step 5: Commit any fixes, then final commit**

If any lint/build issues were found and fixed, commit those fixes.
