# PASS Viewer Phase 2 — Cross-Section Controls, Properties Panel, Layers Tree

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the PASS Viewer industrial theme with three information-panel upgrades: full cross-section controls (position slider, mode toggle, reset), a rich Properties panel (geometry stats, texture info, file info, scan metadata), and a MeshLab-style Layers tree with per-layer visibility toggles and sub-mesh expansion for GLB files.

**Architecture:** All changes are confined to `src/themes/industrial/layout.js` (vanilla JS, ~1830 lines). The cross-section backend (`src/modules/cross-section.ts`) already exposes every method needed — this phase is pure UI wiring. No new dependencies, no TypeScript files, no new modules.

**Tech Stack:** Vanilla JS (layout.js), Three.js geometry API for stats, existing `createEl` / `createPanelSection` / `buildSection` helpers already present in layout.js.

---

## Chunk 1: Cross-Section Controls (Section 2.1)

The `buildCrossSectionPanel` function (line 1285) currently creates axis buttons, a position slider, and a flip button. It is missing: the mode toggle (Translate / Rotate), a Reset button, and the slider does not read the live position when the active axis changes (it always starts at 50). This chunk completes the panel.

### Task 1: Mode toggle and Reset button

**Files:**
- Modify: `src/themes/industrial/layout.js:1285–1336` (`buildCrossSectionPanel`)

- [ ] **Step 1: Add a mode-toggle row below the position slider**

Inside `buildCrossSectionPanel`, after `body.appendChild(sliderRow)` (line 1331) and before the hint text (line 1333), insert:

```js
    // Mode toggle row
    var modeRow = createEl('div', 'ind-xsec-mode-row');
    var modeLabel = createEl('span', 'ind-xsec-label', 'Gizmo');
    modeRow.appendChild(modeLabel);

    var translateBtn = createEl('button', 'ind-xsec-mode-btn active', 'Translate');
    translateBtn.setAttribute('data-mode', 'translate');
    var rotateBtn = createEl('button', 'ind-xsec-mode-btn', 'Rotate');
    rotateBtn.setAttribute('data-mode', 'rotate');

    function setModeActive(mode) {
        translateBtn.classList.toggle('active', mode === 'translate');
        rotateBtn.classList.toggle('active', mode === 'rotate');
        if (_deps && _deps.crossSection) _deps.crossSection.setMode(mode);
    }
    translateBtn.addEventListener('click', function() { setModeActive('translate'); });
    rotateBtn.addEventListener('click', function() { setModeActive('rotate'); });

    modeRow.appendChild(translateBtn);
    modeRow.appendChild(rotateBtn);
    body.appendChild(modeRow);
```

- [ ] **Step 2: Add a Reset button row**

After `body.appendChild(modeRow)`, insert:

```js
    // Reset row
    var resetRow = createEl('div', 'ind-xsec-reset-row');
    var resetBtn = createEl('button', 'ind-tool-btn', 'Reset Plane');
    resetBtn.setAttribute('data-tooltip', 'Re-center plane on scene bounding box');
    resetBtn.addEventListener('click', function() {
        if (!_deps || !_deps.crossSection) return;
        var bbox = _deps.crossSection.getBBox();
        var center = new THREE.Vector3();
        bbox.getCenter(center);
        _deps.crossSection.reset(center);
        slider.value = '50';
    });
    resetRow.appendChild(resetBtn);
    body.appendChild(resetRow);
```

Note: `THREE` is available at module scope in layout.js via the `deps.THREE` reference or global `THREE`. Check which is available; use `_deps.THREE || window.THREE`.

- [ ] **Step 3: Manual test — mode toggle and reset**

Open industrial theme, load a mesh, press `1` to activate slice tool:
- "Translate" button highlighted. Drag the gizmo — translates along axis.
- Click "Rotate" — highlighted. Drag gizmo — rotates the plane.
- Click "Translate" again — returns to translate mode.
- Click "Reset Plane" — plane snaps to scene center. Slider returns to 50.

- [ ] **Step 4: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): add mode toggle and reset button to cross-section panel

Translate/Rotate gizmo mode toggle and a Reset Plane button that
re-centers the cutting plane on the scene bounding box."
```

---

### Task 2: Sync slider to live axis position

The position slider starts at 50 regardless of which axis is active. When the user clicks a different axis button, the slider should update to reflect the actual position along that axis.

**Files:**
- Modify: `src/themes/industrial/layout.js:1293–1310` (axis button click handler inside `buildCrossSectionPanel`)

- [ ] **Step 1: Read live position when axis changes**

The existing axis button click handler (line 1296) currently only calls `setAxis`. Extend it to also read the current position and update the slider:

```js
    btn.addEventListener('click', function() {
        axisRow.querySelectorAll('.ind-xsec-axis-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var a = axis.toLowerCase();
        if (_deps && _deps.crossSection) {
            _deps.crossSection.setAxis(a);
            // Read live position after axis snap and sync slider
            var t = _deps.crossSection.getPositionAlongAxis(a);
            slider.value = String(Math.round(t * 100));
        }
    });
```

- [ ] **Step 2: Manual test — slider sync**

Open industrial theme, load a mesh, press `1`. Move the plane to ~25% on Y. Click "X" axis button — slider jumps to 50 (X default). Click "Y" again — slider returns to ~25. Acceptable tolerance: ±2 slider units.

- [ ] **Step 3: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "fix(industrial): sync cross-section slider when switching axis

Reads getPositionAlongAxis after setAxis so the slider reflects the
actual plane position on the newly selected axis."
```

---

## Chunk 2: Properties & Mesh Info Panel (Section 2.2)

The existing `buildPropertiesSection` (line 1214) shows title, creator, date, format, description, and tags from the manifest. This chunk adds a Geometry sub-section (vertices, faces, bounding box), a Texture sub-section (resolution, format, count), a File sub-section (file size, format, compression), and appends scan metadata fields (accuracy, device, operator, scan date) when present in the manifest.

### Task 3: Geometry stats sub-section

**Files:**
- Modify: `src/themes/industrial/layout.js:1214–1255` (`buildPropertiesSection`)

- [ ] **Step 1: Add `addSection` helper and geometry stats block**

At the top of `buildPropertiesSection`, after the `addRow` inner function, add:

```js
    function addSection(title) {
        body.appendChild(createEl('div', 'ind-prop-sep'));
        body.appendChild(createEl('div', 'ind-prop-section-title', title));
    }

    // --- Geometry ---
    var meshGroup = _deps && _deps.modelGroup;
    var verts = countVertices(meshGroup);
    var faces = countFaces(meshGroup);
    if (verts > 0 || faces > 0) {
        addSection('Geometry');
        if (verts > 0) addRow('Vertices', formatNumber(verts));
        if (faces > 0) addRow('Faces', formatNumber(faces));

        // Bounding box dimensions
        var bbox = new (_deps && _deps.THREE ? _deps.THREE.Box3 : THREE.Box3)();
        meshGroup.traverse(function(child) {
            if (child.isMesh && child.geometry) {
                child.geometry.computeBoundingBox();
                bbox.expandByObject(child);
            }
        });
        if (!bbox.isEmpty()) {
            var size = new (_deps && _deps.THREE ? _deps.THREE.Vector3 : THREE.Vector3)();
            bbox.getSize(size);
            var units = (manifest && manifest.metadata && manifest.metadata.units) || 'm';
            addRow('Width',  size.x.toFixed(3) + ' ' + units);
            addRow('Height', size.y.toFixed(3) + ' ' + units);
            addRow('Depth',  size.z.toFixed(3) + ' ' + units);
        }
    }
```

Insert this block immediately after the existing `addRow('Format', ...)` call and before the description block. Keep the existing project-info rows at the top.

- [ ] **Step 2: Manual test — geometry stats**

Load a GLB mesh in industrial theme, open info panel, expand "Project" section:
- Vertices and Faces rows appear with formatted numbers (e.g., "123,456").
- Width/Height/Depth rows appear in meters (or manifest units if set).
- Point cloud or splat-only load: rows do not appear.

- [ ] **Step 3: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): add geometry stats to Properties panel

Shows vertex count, face count, and bounding box dimensions (in
manifest units, defaulting to metres) when a mesh is loaded."
```

---

### Task 4: Texture and file info sub-sections

**Files:**
- Modify: `src/themes/industrial/layout.js:1214–1255` (`buildPropertiesSection`)

- [ ] **Step 1: Add texture info block**

After the geometry stats block (from Task 3), add:

```js
    // --- Texture ---
    var textures = [];
    if (meshGroup) {
        meshGroup.traverse(function(child) {
            if (child.isMesh && child.material) {
                var mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(function(mat) {
                    ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(function(slot) {
                        if (mat[slot] && mat[slot].image && textures.indexOf(mat[slot]) === -1) {
                            textures.push(mat[slot]);
                        }
                    });
                });
            }
        });
    }
    if (textures.length > 0) {
        addSection('Textures');
        addRow('Maps', String(textures.length));
        var firstImg = textures[0].image;
        if (firstImg && firstImg.width) {
            addRow('Resolution', firstImg.width + ' × ' + firstImg.height);
        }
        // Format from source URL or name
        var srcName = textures[0].name || (textures[0].image && textures[0].image.src) || '';
        var ext = srcName.split('.').pop().toUpperCase();
        if (ext === 'JPG' || ext === 'JPEG' || ext === 'PNG' || ext === 'WEBP' || ext === 'KTX2') {
            addRow('Format', ext === 'JPEG' ? 'JPG' : ext);
        }
    }
```

- [ ] **Step 2: Add file info block from manifest assets**

After the texture block, add:

```js
    // --- File Info ---
    var meshAsset = manifest && manifest.assets && manifest.assets.find(function(a) {
        return a.role === 'mesh' || a.role === 'cad';
    });
    if (meshAsset) {
        addSection('File');
        if (meshAsset.size) addRow('Size', formatFileSize(meshAsset.size));
        var filename = meshAsset.filename || meshAsset.key || '';
        var extMatch = filename.match(/\.(\w+)$/);
        if (extMatch) addRow('Format', extMatch[1].toUpperCase());
        // Compression type — GLB files may carry Draco/Meshopt in extras
        var compression = (meshAsset.extras && meshAsset.extras.compression) || null;
        if (compression) addRow('Compression', compression);
        var origName = meshAsset.original_filename || meshAsset.source_filename || null;
        if (origName) addRow('Source', origName.replace(/^.*[/\\]/, ''));
    }
```

- [ ] **Step 3: Add scan metadata block**

After the file info block, add:

```js
    // --- Scan Metadata ---
    var meta = manifest && manifest.metadata;
    var scanFields = [
        ['accuracy',  meta && (meta.accuracy || meta.scan_accuracy)],
        ['device',    meta && (meta.device || meta.scanner || meta.instrument)],
        ['operator',  meta && (meta.operator || meta.surveyor)],
        ['scan_date', meta && (meta.scan_date || meta.acquisition_date)]
    ];
    var hasScan = scanFields.some(function(f) { return !!f[1]; });
    if (hasScan) {
        addSection('Scan');
        if (scanFields[0][1]) addRow('Accuracy',  String(scanFields[0][1]));
        if (scanFields[1][1]) addRow('Device',    String(scanFields[1][1]));
        if (scanFields[2][1]) addRow('Operator',  String(scanFields[2][1]));
        if (scanFields[3][1]) addRow('Scan Date', String(scanFields[3][1]).slice(0, 10));
    }
```

- [ ] **Step 4: Manual test — texture and file info**

Load a GLB with textures:
- "Textures" section shows map count, resolution (e.g., "2048 × 2048"), format (JPG/PNG).
- "File" section shows size (e.g., "14.2 MB"), format (GLB), source filename.
- Load an archive with scan metadata in the manifest: "Scan" section appears with populated fields.
- Load a splat-only archive: texture and file sections absent (or file section shows splat asset info).

- [ ] **Step 5: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): add texture, file info, and scan metadata to Properties panel

Texture section shows map count, resolution, and format. File section
shows size, format, and source filename from manifest. Scan section
shows accuracy, device, operator, and scan date when present."
```

---

## Chunk 3: Layers Panel Tree (Section 2.3)

The existing `buildLayersSection` (line 1124) shows a flat list of assets from the manifest with badges, a splat budget slider for splats, and a size sub-line. This chunk upgrades it to a proper tree:

- Top-level entries per asset with an eye/visibility toggle for all types
- Expandable sub-mesh children for GLB assets (traverse `modelGroup.children`)
- Clicking a top-level entry selects it and refreshes the Properties panel to show that asset's data

### Task 5: Visibility toggles for all asset types

**Files:**
- Modify: `src/themes/industrial/layout.js:1124–1212` (`buildLayersSection`)

- [ ] **Step 1: Add visibility toggle to every layer item**

Replace the existing `item` assembly block (lines 1145–1206) with a unified approach that adds an eye toggle to all asset types. The flight path already has a checkbox (lines 1187–1196) — generalise this pattern.

For each asset, after creating `item`, `badge`, and `nameEl`, add:

```js
        // Eye toggle — works for all asset types
        var eyeBtn = createEl('button', 'ind-layer-eye active', '👁');
        eyeBtn.setAttribute('aria-label', 'Toggle visibility');
        eyeBtn.setAttribute('title', 'Toggle visibility');
        eyeBtn.style.cssText = 'margin-left:auto; background:none; border:none; cursor:pointer; padding:0 4px; font-size:14px; opacity:0.9;';
        eyeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var visible = eyeBtn.classList.toggle('active');
            setAssetVisible(role, asset, visible);
        });
        item.appendChild(eyeBtn);
```

Add a `setAssetVisible(role, asset, visible)` helper function near `buildLayersSection`:

```js
function setAssetVisible(role, asset, visible) {
    if (!_deps) return;
    if (role === 'splat' && _deps.sparkRenderer) {
        // Spark renderer visibility
        if (_deps.sparkRenderer.visible !== undefined) _deps.sparkRenderer.visible = visible;
    } else if (role === 'mesh' || role === 'cad') {
        if (_deps.modelGroup) _deps.modelGroup.visible = visible;
    } else if (role === 'pointcloud') {
        if (_deps.pointcloudGroup) _deps.pointcloudGroup.visible = visible;
    } else if (role === 'flightpath' && _deps.flightPathManager) {
        _deps.flightPathManager.setVisible(visible);
    }
}
```

Remove the existing flight-path-specific checkbox block (lines 1187–1196) since the unified eye toggle replaces it.

- [ ] **Step 2: Manual test — visibility toggles**

Load an archive with mesh + flight path. Eye buttons present on both rows. Click mesh eye — mesh disappears from scene. Click again — reappears. Flight path toggle still works. Splat eye hides/shows the splat renderer.

- [ ] **Step 3: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): add visibility eye toggle to all layer types

Unified eye button on every layer item replaces the flight-path-only
checkbox. Toggles visibility of the corresponding scene group or renderer."
```

---

### Task 6: Sub-mesh expansion for GLB assets

**Files:**
- Modify: `src/themes/industrial/layout.js:1124–1212` (`buildLayersSection`)

- [ ] **Step 1: Add expand/collapse toggle for mesh assets**

For assets with `role === 'mesh' || role === 'cad'` that have children in `_deps.modelGroup`, add an expand arrow to the item and a child list container:

```js
        if ((role === 'mesh' || role === 'cad') && _deps && _deps.modelGroup
                && _deps.modelGroup.children.length > 0) {

            var arrow = createEl('span', 'ind-layer-arrow', '▶');
            arrow.style.cssText = 'cursor:pointer; font-size:10px; margin-right:4px; transition:transform 0.15s;';
            item.insertBefore(arrow, badge);

            var childList = createEl('div', 'ind-layer-children');
            childList.style.display = 'none';
            childList.style.cssText = 'display:none; padding-left:20px;';

            var expanded = false;
            arrow.addEventListener('click', function(e) {
                e.stopPropagation();
                expanded = !expanded;
                childList.style.display = expanded ? '' : 'none';
                arrow.style.transform = expanded ? 'rotate(90deg)' : '';
                if (expanded && childList.childElementCount === 0) {
                    buildSubMeshList(childList, _deps.modelGroup);
                }
            });

            body.appendChild(item);
            body.appendChild(childList);
            added++;
            return; // skip the default body.appendChild(item) below
        }
```

Add the `buildSubMeshList` helper before `buildLayersSection`:

```js
function buildSubMeshList(container, group) {
    var found = 0;
    group.traverse(function(child) {
        if (!child.isMesh) return;
        var childItem = createEl('div', 'ind-layer-item ind-layer-child');
        var childBadge = createEl('span', 'ind-layer-badge ind-badge-mesh', 'M');
        var childName = child.name || ('mesh_' + found);
        var childNameEl = createEl('span', 'ind-layer-name', childName);

        var childEye = createEl('button', 'ind-layer-eye active', '👁');
        childEye.setAttribute('aria-label', 'Toggle visibility');
        childEye.style.cssText = 'margin-left:auto; background:none; border:none; cursor:pointer; padding:0 4px; font-size:13px;';
        childEye.addEventListener('click', function(e) {
            e.stopPropagation();
            child.visible = childEye.classList.toggle('active');
        });

        childItem.appendChild(childBadge);
        childItem.appendChild(childNameEl);
        childItem.appendChild(childEye);
        container.appendChild(childItem);
        found++;
    });
    if (found === 0) {
        container.appendChild(createEl('div', 'ind-panel-empty', 'No sub-meshes'));
    }
}
```

- [ ] **Step 2: Manual test — sub-mesh expansion**

Load a GLB with multiple meshes (e.g., a scene with separate body, wheels, glass objects):
- Mesh row shows a ▶ arrow.
- Click arrow — rotates to ▼, child list expands showing one sub-row per named mesh.
- Each sub-row has its own eye toggle. Click a sub-row eye — that object disappears from scene, others remain.
- Click ▼ arrow — collapses list.
- Second expand: list re-uses existing DOM (no re-build).

Load a single-mesh GLB: no arrow present on the row.

- [ ] **Step 3: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): expandable sub-mesh tree in Layers panel

Mesh and CAD assets with multiple children show a collapse arrow.
Expanding lists each named THREE.Mesh with an individual eye toggle."
```

---

### Task 7: Layer selection and Properties refresh

Clicking a top-level layer item should select it (highlight) and update the Properties panel to show that specific asset's data.

**Files:**
- Modify: `src/themes/industrial/layout.js:1124–1212` (`buildLayersSection`)
- Modify: `src/themes/industrial/layout.js:1214–1255` (`buildPropertiesSection`) — accept optional `selectedAsset` param

- [ ] **Step 1: Add click-to-select on layer items**

Track a module-scope selected asset key: add `var _selectedLayerKey = null;` near the other module-scope vars at the top of the file.

In `buildLayersSection`, after assembling `item`, add a click handler:

```js
        item.setAttribute('data-asset-key', asset.key || role);
        item.style.cursor = 'pointer';
        item.addEventListener('click', function() {
            // Deselect all
            body.querySelectorAll('.ind-layer-item').forEach(function(el) {
                el.classList.remove('selected');
            });
            item.classList.add('selected');
            _selectedLayerKey = asset.key || role;
            // Refresh properties panel for this asset
            if (_panel && _panel._projBody) {
                buildPropertiesSection(_panel._projBody, _manifest, asset);
            }
        });
```

- [ ] **Step 2: Update `buildPropertiesSection` to accept a selected asset**

Change the function signature:

```js
function buildPropertiesSection(body, manifest, selectedAsset) {
```

When `selectedAsset` is provided, the Geometry, Texture, and File sections should describe that specific asset rather than the whole scene. The project-info rows (title, creator, date) always come from the manifest regardless.

For the Geometry block: if `selectedAsset.role === 'splat'`, show a point budget row instead of vertices/faces. If `role === 'pointcloud'`, show point count from `_deps.pointcloudGroup` geometry. If `role === 'mesh' || role === 'cad'`, use `countVertices` / `countFaces` as before.

For the File block: use `selectedAsset` directly instead of `manifest.assets.find(...)`.

The additional logic is minimal — the existing blocks already handle per-role branching.

- [ ] **Step 3: Manual test — layer selection**

Load a multi-asset archive (mesh + flight path):
- Click the mesh row — row highlights, Properties panel shows geometry and file info for the mesh.
- Click the flight path row — highlight moves, Properties panel updates (no geometry rows, just file info for the flight path asset).
- No crash when clicking sub-mesh rows (they do not trigger Properties refresh).

- [ ] **Step 4: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): layer selection refreshes Properties panel

Clicking a layer item highlights it and rebuilds the Properties section
scoped to that asset. Project-level metadata rows are always shown."
```

---

## Chunk 4: CSS and Build Verification

### Task 8: CSS for new UI elements

**Files:**
- Modify: `src/themes/industrial/layout.css`

- [ ] **Step 1: Add styles for cross-section mode toggle and reset rows**

```css
/* Cross-section mode toggle */
.ind-xsec-mode-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 6px 0 0;
}
.ind-xsec-mode-btn {
    flex: 1;
    padding: 4px 0;
    background: var(--kiosk-panel-bg, #2a2a2a);
    border: 1px solid var(--kiosk-border, #444);
    color: var(--kiosk-text, #ccc);
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
}
.ind-xsec-mode-btn.active {
    background: var(--kiosk-accent, #3874CB);
    color: #fff;
    border-color: var(--kiosk-accent, #3874CB);
}
.ind-xsec-reset-row {
    margin: 6px 0 0;
}
.ind-xsec-reset-row .ind-tool-btn {
    width: 100%;
    font-size: 11px;
}
```

- [ ] **Step 2: Add styles for property section titles and sub-sections**

```css
/* Properties sub-section separator and title */
.ind-prop-section-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--kiosk-text-muted, #888);
    margin: 2px 0 4px;
}
```

- [ ] **Step 3: Add styles for layers tree children and selection**

```css
/* Layer tree */
.ind-layer-item.selected {
    background: rgba(56, 116, 203, 0.18);
    border-left: 2px solid var(--kiosk-accent, #3874CB);
}
.ind-layer-children {
    padding-left: 20px;
}
.ind-layer-child {
    opacity: 0.85;
    font-size: 11px;
}
.ind-layer-arrow {
    display: inline-block;
    width: 12px;
    font-size: 9px;
    color: var(--kiosk-text-muted, #888);
    transition: transform 0.15s;
    user-select: none;
}
.ind-layer-eye {
    opacity: 0.5;
    transition: opacity 0.15s;
}
.ind-layer-eye.active {
    opacity: 1;
}
```

- [ ] **Step 4: Commit CSS**

```bash
git add src/themes/industrial/layout.css
git commit -m "feat(industrial): CSS for cross-section mode toggle, property sub-sections, layer tree

Styles for Translate/Rotate toggle, Reset Plane button, property
section titles, layer selection highlight, child indentation, and
eye-toggle opacity states."
```

---

### Task 9: Build verification

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: 0 errors (warnings OK).

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all existing tests pass. Layout.js changes do not touch any tested modules (url-validation, theme-loader, archive-loader, flight-parsers, utilities, quality-tier).

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: build succeeds with no errors. Industrial theme is bundled in the kiosk output.

- [ ] **Step 4: Manual smoke test**

Open `http://localhost:8080/?kiosk=true&theme=industrial` and load a multi-mesh GLB archive:

1. Press `1` — cross-section activates.
   - Axis buttons X/Y/Z snap the plane normal.
   - Position slider moves the plane along the active axis.
   - Switching axis updates the slider to the live position.
   - Flip button reverses clip direction.
   - Click "Rotate" — gizmo switches to rotation mode. Click "Translate" — back to translate.
   - Click "Reset Plane" — plane re-centers, slider returns to 50.
   - Press `1` — deactivates, panel hidden.

2. Open info panel, expand "Project" section:
   - Geometry sub-section: Vertices, Faces, Width/Height/Depth.
   - Textures sub-section: Maps count, Resolution, Format.
   - File sub-section: Size, Format (GLB), Source filename.
   - If manifest has scan metadata: Scan sub-section with accuracy/device/operator/date.

3. Expand "Layers" section:
   - One top-level row per asset with eye toggle.
   - Mesh row has ▶ arrow. Click it — sub-meshes listed with individual eye toggles.
   - Click a top-level row — highlighted, Properties panel updates for that asset.
   - Eye toggle on mesh row hides entire modelGroup. Individual sub-mesh eye hides that object only.
