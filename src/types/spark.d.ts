/**
 * Type declarations for @sparkjsdev/spark
 *
 * Spark.js is a Gaussian splat renderer. Only the APIs actually used
 * by this project are declared here.
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

        static NewAsync(config: {
            renderer: WebGLRenderer;
            maxSplats: number;
            loadingAnimDuration?: number;
        }): Promise<SplatMesh>;

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
     * Automatically created by Spark if not manually instantiated.
     */
    export class SparkRenderer extends Object3D {
        constructor(config: {
            renderer: WebGLRenderer;
            autoUpdate?: boolean;
            clipXY?: number;           // Default: 1.4. Higher values prevent edge clipping
            maxStdDev?: number;        // Controls Gaussian extent (√5 to √9)
            blurAmount?: number;       // Anti-aliasing blur
            originDistance?: number;   // Precision threshold
            view?: {                   // SparkViewpoint options for default viewpoint
                sortDistance?: number;  // Re-sort distance threshold (default: 0.01)
                sortRadial?: boolean;   // Sort by radial distance vs Z-depth (default: true)
                autoUpdate?: boolean;   // Auto-update sort each frame (default: false)
            };
            [key: string]: any;
        });

        dispose(): void;
    }
}
