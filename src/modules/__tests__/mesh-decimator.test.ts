// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { dracoCompressGLB } from '../mesh-decimator.js';

// Build a minimal valid GLB blob
function makeMinimalGLB(extensionsUsed?: string[]): Blob {
    const json = JSON.stringify({
        asset: { version: '2.0' },
        ...(extensionsUsed ? { extensionsUsed } : {})
    });
    const jsonBytes = new TextEncoder().encode(json);
    const padded = Math.ceil(jsonBytes.length / 4) * 4;
    const paddedJson = new Uint8Array(padded);
    paddedJson.set(jsonBytes);

    const totalLength = 12 + 8 + padded;
    const buf = new ArrayBuffer(totalLength);
    const view = new DataView(buf);
    view.setUint32(0, 0x46546C67, true); // "glTF"
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);
    view.setUint32(12, padded, true);
    view.setUint32(16, 0x4E4F534A, true); // "JSON"
    new Uint8Array(buf, 20).set(paddedJson);
    return new Blob([buf], { type: 'model/gltf-binary' });
}

describe('dracoCompressGLB', () => {
    it('returns the same blob reference when already Draco-compressed', async () => {
        const blob = makeMinimalGLB(['KHR_draco_mesh_compression']);
        const result = await dracoCompressGLB(blob);
        // Already compressed → skip, return same reference
        expect(result).toBe(blob);
    });
});
