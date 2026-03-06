/**
 * Recording Trim UI
 *
 * Lightweight inline trim interface: video preview + timeline scrubber
 * with start/end handles. Produces trim timestamps for server-side FFmpeg.
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('recording-trim');

export interface TrimResult {
    trimStart: number;  // seconds
    trimEnd: number;    // seconds
    title: string;
}

/**
 * Show the trim UI for a recorded WebM blob.
 * Returns a promise that resolves with trim settings or null if discarded.
 */
export function showTrimUI(
    container: HTMLElement,
    blob: Blob,
    defaultTitle: string
): Promise<TrimResult | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);

        container.innerHTML = '';
        container.classList.remove('hidden');

        // Video preview
        const video = document.createElement('video');
        video.src = url;
        video.controls = false;
        video.muted = true;
        video.playsInline = true;
        video.style.cssText = 'width:100%; border-radius:4px; background:#000; max-height:200px;';
        container.appendChild(video);

        // Timeline scrubber
        const timeline = document.createElement('div');
        timeline.className = 'trim-timeline';
        timeline.style.cssText = 'position:relative; height:32px; background:#1a1a1a; border-radius:4px; margin:8px 0; cursor:pointer; overflow:hidden;';

        const range = document.createElement('div');
        range.className = 'trim-range';
        range.style.cssText = 'position:absolute; top:0; bottom:0; left:0; width:100%; background:rgba(90,158,151,0.3); border-left:2px solid #5a9e97; border-right:2px solid #5a9e97;';
        timeline.appendChild(range);

        const playhead = document.createElement('div');
        playhead.style.cssText = 'position:absolute; top:0; bottom:0; width:2px; background:#fff; pointer-events:none; left:0;';
        timeline.appendChild(playhead);

        container.appendChild(timeline);

        let trimStart = 0;
        let trimEnd = 0;
        let duration = 0;

        function updateRange(): void {
            if (duration <= 0) return;
            const startPct = (trimStart / duration) * 100;
            const endPct = (trimEnd / duration) * 100;
            range.style.left = `${startPct}%`;
            range.style.width = `${endPct - startPct}%`;
            updateTimeDisplay();
        }

        video.addEventListener('loadedmetadata', () => {
            duration = video.duration;
            trimEnd = duration;
            updateRange();
            log.info(`Trim UI loaded: duration=${duration.toFixed(1)}s`);
        });

        video.addEventListener('timeupdate', () => {
            if (duration > 0) {
                playhead.style.left = `${(video.currentTime / duration) * 100}%`;
            }
        });

        // Click on timeline to set trim points (left third = start, right third = end, middle = seek)
        timeline.addEventListener('click', (e) => {
            const rect = timeline.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const time = pct * duration;

            if (pct < 0.33) {
                trimStart = Math.max(0, Math.min(time, trimEnd - 0.5));
            } else if (pct > 0.66) {
                trimEnd = Math.max(trimStart + 0.5, Math.min(time, duration));
            } else {
                video.currentTime = time;
            }
            updateRange();
        });

        // Controls row
        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex; gap:6px; align-items:center; margin:8px 0;';

        const previewBtn = document.createElement('button');
        previewBtn.className = 'prop-btn';
        previewBtn.textContent = 'Preview';
        previewBtn.addEventListener('click', () => {
            video.currentTime = trimStart;
            video.play();
            const checkEnd = () => {
                if (video.currentTime >= trimEnd) {
                    video.pause();
                    video.removeEventListener('timeupdate', checkEnd);
                }
            };
            video.addEventListener('timeupdate', checkEnd);
        });
        controls.appendChild(previewBtn);

        const timeDisplay = document.createElement('span');
        timeDisplay.style.cssText = 'font-size:10px; color:#999; margin-left:auto; font-family:monospace;';
        controls.appendChild(timeDisplay);
        container.appendChild(controls);

        function updateTimeDisplay(): void {
            const dur = trimEnd - trimStart;
            timeDisplay.textContent = `${trimStart.toFixed(1)}s — ${trimEnd.toFixed(1)}s (${dur.toFixed(1)}s)`;
        }

        // Title input
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = defaultTitle;
        titleInput.placeholder = 'Recording title';
        titleInput.className = 'prop-input';
        titleInput.style.cssText = 'width:100%; margin:4px 0 8px;';
        container.appendChild(titleInput);

        // Action buttons
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; gap:8px;';

        const uploadBtn = document.createElement('button');
        uploadBtn.className = 'prop-btn accent';
        uploadBtn.textContent = 'Upload';
        uploadBtn.addEventListener('click', () => {
            URL.revokeObjectURL(url);
            container.classList.add('hidden');
            resolve({
                trimStart,
                trimEnd,
                title: titleInput.value || defaultTitle,
            });
        });

        const discardBtn = document.createElement('button');
        discardBtn.className = 'prop-btn';
        discardBtn.textContent = 'Discard';
        discardBtn.addEventListener('click', () => {
            URL.revokeObjectURL(url);
            container.classList.add('hidden');
            container.innerHTML = '';
            resolve(null);
        });

        actions.appendChild(uploadBtn);
        actions.appendChild(discardBtn);
        container.appendChild(actions);

        // Load video
        video.load();
    });
}
