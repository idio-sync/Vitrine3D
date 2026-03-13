# View Defaults Settings — Design Spec

**Date:** 2026-03-10
**Status:** Approved

## Overview

Add archive-embeddable view default settings for SFM cameras and flight paths. These settings control initial visibility and display parameters when an archive is loaded, and are saved into the `.ddim` manifest so the archive author controls the default viewer experience.

## UI Layout

Settings live in the **Defaults tab** of the View Settings pane (`pane-view-settings` → `vs-tab-defaults`).

### SFM Camera Settings (new section)

New collapsible section in `vs-tab-defaults`, placed adjacent to the existing Drone Flight section. Starts `display:none` with `archived` class — shown when SFM camera data is loaded.

Controls:
- **Show on load** — checkbox, off by default
- **Display mode** — dropdown: Frustums | Markers (default: Frustums)

### Drone Flight (existing section, extended)

Already exists at `#drone-flight-section` with `display:none` and `archived` class — shown when flight path data is loaded. Existing controls preserved; new controls added:

Existing controls:
- Path Color — dropdown (Speed / Altitude / Climb Rate)
- Show Takeoff / Landing Markers — checkbox
- Show Direction Indicators — checkbox

New controls added:
- **Show on load** — checkbox, off by default
- **Line color** — color picker (default: `#00ffff` cyan)
- **Line opacity** — slider 0–100% (default: 100%)
- **Show markers** — checkbox, on by default
- **Marker density** — three-option selector: Off | Sparse | All (default: All). Disabled when "Show markers" is unchecked.

## Manifest Schema

New `viewDefaults` key in the `.ddim` manifest JSON:

```json
{
  "viewDefaults": {
    "sfmCameras": {
      "visible": false,
      "displayMode": "frustums"
    },
    "flightPath": {
      "visible": false,
      "lineColor": "#00ffff",
      "lineOpacity": 1.0,
      "showMarkers": true,
      "markerDensity": "all"
    }
  }
}
```

### Load behavior
- If `viewDefaults` is present: apply values, update UI controls, set initial visibility
- If `viewDefaults` is absent (legacy archives): fall back to current behavior (both visible on load, default styles)
- Overlay pill toggles still work at runtime as overrides

### Export behavior
- `archive-creator.ts` reads current UI control values and writes them into the manifest under `viewDefaults`

### Marker density values
- `"off"` — no markers rendered
- `"sparse"` — targets ~200 markers regardless of total point count
- `"all"` — every data point gets a marker

## Data Flow

### Editor (write path)
1. UI controls in `editor/index.html` as standard form elements
2. `event-wiring.ts` binds change listeners that update `state.viewDefaults`
3. On export, `createExportDeps()` includes `state.viewDefaults` → `archive-creator.ts` writes to manifest

### Editor (read path — loading archive)
1. `archive-pipeline.ts` reads `manifest.viewDefaults` during archive load
2. Applies to `state.viewDefaults` and updates UI controls
3. Sets initial visibility of `colmapGroup` and `flightPathGroup`
4. Passes styling params to `FlightPathManager` and `displayMode` to `ColmapManager`

### Kiosk (read path)
1. `kiosk-main.ts` reads `manifest.viewDefaults`
2. Applies initial visibility (data still loaded, scene group starts hidden if `visible: false`)
3. Applies flight path styling (color, opacity, marker density)
4. Toggle buttons still work for runtime overrides

### Section visibility
Both sections start `display:none`. Shown when respective data is loaded — same trigger points that currently call `updateOverlayPill()`. Overlay pill behavior unchanged (shows based on data being *loaded*, not *visible*).

## Type Definition

New on `AppState`:

```typescript
interface ViewDefaults {
  sfmCameras: {
    visible: boolean;
    displayMode: 'frustums' | 'markers';
  };
  flightPath: {
    visible: boolean;
    lineColor: string;
    lineOpacity: number;
    showMarkers: boolean;
    markerDensity: 'off' | 'sparse' | 'all';
  };
}
```

Added as `viewDefaults: ViewDefaults` on `AppState`. Initialized with defaults (both `visible: false`, etc.) at app startup.

## Files to Modify

| File | Change |
|------|--------|
| `src/types.ts` | Add `ViewDefaults` type and `viewDefaults` property to `AppState` |
| `src/editor/index.html` | Add SFM Camera Settings section; extend Drone Flight section with new controls |
| `src/styles.css` | Minimal styling for new controls (reuse existing patterns) |
| `src/modules/event-wiring.ts` | Bind change listeners for new controls, update `state.viewDefaults` |
| `src/modules/archive-pipeline.ts` | Read `viewDefaults` from manifest, apply to state + scene groups |
| `src/modules/archive-creator.ts` | Write `state.viewDefaults` into manifest |
| `src/modules/flight-path.ts` | Add `setLineColor()`, `setLineOpacity()`, `setMarkerDensity()` methods |
| `src/modules/kiosk-main.ts` | Read `viewDefaults` from manifest, apply on load |
| `src/main.ts` | Initialize `state.viewDefaults` with defaults, show/hide sections on data load |

### Files NOT modified
- `colmap-loader.ts` — already has `setDisplayMode()` and `setVisible()`
- `ui-controller.ts` — overlay pill logic unchanged
- Themes — no theme-specific overrides needed
