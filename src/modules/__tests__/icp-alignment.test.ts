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
        expect(idx).toBe(1);
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
