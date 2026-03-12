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

        // Convert from Colmap (Y-down, Z-forward) to Three.js (Y-up, Z-backward):
        // Position: negate all three axes — Y,Z for coord system, X to fix SfM mirror ambiguity
        // Quaternion: negate X (mirror) and Y,Z (coord conversion) = negate all components, keep w
        const posConverted = new THREE.Vector3(-pos.x, -pos.y, -pos.z);
        const qConverted = new THREE.Quaternion(-rInv.x, -rInv.y, -rInv.z, rInv.w);

        const intr = intrinsicsMap.get(cameraId);
        const focalLength = intr?.focalLength || 0;

        images.push({
            imageId,
            quaternion: [qConverted.x, qConverted.y, qConverted.z, qConverted.w],
            position: [posConverted.x, posConverted.y, posConverted.z],
            cameraId,
            name,
            focalLength,
        });
    }

    log.info(`Parsed ${images.length} images from images.bin`);
    return images;
}

export type ColmapDisplayMode = 'frustums' | 'markers';

/**
 * Manages Colmap camera visualization in the scene.
 * Renders cameras as frustums (wireframe pyramids) or instanced markers.
 */
export class ColmapManager {
    readonly group: THREE.Group;
    private cameras: ColmapCamera[] = [];
    private intrinsics: ColmapIntrinsics[] = [];
    private frustumMesh: THREE.LineSegments | null = null;
    private markerMesh: THREE.InstancedMesh | null = null;
    private _displayMode: ColmapDisplayMode = 'frustums';
    private _frustumScale = 1.0;
    private _visible = true;
    private _points3D: Float64Array | null = null;
    private _points3DCount = 0;

    /** Raw buffer for archive export (set externally). */
    points3DBuffer: ArrayBuffer | null = null;

    constructor(group: THREE.Group) {
        this.group = group;
    }

    get hasData(): boolean { return this.cameras.length > 0; }
    get cameraCount(): number { return this.cameras.length; }
    get colmapCameras(): ColmapCamera[] { return this.cameras; }
    get points3D(): Float64Array | null { return this._points3D; }
    get points3DCount(): number { return this._points3DCount; }
    get hasPoints3D(): boolean { return this._points3D !== null && this._points3DCount > 0; }

    /** Load from parsed binary data. */
    load(intrinsics: ColmapIntrinsics[], cameras: ColmapCamera[]): void {
        this.dispose();
        this.intrinsics = intrinsics;
        this.cameras = cameras;
        this.render();
    }

    /** Load from raw binary buffers. */
    loadFromBuffers(camerasBuffer: ArrayBuffer, imagesBuffer: ArrayBuffer): void {
        const intrinsics = parseCamerasBin(camerasBuffer);
        const cameras = parseImagesBin(imagesBuffer, intrinsics);
        this.load(intrinsics, cameras);
    }

    /** Store parsed points3D positions (already coordinate-converted). */
    loadPoints3D(positions: Float64Array, count: number): void {
        this._points3D = positions;
        this._points3DCount = count;
        log.info(`Stored ${count} points3D positions`);
    }

    private render(): void {
        this.clearMeshes();
        if (this.cameras.length === 0) return;

        if (this._displayMode === 'frustums') {
            this.renderFrustums();
        } else {
            this.renderMarkers();
        }
    }

    private renderFrustums(): void {
        const positions: number[] = [];
        const colors: number[] = [];
        const n = this.cameras.length;

        for (let i = 0; i < n; i++) {
            const cam = this.cameras[i];
            const t = n > 1 ? i / (n - 1) : 0.5;
            const color = sequenceColor(t);

            const focalNorm = cam.focalLength > 0 ? cam.focalLength / 3000 : 0.5;
            const size = this._frustumScale * 0.3 * focalNorm;
            const aspect = 4 / 3;

            const hw = size * aspect * 0.5;
            const hh = size * 0.5;
            const d = size;
            const corners = [
                new THREE.Vector3(-hw, -hh, -d),
                new THREE.Vector3(hw, -hh, -d),
                new THREE.Vector3(hw, hh, -d),
                new THREE.Vector3(-hw, hh, -d),
            ];

            const q = new THREE.Quaternion(...cam.quaternion);
            const p = new THREE.Vector3(...cam.position);
            const origin = p.clone();

            for (const c of corners) {
                c.applyQuaternion(q).add(p);
            }

            const edges: [THREE.Vector3, THREE.Vector3][] = [
                [origin, corners[0]], [origin, corners[1]],
                [origin, corners[2]], [origin, corners[3]],
                [corners[0], corners[1]], [corners[1], corners[2]],
                [corners[2], corners[3]], [corners[3], corners[0]],
            ];

            for (const [a, b] of edges) {
                positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
                colors.push(color[0], color[1], color[2], color[0], color[1], color[2]);
            }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const mat = new THREE.LineBasicMaterial({
            vertexColors: true,
            depthTest: true,
            transparent: true,
            opacity: 0.85,
        });
        this.frustumMesh = new THREE.LineSegments(geom, mat);
        this.frustumMesh.name = 'colmap_frustums';
        this.frustumMesh.visible = this._visible;
        this.group.add(this.frustumMesh);
    }

    private renderMarkers(): void {
        const n = this.cameras.length;
        const sphereGeom = new THREE.SphereGeometry(0.02 * this._frustumScale, 8, 6);
        const mat = new THREE.MeshBasicMaterial({ vertexColors: false, color: 0xffffff });
        this.markerMesh = new THREE.InstancedMesh(sphereGeom, mat, n);
        this.markerMesh.name = 'colmap_markers';

        const dummy = new THREE.Object3D();
        const color = new THREE.Color();

        for (let i = 0; i < n; i++) {
            const cam = this.cameras[i];
            dummy.position.set(...cam.position);
            dummy.updateMatrix();
            this.markerMesh.setMatrixAt(i, dummy.matrix);

            const t = n > 1 ? i / (n - 1) : 0.5;
            const [r, g, b] = sequenceColor(t);
            color.setRGB(r, g, b);
            this.markerMesh.setColorAt(i, color);
        }

        this.markerMesh.instanceMatrix.needsUpdate = true;
        if (this.markerMesh.instanceColor) this.markerMesh.instanceColor.needsUpdate = true;
        this.markerMesh.visible = this._visible;
        this.group.add(this.markerMesh);
    }

    setDisplayMode(mode: ColmapDisplayMode): void {
        if (mode === this._displayMode) return;
        this._displayMode = mode;
        this.render();
    }

    setFrustumScale(scale: number): void {
        this._frustumScale = scale;
        this.render();
    }

    setVisible(visible: boolean): void {
        this._visible = visible;
        if (this.frustumMesh) this.frustumMesh.visible = visible;
        if (this.markerMesh) this.markerMesh.visible = visible;
    }

    private clearMeshes(): void {
        if (this.frustumMesh) {
            this.group.remove(this.frustumMesh);
            this.frustumMesh.geometry.dispose();
            (this.frustumMesh.material as THREE.Material).dispose();
            this.frustumMesh = null;
        }
        if (this.markerMesh) {
            this.group.remove(this.markerMesh);
            this.markerMesh.geometry.dispose();
            (this.markerMesh.material as THREE.Material).dispose();
            this.markerMesh = null;
        }
    }

    dispose(): void {
        this.clearMeshes();
        this._points3D = null;
        this._points3DCount = 0;
        this.points3DBuffer = null;
        this.cameras = [];
        this.intrinsics = [];
    }
}

/** Rainbow sequence color: blue → cyan → green → yellow → red. t in [0, 1]. */
function sequenceColor(t: number): [number, number, number] {
    const hue = (1 - t) * 0.66;
    const c = new THREE.Color().setHSL(hue, 0.9, 0.55);
    return [c.r, c.g, c.b];
}
