/**
 * File Handlers Module — Re-export hub
 *
 * All asset loading logic has been split into focused modules under ./loaders/.
 * This file re-exports everything to preserve the existing import surface
 * for all consumers (main.ts, kiosk-main.ts, event-wiring.ts, etc.).
 */

// Splat loading
export {
    getSplatFileType, createSplatMesh,
    loadSplatFromFile, loadSplatFromUrl, loadSplatFromBlobUrl,
} from './loaders/splat-loader.js';
export type { LoadSplatDeps } from './loaders/splat-loader.js';

// Mesh / model / STL / DRC loading
export {
    loadGLTF, loadOBJFromUrl, loadSTLFromUrl, loadDRC,
    loadModelFromFile, loadModelFromUrl, loadModelFromBlobUrl,
    bundleModelFiles,
    loadSTLFile, loadSTLFromUrlWithDeps,
} from './loaders/mesh-loader.js';
export type { LoadModelDeps, LoadSTLDeps, OBJGroup, ModelLoadResult } from './loaders/mesh-loader.js';

// Drawing / DXF loading
export {
    loadDrawingFromFile, loadDrawingFromUrl, loadDrawingFromBlobUrl,
} from './loaders/drawing-loader.js';
export type { LoadDrawingDeps } from './loaders/drawing-loader.js';

// Point cloud loading
export {
    loadPointcloudFromFile, loadPointcloudFromUrl, loadPointcloudFromBlobUrl,
    updatePointcloudPointSize, updatePointcloudOpacity,
} from './loaders/pointcloud-loader.js';
export type { LoadPointcloudDeps, PointcloudLoadResult } from './loaders/pointcloud-loader.js';

// Mesh material / visual updates
export {
    updateModelOpacity, updateModelWireframe, updateModelTextures,
    updateModelMatcap, updateModelNormals,
    updateModelRoughness, updateModelMetalness, updateModelSpecularF0,
} from './loaders/mesh-material-updates.js';

// Archive processing + quality tier swap
export {
    loadArchiveFromFile, loadArchiveFromUrl,
    processArchive, processArchivePhase1, loadArchiveAsset,
    loadArchiveFullResMesh, loadArchiveFullResSplat,
    loadArchiveProxyMesh, loadArchiveProxySplat,
    getAssetTypesForMode, getPrimaryAssetType,
} from './loaders/archive-asset-loader.js';
export type {
    LoadArchiveAssetDeps, LoadFullResDeps,
    ProcessArchiveResult, Phase1Result, AssetLoadResult,
} from './loaders/archive-asset-loader.js';
