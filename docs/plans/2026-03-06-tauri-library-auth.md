# Tauri Library with CF Access Auth — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the Tauri desktop/Android app browse the archive library in-app, using the system browser only for CF Access authentication.

**Architecture:** The system browser handles CF Access login and redirects a JWT back to the app via `vitrine3d://auth?token=<jwt>` deep link. The app stores the JWT and uses it to call `/api/archives` and `/api/collections`. The existing `library-page.ts` renders the library. Clicking an archive loads it in the local kiosk viewer with a "← Library" button to return.

**Tech Stack:** Tauri v2 deep-link plugin, CF Access JWT, existing library-page.ts + collection-page.ts

---

### Task 1: Add Tauri deep-link plugin (Rust side)

**Files:**
- Modify: `src-tauri/Cargo.toml:14-18`
- Modify: `src-tauri/src/lib.rs:86-98`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/main-window.json`

**Step 1: Add deep-link dependency to Cargo.toml**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
tauri-plugin-deep-link = "2"
```

**Step 2: Register the plugin in lib.rs**

In `src-tauri/src/lib.rs`, add the plugin to the builder chain (before `.run()`):

```rust
.plugin(tauri_plugin_deep_link::init())
```

So the builder becomes:

```rust
tauri::Builder::default()
    .manage(FileHandleStore::default())
    .invoke_handler(tauri::generate_handler![
        ipc_open_file,
        ipc_read_bytes,
        ipc_close_file
    ])
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_deep_link::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

**Step 3: Register URI scheme in tauri.conf.json**

Add `"deep-link"` to the `plugins` object:

```json
"plugins": {
    "deep-link": {
        "desktop": {
            "schemes": ["vitrine3d"]
        },
        "mobile": {
            "schemes": ["vitrine3d"]
        }
    }
}
```

**Step 4: Add deep-link permission to capabilities**

In `src-tauri/capabilities/main-window.json`, add to the `permissions` array:

```json
"deep-link:default"
```

**Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/capabilities/main-window.json
git commit -m "feat(tauri): add deep-link plugin for vitrine3d:// URI scheme"
```

---

### Task 2: Add server auth-callback endpoint

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add the auth-callback handler function**

Add this function near the other route handlers (after `handleLibraryPage` around line 668):

```javascript
/**
 * GET /api/auth-callback — CF Access auth relay for Tauri app.
 * After CF Access authenticates the user, this reads the CF_Authorization
 * JWT cookie and redirects to the vitrine3d:// deep link with the token.
 * Returns a simple HTML page telling the user they can close the tab.
 */
function handleAuthCallback(req, res) {
    // CF Access has already authenticated by this point (requireAuth runs first)
    if (!requireAuth(req, res)) return;

    // Extract CF_Authorization JWT from cookies
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/CF_Authorization=([^;]+)/);
    const token = match ? match[1] : '';

    const deepLink = 'vitrine3d://auth?token=' + encodeURIComponent(token);

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Vitrine3D — Authenticated</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       background: #08182a; color: #e8ecf0; display: flex; align-items: center;
       justify-content: center; height: 100vh; margin: 0; text-align: center; }
.card { max-width: 400px; padding: 40px; }
h1 { font-size: 1.2rem; margin-bottom: 12px; }
p { color: rgba(140,160,180,0.7); font-size: 0.9rem; line-height: 1.5; }
a { color: #FEC03A; text-decoration: none; }
</style>
</head><body><div class="card">
<h1>Authentication Successful</h1>
<p>Returning to Vitrine3D...</p>
<p style="margin-top: 24px; font-size: 0.8rem;">
If the app didn't open, <a href="${deepLink}">click here</a>.</p>
<p style="font-size: 0.75rem; color: rgba(140,160,180,0.4);">You can close this tab.</p>
</div>
<script>window.location.href = ${JSON.stringify(deepLink)};</script>
</body></html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
}
```

**Step 2: Register the route**

Find the route dispatch section (where routes like `/api/archives`, `/library` etc. are matched) and add:

```javascript
if (pathname === '/api/auth-callback') return handleAuthCallback(req, res);
```

Add it near the other `/api/` routes.

**Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(server): add /api/auth-callback endpoint for Tauri deep-link auth"
```

---

### Task 3: Create tauri-auth module

**Files:**
- Create: `src/modules/tauri-auth.ts`

**Step 1: Write the module**

```typescript
/**
 * Tauri Auth Module
 *
 * Stores the CF Access JWT obtained via deep-link auth flow.
 * Provides cfAuthFetch() which wraps fetch() with the JWT header
 * and prepends the library base URL for relative paths.
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('tauri-auth');

let cfToken: string | null = null;

const libraryBaseUrl = (import.meta.env.VITE_APP_LIBRARY_URL as string | undefined) || '';

export function setCfToken(token: string): void {
    cfToken = token;
    log.info('CF Access token stored');
}

export function getCfToken(): string | null {
    return cfToken;
}

export function hasCfToken(): boolean {
    return cfToken !== null && cfToken.length > 0;
}

export function clearCfToken(): void {
    cfToken = null;
    log.info('CF Access token cleared');
}

/**
 * Fetch wrapper that adds the CF Access JWT header and prepends
 * the library base URL for relative paths (e.g. /api/archives).
 * Falls back to plain fetch when no token is stored.
 */
export async function cfAuthFetch(url: string, opts: RequestInit = {}): Promise<Response> {
    // Prepend base URL for relative paths when we have a library URL
    const fullUrl = (url.startsWith('/') && libraryBaseUrl) ? libraryBaseUrl + url : url;

    const headers: Record<string, string> = {
        ...(opts.headers as Record<string, string> || {}),
    };
    if (cfToken) {
        headers['Cf-Access-Jwt-Assertion'] = cfToken;
    }

    const res = await fetch(fullUrl, { ...opts, headers });

    // If 401, token may have expired — clear it
    if (res.status === 401 && cfToken) {
        log.warn('API returned 401 — clearing expired CF token');
        clearCfToken();
    }

    return res;
}

/** Returns the configured library base URL (e.g. https://jakemarino.fyi) */
export function getLibraryBaseUrl(): string {
    return libraryBaseUrl;
}
```

**Step 2: Commit**

```bash
git add src/modules/tauri-auth.ts
git commit -m "feat: add tauri-auth module for CF Access JWT storage and fetch"
```

---

### Task 4: Make library-page.ts use cfAuthFetch

**Files:**
- Modify: `src/modules/library-page.ts:1-10` (imports)
- Modify: `src/modules/library-page.ts:62-72` (fetch functions)

**Step 1: Add import**

At the top of `library-page.ts`, add:

```typescript
import { cfAuthFetch } from './tauri-auth.js';
```

**Step 2: Replace fetch calls with cfAuthFetch**

Replace the `fetchArchives` function (lines 62-66):

```typescript
async function fetchArchives(): Promise<ArchivesResponse> {
    const res = await cfAuthFetch('/api/archives');
    if (!res.ok) throw new Error('Failed to fetch archives (' + res.status + ')');
    return res.json();
}
```

Replace the `fetchCollections` function (lines 68-72):

```typescript
async function fetchCollections(): Promise<CollectionItem[]> {
    const res = await cfAuthFetch('/api/collections');
    if (!res.ok) throw new Error('Failed to fetch collections (' + res.status + ')');
    return res.json();
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add src/modules/library-page.ts
git commit -m "feat(library-page): use cfAuthFetch for authenticated API calls"
```

---

### Task 5: Make archive cards Tauri-aware

**Files:**
- Modify: `src/modules/collection-page.ts:396-438` (renderCard)
- Modify: `src/modules/library-page.ts:476-478` (card click in grid)

The `renderCard()` function in `collection-page.ts` creates `<a>` tags with `href` pointing to the server viewer URL. In Tauri, we need to intercept clicks to load archives locally instead.

**Step 1: Add an onCardClick callback to renderCard**

Modify `renderCard` in `collection-page.ts` to accept an optional click handler:

```typescript
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

    // If a click handler is provided, intercept navigation
    if (onCardClick) {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            onCardClick(archive);
        });
    }

    // ... rest of the function unchanged (thumbnail, innerHTML, etc.)
```

Only add the `onCardClick` parameter and the event listener block. Keep all existing innerHTML generation unchanged.

**Step 2: Pass the callback in library-page.ts**

In `library-page.ts`, add a module-level callback variable and a public setter:

```typescript
let _onArchiveSelect: ((archive: CollectionArchive) => void) | null = null;

/** Set a callback invoked when the user clicks an archive card (used by Tauri kiosk). */
export function setOnArchiveSelect(cb: (archive: CollectionArchive) => void): void {
    _onArchiveSelect = cb;
}
```

Add the import for CollectionArchive if not already present (it is — via `collection-page.js`).

Then in `refreshArchiveGrid()` (around line 476), pass the callback:

```typescript
filtered.forEach((archive, i) => {
    gridEl!.appendChild(renderCard(archive, i, _onArchiveSelect || undefined));
});
```

Also update the `initCollectionPage` in `collection-page.ts` to pass undefined (preserving existing behavior):

```typescript
grid.appendChild(renderCard(archive, i));  // no change needed — parameter is optional
```

**Step 3: Export CollectionArchive type from library-page.ts**

Add a re-export so kiosk-main can use the type:

```typescript
export type { CollectionArchive } from './collection-page.js';
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add src/modules/collection-page.ts src/modules/library-page.ts
git commit -m "feat(library): add onCardClick callback for Tauri archive loading"
```

---

### Task 6: Wire up kiosk-main for library + deep link

**Files:**
- Modify: `src/modules/kiosk-main.ts:609-647` (createFilePicker / library button)
- Modify: `src/modules/kiosk-main.ts` (add library show/hide and back button)
- Modify: `src/modules/kiosk-web.ts` (deep link listener)

This is the largest task. It connects everything together.

**Step 1: Add deep-link listener in kiosk-web.ts**

Replace `src/kiosk-web.ts` with:

```typescript
// Kiosk bundle entry point — imports viewer layer only.
// For the full editor, see src/editor/index.html → main.ts.
import { initHomeScreen } from './modules/home-screen.js';
import { initLibraryPage } from './modules/library-page.js';
import { initCollectionPage } from './modules/collection-page.js';
import { setCfToken, hasCfToken } from './modules/tauri-auth.js';

// Listen for deep-link auth callbacks (Tauri only)
if (window.__TAURI__) {
    import('@tauri-apps/plugin-deep-link').then(({ onOpenUrl }) => {
        onOpenUrl((urls) => {
            for (const raw of urls) {
                try {
                    const url = new URL(raw);
                    if (url.hostname === 'auth' || url.pathname === '/auth') {
                        const token = url.searchParams.get('token');
                        if (token) {
                            setCfToken(token);
                            // Dispatch custom event so kiosk-main can react
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
```

**Step 2: Modify the "Browse Library" button in kiosk-main.ts**

In `createFilePicker()` (around line 638-646), replace the library button click handler:

```typescript
// Wire up library button
if (showLibrary) {
    const libraryBtn = picker.querySelector('#kiosk-library-btn');
    if (libraryBtn) {
        libraryBtn.addEventListener('click', async () => {
            if (hasCfToken()) {
                await showLibrary_();
            } else {
                // Open system browser for CF Access login
                log.info('Opening browser for CF Access auth');
                const authUrl = libraryUrl + '/api/auth-callback';
                if (window.__TAURI__) {
                    const { open } = await import('@tauri-apps/plugin-shell');
                    await open(authUrl);
                } else {
                    window.location.href = libraryUrl + '/library';
                }
            }
        });

        // Listen for auth callback from deep link
        window.addEventListener('vitrine3d:auth', () => {
            showLibrary_();
        }, { once: true });
    }
}
```

Add the required imports at the top of kiosk-main.ts:

```typescript
import { hasCfToken } from './tauri-auth.js';
import { initLibraryPage, setOnArchiveSelect } from './library-page.js';
import type { CollectionArchive } from './collection-page.js';
```

**Step 3: Add showLibrary_ and returnToLibrary functions in kiosk-main.ts**

Add these functions (near the bottom of the file, before `export function init()`):

```typescript
// ── Library integration ──

let _launchedFromLibrary = false;

async function showLibrary_(): Promise<void> {
    log.info('Showing in-app library');

    // Set the flag so library-page.ts activates
    const config = window.APP_CONFIG || {};
    (config as Record<string, unknown>).library = true;

    // Set up card click handler before init
    setOnArchiveSelect((archive: CollectionArchive) => {
        _launchedFromLibrary = true;
        const archiveUrl = archive.path;  // public URL like /archives/abc.a3z
        const libraryBaseUrl = (import.meta.env.VITE_APP_LIBRARY_URL as string) || '';
        const fullUrl = archiveUrl.startsWith('http') ? archiveUrl : libraryBaseUrl + archiveUrl;

        // Hide library, show viewer
        const libContainer = document.getElementById('library-container');
        if (libContainer) libContainer.style.display = 'none';
        const app = document.getElementById('app');
        if (app) app.style.display = '';

        // Show back button
        const backBtn = document.getElementById('kiosk-back-library');
        if (backBtn) backBtn.classList.remove('hidden');

        // Hide the file picker
        const picker = document.getElementById('kiosk-file-picker');
        if (picker) picker.classList.add('hidden');

        // Load the archive
        log.info('Loading archive from library:', fullUrl);
        loadArchiveFromUrl(fullUrl);
    });

    await initLibraryPage();
}

function returnToLibrary(): void {
    log.info('Returning to library');
    _launchedFromLibrary = false;

    // Hide back button
    const backBtn = document.getElementById('kiosk-back-library');
    if (backBtn) backBtn.classList.add('hidden');

    // Hide viewer app, show library
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    const libContainer = document.getElementById('library-container');
    if (libContainer) libContainer.style.display = '';

    // Dispose current scene
    disposeCurrentScene();
}
```

Note: `loadArchiveFromUrl` and `disposeCurrentScene` — check what functions already exist in kiosk-main.ts for loading archives by URL and cleaning up. The exact function names may differ. Use the existing archive-loading path that handles URL-based loading (the same one used for `?archive=` URL param).

**Step 4: Create the back-to-library button**

In the `setupViewerUI()` function (or wherever kiosk UI elements are created dynamically), add:

```typescript
const backBtn = document.createElement('button');
backBtn.id = 'kiosk-back-library';
backBtn.className = 'kiosk-back-library hidden';
backBtn.innerHTML = '← Library';
backBtn.addEventListener('click', returnToLibrary);
document.body.appendChild(backBtn);
```

**Step 5: Add CSS for the back button**

Add to `src/kiosk.css`:

```css
.kiosk-back-library {
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 1000;
    background: rgba(8, 24, 42, 0.85);
    border: 1px solid rgba(254, 192, 58, 0.2);
    color: rgba(232, 236, 240, 0.9);
    font-family: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    padding: 8px 16px;
    cursor: pointer;
    transition: border-color 0.2s ease, background 0.2s ease;
    backdrop-filter: blur(8px);
}

.kiosk-back-library:hover {
    border-color: rgba(254, 192, 58, 0.4);
    background: rgba(8, 24, 42, 0.95);
}
```

**Step 6: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add src/kiosk-web.ts src/modules/kiosk-main.ts src/kiosk.css
git commit -m "feat(kiosk): wire up in-app library with deep-link auth and back button"
```

---

### Task 7: Add @tauri-apps/plugin-deep-link and @tauri-apps/plugin-shell npm packages

**Files:**
- Modify: `package.json`

**Step 1: Install the npm packages**

```bash
npm install @tauri-apps/plugin-deep-link @tauri-apps/plugin-shell
```

Note: `@tauri-apps/plugin-shell` may already be installed (check package.json first). Only install what's missing.

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @tauri-apps/plugin-deep-link npm package"
```

---

### Task 8: Integration test — verify full build

**Step 1: Run the Vite build**

```bash
npm run build
```

Expected: Build succeeds with no errors (warnings about chunk size are OK).

**Step 2: Run existing tests**

```bash
npm test
```

Expected: All existing tests pass (the new code doesn't break URL validation, theme loading, etc.).

**Step 3: Run lint**

```bash
npm run lint
```

Expected: 0 errors.

**Step 4: Final commit if any fixes needed**

Fix any lint/build issues discovered and commit.

---

## Execution Notes

- **Task 7 should run before Task 6** (npm packages need to be installed before the imports work in the build).
- **Tasks 1-3 are independent** and can be done in any order.
- **Task 4 depends on Task 3** (tauri-auth.ts must exist).
- **Task 5 depends on Task 4** (library-page needs cfAuthFetch).
- **Task 6 depends on Tasks 3, 5, and 7** (kiosk-main needs tauri-auth, library-page callbacks, and npm packages).
- The exact function names for loading archives and disposing scenes in kiosk-main.ts need to be verified by reading the file. Look for the `?archive=` URL param handling path in `init()`.
