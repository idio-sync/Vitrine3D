# PASS Viewer Professional Upgrade — Design Spec

**Date:** 2026-03-10
**Status:** Approved
**Scope:** Bring PASS Viewer (industrial theme Tauri build) to professional 3D model inspection quality, MeshLab-style

## Context

PASS Viewer is the client-facing desktop app for inspecting scans from Direct Dimensions' PASS (Part Automated Scanning System). It scans small-to-medium objects (up to 16" cube) producing OBJ meshes + JPG textures with <1mm accuracy. The viewer is used for QA inspection — checking mesh quality, texture coverage, measurements, and defect marking.

The viewer runs as a Tauri v2 desktop app (`tauri.pass.conf.json`) using the industrial theme (`src/themes/industrial/`) in kiosk mode. The industrial theme already provides a MeshLab-style Qt-vintage UI (beveled toolbar buttons, gray palette, menu bar, status bar).

## Design Decisions

- **Aesthetic:** Keep Qt-vintage MeshLab look (beveled buttons, gray toolbar, classic desktop feel)
- **Primary asset type:** Meshes (OBJ/GLB from PASS scans), but support splats/clouds when loaded
- **Annotation model:** Defect-marking annotations with severity, category, pass/fail for QA workflows
- **Layers:** Tree-style with top-level assets and expandable sub-mesh components
- **Properties:** Comprehensive mesh inspection info (geometry stats, textures, compression, quality indicators, scan metadata)

## Phase 1: Ship-Blocking Fixes

### 1.1 Cross-Section Not Clipping (Bug)

**Root cause:** `src/themes/industrial/layout.js` `activateTool('slice')` calls `_deps.crossSection.start(center)` but never calls `_deps.setLocalClippingEnabled(true)`. The editorial theme and editor both make this call. Same omission on deactivation.

**Fix:** Add `setLocalClippingEnabled(true)` before `crossSection.start()` and `setLocalClippingEnabled(false)` on `crossSection.stop()` in the industrial layout's `activateTool`/`deactivateTool` functions.

### 1.2 Measurement Points Misplaced (Bug)

**Investigation needed:** The measurement raycaster in `measurement-system.ts` uses standard Three.js raycasting against `scene.children`. Possible causes:
- Viewport offset: industrial layout adds 58px top offset (menu + toolbar) + 24px bottom (status bar). If the raycaster doesn't account for the canvas offset within the viewport, clicks will be offset.
- Invisible objects: cross-section cap meshes, trackball overlay, or other non-visible geometry intercepting rays.

**Fix approach:** Verify `getBoundingClientRect()` returns correct canvas bounds in industrial layout. Add cap meshes and overlay objects to the raycaster exclusion filter.

### 1.3 Remove "Show Toolbar" Button

**Current:** A toggle button exists to show/hide the toolbar. In industrial theme, the toolbar should always be visible.

**Fix:** Remove or permanently hide the toolbar toggle button in industrial layout. Ensure `_toggles.toolbar` is always `true`.

### 1.4 Conditional Asset Type Buttons

**Current:** Display mode buttons (Model/Splat/Cloud/STL/M+S/Split) always shown regardless of loaded assets.

**Fix:** Track which asset types are loaded. Show/hide individual mode buttons based on `state.hasModel`, `state.hasSplat`, `state.hasPointcloud`, `state.hasStl`. Update button visibility when assets load/unload.

### 1.5 Active Display Mode Indicator

**Current:** No visual indication of which display mode is selected.

**Fix:** Add `.active` class styling to the current display mode button. Update on mode change.

### 1.6 Background Color

**Current:** Industrial theme CSS sets `--kiosk-scene-bg: #535353` but the kiosk HTML has an inline radial gradient on the canvas container that may override it.

**Fix:** Verify theme background is applied at runtime. Remove or override the inline gradient for industrial theme. Consider a subtle MeshLab-style radial gradient (lighter center, darker edges) on the #535353 base.

## Phase 2: Core Inspection Tools

### 2.1 Cross-Section Controls (Info Panel Section)

When slice tool is active, show in info panel:
- Axis presets: X / Y / Z buttons to snap plane normal
- Position slider: 0–100% along active axis
- Flip button: reverse clip direction
- Mode toggle: translate / rotate gizmo
- Reset button: re-center plane

Core logic already exists in `CrossSectionTool` — this is UI wiring in layout.js.

### 2.2 Properties & Mesh Info Panel

Populate the info panel with comprehensive mesh data:
- **Geometry stats:** vertex count, face count, edge count, bounding box dimensions (in calibrated units), watertight (yes/no)
- **Texture info:** resolution, format (JPG/PNG), UV coverage %, number of texture maps
- **File info:** file size (MB), format (OBJ/GLB/STL), compression type (Draco/Meshopt/none), original filename
- **Quality indicators:** non-manifold edge count, degenerate face count, duplicate vertex count, normal consistency (%)
- **Scan metadata:** from archive manifest (accuracy, scan date, device, operator)

Geometry analysis runs once on load, cached per asset. Quality checks are compute-heavy — run on demand or lazily.

### 2.3 Layers Panel (Tree Structure)

MeshLab-style layer list in the info panel:
- Top-level entries per loaded asset (mesh, splat, point cloud, flight path)
- Expandable sub-meshes for GLB files (traverse `modelGroup.children`)
- Per-layer: visibility eye toggle, selection highlight, name
- Right-click context menu: zoom-to, isolate, show properties
- Selected layer's properties shown in the properties section below

## Phase 3: QA Workflow

### 3.1 Annotation + Defect Marking

Extend annotation schema with QA fields:
```typescript
interface DefectAnnotation extends Annotation {
  severity?: 'low' | 'medium' | 'high' | 'critical';
  category?: 'surface_defect' | 'gap' | 'missing_data' | 'scan_artifact' | 'dimensional_variance' | 'other';
  status?: 'pass' | 'fail' | 'review';
  notes?: string;
}
```

UI in info panel when annotation tool is active:
- Title field
- Description field
- Severity dropdown (color-coded: green/yellow/orange/red)
- Category dropdown
- Pass/Fail/Review status toggle
- Save button → persists to archive manifest
- Annotation list with jump-to-view, edit, delete

Export: defect summary as CSV (annotation title, severity, category, status, coordinates).

## Phase 4: Professional Polish

- **Coordinate readout:** Live XYZ position under cursor in status bar
- **Orthographic view presets:** Top/Front/Right/ISO buttons (View menu or toolbar)
- **View cube:** Small orientation cube in viewport corner (Fusion 360-style)
- **Selection highlighting:** Click face to highlight + show face normal/index
- **Normals visualization:** Toggle face/vertex normal arrows
- **Screenshot with annotations:** Composite capture including visible annotation markers

Each feature is independent and can be prioritized individually.

## Files Affected

**Phase 1 (primary):**
- `src/themes/industrial/layout.js` — bug fixes, toolbar cleanup, conditional buttons
- `src/themes/industrial/layout.css` — active mode indicator styling
- `src/themes/industrial/theme.css` — background verification

**Phase 2:**
- `src/themes/industrial/layout.js` — cross-section UI, layers panel, properties panel
- `src/themes/industrial/layout.css` — new panel styles
- New module: `src/modules/mesh-inspector.ts` — geometry analysis, quality checks

**Phase 3:**
- `src/types.ts` — DefectAnnotation type extension
- `src/modules/annotation-system.ts` — defect field support
- `src/themes/industrial/layout.js` — annotation editing UI
- `src/modules/kiosk-main.ts` — annotation save/load with defect fields

**Phase 4:**
- `src/themes/industrial/layout.js` — view cube, ortho presets, coordinate readout
- `src/modules/scene-manager.ts` — orthographic camera support
