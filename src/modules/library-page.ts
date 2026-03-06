/**
 * Library Page Module
 *
 * Full-page editorial-themed browser with two tabs: "All Archives" and "Collections".
 * Activated when window.APP_CONFIG.library === true (set by server injection).
 * Reuses shared helpers from collection-page.ts.
 */

import { Logger } from './utilities.js';
import { cfAuthFetch } from './tauri-auth.js';
import {
    escapeHtml,
    ASSET_LABELS,
    injectStyles as injectBaseStyles,
    getLogoSrc,
    renderCard,
} from './collection-page.js';
import type { CollectionArchive } from './collection-page.js';

const log = Logger.getLogger('library-page');

// ── Types ──

interface ArchivesResponse {
    archives: CollectionArchive[];
    storageUsed: number;
}

interface CollectionItem {
    id: number;
    slug: string;
    name: string;
    description: string;
    thumbnail: string | null;
    theme: string | null;
    archiveCount: number;
}

type SortField = 'name' | 'date' | 'size';
type SortDir = 'asc' | 'desc';
type TabId = 'archives' | 'collections';

// ── Module state ──

let allArchives: CollectionArchive[] = [];
let allCollections: CollectionItem[] = [];
let searchQuery = '';
let sortField: SortField = 'date';
let sortDir: SortDir = 'desc';
const activeTypeFilters: Set<string> = new Set();
let _activeTab: TabId = 'archives';
let _onArchiveSelect: ((archive: CollectionArchive) => void) | null = null;

// DOM refs
let gridEl: HTMLElement | null = null;
let filterBarEl: HTMLElement | null = null;
let _searchInputEl: HTMLInputElement | null = null;
let countEl: HTMLElement | null = null;
let collGridEl: HTMLElement | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Fetch ──

async function fetchArchives(): Promise<ArchivesResponse> {
    const res = await cfAuthFetch('/api/archives');
    if (!res.ok) throw new Error('Failed to fetch archives (' + res.status + ')');
    return res.json();
}

async function fetchCollections(): Promise<CollectionItem[]> {
    const res = await cfAuthFetch('/api/collections');
    if (!res.ok) throw new Error('Failed to fetch collections (' + res.status + ')');
    return res.json();
}

// ── Inject Styles ──

function injectLibraryStyles(): void {
    if (document.getElementById('library-page-styles')) return;
    const style = document.createElement('style');
    style.id = 'library-page-styles';
    style.textContent = `
/* ── Tabs ── */
.lp-tabs {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 48px;
    display: flex;
    gap: 0;
    border-bottom: 1px solid rgba(254, 192, 58, 0.1);
    animation: cpFadeIn 0.4s ease-out 0.3s both;
}

.lp-tab {
    position: relative;
    background: none;
    border: none;
    color: rgba(140, 160, 180, 0.7);
    font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 16px 20px 14px;
    cursor: pointer;
    transition: color 0.2s ease;
    outline: none;
}

.lp-tab:hover {
    color: rgba(232, 236, 240, 0.9);
}

.lp-tab.active {
    color: rgba(232, 236, 240, 0.97);
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

/* ── Filter bar ── */
.lp-filters {
    max-width: 960px;
    margin: 0 auto;
    padding: 20px 48px 0;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    animation: cpFadeIn 0.4s ease-out 0.35s both;
}

.lp-filters.hidden {
    display: none;
}

.lp-search {
    flex: 1;
    min-width: 180px;
    max-width: 280px;
    background: rgba(17, 48, 78, 0.5);
    border: 1px solid rgba(254, 192, 58, 0.12);
    color: rgba(232, 236, 240, 0.95);
    font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 0.78rem;
    padding: 7px 12px;
    outline: none;
    transition: border-color 0.2s ease;
}

.lp-search::placeholder {
    color: rgba(140, 160, 180, 0.45);
}

.lp-search:focus {
    border-color: rgba(254, 192, 58, 0.3);
}

.lp-sort-group {
    display: flex;
    gap: 4px;
}

.lp-sort-btn {
    background: rgba(17, 48, 78, 0.4);
    border: 1px solid rgba(254, 192, 58, 0.1);
    color: rgba(140, 160, 180, 0.7);
    font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 6px 10px;
    cursor: pointer;
    transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;
    outline: none;
}

.lp-sort-btn:hover {
    color: rgba(232, 236, 240, 0.9);
    border-color: rgba(254, 192, 58, 0.2);
}

.lp-sort-btn.active {
    color: #FEC03A;
    border-color: rgba(254, 192, 58, 0.35);
    background: rgba(254, 192, 58, 0.06);
}

.lp-type-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.lp-type-pill {
    background: rgba(17, 48, 78, 0.4);
    border: 1px solid rgba(254, 192, 58, 0.1);
    color: rgba(140, 160, 180, 0.7);
    font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 5px 10px;
    cursor: pointer;
    transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;
    outline: none;
}

.lp-type-pill:hover {
    color: rgba(232, 236, 240, 0.9);
    border-color: rgba(254, 192, 58, 0.22);
}

.lp-type-pill.active {
    color: #08182a;
    background: #FEC03A;
    border-color: #FEC03A;
}

/* ── Empty state ── */
.lp-empty {
    max-width: 960px;
    margin: 0 auto;
    padding: 80px 48px;
    text-align: center;
    animation: cpFadeIn 0.4s ease-out 0.1s both;
}

.lp-empty p {
    font-size: 0.85rem;
    color: rgba(140, 160, 180, 0.55);
    letter-spacing: 0.02em;
}

/* ── Collection cards ── */
.lp-coll-grid {
    max-width: 960px;
    margin: 0 auto;
    padding: 40px 48px 48px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 24px;
}

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

.lp-coll-card:hover .lp-coll-thumb img {
    transform: scale(1.03);
}

.lp-coll-thumb {
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: rgba(8, 24, 42, 0.8);
    position: relative;
}

.lp-coll-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.4s ease;
}

.lp-coll-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(17, 48, 78, 0.5), rgba(8, 24, 42, 0.8));
}

.lp-coll-body {
    padding: 14px 16px 16px;
    border-top: 1px solid rgba(254, 192, 58, 0.1);
}

.lp-coll-name {
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: rgba(232, 236, 240, 0.95);
    margin-bottom: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.lp-coll-desc {
    font-size: 0.72rem;
    font-weight: 400;
    line-height: 1.5;
    color: rgba(170, 185, 200, 0.75);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 8px;
}

.lp-coll-meta {
    font-size: 0.6rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(140, 160, 180, 0.55);
}

/* ── Responsive ── */
@media (max-width: 768px) {
    .lp-tabs { padding: 0 24px; }
    .lp-filters { padding: 16px 24px 0; }
    .lp-coll-grid {
        padding: 32px 24px 32px;
        gap: 16px;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    }
}

@media (max-width: 480px) {
    .lp-tabs { padding: 0 16px; }
    .lp-filters { padding: 12px 16px 0; }
    .lp-coll-grid {
        padding: 24px 16px 24px;
        grid-template-columns: 1fr;
    }
}
`;
    document.head.appendChild(style);
}

// ── Filtering & Sorting ──

function getFilteredArchives(): CollectionArchive[] {
    let result = allArchives.slice();

    // Text filter
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        result = result.filter(a =>
            (a.title || a.filename).toLowerCase().includes(q) ||
            a.filename.toLowerCase().includes(q),
        );
    }

    // Asset type filter (OR)
    if (activeTypeFilters.size > 0) {
        result = result.filter(a => {
            if (!a.assets || a.assets.length === 0) return false;
            return a.assets.some(asset => activeTypeFilters.has(asset.type));
        });
    }

    // Sort
    result.sort((a, b) => {
        let cmp = 0;
        if (sortField === 'name') {
            cmp = (a.title || a.filename).localeCompare(b.title || b.filename);
        } else if (sortField === 'date') {
            cmp = new Date(a.modified || 0).getTime() - new Date(b.modified || 0).getTime();
        } else if (sortField === 'size') {
            cmp = a.size - b.size;
        }
        return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
}

function getUniqueTypes(): string[] {
    const types = new Set<string>();
    for (const archive of allArchives) {
        if (archive.assets) {
            for (const asset of archive.assets) {
                types.add(asset.type);
            }
        }
    }
    // Sort by label for consistency
    return [...types].sort((a, b) =>
        (ASSET_LABELS[a] || a).localeCompare(ASSET_LABELS[b] || b),
    );
}

// ── Render helpers ──

function renderTypeFilterPills(container: HTMLElement): void {
    const pillsEl = container.querySelector('.lp-type-filters');
    if (!pillsEl) return;
    pillsEl.innerHTML = '';
    const types = getUniqueTypes();
    for (const type of types) {
        const btn = document.createElement('button');
        btn.className = 'lp-type-pill' + (activeTypeFilters.has(type) ? ' active' : '');
        btn.textContent = ASSET_LABELS[type] || type;
        btn.dataset.type = type;
        btn.addEventListener('click', () => {
            if (activeTypeFilters.has(type)) {
                activeTypeFilters.delete(type);
                btn.classList.remove('active');
            } else {
                activeTypeFilters.add(type);
                btn.classList.add('active');
            }
            refreshArchiveGrid();
        });
        pillsEl.appendChild(btn);
    }
}

function renderSortButtons(container: HTMLElement): void {
    const SORT_OPTIONS: { field: SortField; label: string }[] = [
        { field: 'name', label: 'Name' },
        { field: 'date', label: 'Date' },
        { field: 'size', label: 'Size' },
    ];

    const group = container.querySelector('.lp-sort-group');
    if (!group) return;
    group.innerHTML = '';

    for (const opt of SORT_OPTIONS) {
        const btn = document.createElement('button');
        const isActive = sortField === opt.field;
        const arrow = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
        btn.className = 'lp-sort-btn' + (isActive ? ' active' : '');
        btn.textContent = opt.label + arrow;
        btn.dataset.field = opt.field;
        btn.addEventListener('click', () => {
            if (sortField === opt.field) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortField = opt.field;
                sortDir = opt.field === 'date' ? 'desc' : 'asc';
            }
            renderSortButtons(container);
            refreshArchiveGrid();
        });
        group.appendChild(btn);
    }
}

function refreshArchiveGrid(): void {
    if (!gridEl) return;
    const filtered = getFilteredArchives();

    if (filtered.length === 0) {
        gridEl.innerHTML = '<div class="lp-empty"><p>' +
            (searchQuery || activeTypeFilters.size > 0 ? 'No archives match your filters.' : 'No archives yet.') +
            '</p></div>';
    } else {
        gridEl.innerHTML = '';
        filtered.forEach((archive, i) => {
            gridEl!.appendChild(renderCard(archive, i, _onArchiveSelect || undefined));
        });
    }

    if (countEl) {
        const total = allArchives.length;
        const shown = filtered.length;
        if (shown !== total) {
            countEl.textContent = shown + ' of ' + total + ' Archive' + (total !== 1 ? 's' : '');
        } else {
            countEl.textContent = total + ' Archive' + (total !== 1 ? 's' : '');
        }
    }
}

function renderCollectionCard(coll: CollectionItem, index: number): HTMLElement {
    const card = document.createElement('a');
    card.className = 'lp-coll-card';
    card.href = '/collection/' + encodeURIComponent(coll.slug);
    card.style.animationDelay = (0.15 + index * 0.06) + 's';

    const thumbHtml = coll.thumbnail
        ? '<img src="' + escapeHtml(coll.thumbnail) + '" alt="" loading="lazy">'
        : '<div class="lp-coll-placeholder"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="rgba(254,192,58,0.2)" stroke-width="0.8"><rect x="4" y="8" width="24" height="18" rx="1"/><path d="M8 8V6a1 1 0 011-1h14a1 1 0 011 1v2"/></svg></div>';

    const descHtml = coll.description
        ? '<p class="lp-coll-desc">' + escapeHtml(coll.description) + '</p>'
        : '';

    const countText = coll.archiveCount + ' Archive' + (coll.archiveCount !== 1 ? 's' : '');

    card.innerHTML =
        '<div class="lp-coll-thumb">' + thumbHtml + '</div>' +
        '<div class="lp-coll-body">' +
            '<div class="lp-coll-name">' + escapeHtml(coll.name) + '</div>' +
            descHtml +
            '<div class="lp-coll-meta">' + escapeHtml(countText) + '</div>' +
        '</div>';

    return card;
}

function renderCollectionGrid(): void {
    if (!collGridEl) return;

    if (allCollections.length === 0) {
        collGridEl.innerHTML = '<div class="lp-empty"><p>No collections yet.</p></div>';
        return;
    }

    collGridEl.innerHTML = '';
    allCollections.forEach((coll, i) => {
        collGridEl!.appendChild(renderCollectionCard(coll, i));
    });
}

// ── Tab switching ──

function switchTab(tab: TabId): void {
    _activeTab = tab;

    // Update tab buttons
    document.querySelectorAll('.lp-tab').forEach(el => {
        const btn = el as HTMLElement;
        if (btn.dataset.tab === tab) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Show/hide filter bar
    if (filterBarEl) {
        if (tab === 'archives') {
            filterBarEl.classList.remove('hidden');
        } else {
            filterBarEl.classList.add('hidden');
        }
    }

    // Show/hide grids
    if (gridEl) gridEl.style.display = tab === 'archives' ? '' : 'none';
    if (collGridEl) collGridEl.style.display = tab === 'collections' ? '' : 'none';
}

// ── Page construction ──

function buildPage(container: HTMLElement, archivesData: ArchivesResponse, collectionsData: CollectionItem[]): void {
    allArchives = archivesData.archives;
    allCollections = collectionsData;

    const logoSrc = getLogoSrc();
    const totalArchives = allArchives.length;

    // Gold spine
    const spine = document.createElement('div');
    spine.className = 'cp-spine';
    container.appendChild(spine);

    // Header
    const header = document.createElement('div');
    header.className = 'cp-header';
    header.innerHTML =
        '<img class="cp-logo" src="' + logoSrc + '" alt="" onerror="this.style.display=\'none\'">' +
        '<div class="cp-eyebrow">Library</div>' +
        '<h1 class="cp-title">Archive Library</h1>' +
        '<div class="cp-rule"></div>' +
        '<span class="cp-count lp-count">' + totalArchives + ' Archive' + (totalArchives !== 1 ? 's' : '') + '</span>';
    container.appendChild(header);
    countEl = header.querySelector('.lp-count');

    // Tab bar
    const tabs = document.createElement('div');
    tabs.className = 'lp-tabs';
    tabs.innerHTML =
        '<button class="lp-tab active" data-tab="archives">All Archives</button>' +
        '<button class="lp-tab" data-tab="collections">Collections</button>';
    tabs.querySelectorAll('.lp-tab').forEach(el => {
        (el as HTMLButtonElement).addEventListener('click', () => {
            switchTab((el as HTMLButtonElement).dataset.tab as TabId);
        });
    });
    container.appendChild(tabs);

    // Filter bar (archives tab only)
    const filterBar = document.createElement('div');
    filterBar.className = 'lp-filters';
    filterBar.innerHTML =
        '<input class="lp-search" type="search" placeholder="Search archives…" autocomplete="off">' +
        '<div class="lp-sort-group"></div>' +
        '<div class="lp-type-filters"></div>';
    container.appendChild(filterBar);
    filterBarEl = filterBar;

    // Wire search input
    const searchInput = filterBar.querySelector('.lp-search') as HTMLInputElement;
    _searchInputEl = searchInput;
    searchInput.addEventListener('input', () => {
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchQuery = searchInput.value.trim();
            refreshArchiveGrid();
        }, 200);
    });

    // Render sort buttons and type pills
    renderSortButtons(filterBar);
    renderTypeFilterPills(filterBar);

    // Archives grid
    const archiveGrid = document.createElement('div');
    archiveGrid.className = 'cp-grid';
    container.appendChild(archiveGrid);
    gridEl = archiveGrid;

    // Collections grid (hidden initially)
    const collGrid = document.createElement('div');
    collGrid.className = 'lp-coll-grid';
    collGrid.style.display = 'none';
    container.appendChild(collGrid);
    collGridEl = collGrid;

    // Initial renders
    refreshArchiveGrid();
    renderCollectionGrid();
}

// ── Public API ──

export type { CollectionArchive } from './collection-page.js';

/** Set a callback invoked when the user clicks an archive card (used by Tauri kiosk). */
export function setOnArchiveSelect(cb: (archive: CollectionArchive) => void): void {
    _onArchiveSelect = cb;
}

/**
 * Initialize the library page. Returns true if APP_CONFIG.library is set and the page was rendered.
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
        const [archivesData, collectionsData] = await Promise.all([
            fetchArchives(),
            fetchCollections(),
        ]);

        buildPage(container, archivesData, collectionsData);
        document.title = 'Archive Library \u2014 ' + (document.title || 'Vitrine3D');
        log.info(
            'Library loaded:',
            archivesData.archives.length + ' archives,',
            collectionsData.length + ' collections',
        );
    } catch (err) {
        log.error('Failed to load library:', err);
        // Render a minimal error state inside the container
        const spine = document.createElement('div');
        spine.className = 'cp-spine';
        container.appendChild(spine);
        const errEl = document.createElement('div');
        errEl.className = 'lp-empty';
        errEl.innerHTML = '<p>Failed to load library. Please try refreshing.</p>';
        container.appendChild(errEl);
    }

    return true;
}
