/**
 * Type declarations for @sparkjsdev/spark
 *
 * Spark.js 2.0.0-preview — Gaussian splat renderer with hierarchical LOD.
 * Only the APIs actually used by this project are declared here.
 *
 * Vendored from: https://sparkjs.dev/releases/spark/preview/2.0.0/spark.module.js
 * Docs: https://sparkjs.dev/2.0.0-preview/docs/spark-renderer/
 */
declare module '@sparkjsdev/spark' {
    import { Object3D, WebGLRenderer, Euler, Vector3, Box3 } from 'three';

    export class SplatMesh extends Object3D {
        rotation: Euler;
        position: Vector3;

        /** Resolves when this SplatMesh has finished loading/parsing. */
        initialized: Promise<SplatMesh>;
        isInitialized: boolean;

        /** Resolves when WASM module is ready (required for compressed formats). */
        static staticInitialized: Promise<void>;
        static isStaticInitialized: boolean;

        constructor(config?: { url?: string; [key: string]: any });

        loadUrl(url: string, onProgress?: (progress: number) => void): Promise<void>;
        loadFile(file: File, onProgress?: (progress: number) => void): Promise<void>;
        dispose(): void;

        /**
         * Calculate bounding box of the splat mesh.
         * @param centers_only - If true (default), uses only splat center positions.
         *                       If false, includes full extent of splats.
         */
        getBoundingBox(centers_only?: boolean): Box3;
    }

    /**
     * SparkRenderer manages Gaussian Splatting rendering within a THREE.Scene.
     *
     * v2.0 breaking changes from v0.1:
     * - `view` option removed; sort options are now top-level
     * - LOD system added (hierarchical splat tree with budget control)
     * - Foveation controlled via cone parameters, not `outsideFoveate`
     */
    export class SparkRenderer extends Object3D {
        constructor(config: {
            renderer: WebGLRenderer;

            // Rendering
            autoUpdate?: boolean;          // Default: true
            clipXY?: number;               // Default: 1.4. Higher prevents edge clipping
            maxStdDev?: number;            // Default: Math.sqrt(8)
            minAlpha?: number;             // Default: 0.5 * (1/255). Cull near-invisible splats

            // Sorting (top-level in 2.0, was inside view: {} in 0.1)
            sortRadial?: boolean;          // Default: true. Sort by radial distance vs Z-depth
            minSortIntervalMs?: number;    // Default: 0. Min ms between re-sorts

            // LOD (new in 2.0)
            enableLod?: boolean;           // Default: true
            lodSplatCount?: number;        // Hard cap on rendered splats per frame
            lodSplatScale?: number;        // Default: 1.0. Multiplier on default budget
            lodRenderScale?: number;       // Default: 1.0

            // Foveation (new in 2.0)
            behindFoveate?: number;        // Default: 1.0. Scale for splats behind camera (lower = more aggressive)
            coneFov?: number;              // Default: 0.0. Cone FOV angle for foveation
            coneFoveate?: number;          // Default: 1.0. Scale at cone edge

            // Depth of field
            focalDistance?: number;
            apertureAngle?: number;

            // Blur
            preBlurAmount?: number;
            blurAmount?: number;

            [key: string]: any;
        });

        /** Runtime LOD budget — hard cap on splats rendered per frame. */
        lodSplatCount: number;
        /** Runtime LOD scale multiplier. */
        lodSplatScale: number;

        dispose(): void;
    }

    /**
     * PackedSplats — pre-decoded splat data container.
     * Can be passed to SplatMesh constructor to skip the decode step.
     */
    export class PackedSplats {
        initialized: Promise<PackedSplats>;
        isInitialized: boolean;
        numSplats: number;
        packedArray: Uint32Array | null;
        constructor(options?: { packedArray?: Uint32Array; numSplats?: number; extra?: any; splatEncoding?: any; [key: string]: any });
    }

    /**
     * Decode splat file bytes on the legacy worker (supports all formats including pcsogszip/.sog).
     * The new PackedSplats worker path does NOT support .sog — use this as a workaround.
     */
    export function unpackSplats(options: {
        input: Uint8Array | ArrayBuffer;
        fileType?: string;
        pathOrUrl?: string;
        extraFiles?: any;
        splatEncoding?: any;
    }): Promise<{ packedArray: Uint32Array; numSplats: number; extra?: any }>;

    /**
     * Transcode splat data to LOD-ordered SPZ format.
     * CPU-heavy — prefer running in a Web Worker for large files.
     */
    export function transcodeSpz(input: {
        inputs: Array<{
            fileBytes: Uint8Array;
            fileType?: string;
            pathOrUrl?: string;
            transform?: {
                scale?: number;
                quaternion?: [number, number, number, number];
                translate?: [number, number, number];
            };
        }>;
        clipXyz?: { min: [number, number, number]; max: [number, number, number] };
        maxSh?: number;
        fractionalBits?: number;
        opacityThreshold?: number;
    }): Promise<{ fileBytes: Uint8Array }>;

    /**
     * Legacy 0.1 renderer, renamed in 2.0. No LOD support.
     * Use via spark-compat.ts adapter with VITE_SPARK_VERSION=0.1.
     */
    export class OldSparkRenderer extends Object3D {
        constructor(config: {
            renderer: WebGLRenderer;
            autoUpdate?: boolean;
            maxStdDev?: number;
            minAlpha?: number;
            premultipliedAlpha?: boolean;
            [key: string]: any;
        });
        newViewpoint(options?: any): any;
        dispose(): void;
    }
}
