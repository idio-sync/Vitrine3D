# DJI Flight Path Import & Display — Design

**Date**: 2026-03-06
**Status**: Approved

## Summary

Import DJI flight logs into Vitrine3D archives and display drone flight paths as 3D lines over models/splats. Supports provenance documentation, scan coverage QA, and client presentation. Camera replay along flight path deferred to a future iteration.

## Requirements

- Import DJI flight logs in CSV, KML/KMZ, and SRT formats
- Parse GPS telemetry to local 3D coordinates
- Render as line + data point markers with hover telemetry tooltips
- Store raw flight log files in archives with transform data
- Support multiple flight logs per archive (`flightpath_0`, `flightpath_1`, ...)
- Manual alignment via existing transform gizmo
- Display in both editor and kiosk modes
- No new npm dependencies

## Data Model

### FlightPoint (internal representation)

```typescript
interface FlightPoint {
  x: number;        // local coords (converted from GPS)
  y: number;        // altitude mapped to Y-up
  z: number;        // local coords
  lat: number;      // original GPS latitude
  lon: number;      // original GPS longitude
  alt: number;      // altitude in meters
  timestamp: number; // ms since flight start
  speed?: number;    // m/s ground speed
  gimbalPitch?: number;
  gimbalYaw?: number;
  heading?: number;  // drone heading degrees
}
```

### GPS to Local Coordinate Conversion

First GPS point becomes origin `(0, 0, 0)`. Subsequent points converted via flat-earth approximation (sufficient for site-scale <1km distances):

```
dx = (lon - originLon) * cos(originLat) * 111320  // meters east
dz = (lat - originLat) * 111320                    // meters north
dy = alt - originAlt                                // meters up
```

### Manifest Entry

```json
"flightpath_0": {
  "file_name": "assets/flightpath_0.csv",
  "role": "primary",
  "created_by": "DJI Fly",
  "_source_format": "dji-csv",
  "_parameters": {
    "position": [0, 0, 0],
    "rotation": [0, 0, 0],
    "scale": 1
  },
  "_flight_meta": {
    "point_count": 4821,
    "duration_s": 482,
    "origin_gps": [38.8893, -77.0502],
    "max_alt_m": 120,
    "source_format": "dji-csv"
  }
}
```

## Parsers

Three format parsers, each returning `FlightPoint[]`:

### DJI CSV
Column detection by matching known aliases (`latitude`/`lat`, `altitude(m)`/`alt`, etc.) to handle DJI app version differences. Rows typically 1-10Hz.

### KML/KMZ
`<coordinates>` elements with `lon,lat,alt` triples. KMZ extracted via fflate (existing dependency). Timestamps from `<when>` elements if present.

### SRT (DJI subtitle telemetry)
Regex-based parser for bracketed GPS values in subtitle blocks. 30Hz source downsampled to ~5Hz to keep point count reasonable.

### Format Detection
Auto-detected by file extension. Ambiguous cases resolved by content peek (CSV header row, XML declaration, SRT timestamp blocks).

All parsers use built-in APIs only — string splitting for CSV, DOMParser for KML/XML, regex for SRT.

## Rendering

### Path Line
`THREE.Line` with `THREE.BufferGeometry`. Default color: `#4FC3F7` (light blue). `depthTest: true`, `depthWrite: false`, `transparent: true`. Points subsampled to ~2,000 segments if source exceeds 5,000 points. Full data retained for hover inspection.

### Data Point Markers
`THREE.InstancedMesh` with `SphereGeometry(0.02)` at each rendered point.

### Hover Telemetry Tooltip
DOM overlay div. On mousemove, raycast against instanced mesh. Hit shows tooltip with altitude, speed, timestamp, heading. Dark semi-transparent background, white text.

### Visibility Toggle
Toggle button in editor sidebar and kiosk UI. Shows/hides the `THREE.Group` containing all flight path objects. Shown only when flight paths exist.

### Transform Gizmo
Flight paths in `flightPathGroup` (`THREE.Group`) on `SceneRefs`. Existing transform gizmo attaches for manual alignment.

## File Changes

### New Files
- `src/modules/flight-path.ts` — `FlightPathManager` class: import, parse, render, serialize, dispose
- `src/modules/flight-parsers.ts` — Pure parser functions: `parseDjiCsv()`, `parseKml()`, `parseSrt()`, `detectFormat()`
- `src/modules/__tests__/flight-parsers.test.ts` — Unit tests for each parser

### Modified Files
- `src/types.ts` — `FlightPoint`, `FlightPathData` interfaces; `flightPathGroup` on `SceneRefs`; `flightPaths` on `AppState`
- `src/modules/constants.js` — `FLIGHT_LOG` extensions
- `src/modules/scene-manager.ts` — Create `flightPathGroup`
- `src/modules/asset-store.ts` — Flight path blob slots
- `src/modules/archive-creator.ts` — `addFlightPath()` method
- `src/modules/archive-loader.ts` — `getFlightPathEntries()` helper
- `src/modules/archive-pipeline.ts` — Load flight paths from manifest
- `src/modules/file-input-handlers.ts` — Wire flight log file input
- `src/editor/index.html` — Flight log import button, telemetry tooltip div
- `src/index.html` — Telemetry tooltip div, toggle button placeholder
- `src/main.ts` — Init `FlightPathManager`, wire deps, add to export pipeline
- `src/modules/kiosk-main.ts` — Load and display flight paths from archive

## Future Enhancements (Not in v1)
- Camera replay along flight path (animate camera perspective)
- Altitude gradient coloring (blue-to-red)
- Gimbal direction indicators at data points
- Georeferenced auto-alignment
