# Background Asset Loading Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate UI freezes during background HD asset loading by throttling render cost and yielding to the renderer between heavy operations.

**Architecture:** New `background-loader.ts` module provides `enterReducedQualityMode()`/`exitReducedQualityMode()` (reduces LOD budget + pixel ratio during loading) and `yieldToRenderer()` (guarantees render frames between blocking steps). These are wired into the existing Phase 3 background loading paths in `kiosk-main.ts` and `archive-pipeline.ts`, and into the blocking functions in `archive-asset-loader.ts`.

**Tech Stack:** TypeScript, Three.js 0.183.2, Spark.js 2.0 (vendored)

**Spec:** `docs/superpowers/specs/2026-03-12-background-asset-loading-design.md`

---

## Chunk 1: Core Module + Tests

### Task 1: Create `background-loader.ts` with throttling and yield APIs

**Files:**
- Create: `src/modules/background-loader.ts`
- Test: `src/modules/__tests__/background-loader.test.ts`

- [ ] **Step 1: Write complete test file**

Create `src/modules/__tests__/background-loader.test.ts` with all imports and both describe blocks:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    yieldToRenderer,
    enterReducedQualityMode, exitReducedQualityMode,
    isReducedQualityActive, LOADING_LOD_BUDGET, _resetForTest,
} from '../background-loader.js';

describe('yieldToRenderer', () => {
    let rafSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
            (cb: FrameRequestCallback) => { cb(0); return 0; }
        );
    });

    afterEach(() => {
        rafSpy.mockRestore();
    });

    it('resolves after requestAnimationFrame + setTimeout', async () => {
        const promise = yieldToRenderer();
        await vi.runAllTimersAsync();
        await expect(promise).resolves.toBeUndefined();
    });

    it('calls requestAnimationFrame exactly once', async () => {
        vi.useFakeTimers();
        const promise = yieldToRenderer();
        await vi.runAllTimersAsync();
        await promise;
        expect(rafSpy).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});

describe('enterReducedQualityMode / exitReducedQualityMode', () => {
    let mockRenderer: any;
    let mockSparkRenderer: any;
    let resizeCalled: boolean;

    beforeEach(() => {
        _resetForTest();
        resizeCalled = false;
        mockRenderer = {
            getPixelRatio: () => 2,
            setPixelRatio: vi.fn(),
        };
        mockSparkRenderer = {
            lodSplatCount: 5_000_000,
        };
    });

    it('reduces LOD budget and pixel ratio', () => {
        enterReducedQualityMode({
            renderer: mockRenderer,
            sparkRenderer: mockSparkRenderer,
            onResize: () => { resizeCalled = true; },
        });

        expect(mockSparkRenderer.lodSplatCount).toBe(LOADING_LOD_BUDGET);
        expect(mockRenderer.setPixelRatio).toHaveBeenCalledWith(1);
        expect(resizeCalled).toBe(true);
        expect(isReducedQualityActive()).toBe(true);
    });

    it('restores original values on exit', () => {
        const targets = {
            renderer: mockRenderer,
            sparkRenderer: mockSparkRenderer,
            onResize: () => { resizeCalled = true; },
        };

        enterReducedQualityMode(targets);
        mockRenderer.setPixelRatio.mockClear();
        resizeCalled = false;

        exitReducedQualityMode(targets);

        expect(mockSparkRenderer.lodSplatCount).toBe(5_000_000);
        expect(mockRenderer.setPixelRatio).toHaveBeenCalledWith(2);
        expect(resizeCalled).toBe(true);
        expect(isReducedQualityActive()).toBe(false);
    });

    it('is a no-op if already active', () => {
        const targets = { renderer: mockRenderer, sparkRenderer: mockSparkRenderer };
        enterReducedQualityMode(targets);
        mockSparkRenderer.lodSplatCount = 999; // simulate external change
        enterReducedQualityMode(targets); // should not overwrite captured state
        expect(mockSparkRenderer.lodSplatCount).toBe(999); // unchanged
    });

    it('is a no-op if not active on exit', () => {
        const targets = { renderer: mockRenderer, sparkRenderer: mockSparkRenderer };
        exitReducedQualityMode(targets); // should not throw
        expect(mockSparkRenderer.lodSplatCount).toBe(5_000_000); // unchanged
    });

    it('works with null sparkRenderer', () => {
        const targets = { renderer: mockRenderer, sparkRenderer: null };
        enterReducedQualityMode(targets);
        expect(isReducedQualityActive()).toBe(true);
        expect(mockRenderer.setPixelRatio).toHaveBeenCalledWith(1);

        exitReducedQualityMode(targets);
        expect(isReducedQualityActive()).toBe(false);
    });

    it('restores SD-tier budget (1M) correctly, not HD', () => {
        mockSparkRenderer.lodSplatCount = 1_000_000; // SD tier
        const targets = { renderer: mockRenderer, sparkRenderer: mockSparkRenderer };

        enterReducedQualityMode(targets);
        expect(mockSparkRenderer.lodSplatCount).toBe(LOADING_LOD_BUDGET);

        exitReducedQualityMode(targets);
        expect(mockSparkRenderer.lodSplatCount).toBe(1_000_000); // back to SD, not HD
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/__tests__/background-loader.test.ts`
Expected: FAIL — module `../background-loader.js` does not exist

- [ ] **Step 3: Write `background-loader.ts` with `yieldToRenderer()`**

Create `src/modules/background-loader.ts`:

```typescript
/**
 * Background Loader — Frame-budget throttling and yield helpers
 *
 * Reduces render cost during background HD asset loading so the viewer
 * stays interactive. Used by kiosk-main.ts and archive-pipeline.ts
 * during Phase 3 background loading and quality tier switching.
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('background-loader');

// =============================================================================
// CONSTANTS
// =============================================================================

/** LOD budget during background loading — low enough to make render frames cheap. */
export const LOADING_LOD_BUDGET = 250_000;

// =============================================================================
// TYPES
// =============================================================================

export interface ReducedQualityState {
    /** The LOD budget that was active before entering reduced mode. */
    originalLodBudget: number;
    /** The pixel ratio that was active before entering reduced mode. */
    originalPixelRatio: number;
    /** Whether reduced quality mode is currently active. */
    active: boolean;
}

export interface ThrottleTargets {
    /** Three.js WebGLRenderer instance. */
    renderer: any;
    /** SparkRenderer instance (must have lodSplatCount property). Null if no splat loaded. */
    sparkRenderer: any | null;
    /** Callback to trigger resize after pixel ratio change (e.g., onWindowResize). */
    onResize?: () => void;
}

// =============================================================================
// STATE
// =============================================================================

let _reducedState: ReducedQualityState = {
    originalLodBudget: 0,
    originalPixelRatio: 1,
    active: false,
};

// =============================================================================
// YIELD HELPER
// =============================================================================

/**
 * Yield to the renderer — guarantees at least one render frame completes
 * before the returned promise resolves.
 *
 * Uses requestAnimationFrame to wait for the next frame, then setTimeout(0)
 * to yield back to the microtask queue after the frame paints.
 */
export function yieldToRenderer(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            setTimeout(resolve, 0);
        });
    });
}

// =============================================================================
// THROTTLING API
// =============================================================================

/**
 * Enter reduced quality mode for background loading.
 * Captures current LOD budget and pixel ratio, then reduces both
 * to minimize per-frame GPU cost while HD assets parse/upload.
 */
export function enterReducedQualityMode(targets: ThrottleTargets): void {
    if (_reducedState.active) {
        log.warn('enterReducedQualityMode called while already active — ignoring');
        return;
    }

    // Capture current values for restoration
    _reducedState.originalLodBudget = targets.sparkRenderer?.lodSplatCount ?? 0;
    _reducedState.originalPixelRatio = targets.renderer.getPixelRatio();
    _reducedState.active = true;

    // Reduce LOD budget
    if (targets.sparkRenderer) {
        targets.sparkRenderer.lodSplatCount = LOADING_LOD_BUDGET;
        log.info(`Reduced lodSplatCount: ${_reducedState.originalLodBudget} → ${LOADING_LOD_BUDGET}`);
    }

    // Reduce pixel ratio to 1.0
    targets.renderer.setPixelRatio(1);
    if (targets.onResize) targets.onResize();

    log.info('Entered reduced quality mode for background loading');
}

/**
 * Exit reduced quality mode — restore original LOD budget and pixel ratio.
 */
export function exitReducedQualityMode(targets: ThrottleTargets): void {
    if (!_reducedState.active) {
        log.warn('exitReducedQualityMode called while not active — ignoring');
        return;
    }

    // Restore LOD budget
    if (targets.sparkRenderer && _reducedState.originalLodBudget > 0) {
        targets.sparkRenderer.lodSplatCount = _reducedState.originalLodBudget;
        log.info(`Restored lodSplatCount: ${LOADING_LOD_BUDGET} → ${_reducedState.originalLodBudget}`);
    }

    // Restore pixel ratio
    targets.renderer.setPixelRatio(_reducedState.originalPixelRatio);
    if (targets.onResize) targets.onResize();

    _reducedState.active = false;
    log.info('Exited reduced quality mode');
}

/**
 * Check if reduced quality mode is currently active.
 */
export function isReducedQualityActive(): boolean {
    return _reducedState.active;
}

/** @internal — test-only: reset state between tests. */
export function _resetForTest(): void {
    _reducedState = { originalLodBudget: 0, originalPixelRatio: 1, active: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/__tests__/background-loader.test.ts`
Expected: PASS

- [ ] **Step 5: Run all background-loader tests**

Run: `npx vitest run src/modules/__tests__/background-loader.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/background-loader.ts src/modules/__tests__/background-loader.test.ts
git commit -m "feat(background-loader): add throttling and yield-to-renderer APIs

New module for reducing render cost during background HD asset loading.
enterReducedQualityMode/exitReducedQualityMode control LOD budget and
pixel ratio. yieldToRenderer() guarantees render frames between heavy ops."
```

---

## Chunk 2: Wire Yield Points into archive-asset-loader.ts

### Task 2: Add `yieldToRenderer()` calls around blocking operations

**Files:**
- Modify: `src/modules/loaders/archive-asset-loader.ts`

The two blocking hotspots are:
1. `loadArchiveFullResMesh()` — between `await parseMeshOffScene()` (~line 554) and `swapMeshChildren()` (~line 577)
2. `swapSplatAsset()` — before `await newSplat.initialized` (~line 627)

- [ ] **Step 1: Add import of `yieldToRenderer` at top of archive-asset-loader.ts**

In `src/modules/loaders/archive-asset-loader.ts`, add to the existing imports:

```typescript
import { yieldToRenderer } from '../background-loader.js';
```

- [ ] **Step 2: Add yield in `loadArchiveFullResMesh()` between parse and swap**

In `loadArchiveFullResMesh()`, after the `parseMeshOffScene()` calls complete and before `swapMeshChildren()`, insert a yield. Find the code block around line 554-577:

```typescript
// Current code (around line 554):
    if (extension === 'glb' || extension === 'gltf') {
        const buffer = await archiveLoader.extractFileBuffer(meshEntry.file_name);
        if (buffer) {
            parsed = await parseMeshOffScene(buffer, meshEntry.file_name);
        }
    }

    if (!parsed) {
        const meshData = await archiveLoader.extractFile(meshEntry.file_name);
        if (!meshData) {
            return { loaded: false, blob: null, error: 'Failed to extract full-resolution mesh' };
        }
        meshBlob = meshData.blob;
        parsed = await parseMeshOffScene(meshData.url, meshEntry.file_name);
    }

    if (!parsed) {
        return { loaded: false, blob: null, error: 'Failed to parse full-resolution mesh' };
    }

    // In-place swap: synchronous, no empty frames
```

Insert `await yieldToRenderer();` between the null-check for `parsed` and the swap block, and again after the swap:

```typescript
    if (!parsed) {
        return { loaded: false, blob: null, error: 'Failed to parse full-resolution mesh' };
    }

    // Yield to renderer before the synchronous swap — gives the render loop
    // a frame to paint after the heavy parseMeshOffScene() work.
    await yieldToRenderer();

    // In-place swap: synchronous, no empty frames
    if (modelGroup && modelGroup.children.length > 0) {
        swapMeshChildren(modelGroup, parsed.object);
    } else {
        if (modelGroup) {
            modelGroup.add(parsed.object);
        }
    }

    // Yield after swap — lets the renderer paint the new HD geometry
    // before control returns to the caller (GPU upload may have blocked).
    await yieldToRenderer();
```

- [ ] **Step 3: Add yield in `swapSplatAsset()` before GPU texture upload**

In `swapSplatAsset()`, before `await newSplat.initialized` (~line 627), insert a yield:

```typescript
// Current code (around line 623-627):
    // Create new SplatMesh off-scene — old one stays visible during load
    const newSplat = await createSplatMesh(blobUrl, fileType);
    newSplat.rotation.x = Math.PI;
    newSplat.frustumCulled = false;
    await newSplat.initialized;
```

Change to:

```typescript
    // Create new SplatMesh off-scene — old one stays visible during load
    const newSplat = await createSplatMesh(blobUrl, fileType);
    newSplat.rotation.x = Math.PI;
    newSplat.frustumCulled = false;

    // Yield before GPU texture upload — splatMesh.initialized triggers
    // PackedSplats.initialize() which blocks the main thread with gl.texImage2D
    await yieldToRenderer();

    await newSplat.initialized;
```

- [ ] **Step 4: Verify build compiles**

Run: `npx vite build`
Expected: Build succeeds with no errors

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/modules/loaders/archive-asset-loader.ts
git commit -m "feat(archive-asset-loader): add yield points around heavy operations

Yield to renderer between parseMeshOffScene and swapMeshChildren, and
before splatMesh.initialized GPU texture upload. Ensures render frames
continue during background HD asset loading."
```

---

## Chunk 3: Wire Throttling into kiosk-main.ts

### Task 3: Wrap Phase 3 background loading with reduced quality mode

**Files:**
- Modify: `src/modules/kiosk-main.ts`

- [ ] **Step 1: Add imports at top of kiosk-main.ts**

```typescript
import { enterReducedQualityMode, exitReducedQualityMode, yieldToRenderer } from './background-loader.js';
import type { ThrottleTargets } from './background-loader.js';
```

- [ ] **Step 2: Create a helper to build ThrottleTargets**

Add near the other helper functions (near `createArchiveDeps()`):

```typescript
/** Build throttle targets for background-loader from module-scope variables. */
function createThrottleTargets(): ThrottleTargets {
    return {
        renderer,
        sparkRenderer,
        onResize: onWindowResize,
    };
}
```

- [ ] **Step 3: Wrap progressive mesh loading (lines 2088-2119) with throttling**

In the Phase 3 progressive mesh upgrade block, wrap the existing `setTimeout` callback:

```typescript
        // Progressive mesh upgrade: load HD in background, atomically swap SD→HD
        if (shouldProgressiveLoad && state.archiveLoader) {
            showBgLoadingIndicator();
            log.info('Progressive load: starting background HD mesh upgrade');
            const throttleTargets = createThrottleTargets();
            enterReducedQualityMode(throttleTargets);
            setTimeout(async () => {
                try {
                    // loadArchiveFullResMesh parses HD off-scene, then calls swapMeshChildren
                    // for an atomic replacement — SD stays visible until HD is ready.
                    const result = await loadArchiveFullResMesh(state.archiveLoader!, createArchiveDeps());
                    // ... rest of existing code unchanged ...
                } catch (e: unknown) {
                    log.warn('Progressive load: HD mesh upgrade failed, keeping SD proxy:', errMsg(e));
                } finally {
                    exitReducedQualityMode(throttleTargets);
                    hideBgLoadingIndicator();
                }
            }, 100);
        }
```

Key changes:
- Add `const throttleTargets = createThrottleTargets();` before the setTimeout
- Add `enterReducedQualityMode(throttleTargets);` before setTimeout
- Move `exitReducedQualityMode(throttleTargets);` into the finally block (before `hideBgLoadingIndicator()`)

- [ ] **Step 4: Wrap remaining-types background loading (lines 2128-2177) with throttling and yields**

For the second `setTimeout` block that loads remaining asset types, add throttling and yields between each asset:

```typescript
        const remainingTypes = ['splat', 'mesh', 'pointcloud'].filter(
            t => state.assetStates[t] === ASSET_STATE.UNLOADED
                && !(t === 'mesh' && shouldProgressiveLoad)
        );
        if (remainingTypes.length > 0) {
            // Only enter reduced mode if we haven't already (progressive load may have set it)
            const throttleTargets = createThrottleTargets();
            if (!shouldProgressiveLoad) {
                enterReducedQualityMode(throttleTargets);
            }
            setTimeout(async () => {
                try {
                    for (const type of remainingTypes) {
                        // ... existing typeAvailable check and loading logic unchanged ...
                        if (typeAvailable) {
                            log.info(`Background loading: ${type}`);
                            await ensureAssetLoaded(type as AssetType);
                            // Yield between asset types to keep renderer responsive
                            await yieldToRenderer();
                            // ... existing post-load logic (showRelevantSettings, etc.) unchanged ...
                        }
                    }
                    // ... existing globalAlignment + releaseRawData logic unchanged ...
                } finally {
                    if (!shouldProgressiveLoad) {
                        exitReducedQualityMode(throttleTargets);
                    }
                }
            }, 100);
        }
```

Key changes:
- Add `enterReducedQualityMode()` / `exitReducedQualityMode()` wrapping (only if progressive load isn't already managing it)
- Add `await yieldToRenderer()` after each `ensureAssetLoaded()` call

**Throttling coordination note:** When `shouldProgressiveLoad` is true, the first setTimeout (progressive mesh) owns the throttling lifecycle. The second setTimeout runs without its own throttling — it relies on the progressive load's `finally` to call `exitReducedQualityMode()`. If splat/pointcloud finish before the HD mesh parse, the viewer stays in reduced quality until the mesh finishes. This is acceptable: the reduced quality is barely noticeable (250K splats at 1x pixel ratio) and trying to coordinate exit across concurrent async blocks adds fragile complexity.

- [ ] **Step 5: Wrap `switchQualityTier()` (lines 2234-2324) with throttling**

In `switchQualityTier()`, wrap the asset swap operations. The key insight: set the target LOD/pixelRatio _first_ (so it's the "current" value), then call `enterReducedQualityMode()` which captures that as the restore target. `exitReducedQualityMode()` in the `finally` block restores exactly those new-tier values — no redundant re-set needed.

```typescript
async function switchQualityTier(newTier: string): Promise<void> {
    if (newTier === state.qualityResolved) return;
    state.qualityResolved = newTier;

    // Update button states
    document.querySelectorAll('.quality-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.tier === newTier);
        btn.classList.add('loading');
    });

    // Set target LOD and pixel ratio BEFORE entering reduced mode,
    // so enterReducedQualityMode captures the new-tier values as restore targets.
    if (sparkRenderer && isSparkV2) {
        sparkRenderer.lodSplatCount = getLodBudget(newTier);
        log.info(`SparkRenderer lodSplatCount updated to ${getLodBudget(newTier)}`);
    }
    if (renderer) {
        const targetRatio = newTier === 'hd' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
        renderer.setPixelRatio(targetRatio);
        onWindowResize();
    }

    const archiveLoader = state.archiveLoader;
    if (!archiveLoader) {
        document.querySelectorAll('.quality-toggle-btn').forEach(btn => {
            btn.classList.remove('loading');
        });
        log.info(`Quality tier switched to ${newTier} (LOD only)`);
        return;
    }

    // Enter reduced quality — captures the just-set new-tier values as restore targets
    const throttleTargets = createThrottleTargets();
    enterReducedQualityMode(throttleTargets);

    const contentInfo = archiveLoader.getContentInfo();
    const deps = createArchiveDeps();

    try {
        if (contentInfo.hasSceneProxy) {
            // ... existing splat swap logic unchanged ...
            await yieldToRenderer();
        }
        if (contentInfo.hasMeshProxy) {
            // ... existing mesh swap logic unchanged ...
            await yieldToRenderer();
        }
        log.info(`Quality tier switched to ${newTier}`);
    } catch (e) {
        log.error('Error switching quality tier:', e);
        notify.error(`Failed to switch quality: ${errMsg(e)}`);
    } finally {
        // exitReducedQualityMode restores to the new-tier values captured above
        exitReducedQualityMode(throttleTargets);
        document.querySelectorAll('.quality-toggle-btn').forEach(btn => {
            btn.classList.remove('loading');
        });
    }
}
```

- [ ] **Step 6: Verify build compiles**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(kiosk): throttle render during background HD asset loading

Wrap Phase 3 background loading and switchQualityTier with
enterReducedQualityMode/exitReducedQualityMode. Add yieldToRenderer
between sequential asset loads for smooth interactivity."
```

---

## Chunk 4: Wire Throttling into archive-pipeline.ts

### Task 4: Add throttling to editor's background loading path

**Files:**
- Modify: `src/modules/archive-pipeline.ts`
- Modify: `src/types.ts` (extend `ArchivePipelineDeps`)

- [ ] **Step 1: Extend `ArchivePipelineDeps` in types.ts**

In `src/types.ts`, find the `ArchivePipelineDeps` interface (~line 395). Add these two optional fields after `sceneManager: any;` (do NOT replace the entire interface — it has 12+ other fields):

```typescript
    sceneManager: any;
    sparkRenderer?: any;    // for background-loader throttling
    onResize?: () => void;  // for pixel ratio restore after throttling
    setSplatMesh: (mesh: any) => void;  // ← existing line, add the two new fields ABOVE this
```

- [ ] **Step 2: Update main.ts deps factory to pass sparkRenderer**

In `main.ts`, find the `createArchivePipelineDeps()` factory and add `sparkRenderer` and `onResize`:

```typescript
// Add sparkRenderer and onResize to the returned object
sparkRenderer: sparkRenderer,
onResize: onWindowResize,
```

- [ ] **Step 3: Add imports to archive-pipeline.ts**

```typescript
import { enterReducedQualityMode, exitReducedQualityMode, yieldToRenderer } from './background-loader.js';
import type { ThrottleTargets } from './background-loader.js';
```

- [ ] **Step 4: Add throttle targets helper in archive-pipeline.ts**

```typescript
/** Build ThrottleTargets from ArchivePipelineDeps. */
function createThrottleTargets(deps: ArchivePipelineDeps): ThrottleTargets {
    return {
        renderer: deps.sceneRefs.renderer,
        sparkRenderer: deps.sparkRenderer ?? null,
        onResize: deps.onResize,
    };
}
```

- [ ] **Step 5: Wrap Phase 3 in `processArchive()` (lines 843-881)**

In the `setTimeout` block at line 844, wrap with throttling and add yields:

```typescript
        if (remainingTypes.length > 0) {
            setTimeout(async () => {
                const throttleTargets = createThrottleTargets(deps);
                enterReducedQualityMode(throttleTargets);
                try {
                    const typesToLoad = remainingTypes.filter(type => /* ... existing filter ... */);
                    // Load sequentially with yields instead of Promise.all
                    // to avoid concurrent GPU uploads competing for main thread
                    for (const type of typesToLoad) {
                        log.info(`Background loading: ${type}`);
                        const loaded = await ensureAssetLoaded(type, deps);
                        if (!loaded && state.assetStates[type] === ASSET_STATE.ERROR) {
                            log.error(`Background load failed for: ${type}`);
                            notify.error(`Failed to load ${type} from archive`);
                        }
                        deps.ui.updateTransformInputs();
                        if (type === 'mesh' && manifest.viewer_settings) {
                            applyViewerSettings(manifest.viewer_settings, deps);
                        }
                        if (type === 'flightpath' && loaded && deps.renderFlightPaths) {
                            await deps.renderFlightPaths();
                        }
                        // Yield between assets to keep editor responsive
                        await yieldToRenderer();
                    }
                    // ... existing releaseRawData logic unchanged ...
                } finally {
                    exitReducedQualityMode(throttleTargets);
                }
            }, 100);
        }
```

Key change: Replace `Promise.all(typesToLoad.map(...))` with a sequential `for` loop with `yieldToRenderer()` between each. Concurrent GPU uploads from `Promise.all` are the worst case for jank — sequential + yield is much smoother.

- [ ] **Step 6: Wrap `switchQualityTier()` in archive-pipeline.ts (line 1117)**

```typescript
export async function switchQualityTier(newTier: string, deps: ArchivePipelineDeps): Promise<void> {
    const { state } = deps;
    // ... existing early return and button state logic unchanged ...

    const throttleTargets = createThrottleTargets(deps);
    enterReducedQualityMode(throttleTargets);

    try {
        if (contentInfo.hasSceneProxy) {
            // ... existing splat swap ...
            await yieldToRenderer();
        }
        if (contentInfo.hasMeshProxy) {
            // ... existing mesh swap ...
        }
        log.info(`Quality tier switched to ${newTier}`);
    } catch (e: any) {
        log.error('Error switching quality tier:', e);
        notify.error('Error switching quality: ' + e.message);
    } finally {
        exitReducedQualityMode(throttleTargets);
        document.querySelectorAll('.quality-toggle-btn').forEach((btn: Element) => {
            btn.classList.remove('loading');
        });
    }
}
```

- [ ] **Step 7: Verify build compiles**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add src/modules/archive-pipeline.ts src/types.ts src/main.ts
git commit -m "feat(archive-pipeline): throttle render during background loading

Wire enterReducedQualityMode/exitReducedQualityMode into editor's Phase 3
background loading and switchQualityTier. Replace Promise.all with
sequential loading + yieldToRenderer for smoother frame delivery."
```

---

## Chunk 5: Manual Testing & Verification

### Task 5: Verify with real archives

**Files:** None (manual testing only)

- [ ] **Step 1: Test kiosk mode with HD archive**

1. Run `npm run dev`
2. Open kiosk with an archive URL that has both SD proxy and HD assets
3. Open DevTools → Performance tab → Start recording
4. Observe: SD proxy should load and become interactive immediately
5. During HD background loading: check for long tasks >50ms in the Performance timeline
6. Verify: no complete freezes, minor stutters acceptable
7. Verify: HD assets swap in without blank frames

- [ ] **Step 2: Test editor mode with HD archive**

1. Open `/editor/` and load the same archive
2. Monitor console for `background-loader` log messages:
   - `Entered reduced quality mode for background loading`
   - `Reduced lodSplatCount: X → 250000`
   - `Exited reduced quality mode`
   - `Restored lodSplatCount: 250000 → X`
3. Verify smooth interaction during background loading

- [ ] **Step 3: Test quality tier switching**

1. In kiosk mode, click SD/HD toggle buttons
2. Verify throttling activates during the swap (check console logs)
3. Verify correct LOD budget and pixel ratio after switch completes

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Run build**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 6: Final commit if any adjustments were made**

```bash
git add -A
git commit -m "fix: adjustments from manual background-loader testing"
```
