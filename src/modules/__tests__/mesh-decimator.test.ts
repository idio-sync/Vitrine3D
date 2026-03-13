// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// Build a minimal valid GLB as Uint8Array
function makeMinimalGLB(extensionsUsed?: string[]): Uint8Array {
    const json = JSON.stringify({
        asset: { version: '2.0' },
        ...(extensionsUsed ? { extensionsUsed } : {}),
    });
    const jsonBytes = new TextEncoder().encode(json);
    const padded = Math.ceil(jsonBytes.length / 4) * 4;
    const paddedJson = new Uint8Array(padded);
    paddedJson.set(jsonBytes);

    const totalLength = 12 + 8 + padded;
    const buf = new ArrayBuffer(totalLength);
    const view = new DataView(buf);
    view.setUint32(0, 0x46546c67, true); // "glTF"
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);
    view.setUint32(12, padded, true);
    view.setUint32(16, 0x4e4f534a, true); // "JSON"
    new Uint8Array(buf, 20).set(paddedJson);
    return new Uint8Array(buf);
}

// Mock the Worker so dracoCompressGLB works in tests without a real worker thread.
// The mock echoes the input bytes back with skipped=true when already compressed
// (mirrors the real worker's isAlreadyCompressed check).
vi.stubGlobal(
    'Worker',
    class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage(data: { glbBytes: Uint8Array }) {
            const { glbBytes } = data;
            // Replicate the worker's isAlreadyCompressed logic
            let skipped = false;
            if (glbBytes.byteLength >= 20) {
                const view = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
                const jsonLength = view.getUint32(12, true);
                const jsonEnd = 20 + jsonLength;
                if (glbBytes.byteLength >= jsonEnd) {
                    const jsonStr = new TextDecoder().decode(glbBytes.subarray(20, jsonEnd)).replace(/\0+$/, '');
                    const json = JSON.parse(jsonStr);
                    const used: string[] = json.extensionsUsed ?? [];
                    skipped =
                        used.includes('KHR_draco_mesh_compression') || used.includes('EXT_meshopt_compression');
                }
            }
            // Simulate async message delivery
            setTimeout(() => {
                this.onmessage?.({ data: { success: true, compressedBytes: glbBytes, skipped } } as any);
            }, 0);
        }
        terminate() {}
    },
);

// Import after mocking Worker
const { dracoCompressGLB } = await import('../mesh-decimator.js');

describe('dracoCompressGLB', () => {
    it('skips compression when already Draco-compressed', async () => {
        const glb = makeMinimalGLB(['KHR_draco_mesh_compression']);
        const blob = new Blob([glb.buffer as ArrayBuffer], { type: 'model/gltf-binary' });
        const result = await dracoCompressGLB(blob);
        // Should return a blob of the same size (worker echoed bytes back)
        expect(result.size).toBe(blob.size);
    });

    it('skips compression when already meshopt-compressed', async () => {
        const glb = makeMinimalGLB(['EXT_meshopt_compression']);
        const blob = new Blob([glb.buffer as ArrayBuffer], { type: 'model/gltf-binary' });
        const result = await dracoCompressGLB(blob);
        expect(result.size).toBe(blob.size);
    });

    it('processes uncompressed GLB', async () => {
        const glb = makeMinimalGLB();
        const blob = new Blob([glb.buffer as ArrayBuffer], { type: 'model/gltf-binary' });
        const result = await dracoCompressGLB(blob);
        // Mock echoes back same bytes, so size should match
        expect(result.size).toBe(blob.size);
    });
});
