/**
 * Annotation Tour — Camera Automation
 *
 * Iterates through annotations, flying the camera to each one with
 * easeOutCubic easing, dwelling to show the popup, then advancing.
 * Reuses the flyCamera pattern from walkthrough-controller.
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('annotation-tour');

export interface AnnotationTourDeps {
    camera: any;            // THREE.PerspectiveCamera
    controls: any;          // OrbitControls
    annotationSystem: any;  // AnnotationSystem
}

export interface AnnotationTourOptions {
    dwellTime: number;      // ms per annotation (default 3000)
    flyDuration: number;    // ms per flight (default 1500)
    onStart?: () => void;
    onAnnotationEnter?: (annotationId: string, index: number) => void;
    onAnnotationLeave?: (annotationId: string) => void;
    onComplete?: () => void;
}

let _running = false;
let _cancelRequested = false;
let _rafId = 0;
let _timeoutId = 0;

export function isRunning(): boolean {
    return _running;
}

export function startAnnotationTour(
    deps: AnnotationTourDeps,
    options: AnnotationTourOptions
): boolean {
    const annotations = deps.annotationSystem?.getAnnotations?.() ?? [];
    if (annotations.length === 0) {
        log.warn('No annotations for tour');
        return false;
    }

    _running = true;
    _cancelRequested = false;
    options.onStart?.();

    log.info(`Starting annotation tour: ${annotations.length} stops, ${options.dwellTime}ms dwell`);

    let index = 0;

    function visitNext(): void {
        if (_cancelRequested || index >= annotations.length) {
            _running = false;
            _cancelRequested = false;
            options.onComplete?.();
            return;
        }

        const anno = annotations[index];
        options.onAnnotationEnter?.(anno.id, index);

        flyToAnnotation(deps, anno, options.flyDuration, () => {
            if (_cancelRequested) {
                _running = false;
                options.onComplete?.();
                return;
            }

            // Show annotation popup
            deps.annotationSystem?.selectAnnotation?.(anno.id);

            // Dwell then advance
            _timeoutId = window.setTimeout(() => {
                _timeoutId = 0;
                options.onAnnotationLeave?.(anno.id);
                index++;
                visitNext();
            }, options.dwellTime);
        });
    }

    visitNext();
    return true;
}

export function stopAnnotationTour(): void {
    _cancelRequested = true;
    if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = 0;
    }
    if (_timeoutId) {
        clearTimeout(_timeoutId);
        _timeoutId = 0;
    }
    _running = false;
}

function flyToAnnotation(
    deps: AnnotationTourDeps,
    annotation: any,
    duration: number,
    onComplete: () => void
): void {
    if (!annotation.camera_position || !annotation.camera_target) {
        // Skip annotations without camera data
        onComplete();
        return;
    }

    const cam = deps.camera;
    const ctrl = deps.controls;
    const startPos = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
    const startTarget = { x: ctrl.target.x, y: ctrl.target.y, z: ctrl.target.z };
    const endPos = annotation.camera_position;
    const endTarget = annotation.camera_target;
    const startTime = performance.now();

    function step(): void {
        if (_cancelRequested) { onComplete(); return; }

        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic

        cam.position.set(
            startPos.x + (endPos.x - startPos.x) * eased,
            startPos.y + (endPos.y - startPos.y) * eased,
            startPos.z + (endPos.z - startPos.z) * eased
        );
        ctrl.target.set(
            startTarget.x + (endTarget.x - startTarget.x) * eased,
            startTarget.y + (endTarget.y - startTarget.y) * eased,
            startTarget.z + (endTarget.z - startTarget.z) * eased
        );

        if (t < 1) {
            _rafId = requestAnimationFrame(step);
        } else {
            _rafId = 0;
            onComplete();
        }
    }

    _rafId = requestAnimationFrame(step);
}
