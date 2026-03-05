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

const log = Logger.getLogger('mesh-decimator');

// ===== WASM Initialization =====

let _wasmReady = false;

async function ensureWasm(): Promise<void> {
    if (_wasmReady) return;
    await MeshoptSimplifier.ready;
    _wasmReady = true;
    log.info('meshoptimizer WASM ready');
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

    // Ensure indexed geometry — meshoptimizer requires an index buffer.
    // mergeVertices() deduplicates positions and creates an index.
    let geo = geometry;
    if (!geo.index) {
        log.warn('Non-indexed geometry — merging vertices to create index');
        geo = mergeVertices(geo);
    }

    const posAttr = geo.attributes.position;
    const indexAttr = geo.index!;
    const vertexCount = posAttr.count;
    const originalFaceCount = indexAttr.count / 3;

    onProgress?.('Preparing buffers', 10);

    // Extract position data
    const positions = new Float32Array(posAttr.array);
    const stride = posAttr instanceof THREE.InterleavedBufferAttribute
        ? posAttr.data.stride : 3;
    const indices = new Uint32Array(indexAttr.array);

    const targetIndexCount = computeTargetIndexCount(originalFaceCount, options);

    log.info(`Decimation input: ${vertexCount} verts, ${originalFaceCount} faces, stride=${stride}, indexed=${!!geometry.index}`);
    log.info(`Decimation target: ${targetIndexCount / 3} faces (ratio=${options.targetRatio}, errorThreshold=${options.errorThreshold}, lockBorder=${options.lockBorder})`);

    onProgress?.('Simplifying', 30);

    // Build flags
    const flags: string[] = [];
    if (options.lockBorder) flags.push('LockBorder');

    // Scan/photogrammetry GLBs typically have split vertices — adjacent
    // triangles don't share vertex indices because normals and UVs differ
    // per face. meshoptimizer can't find shared edges without position
    // deduplication. Use generatePositionRemap to build a topology where
    // coincident positions share an index, run simplify on that, then map
    // the result back to original vertex indices.
    const posRemap = MeshoptSimplifier.generatePositionRemap(positions, stride);
    const maxRemapIdx = posRemap.reduce((a: number, b: number) => Math.max(a, b), 0);
    const dedupPositions = new Float32Array((maxRemapIdx + 1) * stride);
    for (let i = 0; i < posRemap.length; i++) {
        const ri = posRemap[i];
        for (let c = 0; c < stride; c++) {
            dedupPositions[ri * stride + c] = positions[i * stride + c];
        }
    }
    const dedupIndices = new Uint32Array(indices.length);
    for (let i = 0; i < indices.length; i++) dedupIndices[i] = posRemap[indices[i]];

    log.info(`Position dedup: ${vertexCount} → ${maxRemapIdx + 1} unique positions`);

    const result = MeshoptSimplifier.simplify(
        dedupIndices, dedupPositions, stride,
        targetIndexCount,
        options.errorThreshold,
        flags,
    );

    const [simplifiedDedupIndices, error] = result;
    const newFaceCount = simplifiedDedupIndices.length / 3;
    log.info(`Decimation: ${originalFaceCount} → ${newFaceCount} faces (error: ${error.toFixed(6)})`);

    onProgress?.('Rebuilding geometry', 80);

    // --- Triangle-context-aware vertex selection ---
    // The dedup→simplify process works in dedup-index space. To rebuild the
    // output geometry with correct UVs (and other per-vertex attributes), we
    // must pick the RIGHT original vertex for each corner of each output
    // triangle. A naive global mapping (one original vertex per dedup index)
    // causes texture distortion at UV seams because different original
    // vertices at the same position have different UVs.
    //
    // Strategy: for each output triangle, find original triangles that share
    // the most dedup vertices with it and pick original vertices from those.

    const origTriCount = indices.length / 3;

    // Build inverse map: dedup vertex → list of original triangles touching it
    const dedupVertToOrigTris: number[][] = Array.from(
        { length: maxRemapIdx + 1 }, () => [],
    );
    for (let t = 0; t < origTriCount; t++) {
        for (let c = 0; c < 3; c++) {
            const origVert = indices[t * 3 + c];
            const dedupVert = posRemap[origVert];
            dedupVertToOrigTris[dedupVert].push(t);
        }
    }

    const numOutputTris = simplifiedDedupIndices.length / 3;
    const numOutputVerts = numOutputTris * 3;

    // Build per-face output geometry (3 unique verts per triangle).
    // For each corner, find the best-matching original vertex.
    const newGeo = new THREE.BufferGeometry();

    // Allocate output attribute buffers
    const attrNames = Object.keys(geo.attributes);
    const outBuffers: Record<string, { data: Float32Array; itemSize: number; normalized: boolean }> = {};
    for (const name of attrNames) {
        const srcAttr = geo.attributes[name];
        const TypedArrayCtor = (srcAttr.array as Float32Array).constructor as new (n: number) => Float32Array;
        outBuffers[name] = {
            data: new TypedArrayCtor(numOutputVerts * srcAttr.itemSize),
            itemSize: srcAttr.itemSize,
            normalized: srcAttr.normalized,
        };
    }

    // For each output triangle, find best original vertices
    for (let t = 0; t < numOutputTris; t++) {
        const d0 = simplifiedDedupIndices[t * 3];
        const d1 = simplifiedDedupIndices[t * 3 + 1];
        const d2 = simplifiedDedupIndices[t * 3 + 2];

        for (let c = 0; c < 3; c++) {
            const di = simplifiedDedupIndices[t * 3 + c];
            const outIdx = t * 3 + c;
            const origTris = dedupVertToOrigTris[di];

            // Find the original triangle that overlaps most with this output triangle.
            // "Overlap" = how many of its dedup vertices match {d0, d1, d2}.
            let bestOrigVert = -1;
            let bestOverlap = 0;

            for (let ti = 0; ti < origTris.length; ti++) {
                const ot = origTris[ti];
                let overlap = 0;
                let origVertAtDi = -1;
                for (let cc = 0; cc < 3; cc++) {
                    const ov = indices[ot * 3 + cc];
                    const dv = posRemap[ov];
                    if (dv === di) origVertAtDi = ov;
                    if (dv === d0 || dv === d1 || dv === d2) overlap++;
                }
                if (overlap > bestOverlap && origVertAtDi >= 0) {
                    bestOverlap = overlap;
                    bestOrigVert = origVertAtDi;
                    if (overlap === 3) break; // perfect match, stop early
                }
            }

            // Fallback: pick any original vertex at this dedup position
            if (bestOrigVert < 0) {
                for (let ti = 0; ti < origTris.length && bestOrigVert < 0; ti++) {
                    const ot = origTris[ti];
                    for (let cc = 0; cc < 3; cc++) {
                        const ov = indices[ot * 3 + cc];
                        if (posRemap[ov] === di) { bestOrigVert = ov; break; }
                    }
                }
            }

            // Copy all attributes from the chosen original vertex
            for (const name of attrNames) {
                const src = geo.attributes[name];
                const dst = outBuffers[name];
                const is = dst.itemSize;
                for (let a = 0; a < is; a++) {
                    dst.data[outIdx * is + a] = src.array[bestOrigVert * is + a];
                }
            }
        }
    }

    // Set attributes on the new geometry
    for (const name of attrNames) {
        const buf = outBuffers[name];
        newGeo.setAttribute(name, new THREE.BufferAttribute(buf.data, buf.itemSize, buf.normalized));
    }

    // Build a trivial index (0, 1, 2, 3, 4, 5, ...)
    const seqIndices = new Uint32Array(numOutputVerts);
    for (let i = 0; i < numOutputVerts; i++) seqIndices[i] = i;
    newGeo.setIndex(new THREE.BufferAttribute(seqIndices, 1));

    // Merge identical vertices to reduce size (respects UV seams — only
    // merges vertices whose positions AND UVs match exactly).
    const mergedGeo = mergeVertices(newGeo);
    newGeo.dispose();

    const finalVertCount = mergedGeo.attributes.position.count;
    log.info(`Rebuilt: ${numOutputVerts} per-face verts → ${finalVertCount} merged verts`);

    // Recompute normals from the simplified topology
    mergedGeo.computeVertexNormals();

    onProgress?.('Complete', 100);
    return mergedGeo;
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

    // Deep clone the group so we don't mutate the original
    const cloned = group.clone(true);

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
export async function exportAsGLB(group: THREE.Group): Promise<Blob> {
    const exporter = new GLTFExporter();
    const buffer = await exporter.parseAsync(group, { binary: true }) as ArrayBuffer;
    return new Blob([buffer], { type: 'model/gltf-binary' });
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
    const blob = await exportAsGLB(decimatedGroup);

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
