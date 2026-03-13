# Background Asset Loading — Smooth SD→HD Upgrade

**Date:** 2026-03-12
**Status:** Draft
**Affects:** `kiosk-main.ts`, `archive-pipeline.ts`, `loaders/archive-asset-loader.ts`, new `background-loader.ts`, new `mesh-parse.worker.ts`

## Problem

When an archive contains both SD proxy and HD full-resolution assets, the SD proxy loads quickly and the viewer becomes interactive. But as HD assets load in the background, the main thread is blocked by:

1. **GLTFLoader mesh parsing** — HD `.glb` files (75-200MB, 2-5M faces) parse synchronously on the main thread via `parseMeshOffScene()` in `archive-asset-loader.ts`
2. **GPU uploads** — `scene.add(mesh)` and `SplatMesh` texture initialization trigger synchronous `gl.bufferData` / `gl.texImage2D` calls
3. **Splat texture upload** — Spark 2.0 already decodes `.spz` files off-thread in its internal worker pool (`SplatLoader.loadInternal()` → `workerPool.withWorker()` → `worker.call("loadPackedSplats")`), but the decoded `PackedSplats` initialization (GPU texture creation) happens on the main thread via `packedSplats.initialize()` and blocks during `await splatMesh.initialized`

These compete with `requestAnimationFrame` for main-thread time, causing 2-15 second freezes and dropped frames during what should be a smooth viewing experience.

**Not a bottleneck:** ZIP extraction (archives use STORE mode — byte slicing, zero decompression cost) or splat WASM decoding (already off-thread via Spark's worker pool).

## Solution: Two-Phase Approach

### Phase 1: Frame-Budget Throttling + Yield-to-Renderer (Low Risk)

Reduce the render loop's cost during background loading so that even when GPU uploads and parsing hit the main thread, frames still complete within budget.

**Throttling levers:**
- Reduce `sparkRenderer.lodSplatCount` to a loading budget of 250K — new constant `LOADING_LOD_BUDGET` added to `background-loader.ts`. Applied unconditionally regardless of current tier (both SD=1M and HD=5M are reduced to 250K during background loading).
- Drop `renderer.setPixelRatio()` to 1.0 (from `devicePixelRatio`, often 2x)
- `enterReducedQualityMode()` captures the current LOD budget and pixel ratio in `originalLodBudget`/`originalPixelRatio` before reducing. `exitReducedQualityMode()` restores those captured values — so if loading started while in SD tier (1M), it restores to 1M, not HD's 5M.
- These two changes alone can reduce per-frame GPU cost by 80-90%

**Yield-to-renderer pattern:**
- Insert `await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))` between heavy synchronous steps
- This guarantees at least one render frame between each blocking operation
- Applied inside `parseMeshOffScene()` (between mesh child processing), around `swapMeshChildren()`, around `swapSplatAsset()` (before/after `await newSplat.initialized`), and between sequential asset loads in Phase 3

**Atomic swap (already exists):**
- `swapMeshChildren()` in `archive-asset-loader.ts` does synchronous geometry/material replacement
- `swapSplatAsset()` does load-then-swap for splats (create off-scene, await init, atomic remove+add)
- Both avoid blank frames during SD→HD transition

### Phase 2: Web Worker for Mesh Parsing (Higher Risk, Higher Reward)

Move GLTFLoader mesh parsing off the main thread. Only pursued if Phase 1 doesn't achieve acceptable smoothness.

**One dedicated Worker:**

`mesh-parse.worker.ts` — Receives `.glb` ArrayBuffer, runs `GLTFLoader.parse()`, serializes geometry `BufferAttribute` arrays and material definitions, returns via Transferable (zero-copy).

**Why no splat Worker:** Spark 2.0 already decodes `.spz` in its internal worker pool. The remaining splat bottleneck is GPU texture upload during `PackedSplats.initialize()`, which must happen on the main thread (WebGL context is not transferable). The throttling + yield approach in Phase 1 is the correct mitigation for GPU upload stalls.

## Architecture

### New File: `src/modules/background-loader.ts`

Coordinator module. ~150-250 lines estimated.

```typescript
/** LOD budget during background loading — low enough to make render frames cheap */
const LOADING_LOD_BUDGET = 250_000;

interface BackgroundLoadOptions {
  renderer: THREE.WebGLRenderer;
  sparkRenderer: any;              // SparkRenderer instance
  originalLodBudget: number;       // to restore after loading
  originalPixelRatio: number;      // to restore after loading
}

// Phase 1: Throttling API
export function enterReducedQualityMode(opts: BackgroundLoadOptions): void;
export function exitReducedQualityMode(opts: BackgroundLoadOptions): void;

// Yield helper — guarantees at least one render frame
export function yieldToRenderer(): Promise<void>;

// Phase 2: Worker-based mesh loading
export function loadMeshInWorker(glbBuffer: ArrayBuffer): Promise<THREE.Group>;
```

### New File: `src/modules/workers/mesh-parse.worker.ts` (Phase 2 only)

- Imports `GLTFLoader` from `three/examples/jsm/loaders/GLTFLoader.js`
- Receives `ArrayBuffer` via `postMessage` (Transferable)
- Parses GLB, extracts geometry `BufferAttribute` arrays and material definitions
- Returns serialized geometry/material data via Transferable (zero-copy)
- Main thread reconstructs `THREE.Mesh` objects from the serialized data
- Requires `OffscreenCanvas` polyfill and `document.createElement` stub for Three.js texture handling

### Modifications to Existing Files

**`src/modules/loaders/archive-asset-loader.ts`** — where the actual blocking work happens:
- `loadArchiveFullResMesh()` (~line 530-594): add `yieldToRenderer()` between the `await parseMeshOffScene()` call (~line 554) and the `swapMeshChildren()` call (~line 577). `parseMeshOffScene()` itself is a thin 18-line format dispatcher (delegates to `loadGLTF()`, `loadOBJFromUrl()`, etc.) — yields go around it, not inside it.
- `swapSplatAsset()` (~line 602-643): add `yieldToRenderer()` before `await newSplat.initialized` (~line 627), which is where GPU texture upload blocks the main thread
- Phase 2: replace the `parseMeshOffScene(buffer)` call with `loadMeshInWorker(buffer)` when Worker is available

**`kiosk-main.ts`** — Phase 3 background loading section (~lines 2070-2177):
- Wrap entire HD loading sequence in `enterReducedQualityMode()` / `exitReducedQualityMode()`
- Insert `yieldToRenderer()` between sequential asset loads (mesh, splat, pointcloud, flight paths)

**`archive-pipeline.ts`** — Phase 3 background loading (~lines 843-885) and `switchQualityTier()` (~line 1121):
- Same throttling wrapper and yield points as kiosk

**`main.ts`** — editor entry point:
- Editor uses `archive-pipeline.ts` for archive loading, so throttling in `archive-pipeline.ts` covers the editor path
- No direct changes needed in `main.ts` unless editor-specific loading sequences exist outside the pipeline

## Loading Flow (Full Implementation)

User opens archive URL → kiosk boots:

1. **Manifest parse** — instant (JSON from ZIP, STORE mode)
2. **SD proxy load** — fast (small assets, <2s typical)
3. **Viewer becomes interactive** — SD assets visible, user can orbit/zoom
4. **`enterReducedQualityMode()`** — LOD drops to 250K, pixel ratio to 1.0
5. **HD splat load** — Spark decodes `.spz` in its worker pool (off-thread), then `PackedSplats.initialize()` uploads textures on main thread. `yieldToRenderer()` before/after the GPU upload ensures render frames continue
6. **`yieldToRenderer()`** — between asset types
7. **HD mesh parse** — Phase 1: `parseMeshOffScene()` on main thread with yields. Phase 2: `loadMeshInWorker()` in Worker
8. **`yieldToRenderer()`**
9. **Atomic swap** — SD→HD in single sync block (existing `swapMeshChildren`/`swapSplatAsset`)
10. **`exitReducedQualityMode()`** — LOD restored to HD budget, pixel ratio restored
11. **Full HD interactive** — smooth transition, no blank frames

## Performance Expectations

### Current Behavior (measured against typical archives)
| Asset | Parse Time | Main Thread Block | User Experience |
|-------|-----------|-------------------|-----------------|
| HD splat (200MB .spz) | 3-8s | 0.5-2s (GPU upload only; decode is off-thread) | Stutter during texture init |
| HD mesh (150MB .glb) | 2-5s | 2-5s continuous (parsing on main thread) | Complete freeze |
| GPU upload (5M faces) | 0.2-0.5s | 0.2-0.5s | Brief stutter |
| **Total** | **5-14s** | **3-8s** | **Unusable** |

### Phase 1: Throttling + Yield
| Asset | Parse Time | Main Thread Block | User Experience |
|-------|-----------|-------------------|-----------------|
| HD splat (200MB .spz) | 3-8s (decode off-thread) | 50-200ms bursts (GPU upload with yields) | Minor stutters |
| HD mesh (150MB .glb) | 3-7s (slower with yields) | 50-200ms bursts | Minor stutters |
| GPU upload (5M faces) | 0.2-0.5s | 0.2-0.5s | Brief stutter |
| **Total** | **6-16s** | **Intermittent** | **Usable** |

Parse wall-clock time increases ~20-30% due to yielding, but perceived smoothness improves dramatically. The reduced LOD budget means each render frame costs <2ms instead of 8-15ms, so the renderer catches up between blocking bursts.

### Phase 2: Mesh Worker + Throttling
| Asset | Parse Time | Main Thread Block | User Experience |
|-------|-----------|-------------------|-----------------|
| HD splat (200MB .spz) | 3-8s (Spark worker) | 50-200ms (GPU upload with yields) | Minor stutters |
| HD mesh (150MB .glb) | 2-5s (our Worker) | 50-100ms (reconstruct + GPU upload) | Near-smooth |
| GPU upload (5M faces) | 0.2-0.5s | 0.2-0.5s | Brief stutter |
| **Total** | **3-8s** (parallel) | **0.3-0.7s** total | **Smooth** |

## Fallback Chain

```
Phase 2: Mesh Worker
  ├─ success → Transferable geometry back to main thread → reconstruct → scene.add()
  └─ failure (GLTFLoader DOM deps, CSP, browser compat) →
      Phase 1: Main-thread parse + yield-to-renderer
        ├─ success → parseMeshOffScene() with yields between steps
        └─ failure →
            Direct load (current behavior, no throttling)

Splat loading always uses Spark's built-in worker pool (no custom Worker needed).
Throttling (reduced LOD + pixel ratio) is active in all paths.
```

The fallback is automatic and transparent. Phase 1 is always the safety net.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GLTFLoader needs DOM in Worker | Medium | Phase 2 mesh Worker needs polyfills | `OffscreenCanvas` + stub `document.createElement`; well-trodden path in Three.js community |
| GPU upload stutter unavoidable | Certain | 200-500ms stutter on HD swap | Reduced LOD budget during swap minimizes impact; yield before/after upload |
| Phase 1 insufficient for very large meshes | Low-medium | Stutters still noticeable on 5M+ face meshes | Phase 2 Worker eliminates parsing from main thread |
| Spark worker pool contention | Low | Splat decode slowed if other splats loading | Only one HD splat loads at a time; pool has 4 workers |
| `yieldToRenderer()` inside `parseMeshOffScene` increases total parse time | Certain | ~20-30% longer wall-clock time | Acceptable tradeoff — user can interact during entire period |

## Spike Plan (Before Phase 2)

**Duration:** 2-4 hours

1. Test `GLTFLoader` in a Worker with `OffscreenCanvas` polyfill — confirm geometry extraction works for a real HD `.glb` file
2. Measure overhead of serializing/transferring `BufferAttribute` arrays back to main thread vs. parsing on main thread directly
3. If overhead is >50% of parse time, the Worker approach has diminishing returns — stay with Phase 1

## Implementation Order

1. **Phase 1** (~1-2 days)
   - Create `background-loader.ts` with throttling API (`enterReducedQualityMode`/`exitReducedQualityMode`) and `yieldToRenderer()`
   - Add yield points inside `archive-asset-loader.ts`: around `parseMeshOffScene()`, `swapMeshChildren()`, `swapSplatAsset()`
   - Wire throttling into `kiosk-main.ts` Phase 3 loading
   - Wire throttling into `archive-pipeline.ts` Phase 3 loading and `switchQualityTier()`
   - Test against real archives, measure frame times with DevTools Performance

2. **Evaluate** — Is Phase 1 smooth enough? Profile with real HD archives. If yes, stop here. If no:

3. **Spike** (~2-4 hours) — Validate GLTFLoader in Worker

4. **Phase 2** (~2-3 days)
   - Create `mesh-parse.worker.ts`
   - Add Worker management to `background-loader.ts`
   - Implement Transferable serialization/deserialization for geometry data
   - Add fallback chain (Worker fails → Phase 1 path)
   - Test against real archives, measure improvement over Phase 1

## Testing Strategy

- **Manual testing:** Load real archives (small/medium/large) in both kiosk and editor, observe DevTools Performance timeline for long tasks (>50ms blocks)
- **Frame time logging:** Add `performance.now()` instrumentation around yield points, log frame budget violations (>16ms) via `Logger`
- **Automated:** Unit tests for `yieldToRenderer()` behavior, `enterReducedQualityMode`/`exitReducedQualityMode` state transitions, fallback detection
- **Regression:** Ensure atomic swap still works correctly (no blank frames, correct transforms preserved, no visual artifacts)
- **Phase 2 specific:** Worker message protocol tests, Transferable roundtrip validation, fallback chain activation tests

## Files Changed Summary

| File | Change Type | Phase |
|------|------------|-------|
| `src/modules/background-loader.ts` | **New** | 1 |
| `src/modules/workers/mesh-parse.worker.ts` | **New** | 2 |
| `src/modules/loaders/archive-asset-loader.ts` | Modified (yield points around `parseMeshOffScene`, `swapSplatAsset`) | 1 |
| `src/modules/kiosk-main.ts` | Modified (throttling wrapper) | 1 |
| `src/modules/archive-pipeline.ts` | Modified (throttling wrapper) | 1 |
