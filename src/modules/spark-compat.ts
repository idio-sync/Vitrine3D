/**
 * Spark.js Version Compatibility Adapter
 *
 * Toggles between SparkRenderer (2.0, with LOD) and OldSparkRenderer (0.1 compat)
 * based on APP_CONFIG.sparkVersion (runtime, set via Docker env var SPARK_VERSION).
 * Both classes ship in the same 2.0 bundle.
 *
 * Usage:
 *   Docker: SPARK_VERSION=0.1 (in docker-compose or docker run -e)
 *   Local:  Edit sparkVersion in src/config.js
 */

import { SparkRenderer, OldSparkRenderer } from '@sparkjsdev/spark';
import { Logger } from './utilities.js';

const log = Logger.getLogger('spark-compat');

/** Runtime toggle from APP_CONFIG: '2.0' (default) or '0.1' */
const SPARK_VERSION = (window as any).APP_CONFIG?.sparkVersion || '2.0';

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
    maxStdDev?: number;       // v2 only — silently dropped for 0.1
    [key: string]: any;
}

/**
 * Create the appropriate SparkRenderer based on APP_CONFIG.sparkVersion.
 * v2.0: SparkRenderer with full LOD/foveation options.
 * v0.1: OldSparkRenderer (LOD options silently stripped).
 */
export function createSparkRenderer(options: SparkRendererOptions): any {
    if (isSparkV2) {
        return new SparkRenderer(options);
    }
    // OldSparkRenderer doesn't support LOD or clipXY — strip them
    const { lodSplatCount: _lod, behindFoveate: _bf, clipXY: _clip, maxStdDev: _msd, ...rest } = options;
    return new OldSparkRenderer(rest);
}

// Re-export SplatMesh unchanged — same class in both renderer versions
export { SplatMesh } from '@sparkjsdev/spark';
