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
    z-index: 201; /* above #metadata-display which is also z-index:200 */
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

// Not cached — element is created dynamically by kiosk-main after module load
function getBackButtonEl(): HTMLElement | null {
    return document.getElementById('kiosk-back-library');
}
