/**
 * ICP Alignment Engine
 *
 * Coarse rotation search + iterative closest point refinement
 * for aligning colmap points3D to splat point clouds.
 */

import * as THREE from 'three';
import { computeSimilarityTransform } from './colmap-alignment.js';
import { Logger } from './utilities.js';

const log = Logger.getLogger('icp-alignment');

/**
 * Spatial hash grid for O(1) average nearest-neighbor lookup.
 * Points stored as flat Float64Array (xyz interleaved).
 */
export class SpatialHash {
    private cells = new Map<string, number[]>();
    private points: Float64Array;
    private count: number;
    private cellSize: number;

    constructor(points: Float64Array, count: number, cellSize: number) {
        this.points = points;
        this.count = count;
        this.cellSize = cellSize;
        this.build();
    }

    private key(cx: number, cy: number, cz: number): string {
        return `${cx},${cy},${cz}`;
    }

    private cellCoord(v: number): number {
        return Math.floor(v / this.cellSize);
    }

    private build(): void {
        for (let i = 0; i < this.count; i++) {
            const x = this.points[i * 3];
            const y = this.points[i * 3 + 1];
            const z = this.points[i * 3 + 2];
            const k = this.key(this.cellCoord(x), this.cellCoord(y), this.cellCoord(z));
            let cell = this.cells.get(k);
            if (!cell) { cell = []; this.cells.set(k, cell); }
            cell.push(i);
        }
    }

    /** Find nearest point. Returns [index, distanceSquared]. */
    findNearest(qx: number, qy: number, qz: number): [number, number] {
        const cx = this.cellCoord(qx);
        const cy = this.cellCoord(qy);
        const cz = this.cellCoord(qz);

        let bestIdx = 0;
        let bestDistSq = Infinity;

        // Search 3×3×3 neighborhood
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const cell = this.cells.get(this.key(cx + dx, cy + dy, cz + dz));
                    if (!cell) continue;
                    for (const idx of cell) {
                        const px = this.points[idx * 3] - qx;
                        const py = this.points[idx * 3 + 1] - qy;
                        const pz = this.points[idx * 3 + 2] - qz;
                        const d = px * px + py * py + pz * pz;
                        if (d < bestDistSq) { bestDistSq = d; bestIdx = idx; }
                    }
                }
            }
        }

        // Brute force fallback (rare, only if cellSize too small)
        if (bestDistSq === Infinity) {
            for (let i = 0; i < this.count; i++) {
                const px = this.points[i * 3] - qx;
                const py = this.points[i * 3 + 1] - qy;
                const pz = this.points[i * 3 + 2] - qz;
                const d = px * px + py * py + pz * pz;
                if (d < bestDistSq) { bestDistSq = d; bestIdx = i; }
            }
        }

        return [bestIdx, bestDistSq];
    }
}

/**
 * Generate 24 rotation candidates covering all principal axis orientations.
 */
export function generateRotationCandidates(): THREE.Quaternion[] {
    const candidates: THREE.Quaternion[] = [];
    const angles = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];

    for (const ax of angles) {
        for (const ay of angles) {
            for (const az of angles) {
                const q = new THREE.Quaternion()
                    .setFromEuler(new THREE.Euler(ax, ay, az, 'XYZ'));
                const isDuplicate = candidates.some(c =>
                    Math.abs(c.dot(q)) > 0.999
                );
                if (!isDuplicate) candidates.push(q);
            }
        }
    }
    return candidates;
}

/** Compute centroid of flat xyz array. */
function computeCentroidFlat(points: Float64Array, count: number): THREE.Vector3 {
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < count; i++) {
        sx += points[i * 3];
        sy += points[i * 3 + 1];
        sz += points[i * 3 + 2];
    }
    return new THREE.Vector3(sx / count, sy / count, sz / count);
}

/** Subsample a flat xyz array to at most maxCount points. */
function subsample(points: Float64Array, count: number, maxCount: number): { points: Float64Array; count: number } {
    if (count <= maxCount) return { points, count };
    const stride = Math.ceil(count / maxCount);
    const outCount = Math.ceil(count / stride);
    const out = new Float64Array(outCount * 3);
    let outIdx = 0;
    for (let i = 0; i < count; i += stride) {
        out[outIdx++] = points[i * 3];
        out[outIdx++] = points[i * 3 + 1];
        out[outIdx++] = points[i * 3 + 2];
    }
    return { points: out, count: outIdx / 3 };
}

/**
 * Find the best coarse rotation from 24 principal axis candidates.
 */
export function findBestCoarseRotation(
    source: Float64Array, sourceCount: number,
    target: Float64Array, targetCount: number,
    maxSamplePoints = 2000
): THREE.Quaternion {
    const candidates = generateRotationCandidates();
    const srcSub = subsample(source, sourceCount, maxSamplePoints);
    const tgtSub = subsample(target, targetCount, maxSamplePoints);
    const tgtCentroid = computeCentroidFlat(tgtSub.points, tgtSub.count);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < tgtSub.count; i++) {
        const x = tgtSub.points[i * 3], y = tgtSub.points[i * 3 + 1], z = tgtSub.points[i * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.001);
    const cellSize = extent / 20;
    const targetHash = new SpatialHash(tgtSub.points, tgtSub.count, cellSize);

    let bestScore = Infinity;
    let bestQ = candidates[0];

    for (const q of candidates) {
        const rotated = new Float64Array(srcSub.count * 3);
        let rsx = 0, rsy = 0, rsz = 0;
        for (let i = 0; i < srcSub.count; i++) {
            const v = new THREE.Vector3(
                srcSub.points[i * 3], srcSub.points[i * 3 + 1], srcSub.points[i * 3 + 2]
            ).applyQuaternion(q);
            rotated[i * 3] = v.x; rotated[i * 3 + 1] = v.y; rotated[i * 3 + 2] = v.z;
            rsx += v.x; rsy += v.y; rsz += v.z;
        }
        const rCentroid = new THREE.Vector3(rsx / srcSub.count, rsy / srcSub.count, rsz / srcSub.count);
        const offset = tgtCentroid.clone().sub(rCentroid);

        let score = 0;
        for (let i = 0; i < srcSub.count; i++) {
            const qx = rotated[i * 3] + offset.x;
            const qy = rotated[i * 3 + 1] + offset.y;
            const qz = rotated[i * 3 + 2] + offset.z;
            const [, distSq] = targetHash.findNearest(qx, qy, qz);
            score += distSq;
        }

        if (score < bestScore) {
            bestScore = score;
            bestQ = q;
        }
    }

    log.info(`Coarse rotation search: best score ${bestScore.toFixed(2)} from ${candidates.length} candidates`);
    return bestQ;
}

export interface ICPResult {
    rotation: THREE.Quaternion;
    scale: number;
    translation: THREE.Vector3;
    rmse: number;
    matchCount: number;
    converged: boolean;
}

export interface ICPOptions {
    maxIterations?: number;
    convergenceThreshold?: number;
    /** Skip the 24-candidate coarse rotation search.  Use when source points
     *  are already approximately aligned with target (e.g. pre-transformed by
     *  the colmapGroup matrix). */
    skipCoarseSearch?: boolean;
}

/**
 * Run ICP: coarse rotation search → iterative refinement.
 * Source points are transformed to match target points.
 */
export function runICP(
    source: Float64Array, sourceCount: number,
    target: Float64Array, targetCount: number,
    options?: ICPOptions
): ICPResult | null {
    const maxIterations = options?.maxIterations ?? 30;
    const convergenceThreshold = options?.convergenceThreshold ?? 1e-6;

    if (sourceCount < 3 || targetCount < 3) return null;

    const currentSource = new Float64Array(sourceCount * 3);

    if (options?.skipCoarseSearch) {
        // Source is already approximately aligned — copy as-is
        log.info('Skipping coarse rotation search (pre-aligned source)');
        currentSource.set(source);
    } else {
        // Coarse rotation search over 24 principal-axis candidates
        const coarseQ = findBestCoarseRotation(source, sourceCount, target, targetCount);
        for (let i = 0; i < sourceCount; i++) {
            const v = new THREE.Vector3(source[i * 3], source[i * 3 + 1], source[i * 3 + 2])
                .applyQuaternion(coarseQ);
            currentSource[i * 3] = v.x;
            currentSource[i * 3 + 1] = v.y;
            currentSource[i * 3 + 2] = v.z;
        }
    }

    // Centroid-align
    const srcCentroid = computeCentroidFlat(currentSource, sourceCount);
    const tgtCentroid = computeCentroidFlat(target, targetCount);
    const initOffset = tgtCentroid.clone().sub(srcCentroid);
    for (let i = 0; i < sourceCount; i++) {
        currentSource[i * 3] += initOffset.x;
        currentSource[i * 3 + 1] += initOffset.y;
        currentSource[i * 3 + 2] += initOffset.z;
    }

    // Target spatial hash
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < targetCount; i++) {
        const x = target[i * 3], y = target[i * 3 + 1], z = target[i * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.001);
    const cellSize = extent / 30;
    const targetHash = new SpatialHash(target, targetCount, cellSize);

    let prevRmse = Infinity;

    for (let iter = 0; iter < maxIterations; iter++) {
        const pairs: { srcIdx: number; tgtDist: number; srcPt: [number, number, number]; tgtPt: [number, number, number] }[] = [];
        for (let i = 0; i < sourceCount; i++) {
            const sx = currentSource[i * 3], sy = currentSource[i * 3 + 1], sz = currentSource[i * 3 + 2];
            const [tgtIdx, distSq] = targetHash.findNearest(sx, sy, sz);
            pairs.push({
                srcIdx: i, tgtDist: distSq,
                srcPt: [sx, sy, sz],
                tgtPt: [target[tgtIdx * 3], target[tgtIdx * 3 + 1], target[tgtIdx * 3 + 2]],
            });
        }

        pairs.sort((a, b) => a.tgtDist - b.tgtDist);
        const medianDist = pairs[Math.floor(pairs.length / 2)].tgtDist;
        const threshold = medianDist * 9;
        const inliers = pairs.filter(p => p.tgtDist <= threshold);

        if (inliers.length < 3) {
            log.warn(`ICP iter ${iter}: only ${inliers.length} inliers, stopping`);
            break;
        }

        const srcPts = inliers.map(p => p.srcPt);
        const tgtPts = inliers.map(p => p.tgtPt);
        const stepResult = computeSimilarityTransform(srcPts, tgtPts, true);
        if (!stepResult) break;

        for (let i = 0; i < sourceCount; i++) {
            const v = new THREE.Vector3(currentSource[i * 3], currentSource[i * 3 + 1], currentSource[i * 3 + 2])
                .applyQuaternion(stepResult.rotation)
                .add(stepResult.translation);
            currentSource[i * 3] = v.x;
            currentSource[i * 3 + 1] = v.y;
            currentSource[i * 3 + 2] = v.z;
        }

        const rmseDelta = Math.abs(prevRmse - stepResult.rmse);
        prevRmse = stepResult.rmse;

        log.debug(`ICP iter ${iter}: RMSE=${stepResult.rmse.toFixed(6)}, inliers=${inliers.length}`);

        if (rmseDelta < convergenceThreshold) {
            log.info(`ICP converged at iteration ${iter}`);
            break;
        }
    }

    // Derive final transform from original source → converged positions
    const finalPairs: { src: [number, number, number]; tgt: [number, number, number] }[] = [];
    const finalDists: number[] = [];
    for (let i = 0; i < sourceCount; i++) {
        const cx = currentSource[i * 3], cy = currentSource[i * 3 + 1], cz = currentSource[i * 3 + 2];
        const [tgtIdx, distSq] = targetHash.findNearest(cx, cy, cz);
        finalPairs.push({
            src: [source[i * 3], source[i * 3 + 1], source[i * 3 + 2]],
            tgt: [target[tgtIdx * 3], target[tgtIdx * 3 + 1], target[tgtIdx * 3 + 2]],
        });
        finalDists.push(distSq);
    }

    const sortedDists = [...finalDists].sort((a, b) => a - b);
    const finalMedian = sortedDists[Math.floor(sortedDists.length / 2)];
    const finalThreshold = finalMedian * 9;
    const finalInliers = finalPairs.filter((_, i) => finalDists[i] <= finalThreshold);

    if (finalInliers.length < 3) {
        log.warn('ICP: insufficient final inliers for transform derivation');
        return null;
    }

    const finalResult = computeSimilarityTransform(
        finalInliers.map(p => p.src),
        finalInliers.map(p => p.tgt)
    );
    if (!finalResult) return null;

    log.info(`ICP final: RMSE=${finalResult.rmse.toFixed(6)}, ${finalInliers.length} inliers, scale=${finalResult.scale.toFixed(4)}`);
    return {
        rotation: finalResult.rotation,
        scale: finalResult.scale,
        translation: finalResult.translation,
        rmse: finalResult.rmse,
        matchCount: finalInliers.length,
        converged: prevRmse !== Infinity,
    };
}

/**
 * Sample world-space positions from a SplatMesh.
 * Applies matrixWorld (accounts for Math.PI X-rotation on load).
 */
export function sampleSplatPoints(
    splatMesh: THREE.Object3D,
    maxCount = 20000
): { points: Float64Array; count: number } | null {
    splatMesh.updateMatrixWorld(true);
    const worldMatrix = splatMesh.matrixWorld;

    const mesh = splatMesh as any;
    if (!mesh.packedSplats?.forEachSplat || !mesh.packedSplats?.numSplats) return null;

    const splatCount = mesh.packedSplats.numSplats;
    if (splatCount === 0) return null;

    const stride = Math.max(1, Math.floor(splatCount / maxCount));
    const estCount = Math.ceil(splatCount / stride);
    const positions = new Float64Array(estCount * 3);
    let outIdx = 0;

    mesh.packedSplats.forEachSplat((index: number, center: { x: number; y: number; z: number }) => {
        if (index % stride !== 0) return;
        const wp = new THREE.Vector3(center.x, center.y, center.z).applyMatrix4(worldMatrix);
        positions[outIdx++] = wp.x;
        positions[outIdx++] = wp.y;
        positions[outIdx++] = wp.z;
    });

    const actualCount = outIdx / 3;
    log.info(`Sampled ${actualCount} splat points (from ${splatCount}, stride ${stride})`);
    return { points: positions.slice(0, actualCount * 3), count: actualCount };
}
