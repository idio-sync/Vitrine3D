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

// Teleport state
let teleportArc: THREE.Line | null = null;
let teleportLandingMarker: THREE.Mesh | null = null;
let teleportTarget: THREE.Vector3 | null = null;
let teleportValid = false;
let isTeleporting = false;

// Snap turn state
let lastSnapTime = 0;
const SNAP_COOLDOWN_MS = 300;

// Fade callback for teleport transition
let fadeCallback: (() => void) | null = null;

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
// Teleport Locomotion
// =============================================================================

const TELEPORT_ARC_SEGMENTS = 30;
const TELEPORT_GRAVITY = 9.8;
const TELEPORT_VELOCITY = 6.0;

function initTeleport(): void {
    if (!deps) return;

    // Arc line
    const arcGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(TELEPORT_ARC_SEGMENTS * 3);
    arcGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const arcMaterial = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 });
    teleportArc = new THREE.Line(arcGeometry, arcMaterial);
    teleportArc.visible = false;
    teleportArc.frustumCulled = false;
    deps.scene.add(teleportArc);

    // Landing target — ring
    const targetGeometry = new THREE.RingGeometry(0.15, 0.25, 32);
    targetGeometry.rotateX(-Math.PI / 2);
    const targetMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
    });
    teleportLandingMarker = new THREE.Mesh(targetGeometry, targetMaterial);
    teleportLandingMarker.visible = false;
    deps.scene.add(teleportLandingMarker);

    log.info('Teleport system initialized');
}

/** Calculate parabolic arc points from controller position/direction */
export function calculateArc(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    velocity: number = TELEPORT_VELOCITY,
): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const pos = origin.clone();
    const vel = direction.clone().multiplyScalar(velocity);
    const dt = 0.05;

    for (let i = 0; i < TELEPORT_ARC_SEGMENTS; i++) {
        points.push(pos.clone());
        pos.add(vel.clone().multiplyScalar(dt));
        vel.y -= TELEPORT_GRAVITY * dt;
    }
    return points;
}

/** Raycast arc segments against scene meshes to find walkable landing point */
export function findTeleportLanding(
    points: THREE.Vector3[],
    scene: THREE.Scene,
    maxDistance: number,
): THREE.Vector3 | null {
    const raycaster = new THREE.Raycaster();

    for (let i = 0; i < points.length - 1; i++) {
        const from = points[i];
        const to = points[i + 1];
        const dir = to.clone().sub(from);
        const len = dir.length();
        dir.normalize();

        raycaster.set(from, dir);
        raycaster.far = len;

        const intersects = raycaster.intersectObjects(scene.children, true);
        for (const hit of intersects) {
            // Check distance from origin
            if (hit.point.distanceTo(points[0]) > maxDistance) continue;
            // Check surface normal is walkable (< 45° from up)
            if (hit.face && hit.face.normal.y > 0.7) {
                return hit.point;
            }
        }
    }
    return null;
}

function updateTeleport(): void {
    if (!deps || !cameraRig || locomotionMode !== 'teleport') return;

    const session = deps.renderer.xr.getSession();
    if (!session) return;

    // Run fade callback if active
    if (fadeCallback) {
        fadeCallback();
    }

    // Get right controller (index 1) for teleport
    const controller = deps.renderer.xr.getController(1);
    if (!controller) return;

    // Read gamepad for trigger and thumbstick
    const sources = session.inputSources;
    let triggerPressed = false;
    let thumbstickX = 0;
    let rightSource: XRInputSource | null = null;

    for (const source of sources) {
        if (source.handedness === 'right' && source.gamepad) {
            rightSource = source;
            // Trigger is typically axes/buttons[0] (select)
            triggerPressed = source.gamepad.buttons[0]?.pressed ?? false;
            // Thumbstick X for snap turn (axes[2] is typically right thumbstick X)
            thumbstickX = source.gamepad.axes[2] ?? 0;
            break;
        }
    }

    // Snap turn on right thumbstick
    handleSnapTurn(thumbstickX);

    // Teleport arc on trigger hold
    if (rightSource && triggerPressed && !isTeleporting) {
        // Calculate arc from controller position/direction
        const controllerPos = new THREE.Vector3();
        const controllerDir = new THREE.Vector3(0, 0, -1);
        controller.getWorldPosition(controllerPos);
        controller.getWorldDirection(controllerDir);
        controllerDir.negate(); // getWorldDirection returns -Z

        const arcPoints = calculateArc(controllerPos, controllerDir);
        const landing = findTeleportLanding(arcPoints, deps.scene, VR.TELEPORT_MAX_DISTANCE);

        // Update arc visual
        if (teleportArc) {
            const posAttr = teleportArc.geometry.getAttribute('position') as THREE.BufferAttribute;
            for (let i = 0; i < arcPoints.length && i < TELEPORT_ARC_SEGMENTS; i++) {
                posAttr.setXYZ(i, arcPoints[i].x, arcPoints[i].y, arcPoints[i].z);
            }
            posAttr.needsUpdate = true;
            teleportArc.visible = true;

            // Color: green if valid, red if invalid
            (teleportArc.material as THREE.LineBasicMaterial).color.setHex(landing ? 0x00ff88 : 0xff4444);
        }

        // Update landing marker
        if (teleportLandingMarker) {
            if (landing) {
                teleportLandingMarker.position.copy(landing);
                teleportLandingMarker.position.y += 0.01; // Slight offset above ground
                teleportLandingMarker.visible = true;
                teleportTarget = landing;
                teleportValid = true;
            } else {
                teleportLandingMarker.visible = false;
                teleportValid = false;
            }
        }
    } else if (!triggerPressed) {
        // Trigger released — execute teleport if valid
        if (teleportValid && teleportTarget && !isTeleporting) {
            executeTeleport(teleportTarget);
        }

        // Hide arc and marker
        if (teleportArc) teleportArc.visible = false;
        if (teleportLandingMarker) teleportLandingMarker.visible = false;
        teleportValid = false;
    }
}

function handleSnapTurn(thumbstickX: number): void {
    if (!cameraRig) return;
    const now = performance.now();
    if (now - lastSnapTime < SNAP_COOLDOWN_MS) return;

    if (Math.abs(thumbstickX) > 0.6) {
        const angle = thumbstickX > 0
            ? -VR.SNAP_TURN_DEGREES * Math.PI / 180
            : VR.SNAP_TURN_DEGREES * Math.PI / 180;
        cameraRig.rotateY(angle);
        lastSnapTime = now;
    }
}

function executeTeleport(target: THREE.Vector3): void {
    if (!deps || !cameraRig) return;
    isTeleporting = true;

    // Get current camera world position to calculate offset
    const cameraWorldPos = new THREE.Vector3();
    deps.camera.getWorldPosition(cameraWorldPos);

    // Calculate horizontal offset (keep camera height, move rig)
    const offset = new THREE.Vector3(
        target.x - cameraWorldPos.x,
        0, // Don't change Y — let target height determine floor
        target.z - cameraWorldPos.z,
    );

    // Fade to black, teleport, fade in
    const fadeMs = VR.TELEPORT_FADE_MS;
    const startTime = performance.now();
    let hasMoved = false;

    fadeCallback = () => {
        const elapsed = performance.now() - startTime;
        const totalDuration = fadeMs * 2;

        if (elapsed < fadeMs) {
            // Fading out (not yet moved)
        } else if (!hasMoved) {
            // At peak darkness — execute the move
            cameraRig!.position.add(offset);
            cameraRig!.position.y = target.y; // Set floor height
            hasMoved = true;
        } else if (elapsed >= totalDuration) {
            // Fade complete
            fadeCallback = null;
            isTeleporting = false;
        }
    };
}

function disposeTeleport(): void {
    if (teleportArc) {
        teleportArc.geometry.dispose();
        (teleportArc.material as THREE.Material).dispose();
        teleportArc.removeFromParent();
        teleportArc = null;
    }
    if (teleportLandingMarker) {
        teleportLandingMarker.geometry.dispose();
        (teleportLandingMarker.material as THREE.Material).dispose();
        teleportLandingMarker.removeFromParent();
        teleportLandingMarker = null;
    }
    teleportTarget = null;
    teleportValid = false;
    isTeleporting = false;
    fadeCallback = null;
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
