# GPU Benchmark Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a GPU render benchmark to `quality-tier.ts` that measures actual rendering performance and uses the result as a weighted heuristic (0-2 points) in the SD/HD quality tier decision.

**Architecture:** A `runGpuBenchmark()` function creates a temporary Three.js scene with ~500k triangles, renders 30 frames via `requestAnimationFrame`, measures average FPS (discarding 2 warm-up frames), and caches the result. `detectDeviceTier()` is updated from a 5-point to 7-point scoring system (HD threshold >= 4). The benchmark runs once per session during init, parallel with SD asset loading.

**Tech Stack:** Three.js (IcosahedronGeometry, MeshStandardMaterial, Scene, PerspectiveCamera), Vitest for testing.

---

### Task 1: Add benchmark thresholds to constants

**Files:**
- Modify: `src/modules/constants.ts:152-157`

**Step 1: Add GPU benchmark thresholds to DEVICE_THRESHOLDS**

In `src/modules/constants.ts`, add two new entries to the `DEVICE_THRESHOLDS` object:

```typescript
export const DEVICE_THRESHOLDS = {
    LOW_MEMORY_GB: 4,         // navigator.deviceMemory threshold
    LOW_CORES: 4,             // navigator.hardwareConcurrency threshold
    MOBILE_WIDTH_PX: 768,     // screen.width threshold
    LOW_MAX_TEXTURE: 8192,    // gl.MAX_TEXTURE_SIZE threshold
    GPU_BENCHMARK_HD: 240,    // FPS at 500k tris for 2 points (full HD capable)
    GPU_BENCHMARK_MID: 120,   // FPS at 500k tris for 1 point (mid-range)
    // TODO: Make GPU_BENCHMARK_HD and GPU_BENCHMARK_MID overridable via
    // APP_CONFIG env vars (same pattern as LOD_BUDGET_SD/LOD_BUDGET_HD)
} as const;
```

**Step 2: Run existing tests to verify no regressions**

Run: `npx vitest run src/modules/__tests__/constants.test.ts`
Expected: PASS — no existing tests reference `DEVICE_THRESHOLDS` values directly.

**Step 3: Commit**

```bash
git add src/modules/constants.ts
git commit -m "feat(quality): add GPU benchmark FPS thresholds to DEVICE_THRESHOLDS"
```

---

### Task 2: Add runGpuBenchmark and getBenchmarkScore to quality-tier.ts

**Files:**
- Modify: `src/modules/quality-tier.ts`

**Step 1: Add Three.js imports and cache variable**

At the top of `src/modules/quality-tier.ts`, add Three.js imports after the existing imports (line 9):

```typescript
import {
    Scene, PerspectiveCamera, IcosahedronGeometry,
    MeshStandardMaterial, Mesh, DirectionalLight, AmbientLight, Color,
    WebGLRenderer
} from 'three';
```

After the `log` declaration (line 11), add the cache variable:

```typescript
/** Cached GPU benchmark FPS — null means benchmark hasn't run yet. */
let _benchmarkFps: number | null = null;
```

**Step 2: Implement runGpuBenchmark**

Add after the `isAndroidDevice()` function (after line 35):

```typescript
/**
 * Run a GPU benchmark by rendering ~500k triangles at actual viewport
 * resolution over ~500ms. Measures average FPS (discarding 2 warm-up frames).
 * Result is cached — subsequent calls return immediately.
 *
 * Always runs regardless of forced quality tier, so the result
 * is available for diagnostics/logging.
 *
 * @param renderer - The active WebGLRenderer
 * @returns Average FPS from the benchmark
 */
export async function runGpuBenchmark(renderer: WebGLRenderer): Promise<number> {
    if (_benchmarkFps !== null) {
        log.info(`GPU benchmark already cached: ${_benchmarkFps.toFixed(1)} FPS`);
        return _benchmarkFps;
    }

    log.info('Starting GPU benchmark (~500ms)...');

    // Create temporary scene with ~410k triangles (5 icospheres @ detail 6)
    const benchScene = new Scene();
    benchScene.background = new Color(0x000000);
    const benchCamera = new PerspectiveCamera(60, renderer.domElement.clientWidth / renderer.domElement.clientHeight, 0.1, 100);
    benchCamera.position.set(0, 0, 8);

    // Lighting (matches real scene complexity)
    benchScene.add(new AmbientLight(0xffffff, 0.5));
    const dirLight = new DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 5, 5);
    benchScene.add(dirLight);

    // 5 icospheres spread across viewport — detail 6 = ~81,920 faces each = ~409,600 total
    const geometry = new IcosahedronGeometry(1, 6);
    const material = new MeshStandardMaterial({ metalness: 0.5, roughness: 0.5 });
    const positions = [
        [0, 0, 0], [-3, 2, -1], [3, 2, -1], [-3, -2, -1], [3, -2, -1]
    ];
    const meshes: Mesh[] = [];
    for (const [x, y, z] of positions) {
        const mesh = new Mesh(geometry, material);
        mesh.position.set(x, y, z);
        benchScene.add(mesh);
        meshes.push(mesh);
    }

    // Render 30 frames via requestAnimationFrame, discard first 2 as warm-up
    const TOTAL_FRAMES = 30;
    const WARMUP_FRAMES = 2;

    const fps = await new Promise<number>((resolve) => {
        let frameCount = 0;
        let warmupEndTime = 0;

        function renderFrame(): void {
            renderer.render(benchScene, benchCamera);
            frameCount++;

            if (frameCount === WARMUP_FRAMES) {
                warmupEndTime = performance.now();
            }

            if (frameCount < TOTAL_FRAMES) {
                requestAnimationFrame(renderFrame);
            } else {
                const endTime = performance.now();
                const measuredFrames = TOTAL_FRAMES - WARMUP_FRAMES;
                const elapsedSec = (endTime - warmupEndTime) / 1000;
                const avgFps = measuredFrames / elapsedSec;
                resolve(avgFps);
            }
        }

        requestAnimationFrame(renderFrame);
    });

    // Cleanup: dispose geometry + material
    geometry.dispose();
    material.dispose();
    meshes.length = 0;

    // Clear canvas — render one empty frame to flush benchmark visuals
    const clearScene = new Scene();
    clearScene.background = new Color(0x000000);
    renderer.render(clearScene, benchCamera);

    _benchmarkFps = fps;
    log.info(`GPU benchmark complete: ${fps.toFixed(1)} FPS`);
    return fps;
}

/**
 * Get the benchmark score (0, 1, or 2) from the cached FPS result.
 * Returns 0 if benchmark hasn't run yet.
 */
export function getBenchmarkScore(): number {
    if (_benchmarkFps === null) return 0;
    if (_benchmarkFps >= DEVICE_THRESHOLDS.GPU_BENCHMARK_HD) return 2;
    if (_benchmarkFps >= DEVICE_THRESHOLDS.GPU_BENCHMARK_MID) return 1;
    return 0;
}

/**
 * Get the cached benchmark FPS value (or null if not yet run).
 * Useful for diagnostics/logging.
 */
export function getBenchmarkFps(): number | null {
    return _benchmarkFps;
}
```

**Step 3: Export a test helper to set the cached value**

Add at the bottom of `quality-tier.ts`:

```typescript
/** @internal — test-only: override cached benchmark FPS for unit tests. */
export function _setBenchmarkFpsForTest(fps: number | null): void {
    _benchmarkFps = fps;
}
```

**Step 4: Commit**

```bash
git add src/modules/quality-tier.ts
git commit -m "feat(quality): add GPU benchmark with 500k-tri render test"
```

---

### Task 3: Update detectDeviceTier to use benchmark score (7-point scale)

**Files:**
- Modify: `src/modules/quality-tier.ts:48-107` (the `detectDeviceTier` function)

**Step 1: Update detectDeviceTier to incorporate benchmark score**

Replace the scoring section of `detectDeviceTier` (lines 64-106) with the updated 7-point system. The iOS/Android early-return blocks (lines 49-63) stay unchanged. Update from line 64 onward:

```typescript
    let score = 0;

    // 1. Device memory (Chrome/Edge only; absent = assume capable)
    const mem = navigator.deviceMemory;
    if (mem === undefined || mem >= DEVICE_THRESHOLDS.LOW_MEMORY_GB) {
        score++;
    }

    // 2. CPU core count
    const cores = navigator.hardwareConcurrency;
    if (cores === undefined || cores >= DEVICE_THRESHOLDS.LOW_CORES) {
        score++;
    }

    // 3. Screen width (proxy for mobile vs desktop)
    if (screen.width >= DEVICE_THRESHOLDS.MOBILE_WIDTH_PX) {
        score++;
    }

    // 4. GPU max texture size (requires GL context)
    if (gl) {
        try {
            const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            if (maxTex >= DEVICE_THRESHOLDS.LOW_MAX_TEXTURE) {
                score++;
            }
        } catch {
            score++; // If we can't query, assume capable
        }
    } else {
        score++; // No GL context available, assume capable
    }

    // 5. User agent mobile check
    const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) {
        score++;
    }

    // 6. GPU benchmark (0, 1, or 2 points)
    score += getBenchmarkScore();

    const tier = score >= 4 ? QUALITY_TIER.HD : QUALITY_TIER.SD;
    log.info(`Device tier detected: ${tier} (score ${score}/7, benchmark ${getBenchmarkFps()?.toFixed(1) ?? 'N/A'} FPS)`);
    return tier;
```

**Step 2: Commit**

```bash
git add src/modules/quality-tier.ts
git commit -m "feat(quality): update detectDeviceTier to 7-point scale with benchmark"
```

---

### Task 4: Write unit tests for benchmark scoring

**Files:**
- Modify: `src/modules/__tests__/quality-tier.test.ts`

**Step 1: Add import for new exports**

Update the import at line 5:

```typescript
import { detectDeviceTier, resolveQualityTier, hasAnyProxy, getBenchmarkScore, _setBenchmarkFpsForTest } from '../quality-tier.js';
```

**Step 2: Add getBenchmarkScore tests**

Add a new `describe` block after the `hasAnyProxy` tests (after line 37):

```typescript
describe('getBenchmarkScore', () => {
    afterEach(() => {
        _setBenchmarkFpsForTest(null);
    });

    it('returns 0 when benchmark has not run', () => {
        _setBenchmarkFpsForTest(null);
        expect(getBenchmarkScore()).toBe(0);
    });

    it('returns 0 for FPS below 120', () => {
        _setBenchmarkFpsForTest(80);
        expect(getBenchmarkScore()).toBe(0);
    });

    it('returns 0 at FPS boundary of 119', () => {
        _setBenchmarkFpsForTest(119);
        expect(getBenchmarkScore()).toBe(0);
    });

    it('returns 1 at FPS boundary of 120', () => {
        _setBenchmarkFpsForTest(120);
        expect(getBenchmarkScore()).toBe(1);
    });

    it('returns 1 for mid-range FPS', () => {
        _setBenchmarkFpsForTest(180);
        expect(getBenchmarkScore()).toBe(1);
    });

    it('returns 1 at FPS boundary of 239', () => {
        _setBenchmarkFpsForTest(239);
        expect(getBenchmarkScore()).toBe(1);
    });

    it('returns 2 at FPS boundary of 240', () => {
        _setBenchmarkFpsForTest(240);
        expect(getBenchmarkScore()).toBe(2);
    });

    it('returns 2 for high FPS', () => {
        _setBenchmarkFpsForTest(500);
        expect(getBenchmarkScore()).toBe(2);
    });
});
```

**Step 3: Run new tests to verify they pass**

Run: `npx vitest run src/modules/__tests__/quality-tier.test.ts`
Expected: All `getBenchmarkScore` tests PASS.

**Step 4: Commit**

```bash
git add src/modules/__tests__/quality-tier.test.ts
git commit -m "test(quality): add benchmark score threshold tests"
```

---

### Task 5: Update existing detectDeviceTier tests for 7-point scale

**Files:**
- Modify: `src/modules/__tests__/quality-tier.test.ts`

**Step 1: Add benchmark cache setup to detectDeviceTier beforeEach**

In the `detectDeviceTier` `describe` block, add to the existing `beforeEach` (after line 66):

```typescript
        // Default to high benchmark score for existing tests so they
        // continue testing the static heuristics in isolation
        _setBenchmarkFpsForTest(500); // 2 points
```

Add to the existing `afterEach` (after line 89):

```typescript
        _setBenchmarkFpsForTest(null);
```

**Step 2: Update the high-end desktop test comment**

The test at line 92 (`'returns hd for desktop with high-end specs (score 5/5)'`) should have its comment updated to `'returns hd for desktop with high-end specs (score 7/7)'`. The test itself still passes because all 5 static checks pass + 2 benchmark points = 7/7 >= 4.

**Step 3: Update the low-end mobile test**

The test `'returns sd for mobile device with low memory (score < 3)'` at line 123 needs the benchmark set low too, since this test has an iPhone UA which will trigger the iOS early-return anyway. No code change needed — the iOS force-SD happens before scoring.

**Step 4: Add a test for low benchmark dragging score below threshold**

Add a new test in the `detectDeviceTier` describe block:

```typescript
    it('returns sd when benchmark score drags total below threshold', () => {
        // Desktop with decent static scores (4/5 static) but terrible GPU
        _setBenchmarkFpsForTest(50); // 0 benchmark points
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        // Low texture size to lose 1 static point
        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn((param) => {
                if (param === 0x0D33) return 4096;
                return null;
            })
        } as any;

        // Score: 1(mem) + 1(cores) + 1(width) + 0(texture) + 1(ua) + 0(bench) = 4 -> HD
        // Actually still HD at 4. Let's make it fail more:
        // Drop cores too
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 2 // Below threshold
        });

        // Score: 1(mem) + 0(cores) + 1(width) + 0(texture) + 1(ua) + 0(bench) = 3 -> SD
        expect(detectDeviceTier(mockGl)).toBe('sd');
    });

    it('returns hd when benchmark compensates for missing deviceMemory', () => {
        // Firefox/Safari desktop: deviceMemory undefined (1pt), good benchmark
        _setBenchmarkFpsForTest(300); // 2 benchmark points
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => undefined
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'
        });

        // Score: 1(mem undefined=capable) + 1(cores) + 1(width) + 1(no gl=capable) + 1(ua) + 2(bench) = 7 -> HD
        expect(detectDeviceTier()).toBe('hd');
    });
```

**Step 5: Run all quality-tier tests**

Run: `npx vitest run src/modules/__tests__/quality-tier.test.ts`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add src/modules/__tests__/quality-tier.test.ts
git commit -m "test(quality): update detectDeviceTier tests for 7-point scoring"
```

---

### Task 6: Integrate benchmark call into kiosk-main.ts

**Files:**
- Modify: `src/modules/kiosk-main.ts:27,348-351`

**Step 1: Update import**

At line 27 of `src/modules/kiosk-main.ts`, add `runGpuBenchmark` to the import:

```typescript
import { resolveQualityTier, hasAnyProxy, getLodBudget, runGpuBenchmark } from './quality-tier.js';
```

**Step 2: Add benchmark call after SceneManager.init()**

After line 337 (`log.info('Renderer type:', sceneManager.rendererType);`) and before line 348 (`// Resolve quality tier early`), add:

```typescript
    // Run GPU benchmark (~500ms) — result is cached for detectDeviceTier scoring.
    // Runs in the init phase while the loading screen is visible.
    await runGpuBenchmark(renderer);
```

The existing `resolveQualityTier` call at line 350 will now automatically pick up the benchmark score via `getBenchmarkScore()` inside `detectDeviceTier`.

**Step 3: Verify the app builds**

Run: `npx vite build`
Expected: Build succeeds with no TypeScript errors.

**Step 4: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(quality): run GPU benchmark during kiosk init"
```

---

### Task 7: Run full test suite and verify

**Files:** None (verification only)

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

**Step 2: Run build**

Run: `npx vite build`
Expected: Build succeeds.

**Step 3: Manual smoke test**

Open the kiosk viewer in a browser. Check browser console for:
- `GPU benchmark complete: X.X FPS`
- `Device tier detected: sd/hd (score N/7, benchmark X.X FPS)`

Verify SD assets load immediately and HD assets load (or don't) based on the resolved tier.
