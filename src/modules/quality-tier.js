/**
 * Quality Tier Module
 *
 * Device capability detection and quality-tier helpers for SD/HD
 * asset selection. Used by both main.js and kiosk-main.js.
 */

import { QUALITY_TIER, DEVICE_THRESHOLDS } from './constants.js';
import { Logger } from './utilities.js';

const log = Logger.getLogger('quality-tier');

/**
 * Detect device capability tier based on hardware signals.
 * Returns QUALITY_TIER.SD for low-end devices, QUALITY_TIER.HD for capable ones.
 *
 * Scoring: 5 heuristics, each worth 1 point. Score >= 3 = HD.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} [gl] - GL context for GPU queries
 * @returns {string} QUALITY_TIER.SD or QUALITY_TIER.HD
 */
export function detectDeviceTier(gl) {
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
        } catch (e) {
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

    const tier = score >= 3 ? QUALITY_TIER.HD : QUALITY_TIER.SD;
    log.info(`Device tier detected: ${tier} (score ${score}/5)`);
    return tier;
}

/**
 * Resolve a quality tier value. AUTO is resolved via device detection;
 * SD and HD are returned as-is.
 *
 * @param {string} tier - QUALITY_TIER.AUTO, .SD, or .HD
 * @param {WebGLRenderingContext|WebGL2RenderingContext} [gl]
 * @returns {string} QUALITY_TIER.SD or QUALITY_TIER.HD
 */
export function resolveQualityTier(tier, gl) {
    if (tier === QUALITY_TIER.SD || tier === QUALITY_TIER.HD) {
        return tier;
    }
    return detectDeviceTier(gl);
}

/**
 * Check if archive content has any proxies (mesh or splat).
 * @param {Object} contentInfo - from archiveLoader.getContentInfo()
 * @returns {boolean}
 */
export function hasAnyProxy(contentInfo) {
    return !!(contentInfo.hasMeshProxy || contentInfo.hasSceneProxy);
}
