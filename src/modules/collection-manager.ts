/**
 * Collection Manager Module
 *
 * Manages collections in the editor library panel.
 * Handles sidebar rendering, collection CRUD, archive membership,
 * and collection chip display in the archive detail pane.
 */

import { Logger, notify, escapeHtml } from './utilities.js';
import type { Collection } from '../types.js';

const log = Logger.getLogger('collection-manager');

// ── Types ──

interface CollectionWithArchives extends Collection {
    archives?: { hash: string; thumbnail: string | null }[];
}

// ── State ──

let _initialized = false;
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

// ── Collection detail panel state ──

let detailPanel: HTMLElement | null = null;
let collectionDetailEl: HTMLElement | null = null;
let editingCollection: (Collection & { archives?: { hash: string; thumbnail: string | null }[] }) | null = null;
let isManualThumb = false;

// ── API ──

function headers(): Record<string, string> {
    const h = authHeadersGetter ? authHeadersGetter() : {};
    if (_csrfTokenGetter) {
        const token = _csrfTokenGetter();
        if (token) h['x-csrf-token'] = token;
    }
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
    const res = await apiFetch('/api/collections/' + slug + '?action=add-archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes }),
    });
    if (!res.ok) throw new Error('Failed to add to collection');
}

async function removeFromCollection(slug: string, hash: string): Promise<void> {
    const res = await apiFetch('/api/collections/' + slug + '?action=remove-archive&hash=' + encodeURIComponent(hash), {
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
            '<span class="collection-sidebar-actions">' +
                '<span class="collection-sidebar-share" title="Copy collection link" data-slug="' + coll.slug + '">' +
                    '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 10l4-4"/><circle cx="4.5" cy="11.5" r="2"/><circle cx="11.5" cy="4.5" r="2"/></svg>' +
                '</span>' +
                '<span class="collection-sidebar-count">' + coll.archiveCount + '</span>' +
            '</span>';
        btn.addEventListener('click', () => setActiveCollection(coll.slug));
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            handleDeleteCollection(coll);
        });
        // Wire share button
        const shareBtn = btn.querySelector('.collection-sidebar-share') as HTMLElement;
        if (shareBtn) {
            shareBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const url = window.location.origin + '/collection/' + coll.slug;
                navigator.clipboard.writeText(url).then(() => {
                    notify.success('Collection link copied');
                }).catch(() => {
                    notify.info(url);
                });
            });
        }
        sidebarList.appendChild(btn);
    }
}

function createCollectionDetailPanel(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'collection-detail-panel';
    el.className = 'hidden';
    el.innerHTML = `
        <div class="prop-section open">
            <div class="prop-section-hd">
                <span class="prop-section-title">Collection</span>
                <span class="prop-section-chevron">&#9654;</span>
            </div>
            <div class="prop-section-body">
                <div class="prop-row" style="flex-direction:column;align-items:stretch;">
                    <label class="prop-row-label" style="margin-bottom:4px;">Name</label>
                    <input type="text" id="collection-edit-name" class="collection-field-input" placeholder="Collection name" />
                </div>
                <div class="prop-row" style="flex-direction:column;align-items:stretch;margin-top:8px;">
                    <label class="prop-row-label" style="margin-bottom:4px;">Description</label>
                    <textarea id="collection-edit-desc" class="collection-field-textarea" rows="3" placeholder="Collection summary..."></textarea>
                </div>
            </div>
        </div>
        <div class="prop-section open">
            <div class="prop-section-hd">
                <span class="prop-section-title">Preview Image</span>
                <span class="prop-section-chevron">&#9654;</span>
            </div>
            <div class="prop-section-body">
                <div id="collection-thumb-preview" class="collection-thumb-preview">
                    <img id="collection-thumb-img" src="" alt="" />
                    <div id="collection-thumb-placeholder" class="collection-thumb-placeholder">No image</div>
                </div>
                <div class="collection-thumb-actions">
                    <button id="collection-thumb-upload" class="prop-btn small" type="button">Upload</button>
                    <button id="collection-thumb-pick" class="prop-btn small" type="button">From Archives</button>
                    <button id="collection-thumb-generate" class="prop-btn small" type="button">Auto-generate</button>
                </div>
                <div id="collection-thumb-reset" class="collection-thumb-reset hidden">
                    <a href="#" id="collection-thumb-reset-link">Reset to auto-generated</a>
                </div>
                <div id="collection-archive-thumbs" class="collection-archive-thumbs hidden">
                    <div class="prop-row-label" style="margin-bottom:6px;">Pick an archive thumbnail</div>
                    <div id="collection-archive-thumb-grid" class="collection-archive-thumb-grid"></div>
                </div>
                <input type="file" id="collection-thumb-file" accept="image/*" style="display:none" />
            </div>
        </div>
        <div class="prop-section open">
            <div class="prop-section-body" style="padding-top:8px;">
                <button id="collection-delete-btn" class="prop-btn danger" type="button">Delete Collection</button>
                <button id="collection-save-btn" class="prop-btn accent" type="button" style="margin-top:24px;">Save Changes</button>
            </div>
        </div>
    `;
    return el;
}

async function showCollectionDetail(slug: string): Promise<void> {
    if (!collectionDetailEl || !detailPanel) return;
    try {
        const res = await apiFetch(`/api/collections/${slug}`);
        if (!res.ok) throw new Error(`Failed to fetch collection: ${res.status}`);
        const data = await res.json();
        editingCollection = data;

        const nameInput = document.getElementById('collection-edit-name') as HTMLInputElement;
        const descInput = document.getElementById('collection-edit-desc') as HTMLTextAreaElement;
        const thumbImg = document.getElementById('collection-thumb-img') as HTMLImageElement;
        const thumbPlaceholder = document.getElementById('collection-thumb-placeholder') as HTMLElement;
        const resetEl = document.getElementById('collection-thumb-reset') as HTMLElement;

        if (nameInput) nameInput.value = data.name || '';
        if (descInput) descInput.value = data.description || '';

        isManualThumb = !!(data.thumbnail && data.thumbnail.includes(`collection-${slug}.jpg`) && !data.thumbnail.includes('-auto'));

        if (data.thumbnail) {
            if (thumbImg) { thumbImg.src = data.thumbnail; thumbImg.style.display = ''; }
            if (thumbPlaceholder) thumbPlaceholder.style.display = 'none';
        } else {
            if (thumbImg) thumbImg.style.display = 'none';
            if (thumbPlaceholder) thumbPlaceholder.style.display = '';
        }

        if (resetEl) resetEl.classList.toggle('hidden', !isManualThumb);

        detailPanel.classList.add('hidden');
        collectionDetailEl.classList.remove('hidden');

        const archiveThumbsEl = document.getElementById('collection-archive-thumbs');
        if (archiveThumbsEl) archiveThumbsEl.classList.add('hidden');
    } catch (err) {
        log.error('Failed to load collection detail:', err);
        notify.error('Failed to load collection details');
    }
}

function hideCollectionDetail(): void {
    if (collectionDetailEl) collectionDetailEl.classList.add('hidden');
    if (detailPanel) detailPanel.classList.remove('hidden');
    editingCollection = null;
}

function wireCollectionDetailEvents(): void {
    const deleteBtn = document.getElementById('collection-delete-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', handleDeleteFromDetail);

    const saveBtn = document.getElementById('collection-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', handleSaveCollection);

    const uploadBtn = document.getElementById('collection-thumb-upload');
    const fileInput = document.getElementById('collection-thumb-file') as HTMLInputElement;
    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleThumbFileSelected);
    }

    const pickBtn = document.getElementById('collection-thumb-pick');
    if (pickBtn) pickBtn.addEventListener('click', handleShowArchiveThumbs);

    const genBtn = document.getElementById('collection-thumb-generate');
    if (genBtn) genBtn.addEventListener('click', handleGenerateMosaic);

    const resetLink = document.getElementById('collection-thumb-reset-link');
    if (resetLink) resetLink.addEventListener('click', (e) => {
        e.preventDefault();
        handleResetThumb();
    });
}

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

async function handleThumbFileSelected(): Promise<void> {
    if (!editingCollection) return;
    const fileInput = document.getElementById('collection-thumb-file') as HTMLInputElement;
    if (!fileInput?.files?.length) return;

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file, file.name);

    try {
        const headers: Record<string, string> = authHeadersGetter ? authHeadersGetter() : {};
        if (_csrfTokenGetter) {
            const token = _csrfTokenGetter();
            if (token) headers['x-csrf-token'] = token;
        }
        const res = await fetch(`/api/collections/${editingCollection.slug}?action=upload-thumbnail`, {
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

function handleShowArchiveThumbs(): void {
    if (!editingCollection?.archives) return;
    const container = document.getElementById('collection-archive-thumbs');
    const grid = document.getElementById('collection-archive-thumb-grid');
    if (!container || !grid) return;

    grid.innerHTML = '';
    const archivesWithThumbs = editingCollection.archives.filter(a => a.thumbnail);

    if (archivesWithThumbs.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-muted); font-size: 11px;">No archive thumbnails available</p>';
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

async function handleGenerateMosaic(): Promise<void> {
    if (!editingCollection) return;
    try {
        const res = await apiFetch(`/api/collections/${editingCollection.slug}?action=generate-thumbnail`, { method: 'POST' });
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
        const res = await apiFetch(`/api/collections/${editingCollection.slug}?action=delete-thumbnail`, { method: 'DELETE' });
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

// ── Actions ──

function setActiveCollection(slug: string): void {
    activeSlug = slug;
    renderSidebar();
    if (onFilterChange) onFilterChange(slug);
    if (slug) {
        showCollectionDetail(slug);
    } else {
        hideCollectionDetail();
    }
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

async function handleDeleteFromDetail(): Promise<void> {
    if (!editingCollection) return;
    await handleDeleteCollection(editingCollection);
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
    if (_initialized) {
        log.warn('Collection manager already initialized — skipping duplicate init');
        return;
    }
    _initialized = true;
    authHeadersGetter = config.getAuthHeaders;
    _csrfTokenGetter = config.getCsrfToken;
    onFilterChange = config.onFilterChange;

    sidebarList = document.getElementById('collection-sidebar-list');
    addBtn = document.getElementById('collection-sidebar-add');
    chipsContainer = document.getElementById('library-collection-chips');
    addSelect = document.getElementById('library-add-to-collection') as HTMLSelectElement | null;

    detailPanel = document.getElementById('library-detail');
    if (detailPanel) {
        collectionDetailEl = createCollectionDetailPanel();
        detailPanel.parentElement?.appendChild(collectionDetailEl);
        wireCollectionDetailEvents();
    }

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
export { refreshCollections, hideCollectionDetail };
