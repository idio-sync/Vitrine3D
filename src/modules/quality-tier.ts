/**
 * Quality Tier Module
 *
 * Device capability detection and quality-tier helpers for SD/HD
 * asset selection. Used by both main.js and kiosk-main.js.
 */

import { QUALITY_TIER, DEVICE_THRESHOLDS } from './constants.js';
import { Logger } from './utilities.js';
import {
    Scene, PerspectiveCamera, IcosahedronGeometry,
    MeshStandardMaterial, Mesh, DirectionalLight, AmbientLight, Color,
    WebGLRenderer
} from 'three';

const log = Logger.getLogger('quality-tier');

/** Cached GPU benchmark FPS — null means benchmark hasn't run yet. */
let _benchmarkFps: number | null = null;

// Extend Navigator interface for Chrome-only deviceMemory API
declare global {
  interface Navigator {
    deviceMemory?: number;
  }
}

/**
 * Detect if the device is running iOS or iPadOS.
 * Modern iPads send a desktop Safari UA, so we also check for touch + standalone support.
 */
function isIOSDevice(): boolean {
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
    // iPadOS 13+ sends desktop UA — detect via platform + touch support
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/**
 * Detect if the device is running Android.
 */
function isAndroidDevice(): boolean {
    return /Android/i.test(navigator.userAgent);
}

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

/**
 * Detect device capability tier based on hardware signals.
 * Returns QUALITY_TIER.SD for low-end devices, QUALITY_TIER.HD for capable ones.
 *
 * Scoring: 5 static heuristics (1 pt each) + GPU benchmark (0-2 pts) = 7 max. Score >= 4 = HD.
 * iOS/iPadOS devices are forced to SD — Safari has strict process memory limits
 * (~1.5 GB) and will kill the tab when GPU memory is exhausted.
 *
 * @param gl - GL context for GPU queries
 * @returns QUALITY_TIER.SD or QUALITY_TIER.HD
 */
export function detectDeviceTier(gl?: WebGLRenderingContext | WebGL2RenderingContext): string {
    // iOS/iPadOS: force SD regardless of hardware capability.
    // Even M-series iPads hit Safari's process memory ceiling with HD splat budgets
    // and full-res render targets at 2x-3x pixel ratio.
    if (isIOSDevice()) {
        log.info(`Device tier detected: ${QUALITY_TIER.SD} (iOS/iPadOS — forced SD)`);
        return QUALITY_TIER.SD;
    }

    // Android: force SD — WebView has lower memory ceiling and mobile GPUs
    // struggle with HD splat budgets. Same rationale as iOS.
    if (isAndroidDevice()) {
        log.info(`Device tier detected: ${QUALITY_TIER.SD} (Android — forced SD)`);
        return QUALITY_TIER.SD;
    }

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
            // If we can't query, assume capable
            score++;
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
}

/**
 * Resolve a quality tier value. AUTO is resolved via device detection;
 * SD and HD are returned as-is.
 *
 * @param tier - QUALITY_TIER.AUTO, .SD, or .HD
 * @param gl - GL context for device detection
 * @returns QUALITY_TIER.SD or QUALITY_TIER.HD
 */
export function resolveQualityTier(tier: string, gl?: WebGLRenderingContext | WebGL2RenderingContext): string {
    if (tier === QUALITY_TIER.SD || tier === QUALITY_TIER.HD) {
        return tier;
    }
    return detectDeviceTier(gl);
}

/**
 * Check if archive content has any proxies (mesh or splat).
 * @param contentInfo - from archiveLoader.getContentInfo()
 * @returns true if mesh or scene proxy exists
 */
export function hasAnyProxy(contentInfo: { hasMeshProxy?: boolean; hasSceneProxy?: boolean }): boolean {
    return !!(contentInfo.hasMeshProxy || contentInfo.hasSceneProxy);
}

/**
 * Default LOD splat budgets by quality tier.
 * Controls SparkRenderer.lodSplatCount — the hard cap on splats rendered per frame.
 * Can be overridden via Docker env vars LOD_BUDGET_SD / LOD_BUDGET_HD.
 */
const DEFAULT_LOD_BUDGETS: Record<string, number> = {
    [QUALITY_TIER.SD]: 1_000_000,
    [QUALITY_TIER.HD]: 5_000_000,
};

/** Resolve LOD budgets: APP_CONFIG overrides take priority over defaults. */
function resolveLodBudgets(): Record<string, number> {
    const cfg = (window as any).APP_CONFIG;
    return {
        [QUALITY_TIER.SD]: (cfg?.lodBudgetSd > 0) ? cfg.lodBudgetSd : DEFAULT_LOD_BUDGETS[QUALITY_TIER.SD],
        [QUALITY_TIER.HD]: (cfg?.lodBudgetHd > 0) ? cfg.lodBudgetHd : DEFAULT_LOD_BUDGETS[QUALITY_TIER.HD],
    };
}

/**
 * Get the LOD splat budget for a given quality tier.
 * @param tier - Resolved quality tier (SD or HD)
 * @returns Splat count budget for SparkRenderer
 */
export function getLodBudget(tier: string): number {
    const budgets = resolveLodBudgets();
    return budgets[tier] ?? budgets[QUALITY_TIER.HD];
}

/** @internal — test-only: override cached benchmark FPS for unit tests. */
export function _setBenchmarkFpsForTest(fps: number | null): void {
    _benchmarkFps = fps;
}
