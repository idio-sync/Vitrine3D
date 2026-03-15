# GPU Benchmark for Quality Tier Detection

**Date:** 2026-03-07
**Status:** Approved

## Problem

The current quality-tier detection in `quality-tier.ts` uses 5 heuristics (device memory, CPU cores, screen width, max texture size, mobile UA) to decide SD vs HD asset loading. Low-power laptops with desktop UAs and undefined `deviceMemory` (Firefox/Safari) score 5/5 and receive HD assets they can't render at acceptable frame rates.

## Solution

Add a GPU render benchmark that runs during the loading screen, measuring actual rendering performance with representative geometry. The benchmark result becomes a weighted (0-2 point) heuristic in the existing scoring system.

## Design Decisions

- **Benchmark controls HD background load only** — SD assets always load first for fast initial display. The benchmark determines whether HD assets are fetched in the background and swapped in.
- **Always runs** — even when quality tier is manually forced to SD/HD, the benchmark runs and caches its result for diagnostics/logging.
- **Runs once per session** — result cached in module-level variable; subsequent `detectDeviceTier` calls reuse the cached score.
- **Clear canvas after benchmark** — render one empty frame to prevent any visual flash of test geometry.
- **Thresholds will be env-var controllable in future** — TODO for Docker env var override via `APP_CONFIG`, same pattern as `LOD_BUDGET_SD`/`LOD_BUDGET_HD`.

## Architecture

### Flow

```
SceneManager.init() -> renderer ready
  |
  +--> SD assets load immediately (no delay)
  |
  +--> GPU benchmark runs (~500ms, parallel with SD load)
         |
         v
       qualityResolved = HD or SD
         |
         v
       If HD: background-fetch HD assets, swap when ready
       If SD: stay on SD, skip HD fetch
```

### Scoring (updated from 5 to 7 points)

| Heuristic          | Points | Source                          |
|--------------------|--------|---------------------------------|
| Device memory      | 0-1    | `navigator.deviceMemory`        |
| CPU cores          | 0-1    | `navigator.hardwareConcurrency` |
| Screen width       | 0-1    | `screen.width`                  |
| Max texture size   | 0-1    | `gl.MAX_TEXTURE_SIZE`           |
| Mobile UA check    | 0-1    | `navigator.userAgent`           |
| **GPU benchmark**  | **0-2**| **Measured FPS at 500k tris**   |
| **Total**          | **0-7**| **HD threshold: >= 4**          |

iOS/iPadOS and Android still force SD before scoring. Benchmark result is cached regardless for logging.

### Benchmark FPS Thresholds

Benchmark renders ~500k triangles at actual viewport resolution. GPU rasterization scales roughly linearly with triangle count, so FPS/10 predicts performance at 5M faces (HD asset ceiling).

| Benchmark FPS (500k tris) | Predicted HD FPS (5M tris) | Score    |
|---------------------------|----------------------------|----------|
| >= 240                    | ~24+ fps                   | 2 points |
| 120-239                   | ~12-24 fps                 | 1 point  |
| < 120                     | < 12 fps                   | 0 points |

Expected GPU performance:

| GPU class                        | Expected benchmark FPS | Score |
|----------------------------------|------------------------|-------|
| Intel UHD 620 (Chromebook/ultra) | 40-80                  | 0     |
| Intel Iris Xe (modern integrated)| 100-180                | 1     |
| GTX 1650 (entry discrete)        | 200-350                | 2     |
| RTX 3060+ (capable discrete)     | 400+                   | 2     |

### Benchmark Implementation

**Geometry:**
- 5 icospheres at `detail=6` (~82k faces each, ~410k total)
- `MeshStandardMaterial` (metalness: 0.5, roughness: 0.5)
- Spread across viewport for fill-rate coverage
- Temporary `Scene` + `PerspectiveCamera` — uses existing renderer, separate scene

**Measurement:**
- 30 frames via `requestAnimationFrame`
- First 2 frames discarded (warm-up: pipeline fill, shader compilation)
- `averageFps = 28 / ((endTime - warmupEnd) / 1000)`
- Total wall time ~500ms

**Cleanup:**
- Dispose all geometries and materials
- Render one clear frame (empty scene)
- Nullify references

**Cache:**
- `let _benchmarkFps: number | null = null` (module-level)
- `runGpuBenchmark()` returns immediately if cached
- `getBenchmarkScore()` reads cache, returns 0/1/2

## Files Modified

- **`src/modules/quality-tier.ts`** — add `runGpuBenchmark()`, `getBenchmarkScore()`, update `detectDeviceTier` scoring to 7-point scale with threshold 4
- **`src/modules/constants.ts`** — add `GPU_BENCHMARK_HD: 240` and `GPU_BENCHMARK_MID: 120` to `DEVICE_THRESHOLDS`
- **`src/modules/kiosk-main.ts`** — call `await runGpuBenchmark(renderer)` after `SceneManager.init()`, can run parallel with SD loading
- **`src/modules/__tests__/quality-tier.test.ts`** — update tests for 7-point scale, add benchmark score threshold tests

## Test Strategy

- Unit tests mock the cached `_benchmarkFps` value to test scoring at boundary values (0, 119, 120, 239, 240, 500)
- Existing `detectDeviceTier` tests updated for new 7-point scale and threshold of 4
- No integration test for actual render loop (requires real WebGL context)
- Manual testing on known hardware to validate threshold calibration
