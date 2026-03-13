# VR/XR Support — Design Spec

**Date:** 2026-03-12
**Status:** Draft
**Scope:** VR walkthrough for Vitrine3D — viewing, annotations, light controls

---

## 1. Goals & Non-Goals

### Goals
- VR scene walkthrough with teleport and smooth locomotion
- View and read 3D annotations in VR
- Light controls: toggle asset visibility, locomotion mode, exit VR
- Entry from both editor and kiosk, plus `?vr=true` direct-launch param
- PC-tethered headsets as primary target (SteamVR, OpenXR via desktop browser or Tauri)

### Non-Goals (v1)
- AR overlay mode
- Quest standalone optimization (future)
- Hand tracking (future — `SparkXr` already supports it)
- VR annotation creation/editing
- Measurement tools in VR
- Multi-user VR sessions
- Adaptive frame-time scaling (future enhancement)

---

## 2. Background: Spark.js WebXR Support

Spark.js 2.0 has **first-class WebXR support** already built in. Key findings from source analysis of the vendored `spark-2.0.0-preview.module.js`:

### SparkXr Class (line ~18425)
A dedicated convenience class that handles the full XR session lifecycle:
- Session modes: `vr`, `ar`, `arvr`, `vrar`
- Auto-creates Enter VR/AR button (or accepts custom element)
- Callbacks: `onEnterXr`, `onExitXr`, `onReady`
- Hand tracking via `enableHands` option
- Built-in controller support: `updateControllers(camera)` maps XR gamepads to movement/rotation
- Configurable: `fixedFoveation`, `frameBufferScaleFactor`, `referenceSpaceType`

### Stereo Rendering (lines ~10096, ~15778)
The render pipeline detects `renderer.xr.isPresenting` and adapts automatically:
- `preUpdate` is forced off in XR (per Spark docs: "must be false to complete rendering as soon as possible")
- Uses `renderer.xr.getCamera()` for the XR camera array
- Splat sorting uses the **averaged eye position** (not per-eye) — standard optimization
- Framebuffer size detection falls back to `baseLayer.framebufferWidth/Height` in XR

### FpsMovement XR Controllers
Spark's `FpsMovement` class accepts `xr: renderer.xr` and maps XR controllers as a split gamepad. Tested on Quest 3.

### VR Performance Tuning (from Spark docs)
- `maxStdDev`: Use `Math.sqrt(5)` in VR (vs default `Math.sqrt(8)`) — ~35% cheaper with minimal visual difference
- Quest 3: up to 1M splats
- `frameBufferScaleFactor`: defaults to 0.5 in SparkXr

**Implication:** The hardest part (stereo Gaussian splat rendering) is already solved. Remaining work is standard VR interaction patterns.

---

## 3. Architecture

### New Module: `src/modules/vr-session.ts`

Single module following the deps pattern. ~550–800 lines estimated. Split into `vr-session.ts` + `vr-ui.ts` later if needed.

Responsibilities:
- `SparkXr` wrapper (session lifecycle, enter/exit, auto-enter)
- Teleport + smooth locomotion
- Wrist menu UI panel (asset toggles, locomotion switch, exit)
- VR annotation display (3D text popups on controller point)

### New Interface in `types.ts`: `VRDeps`

```ts
interface VRDeps {
    sceneRefs: SceneRefs;
    state: AppState;
    annotationSystem: AnnotationSystem;
    animate: () => void;                                    // ref to animate() for setAnimationLoop
    getAssetVisibility: () => Record<string, boolean>;
    toggleAsset: (type: string) => void;
    setQualityTier: (tier: 'sd' | 'hd') => Promise<void>;  // async — switchQualityTier returns Promise
    getSplatBudget: () => number;
    setSplatBudget: (budget: number) => void;               // sets sparkRenderer.lodSplatCount
}
```

### `createVRDeps()` Factory (both entry points)

`kiosk-main.ts` already has `getSplatBudget`/`setSplatBudget` (lines 2694–2695). `main.ts` does not — it must add them following the same pattern:

```ts
// main.ts — add to createVRDeps()
function createVRDeps(): VRDeps {
    return {
        sceneRefs,
        state,
        annotationSystem,
        animate,
        getAssetVisibility: () => ({
            splat: !state.splatHidden,
            mesh: !state.meshHidden,
            pointcloud: !state.pointCloudHidden,
            cad: !state.cadHidden,
            flightpath: !state.flightPathHidden,
        }),
        toggleAsset: (type: string) => { /* dispatch to existing toggle functions */ },
        setQualityTier: switchQualityTier,
        getSplatBudget: () => sparkRenderer ? sparkRenderer.lodSplatCount : 0,
        setSplatBudget: (n: number) => { if (sparkRenderer) sparkRenderer.lodSplatCount = n; },
    };
}
```

### Thin Touchpoints in Existing Files

| File | Change | Size |
|---|---|---|
| `main.ts` | Import VR module, `createVRDeps()` factory (see above), call `initVR()` in `init()`. Guard `animate()` to not call `requestAnimationFrame` when `renderer.xr.isPresenting`. | ~25 lines |
| `kiosk-main.ts` | Same lazy import + init + animate guard. Reuse existing `getSplatBudget`/`setSplatBudget` from debug object (lines 2694–2695). | ~20 lines |
| `editor/index.html` | Add `<button id="btn-enter-vr" class="hidden">` | 1 element |
| `index.html` | Add `<button id="btn-enter-vr" class="hidden">` | 1 element |
| `config.js` | Parse `vr=true` param into `APP_CONFIG.vr` | ~2 lines |
| `constants.js` | Add `VR` section with defaults | ~10 lines |
| `quality-tier.ts` | Add VR quality preset | ~5 lines |
| `types.ts` | Add `VRDeps` interface | ~15 lines |

### Lazy Loading

VR module is dynamically imported only when `navigator.xr` exists or `?vr=true` is set. Zero cost for non-VR users.

### What Does NOT Change
- `scene-manager.ts` — `renderer` already on `SceneRefs`
- `annotation-system.ts` — VR module reads annotation data, doesn't modify
- `file-handlers.ts` — asset loading unchanged
- `archive-loader.ts` / `archive-creator.ts` — archives don't store VR state

---

## 4. XR Session Lifecycle

### Entry Points

1. **"Enter VR" button** — visible when `SparkXr` reports `mode !== 'not_supported'`
2. **`?vr=true` URL param** — auto-enters VR after scene loads (trade show kiosks)
3. Works in both editor and kiosk mode

### SparkXr Configuration

```ts
new SparkXr({
    renderer,
    mode: 'vr',
    element: document.getElementById('btn-enter-vr'),
    referenceSpaceType: 'local',           // fallback to 'local-floor' if rejected
    frameBufferScaleFactor: 0.5,
    fixedFoveation: 1.0,
    enableHands: false,                 // controllers only for v1
    onEnterXr: () => enterVRMode(),
    onExitXr: () => exitVRMode(),
    onReady: (supported) => showVRButton(supported),
    controllers: {
        moveSpeed: 3.0,
        rotateSpeed: 1.5,
        moveHeading: true,
    }
});
```

> **Implementation note:** The `controllers` option field names above are derived from `SparkXr.updateControllers()` in the vendored source (~line 18657–18696), which reads `controllers.moveSpeed`, `controllers.rotateSpeed`, `controllers.rollSpeed`, `controllers.getMove`, `controllers.getRotate`, `controllers.getFast`, `controllers.getSlow`, and `controllers.moveHeading`. Before implementation, verify these field names against the current vendored `spark-2.0.0-preview.module.js` and `src/types/spark.d.ts` — if the type declarations don't cover `SparkXr`, add them.

### Render Loop Switch (CRITICAL)

Both `main.ts` and `kiosk-main.ts` drive rendering via `requestAnimationFrame(animate)`. WebXR does **not** fire frames through `rAF` — it requires `renderer.setAnimationLoop(callback)`. Without this, the XR session enters but nothing renders.

**On VR enter:**
```ts
renderer.setAnimationLoop(animate);
```

**On VR exit:**
```ts
renderer.setAnimationLoop(null);       // stop XR loop
requestAnimationFrame(animate);        // restart desktop rAF loop
```

**Guard in `animate()`:** Both entry points must guard against double-firing. When `renderer.xr.isPresenting` is true, `animate()` must NOT call `requestAnimationFrame(animate)` at its start — `setAnimationLoop` handles frame scheduling. The existing `clock.getDelta()` call is safe in both modes.

### enterVRMode()

- Switch render loop to `renderer.setAnimationLoop(animate)` (see above)
- Apply VR quality profile: set `lodSplatCount` to 2M via `deps.setSplatBudget()`
- **Note:** `maxStdDev` is a constructor-only option on `SparkRenderer` — it cannot be changed at runtime. The VR `maxStdDev` optimization (`Math.sqrt(5)`) must be set when the `SparkRenderer` is first created if VR is anticipated, or accepted as a v1 limitation. Changing `lodSplatCount` alone provides sufficient performance headroom for PC-tethered targets.
- Hide all DOM-based UI (sidebars, toolbars, overlays)
- Spawn wrist menu in 3D space
- Create VR annotation markers (see §7 — DOM markers don't render in XR)
- Disable OrbitControls / FlyControls (XR controllers take over)

### exitVRMode()

- Switch render loop back to `requestAnimationFrame` (see above)
- Restore previous splat budget via `deps.setSplatBudget()`
- Re-show DOM UI
- Dispose wrist menu meshes and VR annotation markers
- Restore original controls

### Auto-Enter Flow (`?vr=true`)

**Browser constraint:** All WebXR implementations require the XR session request to originate from a user gesture. Calling `sparkXr.toggleXr()` programmatically after scene load will be rejected with a `SecurityError`.

**Solution:** When `APP_CONFIG.vr` is set:
1. `config.js` parses param into `APP_CONFIG.vr`
2. After scene loads, VR module shows a full-screen overlay: "Tap anywhere to enter VR" with the VR button prominently centered
3. On first user interaction (click/tap), call `sparkXr.toggleXr()` — this satisfies the user gesture requirement
4. Fallback: if XR not available, dismiss overlay and load normally with console warning

This achieves near-auto-enter (one tap) without violating browser security policy.

---

## 5. Locomotion

### Teleport (Default)

- **Trigger:** Controller primary select (trigger button)
- **Visual:** Parabolic arc (`THREE.Line`), landing indicator (ring + disc `THREE.Mesh`)
- **Raycasting:** Against scene meshes, splat bounding boxes, and ground plane fallback
- **Snap:** Fade to black (200ms) → move camera rig → fade in (200ms)
- **Max distance:** 20m (configurable in `constants.js`)
- **Invalid targets:** Red arc, no landing indicator (too far, too steep, no hit)

### Smooth Movement (Opt-In)

- Uses Spark's built-in `SparkXr.updateControllers()` for thumbstick → camera rig translation
- Toggle via wrist menu button
- Movement relative to head direction (`moveHeading: true`)

### Rotation

- **Snap turn (default):** 30-degree increments on right thumbstick left/right
- **Smooth turn (with smooth movement):** Continuous rotation via `SparkXr.updateControllers()`

---

## 6. VR UI: Wrist Menu

### Design

- Attached to left controller position/orientation, offset above wrist
- **Hidden by default** — appears when user looks at left wrist (dot product between head forward vector and wrist-to-head direction > 0.7 threshold)
- Disappears when user looks away
- Right controller ray for interaction (point and trigger to press)
- **Input priority:** Wrist menu hit-test is checked first each frame. If a panel element is hit, the event is consumed and teleport does not fire. Teleport arc only activates when the ray hits no UI element.

### Dimensions

- ~0.3m wide × 0.25m tall in world space
- Semi-transparent dark background panel

### Controls

| Control | Type | Action |
|---|---|---|
| Splat toggle | On/off | `toggleAsset('splat')` |
| Mesh toggle | On/off | `toggleAsset('mesh')` |
| Point cloud toggle | On/off | `toggleAsset('pointcloud')` |
| CAD toggle | On/off | `toggleAsset('cad')` |
| Flight path toggle | On/off | `toggleAsset('flightpath')` |
| Locomotion mode | Toggle | Switch teleport / smooth |
| Exit VR | Button | `sparkXr.toggleXr()` |

### Rendering

- Text rendered to `CanvasTexture` (no `three-mesh-ui` dependency)
- Button states (on/off/hover) are texture swaps on canvas
- Canvas redrawn only on state change, not per-frame

---

## 7. Annotations in VR

### Marker Display

**Important:** Existing annotation markers are DOM `HTMLDivElement` elements positioned via CSS transforms — they are NOT `THREE.Sprite` objects in the scene graph. DOM elements do not render inside a WebXR session.

**VR marker strategy:** On `enterVRMode()`, the VR module creates a parallel set of 3D marker objects from `annotationSystem.annotations` data:
- `THREE.Sprite` with a pin/dot texture for each annotation, placed at the annotation's `position` (Vector3)
- Sprites are added to the scene and billboard toward the camera automatically
- Scaled 2x relative to desktop markers for VR visibility (`MARKER_SCALE_VR` constant)
- On `exitVRMode()`, VR sprites are disposed — DOM markers resume normal operation
- VR markers are owned and managed entirely by `vr-session.ts`, not by `annotation-system.ts`

### Reading Annotations

- Point right controller ray at marker
- **Hover:** Marker pulses/highlights
- **Trigger press:** Floating text card appears next to marker
  - `CanvasTexture` rendered panel (same technique as wrist menu)
  - Shows title + description text
  - Markdown images NOT displayed in VR v1 (text only)
- **Dismiss:** Trigger again or point away
- Only one annotation card visible at a time

### No VR Editing

Annotations are read-only in VR. Creation/editing remains in the desktop editor.

---

## 8. Performance & Quality

### VR Quality Profile

| Setting | PC-Tethered (v1) | Quest Standalone (Future) |
|---|---|---|
| Splat budget | 2,000,000 | 500,000 |
| `maxStdDev` | `Math.sqrt(5)` * | `Math.sqrt(5)` * |
| `frameBufferScaleFactor` | 0.5 | 0.5 |
| `fixedFoveation` | 1.0 | 1.0 |
| Target framerate | 90fps | 72fps |

\* `maxStdDev` is constructor-only — cannot be changed at runtime. To apply in v1, set at `SparkRenderer` creation time if VR is anticipated (e.g., when `APP_CONFIG.vr` is set or `navigator.xr` is available). Otherwise, this optimization is deferred to a future version that recreates the renderer on VR entry. See §4 for details.

### Constants (`constants.js`)

```js
VR: {
    SPLAT_BUDGET_PC: 2_000_000,
    SPLAT_BUDGET_STANDALONE: 500_000,
    MAX_STD_DEV: Math.sqrt(5),
    FRAMEBUFFER_SCALE: 0.5,
    TELEPORT_MAX_DISTANCE: 20,
    TELEPORT_FADE_MS: 200,
    SNAP_TURN_DEGREES: 30,
    WRIST_MENU_LOOK_THRESHOLD: 0.7,
    MARKER_SCALE_VR: 2.0,
}
```

### Frame Budget

At 90fps the frame budget is ~11ms. Stereo rendering doubles draw calls but:
- `frameBufferScaleFactor: 0.5` halves pixel count
- `maxStdDev = Math.sqrt(5)` reduces per-splat cost ~35%
- Splat sorting is done once (averaged eye position), not per-eye
- 2M splats at these settings should be comfortable on a 3070-class GPU

---

## 9. Theme Integration

Each theme needs a CSS rule for `#btn-enter-vr` positioning/appearance.

**Button visibility mechanism:**
- Button starts with `.hidden` class in HTML (`display: none !important`)
- `showVRButton(supported)` removes `.hidden` class when XR is supported — no inline style toggling
- Themes that don't style the button get default positioning (bottom-right corner, absolute)

**Default button style** (in `styles.css`):
- Positioned absolute, bottom-right of the viewport
- Semi-transparent background, white icon/text
- `.hidden` hides it; no fade transition needed (instant show/hide)

Themes to update: editorial, gallery, exhibit, minimal, _template. Each theme's `layout.css` may override position/colors to match its aesthetic.

---

## 10. Difficulty Ratings

| Component | Difficulty | Notes |
|---|---|---|
| WebXR session lifecycle | 2/10 | `SparkXr` handles it |
| Render loop switch | 3/10 | `setAnimationLoop` + `rAF` guard in both entry points |
| Stereo splat rendering | 2/10 | Built into Spark, automatic |
| Smooth locomotion | 1/10 | `SparkXr.updateControllers()` |
| Controller input | 2/10 | Built into `SparkXr` |
| VR entry button + `?vr=true` | 3/10 | Wire `SparkXr` + gesture-gated overlay for auto-enter |
| Quality tier adaptation | 3/10 | `setSplatBudget` on enter/exit; `maxStdDev` is constructor-only (v1 limitation) |
| Teleport locomotion | 4/10 | Arc raycaster + snap + fade. Standard pattern |
| Wrist menu UI | 5/10 | 3D panel, CanvasTexture, raycaster interaction, input priority over teleport |
| VR annotation markers | 6/10 | Must create parallel 3D sprites from DOM annotation data + text card popups |
| Theme button styling | 2/10 | CSS across 5 themes |
| **Overall** | **~3–4/10** | Spark does the heavy lifting |

---

## 11. Future Work (Out of Scope)

| Item | Notes |
|---|---|
| AR overlay mode | `SparkXr` supports `mode: 'ar'` — add passthrough rendering |
| Quest standalone | Lower splat budget, test on Quest Browser |
| Hand tracking | `SparkXr` has `enableHands` + `XrHand` — map gestures |
| Adaptive frame-time scaling | Auto-reduce `lodSplatCount` if frame time >11ms |
| Comfort vignette | Darken peripheral vision during smooth movement |
| VR measurement tool | Point-to-point distance via controller |
| VR annotation creation | Place annotations via controller pointing |
| Multi-user VR | Shared sessions (requires server component) |
