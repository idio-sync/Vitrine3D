/**
 * Archive Asset Loader — archive processing, lazy asset extraction, quality tier switching
 *
 * Handles archive loading/processing, per-asset-type extraction on demand,
 * and full-res/proxy swapping for quality tier management.
 * Extracted from file-handlers.ts for modularity.
 */

import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';
import { ArchiveLoader } from '../archive-loader.js';
import { ASSET_STATE } from '../constants.js';
import { Logger, computeMeshFaceCount, disposeObject } from '../utilities.js';
import type { AppState, QualityTier } from '@/types.js';

// Imports from sibling loader modules
import { createSplatMesh, getSplatFileType, loadSplatFromBlobUrl } from './splat-loader.js';
import { loadGLTF, loadOBJFromUrl, loadSTLFromUrl, loadDRC, loadModelFromBlobUrl } from './mesh-loader.js';
import { loadPointcloudFromBlobUrl } from './pointcloud-loader.js';
import { yieldToRenderer } from '../background-loader.js';

const log = Logger.getLogger('archive-asset-loader');

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface LoadArchiveDeps {
    state: AppState;
}

interface ProcessArchiveDeps {
    scene: THREE.Scene;
    getSplatMesh: () => any;
    setSplatMesh: (mesh: any) => void;
    modelGroup: THREE.Group;
    state: AppState;
    callbacks?: {
        onApplySplatTransform?: (transform: any) => void;
        onApplyModelTransform?: (transform: any) => void;
        onApplyPointcloudTransform?: (transform: any) => void;
    };
}

export interface LoadArchiveAssetDeps {
    scene: THREE.Scene;
    getSplatMesh: () => any;
    setSplatMesh: (mesh: any) => void;
    modelGroup: THREE.Group;
    pointcloudGroup: THREE.Group;
    state: AppState;
    qualityTier?: QualityTier | string;
    sceneManager?: { ensureWebGLRenderer: () => Promise<void>; ensureWebGPURenderer: () => Promise<void> };
    callbacks?: {
        onApplySplatTransform?: (transform: any) => void;
        onApplyModelTransform?: (transform: any) => void;
        onApplyPointcloudTransform?: (transform: any) => void;
    };
    onProgress?: (percent: number, stage: string) => void;
}

export interface LoadFullResDeps {
    scene: THREE.Scene;
    getSplatMesh: () => any;
    setSplatMesh: (mesh: any) => void;
    modelGroup: THREE.Group;
    state: AppState;
    sceneManager?: { ensureWebGLRenderer: () => Promise<void>; ensureWebGPURenderer: () => Promise<void> };
    callbacks?: {
        onApplySplatTransform?: (transform: any) => void;
        onApplyModelTransform?: (transform: any) => void;
    };
}

export interface ProcessArchiveResult {
    manifest: any;
    archiveLoader: ArchiveLoader;
    loadedSplat: boolean;
    loadedMesh: boolean;
    splatBlob: Blob | null;
    meshBlob: Blob | null;
    errors: string[];
    globalAlignment: any;
    annotations: any[];
}

export interface Phase1Result {
    manifest: any;
    contentInfo: any;
    thumbnailUrl: string | null;
}

export interface AssetLoadResult {
    loaded: boolean;
    blob: Blob | null;
    error: string | null;
    faceCount?: number;
    pointCount?: number;
    isProxy?: boolean;
}

// =============================================================================
// ARCHIVE LOADING
// =============================================================================

/**
 * Load archive from a file
 */
export async function loadArchiveFromFile(file: File, deps: LoadArchiveDeps): Promise<ArchiveLoader> {
    const { state } = deps;

    // Clean up previous archive
    if (state.archiveLoader) {
        state.archiveLoader.dispose();
    }

    const archiveLoader = new ArchiveLoader();
    await archiveLoader.loadFromFile(file);

    state.currentArchiveUrl = null; // Local files cannot be shared

    return archiveLoader;
}

/**
 * Load archive from URL
 */
export async function loadArchiveFromUrl(url: string, deps: LoadArchiveDeps, onProgress: ((progress: number) => void) | null = null): Promise<ArchiveLoader> {
    const { state } = deps;

    // Clean up previous archive
    if (state.archiveLoader) {
        state.archiveLoader.dispose();
    }

    const archiveLoader = new ArchiveLoader();
    await archiveLoader.loadFromUrl(url, onProgress);

    state.currentArchiveUrl = url;

    return archiveLoader;
}

// =============================================================================
// ARCHIVE PROCESSING
// =============================================================================

/**
 * Process loaded archive - extract and load splat/mesh
 */
export async function processArchive(archiveLoader: ArchiveLoader, archiveName: string, deps: ProcessArchiveDeps): Promise<ProcessArchiveResult> {
    const { state, callbacks } = deps;

    const manifest = await archiveLoader.parseManifest();
    log.info('Archive manifest:', manifest);

    state.archiveLoader = archiveLoader;
    state.archiveManifest = manifest;
    state.archiveFileName = archiveName;
    state.archiveLoaded = true;

    const contentInfo = archiveLoader.getContentInfo();
    const errors: string[] = [];
    let loadedSplat = false;
    let loadedMesh = false;
    let splatBlob: Blob | null = null;
    let meshBlob: Blob | null = null;

    // Load splat (scene_0) if present
    const sceneEntry = archiveLoader.getSceneEntry();
    if (sceneEntry && contentInfo.hasSplat) {
        try {
            const splatData = await archiveLoader.extractFile(sceneEntry.file_name);
            if (splatData) {
                await loadSplatFromBlobUrl(splatData.url, sceneEntry.file_name, deps);
                loadedSplat = true;
                splatBlob = splatData.blob;

                // Apply transform from entry parameters if present
                const transform = archiveLoader.getEntryTransform(sceneEntry);
                if (callbacks?.onApplySplatTransform) {
                    callbacks.onApplySplatTransform(transform);
                }
            }
        } catch (e: any) {
            errors.push(`Failed to load splat: ${e.message}`);
            log.error('Error loading splat from archive:', e);
        }
    }

    // Load mesh (mesh_0) if present
    const meshEntry = archiveLoader.getMeshEntry();
    if (meshEntry && contentInfo.hasMesh) {
        try {
            const meshData = await archiveLoader.extractFile(meshEntry.file_name);
            if (meshData) {
                await loadModelFromBlobUrl(meshData.url, meshEntry.file_name, deps);
                loadedMesh = true;
                meshBlob = meshData.blob;

                // Apply transform from entry parameters if present
                const transform = archiveLoader.getEntryTransform(meshEntry);
                if (callbacks?.onApplyModelTransform) {
                    callbacks.onApplyModelTransform(transform);
                }
            }
        } catch (e: any) {
            errors.push(`Failed to load mesh: ${e.message}`);
            log.error('Error loading mesh from archive:', e);
        }
    }

    // Get global alignment data
    const globalAlignment = archiveLoader.getGlobalAlignment();

    // Get annotations
    const annotations = archiveLoader.getAnnotations();

    return {
        manifest,
        archiveLoader,
        loadedSplat,
        loadedMesh,
        splatBlob,
        meshBlob,
        errors,
        globalAlignment,
        annotations
    };
}

// =============================================================================
// PHASED ARCHIVE PROCESSING (Lazy Loading)
// =============================================================================

/**
 * Phase 1: Fast archive processing — manifest + metadata only, no 3D asset decompression.
 * Typically completes in ~50ms. Extracts thumbnail if present.
 */
export async function processArchivePhase1(archiveLoader: ArchiveLoader, archiveName: string, deps: Pick<ProcessArchiveDeps, 'state'>): Promise<Phase1Result> {
    const { state } = deps;

    const manifest = await archiveLoader.parseManifest();
    log.info('Phase 1 — manifest parsed:', manifest);

    state.archiveLoader = archiveLoader;
    state.archiveManifest = manifest;
    state.archiveFileName = archiveName;
    state.archiveLoaded = true;

    const contentInfo = archiveLoader.getContentInfo();

    // Index detail model entries (lazy — not extracted until user clicks inspect)
    const detailIndex = new Map<string, { filename: string }>();
    if (manifest.data_entries) {
        for (const [key, entry] of Object.entries(manifest.data_entries)) {
            if (key.startsWith('detail_') && (entry as any).role === 'detail') {
                detailIndex.set(key, { filename: (entry as any).file_name });
            }
        }
    }
    state.detailAssetIndex = detailIndex;
    state.loadedDetailBlobs = new Map();
    if (detailIndex.size > 0) {
        log.info(`Phase 1 — indexed ${detailIndex.size} detail model(s)`);
    }

    // Extract thumbnail (small file, fast)
    let thumbnailUrl: string | null = null;
    const thumbnailEntry = archiveLoader.getThumbnailEntry();
    if (thumbnailEntry) {
        try {
            const thumbData = await archiveLoader.extractFile(thumbnailEntry.file_name);
            if (thumbData) {
                thumbnailUrl = thumbData.url;
            }
        } catch (e: any) {
            log.warn('Failed to extract thumbnail:', e.message);
        }
    }

    return { manifest, contentInfo, thumbnailUrl };
}

/**
 * Load a single archive asset type on demand.
 */
export async function loadArchiveAsset(archiveLoader: ArchiveLoader, assetType: 'splat' | 'mesh' | 'pointcloud', deps: LoadArchiveAssetDeps): Promise<AssetLoadResult> {
    const { state, callbacks = {} } = deps;

    // Initialize assetStates if not present
    if (!state.assetStates) {
        state.assetStates = { splat: ASSET_STATE.UNLOADED, mesh: ASSET_STATE.UNLOADED, pointcloud: ASSET_STATE.UNLOADED };
    }

    // Guard against duplicate loads
    if (state.assetStates[assetType] === ASSET_STATE.LOADING) {
        log.warn(`Asset "${assetType}" is already loading, skipping duplicate request`);
        return { loaded: false, blob: null, error: 'Already loading' };
    }
    if (state.assetStates[assetType] === ASSET_STATE.LOADED) {
        log.info(`Asset "${assetType}" already loaded`);
        return { loaded: true, blob: null, error: null };
    }

    state.assetStates[assetType] = ASSET_STATE.LOADING;
    deps.onProgress?.(10, 'Preparing...');

    try {
        if (assetType === 'splat') {
            const contentInfo = archiveLoader.getContentInfo();
            const sceneEntry = archiveLoader.getSceneEntry();
            if (!sceneEntry || !contentInfo.hasSplat) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return { loaded: false, blob: null, error: 'No splat in archive' };
            }

            // Prefer proxy when available and quality tier is SD
            const qualityTier = deps.qualityTier || 'hd';
            const proxyEntry = archiveLoader.getSceneProxyEntry();
            const useProxy = qualityTier === 'sd' && contentInfo.hasSceneProxy && proxyEntry;
            const entryToLoad = useProxy ? proxyEntry : sceneEntry;

            deps.onProgress?.(40, 'Decompressing splat...');
            const splatData = await archiveLoader.extractFile(entryToLoad.file_name);
            if (!splatData) {
                state.assetStates[assetType] = ASSET_STATE.ERROR;
                return { loaded: false, blob: null, error: 'Failed to extract splat file' };
            }

            deps.onProgress?.(60, 'Parsing splat data...');
            // Spark.js SplatMesh has no progress callback — simulate gradual progress
            let simInterval: ReturnType<typeof setInterval> | undefined;
            if (deps.onProgress) {
                let simPct = 60;
                simInterval = setInterval(() => {
                    simPct = Math.min(simPct + 3, 92);
                    deps.onProgress!(simPct, 'Parsing splat data...');
                }, 100);
            }
            try {
                await loadSplatFromBlobUrl(splatData.url, entryToLoad.file_name, deps);
            } finally {
                if (simInterval) clearInterval(simInterval);
            }

            // Apply transform from the primary scene entry (proxy inherits the same transform)
            const transform = archiveLoader.getEntryTransform(sceneEntry);
            if (callbacks.onApplySplatTransform) {
                callbacks.onApplySplatTransform(transform);
            }

            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return { loaded: true, blob: splatData.blob, error: null, isProxy: !!useProxy };

        } else if (assetType === 'mesh') {
            const contentInfo = archiveLoader.getContentInfo();
            const meshEntry = archiveLoader.getMeshEntry();
            if (!meshEntry || !contentInfo.hasMesh) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return { loaded: false, blob: null, error: 'No mesh in archive' };
            }

            // Prefer proxy mesh when available and quality tier is SD
            const qualityTier = deps.qualityTier || 'hd';
            const proxyEntry = archiveLoader.getMeshProxyEntry();
            const useProxy = qualityTier === 'sd' && contentInfo.hasMeshProxy && proxyEntry;
            const entryToLoad = useProxy ? proxyEntry : meshEntry;

            deps.onProgress?.(40, 'Decompressing model...');
            const meshData = await archiveLoader.extractFile(entryToLoad.file_name);
            if (!meshData) {
                state.assetStates[assetType] = ASSET_STATE.ERROR;
                return { loaded: false, blob: null, error: 'Failed to extract mesh file' };
            }

            deps.onProgress?.(60, 'Parsing model data...');
            const parseProgress = deps.onProgress ? (loaded: number, total: number) => {
                if (total > 0) deps.onProgress!(60 + Math.round((loaded / total) * 35), 'Parsing model data...');
            } : undefined;
            const result = await loadModelFromBlobUrl(meshData.url, entryToLoad.file_name, deps, parseProgress);

            // Apply transform from the primary mesh entry (proxy inherits the same transform)
            const transform = archiveLoader.getEntryTransform(meshEntry);
            if (callbacks.onApplyModelTransform) {
                callbacks.onApplyModelTransform(transform);
            }

            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return {
                loaded: true,
                blob: meshData.blob,
                error: null,
                faceCount: result?.faceCount || 0,
                isProxy: !!useProxy
            };

        } else if (assetType === 'pointcloud') {
            const contentInfo = archiveLoader.getContentInfo();
            if (!contentInfo.hasPointcloud) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return { loaded: false, blob: null, error: 'No pointcloud in archive' };
            }

            // Find pointcloud entry
            const pcEntries = archiveLoader.findEntriesByPrefix('pointcloud');
            if (pcEntries.length === 0) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return { loaded: false, blob: null, error: 'No pointcloud entries found' };
            }

            const pcEntry = pcEntries[0].entry;
            deps.onProgress?.(40, 'Decompressing point cloud...');
            const pcData = await archiveLoader.extractFile(pcEntry.file_name);
            if (!pcData) {
                state.assetStates[assetType] = ASSET_STATE.ERROR;
                return { loaded: false, blob: null, error: 'Failed to extract pointcloud file' };
            }

            deps.onProgress?.(60, 'Parsing point cloud data...');
            const parseProgress = deps.onProgress ? (loaded: number, total: number) => {
                if (total > 0) deps.onProgress!(60 + Math.round((loaded / total) * 35), 'Parsing point cloud data...');
            } : undefined;
            const result = await loadPointcloudFromBlobUrl(pcData.url, pcEntry.file_name, deps, parseProgress);

            // Apply transform if present
            const transform = archiveLoader.getEntryTransform(pcEntry);
            if (callbacks.onApplyPointcloudTransform) {
                callbacks.onApplyPointcloudTransform(transform);
            }

            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return { loaded: true, blob: pcData.blob, error: null, pointCount: result?.pointCount || 0 };
        }

        return { loaded: false, blob: null, error: `Unknown asset type: ${assetType}` };

    } catch (e: any) {
        state.assetStates[assetType] = ASSET_STATE.ERROR;
        log.error(`Error loading ${assetType} from archive:`, e);
        return { loaded: false, blob: null, error: e.message };
    }
}

// =============================================================================
// OFF-SCENE MESH PARSING
// =============================================================================

/**
 * Parse a mesh from a blob URL into a temporary off-scene group.
 * Returns the loaded object without adding it to any scene graph.
 */
async function parseMeshOffScene(source: string | ArrayBuffer, fileName: string, onProgress?: (loaded: number, total: number) => void): Promise<{ object: THREE.Object3D; faceCount: number } | null> {
    const extension = fileName.split('.').pop()?.toLowerCase();
    let loadedObject: THREE.Object3D | undefined;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(source, onProgress);
    } else if (extension === 'obj') {
        loadedObject = await loadOBJFromUrl(source as string, onProgress);
    } else if (extension === 'stl') {
        loadedObject = await loadSTLFromUrl(source as string, onProgress);
    } else if (extension === 'drc') {
        loadedObject = await loadDRC(source as string, onProgress);
    }

    if (!loadedObject) return null;

    const faceCount = computeMeshFaceCount(loadedObject);
    return { object: loadedObject, faceCount };
}

/**
 * Swap mesh geometry and materials in-place on modelGroup.
 * Performs a synchronous swap so the renderer never draws an empty frame.
 *
 * Strategy:
 * - Collect all Mesh children from both old (modelGroup) and new (parsed HD object)
 * - If counts match, swap geometry + material per-child (fastest, no scene graph change)
 * - If counts differ, bulk remove-all + add-all in one synchronous block
 * - Dispose old geometry/materials after swap
 */
function swapMeshChildren(modelGroup: THREE.Group, newObject: THREE.Object3D): void {
    const oldMeshes: THREE.Mesh[] = [];
    modelGroup.traverse((child: any) => {
        if (child.isMesh) oldMeshes.push(child);
    });

    const newMeshes: THREE.Mesh[] = [];
    newObject.traverse((child: any) => {
        if (child.isMesh) newMeshes.push(child);
    });

    if (oldMeshes.length === newMeshes.length && oldMeshes.length > 0) {
        // Per-child geometry/material swap — no scene graph mutation
        for (let i = 0; i < oldMeshes.length; i++) {
            const oldGeo = oldMeshes[i].geometry;
            const oldMat = oldMeshes[i].material;

            oldMeshes[i].geometry = newMeshes[i].geometry;
            oldMeshes[i].material = newMeshes[i].material;

            // Dispose old resources
            if (oldGeo) oldGeo.dispose();
            if (Array.isArray(oldMat)) {
                oldMat.forEach(m => { if (m.dispose) m.dispose(); });
            } else if (oldMat && (oldMat as THREE.Material).dispose) {
                (oldMat as THREE.Material).dispose();
            }
        }
    } else {
        // Mesh count mismatch — bulk swap in one synchronous block
        const oldChildren = [...modelGroup.children];

        // Remove all old children
        while (modelGroup.children.length > 0) {
            modelGroup.remove(modelGroup.children[0]);
        }

        // Add all new children from loaded object
        if (newObject.children) {
            const newChildren = [...newObject.children];
            for (const child of newChildren) {
                modelGroup.add(child);
            }
        } else {
            modelGroup.add(newObject);
        }

        // Dispose old resources
        for (const child of oldChildren) {
            disposeObject(child);
        }
    }
}

// =============================================================================
// QUALITY TIER SWAP — FULL-RES / PROXY
// =============================================================================

/**
 * Load the full-resolution mesh from an archive, replacing the currently displayed proxy.
 * Uses off-scene parsing and in-place swap to avoid empty frames.
 */
export async function loadArchiveFullResMesh(archiveLoader: ArchiveLoader, deps: LoadFullResDeps): Promise<AssetLoadResult> {
    const { state, callbacks = {} } = deps;
    const meshEntry = archiveLoader.getMeshEntry();
    if (!meshEntry) {
        return { loaded: false, blob: null, error: 'No full-resolution mesh in archive' };
    }

    const { modelGroup } = deps;

    // Capture current modelGroup transform (preserves user edits during quality switch)
    const currentTransform = modelGroup ? {
        position: [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z] as [number, number, number],
        rotation: [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z] as [number, number, number],
        scale: [modelGroup.scale.x, modelGroup.scale.y, modelGroup.scale.z] as [number, number, number]
    } : null;

    // Try direct ArrayBuffer path for GLB/GLTF (no Blob, no _fileCache copy — single Range request)
    const extension = meshEntry.file_name.split('.').pop()?.toLowerCase();
    let parsed: { object: THREE.Object3D; faceCount: number } | null = null;
    let meshBlob: Blob | null = null;

    if (extension === 'glb' || extension === 'gltf') {
        const buffer = await archiveLoader.extractFileBuffer(meshEntry.file_name);
        if (buffer) {
            parsed = await parseMeshOffScene(buffer, meshEntry.file_name);
            // No Blob copy — Three.js holds parsed geometry, and the editor's export
            // fallback (export-controller.ts) re-extracts from archive on demand.
            // Skipping the Blob saves ~160 MB for large HD meshes.
        }
    }

    if (!parsed) {
        // Fall back to Blob URL path (non-GLB formats, or Range request unavailable)
        const meshData = await archiveLoader.extractFile(meshEntry.file_name);
        if (!meshData) {
            return { loaded: false, blob: null, error: 'Failed to extract full-resolution mesh' };
        }
        meshBlob = meshData.blob;
        parsed = await parseMeshOffScene(meshData.url, meshEntry.file_name);
    }

    if (!parsed) {
        return { loaded: false, blob: null, error: 'Failed to parse full-resolution mesh' };
    }

    // Yield before swap so the renderer gets a frame before the GPU upload
    await yieldToRenderer();

    // In-place swap: synchronous, no empty frames
    if (modelGroup && modelGroup.children.length > 0) {
        swapMeshChildren(modelGroup, parsed.object);
    } else {
        // No existing mesh to swap — just add directly (first load, no proxy)
        if (modelGroup) {
            modelGroup.add(parsed.object);
        }
    }

    // Yield after swap so the renderer can present the new geometry
    await yieldToRenderer();

    state.modelLoaded = true;

    // Re-apply the captured transform, falling back to manifest
    const transform = currentTransform || archiveLoader.getEntryTransform(meshEntry);
    if (callbacks.onApplyModelTransform) {
        callbacks.onApplyModelTransform(transform);
    }

    state.assetStates.mesh = ASSET_STATE.LOADED;
    return { loaded: true, blob: meshBlob, error: null, faceCount: parsed.faceCount };
}

/**
 * Swap splat assets using load-then-swap: create the new SplatMesh off-scene,
 * wait for it to initialize, then atomically remove old + add new.
 * Eliminates blank frames during quality tier switches.
 */
async function swapSplatAsset(
    blobUrl: string, fileName: string,
    deps: LoadFullResDeps,
    fallbackTransform: any
): Promise<void> {
    const { state, scene, getSplatMesh, setSplatMesh, callbacks = {} } = deps;

    // Ensure WebGL renderer (Spark.js requirement)
    if (deps.sceneManager) await deps.sceneManager.ensureWebGLRenderer();
    await SplatMesh.staticInitialized;

    const fileType = getSplatFileType(fileName);

    // Capture current transform before swap (preserves user edits)
    const existingSplat = getSplatMesh();
    const currentTransform = existingSplat ? {
        position: [existingSplat.position.x, existingSplat.position.y, existingSplat.position.z] as [number, number, number],
        rotation: [existingSplat.rotation.x, existingSplat.rotation.y, existingSplat.rotation.z] as [number, number, number],
        scale: [existingSplat.scale.x, existingSplat.scale.y, existingSplat.scale.z] as [number, number, number]
    } : null;

    // Create new SplatMesh off-scene — old one stays visible during load
    const newSplat = await createSplatMesh(blobUrl, fileType);
    newSplat.rotation.x = Math.PI;
    newSplat.frustumCulled = false;

    // Yield before GPU texture upload so the renderer stays responsive
    await yieldToRenderer();
    await newSplat.initialized;

    // Atomic swap: remove old, add new in the same synchronous block
    if (existingSplat) {
        scene.remove(existingSplat);
        existingSplat.dispose?.();
    }
    scene.add(newSplat);
    setSplatMesh(newSplat);
    state.splatLoaded = true;

    // Re-apply the captured transform, falling back to caller-provided manifest transform
    const transform = currentTransform || fallbackTransform;
    if (transform && callbacks.onApplySplatTransform) {
        callbacks.onApplySplatTransform(transform);
    }
}

/**
 * Load the full-resolution splat from an archive, replacing the currently displayed proxy.
 * Uses load-then-swap to avoid blank frames.
 */
export async function loadArchiveFullResSplat(archiveLoader: ArchiveLoader, deps: LoadFullResDeps): Promise<AssetLoadResult> {
    const sceneEntry = archiveLoader.getSceneEntry();
    if (!sceneEntry) {
        return { loaded: false, blob: null, error: 'No full-resolution splat in archive' };
    }

    const splatData = await archiveLoader.extractFile(sceneEntry.file_name);
    if (!splatData) {
        return { loaded: false, blob: null, error: 'Failed to extract full-resolution splat' };
    }

    await swapSplatAsset(splatData.url, sceneEntry.file_name, deps, archiveLoader.getEntryTransform(sceneEntry));

    deps.state.assetStates.splat = ASSET_STATE.LOADED;
    return { loaded: true, blob: splatData.blob, error: null };
}

/**
 * Load the proxy splat from an archive, replacing the currently displayed full-res.
 * Uses load-then-swap to avoid blank frames.
 */
export async function loadArchiveProxySplat(archiveLoader: ArchiveLoader, deps: LoadFullResDeps): Promise<AssetLoadResult> {
    const proxyEntry = archiveLoader.getSceneProxyEntry();
    if (!proxyEntry) {
        return { loaded: false, blob: null, error: 'No proxy splat in archive' };
    }

    const splatData = await archiveLoader.extractFile(proxyEntry.file_name);
    if (!splatData) {
        return { loaded: false, blob: null, error: 'Failed to extract proxy splat' };
    }

    const sceneEntry = archiveLoader.getSceneEntry();
    await swapSplatAsset(splatData.url, proxyEntry.file_name, deps, archiveLoader.getEntryTransform(sceneEntry || proxyEntry));

    deps.state.assetStates.splat = ASSET_STATE.LOADED;
    return { loaded: true, blob: splatData.blob, error: null };
}

/**
 * Load the proxy mesh from an archive, replacing the currently displayed full-res.
 * Uses off-scene parsing and atomic swap (same pattern as loadArchiveFullResMesh)
 * to avoid blank frames during the transition.
 */
export async function loadArchiveProxyMesh(archiveLoader: ArchiveLoader, deps: LoadFullResDeps): Promise<AssetLoadResult> {
    const { state, callbacks = {} } = deps;
    const proxyEntry = archiveLoader.getMeshProxyEntry();
    if (!proxyEntry) {
        return { loaded: false, blob: null, error: 'No proxy mesh in archive' };
    }

    const { modelGroup } = deps;

    // Capture current modelGroup transform (preserves user edits during quality switch)
    const currentTransform = modelGroup ? {
        position: [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z] as [number, number, number],
        rotation: [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z] as [number, number, number],
        scale: [modelGroup.scale.x, modelGroup.scale.y, modelGroup.scale.z] as [number, number, number]
    } : null;

    // Try direct ArrayBuffer path for GLB/GLTF (same as loadArchiveFullResMesh)
    const extension = proxyEntry.file_name.split('.').pop()?.toLowerCase();
    let parsed: { object: THREE.Object3D; faceCount: number } | null = null;
    let meshBlob: Blob | null = null;

    if (extension === 'glb' || extension === 'gltf') {
        const buffer = await archiveLoader.extractFileBuffer(proxyEntry.file_name);
        if (buffer) {
            parsed = await parseMeshOffScene(buffer, proxyEntry.file_name);
            // No Blob copy — export fallback re-extracts from archive on demand
        }
    }

    if (!parsed) {
        const meshData = await archiveLoader.extractFile(proxyEntry.file_name);
        if (!meshData) {
            return { loaded: false, blob: null, error: 'Failed to extract proxy mesh' };
        }
        meshBlob = meshData.blob;
        parsed = await parseMeshOffScene(meshData.url, proxyEntry.file_name);
    }

    if (!parsed) {
        return { loaded: false, blob: null, error: 'Failed to parse proxy mesh' };
    }

    // Atomic swap: no blank frames
    if (modelGroup && modelGroup.children.length > 0) {
        swapMeshChildren(modelGroup, parsed.object);
    } else if (modelGroup) {
        modelGroup.add(parsed.object);
    }

    state.modelLoaded = true;

    // Re-apply the captured transform (user's current position), falling back to manifest
    const meshEntry = archiveLoader.getMeshEntry();
    const transform = currentTransform || archiveLoader.getEntryTransform(meshEntry || proxyEntry);
    if (callbacks.onApplyModelTransform) {
        callbacks.onApplyModelTransform(transform);
    }

    state.assetStates.mesh = ASSET_STATE.LOADED;
    return { loaded: true, blob: meshBlob, error: null, faceCount: parsed.faceCount };
}

// =============================================================================
// DISPLAY MODE HELPERS
// =============================================================================

/**
 * Determine which asset types are needed for a given display mode.
 */
export function getAssetTypesForMode(mode: string): string[] {
    switch (mode) {
        case 'splat': return ['splat'];
        case 'model': return ['mesh'];
        case 'both': return ['splat', 'mesh'];
        case 'split': return ['splat', 'mesh'];
        case 'pointcloud': return ['pointcloud'];
        case 'stl': return ['stl'];
        default: return ['splat', 'mesh'];
    }
}

/**
 * Determine the primary asset type to load first based on display mode and available content.
 * Priority: splat > mesh > pointcloud (splat gives fastest visual feedback).
 */
export function getPrimaryAssetType(displayMode: string, contentInfo: any): string {
    const modeTypes = getAssetTypesForMode(displayMode);

    // Try mode-preferred types first
    for (const type of modeTypes) {
        if (type === 'splat' && contentInfo.hasSplat) return 'splat';
        if (type === 'mesh' && contentInfo.hasMesh) return 'mesh';
        if (type === 'pointcloud' && contentInfo.hasPointcloud) return 'pointcloud';
    }

    // Fallback: whatever is available
    if (contentInfo.hasSplat) return 'splat';
    if (contentInfo.hasMesh) return 'mesh';
    if (contentInfo.hasPointcloud) return 'pointcloud';

    return 'splat'; // Default
}
