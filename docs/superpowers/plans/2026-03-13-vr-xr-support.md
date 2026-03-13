# VR/XR Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VR walkthrough support to Vitrine3D with teleport/smooth locomotion, annotation viewing, and asset toggle controls, using Spark.js's built-in SparkXr class.

**Architecture:** Single new module `vr-session.ts` following the deps pattern. SparkXr handles XR session lifecycle and stereo rendering. VR UI is a wrist-attached menu rendered via CanvasTexture. Annotations get parallel 3D sprite markers since DOM elements don't render in WebXR. Lazy-loaded — zero cost for non-VR users.

**Tech Stack:** Three.js 0.183.2, Spark.js 2.0 (vendored, SparkXr class), WebXR Device API, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-12-vr-xr-support-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/modules/vr-session.ts` | VR session lifecycle, SparkXr wrapper, teleport/smooth locomotion, wrist menu, VR annotation markers, auto-enter overlay |
| `src/modules/__tests__/vr-session.test.ts` | Unit tests for VR helper functions (arc math, wrist menu visibility, annotation sprite creation) |

### Modified Files
| File | Change |
|---|---|
| `src/types.ts` | Add `VRDeps` interface |
| `src/types/spark.d.ts` | Add `SparkXr` type declarations |
| `src/modules/constants.ts` | Add `VR` constants section |
| `src/config.js` | Parse `?vr=true` URL param |
| `src/main.ts` | `createVRDeps()` factory, lazy VR init, `animate()` rAF guard |
| `src/modules/kiosk-main.ts` | Same: lazy VR init, `animate()` rAF guard |
| `src/editor/index.html` | Add `<button id="btn-enter-vr">` |
| `src/index.html` | Add `<button id="btn-enter-vr">` |
| `src/styles.css` | Default `#btn-enter-vr` style |
| `src/themes/editorial/layout.css` | Theme-specific VR button position |
| `src/themes/gallery/layout.css` | Theme-specific VR button position |
| `src/themes/exhibit/layout.css` | Theme-specific VR button position |
| `src/themes/minimal/theme.css` | Theme-specific VR button position |
| `src/themes/_template/theme.css` | Theme-specific VR button position |

---

## Chunk 1: Foundation (Types, Constants, Config, SparkXr Types)

### Task 1: Add VRDeps interface to types.ts

**Files:**
- Modify: `src/types.ts` (at the end of the file, after the last interface)

- [ ] **Step 1: Add VRDeps interface**

Add at the end of `src/types.ts`:

```ts
/** Dependencies for VR session module */
export interface VRDeps {
    scene: Scene;
    camera: PerspectiveCamera;
    renderer: WebGLRenderer;
    controls: OrbitControls;
    annotationSystem: AnnotationSystem | null;
    animate: () => void;
    getAssetVisibility: () => Record<string, boolean>;
    toggleAsset: (type: string) => void;
    getSplatBudget: () => number;
    setSplatBudget: (budget: number) => void;
}
```

Note: We deliberately avoid passing `SceneRefs` since kiosk-main.ts doesn't have a `SceneRefs` object — instead we pass the individual scene objects both entry points have. We also removed `setQualityTier` — the spec §4 says only `setSplatBudget` is needed for VR quality adjustment (since `maxStdDev` is constructor-only).

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors from VRDeps addition

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(vr): add VRDeps interface to types.ts"
```

---

### Task 2: Add SparkXr type declarations

**Files:**
- Modify: `src/types/spark.d.ts` (after existing SparkRenderer class, ~line 88)

SparkXr is exported from the vendored Spark 2.0 module but has no type declarations. Add them based on the vendored source at `src/vendor/spark-2.0.0-preview.module.js` lines 18425–18720.

- [ ] **Step 1: Add SparkXr types**

Add to the end of `src/types/spark.d.ts`, inside the module declaration:

```ts
export interface SparkXrControllers {
    moveSpeed?: number;
    rotateSpeed?: number;
    rollSpeed?: number;
    moveHeading?: boolean;
    getMove?: (gamepads: Record<string, Gamepad>, xr: SparkXr) => THREE.Vector3;
    getRotate?: (gamepads: Record<string, Gamepad>, xr: SparkXr) => THREE.Vector3;
    getFast?: (gamepads: Record<string, Gamepad>, xr: SparkXr) => boolean;
    getSlow?: (gamepads: Record<string, Gamepad>, xr: SparkXr) => boolean;
}

export interface SparkXrButtonConfig {
    enterVrText?: string;
    exitVrText?: string;
    enterArText?: string;
    exitArText?: string;
    enterXrText?: string;
    exitXrText?: string;
    enterVrHtml?: string;
    exitVrHtml?: string;
    enterArHtml?: string;
    exitArHtml?: string;
    enterXrHtml?: string;
    exitXrHtml?: string;
}

export interface SparkXrOptions {
    renderer: THREE.WebGLRenderer;
    mode?: 'vr' | 'ar' | 'arvr' | 'vrar';
    element?: HTMLElement;
    elementId?: string;
    button?: SparkXrButtonConfig | boolean;
    referenceSpaceType?: XRReferenceSpaceType;
    frameBufferScaleFactor?: number;
    fixedFoveation?: number;
    enableHands?: boolean;
    allowMobileXr?: boolean;
    controllers?: SparkXrControllers;
    sessionInit?: XRSessionInit;
    onEnterXr?: () => void;
    onExitXr?: () => void;
    onReady?: (supported: boolean) => void;
    onMouseLeaveOpacity?: number;
}

export class SparkXr {
    constructor(options: SparkXrOptions);
    mode: string;
    session: XRSession | undefined;
    element: HTMLElement | undefined;
    hands: any[];
    toggleXr(): Promise<void>;
    updateControllers(camera: THREE.Camera): void;
    updateHands(params: { xrFrame: XRFrame }): void;
    xrSupported(): boolean;
    left(): any;
    right(): any;
    static createButton(): HTMLButtonElement;
}
```

- [ ] **Step 2: Verify these types match the vendored source**

Run: `grep -n "moveSpeed\|rotateSpeed\|rollSpeed\|moveHeading\|getMove\|getRotate\|getFast\|getSlow" src/vendor/spark-2.0.0-preview.module.js | head -20`

Confirm field names match.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/types/spark.d.ts
git commit -m "feat(vr): add SparkXr type declarations"
```

---

### Task 3: Add VR constants

**Files:**
- Modify: `src/modules/constants.ts` (after last section, e.g., after `FLIGHT_LOG`)

- [ ] **Step 1: Add VR constants section**

```ts
/** VR/XR configuration defaults */
export const VR = {
    /** Splat budget for PC-tethered headsets (targeting 3070-class GPU at 90fps) */
    SPLAT_BUDGET_PC: 2_000_000,
    /** Splat budget for standalone headsets like Quest 3 (future) */
    SPLAT_BUDGET_STANDALONE: 500_000,
    /** Reduced Gaussian falloff for VR perf — Spark docs recommend sqrt(5) */
    MAX_STD_DEV: Math.sqrt(5),
    /** Framebuffer scale — 0.5 is SparkXr default for VR */
    FRAMEBUFFER_SCALE: 0.5,
    /** Maximum teleport distance in meters */
    TELEPORT_MAX_DISTANCE: 20,
    /** Fade-to-black duration for teleport snap in ms */
    TELEPORT_FADE_MS: 200,
    /** Snap turn increment in degrees */
    SNAP_TURN_DEGREES: 30,
    /** Dot product threshold for wrist-look to show menu */
    WRIST_MENU_LOOK_THRESHOLD: 0.7,
    /** Annotation marker scale multiplier in VR */
    MARKER_SCALE_VR: 2.0,
    /** Wrist menu width in meters */
    WRIST_MENU_WIDTH: 0.3,
    /** Wrist menu height in meters */
    WRIST_MENU_HEIGHT: 0.25,
} as const;
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/modules/constants.ts
git commit -m "feat(vr): add VR constants section"
```

---

### Task 4: Parse `?vr=true` URL param in config.js

**Files:**
- Modify: `src/config.js` (~line 148 for param, ~line 220 for APP_CONFIG)

- [ ] **Step 1: Add VR param parsing**

After the line `const autoload = ...` (~line 150), add:

```js
const vrMode = params.get('vr') === 'true';
```

In the `window.APP_CONFIG = { ... }` block (~line 195), add:

```js
        vr: vrMode,
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/config.js
git commit -m "feat(vr): parse ?vr=true URL param in config.js"
```

---

## Chunk 2: HTML, CSS, Theme Integration

### Task 5: Add VR button to editor HTML

**Files:**
- Modify: `src/editor/index.html` (after Cross-Section button group, ~line 176, before the Output separator ~line 178)

- [ ] **Step 1: Add VR button element**

Insert after the Cross-Section tool group, before the `<!-- Output -->` separator:

```html
                    <!-- VR -->
                    <button class="tool-btn hidden" id="btn-enter-vr" data-tooltip="Enter VR" title="Enter VR mode">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M2 8a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-2.5l-1.5 2h-4l-1.5-2H6a4 4 0 0 1-4-4V8z"/>
                            <circle cx="8.5" cy="10.5" r="2"/>
                            <circle cx="15.5" cy="10.5" r="2"/>
                        </svg>
                    </button>
```

- [ ] **Step 2: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(vr): add VR button to editor toolbar"
```

---

### Task 6: Add VR button to kiosk HTML

**Files:**
- Modify: `src/index.html` (in the viewport overlay area, after the display pill controls)

- [ ] **Step 1: Add VR button element**

Add near the other kiosk control buttons (after the annotation toggle button area):

```html
        <!-- VR -->
        <button class="kiosk-floating-btn hidden" id="btn-enter-vr" title="Enter VR">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M2 8a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-2.5l-1.5 2h-4l-1.5-2H6a4 4 0 0 1-4-4V8z"/>
                <circle cx="8.5" cy="10.5" r="2"/>
                <circle cx="15.5" cy="10.5" r="2"/>
            </svg>
        </button>
```

- [ ] **Step 2: Commit**

```bash
git add src/index.html
git commit -m "feat(vr): add VR button to kiosk viewer"
```

---

### Task 7: Add default VR button styles and theme overrides

**Files:**
- Modify: `src/styles.css` (add default `#btn-enter-vr` rule)
- Modify: `src/themes/editorial/layout.css`
- Modify: `src/themes/gallery/layout.css`
- Modify: `src/themes/exhibit/layout.css`
- Modify: `src/themes/minimal/theme.css`
- Modify: `src/themes/_template/theme.css`

- [ ] **Step 1: Add default VR button style in styles.css**

Add to the button styles section of `src/styles.css`:

```css
/* VR mode button — default positioning for editor */
#btn-enter-vr {
    /* In editor: inherits .tool-btn styles from toolbar rail */
}

/* VR mode button — kiosk floating position */
body.kiosk-mode #btn-enter-vr {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 100;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(8px);
    transition: background 0.2s;
}

body.kiosk-mode #btn-enter-vr:hover {
    background: rgba(0, 0, 0, 0.7);
}
```

- [ ] **Step 2: Add theme overrides for each theme**

For each theme, add a minimal override to position/style the button consistently with the theme's aesthetic. The button is `.hidden` by default and only shown when XR is available.

**editorial/layout.css** — bottom-right, matches editorial glass style:
```css
#btn-enter-vr { right: 20px; bottom: 80px; }
```

**gallery/layout.css** — bottom-center area, cinematic:
```css
#btn-enter-vr { right: 20px; bottom: 20px; }
```

**exhibit/layout.css** — bottom-right, institutional:
```css
#btn-enter-vr { right: 20px; bottom: 80px; }
```

**minimal/theme.css** — inherits default:
```css
/* VR button uses default kiosk positioning */
```

**_template/theme.css** — comment placeholder:
```css
/* VR button: override #btn-enter-vr positioning here */
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/styles.css src/themes/
git commit -m "feat(vr): add VR button styles and theme overrides"
```

---

## Chunk 3: Core VR Session Module

### Task 8: Create vr-session.ts — SparkXr lifecycle and render loop

**Files:**
- Create: `src/modules/vr-session.ts`

This is the core module. We build it incrementally across Tasks 8–12. Start with session lifecycle only.

- [ ] **Step 1: Create vr-session.ts with session lifecycle**

```ts
import * as THREE from 'three';
import { SparkXr } from '@sparkjsdev/spark';
import { Logger } from './logger.js';
import { VR } from './constants.js';
import type { VRDeps } from '../types.js';

const log = Logger.getLogger('vr-session');

/** VR session state */
interface VRSessionState {
    sparkXr: SparkXr | null;
    active: boolean;
    previousSplatBudget: number;
    locomotionMode: 'teleport' | 'smooth';
    // Populated in later tasks:
    vrMarkers: THREE.Sprite[];
    wristMenu: THREE.Group | null;
    controllerRay: THREE.Line | null;
    teleportArc: THREE.Line | null;
    teleportTarget: THREE.Mesh | null;
    annotationCard: THREE.Mesh | null;
}

let vrState: VRSessionState | null = null;
let deps: VRDeps | null = null;

/**
 * Initialize VR support. Call after scene setup.
 * Lazy-loaded — only called when navigator.xr exists or APP_CONFIG.vr is set.
 */
export function initVR(vrDeps: VRDeps): void {
    deps = vrDeps;
    const renderer = deps.renderer;

    vrState = {
        sparkXr: null,
        active: false,
        previousSplatBudget: 0,
        locomotionMode: 'teleport',
        vrMarkers: [],
        wristMenu: null,
        controllerRay: null,
        teleportArc: null,
        teleportTarget: null,
        annotationCard: null,
    };

    const btnEl = document.getElementById('btn-enter-vr');
    if (!btnEl) {
        log.warn('VR button element #btn-enter-vr not found');
        return;
    }

    vrState.sparkXr = new SparkXr({
        renderer,
        mode: 'vr',
        element: btnEl,
        referenceSpaceType: 'local',
        frameBufferScaleFactor: VR.FRAMEBUFFER_SCALE,
        fixedFoveation: 1.0,
        enableHands: false,
        onEnterXr: () => enterVRMode(),
        onExitXr: () => exitVRMode(),
        onReady: (supported: boolean) => {
            if (supported) {
                btnEl.classList.remove('hidden');
                log.info('WebXR supported — VR button shown');
                checkAutoEnter(btnEl);
            } else {
                log.info('WebXR not supported on this device');
            }
        },
        controllers: {
            moveSpeed: 3.0,
            rotateSpeed: 1.5,
            moveHeading: true,
        },
    });
}

/** Check for ?vr=true auto-enter — show gesture overlay */
function checkAutoEnter(btnEl: HTMLElement): void {
    const config = (window as any).APP_CONFIG;
    if (!config?.vr) return;

    // Browser requires user gesture for XR session — show overlay
    const overlay = document.createElement('div');
    overlay.id = 'vr-auto-enter-overlay';
    Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '10000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#fff',
        fontSize: '24px',
        fontFamily: 'sans-serif',
        cursor: 'pointer',
    });
    overlay.textContent = 'Tap anywhere to enter VR';
    document.body.appendChild(overlay);

    const enterOnGesture = () => {
        overlay.remove();
        vrState?.sparkXr?.toggleXr();
    };
    overlay.addEventListener('click', enterOnGesture, { once: true });
}

/** Called by SparkXr when XR session starts */
function enterVRMode(): void {
    if (!deps || !vrState) return;
    const { renderer, animate, setSplatBudget, getSplatBudget } = deps;

    vrState.active = true;
    vrState.previousSplatBudget = getSplatBudget();

    // CRITICAL: Switch render loop from rAF to setAnimationLoop for WebXR
    renderer.setAnimationLoop(animate);

    // Apply VR quality profile
    setSplatBudget(VR.SPLAT_BUDGET_PC);

    // Hide DOM UI — it doesn't render in XR
    document.querySelectorAll('.sidebar, .toolbar, #loading-overlay, .vp-display-pill, #metadata-sidebar')
        .forEach(el => (el as HTMLElement).style.display = 'none');

    // Disable desktop controls
    if (deps.controls) {
        deps.controls.enabled = false;
    }

    log.info('Entered VR mode');
}

/** Called by SparkXr when XR session ends */
function exitVRMode(): void {
    if (!deps || !vrState) return;
    const { renderer, animate, setSplatBudget } = deps;

    // Switch render loop back to rAF
    renderer.setAnimationLoop(null);
    requestAnimationFrame(animate);

    // Restore splat budget
    setSplatBudget(vrState.previousSplatBudget);

    // Re-show DOM UI
    document.querySelectorAll('.sidebar, .toolbar, .vp-display-pill')
        .forEach(el => (el as HTMLElement).style.removeProperty('display'));

    // Re-enable desktop controls
    if (deps.controls) {
        deps.controls.enabled = true;
    }

    // Dispose VR-specific 3D objects
    disposeVRObjects();

    vrState.active = false;
    log.info('Exited VR mode');
}

/** Clean up VR-specific scene objects */
function disposeVRObjects(): void {
    if (!vrState || !deps) return;
    const scene = deps.scene;

    // Dispose VR annotation markers
    for (const marker of vrState.vrMarkers) {
        scene.remove(marker);
        marker.material.dispose();
    }
    vrState.vrMarkers = [];

    // Dispose wrist menu
    if (vrState.wristMenu) {
        scene.remove(vrState.wristMenu);
        vrState.wristMenu.traverse((obj: THREE.Object3D) => {
            if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
            if ((obj as THREE.Mesh).material) {
                const mat = (obj as THREE.Mesh).material;
                if (Array.isArray(mat)) mat.forEach(m => m.dispose());
                else (mat as THREE.Material).dispose();
            }
        });
        vrState.wristMenu = null;
    }

    // Dispose teleport visuals
    if (vrState.teleportArc) {
        scene.remove(vrState.teleportArc);
        vrState.teleportArc.geometry.dispose();
        (vrState.teleportArc.material as THREE.Material).dispose();
        vrState.teleportArc = null;
    }
    if (vrState.teleportTarget) {
        scene.remove(vrState.teleportTarget);
        vrState.teleportTarget.geometry.dispose();
        (vrState.teleportTarget.material as THREE.Material).dispose();
        vrState.teleportTarget = null;
    }

    // Dispose controller ray
    if (vrState.controllerRay) {
        scene.remove(vrState.controllerRay);
        vrState.controllerRay.geometry.dispose();
        (vrState.controllerRay.material as THREE.Material).dispose();
        vrState.controllerRay = null;
    }

    // Dispose annotation card
    if (vrState.annotationCard) {
        scene.remove(vrState.annotationCard);
        vrState.annotationCard.geometry.dispose();
        (vrState.annotationCard.material as THREE.Material).dispose();
        vrState.annotationCard = null;
    }
}

/** Returns whether VR mode is currently active */
export function isVRActive(): boolean {
    return vrState?.active ?? false;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds (module is tree-shaken if not imported yet, but syntax/types must be valid)

- [ ] **Step 3: Commit**

```bash
git add src/modules/vr-session.ts
git commit -m "feat(vr): create vr-session.ts with SparkXr lifecycle and render loop switch"
```

---

### Task 9: Wire VR module into main.ts (editor)

**Files:**
- Modify: `src/main.ts`
  - ~line 353: near sparkRenderer declaration (for context)
  - ~line 642: after existing deps factories (add createVRDeps)
  - ~line 2140: before animate() call in init() (add VR init)
  - ~line 3745: animate() function (add rAF guard)

- [ ] **Step 1: Add lazy VR import and createVRDeps factory**

After the existing deps factory functions (after `createArchivePipelineDeps`), add:

```ts
function createVRDeps(): import('./types.js').VRDeps {
    return {
        scene,
        camera,
        renderer,
        controls,
        annotationSystem,
        animate,
        getAssetVisibility: () => ({
            splat: splatMesh ? splatMesh.visible : false,
            mesh: modelGroup ? modelGroup.visible : false,
            pointcloud: pointcloudGroup ? pointcloudGroup.visible : false,
            cad: cadGroup ? cadGroup.visible : false,
            flightpath: sceneManager?.flightPathGroup ? sceneManager.flightPathGroup.visible : false,
        }),
        toggleAsset: (type: string) => {
            // Editor has no named toggle functions — directly toggle .visible on scene groups.
            // This is independent of displayMode and only used during VR mode.
            const groups: Record<string, THREE.Object3D | null> = {
                splat: splatMesh,
                mesh: modelGroup,
                pointcloud: pointcloudGroup,
                cad: cadGroup,
                flightpath: sceneManager?.flightPathGroup ?? null,
            };
            const target = groups[type];
            if (target) target.visible = !target.visible;
        },
        getSplatBudget: () => sparkRenderer ? sparkRenderer.lodSplatCount : 0,
        setSplatBudget: (n: number) => { if (sparkRenderer) sparkRenderer.lodSplatCount = n; },
    };
}
```

**Why direct `.visible` toggles:** The editor controls asset visibility through `setDisplayMode()` → `updateVisibility()`, which applies display mode rules (e.g., "model" mode hides splat). In VR, we bypass displayMode entirely and directly toggle scene group `.visible` flags. On VR exit, `exitVRMode()` should call `updateVisibility()` (if available via deps) to restore display-mode-correct visibility.

- [ ] **Step 2: Add lazy VR init in init()**

Before the `animate()` call at the end of `init()` (~line 2145), add:

```ts
    // VR support — lazy load only when WebXR available or ?vr=true requested
    if (navigator.xr || config.vr) {
        import('./modules/vr-session.js').then(({ initVR }) => {
            initVR(createVRDeps());
        }).catch(err => log.warn('VR module failed to load:', err));
    }
```

- [ ] **Step 3: Add rAF guard to animate()**

At the top of the `animate()` function (~line 3771), change:

```ts
// BEFORE:
function animate() {
    if (_renderPaused) return;
    _animFrameId = requestAnimationFrame(animate);

// AFTER:
function animate() {
    if (_renderPaused) return;
    // When WebXR is presenting, setAnimationLoop drives frames — don't double-schedule via rAF
    if (!renderer.xr.isPresenting) {
        _animFrameId = requestAnimationFrame(animate);
    }
```

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(vr): wire VR module into editor main.ts with deps factory and rAF guard"
```

---

### Task 10: Wire VR module into kiosk-main.ts

**Files:**
- Modify: `src/modules/kiosk-main.ts`
  - ~line 5423: animate() function (add rAF guard)
  - Near init section: add lazy VR import
  - ~line 2770: reuse existing getSplatBudget/setSplatBudget

- [ ] **Step 1: Add createVRDeps factory and lazy init**

Add a `createVRDeps()` factory near other deps functions in kiosk-main.ts. The kiosk uses different variable names than the editor — there is no `SceneRefs` object. Key variables: `scene` (THREE.Scene, line ~187), `camera` (line ~188), `renderer` (line ~190), `controls` (line ~192), `annotationSystem` (line ~194), `splatMesh` (line ~198), `modelGroup` (line ~199), `pointcloudGroup` (line ~200), `sparkRenderer` (line ~202). Reuse existing `getSplatBudget`/`setSplatBudget` pattern from ~line 2770:

```ts
function createVRDeps(): import('../types.js').VRDeps {
    return {
        scene,
        camera,
        renderer,
        controls,
        annotationSystem,
        animate,
        getAssetVisibility: () => ({
            // Kiosk tracks visibility via scene group .visible, not state flags
            splat: splatMesh ? splatMesh.visible : false,
            mesh: modelGroup ? modelGroup.visible : false,
            pointcloud: pointcloudGroup ? pointcloudGroup.visible : false,
            cad: false,       // kiosk doesn't load CAD assets
            flightpath: sceneManager?.flightPathGroup ? sceneManager.flightPathGroup.visible : false,
        }),
        toggleAsset: (type: string) => {
            // Directly toggle .visible on scene groups — same approach as editor VR deps
            const groups: Record<string, THREE.Object3D | null> = {
                splat: splatMesh,
                mesh: modelGroup,
                pointcloud: pointcloudGroup,
                flightpath: sceneManager?.flightPathGroup ?? null,
            };
            const target = groups[type];
            if (target) target.visible = !target.visible;
        },
        getSplatBudget: () => sparkRenderer ? sparkRenderer.lodSplatCount : getLodBudget(state.qualityResolved),
        setSplatBudget: (n: number) => { if (sparkRenderer) sparkRenderer.lodSplatCount = n; },
    };
}
```

Add lazy init after scene setup completes:

```ts
    if (navigator.xr || config.vr) {
        import('./vr-session.js').then(({ initVR }) => {
            initVR(createVRDeps());
        }).catch(err => log.warn('VR module failed to load:', err));
    }
```

- [ ] **Step 2: Add rAF guard to kiosk animate()**

At the top of the kiosk `animate()` function (~line 5423), change:

```ts
// BEFORE:
function animate(): void {
    if (_kioskRenderPaused) return;
    _kioskAnimFrameId = requestAnimationFrame(animate);

// AFTER:
function animate(): void {
    if (_kioskRenderPaused) return;
    if (!renderer.xr.isPresenting) {
        _kioskAnimFrameId = requestAnimationFrame(animate);
    }
```

Note: The kiosk uses `renderer` (module-scope `let` at ~line 190), not a `sceneRefs` object.

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(vr): wire VR module into kiosk-main.ts with deps factory and rAF guard"
```

---

## Chunk 4: Teleport Locomotion

### Task 11: Add teleport system to vr-session.ts

**Files:**
- Modify: `src/modules/vr-session.ts`

- [ ] **Step 1: Add teleport arc geometry and raycasting**

Add to `vr-session.ts`:

```ts
const TELEPORT_ARC_SEGMENTS = 30;
const TELEPORT_GRAVITY = 9.8;

/** Create the parabolic arc line and landing target mesh */
function createTeleportVisuals(scene: THREE.Scene): { arc: THREE.Line; target: THREE.Mesh } {
    // Arc line
    const arcGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(TELEPORT_ARC_SEGMENTS * 3);
    arcGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const arcMaterial = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 });
    const arc = new THREE.Line(arcGeometry, arcMaterial);
    arc.visible = false;
    scene.add(arc);

    // Landing target — ring + disc
    const targetGeometry = new THREE.RingGeometry(0.15, 0.25, 32);
    targetGeometry.rotateX(-Math.PI / 2);
    const targetMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
    });
    const target = new THREE.Mesh(targetGeometry, targetMaterial);
    target.visible = false;
    scene.add(target);

    return { arc, target };
}

/** Calculate parabolic arc points from controller */
function calculateArc(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    velocity: number,
): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const pos = origin.clone();
    const vel = direction.clone().multiplyScalar(velocity);

    for (let i = 0; i < TELEPORT_ARC_SEGMENTS; i++) {
        points.push(pos.clone());
        const dt = 0.05;
        pos.add(vel.clone().multiplyScalar(dt));
        vel.y -= TELEPORT_GRAVITY * dt;
    }
    return points;
}

/** Raycast arc points against scene to find landing */
function findTeleportLanding(
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
            // Check surface normal is walkable (< 45 degrees from up)
            if (hit.face && hit.face.normal.y > 0.7) {
                return hit.point;
            }
        }
    }
    return null;
}

/** Fade screen for teleport snap */
function teleportFade(renderer: THREE.WebGLRenderer, callback: () => void): void {
    // Create fullscreen fade quad in XR space
    const fadeScene = new THREE.Scene();
    const fadeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const fadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 });
    const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMat);
    fadeScene.add(fadeQuad);

    let fadeIn = true;
    const startTime = performance.now();
    const fadeDuration = VR.TELEPORT_FADE_MS;

    const doFade = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / fadeDuration, 1);

        if (fadeIn) {
            fadeMat.opacity = t;
            if (t >= 1) {
                callback(); // Execute teleport at peak darkness
                fadeIn = false;
            }
        } else {
            fadeMat.opacity = 1 - ((elapsed - fadeDuration) / fadeDuration);
            if (fadeMat.opacity <= 0) {
                fadeScene.remove(fadeQuad);
                fadeMat.dispose();
                fadeQuad.geometry.dispose();
                return;
            }
        }
    };

    // Hook into render loop — doFade will be called each frame
    // Store on vrState for per-frame update
    if (vrState) {
        (vrState as any)._fadeCallback = doFade;
    }
}
```

- [ ] **Step 2: Add per-frame VR update function**

Add a public `updateVR()` function to be called each frame from `animate()`:

```ts
/**
 * Per-frame VR update. Call from animate() when VR is active.
 * Handles teleport arc, wrist menu visibility, controller ray, and annotation hover.
 */
export function updateVR(): void {
    if (!vrState?.active || !deps) return;
    const renderer = deps.renderer;
    const xrCamera = renderer.xr.getCamera();

    // Update SparkXr controllers (smooth locomotion when enabled)
    if (vrState.locomotionMode === 'smooth' && vrState.sparkXr) {
        vrState.sparkXr.updateControllers(xrCamera);
    }

    // Run fade callback if active
    if ((vrState as any)._fadeCallback) {
        (vrState as any)._fadeCallback();
    }

    // TODO: Task 12 — wrist menu visibility + interaction
    // TODO: Task 13 — VR annotation markers + hover
}
```

- [ ] **Step 3: Wire updateVR() into both animate() functions**

In `main.ts` animate(), add after the existing render calls:

```ts
    // VR per-frame update
    if (renderer.xr.isPresenting) {
        import('./modules/vr-session.js').then(m => m.updateVR());
    }
```

Better approach — cache the import at init time. Add a module-scope variable:

```ts
let vrUpdateFn: (() => void) | null = null;
```

In the VR lazy-init block:

```ts
    import('./modules/vr-session.js').then(({ initVR, updateVR }) => {
        initVR(createVRDeps());
        vrUpdateFn = updateVR;
    });
```

In animate():

```ts
    if (renderer.xr.isPresenting && vrUpdateFn) {
        vrUpdateFn();
    }
```

Same pattern for kiosk-main.ts.

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/modules/vr-session.ts src/main.ts src/modules/kiosk-main.ts
git commit -m "feat(vr): add teleport locomotion system with arc raycasting and fade snap"
```

---

## Chunk 5: Wrist Menu UI

### Task 12: Add wrist menu to vr-session.ts

**Files:**
- Modify: `src/modules/vr-session.ts`

- [ ] **Step 1: Add CanvasTexture-based wrist menu**

```ts
interface WristMenuButton {
    label: string;
    key: string;
    type: 'toggle' | 'action';
    active: boolean;
    y: number;        // vertical position on canvas
    height: number;   // button height on canvas
}

/** Create the wrist menu panel attached to left controller */
function createWristMenu(scene: THREE.Scene): THREE.Group {
    const group = new THREE.Group();
    group.visible = false;

    // Canvas for rendering menu text/buttons
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
    });
    const geometry = new THREE.PlaneGeometry(VR.WRIST_MENU_WIDTH, VR.WRIST_MENU_HEIGHT);
    const panel = new THREE.Mesh(geometry, material);
    group.add(panel);

    // Store refs for interaction
    group.userData.canvas = canvas;
    group.userData.texture = texture;
    group.userData.panel = panel;
    group.userData.buttons = createMenuButtons();
    group.userData.hoveredButton = null;

    renderWristMenu(group);
    scene.add(group);
    return group;
}

function createMenuButtons(): WristMenuButton[] {
    const buttonHeight = 30;
    const startY = 10;
    const buttons: WristMenuButton[] = [
        { label: 'Splat', key: 'splat', type: 'toggle', active: true, y: startY, height: buttonHeight },
        { label: 'Mesh', key: 'mesh', type: 'toggle', active: true, y: startY + 32, height: buttonHeight },
        { label: 'Point Cloud', key: 'pointcloud', type: 'toggle', active: true, y: startY + 64, height: buttonHeight },
        { label: 'CAD', key: 'cad', type: 'toggle', active: true, y: startY + 96, height: buttonHeight },
        { label: 'Flight Path', key: 'flightpath', type: 'toggle', active: true, y: startY + 128, height: buttonHeight },
        { label: 'Teleport', key: 'locomotion', type: 'toggle', active: true, y: startY + 170, height: buttonHeight },
        { label: 'Exit VR', key: 'exit', type: 'action', active: false, y: startY + 212, height: buttonHeight },
    ];
    return buttons;
}

/** Render the wrist menu canvas */
function renderWristMenu(menuGroup: THREE.Group): void {
    const canvas = menuGroup.userData.canvas as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const buttons = menuGroup.userData.buttons as WristMenuButton[];
    const hovered = menuGroup.userData.hoveredButton as string | null;

    // Background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.roundRect(0, 0, canvas.width, canvas.height, 8);
    ctx.fill();

    // Buttons
    for (const btn of buttons) {
        const isHover = hovered === btn.key;

        // Button background
        ctx.fillStyle = isHover ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(8, btn.y, canvas.width - 16, btn.height);

        // Label
        ctx.fillStyle = '#fff';
        ctx.font = '14px sans-serif';
        ctx.fillText(btn.label, 16, btn.y + 20);

        // Toggle indicator
        if (btn.type === 'toggle') {
            ctx.fillStyle = btn.active ? '#00ff88' : '#ff4444';
            ctx.beginPath();
            ctx.arc(canvas.width - 24, btn.y + 15, 6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Update texture
    const texture = menuGroup.userData.texture as THREE.CanvasTexture;
    texture.needsUpdate = true;
}

/** Update wrist menu visibility based on gaze direction */
function updateWristMenu(xrCamera: THREE.Camera, renderer: THREE.WebGLRenderer): boolean {
    if (!vrState?.wristMenu || !deps) return false;

    const session = renderer.xr.getSession();
    if (!session) return false;

    // Find left controller position
    let leftControllerPos: THREE.Vector3 | null = null;
    let leftControllerQuat: THREE.Quaternion | null = null;

    for (const source of session.inputSources) {
        if (source.handedness === 'left' && source.gripSpace) {
            const pose = renderer.xr.getReferenceSpace();
            // Use controller position from Three.js XR controller
            const controller = renderer.xr.getController(0);
            if (controller) {
                leftControllerPos = new THREE.Vector3();
                leftControllerQuat = new THREE.Quaternion();
                controller.getWorldPosition(leftControllerPos);
                controller.getWorldQuaternion(leftControllerQuat);
            }
            break;
        }
    }

    if (!leftControllerPos || !leftControllerQuat) {
        vrState.wristMenu.visible = false;
        return false;
    }

    // Position menu above wrist
    vrState.wristMenu.position.copy(leftControllerPos);
    vrState.wristMenu.position.y += 0.1;
    vrState.wristMenu.quaternion.copy(leftControllerQuat);

    // Check gaze direction — show menu when user looks at wrist
    const headForward = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCamera.quaternion);
    const headPos = new THREE.Vector3();
    xrCamera.getWorldPosition(headPos);
    const toWrist = leftControllerPos.clone().sub(headPos).normalize();
    const dot = headForward.dot(toWrist);

    vrState.wristMenu.visible = dot > VR.WRIST_MENU_LOOK_THRESHOLD;
    return vrState.wristMenu.visible;
}

/** Handle wrist menu button press — returns true if a button was hit (consumes input) */
function handleWristMenuInteraction(
    raycaster: THREE.Raycaster,
    triggerPressed: boolean,
): boolean {
    if (!vrState?.wristMenu?.visible || !deps) return false;

    const panel = vrState.wristMenu.userData.panel as THREE.Mesh;
    const intersects = raycaster.intersectObject(panel);

    if (intersects.length === 0) {
        if (vrState.wristMenu.userData.hoveredButton !== null) {
            vrState.wristMenu.userData.hoveredButton = null;
            renderWristMenu(vrState.wristMenu);
        }
        return false;
    }

    // Map UV coordinates to button
    const uv = intersects[0].uv;
    if (!uv) return false;

    const buttons = vrState.wristMenu.userData.buttons as WristMenuButton[];
    const canvasY = (1 - uv.y) * 256; // flip Y
    const hitButton = buttons.find(b => canvasY >= b.y && canvasY <= b.y + b.height);

    // Update hover state
    const prevHover = vrState.wristMenu.userData.hoveredButton;
    vrState.wristMenu.userData.hoveredButton = hitButton?.key ?? null;
    if (prevHover !== vrState.wristMenu.userData.hoveredButton) {
        renderWristMenu(vrState.wristMenu);
    }

    if (!hitButton || !triggerPressed) return intersects.length > 0;

    // Handle button press
    if (hitButton.key === 'exit') {
        vrState.sparkXr?.toggleXr();
    } else if (hitButton.key === 'locomotion') {
        vrState.locomotionMode = vrState.locomotionMode === 'teleport' ? 'smooth' : 'teleport';
        hitButton.label = vrState.locomotionMode === 'teleport' ? 'Teleport' : 'Smooth';
        hitButton.active = vrState.locomotionMode === 'teleport';
        renderWristMenu(vrState.wristMenu);
    } else {
        // Asset toggle
        deps.toggleAsset(hitButton.key);
        hitButton.active = !hitButton.active;
        renderWristMenu(vrState.wristMenu);
    }

    return true; // Consumed input — don't fire teleport
}
```

- [ ] **Step 2: Wire wrist menu into enterVRMode/exitVRMode and updateVR**

In `enterVRMode()`, add after hiding DOM UI:
```ts
    vrState.wristMenu = createWristMenu(deps.scene);
```

In `updateVR()`, replace the TODO for wrist menu:
```ts
    const menuVisible = updateWristMenu(xrCamera, renderer);
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/modules/vr-session.ts
git commit -m "feat(vr): add wrist menu with CanvasTexture rendering and gaze activation"
```

---

## Chunk 6: VR Annotation Markers

### Task 13: Add VR annotation markers and text cards

**Files:**
- Modify: `src/modules/vr-session.ts`

- [ ] **Step 1: Add annotation marker creation**

```ts
/** Create 3D sprite markers for each annotation (DOM markers don't render in XR) */
function createVRAnnotationMarkers(scene: THREE.Scene): THREE.Sprite[] {
    if (!deps?.annotationSystem) return [];

    const annotations = deps.annotationSystem.getAnnotations();
    const sprites: THREE.Sprite[] = [];

    // Create pin texture via canvas
    const pinCanvas = document.createElement('canvas');
    pinCanvas.width = 64;
    pinCanvas.height = 64;
    const pCtx = pinCanvas.getContext('2d')!;

    // Draw circular pin
    pCtx.beginPath();
    pCtx.arc(32, 32, 24, 0, Math.PI * 2);
    pCtx.fillStyle = '#ff4444';
    pCtx.fill();
    pCtx.strokeStyle = '#ffffff';
    pCtx.lineWidth = 3;
    pCtx.stroke();

    // Inner dot
    pCtx.beginPath();
    pCtx.arc(32, 32, 8, 0, Math.PI * 2);
    pCtx.fillStyle = '#ffffff';
    pCtx.fill();

    const pinTexture = new THREE.CanvasTexture(pinCanvas);

    for (const anno of annotations) {
        const material = new THREE.SpriteMaterial({
            map: pinTexture.clone(),
            transparent: true,
            depthTest: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(anno.position.x, anno.position.y, anno.position.z);
        sprite.scale.setScalar(0.1 * VR.MARKER_SCALE_VR);
        sprite.userData.annotation = anno;
        scene.add(sprite);
        sprites.push(sprite);
    }

    return sprites;
}

/** Create a text card for an annotation */
function createAnnotationCard(annotation: import('../types.js').Annotation, position: THREE.Vector3): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.roundRect(0, 0, canvas.width, canvas.height, 12);
    ctx.fill();

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(annotation.title || 'Annotation', 20, 40);

    // Body text — word wrap
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#cccccc';
    const words = (annotation.body || '').split(' ');
    let line = '';
    let y = 70;
    const maxWidth = canvas.width - 40;
    const lineHeight = 22;

    for (const word of words) {
        const testLine = line + word + ' ';
        if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
            ctx.fillText(line, 20, y);
            line = word + ' ';
            y += lineHeight;
            if (y > canvas.height - 20) break; // Overflow
        } else {
            line = testLine;
        }
    }
    if (y <= canvas.height - 20) {
        ctx.fillText(line, 20, y);
    }

    // Severity/status indicator
    if (annotation.severity) {
        const colors: Record<string, string> = {
            low: '#4CAF50', medium: '#FF9800', high: '#f44336', critical: '#9C27B0',
        };
        ctx.fillStyle = colors[annotation.severity] || '#666';
        ctx.beginPath();
        ctx.arc(canvas.width - 30, 30, 10, 0, Math.PI * 2);
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
    });
    const geometry = new THREE.PlaneGeometry(0.5, 0.25);
    const card = new THREE.Mesh(geometry, material);

    // Position offset from marker
    card.position.copy(position);
    card.position.y += 0.2;
    card.position.x += 0.3;

    return card;
}

/** Handle annotation interaction — hover highlight and trigger to show card */
function updateAnnotationInteraction(
    raycaster: THREE.Raycaster,
    triggerPressed: boolean,
    scene: THREE.Scene,
    camera: THREE.Camera,
): void {
    if (!vrState || vrState.vrMarkers.length === 0) return;

    const intersects = raycaster.intersectObjects(vrState.vrMarkers);

    // Reset all markers to default scale
    for (const marker of vrState.vrMarkers) {
        const baseScale = 0.1 * VR.MARKER_SCALE_VR;
        marker.scale.setScalar(baseScale);
    }

    if (intersects.length > 0) {
        const hitMarker = intersects[0].object as THREE.Sprite;

        // Hover effect — pulse scale
        hitMarker.scale.setScalar(0.1 * VR.MARKER_SCALE_VR * 1.3);

        if (triggerPressed) {
            const annotation = hitMarker.userData.annotation;
            if (!annotation) return;

            // Toggle card — dismiss if same annotation, show if different
            if (vrState.annotationCard) {
                scene.remove(vrState.annotationCard);
                vrState.annotationCard.geometry.dispose();
                (vrState.annotationCard.material as THREE.Material).dispose();
                vrState.annotationCard = null;

                // If clicking same annotation, just dismiss
                if ((vrState as any)._lastAnnotationId === annotation.id) {
                    (vrState as any)._lastAnnotationId = null;
                    return;
                }
            }

            // Show new card
            const card = createAnnotationCard(annotation, hitMarker.position);
            // Billboard toward camera
            card.lookAt(camera.position);
            scene.add(card);
            vrState.annotationCard = card;
            (vrState as any)._lastAnnotationId = annotation.id;
        }
    } else if (triggerPressed && vrState.annotationCard) {
        // Clicking empty space dismisses card
        scene.remove(vrState.annotationCard);
        vrState.annotationCard.geometry.dispose();
        (vrState.annotationCard.material as THREE.Material).dispose();
        vrState.annotationCard = null;
        (vrState as any)._lastAnnotationId = null;
    }
}
```

- [ ] **Step 2: Wire annotation markers into enterVRMode**

In `enterVRMode()`, add after wrist menu creation:
```ts
    vrState.vrMarkers = createVRAnnotationMarkers(deps.scene);
```

- [ ] **Step 3: Update the full updateVR() function**

Replace `updateVR()` with the complete implementation that ties everything together:

```ts
export function updateVR(): void {
    if (!vrState?.active || !deps) return;
    const renderer = deps.renderer;
    const xrCamera = renderer.xr.getCamera();

    // Smooth locomotion
    if (vrState.locomotionMode === 'smooth' && vrState.sparkXr) {
        vrState.sparkXr.updateControllers(xrCamera);
    }

    // Fade callback
    if ((vrState as any)._fadeCallback) {
        (vrState as any)._fadeCallback();
    }

    // Wrist menu
    const menuVisible = updateWristMenu(xrCamera, renderer);

    // Controller ray + interaction
    const session = renderer.xr.getSession();
    if (!session) return;

    // Get right controller for ray
    const rightController = renderer.xr.getController(1);
    if (!rightController) return;

    const raycaster = new THREE.Raycaster();
    const controllerPos = new THREE.Vector3();
    const controllerDir = new THREE.Vector3(0, 0, -1);
    rightController.getWorldPosition(controllerPos);
    rightController.getWorldDirection(controllerDir);
    controllerDir.negate(); // Controller forward is -Z
    raycaster.set(controllerPos, controllerDir);

    // Check trigger state
    let triggerPressed = false;
    for (const source of session.inputSources) {
        if (source.handedness === 'right' && source.gamepad) {
            triggerPressed = source.gamepad.buttons[0]?.pressed ?? false;
            break;
        }
    }

    // Input priority: wrist menu > annotations > teleport
    const menuConsumed = menuVisible && handleWristMenuInteraction(raycaster, triggerPressed);

    if (!menuConsumed) {
        // Check annotations
        updateAnnotationInteraction(raycaster, triggerPressed, deps.scene, xrCamera);

        // Teleport (when in teleport mode)
        if (vrState.locomotionMode === 'teleport') {
            // Create teleport visuals on first use
            if (!vrState.teleportArc) {
                const visuals = createTeleportVisuals(deps.scene);
                vrState.teleportArc = visuals.arc;
                vrState.teleportTarget = visuals.target;
            }

            // Check if trigger is held — show arc
            const triggerValue = getTriggerValue(session, 'right');
            if (triggerValue > 0.1) {
                const arcPoints = calculateArc(controllerPos, controllerDir, 5.0);
                const landing = findTeleportLanding(arcPoints, deps.scene, VR.TELEPORT_MAX_DISTANCE);

                // Update arc geometry
                const positions = vrState.teleportArc.geometry.attributes.position as THREE.BufferAttribute;
                for (let i = 0; i < arcPoints.length && i < TELEPORT_ARC_SEGMENTS; i++) {
                    positions.setXYZ(i, arcPoints[i].x, arcPoints[i].y, arcPoints[i].z);
                }
                positions.needsUpdate = true;
                vrState.teleportArc.visible = true;

                // Update landing indicator
                if (landing && vrState.teleportTarget) {
                    vrState.teleportTarget.position.copy(landing);
                    vrState.teleportTarget.visible = true;
                    (vrState.teleportArc.material as THREE.LineBasicMaterial).color.setHex(0x00ff88);
                } else if (vrState.teleportTarget) {
                    vrState.teleportTarget.visible = false;
                    (vrState.teleportArc.material as THREE.LineBasicMaterial).color.setHex(0xff4444);
                }
            } else {
                // Trigger released — teleport if valid landing
                if (vrState.teleportArc?.visible && vrState.teleportTarget?.visible) {
                    const landingPos = vrState.teleportTarget.position.clone();
                    const cameraRig = xrCamera.parent;
                    if (cameraRig) {
                        teleportFade(renderer, () => {
                            cameraRig.position.copy(landingPos);
                        });
                    }
                }
                if (vrState.teleportArc) vrState.teleportArc.visible = false;
                if (vrState.teleportTarget) vrState.teleportTarget.visible = false;
            }
        }
    }

    // Billboard annotation card toward camera
    if (vrState.annotationCard) {
        vrState.annotationCard.lookAt(xrCamera.position);
    }
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/modules/vr-session.ts
git commit -m "feat(vr): add VR annotation markers and text card popups"
```

---

## Chunk 7: Tests and Final Verification

### Task 14: Add unit tests for VR helper functions

**Files:**
- Create: `src/modules/__tests__/vr-session.test.ts`

Test the pure functions. First, export `calculateArc` and `findTeleportLanding` from `vr-session.ts` with `/** @internal */` JSDoc tags so they're available for testing without cluttering the public API.

In `vr-session.ts`, change:
```ts
function calculateArc(...)     →  export function _calculateArc(...)
function findTeleportLanding(...)  →  export function _findTeleportLanding(...)
```

Then keep internal aliases:
```ts
const calculateArc = _calculateArc;
const findTeleportLanding = _findTeleportLanding;
```

- [ ] **Step 1: Write tests**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

describe('VR Session', () => {
    describe('module exports', () => {
        it('exports public API', async () => {
            const mod = await import('../vr-session.js');
            expect(mod.initVR).toBeDefined();
            expect(mod.updateVR).toBeDefined();
            expect(mod.isVRActive).toBeDefined();
        });

        it('isVRActive returns false before init', async () => {
            const { isVRActive } = await import('../vr-session.js');
            expect(isVRActive()).toBe(false);
        });
    });

    describe('teleport arc calculation', () => {
        it('generates correct number of points', async () => {
            const { _calculateArc } = await import('../vr-session.js');
            const origin = new THREE.Vector3(0, 1.5, 0);
            const direction = new THREE.Vector3(0, 0.3, -1).normalize();
            const points = _calculateArc(origin, direction, 5.0);
            expect(points.length).toBe(30); // TELEPORT_ARC_SEGMENTS
        });

        it('arc descends due to gravity', async () => {
            const { _calculateArc } = await import('../vr-session.js');
            const origin = new THREE.Vector3(0, 1.5, 0);
            const direction = new THREE.Vector3(0, 0, -1);
            const points = _calculateArc(origin, direction, 5.0);
            // Last point should be lower than first due to gravity
            expect(points[points.length - 1].y).toBeLessThan(points[0].y);
        });

        it('arc starts at origin', async () => {
            const { _calculateArc } = await import('../vr-session.js');
            const origin = new THREE.Vector3(1, 2, 3);
            const direction = new THREE.Vector3(0, 0, -1);
            const points = _calculateArc(origin, direction, 5.0);
            expect(points[0].x).toBeCloseTo(1);
            expect(points[0].y).toBeCloseTo(2);
            expect(points[0].z).toBeCloseTo(3);
        });
    });

    describe('VR constants', () => {
        it('VR constants are properly defined', async () => {
            const { VR } = await import('../constants.js');
            expect(VR.SPLAT_BUDGET_PC).toBe(2_000_000);
            expect(VR.SPLAT_BUDGET_STANDALONE).toBe(500_000);
            expect(VR.TELEPORT_MAX_DISTANCE).toBe(20);
            expect(VR.SNAP_TURN_DEGREES).toBe(30);
            expect(VR.MARKER_SCALE_VR).toBe(2.0);
            expect(VR.MAX_STD_DEV).toBeCloseTo(Math.sqrt(5));
        });
    });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: All tests pass (including existing test suites)

- [ ] **Step 3: Commit**

```bash
git add src/modules/__tests__/vr-session.test.ts
git commit -m "test(vr): add VR session unit tests"
```

---

### Task 15: Verify full build and lint

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK)

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All test suites pass

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore(vr): lint and build fixes"
```

---

## Implementation Notes

### Testing VR without a headset
- Chrome DevTools has a WebXR emulator extension that simulates VR sessions
- The `?vr=true` overlay can be tested in any browser — it just won't find a session
- `SparkXr.onReady(false)` fires when no headset is found — VR button stays hidden

### What to verify with a real headset
1. Scene renders in stereo (splats + meshes + point clouds)
2. Teleport arc appears and snaps correctly
3. Wrist menu appears when looking at left wrist
4. Annotation markers are visible and readable
5. Exit VR restores desktop mode cleanly
6. `?vr=true` shows overlay and enters on tap

### Key risk: SparkXr controller field names
The `controllers` config in Task 8 uses field names derived from source analysis. If they don't work at runtime, check the vendored source at `src/vendor/spark-2.0.0-preview.module.js` line ~18657 and update the type declarations accordingly.
