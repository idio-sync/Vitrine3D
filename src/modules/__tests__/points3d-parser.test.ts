// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parsePoints3D } from '../colmap-alignment.js';

function buildPoints3DBin(points: { id: number; x: number; y: number; z: number; r: number; g: number; b: number; error: number; tracks: [number, number][] }[]): ArrayBuffer {
    let size = 8;
    for (const p of points) {
        size += 8 + 24 + 3 + 8 + 8 + p.tracks.length * 8;
    }
    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    let off = 0;

    view.setUint32(off, points.length, true); off += 4;
    view.setUint32(off, 0, true); off += 4;

    for (const p of points) {
        view.setUint32(off, p.id, true); off += 4;
        view.setUint32(off, 0, true); off += 4;
        view.setFloat64(off, p.x, true); off += 8;
        view.setFloat64(off, p.y, true); off += 8;
        view.setFloat64(off, p.z, true); off += 8;
        view.setUint8(off, p.r); off += 1;
        view.setUint8(off, p.g); off += 1;
        view.setUint8(off, p.b); off += 1;
        view.setFloat64(off, p.error, true); off += 8;
        view.setUint32(off, p.tracks.length, true); off += 4;
        view.setUint32(off, 0, true); off += 4;
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
        expect(result!.positions[0]).toBeCloseTo(1.0);
        expect(result!.positions[1]).toBeCloseTo(-2.0);
        expect(result!.positions[2]).toBeCloseTo(-3.0);
        expect(result!.positions[3]).toBeCloseTo(4.0);
        expect(result!.positions[4]).toBeCloseTo(-5.0);
        expect(result!.positions[5]).toBeCloseTo(-6.0);
        expect(result!.positions[6]).toBeCloseTo(7.0);
        expect(result!.positions[7]).toBeCloseTo(-8.0);
        expect(result!.positions[8]).toBeCloseTo(-9.0);
        expect(result!.count).toBe(3);
    });

    it('returns null for empty buffer', () => {
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        view.setUint32(0, 0, true);
        expect(parsePoints3D(buf)).toBeNull();
    });

    it('returns null for buffer too small', () => {
        expect(parsePoints3D(new ArrayBuffer(4))).toBeNull();
    });

    it('subsamples when count exceeds maxPoints', () => {
        const points = Array.from({ length: 100 }, (_, i) => ({
            id: i, x: i, y: i * 2, z: i * 3, r: 0, g: 0, b: 0, error: 0, tracks: [] as [number, number][],
        }));
        const buf = buildPoints3DBin(points);
        const result = parsePoints3D(buf, 10);
        expect(result).not.toBeNull();
        expect(result!.count).toBeLessThanOrEqual(10);
        expect(result!.positions.length).toBe(result!.count * 3);
    });
});
