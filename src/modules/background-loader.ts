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
