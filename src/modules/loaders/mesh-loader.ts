/**
 * Mesh Loader — GLTF/GLB, OBJ, STL, DRC model loading
 *
 * Handles all mesh/model format loading including multi-part OBJ with textures,
 * Draco-compressed meshes, and STL files.
 * Extracted from file-handlers.ts for modularity.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TIMING } from '../constants.js';
import { Logger, processMeshMaterials, computeMeshFaceCount, computeMeshVertexCount, computeTextureInfo, disposeObject, fetchWithProgress } from '../utilities.js';
import type { AppState } from '@/types.js';

const log = Logger.getLogger('mesh-loader');

type ProgressCallback = ((received: number, total: number) => void) | null;

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface LoadModelDeps {
    modelGroup: THREE.Group;
    state: AppState;
    archiveCreator?: any;
    callbacks?: {
        onModelLoaded?: (object: THREE.Object3D, file: File | Blob, faceCount: number) => void;
    };
}

export interface LoadSTLDeps {
    stlGroup: THREE.Group;
    state: AppState;
    callbacks?: {
        onSTLLoaded?: (object: THREE.Mesh, file: File | Blob, faceCount: number) => void;
    };
}

export interface ModelLoadResult {
    object: THREE.Object3D;
    faceCount: number;
    textureInfo?: import('../utilities.js').TextureInfo;
}

/**
 * Describes one OBJ file and its companion MTL + texture files.
 */
export interface OBJGroup {
    objFile: File;
    mtlFile: File | null;
    textureFiles: File[];
}

// =============================================================================
// DRACO LOADER SINGLETON
// =============================================================================

// Singleton Draco decoder — WASM is compiled once and reused across all GLTF loads.
// In kiosk offline mode, the bootstrap injects the decoder source into
// window.__DRACO_DECODER_SRC__ before modules are imported. If present, use it
// directly to avoid any network fetch (the kiosk HTML may be opened via file://).
const dracoLoader = new DRACOLoader();
const _dracoOfflineSrc = (window as any).__DRACO_DECODER_SRC__;
if (_dracoOfflineSrc) {
    dracoLoader.setDecoderConfig({ type: 'js' });
    (dracoLoader as any)._loadLibrary = () => Promise.resolve(_dracoOfflineSrc);
} else {
    dracoLoader.setDecoderPath('/draco/');
    // Force JS decoder — Blender 5.x Draco-compressed GLBs crash the WASM decoder
    // with Aborted(). The JS decoder (draco_decoder.js) is ~2x slower but handles
    // all Draco-encoded files reliably. If WASM compatibility is resolved upstream,
    // remove this line to re-enable the faster WASM path.
    dracoLoader.setDecoderConfig({ type: 'js' });
}

// =============================================================================
// GLTF/GLB LOADING
// =============================================================================

/**
 * Load GLTF/GLB model
 */
export function loadGLTF(source: File | string | ArrayBuffer, onProgress?: (loaded: number, total: number) => void): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);
        loader.setMeshoptDecoder(MeshoptDecoder);

        // Direct parse path — no fetch, no Blob, no intermediate copy
        if (source instanceof ArrayBuffer) {
            loader.parse(
                source,
                '',
                (gltf) => { processMeshMaterials(gltf.scene); resolve(gltf.scene); },
                (error) => reject(error)
            );
            return;
        }

        const url = source instanceof File ? URL.createObjectURL(source) : source;
        const isFile = source instanceof File;

        loader.load(
            url,
            (gltf) => {
                if (isFile) URL.revokeObjectURL(url);
                processMeshMaterials(gltf.scene);
                resolve(gltf.scene);
            },
            onProgress ? (event) => { if (event.lengthComputable) onProgress(event.loaded, event.total); } : undefined,
            (error) => {
                if (isFile) URL.revokeObjectURL(url);
                reject(error);
            }
        );
    });
}

// =============================================================================
// OBJ LOADING
// =============================================================================

/**
 * Texture file extensions recognized when loading OBJ companions.
 */
const TEXTURE_EXTS = new Set(['png', 'jpg', 'jpeg', 'tga', 'bmp', 'webp']);

/**
 * Load OBJ model with optional MTL and texture files.
 * Uses the Three.js docs pattern: all files are mapped by original filename
 * to blob URLs via a LoadingManager URL modifier, then loaded by name.
 * This ensures MTLLoader resolves texture references correctly.
 */
function loadOBJ(objFile: File, mtlFile: File | null, textureFiles?: File[]): Promise<THREE.Group> {
    // Map all files by their original filename → blob URL (Three.js docs pattern)
    const blobMap = new Map<string, string>();
    const allBlobUrls: string[] = [];

    const mapFile = (file: File) => {
        const blobUrl = URL.createObjectURL(file);
        blobMap.set(file.name, blobUrl);
        blobMap.set(file.name.toLowerCase(), blobUrl);
        allBlobUrls.push(blobUrl);
    };

    mapFile(objFile);
    if (mtlFile) mapFile(mtlFile);
    if (textureFiles) {
        for (const file of textureFiles) mapFile(file);
    }

    // LoadingManager URL modifier maps filenames to blob URLs
    const manager = new THREE.LoadingManager();
    manager.onError = (url: string) => {
        log.warn('Failed to load OBJ resource:', url);
    };
    manager.setURLModifier((url: string) => {
        // Try exact match
        if (blobMap.has(url)) return blobMap.get(url)!;
        // Try case-insensitive
        const lower = url.toLowerCase();
        if (blobMap.has(lower)) return blobMap.get(lower)!;
        // Try filename only (strips any path prefix)
        const filename = url.split(/[/\\]/).pop() || '';
        if (blobMap.has(filename)) return blobMap.get(filename)!;
        if (blobMap.has(filename.toLowerCase())) return blobMap.get(filename.toLowerCase())!;
        log.warn('URL modifier: no blob match for', url, '— available:', [...blobMap.keys()]);
        return url;
    });

    const revokeAll = () => {
        for (const url of allBlobUrls) URL.revokeObjectURL(url);
    };

    return new Promise((resolve, reject) => {
        const objLoader = new OBJLoader(manager);

        if (mtlFile) {
            const mtlLoader = new MTLLoader(manager);

            // Load by original filename — URL modifier maps to blob URL.
            // This makes extractUrlBase('model.mtl') return '' so texture
            // paths resolve as bare filenames through the modifier.
            mtlLoader.load(
                mtlFile.name,
                (materials) => {
                    materials.preload();
                    objLoader.setMaterials(materials);

                    objLoader.load(
                        objFile.name,
                        (object) => {
                            // MTL loaded successfully — preserve its materials (colors, textures, etc.)
                            processMeshMaterials(object, {
                                forceDefaultMaterial: false,
                                preserveTextures: true
                            });
                            // Delay blob cleanup to ensure GPU texture upload completes
                            setTimeout(revokeAll, TIMING.BLOB_REVOKE_DELAY || 5000);
                            resolve(object);
                        },
                        undefined,
                        (error) => {
                            revokeAll();
                            reject(error);
                        }
                    );
                },
                undefined,
                () => {
                    // MTL failed to load — fall back to OBJ without materials
                    loadOBJWithoutMaterials(objLoader, objFile.name, resolve, reject, revokeAll);
                }
            );
        } else {
            loadOBJWithoutMaterials(objLoader, objFile.name, resolve, reject, revokeAll);
        }
    });
}

/**
 * Load OBJ without materials
 */
function loadOBJWithoutMaterials(
    loader: OBJLoader,
    url: string,
    resolve: (value: THREE.Group) => void,
    reject: (reason?: any) => void,
    cleanupFn?: () => void
): void {
    loader.load(
        url,
        (object) => {
            processMeshMaterials(object, { forceDefaultMaterial: true });
            if (cleanupFn) cleanupFn();
            resolve(object);
        },
        undefined,
        (error) => {
            if (cleanupFn) cleanupFn();
            reject(error);
        }
    );
}

/**
 * Parse a FileList into OBJ groups — each OBJ matched with its MTL by base name.
 * All texture images are shared across groups (MTLLoader requests only what it needs).
 */
function parseMultiPartOBJ(files: File[]): OBJGroup[] {
    const objFiles: File[] = [];
    const mtlFiles: File[] = [];
    const textureFiles: File[] = [];

    for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        if (ext === 'obj') objFiles.push(file);
        else if (ext === 'mtl') mtlFiles.push(file);
        else if (TEXTURE_EXTS.has(ext)) textureFiles.push(file);
    }

    const groups: OBJGroup[] = [];

    for (const objFile of objFiles) {
        let matchedMtl: File | null = null;
        const baseName = objFile.name.replace(/\.obj$/i, '').toLowerCase();

        // Match by base name: part1.obj → part1.mtl
        for (const mtl of mtlFiles) {
            if (mtl.name.replace(/\.mtl$/i, '').toLowerCase() === baseName) {
                matchedMtl = mtl;
                break;
            }
        }

        // Fallback: single OBJ + single MTL → pair them
        if (!matchedMtl && objFiles.length === 1 && mtlFiles.length === 1) {
            matchedMtl = mtlFiles[0];
        }

        groups.push({ objFile, mtlFile: matchedMtl, textureFiles });
    }

    return groups;
}

/**
 * Load multiple OBJ parts into a single combined THREE.Group.
 */
async function loadMultiPartOBJ(groups: OBJGroup[]): Promise<THREE.Group> {
    const combinedGroup = new THREE.Group();
    combinedGroup.name = 'multi_obj_combined';

    for (const group of groups) {
        const partGroup = await loadOBJ(group.objFile, group.mtlFile, group.textureFiles);
        partGroup.name = group.objFile.name;
        combinedGroup.add(partGroup);
    }

    log.info(`Loaded ${groups.length} OBJ parts into combined group`);
    return combinedGroup;
}

/**
 * Export a THREE.Object3D to a self-contained GLB Blob.
 * Used to convert multi-part OBJ scenes into a single archivable binary.
 */
async function exportToGLB(object: THREE.Object3D): Promise<Blob> {
    const exporter = new GLTFExporter();
    const glbBuffer = await exporter.parseAsync(object, { binary: true });
    return new Blob([glbBuffer as ArrayBuffer], { type: 'model/gltf-binary' });
}

/**
 * Load OBJ from URL
 */
export function loadOBJFromUrl(url: string, onProgress?: (loaded: number, total: number) => void): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
        const loader = new OBJLoader();
        loader.load(
            url,
            (object) => {
                processMeshMaterials(object, { forceDefaultMaterial: true, preserveTextures: true });
                resolve(object);
            },
            onProgress ? (event) => { if (event.lengthComputable) onProgress(event.loaded, event.total); } : undefined,
            (error) => reject(error)
        );
    });
}

// =============================================================================
// STL LOADING
// =============================================================================

/**
 * Load STL from a File object
 * STLLoader returns a BufferGeometry, so we wrap it in a Mesh.
 */
function loadSTL(fileOrUrl: File | string): Promise<THREE.Mesh> {
    return new Promise((resolve, reject) => {
        const loader = new STLLoader();
        const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
        loader.load(
            url,
            (geometry) => {
                if (typeof fileOrUrl !== 'string') URL.revokeObjectURL(url);
                geometry.computeVertexNormals();
                const material = new THREE.MeshStandardMaterial({
                    color: 0xaaaaaa,
                    metalness: 0.2,
                    roughness: 0.6,
                    flatShading: false,
                    side: THREE.DoubleSide
                });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.name = typeof fileOrUrl === 'string' ? 'stl_model' : fileOrUrl.name;
                resolve(mesh);
            },
            undefined,
            (error) => {
                if (typeof fileOrUrl !== 'string') URL.revokeObjectURL(url);
                reject(error);
            }
        );
    });
}

/**
 * Load STL from URL (no blob URL revocation needed)
 */
export function loadSTLFromUrl(url: string, onProgress?: (loaded: number, total: number) => void): Promise<THREE.Mesh> {
    return new Promise((resolve, reject) => {
        const loader = new STLLoader();
        loader.load(
            url,
            (geometry) => {
                geometry.computeVertexNormals();
                const material = new THREE.MeshStandardMaterial({
                    color: 0xaaaaaa,
                    metalness: 0.2,
                    roughness: 0.6,
                    flatShading: false,
                    side: THREE.DoubleSide
                });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.name = 'stl_model';
                resolve(mesh);
            },
            onProgress ? (event) => { if (event.lengthComputable) onProgress(event.loaded, event.total); } : undefined,
            (error) => reject(error)
        );
    });
}

// =============================================================================
// DRACO (.drc) LOADING
// =============================================================================

/**
 * Load a standalone Draco-compressed geometry file (.drc)
 */
export function loadDRC(source: File | string, onProgress?: (loaded: number, total: number) => void): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
        const url = source instanceof File ? URL.createObjectURL(source) : source;
        const isFile = source instanceof File;

        dracoLoader.load(
            url,
            (geometry) => {
                if (isFile) URL.revokeObjectURL(url);
                if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
                const material = new THREE.MeshStandardMaterial({
                    vertexColors: geometry.hasAttribute('color'),
                    color: geometry.hasAttribute('color') ? 0xffffff : 0xaaaaaa,
                    metalness: 0.2,
                    roughness: 0.6,
                    side: THREE.DoubleSide
                });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.name = 'drc_model';
                const group = new THREE.Group();
                group.add(mesh);
                resolve(group);
            },
            onProgress ? (event) => { if (event.lengthComputable) onProgress(event.loaded, event.total); } : undefined,
            (error) => {
                if (isFile) URL.revokeObjectURL(url);
                reject(error);
            }
        );
    });
}

// =============================================================================
// STL AS SEPARATE ASSET TYPE (with deps)
// =============================================================================

/**
 * Load STL from a file into the STL group (separate asset type)
 */
export async function loadSTLFile(files: FileList, deps: LoadSTLDeps): Promise<THREE.Mesh> {
    const { stlGroup, state, callbacks } = deps;
    const mainFile = files[0];

    // Clear existing STL
    while (stlGroup.children.length > 0) {
        const child = stlGroup.children[0];
        disposeObject(child);
        stlGroup.remove(child);
    }

    const loadedObject = await loadSTL(mainFile);

    if (loadedObject) {
        stlGroup.add(loadedObject);
        state.stlLoaded = true;

        const faceCount = computeMeshFaceCount(loadedObject);

        if (callbacks?.onSTLLoaded) {
            callbacks.onSTLLoaded(loadedObject, mainFile, faceCount);
        }
    }

    return loadedObject;
}

/**
 * Load STL from URL into the STL group (separate asset type)
 */
export async function loadSTLFromUrlWithDeps(url: string, deps: LoadSTLDeps): Promise<THREE.Mesh> {
    const { stlGroup, state, callbacks } = deps;

    log.info('Fetching STL from URL:', url);
    const blob = await fetchWithProgress(url);
    log.info('STL blob fetched, size:', blob.size);

    const blobUrl = URL.createObjectURL(blob);

    // Clear existing STL
    while (stlGroup.children.length > 0) {
        const child = stlGroup.children[0];
        disposeObject(child);
        stlGroup.remove(child);
    }

    const loadedObject = await loadSTLFromUrl(blobUrl);

    if (loadedObject) {
        stlGroup.add(loadedObject);
        state.stlLoaded = true;
        state.currentStlUrl = url;

        const faceCount = computeMeshFaceCount(loadedObject);

        if (callbacks?.onSTLLoaded) {
            callbacks.onSTLLoaded(loadedObject, blob, faceCount);
        }
    }

    URL.revokeObjectURL(blobUrl);
    return loadedObject;
}

// =============================================================================
// MODEL LOADING (with deps)
// =============================================================================

/**
 * Extensions to skip when identifying the "main" model file from a multi-file selection.
 */
const COMPANION_EXTS = new Set(['mtl', 'png', 'jpg', 'jpeg', 'tga', 'bmp', 'webp']);

/**
 * Load model from a file (supports multi-part OBJ with textures).
 */
export async function loadModelFromFile(files: FileList, deps: LoadModelDeps): Promise<THREE.Object3D | undefined> {
    const { modelGroup, state, archiveCreator, callbacks } = deps;
    const fileArray = Array.from(files);

    // Clear existing model
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        disposeObject(child);
        modelGroup.remove(child);
    }

    // Find the primary model file (skip companion MTL/texture files)
    const mainFile = fileArray.find(f => {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        return !COMPANION_EXTS.has(ext);
    }) || fileArray[0];

    const extension = mainFile.name.split('.').pop()?.toLowerCase();
    let loadedObject: THREE.Object3D | undefined;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(mainFile);
    } else if (extension === 'obj') {
        const groups = parseMultiPartOBJ(fileArray);
        if (groups.length > 1) {
            loadedObject = await loadMultiPartOBJ(groups);
        } else if (groups.length === 1) {
            loadedObject = await loadOBJ(groups[0].objFile, groups[0].mtlFile, groups[0].textureFiles);
        }
    } else if (extension === 'stl') {
        loadedObject = await loadSTL(mainFile);
    } else if (extension === 'drc') {
        loadedObject = await loadDRC(mainFile);
    }

    if (loadedObject) {
        modelGroup.add(loadedObject);
        state.modelLoaded = true;
        state.currentModelUrl = null; // Local files cannot be shared

        // For OBJ with textures or multi-part: convert to self-contained GLB for archival
        const objGroups = extension === 'obj' ? parseMultiPartOBJ(fileArray) : [];
        const isMultiPart = objGroups.length > 1;
        const hasTextures = objGroups.some(g => g.textureFiles.length > 0);

        let archiveBlob: Blob;
        let archiveFileName: string;

        if (isMultiPart || hasTextures) {
            archiveBlob = await exportToGLB(loadedObject);
            archiveFileName = mainFile.name.replace(/\.obj$/i, '_combined.glb');
            log.info(`Converted ${objGroups.length} OBJ part(s) to GLB for archival (${(archiveBlob.size / 1024 / 1024).toFixed(1)} MB)`);
        } else {
            archiveBlob = mainFile;
            archiveFileName = mainFile.name;
        }

        // Store archive-ready filename on state for export-controller
        state._meshFileName = archiveFileName;

        // Pre-compute hash in background
        if (archiveCreator) {
            archiveCreator.precomputeHash(archiveBlob).catch((e: Error) => {
                log.warn('Background hash precompute failed:', e);
            });
        }

        // Count faces
        const faceCount = computeMeshFaceCount(loadedObject);

        // Call callbacks — pass the archive blob (GLB for multi-part, original file otherwise)
        if (callbacks?.onModelLoaded) {
            callbacks.onModelLoaded(loadedObject, archiveBlob, faceCount);
        }
    }

    return loadedObject;
}

/**
 * Bundle model files into a single archive-ready blob.
 * For OBJ with companion MTL/textures, loads and converts to a self-contained GLB.
 * For GLB/GLTF, returns the file as-is.
 * Used by the display proxy picker to match the main mesh file picker behavior.
 */
export async function bundleModelFiles(files: File[]): Promise<{ blob: Blob; fileName: string }> {
    const mainFile = files.find(f => {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        return !COMPANION_EXTS.has(ext);
    }) || files[0];

    const extension = mainFile.name.split('.').pop()?.toLowerCase();

    if (extension === 'obj') {
        const groups = parseMultiPartOBJ(files);
        const hasCompanions = groups.some(g => g.mtlFile || g.textureFiles.length > 0);
        if (hasCompanions || groups.length > 1) {
            let loadedObject: THREE.Object3D;
            if (groups.length > 1) {
                loadedObject = await loadMultiPartOBJ(groups);
            } else {
                loadedObject = await loadOBJ(groups[0].objFile, groups[0].mtlFile, groups[0].textureFiles);
            }
            const glbBlob = await exportToGLB(loadedObject);
            disposeObject(loadedObject);
            return { blob: glbBlob, fileName: mainFile.name.replace(/\.obj$/i, '.glb') };
        }
    }

    return { blob: mainFile, fileName: mainFile.name };
}

/**
 * Load model from URL
 */
export async function loadModelFromUrl(url: string, deps: LoadModelDeps, onProgress: ProgressCallback = null): Promise<THREE.Object3D | undefined> {
    const { modelGroup, state, archiveCreator, callbacks } = deps;

    log.info('Fetching model from URL:', url);
    const blob = await fetchWithProgress(url, onProgress);
    log.info('Mesh blob fetched, size:', blob.size);

    // Pre-compute hash in background
    if (archiveCreator) {
        archiveCreator.precomputeHash(blob).catch((e: Error) => {
            log.warn('Background hash precompute failed:', e);
        });
    }

    // Create blob URL for loading
    const blobUrl = URL.createObjectURL(blob);

    // Clear existing model
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        disposeObject(child);
        modelGroup.remove(child);
    }

    const extension = url.split('.').pop()?.toLowerCase().split('?')[0];
    let loadedObject: THREE.Object3D | undefined;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(blobUrl);
    } else if (extension === 'obj') {
        loadedObject = await loadOBJFromUrl(blobUrl);
    } else if (extension === 'stl') {
        loadedObject = await loadSTLFromUrl(blobUrl);
    } else if (extension === 'drc') {
        loadedObject = await loadDRC(blobUrl);
    }

    // Clean up blob URL — Three.js loaders have finished reading it
    URL.revokeObjectURL(blobUrl);

    if (loadedObject) {
        modelGroup.add(loadedObject);
        state.modelLoaded = true;
        state.currentModelUrl = url;

        // Count faces and vertices
        const faceCount = computeMeshFaceCount(loadedObject);
        state.meshVertexCount = computeMeshVertexCount(loadedObject);
        state.meshTextureInfo = computeTextureInfo(loadedObject);

        // Call callbacks
        if (callbacks?.onModelLoaded) {
            callbacks.onModelLoaded(loadedObject, blob, faceCount);
        }
    }

    return loadedObject;
}

/**
 * Load model from a blob URL (used by archive loader)
 */
export async function loadModelFromBlobUrl(blobUrl: string, fileName: string, deps: Pick<LoadModelDeps, 'modelGroup' | 'state'>, onProgress?: (loaded: number, total: number) => void): Promise<ModelLoadResult> {
    const { modelGroup, state } = deps;

    // Clear existing model
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        disposeObject(child);
        modelGroup.remove(child);
    }

    const extension = fileName.split('.').pop()?.toLowerCase();
    let loadedObject: THREE.Object3D | undefined;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(blobUrl, onProgress);
    } else if (extension === 'obj') {
        loadedObject = await loadOBJFromUrl(blobUrl, onProgress);
    } else if (extension === 'stl') {
        loadedObject = await loadSTLFromUrl(blobUrl, onProgress);
    } else if (extension === 'drc') {
        loadedObject = await loadDRC(blobUrl, onProgress);
    }

    if (loadedObject) {
        modelGroup.add(loadedObject);
        state.modelLoaded = true;

        // Count faces
        const faceCount = computeMeshFaceCount(loadedObject);
        const textureInfo = computeTextureInfo(loadedObject);

        return { object: loadedObject, faceCount, textureInfo };
    }

    return { object: loadedObject!, faceCount: 0 };
}
