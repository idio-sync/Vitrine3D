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
        document.title = data.name + ' \u2014 ' + (document.title || 'Vitrine3D');
        log.info('Collection loaded:', data.name, '(' + data.archives.length + ' archives)');
    } catch (err) {
        log.error('Failed to load collection:', err);
        renderError(container, 'Collection not found');
    }

    return true;
}
