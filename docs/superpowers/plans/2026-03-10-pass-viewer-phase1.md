# PASS Viewer Phase 1 — Ship-Blocking Fixes

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all ship-blocking bugs and UI issues in the PASS Viewer industrial theme to make it functional for basic 3D model inspection.

**Architecture:** All changes are in the industrial layout module (`src/themes/industrial/layout.js`), kiosk bootstrap (`src/modules/kiosk-main.ts`), and minor fixes in core tool modules. The layout module is vanilla JS (not TypeScript). The core tool systems (cross-section, measurement, annotation) are in `src/modules/*.ts`.

**Tech Stack:** Vanilla JS (layout.js), TypeScript (kiosk-main.ts, tool modules), Three.js, Vite

---

## Chunk 1: Critical Bug Fixes

### Task 1: Fix cross-section clipping

The cross-section plane shows but doesn't clip the mesh. Root cause: `activateTool('slice')` in layout.js calls `crossSection.start()` but never calls `setLocalClippingEnabled(true)` on the renderer. The editorial theme (`src/themes/editorial/layout.js:1060`) and editor (`src/modules/event-wiring.ts:89`) both make this call. Same omission on deactivation.

**Files:**
- Modify: `src/themes/industrial/layout.js:183-200` (activateTool slice branch)
- Modify: `src/themes/industrial/layout.js:217-219` (deactivateTool slice branch)

- [ ] **Step 1: Add `setLocalClippingEnabled(true)` before `crossSection.start()` in `activateTool`**

In `src/themes/industrial/layout.js`, find the `activateTool` function's slice branch (line ~183). Add the `setLocalClippingEnabled` call as the first line inside the `if (_deps.crossSection)` block:

```js
    if (name === 'slice') {
        if (_deps.crossSection) {
            if (_deps.setLocalClippingEnabled) _deps.setLocalClippingEnabled(true);
            var center = { x: 0, y: 0, z: 0 };
```

The existing code continues unchanged from `var center = ...` through `_deps.crossSection.start(center);`.

- [ ] **Step 2: Add `setLocalClippingEnabled(false)` in `deactivateTool`**

In the `deactivateTool` function's slice branch (line ~217), add the disable call after `crossSection.stop()`:

```js
    if (name === 'slice') {
        if (_deps.crossSection) _deps.crossSection.stop();
        if (_deps.setLocalClippingEnabled) _deps.setLocalClippingEnabled(false);
        if (_panel && _panel._crossSectionEl) _panel._crossSectionEl.style.display = 'none';
    }
```

- [ ] **Step 3: Manual test**

Run `npm run dev`, open `http://localhost:8080/?kiosk=true&theme=industrial`, load a mesh file, press `1` to activate the slice tool. The mesh should be clipped by the blue plane. Drag the gizmo — clipping follows. Press `1` again — mesh fully visible. Press Escape — mesh fully visible.

- [ ] **Step 4: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "fix(industrial): enable renderer clipping when cross-section tool activates

The industrial layout called crossSection.start() but never called
setLocalClippingEnabled(true), so the clipping plane was visible but
did not actually clip meshes. Editorial and editor both made this call."
```

---

### Task 2: Fix measurement point placement

Measurement points appear offset from where the user clicks. The `event.target` check at `measurement-system.ts:146` (`if (event.target !== this.renderer.domElement) return;`) is the most likely cause — if any transparent DOM element sits between the user's click and the canvas, the target won't be the canvas and the click is silently ignored.

**Investigation note:** The trackball overlay and marker containers already have `pointer-events: none` in CSS (verified in `layout.css:215` and `styles.css:1608,1674`). The issue is likely a DOM element created by `layout.js` that sits over the canvas without `pointer-events: none`.

Additionally, the cross-section tool's plane mesh and cap meshes have no `.name` set, so they can't be filtered by the raycaster. If the slice tool is active while measuring, these invisible meshes could intercept rays.

**Files:**
- Modify: `src/modules/cross-section.ts:83,335` (name the plane and cap meshes)
- Modify: `src/modules/measurement-system.ts:155-167` (add cross-section to raycaster filter)
- Possibly modify: `src/modules/measurement-system.ts:146` (relax event.target check)
- Possibly modify: `src/themes/industrial/layout.js` (add pointer-events: none to any overlay)

- [ ] **Step 1: Name cross-section meshes for raycaster filtering**

In `src/modules/cross-section.ts`, after the plane mesh is created (line 83), add a name:

```ts
this._planeMesh = new THREE.Mesh(geo, mat);
this._planeMesh.name = 'crossSectionPlane';
this._planeMesh.renderOrder = 1;
```

In `_walkForCaps` (line 335), name cap meshes:

```ts
const capMesh = new THREE.Mesh(mesh.geometry, capMat);
capMesh.name = 'crossSectionCap';
capMesh.applyMatrix4(mesh.matrixWorld);
```

- [ ] **Step 2: Add cross-section objects to measurement raycaster filter**

In `src/modules/measurement-system.ts`, update the filter in `_onClickHandler` (line ~155):

```ts
const valid = intersects.filter((hit: any) => {
    let obj = hit.object;
    while (obj) {
        if (obj.name === 'annotationMarkers' ||
            obj.name === 'measurementLine' ||
            obj.name === 'crossSectionPlane' ||
            obj.name === 'crossSectionCap' ||
            obj.type === 'GridHelper' ||
            obj.type === 'AxesHelper') {
            return false;
        }
        obj = obj.parent;
    }
    return true;
});
```

Also apply the same filter update to `annotation-system.ts` `_onClickHandler` (line ~204) for consistency.

- [ ] **Step 3: Investigate and fix the event.target issue**

Run the dev server, open industrial theme, activate measure tool (`2`), open browser DevTools console. Click on the canvas and check what `event.target` is by temporarily adding a log:

In `measurement-system.ts` `_onClickHandler`, temporarily add at the top:
```ts
console.log('measure click target:', event.target, 'canvas:', this.renderer.domElement);
```

If `event.target` is NOT the canvas (e.g., it's an overlay div), there are two fix approaches:

**Approach A (preferred):** Find the offending element in layout.js and add `pointer-events: none`. Check all elements layout.js creates that are positioned over the viewport (drop zone, loading screen, any info panel overlay).

**Approach B (fallback):** Relax the target check to bounds-based:
```ts
// Replace: if (event.target !== this.renderer.domElement) return;
// With:
const canvasEl = this.renderer.domElement;
if (event.target !== canvasEl && !(canvasEl.contains(event.target as Node))) return;
```

Remove the temporary console.log after debugging.

- [ ] **Step 4: Manual test**

Load a mesh in industrial theme, press `2`, click two points on the mesh:
- Point A marker appears exactly at the click position on the model surface
- Point B marker appears at the second click
- Distance line connects them correctly
- Test with slice tool both active and inactive
- Test with trackball overlay visible and hidden

- [ ] **Step 5: Commit**

```bash
git add src/modules/cross-section.ts src/modules/measurement-system.ts src/modules/annotation-system.ts
git commit -m "fix: name cross-section meshes and filter from measurement/annotation raycasts

Cross-section plane and cap meshes had no name, making them impossible
to exclude from raycaster intersection filters. Named them and added
to the exclusion list in measurement and annotation click handlers."
```

If the event.target fix was also needed:
```bash
git add src/themes/industrial/layout.js
git commit -m "fix(industrial): ensure measurement clicks reach the canvas

[describe which element was intercepting and how it was fixed]"
```

---

### Task 3: Remove "Show Toolbar" toggle from View menu

The toolbar should always be visible in industrial theme.

**Files:**
- Modify: `src/themes/industrial/layout.js:487-490` (updateViewMenuChecks)
- Modify: `src/themes/industrial/layout.js:517-524` (buildViewMenu — remove toolbar item)

- [ ] **Step 1: Remove the toolbar toggle menu item**

In `src/themes/industrial/layout.js`, find `buildViewMenu` (line ~493). Delete lines 517-524 entirely (the "Show Toolbar" ddItem block):

```js
    // DELETE these lines:
    var toolbarItem = ddItem('Show Toolbar', '', function() {
        _toggles.toolbar = !_toggles.toolbar;
        if (_toolbar) _toolbar.classList.toggle('hidden', !_toggles.toolbar);
        updateViewMenuChecks();
    });
    toolbarItem.classList.add('checked');
    _viewMenuItems.toolbar = toolbarItem;
    dropdown.appendChild(toolbarItem);
```

- [ ] **Step 2: Clean up updateViewMenuChecks**

Remove the toolbar line from `updateViewMenuChecks` (line ~490):

```js
function updateViewMenuChecks() {
    if (_viewMenuItems.ortho) _viewMenuItems.ortho.classList.toggle('checked', _cameraMode === 'orthographic');
    if (_viewMenuItems.trackball) _viewMenuItems.trackball.classList.toggle('checked', _toggles.trackball);
}
```

- [ ] **Step 3: Manual test**

Open View menu — "Show Toolbar" item should be gone. Toolbar remains permanently visible.

- [ ] **Step 4: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "fix(industrial): remove 'Show Toolbar' toggle from View menu

Toolbar should always be visible in industrial theme."
```

---

## Chunk 2: Display Mode & Background Fixes

### Task 4: Conditional asset type buttons

Display mode buttons (Mesh/Splat/Cloud) should only appear when that asset type is loaded.

**Files:**
- Modify: `src/themes/industrial/layout.js:248` (add updateModeButtonVisibility function)
- Modify: `src/themes/industrial/layout.js:821` (start buttons hidden)
- Modify: `src/themes/industrial/layout.js:1418` (call on asset load)

**Key context:** The deps object from kiosk-main.ts includes `hasSplat` (line 2618) and `hasMesh` (line 2619) as booleans, plus `modelGroup` and `pointcloudGroup` as Three.js Group refs. The existing `onAssetLoaded` function (line 1418) already exists and is called by kiosk-main when assets finish loading.

- [ ] **Step 1: Add `updateModeButtonVisibility` function**

Add near `updateModeButtons` (after line ~254):

```js
function updateModeButtonVisibility() {
    if (!_modeBtns || !_deps) return;
    var hasModel = (_deps.modelGroup && _deps.modelGroup.children.length > 0) || _deps.hasMesh;
    var hasSplat = _deps.hasSplat || false;
    var hasPointcloud = (_deps.pointcloudGroup && _deps.pointcloudGroup.children.length > 0);

    if (_modeBtns.model) _modeBtns.model.style.display = hasModel ? '' : 'none';
    if (_modeBtns.splat) _modeBtns.splat.style.display = hasSplat ? '' : 'none';
    if (_modeBtns.pointcloud) _modeBtns.pointcloud.style.display = hasPointcloud ? '' : 'none';

    // Hide mode group + preceding separator if no buttons visible
    var modeGroup = _modeBtns.model ? _modeBtns.model.parentElement : null;
    if (modeGroup) {
        var anyVisible = hasModel || hasSplat || hasPointcloud;
        modeGroup.style.display = anyVisible ? '' : 'none';
        var prevSep = modeGroup.previousElementSibling;
        if (prevSep && prevSep.classList.contains('ind-toolbar-sep')) {
            prevSep.style.display = anyVisible ? '' : 'none';
        }
    }
}
```

Note: uses `_deps.hasMesh` and `_deps.hasSplat` (booleans passed from kiosk-main at lines 2618-2619), NOT `_deps.state.hasModel`.

- [ ] **Step 2: Start mode buttons hidden**

After `_modeBtns = { model: meshBtn, splat: splatBtn, pointcloud: cloudBtn };` (line ~821), add:

```js
meshBtn.style.display = 'none';
splatBtn.style.display = 'none';
cloudBtn.style.display = 'none';
```

- [ ] **Step 3: Call from `onAssetLoaded`**

The existing `onAssetLoaded` function (line ~1418) already rebuilds layers and updates status. Add `updateModeButtonVisibility()` at the top:

```js
function onAssetLoaded() {
    if (!_panel || !_deps) return;
    updateModeButtonVisibility();
    // ... rest of existing function unchanged
```

Also call `updateModeButtonVisibility()` at the end of the `setup()` function (after toolbar is created) to handle pre-loaded archives.

- [ ] **Step 4: Manual test**

Load industrial theme with no file → mode buttons hidden. Drag a mesh file → Mesh button appears. Splat/Cloud still hidden.

- [ ] **Step 5: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): show display mode buttons only when asset type is loaded

Mesh/Splat/Cloud buttons now hidden until that asset type loads."
```

---

### Task 5: Active display mode indicator

The current display mode button should have a visual "pressed" state.

**Files:**
- Modify: `src/themes/industrial/layout.js:813-819` (mode button click handler)
- Modify: `src/themes/industrial/layout.css` (mode button active style)

**Key context:** `updateModeButtons` (line ~248) already toggles `.active` class on the correct button. But the click handler (line ~814) calls `setDisplayMode` without calling `updateModeButtons`. Also the `onViewModeChange` callback (line ~1803 registration) already exists — check if it calls `updateModeButtons`.

- [ ] **Step 1: Call `updateModeButtons` after `setDisplayMode` in click handler**

Update the click handler (line ~814):

```js
[meshBtn, splatBtn, cloudBtn].forEach(function(btn) {
    btn.addEventListener('click', function() {
        if (_deps && _deps.setDisplayMode) {
            var mode = btn.getAttribute('data-mode');
            _deps.setDisplayMode(mode);
            updateModeButtons(mode);
        }
    });
    modeGroup.appendChild(btn);
});
```

- [ ] **Step 2: Also call from `onViewModeChange` callback**

Find the `onViewModeChange` function. If it doesn't already call `updateModeButtons`, add it:

```js
function onViewModeChange(mode) {
    updateModeButtons(mode);
}
```

This handles mode changes triggered from outside the layout (e.g., keyboard shortcuts, Render menu).

- [ ] **Step 3: Add distinct active styling for mode buttons**

In `src/themes/industrial/layout.css`, add after the existing `.ind-tool-btn.active` rule:

```css
/* Active display mode button — stronger highlight */
.ind-mode-btn.active {
    background: var(--kiosk-accent, #3874CB);
    color: #fff;
    border-style: solid;
    border-color: var(--kiosk-accent, #3874CB);
}
.ind-mode-btn.active:hover {
    background: var(--kiosk-accent, #3874CB);
    color: #fff;
}
```

- [ ] **Step 4: Manual test**

Load a mesh. "Mesh" button should be highlighted blue. If also loading a splat, click "Splat" → Splat highlighted, Mesh not.

- [ ] **Step 5: Commit**

```bash
git add src/themes/industrial/layout.js src/themes/industrial/layout.css
git commit -m "feat(industrial): highlight active display mode button

Call updateModeButtons after mode changes and add distinct blue
highlight for active mode buttons."
```

---

### Task 6: Fix background color

The Three.js scene background is dark blue (#1a1a2e) instead of industrial gray (#535353). Root cause: `kiosk-main.ts` never reads `themeMeta.sceneBg` (parsed from `@scene-bg #535353` in `theme.css`) to apply it to the Three.js scene. The fallback `COLORS.SCENE_BACKGROUND` (0x1a1a2e) is always used.

**Key ordering fact:** SceneManager is created at line 277. Theme is loaded at line 410. So SceneManager is guaranteed to exist when theme meta is available.

**Files:**
- Modify: `src/modules/kiosk-main.ts:277-280` (after SceneManager init, apply theme bg)

- [ ] **Step 1: Apply theme sceneBg after SceneManager creation**

In `src/modules/kiosk-main.ts`, find where SceneManager is initialized (line ~277-280):

```ts
sceneManager = new SceneManager();
if (!await sceneManager.init(canvas as HTMLCanvasElement, canvasRight as HTMLCanvasElement)) {
    log.error('Scene initialization failed');
    return;
}
```

The theme is loaded earlier at line ~410... actually, let me re-check the ordering. The `init()` function flow is:

1. Line 277: `sceneManager = new SceneManager()` + `sceneManager.init()`
2. Line 410: `const themeMeta = await loadTheme(config.theme, ...)`
3. Line 421: `config._themeMeta = themeMeta`

So the SceneManager exists BEFORE the theme loads. The correct insertion point is right after `config._themeMeta = themeMeta;` (line 421):

```ts
    config._resolvedLayout = layoutStyle;
    config._themeMeta = themeMeta;
    config._layoutModule = themeMeta.layoutModule || null;

    // Apply theme scene background to Three.js (must happen before archive loading,
    // which may override with manifest settings via setBackgroundColor)
    if (themeMeta.sceneBg && sceneManager) {
        sceneManager.setBackgroundColor(themeMeta.sceneBg);
    } else {
        const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--kiosk-scene-bg').trim();
        if (cssBg && sceneManager) {
            sceneManager.setBackgroundColor(cssBg);
        }
    }
```

This sets `scene.background` AND `savedBackgroundColor`, so when `applyBackgroundForMode()` falls back (line 3146), it uses the theme color.

- [ ] **Step 2: Manual test**

Open `http://localhost:8080/?kiosk=true&theme=industrial`. Background should be MeshLab gray (#535353). Load a mesh — stays gray. Test other themes still work: `?kiosk=true&theme=editorial` should be dark navy (#11304e).

- [ ] **Step 3: Run tests**

```bash
npm test
```

All existing tests should pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "fix(kiosk): apply theme @scene-bg color to Three.js scene

kiosk-main never read themeMeta.sceneBg, so the scene always fell back
to the default dark blue. Now applies the theme color after SceneManager
init, before archive loading (which can override via manifest settings)."
```

---

### Task 7: Build verification

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: 0 errors (warnings OK).

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: All existing tests pass.

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Manual smoke test**

Open `http://localhost:8080/?kiosk=true&theme=industrial`:
1. Background is gray (#535353)
2. Load a mesh file (drag & drop or File > Open)
3. Mesh button appears in toolbar, Splat/Cloud hidden
4. Mesh button shows blue active state
5. Press `1` — cross-section activates, mesh is clipped
6. Drag gizmo — clipping follows
7. Press `1` — deactivates, mesh fully visible
8. Press `2` — measure tool, click two points — markers at correct positions
9. View menu — no "Show Toolbar" item
10. Toolbar always visible
