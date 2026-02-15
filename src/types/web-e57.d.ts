/**
 * Type declarations for web-e57
 *
 * WASM support module for E57 point cloud parsing.
 * Used as a peer dependency of three-e57-loader.
 */
declare module 'web-e57' {
    export function init(): Promise<void>;
}
