/**
 * Type declarations for three-e57-loader
 *
 * E57 point cloud loader for Three.js. Loaded lazily via dynamic import
 * in file-handlers.js. Only the APIs actually used are declared here.
 */
declare module 'three-e57-loader' {
    import { Loader, Points } from 'three';

    export class E57Loader extends Loader {
        load(
            url: string,
            onLoad: (points: Points) => void,
            onProgress?: (event: ProgressEvent) => void,
            onError?: (error: Error) => void
        ): void;
    }
}
