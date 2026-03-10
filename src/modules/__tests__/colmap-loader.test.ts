// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseCamerasBin, parseImagesBin } from '../colmap-loader.js';

/** Build a minimal cameras.bin buffer: 1 PINHOLE camera */
function buildCamerasBin(): ArrayBuffer {
    const size = 8 + 4 + 4 + 8 + 8 + 4 * 8; // 56 bytes
    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    let off = 0;
    view.setUint32(off, 1, true); off += 4;
    view.setUint32(off, 0, true); off += 4;
    view.setUint32(off, 1, true); off += 4;
    view.setInt32(off, 1, true); off += 4;
    view.setUint32(off, 4000, true); off += 4;
    view.setUint32(off, 0, true); off += 4;
    view.setUint32(off, 3000, true); off += 4;
    view.setUint32(off, 0, true); off += 4;
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
    const size = 8 + 4 + 4 * 8 + 3 * 8 + 4 + (nameBytes.length + 1) + 8;
    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    let off = 0;
    view.setUint32(off, 1, true); off += 4;
    view.setUint32(off, 0, true); off += 4;
    view.setUint32(off, 1, true); off += 4;
    view.setFloat64(off, 1.0, true); off += 8;
    view.setFloat64(off, 0.0, true); off += 8;
    view.setFloat64(off, 0.0, true); off += 8;
    view.setFloat64(off, 0.0, true); off += 8;
    view.setFloat64(off, 1.0, true); off += 8;
    view.setFloat64(off, 2.0, true); off += 8;
    view.setFloat64(off, 3.0, true); off += 8;
    view.setUint32(off, 1, true); off += 4;
    for (let i = 0; i < nameBytes.length; i++) {
        view.setUint8(off++, nameBytes[i]);
    }
    view.setUint8(off++, 0);
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
