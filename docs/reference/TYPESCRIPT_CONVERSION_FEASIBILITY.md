# TypeScript Conversion Feasibility Evaluation

**Date:** 2026-02-06 (original), **Updated:** 2026-02-15
**Scope:** Full assessment of converting simple-splat-mesh-viewer from JavaScript to TypeScript
**Codebase:** ~20,000 lines across 30 source files (3 `.js` + 26 `.ts` modules + shared types + tests)

---

## Executive Summary

Converting this project to TypeScript is **feasible, nearly complete, and recommended to finish**. The original assessment identified the CDN import map architecture as the primary blocker — that has been fully resolved. Vite is in place, TypeScript is configured, shared types exist, and 26 modules are already `.ts` (Phases 0-3 complete). The remaining work is converting `main.js` and optionally `config.js` (Phase 4).

### Feasibility Rating: **Very High** (9/10)

| Factor | Rating | Notes |
|--------|--------|-------|
| Module structure | 9/10 | Clean ESM, clear exports, good separation of concerns |
| Existing type hints | 8/10 | JSDoc in most modules + `src/types.ts` with shared interfaces |
| Dependency typing | 7/10 | `@types/three` excellent; spark.js still has no types |
| Build complexity | 9/10 | ~~Requires bundler~~ Vite already in place, TS compiles cleanly |
| Data model complexity | 7/10 | Complex nested metadata, but well-documented structures |
| Risk level | Low | Tests exist (90), ESLint configured, phased approach proven |

### Progress Summary

| Milestone | Status |
|-----------|--------|
| Build pipeline (Vite + TypeScript) | **Done** |
| Shared types (`src/types.ts`) | **Done** — `AppState`, `SceneRefs`, 3 deps interfaces |
| ESLint + Prettier | **Done** |
| Test framework (Vitest, 31 tests) | **Done** |
| 4 modules written as TypeScript | **Done** — `export-controller`, `archive-pipeline`, `event-wiring`, `url-validation` |
| Phase 1 foundation conversions | **Done** — `constants`, `logger`, `asset-store`, `quality-tier`, `fly-controls`, `utilities` |
| Declaration stubs | **Done** — `spark.d.ts`, `three-e57-loader.d.ts`, `web-e57.d.ts` |
| `Transform`, `Annotation` interfaces | **Done** — added to `src/types.ts` |
| Phase 2 batch 1 conversions | **Done** — `screenshot-manager`, `transform-controller`, `theme-loader`, `tauri-bridge`, `annotation-controller` |
| Phase 2 batch 2 conversions | **Done** — `share-dialog`, `ui-controller`, `annotation-system` |
| Phase 2 batch 3 conversions | **Done** — `scene-manager`, `alignment`, `archive-loader` |
| `@types/three` installation | **Done** — installed for batch 3 (Three.js-heavy modules) |
| Phase 3 complex conversions | **Done** — `archive-creator`, `file-handlers`, `metadata-manager`, `kiosk-viewer`, `kiosk-main` |
| Phase 4 — `main.js` + strict mode | **Not started** |

---

## 1. Current Architecture Analysis

### Module System
- **Pure ES Modules** with `"type": "module"` in `package.json`
- **Vite 7.3** — dev server, production bundler, TypeScript compilation
- **npm dependencies** — bare specifiers resolved from `node_modules/` (CDN import map removed)
- **Hybrid `.js`/`.ts`** — `allowJs: true`, `checkJs: false`, `strict: false` (only 3 `.js` files remain)
- All inter-module imports use `.js` extensions (Vite resolves `.ts` from `.js` imports)

### File Inventory

**Already TypeScript:**

| File | Lines | Notes |
|------|-------|-------|
| `types.ts` | 221 | Shared types: `AppState`, `SceneRefs`, `ExportDeps`, `ArchivePipelineDeps`, `EventWiringDeps`, `Transform`, `Annotation` |
| `modules/export-controller.ts` | 464 | Archive export, generic viewer download |
| `modules/archive-pipeline.ts` | 693 | Archive loading/processing pipeline |
| `modules/event-wiring.ts` | 636 | Central UI event binding |
| `modules/url-validation.ts` | 96 | URL validation (extracted, testable) |
| `modules/constants.ts` | 196 | Phase 1 — `as const` config objects |
| `modules/logger.ts` | 220 | Phase 1 — standalone Logger class |
| `modules/asset-store.ts` | 47 | Phase 1 — blob singleton, typed via `AssetStore` interface |
| `modules/quality-tier.ts` | 90 | Phase 1 — SD/HD detection |
| `modules/fly-controls.ts` | 236 | Phase 1 — simple class with Three.js types |
| `modules/utilities.ts` | 677 | Phase 1 — utility functions |
| `modules/screenshot-manager.ts` | 153 | Phase 2 — screenshot capture/list |
| `modules/transform-controller.ts` | 190 | Phase 2 — gizmo orchestration |
| `modules/theme-loader.ts` | 203 | Phase 2 — CSS/layout loading |
| `modules/tauri-bridge.ts` | 208 | Phase 2 — Tauri feature detection |
| `modules/annotation-controller.ts` | 417 | Phase 2 — annotation UI orchestration |
| `modules/share-dialog.ts` | 543 | Phase 2 — URL parameter serialization |
| `modules/ui-controller.ts` | 683 | Phase 2 — DOM wrappers, typed event handlers |
| `modules/annotation-system.ts` | 655 | Phase 2 — 3D annotation placement via raycasting |
| `modules/scene-manager.ts` | 836 | Phase 2 — Three.js scene/camera/renderer class with proper types |
| `modules/alignment.ts` | 940 | Phase 2 — landmark alignment, ICP, fit-to-view with deps interfaces |
| `modules/archive-loader.ts` | 908 | Phase 2 — ZIP parsing with CentralDirEntry, ArchiveManifest interfaces |
| `modules/archive-creator.ts` | 1,896 | Phase 3 — 26 interfaces for manifest schema, ZIP building |
| `modules/file-handlers.ts` | 1,793 | Phase 3 — typed deps interfaces for all asset loaders |
| `modules/metadata-manager.ts` | 1,800 | Phase 3 — 15 interfaces for Dublin Core metadata |
| `modules/kiosk-viewer.ts` | 470 | Phase 3 — HTML string generation, typed CDN deps |
| `modules/kiosk-main.ts` | 3,115 | Phase 3 — KioskState interface, typed Three.js scene |

**Remaining JavaScript (to convert):**

| File | Lines | Complexity | Type Difficulty |
|------|-------|-----------|-----------------|
| `main.js` | 1,681 | High | Hard — orchestrator with state, deps factories, animation loop |
| `config.js` | 208 | Low | Special — IIFE, must remain JS (see Section 3) |
| `pre-module.js` | 15 | Low | Trivial |

### Existing JSDoc Coverage (Remaining `.js` Files)
- `main.js` — has JSDoc `@returns` on deps factories pointing to shared types, but most functions lack annotations

---

## 2. Dependency Type Availability

| Dependency | Version | Types Available | Notes |
|------------|---------|----------------|-------|
| `three` | 0.170.0 | `@types/three` (DefinitelyTyped) | Excellent coverage; **installed** |
| `@sparkjsdev/spark` | 0.1.10 | **None** | Available on npm; needs `.d.ts` declaration file |
| `fflate` | 0.8.2 | Bundled | Written in TypeScript natively |
| `three-e57-loader` | 1.2.0 | **None** | Needs `.d.ts` declaration file |
| `web-e57` | 1.2.0 | **None** | Needs `.d.ts` declaration file |

### `@types/three` Installation (Done)

`@types/three` was installed at the start of Phase 2 batch 3 using `--legacy-peer-deps` (needed due to `three-e57-loader` expecting `three@^0.157.0`). The feared cascade of errors did not materialize — `tsc` remained clean because `checkJs: false` ignores `.js` files and the existing `.ts` files used `any` for Three.js types. The batch 3 modules (`scene-manager.ts`, `alignment.ts`) now use proper Three.js types throughout.

### Type Declarations Needed

**`@sparkjsdev/spark`** — Used for `SplatMesh` class. Requires a declaration covering:
```typescript
// types/spark.d.ts (approximate)
declare module '@sparkjsdev/spark' {
  import { Object3D } from 'three';
  export class SplatMesh extends Object3D {
    static NewAsync(config: {
      renderer: THREE.WebGLRenderer;
      maxSplats: number;
      loadingAnimDuration: number;
    }): Promise<SplatMesh>;
    loadUrl(url: string, onProgress?: (progress: number) => void): Promise<void>;
    loadFile(file: File, onProgress?: (progress: number) => void): Promise<void>;
    dispose(): void;
  }
}
```

**`three-e57-loader`** — Used for `E57Loader`. Requires:
```typescript
declare module 'three-e57-loader' {
  import { Loader, Points } from 'three';
  export class E57Loader extends Loader {
    load(url: string, onLoad: (points: Points) => void,
         onProgress?: (event: ProgressEvent) => void,
         onError?: (error: Error) => void): void;
  }
}
```

**`web-e57`** — WASM support module. Minimal declaration needed:
```typescript
declare module 'web-e57' {
  export function init(): Promise<void>;
}
```

---

## 3. Build Pipeline ~~Changes Required~~ (DONE)

### ~~Current Setup (No Bundler)~~ Previous Setup (Replaced)
```
index.html → <script type="importmap"> → CDN URLs        ← REMOVED
           → <script src="config.js">  → IIFE sets window.APP_CONFIG
           → <script type="module" src="main.js">
```

### Current Setup (Vite — In Place)
```
vite.config.ts → TypeScript compilation
              → Bundle resolution (replaces import map)
              → Dev server with HMR (port 8080)
              → Production build output to dist/
              → copyRuntimeAssets plugin for kiosk module files
```

**`tsconfig.json` (actual, in use):**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "checkJs": false,
    "strict": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `config.js` Special Case
`config.js` is loaded as a non-module `<script>` that runs before the module graph, setting `window.APP_CONFIG` from URL parameters. Two options:

1. **Keep as JS** (current approach): Copied to `dist/` by Vite plugin. Referenced via `window.APP_CONFIG` through typed wrappers in `.ts` files.
2. **Convert to TS module**: Move URL parsing into the module graph, import before `main.ts`. Cleaner but changes load ordering.

**Recommendation:** Option 1 is working fine. Convert to a module only if `main.js` → `main.ts` conversion (Phase 3) makes it natural to do so.

### Docker
Docker already serves Vite build output from `dist/`. CI/CD workflow already includes `npm ci && npm run build` before Docker build. No changes needed.

---

## 4. Key Type Definitions

### Already Defined (`src/types.ts`)

```typescript
// Union types
type DisplayMode = 'splat' | 'model' | 'pointcloud' | 'both' | 'split' | 'stl';
type SelectedObject = 'splat' | 'model' | 'both' | 'none';
type TransformMode = 'translate' | 'rotate' | 'scale';
type QualityTier = 'sd' | 'hd';
type AssetStateValue = 'unloaded' | 'loading' | 'loaded' | 'error';

// Core interfaces
interface AppState { /* 33+ properties + index signature */ }
interface SceneRefs { /* 17 readonly getters */ }
interface UICallbacks { showLoading, hideLoading, updateProgress }
interface AssetStore { splatBlob, meshBlob, proxyMeshBlob, proxySplatBlob, pointcloudBlob, sourceFiles }

// Module dependency interfaces
interface ExportDeps { sceneRefs: Pick<SceneRefs, ...>, state: AppState, ... }
interface ArchivePipelineDeps { sceneRefs: Pick<SceneRefs, ...>, state: AppState, ... }
interface EventWiringDeps { sceneRefs: Pick<SceneRefs, ...>, state: AppState, ... }
```

### Still Needed (add during module conversion)

```typescript
// Transform data used throughout alignment, archives, sharing
interface Transform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: number;
}

// Annotation placed in 3D space
interface Annotation {
  id: string;
  title: string;
  body: string;
  position: { x: number; y: number; z: number };
  camera_target: { x: number; y: number; z: number };
  camera_position: { x: number; y: number; z: number };
}

// Archive manifest structure
interface ArchiveManifest {
  version: string;
  packer: string;
  created: string;
  metadata: ProjectMetadata;
  alignment: { splat: Transform; model: Transform; pointcloud: Transform };
  assets: Array<{ path: string; type: 'splat' | 'model' | 'pointcloud'; size: number }>;
  annotations: Annotation[];
  integrity: { algorithm: string; manifest_hash: string; asset_hashes: Record<string, string> };
}

// Metadata (largest interface — 60+ fields across 8 categories)
interface ProjectMetadata {
  title: string;
  id: string;
  description: string;
  license: string;
  // ... (extensive, maps to Dublin Core / EDAN / PRONOM standards)
}
```

### Global Augmentations
```typescript
declare global {
  interface Window {
    APP_CONFIG: AppConfig;
    notify: NotificationManager;
    moduleLoaded: boolean;
  }
}
```

Note: `window.THREE` is no longer used (Three.js is now imported via npm, not assigned to a global).

---

## 5. Migration Strategy (Updated)

### Phase 0 — Build Pipeline Setup — **DONE**
- ~~Install Vite + TypeScript~~ Done
- ~~Create `tsconfig.json`~~ Done (`strict: false`, `allowJs: true`, `checkJs: false`)
- ~~Move dependencies from CDN import map to `node_modules`~~ Done
- ~~Verify app runs identically through Vite dev server~~ Done
- ~~Update Docker build to use Vite output~~ Done

### Phase 0.5 — Quality Infrastructure — **DONE**
- ~~ESLint 9 + Prettier~~ Done (0 errors, 51 warnings)
- ~~Shared types (`src/types.ts`)~~ Done (221 lines)
- ~~Vitest + 31 tests~~ Done (url-validation, theme-loader, archive-loader)
- ~~Deps typing migration~~ Done (interfaces in shared types, JSDoc `@returns` on factories)

### Phase 1 — Foundation Types (Low-Risk Files) — **DONE**

Converted the simplest, most self-contained modules. All have minimal dependencies and clear APIs.

| File | Lines | Approach |
|------|-------|----------|
| ~~`constants.js`~~ → `constants.ts` | 196 | `as const` for all config objects |
| ~~`logger.js`~~ → `logger.ts` | 220 | Standalone class, no external deps |
| ~~`asset-store.js`~~ → `asset-store.ts` | 47 | Singleton, typed via `AssetStore` interface |
| ~~`quality-tier.js`~~ → `quality-tier.ts` | 90 | Small, pure logic |
| ~~`fly-controls.js`~~ → `fly-controls.ts` | 236 | Simple class with Three.js types |
| ~~`utilities.js`~~ → `utilities.ts` | 677 | Strong JSDoc, utility functions |

Also completed in this phase:
- [x] Created `src/types/spark.d.ts`, `src/types/three-e57-loader.d.ts`, `src/types/web-e57.d.ts` declaration stubs
- [x] Added `Transform`, `Annotation` interfaces to `src/types.ts`

### Phase 2 — Module Conversion (Medium-Risk Files) — **DONE**

Convert standalone modules with clean APIs and good JSDoc:

| File | Lines | Approach |
|------|-------|----------|
| ~~`transform-controller.js`~~ → `transform-controller.ts` | 190 | Small, gizmo orchestration |
| ~~`screenshot-manager.js`~~ → `screenshot-manager.ts` | 153 | Small, self-contained |
| ~~`theme-loader.js`~~ → `theme-loader.ts` | 203 | Small, already tested |
| ~~`tauri-bridge.js`~~ → `tauri-bridge.ts` | 208 | Feature detection module |
| ~~`annotation-controller.js`~~ → `annotation-controller.ts` | 417 | Annotation UI orchestration |
| ~~`share-dialog.js`~~ → `share-dialog.ts` | 543 | URL parameter serialization |
| ~~`ui-controller.js`~~ → `ui-controller.ts` | 683 | DOM wrappers, typed event handlers |
| ~~`annotation-system.js`~~ → `annotation-system.ts` | 655 | Clean class with JSDoc `@typedef` |
| ~~`scene-manager.js`~~ → `scene-manager.ts` | 836 | Three.js class with proper typed properties |
| ~~`alignment.js`~~ → `alignment.ts` | 940 | Algorithmic, deps interfaces, Three.js types |
| ~~`archive-loader.js`~~ → `archive-loader.ts` | 908 | ZIP/manifest interfaces, well-documented |

**Phase 2 complete.** `@types/three` was installed for batch 3, enabling proper Three.js types in `scene-manager.ts` and `alignment.ts`.

### Phase 3 — Complex Module Conversion (Higher-Risk Files) — **DONE**

| File | Lines | Approach |
|------|-------|----------|
| ~~`archive-creator.js`~~ → `archive-creator.ts` | 1,896 | 26 interfaces for manifest schema, ZIP building, hashing |
| ~~`file-handlers.js`~~ → `file-handlers.ts` | 1,793 | Typed deps interfaces for all asset loading functions |
| ~~`metadata-manager.js`~~ → `metadata-manager.ts` | 1,800 | 15 interfaces for Dublin Core metadata, DOM typed |
| ~~`kiosk-viewer.js`~~ → `kiosk-viewer.ts` | 470 | HTML string generation with typed CDN deps |
| ~~`kiosk-main.js`~~ → `kiosk-main.ts` | 3,115 | KioskState interface, Three.js typed scene, 176 errors fixed |

**Phase 3 complete.** All 5 complex modules converted. `src/modules/` is now 100% TypeScript (0 `.js` files remain).

### Phase 4 — Main Module + Strict Mode

- Convert `main.js` → `main.ts` (1,681 lines — reduced from original 3,993 via refactoring)
- Convert `config.js` → `config.ts` if appropriate (may keep as JS)
- Enable `strict: true` globally
- Resolve all remaining `any` types in `src/types.ts` (replace with proper Three.js types)
- Add strict null checks

---

## 6. Risk Assessment

### Low Risk
- **Module structure is clean** — dependency injection pattern means modules don't need to know about each other's internals
- **Test suite exists** — 90 tests across 5 suites (URL validation, filename sanitization, theme parsing, utility functions, quality-tier) catch regressions during conversion
- **ESLint configured** — catches common issues during conversion
- **Well-separated concerns** — each module has a clear API surface
- **ESM already in use** — no CommonJS conversion needed
- **Hybrid `.ts`/`.js` proven** — 26 modules already TypeScript, interop is seamless

### Medium Risk
- **`main.js` complexity** — at ~1,680 lines with deps factories and state management, this is still the hardest file to type correctly (though reduced from ~4,000)
- **`window` global state** — `window.APP_CONFIG`, `window.notify` need careful typing
- **Dynamic HTML generation** — `kiosk-viewer.js` and `kiosk-main.js` generate complete HTML pages as strings; template literal types won't help here
- ~~**`@types/three` cascade**~~ — **Resolved:** installed without issues; `checkJs: false` prevented cascade

### Low-Medium Risk
- **Three.js version pinning** — `@types/three` must match v0.170.0; minor version mismatches can cause type errors
- **Spark.js declaration accuracy** — hand-written `.d.ts` may not cover all used APIs; iterate as needed

### Mitigations
1. **Run `npx tsc --noEmit` after each file conversion** — catches type errors immediately
2. **Run `npm test` after each phase** — 31 existing tests verify no regressions
3. **Start with `strict: false`** (already in place) — flip to `strict: true` only in Phase 4
4. **Keep `.js` files working during migration** — Vite handles mixed `.ts`/`.js` imports seamlessly (proven)
5. ~~**Install `@types/three` in Phase 2, not earlier**~~ — **Done:** installed at start of batch 3 with `--legacy-peer-deps`

---

## 7. Estimated Scope

| Phase | Files | Status | Complexity |
|-------|-------|--------|------------|
| 0 — Build pipeline | Config files only | **DONE** | — |
| 0.5 — Quality infrastructure | Types + linter + tests | **DONE** | — |
| 1 — Foundation | 6 files + declaration stubs | **DONE** | Low |
| 2 — Modules | 11 files + `@types/three` | **DONE** (11/11) | Medium |
| 3 — Complex modules | 5 files | **DONE** (5/5) | Medium-High |
| 4 — Main + strict | 1-2 files + strict audit | Not started | High |

**Remaining files to convert:** `main.js` + optionally `config.js` (excluding `pre-module.js`)
**Already TypeScript:** 26 modules + shared types (27 files, ~18,000+ lines)
**`src/modules/` directory:** 100% TypeScript (0 `.js` files remain)
**Additional type definitions needed:** ~10 interfaces (ArchiveManifest, ProjectMetadata, and module-specific types added during conversion)

---

## 8. Tooling (Actual Configuration)

### `tsconfig.json` (in use)
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "checkJs": false,
    "strict": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `vite.config.ts` (in use)
Includes `copyRuntimeAssets()` plugin that copies kiosk module source files, non-bundled scripts, themes, and raw CSS to `dist/` after build.

### Current Dependencies
```json
{
  "devDependencies": {
    "@types/three": "^0.170.0",
    "@eslint/js": "^10.0.1",
    "@tauri-apps/cli": "^2.10.0",
    "eslint": "^10.0.0",
    "eslint-config-prettier": "^10.1.8",
    "jsdom": "^26.1.0",
    "prettier": "^3.8.1",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.55.0",
    "vite": "^7.3.1",
    "vitest": "^4.0.18"
  },
  "dependencies": {
    "@sparkjsdev/spark": "^0.1.10",
    "fflate": "^0.8.2",
    "three": "^0.170.0",
    "three-e57-loader": "^1.2.0",
    "web-e57": "^1.2.0"
  }
}
```

### CI/CD (in place)
GitHub Actions workflow already includes install, build, and Docker steps. Add `npx tsc --noEmit` as a type-check step when more modules are converted.

---

## 9. Benefits of Converting

1. **Type safety across module boundaries** — the dependency injection pattern in `file-handlers.js` and `alignment.js` will benefit enormously from typed callback signatures
2. **Refactoring confidence** — renaming a field in the metadata interface will surface all call sites at compile time
3. **IDE support** — autocompletion for Three.js APIs, metadata fields, and archive structures
4. **Self-documenting code** — interfaces replace JSDoc for data structures; documentation and code stay in sync
5. **Catches real bugs** — common issues like passing `null` where `Object3D` is expected, or misspelling metadata field names, will be caught before runtime
6. **Future-proofing** — TypeScript makes onboarding new developers significantly faster
7. **Aligns with code review findings** — the existing CODE_REVIEW.md identifies "Missing Type Safety" as HIGH priority item 1.1
8. **Proven feasible** — 26 modules already converted successfully with zero runtime regressions

---

## 10. Conclusion

This project's TypeScript conversion is **nearly complete**. The original blockers (no bundler, CDN import map, no tests) have all been resolved. All 26 modules in `src/modules/` are now TypeScript — zero `.js` files remain in the modules directory. `@types/three` is installed and providing full Three.js type coverage. 90 tests across 5 suites verify correctness.

The recommended next step is **Phase 4** — converting `main.js` (1,681 lines) to TypeScript, optionally converting `config.js`, then enabling `strict: true` globally.

**Key change from original assessment:** The risk profile has dropped to minimal. What was originally rated Low-Medium risk with a "requires bundler" caveat is now Low risk with infrastructure fully in place, Phases 0-3 complete, `@types/three` installed, and a proven track record of 26 successful module conversions across 4 phases.
