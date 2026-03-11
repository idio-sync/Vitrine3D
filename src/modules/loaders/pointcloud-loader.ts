/**
 * Point Cloud Loader — E57 point cloud file loading
 *
 * Handles .e57 format files via lazy-loaded three-e57-loader.
 * Extracted from file-handlers.ts for modularity.
 */

import * as THREE from 'three';
import { Logger, disposeObject, fetchWithProgress } from '../utilities.js';
import type { AppState } from '@/types.js';

const log = Logger.getLogger('pointcloud-loader');

type ProgressCallback = ((received: number, total: number) => void) | null;

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface LoadPointcloudDeps {
    pointcloudGroup: THREE.Group;
    state: AppState;
    archiveCreator?: any;
    callbacks?: {
        onPointcloudLoaded?: (object: THREE.Object3D, file: File | { name: string }, pointCount: number, blob: Blob) => void;
    };
}

export interface PointcloudLoadResult {
    object: THREE.Group;
    pointCount: number;
}

// =============================================================================
// E57 LAZY LOADING
// =============================================================================

// E57Loader is loaded lazily via dynamic import to allow graceful degradation
// when the three-e57-loader CDN module is unavailable (e.g., offline kiosk viewer).
let _E57Loader: any = null;
let _e57Checked = false;

/**
 * Lazily load the E57Loader. Returns null if unavailable (e.g., offline).
 */
async function getE57Loader(): Promise<any | null> {
    if (_e57Checked) return _E57Loader;
    _e57Checked = true;
    try {
        const mod = await import('three-e57-loader');
        _E57Loader = mod.E57Loader;
        log.info('E57 loader available');
    } catch (e: any) {
        log.warn('E57 loader not available:', e.message);
        _E57Loader = null;
    }
    return _E57Loader;
}

/**
 * Load an E57 file and return a THREE.Group containing THREE.Points.
 * E57 files from surveying/scanning use Z-up convention, so we rotate
 * the geometry to Three.js Y-up coordinate system.
 */
async function loadE57(url: string, onProgress?: (loaded: number, total: number) => void): Promise<THREE.Group> {
    const E57Loader = await getE57Loader();
    if (!E57Loader) {
        throw new Error('E57 point cloud loading is not available. The three-e57-loader module could not be loaded (requires network access).');
    }
    return new Promise((resolve, reject) => {
        const loader = new E57Loader();
        loader.load(
            url,
            (geometry: THREE.BufferGeometry) => {
                // Convert from Z-up (E57/surveying) to Y-up (Three.js)
                geometry.rotateX(-Math.PI / 2);

                const material = new THREE.PointsMaterial({
                    size: 0.01,
                    vertexColors: geometry.hasAttribute('color'),
                    sizeAttenuation: true
                });
                const points = new THREE.Points(geometry, material);
                const group = new THREE.Group();
                group.add(points);
                resolve(group);
            },
            onProgress ? (event: any) => { if (event.lengthComputable) onProgress(event.loaded, event.total); } : undefined,
            (error: any) => {
                reject(error);
            }
        );
    });
}

// =============================================================================
// POINT CLOUD LOADING
// =============================================================================

/**
 * Load a point cloud from a File object
 */
export async function loadPointcloudFromFile(file: File, deps: LoadPointcloudDeps): Promise<void> {
    const {
        pointcloudGroup,
        state,
        archiveCreator,
        callbacks = {}
    } = deps;

    log.info('Loading point cloud from file:', file.name);

    // Clear existing pointcloud
    if (pointcloudGroup) {
        while (pointcloudGroup.children.length > 0) {
            const child = pointcloudGroup.children[0];
            disposeObject(child);
            pointcloudGroup.remove(child);
        }
    }

    // Create blob URL
    const fileUrl = URL.createObjectURL(file);

    try {
        const loadedObject = await loadE57(fileUrl);
        pointcloudGroup.add(loadedObject);
        state.pointcloudLoaded = true;

        // Compute point count
        let pointCount = 0;
        loadedObject.traverse((child) => {
            if ((child as any).isPoints && (child as any).geometry) {
                const posAttr = (child as any).geometry.getAttribute('position');
                if (posAttr) pointCount += posAttr.count;
            }
        });

        // Pre-compute hash for archive export
        const blob = (file as any).slice ? file : new Blob([file]);
        if (archiveCreator) {
            archiveCreator.precomputeHash(blob).catch(() => {});
        }

        if (callbacks.onPointcloudLoaded) {
            callbacks.onPointcloudLoaded(loadedObject, file, pointCount, blob);
        }

        log.info('Point cloud loaded:', file.name, 'points:', pointCount);
    } finally {
        URL.revokeObjectURL(fileUrl);
    }
}

/**
 * Load a point cloud from a URL
 */
export async function loadPointcloudFromUrl(url: string, deps: LoadPointcloudDeps, onProgress: ProgressCallback = null): Promise<void> {
    const {
        pointcloudGroup,
        state,
        archiveCreator,
        callbacks = {}
    } = deps;

    log.info('Loading point cloud from URL:', url);

    // Clear existing pointcloud
    if (pointcloudGroup) {
        while (pointcloudGroup.children.length > 0) {
            const child = pointcloudGroup.children[0];
            disposeObject(child);
            pointcloudGroup.remove(child);
        }
    }

    // Fetch with progress
    const blob = await fetchWithProgress(url, onProgress);
    const blobUrl = URL.createObjectURL(blob);

    // Pre-compute hash
    if (archiveCreator) {
        archiveCreator.precomputeHash(blob).catch(() => {});
    }

    try {
        const loadedObject = await loadE57(blobUrl);
        pointcloudGroup.add(loadedObject);
        state.pointcloudLoaded = true;
        state.currentPointcloudUrl = url;

        // Compute point count
        let pointCount = 0;
        loadedObject.traverse((child) => {
            if ((child as any).isPoints && (child as any).geometry) {
                const posAttr = (child as any).geometry.getAttribute('position');
                if (posAttr) pointCount += posAttr.count;
            }
        });

        const fileName = url.split('/').pop() || 'pointcloud.e57';

        if (callbacks.onPointcloudLoaded) {
            callbacks.onPointcloudLoaded(loadedObject, { name: fileName }, pointCount, blob);
        }

        log.info('Point cloud loaded from URL:', url, 'points:', pointCount);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}

/**
 * Load a point cloud from a blob URL (used by archive loader)
 */
export async function loadPointcloudFromBlobUrl(blobUrl: string, fileName: string, deps: Pick<LoadPointcloudDeps, 'pointcloudGroup'>, onProgress?: (loaded: number, total: number) => void): Promise<PointcloudLoadResult> {
    const { pointcloudGroup } = deps;

    log.info('Loading point cloud from blob URL:', fileName);

    // Clear existing pointcloud
    if (pointcloudGroup) {
        while (pointcloudGroup.children.length > 0) {
            const child = pointcloudGroup.children[0];
            disposeObject(child);
            pointcloudGroup.remove(child);
        }
    }

    const loadedObject = await loadE57(blobUrl, onProgress);
    pointcloudGroup.add(loadedObject);

    // Compute point count
    let pointCount = 0;
    loadedObject.traverse((child) => {
        if ((child as any).isPoints && (child as any).geometry) {
            const posAttr = (child as any).geometry.getAttribute('position');
            if (posAttr) pointCount += posAttr.count;
        }
    });

    return { object: loadedObject, pointCount };
}

// =============================================================================
// POINT CLOUD VISUAL UPDATES
// =============================================================================

/**
 * Update point cloud point size
 */
export function updatePointcloudPointSize(pointcloudGroup: THREE.Group, size: number): void {
    if (pointcloudGroup) {
        pointcloudGroup.traverse((child) => {
            if ((child as any).isPoints && (child as any).material) {
                (child as any).material.size = size;
                (child as any).material.needsUpdate = true;
            }
        });
    }
}

/**
 * Update point cloud opacity
 */
export function updatePointcloudOpacity(pointcloudGroup: THREE.Group, opacity: number): void {
    if (pointcloudGroup) {
        pointcloudGroup.traverse((child) => {
            if ((child as any).isPoints && (child as any).material) {
                (child as any).material.transparent = opacity < 1;
                (child as any).material.opacity = opacity;
                (child as any).material.needsUpdate = true;
            }
        });
    }
}
