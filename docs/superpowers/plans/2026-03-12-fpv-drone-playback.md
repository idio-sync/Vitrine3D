# FPV Drone Flight Playback — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-person camera view (FPV) to drone flight playback in the editor, with chase cam, smooth transitions, free-look, PiP, and telemetry readout.

**Architecture:** Extend `FlightPathManager` in `flight-path.ts` with camera mode state machine (orbit/chase/fpv), FPV orientation logic (gimbal-locked + heading fallback), smooth transitions, free-look, PiP camera, and telemetry getters. Wire everything from `main.ts` and add UI controls to `editor/index.html`. No new modules.

**Tech Stack:** Three.js (PerspectiveCamera, Quaternion, Euler, Vector3), existing FlightPathManager, existing editor panel HTML.

**Spec:** `docs/superpowers/specs/2026-03-12-fpv-drone-playback-design.md`

---

## Chunk 1: Prerequisites & Camera Mode Refactor

### Task 1: Fix hardcoded deltaTime in animate loop

**Files:**
- Modify: `src/main.ts:3587-3588`

- [ ] **Step 1: Add THREE.Clock instance near the top of animate scope**

In `src/main.ts`, find the camera dirty tracking section (around line 3556) and add a Clock:

```typescript
// Camera dirty tracking — skip marker DOM updates when camera is stationary
const _prevCamPos = new THREE.Vector3();
const _prevCamQuat = new THREE.Quaternion();
let _markersDirty = true; // Start dirty so first frame always updates
const _clock = new THREE.Clock();
```

- [ ] **Step 2: Replace hardcoded 1/60 with clock delta**

Replace:
```typescript
if (flightPathManager?.isPlaying) {
    flightPathManager.updatePlayback(1 / 60);
}
```
With:
```typescript
// Always get delta (keeps clock ticking even when not playing)
// Clamp to 100ms to avoid huge first-frame jump (Clock starts on construction)
const dt = Math.min(_clock.getDelta(), 0.1);
if (flightPathManager?.isPlaying) {
    flightPathManager.updatePlayback(dt);
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "fix(flight-path): use THREE.Clock for accurate playback deltaTime"
```

---

### Task 2: Add CameraMode type and refactor _followCamera

**Files:**
- Modify: `src/modules/flight-path.ts:149-157` (playback state)
- Modify: `src/types.ts` (add CameraMode export)

- [ ] **Step 1: Export CameraMode from types.ts**

Add after the `MarkerDensity` type (around line 21):

```typescript
export type FlightCameraMode = 'orbit' | 'chase' | 'fpv';
```

- [ ] **Step 2: Import and replace _followCamera with _cameraMode in flight-path.ts**

Add to imports:
```typescript
import type { FlightPoint, FlightPathData, FlightCameraMode } from '@/types.js';
```

Replace the `_followCamera` field (line 155):
```typescript
// Before:
private _followCamera = false;

// After:
private _cameraMode: FlightCameraMode = 'orbit';
```

- [ ] **Step 3: Update setFollowCamera / get followCamera as compatibility wrappers**

Replace the existing methods (lines 770-776):

```typescript
/** Toggle follow-camera mode. @deprecated Use setCameraMode() instead. */
setFollowCamera(follow: boolean): void {
    this._cameraMode = follow ? 'chase' : 'orbit';
}

get followCamera(): boolean {
    return this._cameraMode === 'chase';
}
```

- [ ] **Step 4: Update the chase camera block in updatePlaybackPosition**

Replace `if (this._followCamera &&` (line 857):

```typescript
// Follow camera (chase mode)
if (this._cameraMode === 'chase' && this.camera instanceof THREE.PerspectiveCamera) {
```

- [ ] **Step 5: Add new setCameraMode method (basic version — transitions added in Task 5)**

Add after `setFollowCamera`:

```typescript
/** Set camera mode: orbit, chase, or fpv. */
setCameraMode(mode: FlightCameraMode): void {
    if (this._cameraMode === mode) return;
    this._cameraMode = mode;
    log.info(`Camera mode changed to: ${mode}`);
}

get cameraMode(): FlightCameraMode {
    return this._cameraMode;
}

get isTransitioning(): boolean {
    return this._transitioning;
}
```

- [ ] **Step 6: Verify build and test**

Run: `npm run build && npm test`
Expected: Clean build, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/modules/flight-path.ts
git commit -m "refactor(flight-path): replace _followCamera with CameraMode enum"
```

---

### Task 3: Add FPV orientation logic

**Files:**
- Modify: `src/modules/flight-path.ts`

- [ ] **Step 1: Add FPV state fields to the class**

After `_cameraMode` (around line 155), add:

```typescript
// FPV state
private _fpvQuaternion = new THREE.Quaternion();       // target orientation (gimbal or heading)
private _smoothedQuaternion = new THREE.Quaternion();   // smoothed orientation (slerp'd each frame)
private _freeLookOffset = new THREE.Quaternion();       // user drag offset from base orientation
private _freeLookActive = false;
private _recentering = false;
private _recenterStartQuat = new THREE.Quaternion();
private _recenterProgress = 0;
private static readonly SLERP_ALPHA = 0.15;  // low-pass filter: 15% convergence per frame = heavy smoothing for noisy gimbal data
private static readonly RECENTER_DURATION = 0.5; // seconds
```

- [ ] **Step 2: Add FPV orientation computation method**

Add after `getPlaybackHeading`:

```typescript
/** Compute the FPV camera orientation quaternion for the current playback position. */
private computeFpvOrientation(points: FlightPoint[], timeMs: number): THREE.Quaternion {
    let i = 0;
    while (i < points.length - 1 && points[i + 1].timestamp <= timeMs) i++;

    const point = points[i];
    const hasGimbal = point.gimbalPitch !== undefined && point.gimbalYaw !== undefined;

    if (hasGimbal) {
        // Gimbal-locked: use gimbal yaw + pitch
        const euler = new THREE.Euler(
            (point.gimbalPitch! * Math.PI) / 180, // pitch (X)
            (point.gimbalYaw! * Math.PI) / 180,   // yaw (Y)
            0,                                       // roll (Z) — assumed 0
            'YXZ'
        );
        return new THREE.Quaternion().setFromEuler(euler);
    }

    // Heading-forward fallback
    let heading: number;
    if (points.length < 50) {
        // Sparse path (typical KML waypoints): use Catmull-Rom interpolated direction
        // to avoid abrupt heading changes between widely spaced waypoints
        heading = this.getCatmullRomHeading(points, i);
    } else {
        heading = this.getPlaybackHeading(points, timeMs);
    }
    const pitchRad = (-15 * Math.PI) / 180; // -15° downward pitch
    const euler = new THREE.Euler(pitchRad, heading, 0, 'YXZ');
    return new THREE.Quaternion().setFromEuler(euler);
}
```

- [ ] **Step 2b: Add Catmull-Rom heading helper for sparse paths**

Add after `computeFpvOrientation`:

```typescript
/** Compute heading using Catmull-Rom tangent for smooth direction on sparse paths. */
private getCatmullRomHeading(points: FlightPoint[], index: number): number {
    // Use surrounding points to compute a smooth tangent
    const i0 = Math.max(0, index - 1);
    const i1 = index;
    const i2 = Math.min(points.length - 1, index + 1);
    const i3 = Math.min(points.length - 1, index + 2);

    // Catmull-Rom tangent at i1: 0.5 * (P2 - P0)
    const tx = 0.5 * (points[i2].x - points[i0].x);
    const tz = 0.5 * (points[i2].z - points[i0].z);

    if (tx === 0 && tz === 0) {
        // Degenerate — fall back to point-to-point
        return Math.atan2(points[i2].x - points[i1].x, points[i2].z - points[i1].z);
    }
    return Math.atan2(tx, tz);
}
```

- [ ] **Step 3: Add FPV camera update to updatePlaybackPosition**

After the chase camera block (after `this.camera.lookAt(pos);` around line 867), add the FPV block:

```typescript
// FPV camera
if (this._cameraMode === 'fpv' && this.camera instanceof THREE.PerspectiveCamera && !this._transitioning) {
    const pos = this._playbackMarker.position;
    this.camera.position.copy(pos);

    // Compute target orientation
    this._fpvQuaternion.copy(this.computeFpvOrientation(points, t));

    // Smooth the base orientation (low-pass filter: small alpha = heavy smoothing)
    this._smoothedQuaternion.slerp(this._fpvQuaternion, FlightPathManager.SLERP_ALPHA);

    // Apply free-look offset (or recenter it)
    if (this._recentering) {
        // Handled in updateRecenter() called from updatePlayback()
    }

    // Compose: smoothed base * free-look offset
    const finalQuat = this._smoothedQuaternion.clone().multiply(this._freeLookOffset);
    this.camera.quaternion.copy(finalQuat);
}
```

- [ ] **Step 4: Also skip orbit controls update when in chase mode (add _transitioning field)**

Add to class fields (after FPV state):

```typescript
// Transition state
private _transitioning = false;
```

Update the chase camera block to also check `_transitioning`:

```typescript
// Follow camera (chase mode)
if (this._cameraMode === 'chase' && this.camera instanceof THREE.PerspectiveCamera && !this._transitioning) {
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add src/modules/flight-path.ts
git commit -m "feat(flight-path): add FPV orientation logic with gimbal-lock and heading fallback"
```

---

## Chunk 2: Transitions, Free-Look & Controls Wiring

### Task 4: Add smooth camera transitions (fly-in / fly-out)

**Files:**
- Modify: `src/modules/flight-path.ts`

- [ ] **Step 1: Add transition state fields**

Add after `_transitioning`:

```typescript
private _transitionDuration = 1.0; // seconds
private _transitionElapsed = 0;
private _transitionFromPos = new THREE.Vector3();
private _transitionFromQuat = new THREE.Quaternion();
private _transitionToPos = new THREE.Vector3();
private _transitionToQuat = new THREE.Quaternion();
// Saved camera state for restoring on exit
private _savedCameraPos: THREE.Vector3 | null = null;
private _savedCameraQuat: THREE.Quaternion | null = null;
private _savedControlsTarget: THREE.Vector3 | null = null;
// Callback for when camera mode changes (main.ts uses to toggle controls.enabled)
private _onCameraModeChange: ((mode: FlightCameraMode) => void) | null = null;
```

- [ ] **Step 2: Add camera mode change callback setter**

```typescript
/** Register callback for camera mode changes (used by main.ts to disable/enable OrbitControls). */
onCameraModeChange(cb: (mode: FlightCameraMode) => void): void {
    this._onCameraModeChange = cb;
}
```

- [ ] **Step 3: Rewrite setCameraMode to handle transitions**

Replace the basic `setCameraMode` from Task 2:

```typescript
/** Set camera mode with smooth transition. */
setCameraMode(mode: FlightCameraMode): void {
    if (this._cameraMode === mode) return;
    const prevMode = this._cameraMode;

    // Save camera state when leaving orbit
    if (prevMode === 'orbit' && (mode === 'chase' || mode === 'fpv')) {
        this._savedCameraPos = this.camera.position.clone();
        this._savedCameraQuat = this.camera.quaternion.clone();
        // Controls target saved via callback — main.ts passes it
    }

    this._cameraMode = mode;
    this._onCameraModeChange?.(mode);

    // Reset free-look when switching modes
    this._freeLookOffset.identity();
    this._freeLookActive = false;
    this._recentering = false;

    // Start transition if playback marker exists
    if (mode === 'orbit' && this._savedCameraPos) {
        // Fly out to saved position
        this.startTransition(this._savedCameraPos, this._savedCameraQuat!);
    } else if ((mode === 'chase' || mode === 'fpv') && this._playbackMarker && this._playing) {
        // Fly in — compute target from current playback position
        this.startTransitionToPlaybackTarget(mode);
    }

    log.info(`Camera mode changed to: ${mode}`);
}

private startTransition(toPos: THREE.Vector3, toQuat: THREE.Quaternion): void {
    this._transitioning = true;
    this._transitionElapsed = 0;
    this._transitionFromPos.copy(this.camera.position);
    this._transitionFromQuat.copy(this.camera.quaternion);
    this._transitionToPos.copy(toPos);
    this._transitionToQuat.copy(toQuat);
}

private startTransitionToPlaybackTarget(mode: FlightCameraMode): void {
    if (!this._playbackMarker) return;
    const pos = this._playbackMarker.position.clone();
    let toPos: THREE.Vector3;
    let toQuat: THREE.Quaternion;

    if (mode === 'fpv') {
        toPos = pos;
        const pathData = this._playbackPathId ? this.paths.find(p => p.id === this._playbackPathId) : null;
        const points = pathData ? this.getTrimmedPoints(pathData) : [];
        toQuat = points.length > 0 ? this.computeFpvOrientation(points, this._playbackTime) : new THREE.Quaternion();
    } else {
        // Chase: behind and above
        const pathData = this._playbackPathId ? this.paths.find(p => p.id === this._playbackPathId) : null;
        const points = pathData ? this.getTrimmedPoints(pathData) : [];
        const heading = points.length > 0 ? this.getPlaybackHeading(points, this._playbackTime) : 0;
        const camDist = 0.5;
        const camHeight = 0.3;
        toPos = new THREE.Vector3(
            pos.x - Math.sin(heading) * camDist,
            pos.y + camHeight,
            pos.z - Math.cos(heading) * camDist
        );
        toQuat = new THREE.Quaternion();
        const lookMat = new THREE.Matrix4().lookAt(toPos, pos, new THREE.Vector3(0, 1, 0));
        toQuat.setFromRotationMatrix(lookMat);
    }

    this.startTransition(toPos, toQuat);
}
```

- [ ] **Step 4: Update stopPlayback to restore camera**

Replace `stopPlayback()`:

```typescript
/** Stop playback and reset to start. Restores camera if in chase/fpv. */
stopPlayback(): void {
    this._playing = false;
    this._playbackTime = 0;
    this._playbackPathId = null;
    if (this._playbackMarker) {
        this._playbackMarker.visible = false;
    }

    // Restore camera if in follow mode
    if (this._cameraMode !== 'orbit') {
        const restoreMode = this._cameraMode;
        this._cameraMode = 'orbit';
        this._onCameraModeChange?.('orbit');

        if (this._savedCameraPos && this.camera instanceof THREE.PerspectiveCamera) {
            this.startTransition(this._savedCameraPos, this._savedCameraQuat!);
        }
    }

    this._freeLookOffset.identity();
    this._freeLookActive = false;
    // Note: do NOT set _transitioning = false here — the fly-out transition
    // started by startTransition() above needs to run to completion in updatePlayback()
    this._onPlaybackEnd?.();
}
```

- [ ] **Step 5: Add transition + recenter updates at the top of updatePlayback**

The existing `updatePlayback` starts with `if (!this._playing || ...) return;`. We need transitions and recentering to run even when not playing (e.g., fly-out on stop). Rewrite the top of `updatePlayback` to handle these before the early return:

```typescript
/** Called each frame from the animate loop. deltaTime in seconds. */
updatePlayback(deltaTime: number): void {
    // Always update transition even when not playing (fly-out on stop)
    if (this._transitioning) {
        this._transitionElapsed += deltaTime;
        const t = Math.min(1, this._transitionElapsed / this._transitionDuration);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        if (this.camera instanceof THREE.PerspectiveCamera) {
            this.camera.position.lerpVectors(this._transitionFromPos, this._transitionToPos, ease);
            this.camera.quaternion.copy(this._transitionFromQuat).slerp(this._transitionToQuat, ease);
        }
        if (t >= 1) {
            this._transitioning = false;
            if (this._cameraMode === 'fpv') {
                this._smoothedQuaternion.copy(this._fpvQuaternion);
            }
            if (this._cameraMode === 'orbit') {
                this._savedCameraPos = null;
                this._savedCameraQuat = null;
            }
        }
    }

    if (!this._playing || !this._playbackPathId) return;
    // ... rest of existing updatePlayback
```

- [ ] **Step 6: Update main.ts animate loop to always call updatePlayback when transitioning or playing**

In `src/main.ts`, replace:
```typescript
if (flightPathManager?.isPlaying) {
    flightPathManager.updatePlayback(dt);
}
```
With:
```typescript
if (flightPathManager && (flightPathManager.isPlaying || flightPathManager.isTransitioning)) {
    flightPathManager.updatePlayback(dt);
}
```

Note: `isTransitioning` getter ensures fly-out transitions run even after `_playing` becomes false (e.g., on stop).

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 8: Commit**

```bash
git add src/modules/flight-path.ts src/main.ts
git commit -m "feat(flight-path): add smooth camera transitions between orbit/chase/fpv"
```

---

### Task 5: Wire OrbitControls enable/disable from main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Register camera mode change callback after FlightPathManager creation**

In `main.ts`, after the line `if (flightTooltip) flightPathManager.setupTooltip(flightTooltip);` (around line 1770), add:

```typescript
flightPathManager.onCameraModeChange((mode) => {
    if (mode === 'orbit') {
        controls.enabled = true;
    } else {
        controls.enabled = false;
    }
    // Save controls target when leaving orbit
    if (mode !== 'orbit') {
        // Saved internally by FlightPathManager
    }
});
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(flight-path): disable orbit controls during chase/fpv camera modes"
```

---

### Task 6: Add free-look (mouse drag in FPV mode)

**Files:**
- Modify: `src/modules/flight-path.ts`

- [ ] **Step 1: Add free-look event handlers**

Add a new method section after the tooltip section:

```typescript
// ─── Free-Look ───────────────────────────────────────────────────

private _freeLookStartX = 0;
private _freeLookStartY = 0;
private _onPointerDown: ((e: PointerEvent) => void) | null = null;
private _onPointerMove: ((e: PointerEvent) => void) | null = null;
private _onPointerUp: ((e: PointerEvent) => void) | null = null;
private _onDblClick: ((e: MouseEvent) => void) | null = null;

/** Set up free-look event handlers on the renderer canvas. */
setupFreeLook(): void {
    const canvas = this.renderer.domElement;

    this._onPointerDown = (e: PointerEvent) => {
        if (this._cameraMode !== 'fpv' || e.button !== 0) return;
        this._freeLookActive = true;
        this._freeLookStartX = e.clientX;
        this._freeLookStartY = e.clientY;
        e.stopPropagation();
    };

    this._onPointerMove = (e: PointerEvent) => {
        if (!this._freeLookActive || this._cameraMode !== 'fpv') return;
        const dx = (e.clientX - this._freeLookStartX) * 0.003;
        const dy = (e.clientY - this._freeLookStartY) * 0.003;
        this._freeLookStartX = e.clientX;
        this._freeLookStartY = e.clientY;

        // Apply yaw (Y-axis) and pitch (X-axis) to offset quaternion
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx);
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy);
        this._freeLookOffset.premultiply(yawQuat).multiply(pitchQuat);

        e.stopPropagation();
    };

    this._onPointerUp = (_e: PointerEvent) => {
        this._freeLookActive = false;
    };

    this._onDblClick = (e: MouseEvent) => {
        if (this._cameraMode !== 'fpv') return;
        this.recenterFreeLook();
        e.stopPropagation();
    };

    // Use capture phase so free-look fires BEFORE annotation/measurement/gizmo handlers
    canvas.addEventListener('pointerdown', this._onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this._onPointerMove, { capture: true });
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('dblclick', this._onDblClick, { capture: true });
}

/** Smoothly recenter free-look to the base gimbal/heading orientation. */
recenterFreeLook(): void {
    if (this._freeLookOffset.equals(new THREE.Quaternion())) return; // already centered
    this._recentering = true;
    this._recenterStartQuat.copy(this._freeLookOffset);
    this._recenterProgress = 0;
    log.info('Re-centering free-look');
}
```

- [ ] **Step 2: Add recenter update logic to updatePlayback**

In `updatePlayback`, after the transition block but before the early return, add:

```typescript
// Update free-look recenter animation
if (this._recentering) {
    this._recenterProgress += deltaTime / FlightPathManager.RECENTER_DURATION;
    if (this._recenterProgress >= 1) {
        this._freeLookOffset.identity();
        this._recentering = false;
    } else {
        this._freeLookOffset.copy(this._recenterStartQuat).slerp(new THREE.Quaternion(), this._recenterProgress);
    }
}
```

- [ ] **Step 3: Call setupFreeLook in main.ts after FlightPathManager creation**

After the `setupTooltip` call (around line 1770):

```typescript
flightPathManager.setupFreeLook();
```

- [ ] **Step 4: Clean up free-look listeners in dispose()**

In the `dispose()` method, add before the existing `if (this._onMouseMove)` block:

```typescript
const canvas = this.renderer.domElement;
// Must match capture phase used in setupFreeLook()
if (this._onPointerDown) canvas.removeEventListener('pointerdown', this._onPointerDown, { capture: true });
if (this._onPointerMove) canvas.removeEventListener('pointermove', this._onPointerMove, { capture: true });
if (this._onPointerUp) canvas.removeEventListener('pointerup', this._onPointerUp);
if (this._onDblClick) canvas.removeEventListener('dblclick', this._onDblClick, { capture: true });
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add src/modules/flight-path.ts src/main.ts
git commit -m "feat(flight-path): add free-look mouse drag in FPV mode with recenter"
```

---

## Chunk 3: UI Controls & Telemetry

### Task 7: Add camera mode and telemetry UI to editor HTML

**Files:**
- Modify: `src/editor/index.html:1869-1873` (playback section)

- [ ] **Step 1: Replace the "Follow Camera" checkbox with camera mode selector + telemetry**

Replace the block at lines 1869–1873:

```html
<div class="cb-row mt4">
    <input type="checkbox" id="fp-follow-camera">
    <label for="fp-follow-camera">Follow Camera</label>
</div>
```

With:

```html
<!-- Camera Mode -->
<div class="prop-label mt8 mb4">Camera</div>
<div class="seg-ctrl mb4">
    <button class="seg-btn active" id="fp-cam-orbit">Orbit</button>
    <button class="seg-btn" id="fp-cam-chase">Chase</button>
    <button class="seg-btn" id="fp-cam-fpv">FPV</button>
</div>
<div style="display:flex; gap:6px; align-items:center;">
    <button class="prop-btn small" id="fp-recenter-btn" style="display:none;" title="Re-center view">Re-center</button>
    <div class="cb-row" id="fp-pip-row" style="display:none;">
        <input type="checkbox" id="fp-pip-toggle">
        <label for="fp-pip-toggle">PiP</label>
    </div>
</div>

<!-- Telemetry Readout -->
<div id="fp-telemetry" style="display:none; margin-top:8px; font-size:10px; color:var(--text-secondary);">
    <div style="display:flex; gap:12px;">
        <span>Alt: <span class="font-mono" id="fp-telem-alt">—</span></span>
        <span>Spd: <span class="font-mono" id="fp-telem-speed">—</span></span>
        <span>Hdg: <span class="font-mono" id="fp-telem-heading">—</span></span>
    </div>
</div>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(flight-path): add camera mode selector, PiP toggle, and telemetry readout to editor UI"
```

---

### Task 8: Add telemetry data getter to FlightPathManager

**Files:**
- Modify: `src/modules/flight-path.ts`

- [ ] **Step 1: Add telemetry getter method**

Add in the Public API section:

```typescript
/** Get interpolated telemetry data at current playback position. */
getCurrentTelemetry(): { alt: number; speed: number; heading: number } | null {
    if (!this._playbackPathId) return null;
    const pathData = this.paths.find(p => p.id === this._playbackPathId);
    if (!pathData) return null;

    const points = this.getTrimmedPoints(pathData);
    if (points.length === 0) return null;
    const t = this._playbackTime;

    // Find surrounding points
    let i = 0;
    while (i < points.length - 1 && points[i + 1].timestamp <= t) i++;

    if (i >= points.length - 1) {
        const p = points[points.length - 1];
        return { alt: p.alt, speed: p.speed ?? 0, heading: p.heading ?? 0 };
    }

    const p0 = points[i];
    const p1 = points[i + 1];
    const dt = p1.timestamp - p0.timestamp;
    const f = dt > 0 ? (t - p0.timestamp) / dt : 0;

    return {
        alt: p0.alt + (p1.alt - p0.alt) * f,
        speed: (p0.speed ?? 0) + ((p1.speed ?? 0) - (p0.speed ?? 0)) * f,
        heading: p0.heading ?? 0, // Not interpolated: linear lerp is wrong for angles (359→1 goes through 180)
    };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/modules/flight-path.ts
git commit -m "feat(flight-path): add getCurrentTelemetry() for live readout during playback"
```

---

### Task 9: Wire camera mode UI and telemetry updates in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Replace the follow-camera checkbox handler with camera mode button handlers**

Find the `fp-follow-camera` handler (around line 1872) and replace it:

```typescript
// Camera mode buttons
const camBtns = ['fp-cam-orbit', 'fp-cam-chase', 'fp-cam-fpv'] as const;
const camModes: FlightCameraMode[] = ['orbit', 'chase', 'fpv'];
camBtns.forEach((btnId, idx) => {
    addListener(btnId, 'click', () => {
        if (!flightPathManager) return;
        flightPathManager.setCameraMode(camModes[idx]);
        // Update active state
        camBtns.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('active', id === btnId);
        });
        // Show/hide recenter (FPV only) and PiP (orbit only)
        const recenterBtn = document.getElementById('fp-recenter-btn');
        if (recenterBtn) recenterBtn.style.display = camModes[idx] === 'fpv' ? '' : 'none';
        const pipRow = document.getElementById('fp-pip-row');
        if (pipRow) pipRow.style.display = camModes[idx] === 'orbit' ? '' : 'none';
    });
});

// Re-center button
addListener('fp-recenter-btn', 'click', () => {
    flightPathManager?.recenterFreeLook();
});
```

- [ ] **Step 2: Add FlightCameraMode import at top of main.ts**

```typescript
import type { FlightCameraMode } from '@/types.js';
```

- [ ] **Step 3: Update playback update callback to include telemetry**

Find the `onPlaybackUpdate` callback (around line 1878) and extend it:

```typescript
flightPathManager.onPlaybackUpdate((currentMs, totalMs) => {
    const scrubber = document.getElementById('fp-scrubber') as HTMLInputElement | null;
    if (scrubber) scrubber.value = String(Math.round((currentMs / totalMs) * 1000));
    const timeCur = document.getElementById('fp-time-current');
    if (timeCur) {
        const s = Math.floor(currentMs / 1000);
        timeCur.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    // Telemetry readout
    const telem = flightPathManager!.getCurrentTelemetry();
    const telemDiv = document.getElementById('fp-telemetry');
    if (telemDiv) telemDiv.style.display = telem ? '' : 'none';
    if (telem) {
        const altEl = document.getElementById('fp-telem-alt');
        const spdEl = document.getElementById('fp-telem-speed');
        const hdgEl = document.getElementById('fp-telem-heading');
        if (altEl) altEl.textContent = `${telem.alt.toFixed(1)}m`;
        if (spdEl) spdEl.textContent = `${telem.speed.toFixed(1)}m/s`;
        if (hdgEl) hdgEl.textContent = `${telem.heading.toFixed(0)}°`;
    }
});
```

- [ ] **Step 4: Update stop handler to reset camera mode UI**

Find the `fp-stop-btn` handler and add camera mode reset:

```typescript
addListener('fp-stop-btn', 'click', () => {
    if (!flightPathManager) return;
    flightPathManager.stopPlayback();
    const btn = document.getElementById('fp-play-btn');
    if (btn) btn.textContent = '\u25B6';
    const scrubber = document.getElementById('fp-scrubber') as HTMLInputElement | null;
    if (scrubber) scrubber.value = '0';
    const timeCur = document.getElementById('fp-time-current');
    if (timeCur) timeCur.textContent = '00:00';
    // Reset camera mode UI to orbit
    ['fp-cam-orbit', 'fp-cam-chase', 'fp-cam-fpv'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', id === 'fp-cam-orbit');
    });
    const recenterBtn = document.getElementById('fp-recenter-btn');
    if (recenterBtn) recenterBtn.style.display = 'none';
    const pipRow = document.getElementById('fp-pip-row');
    if (pipRow) pipRow.style.display = '';
    const telemDiv = document.getElementById('fp-telemetry');
    if (telemDiv) telemDiv.style.display = 'none';
});
```

- [ ] **Step 5: Update onPlaybackEnd callback to freeze camera in FPV/Chase**

Replace the existing `onPlaybackEnd` callback:

```typescript
flightPathManager.onPlaybackEnd(() => {
    const btn = document.getElementById('fp-play-btn');
    if (btn) btn.textContent = '\u25B6';
    // Camera stays frozen at last position per spec — user must hit Stop to restore
});
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(flight-path): wire camera mode buttons, telemetry readout, and stop handler in editor"
```

---

## Chunk 4: Picture-in-Picture

### Task 10: Add PiP camera and rendering to FlightPathManager

**Files:**
- Modify: `src/modules/flight-path.ts`

- [ ] **Step 1: Add PiP state fields**

Add after transition state fields:

```typescript
// PiP state
private _pipEnabled = false;
private _pipCamera: THREE.PerspectiveCamera | null = null;
```

- [ ] **Step 2: Add PiP toggle and render methods**

Add in the Public API section:

```typescript
/** Enable/disable PiP mode. Creates PiP camera on first enable. */
setPipEnabled(enabled: boolean): void {
    this._pipEnabled = enabled;
    if (enabled && !this._pipCamera) {
        this._pipCamera = new THREE.PerspectiveCamera(
            60, 16 / 9, 0.1, 1000
        );
    }
    log.info(`PiP ${enabled ? 'enabled' : 'disabled'}`);
}

get pipEnabled(): boolean {
    return this._pipEnabled;
}

/** Update PiP camera to match current playback position with FPV orientation. */
private updatePipCamera(): void {
    if (!this._pipEnabled || !this._pipCamera || !this._playbackMarker) return;

    const pos = this._playbackMarker.position;
    this._pipCamera.position.copy(pos);

    const pathData = this._playbackPathId ? this.paths.find(p => p.id === this._playbackPathId) : null;
    const points = pathData ? this.getTrimmedPoints(pathData) : [];
    if (points.length > 0) {
        const targetQuat = this.computeFpvOrientation(points, this._playbackTime);
        this._pipCamera.quaternion.copy(targetQuat);
    }
}

/** Render PiP viewport. Call from main animate loop AFTER all other updates.
 *  Saves and restores renderer viewport/scissor state. */
renderPiP(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!this._pipEnabled || !this._pipCamera || !this._playing || this._cameraMode !== 'orbit') return;

    this.updatePipCamera();

    // Save current renderer state
    const currentViewport = new THREE.Vector4();
    const currentScissor = new THREE.Vector4();
    renderer.getViewport(currentViewport);
    renderer.getScissor(currentScissor);
    const scissorTestWas = renderer.getScissorTest();

    // Compute PiP viewport (bottom-right, 25% width, 16:9)
    const canvas = renderer.domElement;
    const pipWidth = Math.round(canvas.width * 0.25);
    const pipHeight = Math.round(pipWidth * (9 / 16));
    const pipX = canvas.width - pipWidth - 16; // 16px padding
    const pipY = 16; // bottom-left origin in WebGL, so 16px from bottom

    this._pipCamera.aspect = pipWidth / pipHeight;
    this._pipCamera.updateProjectionMatrix();

    renderer.setViewport(pipX, pipY, pipWidth, pipHeight);
    renderer.setScissor(pipX, pipY, pipWidth, pipHeight);
    renderer.setScissorTest(true);

    // Clear only the PiP region
    renderer.setClearColor(0x000000, 0.3);
    renderer.clear(true, true, false);

    // Render scene with PiP camera.
    // NOTE: SparkRenderer dual-render spike needed — if splats render incorrectly
    // (sort artifacts, flickering), add splatMesh.visible = false before this call
    // and restore after. See spec "PiP rendering" section for full mitigation plan.
    renderer.render(scene, this._pipCamera);

    // Restore state
    renderer.setViewport(currentViewport);
    renderer.setScissor(currentScissor);
    renderer.setScissorTest(scissorTestWas);
}
```

- [ ] **Step 3: Call updatePipCamera in updatePlaybackPosition**

At the end of `updatePlaybackPosition()`, add:

```typescript
// Update PiP camera
this.updatePipCamera();
```

- [ ] **Step 4: Clean up PiP camera in dispose()**

In dispose(), add:

```typescript
this._pipCamera = null;
this._pipEnabled = false;
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add src/modules/flight-path.ts
git commit -m "feat(flight-path): add PiP camera with viewport/scissor rendering"
```

---

### Task 11: Wire PiP in main.ts (rendering + DOM overlay + toggle)

**Files:**
- Modify: `src/main.ts`
- Modify: `src/editor/index.html`

- [ ] **Step 1: Add PiP overlay element to editor HTML**

After the canvas element (search for `<canvas` in `editor/index.html`), add:

```html
<!-- PiP FPV overlay label -->
<div id="fp-pip-overlay" style="display:none; position:absolute; bottom:16px; right:16px; pointer-events:none; z-index:10;">
    <div style="border:2px solid rgba(255,255,255,0.3); border-radius:4px; overflow:hidden;">
        <div style="background:rgba(0,0,0,0.6); color:white; font-size:10px; padding:2px 6px; text-align:center;">FPV</div>
    </div>
</div>
```

Note: The actual PiP viewport is rendered on the main canvas. This overlay is just the label/border decoration positioned to match.

- [ ] **Step 2: Wire PiP toggle in main.ts**

Add after the camera mode button handlers:

```typescript
// PiP toggle
addListener('fp-pip-toggle', 'change', (e: Event) => {
    if (!flightPathManager) return;
    const enabled = (e.target as HTMLInputElement).checked;
    flightPathManager.setPipEnabled(enabled);
    const overlay = document.getElementById('fp-pip-overlay');
    if (overlay) overlay.style.display = enabled ? '' : 'none';
});
```

- [ ] **Step 3: Add PiP render call in animate loop**

In the `animate()` function in `main.ts`, after ALL the marker/measurement updates (after line ~3616), add:

```typescript
// Render PiP viewport (must be after all DOM position updates)
if (flightPathManager?.pipEnabled) {
    flightPathManager.renderPiP(renderer, scene);
}
```

- [ ] **Step 4: Hide PiP overlay on stop**

In the stop button handler, add:

```typescript
const pipOverlay = document.getElementById('fp-pip-overlay');
if (pipOverlay) pipOverlay.style.display = 'none';
const pipToggle = document.getElementById('fp-pip-toggle') as HTMLInputElement | null;
if (pipToggle) { pipToggle.checked = false; }
flightPathManager?.setPipEnabled(false);
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add src/editor/index.html src/main.ts
git commit -m "feat(flight-path): wire PiP toggle, overlay label, and render call in editor"
```

---

## Chunk 5: Polish & Verification

### Task 12: Playback end behavior and UI visibility gating

**Files:**
- Modify: `src/modules/flight-path.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Ensure playback end freezes camera in FPV/Chase (already correct)**

Verify in `updatePlayback()` that when `_playbackTime >= trimEndMs`:
- `_playing` is set to `false`
- `_onPlaybackEnd?.()` fires
- Camera mode is NOT reset (stays in chase/fpv — camera freezes)

This should already be correct from the existing code. The `_onPlaybackEnd` callback in main.ts just resets the play button icon. Confirm no mode reset happens.

- [ ] **Step 2: Gate playback controls visibility in updateFlightPathUI**

In the existing `updateFlightPathUI` function in main.ts (around the `droneSection` visibility toggle, line 2417), ensure the controls section is also gated:

The existing line:
```typescript
if (droneSection) droneSection.style.display = state.flightPathLoaded ? '' : 'none';
```

Already handles this — the entire `pane-flightpath` is shown/hidden based on `flightPathLoaded`. The playback controls are inside this pane, so they're automatically hidden when no flight paths are loaded.

No code change needed — just verify.

- [ ] **Step 3: Commit if any changes were made**

If no changes: skip commit. If changes:
```bash
git add src/modules/flight-path.ts src/main.ts
git commit -m "fix(flight-path): ensure playback end freezes camera and controls are gated"
```

---

### Task 13: Verification — build, lint, test

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK).

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All test suites pass.

- [ ] **Step 4: Manual smoke test checklist**

1. `npm run dev` — load a DJI CSV flight log in the editor
2. Open flight path pane — verify playback controls, camera mode buttons, telemetry readout area all visible
3. Press Play — verify playback marker animates along path, scrubber moves, time updates
4. Click "Chase" — verify smooth fly-in to behind-drone view, orbit controls disabled
5. Click "FPV" — verify smooth transition to drone position, camera faces forward
6. Click-drag in FPV — verify free-look works, camera rotates
7. Click "Re-center" or double-click — verify smooth return to gimbal/heading orientation
8. Click "Orbit" — verify smooth fly-out back to saved camera position, orbit controls re-enabled
9. Press Stop — verify camera returns to orbit, UI resets
10. Toggle PiP (in Orbit mode) — verify small viewport appears in bottom-right corner with FPV perspective
11. Toggle PiP off — verify clean removal

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(flight-path): address issues found during smoke testing"
```

---

## Summary of All Commits

1. `fix(flight-path): use THREE.Clock for accurate playback deltaTime`
2. `refactor(flight-path): replace _followCamera with CameraMode enum`
3. `feat(flight-path): add FPV orientation logic with gimbal-lock and heading fallback`
4. `feat(flight-path): add smooth camera transitions between orbit/chase/fpv`
5. `feat(flight-path): disable orbit controls during chase/fpv camera modes`
6. `feat(flight-path): add free-look mouse drag in FPV mode with recenter`
7. `feat(flight-path): add camera mode selector, PiP toggle, and telemetry readout to editor UI`
8. `feat(flight-path): add getCurrentTelemetry() for live readout during playback`
9. `feat(flight-path): wire camera mode buttons, telemetry readout, and stop handler in editor`
10. `feat(flight-path): add PiP camera with viewport/scissor rendering`
11. `feat(flight-path): wire PiP toggle, overlay label, and render call in editor`
12. `fix(flight-path): address issues found during smoke testing` (if needed)
