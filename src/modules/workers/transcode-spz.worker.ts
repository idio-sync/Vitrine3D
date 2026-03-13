/**
 * Web Worker for transcodeSpz — offloads CPU-heavy splat LOD generation
 * off the main thread to avoid "tab unresponsive" warnings.
 */
import { transcodeSpz } from '@sparkjsdev/spark';

export interface TranscodeRequest {
    fileBytes: Uint8Array;
    fileType: string;
}

export interface TranscodeResponse {
    success: true;
    spzBytes: Uint8Array;
}

export interface TranscodeError {
    success: false;
    error: string;
}

self.onmessage = async (e: MessageEvent<TranscodeRequest>) => {
    try {
        const { fileBytes, fileType } = e.data;
        const { fileBytes: spzBytes } = await transcodeSpz({
            inputs: [{ fileBytes, fileType }],
        });

        if (!spzBytes || spzBytes.length === 0) {
            self.postMessage({ success: false, error: 'transcodeSpz returned empty output' } satisfies TranscodeError);
            return;
        }

        self.postMessage(
            { success: true, spzBytes } satisfies TranscodeResponse,
            // Transfer the buffer to avoid copying
            { transfer: [spzBytes.buffer] } as any,
        );
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        self.postMessage({ success: false, error: message } satisfies TranscodeError);
    }
};
