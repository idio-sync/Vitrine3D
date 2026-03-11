/**
 * Splat Loader — Gaussian splat file loading (via Spark SplatMesh)
 *
 * Handles .ply, .spz, .splat, .ksplat, .rad, .sog formats.
 * Extracted from file-handlers.ts for modularity.
 */

import * as THREE from 'three';
import { SplatMesh, PackedSplats, unpackSplats } from '@sparkjsdev/spark';
import { TIMING } from '../constants.js';
import { Logger, fetchWithProgress } from '../utilities.js';
import type { AppState } from '@/types.js';

const log = Logger.getLogger('splat-loader');

type ProgressCallback = ((received: number, total: number) => void) | null;

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface LoadSplatDeps {
    scene: THREE.Scene;
    getSplatMesh: () => any;
    setSplatMesh: (mesh: any) => void;
    state: AppState;
    archiveCreator?: any;
    sceneManager?: { ensureWebGLRenderer: () => Promise<void>; ensureWebGPURenderer: () => Promise<void> };
    callbacks?: {
        onSplatLoaded?: (mesh: any, file: File | Blob) => void;
        onApplySplatTransform?: (transform: any) => void;
        [key: string]: any;
    };
}

// =============================================================================
// SPLAT FILE TYPE DETECTION
// =============================================================================

/**
 * Map file extension to Spark 2.0 SplatFileType enum value.
 * Needed when loading from blob URLs where Spark can't infer format from the path.
 */
const SPLAT_FILE_TYPE_MAP: Record<string, string> = {
    ply: 'ply', spz: 'spz', splat: 'splat', ksplat: 'ksplat', rad: 'rad',
    sog: 'pcsogszip',
};

export function getSplatFileType(fileNameOrUrl: string): string | undefined {
    const ext = fileNameOrUrl.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
    return ext ? SPLAT_FILE_TYPE_MAP[ext] : undefined;
}

// =============================================================================
// SPLAT MESH CREATION
// =============================================================================

/**
 * Create a SplatMesh from a URL (blob: or http:) with file type detection.
 *
 * .sog (pcsogszip) files require a workaround: Spark 2.0's new PackedSplats worker
 * path uses decode_to_packedsplats WASM which doesn't support pcsogszip.
 * We pre-decode via the exported unpackSplats() (old worker) then hand the
 * decoded PackedSplats to SplatMesh directly.
 *
 * Quality-tier differentiation is handled by the LOD tree (lodSplatCount budget),
 * not by raw splat count truncation.
 */
export async function createSplatMesh(url: string, fileType?: string): Promise<any> {
    if (fileType === 'pcsogszip') {
        const response = await fetch(url);
        const fileBytes = new Uint8Array(await response.arrayBuffer());
        const decoded = await unpackSplats({ input: fileBytes, fileType: 'pcsogszip' }) as any;
        const packedSplats = new PackedSplats(decoded);
        return new SplatMesh({ packedSplats });
    }
    // For other formats (.ply, .spz, .splat), Spark decodes internally.
    // LOD is generated at archive export time via transcodeSpz(), not at load time.
    return new SplatMesh({ url, ...(fileType && { fileType }) });
}

// =============================================================================
// SPLAT LOADING
// =============================================================================

/**
 * Load splat from a file
 */
export async function loadSplatFromFile(file: File, deps: LoadSplatDeps): Promise<any> {
    const { scene, getSplatMesh, setSplatMesh, state, archiveCreator, callbacks } = deps;

    // Spark.js requires WebGL — switch renderer if currently WebGPU
    if (deps.sceneManager) await deps.sceneManager.ensureWebGLRenderer();

    // Remove existing splat
    const existingSplat = getSplatMesh();
    if (existingSplat) {
        scene.remove(existingSplat);
        if (existingSplat.dispose) existingSplat.dispose();
        setSplatMesh(null);
    }

    // Create object URL for the file
    const fileUrl = URL.createObjectURL(file);

    // Ensure WASM is ready (required for compressed formats like .sog, .spz)
    await SplatMesh.staticInitialized;

    // Pass fileType for blob URLs where Spark 2.0 can't detect format from path
    const fileType = getSplatFileType(file.name);

    // Create SplatMesh (.sog pre-decoded via legacy worker; other formats use native path)
    const splatMesh = await createSplatMesh(fileUrl, fileType);

    // Apply default rotation to correct upside-down orientation
    splatMesh.rotation.x = Math.PI;

    // Disable frustum culling to prevent clipping issues with rotated splats
    splatMesh.frustumCulled = false;

    // Force matrix auto-update and set render order
    splatMesh.matrixAutoUpdate = true;
    splatMesh.renderOrder = 0;

    // Verify SplatMesh is a valid THREE.Object3D
    if (!(splatMesh instanceof THREE.Object3D)) {
        log.warn('WARNING: SplatMesh is not an instance of THREE.Object3D!');
        log.warn('This may indicate multiple THREE.js instances are loaded.');
    }

    // Wait for splat to finish loading/parsing
    await splatMesh.initialized;

    try {
        scene.add(splatMesh);
    } catch (addError) {
        log.error('Error adding splatMesh to scene:', addError);
        throw addError;
    }

    // Clean up URL after a delay
    setTimeout(() => URL.revokeObjectURL(fileUrl), TIMING.BLOB_REVOKE_DELAY);

    // Update state
    setSplatMesh(splatMesh);
    state.splatLoaded = true;
    state.currentSplatUrl = null; // Local files cannot be shared

    // Pre-compute hash in background
    if (archiveCreator) {
        archiveCreator.precomputeHash(file).catch((e: Error) => {
            log.warn('Background hash precompute failed:', e);
        });
    }

    // Call callbacks
    if (callbacks?.onSplatLoaded) {
        callbacks.onSplatLoaded(splatMesh, file);
    }

    return splatMesh;
}

/**
 * Load splat from a URL
 */
export async function loadSplatFromUrl(url: string, deps: LoadSplatDeps, onProgress: ProgressCallback = null): Promise<any> {
    const { scene, getSplatMesh, setSplatMesh, state, archiveCreator, callbacks } = deps;

    // Spark.js requires WebGL — switch renderer if currently WebGPU
    if (deps.sceneManager) await deps.sceneManager.ensureWebGLRenderer();

    log.info('Fetching splat from URL:', url);
    const blob = await fetchWithProgress(url, onProgress);
    log.info('Splat blob fetched, size:', blob.size);

    // Pre-compute hash in background
    if (archiveCreator) {
        archiveCreator.precomputeHash(blob).catch((e: Error) => {
            log.warn('Background hash precompute failed:', e);
        });
    }

    // Create blob URL for loading
    const blobUrl = URL.createObjectURL(blob);

    // Remove existing splat
    const existingSplat = getSplatMesh();
    if (existingSplat) {
        scene.remove(existingSplat);
        if (existingSplat.dispose) existingSplat.dispose();
        setSplatMesh(null);
    }

    // Ensure WASM is ready (required for compressed formats like .sog, .spz)
    await SplatMesh.staticInitialized;

    // Pass fileType for blob URLs where Spark 2.0 can't detect format from path
    const fileType = getSplatFileType(url);

    // Create SplatMesh (.sog pre-decoded via legacy worker; other formats use native path)
    const splatMesh = await createSplatMesh(blobUrl, fileType);

    // Apply default rotation
    splatMesh.rotation.x = Math.PI;

    // Disable frustum culling to prevent clipping issues with rotated splats
    splatMesh.frustumCulled = false;

    // Verify SplatMesh
    if (!(splatMesh instanceof THREE.Object3D)) {
        log.warn('WARNING: SplatMesh is not an instance of THREE.Object3D!');
    }

    // Wait for splat to finish loading/parsing
    await splatMesh.initialized;

    try {
        scene.add(splatMesh);
    } catch (addError) {
        log.error('Error adding splatMesh to scene:', addError);
        throw addError;
    }

    // Update state
    setSplatMesh(splatMesh);
    state.splatLoaded = true;
    state.currentSplatUrl = url;

    // Clean up blob URL after loading completes
    setTimeout(() => URL.revokeObjectURL(blobUrl), TIMING.BLOB_REVOKE_DELAY);

    // Call callbacks
    if (callbacks?.onSplatLoaded) {
        callbacks.onSplatLoaded(splatMesh, blob);
    }

    return splatMesh;
}

/**
 * Load splat from a blob URL (used by archive loader)
 */
export async function loadSplatFromBlobUrl(blobUrl: string, fileName: string, deps: LoadSplatDeps): Promise<any> {
    const { scene, getSplatMesh, setSplatMesh, state } = deps;

    // Spark.js requires WebGL — switch renderer if currently WebGPU
    if (deps.sceneManager) await deps.sceneManager.ensureWebGLRenderer();

    // Remove existing splat
    const existingSplat = getSplatMesh();
    if (existingSplat) {
        scene.remove(existingSplat);
        if (existingSplat.dispose) existingSplat.dispose();
        setSplatMesh(null);
    }

    // Ensure WASM is ready (required for compressed formats like .sog, .spz)
    await SplatMesh.staticInitialized;

    // Pass fileType for blob URLs where Spark 2.0 can't detect format from path
    const fileType = getSplatFileType(fileName);

    // Create SplatMesh (.sog pre-decoded via legacy worker; other formats use native path)
    const splatMesh = await createSplatMesh(blobUrl, fileType);

    // Apply default rotation
    splatMesh.rotation.x = Math.PI;

    // Disable frustum culling to prevent clipping issues with rotated splats
    splatMesh.frustumCulled = false;

    // Verify SplatMesh
    if (!(splatMesh instanceof THREE.Object3D)) {
        log.warn('WARNING: SplatMesh is not an instance of THREE.Object3D!');
    }

    // Wait for splat to finish loading/parsing
    await splatMesh.initialized;

    try {
        scene.add(splatMesh);
    } catch (addError) {
        log.error('Error adding splatMesh to scene:', addError);
        throw addError;
    }

    // Update state
    setSplatMesh(splatMesh);
    state.splatLoaded = true;

    return splatMesh;
}
