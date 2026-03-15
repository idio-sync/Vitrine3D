# Library Browser + Tauri Home Screen

**Date**: 2026-03-05
**Status**: Design approved, pending implementation

## Problem

The server stores an archive library accessible only through the editor's library panel (requires `ADMIN_ENABLED` + Docker). There's no standalone, browsable view of the full library that works in a browser or the Tauri desktop app. Collections exist but are individual pages — there's no unified entry point to browse everything.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Entry point | New `/library` server route | Reusable from any browser + Tauri webview |
| Auth | CF Access (same as `/admin`) | Not publicly accessible; consistent with existing admin gating |
| UI pattern | Mirrors collection page editorial style | Maximum code reuse; consistent design language |
| Content | Tabbed: "All Archives" + "Collections" | Single entry point for all browsable content |
| Filters | Search + sort + asset type pills | Requested scope; client-side filtering on fetched data |
| Desktop | Tauri home screen with Library + Local File options | Clean entry point; library only shown when server URL configured |
| Server URL | `VITE_SERVER_URL` env var | Build-time config; no runtime UI needed |

## Architecture

### Server: `GET /library`

New route in `meta-server.js`, gated behind `ADMIN_ENABLED` + CF Access (identical to `/admin` middleware). Serves `index.html` with injected globals:

```js
window.__VITRINE_LIBRARY = true;
// Also sets kiosk=true, theme=editorial via query params or injection
```

No new API endpoints needed — consumes existing:
- `GET /api/archives` — full archive list with metadata
- `GET /api/collections` — all collections with archive counts

### Boot Sequence

`kiosk-web.ts` flow becomes:

```
initLibraryPage() → initCollectionPage() → init kiosk viewer
```

`initLibraryPage()` checks `window.__VITRINE_LIBRARY`. If `true`, renders library and returns `true`, short-circuiting the rest.

### Library Page (`library-page.ts`)

Full-page editorial view with two tabs:

**Tab: "All Archives"** (default)
- Fetches `/api/archives`
- Filter bar: text search (title/filename), sort toggle (Name/Date/Size), asset type pill filters (Splat, Mesh, Point Cloud, CAD, Drawing)
- Card grid: thumbnail, title, asset type pills, date, size
- Card click → navigates to `/?archive=/archives/{file}&autoload=true`

**Tab: "Collections"**
- Fetches `/api/collections`
- Card grid: collection thumbnail, name, description excerpt, archive count
- Card click → navigates to `/collection/:slug`
- No filter bar (collections tab is just the grid)

Tab styling: gold underline on active tab, positioned below header above content area.

### Shared Code Extraction

Export from `collection-page.ts` for reuse:
- `formatBytes()`, `escapeHtml()`, `formatDate()`, `ASSET_LABELS`
- `renderCard()` (archive card component)
- Editorial base CSS (`.cp-page`, `.cp-spine`, `.cp-header`, `.cp-card`, etc.)

Library page imports these and adds: tab bar, filter bar, collection card renderer.

### Tauri Home Screen

New local page (bundled in Vite build) replacing the current direct-to-kiosk launch:

- Editorial design language (navy + gold, logo)
- **"Browse Library"** — visible when `VITE_SERVER_URL` is set. Navigates Tauri webview to `{VITE_SERVER_URL}/library`
- **"Open Local File"** — opens native Tauri file dialog, loads archive into kiosk viewer
- When `VITE_SERVER_URL` is not set, only "Open Local File" appears

`tauri.conf.json` window URL updated to point to home screen.

### Config Changes

- `src/config.js`: read `window.__VITRINE_LIBRARY` into `APP_CONFIG.library`
- `vite.config.ts`: `VITE_SERVER_URL` exposed automatically (Vite `VITE_` prefix convention)

## Files Changed

| File | Change |
|---|---|
| `docker/meta-server.js` | Add `GET /library` route (CF Access gated, injects `__VITRINE_LIBRARY`) |
| `src/modules/library-page.ts` | **New** — tabbed library view (archives + collections), filter bar |
| `src/modules/collection-page.ts` | Export shared helpers & card styles for reuse |
| `src/kiosk-web.ts` | Add `initLibraryPage()` check before collection check |
| `src/config.js` | Read `__VITRINE_LIBRARY` into `APP_CONFIG` |
| `src/index.html` | Add home screen markup (activated by `?home=true` param) |
| `src-tauri/tauri.conf.json` | Update window URL to home screen |

## Not Changed

- Editor (`main.ts`, `editor/index.html`) — untouched
- Existing collection page behavior — untouched
- Archive loading pipelines — untouched
- Existing kiosk viewer — untouched
