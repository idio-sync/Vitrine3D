# View Defaults Settings Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add archive-embeddable view default settings for SFM cameras and flight paths — controlling initial visibility, display mode, line color/opacity, and marker density.

**Architecture:** Settings are collected from DOM controls via the existing `collectMetadata()` → `setViewerSettings()` → manifest pipeline. New fields go into `viewer_settings` (not a separate `viewDefaults` key) to follow established patterns. On archive load, `archive-pipeline.ts` and `kiosk-main.ts` read the settings and apply them. A new `ViewDefaults` type on `AppState` tracks current values at runtime.

**Tech Stack:** TypeScript, Three.js, HTML form controls, existing manifest/viewer_settings pipeline.

**Spec:** `docs/superpowers/specs/2026-03-10-view-defaults-settings-design.md`

---

## Chunk 1: Types, State, and HTML Controls

### Task 1: Add ViewDefaults type and state property

**Files:**
- Modify: `src/types.ts:8` (after union types, before DecimationOptions)
- Modify: `src/types.ts:34` (AppState interface)
- Modify: `src/main.ts:260-320` (state initialization)

- [ ] **Step 1: Add ViewDefaults type to types.ts**

After the `AssetStateValue` type (line 8), add:

```typescript
export type MarkerDensity = 'off' | 'sparse' | 'all';
export type SfmDisplayMode = 'frustums' | 'markers';

export interface ViewDefaults {
    sfmCameras: {
        visible: boolean;
        displayMode: SfmDisplayMode;
    };
    flightPath: {
        visible: boolean;
        lineColor: string;
        lineOpacity: number;
        showMarkers: boolean;
        markerDensity: MarkerDensity;
    };
}
```

- [ ] **Step 2: Add viewDefaults to AppState**

In the `AppState` interface (after `splatLodEnabled` around line 87), add:

```typescript
viewDefaults: ViewDefaults;
```

- [ ] **Step 3: Initialize viewDefaults in main.ts state object**

In `src/main.ts` state initialization (after `splatLodEnabled` around line 320), add:

```typescript
viewDefaults: {
    sfmCameras: { visible: false, displayMode: 'frustums' },
    flightPath: { visible: false, lineColor: '#00ffff', lineOpacity: 1.0, showMarkers: true, markerDensity: 'all' },
},
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: Success with no new errors

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/main.ts
git commit -m "feat(types): add ViewDefaults type and state property"
```

---

### Task 2: Add SFM Camera Settings section to editor HTML

**Files:**
- Modify: `src/editor/index.html:709` (before the Drone Flight section)

- [ ] **Step 1: Add SFM Camera Settings section**

Insert before line 710 (`<!-- Drone Flight -->`):

```html
<!-- SfM Camera Defaults -->
<div class="prop-section archived" id="sfm-camera-section" style="display:none;">
    <div class="prop-section-hd">
        <span class="prop-section-title">SfM Cameras</span>
        <span class="archive-tag">archived</span>
        <span class="prop-section-chevron">&#9654;</span>
    </div>
    <div class="prop-section-body">
        <div class="cb-row">
            <input type="checkbox" id="sfm-show-on-load">
            <label for="sfm-show-on-load">Show on Load</label>
        </div>

        <label class="prop-label mt6">Display Mode</label>
        <select class="prop-select mb4" id="sfm-display-mode">
            <option value="frustums">Frustums</option>
            <option value="markers">Markers</option>
        </select>
    </div>
</div>
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(editor): add SfM Camera Settings section to view defaults"
```

---

### Task 3: Extend Drone Flight section with new controls

**Files:**
- Modify: `src/editor/index.html:730-734` (inside drone-flight-section prop-section-body, after existing controls)

- [ ] **Step 1: Add new controls after the existing "Show Direction Indicators" checkbox**

After the existing `flight-show-direction` checkbox div (line 733), before `</div>` closing the section-body, add:

```html

        <hr class="prop-divider mt6 mb6">

        <div class="cb-row">
            <input type="checkbox" id="flight-show-on-load">
            <label for="flight-show-on-load">Show on Load</label>
        </div>

        <label class="prop-label mt6">Line Color</label>
        <input type="color" class="prop-color-input" id="flight-line-color" value="#00ffff">

        <div class="sl-row mt6">
            <div class="sl-hd">
                <span class="sl-label">Line Opacity</span>
                <span class="sl-val" id="flight-line-opacity-value">100%</span>
            </div>
            <input type="range" id="flight-line-opacity" min="0" max="100" step="1" value="100">
        </div>

        <div class="cb-row mt6">
            <input type="checkbox" id="flight-show-markers" checked>
            <label for="flight-show-markers">Show Markers</label>
        </div>

        <label class="prop-label mt6">Marker Density</label>
        <select class="prop-select mb4" id="flight-marker-density">
            <option value="off">Off</option>
            <option value="sparse">Sparse (~200)</option>
            <option value="all" selected>All</option>
        </select>
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(editor): add flight path view default controls to Drone Flight section"
```

---

### Task 4: Show SFM Camera Settings section when colmap loads

**Files:**
- Modify: `src/main.ts:1965-1975` (updateColmapUI function)

- [ ] **Step 1: Add section visibility toggle to updateColmapUI()**

In `updateColmapUI()` (around line 1966), after the existing logic, add:

```typescript
const sfmSection = document.getElementById('sfm-camera-section');
if (sfmSection) sfmSection.style.display = state.colmapLoaded ? '' : 'none';
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(editor): show SfM Camera Settings section when colmap loads"
```

---

## Chunk 2: Event Wiring and State Sync

### Task 5: Wire UI controls to state.viewDefaults in event-wiring.ts

**Files:**
- Modify: `src/modules/event-wiring.ts:122-123` (after overlay toggle pill section)

- [ ] **Step 1: Add change listeners for new controls**

After the overlay pill handlers (after line 122), add a new section:

```typescript
// ─── View default settings ──────────────────────────────
addListener('sfm-show-on-load', 'change', () => {
    deps.state.viewDefaults.sfmCameras.visible = (document.getElementById('sfm-show-on-load') as HTMLInputElement)?.checked ?? false;
});
addListener('sfm-display-mode', 'change', () => {
    deps.state.viewDefaults.sfmCameras.displayMode = (document.getElementById('sfm-display-mode') as HTMLSelectElement)?.value as any ?? 'frustums';
});
addListener('flight-show-on-load', 'change', () => {
    deps.state.viewDefaults.flightPath.visible = (document.getElementById('flight-show-on-load') as HTMLInputElement)?.checked ?? false;
});
addListener('flight-line-color', 'input', () => {
    deps.state.viewDefaults.flightPath.lineColor = (document.getElementById('flight-line-color') as HTMLInputElement)?.value ?? '#00ffff';
});
addListener('flight-line-opacity', 'input', () => {
    const val = parseInt((document.getElementById('flight-line-opacity') as HTMLInputElement)?.value ?? '100', 10);
    deps.state.viewDefaults.flightPath.lineOpacity = val / 100;
    const label = document.getElementById('flight-line-opacity-value');
    if (label) label.textContent = `${val}%`;
});
addListener('flight-show-markers', 'change', () => {
    const checked = (document.getElementById('flight-show-markers') as HTMLInputElement)?.checked ?? true;
    deps.state.viewDefaults.flightPath.showMarkers = checked;
    const densitySelect = document.getElementById('flight-marker-density') as HTMLSelectElement | null;
    if (densitySelect) densitySelect.disabled = !checked;
});
addListener('flight-marker-density', 'change', () => {
    deps.state.viewDefaults.flightPath.markerDensity = (document.getElementById('flight-marker-density') as HTMLSelectElement)?.value as any ?? 'all';
});
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/modules/event-wiring.ts
git commit -m "feat(events): wire view default controls to state.viewDefaults"
```

---

## Chunk 3: Export Pipeline (Archive Write)

### Task 6: Add new fields to ViewerSettings and collectMetadata

**Files:**
- Modify: `src/modules/archive-creator.ts:140-143` (ViewerSettings interface)
- Modify: `src/modules/archive-creator.ts:1191-1194` (setViewerSettings method)
- Modify: `src/modules/metadata-manager.ts:222-225` (ViewerSettingsCollected type)
- Modify: `src/modules/metadata-manager.ts:1527-1530` (collectMetadata viewerSettings block)

- [ ] **Step 1: Add fields to ViewerSettings in archive-creator.ts**

After `flightShowDirection` (line 142), add:

```typescript
// View defaults (overlay visibility on load)
sfmVisible?: boolean;
sfmDisplayMode?: string;
flightVisible?: boolean;
flightLineColor?: string;
flightLineOpacity?: number;
flightShowMarkers?: boolean;
flightMarkerDensity?: string;
```

- [ ] **Step 2: Add setViewerSettings mappings in archive-creator.ts**

After line 1193 (`flightShowDirection`), add:

```typescript
if (settings.sfmVisible !== undefined) this.manifest.viewer_settings.sfm_visible = settings.sfmVisible;
if (settings.sfmDisplayMode !== undefined) this.manifest.viewer_settings.sfm_display_mode = settings.sfmDisplayMode;
if (settings.flightVisible !== undefined) this.manifest.viewer_settings.flight_visible = settings.flightVisible;
if (settings.flightLineColor !== undefined) this.manifest.viewer_settings.flight_line_color = settings.flightLineColor;
if (settings.flightLineOpacity !== undefined) this.manifest.viewer_settings.flight_line_opacity = settings.flightLineOpacity;
if (settings.flightShowMarkers !== undefined) this.manifest.viewer_settings.flight_show_markers = settings.flightShowMarkers;
if (settings.flightMarkerDensity !== undefined) this.manifest.viewer_settings.flight_marker_density = settings.flightMarkerDensity;
```

- [ ] **Step 3: Add fields to ViewerSettingsCollected in metadata-manager.ts**

After `flightShowDirection` (line 224), add:

```typescript
sfmVisible?: boolean;
sfmDisplayMode?: string;
flightVisible?: boolean;
flightLineColor?: string;
flightLineOpacity?: number;
flightShowMarkers?: boolean;
flightMarkerDensity?: string;
```

- [ ] **Step 4: Collect new values in collectMetadata() in metadata-manager.ts**

After `flightShowDirection` line (1529), add:

```typescript
// View defaults
sfmVisible: (document.getElementById('sfm-show-on-load') as HTMLInputElement)?.checked ?? false,
sfmDisplayMode: (document.getElementById('sfm-display-mode') as HTMLSelectElement)?.value || 'frustums',
flightVisible: (document.getElementById('flight-show-on-load') as HTMLInputElement)?.checked ?? false,
flightLineColor: (document.getElementById('flight-line-color') as HTMLInputElement)?.value || '#00ffff',
flightLineOpacity: parseInt((document.getElementById('flight-line-opacity') as HTMLInputElement)?.value || '100', 10) / 100,
flightShowMarkers: (document.getElementById('flight-show-markers') as HTMLInputElement)?.checked ?? true,
flightMarkerDensity: (document.getElementById('flight-marker-density') as HTMLSelectElement)?.value || 'all',
```

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: Success

- [ ] **Step 6: Commit**

```bash
git add src/modules/archive-creator.ts src/modules/metadata-manager.ts
git commit -m "feat(export): write view default settings into archive manifest"
```

---

## Chunk 4: Archive Load (Editor + Kiosk Read)

### Task 7: Apply view defaults on archive load in archive-pipeline.ts

**Files:**
- Modify: `src/modules/archive-pipeline.ts:728-730` (after `applyViewerSettings` call)

- [ ] **Step 1: Apply view defaults from manifest viewer_settings**

In `processArchive()`, after the `applyViewerSettings()` call (around line 729), add logic to populate `state.viewDefaults` and apply initial visibility. Find the `applyViewerSettings` function and add handling there.

In the `applyViewerSettings()` function in `archive-pipeline.ts`, add after the existing settings application:

```typescript
// View defaults — overlay visibility on load
if (settings.sfm_visible !== undefined) {
    state.viewDefaults.sfmCameras.visible = settings.sfm_visible;
    const el = document.getElementById('sfm-show-on-load') as HTMLInputElement | null;
    if (el) el.checked = settings.sfm_visible;
}
if (settings.sfm_display_mode !== undefined) {
    state.viewDefaults.sfmCameras.displayMode = settings.sfm_display_mode;
    const el = document.getElementById('sfm-display-mode') as HTMLSelectElement | null;
    if (el) el.value = settings.sfm_display_mode;
}
if (settings.flight_visible !== undefined) {
    state.viewDefaults.flightPath.visible = settings.flight_visible;
    const el = document.getElementById('flight-show-on-load') as HTMLInputElement | null;
    if (el) el.checked = settings.flight_visible;
}
if (settings.flight_line_color !== undefined) {
    state.viewDefaults.flightPath.lineColor = settings.flight_line_color;
    const el = document.getElementById('flight-line-color') as HTMLInputElement | null;
    if (el) el.value = settings.flight_line_color;
}
if (settings.flight_line_opacity !== undefined) {
    state.viewDefaults.flightPath.lineOpacity = settings.flight_line_opacity;
    const slider = document.getElementById('flight-line-opacity') as HTMLInputElement | null;
    const label = document.getElementById('flight-line-opacity-value');
    if (slider) slider.value = String(Math.round(settings.flight_line_opacity * 100));
    if (label) label.textContent = `${Math.round(settings.flight_line_opacity * 100)}%`;
}
if (settings.flight_show_markers !== undefined) {
    state.viewDefaults.flightPath.showMarkers = settings.flight_show_markers;
    const el = document.getElementById('flight-show-markers') as HTMLInputElement | null;
    if (el) el.checked = settings.flight_show_markers;
    const densitySelect = document.getElementById('flight-marker-density') as HTMLSelectElement | null;
    if (densitySelect) densitySelect.disabled = !settings.flight_show_markers;
}
if (settings.flight_marker_density !== undefined) {
    state.viewDefaults.flightPath.markerDensity = settings.flight_marker_density;
    const el = document.getElementById('flight-marker-density') as HTMLSelectElement | null;
    if (el) el.value = settings.flight_marker_density;
}
```

- [ ] **Step 2: Apply initial visibility after overlays load**

After flight path and colmap assets finish loading in `processArchive()`, apply visibility from `state.viewDefaults`. Look for where `state.flightPathLoaded = true` is set (around line 522) and after `colmapLoaded` is set. The scene groups should respect the `visible` setting:

In the flight path loading section (around line 522), after `state.flightPathLoaded = true`:
```typescript
// Apply view default visibility
if (deps.sceneRefs && 'flightPathGroup' in deps.sceneRefs) {
    (deps.sceneRefs as any).flightPathGroup.visible = state.viewDefaults.flightPath.visible;
}
```

For colmap, find the colmap loading section (around line 708-725) and after loading completes:
```typescript
// Apply view default visibility
if (deps.sceneRefs && 'colmapGroup' in deps.sceneRefs) {
    (deps.sceneRefs as any).colmapGroup.visible = state.viewDefaults.sfmCameras.visible;
}
```

Also update the overlay pill button active states to match:
```typescript
const sfmBtn = document.getElementById('btn-overlay-sfm');
if (sfmBtn) sfmBtn.classList.toggle('active', state.viewDefaults.sfmCameras.visible);
const fpBtn = document.getElementById('btn-overlay-flightpath');
if (fpBtn) fpBtn.classList.toggle('active', state.viewDefaults.flightPath.visible);
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add src/modules/archive-pipeline.ts
git commit -m "feat(archive): apply view defaults from manifest on archive load"
```

---

### Task 8: Apply view defaults in kiosk mode

**Files:**
- Modify: `src/modules/kiosk-main.ts:1630-1684` (flight path and colmap loading sections)

- [ ] **Step 1: Apply flight path view defaults in kiosk**

In `kiosk-main.ts`, after flight paths are loaded and the toggle button is set up (around line 1632-1643), apply view defaults from manifest:

```typescript
// Apply view defaults from manifest
const vs = manifest.viewer_settings || {};
const fpStartVisible = vs.flight_visible !== undefined ? vs.flight_visible : true;
flightPathManager.setVisible(fpStartVisible);
if (toggleBtn) toggleBtn.classList.toggle('active', fpStartVisible);
let fpVisible = fpStartVisible;
```

Replace the existing `let fpVisible = true;` with the above.

- [ ] **Step 2: Apply colmap view defaults in kiosk**

After colmap cameras are loaded and toggle button is set up (around line 1676-1684), apply:

```typescript
// Apply view defaults
const sfmStartVisible = vs.sfm_visible !== undefined ? vs.sfm_visible : true;
colmapGroup.visible = sfmStartVisible;
if (toggleBtn) toggleBtn.classList.toggle('active', sfmStartVisible);
```

- [ ] **Step 3: Apply flight path styling (color, opacity, marker density) in kiosk**

After flight path import loop (around line 1618), apply styling from manifest:

```typescript
// Apply flight path styling from manifest
if (vs.flight_line_color) flightPathManager.setLineColor?.(vs.flight_line_color);
if (vs.flight_line_opacity !== undefined) flightPathManager.setLineOpacity?.(vs.flight_line_opacity);
if (vs.flight_marker_density) flightPathManager.setMarkerDensity?.(vs.flight_marker_density);
if (vs.flight_show_markers === false) flightPathManager.setMarkerDensity?.('off');
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: Success

- [ ] **Step 5: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(kiosk): apply view defaults from manifest on archive load"
```

---

## Chunk 5: FlightPathManager New Methods

### Task 9: Add setLineColor, setLineOpacity, setMarkerDensity to FlightPathManager

**Files:**
- Modify: `src/modules/flight-path.ts:833-835` (after setVisible method)

- [ ] **Step 1: Add setLineColor method**

After `setVisible()` (line 835), add:

```typescript
/** Update the line color for all flight paths. */
setLineColor(hex: string): void {
    const color = new THREE.Color(hex);
    for (const [, entry] of this.meshes) {
        const mat = entry.line.material as THREE.LineBasicMaterial;
        if (mat.vertexColors) {
            // Vertex-colored lines: tint via color multiply
            mat.color.copy(color);
        }
        mat.needsUpdate = true;
    }
}

/** Update the line opacity for all flight paths. */
setLineOpacity(opacity: number): void {
    for (const [, entry] of this.meshes) {
        const mat = entry.line.material as THREE.LineBasicMaterial;
        mat.opacity = opacity;
        mat.transparent = opacity < 1;
        mat.needsUpdate = true;
    }
}

/** Set marker density: 'off' hides all markers, 'sparse' shows ~200, 'all' shows everything. */
setMarkerDensity(density: 'off' | 'sparse' | 'all'): void {
    for (const [id, entry] of this.meshes) {
        if (!entry.markers) continue;
        if (density === 'off') {
            entry.markers.visible = false;
        } else if (density === 'all') {
            entry.markers.visible = this._pathVisibility.get(id) !== false;
            entry.markers.count = entry.markers.userData?.totalCount ?? entry.markers.count;
        } else {
            // sparse: show ~200 evenly spaced
            const total = entry.markers.userData?.totalCount ?? entry.markers.count;
            const target = Math.min(200, total);
            entry.markers.count = target;
            entry.markers.visible = this._pathVisibility.get(id) !== false;
        }
    }
}
```

- [ ] **Step 2: Store totalCount on marker mesh userData during rendering**

In the `renderPath()` method, find where markers (InstancedMesh) are created and added to the group (around line 440-456). After creating the markers InstancedMesh and before adding to group, store the total count:

```typescript
markers.userData.totalCount = markers.count;
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add src/modules/flight-path.ts
git commit -m "feat(flight-path): add setLineColor, setLineOpacity, setMarkerDensity methods"
```

---

## Chunk 6: CSS and Final Polish

### Task 10: Add minimal CSS for new controls

**Files:**
- Modify: `src/styles.css` (near existing prop-section styles)

- [ ] **Step 1: Add styles for color input and divider**

Search for existing `.prop-color` or `.prop-divider` styles. If not present, add near the property panel styles:

```css
.prop-color-input {
    width: 32px;
    height: 24px;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px;
    cursor: pointer;
    background: transparent;
}

.prop-divider {
    border: none;
    border-top: 1px solid var(--border);
}
```

- [ ] **Step 2: Verify build compiles and dev server renders correctly**

Run: `npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style: add CSS for flight path color input and section divider"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Success, no errors

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK)

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass (existing tests unaffected)

- [ ] **Step 4: Manual smoke test**

Start dev server with `npm run dev`, open `/editor/`, verify:
1. Load an archive with flight paths and SFM cameras
2. "Drone Flight" section appears with new controls
3. "SfM Cameras" section appears with new controls
4. Toggle "Show on Load" checkboxes
5. Change flight path line color, opacity, marker density
6. Export archive, re-import, verify settings persist
7. Open in kiosk mode, verify visibility defaults are applied

- [ ] **Step 5: Final commit if any fixes needed**
