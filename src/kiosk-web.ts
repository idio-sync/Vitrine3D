// Kiosk bundle entry point — imports viewer layer only.
// For the full editor, see src/editor/index.html → main.ts.
import { initHomeScreen } from './modules/home-screen.js';
import { initLibraryPage } from './modules/library-page.js';
import { initCollectionPage } from './modules/collection-page.js';
import { setCfToken } from './modules/tauri-auth.js';

// Listen for deep-link auth callbacks (Tauri only)
if ((window as any).__TAURI__) {
    import('@tauri-apps/plugin-deep-link').then(({ onOpenUrl }) => {
        onOpenUrl((urls) => {
            for (const raw of urls) {
                try {
                    const url = new URL(raw);
                    if (url.hostname === 'auth' || url.pathname === '/auth') {
                        const token = url.searchParams.get('token');
                        if (token) {
                            setCfToken(token);
                            window.dispatchEvent(new CustomEvent('vitrine3d:auth', { detail: { token } }));
                        }
                    }
                } catch { /* ignore malformed URLs */ }
            }
        });
    }).catch(() => { /* deep-link plugin not available */ });
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
