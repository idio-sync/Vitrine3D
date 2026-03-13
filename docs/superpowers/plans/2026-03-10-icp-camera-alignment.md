# ICP Camera Data Alignment — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add points3D.bin import and ICP-based auto-alignment so colmap cameras (and flight paths) automatically align to splats with one button click.

**Architecture:** New `icp-alignment.ts` module for the ICP engine (spatial hash, coarse rotation search, iterative refinement). Extend `ColmapManager` in `colmap-loader.ts` to store points3D data. Add `parsePoints3D()` to `colmap-alignment.ts`. Wire a new "Align from Camera Data" button in the Transform pane's Alignment section. Extend archive creator/loader to serialize points3D.bin.

**Tech Stack:** TypeScript, Three.js (Vector3, Quaternion, Matrix4), existing Umeyama from `colmap-alignment.ts`, Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-03-10-icp-camera-alignment-design.md`

---

## Chunk 1: points3D.bin Parser + ColmapManager Storage

### Task 1: parsePoints3D — failing tests

**Files:**
- Create: `src/modules/__tests__/points3d-parser.test.ts`

- [ ] **Step 1: Write test for parsePoints3D with a synthetic binary buffer**

The test must build a valid points3D.bin buffer by hand. Format per point:
- point3D_id: uint64 (8 bytes)
- xyz: 3× float64 (24 bytes)
- rgb: 3× uint8 (3 bytes)
- error: float64 (8 bytes)
- track_length: uint64 (8 bytes)
- track_length × 8 bytes of track data (image_id: int32 + point2d_idx: int32)

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parsePoints3D } from '../colmap-alignment.js';

function buildPoints3DBin(points: { id: number; x: number; y: number; z: number; r: number; g: number; b: number; error: number; tracks: [number, number][] }[]): ArrayBuffer {
    // Calculate total size
    let size = 8; // num_points uint64
    for (const p of points) {
        size += 8 + 24 + 3 + 8 + 8 + p.tracks.length * 8; // id + xyz + rgb + error + track_length + tracks
    }
    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    let off = 0;

    // num_points as uint64 (little-endian)
    view.setUint32(off, points.length, true); off += 4;
    view.setUint32(off, 0, true); off += 4; // high 32 bits

    for (const p of points) {
        // point3D_id
        view.setUint32(off, p.id, true); off += 4;
        view.setUint32(off, 0, true); off += 4;
        // xyz
        view.setFloat64(off, p.x, true); off += 8;
        view.setFloat64(off, p.y, true); off += 8;
        view.setFloat64(off, p.z, true); off += 8;
        // rgb
        view.setUint8(off, p.r); off += 1;
        view.setUint8(off, p.g); off += 1;
        view.setUint8(off, p.b); off += 1;
        // error
        view.setFloat64(off, p.error, true); off += 8;
        // track_length
        view.setUint32(off, p.tracks.length, true); off += 4;
        view.setUint32(off, 0, true); off += 4;
        // track entries
        for (const [imgId, pt2dIdx] of p.tracks) {
            view.setInt32(off, imgId, true); off += 4;
            view.setInt32(off, pt2dIdx, true); off += 4;
        }
    }
    return buf;
}

describe('parsePoints3D', () => {
    it('parses a 3-point buffer correctly', () => {
        const buf = buildPoints3DBin([
            { id: 1, x: 1.0, y: 2.0, z: 3.0, r: 255, g: 0, b: 0, error: 0.5, tracks: [[0, 10], [1, 20]] },
            { id: 2, x: 4.0, y: 5.0, z: 6.0, r: 0, g: 255, b: 0, error: 0.3, tracks: [[0, 30]] },
            { id: 3, x: 7.0, y: 8.0, z: 9.0, r: 0, g: 0, b: 255, error: 0.1, tracks: [] },
        ]);
        const result = parsePoints3D(buf);
        expect(result).not.toBeNull();
        // Positions are coordinate-converted: Y and Z negated
        // Point 1: (1.0, -2.0, -3.0)
        expect(result!.positions[0]).toBeCloseTo(1.0);
        expect(result!.positions[1]).toBeCloseTo(-2.0);
        expect(result!.positions[2]).toBeCloseTo(-3.0);
        // Point 2: (4.0, -5.0, -6.0)
        expect(result!.positions[3]).toBeCloseTo(4.0);
        expect(result!.positions[4]).toBeCloseTo(-5.0);
        expect(result!.positions[5]).toBeCloseTo(-6.0);
        // Point 3: (7.0, -8.0, -9.0)
        expect(result!.positions[6]).toBeCloseTo(7.0);
        expect(result!.positions[7]).toBeCloseTo(-8.0);
        expect(result!.positions[8]).toBeCloseTo(-9.0);
        expect(result!.count).toBe(3);
    });

    it('returns null for empty buffer', () => {
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        view.setUint32(0, 0, true); // 0 points
        expect(parsePoints3D(buf)).toBeNull();
    });

    it('returns null for buffer too small', () => {
        expect(parsePoints3D(new ArrayBuffer(4))).toBeNull();
    });

    it('subsamples when count exceeds maxPoints', () => {
        // Build 100 points, request max 10
        const points = Array.from({ length: 100 }, (_, i) => ({
            id: i, x: i, y: i * 2, z: i * 3, r: 0, g: 0, b: 0, error: 0, tracks: [] as [number, number][],
        }));
        const buf = buildPoints3DBin(points);
        const result = parsePoints3D(buf, 10);
        expect(result).not.toBeNull();
        expect(result!.count).toBeLessThanOrEqual(10);
        // Positions array length should be 3 × count
        expect(result!.positions.length).toBe(result!.count * 3);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/__tests__/points3d-parser.test.ts`
Expected: FAIL — `parsePoints3D` is not exported from `colmap-alignment.ts`

### Task 2: parsePoints3D — implementation

**Files:**
- Modify: `src/modules/colmap-alignment.ts`

- [ ] **Step 3: Add parsePoints3D to colmap-alignment.ts**

Add after the existing imports, reusing the `readUint64` pattern from `colmap-loader.ts`:

```typescript
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
 *
 * Returns null if the buffer is empty or too small.
 * If the file contains more than maxPoints, subsamples with uniform stride.
 */
export function parsePoints3D(buffer: ArrayBuffer, maxPoints = 20000): Points3DResult | null {
    if (buffer.byteLength < 8) return null;
    const view = new DataView(buffer);
    const numPoints = readUint64(view, 0);
    if (numPoints === 0) return null;

    // First pass: collect byte offsets for each point (variable-length records)
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
        off += trackLength * 8; // track entries (int32 + int32 each)
    }

    // Determine stride for subsampling
    const stride = numPoints > maxPoints ? Math.ceil(numPoints / maxPoints) : 1;
    const sampleCount = Math.ceil(numPoints / stride);
    const positions = new Float64Array(sampleCount * 3);
    let outIdx = 0;

    for (let i = 0; i < numPoints; i += stride) {
        const pOff = offsets[i] + 8; // skip point3D_id to reach xyz
        const x = view.getFloat64(pOff, true);
        const y = view.getFloat64(pOff + 8, true);
        const z = view.getFloat64(pOff + 16, true);
        // Convert Colmap → Three.js: negate Y and Z
        positions[outIdx++] = x;
        positions[outIdx++] = -y;
        positions[outIdx++] = -z;
    }

    // Trim if fewer than expected (shouldn't happen, but defensive)
    const actualCount = outIdx / 3;
    const trimmed = actualCount < sampleCount ? positions.slice(0, actualCount * 3) : positions;

    log.info(`Parsed ${numPoints} points from points3D.bin, sampled ${actualCount} (stride ${stride})`);
    return { positions: trimmed, count: actualCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/__tests__/points3d-parser.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/colmap-alignment.ts src/modules/__tests__/points3d-parser.test.ts
git commit -m "feat(alignment): add points3D.bin parser with coordinate conversion"
```

### Task 3: ColmapManager — store points3D

**Files:**
- Modify: `src/modules/colmap-loader.ts`

- [ ] **Step 6: Add points3D storage to ColmapManager**

In `ColmapManager` class, add:
- A `private _points3D: Float64Array | null = null;` field
- A `private _points3DCount = 0;` field
- A getter `get points3D(): Float64Array | null { return this._points3D; }`
- A getter `get points3DCount(): number { return this._points3DCount; }`
- A getter `get hasPoints3D(): boolean { return this._points3D !== null && this._points3DCount > 0; }`
- A method `loadPoints3D(positions: Float64Array, count: number): void` that stores them
- Update `dispose()` to clear `_points3D`

```typescript
// Add these fields after the existing private fields:
private _points3D: Float64Array | null = null;
private _points3DCount = 0;

// Add these getters after existing getters:
get points3D(): Float64Array | null { return this._points3D; }
get points3DCount(): number { return this._points3DCount; }
get hasPoints3D(): boolean { return this._points3D !== null && this._points3DCount > 0; }

// Add this method after loadFromBuffers:
/** Store parsed points3D positions (already coordinate-converted). */
loadPoints3D(positions: Float64Array, count: number): void {
    this._points3D = positions;
    this._points3DCount = count;
    log.info(`Stored ${count} points3D positions`);
}
```

In `dispose()`, add before `this.cameras = [];`:
```typescript
this._points3D = null;
this._points3DCount = 0;
```

- [ ] **Step 7: Run existing colmap-loader tests**

Run: `npx vitest run src/modules/__tests__/colmap-loader.test.ts`
Expected: PASS (existing tests unaffected)

- [ ] **Step 8: Commit**

```bash
git add src/modules/colmap-loader.ts
git commit -m "feat(colmap): add points3D storage to ColmapManager"
```

---

## Chunk 2: ICP Alignment Engine

### Task 4: Spatial hash — failing tests

**Files:**
- Create: `src/modules/__tests__/icp-alignment.test.ts`

- [ ] **Step 9: Write spatial hash tests**

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { SpatialHash } from '../icp-alignment.js';

describe('SpatialHash', () => {
    it('finds nearest neighbor in same cell', () => {
        const points = new Float64Array([0, 0, 0,  1, 0, 0,  0, 1, 0]);
        const hash = new SpatialHash(points, 3, 2.0);
        const [idx, distSq] = hash.findNearest(0.1, 0.1, 0.1);
        expect(idx).toBe(0);
        expect(distSq).toBeCloseTo(0.03, 2);
    });

    it('finds nearest neighbor across cells', () => {
        const points = new Float64Array([10, 10, 10,  0, 0, 0]);
        const hash = new SpatialHash(points, 2, 1.0);
        const [idx, distSq] = hash.findNearest(0.5, 0.5, 0.5);
        expect(idx).toBe(1); // (0,0,0) is closer than (10,10,10)
        expect(distSq).toBeCloseTo(0.75, 2);
    });

    it('handles single point', () => {
        const points = new Float64Array([5, 5, 5]);
        const hash = new SpatialHash(points, 1, 1.0);
        const [idx, distSq] = hash.findNearest(6, 5, 5);
        expect(idx).toBe(0);
        expect(distSq).toBeCloseTo(1.0, 2);
    });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run src/modules/__tests__/icp-alignment.test.ts`
Expected: FAIL — `SpatialHash` not found

### Task 5: Spatial hash — implementation

**Files:**
- Create: `src/modules/icp-alignment.ts`

- [ ] **Step 11: Implement SpatialHash class**

```typescript
/**
 * ICP Alignment Engine
 *
 * Coarse rotation search + iterative closest point refinement
 * for aligning colmap points3D to splat point clouds.
 */

import * as THREE from 'three';
import { computeSimilarityTransform } from './colmap-alignment.js';
import type { SimilarityTransformResult } from './colmap-alignment.js';
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

        // If no neighbor found in 3×3×3, brute force (rare, only if cellSize is too small)
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
```

- [ ] **Step 12: Run spatial hash tests**

Run: `npx vitest run src/modules/__tests__/icp-alignment.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 13: Commit**

```bash
git add src/modules/icp-alignment.ts src/modules/__tests__/icp-alignment.test.ts
git commit -m "feat(alignment): add SpatialHash for nearest-neighbor lookup"
```

### Task 6: Coarse rotation search — tests + implementation

**Files:**
- Modify: `src/modules/__tests__/icp-alignment.test.ts`
- Modify: `src/modules/icp-alignment.ts`

- [ ] **Step 14: Write coarse rotation search tests**

Add to `icp-alignment.test.ts`:

```typescript
import { SpatialHash, generateRotationCandidates, findBestCoarseRotation } from '../icp-alignment.js';

describe('generateRotationCandidates', () => {
    it('generates 24 distinct rotations', () => {
        const candidates = generateRotationCandidates();
        expect(candidates).toHaveLength(24);
        // All should be valid unit quaternions
        for (const q of candidates) {
            const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
            expect(len).toBeCloseTo(1.0, 5);
        }
    });
});

describe('findBestCoarseRotation', () => {
    it('finds identity when points are already aligned', () => {
        // Source and target are the same point cloud
        const points = new Float64Array([0,0,0, 1,0,0, 0,1,0, 0,0,1, 1,1,0, 1,0,1]);
        const result = findBestCoarseRotation(points, 6, points, 6);
        // Best rotation should be near identity (w ≈ 1)
        expect(Math.abs(result.w)).toBeGreaterThan(0.9);
    });

    it('finds 180° X rotation for Y/Z-flipped points', () => {
        // Source is the "correct" cloud
        const source = new Float64Array([1,2,3, 4,5,6, 7,8,9]);
        // Target has Y and Z negated (180° around X)
        const target = new Float64Array([1,-2,-3, 4,-5,-6, 7,-8,-9]);
        const result = findBestCoarseRotation(source, 3, target, 3);
        // Apply result rotation to source[0] and check it matches target[0]
        const v = new THREE.Vector3(1, 2, 3).applyQuaternion(result);
        expect(v.x).toBeCloseTo(1, 1);
        expect(v.y).toBeCloseTo(-2, 1);
        expect(v.z).toBeCloseTo(-3, 1);
    });
});
```

- [ ] **Step 15: Run test to verify it fails**

Run: `npx vitest run src/modules/__tests__/icp-alignment.test.ts`
Expected: FAIL — `generateRotationCandidates` and `findBestCoarseRotation` not found

- [ ] **Step 16: Implement coarse rotation search**

Add to `icp-alignment.ts`:

```typescript
/**
 * Generate 24 rotation candidates covering all principal axis orientations
 * (all combinations of 90° rotations around X, Y, Z).
 */
export function generateRotationCandidates(): THREE.Quaternion[] {
    const candidates: THREE.Quaternion[] = [];
    const angles = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];

    // Iterate all three Euler axes to cover the full 24-element chiral octahedral group
    for (const ax of angles) {
        for (const ay of angles) {
            for (const az of angles) {
                const q = new THREE.Quaternion()
                    .setFromEuler(new THREE.Euler(ax, ay, az, 'XYZ'));
                // Deduplicate: q and -q represent the same rotation
                const isDuplicate = candidates.some(c =>
                    Math.abs(c.dot(q)) > 0.999
                );
                if (!isDuplicate) candidates.push(q);
            }
        }
    }

    // Should produce 24 unique rotations (the chiral octahedral group)
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
 * Evaluates each by rotating source, centroid-aligning to target,
 * and computing sum of nearest-neighbor distances.
 */
export function findBestCoarseRotation(
    source: Float64Array, sourceCount: number,
    target: Float64Array, targetCount: number,
    maxSamplePoints = 2000
): THREE.Quaternion {
    const candidates = generateRotationCandidates();

    // Subsample for speed
    const srcSub = subsample(source, sourceCount, maxSamplePoints);
    const tgtSub = subsample(target, targetCount, maxSamplePoints);

    const tgtCentroid = computeCentroidFlat(tgtSub.points, tgtSub.count);

    // Estimate cell size from target bounding box
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
    const cellSize = extent / 20; // ~20 cells along longest axis

    const targetHash = new SpatialHash(tgtSub.points, tgtSub.count, cellSize);

    let bestScore = Infinity;
    let bestQ = candidates[0];

    for (const q of candidates) {
        // Rotate source points and compute centroid
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

        // Score: sum of squared nearest-neighbor distances after centroid alignment
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
```

- [ ] **Step 17: Run tests**

Run: `npx vitest run src/modules/__tests__/icp-alignment.test.ts`
Expected: PASS (all tests including new ones)

- [ ] **Step 18: Commit**

```bash
git add src/modules/icp-alignment.ts src/modules/__tests__/icp-alignment.test.ts
git commit -m "feat(alignment): add coarse rotation search with 24 principal axis candidates"
```

### Task 7: ICP refinement loop — tests + implementation

**Files:**
- Modify: `src/modules/__tests__/icp-alignment.test.ts`
- Modify: `src/modules/icp-alignment.ts`

- [ ] **Step 19: Write ICP refinement tests**

Add to `icp-alignment.test.ts`:

```typescript
import { SpatialHash, generateRotationCandidates, findBestCoarseRotation, runICP } from '../icp-alignment.js';

describe('runICP', () => {
    it('converges on identity for identical point clouds', () => {
        const points = new Float64Array([0,0,0, 5,0,0, 0,5,0, 0,0,5, 3,3,0, 3,0,3]);
        const result = runICP(points, 6, points, 6);
        expect(result).not.toBeNull();
        expect(result!.rmse).toBeCloseTo(0, 1);
        expect(result!.scale).toBeCloseTo(1, 1);
        expect(result!.converged).toBe(true);
    });

    it('recovers pure translation', () => {
        const source = new Float64Array([0,0,0, 1,0,0, 0,1,0, 0,0,1]);
        const target = new Float64Array([10,0,0, 11,0,0, 10,1,0, 10,0,1]);
        const result = runICP(source, 4, target, 4);
        expect(result).not.toBeNull();
        expect(result!.translation.x).toBeCloseTo(10, 0);
        expect(result!.rmse).toBeLessThan(0.5);
        expect(result!.converged).toBe(true);
    });

    it('recovers uniform scale', () => {
        const source = new Float64Array([0,0,0, 1,0,0, 0,1,0, 0,0,1]);
        const target = new Float64Array([0,0,0, 3,0,0, 0,3,0, 0,0,3]);
        const result = runICP(source, 4, target, 4);
        expect(result).not.toBeNull();
        expect(result!.scale).toBeCloseTo(3, 0);
        expect(result!.converged).toBe(true);
    });

    it('returns null for insufficient points', () => {
        const source = new Float64Array([0,0,0, 1,0,0]);
        const target = new Float64Array([0,0,0, 1,0,0]);
        expect(runICP(source, 2, target, 2)).toBeNull();
    });
});
```

- [ ] **Step 20: Run test to verify it fails**

Run: `npx vitest run src/modules/__tests__/icp-alignment.test.ts`
Expected: FAIL — `runICP` not found

- [ ] **Step 21: Implement ICP refinement loop**

Add to `icp-alignment.ts`:

```typescript
export interface ICPResult {
    rotation: THREE.Quaternion;
    scale: number;
    translation: THREE.Vector3;
    rmse: number;
    matchCount: number;
    converged: boolean;
}

/**
 * Run ICP refinement starting from the best coarse rotation.
 *
 * Source points are transformed to match target points.
 * Uses Umeyama (via computeSimilarityTransform) at each iteration
 * to compute the optimal similarity transform.
 *
 * @param source Flat xyz Float64Array of source points (points3D, coordinate-converted)
 * @param sourceCount Number of source points
 * @param target Flat xyz Float64Array of target points (splat world-space)
 * @param targetCount Number of target points
 * @param maxIterations Maximum ICP iterations (default 30)
 * @param convergenceThreshold Stop when RMSE delta < this (default 1e-6)
 */
export function runICP(
    source: Float64Array, sourceCount: number,
    target: Float64Array, targetCount: number,
    maxIterations = 30,
    convergenceThreshold = 1e-6
): ICPResult | null {
    if (sourceCount < 3 || targetCount < 3) return null;

    // Step 1: Coarse rotation search
    const coarseQ = findBestCoarseRotation(source, sourceCount, target, targetCount);

    // Apply coarse rotation to source
    let currentSource = new Float64Array(sourceCount * 3);
    for (let i = 0; i < sourceCount; i++) {
        const v = new THREE.Vector3(source[i * 3], source[i * 3 + 1], source[i * 3 + 2])
            .applyQuaternion(coarseQ);
        currentSource[i * 3] = v.x;
        currentSource[i * 3 + 1] = v.y;
        currentSource[i * 3 + 2] = v.z;
    }

    // Centroid-align after coarse rotation
    const srcCentroid = computeCentroidFlat(currentSource, sourceCount);
    const tgtCentroid = computeCentroidFlat(target, targetCount);
    const initOffset = tgtCentroid.clone().sub(srcCentroid);
    for (let i = 0; i < sourceCount; i++) {
        currentSource[i * 3] += initOffset.x;
        currentSource[i * 3 + 1] += initOffset.y;
        currentSource[i * 3 + 2] += initOffset.z;
    }

    // Estimate spatial hash cell size from target extent
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
    let lastInlierCount = sourceCount;

    for (let iter = 0; iter < maxIterations; iter++) {
        // Find closest-point correspondences
        const pairs: { srcIdx: number; tgtDist: number; srcPt: [number, number, number]; tgtPt: [number, number, number] }[] = [];
        for (let i = 0; i < sourceCount; i++) {
            const sx = currentSource[i * 3], sy = currentSource[i * 3 + 1], sz = currentSource[i * 3 + 2];
            const [tgtIdx, distSq] = targetHash.findNearest(sx, sy, sz);
            pairs.push({
                srcIdx: i,
                tgtDist: distSq,
                srcPt: [sx, sy, sz],
                tgtPt: [target[tgtIdx * 3], target[tgtIdx * 3 + 1], target[tgtIdx * 3 + 2]],
            });
        }

        // Reject outliers: distance > 3× median
        pairs.sort((a, b) => a.tgtDist - b.tgtDist);
        const medianDist = pairs[Math.floor(pairs.length / 2)].tgtDist;
        const threshold = medianDist * 9; // 3× median squared = 9× median of squared distances
        const inliers = pairs.filter(p => p.tgtDist <= threshold);

        if (inliers.length < 3) {
            log.warn(`ICP iter ${iter}: only ${inliers.length} inliers, stopping`);
            break;
        }

        // Compute similarity transform on inlier pairs
        const srcPts = inliers.map(p => p.srcPt);
        const tgtPts = inliers.map(p => p.tgtPt);
        const stepResult = computeSimilarityTransform(srcPts, tgtPts);
        if (!stepResult) break;

        // Apply step transform to current source points
        for (let i = 0; i < sourceCount; i++) {
            const v = new THREE.Vector3(currentSource[i * 3], currentSource[i * 3 + 1], currentSource[i * 3 + 2])
                .applyQuaternion(stepResult.rotation)
                .multiplyScalar(stepResult.scale)
                .add(stepResult.translation);
            currentSource[i * 3] = v.x;
            currentSource[i * 3 + 1] = v.y;
            currentSource[i * 3 + 2] = v.z;
        }

        lastInlierCount = inliers.length;

        // Check convergence
        const rmseDelta = Math.abs(prevRmse - stepResult.rmse);
        prevRmse = stepResult.rmse;

        log.debug(`ICP iter ${iter}: RMSE=${stepResult.rmse.toFixed(6)}, inliers=${inliers.length}, scale=${stepResult.scale.toFixed(4)}`);

        if (rmseDelta < convergenceThreshold) {
            log.info(`ICP converged at iteration ${iter}`);
            break;
        }
    }

    // Derive the final transform from original source → converged positions.
    // This avoids accumulated numerical drift from composing incremental transforms.
    // Build matched pairs: original source point → its closest target point (using converged positions).
    const finalPairs: { src: [number, number, number]; tgt: [number, number, number] }[] = [];
    for (let i = 0; i < sourceCount; i++) {
        const cx = currentSource[i * 3], cy = currentSource[i * 3 + 1], cz = currentSource[i * 3 + 2];
        const [tgtIdx, distSq] = targetHash.findNearest(cx, cy, cz);
        // Use a generous threshold (median-based) for final matching
        finalPairs.push({
            src: [source[i * 3], source[i * 3 + 1], source[i * 3 + 2]],
            tgt: [target[tgtIdx * 3], target[tgtIdx * 3 + 1], target[tgtIdx * 3 + 2]],
        });
    }
    // Reject outliers from final pairs too
    const finalDists = finalPairs.map((p, i) => {
        const cx = currentSource[i * 3], cy = currentSource[i * 3 + 1], cz = currentSource[i * 3 + 2];
        const [, d] = targetHash.findNearest(cx, cy, cz);
        return d;
    });
    finalDists.sort((a, b) => a - b);
    const finalMedian = finalDists[Math.floor(finalDists.length / 2)];
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
```

- [ ] **Step 22: Run tests**

Run: `npx vitest run src/modules/__tests__/icp-alignment.test.ts`
Expected: PASS (all tests)

- [ ] **Step 23: Commit**

```bash
git add src/modules/icp-alignment.ts src/modules/__tests__/icp-alignment.test.ts
git commit -m "feat(alignment): add ICP refinement loop with outlier rejection"
```

### Task 8: sampleSplatPoints helper

**Files:**
- Modify: `src/modules/icp-alignment.ts`

- [ ] **Step 24: Add sampleSplatPoints function**

This extracts world-space positions from a SplatMesh, reusing the pattern from `alignment.ts` `computeSplatBoundsFromPositions`.

```typescript
/**
 * Sample world-space positions from a SplatMesh.
 * Applies matrixWorld to each point (accounts for Math.PI X-rotation on load).
 */
export function sampleSplatPoints(
    splatMesh: THREE.Object3D,
    maxCount = 20000
): { points: Float64Array; count: number } | null {
    splatMesh.updateMatrixWorld(true);
    const worldMatrix = splatMesh.matrixWorld;

    const mesh = splatMesh as any; // SplatMesh type
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
```

- [ ] **Step 25: Commit**

```bash
git add src/modules/icp-alignment.ts
git commit -m "feat(alignment): add sampleSplatPoints world-space extractor"
```

---

## Chunk 3: Update Types (must come before event-wiring changes)

### Task 9: Update types for colmap deps

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 26a: Update ExportAssets type to include points3DBuffer**

In `src/types.ts`, find the `colmapBlobs` field in `ExportAssets` (~line 270) and extend:

```typescript
colmapBlobs: Array<{ camerasBlob: Blob; imagesBlob: Blob; points3DBuffer?: ArrayBuffer }>;
```

- [ ] **Step 26b: Update EventWiringDeps colmap section**

In `EventWiringDeps` in `types.ts`, extend the colmap section:

```typescript
colmap: {
    loadFromBuffers: (cameras: ArrayBuffer, images: ArrayBuffer) => void;
    setDisplayMode: (mode: string) => void;
    setFrustumScale: (scale: number) => void;
    alignFlightPath: () => void;
    // New for ICP alignment:
    hasData: boolean;
    hasPoints3D: boolean;
    loadPoints3D: (positions: Float64Array, count: number) => void;
    points3DBuffer: ArrayBuffer | null;
    alignFromCameraData: () => Promise<void>;
};
```

- [ ] **Step 26c: Update ArchivePipelineDeps colmap section**

Add a `colmap` property to `ArchivePipelineDeps` with `loadPoints3D` and `points3DBuffer`:

```typescript
// In ArchivePipelineDeps, add or extend colmap:
colmap?: {
    loadFromBuffers: (cameras: ArrayBuffer, images: ArrayBuffer) => void;
    loadPoints3D?: (positions: Float64Array, count: number) => void;
    points3DBuffer?: ArrayBuffer | null;
};
```

- [ ] **Step 26d: Run build**

Run: `npm run build`
Expected: Build succeeds (existing code still satisfies the extended interfaces via optional fields)

- [ ] **Step 26e: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add points3D and ICP alignment to deps interfaces"
```

---

## Chunk 4: UI — points3D Input, Alignment Button, Export Checkbox

### Task 10: HTML — points3D.bin input in SfM Cameras section

**Files:**
- Modify: `src/editor/index.html:1729-1747`

- [ ] **Step 26: Add points3D.bin file input and status indicators**

In the SfM Cameras section (`editor/index.html` ~line 1729), add a third button for `points3D.bin` and per-file status indicators:

After the existing `prop-btn-row` with cameras.bin and images.bin labels (~line 1731), add:

```html
<!-- Add after the existing prop-btn-row (cameras.bin + images.bin) -->
<label for="colmap-points3d-input" class="prop-btn" style="cursor:pointer; margin-top:4px;"><span style="color:#CE93D8;">+</span> points3D.bin</label>
<input type="file" id="colmap-points3d-input" accept=".bin" style="display:none" />
<div id="colmap-file-status" class="prop-hint" style="margin-top:4px;">
    <span id="colmap-status-cameras">&#9675; cameras.bin</span><br>
    <span id="colmap-status-images">&#9675; images.bin</span><br>
    <span id="colmap-status-points3d">&#9675; points3D.bin</span>
</div>
```

Replace the existing `<span id="colmap-filename" class="prop-hint">.bin (Colmap sparse)</span>` with the status div above.

- [ ] **Step 27: Add "Align from Camera Data" button in Alignment section**

In the Alignment section (`editor/index.html` ~line 1520), add a new button after the existing buttons:

```html
<button class="prop-btn mt4" id="btn-align-from-camera-data" disabled title="Load camera data (cameras.bin, images.bin, points3D.bin) to enable">Align from Camera Data</button>
<span id="icp-align-result" class="prop-hint mt4" style="display:none;"></span>
```

Add after the existing `btn-reset-alignment` button (~line 1526), before the closing `</div>` of the section body.

- [ ] **Step 28: Add "Include camera data" checkbox in export dialog**

Find the export/download dialog section. Add a checkbox:

```html
<div class="metadata-field" style="margin-top:8px;">
    <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
        <input type="checkbox" id="chk-export-camera-data" />
        <span style="font-size:12px;">Include camera data</span>
    </label>
    <span class="prop-hint">cameras.bin, images.bin, points3D.bin</span>
</div>
```

- [ ] **Step 29: Run build to verify HTML is valid**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 30: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(editor): add points3D.bin input, alignment button, and export checkbox"
```

### Task 10: Wire points3D file input in event-wiring.ts

**Files:**
- Modify: `src/modules/event-wiring.ts:1192-1215`

- [ ] **Step 31: Add points3D file input handler and status update logic**

In `event-wiring.ts`, in the SfM Camera settings section (~line 1192), extend the existing colmap wiring:

```typescript
// Add after existing pendingImagesBin declaration (~line 1194):
let pendingPoints3DBin: ArrayBuffer | null = null;

// Add a status update helper:
const updateColmapStatus = () => {
    const camEl = document.getElementById('colmap-status-cameras');
    const imgEl = document.getElementById('colmap-status-images');
    const ptsEl = document.getElementById('colmap-status-points3d');
    if (camEl) camEl.textContent = pendingCamerasBin || deps.colmap.hasData ? '● cameras.bin' : '○ cameras.bin';
    if (imgEl) imgEl.textContent = pendingImagesBin || deps.colmap.hasData ? '● images.bin' : '○ images.bin';
    if (ptsEl) ptsEl.textContent = deps.colmap.hasPoints3D ? '● points3D.bin' : '○ points3D.bin';

    // Enable/disable alignment button
    const alignBtn = document.getElementById('btn-align-from-camera-data') as HTMLButtonElement | null;
    if (alignBtn) {
        const ready = deps.colmap.hasData && deps.colmap.hasPoints3D && deps.state.splatLoaded;
        alignBtn.disabled = !ready;
        alignBtn.title = ready ? 'Auto-align using ICP on camera data' : 'Load camera data (cameras.bin, images.bin, points3D.bin) and a splat to enable';
    }
};

// Modify existing tryLoadColmap to call updateColmapStatus:
const tryLoadColmap = () => {
    if (!pendingCamerasBin || !pendingImagesBin) return;
    deps.colmap.loadFromBuffers(pendingCamerasBin, pendingImagesBin);
    pendingCamerasBin = null;
    pendingImagesBin = null;
    updateColmapStatus();
};
```

Update the existing camera/images input handlers to call `updateColmapStatus()` after setting pending buffers.

Add the points3D input handler after the images handler:

```typescript
addListener('colmap-points3d-input', 'change', async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const { parsePoints3D } = await import('./colmap-alignment.js');
    const result = parsePoints3D(buffer);
    if (result) {
        deps.colmap.loadPoints3D(result.positions, result.count);
        // Store raw buffer for archive export
        deps.colmap.points3DBuffer = buffer;
    }
    updateColmapStatus();
});
```

- [ ] **Step 32: Wire the "Align from Camera Data" button**

Add in `event-wiring.ts` after the colmap section:

```typescript
addListener('btn-align-from-camera-data', 'click', async () => {
    if (deps.colmap.alignFromCameraData) {
        await deps.colmap.alignFromCameraData();
    }
});
```

The actual alignment logic will be wired in main.ts (Task 11) via the deps pattern.

- [ ] **Step 33: Commit**

```bash
git add src/modules/event-wiring.ts
git commit -m "feat(editor): wire points3D.bin input and alignment button events"
```

### Task 11: Wire alignment pipeline in main.ts

**Files:**
- Modify: `src/main.ts`
- Modify: `src/modules/colmap-loader.ts` (add `points3DBuffer` field)

- [ ] **Step 34: Add points3DBuffer to ColmapManager**

In `colmap-loader.ts`, add a public field to store the raw buffer for archive export:

```typescript
/** Raw buffer for archive export (set externally). */
points3DBuffer: ArrayBuffer | null = null;
```

Clear it in `dispose()`.

- [ ] **Step 35: Add alignFromCameraData to colmap deps in main.ts**

In `main.ts`, in the colmap deps section (~line 817), add the `alignFromCameraData` method and update `hasPoints3D` getter:

```typescript
// Add import at top of main.ts:
import { runICP, sampleSplatPoints } from './modules/icp-alignment.js';
import { parsePoints3D, computeSimilarityTransform } from './modules/colmap-alignment.js';

// In the colmap deps object (~line 817), add:
alignFromCameraData: async () => {
    if (!colmapManager?.hasPoints3D || !splatMesh) {
        notify.error('Load splat + camera data first');
        return;
    }

    showLoading('Auto-aligning from camera data...');

    try {
        // Extract splat world-space points
        const splatSample = sampleSplatPoints(splatMesh);
        if (!splatSample) {
            notify.error('Could not sample splat points');
            return;
        }

        const points3D = colmapManager.points3D!;
        const points3DCount = colmapManager.points3DCount;

        // Run ICP: source = points3D (Colmap, coordinate-converted), target = splat world-space
        const icpResult = runICP(points3D, points3DCount, splatSample.points, splatSample.count);
        if (!icpResult) {
            notify.error('Alignment failed — insufficient point overlap');
            return;
        }

        // Apply transform to colmap group
        const colmapGrp = sceneManager?.colmapGroup;
        if (colmapGrp) {
            colmapGrp.quaternion.copy(icpResult.rotation);
            colmapGrp.scale.setScalar(icpResult.scale);
            colmapGrp.position.copy(icpResult.translation);
            colmapGrp.updateMatrix();
            colmapGrp.updateMatrixWorld(true);
        }

        // Chain flight path alignment if loaded
        if (flightPathManager?.hasData && colmapManager.colmapCameras.length >= 3) {
            const fpGroup = sceneManager?.flightPathGroup;
            if (fpGroup) {
                // Use matchCamerasToFlightPoints for proper correspondence
                // (timestamp matching with sequential fallback)
                const { matchCamerasToFlightPoints } = await import('./modules/colmap-alignment.js');
                const matchedPairs = matchCamerasToFlightPoints(
                    colmapManager.colmapCameras,
                    flightPathManager.getAllPoints()
                );

                if (matchedPairs.length >= 3) {
                    // T_geo: GPS local → Colmap Three.js-convention
                    // source = GPS positions, target = colmap camera positions
                    const gpsSlice = matchedPairs.map(p => p.gpsPos);
                    const colmapSlice = matchedPairs.map(p => p.colmapPos);

                    const tGeo = computeSimilarityTransform(gpsSlice, colmapSlice);
                    if (tGeo) {
                        // Compose: T_flight_to_splat = T_icp ∘ T_geo
                        // Apply T_geo first (GPS → Colmap space), then T_icp (Colmap → splat)
                        const composedQ = icpResult.rotation.clone().multiply(tGeo.rotation);
                        const composedScale = icpResult.scale * tGeo.scale;
                        const composedT = tGeo.translation.clone()
                            .applyQuaternion(icpResult.rotation)
                            .multiplyScalar(icpResult.scale)
                            .add(icpResult.translation);

                        fpGroup.quaternion.copy(composedQ);
                        fpGroup.scale.setScalar(composedScale);
                        fpGroup.position.copy(composedT);
                        fpGroup.updateMatrix();
                        fpGroup.updateMatrixWorld(true);

                        notify.success(`Aligned camera data + flight path — RMSE: ${icpResult.rmse.toFixed(3)}`);
                    } else {
                        notify.success(`Aligned camera data — RMSE: ${icpResult.rmse.toFixed(3)}`);
                        notify.warning('Flight path alignment failed (insufficient GPS↔camera matches)');
                    }
                } else {
                    notify.success(`Aligned camera data — RMSE: ${icpResult.rmse.toFixed(3)}`);
                    notify.warning('Flight path: insufficient camera↔GPS matches (need >= 3)');
                }
            }
        } else {
            notify.success(`Aligned camera data — RMSE: ${icpResult.rmse.toFixed(3)}, ${icpResult.matchCount} matches`);
        }

        // Show result in UI
        const resultEl = document.getElementById('icp-align-result');
        if (resultEl) {
            resultEl.style.display = '';
            resultEl.textContent = `RMSE: ${icpResult.rmse.toFixed(3)} | ${icpResult.matchCount} matches | ${icpResult.converged ? 'converged' : 'max iter'}`;
        }

        updateTransformInputs();
        storeLastPositions();
    } catch (err) {
        log.error('Alignment failed:', err);
        notify.error('Alignment failed — see console for details');
    } finally {
        hideLoading();
    }
},
```

Also update the `hasPoints3D` getter in the deps:

```typescript
get hasPoints3D() { return colmapManager?.hasPoints3D ?? false; },
```

- [ ] **Step 36: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 37: Commit**

```bash
git add src/main.ts src/modules/colmap-loader.ts
git commit -m "feat(alignment): wire ICP alignment pipeline in main.ts"
```

---

## Chunk 4: Archive Support

### Task 12: Archive creator — include points3D.bin

**Files:**
- Modify: `src/modules/archive-creator.ts:1508-1530`

- [ ] **Step 38: Extend addColmap to accept optional points3DBlob**

Update the `addColmap` method signature and implementation:

```typescript
addColmap(camerasBlob: Blob, imagesBlob: Blob, options: AddAssetOptions & { points3DBlob?: Blob } = {}): string {
    const index = this._countEntriesOfType('colmap_sfm_');
    const entryKey = `colmap_sfm_${index}`;

    this.files.set(`assets/colmap_sfm_${index}/cameras.bin`, { blob: camerasBlob, originalName: 'cameras.bin' });
    this.files.set(`assets/colmap_sfm_${index}/images.bin`, { blob: imagesBlob, originalName: 'images.bin' });
    if (options.points3DBlob) {
        this.files.set(`assets/colmap_sfm_${index}/points3D.bin`, { blob: options.points3DBlob, originalName: 'points3D.bin' });
    }

    this.manifest.data_entries[entryKey] = {
        // ... existing manifest entry, add hasPoints3D flag:
        _parameters: {
            position: options.position || [0, 0, 0],
            rotation: options.rotation || [0, 0, 0],
            scale: options.scale ?? 1,
            hasPoints3D: !!options.points3DBlob,
        },
        // ... rest of existing entry
    };
    // ... rest of method
}
```

- [ ] **Step 39: Update export-controller.ts to pass points3DBlob and respect checkbox**

In `export-controller.ts` (~line 466), update the colmap export section. The checkbox gates the **entire** colmap export (cameras.bin, images.bin, and points3D.bin — all or nothing):

```typescript
// Add colmap data if loaded AND checkbox is checked (checkbox gates entire colmap export)
const includeColmap = (document.getElementById('chk-export-camera-data') as HTMLInputElement)?.checked ?? false;
const colmapGroup = sceneRefs.colmapGroup;
if (state.colmapLoaded && assets.colmapBlobs.length > 0 && includeColmap) {
    log.info(` Adding ${assets.colmapBlobs.length} colmap SfM dataset(s)`);
    for (const { camerasBlob, imagesBlob, points3DBuffer } of assets.colmapBlobs) {
        const position = colmapGroup ? [colmapGroup.position.x, colmapGroup.position.y, colmapGroup.position.z] : [0, 0, 0];
        const rotation = colmapGroup ? [colmapGroup.rotation.x, colmapGroup.rotation.y, colmapGroup.rotation.z] : [0, 0, 0];
        const scale = colmapGroup ? colmapGroup.scale.x : 1;
        const points3DBlob = points3DBuffer ? new Blob([points3DBuffer]) : undefined;
        archiveCreator.addColmap(camerasBlob, imagesBlob, { position, rotation, scale, points3DBlob });
    }
}
```

**How points3DBuffer reaches ExportAssets:** In `event-wiring.ts` (Step 31), when `points3D.bin` is loaded, store the raw `ArrayBuffer` on the matching `colmapBlobs` entry. In `main.ts`, when building the `ExportAssets` object, read `colmapManager.points3DBuffer` and include it in the `colmapBlobs` array entry. The `ExportAssets.colmapBlobs` type is updated in Task 14 to include `points3DBuffer?: ArrayBuffer`.

- [ ] **Step 40: Commit**

```bash
git add src/modules/archive-creator.ts src/modules/export-controller.ts
git commit -m "feat(archive): support points3D.bin in archive export with checkbox"
```

### Task 13: Archive loader — load points3D.bin

**Files:**
- Modify: `src/modules/archive-pipeline.ts:716-722`

- [ ] **Step 41: Extend colmap archive loading to handle points3D.bin**

In `archive-pipeline.ts`, in the colmap loading section (~line 716):

```typescript
for (const [key, entry] of colmapEntries) {
    const basePath = (entry as any).file_name || `assets/${key}/`;
    const camerasBuffer = await archiveLoader.extractFileBuffer(`${basePath}cameras.bin`);
    const imagesBuffer = await archiveLoader.extractFileBuffer(`${basePath}images.bin`);
    if (camerasBuffer && imagesBuffer && deps.colmap) {
        deps.colmap.loadFromBuffers(camerasBuffer, imagesBuffer);

        // Load points3D.bin if present
        const points3DBuffer = await archiveLoader.extractFileBuffer(`${basePath}points3D.bin`);
        if (points3DBuffer && deps.colmap.loadPoints3D) {
            const { parsePoints3D } = await import('./colmap-alignment.js');
            const result = parsePoints3D(points3DBuffer);
            if (result) {
                deps.colmap.loadPoints3D(result.positions, result.count);
                // Store raw buffer for re-export
                deps.colmap.points3DBuffer = points3DBuffer;
            }
        }

        // ... rest of existing transform application
    }
}
```

- [ ] **Step 42: Run build and tests**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests pass

- [ ] **Step 43: Commit**

```bash
git add src/modules/archive-pipeline.ts
git commit -m "feat(archive): load points3D.bin from archives"
```

---

## Chunk 6: Integration Test + Final Verification

### Task 15: Integration smoke test

**Files:**
- Modify: `src/modules/__tests__/icp-alignment.test.ts`

- [ ] **Step 48: Add end-to-end alignment test**

```typescript
describe('full alignment pipeline', () => {
    it('aligns a rotated + translated + scaled point cloud', () => {
        // Create a "building" shape as source (in Colmap space)
        const source = new Float64Array([
            0,0,0, 10,0,0, 10,10,0, 0,10,0,  // floor corners
            0,0,5, 10,0,5, 10,10,5, 0,10,5,   // ceiling corners
            5,5,0, 5,5,5,                        // center points
        ]);

        // Create target: same shape but rotated 90° around Y, scaled 2×, translated (100,50,0)
        const rotQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        const scale = 2;
        const translation = new THREE.Vector3(100, 50, 0);

        const target = new Float64Array(source.length);
        for (let i = 0; i < 10; i++) {
            const v = new THREE.Vector3(source[i*3], source[i*3+1], source[i*3+2])
                .applyQuaternion(rotQ)
                .multiplyScalar(scale)
                .add(translation);
            target[i*3] = v.x; target[i*3+1] = v.y; target[i*3+2] = v.z;
        }

        const result = runICP(source, 10, target, 10);
        expect(result).not.toBeNull();
        expect(result!.rmse).toBeLessThan(1.0);
        expect(result!.scale).toBeCloseTo(2, 0);

        // Verify a transformed source point lands near the corresponding target point
        const testPt = new THREE.Vector3(source[0], source[1], source[2])
            .applyQuaternion(result!.rotation)
            .multiplyScalar(result!.scale)
            .add(result!.translation);
        const targetPt = new THREE.Vector3(target[0], target[1], target[2]);
        expect(testPt.distanceTo(targetPt)).toBeLessThan(2.0);
    });
});
```

- [ ] **Step 49: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 50: Run build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 51: Commit**

```bash
git add src/modules/__tests__/icp-alignment.test.ts
git commit -m "test(alignment): add end-to-end ICP alignment integration test"
```

### Task 16: Final verification

- [ ] **Step 52: Run full test suite and lint**

Run: `npm test && npm run lint`
Expected: All tests pass, 0 lint errors

- [ ] **Step 53: Run build one final time**

Run: `npm run build`
Expected: Clean build, no warnings related to new code

- [ ] **Step 54: Final commit if any cleanup needed**

Only if prior steps required fixes.
