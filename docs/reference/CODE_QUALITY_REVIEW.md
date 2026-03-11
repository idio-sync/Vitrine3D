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
| **HIGH** | 32 | 25 | 7 | Phases 1–6 (`936259b`–`42db075`) |
| **MEDIUM** | 69 | ~5 | ~64 | Incidental fixes during HIGH work |
| **LOW** | 48 | 0 | 48 | Not addressed |

All CRITICAL and most HIGH issues were resolved across 6 phases committed to the `dev` branch on 2026-03-11.

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

25 of 32 HIGH issues have been fixed.

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

---

## 4. Open — HIGH Issues

7 HIGH issues remain unresolved.

### Type Safety (5)

| # | Issue | File | Impact |
|---|-------|------|--------|
| H-TS1 | `SceneRefs` is 25+ fields of `any` despite `@types/three` installed | `types.ts:123-146` | IDE support and compile-time safety lost for all scene objects |
| H-TS2 | `AppState` index signature `[key: string]: any` defeats all 115+ typed fields | `types.ts:118` | Any typo in state access silently returns `undefined` |
| H-TS3 | 6 deps factories return `any` — entire dependency chain unchecked | `main.ts:423-772` | Type errors in module calls not caught at compile time |
| H-TS4 | 87 uses of `any` in kiosk-main.ts | `kiosk-main.ts` | Kiosk bundle has no type safety |
| H-TS5 | TypeScript compilation errors (`downloadScreenshot` missing from `EventWiringDeps`, `SharedArrayBuffer`/`ArrayBuffer` mismatch) | `kiosk-main.ts`, `event-wiring.ts:603` | Compilation warnings indicate interface drift |

### Logic Error (1)

| # | Issue | File | Impact |
|---|-------|------|--------|
| H-LE1 | `sceneRefs.splatMesh = null` is a no-op (assigns to getter-only property) | `main.ts:2175` | Splat mesh reference never actually cleared; potential stale reference |

### Security (1)

| # | Issue | File | Impact |
|---|-------|------|--------|
| H-SEC1 | Recording upload has no auth/CSRF outside CF Access | `recording-manager.ts:223` | POST endpoint unprotected in non-CF environments |

### Architecture (3 — refactoring scope)

| # | Issue | File | Impact |
|---|-------|------|--------|
| H-AR1 | `handleArchiveFile` is 660+ lines | `kiosk-main.ts:1479-2148` | Hard to test, review, and modify |
| H-AR2 | Duplicate flight path input handlers | `main.ts:1656-1706` | Copy-paste divergence risk |
| H-AR3 | `collection-manager.ts` singleton state never cleaned up | `collection-manager.ts` | Double-init duplicates event listeners |

---

## 5. Open — MEDIUM Issues

~64 MEDIUM issues remain. Grouped by theme:

### Editor/Kiosk Code Duplication (~15 issues)

Functions duplicated between `main.ts`/`kiosk-main.ts` or across multiple modules:
- `escapeHtml` — consolidated in `utilities.ts` but some modules still use local copies
- `formatBytes`, `formatDate` — duplicated in kiosk-main, metadata-manager, collection-page
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

### Module-Level Singletons Without Cleanup (~6 issues)

Modules with mutable state that's never reset:
- `collection-manager.ts` — event listeners duplicated on re-init
- `map-picker.ts` — map instance leaks on repeated open/close
- `recording-manager.ts` — timer state partially cleaned (improved in Phase 3)
- `walkthrough-editor.ts` — reset added in Phase 3, but other singletons remain

### Large File Decomposition (~5 issues)

| Module | Lines | Suggested Extraction |
|--------|-------|----------------------|
| `kiosk-main.ts` | 5,364 | Archive loading, viewer settings, metadata display, mobile UI, toolbar |
| `metadata-manager.ts` | 2,940 | Display, collection, camera constraints |
| `file-handlers.ts` | 2,593 | Per-format loaders into separate files |

### Polling Instead of Events (~4 issues)

`ensureAssetLoaded` in `archive-pipeline.ts` and `kiosk-main.ts` polls with `setTimeout`. The loader could resolve a Promise instead, eliminating the polling pattern entirely.

### Performance (~3 issues)

- `calculateSHA256Streaming` reads chunks then combines into a full buffer, doubling peak memory (`archive-creator.ts:513-565`)
- N+1 query pattern — sequential API call per collection (`collection-manager.ts:502-515`)
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

The single biggest quality debt. `SceneRefs`, `AppState`, all deps factories, kiosk state, and Spark.js types all use `any` extensively. TypeScript is configured and `@types/three` is installed, but types are bypassed everywhere. This makes the TypeScript migration incomplete — the compiler catches almost nothing.

### Duplication Across Editor/Kiosk

The editor (`main.ts`) and kiosk (`kiosk-main.ts`) share significant logic but implement it independently. Utility functions, blob loaders, transform handling, and UI helpers are duplicated 2–4x. Changes to shared behavior require updating both codepaths.

### 8-Way Asset Branching

Eight asset types (splat, model, pointcloud, STL, CAD, drawing, flightpath, colmap) create long if/else chains in transform-controller, event-wiring, ui-controller, and archive-pipeline. A registry or map-based dispatch pattern would reduce this from O(asset types × call sites) to O(1) per addition.

### Polling Instead of Events

Asset loading completion is detected by polling state every 50ms. Converting to Promise-based resolution would be cleaner and more efficient.

### Module Singletons Without Lifecycle

Several modules use mutable module-scope state without reset/dispose functions, causing issues on repeated initialization (duplicate listeners, stale state).

---

## 8. Recommended Priority

### Next up (high impact, moderate effort)

1. **Remove `[key: string]: any` from `AppState`** — Instantly catches typos in state access across the entire codebase.
2. **Fix `sceneRefs.splatMesh = null` no-op** — Quick logic bug; getter-only property silently discards the assignment.
3. **Type `SceneRefs` with Three.js types** — Replace 25+ `any` fields with proper types from `@types/three`.
4. **Type deps factories** — Return typed objects instead of `any` from the 6 factory functions in `main.ts`.

### Medium-term (quality improvement)

5. **Consolidate duplicated utilities** — Single canonical `formatBytes`, `formatDate` in `utilities.ts`.
6. **Asset type registry** — Replace 8-way if/else chains with a map pattern; makes adding asset types a one-location change.
7. **Recording auth** — Add CSRF token or session validation to the upload endpoint.
8. **Extract kiosk-main.ts** — Break the 5,364-line file into focused modules (archive loading, viewer settings, metadata display, mobile UI).

### Long-term (technical debt)

9. **Promise-based asset loading** — Replace polling with Promise resolution.
10. **Module singleton lifecycle** — Add reset/dispose to collection-manager, map-picker, etc.
11. **SHA-256 streaming fix** — Use incremental hashing instead of buffering the full file.
12. **N+1 collection queries** — Batch API calls in collection-manager.
