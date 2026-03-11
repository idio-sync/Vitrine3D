# Phase 16: file-handlers.ts Split — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 2,601-line `file-handlers.ts` into focused per-concern modules under `src/modules/loaders/`, keeping `file-handlers.ts` as a re-export hub for backward compatibility.

**Architecture:** Extract 6 leaf modules organized by asset type / concern. The archive-asset module depends on the four loader modules (one-way). `file-handlers.ts` becomes a thin re-export coordinator — all existing consumer imports continue to work unchanged.

**Tech Stack:** TypeScript, Three.js, Vite

**Decisions made:**
- STL and DRC loading stay in mesh-loader.ts (shared Three.js addon imports, small function count)
- `ProgressCallback` type alias is duplicated in each loader that needs it (one-liner, avoids cross-module dep)
- Material update functions get their own module (they have zero loader dependencies)
- `file-handlers.ts` keeps all original exports via `export { ... } from './loaders/...'`
- No consumer files change their import paths — only `file-handlers.ts` internals change

---

## Dependency DAG

```
splat-loader ──────────┐
mesh-loader ───────────┤
drawing-loader ────────┼──▶ archive-asset-loader
pointcloud-loader ─────┘
mesh-material-updates        (independent, no loader deps)

file-handlers.ts ── re-exports everything from all 6 modules
```

No circular dependencies. Each loader is a leaf (depends only on Three.js, npm packages, and shared utilities/constants).

---

## Consumer Import Surface (must not break)

| Consumer | Imports from `file-handlers.js` |
|---|---|
| **main.ts** | `loadSplatFromFile`, `loadModelFromFile`, `loadPointcloudFromFile`, `getAssetTypesForMode`, `updateModelOpacity`, `updateModelWireframe`, `updateModelMatcap`, `updateModelNormals`, `updateModelRoughness`, `updateModelMetalness`, `updateModelSpecularF0`, `loadSTLFile`, type `LoadPointcloudDeps` |
| **event-wiring.ts** | `updatePointcloudPointSize`, `updatePointcloudOpacity`, `updateModelTextures` |
| **archive-pipeline.ts** | `loadGLTF`, `loadOBJFromUrl`, `loadPointcloudFromBlobUrl`, `loadDrawingFromBlobUrl`, `loadArchiveFullResMesh`, `loadArchiveFullResSplat`, `loadArchiveProxyMesh`, `loadArchiveProxySplat`, `getPrimaryAssetType`, `getSplatFileType` |
| **kiosk-main.ts** | `loadArchiveFromFile`, `processArchivePhase1`, `loadArchiveAsset`, `getAssetTypesForMode`, `getPrimaryAssetType`, `updateModelOpacity`, `updateModelWireframe`, `updateModelTextures`, `updateModelMatcap`, `updateModelNormals`, `updateModelRoughness`, `updateModelMetalness`, `updateModelSpecularF0`, `updatePointcloudPointSize`, `updatePointcloudOpacity`, `loadSplatFromFile`, `loadSplatFromUrl`, `loadModelFromFile`, `loadModelFromUrl`, `loadPointcloudFromFile`, `loadPointcloudFromUrl`, `loadArchiveFullResMesh`, `loadArchiveFullResSplat`, `loadArchiveProxyMesh`, `loadArchiveProxySplat` |
| **file-input-handlers.ts** | `loadSplatFromFile`, `loadModelFromFile`, `loadSTLFile`, `loadSplatFromUrl`, `loadModelFromUrl`, `loadSTLFromUrlWithDeps`, `loadPointcloudFromFile`, `loadPointcloudFromUrl`, `loadDrawingFromFile`, `loadDrawingFromUrl`, `bundleModelFiles` |

---

## Module Extraction Map

### Module 1: `src/modules/loaders/splat-loader.ts` (~370 lines)

**Source lines:** ~47–460 from file-handlers.ts

**Contains:**
- `SPLAT_FILE_TYPE_MAP` constant
- `getSplatFileType()` (exported)
- `createSplatMesh()` (exported — needed by archive-asset-loader)
- `loadSplatFromFile()` (exported)
- `loadSplatFromUrl()` (exported)
- `loadSplatFromBlobUrl()` (exported)
- `LoadSplatDeps` interface (exported)
- `ProgressCallback` type alias (local)

**Imports from npm:** `three`, `@sparkjsdev/spark` (SplatMesh, PackedSplats, unpackSplats)
**Imports from project:** `archive-loader`, `constants` (TIMING, ASSET_STATE), `utilities` (Logger, fetchWithProgress), `@/types` (AppState)

### Module 2: `src/modules/loaders/mesh-loader.ts` (~700 lines)

**Source lines:** ~30–46 (dracoLoader singleton), ~460–870 (GLTF/OBJ/STL/DRC), ~1141–1360 (model from file/url/blob)

**Contains:**
- `dracoLoader` singleton (module-scope, with offline WASM detection)
- `loadGLTF()` (exported)
- `loadOBJ()` (private)
- `loadOBJWithoutMaterials()` (private)
- `OBJGroup` interface (exported)
- `parseMultiPartOBJ()` (private)
- `loadMultiPartOBJ()` (private)
- `exportToGLB()` (private)
- `loadOBJFromUrl()` (exported)
- `loadSTL()` (private)
- `loadSTLFromUrl()` (exported)
- `loadDRC()` (private)
- `loadModelFromFile()` (exported)
- `bundleModelFiles()` (exported)
- `loadModelFromUrl()` (exported)
- `loadModelFromBlobUrl()` (exported)
- `loadSTLFile()` (exported)
- `loadSTLFromUrlWithDeps()` (exported)
- `LoadModelDeps` interface (exported)
- `LoadSTLDeps` interface (exported)
- `ModelLoadResult` interface (exported)
- `ProgressCallback` type alias (local)

**Imports from npm:** `three`, `three/addons/loaders/GLTFLoader.js`, `three/addons/loaders/OBJLoader.js`, `three/addons/loaders/MTLLoader.js`, `three/addons/loaders/STLLoader.js`, `three/addons/loaders/DRACOLoader.js`, `three/addons/exporters/GLTFExporter.js`, `three/addons/libs/meshopt_decoder.module.js`
**Imports from project:** `constants` (TIMING, ASSET_STATE), `utilities` (Logger, processMeshMaterials, computeMeshFaceCount, computeMeshVertexCount, computeTextureInfo, fetchWithProgress), `@/types` (AppState)

### Module 3: `src/modules/loaders/drawing-loader.ts` (~260 lines)

**Source lines:** ~883–1140

**Contains:**
- `dxfVec()` (private)
- `dxfArcPoints()` (private)
- `ptsToLineSegments()` (private)
- `dxfEntityToSegments()` (private)
- `parseDXFText()` (private)
- `loadDXFFromFile()` (private)
- `loadDXFFromUrl()` (private)
- `LoadDrawingDeps` interface (exported)
- `loadDrawingFromFile()` (exported)
- `loadDrawingFromUrl()` (exported)
- `loadDrawingFromBlobUrl()` (exported)
- `ProgressCallback` type alias (local)

**Imports from npm:** `three`, `dxf-parser`
**Imports from project:** `constants` (TIMING, ASSET_STATE), `utilities` (Logger, fetchWithProgress)

### Module 4: `src/modules/loaders/pointcloud-loader.ts` (~200 lines)

**Source lines:** ~86–105 (E57 lazy singleton), ~2398–2601

**Contains:**
- `_E57Loader`, `_e57Checked` (module-scope singleton state)
- `getE57Loader()` (private)
- `loadE57()` (private)
- `loadPointcloudFromFile()` (exported)
- `loadPointcloudFromUrl()` (exported)
- `loadPointcloudFromBlobUrl()` (exported)
- `updatePointcloudPointSize()` (exported)
- `updatePointcloudOpacity()` (exported)
- `LoadPointcloudDeps` interface (exported)
- `PointcloudLoadResult` interface (exported)
- `ProgressCallback` type alias (local)

**Imports from npm:** `three` (+ dynamic `import('three-e57-loader')`)
**Imports from project:** `constants` (TIMING, ASSET_STATE), `utilities` (Logger, fetchWithProgress), `@/types` (AppState)

### Module 5: `src/modules/loaders/mesh-material-updates.ts` (~360 lines)

**Source lines:** ~2040–2395

**Contains:**
- `_matcapTextureCache` (module-scope Map)
- `_originalMaterials` / `_debugMaterials` caches (module-scope WeakMaps, if present)
- `updateModelOpacity()` (exported)
- `updateModelWireframe()` (exported)
- `updateModelTextures()` (exported)
- `generateMatcapTexture()` (private)
- `updateModelMatcap()` (exported)
- `updateModelNormals()` (exported)
- `_createPBRDebugMaterial()` (private)
- `_togglePBRDebugView()` (private)
- `updateModelRoughness()` (exported)
- `updateModelMetalness()` (exported)
- `updateModelSpecularF0()` (exported)

**Imports from npm:** `three`
**Imports from project:** `utilities` (Logger) — possibly none beyond THREE

### Module 6: `src/modules/loaders/archive-asset-loader.ts` (~640 lines)

**Source lines:** ~1362–2038

**Contains:**
- `loadArchiveFromFile()` (exported)
- `loadArchiveFromUrl()` (exported)
- `processArchive()` (exported)
- `processArchivePhase1()` (exported)
- `loadArchiveAsset()` (exported)
- `parseMeshOffScene()` (private — calls `loadGLTF` from mesh-loader)
- `swapMeshChildren()` (private)
- `loadArchiveFullResMesh()` (exported)
- `swapSplatAsset()` (private — calls `createSplatMesh` from splat-loader)
- `loadArchiveFullResSplat()` (exported)
- `loadArchiveProxySplat()` (exported)
- `loadArchiveProxyMesh()` (exported)
- `getAssetTypesForMode()` (exported)
- `getPrimaryAssetType()` (exported)
- Interfaces: `LoadArchiveDeps`, `ProcessArchiveDeps`, `LoadArchiveAssetDeps`, `LoadFullResDeps`, `ProcessArchiveResult`, `Phase1Result`, `AssetLoadResult` (all exported)

**Imports from loaders:**
- `splat-loader` → `createSplatMesh`, `getSplatFileType`
- `mesh-loader` → `loadGLTF`, `loadOBJFromUrl`, `loadModelFromBlobUrl`
- `pointcloud-loader` → `loadPointcloudFromBlobUrl`
- `drawing-loader` → `loadDrawingFromBlobUrl`

**Imports from project:** `archive-loader` (ArchiveLoader), `constants` (TIMING, ASSET_STATE), `utilities` (Logger, notify, disposeObject, computeMeshFaceCount, computeTextureInfo, fetchWithProgress), `@/types` (AppState, QualityTier)

---

## Execution Steps

### Task 16.1: Create directory and extract splat-loader.ts

- [ ] **Step 1:** Create `src/modules/loaders/` directory

- [ ] **Step 2:** Read file-handlers.ts lines 1–60 (imports + SPLAT_FILE_TYPE_MAP + getSplatFileType)

- [ ] **Step 3:** Read file-handlers.ts lines 62–460 (createSplatMesh + splat load functions + LoadSplatDeps)

- [ ] **Step 4:** Create `src/modules/loaders/splat-loader.ts` with:
  - Required npm imports (THREE, @sparkjsdev/spark)
  - Required project imports (archive-loader, constants, utilities, types)
  - Logger: `const log = Logger.getLogger('splat-loader');`
  - `ProgressCallback` type alias
  - `SPLAT_FILE_TYPE_MAP`, `getSplatFileType`, `createSplatMesh`
  - `LoadSplatDeps` interface
  - `loadSplatFromFile`, `loadSplatFromUrl`, `loadSplatFromBlobUrl`

- [ ] **Step 5:** Run `npm run build` — verify no errors

### Task 16.2: Extract mesh-loader.ts

- [ ] **Step 1:** Read file-handlers.ts lines 30–46 (dracoLoader singleton)

- [ ] **Step 2:** Read file-handlers.ts lines 460–870 (GLTF/OBJ/STL/DRC functions)

- [ ] **Step 3:** Read file-handlers.ts lines 1141–1360 (model from file/url/blob + bundleModelFiles)

- [ ] **Step 4:** Create `src/modules/loaders/mesh-loader.ts` with:
  - All Three.js addon imports (GLTFLoader, OBJLoader, MTLLoader, STLLoader, DRACOLoader, GLTFExporter, MeshoptDecoder)
  - Project imports (constants, utilities, types)
  - `dracoLoader` singleton (including offline WASM detection)
  - Logger: `const log = Logger.getLogger('mesh-loader');`
  - All mesh/model/STL/DRC loading functions
  - All interfaces (`LoadModelDeps`, `LoadSTLDeps`, `OBJGroup`, `ModelLoadResult`)

- [ ] **Step 5:** Run `npm run build` — verify no errors

### Task 16.3: Extract drawing-loader.ts

- [ ] **Step 1:** Read file-handlers.ts lines 883–1140 (DXF helpers + drawing loaders)

- [ ] **Step 2:** Create `src/modules/loaders/drawing-loader.ts` with:
  - npm imports (THREE, dxf-parser)
  - Project imports (constants, utilities)
  - Logger: `const log = Logger.getLogger('drawing-loader');`
  - All DXF helper functions + drawing load functions + `LoadDrawingDeps`

- [ ] **Step 3:** Run `npm run build` — verify no errors

### Task 16.4: Extract pointcloud-loader.ts

- [ ] **Step 1:** Read file-handlers.ts lines 86–105 (E57 lazy singleton) and lines 2398–2601 (pointcloud functions)

- [ ] **Step 2:** Create `src/modules/loaders/pointcloud-loader.ts` with:
  - npm imports (THREE, dynamic three-e57-loader)
  - Project imports (constants, utilities, types)
  - Logger: `const log = Logger.getLogger('pointcloud-loader');`
  - E57 singleton + all pointcloud load/update functions + interfaces

- [ ] **Step 3:** Run `npm run build` — verify no errors

### Task 16.5: Extract mesh-material-updates.ts

- [ ] **Step 1:** Read file-handlers.ts lines 2040–2395 (all material update functions)

- [ ] **Step 2:** Create `src/modules/loaders/mesh-material-updates.ts` with:
  - npm imports (THREE only)
  - Project imports (utilities for Logger, if used)
  - All material caches (matcap texture cache, original material WeakMaps)
  - All `updateModel*` functions + private helpers

- [ ] **Step 3:** Run `npm run build` — verify no errors

### Task 16.6: Extract archive-asset-loader.ts

- [ ] **Step 1:** Read file-handlers.ts lines 1362–2038 (archive processing + quality tier swap functions)

- [ ] **Step 2:** Create `src/modules/loaders/archive-asset-loader.ts` with:
  - npm imports (THREE, @sparkjsdev/spark for SplatMesh/PackedSplats if needed directly)
  - Imports from sibling loaders: `splat-loader` (createSplatMesh, getSplatFileType), `mesh-loader` (loadGLTF, loadOBJFromUrl, loadModelFromBlobUrl), `pointcloud-loader` (loadPointcloudFromBlobUrl), `drawing-loader` (loadDrawingFromBlobUrl)
  - Project imports (archive-loader, constants, utilities, types)
  - Logger: `const log = Logger.getLogger('archive-asset-loader');`
  - All archive processing + quality swap functions + interfaces
  - `getAssetTypesForMode`, `getPrimaryAssetType`

- [ ] **Step 3:** Run `npm run build` — verify no errors

### Task 16.7: Convert file-handlers.ts to re-export hub

- [ ] **Step 1:** Replace file-handlers.ts contents with re-exports from all 6 modules

The new file-handlers.ts should look like:
```typescript
/**
 * File Handlers Module — Re-export hub
 *
 * All asset loading logic has been split into focused modules under ./loaders/.
 * This file re-exports everything to preserve the existing import surface
 * for all consumers (main.ts, kiosk-main.ts, event-wiring.ts, etc.).
 */

// Splat loading
export {
    getSplatFileType, createSplatMesh,
    loadSplatFromFile, loadSplatFromUrl, loadSplatFromBlobUrl,
} from './loaders/splat-loader.js';
export type { LoadSplatDeps } from './loaders/splat-loader.js';

// Mesh / model / STL / DRC loading
export {
    loadGLTF, loadOBJFromUrl, loadSTLFromUrl,
    loadModelFromFile, loadModelFromUrl, loadModelFromBlobUrl,
    bundleModelFiles,
    loadSTLFile, loadSTLFromUrlWithDeps,
} from './loaders/mesh-loader.js';
export type { LoadModelDeps, LoadSTLDeps, OBJGroup, ModelLoadResult } from './loaders/mesh-loader.js';

// Drawing / DXF loading
export {
    loadDrawingFromFile, loadDrawingFromUrl, loadDrawingFromBlobUrl,
} from './loaders/drawing-loader.js';
export type { LoadDrawingDeps } from './loaders/drawing-loader.js';

// Point cloud loading
export {
    loadPointcloudFromFile, loadPointcloudFromUrl, loadPointcloudFromBlobUrl,
    updatePointcloudPointSize, updatePointcloudOpacity,
} from './loaders/pointcloud-loader.js';
export type { LoadPointcloudDeps, PointcloudLoadResult } from './loaders/pointcloud-loader.js';

// Mesh material / visual updates
export {
    updateModelOpacity, updateModelWireframe, updateModelTextures,
    updateModelMatcap, updateModelNormals,
    updateModelRoughness, updateModelMetalness, updateModelSpecularF0,
} from './loaders/mesh-material-updates.js';

// Archive processing + quality tier swap
export {
    loadArchiveFromFile, loadArchiveFromUrl,
    processArchive, processArchivePhase1, loadArchiveAsset,
    loadArchiveFullResMesh, loadArchiveFullResSplat,
    loadArchiveProxyMesh, loadArchiveProxySplat,
    getAssetTypesForMode, getPrimaryAssetType,
} from './loaders/archive-asset-loader.js';
export type {
    LoadArchiveAssetDeps, LoadFullResDeps,
    ProcessArchiveResult, Phase1Result, AssetLoadResult,
} from './loaders/archive-asset-loader.js';
```

- [ ] **Step 2:** Run `npm run build` — verify no errors (this is the critical step)

- [ ] **Step 3:** Run `npm test` — verify all 423 tests pass

### Task 16.8: Commit

- [ ] **Step 1:** Verify no consumer files changed their imports (only file-handlers.ts and new loaders/ files)

- [ ] **Step 2:** Commit:
```bash
git add src/modules/file-handlers.ts src/modules/loaders/
git commit -m "refactor: split file-handlers.ts into per-asset-type loaders (M-MR4)"
```

---

## Risk Areas

1. **`dracoLoader` singleton** — Must stay a single instance. It's only in mesh-loader.ts, so this is clean. But verify no other file creates a second DRACOLoader.

2. **`createSplatMesh` cross-module usage** — archive-asset-loader imports from splat-loader. One-way dependency, no circular risk.

3. **`loadGLTF` used by archive-pipeline.ts** — archive-pipeline already imports `loadGLTF` from file-handlers.ts. The re-export in file-handlers.ts preserves this. No change needed.

4. **Module-scope caches in mesh-material-updates** — matcap texture cache, original material WeakMaps. These move to mesh-material-updates.ts and remain singletons (ES module scope guarantees single instance).

5. **Import path resolution** — Loaders import from sibling modules using `./splat-loader.js` etc. Vite resolves `.ts` from `.js` extensions. Standard pattern already used throughout the codebase.

6. **`window.__DRACO_DECODER_SRC__`** — The offline Draco source detection in the dracoLoader singleton reads from `window` at module load time. This continues to work since the import order doesn't change (it's still loaded early via file-handlers → mesh-loader).

## Extraction Order Rationale

Leaf modules first (splat → mesh → drawing → pointcloud → material), then archive-asset (which depends on the leaves), then the re-export hub (which depends on all). Each step is independently buildable — if any extraction fails, the previous extractions remain valid.
