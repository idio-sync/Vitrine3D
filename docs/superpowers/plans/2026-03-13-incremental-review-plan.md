# Incremental Review #2 — Phased Fix Plan

**Date:** 2026-03-13
**Source:** `docs/reference/CODE_QUALITY_REVIEW.md` §10–16
**Total open issues:** 81 (2 CRITICAL, 19 HIGH, 39 MEDIUM, 22 LOW)
**Removed after verification:** C10 (archive-stream intentionally public for `/view/{hash}` sharing — user shares via UUID), H40 (clearColor is frame-transient), H41 (deps factory pattern is correct), H42 (callback-before-transition is intended)

---

## Verification Status

All findings were cross-checked against current code. Corrections from verification:

| # | Review Said | Verification Result | Final Status |
|---|-------------|--------------------|----|
| H29 | `new Blob([envData])` wraps ExtractedFile object | Verification agent said "FIXED" but `extractFile()` returns `ExtractedFile { blob, url, name }` — wrapping the object produces `[object Object]` | **EXISTS** |
| H30 | `getManifest()` doesn't exist | Verification agent said "FIXED" but grep confirms zero matches in archive-loader.ts | **EXISTS** |
| H31 | `setComparisons()` never called in export | Verification agent said "design correct" but grep confirms zero matches in export-controller.ts | **EXISTS** |
| H32 | `state.metadata` missing from AppState | Verification agent said "FIXED" but AppState (types.ts:89-168) has no `metadata` field | **EXISTS** |
| C10 | Unauthenticated archive-stream | Endpoint is intentionally public for `/view/{hash}` sharing; user shares via UUID | **REMOVED** |
| H40 | PiP clearColor not restored | Main render loop sets clearColor each frame — **not a real issue** | **REMOVED** |
| H41 | Stale sparkRenderer in deps | Deps factories are called fresh each invocation — **not a real issue** | **REMOVED** |
| H42 | Premature _onPlaybackEnd | Callback fires before transition but transition continues in render loop — **intended pattern** | **REMOVED** |
| M-VR3 | Teleport fade has no visual effect | Fade callback mechanism exists but may not render a visible fade quad — **NEEDS MANUAL TESTING** | **NEEDS REVIEW** |

---

## Phase 1 — Security & Auth (CRITICAL + HIGH)

**Scope:** 6 issues across 2 files
**Estimated effort:** Small — all are 1-5 line fixes
**Impact:** Fixes auth bypass, input validation, and XSS

| # | Issue | File | Fix |
|---|-------|------|-----|
| ~~C10~~ | ~~Unauthenticated `/api/archive-stream`~~ | `meta-server.js` | **REMOVED** — endpoint is intentionally public for `/view/{hash}` sharing |
| H26 | Unsanitized VAAPI device path | `meta-server.js` | Add pattern validation `/^\/dev\/dri\/renderD\d+$/` in `validateSetting()` |
| H27 | `GET /api/settings` unauthenticated | `meta-server.js` | Add `if (!requireAuth(req, res)) return;` in `handleGetSettings` |
| H28 | Stream hash not validated | `meta-server.js` | Add `/^[a-f0-9]{16}$/` regex check before `handleArchiveStream` call |
| C11 | XSS in `_showError()` innerHTML | `detail-viewer.ts` | Replace innerHTML with `createElement` + `textContent` |
| C12 | VR flight path toggle wrong source | `kiosk-main.ts` | Change `!splatMesh?.visible` → `!flightPathManager.isVisible` |

---

## Phase 2 — Runtime Bugs (HIGH)

**Scope:** 5 issues across 4 files
**Estimated effort:** Small-medium — 1-10 line fixes each
**Impact:** Fixes silent data corruption, TypeError crashes, and data loss on re-export

| # | Issue | File | Fix |
|---|-------|------|-----|
| H29 | Environment blob wraps ExtractedFile object | `archive-pipeline.ts:832` | Change `new Blob([envData])` → `envData.blob` and `deps.state.environmentBlob = envBlob` → `deps.state.environmentBlob = envData.blob` |
| H30 | `archiveLoader.getManifest()` doesn't exist | `archive-pipeline.ts:463` | Change to `archiveLoader.manifest` |
| H31 | Comparisons lost on re-export | `export-controller.ts` | Add `archiveCreator.setComparisons(state.archiveManifest?.comparisons)` in `prepareArchive()` |
| H32 | `state.metadata?.title` doesn't exist on AppState | `main.ts:3381` | Change to `state.archiveManifest?.title \|\| 'Untitled'` |
| H33 | `theme` missing from KioskState | `kiosk-main.ts` | Add `theme: string \| null` to KioskState; assign `state.theme = config.theme \|\| null` in init |

---

## Phase 3 — Double Extension + Missing File Types

**Scope:** 2 issues across 2 files
**Estimated effort:** Tiny — 1 line each
**Impact:** Prevents double `.vdim.vdim` extensions and enables kiosk file picker to accept new formats

| # | Issue | File | Fix |
|---|-------|------|-----|
| H43 | `.vdim` not in double-extension regex | `export-controller.ts:710` | Add `vdim` to regex: `/\.(ddim\|a3d\|a3z\|zip\|vdim)$/i` |
| L12 | Missing `.zip`/`.vdim` in kiosk FILE_CATEGORIES | `kiosk-main.ts:257` | Add `'.zip'`, `'.vdim'` to archive array |

---

## Phase 4 — Memory Leaks: Viewer Modules (HIGH)

**Scope:** 2 issues across 2 files
**Estimated effort:** Medium — requires AbortController or listener tracking pattern
**Impact:** Fixes resource leaks in ComparisonViewer and DetailViewer on open/close cycles

| # | Issue | File | Fix |
|---|-------|------|-----|
| H34 | ComparisonViewer DOM listeners not removed on close | `comparison-viewer.ts` | Add `AbortController` in `_wireEvents()`, abort signal in `close()` |
| H35 | DetailViewer error path doesn't call close() | `detail-viewer.ts` | Call `this.close()` in catch block after `_showError()` |

---

## Phase 5 — Memory Leaks: Editorial Theme (HIGH)

**Scope:** 4 issues in 1 file
**Estimated effort:** Medium — requires tracking document listeners
**Impact:** Fixes listener accumulation in long-running kiosk sessions

| # | Issue | File | Fix |
|---|-------|------|-----|
| H36 | 9 document listeners never removed | `editorial/layout.js` | Store named refs in module-scoped array; remove in `cleanup()` |
| H37 | `editorial-frozen-label` not in cleanup list | `editorial/layout.js` | Add to `EDITORIAL_ROOT_CLASSES` array |
| H38 | Detail blob URLs not revoked in kiosk cleanup | `kiosk-main.ts` | Add revoke loop + `.clear()` in `cleanupCurrentScene()` |
| H39 | Flight dropdown callbacks not cleaned up | `editorial/layout.js` | Null out `fpm.onPlaybackUpdate` etc. in `cleanup()` |

---

## Phase 6 — Server Robustness (MEDIUM)

**Scope:** 4 issues in 1 file
**Estimated effort:** Small — error handlers and input validation
**Impact:** Prevents server crashes and information leakage

| # | Issue | File | Fix |
|---|-------|------|-----|
| M-SRV1 | `/api/gpu` no auth | `meta-server.js` | Add `requireAuth()` check |
| M-SRV2 | TOCTOU race in archive streaming | `meta-server.js` | Use `fs.openSync()` once, pass `fd` to both stat and stream |
| M-SRV3 | Read stream error unhandled | `meta-server.js` | Add `.on('error', ...)` to both createReadStream calls |
| L20 | nginx.conf missing `.vdim` | `docker/nginx.conf` | Add `vdim` to archive location regex |

---

## Phase 7 — Per-Frame Allocation Fixes (MEDIUM)

**Scope:** 7 issues across 2 files
**Estimated effort:** Medium — hoist allocations to class/module scope
**Impact:** Eliminates GC-induced frame drops in VR (72-90Hz) and flight playback (60Hz)

| # | Issue | File | Fix |
|---|-------|------|-----|
| M-VR1 | VR Raycaster/Vector3 per-frame | `vr-session.ts` | Hoist to module-scope `_raycaster`, `_tempVec3A/B`, `_tempDir` |
| M-FP2 | Playback per-frame Vector3/Quaternion | `flight-path.ts` | Add private `_tempWorldPos`, `_tempGroupQuat` class fields |
| M-FP5 | Identity Quaternion allocated per-frame | `flight-path.ts` | Add module-scope `const IDENTITY_QUAT = Object.freeze(new THREE.Quaternion())` |
| M-FP3 | `seekTo()` doesn't clamp `t` | `flight-path.ts` | Add `t = Math.max(0, Math.min(1, t))` |
| M-FP1 | `_savedControlsTarget` never written | `flight-path.ts` | Save/restore controls target on camera mode transitions |
| M-FP4 | Chase camera magic numbers duplicated | `flight-path.ts` + `constants.ts` | Add `CHASE_CAM_DISTANCE/HEIGHT` to `FLIGHT_LOG` constants |
| M-VR2 | Wrist menu material dispose order | `vr-session.ts` | Extract map before material.dispose() |

---

## Phase 8 — Archive Pipeline Hardening (MEDIUM)

**Scope:** 4 issues across 3 files
**Estimated effort:** Small
**Impact:** Fixes stale state between loads, type safety, and security documentation

| # | Issue | File | Fix |
|---|-------|------|-----|
| M-ARC2 | `environmentBlob` not cleared between loads | `archive-pipeline.ts` | Add `deps.state.environmentBlob = null` + `comparisonAfterEntry = null` at top of `processArchive()` |
| M-ARC4 | `archiveLoader: any` hides bugs | `archive-pipeline.ts` | Type as `ArchiveLoader` — would have caught H30 at compile time |
| M-ARC3 | Detail re-export from revoked blob URL | `export-controller.ts` | Store `Blob` reference in `loadedDetailBlobs` instead of URL string |
| M-ARC1 | "Encrypted" comments overstate security | `archive-scramble.ts` | Change comments to "obfuscated" with security model note |

---

## Phase 9 — Debug Cleanup + Quick Wins (MEDIUM + LOW)

**Scope:** 7 issues across 4 files
**Estimated effort:** Tiny — mechanical find-and-fix
**Impact:** Cleans up production console, fixes minor inconsistencies

| # | Issue | File | Fix |
|---|-------|------|-----|
| M-ICP1 | 20 lines of `[ICP-DEBUG]` console.log | `main.ts` | Remove or change to `log.debug()` |
| L18 | `var` in `createStaticMap` for loop | `editorial/layout.js` | Change to `let` |
| L21 | Worker JSON.parse without try/catch | `draco-compress.worker.ts` | Wrap in try/catch, return false |
| L6 | Orphaned `_ARCHIVE_EXTENSIONS` | `archive-loader.ts` | Remove or export |
| L7 | Unused `_format` parameter | `archive-creator.ts` | Remove from options interface |
| L8 | Magic 2GB size warning number | `export-controller.ts` | Extract to `MAX_SOURCE_FILE_SIZE` constant |
| L22 | `_pendingDetailKey` declaration far from use | `main.ts` | Move declaration near line 1860 |

---

## Phase 10 — CSS & Theme Defense-in-Depth (MEDIUM + LOW)

**Scope:** 8 issues across 3 files
**Estimated effort:** Medium
**Impact:** Hardens innerHTML patterns, documents z-index scale, adds missing theme hooks

| # | Issue | File | Fix |
|---|-------|------|-----|
| M-CSS3 | `createCollapsible` innerHTML with title | `editorial/layout.js` | Use `createElement` + `textContent` |
| M-CSS2 | `parseMarkdown` innerHTML at 4 sites | `editorial/layout.js` | Add comment documenting pre-escaping, or use trusted types |
| M-TH2 | z-index scale undocumented | `editorial/layout.css` | Add z-index scale comment block at top |
| M-TH1 | Exhibit/Gallery missing flight hooks | `exhibit/layout.js`, `gallery/layout.js` | Add stub `onFlightPathLoaded` functions |
| L15 | Duplicate flight stats rendering | `editorial/layout.js` | Extract `buildFlightStatsGrid()` helper |
| L16 | Golden ratio `38.2%` repeated 6x | `editorial/layout.css` | Define `--editorial-detail-split: 38.2%` CSS variable |
| L4 | VR teleport constants not in constants.ts | `vr-session.ts` + `constants.ts` | Move to `VR` constants object |
| L2 | FPV pitch magic number | `flight-path.ts` | Add `FPV_DEFAULT_PITCH_DEG` to `FLIGHT_LOG` constants |

---

## Phase 11 — Editor/Kiosk Deduplication (MEDIUM — larger scope)

**Scope:** 4 issues across 3 files
**Estimated effort:** Large — requires shared helper modules
**Impact:** Reduces drift risk, prevents future bugs like C12

| # | Issue | File | Fix |
|---|-------|------|-----|
| M-DUP6 | Detail inspect handler duplicated | `main.ts` + `kiosk-main.ts` | Extract `openDetailInspect()` to `detail-viewer-utils.ts` |
| M-DUP7 | VR init duplicated | `main.ts` + `kiosk-main.ts` | Extract `createVRDeps()` factory to shared module |
| M-DUP8 | Comparison blob-loading 3x in main.ts | `main.ts` | Extract `loadAndOpenComparison()` helper |
| M-DUP9 | `_disposeMaterial` duplicated | `detail-viewer.ts` + `comparison-viewer.ts` | Extract to `utilities.ts` |

---

## Phase 12 — Type Safety (MEDIUM — ongoing)

**Scope:** 2 issues, systemic
**Estimated effort:** Large — KioskState refactor touches many files
**Impact:** Prevents entire class of kiosk drift bugs at compile time

| # | Issue | File | Fix |
|---|-------|------|-----|
| M-TS6 | KioskState incompatible with AppState | `kiosk-main.ts` + `types.ts` | Create shared `BaseViewerState` interface, have both extend it |
| M-TS7 | `normalizeManifest` works on `unknown` | `kiosk-main.ts` | Cast `deepSnakeKeys` result to `Record<string, any>` |

---

## Remaining LOW issues (not phased — fix opportunistically)

| # | Issue | File |
|---|-------|------|
| L1 | `_onPointerUp` missing FPV guard | `flight-path.ts` |
| L3 | Unused `_scene` constructor param | `flight-path.ts` |
| L5 | VR overlay innerHTML (safe, inconsistent) | `vr-session.ts` |
| L9 | `activeLeader` not externally readable | `comparison-viewer.ts` |
| L10 | `_handleKeydown` double-initialized | `comparison-viewer.ts` |
| L11 | Detail editor listeners never removed | `detail-viewer.ts` |
| L13 | Inconsistent pause/resume naming | `main.ts` vs `kiosk-main.ts` |
| L14 | Golden ratio magic number in kiosk | `kiosk-main.ts` |
| L17 | Mobile breakpoint 699px vs 768px | `kiosk.css` |
| L19 | vainfo detection imprecise | `meta-server.js` |

---

## Execution Order

```
Phase 1  (security)          — do first, independent
Phase 2  (runtime bugs)      — do second, independent
Phase 3  (extensions)        — trivial, can batch with Phase 1 or 2
Phase 4  (viewer leaks)      — independent
Phase 5  (editorial leaks)   — independent
Phase 6  (server robustness) — independent, can parallel with 4-5
Phase 7  (per-frame alloc)   — independent
Phase 8  (archive pipeline)  — do after Phase 2 (depends on H29/H30 fixes)
Phase 9  (cleanup)           — independent, low risk
Phase 10 (CSS/themes)        — independent
Phase 11 (deduplication)     — do after Phases 1-5 (depends on fixes being in place)
Phase 12 (type safety)       — do last (systemic refactor, benefits from all prior fixes)
```

**Phases 1-3** are the highest priority and can be done in one session.
**Phases 4-7** can be parallelized.
**Phases 8-10** are medium priority.
**Phases 11-12** are architectural improvements best done after the bug fixes land.
