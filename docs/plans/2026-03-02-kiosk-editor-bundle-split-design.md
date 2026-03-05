# Design: Kiosk / Editor Bundle Split

**Date:** 2026-03-02
**Status:** Approved
**Scope:** Vite build split only — auth is a follow-on task

---

## Problem

The current build produces a single bundle served at `/`. The kiosk viewer (public-facing) and the editor (internal authoring tool) share the same entry point, HTML, and JavaScript bundle. This means:

- Public clients download the full editor bundle including archive-creator, export-controller, library-panel, and all authoring tools they will never use.
- There is no clean separation point at which to add authentication to the editor in the future.
- `?kiosk=true` is a runtime toggle, not a build-time separation.

---

## Goals

1. Produce two separate Vite bundles from one `npm run build`.
2. Public kiosk at `/` — minimal viewer bundle (no editor code).
3. Editor at `/editor/` — full current functionality, unchanged behaviour.
4. Establish `kiosk-main.ts` as the canonical shared viewer layer so new viewer features only need to be written once.
5. Fix the three known duplicated functions between `main.ts` and `kiosk-main.ts`.
6. Preserve full editorial theme functionality.
7. Leave a clean seam for adding `auth_basic` to the `/editor/` nginx location in a future task.

---

## Architecture

### Two Vite Entry Points, One Build

```
rollupOptions.input:
  kiosk:  src/kiosk.html   →  dist/index.html         (served at /)
  editor: src/editor/index.html  →  dist/editor/index.html  (served at /editor/)
```

Both entries share Three.js, Spark.js, and fflate via Rollup's automatic chunk splitting. The shared renderer (~4 MB) is cached across both bundles.

### Output Structure

```
dist/
  index.html                ← kiosk bundle
  editor/
    index.html              ← editor bundle
    config.js               ← copied by copyRuntimeAssets()
    pre-module.js
    styles.css
    kiosk.css
  assets/
    kiosk-[hash].js         ← viewer-only JS
    editor-[hash].js        ← full editor JS
    shared-[hash].js        ← Three.js + Spark (shared chunk)
  themes/                   ← runtime-fetched by theme-loader
  modules/                  ← kiosk raw files for offline viewer generation
  config.js
  pre-module.js
  styles.css
  kiosk.css
  occt-import-js.wasm
```

### Shared Viewer Layer

`kiosk-main.ts` is the canonical viewer layer. `main.ts` already delegates to it via dynamic import for kiosk mode (line 1835). After the split, the kiosk bundle calls it directly.

```
kiosk-web.ts  ──→  kiosk-main.ts  (shared viewer layer)
                        ↑
main.ts (editor) ──→  delegates here for /editor/ kiosk preview
                  +   adds editor-only modules on top
```

**Convention for new features:**

| Feature type | Written in | Available in |
|---|---|---|
| New asset type (viewer display) | `kiosk-main.ts` or shared module | Both bundles |
| Display option, measurement, annotation | `kiosk-main.ts` | Both bundles |
| Archive authoring, export, library | `main.ts` only | Editor only |
| Transform / alignment tools | `main.ts` only | Editor only |

---

## Bundle Composition

### Kiosk bundle — modules included

| Module | Notes |
|---|---|
| `kiosk-main.ts` | Entry delegate — viewer init, theme, archive loading |
| `scene-manager.ts` | Three.js scene/camera/renderer/controls |
| `file-handlers.ts` | Asset loading (splat, mesh, point cloud) |
| `archive-loader.ts` | ZIP extraction, manifest parsing |
| `archive-pipeline.ts` | Archive loading pipeline |
| `annotation-system.ts`, `annotation-controller.ts` | 3D annotation placement |
| `measurement-system.ts` | Point-to-point distance tool |
| `cross-section.ts` | Cutting plane tool |
| `cad-loader.ts` | STEP/IGES CAD display (added — see §CAD gap below) |
| `walkthrough-engine.ts`, `walkthrough-controller.ts` | Playback only |
| `fly-controls.ts` | WASD first-person camera |
| `quality-tier.ts` | SD/HD detection and switching |
| `theme-loader.ts` | Runtime CSS/layout theme loading |
| `metadata-manager.ts` | Display-only metadata sidebar |
| `metadata-profile.ts` | Metadata schema definitions |
| `ui-controller.ts` | Loading overlay, display-mode helpers |
| `asset-store.ts` | Blob reference store |
| `constants.ts`, `utilities.ts`, `logger.ts` | Shared utilities |
| `url-validation.ts` | URL allow-list validation |

### Editor bundle — additional modules (kiosk modules + these)

| Module | Notes |
|---|---|
| `archive-creator.ts` | ZIP creation, SHA-256, screenshot |
| `export-controller.ts` | Archive export, metadata manifests |
| `library-panel.ts` | Server-side archive browser |
| `share-dialog.ts` | Share link builder |
| `transform-controller.ts` | Transform gizmo |
| `alignment.ts` | KD-tree, ICP, auto-align |
| `screenshot-manager.ts` | Screenshot capture and list |
| `source-files-manager.ts` | Source file list UI |
| `walkthrough-editor.ts` | Walkthrough authoring |
| `file-input-handlers.ts` | File input events, URL prompts |
| `event-wiring.ts` | Full editor UI event binding |
| `sip-validator.ts` | SIP compliance validation |
| `map-picker.ts` | Geolocation map picker |
| `kiosk-viewer.ts` | Offline HTML generator (deprecated but present) |
| `tauri-bridge.ts` | Native dialog integration |

---

## Files to Create / Modify

### New files

**`src/kiosk.html`**
New root HTML entry. Mirrors the kiosk-mode DOM from `index.html` — editor-only panels (source-file inputs, export controls) removed. Sets `kiosk-mode` on `<body>` unconditionally. Links `./config.js`, `./pre-module.js`, `./styles.css`, `./kiosk.css`. Module script: `./kiosk-web.ts`.

**`src/kiosk-web.ts`**
Thin Vite entry point:
```ts
import { init } from './modules/kiosk-main.js';
init();
```
Vite tree-shakes from here. No editor imports are reachable from this entry.

**`src/editor/index.html`**
Copy of current `src/index.html` with paths adjusted: `./config.js` → `../config.js` etc. (or kept as `./` if scripts are also copied to `dist/editor/` — see §Path resolution below). Module script: `../main.ts`.

### Modified files

| File | Change |
|---|---|
| `vite.config.ts` | Add `kiosk: resolve(__dirname, 'src/kiosk.html')` and `editor: resolve(__dirname, 'src/editor/index.html')` to `rollupOptions.input`; remove old single `main` entry |
| `vite.config.ts` `copyRuntimeAssets()` | Also copy `config.js`, `pre-module.js`, `styles.css`, `kiosk.css` into `dist/editor/` so both entries use `./` relative paths |
| `src/modules/kiosk-main.ts` | Add `cad-loader` import + CAD file display wiring |
| `src/modules/kiosk-main.ts` | Consolidate 3 duplicated functions (see §Deduplication) |
| `src/main.ts` | Remove duplicate implementations of the 3 consolidated functions; import from `metadata-manager.ts` |
| `docker/nginx.conf.template` | Add `location /editor/` block |
| `docker/nginx.conf` | Add `location /editor/` block (local dev) |
| `docker/docker-entrypoint.sh` | Update `KIOSK_LOCK` module-blocking paths; add note that it is now redundant |
| `src-tauri/tauri.conf.json` | Update `devUrl` to `http://localhost:8080/?theme=editorial` (drop `?kiosk=true`); update `url` to `index.html?theme=editorial` |
| `scripts/build-branded.mjs` | Audit and update for two-entry build structure |

---

## Key Implementation Details

### Path resolution for non-bundled scripts

`config.js`, `pre-module.js`, `styles.css`, `kiosk.css` are not Vite-bundled — they are copied by `copyRuntimeAssets()`. To avoid different relative paths in `kiosk.html` (`./`) vs `editor/index.html` (`../`), `copyRuntimeAssets()` copies them into both `dist/` and `dist/editor/`. Both HTML files use `./` paths. No source HTML changes.

### CAD gap in kiosk-main.ts

`kiosk-main.ts` does not currently import `cad-loader.ts`. The user confirmed CAD files must display in kiosk mode. Implementation must add the import and wire up CAD asset loading/display within `kiosk-main.ts`, following the same pattern used for mesh and splat assets.

### Deduplication of three functions

CLAUDE.md documents three functions duplicated between `main.ts` and `kiosk-main.ts`:
- `populateMetadataDisplay`
- `showAnnotationPopup`
- `setupMetadataSidebar`

Both files currently maintain local copies rather than importing from `metadata-manager.ts`. As part of this work, both files should import these from `metadata-manager.ts`. This is the direct fix for the maintenance concern ("will we have to edit both?").

### Editorial theme — no changes required

The editorial theme is fully contained within `kiosk-main.ts` + `theme-loader.ts`:
- `theme-loader.ts` resolves theme paths via `document.baseURI`
- Kiosk at `/` → `document.baseURI = http://host/` → `themes/editorial/` resolves to `dist/themes/editorial/` ✓
- `layout.js` uses no ES imports; all deps passed via object ✓
- `themes/` directory already copied to `dist/themes/` by `copyRuntimeAssets()` ✓

### nginx routing

```nginx
# Kiosk — public, SPA fallback
location / {
    try_files $uri $uri/ /index.html;
}

# Editor — full app, SPA fallback
# Future: add auth_basic block here to gate it
location /editor/ {
    try_files $uri $uri/ /editor/index.html;
}
```

Add to both `docker/nginx.conf` and `docker/nginx.conf.template`.

### KIOSK_LOCK becomes redundant

The `KIOSK_LOCK` env var blocks editor module files at the nginx layer. After the split the kiosk bundle genuinely does not include those modules — they are never built into the kiosk JS. `KIOSK_LOCK` can remain in `docker-entrypoint.sh` for backwards compatibility but should be documented as superseded.

### Tauri

| Setting | Current | After split |
|---|---|---|
| `devUrl` | `http://localhost:8080/?kiosk=true&theme=editorial` | `http://localhost:8080/?theme=editorial` |
| `url` | `index.html?kiosk=true&theme=editorial` | `index.html?theme=editorial` |

`dist/index.html` is now the kiosk bundle directly. `?kiosk=true` is no longer needed. `?theme=editorial` continues to work via `config.js` → `APP_CONFIG.theme` → `kiosk-main.ts` → `loadTheme()`.

---

## What Does Not Change

- `src/main.ts` — all editor functionality unchanged
- `src/index.html` → moved to `src/editor/index.html` with minor path adjustments
- All 38 modules in `src/modules/` — no behaviour changes (only `kiosk-main.ts` gets CAD wiring and deduplication)
- Docker image — `COPY dist/` already copies everything
- CSP — unchanged
- Admin panel, OG meta server, clean `/view/` URLs — all unaffected
- Test suite — tests cover URL validation, archive loading, theme parsing; no changes needed
- `KIOSK_MODULES` list in `vite.config.ts` — unchanged (offline viewer generation unaffected)

---

## Follow-on Tasks (Out of Scope for This Plan)

- **Auth gate**: Add `auth_basic` to the `/editor/` nginx location block with `EDITOR_PASS` env var, mirroring the existing `ADMIN_PASS` pattern.
- **Simplify `kiosk.html` DOM**: Remove editor-only DOM nodes that are currently hidden via CSS; requires auditing all `getElementById` calls in `kiosk-main.ts`.
- **Editor uses kiosk-main as base**: Deeper consolidation — editor mode calls `kiosk-main.init()` then layering authoring tools on top. Significant `main.ts` refactor; not needed for the bundle split.
