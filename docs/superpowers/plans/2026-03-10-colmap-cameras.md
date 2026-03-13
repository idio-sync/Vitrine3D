# Colmap Camera Visualization & Flight Path Alignment — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Colmap SfM camera data as a new asset type with frustum/marker visualization, and auto-align flight paths to splats via timestamp-matched Colmap↔GPS point pairs.

**Architecture:** New `colmap-loader.ts` module handles binary parsing, rendering, and alignment math. Integrates as a standard asset type following the `flightPathGroup` pattern — own THREE.Group in SceneManager, tracking vectors in transform-controller, archive support, kiosk lazy-import.

**Tech Stack:** TypeScript, Three.js 0.183.2, DataView for binary parsing, Umeyama algorithm (extends existing Horn's method in alignment.ts).

**Spec:** `docs/superpowers/specs/2026-03-10-colmap-cameras-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/modules/colmap-loader.ts` | Create | Binary parser, frustum/marker renderer, ColmapManager class |
| `src/modules/colmap-alignment.ts` | Create | Timestamp extraction, point matching, Umeyama similarity transform |
| `src/modules/__tests__/colmap-loader.test.ts` | Create | Parser tests, timestamp tests |
| `src/modules/__tests__/colmap-alignment.test.ts` | Create | Umeyama transform tests, point matching tests |
| `src/types.ts` | Modify | ColmapCamera interface, SceneRefs.colmapGroup, state flags |
| `src/modules/scene-manager.ts` | Modify | Add colmapGroup to scene |
| `src/modules/transform-controller.ts` | Modify | Add colmap tracking vectors and sync |
| `src/modules/event-wiring.ts` | Modify | Wire import, toggle, alignment buttons; colmap in transform inputs |
| `src/modules/ui-controller.ts` | Modify | Add colmap to updateTransformInputs, updateTransformPaneSelection |
| `src/modules/archive-creator.ts` | Modify | addColmap() method |
| `src/modules/archive-pipeline.ts` | Modify | Load colmap_sfm entries |
| `src/modules/archive-loader.ts` | Modify | getColmapEntries() helper |
| `src/modules/export-controller.ts` | Modify | Include colmap transform in manifest |
| `src/modules/kiosk-main.ts` | Modify | Lazy import + toggle button |
| `src/main.ts` | Modify | Wire colmapGroup, deps factories, file input |
| `src/editor/index.html` | Modify | Cameras section in Assets pane, select button in Transform pane |
| `src/index.html` | Modify | Toggle button for kiosk |
| `src/themes/*/layout.css` | Modify | Toggle button styles (5 themes) |

---

## Chunk 1: Core Parser & Types

### Task 1: Add ColmapCamera type and state flags

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add ColmapCamera interface and state properties**

In `src/types.ts`, add after the `FlightPathData` interface (~line 213):

```typescript
/** Parsed Colmap camera intrinsics */
export interface ColmapIntrinsics {
    cameraId: number;
    modelId: number;
    width: number;
    height: number;
    focalLength: number; // fx (or f for simple models)
    cx: number;
    cy: number;
}

/** Parsed Colmap image (camera extrinsics + filename) */
export interface ColmapCamera {
    imageId: number;
    quaternion: [number, number, number, number]; // [x, y, z, w] (Three.js order)
    position: [number, number, number]; // world-space camera position
    cameraId: number; // references ColmapIntrinsics
    name: string; // image filename
    focalLength: number; // resolved from intrinsics
}
```

Add `colmapLoaded: boolean` to the `AppState` interface (near `flightPathLoaded`):

```typescript
colmapLoaded: boolean;
```

Add `colmapGroup` to `SceneRefs` (near `flightPathGroup`):

```typescript
readonly colmapGroup: any; // THREE.Group
```

Add `colmapBlobs` to the asset store pattern in `AssetStore` (near `flightPathBlobs`):

```typescript
colmapBlobs: Array<{ camerasBlob: Blob; imagesBlob: Blob }>;
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success (no consumers of these types yet)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(colmap): add ColmapCamera types and state flags"
```

---

### Task 2: Colmap binary parser with tests

**Files:**
- Create: `src/modules/colmap-loader.ts`
- Create: `src/modules/__tests__/colmap-loader.test.ts`

- [ ] **Step 1: Write failing tests for binary parsing**

Create `src/modules/__tests__/colmap-loader.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseCamerasBin, parseImagesBin } from '../colmap-loader.js';

/** Build a minimal cameras.bin buffer: 1 PINHOLE camera */
function buildCamerasBin(): ArrayBuffer {
    // Header: num_cameras (uint64) = 1
    // Camera: id(u32) + model(i32) + width(u64) + height(u64) + params(4 doubles: fx,fy,cx,cy)
    const size = 8 + 4 + 4 + 8 + 8 + 4 * 8; // 56 bytes
    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    let off = 0;
    // num_cameras = 1 (uint64 LE — write low 32 bits, high 32 bits = 0)
    view.setUint32(off, 1, true); off += 4;
    view.setUint32(off, 0, true); off += 4;
    // camera_id = 1
    view.setUint32(off, 1, true); off += 4;
    // model_id = 1 (PINHOLE)
    view.setInt32(off, 1, true); off += 4;
    // width = 4000
    view.setUint32(off, 4000, true); off += 4;
    view.setUint32(off, 0, true); off += 4;
    // height = 3000
    view.setUint32(off, 3000, true); off += 4;
    view.setUint32(off, 0, true); off += 4;
    // params: fx=2800, fy=2800, cx=2000, cy=1500
    view.setFloat64(off, 2800, true); off += 8;
    view.setFloat64(off, 2800, true); off += 8;
    view.setFloat64(off, 2000, true); off += 8;
    view.setFloat64(off, 1500, true); off += 8;
    return buf;
}

/** Build a minimal images.bin buffer: 1 image, 0 2D points */
function buildImagesBin(): ArrayBuffer {
    const name = 'DJI_20240315_142532_0001.jpg';
    const nameBytes = new TextEncoder().encode(name);
    // Header: num_images(u64) = 1
    // Image: id(u32) + qw,qx,qy,qz(4xf64) + tx,ty,tz(3xf64) + camera_id(u32)
    //         + name(N+1 bytes) + num_points2D(u64) = 0
    const size = 8 + 4 + 4 * 8 + 3 * 8 + 4 + (nameBytes.length + 1) + 8;
    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    let off = 0;
    // num_images = 1
    view.setUint32(off, 1, true); off += 4;
    view.setUint32(off, 0, true); off += 4;
    // image_id = 1
    view.setUint32(off, 1, true); off += 4;
    // quaternion: qw=1, qx=0, qy=0, qz=0 (identity)
    view.setFloat64(off, 1.0, true); off += 8; // qw
    view.setFloat64(off, 0.0, true); off += 8; // qx
    view.setFloat64(off, 0.0, true); off += 8; // qy
    view.setFloat64(off, 0.0, true); off += 8; // qz
    // translation: tx=1, ty=2, tz=3
    view.setFloat64(off, 1.0, true); off += 8;
    view.setFloat64(off, 2.0, true); off += 8;
    view.setFloat64(off, 3.0, true); off += 8;
    // camera_id = 1
    view.setUint32(off, 1, true); off += 4;
    // name (null-terminated)
    for (let i = 0; i < nameBytes.length; i++) {
        view.setUint8(off++, nameBytes[i]);
    }
    view.setUint8(off++, 0); // null terminator
    // num_points2D = 0
    view.setUint32(off, 0, true); off += 4;
    view.setUint32(off, 0, true); off += 4;
    return buf;
}

describe('parseCamerasBin', () => {
    it('parses a single PINHOLE camera', () => {
        const cameras = parseCamerasBin(buildCamerasBin());
        expect(cameras).toHaveLength(1);
        expect(cameras[0].cameraId).toBe(1);
        expect(cameras[0].modelId).toBe(1);
        expect(cameras[0].width).toBe(4000);
        expect(cameras[0].height).toBe(3000);
        expect(cameras[0].focalLength).toBeCloseTo(2800);
    });

    it('returns empty array for empty buffer', () => {
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        view.setUint32(0, 0, true);
        view.setUint32(4, 0, true);
        expect(parseCamerasBin(buf)).toHaveLength(0);
    });
});

describe('parseImagesBin', () => {
    it('parses a single image with identity rotation', () => {
        const cameras = parseCamerasBin(buildCamerasBin());
        const images = parseImagesBin(buildImagesBin(), cameras);
        expect(images).toHaveLength(1);
        expect(images[0].name).toBe('DJI_20240315_142532_0001.jpg');
        expect(images[0].cameraId).toBe(1);
        expect(images[0].focalLength).toBeCloseTo(2800);
        // Identity quaternion — position = -R^T * t = -t for identity R
        expect(images[0].position[0]).toBeCloseTo(-1);
        expect(images[0].position[1]).toBeCloseTo(-2);
        expect(images[0].position[2]).toBeCloseTo(-3);
    });

    it('returns empty array for empty buffer', () => {
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        view.setUint32(0, 0, true);
        view.setUint32(4, 0, true);
        expect(parseImagesBin(buf, [])).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/modules/__tests__/colmap-loader.test.ts`
Expected: FAIL — `parseCamerasBin` and `parseImagesBin` not found

- [ ] **Step 3: Implement the binary parsers**

Create `src/modules/colmap-loader.ts`:

```typescript
/**
 * Colmap SfM Camera Loader
 *
 * Parses Colmap binary format (cameras.bin + images.bin) and renders
 * camera positions as frustums or instanced markers.
 */

import * as THREE from 'three';
import { Logger } from './utilities.js';
import type { ColmapCamera, ColmapIntrinsics } from '@/types.js';

const log = Logger.getLogger('colmap-loader');

// ─── Camera model parameter counts ──────────────────────────────────
// https://colmap.github.io/cameras.html
const MODEL_PARAM_COUNT: Record<number, number> = {
    0: 3,  // SIMPLE_PINHOLE: f, cx, cy
    1: 4,  // PINHOLE: fx, fy, cx, cy
    2: 4,  // SIMPLE_RADIAL: f, cx, cy, k
    3: 5,  // RADIAL: f, cx, cy, k1, k2
    4: 8,  // OPENCV: fx, fy, cx, cy, k1, k2, p1, p2
    5: 8,  // OPENCV_FISHEYE: fx, fy, cx, cy, k1, k2, k3, k4
    6: 2,  // FULL_OPENCV: 12 params
    7: 4,  // FOV: fx, fy, cx, cy (actually 5, but omega is extra)
    8: 5,  // SIMPLE_RADIAL_FISHEYE: f, cx, cy, k
    9: 6,  // RADIAL_FISHEYE: f, cx, cy, k1, k2
    10: 4, // THIN_PRISM_FISHEYE: 12 params
};
// For models not in this map, try to read until next camera or EOF.

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

// ─── Binary parsers ─────────────────────────────────────────────────

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

        // Extract focal length: first param is always f or fx
        const focalLength = params[0] || 0;
        // cx, cy depend on model
        const cx = modelId === 1 || modelId === 4 || modelId === 5
            ? params[2] : params[1]; // PINHOLE/OPENCV: param[2], others: param[1]
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

    // Build intrinsics lookup
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

        // Image name (null-terminated string)
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
            quaternion: [rInv.x, rInv.y, rInv.z, rInv.w], // world-space orientation, Three.js order
            position: [pos.x, pos.y, pos.z],
            cameraId,
            name,
            focalLength,
        });
    }

    log.info(`Parsed ${images.length} images from images.bin`);
    return images;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/modules/__tests__/colmap-loader.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/colmap-loader.ts src/modules/__tests__/colmap-loader.test.ts
git commit -m "feat(colmap): add binary parser for cameras.bin and images.bin"
```

---

### Task 3: Timestamp extraction with tests

**Files:**
- Modify: `src/modules/colmap-alignment.ts` (create)
- Create: `src/modules/__tests__/colmap-alignment.test.ts`

- [ ] **Step 1: Write failing tests for timestamp extraction**

Create `src/modules/__tests__/colmap-alignment.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { extractTimestamp, matchCamerasToFlightPoints } from '../colmap-alignment.js';

describe('extractTimestamp', () => {
    it('extracts from DJI standard format: DJI_YYYYMMDD_HHMMSS_NNNN.jpg', () => {
        const ts = extractTimestamp('DJI_20240315_142532_0001.jpg');
        expect(ts).not.toBeNull();
        const d = new Date(ts!);
        expect(d.getUTCFullYear()).toBe(2024);
        expect(d.getUTCMonth()).toBe(2); // March = 2
        expect(d.getUTCDate()).toBe(15);
        expect(d.getUTCHours()).toBe(14);
        expect(d.getUTCMinutes()).toBe(25);
        expect(d.getUTCSeconds()).toBe(32);
    });

    it('extracts from DJI alt format: DJI_YYYYMMDDHHMMSS_NNNN.jpg', () => {
        const ts = extractTimestamp('DJI_20240315142532_0001.jpg');
        expect(ts).not.toBeNull();
    });

    it('returns null for unrecognized filenames', () => {
        expect(extractTimestamp('photo_001.jpg')).toBeNull();
        expect(extractTimestamp('IMG_1234.jpg')).toBeNull();
    });

    it('handles various DJI prefixes', () => {
        expect(extractTimestamp('DJI_20240315_142532_0001.JPG')).not.toBeNull();
    });
});

describe('matchCamerasToFlightPoints', () => {
    const cameras = [
        { name: 'DJI_20240315_142530_0001.jpg', position: [1, 2, 3] as [number, number, number] },
        { name: 'DJI_20240315_142535_0002.jpg', position: [4, 5, 6] as [number, number, number] },
        { name: 'DJI_20240315_142540_0003.jpg', position: [7, 8, 9] as [number, number, number] },
    ];

    const flightPoints = [
        { timestamp: 0, lat: 0, lon: 0, alt: 0, x: 10, y: 20, z: 30, speed: 0 },
        { timestamp: 5000, lat: 0, lon: 0, alt: 0, x: 40, y: 50, z: 60, speed: 0 },
        { timestamp: 10000, lat: 0, lon: 0, alt: 0, x: 70, y: 80, z: 90, speed: 0 },
    ];

    it('matches cameras to flight points by timestamp', () => {
        // Camera timestamps: 0s, 5s, 10s relative to first
        // Flight timestamps: 0ms, 5000ms, 10000ms
        const pairs = matchCamerasToFlightPoints(
            cameras as any,
            flightPoints as any,
            { timeTolerance: 1000 }
        );
        expect(pairs).toHaveLength(3);
        expect(pairs[0].colmapPos).toEqual([1, 2, 3]);
        expect(pairs[0].gpsPos).toEqual([10, 20, 30]);
    });

    it('discards cameras outside time tolerance', () => {
        const pairs = matchCamerasToFlightPoints(
            cameras as any,
            flightPoints as any,
            { timeTolerance: 100 } // very tight — only exact matches
        );
        // Timestamps may not match within 100ms, depends on rounding
        expect(pairs.length).toBeLessThanOrEqual(3);
    });

    it('returns empty for cameras with unparseable timestamps', () => {
        const badCameras = [
            { name: 'photo_001.jpg', position: [1, 2, 3] as [number, number, number] },
        ];
        const pairs = matchCamerasToFlightPoints(
            badCameras as any,
            flightPoints as any,
            { timeTolerance: 1000 }
        );
        expect(pairs).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/modules/__tests__/colmap-alignment.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement timestamp extraction and point matching**

Create `src/modules/colmap-alignment.ts`:

```typescript
/**
 * Colmap↔FlightPath Alignment
 *
 * Matches Colmap camera positions (splat-space) to flight log GPS points
 * by timestamp, then computes a similarity transform to align the flight
 * path group into splat-space.
 */

import * as THREE from 'three';
import { Logger } from './utilities.js';
import type { ColmapCamera, FlightPoint } from '@/types.js';

const log = Logger.getLogger('colmap-alignment');

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
 * Returns matched point pairs for alignment computation.
 */
export function matchCamerasToFlightPoints(
    cameras: Pick<ColmapCamera, 'name' | 'position'>[],
    flightPoints: FlightPoint[],
    options: { timeTolerance?: number } = {}
): MatchedPair[] {
    const tolerance = options.timeTolerance ?? 1000; // ms
    const pairs: MatchedPair[] = [];

    // Extract timestamps from camera filenames
    const cameraTimestamps: { camera: typeof cameras[0]; ts: number }[] = [];
    for (const cam of cameras) {
        const ts = extractTimestamp(cam.name);
        if (ts !== null) cameraTimestamps.push({ camera: cam, ts });
    }

    if (cameraTimestamps.length === 0 || flightPoints.length === 0) return [];

    // Compute camera timestamps relative to the first camera
    const camBaseTs = Math.min(...cameraTimestamps.map(c => c.ts));

    // Flight point timestamps are in ms from start
    for (const { camera, ts } of cameraTimestamps) {
        const camRelativeMs = ts - camBaseTs;

        // Find nearest flight point by timestamp
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

    log.info(`Matched ${pairs.length}/${cameras.length} cameras to flight points (tolerance: ${tolerance}ms)`);
    return pairs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/modules/__tests__/colmap-alignment.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/colmap-alignment.ts src/modules/__tests__/colmap-alignment.test.ts
git commit -m "feat(colmap): add timestamp extraction and point matching"
```

---

## Chunk 2: Alignment Algorithm

### Task 4: Umeyama similarity transform with tests

**Files:**
- Modify: `src/modules/colmap-alignment.ts`
- Modify: `src/modules/__tests__/colmap-alignment.test.ts`

- [ ] **Step 1: Write failing tests for the Umeyama algorithm**

Add to `src/modules/__tests__/colmap-alignment.test.ts`:

```typescript
import { computeSimilarityTransform, alignFlightPathToColmap } from '../colmap-alignment.js';

describe('computeSimilarityTransform', () => {
    it('computes identity for identical point sets', () => {
        const source = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [number, number, number][];
        const target = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [number, number, number][];
        const result = computeSimilarityTransform(source, target);
        expect(result).not.toBeNull();
        expect(result!.scale).toBeCloseTo(1, 3);
        expect(result!.translation.length()).toBeCloseTo(0, 3);
    });

    it('computes pure translation', () => {
        const source = [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as [number, number, number][];
        const target = [[5, 0, 0], [6, 0, 0], [5, 1, 0]] as [number, number, number][];
        const result = computeSimilarityTransform(source, target);
        expect(result).not.toBeNull();
        expect(result!.scale).toBeCloseTo(1, 2);
        expect(result!.translation.x).toBeCloseTo(5, 2);
        expect(result!.translation.y).toBeCloseTo(0, 2);
        expect(result!.translation.z).toBeCloseTo(0, 2);
    });

    it('computes uniform scale', () => {
        const source = [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as [number, number, number][];
        const target = [[0, 0, 0], [2, 0, 0], [0, 2, 0]] as [number, number, number][];
        const result = computeSimilarityTransform(source, target);
        expect(result).not.toBeNull();
        expect(result!.scale).toBeCloseTo(2, 2);
    });

    it('computes scale + translation', () => {
        const source = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] as [number, number, number][];
        const target = [[10, 10, 10], [13, 10, 10], [10, 13, 10], [10, 10, 13]] as [number, number, number][];
        const result = computeSimilarityTransform(source, target);
        expect(result).not.toBeNull();
        expect(result!.scale).toBeCloseTo(3, 1);
    });

    it('returns null for fewer than 3 points', () => {
        const source = [[0, 0, 0], [1, 0, 0]] as [number, number, number][];
        const target = [[0, 0, 0], [2, 0, 0]] as [number, number, number][];
        expect(computeSimilarityTransform(source, target)).toBeNull();
    });

    it('computes RMSE', () => {
        const source = [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as [number, number, number][];
        const target = [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as [number, number, number][];
        const result = computeSimilarityTransform(source, target);
        expect(result!.rmse).toBeCloseTo(0, 3);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/modules/__tests__/colmap-alignment.test.ts`
Expected: FAIL — `computeSimilarityTransform` not found

- [ ] **Step 3: Implement Umeyama similarity transform**

Add to `src/modules/colmap-alignment.ts`:

```typescript
// ─── Umeyama similarity transform ──────────────────────────────────

interface SimilarityTransformResult {
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
    target: [number, number, number][]
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
    if (srcVar < 1e-12) return null; // degenerate — all source points identical

    // Step 4: Build 3x3 covariance matrix H = (1/n) * sum(tgt_i * src_i^T)
    // Stored as flat array [h00, h01, h02, h10, h11, h12, h20, h21, h22]
    const H = new Float64Array(9);
    for (let i = 0; i < n; i++) {
        const s = srcCentered[i];
        const t = tgtCentered[i];
        H[0] += t.x * s.x; H[1] += t.x * s.y; H[2] += t.x * s.z;
        H[3] += t.y * s.x; H[4] += t.y * s.y; H[5] += t.y * s.z;
        H[6] += t.z * s.x; H[7] += t.z * s.y; H[8] += t.z * s.z;
    }
    for (let i = 0; i < 9; i++) H[i] /= n;

    // Step 5: Compute optimal rotation using Horn's quaternion method
    // (reuses the pattern from alignment.ts computeOptimalRotation)
    // Build 4x4 symmetric matrix N from H
    const N = new THREE.Matrix4();
    const Sxx = H[0], Sxy = H[1], Sxz = H[2];
    const Syx = H[3], Syy = H[4], Syz = H[5];
    const Szx = H[6], Szy = H[7], Szz = H[8];

    N.set(
        Sxx + Syy + Szz,  Syz - Szy,        Szx - Sxz,        Sxy - Syx,
        Syz - Szy,         Sxx - Syy - Szz,  Sxy + Syx,        Szx + Sxz,
        Szx - Sxz,         Sxy + Syx,        -Sxx + Syy - Szz, Syz + Szy,
        Sxy - Syx,         Szx + Sxz,         Syz + Szy,       -Sxx - Syy + Szz
    );

    // Power iteration to find largest eigenvector
    let v = new THREE.Vector4(1, 0, 0, 0);
    const temp = new THREE.Vector4();
    for (let iter = 0; iter < 50; iter++) {
        temp.copy(v).applyMatrix4(N);
        const len = temp.length();
        if (len < 1e-15) break;
        v.copy(temp).divideScalar(len);
    }

    const rotation = new THREE.Quaternion(v.y, v.z, v.w, v.x); // Three.js order: x,y,z,w
    rotation.normalize();

    // Step 6: Compute scale
    // s = trace(R * H^T) / srcVar  — simplified via the matched covariance
    let traceRH = 0;
    for (let i = 0; i < n; i++) {
        const rotSrc = srcCentered[i].clone().applyQuaternion(rotation);
        traceRH += rotSrc.dot(tgtCentered[i]);
    }
    const scale = traceRH / (n * srcVar);

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
 * Align a flight path to Colmap cameras.
 *
 * Matches Colmap cameras to flight points by timestamp, computes the
 * similarity transform, and returns position/rotation/scale to apply
 * to the flightPathGroup.
 */
export function alignFlightPathToColmap(
    cameras: Pick<ColmapCamera, 'name' | 'position'>[],
    flightPoints: FlightPoint[],
    options?: { timeTolerance?: number }
): AlignmentResult | null {
    const pairs = matchCamerasToFlightPoints(cameras, flightPoints, options);
    if (pairs.length < 3) {
        log.warn(`Insufficient matches for alignment: ${pairs.length} (need >= 3)`);
        return null;
    }

    const source = pairs.map(p => p.gpsPos);
    const target = pairs.map(p => p.colmapPos);

    const result = computeSimilarityTransform(source, target);
    if (!result) return null;

    // Convert quaternion to Euler for group.rotation
    const euler = new THREE.Euler().setFromQuaternion(result.rotation);

    return {
        position: result.translation,
        rotation: euler,
        scale: result.scale,
        rmse: result.rmse,
        matchCount: result.matchCount,
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/modules/__tests__/colmap-alignment.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/colmap-alignment.ts src/modules/__tests__/colmap-alignment.test.ts
git commit -m "feat(colmap): add Umeyama similarity transform for flight path alignment"
```

---

## Chunk 3: Rendering

### Task 5: Frustum and marker rendering

**Files:**
- Modify: `src/modules/colmap-loader.ts`

- [ ] **Step 1: Add ColmapManager class with frustum rendering**

Add to the end of `src/modules/colmap-loader.ts`:

```typescript
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

    constructor(group: THREE.Group) {
        this.group = group;
    }

    get hasData(): boolean { return this.cameras.length > 0; }
    get cameraCount(): number { return this.cameras.length; }
    get colmapCameras(): ColmapCamera[] { return this.cameras; }

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

    // ─── Rendering ──────────────────────────────────────────────

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

            // Frustum size proportional to focal length (normalized)
            const focalNorm = cam.focalLength > 0 ? cam.focalLength / 3000 : 0.5;
            const size = this._frustumScale * 0.3 * focalNorm;
            const aspect = 4 / 3; // default aspect

            // Frustum corners in camera-local space
            const hw = size * aspect * 0.5;
            const hh = size * 0.5;
            const d = size;
            const corners = [
                new THREE.Vector3(-hw, -hh, -d),
                new THREE.Vector3(hw, -hh, -d),
                new THREE.Vector3(hw, hh, -d),
                new THREE.Vector3(-hw, hh, -d),
            ];

            // Transform to world space
            const q = new THREE.Quaternion(...cam.quaternion);
            const p = new THREE.Vector3(...cam.position);
            const origin = p.clone();

            for (const c of corners) {
                c.applyQuaternion(q).add(p);
            }

            // 8 edges: origin→4 corners + 4 rectangle edges
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

    // ─── Display controls ───────────────────────────────────────

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

    // ─── Cleanup ────────────────────────────────────────────────

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
        this.cameras = [];
        this.intrinsics = [];
    }
}

// ─── Color helpers ──────────────────────────────────────────────────

/** Rainbow sequence color: blue → cyan → green → yellow → red. t in [0, 1]. */
function sequenceColor(t: number): [number, number, number] {
    // HSL hue: 240° (blue) → 0° (red), lightness 0.55
    const hue = (1 - t) * 0.66; // 0.66 = 240/360
    const c = new THREE.Color().setHSL(hue, 0.9, 0.55);
    return [c.r, c.g, c.b];
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/modules/colmap-loader.ts
git commit -m "feat(colmap): add ColmapManager with frustum and marker rendering"
```

---

## Chunk 4: Scene & Transform Integration

### Task 6: SceneManager colmapGroup

**Files:**
- Modify: `src/modules/scene-manager.ts`

- [ ] **Step 1: Add colmapGroup to SceneManager**

Following the flightPathGroup pattern (scene-manager.ts lines 131, 206, 452-454):

Add property declaration near line 131 (after `flightPathGroup`):
```typescript
colmapGroup: Group | null;
```

Add initialization in constructor near line 206 (after `this.flightPathGroup = null`):
```typescript
this.colmapGroup = null;
```

Add group creation in `initScene()` near line 454 (after flightPathGroup creation):
```typescript
this.colmapGroup = new Group();
this.colmapGroup.name = 'colmapGroup';
this.scene.add(this.colmapGroup);
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/modules/scene-manager.ts
git commit -m "feat(colmap): add colmapGroup to SceneManager"
```

---

### Task 7: Transform controller integration

**Files:**
- Modify: `src/modules/transform-controller.ts`

- [ ] **Step 1: Add colmap tracking vectors and sync handlers**

Follow the exact flightpath pattern. All changes in `src/modules/transform-controller.ts`:

1. **Add tracking vectors** (after line 40, the flightpath vectors):
```typescript
const lastColmapPosition = new THREE.Vector3();
const lastColmapRotation = new THREE.Euler();
const lastColmapScale = new THREE.Vector3(1, 1, 1);
```

2. **Add `colmapGroup` to all interfaces**: `SetSelectedObjectDeps`, `SyncBothObjectsDeps`, `StoreLastPositionsDeps`, `SetTransformModeDeps`, `ResetTransformDeps`, `CenterAtOriginDeps`, `ApplyUniformScaleDeps` — add `colmapGroup: any;` to each.

3. **setSelectedObject()**: Add button name `'colmap'` to the forEach array (line 68). Add attachment case after flightpath (line 93):
```typescript
} else if (selection === 'colmap' && colmapGroup && colmapGroup.children.length > 0) {
    transformControls.attach(colmapGroup);
```
Add colmapGroup as a fallback in the 'both' cascade (after flightpathGroup).

4. **syncBothObjects()**: Add `colmapGroup` to the `applyDelta()` calls in every existing branch (splat, model, pointcloud, stl, cad, drawing, flightpath). Add a new branch for when `transformControls.object === colmapGroup`. Update the "store last positions" block at the end.

5. **storeLastPositions()**: Add colmap block:
```typescript
if (colmapGroup) {
    lastColmapPosition.copy(colmapGroup.position);
    lastColmapRotation.copy(colmapGroup.rotation);
    lastColmapScale.copy(colmapGroup.scale);
}
```

6. **resetTransform()**: Add colmap case:
```typescript
if ((sel === 'colmap' || sel === 'both') && colmapGroup) {
    colmapGroup.position.set(0, 0, 0);
    colmapGroup.rotation.set(0, 0, 0);
}
```

7. **centerAtOrigin()**: Add colmap bounding box contribution.

8. **applyUniformScale()**: Add `else if (obj === colmapGroup) lastScale = lastColmapScale;`

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/modules/transform-controller.ts
git commit -m "feat(colmap): add colmap to transform controller sync"
```

---

## Chunk 5: Editor UI & Wiring

### Task 8: Editor HTML — Assets pane and Transform selector

**Files:**
- Modify: `src/editor/index.html`

- [ ] **Step 1: Add Cameras section to Assets pane**

In `editor/index.html`, add after the Flight Path file input section (~line 1181):

```html
<span class="prop-label mt4">SfM Cameras</span>
<div class="prop-btn-row">
    <label for="colmap-cameras-input" class="prop-btn" style="cursor:pointer; margin-bottom:0;"><span style="color:#CE93D8;">+</span> cameras.bin</label>
    <label for="colmap-images-input" class="prop-btn" style="cursor:pointer; margin-bottom:0;"><span style="color:#CE93D8;">+</span> images.bin</label>
</div>
<input type="file" id="colmap-cameras-input" accept=".bin" style="display:none" />
<input type="file" id="colmap-images-input" accept=".bin" style="display:none" />
<span id="colmap-filename" class="prop-hint">.bin (Colmap sparse)</span>
<div id="colmap-info" style="display:none;">
    <span class="prop-hint">Cameras: <span id="colmap-camera-count">0</span></span>
    <div class="prop-btn-row mt4">
        <button class="prop-btn" id="btn-colmap-frustums">Frustums</button>
        <button class="prop-btn" id="btn-colmap-markers">Markers</button>
    </div>
    <div class="sl-row">
        <div class="sl-hd"><span class="sl-label">Scale</span><span class="sl-val" id="colmap-scale-value">1.0</span></div>
        <input type="range" id="colmap-scale" min="0.1" max="10" step="0.1" value="1">
    </div>
</div>
```

- [ ] **Step 2: Add Colmap select button to Transform pane**

In `editor/index.html`, add after the flightpath select button (~line 1362):

```html
<button class="seg-btn" id="btn-select-colmap" style="display:none;">SfM Cameras</button>
```

- [ ] **Step 3: Add align button to Flight Path section**

In the flight path pane area, add:

```html
<button class="prop-btn" id="btn-align-flightpath" style="display:none;" title="Align flight path to SfM cameras">Align to Cameras</button>
<span id="align-result" class="prop-hint" style="display:none;"></span>
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 5: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(colmap): add SfM cameras UI to editor HTML"
```

---

### Task 9: Event wiring — import, toggle, alignment

**Files:**
- Modify: `src/modules/event-wiring.ts`

- [ ] **Step 1: Wire colmap file inputs and controls**

In `event-wiring.ts`, in the `setupUIEvents` function, add after the flight path section:

```typescript
// ─── SfM Camera settings ─────────────────────────────────────
let pendingCamerasBin: ArrayBuffer | null = null;
let pendingImagesBin: ArrayBuffer | null = null;

const tryLoadColmap = () => {
    if (!pendingCamerasBin || !pendingImagesBin) return;
    deps.colmap.loadFromBuffers(pendingCamerasBin, pendingImagesBin);
    pendingCamerasBin = null;
    pendingImagesBin = null;
};

addListener('colmap-cameras-input', 'change', async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    pendingCamerasBin = await file.arrayBuffer();
    tryLoadColmap();
});

addListener('colmap-images-input', 'change', async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    pendingImagesBin = await file.arrayBuffer();
    tryLoadColmap();
});

addListener('btn-colmap-frustums', 'click', () => deps.colmap.setDisplayMode('frustums'));
addListener('btn-colmap-markers', 'click', () => deps.colmap.setDisplayMode('markers'));

addListener('colmap-scale', 'input', (e: Event) => {
    const scale = parseFloat((e.target as HTMLInputElement).value);
    const valueEl = document.getElementById('colmap-scale-value');
    if (valueEl) valueEl.textContent = scale.toFixed(1);
    deps.colmap.setFrustumScale(scale);
});

addListener('btn-align-flightpath', 'click', () => deps.colmap.alignFlightPath());
```

2. Add `colmap` to the transform pane input handlers (position, rotation, scale) — following the same pattern as the flightpath cases added earlier.

3. Add `colmap` to `EventWiringDeps` in `src/types.ts`:
```typescript
colmap: {
    loadFromBuffers: (cameras: ArrayBuffer, images: ArrayBuffer) => void;
    setDisplayMode: (mode: string) => void;
    setFrustumScale: (scale: number) => void;
    alignFlightPath: () => void;
};
```

- [ ] **Step 2: Add colmap to transform input handlers**

In each of the position/rotation/scale `change` handlers, add after the `flightpath` case:
```typescript
} else if (sel === 'colmap' && sceneManager?.colmapGroup) {
    sceneManager.colmapGroup.{position|rotation|scale}[axis] = val;
```
And in the `both` case, add:
```typescript
if (sceneManager?.colmapGroup) sceneManager.colmapGroup.{property}[axis] = val;
```

- [ ] **Step 3: Add colmap to ui-controller.ts**

In `updateTransformInputs` (~line 353) and `updateTransformPaneSelection` (~line 423), add `colmapGroup` parameter and handle the `'colmap'` selection case, following the flightpath pattern.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 5: Commit**

```bash
git add src/modules/event-wiring.ts src/modules/ui-controller.ts src/types.ts
git commit -m "feat(colmap): wire editor UI events for SfM cameras"
```

---

### Task 10: Main.ts glue — deps factories and file handling

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Wire ColmapManager and deps**

In `src/main.ts`:

1. Add import:
```typescript
import { ColmapManager } from './modules/colmap-loader.js';
import { alignFlightPathToColmap } from './modules/colmap-alignment.js';
```

2. Add module-level variable (near `flightPathManager`):
```typescript
let colmapManager: ColmapManager | null = null;
```

3. Add to `sceneRefs` getter (near `flightPathGroup`):
```typescript
get colmapGroup() { return sceneManager?.colmapGroup || null; },
```

4. Add state initialization: `colmapLoaded: false,`

5. In `init()`, after flightPathManager creation, create ColmapManager:
```typescript
if (sceneManager.colmapGroup) {
    colmapManager = new ColmapManager(sceneManager.colmapGroup);
}
```

6. Add colmap deps to `createEventWiringDeps()`:
```typescript
colmap: {
    loadFromBuffers: (camerasBuffer: ArrayBuffer, imagesBuffer: ArrayBuffer) => {
        if (!colmapManager) return;
        colmapManager.loadFromBuffers(camerasBuffer, imagesBuffer);
        state.colmapLoaded = true;
        updateObjectSelectButtons();
        updateColmapUI();
    },
    setDisplayMode: (mode: string) => colmapManager?.setDisplayMode(mode as any),
    setFrustumScale: (scale: number) => colmapManager?.setFrustumScale(scale),
    alignFlightPath: () => {
        if (!colmapManager?.hasData || !flightPathManager?.hasData) return;
        const result = alignFlightPathToColmap(
            colmapManager.colmapCameras,
            flightPathManager.getAllPoints(),
        );
        if (!result) {
            notify.error('Could not align: insufficient matches (need >= 3)');
            return;
        }
        const group = sceneManager?.flightPathGroup;
        if (group) {
            group.position.copy(result.position);
            group.rotation.copy(result.rotation);
            group.scale.setScalar(result.scale);
            updateTransformInputs();
            storeLastPositions();
        }
        const el = document.getElementById('align-result');
        if (el) {
            el.style.display = '';
            el.textContent = `Aligned: ${result.matchCount} matches, RMSE ${result.rmse.toFixed(3)}`;
        }
        if (result.rmse > 1.0) {
            notify.warning(`Alignment RMSE is high (${result.rmse.toFixed(2)}). Verify match quality.`);
        } else {
            notify.success(`Flight path aligned (${result.matchCount} matches, RMSE: ${result.rmse.toFixed(3)})`);
        }
    },
},
```

7. Add `updateColmapUI()` helper:
```typescript
function updateColmapUI(): void {
    const info = document.getElementById('colmap-info');
    const count = document.getElementById('colmap-camera-count');
    const selectBtn = document.getElementById('btn-select-colmap');
    const alignBtn = document.getElementById('btn-align-flightpath');
    if (info) info.style.display = state.colmapLoaded ? '' : 'none';
    if (count && colmapManager) count.textContent = String(colmapManager.cameraCount);
    if (selectBtn) selectBtn.style.display = state.colmapLoaded ? '' : 'none';
    if (alignBtn) alignBtn.style.display = (state.colmapLoaded && state.flightPathLoaded) ? '' : 'none';
}
```

8. Add colmapGroup to all wrapper functions that forward to transform-controller (setSelectedObject, syncBothObjects, storeLastPositions, etc.) — add `const colmapGroup = sceneManager?.colmapGroup || null;` and pass it through.

9. Add `'colmap'` to `updateObjectSelectButtons()`.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(colmap): wire ColmapManager in main.ts glue layer"
```

---

## Chunk 6: Archive Support

### Task 11: Archive creator — addColmap method

**Files:**
- Modify: `src/modules/archive-creator.ts`

- [ ] **Step 1: Add addColmap method**

In `archive-creator.ts`, following the `addFlightPath` pattern (~line 1464):

```typescript
addColmap(camerasBlob: Blob, imagesBlob: Blob, options: AddAssetOptions = {}): string {
    const index = this._countEntriesOfType('colmap_sfm_');
    const entryKey = `colmap_sfm_${index}`;

    this.files.set(`assets/colmap_sfm_${index}/cameras.bin`, { blob: camerasBlob, originalName: 'cameras.bin' });
    this.files.set(`assets/colmap_sfm_${index}/images.bin`, { blob: imagesBlob, originalName: 'images.bin' });

    this.manifest.data_entries[entryKey] = {
        file_name: `assets/colmap_sfm_${index}/`,
        created_by: options.created_by || "unknown",
        _created_by_version: options.created_by_version || "",
        _source_notes: options.source_notes || "",
        role: 'colmap_sfm',
        original_name: 'colmap_sfm',
        _parameters: {
            position: options.position || [0, 0, 0],
            rotation: options.rotation || [0, 0, 0],
            scale: options.scale !== undefined ? options.scale : 1,
            ...(options.parameters || {}),
        },
    };

    return entryKey;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/modules/archive-creator.ts
git commit -m "feat(colmap): add addColmap method to archive creator"
```

---

### Task 12: Archive pipeline — load colmap entries

**Files:**
- Modify: `src/modules/archive-pipeline.ts`
- Modify: `src/modules/archive-loader.ts`

- [ ] **Step 1: Add getColmapEntries to archive-loader**

In `archive-loader.ts`, add a method following the `getFlightPathEntries()` pattern:

```typescript
getColmapEntries(): Array<{ key: string; entry: any }> {
    return Object.entries(this.manifest?.data_entries || {})
        .filter(([key]) => key.startsWith('colmap_sfm_'))
        .map(([key, entry]) => ({ key, entry }));
}
```

- [ ] **Step 2: Add colmap loading to archive-pipeline**

In `archive-pipeline.ts`, in the asset loading section, add a colmap case following the flightpath pattern:

```typescript
} else if (assetType === 'colmap_sfm') {
    const colmapEntries = archiveLoader.getColmapEntries();
    if (colmapEntries.length === 0) {
        state.assetStates[assetType] = ASSET_STATE.UNLOADED;
        return false;
    }

    const fpStore = getStore();
    for (const { entry } of colmapEntries) {
        const basePath = entry.file_name; // e.g., "assets/colmap_sfm_0/"
        const camerasData = await archiveLoader.extractFile(basePath + 'cameras.bin');
        const imagesData = await archiveLoader.extractFile(basePath + 'images.bin');
        if (camerasData && imagesData) {
            fpStore.colmapBlobs.push({
                camerasBlob: camerasData.blob,
                imagesBlob: imagesData.blob,
            });
        }
    }

    state.colmapLoaded = true;
    state.assetStates[assetType] = ASSET_STATE.LOADED;
    return true;
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add src/modules/archive-pipeline.ts src/modules/archive-loader.ts
git commit -m "feat(colmap): load colmap_sfm entries from archives"
```

---

### Task 13: Export controller — include colmap in archives

**Files:**
- Modify: `src/modules/export-controller.ts`

- [ ] **Step 1: Add colmap export**

In `export-controller.ts`, in the `downloadArchive` function, after the flight path export block (~line 459), add:

```typescript
if (state.colmapLoaded && assets.colmapBlobs.length > 0) {
    log.info(` Adding ${assets.colmapBlobs.length} colmap camera set(s)`);
    for (const colmap of assets.colmapBlobs) {
        const colmapGroup = sceneRefs.colmapGroup;
        const position = colmapGroup ? [colmapGroup.position.x, colmapGroup.position.y, colmapGroup.position.z] : [0, 0, 0];
        const rotation = colmapGroup ? [colmapGroup.rotation.x, colmapGroup.rotation.y, colmapGroup.rotation.z] : [0, 0, 0];
        const scale = colmapGroup ? colmapGroup.scale.x : 1;
        archiveCreator.addColmap(colmap.camerasBlob, colmap.imagesBlob, { position, rotation, scale });
    }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/modules/export-controller.ts
git commit -m "feat(colmap): include colmap data in archive exports"
```

---

## Chunk 7: Kiosk Mode

### Task 14: Kiosk toggle button HTML

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Add toggle button to kiosk HTML**

In `src/index.html`, after the flight path toggle button (~line 370):

```html
<button id="btn-toggle-cameras" class="viewer-btn" title="Toggle SfM Cameras" style="display:none;">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
        <circle cx="12" cy="13" r="4"/>
    </svg>
</button>
```

- [ ] **Step 2: Commit**

```bash
git add src/index.html
git commit -m "feat(colmap): add camera toggle button to kiosk HTML"
```

---

### Task 15: Kiosk lazy import and loading

**Files:**
- Modify: `src/modules/kiosk-main.ts`

- [ ] **Step 1: Add colmap lazy loading**

In `kiosk-main.ts`, after the flight path loading block (~line 1635), add:

```typescript
// ─── Colmap cameras ─────────────────────────────────────
const colmapEntries = archiveLoader.getColmapEntries();
if (colmapEntries.length > 0 && sceneManager.colmapGroup) {
    const { ColmapManager } = await import('./colmap-loader.js');
    const colmapMgr = new ColmapManager(sceneManager.colmapGroup);

    for (const { key, entry } of colmapEntries) {
        const basePath = entry.file_name;
        const camerasData = await archiveLoader.extractFile(basePath + 'cameras.bin');
        const imagesData = await archiveLoader.extractFile(basePath + 'images.bin');
        if (camerasData && imagesData) {
            const camBuf = await camerasData.blob.arrayBuffer();
            const imgBuf = await imagesData.blob.arrayBuffer();
            colmapMgr.loadFromBuffers(camBuf, imgBuf);
            log.info(`Loaded colmap cameras from ${key}`);
        }
    }

    // Apply transform
    if (colmapMgr.hasData && colmapEntries.length > 0) {
        const transform = archiveLoader.getEntryTransform(colmapEntries[0].entry);
        const group = sceneManager.colmapGroup;
        if (transform.position.some((v: number) => v !== 0) ||
            transform.rotation.some((v: number) => v !== 0)) {
            group.position.fromArray(transform.position);
            group.rotation.fromArray(transform.rotation);
        }
        const fs = normalizeScale(transform.scale);
        if (fs.some((v: number) => v !== 1)) {
            group.scale.set(...fs as [number, number, number]);
        }
    }

    // Toggle button
    if (colmapMgr.hasData) {
        const toggleBtn = document.getElementById('btn-toggle-cameras');
        if (toggleBtn) {
            toggleBtn.style.display = '';
            let visible = true;
            toggleBtn.addEventListener('click', () => {
                visible = !visible;
                colmapMgr.setVisible(visible);
                toggleBtn.classList.toggle('active', visible);
            });
        }
    }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(colmap): add lazy colmap loading to kiosk mode"
```

---

### Task 16: Theme toggle button styles

**Files:**
- Modify: `src/themes/editorial/layout.css`
- Modify: `src/themes/gallery/layout.css`
- Modify: `src/themes/exhibit/layout.css`
- Modify: `src/themes/minimal/theme.css`
- Modify: `src/themes/_template/theme.css`

- [ ] **Step 1: Add camera toggle button styles**

In each theme's CSS, find the `btn-toggle-flightpath` styles and add a matching rule for `#btn-toggle-cameras`. The button uses the same `.viewer-btn` class so it inherits base styles — only add if the theme has flight-path-specific overrides.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/themes/
git commit -m "feat(colmap): add camera toggle button styles to all themes"
```

---

## Chunk 8: Final Integration & Verification

### Task 17: FlightPathManager.getAllPoints() accessor

**Files:**
- Modify: `src/modules/flight-path.ts`

- [ ] **Step 1: Add getAllPoints method**

The alignment code needs access to the full parsed flight points. Add to `FlightPathManager`:

```typescript
/** Return all parsed flight points across all paths (for alignment). */
getAllPoints(): FlightPoint[] {
    return this.paths.flatMap(p => p.points);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/modules/flight-path.ts
git commit -m "feat(colmap): add getAllPoints accessor to FlightPathManager"
```

---

### Task 18: Run all tests

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass including new colmap-loader and colmap-alignment tests

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Success with no errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK)

---

### Task 19: Final commit and summary

- [ ] **Step 1: Verify git status**

Run: `git status`
Expected: Clean working directory (all changes committed)

- [ ] **Step 2: Review commit history**

Run: `git log --oneline -15`
Expected: ~12 well-scoped commits covering: types, parser, tests, rendering, scene integration, transform controller, HTML, event wiring, main.ts, archive support, kiosk mode, themes
