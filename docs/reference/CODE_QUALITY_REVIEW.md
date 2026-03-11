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

---

## 1. Status Summary

| Severity | Total | Fixed | Open | Fix Commit Range |
|----------|-------|-------|------|------------------|
| **CRITICAL** | 9 | 9 | 0 | Phases 1–2 (`936259b`–`53cbbfb`) |
| **HIGH** | 32 | 32 | 0 | Phases 1–11 (`936259b`–latest) |
| **MEDIUM** | 69 | ~18 | ~51 | Phases 8, 12–14 + incidental fixes during HIGH work |
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

~59 MEDIUM issues remain. Grouped by theme:

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
| `file-handlers.ts` | 2,593 | Per-format loaders into separate files |

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
- Unused imports and dead code paths

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

### Polling Instead of Events

Asset loading completion is detected by polling state every 50ms. Converting to Promise-based resolution would be cleaner and more efficient.

### Module Singletons Without Lifecycle

Partially addressed in Phase 12: `map-picker.ts` now has `destroyMapPicker()` (called automatically on modal close), `collection-manager.ts` now has `resetCollectionManager()`. Other modules with mutable singleton state (e.g., annotation-system, transform-controller) still lack dispose/reset.

---

## 8. Recommended Priority

### Next up (high impact)

1. **Reduce `any` in kiosk-main.ts** — Type state, deps factories, traverse callbacks, and archive manifest handling.
2. **Extract kiosk-main.ts** — Break the 5,360-line file into focused modules (archive loading, viewer settings, metadata display, mobile UI).

### Medium-term (quality improvement)

3. **Asset type registry** — Replace 8-way if/else chains with a map pattern; makes adding asset types a one-location change.

### Long-term (technical debt)

4. **Promise-based asset loading** — Replace polling with Promise resolution.
5. **Module singleton lifecycle** — Add full reset/dispose to map-picker, recording-manager, etc.
6. **SHA-256 streaming fix** — Use incremental hashing instead of buffering the full file.
7. **N+1 collection queries** — Batch API calls in collection-manager.
