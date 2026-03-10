/**
 * Colmap SfM Camera Loader
 *
 * Parses Colmap binary format (cameras.bin + images.bin) and renders
 * camera positions as frustums or instanced markers.
 */

import * as THREE from 'three';
import { Logger } from './utilities.js';
import type { ColmapCamera, ColmapIntrinsics } from '../types.js';

const log = Logger.getLogger('colmap-loader');

// Camera model parameter counts — https://colmap.github.io/cameras.html
const MODEL_PARAM_COUNT: Record<number, number> = {
    0: 3,  // SIMPLE_PINHOLE: f, cx, cy
    1: 4,  // PINHOLE: fx, fy, cx, cy
    2: 4,  // SIMPLE_RADIAL: f, cx, cy, k
    3: 5,  // RADIAL: f, cx, cy, k1, k2
    4: 8,  // OPENCV: fx, fy, cx, cy, k1, k2, p1, p2
    5: 8,  // OPENCV_FISHEYE: fx, fy, cx, cy, k1, k2, k3, k4
    6: 12, // FULL_OPENCV: fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6
    7: 5,  // FOV: fx, fy, cx, cy, omega
    8: 4,  // SIMPLE_RADIAL_FISHEYE: f, cx, cy, k
    9: 5,  // RADIAL_FISHEYE: f, cx, cy, k1, k2
    10: 12, // THIN_PRISM_FISHEYE
};

/** Read a uint64 as a Number (safe for values < 2^53). */
function readUint64(view: DataView, offset: number): number {
    const lo = view.getUint32(offset, true);
    const hi = view.getUint32(offset + 4, true);
    return hi * 0x100000000 + lo;
}

/** Read a null-terminated string starting at offset. Returns [string, newOffset]. */
function readString(view: DataView, offset: number): [string, number] {
    const bytes: number[] = [];
    let i = offset;
    while (i < view.byteLength && view.getUint8(i) !== 0) {
        bytes.push(view.getUint8(i));
        i++;
    }
    return [new TextDecoder().decode(new Uint8Array(bytes)), i + 1];
}

/** Parse cameras.bin → ColmapIntrinsics[] */
export function parseCamerasBin(buffer: ArrayBuffer): ColmapIntrinsics[] {
    const view = new DataView(buffer);
    if (buffer.byteLength < 8) return [];

    const numCameras = readUint64(view, 0);
    if (numCameras === 0) return [];

    const cameras: ColmapIntrinsics[] = [];
    let off = 8;

    for (let i = 0; i < numCameras; i++) {
        const cameraId = view.getUint32(off, true); off += 4;
        const modelId = view.getInt32(off, true); off += 4;
        const width = readUint64(view, off); off += 8;
        const height = readUint64(view, off); off += 8;

        const paramCount = MODEL_PARAM_COUNT[modelId] ?? 4;
        const params: number[] = [];
        for (let p = 0; p < paramCount; p++) {
            params.push(view.getFloat64(off, true));
            off += 8;
        }

        const focalLength = params[0] || 0;
        // cx, cy positions depend on camera model
        const cx = modelId === 1 || modelId === 4 || modelId === 5
            ? params[2] : params[1];
        const cy = modelId === 1 || modelId === 4 || modelId === 5
            ? params[3] : params[2];

        cameras.push({ cameraId, modelId, width, height, focalLength, cx: cx || width / 2, cy: cy || height / 2 });
    }

    log.info(`Parsed ${cameras.length} cameras from cameras.bin`);
    return cameras;
}

/** Parse images.bin → ColmapCamera[] (with world-space positions). */
export function parseImagesBin(buffer: ArrayBuffer, intrinsics: ColmapIntrinsics[]): ColmapCamera[] {
    const view = new DataView(buffer);
    if (buffer.byteLength < 8) return [];

    const numImages = readUint64(view, 0);
    if (numImages === 0) return [];

    const intrinsicsMap = new Map<number, ColmapIntrinsics>();
    for (const cam of intrinsics) intrinsicsMap.set(cam.cameraId, cam);

    const images: ColmapCamera[] = [];
    let off = 8;

    for (let i = 0; i < numImages; i++) {
        const imageId = view.getUint32(off, true); off += 4;

        // Quaternion (w, x, y, z) — Colmap stores scalar-first
        const qw = view.getFloat64(off, true); off += 8;
        const qx = view.getFloat64(off, true); off += 8;
        const qy = view.getFloat64(off, true); off += 8;
        const qz = view.getFloat64(off, true); off += 8;

        // Translation (world-to-camera)
        const tx = view.getFloat64(off, true); off += 8;
        const ty = view.getFloat64(off, true); off += 8;
        const tz = view.getFloat64(off, true); off += 8;

        const cameraId = view.getUint32(off, true); off += 4;

        const [name, newOff] = readString(view, off);
        off = newOff;

        // Skip 2D points
        const numPoints2D = readUint64(view, off); off += 8;
        off += numPoints2D * 24; // each point: x(f64) + y(f64) + point3D_id(i64)

        // Convert world-to-camera (R, t) to world-space camera position:
        // camera_position = -R^T * t
        const q = new THREE.Quaternion(qx, qy, qz, qw);
        const t = new THREE.Vector3(tx, ty, tz);
        const rInv = q.clone().invert();
        const pos = t.clone().negate().applyQuaternion(rInv);

        const intr = intrinsicsMap.get(cameraId);
        const focalLength = intr?.focalLength || 0;

        images.push({
            imageId,
            quaternion: [rInv.x, rInv.y, rInv.z, rInv.w],
            position: [pos.x, pos.y, pos.z],
            cameraId,
            name,
            focalLength,
        });
    }

    log.info(`Parsed ${images.length} images from images.bin`);
    return images;
}
