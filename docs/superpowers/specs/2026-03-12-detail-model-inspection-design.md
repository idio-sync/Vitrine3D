# Detail Model Inspection via Annotations

**Date:** 2026-03-12
**Status:** Design Spec
**Feature Area:** Annotations, Viewer, Archive

---

## Overview

Annotations in Vitrine3D can link to standalone mesh models (GLB) that open in a dedicated overlay viewer for close-up inspection. For example, a building model could have annotations on ornate stonework that, when clicked, load a high-detail model of that specific element in its own view space. (OBJ support is deferred to a future iteration — OBJ requires handling MTL material files and texture dependencies which are out of scope for v1.)

The detail viewer is a full-screen overlay with its own Three.js renderer, scene, camera, and controls — completely isolated from the parent scene. The parent renderer is paused (not destroyed) while the detail view is active, keeping GPU buffers alive for instant resume.

One level of text-only annotations is supported within the detail view. Detail annotations cannot link to further detail models (no recursion).

---

## Data Model

### Annotation Interface Extension (`src/types.ts`)

The existing `Annotation` interface gains these optional fields:

```typescript
export interface Annotation {
    // ... existing fields (id, title, body, position, camera_target, camera_position,
    // camera_quaternion, severity, category, status, qa_notes) ...

    // Detail model link
    detail_asset_key?: string;            // e.g. "detail_0" — references archive asset
    detail_button_label?: string;         // e.g. "View Stonework" (default: "Inspect Detail")
    detail_thumbnail?: string;            // e.g. "images/detail_0_thumb.png"
    detail_annotations?: Annotation[];    // one-level-deep annotations for the detail model
    detail_view_settings?: DetailViewSettings;
}
```

### DetailViewSettings Interface

```typescript
export interface DetailViewSettings {
    // Camera constraints
    min_distance?: number;
    max_distance?: number;
    min_polar_angle?: number;          // radians
    max_polar_angle?: number;          // radians
    enable_pan?: boolean;              // default: true
    auto_rotate?: boolean;             // default: false
    auto_rotate_speed?: number;        // degrees/sec, default: 2
    damping_factor?: number;           // orbit smoothness
    zoom_to_cursor?: boolean;          // default: false

    // Initial camera
    initial_camera_position?: { x: number; y: number; z: number };
    initial_camera_target?: { x: number; y: number; z: number };

    // Display
    background_color?: string;         // hex color, default: neutral dark
    environment_preset?: 'studio' | 'outdoor' | 'neutral' | 'warm'; // default: 'neutral'
    ambient_intensity?: number;
    show_grid?: boolean;               // default: false

    // Presentation
    description?: string;              // shown in header/sidebar
    scale_reference?: string;          // e.g. "~30cm wide"

    // Annotation behavior
    annotations_visible_on_open?: boolean; // default: true
}
```

### Archive Asset Type

- Key prefix: `detail_`
- Archive path: `assets/detail_0.glb`, etc.
- Role: `'detail'`
- Supported formats: **GLB only** for v1 (self-contained format). OBJ support (MTL + texture dependencies) is deferred to a future iteration.
- Thumbnails stored as: `images/detail_N_thumb.png`

### Manifest Example

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
      "detail_button_label": "View Stonework",
      "detail_thumbnail": "images/detail_0_thumb.png",
      "detail_view_settings": {
        "environment_preset": "warm",
        "auto_rotate": true,
        "scale_reference": "~30cm wide",
        "description": "Corinthian capital, west facade, second floor"
      },
      "detail_annotations": [
        {
          "id": "detail_anno_1",
          "title": "Hairline Crack",
          "body": "Visible crack running NE to SW...",
          "position": { "x": 0.1, "y": 0.5, "z": -0.2 },
          "camera_target": { "x": 0.1, "y": 0.5, "z": -0.2 },
          "camera_position": { "x": 0.5, "y": 0.8, "z": 0.3 }
        }
      ]
    }
  ]
}
```

---

## Archive Storage & Loading

### Storage Organization

Detail models follow the existing asset pattern but are **lazy-loaded**. The archive pipeline extracts them from the ZIP only when a user clicks "Inspect."

### Export Flow (`archive-creator.ts`)

1. Detail model files added to ZIP under `assets/detail_N.ext`
2. Thumbnails (if present) added under `images/detail_N_thumb.png`
3. `data_entries` in manifest gets entries with `role: 'detail'`
4. `detail_annotations` serialized inline on parent annotations
5. Detail models have their own collection in the archive creator (not part of the main scene)

### Import Flow (`archive-loader.ts` / `archive-pipeline.ts`)

1. On archive load, pipeline reads `data_entries` and sees `role: 'detail'` entries
2. Does **not** load them immediately — unlike meshes/splats which load during phase 1
3. Builds a `detailAssetIndex`: metadata map of `detail_asset_key → { filename }`
4. When user clicks "Inspect Detail", uses the archive loader's existing `extractFile()` API to pull just the needed entry from the archive
5. Creates blob URL, passes to detail viewer

### Why Lazy Loading

Detail models could be large (high-poly ornate stonework). Loading all upfront wastes memory and slows initial archive load. Users may never inspect most of them.

### State Additions (`AppState` in `types.ts`)

```typescript
detailAssetIndex: Map<string, { filename: string }>; // key → archive filename, rebuilt on archive load
loadedDetailBlobs: Map<string, string>;              // key → blob URL (cache for revisits)
```

**Note:** These Maps are runtime-only state, not serialized. They are rebuilt on archive load and cleared on archive close.

---

## Editor Workflow

### Inline Import (Primary Path)

1. User places an annotation or selects an existing one
2. Annotation panel shows "Attach Detail Model" section below body textarea
3. If no detail model linked: file picker button ("Choose Detail Model (.glb)")
4. User picks file → stored in archive creator's detail collection with next key (`detail_0`, etc.)
5. Annotation's `detail_asset_key` set to that key
6. "Customize" section appears:
   - Button label text input (placeholder: "Inspect Detail")
   - "Preview in Detail Viewer" button → opens overlay for inspection, camera setup, and detail annotation placement
   - "Capture Thumbnail" button (inside detail viewer) → screenshots current view. Captured thumbnail is rendered to an offscreen canvas via `renderer.domElement.toDataURL()`, stored as a PNG blob in the archive creator's image collection under `images/detail_N_thumb.png`, and the path is saved to `annotation.detail_thumbnail`.

### Pre-Import (Convenience)

- "Detail Models" section in editor sidebar lists all imported detail models by filename
- User can import models here ahead of time
- When editing an annotation, "Attach" shows dropdown of already-imported models

### Detail Model View Settings (Editor)

When the detail viewer overlay is open in editor mode, a collapsible "View Settings" panel provides:

- Sliders for distance limits, polar angle limits
- Toggles for pan, auto-rotate, grid, zoom-to-cursor
- "Set Current View as Initial" button — captures camera position/target
- Environment preset selector (studio / outdoor / neutral / warm)
- Background color picker
- Description text input
- Scale reference text input
- All settings live-previewed

### What the Editor Does NOT Do

- Detail models are never added to the main 3D scene
- No transform gizmo for detail models
- No alignment tools for detail models

---

## Detail Viewer Overlay

### New Module: `src/modules/detail-viewer.ts`

Self-contained module encapsulating the entire overlay lifecycle. Uses the deps pattern.

### DOM Structure (both `index.html` and `editor/index.html`)

```html
<div id="detail-viewer-overlay" class="hidden">
    <div class="detail-viewer-header">
        <button id="btn-detail-back" class="detail-back-btn">← Back</button>
        <span class="detail-viewer-title"></span>
        <span class="detail-viewer-scale"></span>
    </div>
    <canvas id="detail-viewer-canvas"></canvas>
    <div id="detail-annotation-markers"></div>
    <div id="detail-annotation-popup" class="hidden">...</div>
    <!-- Editor-only: view settings panel, annotation tools, thumbnail capture -->
</div>
```

### Lifecycle

**Open** — `openDetailViewer(annotation, assetBlob, isEditor)`:

- Fade in overlay (covers full viewport, ~300ms transition)
- Pause parent renderer (`cancelAnimationFrame`)
- Create new `THREE.WebGLRenderer` on `#detail-viewer-canvas`
- Create `Scene`, `PerspectiveCamera`, `OrbitControls`
- Apply `DetailViewSettings` constraints to controls
- Set up lighting based on `environment_preset`
- Load mesh from blob URL (GLB via `GLTFLoader`; OBJ deferred to future iteration)
- Fit camera to bounding box (or use `initial_camera_position` if set)
- If `detail_annotations` exist, create scoped `AnnotationSystem` instance
- Start own `requestAnimationFrame` loop
- Show `description` and `scale_reference` in header

**Interact** — while open:

- Orbit/pan/zoom with applied constraints
- Click detail annotation markers → popup
- Editor: place/edit detail annotations, adjust view settings, capture thumbnail

**Close** — `closeDetailViewer()`:

- Stop detail render loop
- Dispose renderer, scene, geometries, materials, textures
- Revoke blob URL (unless cached for reuse)
- Hide overlay
- Resume parent renderer
- Editor: save changes to `detail_annotations` and `detail_view_settings` back to parent annotation

### Transition

Overlay fades in over ~300ms. Parent scene's last frame visible behind semi-transparent backdrop during fade for spatial continuity.

### Memory Cleanup

Explicit disposal of all Three.js objects on close. Module tracks everything for teardown — no leaks between open/close cycles. Renderer context explicitly destroyed via `renderer.dispose()` and `renderer.forceContextLoss()`.

### Deps Interface

```typescript
export interface DetailViewerDeps {
    archiveLoader: { extractDetailAsset(key: string): Promise<Blob> };
    parentRenderLoop: { pause(): void; resume(): void };
    theme: string | null;
    isEditor: boolean;
    imageAssets: Map<string, string>;
    onDetailAnnotationsChanged?: (annotations: Annotation[]) => void;
}
```

---

## Kiosk Viewing UX

### Annotation Popup Integration

When an annotation has a linked detail model:

1. **Thumbnail preview** — if `detail_thumbnail` exists, shown as a clickable image below the annotation body with a subtle "inspect" icon overlay
2. **Inspect button** — prominent CTA showing `detail_button_label` (default: "Inspect Detail"). Styled as a solid button.
3. **Marker badge** — annotation markers with detail models get a small magnifying glass icon badge on the numbered circle

### Interaction Flow

```
User clicks marker → popup with thumbnail + "View Stonework" button
    ↓
User clicks button → loading spinner
    ↓
Detail asset extracted from archive via existing `extractFile()` API
    ↓
Detail viewer overlay fades in
    ↓
User inspects: orbit, zoom, click detail annotations
    ↓
"← Back" → overlay fades out, parent scene resumes
    ↓
Popup remains visible (same annotation selected)
```

### Mobile / Touch

- Full-screen overlay on all devices
- Touch orbit/pinch-zoom via OrbitControls
- Large touch target on back button (top-left)
- Detail annotation popups follow same mobile sizing rules

### Keyboard / Accessibility

- `Escape` closes detail viewer
- Back button is focusable
- Focus trapped while overlay is open. Focus trapping implemented by intercepting Tab/Shift+Tab key events within the overlay and cycling focus between interactive elements.

---

## Theme-Specific Layouts

### Editorial Theme

Editorial gets a sidebar-aware layout instead of a full-screen takeover:

```
┌──────────────────┬────────────────────────────────┐
│  ← Back          │                                │
│                  │                                │
│  Column Capital  │     [Detail 3D Viewer]         │
│  ─────────────── │                                │
│  Corinthian      │     (own renderer, own         │
│  capital, west   │      OrbitControls,             │
│  facade, 2nd fl  │      detail annotations)        │
│                  │                                │
│  ~30cm wide      │                                │
│                  │                                │
│  ─────────────── │                                │
│  Detail Notes:   │                                │
│  ① Hairline Crack│                                │
│  ② Erosion Mark  │                                │
│                  │                                │
└──────────────────┴────────────────────────────────┘
```

- Sidebar shows: back button, title, description, scale reference, detail annotation list
- 3D viewer fills the viewport area (right ~61.8%)
- Respects Editorial's title zone (95px top) and ribbon (48px bottom)

### Other Themes

- **Gallery** (cinematic full-bleed): Full-screen overlay with floating back button and info overlay
- **Exhibit** (institutional kiosk): Full-screen overlay with top bar for breadcrumb and scale
- **Minimal**: Full-screen overlay, minimal chrome

The detail viewer module accepts a `themeLayout` hint and adjusts positioning accordingly.

---

## Detail Annotations

### Scoping

The detail viewer creates its own `AnnotationSystem` instance, independent from the parent:

- Own marker numbering (starting at 1)
- Own popup positioning (relative to detail canvas)
- Own placement mode in editor
- No ID collisions with parent

### Storage

`detail_annotations: Annotation[]` on the parent annotation. Uses the same `Annotation` interface but:

- `detail_asset_key` always undefined (no nesting)
- `detail_thumbnail` always undefined
- `detail_button_label` always undefined
- Enforced by UI omission, not type restriction

### Editor Workflow

1. User opens detail viewer from an annotation
2. "Annotate" button in detail viewer toolbar
3. Same placement UX as parent: click surface → marker → fill title/body → save
4. Stored on parent annotation's `detail_annotations` array
5. Persisted on detail viewer close
6. Serialized inline in manifest on archive export

### Limitations (v1)

- Text-only body — image support in annotation bodies is planned for a future iteration
- No linked detail models (no recursion)
- No QA fields

---

## Environment Lighting Presets

| Preset | Description | Implementation |
|--------|-------------|----------------|
| `studio` | Even, soft lighting. Good for geometry inspection. | 2 hemisphere lights (warm/cool), 1 soft directional, high ambient |
| `outdoor` | Directional sunlight with sky fill. Reveals surface texture. | 1 strong directional (warm white), 1 hemisphere (sky/ground), lower ambient |
| `neutral` | Flat, even illumination. Maximum clarity. **Default.** | 1 ambient at full, 1 soft directional for gentle shadow |
| `warm` | Museum-style warm lighting. Emphasizes material warmth. | 2 warm directional lights, 1 warm ambient, subtle shadows |

All use Three.js built-in lights — no HDR environment maps. Shadows off by default for performance.

---

## Module Organization

### New Module

| Module | Purpose |
|--------|---------|
| `detail-viewer.ts` | `DetailViewer` class, overlay lifecycle, lighting presets, controls, theme-aware layout, thumbnail capture |

### Modified Modules

| Module | Change |
|--------|--------|
| `types.ts` | Add `DetailViewSettings` interface, extend `Annotation` with detail fields, add `detailAssetIndex` and `loadedDetailBlobs` to `AppState` |
| `annotation-system.ts` | **Required interface change:** `AnnotationSystem` constructor must accept an optional `containerElement` parameter (defaulting to `#annotation-markers` for existing behavior). The detail viewer passes `#detail-annotation-markers` as its container. Similarly, the annotation popup element must be configurable — the detail viewer uses `#detail-annotation-popup` instead of the default popup. Without this change, the second instance would reuse the parent's DOM container due to ID lookup. |
| `metadata-manager.ts` | `showAnnotationPopup()` renders thumbnail + inspect button when `detail_asset_key` present. **Note (dual-copy pattern):** Both `metadata-manager.ts` `showAnnotationPopup()` and the local copy of `showAnnotationPopup` in `main.ts` must render the inspect button. The kiosk popup in `kiosk-main.ts` also needs this. All three must be updated in parallel. |
| `archive-creator.ts` | Store `detail_N.ext` files and thumbnails, serialize detail data in manifest |
| `archive-loader.ts` | Build `detailAssetIndex` metadata on load, add `extractDetailAsset(key)` |
| `archive-pipeline.ts` | Index detail entries during phase 1 (metadata only, no extraction) |
| `file-handlers.ts` | Add `loadDetailMesh()` for detail viewer context |
| `event-wiring.ts` | Wire inspect button click → `openDetailViewer()` |
| `kiosk-main.ts` | Lazy import of `detail-viewer.ts`, wire inspect button |
| `main.ts` | Deps factory for detail viewer, pause/resume render loop. **Prerequisite:** Add stored rAF ID and `pauseRenderLoop()` / `resumeRenderLoop()` functions to the animation loop. Currently `animate()` calls `requestAnimationFrame(animate)` without saving the ID — this prerequisite change is needed before the detail viewer can pause/resume rendering. |
| `editor/index.html` | Detail model controls in annotation panel, overlay DOM |
| `index.html` | Detail viewer overlay DOM (kiosk, no editor controls) |
| `styles.css` | Overlay styles, inspect button, marker badge |
| Theme CSS files | Editorial sidebar-aware layout; minimal overrides for other themes |

### Untouched Modules

`scene-manager.ts`, `transform-controller.ts`, `alignment.ts`, `flight-path.ts`, `cad-loader.ts`, `share-dialog.ts`

---

## Error Handling & Edge Cases

### Loading Failures

- Detail asset extraction fails → error shown in overlay with "Close" button; parent remains recoverable
- Mesh parsing fails → same treatment

### Archive Compatibility

- Old archives without detail fields → annotations load normally, no inspect button. Zero impact.
- New archives in old viewers → unknown JSON fields ignored silently; detail assets sit as unreferenced ZIP entries. No breakage.

### Orphaned Detail Models

- Deleting an annotation with a linked detail model → orphaned detail asset excluded from the ZIP on next export

### Shared Detail Models

- Multiple annotations can reference the same `detail_asset_key`. Asset stored once, extracted once, blob URL cached in `loadedDetailBlobs`.

### WebGL Context Limits

- Detail viewer creates context #2. Parent is paused but alive. On close, detail context is explicitly destroyed via `renderer.dispose()` + `renderer.forceContextLoss()`.

### Editor with Loose Files (No Archive)

- Detail models imported via file picker → blob URLs used directly; no archive extraction needed.

### Mobile Memory

- Full disposal on close. No automatic mitigation for memory pressure — this is a content authoring concern.

---

## Acceptance Criteria

- [ ] Editor: user can import a GLB file and attach it to an annotation
- [ ] Editor: user can configure button label, capture thumbnail, set view settings
- [ ] Editor: user can place and edit text annotations on the detail model
- [ ] Editor: detail models are included in exported .ddim archives
- [ ] Kiosk: annotation popup shows inspect button and thumbnail when detail model is linked
- [ ] Kiosk: clicking inspect loads the detail model in the overlay viewer
- [ ] Kiosk: detail view respects all DetailViewSettings constraints
- [ ] Kiosk: detail annotations are visible and clickable in the overlay
- [ ] Kiosk: back button closes overlay and resumes parent scene
- [ ] Editorial theme: detail viewer uses sidebar-aware layout
- [ ] Backward compatibility: archives without detail models load without errors
- [ ] Backward compatibility: archives with detail models open in older viewers without errors
- [ ] Memory: detail viewer fully disposes all Three.js resources on close
- [ ] Memory: detail models are only loaded on demand, not at archive load time

---

## Future Work

- **OBJ support**: Load detail models from OBJ files (requires handling MTL material files and texture dependencies)
- **Detail annotation images**: Support `asset:images/` protocol in detail annotation bodies (currently text-only)
- **Additional asset types**: Expand beyond meshes to splats, point clouds, or CAD if use cases emerge
- **HDR environment maps**: Replace lighting presets with real HDR environments for higher fidelity
- **Detail model LOD**: Multiple resolution versions of detail models for bandwidth optimization
- **Nested detail models**: If use cases warrant deeper drill-down (currently hard-capped at one level)
