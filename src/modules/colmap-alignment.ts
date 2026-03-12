/**
 * Colmap↔FlightPath Alignment
 *
 * Matches Colmap camera positions (splat-space) to flight log GPS points
 * by timestamp, then computes a similarity transform to align the flight
 * path group into splat-space.
 */

import * as THREE from 'three';
import { Logger } from './utilities.js';
import type { ColmapCamera, FlightPoint } from '../types.js';

const log = Logger.getLogger('colmap-alignment');

// ─── Points3D parser ─────────────────────────────────────────────────

/** Result from parsing points3D.bin */
export interface Points3DResult {
    positions: Float64Array;  // flat xyz, length = count * 3
    count: number;
}

/** Read a uint64 as a Number (safe for values < 2^53). Little-endian. */
function readUint64(view: DataView, offset: number): number {
    const lo = view.getUint32(offset, true);
    const hi = view.getUint32(offset + 4, true);
    return hi * 0x100000000 + lo;
}

/**
 * Parse Colmap points3D.bin → Float64Array of xyz positions.
 * Coordinate-converts from Colmap (Y-down, Z-forward) to Three.js (Y-up, Z-backward)
 * by negating Y and Z, matching what colmap-loader.ts does for camera positions.
 */
export function parsePoints3D(buffer: ArrayBuffer, maxPoints = 20000): Points3DResult | null {
    if (buffer.byteLength < 8) return null;
    const view = new DataView(buffer);
    const numPoints = readUint64(view, 0);
    if (numPoints === 0) return null;

    // First pass: collect byte offsets (variable-length records)
    const offsets: number[] = [];
    let off = 8;
    for (let i = 0; i < numPoints; i++) {
        offsets.push(off);
        off += 8;  // point3D_id (uint64)
        off += 24; // xyz (3 × float64)
        off += 3;  // rgb (3 × uint8)
        off += 8;  // error (float64)
        const trackLength = readUint64(view, off);
        off += 8;  // track_length (uint64)
        off += trackLength * 8; // track entries
    }

    // Subsample
    const stride = numPoints > maxPoints ? Math.ceil(numPoints / maxPoints) : 1;
    const sampleCount = Math.ceil(numPoints / stride);
    const positions = new Float64Array(sampleCount * 3);
    let outIdx = 0;

    for (let i = 0; i < numPoints; i += stride) {
        const pOff = offsets[i] + 8; // skip point3D_id
        const x = view.getFloat64(pOff, true);
        const y = view.getFloat64(pOff + 8, true);
        const z = view.getFloat64(pOff + 16, true);
        positions[outIdx++] = -x;
        positions[outIdx++] = -y;
        positions[outIdx++] = -z;
    }

    const actualCount = outIdx / 3;
    const trimmed = actualCount < sampleCount ? positions.slice(0, actualCount * 3) : positions;

    log.info(`Parsed ${numPoints} points from points3D.bin, sampled ${actualCount} (stride ${stride})`);
    return { positions: trimmed, count: actualCount };
}

// ─── Timestamp extraction ───────────────────────────────────────────

/** DJI filename patterns: DJI_YYYYMMDD_HHMMSS_NNNN or DJI_YYYYMMDDHHMMSS_NNNN */
const DJI_PATTERN_1 = /DJI_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i;
const DJI_PATTERN_2 = /DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/i;

/**
 * Extract a UTC timestamp (ms since epoch) from a Colmap image filename.
 * Returns null if the filename doesn't match any known pattern.
 */
export function extractTimestamp(filename: string): number | null {
    const m = filename.match(DJI_PATTERN_1) || filename.match(DJI_PATTERN_2);
    if (!m) return null;
    const [, year, month, day, hour, min, sec] = m;
    const d = new Date(Date.UTC(
        parseInt(year), parseInt(month) - 1, parseInt(day),
        parseInt(hour), parseInt(min), parseInt(sec)
    ));
    return d.getTime();
}

// ─── Point matching ─────────────────────────────────────────────────

export interface MatchedPair {
    colmapPos: [number, number, number];
    gpsPos: [number, number, number];
}

/**
 * Match Colmap cameras to flight log GPS points by timestamp.
 * Falls back to evenly-spaced sequential matching when timestamps
 * cannot be extracted from camera filenames.
 * Returns matched point pairs for alignment computation.
 */
export function matchCamerasToFlightPoints(
    cameras: Pick<ColmapCamera, 'name' | 'position'>[],
    flightPoints: FlightPoint[],
    options: { timeTolerance?: number } = {}
): MatchedPair[] {
    if (cameras.length === 0 || flightPoints.length === 0) return [];

    const tolerance = options.timeTolerance ?? 1000;

    const cameraTimestamps: { camera: typeof cameras[0]; ts: number }[] = [];
    for (const cam of cameras) {
        const ts = extractTimestamp(cam.name);
        if (ts !== null) cameraTimestamps.push({ camera: cam, ts });
    }

    // If timestamps could be parsed, match by time
    if (cameraTimestamps.length > 0) {
        const pairs: MatchedPair[] = [];
        const camBaseTs = Math.min(...cameraTimestamps.map(c => c.ts));

        for (const { camera, ts } of cameraTimestamps) {
            const camRelativeMs = ts - camBaseTs;

            let bestIdx = 0;
            let bestDelta = Math.abs(flightPoints[0].timestamp - camRelativeMs);

            for (let i = 1; i < flightPoints.length; i++) {
                const delta = Math.abs(flightPoints[i].timestamp - camRelativeMs);
                if (delta < bestDelta) {
                    bestDelta = delta;
                    bestIdx = i;
                }
            }

            if (bestDelta <= tolerance) {
                const fp = flightPoints[bestIdx];
                pairs.push({
                    colmapPos: camera.position,
                    gpsPos: [fp.x, fp.y, fp.z],
                });
            }
        }

        log.info(`Timestamp matching: ${pairs.length}/${cameras.length} cameras matched (tolerance: ${tolerance}ms)`);
        return pairs;
    }

    // Fallback: sequential matching — evenly space cameras along flight points
    log.info(`No timestamps in camera filenames, using sequential matching for ${cameras.length} cameras across ${flightPoints.length} flight points`);
    const pairs: MatchedPair[] = [];
    const step = flightPoints.length / cameras.length;

    for (let i = 0; i < cameras.length; i++) {
        const fpIdx = Math.min(Math.round(i * step), flightPoints.length - 1);
        const fp = flightPoints[fpIdx];
        pairs.push({
            colmapPos: cameras[i].position,
            gpsPos: [fp.x, fp.y, fp.z],
        });
    }

    log.info(`Sequential matching: ${pairs.length} pairs`);
    return pairs;
}

// ─── Umeyama similarity transform ──────────────────────────────────

export interface SimilarityTransformResult {
    rotation: THREE.Quaternion;
    scale: number;
    translation: THREE.Vector3;
    rmse: number;
    matchCount: number;
}

/**
 * Compute the similarity transform (rotation, uniform scale, translation)
 * that maps source points to target points, minimizing RMSE.
 *
 * Uses the Umeyama algorithm (closed-form solution):
 *   target = scale * R * source + t
 *
 * Requires >= 3 non-collinear point pairs.
 */
export function computeSimilarityTransform(
    source: [number, number, number][],
    target: [number, number, number][],
    rigid = false
): SimilarityTransformResult | null {
    const n = source.length;
    if (n < 3 || n !== target.length) return null;

    // Step 1: Compute centroids
    const srcCentroid = new THREE.Vector3();
    const tgtCentroid = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
        srcCentroid.add(new THREE.Vector3(...source[i]));
        tgtCentroid.add(new THREE.Vector3(...target[i]));
    }
    srcCentroid.divideScalar(n);
    tgtCentroid.divideScalar(n);

    // Step 2: Center the points
    const srcCentered: THREE.Vector3[] = [];
    const tgtCentered: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
        srcCentered.push(new THREE.Vector3(...source[i]).sub(srcCentroid));
        tgtCentered.push(new THREE.Vector3(...target[i]).sub(tgtCentroid));
    }

    // Step 3: Compute variances
    let srcVar = 0;
    for (const v of srcCentered) srcVar += v.lengthSq();
    srcVar /= n;
    if (srcVar < 1e-12) return null;

    // Step 4: Build 3x3 covariance matrix H = (1/n) * sum(tgt_i * src_i^T)
    const H = new Float64Array(9);
    for (let i = 0; i < n; i++) {
        const s = srcCentered[i];
        const t = tgtCentered[i];
        H[0] += t.x * s.x; H[1] += t.x * s.y; H[2] += t.x * s.z;
        H[3] += t.y * s.x; H[4] += t.y * s.y; H[5] += t.y * s.z;
        H[6] += t.z * s.x; H[7] += t.z * s.y; H[8] += t.z * s.z;
    }
    for (let i = 0; i < 9; i++) H[i] /= n;

    // Step 5: Optimal rotation via Horn's quaternion method
    const Sxx = H[0], Sxy = H[1], Sxz = H[2];
    const Syx = H[3], Syy = H[4], Syz = H[5];
    const Szx = H[6], Szy = H[7], Szz = H[8];

    const N = new THREE.Matrix4();
    N.set(
        Sxx + Syy + Szz,  Syz - Szy,        Szx - Sxz,        Sxy - Syx,
        Syz - Szy,         Sxx - Syy - Szz,  Sxy + Syx,        Szx + Sxz,
        Szx - Sxz,         Sxy + Syx,        -Sxx + Syy - Szz, Syz + Szy,
        Sxy - Syx,         Szx + Sxz,         Syz + Szy,       -Sxx - Syy + Szz
    );

    // Power iteration for largest eigenvector
    const v = new THREE.Vector4(1, 0, 0, 0);
    const temp = new THREE.Vector4();
    for (let iter = 0; iter < 50; iter++) {
        temp.copy(v).applyMatrix4(N);
        const len = temp.length();
        if (len < 1e-15) break;
        v.copy(temp).divideScalar(len);
    }

    const rotation = new THREE.Quaternion(v.y, v.z, v.w, v.x);
    rotation.normalize();

    // Step 6: Compute scale
    let traceRH = 0;
    for (let i = 0; i < n; i++) {
        const rotSrc = srcCentered[i].clone().applyQuaternion(rotation);
        traceRH += rotSrc.dot(tgtCentered[i]);
    }
    const scale = rigid ? 1.0 : traceRH / (n * srcVar);

    // Step 7: Compute translation
    const rotatedCentroid = srcCentroid.clone().applyQuaternion(rotation).multiplyScalar(scale);
    const translation = tgtCentroid.clone().sub(rotatedCentroid);

    // Step 8: Compute RMSE
    let sumSqErr = 0;
    for (let i = 0; i < n; i++) {
        const transformed = new THREE.Vector3(...source[i])
            .applyQuaternion(rotation)
            .multiplyScalar(scale)
            .add(translation);
        sumSqErr += transformed.distanceToSquared(new THREE.Vector3(...target[i]));
    }
    const rmse = Math.sqrt(sumSqErr / n);

    log.info(`Similarity transform: scale=${scale.toFixed(4)}, RMSE=${rmse.toFixed(4)}, ${n} points`);

    return { rotation, scale, translation, rmse, matchCount: n };
}

// ─── High-level alignment API ───────────────────────────────────────

export interface AlignmentResult {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: number;
    rmse: number;
    matchCount: number;
}

/**
 * Align Colmap cameras to a (manually positioned) flight path.
 * The flight path group's world matrix is used to convert local flight
 * point positions to world space before computing the transform.
 *
 * Source = colmap camera positions, Target = flight point world positions.
 * The returned transform should be applied to the colmap group.
 */
export function alignCamerasToFlightPath(
    cameras: Pick<ColmapCamera, 'name' | 'position'>[],
    flightPoints: FlightPoint[],
    flightPathWorldMatrix: THREE.Matrix4,
    options?: { timeTolerance?: number }
): AlignmentResult | null {
    const pairs = matchCamerasToFlightPoints(cameras, flightPoints, options);
    if (pairs.length < 3) {
        log.warn(`Insufficient matches for alignment: ${pairs.length} (need >= 3)`);
        return null;
    }

    // Transform flight point positions from local to world space
    const worldPairs = pairs.map(p => {
        const worldPos = new THREE.Vector3(...p.gpsPos).applyMatrix4(flightPathWorldMatrix);
        return { colmapPos: p.colmapPos, gpsWorldPos: [worldPos.x, worldPos.y, worldPos.z] as [number, number, number] };
    });

    // Source = colmap positions, Target = flight path world positions
    const source = worldPairs.map(p => p.colmapPos);
    const target = worldPairs.map(p => p.gpsWorldPos);

    const result = computeSimilarityTransform(source, target);
    if (!result) return null;

    const euler = new THREE.Euler().setFromQuaternion(result.rotation);

    return {
        position: result.translation,
        rotation: euler,
        scale: result.scale,
        rmse: result.rmse,
        matchCount: result.matchCount,
    };
}
