/**
 * Type declarations for @sparkjsdev/spark
 *
 * Spark.js is a Gaussian splat renderer. Only the APIs actually used
 * by this project are declared here.
 */
declare module '@sparkjsdev/spark' {
    import { Object3D, WebGLRenderer, Euler, Vector3 } from 'three';

    export class SplatMesh extends Object3D {
        rotation: Euler;
        position: Vector3;

        constructor(config?: { url?: string; [key: string]: any });

        static NewAsync(config: {
            renderer: WebGLRenderer;
            maxSplats: number;
            loadingAnimDuration?: number;
        }): Promise<SplatMesh>;

        loadUrl(url: string, onProgress?: (progress: number) => void): Promise<void>;
        loadFile(file: File, onProgress?: (progress: number) => void): Promise<void>;
        dispose(): void;
    }
}
