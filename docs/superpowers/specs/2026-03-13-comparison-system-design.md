# Comparison System Design Spec

**Date:** 2026-03-13
**Status:** Draft
**Scope:** Before/after temporal comparison for scene-level and annotation-level models

## Overview

A comparison system for Vitrine3D that lets users view the same physical subject at two different points in time — before and after restoration, construction progress, damage assessment, etc. Comparisons work at two levels:

1. **Scene-level** — two meshes already loaded in the archive (e.g., `mesh_0` and `mesh_1`) are paired as a before/after comparison
2. **Annotation-level** — an annotation's detail model gets a companion "comparison" detail model, viewed together in an overlay

Both levels share the same `ComparisonViewer` module and kiosk UI. Everything lives in a single archive. Only GLB meshes are supported as comparison assets.

## Data Model

### Types (`src/types.ts`)

```typescript
interface ComparisonSide {
  asset_key: string;        // archive key: "mesh_0", "detail_0", etc.
  label?: string;           // e.g., "Pre-Restoration"
  date?: string;            // ISO date: "2025-11-15"
  description?: string;     // markdown
}

interface ComparisonPair {
  id: string;               // "comparison_0"
  before: ComparisonSide;
  after: ComparisonSide;
  alignment?: Transform;  // reuses existing Transform interface from types.ts
  default_mode?: 'side-by-side' | 'slider' | 'toggle';
}
```

### Annotation Extension

Annotations gain two optional fields:

```typescript
interface Annotation {
  // ...existing fields...
  comparison_asset_key?: string;  // second detail model key for comparison
  comparison?: {
    before_label?: string;
    before_date?: string;
    before_description?: string;
    after_label?: string;
    after_date?: string;
    after_description?: string;
    alignment?: Transform;  // reuses existing Transform interface
    default_mode?: 'side-by-side' | 'slider' | 'toggle';
  };
}
```

When both `detail_asset_key` and `comparison_asset_key` are present, the annotation is a comparison. `detail_asset_key` is the "before" model, `comparison_asset_key` is the "after."

## Archive Format

### Scene-Level

Scene-level comparisons reference existing mesh assets — no new key prefix needed. A new `comparisons` array in the manifest defines pairs:

```json
{
  "data_entries": {
    "mesh_0": { "file_name": "assets/mesh_0.glb", "role": "mesh" },
    "mesh_1": { "file_name": "assets/mesh_1.glb", "role": "mesh" }
  },
  "comparisons": [
    {
      "id": "comparison_0",
      "before": { "asset_key": "mesh_0", "label": "November 2025", "date": "2025-11-15" },
      "after": { "asset_key": "mesh_1", "label": "March 2026", "date": "2026-03-01", "description": "Post-restoration scan" },
      "alignment": { "position": { "x": 0, "y": 0, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": 1 },
      "default_mode": "slider"
    }
  ]
}
```

This keeps the mesh assets as normal loadable meshes, compatible with future multi-model loading. The comparison is a relationship between them, not a separate asset type.

### Annotation-Level

Annotation-level comparisons use existing `detail_N` keys. The comparison model is stored as the next available `detail_N` key:

```json
{
  "data_entries": {
    "detail_0": { "file_name": "assets/detail_0.glb", "role": "detail" },
    "detail_1": { "file_name": "assets/detail_1.glb", "role": "detail" }
  },
  "annotations": [
    {
      "id": "anno_1",
      "title": "Column Capital",
      "detail_asset_key": "detail_0",
      "comparison_asset_key": "detail_1",
      "comparison": {
        "before_label": "Before Cleaning",
        "after_label": "After Cleaning",
        "before_date": "2025-11-15",
        "after_date": "2026-03-01",
        "default_mode": "side-by-side"
      }
    }
  ]
}
```

### Backward Compatibility

- Old archives (no `comparisons` array, no `comparison_asset_key`): fully compatible, no UI changes
- New archives opened in old Vitrine3D: unknown manifest fields ignored, meshes and detail models load normally

## ComparisonViewer Module

### File: `src/modules/comparison-viewer.ts`

A new full-screen overlay module following the same pattern as `DetailViewer`. It manages its own single renderer, two scenes, cameras, and animation loop — fully isolated from the main scene.

### Deps Interface

```typescript
interface ComparisonViewerDeps {
  parentRenderLoop: { pause: () => void; resume: () => void };
  theme: string | null;
  isEditor: boolean;
  parentBackgroundColor?: string;
}
```

Blobs are passed directly to `open()` — the caller (kiosk-main or main.ts) is responsible for extracting them before opening the viewer. This keeps the viewer focused on rendering, not asset management.

### Internal Architecture

```
ComparisonViewer
  ├── renderer (WebGLRenderer)      // single renderer, single canvas
  │
  ├── sceneA (THREE.Scene)          // "before" model + lighting
  │   ├── cameraA (PerspectiveCamera)
  │   └── controlsA (OrbitControls)
  │
  ├── sceneB (THREE.Scene)          // "after" model + lighting
  │   ├── cameraB (PerspectiveCamera)
  │   └── controlsB (OrbitControls)
  │
  ├── mode: 'side-by-side' | 'slider' | 'toggle'
  ├── syncCameras: boolean (default true)
  └── animationLoop (own requestAnimationFrame)
```

A single `WebGLRenderer` renders both scenes using `setViewport()` and `setScissor()` — the same canvas serves all three modes. This avoids creating extra WebGL contexts (browsers limit to 8-16 per page; the main scene already uses 2). Two independent `THREE.Scene` objects with their own lighting (matching DetailViewer's neutral environment preset). The main scene's renderers are paused during overlay display.

### Viewing Modes

**Side-by-side:**
- Single canvas, split into left/right halves using `setViewport()` + `setScissor()`
- Each frame: render sceneA into left half, clear scissor, render sceneB into right half
- When `syncCameras` is true, orbiting either side updates the other's camera to match (active side = leader)
- Labels above each viewport region; date badges and expandable description below (only shown if populated)
- OrbitControls for each side receive pointer events based on which half was clicked

**Slider/curtain:**
- Single canvas, two-pass rendering with scissor clipping at the divider position
- Pass 1: render sceneA (before) with scissor set to left of divider
- Pass 2: render sceneB (after) with scissor set to right of divider
- Vertical divider with centered grab handle, draggable via mouse/touch
- Keyboard: left/right arrows move divider; Home/End snap to 0%/100%
- Single camera (cameraA), single controls instance — cameraB synced each frame

**Toggle/crossfade:**
- Single canvas, renders one scene at a time (instant toggle) or both with opacity blending
- Crossfade: render sceneA at full opacity, then render sceneB with `renderer.autoClear = false` and reduced material opacity. Note: material opacity may cause z-fighting with complex PBR materials — if artifacts occur, fall back to instant toggle or a screen-space fade overlay
- Toggle button or Space key for instant swap (reliable fallback — no opacity issues)
- Optional auto-crossfade animation (slow oscillation)
- Single camera (cameraA), cameraB synced

### Camera Sync (Side-by-Side)

- The canvas the user last interacted with is the "leader"
- Each frame: follower camera copies leader's position, quaternion, and controls target
- Sync toggle button in the toolbar — when off, each side orbits independently
- Visual indicator (link/unlink icon) shows sync state

### Alignment Application

When a comparison pair has an `alignment` transform, the "after" model's root group receives the stored position/rotation/scale before rendering. This is critical for slider and toggle modes (models must overlap); side-by-side works with or without alignment.

### Lifecycle

```
open(config, beforeBlob, afterBlob)
  → pause parent render loop
  → show overlay (fade in)
  → load both GLBs in parallel with per-side progress
  → apply alignment transform to "after" model
  → fit camera to encompass both models
  → start own animation loop

close()
  → stop animation loop
  → dispose renderers, geometries, materials, textures
  → hide overlay
  → resume parent render loop
```

## Kiosk UI

### Scene-Level Entry

A "Compare" button in the kiosk toolbar. Only visible when the manifest has `comparisons` with at least one entry. Clicking it extracts both mesh blobs (lazy, on demand) and opens the ComparisonViewer overlay.

### Annotation-Level Entry

When an annotation has both `detail_asset_key` and `comparison_asset_key`, the annotation popup's "Inspect" button becomes "Compare" (or the custom `detail_button_label`). Clicking opens ComparisonViewer instead of DetailViewer.

Annotations with only `detail_asset_key` (no comparison) open DetailViewer as today — no behavior change.

### Overlay Layout

```
┌──────────────────────────────────────────────────────┐
│  [← Back]     "Facade Restoration"    [≡] [⫼] [⇄]  │  header
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────┐ ┌────────────────────┐      │
│  │                    │ │                    │      │  side-by-side
│  │   Before Model     │ │   After Model      │      │  viewports
│  │                    │ │                    │      │
│  └────────────────────┘ └────────────────────┘      │
│   "Nov 2025"              "Mar 2026"                 │  labels
│                                                      │
├──────────────────────────────────────────────────────┤
│  [🔗 Sync]              [crossfade ━━●━━━━]         │  toolbar
└──────────────────────────────────────────────────────┘
```

**Header bar:**
- Back button — closes overlay, returns to main scene / annotation
- Title — comparison label or annotation title
- Mode switcher — three icons for side-by-side, slider, toggle; active mode highlighted
- Mode choice persisted in sessionStorage

**Toolbar (contextual per mode):**
- Side-by-side: camera sync toggle
- Slider: (no extra controls — divider is the interaction)
- Toggle: crossfade slider + toggle button + auto-crossfade button

**Metadata display:**
- Labels, dates, descriptions shown only if populated
- Side-by-side: metadata below each viewport
- Slider/toggle: labels on each side of the divider or as overlay text

### Theme Integration

The overlay inherits the active theme's color scheme via CSS custom properties (background, fonts, accent colors). No theme-specific layout overrides initially — the overlay is self-contained.

### Responsive / Mobile

- Slider divider: touch-draggable
- Side-by-side camera sync: touch orbit on either canvas syncs
- Toggle: swipe left/right as crossfade alternative
- Narrow screens (< 640px): side-by-side switches to stacked vertical layout (before on top, after on bottom)

## Editor Workflow

### Scene-Level Comparison Panel

A new collapsible "Comparison" section in the editor sidebar. Only appears when 2+ meshes are loaded.

```
┌─ Comparison ────────────────────────┐
│                                      │
│  Before: [mesh_0 ▾] "facade.glb"    │
│    Label: [Pre-Restoration      ]    │
│    Date:  [2025-11-15           ]    │
│    Desc:  [                     ]    │
│                                      │
│  After:  [mesh_1 ▾] "facade_r.glb"  │
│    Label: [Post-Restoration     ]    │
│    Date:  [2026-03-01           ]    │
│    Desc:  [After cleaning and...]    │
│                                      │
│  Default mode: [Side-by-side ▾]      │
│                                      │
│  [Align Models]  [Preview Compare]   │
└──────────────────────────────────────┘
```

- Before/After dropdowns list available mesh keys with filenames
- Metadata fields (label, date picker, description textarea) — all optional
- Default mode selector
- "Align Models" opens alignment view
- "Preview Compare" opens ComparisonViewer with current settings

When only one mesh is loaded: section shows "Load a second mesh to enable comparisons."

### Annotation-Level Comparison Setup

Extends the existing detail model section in the annotation sidebar:

```
┌─ Detail Model ──────────────────────┐
│  [Attach .glb]  facade_detail.glb   │
│  Button Label: [Inspect Detail   ]  │
│  [Preview in Detail Viewer]          │
│                                      │
│  ┌─ Comparison ──────────────────┐  │
│  │  [Attach comparison .glb]      │  │
│  │  facade_after.glb  [Remove]    │  │
│  │                                │  │
│  │  Before label: [Before      ]  │  │
│  │  Before date:  [2025-11-15  ]  │  │
│  │  After label:  [After       ]  │  │
│  │  After date:   [2026-03-01  ]  │  │
│  │  Default mode: [Slider ▾]      │  │
│  │                                │  │
│  │  [Align]  [Preview Compare]    │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

Comparison sub-section only appears when a detail model is already attached. Attaching a comparison model:
1. Stores it as the next available `detail_N` key in the archive
2. Sets `comparison_asset_key` on the annotation
3. Changes button label default from "Inspect" to "Compare"

### Alignment Tool

When "Align Models" is clicked:

- Opens ComparisonViewer in editor mode (side-by-side)
- "Before" model is locked (reference frame)
- "After" model has transform gizmo controls (translate, rotate, scale) — creates its own `TransformControls` instance within the overlay's scene/camera (does not reuse the main scene's `TransformController` instance, but follows the same pattern)
- "Fit to Before" button attempts auto-alignment using existing ICP algorithm from `alignment.ts`
- "Save Alignment" writes the transform to the comparison's `alignment` field
- "Reset" reverts to identity transform

### Archive Export

`archive-creator.ts` changes:
- Scene-level: serialize `comparisons` array to manifest. Meshes are already stored as `mesh_0`, `mesh_1` — no extra asset handling.
- Annotation-level: `comparison_asset_key` and `comparison` metadata serialized as part of annotation JSON (same pattern as existing `detail_asset_key` / `detail_view_settings`).
- Orphan cleanup: extend `_cleanOrphanedDetailModels()` to also check `comparison_asset_key` references. Specifically, add `if (anno.comparison_asset_key) referencedKeys.add(anno.comparison_asset_key);` to the annotation loop.

## Scene-Level Mesh Loading Behavior

When a comparison is defined in the manifest, only the "before" mesh (e.g., `mesh_0`) is loaded into the main scene on archive open. The "after" mesh (e.g., `mesh_1`) is extracted on demand when the Compare button is clicked. This avoids doubling mesh memory in the main scene and prevents visual confusion from having both models visible simultaneously. Future multi-model loading may change this behavior, but for comparisons specifically, lazy loading the second mesh is the right default.

When multiple comparisons exist in the manifest, the UI uses the first entry (`comparisons[0]`). Future work may add a picker.

## Error Handling & Edge Cases

### Loading Failures
- If one model fails to load, show the successful model full-screen with a banner: "Could not load [before/after] model"
- Loading progress shows per-side with individual progress indicators

### Memory
- Two GLB models loaded simultaneously. No special mitigation needed — GLB detail models are typically < 50MB each
- Full disposal on `close()`: geometries, materials, textures, renderers

### Missing Alignment
- Slider and toggle modes show a subtle warning badge if no alignment transform is set: "Models may not be aligned"
- Side-by-side mode does not warn (alignment is irrelevant)

### Backward Compatibility
- Archives without `comparisons` or `comparison_asset_key`: no compare button, no comparison panel. Zero impact on existing workflows.
- New archives in old Vitrine3D: unknown manifest fields ignored. Mesh and detail assets load normally as regular assets.

### Mobile / Touch
- Slider divider: touch-draggable
- Side-by-side: touch orbit syncs cameras
- Toggle: swipe left/right as crossfade alternative
- Narrow screens (< 640px): side-by-side switches to stacked vertical (before top, after bottom)

## Files to Create

| File | Purpose |
|------|---------|
| `src/modules/comparison-viewer.ts` | Core comparison viewer module |

## Files to Modify

| File | Changes |
|------|---------|
| `src/types.ts` | Add `ComparisonPair`, `ComparisonSide` interfaces; extend `Annotation` with `comparison_asset_key` and `comparison` fields; extend `AppState` if needed |
| `src/editor/index.html` | Add comparison panel in sidebar; add comparison overlay DOM structure; extend annotation detail section |
| `src/index.html` | Add compare button to kiosk toolbar; add comparison overlay DOM structure |
| `src/styles.css` | Comparison overlay styles, slider, side-by-side layout, mode switcher, responsive breakpoints |
| `src/modules/archive-creator.ts` | Serialize `comparisons` to manifest; serialize annotation comparison fields; extend orphan cleanup |
| `src/modules/archive-loader.ts` | Parse `comparisons` from manifest |
| `src/modules/archive-pipeline.ts` | Extract and index comparison assets on archive load |
| `src/modules/annotation-system.ts` | Serialize/deserialize `comparison_asset_key` and `comparison` fields. `toJSON()` must explicitly enumerate new fields: `if (a.comparison_asset_key) obj.comparison_asset_key = a.comparison_asset_key; if (a.comparison) obj.comparison = { ...a.comparison };` |
| `src/modules/metadata-manager.ts` | Render "Compare" button instead of "Inspect" when comparison exists. Note: kiosk annotation popup rendering in `kiosk-main.ts` also decides button label/click behavior — both locations must check for `comparison_asset_key` |
| `src/modules/event-wiring.ts` | Wire comparison panel UI events in editor |
| `src/modules/kiosk-main.ts` | Wire kiosk compare button; lazy-import ComparisonViewer |
| `src/main.ts` | Wire editor comparison panel; create ComparisonViewer deps factory; update annotation popup for comparisons. **Important:** `main.ts` has local copies of `showAnnotationPopup` that do NOT delegate to `metadata-manager.ts` — the "Compare" vs "Inspect" button logic must be updated in both `main.ts`'s local copy and `metadata-manager.ts`'s version |

## Non-Goals (Explicit Exclusions)

- Comparing non-GLB asset types (splats, point clouds, CAD)
- Multiple scene-level comparisons per archive (data model supports it, UI limited to one for now)
- Nested annotations within comparison models
- Measurement tools within the comparison viewer
- Timeline view (3+ temporal snapshots)
