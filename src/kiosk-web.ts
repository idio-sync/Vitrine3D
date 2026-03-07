// Kiosk bundle entry point — imports viewer layer only.
// For the full editor, see src/editor/index.html → main.ts.
import { initHomeScreen } from './modules/home-screen.js';
import { initLibraryPage } from './modules/library-page.js';
import { initCollectionPage } from './modules/collection-page.js';
import { setCfToken } from './modules/tauri-auth.js';

// Listen for deep-link auth callbacks (Tauri only)
if ((window as any).__TAURI__) {
    // Helper: parse a deep-link URL and dispatch auth event if it's a token callback.
    // Custom URL schemes (vitrine3d://) are parsed as opaque by Chromium/WebView2:
    //   new URL("vitrine3d://auth/?token=x") → hostname="" pathname="//auth/"
    // Additionally, searchParams may be empty for opaque schemes — the query
    // string gets folded into pathname. We extract the token manually.
    function handleDeepLinkUrl(raw: string): void {
        try {
            // Strip surrounding quotes that Windows CLI may add
            const clean = raw.replace(/^["']|["']$/g, '');

            // Check if this is an auth deep link (loose match for opaque parsing)
            if (!clean.includes('auth')) return;

            // Extract token manually — searchParams is unreliable for custom schemes.
            // Look for token= in the raw URL string.
            const tokenMatch = clean.match(/[?&]token=([^&]+)/);
            const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;

            if (token) {
                setCfToken(token);
                window.dispatchEvent(new CustomEvent('vitrine3d:auth', { detail: { token } }));
            }
        } catch (e) {
            console.error('Deep link parse error:', e, 'raw:', raw.substring(0, 100));
        }
    }

    // Strategy 1: deep-link plugin's onOpenUrl (works for first-instance launches)
    import('@tauri-apps/plugin-deep-link').then(({ onOpenUrl }) => {
        onOpenUrl((urls) => { urls.forEach(handleDeepLinkUrl); });
    }).catch(() => { /* deep-link plugin not available */ });

    // Strategy 2: Tauri event from single-instance callback (app.emit)
    import('@tauri-apps/api/event').then(({ listen }) => {
        listen('deep-link-received', (event: any) => {
            if (typeof event.payload === 'string') {
                handleDeepLinkUrl(event.payload);
            }
        });
    }).catch(() => { /* @tauri-apps/api/event not available */ });

    // Strategy 3: global function callable from Rust eval() in single-instance callback.
    // Also handles CustomEvent('vitrine3d:deep-link') dispatched from Rust eval().
    (window as any).__vitrine3dDeepLink = handleDeepLinkUrl;
    window.addEventListener('vitrine3d:deep-link', ((event: CustomEvent) => {
        if (typeof event.detail === 'string') {
            handleDeepLinkUrl(event.detail);
        }
    }) as EventListener);
}

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
                // Normal kiosk viewer — lazy import to avoid loading viewer code for non-viewer pages
                import('./modules/kiosk-main.js').then(m => m.init());
            }
        });
    });
});
