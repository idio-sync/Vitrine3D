/**
 * VR Session Module — WebXR support via Spark.js SparkXr
 *
 * Handles VR session lifecycle, render loop switching, locomotion,
 * wrist menu UI, and VR annotation display.
 *
 * Lazy-loaded — zero cost for non-VR users.
 */

import * as THREE from 'three';
import { SparkXr } from '@sparkjsdev/spark';
import type { SparkXrOptions } from '@sparkjsdev/spark';
import type { VRDeps } from '../types.js';
import { VR } from './constants.js';
import { Logger } from './logger.js';

const log = Logger.getLogger('vr-session');

// =============================================================================
// State
// =============================================================================

let sparkXr: SparkXr | null = null;
let deps: VRDeps | null = null;
let isPresenting = false;

/** Saved splat budget from before VR entry, restored on exit. */
let savedSplatBudget = 0;

/** Saved controls enabled state. */
let savedControlsEnabled = true;

/** DOM elements hidden during VR. */
const hiddenElements: Array<{ el: HTMLElement; prevDisplay: string }> = [];

// Teleport state (populated in Chunk 4)
let teleportArc: THREE.Line | null = null;
let teleportMarker: THREE.Group | null = null;
let teleportRaycaster: THREE.Raycaster | null = null;
let teleportTarget: THREE.Vector3 | null = null;
let teleportValid = false;

// Locomotion mode
let locomotionMode: 'teleport' | 'smooth' = 'teleport';

// Wrist menu (populated in Chunk 5)
let wristMenu: THREE.Group | null = null;

// VR annotation markers (populated in Chunk 6)
let vrAnnotationMarkers: THREE.Group | null = null;
let activeAnnotationCard: THREE.Mesh | null = null;

// Camera rig — wraps the camera for VR movement
let cameraRig: THREE.Group | null = null;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize VR support. Call once after scene is set up.
 * Creates SparkXr, which probes for XR support and shows/hides the VR button.
 *
 * @returns true if XR is potentially supported (button will be shown), false otherwise
 */
export function initVR(vrDeps: VRDeps): boolean {
    if (sparkXr) {
        log.warn('VR already initialized');
        return true;
    }

    deps = vrDeps;

    // Create camera rig — parent for camera, enables moving the viewpoint
    cameraRig = new THREE.Group();
    cameraRig.name = 'vr-camera-rig';
    deps.scene.add(cameraRig);
    cameraRig.add(deps.camera);

    const vrButton = document.getElementById('btn-enter-vr');
    if (!vrButton) {
        log.warn('VR button element #btn-enter-vr not found');
        return false;
    }

    // Check for basic WebXR support before creating SparkXr
    if (!navigator.xr) {
        log.info('WebXR not available in this browser');
        return false;
    }

    const options: SparkXrOptions = {
        renderer: deps.renderer,
        mode: 'vr',
        element: vrButton,
        referenceSpaceType: 'local',
        frameBufferScaleFactor: VR.FRAMEBUFFER_SCALE,
        fixedFoveation: 1.0,
        enableHands: false,
        controllers: {
            moveSpeed: 3.0,
            rotateSpeed: 1.5,
            moveHeading: true,
        },
        onReady: (supported: boolean) => {
            if (supported) {
                log.info('WebXR VR supported — showing Enter VR button');
                // SparkXr already handles showing the element via updateElement()
                // Check if auto-enter is requested
                if (window.APP_CONFIG?.vr) {
                    showAutoEnterOverlay();
                }
            } else {
                log.info('WebXR VR not supported on this device');
            }
        },
        onEnterXr: () => {
            enterVRMode();
        },
        onExitXr: () => {
            exitVRMode();
        },
    };

    sparkXr = new SparkXr(options);
    log.info('SparkXr created');
    return true;
}

// =============================================================================
// VR Mode Enter / Exit
// =============================================================================

function enterVRMode(): void {
    if (!deps) return;
    isPresenting = true;
    log.info('Entering VR mode');

    // Switch to XR render loop (CRITICAL — without this, nothing renders in VR)
    deps.renderer.setAnimationLoop(deps.animate);

    // Apply VR quality profile
    savedSplatBudget = deps.getSplatBudget();
    deps.setSplatBudget(VR.SPLAT_BUDGET_PC);

    // Disable desktop controls
    savedControlsEnabled = deps.controls.enabled;
    deps.controls.enabled = false;

    // Hide DOM UI (doesn't render in XR anyway)
    hideUIForVR();

    // Initialize teleport system
    initTeleport();

    // Initialize wrist menu
    initWristMenu();

    // Create VR annotation markers (DOM markers don't render in WebXR)
    createVRAnnotationMarkers();

    log.info('VR mode active — splat budget: %d', VR.SPLAT_BUDGET_PC);
}

function exitVRMode(): void {
    if (!deps) return;
    isPresenting = false;
    log.info('Exiting VR mode');

    // Switch back to desktop rAF render loop
    deps.renderer.setAnimationLoop(null);
    requestAnimationFrame(deps.animate);

    // Restore previous splat budget
    deps.setSplatBudget(savedSplatBudget);

    // Restore desktop controls
    deps.controls.enabled = savedControlsEnabled;

    // Re-show DOM UI
    restoreUIAfterVR();

    // Clean up VR-specific 3D objects
    disposeTeleport();
    disposeWristMenu();
    disposeVRAnnotationMarkers();

    // Remove camera from rig, restore to scene root
    if (cameraRig && deps.camera.parent === cameraRig) {
        const worldPos = new THREE.Vector3();
        deps.camera.getWorldPosition(worldPos);
        cameraRig.remove(deps.camera);
        deps.scene.add(deps.camera);
        deps.camera.position.copy(worldPos);
    }

    log.info('VR mode exited');
}

/** Returns true if currently in an XR presenting session. */
export function isInVR(): boolean {
    return isPresenting;
}

// =============================================================================
// Auto-Enter Overlay (?vr=true)
// =============================================================================

function showAutoEnterOverlay(): void {
    // Browser requires user gesture to start XR session.
    // Show a full-screen "tap to enter VR" overlay.
    const overlay = document.createElement('div');
    overlay.id = 'vr-auto-enter-overlay';
    overlay.innerHTML = `
        <span class="vr-prompt-text">Tap anywhere to enter VR</span>
    `;
    overlay.addEventListener('click', () => {
        overlay.remove();
        if (sparkXr) {
            sparkXr.toggleXr();
        }
    }, { once: true });
    document.body.appendChild(overlay);
    log.info('Auto-enter overlay shown (?vr=true)');
}

// =============================================================================
// UI Hide / Restore
// =============================================================================

const UI_SELECTORS_TO_HIDE = [
    '#tool-rail',
    '#properties-panel',
    '#metadata-sidebar',
    '#export-panel',
    '#loading-overlay',
    '.kiosk-toolbar',
    '.kiosk-sidebar',
    '.editorial-sidebar',
];

function hideUIForVR(): void {
    hiddenElements.length = 0;
    for (const selector of UI_SELECTORS_TO_HIDE) {
        const el = document.querySelector<HTMLElement>(selector);
        if (el && el.style.display !== 'none') {
            hiddenElements.push({ el, prevDisplay: el.style.display });
            el.style.display = 'none';
        }
    }
}

function restoreUIAfterVR(): void {
    for (const { el, prevDisplay } of hiddenElements) {
        el.style.display = prevDisplay;
    }
    hiddenElements.length = 0;
}

// =============================================================================
// Render Loop Guard
// =============================================================================

/**
 * Call at the top of animate(). Returns true if the rAF-based loop should
 * skip scheduling the next frame (because XR's setAnimationLoop handles it).
 */
export function shouldSkipRAF(): boolean {
    return isPresenting;
}

// =============================================================================
// Per-Frame Update (called from animate loop)
// =============================================================================

/**
 * Per-frame VR update. Call from animate() when in VR.
 * Handles controller input, teleport arc, wrist menu visibility, etc.
 */
export function updateVR(): void {
    if (!isPresenting || !sparkXr || !deps) return;

    // Update Spark's built-in controller movement (smooth locomotion)
    if (locomotionMode === 'smooth') {
        sparkXr.updateControllers(deps.camera);
    }

    // Update teleport (Chunk 4)
    updateTeleport();

    // Update wrist menu visibility (Chunk 5)
    updateWristMenu();
}

// =============================================================================
// Teleport Locomotion (Chunk 4 — stubs)
// =============================================================================

function initTeleport(): void {
    // Populated in Chunk 4
}

function updateTeleport(): void {
    // Populated in Chunk 4
}

function disposeTeleport(): void {
    if (teleportArc) {
        teleportArc.geometry.dispose();
        (teleportArc.material as THREE.Material).dispose();
        teleportArc.removeFromParent();
        teleportArc = null;
    }
    if (teleportMarker) {
        teleportMarker.removeFromParent();
        teleportMarker = null;
    }
    teleportRaycaster = null;
    teleportTarget = null;
    teleportValid = false;
}

// =============================================================================
// Wrist Menu (Chunk 5 — stubs)
// =============================================================================

function initWristMenu(): void {
    // Populated in Chunk 5
}

function updateWristMenu(): void {
    // Populated in Chunk 5
}

function disposeWristMenu(): void {
    if (wristMenu) {
        wristMenu.removeFromParent();
        // Dispose all children
        wristMenu.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
        wristMenu = null;
    }
}

// =============================================================================
// VR Annotation Markers (Chunk 6 — stubs)
// =============================================================================

function createVRAnnotationMarkers(): void {
    // Populated in Chunk 6
}

function disposeVRAnnotationMarkers(): void {
    if (vrAnnotationMarkers) {
        vrAnnotationMarkers.traverse((child) => {
            if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) {
                child.geometry?.dispose();
                if (child instanceof THREE.Mesh) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
                if (child instanceof THREE.Sprite) {
                    child.material.dispose();
                    child.material.map?.dispose();
                }
            }
        });
        vrAnnotationMarkers.removeFromParent();
        vrAnnotationMarkers = null;
    }
    if (activeAnnotationCard) {
        activeAnnotationCard.geometry.dispose();
        (activeAnnotationCard.material as THREE.Material).dispose();
        activeAnnotationCard.removeFromParent();
        activeAnnotationCard = null;
    }
}

// =============================================================================
// Locomotion Mode Toggle
// =============================================================================

export function getLocomotionMode(): 'teleport' | 'smooth' {
    return locomotionMode;
}

export function setLocomotionMode(mode: 'teleport' | 'smooth'): void {
    locomotionMode = mode;
    log.info('Locomotion mode: %s', mode);
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Full disposal — call when the page/scene is being torn down.
 */
export function disposeVR(): void {
    if (isPresenting && sparkXr) {
        sparkXr.toggleXr(); // exit VR first
    }
    disposeTeleport();
    disposeWristMenu();
    disposeVRAnnotationMarkers();

    if (cameraRig) {
        if (deps?.camera.parent === cameraRig) {
            cameraRig.remove(deps.camera);
            deps.scene.add(deps.camera);
        }
        cameraRig.removeFromParent();
        cameraRig = null;
    }

    if (sparkXr) {
        sparkXr.dispose();
        sparkXr = null;
    }
    deps = null;
    isPresenting = false;
    log.info('VR disposed');
}
