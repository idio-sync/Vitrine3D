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
let _csrfTokenGetter: (() => string | null) | null = null;
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
                const updated = await fetchArchiveCollections(hash);
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
    _csrfTokenGetter = config.getCsrfToken;
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
