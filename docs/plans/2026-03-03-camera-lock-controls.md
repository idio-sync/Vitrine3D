# Camera Lock Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add four camera constraint checkboxes to the Default View metadata tab — lock orbit, lock distance, keep above ground, limit max height — with live preview in editor and persistence to archive manifest for kiosk mode.

**Architecture:** Each constraint maps to an OrbitControls property (enablePan, minDistance/maxDistance, maxPolarAngle) or a change-event listener (max height clamp). Constraints are stored as new `viewer_settings` fields in the manifest. The MetadataDeps interface gains a `getControls()` callback so metadata-manager can apply constraints live. No new modules — all changes extend existing files.

**Tech Stack:** Three.js OrbitControls, existing metadata-manager pattern, archive manifest schema.

---

### Task 1: Add manifest schema fields

**Files:**
- Modify: `src/modules/archive-creator.ts:268-276` (Manifest `viewer_settings` type)
- Modify: `src/modules/archive-creator.ts:625-633` (blank manifest defaults)
- Modify: `src/modules/archive-creator.ts:1089-1100` (`setViewerSettings()`)

**Step 1: Add fields to the Manifest interface**

In `src/modules/archive-creator.ts`, find the `viewer_settings` block in the Manifest interface (line ~268) and add after `annotations_visible: boolean;`:

```ts
        lock_orbit: boolean;
        lock_distance: number | null;
        lock_above_ground: boolean;
        max_camera_height: number | null;
```

**Step 2: Add defaults in createBlankManifest()**

In the blank manifest `viewer_settings` block (line ~625), add after `annotations_visible: true,`:

```ts
                lock_orbit: false,
                lock_distance: null,
                lock_above_ground: false,
                max_camera_height: null,
```

**Step 3: Add setters in setViewerSettings()**

In `setViewerSettings()` (line ~1089), add after the `annotationsVisible` line:

```ts
        if (settings.lockOrbit !== undefined) this.manifest.viewer_settings.lock_orbit = settings.lockOrbit;
        if (settings.lockDistance !== undefined) this.manifest.viewer_settings.lock_distance = settings.lockDistance;
        if (settings.lockAboveGround !== undefined) this.manifest.viewer_settings.lock_above_ground = settings.lockAboveGround;
        if (settings.maxCameraHeight !== undefined) this.manifest.viewer_settings.max_camera_height = settings.maxCameraHeight;
```

**Step 4: Verify build compiles**

Run: `npm run build`
Expected: Success, no type errors.

**Step 5: Commit**

```
feat: add camera lock fields to archive manifest schema
```

---

### Task 2: Update ViewerSettings interface and collectMetadata()

**Files:**
- Modify: `src/modules/metadata-manager.ts:192-201` (`ViewerSettings` interface)
- Modify: `src/modules/metadata-manager.ts:1269-1280` (`collectMetadata()` viewerSettings block)

**Step 1: Add fields to ViewerSettings interface**

In `src/modules/metadata-manager.ts`, find the `ViewerSettings` interface (line ~192). Add after `annotationsVisible: boolean;`:

```ts
    lockOrbit: boolean;
    lockDistance: number | null;
    lockAboveGround: boolean;
    maxCameraHeight: number | null;
```

**Step 2: Add collection in collectMetadata()**

In `collectMetadata()` (line ~1269), add after the `annotationsVisible` line in the `viewerSettings` block:

```ts
            lockOrbit: (document.getElementById('meta-viewer-lock-orbit') as HTMLInputElement)?.checked ?? false,
            lockDistance: (document.getElementById('meta-viewer-lock-orbit-distance') as HTMLInputElement)?.checked
                ? parseFloat((document.getElementById('meta-viewer-lock-distance-value') as HTMLInputElement)?.value) || null
                : null,
            lockAboveGround: (document.getElementById('meta-viewer-lock-above-ground') as HTMLInputElement)?.checked ?? false,
            maxCameraHeight: (document.getElementById('meta-viewer-lock-max-height') as HTMLInputElement)?.checked
                ? parseFloat((document.getElementById('meta-viewer-max-height-value') as HTMLInputElement)?.value) || null
                : null,
```

**Step 3: Verify build compiles**

Run: `npm run build`
Expected: Success.

**Step 4: Commit**

```
feat: add camera lock fields to ViewerSettings and collectMetadata
```

---

### Task 3: Add HTML checkboxes to Default View tab

**Files:**
- Modify: `src/index.html:1816-1818` (between Opening Camera and Viewer Behavior sections)

**Step 1: Add the Camera Constraints UI**

In `src/index.html`, find line ~1816 (end of the Opening Camera `</div>`) and before line ~1818 (`<div class="subsection-header"...>Viewer Behavior</div>`), insert:

```html
                            <div class="subsection-header" style="margin-top: 20px;">Camera Constraints</div>
                            <div class="checkbox-group">
                                <input type="checkbox" id="meta-viewer-lock-orbit">
                                <label for="meta-viewer-lock-orbit">Lock Orbit Point</label>
                            </div>
                            <span class="field-hint">Prevent panning — the orbit center stays fixed.</span>

                            <div class="checkbox-group" style="margin-top: 8px;">
                                <input type="checkbox" id="meta-viewer-lock-orbit-distance">
                                <label for="meta-viewer-lock-orbit-distance">Lock Camera Distance</label>
                            </div>
                            <span class="field-hint">Freeze zoom at the current distance from the orbit point.</span>
                            <input type="hidden" id="meta-viewer-lock-distance-value">

                            <div class="checkbox-group" style="margin-top: 8px;">
                                <input type="checkbox" id="meta-viewer-lock-above-ground">
                                <label for="meta-viewer-lock-above-ground">Keep Camera Above Ground</label>
                            </div>
                            <span class="field-hint">Prevent the camera from orbiting below the ground plane.</span>

                            <div class="checkbox-group" style="margin-top: 8px;">
                                <input type="checkbox" id="meta-viewer-lock-max-height">
                                <label for="meta-viewer-lock-max-height">Limit Camera Height</label>
                            </div>
                            <span class="field-hint">Cap the camera's vertical position at a maximum height.</span>
                            <div id="max-height-controls" class="metadata-field" style="display: none; margin-top: 4px; padding-left: 24px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <label for="meta-viewer-max-height-value" style="white-space: nowrap; font-size: 12px;">Max Y:</label>
                                    <input type="number" id="meta-viewer-max-height-value" step="0.1" style="width: 80px; font-size: 12px;" placeholder="0.0">
                                    <button id="btn-set-max-height-current" class="action-btn secondary" style="font-size: 11px; padding: 2px 8px; white-space: nowrap;">Set to current</button>
                                </div>
                            </div>
```

**Step 2: Verify build compiles**

Run: `npm run build`
Expected: Success.

**Step 3: Commit**

```
feat: add camera constraint checkboxes to Default View tab HTML
```

---

### Task 4: Add MetadataDeps.getControls() callback

**Files:**
- Modify: `src/modules/metadata-manager.ts:47-61` (MetadataDeps interface)
- Modify: `src/main.ts:513-538` (createMetadataDeps factory)

**Step 1: Add getControls to MetadataDeps**

In `src/modules/metadata-manager.ts`, in the `MetadataDeps` interface (line ~47), add after the `getCameraState` line:

```ts
    getControls?: () => { controls: any; camera: any };
```

**Step 2: Add getControls to createMetadataDeps in main.ts**

In `src/main.ts`, in `createMetadataDeps()` (line ~513), add after the `getCameraState` block (after the closing `}),` at line ~537):

```ts
        getControls: () => ({ controls, camera }),
```

**Step 3: Verify build compiles**

Run: `npm run build`
Expected: Success.

**Step 4: Commit**

```
feat: add getControls callback to MetadataDeps
```

---

### Task 5: Wire live constraint toggles in setupMetadataSidebar()

**Files:**
- Modify: `src/modules/metadata-manager.ts:635-659` (after the camera save/clear button wiring in `setupMetadataSidebar()`)

**Step 1: Add constraint application helper**

In `src/modules/metadata-manager.ts`, add a new module-level function before `setupMetadataSidebar()`. Place it near the other camera helper functions (after `updateCameraSaveDisplay()` around line ~1120):

```ts
/**
 * Apply camera constraints to OrbitControls based on checkbox state.
 * Called on checkbox toggle (live preview) and on archive load.
 */
export function applyCameraConstraints(
    controls: any,
    camera: any,
    settings: {
        lockOrbit: boolean;
        lockDistance: number | null;
        lockAboveGround: boolean;
        maxCameraHeight: number | null;
    }
): (() => void) | null {
    // Lock orbit point (disable panning)
    controls.enablePan = !settings.lockOrbit;

    // Lock camera distance
    if (settings.lockDistance !== null) {
        controls.minDistance = settings.lockDistance;
        controls.maxDistance = settings.lockDistance;
    } else {
        controls.minDistance = 0.1;  // ORBIT_CONTROLS.MIN_DISTANCE
        controls.maxDistance = 100;  // ORBIT_CONTROLS.MAX_DISTANCE
    }

    // Keep camera above ground
    controls.maxPolarAngle = settings.lockAboveGround ? Math.PI / 2 : Math.PI;

    // Max camera height — return cleanup function
    if (settings.maxCameraHeight !== null) {
        const maxY = settings.maxCameraHeight;
        const clampHeight = () => {
            if (camera.position.y > maxY) {
                camera.position.y = maxY;
                controls.update();
            }
        };
        controls.addEventListener('change', clampHeight);
        // Apply immediately in case camera is already above limit
        clampHeight();
        return clampHeight;
    }

    return null;
}
```

**Step 2: Wire checkbox events in setupMetadataSidebar()**

In `setupMetadataSidebar()`, after the camera clear button wiring (line ~659), add:

```ts
    // Camera constraint checkboxes — live preview
    let heightClampListener: (() => void) | null = null;

    function applyLiveConstraints() {
        if (!deps.getControls) return;
        const { controls: ctrl, camera: cam } = deps.getControls();
        if (!ctrl || !cam) return;

        // Remove old height clamp listener before re-applying
        if (heightClampListener) {
            ctrl.removeEventListener('change', heightClampListener);
            heightClampListener = null;
        }

        const lockOrbit = (document.getElementById('meta-viewer-lock-orbit') as HTMLInputElement)?.checked ?? false;
        const lockDistanceChecked = (document.getElementById('meta-viewer-lock-orbit-distance') as HTMLInputElement)?.checked ?? false;
        const lockAboveGround = (document.getElementById('meta-viewer-lock-above-ground') as HTMLInputElement)?.checked ?? false;
        const lockMaxHeightChecked = (document.getElementById('meta-viewer-lock-max-height') as HTMLInputElement)?.checked ?? false;

        // Capture current distance when lock distance is toggled on
        let lockDistanceValue: number | null = null;
        if (lockDistanceChecked) {
            const storedVal = (document.getElementById('meta-viewer-lock-distance-value') as HTMLInputElement)?.value;
            if (storedVal) {
                lockDistanceValue = parseFloat(storedVal);
            } else {
                // Capture current distance
                const dist = cam.position.distanceTo(ctrl.target);
                lockDistanceValue = parseFloat(dist.toFixed(4));
                const hiddenEl = document.getElementById('meta-viewer-lock-distance-value') as HTMLInputElement;
                if (hiddenEl) hiddenEl.value = String(lockDistanceValue);
            }
        } else {
            // Clear stored distance when unchecked
            const hiddenEl = document.getElementById('meta-viewer-lock-distance-value') as HTMLInputElement;
            if (hiddenEl) hiddenEl.value = '';
        }

        // Max height value
        let maxHeightValue: number | null = null;
        if (lockMaxHeightChecked) {
            const input = document.getElementById('meta-viewer-max-height-value') as HTMLInputElement;
            maxHeightValue = input?.value ? parseFloat(input.value) : null;
        }

        // Show/hide max height controls
        const maxHeightRow = document.getElementById('max-height-controls');
        if (maxHeightRow) maxHeightRow.style.display = lockMaxHeightChecked ? '' : 'none';

        heightClampListener = applyCameraConstraints(ctrl, cam, {
            lockOrbit,
            lockDistance: lockDistanceValue,
            lockAboveGround,
            maxCameraHeight: maxHeightValue,
        });
    }

    // Wire checkbox change events
    ['meta-viewer-lock-orbit', 'meta-viewer-lock-orbit-distance', 'meta-viewer-lock-above-ground', 'meta-viewer-lock-max-height'].forEach(id => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) el.addEventListener('change', applyLiveConstraints);
    });

    // Wire max height value input — re-apply on change
    const maxHeightInput = document.getElementById('meta-viewer-max-height-value') as HTMLInputElement | null;
    if (maxHeightInput) maxHeightInput.addEventListener('input', applyLiveConstraints);

    // "Set to current" button for max height
    const setMaxHeightBtn = document.getElementById('btn-set-max-height-current');
    if (setMaxHeightBtn) {
        setMaxHeightBtn.addEventListener('click', () => {
            if (!deps.getControls) return;
            const { camera: cam } = deps.getControls();
            if (!cam) return;
            const input = document.getElementById('meta-viewer-max-height-value') as HTMLInputElement;
            if (input) {
                input.value = cam.position.y.toFixed(2);
                applyLiveConstraints();
            }
        });
    }
```

**Step 3: Verify build compiles**

Run: `npm run build`
Expected: Success.

**Step 4: Commit**

```
feat: wire live camera constraint toggles in metadata sidebar
```

---

### Task 6: Apply constraints on archive load (editor)

**Files:**
- Modify: `src/modules/archive-pipeline.ts:699-745` (`applyViewerSettings()`)

**Step 1: Import applyCameraConstraints**

At the top of `src/modules/archive-pipeline.ts`, add to the imports from metadata-manager:

```ts
import { applyCameraConstraints } from './metadata-manager.js';
```

If there are no existing imports from metadata-manager, add this as a new import line.

**Step 2: Apply constraints in applyViewerSettings()**

In `applyViewerSettings()`, after the camera position/target block (line ~742), before the final `log.info(...)` line, add:

```ts
    // Apply camera constraints
    const lockControls = sceneRefs.controls;
    const lockCamera = sceneRefs.camera;
    if (lockControls && lockCamera) {
        applyCameraConstraints(lockControls, lockCamera, {
            lockOrbit: settings.lock_orbit ?? false,
            lockDistance: settings.lock_distance ?? null,
            lockAboveGround: settings.lock_above_ground ?? false,
            maxCameraHeight: settings.max_camera_height ?? null,
        });
    }
```

**Step 3: Verify build compiles**

Run: `npm run build`
Expected: Success.

**Step 4: Commit**

```
feat: apply camera constraints on archive load in editor
```

---

### Task 7: Prefill constraint checkboxes from loaded archive

**Files:**
- Modify: `src/modules/metadata-manager.ts:1785-1791` (`prefillMetadataFromArchive()`, after the auto-rotate/annotations prefill)

**Step 1: Add prefill logic for lock fields**

In `prefillMetadataFromArchive()`, after the annotations visible prefill (line ~1791), add:

```ts
        // Camera constraints
        const lockOrbitEl = document.getElementById('meta-viewer-lock-orbit') as HTMLInputElement | null;
        if (lockOrbitEl) lockOrbitEl.checked = manifest.viewer_settings.lock_orbit ?? false;

        const lockDistanceEl = document.getElementById('meta-viewer-lock-orbit-distance') as HTMLInputElement | null;
        if (lockDistanceEl) lockDistanceEl.checked = manifest.viewer_settings.lock_distance !== null && manifest.viewer_settings.lock_distance !== undefined;
        const lockDistanceValEl = document.getElementById('meta-viewer-lock-distance-value') as HTMLInputElement | null;
        if (lockDistanceValEl && manifest.viewer_settings.lock_distance != null) {
            lockDistanceValEl.value = String(manifest.viewer_settings.lock_distance);
        }

        const lockAboveGroundEl = document.getElementById('meta-viewer-lock-above-ground') as HTMLInputElement | null;
        if (lockAboveGroundEl) lockAboveGroundEl.checked = manifest.viewer_settings.lock_above_ground ?? false;

        const lockMaxHeightEl = document.getElementById('meta-viewer-lock-max-height') as HTMLInputElement | null;
        const maxHeightControls = document.getElementById('max-height-controls');
        const maxHeightValEl = document.getElementById('meta-viewer-max-height-value') as HTMLInputElement | null;
        if (lockMaxHeightEl) lockMaxHeightEl.checked = manifest.viewer_settings.max_camera_height != null;
        if (maxHeightControls) maxHeightControls.style.display = manifest.viewer_settings.max_camera_height != null ? '' : 'none';
        if (maxHeightValEl && manifest.viewer_settings.max_camera_height != null) {
            maxHeightValEl.value = String(manifest.viewer_settings.max_camera_height);
        }
```

**Step 2: Verify build compiles**

Run: `npm run build`
Expected: Success.

**Step 3: Commit**

```
feat: prefill camera constraint checkboxes from loaded archive
```

---

### Task 8: Apply constraints in kiosk mode

**Files:**
- Modify: `src/modules/kiosk-main.ts:1509-1534` (after camera position restore, before `log.info`)

**Step 1: Apply constraints after camera restore**

In `src/modules/kiosk-main.ts`, after the camera position restore block (line ~1516) and before the matcap block (line ~1518), add:

```ts
            // Apply camera constraints
            if (controls) {
                // Lock orbit point
                if (manifest.viewer_settings.lock_orbit) {
                    controls.enablePan = false;
                }

                // Lock camera distance
                if (manifest.viewer_settings.lock_distance != null) {
                    controls.minDistance = manifest.viewer_settings.lock_distance;
                    controls.maxDistance = manifest.viewer_settings.lock_distance;
                }

                // Keep camera above ground
                if (manifest.viewer_settings.lock_above_ground) {
                    controls.maxPolarAngle = Math.PI / 2;
                }

                // Max camera height
                if (manifest.viewer_settings.max_camera_height != null) {
                    const maxY = manifest.viewer_settings.max_camera_height;
                    controls.addEventListener('change', () => {
                        if (camera && camera.position.y > maxY) {
                            camera.position.y = maxY;
                            controls.update();
                        }
                    });
                }
            }
```

**Step 2: Verify build compiles**

Run: `npm run build`
Expected: Success.

**Step 3: Commit**

```
feat: apply camera constraints in kiosk mode
```

---

### Task 9: Manual testing and final build verification

**Step 1: Run full build**

Run: `npm run build`
Expected: Success with no errors.

**Step 2: Run tests**

Run: `npm test`
Expected: All existing tests pass.

**Step 3: Run lint**

Run: `npm run lint`
Expected: 0 errors.

**Step 4: Manual test checklist (dev server)**

Run `npm run dev` and test:

1. Open Default View tab — verify "Camera Constraints" subsection appears between Opening Camera and Viewer Behavior
2. Check "Lock Orbit Point" — verify panning with right-click is disabled. Uncheck — panning works again.
3. Check "Lock Camera Distance" — verify scroll zoom is frozen. Uncheck — zoom works again.
4. Check "Keep Camera Above Ground" — orbit down toward the ground plane, verify it stops at the horizon. Uncheck — full orbit freedom returns.
5. Check "Limit Camera Height" — verify Max Y input row appears. Click "Set to current", verify it populates with current Y. Orbit up past the limit, verify clamping. Uncheck — row hides, no clamping.
6. Save an archive with constraints enabled. Reload the archive — verify checkboxes are restored and constraints apply.
7. Open the archive in kiosk mode (`?kiosk=true`) — verify constraints apply.

**Step 5: Commit**

```
chore: verify camera lock controls complete
```
