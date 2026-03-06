/**
 * Library Panel Module
 *
 * Archive management integrated into the main viewer.
 * Renders a gallery of archives in the viewport area when Library mode is active.
 * Communicates with the /api/archives REST API (available when ADMIN_ENABLED=true in Docker).
 */

import { Logger, notify } from './utilities.js';
import { activateTool } from './ui-controller.js';
import { initCollectionManager, getActiveCollectionArchives, updateChipsForArchive } from './collection-manager.js';

const log = Logger.getLogger('library-panel');

// ── Types ──

interface ArchiveAsset {
    key: string;
    type: string;       // splat, mesh, pointcloud, cad, drawing
    format: string;     // file extension
    size_bytes: number;
}

interface Archive {
    hash: string;
    uuid?: string;
    filename: string;
    path: string;
    title: string;
    size: number;
    modified: string;
    thumbnail: string | null;
    viewerUrl: string;
    assets?: ArchiveAsset[];
    metadataFields?: Record<string, boolean | number | string>;
}

interface ArchiveListResponse {
    archives: Archive[];
    storageUsed: number;
}

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

// ── State ──

let archives: Archive[] = [];
let currentSort = 'name';
let currentDir: 'asc' | 'desc' = 'asc';
let selectedHash: string | null = null;
let initialized = false;
let authCredentials: string | null = null;
let hasFetched = false;
let searchQuery = '';
let activeCollectionHashes: string[] | null = null;
let uploadQueue: File[] = [];
let uploading = false;
let csrfToken: string | null = null;
const mediaCache = new Map<string, MediaItem[]>();
let mediaPollTimers: number[] = [];

const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB — safely under Cloudflare's 100 MB request limit
const CHUNK_CONCURRENCY = 3;          // parallel in-flight chunk uploads

// ── DOM refs (cached on init) ──

let gallery: HTMLElement | null = null;
let emptyState: HTMLElement | null = null;
let authPanel: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let storageBar: HTMLElement | null = null;
let storageFill: HTMLElement | null = null;
let storageText: HTMLElement | null = null;
let uploadZone: HTMLElement | null = null;
let fileInput: HTMLInputElement | null = null;
let progressFill: HTMLElement | null = null;
let progressPct: HTMLElement | null = null;
let progressName: HTMLElement | null = null;

// Detail pane refs
let detailPanel: HTMLElement | null = null;
let detailEmpty: HTMLElement | null = null;
let detailThumb: HTMLElement | null = null;
let detailTitle: HTMLElement | null = null;
let detailFilename: HTMLElement | null = null;
let detailSize: HTMLElement | null = null;
let detailDate: HTMLElement | null = null;
let detailAssets: HTMLElement | null = null;
let detailAssetsSection: HTMLElement | null = null;
let detailMetadata: HTMLElement | null = null;
let detailMetadataSection: HTMLElement | null = null;
let recordingsSection: HTMLElement | null = null;
let recordingsBody: HTMLElement | null = null;

// ── Helpers ──

function formatBytes(b: number): string {
    if (b === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return (b / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000) return 'Today';
    if (diff < 172800000) return 'Yesterday';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ── API ──

function authHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    if (authCredentials) h['Authorization'] = 'Basic ' + authCredentials;
    if (csrfToken) h['X-CSRF-Token'] = csrfToken;
    return h;
}

async function fetchCsrfToken(): Promise<void> {
    try {
        const res = await apiFetch('/api/csrf-token');
        if (res.ok) {
            const data = await res.json() as { token?: string };
            csrfToken = data.token || null;
        }
    } catch {
        log.warn('Failed to fetch CSRF token');
    }
}

async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
    const headers = { ...authHeaders(), ...(opts.headers as Record<string, string> || {}) };
    return fetch(url, { ...opts, headers, credentials: 'include' });
}

async function fetchArchives(): Promise<ArchiveListResponse> {
    const res = await apiFetch('/api/archives');
    if (res.status === 401) {
        throw new AuthError();
    }
    if (!res.ok) throw new Error('Failed to fetch archives');
    return res.json();
}

class AuthError extends Error {
    constructor() { super('Authentication required'); this.name = 'AuthError'; }
}

function uploadFileChunked(file: File): Promise<Archive> {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId = crypto.randomUUID();
    const chunkBytes = new Array<number>(totalChunks).fill(0);

    const uploadChunk = (index: number): Promise<void> =>
        new Promise((resolve, reject) => {
            const start = index * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);
            const params = new URLSearchParams({
                uploadId, chunkIndex: String(index), totalChunks: String(totalChunks), filename: file.name
            });
            const xhr = new XMLHttpRequest();
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    chunkBytes[index] = e.loaded;
                    const pct = Math.round((chunkBytes.reduce((s, b) => s + b, 0) / file.size) * 100);
                    if (progressFill) progressFill.style.width = pct + '%';
                    if (progressPct) progressPct.textContent = pct + '%';
                }
            });
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    chunkBytes[index] = end - start;
                    resolve();
                } else if (xhr.status === 401) reject(new AuthError());
                else {
                    let msg = `Chunk ${index + 1}/${totalChunks} failed`;
                    try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* ignore */ }
                    reject(new Error(msg));
                }
            });
            xhr.addEventListener('error', () => reject(new Error('Network error')));
            xhr.open('POST', '/api/archives/chunks?' + params.toString());
            xhr.withCredentials = true;
            if (authCredentials) xhr.setRequestHeader('Authorization', 'Basic ' + authCredentials);
            if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.send(chunk);
        });

    const complete = (): Promise<Archive> =>
        fetch('/api/archives/chunks/' + uploadId + '/complete', {
            method: 'POST',
            credentials: 'include',
            headers: authHeaders()
        }).then(async (res) => {
            if (res.status === 401) throw new AuthError();
            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(data.error || 'Assembly failed');
            }
            return res.json() as Promise<Archive>;
        });

    return (async () => {
        let next = 0;
        const worker = async () => { while (next < totalChunks) await uploadChunk(next++); };
        await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, totalChunks) }, worker));
        return complete();
    })();
}

function uploadFile(file: File): Promise<Archive> {
    const chunkedEnabled = (window as unknown as { APP_CONFIG?: { chunkedUpload?: boolean } }).APP_CONFIG?.chunkedUpload;
    if (chunkedEnabled && file.size > CHUNK_SIZE) return uploadFileChunked(file);

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const form = new FormData();
        form.append('file', file);

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                if (progressFill) progressFill.style.width = pct + '%';
                if (progressPct) progressPct.textContent = pct + '%';
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch { reject(new Error('Invalid response')); }
            } else if (xhr.status === 401) {
                reject(new AuthError());
            } else {
                try {
                    const err = JSON.parse(xhr.responseText);
                    reject(new Error(err.error || 'Upload failed'));
                } catch { reject(new Error('Upload failed: ' + xhr.status)); }
            }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

        xhr.open('POST', '/api/archives');
        xhr.withCredentials = true;
        if (authCredentials) xhr.setRequestHeader('Authorization', 'Basic ' + authCredentials);
        if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
        xhr.send(form);
    });
}

async function deleteArchive(hash: string): Promise<void> {
    const res = await apiFetch('/api/archives/' + hash, { method: 'DELETE' });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Delete failed');
    }
}

async function regenerateArchive(hash: string): Promise<Archive> {
    const res = await apiFetch('/api/archives/' + hash + '/regenerate', { method: 'POST' });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Regenerate failed');
    }
    return res.json();
}

async function renameArchive(hash: string, newFilename: string): Promise<Archive> {
    const res = await apiFetch('/api/archives/' + hash, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: newFilename })
    });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Rename failed');
    }
    return res.json();
}

// ── Rendering ──

const placeholderSvg = '<svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1" opacity="0.25"><path d="M16 6l10 5.5v9L16 26 6 20.5v-9L16 6z"/><path d="M16 15.5V26"/><path d="M6 11.5L16 17l10-5.5"/></svg>';

function renderCard(a: Archive): HTMLElement {
    const card = document.createElement('div');
    card.className = 'library-card' + (selectedHash === a.hash ? ' selected' : '');
    card.dataset.hash = a.hash;

    const thumbHtml = a.thumbnail
        ? '<img src="' + escapeHtml(a.thumbnail) + '" alt="" loading="lazy">'
        : '<div class="library-card-placeholder">' + placeholderSvg + '</div>';

    card.innerHTML =
        '<div class="library-card-thumb">' + thumbHtml + '</div>' +
        '<div class="library-card-body">' +
            '<div class="library-card-title" title="' + escapeHtml(a.title) + '">' + escapeHtml(a.title) + '</div>' +
            '<div class="library-card-meta">' +
                '<span>' + formatBytes(a.size) + '</span>' +
                '<span>' + formatDate(a.modified) + '</span>' +
            '</div>' +
        '</div>';

    card.addEventListener('click', () => selectArchive(a.hash));
    card.addEventListener('dblclick', () => openInEditor(a));

    return card;
}

function render(): void {
    if (!gallery) return;
    gallery.innerHTML = '';

    if (archives.length === 0) {
        if (emptyState) emptyState.style.display = '';
        if (countEl) countEl.textContent = '';
        return;
    }

    // Filter by search query (title + tags)
    const filtered = searchQuery
        ? archives.filter(a => {
            if (a.title.toLowerCase().includes(searchQuery)) return true;
            const tags = a.metadataFields?.['project.tags'];
            if (typeof tags === 'string' && tags.toLowerCase().includes(searchQuery)) return true;
            return false;
        })
        : archives;

    if (filtered.length === 0) {
        if (emptyState) emptyState.style.display = '';
        if (countEl) countEl.textContent = 'No matches';
        return;
    }

    // Apply collection filter if active
    let collectionFiltered = filtered;
    if (activeCollectionHashes !== null) {
        const hashSet = new Set(activeCollectionHashes);
        collectionFiltered = filtered.filter(a => hashSet.has(a.hash));
    }

    if (collectionFiltered.length === 0) {
        if (emptyState) emptyState.style.display = '';
        if (countEl) countEl.textContent = 'No matches';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (countEl) countEl.textContent = collectionFiltered.length + ' archive' + (collectionFiltered.length !== 1 ? 's' : '')
        + (searchQuery ? ' (filtered)' : '');

    const sorted = [...collectionFiltered].sort((a, b) => {
        let cmp = 0;
        if (currentSort === 'name') cmp = a.title.localeCompare(b.title);
        else if (currentSort === 'date') cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime();
        else if (currentSort === 'size') cmp = a.size - b.size;
        return currentDir === 'asc' ? cmp : -cmp;
    });

    for (const a of sorted) gallery.appendChild(renderCard(a));
}

function updateStorage(data: ArchiveListResponse): void {
    if (!storageBar || !storageFill || !storageText) return;
    if (data.storageUsed > 0) {
        storageBar.style.display = '';
        storageText.textContent = formatBytes(data.storageUsed);
        const pct = Math.min(100, (data.storageUsed / (10 * 1024 * 1024 * 1024)) * 100);
        storageFill.style.width = pct + '%';
    } else {
        storageBar.style.display = 'none';
    }
}

// ── Detail pane ──

function selectArchive(hash: string): void {
    selectedHash = hash;
    const archive = archives.find(a => a.hash === hash);

    // Update card selection
    document.querySelectorAll('.library-card').forEach(card => {
        card.classList.toggle('selected', (card as HTMLElement).dataset.hash === hash);
    });

    if (!archive) {
        showDetailEmpty();
        return;
    }

    if (detailEmpty) detailEmpty.style.display = 'none';
    if (detailPanel) detailPanel.style.display = '';

    if (detailThumb) {
        detailThumb.innerHTML = archive.thumbnail
            ? '<img src="' + escapeHtml(archive.thumbnail) + '" alt="">'
            : placeholderSvg;
    }
    if (detailTitle) detailTitle.textContent = archive.title;
    if (detailFilename) detailFilename.textContent = archive.filename;
    if (detailSize) detailSize.textContent = formatBytes(archive.size);
    if (detailDate) detailDate.textContent = formatDate(archive.modified);

    renderAssets(archive);
    renderMetadata(archive);

    // Update collection chips in detail pane
    updateChipsForArchive(hash);

    // Fetch and render recordings
    const cached = mediaCache.get(hash);
    if (cached) {
        renderRecordings(cached);
    } else {
        renderRecordings([]);
        fetchMedia(hash).then(items => {
            mediaCache.set(hash, items);
            if (selectedHash === hash) renderRecordings(items);
        });
    }
}

function showDetailEmpty(): void {
    if (detailEmpty) detailEmpty.style.display = '';
    if (detailPanel) detailPanel.style.display = 'none';
    renderRecordings([]);
}

// ── Asset & Metadata rendering ──

const ASSET_TYPE_LABELS: Record<string, string> = {
    splat: 'Gaussian Splat',
    mesh: 'Mesh',
    pointcloud: 'Point Cloud',
    cad: 'CAD Model',
    drawing: 'Drawing',
};

const ASSET_TYPE_ICONS: Record<string, string> = {
    splat: '\u2B24',       // filled circle
    mesh: '\u25B3',        // triangle
    pointcloud: '\u2059',  // dot pattern
    cad: '\u2B21',         // hexagon
    drawing: '\u25A1',     // square
};

function renderAssets(archive: Archive): void {
    if (!detailAssets || !detailAssetsSection) return;
    const assets = archive.assets;
    if (!assets || assets.length === 0) {
        detailAssetsSection.style.display = 'none';
        return;
    }
    detailAssetsSection.style.display = '';
    let html = '';
    for (const a of assets) {
        const label = ASSET_TYPE_LABELS[a.type] || a.type;
        const icon = ASSET_TYPE_ICONS[a.type] || '\u25CF';
        const fmt = a.format ? a.format.toUpperCase() : '';
        const size = a.size_bytes ? formatBytes(a.size_bytes) : '';
        const detail = [fmt, size].filter(Boolean).join(' \u00B7 ');
        html += '<div class="prop-row">' +
            '<span class="prop-row-label"><span class="library-asset-icon">' + icon + '</span>' + escapeHtml(label) + '</span>' +
            '<span class="font-mono library-detail-val" style="font-size:10px;">' + escapeHtml(detail) + '</span>' +
            '</div>';
    }
    detailAssets.innerHTML = html;
}

const METADATA_FIELD_LABELS: Record<string, string> = {
    'project.title': 'Title',
    'project.description': 'Description',
    'project.license': 'License',
    'project.tags': 'Tags',
    'project.id': 'Project ID',
    'provenance.capture_date': 'Capture Date',
    'provenance.capture_device': 'Capture Device',
    'provenance.operator': 'Operator',
    'provenance.location': 'Location',
    'provenance.processing_software': 'Software',
    'provenance.processing_notes': 'Processing Notes',
    'quality.tier': 'Quality Tier',
    'quality.accuracy_grade': 'Accuracy',
    'quality.capture_resolution': 'Resolution',
    'archival.title': 'Archival Title',
    'archival.creator': 'Creator',
    'archival.date_created': 'Date Created',
    'archival.period': 'Period',
    'archival.culture': 'Culture',
    'archival.medium': 'Medium',
    'archival.location': 'Archival Location',
    'annotations': 'Annotations',
    'viewer.display_mode': 'Display Mode',
};

const METADATA_GROUP_ORDER = ['project', 'provenance', 'quality', 'archival', 'annotations', 'viewer'];

function renderMetadata(archive: Archive): void {
    if (!detailMetadata || !detailMetadataSection) return;
    const fields = archive.metadataFields;
    if (!fields || Object.keys(fields).length === 0) {
        detailMetadataSection.style.display = 'none';
        return;
    }
    detailMetadataSection.style.display = '';

    // Group fields by prefix
    const groups: Record<string, string[]> = {};
    for (const key of Object.keys(fields)) {
        const prefix = key.split('.')[0];
        if (!groups[prefix]) groups[prefix] = [];
        groups[prefix].push(key);
    }

    let html = '';
    for (const group of METADATA_GROUP_ORDER) {
        const keys = groups[group];
        if (!keys) continue;
        for (const key of keys) {
            const label = METADATA_FIELD_LABELS[key] || key;
            const val = fields[key];
            const display = typeof val === 'number' ? String(val) : '\u2713';
            html += '<div class="prop-row">' +
                '<span class="prop-row-label">' + escapeHtml(label) + '</span>' +
                '<span class="font-mono library-detail-val library-meta-filled" style="font-size:10px;">' + escapeHtml(display) + '</span>' +
                '</div>';
        }
    }
    detailMetadata.innerHTML = html;
}

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

function renderRecordings(items: MediaItem[]): void {
    if (!recordingsBody || !recordingsSection) return;

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

        if (item.gif_path) {
            const thumbSrc = item.thumb_path;
            img.addEventListener('mouseenter', () => { img.src = item.gif_path!; });
            img.addEventListener('mouseleave', () => { img.src = thumbSrc; });
        }

        img.addEventListener('click', () => {
            if (item.mp4_path) expandVideoPlayer(thumbArea, item);
        });
        thumbArea.appendChild(img);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'library-media-placeholder';
        placeholder.textContent = isProcessing ? 'Processing\u2026' : 'Error';
        thumbArea.appendChild(placeholder);
    }

    if (isProcessing) {
        const badge = document.createElement('span');
        badge.className = 'library-media-status processing';
        badge.textContent = 'Processing';
        thumbArea.appendChild(badge);

        const timer = window.setInterval(async () => {
            try {
                const res = await apiFetch('/api/media/' + item.id);
                if (!res.ok) return;
                const updated = await res.json() as MediaItem;
                if (updated.status === 'ready' || updated.status === 'error') {
                    clearInterval(timer);
                    mediaPollTimers = mediaPollTimers.filter(t => t !== timer);
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
        shareBtn.addEventListener('click', () => copyMediaUrl(location.origin + item.share_url, 'Share link copied'));
        actions.appendChild(shareBtn);

        if (item.gif_path) {
            const gifBtn = document.createElement('button');
            gifBtn.textContent = 'Copy GIF';
            gifBtn.addEventListener('click', () => copyMediaUrl(location.origin + item.gif_path!, 'GIF URL copied'));
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

function expandVideoPlayer(container: HTMLElement, item: MediaItem): void {
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
    video.addEventListener('ended', () => expandVideoPlayer(container, item));
    container.appendChild(video);
}

async function copyMediaUrl(text: string, successMsg: string): Promise<void> {
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

// ── Actions ──

function openInEditor(archive: Archive): void {
    // Load the archive in the current viewer by navigating with archive path
    const url = new URL(window.location.href);
    url.searchParams.set('archive', archive.path);
    window.location.href = url.toString();
}

function openInNewTab(archive: Archive): void {
    window.open(archive.viewerUrl, '_blank');
}

async function handleRename(archive: Archive): Promise<void> {
    const newName = prompt('Rename archive:', archive.filename);
    if (!newName || newName === archive.filename) return;
    try {
        const updated = await renameArchive(archive.hash, newName);
        const idx = archives.findIndex(a => a.hash === archive.hash);
        if (idx !== -1) archives[idx] = updated;
        render();
        selectArchive(archive.hash);
        notify.success('Renamed to ' + updated.filename);
    } catch (err) {
        if (err instanceof AuthError) { showAuth(); return; }
        notify.error('Rename failed: ' + (err as Error).message);
    }
}

async function handleDelete(archive: Archive): Promise<void> {
    if (!confirm('Delete "' + archive.filename + '"? This cannot be undone.')) return;
    try {
        await deleteArchive(archive.hash);
        archives = archives.filter(a => a.hash !== archive.hash);
        if (selectedHash === archive.hash) {
            selectedHash = null;
            showDetailEmpty();
        }
        render();
        notify.success('Deleted ' + archive.filename);
    } catch (err) {
        if (err instanceof AuthError) { showAuth(); return; }
        notify.error('Delete failed: ' + (err as Error).message);
    }
}

async function handleRegenerate(archive: Archive): Promise<void> {
    try {
        const updated = await regenerateArchive(archive.hash);
        // Cache-bust thumbnail so the browser fetches the freshly extracted image
        if (updated.thumbnail) {
            updated.thumbnail = updated.thumbnail.split('?')[0] + '?t=' + Date.now();
        }
        const idx = archives.findIndex(a => a.hash === archive.hash);
        if (idx !== -1) archives[idx] = updated;
        render();
        selectArchive(archive.hash);
        notify.success('Metadata regenerated');
    } catch (err) {
        if (err instanceof AuthError) { showAuth(); return; }
        notify.error('Regenerate failed: ' + (err as Error).message);
    }
}

async function handleCopyUrl(archive: Archive): Promise<void> {
    const fullUrl = archive.uuid
        ? location.origin + '/view/' + archive.uuid + '?theme=editorial'
        : location.origin + archive.viewerUrl;
    try {
        await navigator.clipboard.writeText(fullUrl);
        notify.success('URL copied');
    } catch {
        notify.error('Copy failed');
    }
}

// ── Upload ──

async function processUploadQueue(): Promise<void> {
    if (uploading || uploadQueue.length === 0) return;
    uploading = true;

    while (uploadQueue.length > 0) {
        const file = uploadQueue.shift()!;
        if (progressName) progressName.textContent = file.name;
        if (progressFill) progressFill.style.width = '0%';
        if (progressPct) progressPct.textContent = '0%';
        if (uploadZone) uploadZone.classList.add('uploading');

        try {
            let archive: Archive;
            try {
                archive = await uploadFile(file);
            } catch (err) {
                // On CSRF failure, re-fetch token and retry once
                if ((err as Error).message?.includes('CSRF')) {
                    await fetchCsrfToken();
                    archive = await uploadFile(file);
                } else {
                    throw err;
                }
            }
            archives.push(archive);
            render();
            notify.success('Uploaded ' + archive.filename);
        } catch (err) {
            if (err instanceof AuthError) {
                showAuth();
                uploadQueue = [];
                break;
            }
            notify.error('Upload failed: ' + (err as Error).message);
        }
    }

    uploading = false;
    if (uploadZone) uploadZone.classList.remove('uploading');
}

// ── Auth ──

function showAuth(): void {
    if (gallery) gallery.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';
    if (authPanel) authPanel.style.display = '';
    if (uploadZone) uploadZone.style.display = 'none';
    document.getElementById('library-sort')?.style.setProperty('display', 'none');
}

function hideAuth(): void {
    if (authPanel) authPanel.style.display = 'none';
    if (gallery) gallery.style.display = '';
    if (uploadZone) uploadZone.style.display = '';
    document.getElementById('library-sort')?.style.removeProperty('display');
}

async function handleAuth(): Promise<void> {
    const userInput = document.getElementById('library-auth-user') as HTMLInputElement | null;
    const passInput = document.getElementById('library-auth-pass') as HTMLInputElement | null;
    if (!userInput || !passInput) return;

    const user = userInput.value.trim();
    const pass = passInput.value;
    if (!user || !pass) return;

    authCredentials = btoa(user + ':' + pass);

    try {
        const data = await fetchArchives();
        archives = data.archives || [];
        hasFetched = true;
        updateStorage(data);
        hideAuth();
        render();
        log.info('Authenticated successfully, loaded', archives.length, 'archives');
    } catch (err) {
        if (err instanceof AuthError) {
            authCredentials = null;
            notify.error('Invalid credentials');
            passInput.value = '';
            passInput.focus();
        } else {
            notify.error('Connection failed');
        }
    }
}

// ── Sort ──

function setupSort(): void {
    const sortContainer = document.getElementById('library-sort');
    if (!sortContainer) return;

    sortContainer.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.library-sort-btn') as HTMLElement | null;
        if (!btn) return;
        const sort = btn.dataset.sort || 'name';

        if (sort === currentSort) {
            currentDir = currentDir === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort = sort;
            currentDir = sort === 'name' ? 'asc' : 'desc';
        }

        sortContainer.querySelectorAll('.library-sort-btn').forEach(b => {
            b.classList.remove('active');
            const arrow = b.querySelector('.arrow');
            if (arrow) arrow.remove();
        });
        btn.classList.add('active');
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.textContent = currentDir === 'asc' ? '\u2191' : '\u2193';
        btn.appendChild(arrow);
        render();
    });
}

// ── Upload wiring ──

function setupUpload(): void {
    if (!uploadZone || !fileInput) return;

    const browseBtn = document.getElementById('library-upload-browse');
    if (browseBtn) {
        browseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput!.click();
        });
    }

    uploadZone.addEventListener('click', () => fileInput!.click());

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone!.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone!.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone!.classList.remove('dragover');
        const files = (e as DragEvent).dataTransfer?.files;
        if (!files) return;
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (f.name.endsWith('.a3d') || f.name.endsWith('.a3z')) {
                uploadQueue.push(f);
            }
        }
        processUploadQueue();
    });

    fileInput.addEventListener('change', () => {
        const files = fileInput!.files;
        if (!files) return;
        for (let i = 0; i < files.length; i++) {
            uploadQueue.push(files[i]);
        }
        fileInput!.value = '';
        processUploadQueue();
    });
}

// ── Detail actions wiring ──

function setupDetailActions(): void {
    const getSelected = (): Archive | null => {
        if (!selectedHash) return null;
        return archives.find(a => a.hash === selectedHash) || null;
    };

    document.getElementById('library-action-open')?.addEventListener('click', () => {
        const a = getSelected();
        if (a) openInEditor(a);
    });

    document.getElementById('library-action-view')?.addEventListener('click', () => {
        const a = getSelected();
        if (a) openInNewTab(a);
    });

    document.getElementById('library-action-share')?.addEventListener('click', async () => {
        const a = getSelected();
        if (a) {
            try {
                const params = new URLSearchParams(a.viewerUrl.split('?')[1] || '');
                const archiveUrl = params.get('archive');
                if (archiveUrl) {
                    const { showShareDialog } = await import('./share-dialog.js');
                    showShareDialog({
                        archiveUrl,
                        archiveHash: a.hash,
                        archiveUuid: a.uuid || null,
                        archiveTitle: a.title || a.filename,
                    });
                } else {
                    notify.warning('Cannot share: no archive URL found');
                }
            } catch {
                notify.error('Failed to open share dialog');
            }
        }
    });

    document.getElementById('library-action-copy')?.addEventListener('click', () => {
        const a = getSelected();
        if (a) handleCopyUrl(a);
    });

    document.getElementById('library-action-rename')?.addEventListener('click', () => {
        const a = getSelected();
        if (a) handleRename(a);
    });

    document.getElementById('library-action-delete')?.addEventListener('click', () => {
        const a = getSelected();
        if (a) handleDelete(a);
    });

    document.getElementById('library-action-regenerate')?.addEventListener('click', () => {
        const a = getSelected();
        if (a) handleRegenerate(a);
    });
}

// ── Public API ──

/**
 * Initialize the library panel. Call once after DOM is ready.
 * Shows the library button in the tool rail if libraryEnabled is true.
 * Does not fetch archives until the library tool is first activated.
 */
export function initLibraryPanel(): void {
    if (initialized) return;

    const config = (window as unknown as { APP_CONFIG?: { libraryEnabled?: boolean } }).APP_CONFIG;
    if (!config?.libraryEnabled) {
        log.debug('Library panel disabled (libraryEnabled=false)');
        return;
    }

    // Swap logo icon for library icon and make it a clickable tool button
    const btn = document.getElementById('btn-library');
    if (btn) {
        // Hide the static logo mark, show the library shelf icon
        const logoMark = btn.querySelector('.rail-logo-mark') as HTMLElement | null;
        const libIcon = btn.querySelector('.rail-library-icon') as HTMLElement | null;
        if (logoMark) logoMark.style.display = 'none';
        if (libIcon) libIcon.style.display = '';
        btn.title = 'Library';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', () => {
            activateTool('library');
            onLibraryActivated();
        });
    }
    const sep = document.querySelector('.rail-library-sep') as HTMLElement | null;
    if (sep) sep.style.display = '';

    // Cache DOM refs
    gallery = document.getElementById('library-gallery');
    emptyState = document.getElementById('library-empty');
    authPanel = document.getElementById('library-auth');
    countEl = document.getElementById('library-count');
    storageBar = document.getElementById('library-storage');
    storageFill = document.getElementById('library-storage-fill');
    storageText = document.getElementById('library-storage-text');
    uploadZone = document.getElementById('library-upload');
    fileInput = document.getElementById('library-file-input') as HTMLInputElement | null;
    progressFill = document.getElementById('library-progress-fill');
    progressPct = document.getElementById('library-progress-pct');
    progressName = document.getElementById('library-progress-name');

    detailPanel = document.getElementById('library-detail');
    detailEmpty = document.getElementById('library-detail-empty');
    detailThumb = document.getElementById('library-detail-thumb');
    detailTitle = document.getElementById('library-detail-title');
    detailFilename = document.getElementById('library-detail-filename');
    detailSize = document.getElementById('library-detail-size');
    detailDate = document.getElementById('library-detail-date');
    detailAssets = document.getElementById('library-detail-assets');
    detailAssetsSection = document.getElementById('library-assets-section');
    detailMetadata = document.getElementById('library-detail-metadata');
    detailMetadataSection = document.getElementById('library-metadata-section');
    recordingsSection = document.getElementById('library-recordings-section');
    recordingsBody = document.getElementById('library-detail-recordings');

    // Show "Save to Library" button in export pane
    const saveBtn = document.getElementById('btn-save-to-library');
    if (saveBtn) saveBtn.style.display = '';

    // Wire up events
    setupSort();
    setupUpload();
    setupDetailActions();

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

    // Search filter
    const searchInput = document.getElementById('library-search') as HTMLInputElement | null;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            searchQuery = searchInput.value.trim().toLowerCase();
            render();
        });
    }

    // Auth form
    document.getElementById('library-auth-submit')?.addEventListener('click', handleAuth);
    const passInput = document.getElementById('library-auth-pass');
    passInput?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') handleAuth();
    });

    initialized = true;
    log.info('Library panel initialized');
}

/**
 * Called when the library tool is activated (user clicks the Library button).
 * Fetches archives on first activation.
 */
export async function onLibraryActivated(): Promise<void> {
    if (!initialized) return;
    // Fetch CSRF token if we don't have one yet
    if (!csrfToken) await fetchCsrfToken();
    // Only fetch if we haven't fetched yet and auth form isn't showing
    const authVisible = authPanel && authPanel.style.display !== 'none';
    if (!hasFetched && !authVisible) {
        try {
            const data = await fetchArchives();
            archives = data.archives || [];
            hasFetched = true;
            updateStorage(data);
            render();
            log.info('Loaded', archives.length, 'archives');
        } catch (err) {
            if (err instanceof AuthError) {
                showAuth();
            } else {
                log.error('Failed to load archives:', err);
                notify.error('Could not connect to archive library');
            }
        }
    }
}

/**
 * Refresh the library archive list.
 */
/**
 * Return the current Basic-auth credentials string (base64), or null if not authenticated.
 */
export function getAuthCredentials(): string | null {
    return authCredentials;
}

export function getCsrfToken(): string | null {
    return csrfToken;
}

export { fetchCsrfToken };

export async function refreshLibrary(): Promise<void> {
    try {
        const data = await fetchArchives();
        archives = data.archives || [];
        hasFetched = true;
        updateStorage(data);
        render();
    } catch (err) {
        if (err instanceof AuthError) showAuth();
        else log.error('Failed to refresh library:', err);
    }
}
