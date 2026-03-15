# Measurement Calibration & Kiosk Units Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Save measurement scale/units in archive manifests so kiosk viewers auto-display calibrated measurements with a unit toggle.

**Architecture:** Add `measurement_scale` + `measurement_unit` to `viewer_settings` in the manifest. Editor gets a reference-calibration flow (click two known points, enter real distance). Kiosk reads saved scale, hides the manual scale panel, and shows a unit-cycle dropdown on each measurement label.

**Tech Stack:** TypeScript, Three.js raycasting, DOM elements, existing archive-creator/loader pipeline.

---

### Task 1: Add unit conversion and calibration API to MeasurementSystem

**Files:**
- Modify: `src/modules/measurement-system.ts`

**Step 1: Add conversion table and new state properties**

After the existing `private _onClick` property (line 58), add:

```typescript
// Unit conversion factors (relative to meters)
static readonly UNIT_TO_METERS: Record<string, number> = {
    m: 1,
    cm: 0.01,
    mm: 0.001,
    ft: 0.3048,
    in: 0.0254,
};

static readonly DISPLAY_UNITS: string[] = ['ft', 'in', 'm', 'cm', 'mm'];
```

Replace the existing `scaleValue` and `scaleUnit` properties with:

```typescript
private baseScale: number;    // scene-units → real-world in baseUnit
private baseUnit: string;     // the unit the archive was calibrated in
private displayUnit: string;  // what the user currently wants to see
```

**Step 2: Update constructor**

Replace:
```typescript
this.scaleValue = 1;
this.scaleUnit = 'm';
```
With:
```typescript
this.baseScale = 1;
this.baseUnit = 'm';
this.displayUnit = 'm';
```

**Step 3: Replace `_getDisplayDistance` and `setScale`**

Replace `_getDisplayDistance` with:

```typescript
private _getDisplayDistance(rawDistance: number): string {
    // Convert: rawDistance (scene units) → meters → display unit
    const inBaseUnit = rawDistance * this.baseScale;
    const inMeters = inBaseUnit * MeasurementSystem.UNIT_TO_METERS[this.baseUnit];
    const inDisplayUnit = inMeters / MeasurementSystem.UNIT_TO_METERS[this.displayUnit];
    return `${parseFloat(inDisplayUnit.toFixed(3))}`;
}
```

Replace `setScale` with:

```typescript
setScale(value: number, unit: string): void {
    if (isNaN(value) || value <= 0) return;
    this.baseScale = value;
    this.baseUnit = unit;
    this._refreshAllLabels();
}

setBaseScale(value: number, unit: string): void {
    this.setScale(value, unit);
}

setDisplayUnit(unit: string): void {
    if (!MeasurementSystem.UNIT_TO_METERS[unit]) return;
    this.displayUnit = unit;
    this._refreshAllLabels();
}

getScale(): number { return this.baseScale; }
getUnit(): string { return this.baseUnit; }
getDisplayUnit(): string { return this.displayUnit; }
isCalibrated(): boolean { return this.baseScale !== 1 || this.baseUnit !== 'm'; }

calibrate(rawDistance: number, realDistance: number, unit: string): void {
    if (rawDistance <= 0 || realDistance <= 0) return;
    this.baseScale = realDistance / rawDistance;
    this.baseUnit = unit;
    this._refreshAllLabels();
}

private _refreshAllLabels(): void {
    for (const m of this.measurements) {
        const textEl = m.labelEl.querySelector('.measure-label-text') as HTMLElement | null;
        if (textEl) textEl.textContent = this._getDisplayDistance(m.rawDistance);
        const unitEl = m.labelEl.querySelector('.measure-unit-btn') as HTMLElement | null;
        if (unitEl) unitEl.textContent = this.displayUnit;
    }
}
```

**Step 4: Update `_renderMeasurement` to include unit badge**

In `_renderMeasurement`, after creating `distSpan` and before creating `deleteBtn`, add:

```typescript
const unitBtn = document.createElement('button');
unitBtn.className = 'measure-unit-btn';
unitBtn.textContent = this.displayUnit;
unitBtn.title = 'Change unit';
unitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    this._showUnitDropdown(unitBtn);
});
```

Update `distSpan.textContent` to use just the number (no unit):
```typescript
distSpan.textContent = this._getDisplayDistance(rawDistance);
```

Update the `labelEl.appendChild` calls to insert `unitBtn` between `distSpan` and `deleteBtn`:
```typescript
labelEl.appendChild(distSpan);
labelEl.appendChild(unitBtn);
labelEl.appendChild(deleteBtn);
```

**Step 5: Add unit dropdown method**

```typescript
private _showUnitDropdown(anchorEl: HTMLElement): void {
    // Remove any existing dropdown
    const existing = document.querySelector('.measure-unit-dropdown');
    if (existing) { existing.remove(); return; }

    const dropdown = document.createElement('div');
    dropdown.className = 'measure-unit-dropdown';

    for (const unit of MeasurementSystem.DISPLAY_UNITS) {
        const opt = document.createElement('button');
        opt.className = 'measure-unit-option';
        if (unit === this.displayUnit) opt.classList.add('active');
        opt.textContent = unit;
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setDisplayUnit(unit);
            dropdown.remove();
        });
        dropdown.appendChild(opt);
    }

    // Position near the anchor
    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    document.body.appendChild(dropdown);

    // Close on outside click
    const closeHandler = (e: MouseEvent) => {
        if (!dropdown.contains(e.target as Node)) {
            dropdown.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}
```

**Step 6: Run build to verify**

Run: `npm run build`
Expected: No TypeScript errors.

**Step 7: Commit**

```
feat: add unit conversion and calibration API to MeasurementSystem
```

---

### Task 2: Add measurement unit CSS styles

**Files:**
- Modify: `src/styles.css` (after existing `.measure-label-delete:hover` block, ~line 1627)
- Modify: `src/kiosk.css` (add kiosk-specific overrides if needed)

**Step 1: Add unit button and dropdown styles to styles.css**

After the `.measure-label-delete:hover` rule (~line 1627), add:

```css
/* Unit toggle button on measurement labels */
.measure-unit-btn {
    background: none;
    border: 1px solid rgba(255, 107, 53, 0.4);
    border-radius: 3px;
    color: #FF6B35;
    font-family: monospace;
    font-size: 11px;
    padding: 0 4px;
    cursor: pointer;
    margin-left: 2px;
    line-height: 1.4;
    transition: background 0.15s;
}
.measure-unit-btn:hover {
    background: rgba(255, 107, 53, 0.15);
}

/* Unit dropdown popup */
.measure-unit-dropdown {
    position: fixed;
    z-index: 10001;
    background: var(--panel-bg, #1e1e2e);
    border: 1px solid var(--border-color, #333);
    border-radius: 6px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.measure-unit-option {
    background: none;
    border: none;
    color: var(--text-primary, #e0e0e0);
    font-family: monospace;
    font-size: 12px;
    padding: 4px 12px;
    cursor: pointer;
    border-radius: 4px;
    text-align: left;
}
.measure-unit-option:hover {
    background: rgba(255, 107, 53, 0.15);
}
.measure-unit-option.active {
    color: #FF6B35;
    font-weight: bold;
}

/* Calibration inline UI in editor measure pane */
.measure-calibrate-status {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
    line-height: 1.5;
}
.measure-calibrate-status.calibrated {
    color: #4CAF50;
}
.measure-calibrate-inline {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
    padding: 8px;
    background: rgba(255, 107, 53, 0.05);
    border: 1px solid rgba(255, 107, 53, 0.2);
    border-radius: 6px;
}
.measure-calibrate-inline label {
    font-size: 11px;
    color: var(--text-secondary);
}
.measure-calibrate-inline .calibrate-row {
    display: flex;
    align-items: center;
    gap: 6px;
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```
feat: add CSS styles for measurement unit toggle and calibration UI
```

---

### Task 3: Add `measurement_scale`/`measurement_unit` to manifest schema and archive-creator

**Files:**
- Modify: `src/modules/archive-creator.ts` (Manifest type ~line 284, empty manifest ~line 657, ViewerSettings interface ~line 112, setViewerSettings ~line 1136)
- Modify: `src/modules/metadata-manager.ts` (ViewerSettings interface ~line 193, collectMetadata ~line 1423)

**Step 1: Add fields to Manifest `viewer_settings` type**

In `archive-creator.ts`, after `environment_as_background: boolean | null;` (~line 306), add:

```typescript
measurement_scale: number | null;
measurement_unit: string | null;
```

**Step 2: Add defaults in `_createEmptyManifest`**

In `archive-creator.ts` `_createEmptyManifest()`, in the `viewer_settings` object, add:

```typescript
measurement_scale: null,
measurement_unit: null,
```

**Step 3: Add to ViewerSettings interface in archive-creator.ts**

After `environmentAsBackground` (~line 135), add:

```typescript
measurementScale?: number | null;
measurementUnit?: string | null;
```

**Step 4: Add to setViewerSettings**

After the `environmentAsBackground` line in `setViewerSettings` (~line 1161), add:

```typescript
if (settings.measurementScale !== undefined) this.manifest.viewer_settings.measurement_scale = settings.measurementScale;
if (settings.measurementUnit !== undefined) this.manifest.viewer_settings.measurement_unit = settings.measurementUnit;
```

**Step 5: Add to ViewerSettings in metadata-manager.ts**

After `environmentAsBackground` (~line 216), add:

```typescript
measurementScale: number | null;
measurementUnit: string | null;
```

**Step 6: Add to collectMetadata in metadata-manager.ts**

In the `viewerSettings` object of `collectMetadata` (~after line 1477), add:

```typescript
measurementScale: null,  // Populated by main.ts from measurementSystem before export
measurementUnit: null,
```

**Step 7: Run build**

Run: `npm run build`
Expected: No errors.

**Step 8: Commit**

```
feat: add measurement_scale/measurement_unit to manifest viewer_settings schema
```

---

### Task 4: Wire editor save — inject measurement scale into export

**Files:**
- Modify: `src/modules/export-controller.ts` (~line 234)
- Modify: `src/types.ts` (ExportDeps interface)

**Step 1: Ensure measurementSystem is in ExportDeps**

Check if `measurementSystem` is already in `ExportDeps` in `src/types.ts`. If not, add it. The `ExportDeps` should include:

```typescript
measurementSystem?: { getScale(): number; getUnit(): string } | null;
```

**Step 2: Inject measurement scale into viewerSettings before calling setViewerSettings**

In `export-controller.ts`, after `const metadata = metadataFns.collectMetadata();` (~line 171), add:

```typescript
// Inject current measurement calibration into viewer settings
if (deps.sceneRefs?.measurementSystem) {
    const ms = deps.sceneRefs.measurementSystem;
    if (ms.isCalibrated()) {
        metadata.viewerSettings.measurementScale = ms.getScale();
        metadata.viewerSettings.measurementUnit = ms.getUnit();
    }
}
```

Note: This depends on `measurementSystem` being available on `sceneRefs` or `deps`. Check the existing `createExportDeps()` in `main.ts` to confirm where it's passed. If it's on `sceneRefs`, use `deps.sceneRefs.measurementSystem`. Otherwise add it to `ExportDeps`.

**Step 3: Do the same for `exportMetadataManifest`**

In the `exportMetadataManifest` function (~line 783), after `const metadata = metadataFns.collectMetadata();`, add the same injection block.

**Step 4: Run build**

Run: `npm run build`
Expected: No errors.

**Step 5: Commit**

```
feat: inject measurement calibration into archive exports
```

---

### Task 5: Wire editor load — apply saved scale from archive manifest

**Files:**
- Modify: `src/main.ts` (in archive load handling, where viewer_settings are applied)

**Step 1: Find where manifest viewer_settings are applied after archive load**

In `main.ts`, find the `prefillMetadataFromArchive` call or where viewer settings are read post-load. After the measurement system is initialized and the archive is loaded, apply saved scale:

```typescript
// Apply saved measurement calibration from archive
if (state.archiveManifest?.viewer_settings?.measurement_scale != null &&
    state.archiveManifest?.viewer_settings?.measurement_unit) {
    measurementSystem.setBaseScale(
        state.archiveManifest.viewer_settings.measurement_scale,
        state.archiveManifest.viewer_settings.measurement_unit
    );
    // Update the manual scale inputs to reflect saved values
    const scaleInput = document.getElementById('measure-scale-value') as HTMLInputElement | null;
    const unitSelect = document.getElementById('measure-scale-unit') as HTMLSelectElement | null;
    if (scaleInput) scaleInput.value = String(state.archiveManifest.viewer_settings.measurement_scale);
    if (unitSelect) unitSelect.value = state.archiveManifest.viewer_settings.measurement_unit;
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: No errors.

**Step 3: Commit**

```
feat: apply saved measurement scale when loading archives in editor
```

---

### Task 6: Add reference calibration UI to editor measure pane

**Files:**
- Modify: `src/editor/index.html` (~line 1315, the measure pane)
- Modify: `src/main.ts` (wire calibration events in `_wireMeasurementControls`)

**Step 1: Restructure the measure pane HTML in editor/index.html**

Replace the entire `#pane-measure` div (lines 1315-1351) with:

```html
<div class="props-pane" id="pane-measure">

    <div class="prop-section open" id="measure-calibrate-section">
        <div class="prop-section-hd">
            <span class="prop-section-title">Calibrate</span>
            <span class="prop-section-chevron">&#9654;</span>
        </div>
        <div class="prop-section-body">
            <p style="font-size:11px; color:var(--text-muted); margin-bottom:8px; line-height:1.5;">
                Click two points on a known dimension to set the real-world scale.
            </p>
            <button class="prop-btn" id="btn-calibrate-scale">Calibrate Scale</button>
            <div id="calibrate-inline-form" style="display:none;" class="measure-calibrate-inline">
                <label>Raw scene distance: <strong id="calibrate-raw-distance">—</strong></label>
                <div class="calibrate-row">
                    <label>Real distance:</label>
                    <input class="prop-input" type="number" id="calibrate-real-distance" min="0.0001" step="any" style="width:70px; text-align:center;">
                    <select class="prop-select" id="calibrate-unit" style="width:60px;">
                        <option value="ft">ft</option>
                        <option value="in">in</option>
                        <option value="m">m</option>
                        <option value="cm">cm</option>
                        <option value="mm">mm</option>
                    </select>
                    <button class="prop-btn" id="btn-calibrate-apply">Apply</button>
                </div>
            </div>
            <div id="measure-calibrate-status" class="measure-calibrate-status">Not calibrated</div>
        </div>
    </div>

    <div class="prop-section" id="measure-scale-panel">
        <div class="prop-section-hd">
            <span class="prop-section-title">Advanced: Manual Scale</span>
            <span class="prop-section-chevron">&#9654;</span>
        </div>
        <div class="prop-section-body">
            <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:11px; color:var(--text-secondary); white-space:nowrap;">1 unit =</span>
                <input class="prop-input" type="number" id="measure-scale-value" value="1" min="0.0001" step="any" style="width:60px; text-align:center;">
                <select class="prop-select" id="measure-scale-unit" style="width:60px;">
                    <option value="ft">ft</option>
                    <option value="in">in</option>
                    <option value="m">m</option>
                    <option value="cm">cm</option>
                    <option value="mm">mm</option>
                </select>
            </div>
        </div>
    </div>

    <div class="prop-section open">
        <div class="prop-section-hd">
            <span class="prop-section-title">Measurements</span>
            <span class="prop-section-chevron">&#9654;</span>
        </div>
        <div class="prop-section-body">
            <p style="font-size:11px; color:var(--text-muted); margin-bottom:8px; line-height:1.5;">
                Click two points on the model to measure distance.
            </p>
            <button class="prop-btn" id="btn-measure">Start Measuring</button>
            <button class="prop-btn danger mt4" id="measure-clear-all">Clear All</button>
        </div>
    </div>

</div>
```

Note: The unit dropdowns now have imperial first (ft, in, m, cm, mm).

**Step 2: Wire the calibration button in main.ts `_wireMeasurementControls`**

Add to the `_wireMeasurementControls` function, after the existing scale input handlers:

```typescript
// Calibration flow
let _calibrateRawDistance = 0;
addListener('btn-calibrate-scale', 'click', () => {
    if (!measurementSystem) return;
    // Enter a special calibration measure mode
    measurementSystem.setMeasureMode(true);
    const btn = document.getElementById('btn-calibrate-scale');
    if (btn) btn.textContent = 'Click point A...';
    // Store original callback and install calibration callback
    const origCallback = measurementSystem.onMeasureModeChanged;
    let clickCount = 0;
    let pointA: any = null;

    // We'll use the measurement system's existing click handler
    // but intercept the result. For simplicity, listen for new measurements.
    const checkForCalibration = setInterval(() => {
        // MeasurementSystem will create a measurement when 2 points are clicked
        // We grab the last one's rawDistance
        const measurements = (measurementSystem as any).measurements;
        if (measurements.length > 0) {
            const last = measurements[measurements.length - 1];
            _calibrateRawDistance = last.rawDistance;
            clearInterval(checkForCalibration);

            // Show the inline form
            const rawEl = document.getElementById('calibrate-raw-distance');
            if (rawEl) rawEl.textContent = parseFloat(_calibrateRawDistance.toFixed(4)) + ' units';
            const form = document.getElementById('calibrate-inline-form');
            if (form) form.style.display = '';
            if (btn) btn.textContent = 'Calibrate Scale';

            measurementSystem.setMeasureMode(false);
            // Remove the calibration measurement (it was just for reference)
            measurementSystem.removeMeasurement(last.id);
        }
    }, 100);
});

addListener('btn-calibrate-apply', 'click', () => {
    if (!measurementSystem || _calibrateRawDistance <= 0) return;
    const realDist = parseFloat((document.getElementById('calibrate-real-distance') as HTMLInputElement)?.value);
    const unit = (document.getElementById('calibrate-unit') as HTMLSelectElement)?.value || 'm';
    if (isNaN(realDist) || realDist <= 0) return;

    measurementSystem.calibrate(_calibrateRawDistance, realDist, unit);

    // Update status
    const status = document.getElementById('measure-calibrate-status');
    if (status) {
        status.textContent = `Calibrated: 1 unit = ${parseFloat(measurementSystem.getScale().toFixed(4))} ${measurementSystem.getUnit()}`;
        status.classList.add('calibrated');
    }

    // Update manual scale inputs to match
    const scaleInput = document.getElementById('measure-scale-value') as HTMLInputElement | null;
    const unitSelect = document.getElementById('measure-scale-unit') as HTMLSelectElement | null;
    if (scaleInput) scaleInput.value = String(parseFloat(measurementSystem.getScale().toFixed(4)));
    if (unitSelect) unitSelect.value = measurementSystem.getUnit();

    // Hide inline form
    const form = document.getElementById('calibrate-inline-form');
    if (form) form.style.display = 'none';
});
```

**Step 3: Run build**

Run: `npm run build`
Expected: No errors.

**Step 4: Commit**

```
feat: add reference calibration UI to editor measure pane
```

---

### Task 7: Wire kiosk — auto-apply saved scale and hide manual panel

**Files:**
- Modify: `src/modules/kiosk-main.ts` (~line 1498, viewer_settings application; ~line 2104, measurement tool wiring)
- Modify: `src/index.html` (kiosk measure pane ~line 374)

**Step 1: Update kiosk index.html measure pane**

Replace the kiosk `#pane-measure` (lines 374-410 of `src/index.html`) with:

```html
<div class="props-pane" id="pane-measure">

    <div class="prop-section open" id="measure-scale-panel">
        <div class="prop-section-hd">
            <span class="prop-section-title">Scale</span>
            <span class="prop-section-chevron">&#9654;</span>
        </div>
        <div class="prop-section-body">
            <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:11px; color:var(--text-secondary); white-space:nowrap;">1 unit =</span>
                <input class="prop-input" type="number" id="measure-scale-value" value="1" min="0.0001" step="any" style="width:60px; text-align:center;">
                <select class="prop-select" id="measure-scale-unit" style="width:60px;">
                    <option value="ft">ft</option>
                    <option value="in">in</option>
                    <option value="m">m</option>
                    <option value="cm">cm</option>
                    <option value="mm">mm</option>
                </select>
            </div>
        </div>
    </div>

    <div class="prop-section open">
        <div class="prop-section-hd">
            <span class="prop-section-title">Measurements</span>
            <span class="prop-section-chevron">&#9654;</span>
        </div>
        <div class="prop-section-body">
            <p style="font-size:11px; color:var(--text-muted); margin-bottom:8px; line-height:1.5;">
                Click two points on the model to measure distance.
            </p>
            <button class="prop-btn" id="btn-measure">Start Measuring</button>
            <button class="prop-btn danger mt4" id="measure-clear-all">Clear All</button>
        </div>
    </div>

</div>
```

Note: The only change from the current kiosk HTML is reordering the unit options to imperial-first (ft, in, m, cm, mm).

**Step 2: Apply saved measurement scale in kiosk-main.ts viewer_settings block**

In `kiosk-main.ts`, inside the `if (manifest.viewer_settings)` block, after the last viewer settings application (~line 1610 area, after the tone mapping block), add:

```typescript
// Apply saved measurement calibration
if (manifest.viewer_settings.measurement_scale != null &&
    manifest.viewer_settings.measurement_unit &&
    measurementSystem) {
    measurementSystem.setBaseScale(
        manifest.viewer_settings.measurement_scale,
        manifest.viewer_settings.measurement_unit
    );
    // Hide the manual scale panel — calibration is embedded
    const scalePanel = document.getElementById('measure-scale-panel');
    if (scalePanel) scalePanel.style.display = 'none';
    log.info('Applied measurement calibration:', manifest.viewer_settings.measurement_scale, manifest.viewer_settings.measurement_unit);
}
```

**Step 3: Run build**

Run: `npm run build`
Expected: No errors.

**Step 4: Test manually**

1. Open editor, load a model
2. Go to Measure pane, click "Calibrate Scale"
3. Click two points on a known dimension, enter real distance
4. Export archive
5. Open archive in kiosk mode
6. Use measure tool — distances should show calibrated values
7. Click unit badge on label — should cycle through ft/in/m/cm/mm

**Step 5: Commit**

```
feat: auto-apply measurement calibration in kiosk mode from archive manifest
```

---

### Task 8: Run lint and build, verify everything compiles

**Files:** None (verification only)

**Step 1: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK).

**Step 2: Run build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass.

**Step 4: Final commit if any lint fixes needed**

```
chore: lint fixes for measurement calibration feature
```
