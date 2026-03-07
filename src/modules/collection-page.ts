/**
 * Collection Page Module
 *
 * Renders an editorial-themed collection browser for kiosk mode.
 * Design language matches the Editorial Gold theme: navy + gold palette,
 * Source Sans 3 typography, gold accent rules, staggered entry animations.
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('collection-page');

export interface CollectionArchive {
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

export function formatBytes(b: number): string {
    if (b === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return (b / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}

export function escapeHtml(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

export function formatDate(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
}

export const ASSET_LABELS: Record<string, string> = {
    splat: 'Gaussian Splat',
    mesh: 'Mesh',
    pointcloud: 'Point Cloud',
    cad: 'CAD',
    drawing: 'Drawing',
};

// ── Fetch ──

async function fetchCollection(slug: string): Promise<CollectionData> {
    const res = await fetch('/collection/' + encodeURIComponent(slug) + '/data');
    if (!res.ok) throw new Error('Collection not found');
    return res.json();
}

// ── Inject Styles ──

export function injectStyles(): void {
    if (document.getElementById('collection-page-styles')) return;
    const style = document.createElement('style');
    style.id = 'collection-page-styles';
    style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;500;600;700&display=swap');

@keyframes cpFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
@keyframes cpSlideUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes cpRuleDraw {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
}
@keyframes cpSpineFade {
    from { opacity: 0; height: 0; }
    to { opacity: 0.6; height: 100%; }
}

.cp-page {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: #08182a;
    color: rgba(232, 236, 240, 0.95);
    font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
}

/* Gold spine — left edge accent */
.cp-spine {
    position: fixed;
    top: 0;
    left: 0;
    width: 3px;
    height: 100%;
    background: #FEC03A;
    opacity: 0.6;
    z-index: 10;
    animation: cpSpineFade 0.6s ease-out 0.2s both;
}

/* Header region */
.cp-header {
    max-width: 960px;
    margin: 0 auto;
    padding: 72px 48px 0 48px;
    animation: cpFadeIn 0.5s ease-out 0.1s both;
}

.cp-logo {
    display: block;
    height: 18px;
    margin-bottom: 32px;
    opacity: 0.7;
    filter: brightness(1.5) drop-shadow(0 1px 4px rgba(0,0,0,0.5));
}

.cp-eyebrow {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #FEC03A;
    margin-bottom: 12px;
}

.cp-title {
    font-size: clamp(1.5rem, 4vw, 2.5rem);
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.15;
    color: rgba(245, 245, 250, 0.95);
    margin: 0 0 16px;
}

.cp-rule {
    width: 56px;
    height: 3px;
    background: #FEC03A;
    margin-bottom: 16px;
    transform-origin: left;
    animation: cpRuleDraw 0.5s cubic-bezier(0.33, 1, 0.68, 1) 0.4s both;
}

.cp-description {
    font-size: 0.88rem;
    font-weight: 400;
    line-height: 1.7;
    color: rgba(190, 200, 215, 0.9);
    max-width: 560px;
    margin: 0 0 12px;
}

.cp-count {
    font-size: 0.68rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(140, 160, 180, 0.7);
}

/* Grid */
.cp-grid {
    max-width: 960px;
    margin: 0 auto;
    padding: 40px 48px 48px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 24px;
}

/* Card — click-gate-inspired poster layout */
.cp-card {
    display: block;
    text-decoration: none;
    color: inherit;
    overflow: hidden;
    cursor: pointer;
    position: relative;
    border-radius: 2px;
    animation: cpSlideUp 0.4s ease-out both;
}

/* Full-bleed poster image */
.cp-card-poster {
    aspect-ratio: 16 / 10;
    position: relative;
    overflow: hidden;
    background: rgba(8, 24, 42, 0.9);
}

.cp-card-poster img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.5s ease, opacity 0.3s ease;
}

.cp-card:hover .cp-card-poster img {
    transform: scale(1.05);
}

.cp-card-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(17, 48, 78, 0.5), rgba(8, 24, 42, 0.8));
}

/* Vignette overlay — matches click gate gradient */
.cp-card-vignette {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg,
        rgba(8, 24, 42, 0.15) 0%,
        rgba(8, 24, 42, 0.05) 40%,
        rgba(8, 24, 42, 0.5) 70%,
        rgba(8, 24, 42, 0.92) 100%
    );
    pointer-events: none;
    transition: opacity 0.3s ease;
}

.cp-card:hover .cp-card-vignette {
    opacity: 0.8;
}

/* Play button — centered, matches editorial gate play */
.cp-card-play {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.85);
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 1.5px solid rgba(254, 192, 58, 0.3);
    background: rgba(8, 24, 42, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.3s ease, transform 0.3s ease, border-color 0.3s ease, background 0.3s ease;
    z-index: 3;
    backdrop-filter: blur(4px);
}

.cp-card-play svg {
    fill: rgba(254, 192, 58, 0.8);
    stroke: none;
    width: 16px;
    height: 16px;
    margin-left: 2px;
}

.cp-card:hover .cp-card-play {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
    border-color: rgba(254, 192, 58, 0.6);
    background: rgba(254, 192, 58, 0.1);
}

.cp-card:hover .cp-card-play:hover {
    border-color: #FEC03A;
    background: rgba(254, 192, 58, 0.2);
    box-shadow: 0 0 24px rgba(254, 192, 58, 0.2);
}

/* Info overlay — bottom of poster, over vignette */
.cp-card-info {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 12px 14px;
    z-index: 2;
}

.cp-card-title {
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 6px;
    color: rgba(245, 245, 250, 0.95);
    text-shadow: 0 1px 3px rgba(0,0,0,0.7), 0 0 8px rgba(0,0,0,0.4);
}

.cp-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    font-size: 0.6rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(190, 200, 215, 0.7);
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
}

.cp-card-meta span {
    white-space: nowrap;
}

/* Asset type pills — inline with meta */
.cp-type-pill {
    font-size: 0.55rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #FEC03A;
}

.cp-type-plus {
    font-size: 0.5rem;
    color: rgba(190, 200, 215, 0.45);
    margin: 0 2px;
}

/* Gold rule above info */
.cp-card-rule {
    width: 24px;
    height: 2px;
    background: rgba(254, 192, 58, 0.4);
    margin-bottom: 8px;
    transition: width 0.3s ease, background 0.3s ease;
}

.cp-card:hover .cp-card-rule {
    width: 40px;
    background: rgba(254, 192, 58, 0.7);
}

/* Error state */
.cp-error {
    max-width: 960px;
    margin: 0 auto;
    padding: 120px 48px;
    text-align: center;
}

.cp-error p {
    font-size: 0.88rem;
    color: rgba(140, 160, 180, 0.7);
}

/* Responsive */
@media (max-width: 768px) {
    .cp-header { padding: 48px 24px 0; }
    .cp-grid { padding: 32px 24px 32px; gap: 16px; }
    .cp-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
    .cp-title { font-size: 1.4rem; }
    .cp-logo { height: 14px; margin-bottom: 24px; }
}

@media (max-width: 480px) {
    .cp-header { padding: 36px 16px 0; }
    .cp-grid { padding: 24px 16px 24px; grid-template-columns: 1fr; }
}
`;
    document.head.appendChild(style);
}

// ── Logo ──

/** Resolve the editorial theme logo path, handling both dev and Docker contexts. */
export function getLogoSrc(): string {
    // In production builds, themes are copied to dist/themes/
    // In dev, Vite serves from src/ directly
    return '/themes/editorial/logo.png';
}

// ── Rendering ──

export function renderCard(
    archive: CollectionArchive,
    index: number,
    onCardClick?: (archive: CollectionArchive) => void,
): HTMLElement {
    const card = document.createElement('a');
    card.className = 'cp-card';
    const baseUrl = archive.uuid ? '/view/' + archive.uuid : archive.viewerUrl;
    card.href = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'autoload=true';
    // Stagger animation delay
    card.style.animationDelay = (0.15 + index * 0.06) + 's';

    if (onCardClick) {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            onCardClick(archive);
        });
    }

    const thumbHtml = archive.thumbnail
        ? '<img src="' + escapeHtml(archive.thumbnail) + '" alt="" loading="lazy">'
        : '<div class="cp-card-placeholder"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="rgba(254,192,58,0.2)" stroke-width="0.8"><path d="M16 6l10 5.5v9L16 26 6 20.5v-9L16 6z"/><path d="M16 15.5V26"/><path d="M6 11.5L16 17l10-5.5"/></svg></div>';

    // Play button SVG (matches editorial click gate)
    const playSvg = '<svg viewBox="0 0 24 24" width="16" height="16"><polygon points="8,5 20,12 8,19"/></svg>';

    // Asset type pills as inline labels (mesh first)
    let typeMeta = '';
    if (archive.assets && archive.assets.length > 0) {
        const TYPE_ORDER = ['mesh', 'splat', 'pointcloud', 'cad', 'drawing'];
        const types = [...new Set(archive.assets.map(a => a.type))]
            .sort((a, b) => (TYPE_ORDER.indexOf(a) === -1 ? 99 : TYPE_ORDER.indexOf(a)) - (TYPE_ORDER.indexOf(b) === -1 ? 99 : TYPE_ORDER.indexOf(b)));
        typeMeta = types.map(t => '<span class="cp-type-pill">' + escapeHtml(ASSET_LABELS[t] || t) + '</span>').join('<span class="cp-type-plus">+</span>');
    }

    // Metadata parts: date, size, filename
    const datePart = archive.modified ? formatDate(archive.modified) : '';
    const metaParts: string[] = [];
    if (typeMeta) metaParts.push(typeMeta);
    if (datePart) metaParts.push('<span>' + escapeHtml(datePart) + '</span>');
    metaParts.push('<span>' + formatBytes(archive.size) + '</span>');

    card.innerHTML =
        '<div class="cp-card-poster">' +
            thumbHtml +
            '<div class="cp-card-vignette"></div>' +
            '<div class="cp-card-play">' + playSvg + '</div>' +
            '<div class="cp-card-info">' +
                '<div class="cp-card-rule"></div>' +
                '<div class="cp-card-title">' + escapeHtml(archive.title || archive.filename) + '</div>' +
                '<div class="cp-card-meta">' + metaParts.join('') + '</div>' +
            '</div>' +
        '</div>';

    return card;
}

function renderPage(container: HTMLElement, data: CollectionData): void {
    const logoSrc = getLogoSrc();

    // Header
    const header = document.createElement('div');
    header.className = 'cp-header';
    header.innerHTML =
        '<img class="cp-logo" src="' + logoSrc + '" alt="" onerror="this.style.display=\'none\'">' +
        '<div class="cp-eyebrow">Collection</div>' +
        '<h1 class="cp-title">' + escapeHtml(data.name) + '</h1>' +
        '<div class="cp-rule"></div>' +
        (data.description ? '<p class="cp-description">' + escapeHtml(data.description) + '</p>' : '') +
        '<span class="cp-count">' + data.archiveCount + ' Archive' + (data.archiveCount !== 1 ? 's' : '') + '</span>';

    // Grid
    const grid = document.createElement('div');
    grid.className = 'cp-grid';
    data.archives.forEach((archive, i) => {
        grid.appendChild(renderCard(archive, i));
    });

    // Gold spine
    const spine = document.createElement('div');
    spine.className = 'cp-spine';

    container.appendChild(spine);
    container.appendChild(header);
    container.appendChild(grid);
}

function renderError(container: HTMLElement, message: string): void {
    const spine = document.createElement('div');
    spine.className = 'cp-spine';
    container.appendChild(spine);
    container.innerHTML += '<div class="cp-error"><p>' + escapeHtml(message) + '</p></div>';
}

// ── Public API ──

/**
 * Initialize the collection page. Replaces the 3D viewport with a card grid.
 * Returns true if a collection slug was found and the page was rendered.
 */
export async function initCollectionPage(): Promise<boolean> {
    const config = (window as unknown as { APP_CONFIG?: { collectionSlug?: string } }).APP_CONFIG;
    // Check APP_CONFIG (server injection) first, then fall back to URL path detection
    const pathMatch = window.location.pathname.match(/^\/collection\/([a-z0-9][a-z0-9-]{0,79})$/);
    const slug = config?.collectionSlug || (pathMatch ? pathMatch[1] : null);
    if (!slug) return false;

    log.info('Loading collection:', slug);
    injectStyles();

    // Hide the entire app shell (tool rail, viewport, status bar, props panel)
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    let container = document.getElementById('collection-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'collection-container';
        container.className = 'cp-page';
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
