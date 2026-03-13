/**
 * Asset Store Module — ES module singleton for asset blob state.
 *
 * Centralizes blob/file storage that was previously scattered as `let` variables
 * in main.js. Any module can import and read/write the store directly.
 *
 * Usage:
 *   import { getStore } from './modules/asset-store.js';
 *   const assets = getStore();
 *   assets.splatBlob = file;       // write
 *   if (assets.meshBlob) { ... }   // read
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('asset-store');

// More precise type for sourceFiles entries than the simpler AssetStore interface
interface SourceFileEntry {
    file: File | null;
    name: string;
    size: number;
    category: string;
    fromArchive: boolean;
}

interface LocalAssetStore {
    splatBlob: Blob | null;
    meshBlob: Blob | null;
    proxyMeshBlob: Blob | null;
    proxySplatBlob: Blob | null;
    pointcloudBlob: Blob | null;
    cadBlob: Blob | null;
    cadFileName: string | null;
    flightPathBlobs: Array<{ blob: Blob; fileName: string; trimStart?: number; trimEnd?: number }>;
    colmapBlobs: Array<{ camerasBlob: Blob; imagesBlob: Blob; points3DBuffer?: ArrayBuffer }>;
    sourceFiles: SourceFileEntry[];
}

const store: LocalAssetStore = {
    splatBlob: null,
    meshBlob: null,
    proxyMeshBlob: null,
    proxySplatBlob: null,
    pointcloudBlob: null,
    cadBlob: null,
    cadFileName: null,
    flightPathBlobs: [],
    colmapBlobs: [],
    sourceFiles: []   // Array of { file: File|null, name: string, size: number, category: string, fromArchive: boolean }
};

/**
 * Get the asset store singleton.
 * @returns {Object} The mutable store object
 */
export function getStore(): LocalAssetStore {
    return store;
}

/**
 * Reset all blob references and source files.
 * Useful when loading a new project/archive.
 */
export function resetBlobs(): void {
    store.splatBlob = null;
    store.meshBlob = null;
    store.proxyMeshBlob = null;
    store.proxySplatBlob = null;
    store.pointcloudBlob = null;
    store.cadBlob = null;
    store.cadFileName = null;
    store.flightPathBlobs = [];
    store.colmapBlobs = [];
    store.sourceFiles = [];
    log.info('Asset store reset');
}
