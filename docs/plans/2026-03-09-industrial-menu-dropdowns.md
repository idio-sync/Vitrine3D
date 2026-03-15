# Industrial Theme — Functional Menu Dropdowns Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the decorative `File | View | Render | Tools | Help` menu bar spans in the industrial kiosk theme with fully functional Qt-style click-to-open dropdown menus that expose new viewer functionality.

**Architecture:** The menu system lives entirely in `src/themes/industrial/layout.js` and `layout.css` — no other modules are touched except `kiosk-main.ts` which gains a `loadFile(file)` dep. Menus open on click (not hover), close on outside click or Escape, and call into the existing `_deps` object the theme already receives.

**Tech Stack:** Vanilla JS (no ES imports — layout.js is a non-module script), Three.js camera/controls via `deps.sceneManager`, existing `updateModelWireframe/Textures/Matcap` deps, existing toolbar action functions (`activateTool`, `deactivateTool`, `toggleDisplay`).

---

## Reference: Key Files

- `src/themes/industrial/layout.js` — main file, ~625 lines. `createMenuBar()` at line 299. Module-scope state at top: `_deps`, `_activeTool`, `_toggles`. `setup(manifest, deps)` called by kiosk-main.
- `src/themes/industrial/layout.css` — ~445 lines. All CSS scoped under `body.kiosk-mode.kiosk-industrial`.
- `src/modules/kiosk-main.ts` — `createLayoutDeps()` at line 2425. Returns the object passed as `deps` to `setup()`.

---

## Task 1: Add `loadFile` dep to kiosk-main.ts

**Files:**
- Modify: `src/modules/kiosk-main.ts:2425-2468`

This exposes a unified file-loading function so the File > Open menu item can load any supported format.

**Step 1: Locate `createLayoutDeps`**

Open `src/modules/kiosk-main.ts` and find `createLayoutDeps()` at line ~2425. The function returns an object with `sceneManager`, `annotationSystem`, etc.

**Step 2: Add the `loadFile` helper above `createLayoutDeps`**

Add this function immediately before `createLayoutDeps`:

```typescript
/**
 * Unified single-file loader for the industrial theme's File > Open menu.
 * Routes by extension to the appropriate loader already available in kiosk-main.
 */
async function loadSingleFile(file: File): Promise<void> {
    const name = file.name.toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop()! : '';

    const ARCHIVE_EXTS = ['ddim', 'a3d', 'a3z'];
    const MESH_EXTS    = ['glb', 'gltf', 'obj'];
    const SPLAT_EXTS   = ['ply', 'splat', 'sog'];
    const E57_EXTS     = ['e57'];
    const CAD_EXTS     = ['step', 'stp', 'iges', 'igs'];
    const FLIGHT_EXTS  = ['csv', 'kml', 'kmz', 'srt'];

    if (ARCHIVE_EXTS.includes(ext)) {
        // Re-use existing archive-from-file pipeline
        const { loadArchiveFromFile } = await import('./file-handlers.js');
        const archiveLoader = await loadArchiveFromFile(file, { state: state as any });
        if (archiveLoader) await processArchivePhase1(archiveLoader, createArchiveDeps());
    } else if (MESH_EXTS.includes(ext)) {
        const { loadMeshFromFile } = await import('./file-handlers.js');
        await loadMeshFromFile(file, createArchiveDeps());
    } else if (SPLAT_EXTS.includes(ext)) {
        const { loadSplatFromFile } = await import('./file-handlers.js');
        await loadSplatFromFile(file, createArchiveDeps());
    } else if (E57_EXTS.includes(ext)) {
        const { loadPointCloudFromFile } = await import('./file-handlers.js');
        await loadPointCloudFromFile(file, createArchiveDeps());
    } else if (CAD_EXTS.includes(ext)) {
        const { loadCADFromFile } = await import('./cad-loader.js');
        await loadCADFromFile(file, createArchiveDeps());
    } else if (FLIGHT_EXTS.includes(ext)) {
        if (flightPathManager) await flightPathManager.importFromFile(file);
    } else {
        const { notify } = await import('./utilities.js');
        notify(`Unsupported file type: .${ext}`);
    }
}
```

**Step 3: Add `loadFile` to the returned deps object**

Inside `createLayoutDeps()`, add one line to the returned object:

```typescript
loadFile: loadSingleFile,
```

**Step 4: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -40
```

Expected: build succeeds. If `loadMeshFromFile` / `loadSplatFromFile` / `loadPointCloudFromFile` don't exist by those names, look up the correct export names in `src/modules/file-handlers.ts` and adjust.

**Step 5: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(kiosk): expose loadFile dep for industrial theme file picker"
```

---

## Task 2: Add dropdown CSS to layout.css

**Files:**
- Modify: `src/themes/industrial/layout.css`

All new rules go at the end of the file, before the final closing comment (if any). All selectors are scoped under `body.kiosk-mode.kiosk-industrial`.

**Step 1: Append dropdown CSS**

Add to the end of `src/themes/industrial/layout.css`:

```css
/* ============================================================
   MENU DROPDOWNS
   ============================================================ */

body.kiosk-mode.kiosk-industrial .ind-menu-item {
    position: relative; /* anchor for absolute dropdown */
    cursor: pointer;
    user-select: none;
}

body.kiosk-mode.kiosk-industrial .ind-dropdown {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 200px;
    background: rgb(var(--kiosk-surface-rgb));
    border: 1px solid var(--kiosk-border-dark);
    border-top: none;
    box-shadow: 1px 3px 6px rgba(0, 0, 0, 0.35);
    z-index: 110;
    padding: 3px 0;
}

body.kiosk-mode.kiosk-industrial .ind-menu-item.open .ind-dropdown {
    display: block;
}

body.kiosk-mode.kiosk-industrial .ind-dd-item {
    display: flex;
    align-items: center;
    height: 22px;
    padding: 0 20px 0 26px;
    font-size: 0.72rem;
    color: var(--kiosk-text-primary, #1a1a1a);
    cursor: pointer;
    white-space: nowrap;
    position: relative;
}

body.kiosk-mode.kiosk-industrial .ind-dd-item:hover {
    background: var(--kiosk-accent);
    color: #fff;
}

body.kiosk-mode.kiosk-industrial .ind-dd-item.disabled {
    opacity: 0.4;
    pointer-events: none;
}

/* Left gutter: checkmark or bullet indicator */
body.kiosk-mode.kiosk-industrial .ind-dd-item::before {
    content: '';
    position: absolute;
    left: 8px;
    font-size: 0.72rem;
    line-height: 22px;
    color: var(--kiosk-accent);
}

body.kiosk-mode.kiosk-industrial .ind-dd-item.checked::before {
    content: '✓';
}

body.kiosk-mode.kiosk-industrial .ind-dd-item.radio-active::before {
    content: '•';
    font-size: 1.1rem;
    line-height: 20px;
}

/* Keyboard shortcut hint — right side */
body.kiosk-mode.kiosk-industrial .ind-dd-hint {
    margin-left: auto;
    padding-left: 16px;
    font-size: 0.68rem;
    color: var(--kiosk-text-muted, #888);
    opacity: 0.7;
}

body.kiosk-mode.kiosk-industrial .ind-dd-item:hover .ind-dd-hint {
    color: rgba(255, 255, 255, 0.75);
    opacity: 1;
}

/* Separator */
body.kiosk-mode.kiosk-industrial .ind-dd-sep {
    height: 1px;
    background: var(--kiosk-border-dark);
    margin: 3px 0;
}

/* ============================================================
   KEYBOARD SHORTCUTS OVERLAY
   ============================================================ */

body.kiosk-mode.kiosk-industrial .ind-shortcuts-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
}

body.kiosk-mode.kiosk-industrial .ind-shortcuts-panel {
    background: rgb(var(--kiosk-surface-rgb));
    border: 1px solid var(--kiosk-border-dark);
    min-width: 320px;
    max-width: 420px;
    box-shadow: 2px 4px 12px rgba(0, 0, 0, 0.4);
}

body.kiosk-mode.kiosk-industrial .ind-shortcuts-title {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 6px 12px;
    border-bottom: 1px solid var(--kiosk-border-dark);
    background: var(--kiosk-border-light, #e0e0e0);
}

body.kiosk-mode.kiosk-industrial .ind-shortcuts-table {
    padding: 6px 0;
}

body.kiosk-mode.kiosk-industrial .ind-shortcuts-row {
    display: flex;
    align-items: center;
    height: 20px;
    padding: 0 12px;
    font-size: 0.70rem;
    gap: 8px;
}

body.kiosk-mode.kiosk-industrial .ind-shortcuts-row:hover {
    background: rgba(var(--kiosk-surface-rgb), 0.8);
}

body.kiosk-mode.kiosk-industrial .ind-shortcuts-key {
    min-width: 80px;
    font-family: monospace;
    font-size: 0.69rem;
    color: var(--kiosk-accent);
    font-weight: 600;
}

body.kiosk-mode.kiosk-industrial .ind-shortcuts-desc {
    color: var(--kiosk-text-primary, #1a1a1a);
}

body.kiosk-mode.kiosk-industrial .ind-shortcuts-close {
    display: block;
    width: 100%;
    padding: 5px;
    font-size: 0.70rem;
    text-align: center;
    border: none;
    border-top: 1px solid var(--kiosk-border-dark);
    background: var(--kiosk-border-light, #e0e0e0);
    cursor: pointer;
    color: inherit;
}

body.kiosk-mode.kiosk-industrial .ind-shortcuts-close:hover {
    background: var(--kiosk-accent);
    color: #fff;
}

/* ============================================================
   ABOUT OVERLAY
   ============================================================ */

body.kiosk-mode.kiosk-industrial .ind-about-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
}

body.kiosk-mode.kiosk-industrial .ind-about-panel {
    background: rgb(var(--kiosk-surface-rgb));
    border: 1px solid var(--kiosk-border-dark);
    min-width: 280px;
    box-shadow: 2px 4px 12px rgba(0, 0, 0, 0.4);
}

body.kiosk-mode.kiosk-industrial .ind-about-title {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 6px 12px;
    border-bottom: 1px solid var(--kiosk-border-dark);
    background: var(--kiosk-border-light, #e0e0e0);
}

body.kiosk-mode.kiosk-industrial .ind-about-body {
    padding: 10px 12px;
    font-size: 0.70rem;
    line-height: 1.7;
    color: var(--kiosk-text-primary, #1a1a1a);
}

body.kiosk-mode.kiosk-industrial .ind-about-close {
    display: block;
    width: 100%;
    padding: 5px;
    font-size: 0.70rem;
    text-align: center;
    border: none;
    border-top: 1px solid var(--kiosk-border-dark);
    background: var(--kiosk-border-light, #e0e0e0);
    cursor: pointer;
    color: inherit;
}

body.kiosk-mode.kiosk-industrial .ind-about-close:hover {
    background: var(--kiosk-accent);
    color: #fff;
}
```

**Step 2: Verify no lint errors**

```bash
npm run lint 2>&1 | head -20
```

Expected: 0 errors.

**Step 3: Commit**

```bash
git add src/themes/industrial/layout.css
git commit -m "feat(industrial): add dropdown, shortcuts overlay, and about overlay CSS"
```

---

## Task 3: Add new module-scope state + close-all utility

**Files:**
- Modify: `src/themes/industrial/layout.js` (top of file, ~line 13-31)

**Step 1: Extend module-scope state**

After the existing state block (lines 13–31), add:

```js
// Menu system state
var _openMenu = null;         // 'file' | 'view' | 'render' | 'tools' | 'help' | null
var _renderMode = 'solid';    // 'solid' | 'wireframe' | 'matcap'
var _cameraMode = 'perspective'; // 'perspective' | 'orthographic'
var _orthoCam = null;         // cached OrthographicCamera instance
var _perspCam = null;         // cached PerspectiveCamera reference (from sceneManager)
var _menuCloseListener = null; // document mousedown listener reference
```

Also extend the existing `_toggles` line from:
```js
var _toggles = { matcap: false, texture: true, wireframe: false };
```
to:
```js
var _toggles = { matcap: false, texture: true, wireframe: false, trackball: true, toolbar: true, annotations: true };
```

**Step 2: Add `closeAllMenus()` helper**

Add this function in the `// ---- Helpers ----` section (after `createEl` and before `formatFileSize`, around line 49):

```js
function closeAllMenus() {
    if (!_openMenu) return;
    var items = document.querySelectorAll('.ind-menu-item.open');
    for (var i = 0; i < items.length; i++) items[i].classList.remove('open');
    _openMenu = null;
}
```

**Step 3: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): add menu state variables and closeAllMenus helper"
```

---

## Task 4: Rewrite `createMenuBar()` — menu infrastructure

**Files:**
- Modify: `src/themes/industrial/layout.js` (~line 299)

Replace the entire `createMenuBar()` function (currently lines 299–308) with the new version below. This task wires up the open/close behavior only — menu content comes in Tasks 5–9.

**Step 1: Replace `createMenuBar()`**

```js
function createMenuBar() {
    var bar = createEl('div', 'ind-menubar');

    var menuDefs = [
        { id: 'file',   label: 'File' },
        { id: 'view',   label: 'View' },
        { id: 'render', label: 'Render' },
        { id: 'tools',  label: 'Tools' },
        { id: 'help',   label: 'Help' }
    ];

    menuDefs.forEach(function(def) {
        var item = createEl('div', 'ind-menu-item', def.label);
        item.dataset.menu = def.id;

        var dropdown = createEl('div', 'ind-dropdown');
        dropdown.dataset.menuFor = def.id;
        item.appendChild(dropdown);

        item.addEventListener('mousedown', function(e) {
            e.stopPropagation();
            var isOpen = item.classList.contains('open');
            closeAllMenus();
            if (!isOpen) {
                item.classList.add('open');
                _openMenu = def.id;
            }
        });

        bar.appendChild(item);
    });

    // Close on outside click
    _menuCloseListener = function(e) {
        if (!e.target.closest('.ind-menu-item')) closeAllMenus();
    };
    document.addEventListener('mousedown', _menuCloseListener);

    // Close on Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeAllMenus();
    });

    return bar;
}
```

**Step 2: Add a `ddItem` helper** (add in helpers section near `createEl`):

```js
/** Create a dropdown menu item. hint is optional keyboard shortcut text. */
function ddItem(label, hint, action, extraClass) {
    var el = createEl('div', 'ind-dd-item' + (extraClass ? ' ' + extraClass : ''), label);
    if (hint) {
        var hintEl = createEl('span', 'ind-dd-hint', hint);
        el.appendChild(hintEl);
    }
    el.addEventListener('click', function(e) {
        e.stopPropagation();
        closeAllMenus();
        if (action) action();
    });
    return el;
}

/** Create a dropdown separator. */
function ddSep() {
    return createEl('div', 'ind-dd-sep');
}
```

**Step 3: Smoke test — open/close works**

Run dev server (`npm run dev`), open `http://localhost:8080?layout=industrial`, click each menu label. Dropdown panel should open (empty for now) and close on outside click / Escape.

**Step 4: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): wire menu open/close infrastructure with empty dropdowns"
```

---

## Task 5: Populate File menu

**Files:**
- Modify: `src/themes/industrial/layout.js`

Add a `buildFileMenu(dropdown)` function and call it from `createMenuBar()`.

**Step 1: Add `buildFileMenu`**

```js
function buildFileMenu(dropdown) {
    // Open File...
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.ddim,.a3d,.a3z,.glb,.gltf,.obj,.e57,.ply,.splat,.sog,.step,.stp,.iges,.igs,.csv,.kml,.kmz,.srt';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function() {
        var file = fileInput.files && fileInput.files[0];
        if (file && _deps && _deps.loadFile) _deps.loadFile(file);
        fileInput.value = '';
    });
    document.body.appendChild(fileInput);

    dropdown.appendChild(ddItem('Open File\u2026', '', function() { fileInput.click(); }));
    dropdown.appendChild(ddSep());
    dropdown.appendChild(ddItem('Take Screenshot', 'P', function() {
        if (_deps && _deps.sceneManager) doScreenshot();
    }));
    dropdown.appendChild(ddItem('Reset View', '', function() {
        if (_deps && _deps.resetOrbitCenter) _deps.resetOrbitCenter();
        fitView();
    }));
    dropdown.appendChild(ddSep());
    dropdown.appendChild(ddItem('Reset Scene', '', function() {
        if (confirm('Reload and reset the scene?')) window.location.reload();
    }));
}
```

**Step 2: Call it from `createMenuBar()`**

Inside the `menuDefs.forEach` loop, after `var dropdown = createEl('div', 'ind-dropdown');`, add:

```js
if (def.id === 'file') buildFileMenu(dropdown);
```

**Step 3: Verify**

In the browser, click **File** — should show: Open File…, separator, Take Screenshot, Reset View, separator, Reset Scene.

**Step 4: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): implement File menu with open file, screenshot, reset"
```

---

## Task 6: Populate View menu

**Files:**
- Modify: `src/themes/industrial/layout.js`

**Step 1: Add camera preset helper**

```js
/**
 * Snap camera to an axis-aligned view. axis: '+x'|'-x'|'+y'|'-y'|'+z'|'-z'
 */
function setCameraPreset(axis) {
    if (!_deps || !_deps.sceneManager) return;
    var sm = _deps.sceneManager;
    var camera = sm.camera;
    var controls = sm.controls;
    if (!camera || !controls) return;

    // Compute bounding sphere of model group
    var THREE = window.THREE || (sm.scene && sm.scene.constructor && sm.scene.constructor.prototype.constructor);
    var box = new (camera.constructor.name === 'PerspectiveCamera' ? Object : Object)();
    // Use sceneManager utilities if available, otherwise compute manually
    var target = controls.target.clone ? controls.target.clone() : { x: 0, y: 0, z: 0 };
    var distance = camera.position.distanceTo(controls.target);

    var offset = { x: 0, y: 0, z: 0 };
    switch (axis) {
        case '+z': offset = { x: 0, y: 0, z: distance }; break;
        case '-z': offset = { x: 0, y: 0, z: -distance }; break;
        case '+x': offset = { x: distance, y: 0, z: 0 }; break;
        case '-x': offset = { x: -distance, y: 0, z: 0 }; break;
        case '+y': offset = { x: 0, y: distance, z: 0 }; break;
        case '-y': offset = { x: 0, y: -distance, z: 0 }; break;
    }

    camera.position.set(
        target.x + offset.x,
        target.y + offset.y,
        target.z + offset.z
    );
    if (controls.update) controls.update();
}
```

**Step 2: Add orthographic camera toggle**

```js
function toggleOrthographic() {
    if (!_deps || !_deps.sceneManager) return;
    var sm = _deps.sceneManager;
    var renderer = sm.renderer;
    var controls = sm.controls;
    var canvas = renderer ? renderer.domElement : null;
    if (!canvas) return;

    var w = canvas.clientWidth || 800;
    var h = canvas.clientHeight || 600;
    var aspect = w / h;

    if (_cameraMode === 'perspective') {
        // Switch to orthographic
        _perspCam = sm.camera;
        var dist = _perspCam.position.distanceTo(controls ? controls.target : { x:0, y:0, z:0 });
        var fovRad = (_perspCam.fov || 45) * Math.PI / 180;
        var frustumH = 2 * Math.tan(fovRad / 2) * dist;
        var frustumW = frustumH * aspect;

        if (!_orthoCam) {
            // Dynamically construct — THREE may not be in global scope;
            // use sceneManager internals if accessible.
            var THREE_cls = Object.getPrototypeOf(_perspCam).constructor;
            _orthoCam = new THREE_cls(-frustumW/2, frustumW/2, frustumH/2, -frustumH/2, 0.01, 10000);
        }
        _orthoCam.position.copy(_perspCam.position);
        _orthoCam.quaternion.copy(_perspCam.quaternion);
        _orthoCam.near = 0.01; _orthoCam.far = 10000;
        _orthoCam.updateProjectionMatrix();

        sm.camera = _orthoCam;
        if (controls) controls.object = _orthoCam;
        _cameraMode = 'orthographic';
    } else {
        // Restore perspective
        if (_perspCam) {
            _perspCam.position.copy(sm.camera.position);
            _perspCam.quaternion.copy(sm.camera.quaternion);
            sm.camera = _perspCam;
            if (controls) controls.object = _perspCam;
        }
        _cameraMode = 'perspective';
    }
    updateViewMenuChecks();
}
```

**Step 3: Add `buildViewMenu`**

```js
var _viewMenuItems = {}; // keyed by action name, so we can update checkmarks

function buildViewMenu(dropdown) {
    dropdown.appendChild(ddItem('Fit to View', 'F', function() { fitView(); }));
    dropdown.appendChild(ddSep());

    [
        ['Front',  '+z'],
        ['Back',   '-z'],
        ['Left',   '+x'],
        ['Right',  '-x'],
        ['Top',    '+y'],
        ['Bottom', '-y']
    ].forEach(function(pair) {
        dropdown.appendChild(ddItem(pair[0], '', function() { setCameraPreset(pair[1]); }));
    });

    dropdown.appendChild(ddSep());

    var orthoItem = ddItem('Perspective / Orthographic', '', function() { toggleOrthographic(); });
    _viewMenuItems.ortho = orthoItem;
    dropdown.appendChild(orthoItem);

    dropdown.appendChild(ddSep());

    var trackballItem = ddItem('Show Trackball', '', function() {
        _toggles.trackball = !_toggles.trackball;
        if (_trackballOverlay) _trackballOverlay.classList.toggle('hidden', !_toggles.trackball);
        updateViewMenuChecks();
    });
    _viewMenuItems.trackball = trackballItem;
    if (_toggles.trackball) trackballItem.classList.add('checked');
    dropdown.appendChild(trackballItem);

    var toolbarItem = ddItem('Show Toolbar', '', function() {
        _toggles.toolbar = !_toggles.toolbar;
        if (_toolbar) _toolbar.classList.toggle('hidden', !_toggles.toolbar);
        updateViewMenuChecks();
    });
    _viewMenuItems.toolbar = toolbarItem;
    if (_toggles.toolbar) toolbarItem.classList.add('checked');
    dropdown.appendChild(toolbarItem);
}

function updateViewMenuChecks() {
    if (_viewMenuItems.ortho) {
        _viewMenuItems.ortho.classList.toggle('checked', _cameraMode === 'orthographic');
    }
    if (_viewMenuItems.trackball) {
        _viewMenuItems.trackball.classList.toggle('checked', _toggles.trackball);
    }
    if (_viewMenuItems.toolbar) {
        _viewMenuItems.toolbar.classList.toggle('checked', _toggles.toolbar);
    }
}
```

**Step 4: Wire into `createMenuBar()`**

```js
if (def.id === 'view') buildViewMenu(dropdown);
```

**Step 5: Verify**

Click **View** — camera presets, Fit to View, Perspective/Orthographic toggle (with checkmark), Show Trackball (checked by default), Show Toolbar (checked by default).

**Step 6: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): implement View menu with camera presets and orthographic toggle"
```

---

## Task 7: Populate Render menu

**Files:**
- Modify: `src/themes/industrial/layout.js`

**Step 1: Add `buildRenderMenu`**

```js
var _renderMenuItems = {}; // 'solid' | 'wireframe' | 'matcap' | 'texture' | 'lighting'

function buildRenderMenu(dropdown) {
    function setRenderMode(mode) {
        _renderMode = mode;
        if (!_deps) return;
        _deps.updateModelWireframe && _deps.updateModelWireframe(mode === 'wireframe');
        _deps.updateModelMatcap   && _deps.updateModelMatcap(mode === 'matcap');
        // Solid: both off
        _toggles.wireframe = mode === 'wireframe';
        _toggles.matcap    = mode === 'matcap';
        updateRenderMenuChecks();
        syncToolbarButtons();
    }

    var solidItem     = ddItem('Solid',     '', function() { setRenderMode('solid'); });
    var wireItem      = ddItem('Wireframe', 'W', function() { setRenderMode('wireframe'); });
    var matcapItem    = ddItem('Matcap',    'M', function() { setRenderMode('matcap'); });

    _renderMenuItems.solid     = solidItem;
    _renderMenuItems.wireframe = wireItem;
    _renderMenuItems.matcap    = matcapItem;

    solidItem.classList.add('radio-active'); // default

    dropdown.appendChild(solidItem);
    dropdown.appendChild(wireItem);
    dropdown.appendChild(matcapItem);
    dropdown.appendChild(ddSep());

    var texItem = ddItem('Texture On/Off', 'T', function() {
        _toggles.texture = !_toggles.texture;
        if (_deps && _deps.updateModelTextures) _deps.updateModelTextures(_toggles.texture);
        updateRenderMenuChecks();
        syncToolbarButtons();
    });
    _renderMenuItems.texture = texItem;
    if (_toggles.texture) texItem.classList.add('checked');
    dropdown.appendChild(texItem);

    dropdown.appendChild(ddSep());
    dropdown.appendChild(ddItem('Lighting', 'L', function() {
        toggleDisplay('light');
    }));
}

function updateRenderMenuChecks() {
    ['solid', 'wireframe', 'matcap'].forEach(function(mode) {
        if (_renderMenuItems[mode]) {
            _renderMenuItems[mode].classList.toggle('radio-active', _renderMode === mode);
        }
    });
    if (_renderMenuItems.texture) {
        _renderMenuItems.texture.classList.toggle('checked', _toggles.texture);
    }
}

/** Keep toolbar button pressed-states in sync after menu changes render mode. */
function syncToolbarButtons() {
    var btnW = document.querySelector('.ind-tb-btn[data-action="wireframe"]');
    var btnM = document.querySelector('.ind-tb-btn[data-action="matcap"]');
    var btnT = document.querySelector('.ind-tb-btn[data-action="texture"]');
    if (btnW) btnW.classList.toggle('active', _toggles.wireframe);
    if (btnM) btnM.classList.toggle('active', _toggles.matcap);
    if (btnT) btnT.classList.toggle('active', _toggles.texture);
}
```

**Step 2: Wire into `createMenuBar()`**

```js
if (def.id === 'render') buildRenderMenu(dropdown);
```

**Step 3: Verify**

Click **Render** — Solid (bullet active), Wireframe, Matcap, separator, Texture On/Off (checked by default), separator, Lighting. Clicking Wireframe should toggle the mesh wireframe and show Wireframe bullet-active.

**Step 4: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): implement Render menu with render mode radio group and texture toggle"
```

---

## Task 8: Populate Tools menu

**Files:**
- Modify: `src/themes/industrial/layout.js`

**Step 1: Add `buildToolsMenu`**

```js
var _toolsMenuItems = {};

function buildToolsMenu(dropdown) {
    dropdown.appendChild(ddItem('Section Plane', '1', function() { activateTool('section'); }));
    dropdown.appendChild(ddItem('Measure',       '2', function() { activateTool('measure'); }));
    dropdown.appendChild(ddItem('Annotate',      '3', function() { activateTool('annotate'); }));
    dropdown.appendChild(ddSep());

    var annoItem = ddItem('Show Annotations', '', function() {
        _toggles.annotations = !_toggles.annotations;
        if (_deps && _deps.annotationSystem) {
            // annotationSystem exposes setVisible or toggle — check both
            if (typeof _deps.annotationSystem.setVisible === 'function') {
                _deps.annotationSystem.setVisible(_toggles.annotations);
            } else if (typeof _deps.annotationSystem.setMarkersVisible === 'function') {
                _deps.annotationSystem.setMarkersVisible(_toggles.annotations);
            }
        }
        updateToolsMenuChecks();
    });
    _toolsMenuItems.annotations = annoItem;
    annoItem.classList.add('checked'); // default: annotations visible
    dropdown.appendChild(annoItem);
}

function updateToolsMenuChecks() {
    if (_toolsMenuItems.annotations) {
        _toolsMenuItems.annotations.classList.toggle('checked', _toggles.annotations);
    }
}
```

**Step 2: Wire into `createMenuBar()`**

```js
if (def.id === 'tools') buildToolsMenu(dropdown);
```

**Step 3: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): implement Tools menu with section plane, measure, annotate, annotations toggle"
```

---

## Task 9: Populate Help menu (keyboard shortcuts + about)

**Files:**
- Modify: `src/themes/industrial/layout.js`

**Step 1: Add `showShortcutsOverlay`**

```js
var SHORTCUTS = [
    { key: '1',      desc: 'Section Plane' },
    { key: '2',      desc: 'Measure' },
    { key: '3',      desc: 'Annotate' },
    { key: 'T',      desc: 'Toggle Texture' },
    { key: 'W',      desc: 'Toggle Wireframe' },
    { key: 'M',      desc: 'Toggle Matcap' },
    { key: 'L',      desc: 'Lighting Widget' },
    { key: 'P',      desc: 'Take Screenshot' },
    { key: 'F',      desc: 'Fit to View' },
    { key: 'Escape', desc: 'Deactivate Tool / Close Menu' }
];

function showShortcutsOverlay() {
    var overlay = createEl('div', 'ind-shortcuts-overlay');
    var panel   = createEl('div', 'ind-shortcuts-panel');
    var title   = createEl('div', 'ind-shortcuts-title', 'Keyboard Shortcuts');
    var table   = createEl('div', 'ind-shortcuts-table');

    SHORTCUTS.forEach(function(s) {
        var row  = createEl('div', 'ind-shortcuts-row');
        var key  = createEl('span', 'ind-shortcuts-key', s.key);
        var desc = createEl('span', 'ind-shortcuts-desc', s.desc);
        row.appendChild(key);
        row.appendChild(desc);
        table.appendChild(row);
    });

    var closeBtn = createEl('button', 'ind-shortcuts-close', 'Close');

    function dismiss() { document.body.removeChild(overlay); }
    closeBtn.addEventListener('click', dismiss);
    overlay.addEventListener('mousedown', function(e) {
        if (e.target === overlay) dismiss();
    });
    document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', onEsc); }
    });

    panel.appendChild(title);
    panel.appendChild(table);
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
}

function showAboutOverlay(manifest) {
    var overlay = createEl('div', 'ind-about-overlay');
    var panel   = createEl('div', 'ind-about-panel');
    var title   = createEl('div', 'ind-about-title', 'About');
    var body    = createEl('div', 'ind-about-body');

    var name    = (manifest && manifest.title) || 'Vitrine3D Industrial Viewer';
    var version = (manifest && manifest.version) || '—';
    body.innerHTML = '<strong>' + name + '</strong><br>Theme: Industrial (MeshLab Workbench)<br>Version: ' + version;

    var closeBtn = createEl('button', 'ind-about-close', 'Close');
    function dismiss() { document.body.removeChild(overlay); }
    closeBtn.addEventListener('click', dismiss);
    overlay.addEventListener('mousedown', function(e) { if (e.target === overlay) dismiss(); });

    panel.appendChild(title);
    panel.appendChild(body);
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
}
```

**Step 2: Add `buildHelpMenu`**

Note: `manifest` is available in module scope from `setup(manifest, deps)` — store it:

At the top of `setup()`, add: `_manifest = manifest;`

And add `var _manifest = null;` to the module-scope state block.

```js
function buildHelpMenu(dropdown) {
    dropdown.appendChild(ddItem('Keyboard Shortcuts', '', function() {
        showShortcutsOverlay();
    }));
    dropdown.appendChild(ddSep());
    dropdown.appendChild(ddItem('About', '', function() {
        showAboutOverlay(_manifest);
    }));
}
```

**Step 3: Wire into `createMenuBar()`**

```js
if (def.id === 'help') buildHelpMenu(dropdown);
```

**Step 4: Verify**

Click **Help > Keyboard Shortcuts** — overlay appears with shortcut table. Escape and click-outside dismiss it. Click **Help > About** — shows name and version.

**Step 5: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): implement Help menu with keyboard shortcuts overlay and about panel"
```

---

## Task 10: Final verification + build check

**Step 1: Run lint**

```bash
npm run lint 2>&1 | tail -5
```

Expected: 0 errors.

**Step 2: Run build**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds with no errors.

**Step 3: Manual smoke test**

Open dev server (`npm run dev`), navigate to `http://localhost:8080?layout=industrial` (or load with an archive that uses the industrial theme).

Check each menu:
- [ ] **File**: Open File… triggers file picker with correct accept types; Reset View re-centers camera; Reset Scene prompts then reloads.
- [ ] **View**: Camera presets (Front/Back/Left/Right/Top/Bottom) reposition camera; Perspective/Orthographic toggles projection + shows checkmark; Show Trackball/Toolbar toggle correctly.
- [ ] **Render**: Solid/Wireframe/Matcap are mutually exclusive with bullet; Texture On/Off toggles texture; toolbar buttons stay in sync.
- [ ] **Tools**: Section Plane/Measure/Annotate activate correct tools; Show Annotations toggles visibility.
- [ ] **Help**: Keyboard Shortcuts overlay opens/closes; About shows manifest title.

**Step 4: Final commit**

```bash
git add -p
git commit -m "feat(industrial): functional dropdown menus — File, View, Render, Tools, Help"
```

---

## Notes for Executor

- `activateTool('section'|'measure'|'annotate')` and `toggleDisplay('light')` and `fitView()` and `doScreenshot()` are module-scope functions already in `layout.js`. Reference them directly — do not re-implement.
- `_deps` is the module-scope variable that holds the deps object from `setup()`. Always guard with `if (!_deps || !_deps.X) return;` before calling deps functions.
- `createEl(tag, className, text)` is the existing helper in the file — use it for consistency.
- The orthographic toggle is the most complex item. If `THREE.OrthographicCamera` isn't accessible from the camera's prototype, fall back to `disabled` state on that menu item and log a warning rather than crashing.
- `syncToolbarButtons()` uses `.ind-tb-btn[data-action]` selectors — verify these match the actual data attributes on toolbar buttons (check the existing `createToolbar()` function in layout.js before writing the querySelector).
