# CLAUDE.md — Vitrine3D

## What This Project Is

A browser-based 3D viewer for assembling and delivering scan data — Gaussian splats, meshes (GLB/OBJ), and E57 point clouds — together or individually, without losing real-world spatial context. Built as an alternative to Sketchfab for a 3D scanning company's deliverables pipeline.

Two entry points, built as separate Vite bundles:
- **Editor** (`src/editor/index.html` → `/editor/`): Internal tool for composing scenes — load assets, align them spatially, add annotations, fill in metadata, and export as a `.ddim` archive (Direct Dimensions format) or `.vdim` (protected, XOR-scrambled). Legacy `.a3d`/`.a3z` archives are still accepted on import.
- **Kiosk** (`src/index.html` → `/`): Client-facing viewer. Loads archives via URL params, applies themes (Editorial, Gallery, Exhibit), supports camera constraints and annotations. Entry point is `kiosk-web.ts` → `kiosk-main.ts`.

## Tech Stack & Constraints

- **Vite + TypeScript (hybrid).** Vite serves `src/` in dev and bundles to `dist/` for production. TypeScript configured with `allowJs: true` — existing `.js` files work unchanged, new modules written as `.ts`.
- **ES modules only.** Bare specifiers (`'three'`, `'fflate'`, etc.) resolved by Vite from `node_modules/`.
- **Runtime dependencies** installed via npm. Pinned versions:
  - Three.js 0.183.2
  - Spark.js 2.0.0-preview (Gaussian splat renderer, vendored in `src/vendor/`)
  - fflate 0.8.2 (ZIP compression)
  - three-e57-loader 1.2.0 / web-e57 1.2.0 (E57 point clouds, WASM)
- **Docker deployment** via multi-stage build (api-deps + nginx:alpine). s6-overlay supervises nginx + Node API (meta-server.js). SQLite for metadata storage, CF Access for auth, busboy for uploads.
- **Tauri v2** for desktop and Android builds. `src-tauri/` scaffold with Cargo.toml, capabilities, etc. Android scaffold generated in CI (not committed).
  - **Two Tauri app variants** configured via separate JSON files:
    - **Vitrine3D** (`tauri.conf.json`): Editorial theme, `home=true` — shows picker with "Browse Files" + "Browse Collections"
    - **PASS Viewer** (`tauri.pass.conf.json`): Industrial theme, no `home` — shows full industrial UI with File > Open menu

## Project Structure

```
src/
  index.html              Kiosk entry point (~570 lines, stripped of editor UI)
  kiosk-web.ts            Kiosk bundle entry — imports kiosk-main.ts
  editor/
    index.html            Editor entry point (~2,230 lines, full UI)
  config.js               IIFE (non-module). Parses URL params, sets window.APP_CONFIG
  pre-module.js           Error watchdog. Loaded before ES modules
  main.ts                 Editor app controller / glue layer (~1,900 lines)
  types.ts                Shared TypeScript types (AppState, SceneRefs, deps interfaces)
  styles.css              All CSS (~5,000 lines)
  modules/
    constants.js          Shared config values (camera, lighting, timing, extensions)
    utilities.js          Logger, notify(), mesh helpers, disposeObject(), fetchWithProgress()
    logger.ts             Standalone Logger class (extracted from utilities)
    scene-manager.ts      Three.js scene/camera/renderer/controls/lighting setup
    ui-controller.ts      Loading overlay, display-mode helpers, addListener()
    file-handlers.ts      Asset loading: splat, mesh, point cloud, archive
    file-input-handlers.ts File input events, URL prompts, URL loaders, Tauri dialogs
    archive-loader.ts     ZIP extraction, manifest parsing, filename sanitization
    archive-creator.ts    Archive creation, SHA-256 hashing, screenshot capture
    archive-pipeline.ts   Archive loading/processing pipeline (extracted from main.ts)
    archive-scramble.ts   XOR byte scrambling/descrambling, VDIM format, transit key derivation
    export-controller.ts  Archive export, metadata manifests
    event-wiring.ts       Central UI event binding — setupUIEvents()
    asset-store.ts        ES module singleton for blob references (splat, mesh, pointcloud)
    screenshot-manager.ts Screenshot capture, viewfinder, screenshot list management
    transform-controller.ts Transform gizmo orchestration, object sync, delta tracking
    url-validation.ts     URL validation for user-entered URLs (extracted, testable)
    source-files-manager.ts Source file list UI management for archive exports
    alignment.ts          KD-tree, ICP algorithm, auto-align, fit-to-view, alignment I/O
    annotation-system.ts  3D annotation placement via raycasting
    metadata-manager.ts   Metadata sidebar (view/edit/annotations), Dublin Core schema
    fly-controls.ts       WASD + mouse-look first-person camera
    share-dialog.ts       Share link builder with URL parameters
    quality-tier.ts       SD/HD quality detection and switching (forces SD on iOS + Android)
    theme-loader.ts       Theme CSS/layout loading for kiosk mode
    spark-compat.ts       Spark.js version abstraction (SPARK_VERSION env var toggle)
    flight-path.ts        Flight path rendering, import/export, hover tooltips
    flight-parsers.ts     DJI CSV, KML/KMZ, SRT flight log parsers
    comparison-viewer.ts  Before/after comparison overlay (side-by-side, slider, toggle modes)
    kiosk-viewer.ts       Offline viewer generator (DEPRECATED — do not extend)
    kiosk-main.ts         Kiosk mode entry point
    __tests__/            Vitest test suites (url-validation, theme-loader, archive-loader, utilities, quality-tier, flight-parsers)
  themes/
    editorial/            Editorial theme (layout.css, layout.js, theme.css)
    gallery/              Gallery theme — cinematic full-bleed layout
    exhibit/              Exhibit theme — institutional kiosk with attract mode
    minimal/              Minimal theme (theme.css only)
    _template/            Theme scaffold template
docker/
  Dockerfile              Multi-stage: api-deps (Node 20) + nginx:alpine + s6-overlay
  nginx.conf              Gzip, CORS, caching, CSP headers
  nginx.conf.template     Dynamic server name substitution
  meta-server.js          Node API — SQLite metadata, archive CRUD, CF Access auth
  package.json            API deps (better-sqlite3, busboy)
  config.js.template      Template for env var substitution
  s6-rc.d/                s6-overlay service definitions (nginx, api, init-config, init-scan)
```

## How to Run

```bash
npm run dev                # Vite dev server on http://localhost:8080
npm run build              # Vite production build to dist/
npm run preview            # Preview production build locally
npm run docker:build       # Vite build + Docker image
npm run docker:run         # runs on http://localhost:8080 (port 80 inside container)
npx tauri dev              # Desktop app (Tauri, requires Rust)
npx tauri android build    # Android APK (requires Android SDK + NDK)
npm run lint               # ESLint check (0 errors expected, warnings OK)
npm run lint:fix           # ESLint auto-fix
npm run format:check       # Prettier formatting check
npm run format             # Prettier auto-format
npm test                   # Vitest — run all test suites
npm run test:watch         # Vitest in watch mode
```

## Boot Sequence

### Editor (`/editor/`)
1. `editor/index.html` loads `config.js` (regular script) → parses URL params, validates URLs, writes `window.APP_CONFIG`
2. `pre-module.js` (regular script) → installs error handlers, starts 5s watchdog
3. `main.ts` (ES module) → imports all modules, reads `APP_CONFIG`, calls `init()`
4. `init()` creates `SceneManager`, extracts its internals to module-scope variables, wires up all UI events, calls `loadDefaultFiles()`, starts `animate()` loop

### Kiosk (`/`)
1. `index.html` loads `config.js` → writes `window.APP_CONFIG`
2. `kiosk-web.ts` → imports and calls `kiosk-main.ts` `init()`
3. Loads archive from URL params, applies theme, sets up viewer-only UI

## Key Patterns to Understand

### The "deps pattern"
Modules don't store references to shared objects. Instead, `main.ts` builds a fresh dependency object on each call:
```js
/** @returns {import('./types.js').ExportDeps} */
function createExportDeps() {
    return { sceneRefs, state, tauriBridge, ui: { ... }, metadata: { ... } };
}
downloadArchive(createExportDeps());
```
Deps interfaces for the largest extracted modules (`ExportDeps`, `ArchivePipelineDeps`, `EventWiringDeps`, `FileInputDeps`) are defined in `src/types.ts` and `src/modules/file-input-handlers.ts`. The main.ts factory functions have typed return annotations.

### SceneManager extraction
After creating `SceneManager`, `init()` copies all its properties into loose `let` variables (`scene`, `camera`, `renderer`, etc.) at module scope in `main.ts`. These loose variables are what the rest of `main.ts` actually uses. Two sources of truth — if you update a property on `SceneManager`, also update the corresponding loose variable in `main.ts` `init()`. They are not automatically synced.

### State management
A single mutable `const state: AppState = { ... }` object in `main.ts`. No setters, no events, no validation. Any function can mutate it directly.

### URL validation
The core validation logic is in `url-validation.ts` (extracted, testable). Two implementations exist:
- `url-validation.ts` — canonical ES module, used at runtime via `main.ts` wrapper (passes `window.location` context and `ALLOWED_EXTERNAL_DOMAINS`). `file-input-handlers.ts` receives this via the deps pattern.
- `config.js` line 68 — duplicate implementation for URL params at boot (IIFE, must run before ES modules). Uses identical logic but can't import from the TS module.

The `ALLOWED_EXTERNAL_DOMAINS` list is defined in `config.js` and shared via `APP_CONFIG.allowedDomains`. A parity test in `__tests__/url-validation.test.ts` asserts both implementations produce identical results — if you change validation logic in one, the drift test will fail until the other is updated.

### Timing-based sequencing
Several post-load operations use `setTimeout` with delays from `constants.js` TIMING (e.g., `AUTO_ALIGN_DELAY: 500`). These are not promise-based — they assume assets finish loading within the delay window.

### Flight path asset pattern
Flight logs follow the same asset pattern as other types: archive key prefix `flightpath_N` (e.g., `flightpath_0`, `flightpath_1`), stored as raw files under `assets/`. GPS coordinates are converted to local scene coordinates using a flat-earth projection with the first point as the origin. The `FlightPathManager` class (in `flight-path.ts`) handles rendering (THREE.Line + InstancedMesh markers), hover tooltips, import, and export. Parsers for DJI CSV, KML/KMZ, and SRT formats are isolated in `flight-parsers.ts`. Manual alignment uses the same transform gizmo as other asset types. Flight paths are visible in both editor and kiosk mode (kiosk has a toggle button); the kiosk import is lazy.

## Rules for Making Changes

### Bug fixing: trace the full pipeline first
Before writing any fix for a data-related bug, map the complete flow: where the value is set → how it's serialized → how it's deserialized → where it's applied on display. List every file involved. Fix all of them. Do not assume a surface-level fix is sufficient.

### CSS changes: cover all themes
When making any CSS/styling change, check for theme-specific overrides in all contexts:
- Default styles in `styles.css` and `kiosk.css`
- Theme-specific overrides in `src/themes/{editorial,gallery,exhibit}/layout.css` and `theme.css`
- Kiosk base styles (`body.kiosk-mode` selectors in `styles.css`)

There are 5 themes (editorial, gallery, exhibit, minimal, _template). Never assume a change to one context is sufficient. Grep for the component name across all theme directories before committing.

### CSS/JS value sync
When changing a CSS size, proportion, or timing value, search for corresponding hardcoded values in `.ts`/`.js` files that must stay in sync. The golden ratio layout, annotation popup dimensions, and sidebar widths all have JS counterparts.

### Verify before committing
Run `npm run build` to confirm the project compiles after any non-trivial change. Run `npm test` if the change touches security-critical code (URL validation, archive handling, theme parsing).

### Keep modular
If adding functionality, investigate if it makes sense to create a module instead of locating new code in main.ts before writing code. All modules are now TypeScript (`.ts`).

### npm dependencies
Runtime deps are in `package.json` and resolved by Vite. If adding a new dependency, install via `npm install` and import normally. Vite resolves bare specifiers from `node_modules/`.

### Docker uses Vite build output
The Dockerfile copies `dist/` (Vite build output). Run `npm run build` before `docker build`. Vite produces two bundles: kiosk (root) and editor (`/editor/`). Ensure new modules are imported so Vite bundles them.

### CSP requires `unsafe-eval`
Spark.js WASM needs `'unsafe-eval'` in the CSP `script-src`. Do not remove it or splat rendering will break. If the CSP in either `index.html` or `editor/index.html` is changed, also check `docker/nginx.conf` which adds its own `frame-ancestors` header.

### Module conventions
- Each module creates a logger: `const log = Logger.getLogger('module-name');`
- Export functions/classes that `main.ts` imports and orchestrates
- Modules receive dependencies via the deps pattern — don't import main.ts
- Use `notify()` from utilities.js for user-facing messages
- Use `showLoading()` / `hideLoading()` from ui-controller.js for progress
- `main.ts` contains local copies of `populateMetadataDisplay`, `showAnnotationPopup`, and `setupMetadataSidebar` — it does NOT delegate to `metadata-manager.ts` for these. If you change metadata display behavior, update both locations.

### HTML is in the entry HTML files, not generated by JS
All DOM structure lives in `src/index.html` (kiosk) and `src/editor/index.html` (editor). Modules query elements by ID. If you need new UI elements, add them to the appropriate HTML file and reference by ID in JS. The exception is dynamically-created elements like annotation markers and metadata form fields. When adding editor-only UI, add to `editor/index.html` only — keep `index.html` minimal for the kiosk bundle.

## Known Fragile Areas

- **`main.ts` is ~1,900 lines** — fully typed glue layer: `init()`, state declarations, deps factories, animation loop, and thin delegation wrappers. Used by editor only; kiosk uses `kiosk-web.ts` → `kiosk-main.ts`.
- **Tests cover security-critical code only.** ~500 tests across 7 suites: URL validation, theme metadata parsing, archive filename sanitization, flight log parsing, archive scrambling. No E2E or integration tests yet.
- **Point cloud memory.** No size limits on E57 loading. Large files can OOM the browser.
- **`@types/three` is installed** but many Three.js references still use `any` for compatibility with Spark.js and dynamic patterns.
- **Flight log parsers** handle DJI firmware variations (column name aliases, "longtitude" typo). New DJI app versions may introduce column names not yet in the alias list.

## When changes are made
- Update ROADMAP.MD if changed item is present
