# Remaining MEDIUM Issues Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all remaining ~35 MEDIUM issues from the code quality review.

**Architecture:** Phased approach — quick wins first (constants, naming, guards), then moderate refactors (helpers, file splits), then large architectural work (asset registry, file decomposition).

**Tech Stack:** TypeScript, Three.js, Vite

**Decisions made:**
- Canonical asset type name for GLB/OBJ: **`'mesh'`** (rename `'model'` references)
- `kiosk-viewer.ts` can be deleted (deprecated, button hidden)
- `main.ts` metadata wrappers are thin delegates — not duplicated logic, can stay
- `stl` and `colmap` are first-class asset types (exportable/loadable from archives)
- No target line count ceiling for decomposed modules — use functional boundaries

---

## Phase 15: Quick Wins ✅

> 7 tasks, ~2 hours total, low risk. All independent — can be parallelized.
> **Status: COMPLETE** — All tasks done. Build passes, 423 tests pass.

### Task 15.1: Extract `writeScaleInputs()` helper in event-wiring.ts ✅

Extracted `writeScaleInputs(value, excludeAxis?)` helper. Replaced 3 identical scale-sync loops + 1 variant (exclude-axis) across slider handlers. 4 sites consolidated.

### Task 15.2: Canonicalize `'mesh'` vs `'model'` asset type naming ✅

Renamed `'model'` → `'mesh'` in `SelectedObject` context across 8 files:
- `types.ts` — `SelectedObject` type union
- `transform-controller.ts` — comment, button list, branching (2 sites)
- `event-wiring.ts` — button binding, selection comparisons (6 sites)
- `ui-controller.ts` — selection comparisons (2 sites)
- `main.ts` — comment + button show call
- `editor/index.html` — button ID + label (`btn-select-mesh`)
- `kiosk-main.ts` — `FileCategory` type, `FILE_CATEGORIES` key, `handleDirectFile` comparison + JSDoc

`DisplayMode` values (`'model'` meaning "show mesh only") intentionally left unchanged — different concept.

### Task 15.3: Replace magic LOD budget literal with `getLodBudget()` ✅

Replaced stale `500000` fallback with `getLodBudget(state.qualityResolved)` in kiosk deps factory.

### Task 15.4: Replace raw console.warn with Logger ✅

Replaced `console.warn('[animate] frame error:', e)` with `log.warn('Frame error:', e)` in kiosk animate loop.

### Task 15.5: Extract magic numbers to named constants ✅

Added `SPARK_DEFAULTS` to `constants.ts` with 5 named constants (`CLIP_XY`, `MIN_ALPHA`, `BEHIND_FOVEATE`, `CONE_FOV`, `CONE_FOVEATE`). Replaced 4 SparkRenderer creation sites (2 in kiosk-main.ts, 2 in main.ts).

### Task 15.6: Add init guard to recording-manager.ts ✅ (already guarded)

Verified: `startRecording` already checks `if (!_deps)` at line 69; composite frame function guards at line 286. No additional work needed.

### Task 15.7: Add init guard to walkthrough-editor.ts ✅ (already guarded)

Verified: `editorDeps` already guarded at line 221 (`if (!select || !editorDeps) return`). No additional work needed.

---

## Phase 16: file-handlers.ts Split ✅

> 1 task, moderate effort (~2 hours), medium risk. The cleanest decomposition since functions already have typed deps interfaces.
> **Status: COMPLETE** — Split into 6 modules. Build passes, 423 tests pass.

### Task 16.1: Split file-handlers.ts by asset type ✅

Split the 2,601-line `file-handlers.ts` into 6 focused modules under `src/modules/loaders/`:
- `splat-loader.ts` (~250 lines) — Spark SplatMesh loading (.ply, .spz, .splat, .ksplat, .rad, .sog)
- `mesh-loader.ts` (~580 lines) — GLTF/GLB, OBJ (multi-part), STL, DRC loading + DracoLoader singleton
- `drawing-loader.ts` (~260 lines) — DXF parsing + drawing load functions
- `pointcloud-loader.ts` (~250 lines) — E57 lazy loading + point cloud updates
- `mesh-material-updates.ts` (~330 lines) — opacity, wireframe, texture toggle, matcap, normals, PBR debug views
- `archive-asset-loader.ts` (~570 lines) — archive processing, lazy extraction, quality tier swap

`file-handlers.ts` is now a ~55-line re-export hub. Zero consumer files changed their import paths. STL was kept in mesh-loader (shared Three.js addon imports, small function count) rather than a separate file.

---

## Phase 17: Asset Type Registry

> 2 tasks. Large effort (half day). High impact — eliminates O(asset types × call sites) maintenance burden. **Depends on Phase 15 Task 15.2 (mesh/model naming fix).**

### Task 17.1: Define the asset registry interface

**Files:**
- Create: `src/modules/asset-registry.ts`
- Modify: `src/modules/constants.js` (or `src/types.ts`)

Design a registry that describes each asset type's properties:

```typescript
interface AssetDescriptor {
    /** Canonical key (e.g., 'mesh', 'splat', 'pointcloud') */
    key: string;
    /** Display label for UI */
    label: string;
    /** The THREE.Group or object that holds this asset in the scene */
    sceneRefKey: keyof SceneRefs;
    /** File extensions this asset type handles */
    extensions: string[];
    /** Whether this type supports transform gizmo */
    transformable: boolean;
    /** Whether this type appears in archive-pipeline's ensureAssetLoaded */
    archiveLoadable: boolean;
    /** State flag key (e.g., 'splatLoaded', 'modelLoaded') */
    loadedStateKey?: string;
    /** Button ID for inline loading indicator */
    loadingButtonId?: string;
}
```

- [ ] **Step 1: Inventory all asset types across codebase**

Collect from transform-controller.ts, archive-pipeline.ts, file-handlers.ts, constants.js. Expected types: `splat`, `mesh`, `pointcloud`, `stl`, `cad`, `drawing`, `flightpath`, `colmap`.

- [ ] **Step 2: Define `AssetDescriptor` interface and populate registry**

Map each type to its properties. Note which types have asymmetric handling (e.g., `stl` is transformable but not archive-loadable via `ensureAssetLoaded`; `colmap` is loaded specially).

- [ ] **Step 3: Export `ASSET_REGISTRY` map and helper functions**

```typescript
export const ASSET_REGISTRY = new Map<string, AssetDescriptor>([...]);
export function getAssetDescriptor(key: string): AssetDescriptor | undefined;
export function getTransformableTypes(): string[];
export function getArchiveLoadableTypes(): string[];
export function getExtensionsForType(key: string): string[];
```

- [ ] **Step 4: Verify build**

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-registry.ts
git commit -m "feat: add asset type registry with descriptors (M-AR1 foundation)"
```

### Task 17.2: Migrate branching sites to use the registry

**Files:**
- Modify: `src/modules/transform-controller.ts`
- Modify: `src/modules/event-wiring.ts`
- Modify: `src/modules/ui-controller.ts`
- Modify: `src/modules/archive-pipeline.ts`

**IMPORTANT:** Do this file by file, committing after each. Don't change all 4 simultaneously.

- [ ] **Step 1: Migrate transform-controller.ts**

Replace `setTransformTarget()` 8-way if/else with registry lookup:
```typescript
const descriptor = getAssetDescriptor(assetType);
if (!descriptor) return;
const target = sceneRefs[descriptor.sceneRefKey];
if (target) transformControls.attach(target);
```

For `syncTransformFromObject()`, the 3 repeated position/rotation/scale blocks can use a loop over `getTransformableTypes()`.

- [ ] **Step 2: Verify build + test after transform-controller change**

- [ ] **Step 3: Commit transform-controller.ts**

```bash
git commit -m "refactor: use asset registry in transform-controller (M-AR1 partial)"
```

- [ ] **Step 4: Migrate event-wiring.ts**

Replace asset-type branching in transform sync and keyboard shortcuts with registry lookups.

- [ ] **Step 5: Verify build + test, commit**

```bash
git commit -m "refactor: use asset registry in event-wiring (M-AR1 partial)"
```

- [ ] **Step 6: Migrate ui-controller.ts**

Replace `ASSET_BUTTON_MAP` and display mode branching with registry lookups.

- [ ] **Step 7: Verify build + test, commit**

```bash
git commit -m "refactor: use asset registry in ui-controller (M-AR1 partial)"
```

- [ ] **Step 8: Migrate archive-pipeline.ts (if feasible)**

The `ensureAssetLoaded` 6-way branch is harder — each branch has unique loader logic. Evaluate whether a `loadFromArchive(descriptor, archiveLoader, deps)` dispatch is practical or if per-type logic is inherently different enough to keep.

- [ ] **Step 9: Final commit**

```bash
git commit -m "refactor: complete asset registry migration (M-AR1)"
```

---

## Phase 18: Moderate Refactors

> 3 tasks, mixed effort, medium risk.

### Task 18.1: Delete deprecated kiosk-viewer.ts ✅

Deleted `kiosk-viewer.ts` and removed all references: `downloadGenericViewer` from export-controller.ts, main.ts wrapper, event-wiring.ts binding, types.ts interface, and hidden button from editor/index.html. Build passes, 423 tests pass.

### Task 18.2: Extract cross-section activation helper

**Files:**
- Create or modify: `src/modules/cross-section.ts` (if it exists) or `src/modules/cross-section-helper.ts`
- Modify: `src/main.ts` (editor init)
- Modify: `src/modules/kiosk-main.ts` (kiosk init)
- Modify: `src/modules/event-wiring.ts` (toggle logic)

- [ ] **Step 1: Read cross-section init in both main.ts and kiosk-main.ts**

Document the differences (editor passes `stlGroup`, kiosk passes `null`).

- [ ] **Step 2: Extract shared `initCrossSection(options)` and `toggleCrossSection()` helpers**

The helper should accept optional `stlGroup` parameter. The toggle logic should be shared.

- [ ] **Step 3: Update both entry points to use the shared helper**

- [ ] **Step 4: Verify build + tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: extract cross-section activation helper (M-MR2)"
```

### Task 18.3: Scope inline style fixes to frame-adjacent code

**Files:**
- Modify: modules with `.style.display` in animation loops or per-frame callbacks

**IMPORTANT:** Only fix instances in performance-critical paths (animation loop, per-frame callbacks, tight iteration). Do NOT attempt all 240 instances.

- [ ] **Step 1: Identify frame-adjacent style manipulations**

Grep for `.style.` within `animate()`, `render()`, `requestAnimationFrame` callbacks, and `traverse()` calls.

- [ ] **Step 2: Replace with CSS class toggling**

Use existing `.hidden` class or add `.visible` class where needed. Verify the class exists in all theme CSS files.

- [ ] **Step 3: Verify build**

- [ ] **Step 4: Commit**

```bash
git commit -m "perf: replace frame-adjacent inline styles with CSS classes (M-MR3)"
```

---

## Phase 19: kiosk-main.ts Decomposition

> Large architectural work (half day+). High risk. This is the biggest single effort.

### Task 19.1: Map module-scope variable dependency graph

**Files:**
- Read-only analysis of: `src/modules/kiosk-main.ts`

This is a **prerequisite research task** — no code changes.

- [ ] **Step 1: List all module-scope `let`/`const` variables**

- [ ] **Step 2: For each identified extraction candidate, list which variables it reads/writes**

Candidates from section headers:
- File picker / click gate (lines ~650-938)
- Archive loading pipeline (lines ~1229-1430)
- Quality tier management (lines ~2168-2296)
- Viewer UI setup (`setupViewerUI()` — ~444 lines)
- Info overlay (lines ~3191-3315)
- Metadata display (lines ~3316-3500+)
- Toolbar/controls setup

- [ ] **Step 3: Identify minimal deps interfaces for each candidate**

Document which candidates can be extracted with small deps objects vs. which need most of the module state.

- [ ] **Step 4: Produce extraction order (least deps → most deps)**

- [ ] **Step 5: Document findings**

Write results to this plan or a separate analysis document.

### Task 19.2: Extract info overlay module

**Files:**
- Create: `src/modules/kiosk-info-overlay.ts`
- Modify: `src/modules/kiosk-main.ts`

The info overlay (`createInfoOverlay`, `populateInfoOverlay`, `toggleInfoOverlay`) is likely the cleanest extraction — it reads manifest data and writes to DOM, with minimal scene dependencies.

- [ ] **Step 1: Extract functions and their local helpers**

- [ ] **Step 2: Define deps interface for manifest + state access**

- [ ] **Step 3: Update kiosk-main.ts to import from new module**

- [ ] **Step 4: Verify build + tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: extract kiosk info overlay to separate module"
```

### Task 19.3: Extract quality tier management

**Files:**
- Create: `src/modules/kiosk-quality.ts`
- Modify: `src/modules/kiosk-main.ts`

`syncQualityButtons`, `showQualityToggle`, `switchQualityTier` — quality tier UI management that reads state but has a well-defined interface.

- [ ] **Step 1: Extract functions**

- [ ] **Step 2: Define deps interface**

- [ ] **Step 3: Update kiosk-main.ts**

- [ ] **Step 4: Verify build + tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: extract kiosk quality tier management to separate module"
```

### Task 19.4: Extract additional modules as identified by dependency analysis

Continue extracting based on Task 19.1 findings. Each extraction follows the same pattern: extract → define deps → update kiosk-main → verify → commit.

Likely additional candidates:
- Metadata display helpers
- Toolbar/controls setup
- File picker / click gate

---

## Phase 20: metadata-manager.ts Decomposition (Optional)

> Only if time permits. The `main.ts` wrappers are thin delegates — not a blocker. But 2,940 lines is large.

### Task 20.1: Split by functional section

**Files:**
- Modify: `src/modules/metadata-manager.ts`
- Create: `src/modules/metadata-display.ts` (display rendering)
- Create: `src/modules/metadata-form.ts` (form field management)
- Create: `src/modules/camera-constraints.ts` (camera constraint logic)

- [ ] **Step 1: Map section boundaries in metadata-manager.ts**

- [ ] **Step 2: Extract display rendering (~300 lines)**

- [ ] **Step 3: Extract camera constraints (~100 lines)**

- [ ] **Step 4: Update metadata-manager.ts to re-export for backward compatibility**

- [ ] **Step 5: Update main.ts wrapper imports if needed**

- [ ] **Step 6: Verify build + tests**

- [ ] **Step 7: Commit**

---

## Summary

| Phase | Tasks | Effort | Risk | Depends On |
|-------|-------|--------|------|------------|
| 15 — Quick Wins | 7 | ~2 hours | Low | None | ✅ Done |
| 16 — file-handlers split | 1 | ~2 hours | Medium | None | ✅ Done |
| 17 — Asset Registry | 2 | ~4 hours | Medium-High | Phase 15.2 |
| 18 — Moderate Refactors | 3 | ~3 hours | Medium | None (18.1 independent) |
| 19 — kiosk-main decomp | 4 | ~6 hours | High | None (but benefits from 16, 17) |
| 20 — metadata-manager | 1 | ~3 hours | Medium | Optional |

**Execution order:** 15 → 16 (parallel OK) → 17 → 18 → 19 → 20

Phases 15, 16, and 18.1 can run in parallel. Phase 17 depends on 15.2. Phase 19 benefits from 16 and 17 being done first but is not strictly blocked.
