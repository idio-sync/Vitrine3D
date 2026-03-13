# PASS Viewer Phase 4: Professional Polish

**Date:** 2026-03-10
**Scope:** Industrial theme — coordinate readout, orthographic view presets, view cube, selection highlighting, normals visualization, screenshot with annotations
**Complexity:** MEDIUM-HIGH (6 independent features; prioritize 1–3)

---

## Context

The industrial theme (`src/themes/industrial/layout.js`) is a ~2100-line vanilla JS module that builds all UI programmatically. It already has:

- A status bar (`_statusBar`) with `ind-status-fps`, `ind-status-vertices`, `ind-status-faces` fields and a right-aligned `ind-status-measure` span
- A View menu with `setCameraPreset(axis)` (Front/Back/Left/Right/Top/Bottom) and `toggleOrthographic()` which creates a `THREE.OrthographicCamera` and swaps it onto `sm.camera` / `controls.object`
- A `doScreenshot()` function that calls `sm.render()` then `renderer.domElement.toBlob()`
- `THREE.Box3Helper` already in use (`_bboxHelper`), confirming THREE helpers are available as globals
- A raycaster pattern already used by annotation and measurement systems

Features 4–6 (selection highlighting, normals visualization, screenshot+annotations) are independent nice-to-haves that can be dropped if scope tightens.

---

## Work Objectives

1. Add live XYZ coordinate readout in the status bar (mousemove + raycast).
2. Add Top / Front / Right / ISO one-click preset buttons to the View menu (reuse `setCameraPreset` + `toggleOrthographic`).
3. Add a view cube overlay (small canvas in viewport corner, orientation indicator, clickable faces for view presets).
4. *(Nice-to-have)* Add face selection highlighting with face index + normal readout in the status bar.
5. *(Nice-to-have)* Add normals visualization toggle (face normals via `THREE.ArrowHelper`, vertex normals via `THREE.VertexNormalsHelper`).
6. *(Nice-to-have)* Upgrade `doScreenshot` to composite visible annotation markers from the DOM onto the canvas capture.

---

## Guardrails

**Must Have**
- No new npm dependencies — use Three.js built-ins and browser APIs only.
- All new state variables declared at module scope alongside existing ones and reset in `teardown()`.
- New mousemove handler registered in `setup()`, cleaned up in `teardown()` with the existing event listener teardown pattern.
- Coordinate readout and view preset buttons must not interfere with existing `ind-status-measure` measurement display or the existing Front/Back/Left/Right/Top/Bottom View menu items.
- View cube must use a separate `<canvas>` element (not the main renderer canvas) and must not interfere with OrbitControls on the main viewport.
- Build passes (`npm run build`) with zero TypeScript/ESLint errors before and after.

**Must NOT Have**
- Do not modify `kiosk-main.ts` or `scene-manager.ts` — all changes stay in `layout.js` and `layout.css`.
- Do not remove or rename existing View menu items (`setCameraPreset`, `toggleOrthographic`, `Show Orbit Guide`).
- Do not add a TypeScript file — layout.js is intentionally vanilla JS.
- Do not add any `import` statements — the module receives all deps via the `deps` object and uses `window.THREE` / `_deps.THREE`.

---

## Task Flow

### Step 1 — Coordinate readout in status bar

Add a live "X: 0.000  Y: 0.000  Z: 0.000" readout to the right side of the status bar that updates on mousemove when the ray hits a scene object.

**Implementation:**

In `createStatusBar(manifest)`, insert a new span before `ind-status-measure`:

```js
var coordField = createEl('span', 'ind-status-field ind-status-coords');
coordField.id = 'ind-status-coords';
coordField.textContent = 'X: —  Y: —  Z: —';
bar.appendChild(coordField);
bar.appendChild(createEl('span', 'ind-status-sep', '|'));
```

Add module-scope state:

```js
var _coordRaycaster = null;
var _coordMouseMoveHandler = null;
```

Add `startCoordReadout()` called from `setup()` after deps are stored:

```js
function startCoordReadout() {
    var THREE = (_deps && _deps.THREE) || window.THREE;
    if (!THREE) return;
    _coordRaycaster = new THREE.Raycaster();
    var canvas = _deps.sceneManager.renderer.domElement;
    _coordMouseMoveHandler = function(e) {
        var rect = canvas.getBoundingClientRect();
        var nx = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
        var ny = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
        _coordRaycaster.setFromCamera({ x: nx, y: ny }, _deps.sceneManager.camera);
        var targets = [_deps.modelGroup, _deps.pointcloudGroup].filter(Boolean);
        var hits = _coordRaycaster.intersectObjects(targets, true);
        var el = document.getElementById('ind-status-coords');
        if (!el) return;
        if (hits.length > 0) {
            var p = hits[0].point;
            el.textContent = 'X: ' + p.x.toFixed(3) + '  Y: ' + p.y.toFixed(3) + '  Z: ' + p.z.toFixed(3);
        } else {
            el.textContent = 'X: —  Y: —  Z: —';
        }
    };
    canvas.addEventListener('mousemove', _coordMouseMoveHandler);
}
```

In `teardown()`, after existing cleanup: `if (_coordMouseMoveHandler && _deps && _deps.sceneManager) { _deps.sceneManager.renderer.domElement.removeEventListener('mousemove', _coordMouseMoveHandler); _coordMouseMoveHandler = null; }`

**Acceptance criteria:**
- Moving the cursor over a loaded mesh updates the XYZ display in the status bar.
- Moving off the mesh shows dashes.
- No effect when no model is loaded.
- `teardown()` removes the listener without errors.

---

### Step 2 — Orthographic view preset buttons in View menu

Extend `buildViewMenu(dropdown)` to add four preset items that combine a camera position with orthographic mode. These sit below the existing separator after `Toggle Orthographic`.

**Implementation:**

Add a helper `applyViewPreset(axis)` that:
1. Calls `setCameraPreset(axis)` to position the camera.
2. If `_cameraMode !== 'orthographic'`, calls `toggleOrthographic()` to switch to ortho.

Add items to `buildViewMenu` after the `Toggle Orthographic` item:

```js
dropdown.appendChild(ddSep());
[
    ['Top (Ortho)',   '+y'],
    ['Front (Ortho)', '+z'],
    ['Right (Ortho)', '-x'],
    ['ISO',           null]   // ISO uses perspective; just resets to 3/4 angle
].forEach(function(p) {
    dropdown.appendChild(ddItem(p[0], '', function() {
        if (p[1]) {
            applyViewPreset(p[1]);
        } else {
            // ISO: switch back to perspective and position at 3/4 angle
            if (_cameraMode === 'orthographic') toggleOrthographic();
            setIsoView();
        }
    }));
});
```

`setIsoView()` positions the camera at equal distance on all three axes from the orbit target (classic isometric angle approximation):

```js
function setIsoView() {
    if (!_deps || !_deps.sceneManager) return;
    var camera = _deps.sceneManager.camera;
    var controls = _deps.sceneManager.controls;
    var target = controls.target;
    var dist = camera.position.distanceTo(target);
    var d = dist / Math.sqrt(3);
    camera.position.set(target.x + d, target.y + d, target.z + d);
    camera.lookAt(target);
    if (controls.update) controls.update();
}
```

**Acceptance criteria:**
- "Top (Ortho)" positions camera directly above and activates orthographic mode.
- "Front (Ortho)" positions camera on the +Z axis and activates orthographic mode.
- "Right (Ortho)" positions camera on the -X axis and activates orthographic mode.
- "ISO" positions camera at the 3/4 diagonal angle in perspective mode.
- Switching between presets while already in ortho mode does not double-toggle.
- Existing Front/Back/Left/Right/Top/Bottom items still work as before.

---

### Step 3 — View cube overlay

A small (120×120px) canvas in the bottom-right corner of the viewport showing a colored labeled box that mirrors the main camera orientation. Clicking a face triggers the corresponding view preset.

**Implementation approach — minimal Three.js sub-scene:**

Add module-scope state:

```js
var _viewCubeCanvas = null;
var _viewCubeRenderer = null;
var _viewCubeScene = null;
var _viewCubeCamera = null;
var _viewCubeRafId = null;
var _viewCubeClickHandler = null;
```

Add `createViewCube()` called from `setup()`:

```js
function createViewCube() {
    var THREE = (_deps && _deps.THREE) || window.THREE;
    if (!THREE) return;

    // Canvas overlay element
    _viewCubeCanvas = document.createElement('canvas');
    _viewCubeCanvas.width = 120;
    _viewCubeCanvas.height = 120;
    _viewCubeCanvas.style.cssText = 'position:fixed;bottom:32px;right:8px;width:120px;height:120px;z-index:50;cursor:pointer;border-radius:4px;';
    document.body.appendChild(_viewCubeCanvas);

    // Dedicated WebGL renderer for the cube (shares no context with main renderer)
    _viewCubeRenderer = new THREE.WebGLRenderer({ canvas: _viewCubeCanvas, alpha: true, antialias: true });
    _viewCubeRenderer.setSize(120, 120);
    _viewCubeRenderer.setClearColor(0x000000, 0);

    // Scene: a BoxGeometry with EdgesGeometry + face labels as colored planes
    _viewCubeScene = new THREE.Scene();
    _viewCubeCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    _viewCubeCamera.position.set(0, 0, 3);

    // Wireframe box
    var boxGeo = new THREE.BoxGeometry(1, 1, 1);
    var edges = new THREE.EdgesGeometry(boxGeo);
    var lineMat = new THREE.LineBasicMaterial({ color: 0x888888 });
    _viewCubeScene.add(new THREE.LineSegments(edges, lineMat));

    // Colored face planes with canvas-rendered labels (Top/Front/Right etc.)
    var faceData = [
        { label: 'RIGHT', color: 0xcc4444, dir: [1,0,0],  rot: [0, -Math.PI/2, 0] },
        { label: 'LEFT',  color: 0xcc4444, dir: [-1,0,0], rot: [0,  Math.PI/2, 0] },
        { label: 'TOP',   color: 0x44cc44, dir: [0,1,0],  rot: [-Math.PI/2, 0, 0] },
        { label: 'BTM',   color: 0x44cc44, dir: [0,-1,0], rot: [ Math.PI/2, 0, 0] },
        { label: 'FRONT', color: 0x4488cc, dir: [0,0,1],  rot: [0, 0, 0] },
        { label: 'BACK',  color: 0x4488cc, dir: [0,0,-1], rot: [0, Math.PI, 0] }
    ];
    faceData.forEach(function(f) {
        var planeGeo = new THREE.PlaneGeometry(0.9, 0.9);
        // Simple canvas texture with text label
        var tc = document.createElement('canvas');
        tc.width = 64; tc.height = 64;
        var ctx2d = tc.getContext('2d');
        ctx2d.fillStyle = '#' + f.color.toString(16).padStart(6,'0') + '44';
        ctx2d.fillRect(0, 0, 64, 64);
        ctx2d.fillStyle = '#ffffff';
        ctx2d.font = 'bold 11px sans-serif';
        ctx2d.textAlign = 'center';
        ctx2d.textBaseline = 'middle';
        ctx2d.fillText(f.label, 32, 32);
        var tex = new THREE.CanvasTexture(tc);
        var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
        var mesh = new THREE.Mesh(planeGeo, mat);
        mesh.position.set(f.dir[0]*0.5, f.dir[1]*0.5, f.dir[2]*0.5);
        mesh.rotation.set(f.rot[0], f.rot[1], f.rot[2]);
        mesh.userData.viewPreset = f.label; // for click detection
        _viewCubeScene.add(mesh);
    });

    // Animate: mirror main camera quaternion
    function animateCube() {
        _viewCubeRafId = requestAnimationFrame(animateCube);
        var mainCam = _deps && _deps.sceneManager && _deps.sceneManager.camera;
        if (mainCam) {
            _viewCubeCamera.quaternion.copy(mainCam.quaternion);
        }
        _viewCubeRenderer.render(_viewCubeScene, _viewCubeCamera);
    }
    animateCube();

    // Click: raycast against face planes to trigger view preset
    var cubeRaycaster = new THREE.Raycaster();
    _viewCubeClickHandler = function(e) {
        var rect = _viewCubeCanvas.getBoundingClientRect();
        var nx = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
        var ny = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
        cubeRaycaster.setFromCamera({ x: nx, y: ny }, _viewCubeCamera);
        var hits = cubeRaycaster.intersectObjects(_viewCubeScene.children, false);
        if (hits.length > 0 && hits[0].object.userData.viewPreset) {
            var label = hits[0].object.userData.viewPreset;
            var presetMap = { 'TOP': '+y', 'BTM': '-y', 'FRONT': '+z', 'BACK': '-z', 'RIGHT': '-x', 'LEFT': '+x' };
            var axis = presetMap[label];
            if (axis) applyViewPreset(axis);
        }
    };
    _viewCubeCanvas.addEventListener('click', _viewCubeClickHandler);
}
```

In `teardown()`, dispose the view cube renderer and remove the canvas:

```js
if (_viewCubeRafId) { cancelAnimationFrame(_viewCubeRafId); _viewCubeRafId = null; }
if (_viewCubeRenderer) { _viewCubeRenderer.dispose(); _viewCubeRenderer = null; }
if (_viewCubeCanvas && _viewCubeCanvas.parentNode) { _viewCubeCanvas.parentNode.removeChild(_viewCubeCanvas); _viewCubeCanvas = null; }
```

Add CSS in `layout.css`:

```css
/* View cube canvas is positioned via inline style; no extra rules needed unless theme needs it */
```

**Acceptance criteria:**
- A 120×120px cube appears in the bottom-right of the viewport.
- The cube rotates to mirror the main camera orientation in real time.
- Clicking a face triggers `applyViewPreset` for the corresponding axis.
- The cube canvas is removed on `teardown()` without WebGL context leaks.
- The cube does not capture scroll or drag events on the main canvas (it is a sibling element, not overlapping the renderer canvas center).

---

### Step 4 — Face selection highlighting *(nice-to-have)*

Add a click handler on the main renderer canvas. On click, raycast against `modelGroup`. If a face is hit:
1. Apply a highlight material to the hit mesh (store original material, restore on next click or Escape).
2. Show face index and surface normal in the status bar (reuse or extend `ind-status-measure`).

**Module-scope state:**
```js
var _selectionHighlight = null;   // { mesh, originalMaterial }
var _selectionClickHandler = null;
```

**Implementation notes:**
- Use a `MeshBasicMaterial` with `color: 0xffaa00, transparent: true, opacity: 0.4` as the highlight.
- `hits[0].face.normal` gives the local-space normal; transform with `hits[0].object.normalMatrix` for world-space.
- Display: `Face: 1234  N: (0.00, 1.00, 0.00)` in the `ind-status-measure` span.
- Clear selection on Escape (add to existing `_keydownHandler`).

**Acceptance criteria:**
- Clicking a mesh face highlights that face in orange.
- Status bar shows the face index and surface normal.
- Clicking a different face switches highlight.
- Escape or clicking empty space clears the highlight and restores the original material.
- No effect when modelGroup is empty.

---

### Step 5 — Normals visualization toggle *(nice-to-have)*

Add a "Show Normals" item to the Render menu (or Tools menu) that toggles face-normal arrows on the active mesh using `THREE.VertexNormalsHelper`.

**Module-scope state:**
```js
var _normalsHelpers = [];   // array of VertexNormalsHelper instances added to scene
```

**Implementation notes:**
- On toggle ON: traverse `modelGroup`, for each `Mesh` create `new THREE.VertexNormalsHelper(mesh, 0.05, 0x00ff00)` and add to `_deps.sceneManager.scene`.
- On toggle OFF: call `.dispose()` on each helper and remove from scene.
- `THREE.VertexNormalsHelper` is in `three/addons/helpers/VertexNormalsHelper.js` — not available as a plain `THREE.VertexNormalsHelper` global. Use `THREE.ArrowHelper` instances per-face as a fallback (sample every Nth face to keep count manageable).
- If using `ArrowHelper` fallback: sample faces at 1-in-10 density, arrow length 0.05 units, color `0x00ff00`.
- Add a "Show Normals" item to the Render menu dropdown with a `checked` class toggle.

**Acceptance criteria:**
- Toggling "Show Normals" on adds green normal indicators on the mesh.
- Toggling off removes them completely.
- No performance degradation on meshes under 100K faces (arrow count capped at 5000).
- Menu item shows active state.

---

### Step 6 — Screenshot with annotations *(nice-to-have)*

Upgrade `doScreenshot()` to composite visible annotation DOM markers onto the canvas capture using the 2D Canvas API.

**Implementation approach:**

After `sm.render(...)` and before calling `toBlob`, draw annotation markers onto a 2D canvas overlay:

```js
function doScreenshot() {
    var sm = _deps && _deps.sceneManager;
    if (!sm || !sm.renderer) return;
    var renderer = sm.renderer;
    var mode = (_deps.state && _deps.state.displayMode) || 'model';
    sm.render(mode, _deps.sparkRenderer || null, _deps.modelGroup || null, _deps.pointcloudGroup || null, null);

    // Composite annotation markers
    var srcCanvas = renderer.domElement;
    var composite = document.createElement('canvas');
    composite.width = srcCanvas.width;
    composite.height = srcCanvas.height;
    var ctx = composite.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0);

    // Draw annotation markers from DOM
    var markers = document.querySelectorAll('.annotation-marker');
    var srcRect = srcCanvas.getBoundingClientRect();
    var scaleX = srcCanvas.width  / srcRect.width;
    var scaleY = srcCanvas.height / srcRect.height;
    markers.forEach(function(marker) {
        if (marker.style.display === 'none' || marker.classList.contains('hidden')) return;
        var mr = marker.getBoundingClientRect();
        var cx = (mr.left + mr.width  / 2 - srcRect.left) * scaleX;
        var cy = (mr.top  + mr.height / 2 - srcRect.top)  * scaleY;
        var r  = (mr.width / 2) * scaleX;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 140, 0, 0.85)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Label
        var label = marker.textContent && marker.textContent.trim();
        if (label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold ' + Math.round(r * 1.2) + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, cx, cy);
        }
    });

    composite.toBlob(function(blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'screenshot-' + Date.now() + '.png';
        a.click();
        setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }, 'image/png');
}
```

**Acceptance criteria:**
- Screenshot with no annotations visible downloads an image identical to current behavior.
- With annotation markers visible, the downloaded PNG includes orange circle markers at the correct screen positions.
- Marker positions are pixel-accurate (within 2px of their DOM positions when viewed at 1:1 zoom).
- Hidden markers (display:none or `.hidden` class) are not included.

---

### Step 7 — Build verification

Run the full build and test suite to confirm no regressions.

```bash
npm run build
npm test
```

**Acceptance criteria:**
- `npm run build` exits 0 — both kiosk and editor bundles compile.
- `npm test` exits 0 (or matches baseline failure count before this change).
- No ESLint errors (`npm run lint` exits 0).

---

## File Inventory

| File | Change type |
|------|-------------|
| `src/themes/industrial/layout.js` | Add `startCoordReadout()`, extend `createStatusBar()`, extend `buildViewMenu()`, add `setIsoView()`, `applyViewPreset()`, add `createViewCube()`, add `_selectionClickHandler`, add normals toggle, upgrade `doScreenshot()`, extend `teardown()` |
| `src/themes/industrial/layout.css` | Minor additions if needed for status bar coord field width |

No other files require changes. All Three.js objects used (`OrthographicCamera`, `BoxGeometry`, `EdgesGeometry`, `LineSegments`, `PlaneGeometry`, `MeshBasicMaterial`, `CanvasTexture`, `Raycaster`, `ArrowHelper`, `Box3Helper`) are already in the Three.js 0.183.2 core bundle loaded by the kiosk.

---

## Priority Order

Implement in this order; stop after Step 3 if scope is tight:

| Priority | Feature | Steps |
|----------|---------|-------|
| P0 | Coordinate readout | Step 1 |
| P0 | View presets (ortho) | Step 2 |
| P1 | View cube | Step 3 |
| P2 | Face selection | Step 4 |
| P2 | Normals viz | Step 5 |
| P2 | Screenshot + annotations | Step 6 |

---

## Success Criteria

- Cursor over a mesh shows live XYZ coordinates in the status bar.
- Top / Front / Right / ISO buttons appear in the View menu and switch camera correctly.
- A view cube in the bottom-right corner mirrors camera orientation and is clickable.
- `npm run build` and `npm test` pass cleanly.
- No new npm dependencies added.
- No modifications to `kiosk-main.ts` or `scene-manager.ts`.
