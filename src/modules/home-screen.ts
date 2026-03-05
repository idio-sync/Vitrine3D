/**
 * Home Screen Module
 *
 * Tauri desktop home screen with "Browse Library" and "Open Local File" action cards.
 * Activated when window.APP_CONFIG.home === true (set by ?home=true URL param in Tauri config).
 * Design language matches Editorial Gold theme: navy + gold palette, Source Sans 3 typography.
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('home-screen');

declare const window: Window & {
    APP_CONFIG?: { home?: boolean; [key: string]: unknown };
    __TAURI__?: unknown;
};

// ── Style injection ──

function injectStyles(): void {
    if (document.getElementById('home-screen-styles')) return;
    const style = document.createElement('style');
    style.id = 'home-screen-styles';
    style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;500;600;700&display=swap');

@keyframes hsFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
}
@keyframes hsSlideUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
}

.hs-page {
    position: fixed;
    inset: 0;
    background: #08182a;
    color: rgba(232, 236, 240, 0.95);
    font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    animation: hsFadeIn 0.4s ease-out both;
    overflow: hidden;
}

/* Gold spine accent */
.hs-spine {
    position: fixed;
    top: 0;
    left: 0;
    width: 3px;
    height: 100%;
    background: #FEC03A;
    opacity: 0.6;
    z-index: 10;
}

.hs-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    animation: hsSlideUp 0.5s ease-out 0.1s both;
}

.hs-logo {
    display: block;
    height: 24px;
    opacity: 0.8;
    filter: brightness(1.1);
    margin-bottom: 20px;
}

.hs-title {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: rgba(232, 236, 240, 0.95);
    margin: 0 0 6px 0;
    text-align: center;
}

.hs-subtitle {
    font-size: 14px;
    font-weight: 400;
    color: rgba(232, 236, 240, 0.45);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0 0 48px 0;
    text-align: center;
}

.hs-cards {
    display: flex;
    flex-direction: row;
    gap: 20px;
    align-items: stretch;
}

.hs-card {
    width: 220px;
    height: 160px;
    background: rgba(17, 48, 78, 0.5);
    border: 1px solid rgba(254, 192, 58, 0.12);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    cursor: pointer;
    transition: border-color 0.2s ease, transform 0.2s ease, background 0.2s ease;
    user-select: none;
    padding: 24px 16px;
    box-sizing: border-box;
}

.hs-card:hover {
    border-color: rgba(254, 192, 58, 0.55);
    transform: translateY(-2px);
    background: rgba(17, 48, 78, 0.75);
}

.hs-card:active {
    transform: translateY(0);
}

.hs-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #FEC03A;
    opacity: 0.85;
    flex-shrink: 0;
}

.hs-card-label {
    font-size: 15px;
    font-weight: 600;
    color: rgba(232, 236, 240, 0.92);
    text-align: center;
    line-height: 1.3;
    margin: 0;
}

.hs-card-desc {
    font-size: 12px;
    font-weight: 400;
    color: rgba(232, 236, 240, 0.4);
    text-align: center;
    letter-spacing: 0.03em;
    margin: 0;
    line-height: 1.4;
}

.hs-error {
    display: none;
    margin-top: 24px;
    font-size: 13px;
    color: rgba(255, 120, 100, 0.85);
    text-align: center;
    max-width: 400px;
    line-height: 1.5;
}

.hs-error.visible {
    display: block;
}

@media (max-width: 500px) {
    .hs-cards {
        flex-direction: column;
    }
    .hs-card {
        width: 260px;
        height: 130px;
    }
}
`;
    document.head.appendChild(style);
}

// ── SVG icons ──

function iconBookshelf(): string {
    // Three vertical rectangles representing a bookshelf / library
    return `<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="5"  y="8" width="7" height="20" rx="1" stroke="currentColor" stroke-width="1.5"/>
  <rect x="14.5" y="12" width="7" height="16" rx="1" stroke="currentColor" stroke-width="1.5"/>
  <rect x="24" y="6" width="7" height="22" rx="1" stroke="currentColor" stroke-width="1.5"/>
  <line x1="3" y1="29.5" x2="33" y2="29.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;
}

function iconFile3D(): string {
    // Document with a 3D cube on it
    return `<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 4h13l7 7v21H8V4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M21 4v7h7" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M18 17l5 2.8v5.6L18 28l-5-2.6v-5.6L18 17z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="M13 19.7l5 2.8 5-2.8" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  <line x1="18" y1="22.5" x2="18" y2="28" stroke="currentColor" stroke-width="1.3"/>
</svg>`;
}

// ── Build page ──

function buildPage(serverUrl: string | null): HTMLElement {
    const page = document.createElement('div');
    page.className = 'hs-page';
    page.id = 'home-screen-container';

    // Gold spine
    const spine = document.createElement('div');
    spine.className = 'hs-spine';
    page.appendChild(spine);

    const inner = document.createElement('div');
    inner.className = 'hs-inner';

    // Logo
    const logo = document.createElement('img');
    logo.className = 'hs-logo';
    logo.src = '/themes/editorial/logo.png';
    logo.alt = 'Vitrine3D';
    logo.onerror = () => { logo.style.display = 'none'; };
    inner.appendChild(logo);

    // Title
    const title = document.createElement('h1');
    title.className = 'hs-title';
    title.textContent = 'Vitrine3D';
    inner.appendChild(title);

    // Subtitle
    const subtitle = document.createElement('p');
    subtitle.className = 'hs-subtitle';
    subtitle.textContent = '3D Archive Viewer';
    inner.appendChild(subtitle);

    // Cards row
    const cards = document.createElement('div');
    cards.className = 'hs-cards';

    // "Browse Library" card — only when server URL is configured
    if (serverUrl) {
        const libraryCard = document.createElement('div');
        libraryCard.className = 'hs-card';
        libraryCard.innerHTML = `
<span class="hs-card-icon">${iconBookshelf()}</span>
<p class="hs-card-label">Browse Library</p>
<p class="hs-card-desc">Connect to server</p>`;
        libraryCard.addEventListener('click', () => {
            log.info('Navigating to library:', serverUrl);
            window.location.href = serverUrl + '/library';
        });
        cards.appendChild(libraryCard);
    }

    // "Open Local File" card — always shown
    const fileCard = document.createElement('div');
    fileCard.className = 'hs-card';
    fileCard.innerHTML = `
<span class="hs-card-icon">${iconFile3D()}</span>
<p class="hs-card-label">Open Local File</p>
<p class="hs-card-desc">.a3d / .a3z archive</p>`;

    // Error display
    const errorEl = document.createElement('p');
    errorEl.className = 'hs-error';

    fileCard.addEventListener('click', async () => {
        errorEl.classList.remove('visible');
        try {
            if (window.__TAURI__) {
                log.info('Opening Tauri file dialog');
                const { openFileDialogPathOnly } = await import('./tauri-bridge.js');
                const result = await openFileDialogPathOnly({
                    filterKey: 'all',
                });
                if (result) {
                    log.info('File selected:', result.name);
                    window.location.href =
                        'index.html?kiosk=true&theme=editorial&tauriFile=' +
                        encodeURIComponent(result.filePath);
                } else {
                    log.info('File dialog cancelled');
                }
            } else {
                // Fallback: browser file input
                log.info('Using browser file input fallback');
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.a3d,.a3z';
                input.style.display = 'none';
                document.body.appendChild(input);
                input.addEventListener('change', () => {
                    const file = input.files?.[0];
                    if (file) {
                        // Store file for kiosk-main to pick up, then navigate
                        (window as any).__PENDING_LOCAL_FILE__ = file;
                        window.location.href =
                            'index.html?kiosk=true&theme=editorial&localFile=1';
                    }
                    document.body.removeChild(input);
                });
                input.click();
            }
        } catch (err) {
            log.error('File open failed:', err);
            const msg = err instanceof Error ? err.message : String(err);
            errorEl.textContent = 'Could not open file: ' + msg;
            errorEl.classList.add('visible');
        }
    });

    cards.appendChild(fileCard);
    inner.appendChild(cards);
    inner.appendChild(errorEl);
    page.appendChild(inner);

    return page;
}

// ── Entry point ──

export async function initHomeScreen(): Promise<boolean> {
    const config = (window as unknown as { APP_CONFIG?: { home?: boolean } }).APP_CONFIG;
    if (!config?.home) return false;

    log.info('Initializing home screen');
    injectStyles();

    // Hide the app shell (same pattern as collection-page, library-page)
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    // Idempotent: skip if already rendered
    if (document.getElementById('home-screen-container')) {
        log.info('Home screen already rendered, skipping');
        return true;
    }

    const serverUrl: string | null =
        (import.meta.env.VITE_APP_LIBRARY_URL as string | undefined) ?? null;

    const page = buildPage(serverUrl || null);
    document.body.appendChild(page);

    document.title = 'Vitrine3D';
    log.info('Home screen ready; serverUrl:', serverUrl ?? '(none)');
    return true;
}
