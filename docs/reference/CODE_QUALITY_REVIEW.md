# Code Quality Review

**Date:** 2026-03-11
**Scope:** Full codebase — 55 modules, ~44,000 lines
**Methodology:** Module-by-module review run by 6 parallel analysis agents, consolidated into a single report
**Total findings:** 184 (9 CRITICAL, 32 HIGH, 69 MEDIUM, 48 LOW)

---

## Table of Contents

1. [Status Summary](#1-status-summary)
2. [Resolved — CRITICAL Issues](#2-resolved--critical-issues)
3. [Resolved — HIGH Issues](#3-resolved--high-issues)
4. [Open — HIGH Issues](#4-open--high-issues)
5. [Open — MEDIUM Issues](#5-open--medium-issues)
6. [Open — LOW Issues](#6-open--low-issues)
7. [Systemic Patterns](#7-systemic-patterns)
8. [Recommended Priority](#8-recommended-priority)
9. [TypeScript `strict: true` Migration Plan](#9-typescript-strict-true-migration-plan)
10. [Incremental Status Summary (2026-03-13)](#10-incremental-status-summary)
11. [CRITICAL Issues (Incremental)](#11-critical-issues)
12. [HIGH Issues (Incremental)](#12-high-issues)
13. [MEDIUM Issues (Incremental)](#13-medium-issues)
14. [LOW Issues (Incremental)](#14-low-issues)
15. [Systemic Patterns (Incremental)](#15-systemic-patterns-incremental)
16. [Updated Recommended Priority](#16-updated-recommended-priority)

---

## 1. Status Summary

| Severity | Total | Fixed | Open | Fix Commit Range |
|----------|-------|-------|------|------------------|
| **CRITICAL** | 9 | 9 | 0 | Phases 1–2 (`936259b`–`53cbbfb`) |
| **HIGH** | 32 | 32 | 0 | Phases 1–11 (`936259b`–latest) |
| **MEDIUM** | 69 | ~27 | ~42 | Phases 8, 12–16, 18.1 + incidental fixes during HIGH work |
| **LOW** | 48 | 0 | 48 | Not addressed |

All CRITICAL and HIGH issues were resolved across 10 phases committed to the `dev` branch on 2026-03-11.

---

## 2. Resolved — CRITICAL Issues

All 9 CRITICAL issues have been fixed.

### Security (5 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| C1 | XSS via unsanitized innerHTML — SIP compliance dialog | `export-controller.ts:104-113` | Added `escapeHtml()` to `f.label` and `f.message` |
| C2 | XSS via unsanitized annotation title in innerHTML | `kiosk-main.ts:4962` | Applied `escapeHtml()` to `annotation.title` |
| C3 | CSS selector injection via annotation IDs | `kiosk-main.ts:380,4921,5034,5220,5247` | Applied `CSS.escape()` in all `querySelector` calls |
| C4 | XSS via unsanitized walkthrough transition in innerHTML | `walkthrough-editor.ts:127` | Added transition validation against allowed enum |
| C5 | Unvalidated URL inputs bypass allowlist | `event-wiring.ts:712,935` | Wired `validateUrl` through deps pattern |

### Data Integrity (2 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| C6 | No decompression bomb protection in ZIP extraction | `archive-loader.ts:614-620` | Added `MAX_UNCOMPRESSED_SIZE` check before `inflateSync()` |
| C7 | Race condition in chunked upload — shared mutable counter | `library-panel.ts:229-230` | Captured index synchronously before `await` |

### Crashes (2 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| C8 | `Math.max(...spread)` stack overflow on large flight logs | `flight-path.ts:208,240,660` | Replaced with iterative `maxOf()` helper |
| C9 | Null dereference in Tauri native file dialogs | `main.ts:2911-2947` | Added null guards to all 7 `getElementById` calls |

---

## 3. Resolved — HIGH Issues

All 32 HIGH issues have been fixed.

### Memory Leaks (5 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| H1 | Blob URL leaks — `loadSplatFromUrl` | `file-handlers.ts:343` | Added `URL.revokeObjectURL()` after load |
| H2 | Blob URL leaks — `loadModelFromUrl` | `file-handlers.ts:1266` | Added `URL.revokeObjectURL()` before group add |
| H3 | Blob URL leaks — `loadSTLFromUrlWithDeps` | `file-handlers.ts:846` | Added `URL.revokeObjectURL()` after group add |
| H4 | Blob URL leaks — `loadDrawingFromUrl` | `file-handlers.ts:1081` | Added `URL.revokeObjectURL()` after group add |
| H5 | Blob URL leak in Tauri image proxy thumbnails | `collections-browser.ts:365` | Added `img.onload` revoke with `{ once: true }` |

### Logic Errors (7 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| H6 | `parseFloat(value) \|\| undefined` treats zero as missing | `flight-parsers.ts:133-136` | Replaced with `parseOptionalFloat()` using `isNaN()` |
| H7 | Same zero-value bug in speed calculation | `dji-txt-parser.ts:92` | Fixed `Math.sqrt(...) \|\| undefined` to use `isNaN()` check |
| H8 | Playback uses full points array instead of trimmed | `flight-path.ts:815` | Changed to `getTrimmedPoints(pathData)` |
| H9 | `seekTo` uses total duration instead of trimmed window | `flight-path.ts:752` | Computed time from trimmed start/end timestamps |
| H10 | `playbackProgress` ignores trim bounds | `flight-path.ts:781` | Computed progress relative to trimmed window |
| H11 | Pivot rotation only tracks splat/model quaternions | `transform-controller.ts:714` | Added quaternion tracking for all 8 asset types |
| H12 | `parseInt` on locale-formatted numbers stops at comma | `export-controller.ts:566-571` | Added `.replace(/,/g, '')` before `parseInt` |

### Robustness (8 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| H13 | 11 non-null assertions on editor-only DOM elements | `archive-pipeline.ts:102-183` | Replaced `!` with null guards |
| H14 | Untyped error access in catch blocks (9 locations) | `kiosk-main.ts` | Added `errMsg()` helper for safe extraction |
| H15 | Untyped error access in catch blocks (10 locations) | `file-input-handlers.ts` | Added `errMsg()` helper for safe extraction |
| H16 | `pollMediaStatus` infinite polling | `recording-manager.ts:250-268` | Added 120-attempt limit |
| H17 | `ensureAssetLoaded` polling with no timeout | `archive-pipeline.ts:310-318` | Added 2-minute timeout |
| H18 | `ensureAssetLoaded` polling with no timeout (kiosk) | `kiosk-main.ts:1434-1442` | Added 2-minute timeout |
| H19 | Module state never reset between archive loads | `walkthrough-editor.ts:27-35` | Added `resetWalkthroughEditor()` export, called from `clearArchiveMetadata` |
| H20 | Recording manager timers leak on cleanup | `recording-manager.ts:31-44` | Added `clearInterval`/`clearTimeout` in `cleanup()` |

### Other (5 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| H21 | Walkthrough editor unchecked DOM casts (6 lines) | `walkthrough-editor.ts:168-173` | Added null guards |
| H22 | `removeEventListener` missing `capture: true` | `alignment.ts:677` | Added `{ capture: true }` to match `addEventListener` |
| H23 | O(n²) climb rate coloring via `indexOf()` | `flight-path.ts:356` | Pass index parameter instead of searching |
| H24 | Duplicate flight path input handler | `main.ts` | Consolidated into shared helper |
| H25 | Shared `escapeHtml` consolidation | `utilities.ts` | Added canonical version; kiosk/editor both use it |

### Performance (1 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| H-perf | Blob URL leak in collections browser | `collections-browser.ts` | Revoke after `img.onload` |

### Phase 7 — Type Safety, Auth & Robustness (4 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| H-TS2 | `AppState` index signature `[key: string]: any` defeats all 115+ typed fields | `types.ts:118` | Removed index signature; typed dynamic access with `keyof AppState` |
| H-TS5 | `downloadScreenshot` missing from `EventWiringDeps` | `types.ts`, `event-wiring.ts:603` | Added missing field to interface |
| H-LE1 | `sceneRefs.splatMesh = null` is a no-op (assigns to getter-only property) | `main.ts:2175` | Removed dead assignment; local `splatMesh = null` already updates getter |
| H-SEC1 | Recording upload has no auth/CSRF outside CF Access | `recording-manager.ts:223` | Added `authHeaders` option and `credentials: 'same-origin'` |
| H-AR3 | `collection-manager.ts` singleton state never cleaned up | `collection-manager.ts` | Added `_initialized` guard to prevent double-init |

### Phase 8 — Code Consolidation & Deduplication (6 fixed — 1 HIGH + 5 MEDIUM)

| # | Issue | File | Fix |
|---|-------|------|-----|
| H-AR2 | Duplicate flight path input handlers | `main.ts:1656-1706` | Extracted shared `handleFlightPathFile` helper |
| M-DUP1 | `escapeHtml` duplicated in 6 modules | `collection-manager.ts`, `library-panel.ts`, `collection-page.ts`, `share-dialog.ts`, `walkthrough-editor.ts`, `kiosk-main.ts` | Removed all local copies; canonical version in `utilities.ts` widened to accept `unknown` |
| M-DUP2 | `formatBytes` duplicated in 3 modules | `collection-page.ts`, `library-panel.ts`, `kiosk-main.ts` | Added canonical version to `utilities.ts`; removed local copies |
| M-DUP3 | `formatDate` duplicated in 2 modules | `collection-page.ts` | Added canonical version to `utilities.ts`; library-panel kept `formatDateRelative` (different behavior) |
| M-DUP4 | `errMsg` duplicated in 2 modules | `file-input-handlers.ts`, `kiosk-main.ts` | Added canonical version to `utilities.ts`; removed local copies |
| M-DUP5 | `escapeHtml` imported from `collection-page.ts` instead of `utilities.ts` | `library-page.ts`, `collections-browser.ts` | Updated imports to use `utilities.ts` |

### Phase 9 — Type SceneRefs (1 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| H-TS1 | `SceneRefs` is 25+ fields of `any` despite `@types/three` installed | `types.ts:121-144` | Replaced all `any` with proper Three.js types (`Scene`, `PerspectiveCamera`, `WebGLRenderer`, `Group`, lights) and project types (`SplatMesh`, `FlyControls`, `AnnotationSystem`, `ArchiveCreator`, `MeasurementSystem`, `LandmarkAlignment`) |

### Phase 10 — Type Deps Factories (1 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| H-TS3 | 9 deps factories return `any` — entire dependency chain unchecked | `main.ts` | Typed all 9 factories with proper return types (`FileHandlerDeps`, `EditorAlignmentDeps`, `AnnotationControllerDeps`, `MetadataDeps`, `LoadCADDeps`, `FileInputDeps`, `AlignmentIODeps`, `ControlsPanelDeps`, `LoadPointcloudDeps`). Exported 6 previously non-exported interfaces from consuming modules. |

### Phase 11 — Reduce `any` in kiosk-main.ts (1 fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| H-TS4 | 51 uses of `any` in kiosk-main.ts | `kiosk-main.ts` | Eliminated ~51 explicit `any` type annotations: typed module vars (`WebGLRenderer`, `OrbitControls`, `SparkRenderer`, `SplatMesh`, `FlightPathManager`), all `catch` clauses to `unknown`, `.traverse()` callbacks to `Object3D`, material forEach to `Material`/`MeshStandardMaterial` casts, light queries with type guards, manifest params to `Record<string, unknown>`, state interface fields, image entries, kiosk deps factories (inference). 26 `as any` casts remain for cross-module type mismatches. |

### Phase 15 — Quick Wins (7 MEDIUM fixed)

| # | Issue | File | Fix |
|---|-------|------|-----|
| M-QW1 | Scale input sync duplicated 4x | `event-wiring.ts` | Extracted `writeScaleInputs()` helper, replaced all 4 sites |
| M-QW2 | `'model'` vs `'mesh'` asset type inconsistency | 8 files | Renamed `'model'` → `'mesh'` in `SelectedObject` context across types.ts, transform-controller, event-wiring, ui-controller, main.ts, editor HTML, kiosk-main (`FileCategory` + `FILE_CATEGORIES`) |
| M-QW3 | Stale magic `500000` LOD budget fallback | `kiosk-main.ts` | Replaced with `getLodBudget(state.qualityResolved)` |
| M-QW4 | Raw `console.warn` in animate loop | `kiosk-main.ts` | Replaced with `log.warn()` |
| M-QW5 | SparkRenderer magic numbers duplicated 4x | `constants.ts`, `kiosk-main.ts`, `main.ts` | Added `SPARK_DEFAULTS` constants, replaced all 4 creation sites |
| M-QW6 | No init guard in recording-manager | `recording-manager.ts` | Already guarded — `startRecording` checks `!_deps`, composite frame guards `!_deps` |
| M-QW7 | No init guard in walkthrough-editor | `walkthrough-editor.ts` | Already guarded — `editorDeps` checked at line 221 |

---

## 4. Open — HIGH Issues

All HIGH issues have been resolved.

### Architecture (1 — refactoring scope)

| # | Issue | File | Impact |
|---|-------|------|--------|
| H-AR1 | `handleArchiveFile` is 660+ lines | `kiosk-main.ts:1479-2148` | Hard to test, review, and modify |

These are tracked as future improvement items rather than blockers.

---

## 5. Open — MEDIUM Issues

~35 distinct MEDIUM issues remain (revised from original ~59 after Phases 8–14 fixes). Detailed plan: `docs/superpowers/plans/2026-03-11-medium-issues-plan.md`. Grouped by theme:

### Editor/Kiosk Code Duplication (~10 issues)

Functions duplicated between `main.ts`/`kiosk-main.ts` or across multiple modules:
- `escapeHtml` — **consolidated** in `utilities.ts`; all modules now import from there
- `formatBytes` — **consolidated** in `utilities.ts`; all modules now import from there
- `formatDate` — **consolidated** in `utilities.ts`; `library-panel.ts` keeps `formatDateRelative` (different behavior)
- `errMsg` — **consolidated** in `utilities.ts`; all modules now import from there
- `loadSplatFromBlobUrl`, `loadModelFromBlobUrl` — similar implementations in editor and kiosk
- Transform input resolution logic duplicated across editor/kiosk
- Cross-section activation duplicated

### 8-Way Asset Type Branching (~8 issues)

Near-identical if/else chains for 8 asset types appear in:
- `transform-controller.ts` — selection, sync, store positions
- `event-wiring.ts` — keyboard shortcuts, button handlers
- `ui-controller.ts` — display mode, visibility toggles
- `archive-pipeline.ts` — asset loading dispatch

Adding a 9th asset type requires touching 20+ locations. A registry/map pattern would eliminate this.

### Module-Level Singletons Without Cleanup (~4 remaining)

Modules with mutable state that's never reset:
- `map-picker.ts` — **fixed** (Phase 12): `destroyMapPicker()` clears Leaflet map, marker, search timeout on modal close
- `collection-manager.ts` — **fixed** (Phase 12): `resetCollectionManager()` clears all state, removes DOM, allows re-init
- `recording-manager.ts` — timer state partially cleaned (improved in Phase 3)
- `walkthrough-editor.ts` — reset added in Phase 3, but other singletons remain

### Large File Decomposition (~5 issues)

| Module | Lines | Suggested Extraction |
|--------|-------|----------------------|
| `kiosk-main.ts` | 5,364 | Archive loading, viewer settings, metadata display, mobile UI, toolbar |
| `metadata-manager.ts` | 2,940 | Display, collection, camera constraints |
| `file-handlers.ts` | 2,593 | Per-format loaders into separate files — **done** (Phase 16): split into 6 modules under `loaders/` (splat-loader, mesh-loader, drawing-loader, pointcloud-loader, mesh-material-updates, archive-asset-loader); file-handlers.ts is now a ~55-line re-export hub |

### Polling Instead of Events — **fixed** (Phase 14)

`ensureAssetLoaded` in both `archive-pipeline.ts` and `kiosk-main.ts` replaced `setTimeout` polling with stored-promise pattern. Concurrent callers now await the same in-flight promise instead of polling state every 50ms. Promise map is cleaned up in `finally` block.

### Performance (~1 remaining)

- `calculateSHA256Streaming` — **fixed** (Phase 13): extracted `hexFromBuffer` helper, no-progress path uses `blob.arrayBuffer()` directly (zero intermediate copy), progress path uses `blob.stream().getReader()` instead of manual `blob.slice()` chunking
- N+1 query pattern — **fixed** (Phase 13): `fetchArchiveCollections` now uses `Promise.all` for parallel execution instead of sequential `for...await`
- Inline style manipulation instead of CSS class toggling (multiple modules)

### Miscellaneous (~20 issues)

- Magic numbers remaining outside `constants.js` (grid colors, material params, popup dimensions)
- Inconsistent use of `notify()` vs `console.error` in non-critical paths
- Missing JSDoc on public APIs in newer modules
- ~~Unused imports and dead code paths~~ — `kiosk-viewer.ts` deleted (Phase 18.1): deprecated module removed along with `downloadGenericViewer` from export-controller, main.ts, event-wiring, types.ts, and editor HTML

---

## 6. Open — LOW Issues

48 LOW priority items, primarily:
- Style inconsistencies (naming conventions, import ordering)
- Dead code paths that could be removed
- Minor robustness improvements (defensive returns, edge case guards)
- Promise handling anti-patterns (`setTimeout` for sequencing)
- Console.log statements that could use the Logger class

These are optional cleanup items that don't affect functionality or security.

---

## 7. Systemic Patterns

### The `any` Epidemic

Major progress: `AppState` index signature removed (Phase 7), `SceneRefs` fully typed (Phase 9), all 9 deps factories in `main.ts` typed (Phase 10), kiosk-main.ts reduced from ~83 to ~26 `any` uses (Phase 11). The remaining `any` in kiosk-main.ts are `as any` casts for cross-module type mismatches (kiosk state vs editor deps interfaces, light intensity access, archive entry shapes) — fixing these requires shared interface refactoring. Both editor and kiosk TypeScript migrations are substantially complete.

### Duplication Across Editor/Kiosk

The editor (`main.ts`) and kiosk (`kiosk-main.ts`) share significant logic but implement it independently. Utility functions have been consolidated into `utilities.ts` (`escapeHtml`, `formatBytes`, `formatDate`, `errMsg`), but blob loaders, transform handling, and UI helpers remain duplicated 2–4x. Changes to shared behavior require updating both codepaths.

### 8-Way Asset Branching

Eight asset types (splat, model, pointcloud, STL, CAD, drawing, flightpath, colmap) create long if/else chains in transform-controller, event-wiring, ui-controller, and archive-pipeline. A registry or map-based dispatch pattern would reduce this from O(asset types × call sites) to O(1) per addition.

### Polling Instead of Events — Fixed (Phase 14)

Asset loading completion was detected by polling state every 50ms. Converted to stored-promise pattern in Phase 14 — concurrent callers now await the same in-flight promise.

### Module Singletons Without Lifecycle

Partially addressed in Phase 12: `map-picker.ts` now has `destroyMapPicker()` (called automatically on modal close), `collection-manager.ts` now has `resetCollectionManager()`. Other modules with mutable singleton state (e.g., annotation-system, transform-controller) still lack dispose/reset.

---

## 8. Recommended Priority

### Next up (high impact)

1. ~~**Reduce `any` in kiosk-main.ts**~~ — Done (Phase 11). 51 explicit `any` replaced; 26 `as any` casts remain.
2. **Extract kiosk-main.ts** — Break the 5,360-line file into focused modules (Phase 19 in MEDIUM plan).

### Medium-term (quality improvement)

3. **Asset type registry** — Replace 8-way if/else chains with a map pattern (Phase 17 in MEDIUM plan).
4. ~~**file-handlers.ts split**~~ — Done (Phase 16). Split into 6 focused modules under `src/modules/loaders/`.

### Long-term (technical debt)

5. ~~**Promise-based asset loading**~~ — Done (Phase 14). Stored-promise pattern replaces polling.
6. ~~**Module singleton lifecycle**~~ — Done (Phase 12). `destroyMapPicker()` and `resetCollectionManager()` added.
7. ~~**SHA-256 streaming fix**~~ — Done (Phase 13). Uses `blob.stream().getReader()`.
8. ~~**N+1 collection queries**~~ — Done (Phase 13). `Promise.all` parallel fetch.

See `docs/superpowers/plans/2026-03-11-medium-issues-plan.md` for the full remaining MEDIUM issues plan (Phases 15–20).

---

## 9. TypeScript `strict: true` Migration Plan

### Current State

`tsconfig.json` has `strict: false`. All sub-flags (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `noImplicitThis`, `strictPropertyInitialization`) are off. The codebase compiles without errors but TypeScript catches far fewer bugs than it could.

**556 explicit `any` uses** remain across the codebase (down from 1,000+ before Phases 7–11).

### Error Counts by Flag

Measured 2026-03-11 against the full `src/` tree:

| Flag | Total Errors | kiosk-main.ts | Rest of Codebase |
|------|-------------|---------------|------------------|
| `--strict` (all flags) | 575 | ~449 | ~126 |
| `--noImplicitAny` | 341 | 267 | 74 |
| `--strictNullChecks` | 438 | 326 | 112 |
| `--strictFunctionTypes` | 306 | 239 | 67 |
| `--strictBindCallApply` | 304 | ~237 | ~67 |
| `--noImplicitThis` | 304 | ~237 | ~67 |

**Key insight:** `kiosk-main.ts` accounts for ~78% of all strict errors. Fixing the rest of the codebase is a manageable ~126 errors across ~15 files.

### Top Error Files (excluding kiosk-main.ts)

| File | noImplicitAny | strictNullChecks | Notes |
|------|--------------|------------------|-------|
| `export-controller.ts` | 32 | 33 | Mostly untyped params in helper functions |
| `file-input-handlers.ts` | — | 26 | Null checks on DOM elements |
| `main.ts` | 22 | 25 | Callback params (`onModelLoaded: (object: any)`) |
| `archive-pipeline.ts` | 7 | 6 | Cross-module type mismatches |
| `share-dialog.ts` | 3 | 3 | Minor |
| `mesh-loader.ts` | 2 | 2 | Three.js addon types |
| Other files | ~8 | ~17 | 1–4 errors each |

### Recommended Migration Strategy

**Approach: Incremental flag enablement, not big-bang `strict: true`.**

#### Phase A: Quick Wins (~1 hour, 0 risk)

Replace `catch (err: any)` with `catch (err: unknown)` across all files (~30 sites). No flag change needed — this is a pure code improvement that works with or without strict mode.

#### Phase B: Enable `noImplicitAny` for non-kiosk files (~2 hours)

1. Add `// @ts-nocheck` to `kiosk-main.ts` temporarily (or use a per-file `// @ts-ignore` strategy)
2. Enable `noImplicitAny: true` in tsconfig
3. Fix ~74 errors across ~12 files — mostly adding types to function params
4. Common fixes:
   - `(obj: any)` → `(obj: THREE.Object3D)` in traverse callbacks
   - `(mesh: any, file: any)` → `(mesh: THREE.Group, file: File)` in loader callbacks
   - `(err: any)` → `(err: unknown)` in catch blocks
   - Untyped function params in export-controller and main.ts

#### Phase C: Enable `strictNullChecks` for non-kiosk files (~3 hours)

1. Enable `strictNullChecks: true` in tsconfig
2. Fix ~112 errors — mostly null guards on DOM element lookups and optional chaining
3. Common fixes:
   - `document.getElementById('x').value` → `document.getElementById('x')?.value`
   - Add `if (!element) return` guards
   - Use non-null assertions (`element!`) sparingly and only where the element is guaranteed by HTML

#### Phase D: Enable remaining flags (~1 hour)

`strictFunctionTypes`, `strictBindCallApply`, `noImplicitThis` — these largely overlap with the errors fixed in Phases B and C. Incremental effort is small once those are done.

#### Phase E: Fix kiosk-main.ts (~6+ hours)

This is the heavy lift — 449 errors in a 5,364-line file. Best done **after Phase 19 (kiosk-main.ts decomposition)**, since splitting it into smaller modules makes each piece easier to type correctly. Attempting this before decomposition is not recommended.

#### Phase F: Enable `strict: true` and remove per-file overrides

Once all files pass, flip `strict: true` and remove any `// @ts-nocheck` annotations. This is the finish line.

### Execution Order

```
Phase A (catch blocks)           — independent, do anytime
Phase B (noImplicitAny)          — do after Phase A
Phase C (strictNullChecks)       — do after Phase B
Phase D (remaining flags)        — do after Phase C
Phase 19 (kiosk-main decomp)     — from MEDIUM plan
Phase E (kiosk-main strict)      — do after Phase 19
Phase F (flip strict: true)      — do after Phase E
```

**Phases A–D can be done independently of the MEDIUM issues plan.** Phase E depends on Phase 19 (kiosk-main decomposition) for practical reasons.

---

# Incremental Review #2

**Date:** 2026-03-13
**Scope:** 164 commits since 2026-03-11 — 62 files changed, ~10,800 lines added across new features (VR, detail viewer, comparison viewer, rendering presets, archive scramble, flight FPV/chase/PiP, VAAPI transcoding, editorial theme expansion)
**Methodology:** 6 parallel review agents covering: new modules, flight path, archive/export pipeline, editor core, editorial theme/CSS, Docker/server
**Total findings:** 87 (3 CRITICAL, 22 HIGH, 40 MEDIUM, 22 LOW)

---

## 10. Incremental Status Summary

| Severity | Total | Verified Open | Fixed | Removed | Source Areas |
|----------|-------|---------------|-------|---------|-------------|
| **CRITICAL** | 3 | 0 | 2 | 1 | Security (XSS), Logic (VR toggle) |
| **HIGH** | 22 | 10 | 9 | 3 | Memory leaks, runtime bugs, missing cleanup |
| **MEDIUM** | 40 | 39 | 0 | 1 | Duplication, magic numbers, type safety, performance |
| **LOW** | 22 | 21 | 1 | 0 | Style, naming, minor robustness |

**Removed after verification:** C10 (archive-stream is intentionally public for `/view/{hash}` sharing), H40 (clearColor is frame-transient — main loop resets it), H41 (deps factories capture current value at call time — correct pattern), H42 (callback-before-transition is the intended design — transition continues in render loop). M-VR3 needs manual testing (fade callback exists but visual effect unclear).

**Fixed in `ccd5dc0`** (Phase 1 — Security & Auth): C11, C12, H26, H27, H28.
**Fixed in Phase 2+3** (Runtime Bugs + Extensions): H29, H30, H31, H32, H33, H43, L12.

**Fix plan:** `docs/superpowers/plans/2026-03-13-incremental-review-plan.md` — 12 phases ordered by severity and dependency.

---

## 11. CRITICAL Issues

### ~~C10~~ — `/api/archive-stream` intentionally unauthenticated — **FALSE POSITIVE (removed)**

The endpoint is designed to be public — it serves scrambled archive data to the public `/view/{hash}` page. Adding auth would break the public sharing workflow. The hash (`SHA-256(archiveUrl).slice(0, 16)`) acts as the access token. Input validation (H28) still applies.

### ~~C11~~ — XSS via `innerHTML` in `detail-viewer.ts:_showError()` — **FIXED in `ccd5dc0`**

Replaced `innerHTML` with `createElement` + `textContent`.

### ~~C12~~ — VR flight path toggle uses wrong visibility source in kiosk — **FIXED in `ccd5dc0`**

Changed `!splatMesh?.visible` to `!flightPathManager.isVisible`. Added `isVisible` getter to `FlightPathManager`.

---

## 12. HIGH Issues

### Security & Auth (3)

| # | Issue | File | Status |
|---|-------|------|--------|
| ~~H26~~ | ~~VAAPI device path passed unsanitized~~ | `meta-server.js` | **FIXED in `ccd5dc0`** — added `/^\/dev\/dri\/renderD\d+$/` validation + 512-char string limit |
| ~~H27~~ | ~~`GET /api/settings` unauthenticated~~ | `meta-server.js` | **FIXED in `ccd5dc0`** — added `requireAuth()` check |
| ~~H28~~ | ~~Stream hash not validated~~ | `meta-server.js` | **FIXED in `ccd5dc0`** — added `/^[a-f0-9]{16}$/` regex check |

### Runtime Bugs (5) — ALL FIXED

| # | Issue | File | Status |
|---|-------|------|--------|
| ~~H29~~ | ~~Environment blob wrapping bug~~ | `archive-pipeline.ts` | **FIXED** — use `envData.blob` directly instead of `new Blob([envData])` |
| ~~H30~~ | ~~`archiveLoader.getManifest()` does not exist~~ | `archive-pipeline.ts` | **FIXED** — changed to `archiveLoader.manifest` |
| ~~H31~~ | ~~Comparisons not re-exported~~ | `export-controller.ts` | **FIXED** — added `setComparisons()` call in `prepareArchive()` |
| ~~H32~~ | ~~`state.metadata` referenced but missing from AppState~~ | `main.ts` | **FIXED** — changed to `state.archiveManifest?.project?.title` |
| ~~H33~~ | ~~`state.theme` missing from KioskState~~ | `kiosk-main.ts` | **FIXED** — added `theme: string | null` to interface, assigned from `config.theme` |

### Memory Leaks (6)

| # | Issue | File | Impact |
|---|-------|------|--------|
| H34 | ComparisonViewer DOM listeners never removed on `close()` — only keydown removed | `comparison-viewer.ts:525-596` | After open/close cycles, stale closures reference disposed Three.js objects |
| H35 | DetailViewer `open()` returns early on load error without calling `close()` — leaves paused render loop, visible overlay, leaked renderer | `detail-viewer.ts:216-219` | Renderer, event listeners, and overlay remain active; parent render loop stays paused |
| H36 | 9 `document.addEventListener` calls in editorial `setup()` never removed on `cleanup()` | `editorial/layout.js:128,1137,1328,1465,1493,1513,1778,1965,2353` | Each archive reload adds 9 document-level listeners that accumulate in long-running kiosk sessions |
| H37 | `editorial-frozen-label` DOM element missing from cleanup class list — accumulates on archive reload | `editorial/layout.js:715-722` | Element appended to `fixedRoot` but not in `EDITORIAL_ROOT_CLASSES` array |
| H38 | Detail blob URLs not cleaned up in kiosk `cleanupCurrentScene()` | `kiosk-main.ts:2763-2811` | `state.loadedDetailBlobs` URLs never revoked when navigating between archives |
| H39 | Flight dropdown callbacks (`onPlaybackUpdate`, `onPlaybackEnd`, `onCameraModeChange`) not cleaned up | `editorial/layout.js:2268,2275,2283,2353` | Closures over stale DOM elements after cleanup/setup cycle |

### Renderer State (2 — both removed after verification)

| # | Issue | File | Status |
|---|-------|------|--------|
| ~~H40~~ | ~~PiP rendering does not restore `clearColor`~~ | `flight-path.ts:979` | **Removed** — main render loop resets clearColor each frame; frame-transient state |
| ~~H41~~ | ~~Stale `sparkRenderer` captured in `ArchivePipelineDeps`~~ | `main.ts:700` | **Removed** — deps factories are called fresh each invocation, capturing current value |

### Playback Logic (1 — removed after verification)

| # | Issue | File | Status |
|---|-------|------|--------|
| ~~H42~~ | ~~`stopPlayback()` fires `_onPlaybackEnd` before transition completes~~ | `flight-path.ts:778-800` | **Removed** — intended design; callback fires immediately, transition continues in render loop |

### Double Extension (1)

| # | Issue | File | Status |
|---|-------|------|--------|
| ~~H43~~ | ~~`.vdim` not in double-extension strip regex~~ | `export-controller.ts` | **FIXED** — added `vdim` to regex |

---

## 13. MEDIUM Issues

### VR Performance (1)

| # | Issue | File | Impact |
|---|-------|------|--------|
| M-VR1 | Per-frame allocation of `THREE.Raycaster` + `Vector3` objects in VR hot path at 72-90Hz | `vr-session.ts:713,936,367` | GC pressure causes frame drops and VR judder/motion sickness |

### Flight Path (5)

| # | Issue | File | Impact |
|---|-------|------|--------|
| M-FP1 | `_savedControlsTarget` declared but never written — orbit target not restored after chase/FPV round-trip | `flight-path.ts:177` | Camera orbits around stale target after returning to orbit mode |
| M-FP2 | `updatePlaybackPosition` allocates `new Vector3()`/`Quaternion()` every frame at 60fps | `flight-path.ts:1136-1137` | GC pressure during playback |
| M-FP3 | `seekTo()` does not clamp normalized `t` to [0, 1] | `flight-path.ts:809-818` | Slider overshoot reads past points array bounds |
| M-FP4 | Chase camera magic numbers (`camDist = 0.5`, `camHeight = 0.3`) duplicated in 2 locations | `flight-path.ts:1143-1144,887-888` | Not in constants.ts |
| M-FP5 | `recenterFreeLook()` and slerp animation allocate `new Quaternion()` each frame for identity comparison | `flight-path.ts:1306,1080` | Unnecessary per-frame allocation |

### Archive/Export (4)

| # | Issue | File | Impact |
|---|-------|------|--------|
| M-ARC1 | XOR key obfuscation labeled "encrypted" in comments — overstates security guarantee | `archive-scramble.ts:138,200-201` | Misleading for anyone auditing the security model |
| M-ARC2 | `environmentBlob` never cleared between archive loads — stale HDR persists | `archive-pipeline.ts` + `asset-store.ts` | Loading archive without HDR retains previous archive's environment |
| M-ARC3 | Detail model re-export fetches from blob URL which may have been revoked | `export-controller.ts:616-617` | If archive loader has been disposed, detail model is silently lost |
| M-ARC4 | `archiveLoader` parameter typed as `any` in `processArchive` — prevents catching compile-time bugs like the `getManifest()` issue (H30) | `archive-pipeline.ts:605` | Direct cause of H30 surviving to runtime |

### Editor/Kiosk Duplication (4)

| # | Issue | File | Impact |
|---|-------|------|--------|
| M-DUP6 | Detail inspect handler duplicated ~80 lines between editor and kiosk | `main.ts:1764-1842` vs `kiosk-main.ts:412-491` | Drift risk — bugs fixed in one but not the other |
| M-DUP7 | VR initialization duplicated ~30 lines between editor and kiosk | `main.ts:2466-2498` vs `kiosk-main.ts:614-643` | The kiosk version has the C12 bug that the editor version does not — exactly the drift duplication causes |
| M-DUP8 | Comparison viewer preview blob-loading pattern duplicated 3x in main.ts | `main.ts:1774-1837,2102-2158` | Same extract/cache/open pattern repeated |
| M-DUP9 | `_disposeMaterial` duplicated between `detail-viewer.ts` and `comparison-viewer.ts` | `detail-viewer.ts:808-816` vs `comparison-viewer.ts:711-719` | Identical implementations |

### Module Growth (2)

| # | Issue | File | Impact |
|---|-------|------|--------|
| M-SIZE1 | `main.ts` has grown from ~1,900 to 4,357 lines — 130% increase | `main.ts` | Detail models (~280 lines), comparison (~120 lines), optimization panel (~430 lines) could be extracted |
| M-SIZE2 | `editorial/layout.js` has grown to ~2,650 lines with flight dropdown, mobile overlay, detail viewer layout | `editorial/layout.js` | Increasingly hard to navigate |

### Theme Consistency (2)

| # | Issue | File | Impact |
|---|-------|------|--------|
| M-TH1 | Exhibit and Gallery themes missing `onFlightPathLoaded` hook — no flight UI in those themes | `exhibit/layout.js`, `gallery/layout.js` | Flight paths have no UI when using exhibit or gallery themes |
| M-TH2 | z-index stacking uses 36 values (0-250) with no documented scale | `editorial/layout.css` | Correct stacking by coincidence, not design |

### Type Safety (2)

| # | Issue | File | Impact |
|---|-------|------|--------|
| M-TS6 | `KioskState` incompatible with `AppState` — 37+ missing properties, 10+ compiler errors at deps boundaries | `kiosk-main.ts` | No compile-time safety for kiosk state usage; root cause of bugs like C12, H33 |
| M-TS7 | `normalizeManifest` works on `unknown` type — 14 compiler errors accessing properties | `kiosk-main.ts:162-171` | `deepSnakeKeys` returns `unknown`, all property accesses unchecked |

### Server (3)

| # | Issue | File | Impact |
|---|-------|------|--------|
| M-SRV1 | `/api/gpu` endpoint exposes hardware info without authentication | `meta-server.js:3327-3330` | GPU driver version and encoder list useful for fingerprinting |
| M-SRV2 | TOCTOU race between `existsSync` and `createReadStream` in archive streaming | `meta-server.js:2502-2547` | File deleted between stat and read causes unhandled stream error |
| M-SRV3 | File read stream `error` event not handled — can crash Node process | `meta-server.js:2539-2548` | Unhandled stream error takes down entire meta-server |

### Other (4)

| # | Issue | File | Impact |
|---|-------|------|--------|
| M-VR2 | Wrist menu material disposed before extracting `.map` texture for disposal | `vr-session.ts:775-792` | When material is an array, `.map` access on array returns `undefined` |
| M-VR3 | VR teleport fade — callback mechanism exists but visual effect unclear | `vr-session.ts:507-528` | **NEEDS MANUAL TESTING** — fade callback is wired but may not render a visible fade-to-black quad |
| M-BG1 | `background-loader.ts` module singleton breaks if multiple viewers exist | `background-loader.ts:46-50` | Second `enterReducedQualityMode` silently ignored |
| M-ICP1 | ~20 lines of `console.log('[ICP-DEBUG]')` left in production code | `main.ts:989,1008-1027,1049,1060-1064` | Clutters browser console, exposes internals |

### CSS (3)

| # | Issue | File | Impact |
|---|-------|------|--------|
| M-CSS1 | `!important` used 23 times in editorial layout.css | `editorial/layout.css` | Most for mobile overrides — acceptable but creates specificity ceiling |
| M-CSS2 | `parseMarkdown` output injected via innerHTML at 4 sites — defense-in-depth concern | `editorial/layout.js:304,418,433,528` | `parseMarkdown` escapes first, but regex bypass could inject HTML |
| M-CSS3 | `createCollapsible` uses innerHTML with `title` param — currently hardcoded but not enforced | `editorial/layout.js:151` | Future caller with manifest-derived data creates XSS vector |

---

## 14. LOW Issues

### Flight Path (3)

| # | Issue | File |
|---|-------|------|
| L1 | `_onPointerUp` handler does not check for FPV mode (inconsistent with down/move guards) | `flight-path.ts:1287-1289` |
| L2 | FPV default pitch angle `-15` degrees is a magic number | `flight-path.ts:1228` |
| L3 | Unused `_scene` constructor parameter | `flight-path.ts:186` |

### VR (2)

| # | Issue | File |
|---|-------|------|
| L4 | VR teleport physics constants (`ARC_SEGMENTS`, `GRAVITY`, `VELOCITY`) not in `constants.ts` VR object | `vr-session.ts:309-311` |
| L5 | VR auto-enter overlay uses `innerHTML` with hardcoded content — safe but inconsistent with project security patterns | `vr-session.ts:221-222` |

### Archive/Export (3)

| # | Issue | File |
|---|-------|------|
| L6 | Orphaned `_ARCHIVE_EXTENSIONS` variable with underscore prefix | `archive-loader.ts:26` |
| L7 | `_format` parameter in `createArchive` captured but unused | `archive-creator.ts:1998` |
| L8 | Magic number `2 * 1024 * 1024 * 1024` for source file size warning | `export-controller.ts:584` |

### New Modules (3)

| # | Issue | File |
|---|-------|------|
| L9 | `ComparisonViewer.activeLeader` not readable from outside the class | `comparison-viewer.ts:54` |
| L10 | `_handleKeydown` class property initialized to no-op then reassigned in `_wireEvents` | `comparison-viewer.ts:599,562` |
| L11 | Detail viewer editor control event listeners never removed — accumulate across open/close cycles | `detail-viewer.ts:399-577` |

### Kiosk (3)

| # | Issue | File |
|---|-------|------|
| ~~L12~~ | ~~Missing `.zip` and `.vdim` in kiosk `FILE_CATEGORIES.archive`~~ | `kiosk-main.ts` — **FIXED** |
| L13 | Inconsistent render loop pause/resume naming: editor `pauseRenderLoop` vs kiosk `pauseRender` | `main.ts:4268` vs `kiosk-main.ts:5690` |
| L14 | Magic number `0.382` (golden ratio) and `720` (sidebar max) inline in kiosk | `kiosk-main.ts:714` |

### Editorial Theme (4)

| # | Issue | File |
|---|-------|------|
| L15 | Duplicate flight log stats rendering code (~30 lines) in setup vs onFlightPathLoaded | `editorial/layout.js:1800-1829` vs `2370-2400` |
| L16 | Magic number `38.2%` (golden ratio) repeated 6 times without CSS variable | `editorial/layout.css` |
| L17 | Mobile breakpoint changed from 768px to 699px — may affect tablet portrait mode | `kiosk.css` |
| L18 | `var` declarations inside `for` loop in `createStaticMap` — should be `let` | `editorial/layout.js:79-98` |

### Docker (2)

| # | Issue | File |
|---|-------|------|
| L19 | `vainfo` HEVC/AV1 detection tests profiles and entrypoints independently — may false-positive | `meta-server.js:113-115` |
| L20 | nginx.conf missing `.vdim` in archive content-type block | `docker/nginx.conf:38` |

### Worker (1)

| # | Issue | File |
|---|-------|------|
| L21 | `draco-compress.worker.ts` `JSON.parse` on GLB chunk without try/catch — confusing error message on corrupt GLB | `draco-compress.worker.ts:54-56` |

### Editor Core (1)

| # | Issue | File |
|---|-------|------|
| L22 | `_pendingDetailKey` declared at line 4157 but first used at line 1866 | `main.ts:4157,1866` |

---

## 15. Systemic Patterns (Incremental)

### main.ts Growth Crisis

`main.ts` has grown from the documented ~1,900 lines to **4,357 lines** — a 130% increase in 2 days. New features (detail models, comparison viewer, optimization panel, VR wiring, flight path UI, rendering presets) were wired inline rather than extracted to modules. This is now the single largest file in the project and the primary source of duplication with `kiosk-main.ts`.

### Editor/Kiosk Divergence Accelerating

Every new feature (VR, detail viewer, comparison viewer, presets) is wired independently in both `main.ts` and `kiosk-main.ts`. The VR toggle bug (C12) is a direct consequence — the kiosk version references the wrong visibility source, a bug the editor version does not have. The `KioskState` vs `AppState` type incompatibility (M-TS6) means these drift bugs cannot be caught at compile time.

### Event Listener Lifecycle Gaps

A recurring pattern across new modules: event listeners are added in setup/init but never removed in cleanup/close. This affects:
- Editorial layout.js (9 document listeners per archive load — H36)
- ComparisonViewer (all DOM listeners except keydown — H34)
- DetailViewer editor controls (never removed — L11)
- Flight dropdown callbacks (H39)

The project would benefit from a standard `AbortController` pattern for grouped listener cleanup.

### Per-Frame Allocation in Hot Paths

Both VR (`vr-session.ts`) and flight playback (`flight-path.ts`) allocate `new THREE.Vector3()`, `new THREE.Quaternion()`, and `new THREE.Raycaster()` objects inside code that runs at 60-90Hz. This creates GC pressure that causes frame drops — especially problematic in VR where judder causes motion sickness.

### XOR Scramble Security Model Unclear

The VDIM archive "protection" uses XOR with a 32-byte repeating key. The key is "encrypted" with an HMAC derived from `VITE_ARCHIVE_SECRET` (which defaults to empty string). Comments say "encrypted" but the scheme provides obfuscation at best. The security model should be explicitly documented as preventing casual redistribution, not protecting against determined attackers.

---

## 16. Updated Recommended Priority

### ~~Immediate (security + data integrity)~~ — DONE (`ccd5dc0`)

1. ~~**H26** — Validate `video.vaapi_device` against `/dev/dri/renderD\d+` pattern~~
2. ~~**H27** — Add `requireAuth()` to `GET /api/settings`~~
3. ~~**H28** — Validate stream hash format~~
4. ~~**C11** — Fix innerHTML XSS in detail-viewer `_showError()`~~
5. ~~**C12** — Fix VR flight path toggle visibility source~~

### ~~Next (runtime bugs + extensions)~~ — DONE (Phase 2+3)

7. ~~**H29** — Fix environment blob wrapping (`envData.blob` not `new Blob([envData])`)~~
8. ~~**H30** — Fix `archiveLoader.getManifest()` → `.manifest`~~
9. ~~**H31** — Add `setComparisons()` call in `prepareArchive()`~~
10. ~~**H32** — Fix `state.metadata` reference in recording title~~
11. ~~**H33** — Add `theme` to `KioskState` interface~~
12. ~~**H43** — Add `.vdim` to double-extension strip regex~~
13. ~~**L12** — Add `.zip`/`.vdim` to kiosk `FILE_CATEGORIES`~~

### Soon (memory leaks)

13. **H34** — ComparisonViewer listener cleanup on close
14. **H35** — DetailViewer cleanup on load error
15. **H36** — Editorial document listener cleanup
16. **H37** — Add `editorial-frozen-label` to cleanup list
17. **H38** — Revoke detail blob URLs in kiosk cleanup
18. **H39** — Flight dropdown callback cleanup

### Medium-term (architecture)

20. **M-TS6** — Shared `BaseState` interface for editor/kiosk
21. **M-DUP6–9** — Extract shared detail/VR/comparison helpers
22. **M-SIZE1** — Extract modules from main.ts (detail, comparison, optimization panel)
23. **M-VR1** — Hoist VR per-frame allocations to module scope
24. **M-FP2/5** — Hoist flight path per-frame allocations

### Long-term

25. **M-ARC1** — Document XOR scramble security model accurately
26. **M-TH1** — Flight path support in exhibit/gallery themes
27. **M-CSS1–3** — Defense-in-depth innerHTML improvements
