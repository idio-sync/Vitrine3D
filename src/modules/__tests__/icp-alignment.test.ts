// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpatialHash, generateRotationCandidates, findBestCoarseRotation, runICP } from '../icp-alignment.js';

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

describe('generateRotationCandidates', () => {
    it('generates 24 distinct rotations', () => {
        const candidates = generateRotationCandidates();
        expect(candidates).toHaveLength(24);
        for (const q of candidates) {
            const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
            expect(len).toBeCloseTo(1.0, 5);
        }
    });
});

describe('findBestCoarseRotation', () => {
    it('finds identity when points are already aligned', () => {
        const points = new Float64Array([0,0,0, 1,0,0, 0,1,0, 0,0,1, 1,1,0, 1,0,1]);
        const result = findBestCoarseRotation(points, 6, points, 6);
        expect(Math.abs(result.w)).toBeGreaterThan(0.9);
    });

    it('finds 180° X rotation for Y/Z-flipped points', () => {
        const source = new Float64Array([1,2,3, 4,5,6, 7,8,9]);
        const target = new Float64Array([1,-2,-3, 4,-5,-6, 7,-8,-9]);
        const result = findBestCoarseRotation(source, 3, target, 3);
        const v = new THREE.Vector3(1, 2, 3).applyQuaternion(result);
        expect(v.x).toBeCloseTo(1, 1);
        expect(v.y).toBeCloseTo(-2, 1);
        expect(v.z).toBeCloseTo(-3, 1);
    });
});

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
        // Use a richer non-degenerate point set to avoid SVD collapse
        const source = new Float64Array([1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1]);
        const target = new Float64Array([3,0,0, -3,0,0, 0,3,0, 0,-3,0, 0,0,3, 0,0,-3]);
        const result = runICP(source, 6, target, 6);
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
