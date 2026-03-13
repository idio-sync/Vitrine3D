/**
 * Screenshot Manager Module
 *
 * Handles screenshot capture, viewfinder overlay, and screenshot list management.
 * Extracted from main.js — manages state.screenshots and state.manualPreviewBlob.
 */

import { captureScreenshot } from './archive-creator.js';
import { Logger, notify } from './utilities.js';
import type { AppState } from '@/types.js';

const log = Logger.getLogger('screenshot-manager');

/** Hide any GridHelper objects in the scene, returning those that were visible for later restore. */
function hideGridHelpers(scene: any): any[] {
    const hidden: any[] = [];
    for (const child of scene.children) {
        if (child.type === 'GridHelper' && child.visible) {
            child.visible = false;
            hidden.push(child);
        }
    }
    return hidden;
}

/** Restore visibility on previously-hidden grid helpers. */
function restoreGridHelpers(hidden: any[]): void {
    for (const child of hidden) {
        child.visible = true;
    }
}

interface ScreenshotDeps {
    renderer: any; // TODO: type when @types/three is installed (THREE.WebGLRenderer)
    scene: any;    // TODO: type when @types/three is installed (THREE.Scene)
    camera: any;   // TODO: type when @types/three is installed (THREE.PerspectiveCamera)
    state: AppState;
    postProcessing?: { isEnabled(): boolean; render(): void };
}

/**
 * Capture a screenshot and download it immediately as a PNG file.
 */
export async function downloadScreenshot(deps: ScreenshotDeps): Promise<void> {
    const { renderer, scene, camera, postProcessing } = deps;
    if (!renderer) {
        notify.error('Renderer not ready');
        return;
    }
    const hiddenGrids = hideGridHelpers(scene);
    try {
        if (postProcessing?.isEnabled()) {
            postProcessing.render();
        } else {
            renderer.render(scene, camera);
        }
        const canvas = renderer.domElement;
        const blob = await captureScreenshot(canvas, { width: canvas.width, height: canvas.height });
        if (!blob) {
            notify.error('Screenshot capture failed');
            return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notify.success('Screenshot downloaded');
    } catch (e) {
        log.error('Screenshot download error:', e);
        notify.error('Failed to download screenshot');
    } finally {
        restoreGridHelpers(hiddenGrids);
    }
}

/**
 * Capture a screenshot and add it to the screenshots list.
 */
export async function captureScreenshotToList(deps: ScreenshotDeps): Promise<void> {
    const { renderer, scene, camera, state, postProcessing } = deps;
    if (!renderer) {
        notify.error('Renderer not ready');
        return;
    }
    const hiddenGrids = hideGridHelpers(scene);
    try {
        if (postProcessing?.isEnabled()) {
            postProcessing.render();
        } else {
            renderer.render(scene, camera);
        }
        const blob = await captureScreenshot(renderer.domElement, { width: 1024, height: 1024 });
        if (!blob) {
            notify.error('Screenshot capture failed');
            return;
        }
        const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
        });
        state.screenshots.push({
            id: Date.now().toString(),
            blob,
            dataUrl,
            timestamp: Date.now()
        });
        renderScreenshotsList(state);
        notify.success('Screenshot captured');
    } catch (e) {
        log.error('Screenshot capture error:', e);
        notify.error('Failed to capture screenshot');
    } finally {
        restoreGridHelpers(hiddenGrids);
    }
}

/**
 * Show the viewfinder overlay for manual preview capture.
 */
export function showViewfinder(): void {
    const overlay = document.getElementById('viewfinder-overlay');
    const frame = document.getElementById('viewfinder-frame');
    const controls = document.getElementById('viewfinder-controls');
    const dim = document.getElementById('viewfinder-dim');
    if (!overlay || !frame || !controls) return;

    const container = document.getElementById('viewer-container');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    const size = Math.min(cw, ch) * 0.8;
    const left = (cw - size) / 2;
    const top = (ch - size) / 2;

    // Hide the dim layer — the frame's box-shadow creates the dimming effect
    if (dim) dim.style.display = 'none';

    frame.style.left = left + 'px';
    frame.style.top = top + 'px';
    frame.style.width = size + 'px';
    frame.style.height = size + 'px';

    controls.style.top = (top + size + 15) + 'px';

    overlay.classList.remove('hidden');
}

/**
 * Hide the viewfinder overlay.
 */
export function hideViewfinder(): void {
    const overlay = document.getElementById('viewfinder-overlay');
    if (overlay) overlay.classList.add('hidden');
}

/**
 * Capture a manual preview image and store it in state.
 */
export async function captureManualPreview(deps: ScreenshotDeps): Promise<void> {
    const { renderer, scene, camera, state, postProcessing } = deps;
    if (!renderer) return;
    const hiddenGrids = hideGridHelpers(scene);
    try {
        if (postProcessing?.isEnabled()) {
            postProcessing.render();
        } else {
            renderer.render(scene, camera);
        }
        const blob = await captureScreenshot(renderer.domElement, { width: 512, height: 512 });
        if (blob) {
            state.manualPreviewBlob = blob;
            hideViewfinder();
            const status = document.getElementById('manual-preview-status');
            if (status) status.style.display = '';
            notify.success('Manual preview captured');
        }
    } catch (e) {
        log.error('Manual preview capture error:', e);
        notify.error('Failed to capture preview');
    } finally {
        restoreGridHelpers(hiddenGrids);
    }
}

/**
 * Render the screenshots list in the DOM.
 */
function renderScreenshotsList(state: AppState): void {
    const list = document.getElementById('screenshots-list');
    if (!list) return;
    list.innerHTML = '';

    if (state.screenshots.length === 0) return;

    state.screenshots.forEach((shot) => {
        const item = document.createElement('div');
        item.className = 'screenshot-item';

        const img = document.createElement('img');
        img.src = shot.dataUrl;
        img.alt = 'Screenshot';
        item.appendChild(img);

        const del = document.createElement('button');
        del.className = 'screenshot-delete';
        del.textContent = '\u00D7';
        del.title = 'Remove screenshot';
        del.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            removeScreenshot(shot.id, state);
        });
        item.appendChild(del);

        list.appendChild(item);
    });
}

/**
 * Remove a screenshot by ID from state and re-render the list.
 */
function removeScreenshot(id: string, state: AppState): void {
    state.screenshots = state.screenshots.filter(s => s.id !== id);
    renderScreenshotsList(state);
}
