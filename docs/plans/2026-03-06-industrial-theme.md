# Industrial Theme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create an "industrial" kiosk theme — a CAD-workbench-style viewer with top toolbar, bottom status bar, and inspection tools for mesh quality review.

**Architecture:** Three theme files (`theme.css`, `layout.css`, `layout.js`) following the existing theme pattern. The layout.js creates toolbar + status bar DOM, wires existing modules (CrossSectionTool, MeasurementSystem, AnnotationSystem, matcap/wireframe toggles, screenshot capture) into toolbar buttons, disables pan controls, and registers keyboard shortcuts. No new shared modules needed — all tool functionality already exists.

**Tech Stack:** CSS custom properties, vanilla JS (layout.js is a non-module script that self-registers on `window.__KIOSK_LAYOUTS__`), Three.js OrbitControls, existing Vitrine3D modules accessed via deps object.

**Design doc:** `docs/plans/2026-03-06-industrial-theme-design.md`

---

### Task 1: Create theme.css — CSS Variable Overrides

**Files:**
- Create: `src/themes/industrial/theme.css`

**Step 1: Create the theme.css file**

```css
/*
 * @theme    Industrial
 * @layout   industrial
 * @scene-bg #2a2a2a
 * @description CAD workbench layout for mesh inspection. Toolbar top, status bar bottom.
 */

body.kiosk-mode {
    /* Accent — tool-blue */
    --kiosk-accent: #4A9EFF;
    --kiosk-accent-rgb: 74, 158, 255;

    /* Surfaces — neutral dark grays */
    --kiosk-surface-rgb: 38, 38, 42;
    --kiosk-elevated-rgb: 52, 52, 58;
    --kiosk-bg-deep-rgb: 24, 24, 28;

    /* Text */
    --kiosk-text-bright-rgb: 220, 220, 225;
    --kiosk-text-body-rgb: 175, 175, 182;
    --kiosk-text-dim-rgb: 120, 120, 130;
    --kiosk-text-heading-rgb: 235, 235, 240;

    /* Named text aliases */
    --kiosk-text-primary: rgba(var(--kiosk-text-bright-rgb), 0.95);
    --kiosk-text-secondary: rgba(var(--kiosk-text-body-rgb), 0.9);
    --kiosk-text-muted: rgba(var(--kiosk-text-dim-rgb), 0.7);
    --kiosk-text-faint: rgba(var(--kiosk-text-dim-rgb), 0.5);

    /* Borders */
    --kiosk-border-subtle: rgba(255, 255, 255, 0.06);
    --kiosk-border-default: rgba(var(--kiosk-accent-rgb), 0.15);

    /* Typography — clean sans-serif throughout */
    --kiosk-font-display: 'Inter', 'Segoe UI', system-ui, sans-serif;
    --kiosk-font-body: 'Inter', 'Segoe UI', system-ui, sans-serif;
    --kiosk-font-mono: 'JetBrains Mono', 'SF Mono', Consolas, monospace;

    /* Deep background */
    --kiosk-bg-deep: rgb(var(--kiosk-bg-deep-rgb));

    /* Scene background */
    --kiosk-scene-bg: #2a2a2a;
}
```

**Step 2: Verify theme metadata parses correctly**

Run: `npm test -- --run src/modules/__tests__/theme-loader.test`
Expected: existing tests still pass (new theme doesn't break parser)

**Step 3: Commit**

```bash
git add src/themes/industrial/theme.css
git commit -m "feat(industrial): add theme.css with neutral gray palette and blue accent"
```

---

### Task 2: Create layout.css — Toolbar, Status Bar, Tool UI Styling

**Files:**
- Create: `src/themes/industrial/layout.css`

**Step 1: Create layout.css**

All rules scoped under `body.kiosk-mode.kiosk-industrial`.

```css
/* =============================================================================
   Industrial Layout — CAD workbench with top toolbar + bottom status bar.
   All rules scoped under body.kiosk-mode.kiosk-industrial.
   ============================================================================= */

/* =============================================================================
   TOP TOOLBAR — 40px, icon-only tool buttons in groups
   ============================================================================= */

body.kiosk-mode.kiosk-industrial .ind-toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 40px;
    z-index: 100;
    display: flex;
    align-items: center;
    padding: 0 8px;
    background: rgba(var(--kiosk-surface-rgb), 0.95);
    border-bottom: 1px solid var(--kiosk-border-subtle);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
}

body.kiosk-mode.kiosk-industrial .ind-toolbar-group {
    display: flex;
    align-items: center;
    gap: 2px;
}

body.kiosk-mode.kiosk-industrial .ind-toolbar-sep {
    width: 1px;
    height: 24px;
    background: rgba(255, 255, 255, 0.08);
    margin: 0 6px;
    flex-shrink: 0;
}

body.kiosk-mode.kiosk-industrial .ind-tool-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: rgba(var(--kiosk-text-dim-rgb), 0.85);
    transition: color 0.12s, background 0.12s;
    position: relative;
}

body.kiosk-mode.kiosk-industrial .ind-tool-btn:hover {
    color: rgba(var(--kiosk-text-bright-rgb), 0.95);
    background: rgba(255, 255, 255, 0.06);
}

body.kiosk-mode.kiosk-industrial .ind-tool-btn.active {
    color: var(--kiosk-accent);
    background: rgba(var(--kiosk-accent-rgb), 0.12);
}

body.kiosk-mode.kiosk-industrial .ind-tool-btn.disabled {
    opacity: 0.3;
    pointer-events: none;
}

body.kiosk-mode.kiosk-industrial .ind-tool-btn svg {
    width: 20px;
    height: 20px;
}

/* Tooltip */
body.kiosk-mode.kiosk-industrial .ind-tool-btn::after {
    content: attr(data-tooltip);
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 6px;
    padding: 4px 8px;
    background: rgba(var(--kiosk-elevated-rgb), 0.95);
    border: 1px solid var(--kiosk-border-subtle);
    border-radius: 3px;
    font-family: var(--kiosk-font-body);
    font-size: 0.62rem;
    font-weight: 500;
    color: rgba(var(--kiosk-text-bright-rgb), 0.9);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 110;
}

body.kiosk-mode.kiosk-industrial .ind-tool-btn:hover::after {
    opacity: 1;
}

/* =============================================================================
   BOTTOM STATUS BAR — 28px, monospace metadata
   ============================================================================= */

body.kiosk-mode.kiosk-industrial .ind-status-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 28px;
    z-index: 100;
    display: flex;
    align-items: center;
    padding: 0 12px;
    background: rgba(var(--kiosk-surface-rgb), 0.95);
    border-top: 1px solid var(--kiosk-border-subtle);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    font-family: var(--kiosk-font-mono);
    font-size: 0.68rem;
    color: rgba(var(--kiosk-text-dim-rgb), 0.8);
}

body.kiosk-mode.kiosk-industrial .ind-status-field {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
}

body.kiosk-mode.kiosk-industrial .ind-status-sep {
    margin: 0 10px;
    color: rgba(var(--kiosk-text-dim-rgb), 0.3);
}

body.kiosk-mode.kiosk-industrial .ind-status-right {
    margin-left: auto;
    color: var(--kiosk-accent);
    font-weight: 500;
}

/* =============================================================================
   VIEWPORT OFFSET — clear toolbar and status bar
   ============================================================================= */

body.kiosk-mode.kiosk-industrial #viewer-container {
    top: 40px !important;
    bottom: 28px !important;
}

/* =============================================================================
   LIGHT CONTROL WIDGET — hemisphere in top-right corner
   ============================================================================= */

body.kiosk-mode.kiosk-industrial .ind-light-widget {
    position: fixed;
    top: 52px;
    right: 12px;
    width: 80px;
    height: 80px;
    z-index: 95;
    background: rgba(var(--kiosk-surface-rgb), 0.9);
    border: 1px solid var(--kiosk-border-subtle);
    border-radius: 50%;
    cursor: grab;
    display: none;
    overflow: hidden;
}

body.kiosk-mode.kiosk-industrial .ind-light-widget.visible {
    display: block;
}

body.kiosk-mode.kiosk-industrial .ind-light-widget canvas {
    width: 100%;
    height: 100%;
    border-radius: 50%;
}

/* =============================================================================
   CROSS-SECTION AXIS PICKER — small floating widget
   ============================================================================= */

body.kiosk-mode.kiosk-industrial .ind-section-controls {
    position: fixed;
    top: 52px;
    left: 12px;
    z-index: 95;
    display: none;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: rgba(var(--kiosk-surface-rgb), 0.92);
    border: 1px solid var(--kiosk-border-subtle);
    border-radius: 4px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
}

body.kiosk-mode.kiosk-industrial .ind-section-controls.visible {
    display: flex;
}

body.kiosk-mode.kiosk-industrial .ind-section-axis-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-family: var(--kiosk-font-mono);
    font-size: 0.72rem;
    font-weight: 700;
    color: rgba(var(--kiosk-text-dim-rgb), 0.8);
    transition: color 0.12s, background 0.12s;
}

body.kiosk-mode.kiosk-industrial .ind-section-axis-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(var(--kiosk-text-bright-rgb), 0.95);
}

body.kiosk-mode.kiosk-industrial .ind-section-axis-btn.active {
    color: var(--kiosk-accent);
    background: rgba(var(--kiosk-accent-rgb), 0.12);
}

body.kiosk-mode.kiosk-industrial .ind-section-slider {
    width: 120px;
    height: 4px;
    margin: 0 8px;
    accent-color: var(--kiosk-accent);
}

body.kiosk-mode.kiosk-industrial .ind-section-flip-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    color: rgba(var(--kiosk-text-dim-rgb), 0.8);
    transition: color 0.12s, background 0.12s;
}

body.kiosk-mode.kiosk-industrial .ind-section-flip-btn:hover {
    color: rgba(var(--kiosk-text-bright-rgb), 0.95);
    background: rgba(255, 255, 255, 0.06);
}

body.kiosk-mode.kiosk-industrial .ind-section-flip-btn svg {
    width: 16px;
    height: 16px;
}

/* =============================================================================
   LOADING OVERLAY — minimal progress bar, no spinner
   ============================================================================= */

body.kiosk-mode.kiosk-industrial #loading-overlay {
    background: rgb(var(--kiosk-bg-deep-rgb));
}

body.kiosk-mode.kiosk-industrial .ind-loading-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
}

body.kiosk-mode.kiosk-industrial #loading-overlay #loading-text {
    font-family: var(--kiosk-font-body);
    font-size: 0.78rem;
    font-weight: 400;
    color: rgba(var(--kiosk-text-dim-rgb), 0.6);
    letter-spacing: 0.02em;
    margin-top: 14px;
}

body.kiosk-mode.kiosk-industrial .ind-loading-bottom {
    position: absolute;
    bottom: 28px;
    left: 0;
    right: 0;
    text-align: center;
}

body.kiosk-mode.kiosk-industrial .ind-loading-bottom #loading-progress-container {
    width: 240px;
    height: 2px;
    background: rgba(var(--kiosk-accent-rgb), 0.1);
    border-radius: 0;
    margin: 0 auto;
    overflow: hidden;
}

body.kiosk-mode.kiosk-industrial .ind-loading-bottom #loading-progress-bar {
    height: 100%;
    background: var(--kiosk-accent);
    transition: width 0.15s ease-out;
}

body.kiosk-mode.kiosk-industrial .ind-loading-bottom #loading-progress-text {
    font-family: var(--kiosk-font-mono);
    font-size: 0.62rem;
    font-weight: 500;
    color: rgba(var(--kiosk-text-dim-rgb), 0.5);
    letter-spacing: 0.04em;
    margin-top: 8px;
}

/* =============================================================================
   ANNOTATION MARKER OVERRIDES — simple numbered circles
   ============================================================================= */

body.kiosk-mode.kiosk-industrial .annotation-marker {
    width: 28px;
    height: 28px;
    font-size: 0.72rem;
    font-weight: 600;
    background: rgba(var(--kiosk-accent-rgb), 0.7);
    border: 2px solid rgba(255, 255, 255, 0.25);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}

body.kiosk-mode.kiosk-industrial .annotation-marker:hover {
    background: rgba(var(--kiosk-accent-rgb), 0.9);
    border-color: rgba(255, 255, 255, 0.5);
}

body.kiosk-mode.kiosk-industrial .annotation-marker.selected {
    background: var(--kiosk-accent);
    border-color: rgba(255, 255, 255, 0.8);
    box-shadow: 0 0 0 3px rgba(var(--kiosk-accent-rgb), 0.25);
}

/* Hide default kiosk sidebar elements */
body.kiosk-mode.kiosk-industrial .kiosk-info-sidebar,
body.kiosk-mode.kiosk-industrial .kiosk-wall-label,
body.kiosk-mode.kiosk-industrial #kiosk-info-overlay {
    display: none !important;
}
```

**Step 2: Commit**

```bash
git add src/themes/industrial/layout.css
git commit -m "feat(industrial): add layout.css with toolbar, status bar, and tool UI styles"
```

---

### Task 3: Create layout.js — DOM Creation and Tool Wiring

**Files:**
- Create: `src/themes/industrial/layout.js`

This is the largest task. The layout.js follows the same pattern as `src/themes/exhibit/layout.js`: a non-module script that self-registers on `window.__KIOSK_LAYOUTS__.industrial`.

**Step 1: Create layout.js with core structure**

The file should implement:

1. **`setup(manifest, deps)`** — Main entry. Creates toolbar + status bar DOM, wires tools, sets up keyboard shortcuts, locks orbit-only navigation.

2. **`initLoadingScreen(container, deps)`** — Customize loading overlay (minimal: filename + progress bar).

3. **`onKeyboardShortcut(key)`** — Handle 1/2/3/M/T/W/L/P/Esc/F shortcuts.

4. **Tool state management** — Track active tool (slice/measure/annotate/light/none) and display toggles (matcap/texture/wireframe).

The layout.js receives deps from kiosk-main.ts with these key properties:
- `deps.sceneManager` — OrbitControls, lights, scene
- `deps.crossSectionTool` — CrossSectionTool instance (if available)
- `deps.measurementSystem` — MeasurementSystem instance (if available)
- `deps.annotationSystem` — AnnotationSystem instance
- `deps.modelGroup` — THREE.Group with loaded meshes
- `deps.state` — AppState
- `deps.renderer`, `deps.scene`, `deps.camera` — Three.js core objects

**Key implementation details:**

a) **Toolbar DOM creation** — Build toolbar with SVG icon buttons. Group into inspection/display/utility sections with separators.

b) **Tool activation** — Mutually exclusive tools. When activating slice: call `crossSectionTool.start(center)`, show section controls. When activating measure: call `measurementSystem.setMeasureMode(true)`. When activating annotate: call `annotationSystem.enablePlacementMode()`. Deactivating clears previous.

c) **Display toggles** — Independent. Matcap calls `updateModelMatcap(modelGroup, enabled, 'clay')`. Wireframe calls `updateModelWireframe(modelGroup, enabled)`. Texture toggles texture visibility.

d) **Status bar** — Parse manifest for filename, vertex count, file size, date. Render in monospace pipe-separated format.

e) **Orbit lock** — Set `controls.enablePan = false` and `controls.mouseButtons.RIGHT = null` on the OrbitControls instance.

f) **Light widget** — When light tool active, show a small circular div. Track mouse drag to reposition `directionalLight1.position` on a sphere. Simple polar coordinate mapping: x-drag = azimuth, y-drag = elevation.

g) **Screenshot** — Call `captureScreenshotToList(deps)` or simpler: capture renderer to blob and trigger download.

**SVG Icons** — Use simple, recognizable 20x20 SVG icons inline in the JS. Keep them minimal (2-3 path elements max per icon):
- Slice: horizontal plane cutting a cube
- Measure: ruler/calipers
- Annotate: pin/marker
- Matcap: sphere with shading
- Texture: checkerboard
- Wireframe: cube wireframe
- Light: sun/lightbulb
- Screenshot: camera

**Step 2: Test manually**

Run: `npm run dev`
Navigate to: `http://localhost:8080/?kiosk=true&theme=industrial`
Load a mesh file and verify:
- Toolbar appears at top with all buttons
- Status bar appears at bottom with filename
- Clicking tools activates/deactivates them
- Keyboard shortcuts work
- Orbit works, pan does not
- Display toggles work independently

**Step 3: Commit**

```bash
git add src/themes/industrial/layout.js
git commit -m "feat(industrial): add layout.js with toolbar, tools, status bar, and keyboard shortcuts"
```

---

### Task 4: Wire Layout Module into Kiosk Bootstrap

**Files:**
- Modify: `src/modules/kiosk-main.ts` — Ensure the industrial layout receives all required deps (crossSectionTool, measurementSystem, etc.) in its `setup()` call. Check that the deps object passed to layout modules includes the tool instances.

**Step 1: Check what deps kiosk-main.ts passes to layout.setup()**

Read `src/modules/kiosk-main.ts` and find the `layout.setup(manifest, deps)` call. Verify that `crossSectionTool`, `measurementSystem`, `modelGroup`, `sceneManager` (with controls and lights accessible), `annotationSystem`, `renderer`, `scene`, `camera`, and `state` are all present in the deps object.

If any are missing, add them to the deps object construction.

**Step 2: Disable pan in orbit controls**

The layout.js will do this in `setup()`, but verify that OrbitControls in scene-manager.ts exposes `controls` publicly so the layout can access `deps.sceneManager.controls.enablePan = false`.

**Step 3: Test the full flow**

Run: `npm run dev`
Navigate to: `http://localhost:8080/?kiosk=true&theme=industrial`
Load an archive (.a3d/.a3z) and verify:
- All tools function correctly with real data
- Status bar shows manifest metadata
- Cross-section works on the mesh
- Measurements display with correct units

**Step 4: Commit any kiosk-main.ts changes**

```bash
git add src/modules/kiosk-main.ts
git commit -m "fix(kiosk): pass tool instances to layout deps for industrial theme"
```

---

### Task 5: Build Verification and Cleanup

**Files:**
- None new — verification only

**Step 1: Run linter**

Run: `npm run lint`
Expected: 0 errors (warnings OK)

**Step 2: Run tests**

Run: `npm test`
Expected: All existing tests pass

**Step 3: Run production build**

Run: `npm run build`
Expected: Builds successfully. Verify `dist/themes/industrial/` contains theme.css, layout.css, layout.js.

**Step 4: Test production build**

Run: `npm run preview`
Navigate to: `http://localhost:4173/?kiosk=true&theme=industrial`
Verify theme loads and tools work in production build.

**Step 5: Final commit if any fixes needed**

```bash
git commit -m "chore(industrial): build verification and cleanup"
```

---

## Implementation Notes

### What already exists (DO NOT reimplement):
- `CrossSectionTool` — `src/modules/cross-section.ts`
- `MeasurementSystem` — `src/modules/measurement-system.ts`
- `AnnotationSystem` — `src/modules/annotation-system.ts`
- `updateModelMatcap()` — `src/modules/file-handlers.ts:1964`
- `updateModelWireframe()` — `src/modules/file-handlers.ts:1895`
- `captureScreenshotToList()` — `src/modules/screenshot-manager.ts`
- `SceneManager` with OrbitControls and lights — `src/modules/scene-manager.ts`

### What layout.js creates new:
- Toolbar DOM with SVG icon buttons
- Status bar DOM with metadata fields
- Light direction hemisphere widget (small canvas or div-based polar drag)
- Cross-section axis picker + slider widget
- Keyboard shortcut handler
- Tool state machine (active tool tracking)

### Pattern reference:
- Follow `src/themes/exhibit/layout.js` for self-registration pattern, deps access, helper functions
- Follow `src/themes/editorial/layout.js` for loading screen customization pattern
