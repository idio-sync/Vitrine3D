/**
 * Recording Manager Module
 *
 * Orchestrates WebGL canvas recording via MediaRecorder API.
 * Supports four modes: turntable, walkthrough, annotation-tour, free.
 * Produces WebM blobs for upload to server-side FFmpeg transcode pipeline.
 */

import { Logger, notify } from './utilities.js';

const log = Logger.getLogger('recording-manager');

export type RecordingMode = 'turntable' | 'walkthrough' | 'annotation-tour' | 'free';
export type RecordingState = 'idle' | 'recording' | 'recorded' | 'uploading';

export interface RecordingDeps {
    renderer: any;          // THREE.WebGLRenderer
    scene: any;             // THREE.Scene
    camera: any;            // THREE.PerspectiveCamera
    controls: any;          // OrbitControls
    canvas: HTMLCanvasElement;
    postProcessing?: { isEnabled(): boolean; render(): void };
}

export interface RecordingResult {
    blob: Blob;
    duration: number;   // ms
    mode: RecordingMode;
}

let _deps: RecordingDeps | null = null;
let _state: RecordingState = 'idle';
let _recorder: MediaRecorder | null = null;
let _chunks: Blob[] = [];
let _startTime = 0;
let _result: RecordingResult | null = null;
let _compositeCanvas: HTMLCanvasElement | null = null;
let _compositeCtx: CanvasRenderingContext2D | null = null;
let _compositeStream: MediaStream | null = null;
let _compositeRafId = 0;
let _onRecordingComplete: ((result: RecordingResult) => void) | null = null;
let _overlayCanvas: HTMLCanvasElement | null = null;
let _timerInterval = 0;
let _maxDurationTimeout = 0;

const MAX_DURATION = 60_000; // 60 seconds

export function initRecordingManager(deps: RecordingDeps): void {
    _deps = deps;
    log.info('Recording manager initialized');
}

export function getRecordingState(): RecordingState {
    return _state;
}

export function getRecordingResult(): RecordingResult | null {
    return _result;
}

/**
 * Start recording the WebGL canvas.
 * Returns false if recording could not start.
 */
export function startRecording(
    mode: RecordingMode,
    onComplete: (result: RecordingResult) => void
): boolean {
    if (!_deps) {
        notify.error('Recording not initialized');
        return false;
    }
    if (_state === 'recording') {
        notify.error('Already recording');
        return false;
    }

    const canvas = _deps.canvas;

    // Create composite canvas matching the WebGL canvas size
    _compositeCanvas = document.createElement('canvas');
    _compositeCanvas.width = canvas.width;
    _compositeCanvas.height = canvas.height;
    _compositeCtx = _compositeCanvas.getContext('2d');

    if (!_compositeCtx) {
        notify.error('Could not create composite canvas');
        return false;
    }

    // Create overlay canvas for DOM elements (annotation popups)
    _overlayCanvas = document.createElement('canvas');
    _overlayCanvas.width = canvas.width;
    _overlayCanvas.height = canvas.height;

    // Start composite frame loop
    _compositeRafId = requestAnimationFrame(compositeFrame);

    // Capture stream from composite canvas
    _compositeStream = _compositeCanvas.captureStream(30);

    // Select best supported MIME type
    const mimeTypes = [
        'video/webm; codecs=vp9',
        'video/webm; codecs=vp8',
        'video/webm',
    ];
    const mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m));
    if (!mimeType) {
        notify.error('Browser does not support WebM recording');
        cleanup();
        return false;
    }

    _chunks = [];
    _recorder = new MediaRecorder(_compositeStream, {
        mimeType,
        videoBitsPerSecond: 5_000_000, // 5 Mbps
    });

    _recorder.ondataavailable = (e) => {
        if (e.data.size > 0) _chunks.push(e.data);
    };

    _recorder.onstop = () => {
        const duration = Date.now() - _startTime;
        const blob = new Blob(_chunks, { type: 'video/webm' });
        _result = { blob, duration, mode };
        _state = 'recorded';
        clearInterval(_timerInterval);
        _timerInterval = 0;
        clearTimeout(_maxDurationTimeout);
        _maxDurationTimeout = 0;
        cancelAnimationFrame(_compositeRafId);
        _compositeRafId = 0;
        if (_onRecordingComplete) _onRecordingComplete(_result);
        showRecIndicator(false);
        log.info(`Recording complete: ${(duration / 1000).toFixed(1)}s, ${(blob.size / 1024 / 1024).toFixed(1)}MB`);
    };

    _onRecordingComplete = onComplete;
    _startTime = Date.now();
    _recorder.start(1000); // collect chunks every second
    _state = 'recording';

    // Start timer display
    updateTimerDisplay();
    _timerInterval = window.setInterval(updateTimerDisplay, 1000);

    // Auto-stop at max duration
    _maxDurationTimeout = window.setTimeout(() => {
        if (_state === 'recording') stopRecording();
    }, MAX_DURATION);

    showRecIndicator(true);
    log.info(`Recording started (${mode}, ${mimeType})`);
    return true;
}

/**
 * Stop the current recording.
 */
export function stopRecording(): void {
    if (_state !== 'recording' || !_recorder) return;
    _recorder.stop();
    clearInterval(_timerInterval);
    _timerInterval = 0;
    clearTimeout(_maxDurationTimeout);
    _maxDurationTimeout = 0;
}

/**
 * Discard the recorded result and reset to idle.
 */
export function discardRecording(): void {
    _result = null;
    _state = 'idle';
    cleanup();
}

/**
 * Get the overlay canvas for rendering annotation popups during recording.
 * Returns null if not currently recording.
 */
export function getOverlayCanvas(): HTMLCanvasElement | null {
    return _state === 'recording' ? _overlayCanvas : null;
}

/**
 * Upload the recorded video to the server.
 */
export async function uploadRecording(options: {
    title: string;
    archiveHash?: string;
    trimStart: number;
    trimEnd: number;
    serverUrl?: string;
}): Promise<{ id: string; status: string } | null> {
    if (!_result) {
        notify.error('No recording to upload');
        return null;
    }

    _state = 'uploading';

    const safeTrimStart = isFinite(options.trimStart) ? options.trimStart : 0;
    const safeTrimEnd = isFinite(options.trimEnd) ? options.trimEnd : 0;

    const formData = new FormData();
    formData.append('video', _result.blob, 'recording.webm');
    formData.append('title', options.title);
    formData.append('mode', _result.mode);
    formData.append('duration_ms', String(_result.duration));
    formData.append('trim_start', String(safeTrimStart));
    formData.append('trim_end', String(safeTrimEnd));
    if (options.archiveHash) {
        formData.append('archive_hash', options.archiveHash);
    }

    try {
        const baseUrl = options.serverUrl || '';
        const res = await fetch(`${baseUrl}/api/media/upload`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        _state = 'idle';
        _result = null;
        cleanup();
        notify.success('Recording uploaded — processing...');
        return data;
    } catch (e: any) {
        _state = 'recorded'; // allow retry
        notify.error(`Upload failed: ${e.message}`);
        log.error('Upload error:', e);
        return null;
    }
}

/**
 * Poll server for media status until ready or error.
 */
export function pollMediaStatus(
    mediaId: string,
    onStatusChange: (status: string, data?: any) => void,
    serverUrl = ''
): void {
    const poll = async () => {
        try {
            const res = await fetch(`${serverUrl}/api/media/${mediaId}`);
            if (!res.ok) return;
            const data = await res.json();
            onStatusChange(data.status, data);
            if (data.status === 'ready' || data.status === 'error') return;
            setTimeout(poll, 2000);
        } catch {
            setTimeout(poll, 5000);
        }
    };
    poll();
}

// =============================================================================
// PRIVATE
// =============================================================================

function compositeFrame(): void {
    if (!_compositeCtx || !_compositeCanvas || !_deps) return;

    // Draw the WebGL canvas
    _compositeCtx.drawImage(_deps.canvas, 0, 0);

    // Draw overlay canvas (annotation popups rendered here by host)
    if (_overlayCanvas) {
        _compositeCtx.drawImage(_overlayCanvas, 0, 0);
    }

    if (_state === 'recording') {
        _compositeRafId = requestAnimationFrame(compositeFrame);
    }
}

function cleanup(): void {
    if (_compositeRafId) {
        cancelAnimationFrame(_compositeRafId);
        _compositeRafId = 0;
    }
    _compositeCanvas = null;
    _compositeCtx = null;
    _compositeStream = null;
    _overlayCanvas = null;
    _recorder = null;
    _chunks = [];
    _onRecordingComplete = null;
}

function showRecIndicator(show: boolean): void {
    const indicator = document.getElementById('rec-indicator');
    if (indicator) indicator.style.display = show ? 'flex' : 'none';
}

function updateTimerDisplay(): void {
    const el = document.getElementById('rec-timer');
    if (!el) return;
    const elapsed = Math.floor((Date.now() - _startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    // Also update the panel elapsed display
    const panelEl = document.getElementById('rec-elapsed');
    if (panelEl) panelEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}
