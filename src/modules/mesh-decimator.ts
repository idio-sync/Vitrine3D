/**
 * Mesh Decimator Module
 *
 * Decimates Three.js meshes using meshoptimizer WASM and downscales textures
 * via canvas. Produces a lightweight GLB blob for use as an SD proxy in archives.
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Logger } from './utilities.js';
import { DECIMATION_PRESETS, DEFAULT_DECIMATION_PRESET } from './constants.js';
import type { DecimationOptions, DecimationResult } from '@/types.js';
import type { DecimationPreset } from './constants.js';
import { WebIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const log = Logger.getLogger('mesh-decimator');

// ===== WASM Initialization =====

let _wasmReady = false;

async function ensureWasm(): Promise<void> {
    if (_wasmReady) return;
    await MeshoptSimplifier.ready;
    _wasmReady = true;
    log.info('meshoptimizer WASM ready');
}

// ===== Draco Compression (gltf-transform) =====

let _dracoIO: WebIO | null = null;

async function ensureDracoIO(): Promise<WebIO> {
    if (_dracoIO) return _dracoIO;
    const wasmOpts = { locateFile: (file: string) => `/draco/${file}` };
    const io = new WebIO()
        .registerExtensions([KHRDracoMeshCompression])
        .registerDependencies({
            'draco3d.encoder': await draco3d.createEncoderModule(wasmOpts),
            'draco3d.decoder': await draco3d.createDecoderModule(wasmOpts),
        });
    _dracoIO = io;
    log.info('gltf-transform Draco IO ready');
    return io;
}

// ===== Resolve Options =====

/**
 * Merge a preset with optional user overrides into a full DecimationOptions.
 */
export function resolveOptions(opts?: Partial<DecimationOptions>): DecimationOptions {
    const presetKey = opts?.preset || DEFAULT_DECIMATION_PRESET;
    const preset: DecimationPreset = DECIMATION_PRESETS[presetKey] || DECIMATION_PRESETS[DEFAULT_DECIMATION_PRESET];
    return {
        preset: presetKey,
        targetRatio: opts?.targetRatio ?? preset.targetRatio,
        targetFaceCount: opts?.targetFaceCount ?? null,
        errorThreshold: opts?.errorThreshold ?? preset.errorThreshold,
        lockBorder: opts?.lockBorder ?? preset.lockBorder,
        preserveUVSeams: opts?.preserveUVSeams ?? preset.preserveUVSeams,
        textureMaxRes: opts?.textureMaxRes ?? preset.textureMaxRes,
        textureFormat: opts?.textureFormat ?? preset.textureFormat,
        textureQuality: opts?.textureQuality ?? preset.textureQuality,
        dracoCompress: opts?.dracoCompress ?? true,
    };
}

// ===== Geometry Decimation =====

/**
 * Compute the target index count from options and original face count.
 * Uses min(ratio * original, maxFaces) logic, respecting explicit targetFaceCount override.
 */
function computeTargetIndexCount(originalFaceCount: number, options: DecimationOptions): number {
    const preset = DECIMATION_PRESETS[options.preset] || DECIMATION_PRESETS[DEFAULT_DECIMATION_PRESET];

    let targetFaces: number;
    if (options.targetFaceCount != null && options.targetFaceCount > 0) {
        targetFaces = options.targetFaceCount;
    } else {
        const ratioFaces = Math.floor(originalFaceCount * options.targetRatio);
        targetFaces = Math.min(ratioFaces, preset.maxFaces);
    }
    // Ensure at least 4 faces (degenerate floor)
    targetFaces = Math.max(targetFaces, 4);
    // Convert faces to index count (3 indices per triangle)
    return targetFaces * 3;
}

/**
 * Decimates a single BufferGeometry using meshoptimizer.
 * Returns a new BufferGeometry with reduced face count.
 */
export async function decimateGeometry(
    geometry: THREE.BufferGeometry,
    options: DecimationOptions,
    onProgress?: (stage: string, pct: number) => void,
): Promise<THREE.BufferGeometry> {
    await ensureWasm();

    // Scan/photogrammetry GLBs have split vertices — every triangle has its
    // own 3 vertices with per-face normals. This prevents meshoptimizer from
    // finding shared edges. Solution: strip normals, then mergeVertices()
    // creates shared edges by merging vertices with identical position+UV.
    // UV seams are preserved (different UVs = different vertices). After
    // simplification, normals are recomputed from the new topology.
    const prepared = geometry.clone();
    prepared.deleteAttribute('normal');
    const geo = mergeVertices(prepared);
    prepared.dispose();

    const posAttr = geo.attributes.position;
    const indexAttr = geo.index!;
    const vertexCount = posAttr.count;
    const originalFaceCount = indexAttr.count / 3;

    onProgress?.('Preparing buffers', 10);

    const positions = new Float32Array(posAttr.array);
    const stride = 3;
    const indices = new Uint32Array(indexAttr.array);

    const targetIndexCount = computeTargetIndexCount(originalFaceCount, options);

    log.info(`Decimation input: ${geometry.attributes.position.count} original verts → ${vertexCount} merged verts, ${originalFaceCount} faces`);
    log.info(`Decimation target: ${targetIndexCount / 3} faces (ratio=${options.targetRatio}, errorThreshold=${options.errorThreshold}, lockBorder=${options.lockBorder})`);

    onProgress?.('Simplifying', 30);

    const flags: string[] = [];
    if (options.lockBorder) flags.push('LockBorder');

    const [simplifiedIndices, error] = MeshoptSimplifier.simplify(
        indices, positions, stride,
        targetIndexCount,
        options.errorThreshold,
        flags,
    );

    const newFaceCount = simplifiedIndices.length / 3;
    log.info(`Decimation: ${originalFaceCount} → ${newFaceCount} faces (error: ${error.toFixed(6)})`);

    onProgress?.('Rebuilding geometry', 80);

    // Compact: build new geometry with only the referenced vertices
    const usedSet = new Set<number>();
    for (let i = 0; i < simplifiedIndices.length; i++) usedSet.add(simplifiedIndices[i]);
    const usedVerts = Array.from(usedSet).sort((a, b) => a - b);
    const compactMap = new Map<number, number>();
    for (let i = 0; i < usedVerts.length; i++) compactMap.set(usedVerts[i], i);

    const newGeo = new THREE.BufferGeometry();

    // Remap indices
    const compactIndices = new Uint32Array(simplifiedIndices.length);
    for (let i = 0; i < simplifiedIndices.length; i++) {
        compactIndices[i] = compactMap.get(simplifiedIndices[i])!;
    }
    newGeo.setIndex(new THREE.BufferAttribute(compactIndices, 1));

    // Copy and compact each attribute from the merged geometry
    for (const name of Object.keys(geo.attributes)) {
        const src = geo.attributes[name];
        const itemSize = src.itemSize;
        const TypedCtor = (src.array as Float32Array).constructor as new (n: number) => Float32Array;
        const dst = new TypedCtor(usedVerts.length * itemSize);
        for (let i = 0; i < usedVerts.length; i++) {
            const si = usedVerts[i];
            for (let c = 0; c < itemSize; c++) {
                dst[i * itemSize + c] = src.array[si * itemSize + c];
            }
        }
        newGeo.setAttribute(name, new THREE.BufferAttribute(dst, itemSize, src.normalized));
    }

    log.info(`Compacted: ${vertexCount} → ${usedVerts.length} vertices`);

    // Recompute normals from the simplified topology
    newGeo.computeVertexNormals();

    onProgress?.('Complete', 100);
    return newGeo;
}

// ===== Texture Downscaling =====

/**
 * Downscale a Three.js Texture to the target resolution using a canvas.
 * Returns a new Texture with the downscaled image, or the original if already small enough.
 */
function downscaleTexture(
    texture: THREE.Texture,
    maxRes: number,
    _format: 'jpeg' | 'png' | 'keep',
    _quality: number,
): THREE.Texture {
    const image = texture.image;
    if (!image) return texture;

    const w = image.width || image.naturalWidth;
    const h = image.height || image.naturalHeight;
    if (!w || !h) return texture;

    // Already within budget
    if (w <= maxRes && h <= maxRes) return texture;

    // Compute target dimensions (preserve aspect ratio)
    const scale = maxRes / Math.max(w, h);
    const tw = Math.round(w * scale);
    const th = Math.round(h * scale);

    // Draw to canvas
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0, tw, th);

    log.info(`Texture downscaled: ${w}x${h} → ${tw}x${th}`);

    // Create new texture from canvas
    const newTex = new THREE.CanvasTexture(canvas);
    // Copy UV transform settings
    newTex.wrapS = texture.wrapS;
    newTex.wrapT = texture.wrapT;
    newTex.repeat.copy(texture.repeat);
    newTex.offset.copy(texture.offset);
    newTex.rotation = texture.rotation;
    newTex.center.copy(texture.center);
    newTex.flipY = texture.flipY;
    newTex.colorSpace = texture.colorSpace;

    return newTex;
}

/** Material texture map property names to process */
const TEXTURE_MAP_KEYS = [
    'map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap',
    'emissiveMap', 'bumpMap', 'displacementMap', 'alphaMap',
] as const;

/**
 * Downscale all textures on a material.
 */
function downscaleMaterialTextures(
    material: THREE.Material,
    maxRes: number,
    format: 'jpeg' | 'png' | 'keep',
    quality: number,
): void {
    const mat = material as any;
    for (const key of TEXTURE_MAP_KEYS) {
        if (mat[key] && mat[key] instanceof THREE.Texture) {
            mat[key] = downscaleTexture(mat[key], maxRes, format, quality);
        }
    }
}

// ===== Scene-Level Decimation =====

/**
 * Decimate all meshes in a THREE.Group and downscale textures.
 * Returns a new cloned group with decimated meshes.
 */
export async function decimateScene(
    group: THREE.Group,
    options: DecimationOptions,
    onProgress?: (stage: string, pct: number) => void,
): Promise<{ group: THREE.Group; totalOriginalFaces: number; totalNewFaces: number }> {
    await ensureWasm();

    // Collect all meshes
    const meshes: THREE.Mesh[] = [];
    group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
            meshes.push(child as THREE.Mesh);
        }
    });

    if (meshes.length === 0) {
        throw new Error('No meshes found in group');
    }

    log.info(`Decimating ${meshes.length} mesh(es)`);

    // Deep clone the group so we don't mutate the original.
    // Reset transforms on the clone so the exported GLB contains local-space
    // geometry only — the manifest stores transforms separately and applies
    // them on load.  Without this, transforms get baked into the GLB *and*
    // re-applied from the manifest, causing double-rotation/offset.
    const cloned = group.clone(true);
    cloned.position.set(0, 0, 0);
    cloned.rotation.set(0, 0, 0);
    cloned.scale.set(1, 1, 1);

    // Collect cloned meshes in the same order
    const clonedMeshes: THREE.Mesh[] = [];
    cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
            clonedMeshes.push(child as THREE.Mesh);
        }
    });

    let totalOriginalFaces = 0;
    let totalNewFaces = 0;

    for (let i = 0; i < clonedMeshes.length; i++) {
        const mesh = clonedMeshes[i];
        const geo = mesh.geometry;
        const faceCount = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
        totalOriginalFaces += faceCount;

        onProgress?.(`Decimating mesh ${i + 1}/${clonedMeshes.length}`, (i / clonedMeshes.length) * 80);

        const newGeo = await decimateGeometry(geo, options);
        const newFaces = newGeo.index ? newGeo.index.count / 3 : newGeo.attributes.position.count / 3;
        totalNewFaces += newFaces;

        mesh.geometry.dispose();
        mesh.geometry = newGeo;

        // Downscale textures on this mesh's materials
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
            downscaleMaterialTextures(mat, options.textureMaxRes, options.textureFormat, options.textureQuality);
        }
    }

    onProgress?.('Complete', 100);
    log.info(`Scene decimation complete: ${totalOriginalFaces} → ${totalNewFaces} faces`);

    return { group: cloned, totalOriginalFaces, totalNewFaces };
}

// ===== GLB Export =====

/**
 * Export a THREE.Group as a GLB Blob.
 */
export async function exportAsGLB(group: THREE.Group, dracoCompress = true): Promise<Blob> {
    const exporter = new GLTFExporter();
    const buffer = await exporter.parseAsync(group, { binary: true }) as ArrayBuffer;

    if (!dracoCompress) {
        return new Blob([buffer], { type: 'model/gltf-binary' });
    }

    const io = await ensureDracoIO();
    const doc = await io.readBinary(new Uint8Array(buffer));
    await doc.transform(draco({ method: 'edgebreaker' }));
    const compressed = await io.writeBinary(doc);

    log.info(`Draco compression: ${(buffer.byteLength / 1024).toFixed(0)} KB → ${(compressed.byteLength / 1024).toFixed(0)} KB`);

    return new Blob([compressed], { type: 'model/gltf-binary' });
}

// ===== High-Level Pipeline =====

/**
 * Full decimation pipeline: decimate scene → export as GLB.
 * This is the main entry point called by the UI.
 */
export async function generateProxy(
    group: THREE.Group,
    userOptions?: Partial<DecimationOptions>,
    onProgress?: (stage: string, pct: number) => void,
): Promise<DecimationResult> {
    const options = resolveOptions(userOptions);
    log.info('Generating SD proxy with options:', options);

    onProgress?.('Starting decimation', 0);

    const { group: decimatedGroup, totalOriginalFaces, totalNewFaces } =
        await decimateScene(group, options, (stage, pct) => {
            onProgress?.(stage, pct * 0.8); // 0-80% for decimation
        });

    onProgress?.('Exporting GLB', 85);
    const blob = await exportAsGLB(decimatedGroup, options.dracoCompress);

    onProgress?.('Done', 100);
    log.info(`Proxy GLB size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

    // Count vertices in result
    let vertexCount = 0;
    decimatedGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
            vertexCount += (child as THREE.Mesh).geometry.attributes.position.count;
        }
    });

    return {
        faceCount: totalNewFaces,
        vertexCount,
        originalFaceCount: totalOriginalFaces,
        blob,
        preset: options.preset,
        options,
    };
}

/**
 * Estimate the resulting face count without running actual decimation.
 * Uses the same target logic as the real pipeline.
 */
export function estimateFaceCount(originalFaceCount: number, opts?: Partial<DecimationOptions>): number {
    const options = resolveOptions(opts);
    const targetIndexCount = computeTargetIndexCount(originalFaceCount, options);
    return targetIndexCount / 3;
}
