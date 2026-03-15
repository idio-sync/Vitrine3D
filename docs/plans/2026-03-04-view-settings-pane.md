# View Settings Pane Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate the Scene pane and Default View metadata tab into a new "View Settings" tool rail button with clear archived vs session-only sections.

**Architecture:** The Scene pane (`pane-scene`) and Default View tab (`edit-tab-viewer`) are merged into a new `pane-view-settings` props pane. The Scene tool rail button is removed. The `viewer` option is removed from the metadata edit category dropdown. All element IDs are preserved so event wiring in `event-wiring.ts` continues to work without changes. The `TOOL_PANE_MAP` in `ui-controller.ts` gets a new entry and loses the `scene` entry. Keyboard shortcut `S` is reassigned to the new `viewsettings` tool, and `V` is added as an alias.

**Tech Stack:** HTML, CSS (styles.css), TypeScript (ui-controller.ts, event-wiring.ts, metadata-profile.ts)

---

### Task 1: Add View Settings button to tool rail

**Files:**
- Modify: `src/editor/index.html:95-103` (replace Scene button)
- Modify: `src/editor/index.html:133-134` (insert before Metadata button)

**Step 1: Replace Scene button with View Settings button**

In `src/editor/index.html`, remove the Scene button (lines 95-102) and add the View Settings button in the Narrate zone between Capture (line 133) and Metadata (line 136):

```html
            <!-- View Settings — Background, display defaults, camera, lighting -->
            <button class="tool-btn" data-tool="viewsettings" data-tooltip="View Settings  V" title="Scene appearance, display defaults, and preview settings">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="12" r="4"/>
                    <line x1="21.17" y1="8" x2="12" y2="8"/>
                    <line x1="3.95" y1="6.06" x2="8.54" y2="14"/>
                    <line x1="10.88" y1="21.94" x2="15.46" y2="14"/>
                </svg>
            </button>
```

This uses an aperture/iris icon suggesting view/display control.

**Step 2: Verify the tool rail order is correct**

The Narrate zone should now read:
```
Annotate → Walkthrough → Capture → View Settings → Metadata
```

**Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat: add View Settings button to tool rail, remove Scene button"
```

---

### Task 2: Create the View Settings pane HTML

**Files:**
- Modify: `src/editor/index.html:326-476` (remove `pane-scene`)
- Modify: `src/editor/index.html` (add new `pane-view-settings` in its place)
- Modify: `src/editor/index.html:1790-1916` (remove `edit-tab-viewer`)
- Modify: `src/editor/index.html:1202` (remove `viewer` option from edit-category-select)

**Step 1: Replace pane-scene with pane-view-settings**

Remove the entire `<div class="props-pane" id="pane-scene">` block (lines 326-476) and replace with the new pane. The new pane contains two sections — "Archive Defaults" (with `archived` class for accent border) and "Editor Preview" (no accent). All element IDs from both the old Scene pane and the Default View tab are preserved exactly.

```html
            <div class="props-pane" id="pane-view-settings">

                <!-- ── Archive Defaults (saved to .a3d/.a3z) ────── -->

                <!-- Background -->
                <div class="prop-section open archived">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Background</span>
                        <span class="archive-tag">archived</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <div class="swatch-row">
                            <div class="swatch active" data-color="#1a1a2e" style="background:#1a1a2e;" title="Dark Blue"></div>
                            <div class="swatch" data-color="#0a0a0a" style="background:#0a0a0a;" title="Near Black"></div>
                            <div class="swatch" data-color="#2d2d2d" style="background:#2d2d2d;" title="Dark Gray"></div>
                            <div class="swatch" data-color="#4a4a4a" style="background:#4a4a4a;" title="Medium Gray"></div>
                            <div class="swatch" data-color="#808080" style="background:#808080;" title="Gray"></div>
                            <div class="swatch" data-color="#f0f0f0" style="background:#f0f0f0; border-color:#555;" title="Light Gray"></div>
                            <div class="swatch-custom" title="Custom color">
                                <input type="color" id="bg-color-picker" value="#1a1a2e">
                                <span>Custom</span>
                            </div>
                        </div>
                        <div class="prop-btn-row mt4">
                            <label for="bg-image-input" class="prop-btn" style="font-size:10px; cursor:pointer; margin-bottom:0;">BG Image...</label>
                            <button class="prop-btn" id="btn-load-bg-image-url" style="font-size:10px;">BG URL...</button>
                        </div>
                        <input type="file" id="bg-image-input" accept=".png,.jpg,.jpeg,.webp" style="display:none" />
                        <div class="prop-btn-row mt4" style="display:none;" id="bg-image-status">
                            <span id="bg-image-filename" class="prop-hint" style="flex:1;"></span>
                            <button id="btn-clear-bg-image" class="prop-btn" style="font-size:10px; flex:0;">Clear</button>
                        </div>
                    </div>
                </div>

                <!-- Background Overrides -->
                <div class="prop-section archived">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Background Overrides</span>
                        <span class="archive-tag">archived</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <div class="cb-row">
                            <input type="checkbox" id="meta-viewer-mesh-bg-override">
                            <label for="meta-viewer-mesh-bg-override">Mesh Background</label>
                        </div>
                        <span class="prop-hint">Background color used when viewing the mesh asset.</span>
                        <div class="color-input-row" id="meta-viewer-mesh-bg-color-row" style="margin-top: 6px; display: none;">
                            <input type="color" id="meta-viewer-mesh-bg-color" value="#1a1a2e">
                            <span class="color-hex-label" id="meta-viewer-mesh-bg-color-hex">#1a1a2e</span>
                        </div>

                        <div class="cb-row mt6">
                            <input type="checkbox" id="meta-viewer-splat-bg-override">
                            <label for="meta-viewer-splat-bg-override">Splat Background</label>
                        </div>
                        <span class="prop-hint">Background color used when viewing the splat or combined view.</span>
                        <div class="color-input-row" id="meta-viewer-splat-bg-color-row" style="margin-top: 6px; display: none;">
                            <input type="color" id="meta-viewer-splat-bg-color" value="#1a1a2e">
                            <span class="color-hex-label" id="meta-viewer-splat-bg-color-hex">#1a1a2e</span>
                        </div>
                    </div>
                </div>

                <!-- Display Mode -->
                <div class="prop-section archived">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Display Mode</span>
                        <span class="archive-tag">archived</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <label for="meta-viewer-display-mode" class="prop-label">Default Asset View</label>
                        <select class="prop-select mb4" id="meta-viewer-display-mode">
                            <option value="">Auto (show primary asset)</option>
                            <option value="splat">Splat</option>
                            <option value="model">Model</option>
                            <option value="pointcloud">Point Cloud</option>
                            <option value="both">All Assets</option>
                        </select>
                        <span class="prop-hint">Which asset(s) to display when the viewer opens.</span>

                        <label for="meta-viewer-default-matcap" class="prop-label mt6">Default Matcap</label>
                        <select class="prop-select mb4" id="meta-viewer-default-matcap">
                            <option value="">None</option>
                            <option value="clay">Clay</option>
                            <option value="chrome">Chrome</option>
                            <option value="pearl">Pearl</option>
                            <option value="jade">Jade</option>
                            <option value="copper">Copper</option>
                            <option value="bronze">Bronze</option>
                            <option value="dark-bronze">Dark Bronze</option>
                        </select>
                        <span class="prop-hint">Apply a matcap material to meshes when the viewer opens.</span>
                    </div>
                </div>

                <!-- Mesh Rendering -->
                <div class="prop-section archived">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Mesh Rendering</span>
                        <span class="archive-tag">archived</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <div class="cb-row">
                            <input type="checkbox" id="meta-viewer-single-sided" checked>
                            <label for="meta-viewer-single-sided">Single Sided</label>
                        </div>
                        <span class="prop-hint">When enabled, back faces are culled. Disable for thin geometry like leaves, fabric, or paper.</span>
                    </div>
                </div>

                <!-- Opening Camera -->
                <div class="prop-section archived">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Opening Camera</span>
                        <span class="archive-tag">archived</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <div class="prop-btn-row">
                            <button id="btn-save-camera" class="prop-btn" style="flex: 1;">Save Current View</button>
                            <button id="btn-clear-camera" class="prop-btn" style="flex: 0 0 auto; display: none;">Clear</button>
                        </div>
                        <span class="prop-hint" id="camera-save-hint">Saves the current camera position as the default opening view.</span>
                        <div id="camera-saved-info" style="display: none;">
                            <span class="prop-hint">Position: <span id="camera-pos-display"></span></span>
                            <span class="prop-hint">Target: <span id="camera-target-display"></span></span>
                        </div>
                        <input type="hidden" id="meta-viewer-camera-pos-x">
                        <input type="hidden" id="meta-viewer-camera-pos-y">
                        <input type="hidden" id="meta-viewer-camera-pos-z">
                        <input type="hidden" id="meta-viewer-camera-target-x">
                        <input type="hidden" id="meta-viewer-camera-target-y">
                        <input type="hidden" id="meta-viewer-camera-target-z">
                    </div>
                </div>

                <!-- Camera Constraints -->
                <div class="prop-section archived">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Camera Constraints</span>
                        <span class="archive-tag">archived</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <div class="cb-row">
                            <input type="checkbox" id="meta-viewer-lock-orbit">
                            <label for="meta-viewer-lock-orbit">Lock Orbit Point</label>
                        </div>
                        <span class="prop-hint">Prevent panning — the orbit center stays fixed.</span>

                        <div class="cb-row mt6">
                            <input type="checkbox" id="meta-viewer-lock-orbit-distance">
                            <label for="meta-viewer-lock-orbit-distance">Lock Camera Distance</label>
                        </div>
                        <span class="prop-hint">Freeze zoom at the current distance from the orbit point.</span>
                        <input type="hidden" id="meta-viewer-lock-distance-value">

                        <div class="cb-row mt6">
                            <input type="checkbox" id="meta-viewer-lock-above-ground">
                            <label for="meta-viewer-lock-above-ground">Keep Camera Above Ground</label>
                        </div>
                        <span class="prop-hint">Prevent the camera from orbiting below the ground plane.</span>

                        <div class="cb-row mt6">
                            <input type="checkbox" id="meta-viewer-lock-max-height">
                            <label for="meta-viewer-lock-max-height">Limit Camera Height</label>
                        </div>
                        <span class="prop-hint">Cap the camera's vertical position at a maximum height.</span>
                        <div id="max-height-controls" style="display: none; margin-top: 4px; padding-left: 24px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <label for="meta-viewer-max-height-value" style="white-space: nowrap; font-size: 12px;">Max Y:</label>
                                <input type="number" id="meta-viewer-max-height-value" step="0.1" style="width: 80px; font-size: 12px;" placeholder="0.0">
                                <button id="btn-set-max-height-current" class="prop-btn" style="font-size: 10px; padding: 2px 8px; white-space: nowrap;">Set to current</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Viewer Behavior -->
                <div class="prop-section archived">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Viewer Behavior</span>
                        <span class="archive-tag">archived</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <div class="cb-row">
                            <input type="checkbox" id="meta-viewer-auto-rotate">
                            <label for="meta-viewer-auto-rotate">Auto-Rotate</label>
                        </div>
                        <span class="prop-hint">Slowly rotate the scene when the viewer first opens.</span>
                        <div class="cb-row mt6">
                            <input type="checkbox" id="meta-viewer-annotations-visible" checked>
                            <label for="meta-viewer-annotations-visible">Show Annotations</label>
                        </div>
                        <span class="prop-hint">Display annotation markers when the viewer opens.</span>
                    </div>
                </div>

                <!-- ── Editor Preview (session-only) ────────────── -->

                <!-- Camera -->
                <div class="prop-section open">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Camera</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <div class="sl-row">
                            <div class="sl-hd">
                                <span class="sl-label">Field of View</span>
                                <span class="sl-val" id="camera-fov-value">60</span>
                            </div>
                            <input type="range" id="camera-fov" min="10" max="120" step="1" value="60">
                        </div>
                        <div class="cb-row mt4">
                            <input type="checkbox" id="btn-auto-rotate">
                            <label for="btn-auto-rotate">Auto-rotate</label>
                        </div>
                        <div class="cb-row">
                            <input type="checkbox" id="toggle-gridlines" checked>
                            <label for="toggle-gridlines">Show Grid</label>
                        </div>
                        <div class="cb-row">
                            <input type="checkbox" id="btn-fly-mode">
                            <label for="btn-fly-mode">Fly Camera Mode</label>
                        </div>
                        <div class="prop-btn-row mt6">
                            <button class="prop-btn" id="btn-reset-camera">Reset Camera</button>
                            <button class="prop-btn" id="btn-fit-view">Fit to View</button>
                            <button class="prop-btn" id="btn-reset-orbit">Reset Orbit Center</button>
                        </div>
                    </div>
                </div>

                <!-- Lighting -->
                <div class="prop-section">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Lighting</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <div class="sl-row">
                            <div class="sl-hd"><span class="sl-label">Ambient</span><span class="sl-val" id="ambient-intensity-value">0.8</span></div>
                            <input type="range" id="ambient-intensity" min="0" max="2" step="0.1" value="0.8">
                        </div>
                        <div class="sl-row">
                            <div class="sl-hd"><span class="sl-label">Hemisphere</span><span class="sl-val" id="hemisphere-intensity-value">0.6</span></div>
                            <input type="range" id="hemisphere-intensity" min="0" max="2" step="0.1" value="0.6">
                        </div>
                        <div class="sl-row">
                            <div class="sl-hd"><span class="sl-label">Directional 1</span><span class="sl-val" id="directional1-intensity-value">1.5</span></div>
                            <input type="range" id="directional1-intensity" min="0" max="3" step="0.1" value="1.5">
                        </div>
                        <div class="sl-row">
                            <div class="sl-hd"><span class="sl-label">Directional 2</span><span class="sl-val" id="directional2-intensity-value">0.5</span></div>
                            <input type="range" id="directional2-intensity" min="0" max="3" step="0.1" value="0.5">
                        </div>
                        <div class="cb-row mt4">
                            <input type="checkbox" id="toggle-shadows" />
                            <label for="toggle-shadows">Enable Shadows</label>
                        </div>
                        <div class="sl-row mt4" id="shadow-opacity-group" style="display:none;">
                            <div class="sl-hd"><span class="sl-label">Shadow Opacity</span><span class="sl-val" id="shadow-opacity-value">0.3</span></div>
                            <input type="range" id="shadow-opacity" min="0.05" max="1" step="0.05" value="0.3">
                        </div>
                    </div>
                </div>

                <!-- Tone Mapping -->
                <div class="prop-section">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Tone Mapping</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <select class="prop-select mb4" id="tone-mapping-select">
                            <option value="None" selected>None</option>
                            <option value="Linear">Linear</option>
                            <option value="Reinhard">Reinhard</option>
                            <option value="Cineon">Cineon</option>
                            <option value="ACESFilmic">ACES Filmic</option>
                            <option value="AgX">AgX</option>
                        </select>
                        <div class="sl-row">
                            <div class="sl-hd"><span class="sl-label">Exposure</span><span class="sl-val" id="tone-mapping-exposure-value">1.0</span></div>
                            <input type="range" id="tone-mapping-exposure" min="0.1" max="3" step="0.1" value="1">
                        </div>
                    </div>
                </div>

                <!-- Environment (IBL) -->
                <div class="prop-section">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Environment (IBL)</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <select class="prop-select mb4" id="env-map-select">
                            <option value="">None</option>
                            <option value="preset:0">Outdoor</option>
                            <option value="preset:1">Studio</option>
                            <option value="preset:2">Sunset</option>
                        </select>
                        <div class="prop-btn-row mb4">
                            <label for="hdr-file-input" class="prop-btn" style="font-size:10px; cursor:pointer; margin-bottom:0;">HDR File</label>
                            <button class="prop-btn" id="btn-load-hdr-url" style="font-size:10px;">HDR URL</button>
                        </div>
                        <input type="file" id="hdr-file-input" accept=".hdr" style="display:none" />
                        <span id="hdr-filename" class="prop-hint" style="display:none;"></span>
                        <div class="cb-row mt4">
                            <input type="checkbox" id="toggle-env-background" />
                            <label for="toggle-env-background">Show as Background</label>
                        </div>
                    </div>
                </div>

            </div>
```

**Step 2: Remove the Default View tab from metadata**

In `src/editor/index.html`, remove the `<option value="viewer">Default View</option>` line (~line 1202) from the `edit-category-select` dropdown.

Then remove the entire `<div class="edit-tab-content" id="edit-tab-viewer">` block (lines 1791-1916).

**Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat: create View Settings pane, remove Scene pane and Default View tab"
```

---

### Task 3: Update TOOL_PANE_MAP and keyboard shortcuts

**Files:**
- Modify: `src/modules/ui-controller.ts:201-213`
- Modify: `src/modules/event-wiring.ts:738`

**Step 1: Update TOOL_PANE_MAP**

In `src/modules/ui-controller.ts`, replace the `scene` entry with `viewsettings`:

```typescript
const TOOL_PANE_MAP: Record<string, { pane: string; title: string }> = {
    viewsettings: { pane: 'pane-view-settings', title: 'View Settings' },
    assets:       { pane: 'pane-assets',       title: 'Assets' },
    transform:    { pane: 'pane-transform',    title: 'Transform' },
    annotate:     { pane: 'pane-annotate',     title: 'Annotations' },
    crosssection: { pane: 'pane-crosssection', title: 'Cross-Section' },
    measure:      { pane: 'pane-measure',      title: 'Measurements' },
    capture:      { pane: 'pane-capture',      title: 'Screenshots' },
    walkthrough:  { pane: 'pane-walkthrough',  title: 'Walkthrough' },
    metadata:     { pane: 'pane-metadata',     title: 'Metadata' },
    export:       { pane: 'pane-export',       title: 'Export' },
    library:      { pane: 'pane-library',      title: 'Library' },
};
```

**Step 2: Update keyboard shortcuts in event-wiring.ts**

In `src/modules/event-wiring.ts`, find the keyboard shortcut handler. Replace:
```typescript
case 's': activateTool('scene'); activatedTool = 'scene'; break;
```
with:
```typescript
case 'v': activateTool('viewsettings'); activatedTool = 'viewsettings'; break;
```

**Step 3: Commit**

```bash
git add src/modules/ui-controller.ts src/modules/event-wiring.ts
git commit -m "feat: update TOOL_PANE_MAP and keyboard shortcut for View Settings"
```

---

### Task 4: Remove `viewer` from metadata-profile.ts

**Files:**
- Modify: `src/modules/metadata-profile.ts:30`

**Step 1: Remove the viewer entry**

In `src/modules/metadata-profile.ts`, remove the line:
```typescript
    viewer:       'basic',
```

**Step 2: Commit**

```bash
git add src/modules/metadata-profile.ts
git commit -m "refactor: remove viewer tab from metadata profile tiers"
```

---

### Task 5: Verify build and test

**Step 1: Run the build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

**Step 2: Run tests**

```bash
npm test
```

Expected: All existing tests pass (no test changes needed — element IDs are preserved).

**Step 3: Run lint**

```bash
npm run lint
```

Expected: 0 errors.

**Step 4: Manual verification**

Open `npm run dev` and verify:
1. Tool rail shows "View Settings" button between Capture and Metadata
2. Clicking it opens the View Settings pane with archived sections (accent border) and editor preview sections
3. `V` key activates the View Settings pane
4. `S` key no longer activates anything (Scene button is gone)
5. Metadata edit mode no longer shows "Default View" in the category dropdown
6. Background swatches work, per-asset overrides work, camera save/clear works
7. Lighting sliders, tone mapping, environment IBL all function correctly
8. All archived sections show the "archived" tag badge

**Step 5: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: address issues found during View Settings verification"
```
