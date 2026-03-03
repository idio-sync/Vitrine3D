/**
 * Spark.js Version Compatibility Adapter
 *
 * Toggles between SparkRenderer (2.0, with LOD) and OldSparkRenderer (0.1 compat)
 * based on the VITE_SPARK_VERSION env var. Both classes ship in the same 2.0 bundle.
 *
 * Usage:
 *   VITE_SPARK_VERSION=0.1 npm run dev   # use legacy renderer
 *   npm run dev                           # default: 2.0
 */

import { SparkRenderer, OldSparkRenderer } from '@sparkjsdev/spark';
import { Logger } from './utilities.js';

const log = Logger.getLogger('spark-compat');

/** Build-time toggle: '2.0' (default) or '0.1' */
const SPARK_VERSION = import.meta.env.VITE_SPARK_VERSION || '2.0';

/** True when using SparkRenderer 2.0 (LOD, foveation supported). */
export const isSparkV2 = SPARK_VERSION === '2.0';

log.info(`Spark.js renderer: ${isSparkV2 ? 'SparkRenderer (2.0)' : 'OldSparkRenderer (0.1 compat)'}`);

interface SparkRendererOptions {
    renderer: any;            // WebGLRenderer
    clipXY?: number;
    autoUpdate?: boolean;
    minAlpha?: number;
    lodSplatCount?: number;   // v2 only — silently dropped for 0.1
    behindFoveate?: number;   // v2 only — silently dropped for 0.1
    [key: string]: any;
}

/**
 * Create the appropriate SparkRenderer based on VITE_SPARK_VERSION.
 * v2.0: SparkRenderer with full LOD/foveation options.
 * v0.1: OldSparkRenderer (LOD options silently stripped).
 */
export function createSparkRenderer(options: SparkRendererOptions): any {
    if (isSparkV2) {
        return new SparkRenderer(options);
    }
    // OldSparkRenderer doesn't support LOD or clipXY — strip them
    const { lodSplatCount, behindFoveate, clipXY, ...rest } = options;
    return new OldSparkRenderer(rest);
}

// Re-export SplatMesh unchanged — same class in both renderer versions
export { SplatMesh } from '@sparkjsdev/spark';
