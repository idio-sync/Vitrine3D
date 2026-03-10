/**
 * ICP Alignment Engine
 *
 * Coarse rotation search + iterative closest point refinement
 * for aligning colmap points3D to splat point clouds.
 */

import * as THREE from 'three';
import { Logger } from './utilities.js';

const log = Logger.getLogger('icp-alignment');

// THREE import retained for future ICP transform math
void THREE;

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
