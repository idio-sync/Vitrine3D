# Tauri Library with CF Access Auth — Design

## Problem

The Tauri desktop/Android app has a "Browse Library" button on the kiosk home screen, but the library API (`/api/archives`, `/api/collections`) is behind Cloudflare Access auth. The Tauri app has no way to authenticate, so the library can't load.

## Solution

Use the system browser for CF Access login only. Pass the JWT back to the Tauri app via deep link (`vitrine3d://`). The app stores the token and uses it for authenticated API calls to render the library in-app using the existing `library-page.ts`.

## Flow

```
Tauri App                     System Browser                  Server
─────────                     ──────────────                  ──────
"Browse Library" click
  → No JWT? shell.open() ──→ jakemarino.fyi/api/auth-callback
                               CF Access login (IdP)
                               Server reads CF_Authorization cookie
                             ← vitrine3d://auth?token=<jwt>
Deep link received
  → Store JWT in memory
  → library-page.ts fetches
    /api/archives + /api/collections
    with Cf-Access-Jwt-Assertion header
  → Library renders in-app (editorial grid)
  → User clicks archive card
  → Load archive (public URL) in local kiosk viewer
  → "← Library" button shown in toolbar
  → Click returns to library (DOM preserved, no re-fetch)
```

## Changes

### 1. Tauri deep-link plugin

**Files:** `Cargo.toml`, `lib.rs`, `tauri.conf.json`, `main-window.json`

- Add `tauri-plugin-deep-link` dependency
- Register `vitrine3d://` URI scheme
- Add deep-link permission to capabilities

### 2. Server auth-callback endpoint

**File:** `docker/meta-server.js`

New `GET /api/auth-callback`:
- Behind CF Access (auth happens before request reaches handler)
- Reads `CF_Authorization` cookie from the request
- Redirects to `vitrine3d://auth?token=<jwt>`
- Returns a simple HTML page: "Authentication successful. You can close this tab."

### 3. Auth token storage module

**New file:** `src/modules/tauri-auth.ts`

- `setCfToken(token: string)` — store JWT in memory
- `getCfToken(): string | null` — retrieve stored JWT
- `hasCfToken(): boolean`
- `cfAuthFetch(url: string, opts?: RequestInit): Promise<Response>` — wraps `fetch()`, adds `Cf-Access-Jwt-Assertion` header when token is available. Prepends `VITE_APP_LIBRARY_URL` base to relative URLs.

### 4. Library page: Tauri-aware fetching

**File:** `src/modules/library-page.ts`

- Import `cfAuthFetch` from `tauri-auth.ts`
- Replace `fetch('/api/archives')` and `fetch('/api/collections')` with `cfAuthFetch()`
- `cfAuthFetch` prepends the library base URL and adds the JWT header when in Tauri

### 5. Library page: card click behavior in Tauri

**Files:** `src/modules/library-page.ts`, `src/modules/collection-page.ts`

- When running in Tauri (`window.__TAURI__`), intercept archive card clicks
- Instead of navigating to the server viewer URL, call a callback to load the archive in the local kiosk viewer
- Pass the public archive URL (e.g., `https://jakemarino.fyi/archives/abc123.a3z`)

### 6. Kiosk main: library integration

**File:** `src/modules/kiosk-main.ts`

- "Browse Library" button logic:
  - If JWT exists → set `APP_CONFIG.library = true`, call `initLibraryPage()`
  - If no JWT → `shell.open(libraryUrl + '/api/auth-callback')` to trigger browser auth
- Deep link handler: on `vitrine3d://auth?token=...` → store token, then show library
- Archive load from library: hide library container, show kiosk viewer, load archive by URL
- "← Library" button: shown in kiosk toolbar when navigated from library. Hides viewer, restores library container (DOM preserved, no re-fetch).

### 7. Back to library button

**File:** `src/modules/kiosk-main.ts`, `src/index.html`

- Add a `← Library` button element (hidden by default)
- Show it when an archive is loaded from the in-app library
- On click: dispose current scene, hide viewer, show library container
- Hide it when archive is loaded from file picker or deep link (non-library source)

## What stays the same

- `library-page.ts` UI and styling — reused as-is
- `library-panel.ts` (editor) — unchanged
- CF Access configuration — unchanged
- Archive files fetched via plain public HTTP (no auth needed)
- Non-Tauri builds unaffected — `cfAuthFetch` falls back to plain `fetch`

## Edge cases

- **JWT expiry:** CF Access JWTs expire (default 24h). If an API call returns 401, clear stored token and re-trigger browser auth flow.
- **App not installed:** `vitrine3d://` link goes nowhere in the browser. The auth-callback page should show a message and the deep link as a fallback.
- **Android:** Tauri deep-link plugin supports Android via intent filters. The `vitrine3d://` scheme works the same way.
