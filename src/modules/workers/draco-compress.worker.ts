/**
 * Web Worker for Draco compression — offloads CPU-heavy gltf-transform
 * WASM processing off the main thread to avoid UI hangs.
 */
import { WebIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

export interface DracoRequest {
    glbBytes: Uint8Array;
}

export interface DracoResponse {
    success: true;
    compressedBytes: Uint8Array;
    skipped: boolean;
}

export interface DracoError {
    success: false;
    error: string;
}

let _io: WebIO | null = null;

async function ensureIO(): Promise<WebIO> {
    if (_io) return _io;
    const [encoderWasm, decoderWasm] = await Promise.all([
        fetch('/draco/draco_encoder.wasm').then((r) => r.arrayBuffer()),
        fetch('/draco/draco_decoder_gltf.wasm').then((r) => r.arrayBuffer()),
    ]);
    await MeshoptDecoder.ready;
    _io = new WebIO()
        .registerExtensions([KHRDracoMeshCompression, EXTMeshoptCompression])
        .registerDependencies({
            'draco3d.encoder': await draco3d.createEncoderModule({ wasmBinary: encoderWasm }),
            'draco3d.decoder': await draco3d.createDecoderModule({ wasmBinary: decoderWasm }),
            'meshopt.decoder': MeshoptDecoder,
        });
    return _io;
}

/**
 * Check if GLB is already Draco/meshopt compressed by reading the JSON chunk header.
 */
function isAlreadyCompressed(glbBytes: Uint8Array): boolean {
    if (glbBytes.byteLength < 20) return false;
    const view = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
    const jsonLength = view.getUint32(12, true);
    const jsonEnd = 20 + jsonLength;
    if (glbBytes.byteLength < jsonEnd) return false;
    const jsonStr = new TextDecoder().decode(glbBytes.subarray(20, jsonEnd)).replace(/\0+$/, '');
    const json = JSON.parse(jsonStr);
    const used: string[] = json.extensionsUsed ?? [];
    return used.includes('KHR_draco_mesh_compression') || used.includes('EXT_meshopt_compression');
}

self.onmessage = async (e: MessageEvent<DracoRequest>) => {
    try {
        const { glbBytes } = e.data;

        if (isAlreadyCompressed(glbBytes)) {
            self.postMessage(
                { success: true, compressedBytes: glbBytes, skipped: true } satisfies DracoResponse,
                { transfer: [glbBytes.buffer] } as any,
            );
            return;
        }

        const io = await ensureIO();
        const doc = await io.readBinary(glbBytes);
        await doc.transform(draco({ method: 'edgebreaker' }));
        const compressed = await io.writeBinary(doc);

        self.postMessage(
            { success: true, compressedBytes: compressed, skipped: false } satisfies DracoResponse,
            { transfer: [compressed.buffer] } as any,
        );
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        self.postMessage({ success: false, error: message } satisfies DracoError);
    }
};
