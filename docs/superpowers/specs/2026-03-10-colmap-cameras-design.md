# Colmap Camera Visualization & Flight Path Alignment

**Date**: 2026-03-10
**Status**: Approved

## Summary

Add Colmap SfM camera data as a new asset type in Vitrine3D. Cameras are visualized as frustums or markers, viewable independently and alongside splats/meshes. When both Colmap cameras and a flight path are loaded, automatic alignment computes the similarity transform between GPS coordinates and splat-space coordinates using matched camera positions.

## Motivation

Flight paths imported from drone logs use GPS coordinates (converted to meters via flat-earth projection), while splats/meshes live in an arbitrary local coordinate system from Colmap reconstruction. Manually aligning flight paths via translate/rotate/scale controls is tedious and imprecise. Since Colmap camera positions are already in the splat's coordinate system, and correspond to the same physical locations as flight log GPS entries, we can compute exact alignment automatically.

## Design

### Section 1: Colmap Cameras — New Asset Type

**New module**: `src/modules/colmap-loader.ts`
- Parses Colmap binary format (`cameras.bin` for intrinsics, `images.bin` for extrinsics)
- Exports parsed data as `ColmapCamera[]` — position, quaternion, focal length, image filename per camera
- No runtime dependencies beyond Three.js

**Scene integration**:
- `colmapGroup` (THREE.Group) added to `SceneManager`, following the `cadGroup`/`flightPathGroup` pattern
- New selection option `'colmap'` in transform controls
- Included in "both" mode sync for all transform operations

**Rendering** (in `colmap-loader.ts`):
- **Frustums**: `THREE.LineSegments` per camera — wireframe pyramid sized by focal length, oriented by quaternion. Batched into a single geometry for performance.
- **Markers**: `THREE.InstancedMesh` spheres (same pattern as flight path markers)
- Toggle between modes via UI button
- Color: rainbow gradient along image sequence (first photo = blue, last = red) — gives a sense of capture order

**UI** (in `editor/index.html` Assets pane):
- New "Cameras" collapsible section with:
  - Import button (file input accepting `.bin` files or folder)
  - Camera count display
  - Frustum/Marker toggle
  - Frustum scale slider (adjust visual size)
  - Visibility checkbox

**Archive storage**:
- Key prefix: `colmap_sfm_0`
- Stores original `cameras.bin` + `images.bin` under `assets/colmap_sfm_0/`
- Manifest entry with role `'colmap_sfm'`, metadata includes camera count and origin image filename

### Section 2: Flight Path Auto-Alignment

**Trigger**: When both a Colmap camera set and a flight path are loaded, the editor shows an "Align Flight Path to Cameras" button.

**Algorithm**:
1. **Timestamp extraction**: Parse timestamps from Colmap image filenames (DJI naming convention: `DJI_YYYYMMDD_HHMMSS_NNNN.jpg`). Fall back to sequential order if timestamps can't be parsed.
2. **Point matching**: For each Colmap camera, find the closest flight log GPS point by timestamp (nearest-neighbor within configurable tolerance, default 1 second). Discard unmatched cameras.
3. **Similarity transform**: With matched point pairs (Colmap position in splat-space, GPS position in flight-path-space), compute a 7-DOF similarity transform (3 translation + 3 rotation + 1 uniform scale) using the Umeyama algorithm (closed-form Procrustes with scale).
4. **Apply**: Set `flightPathGroup`'s position, rotation, and scale from the computed transform. Store alignment metadata in the archive.

**API**:
```typescript
alignFlightPathToColmap(
  colmapCameras: ColmapCamera[],
  flightPoints: FlightPoint[],
  options?: { timeTolerance?: number }
): { position: Vector3, rotation: Euler, scale: number } | null
```

Returns `null` if < 3 matched points.

**UI**:
- "Align to Cameras" button appears in the flight path section when both assets are present
- Shows match count and RMSE after alignment
- Undo support via existing undo system

**Edge cases**:
- Timestamps unparseable from filenames: prompt user to confirm sequential matching
- < 3 matches: error explaining why alignment failed
- High RMSE: warning about poor match quality

### Section 3: Kiosk Mode Support

- `kiosk-main.ts` lazily imports `colmap-loader.ts` when archive contains a `colmap_sfm` entry
- Toggle button (`btn-toggle-cameras`) shown when cameras are present, starts hidden
- Frustum/marker toggle available in kiosk UI
- Toggle button styled in all 5 theme `layout.css` files, following `btn-toggle-annotations` pattern

### Section 4: Module Structure & Integration Points

**New files**:
- `src/modules/colmap-loader.ts` — Binary parser, camera rendering, alignment algorithm
- `src/modules/__tests__/colmap-loader.test.ts` — Binary parsing, timestamp extraction, similarity transform, point matching

**Modified files**:
- `src/modules/scene-manager.ts` — Add `colmapGroup`
- `src/modules/transform-controller.ts` — Add `colmap` tracking vectors and sync handlers
- `src/modules/event-wiring.ts` — Wire import, toggle, alignment buttons; add `colmap` to transform inputs
- `src/modules/archive-creator.ts` — `addColmap()` for `colmap_sfm_0` entries
- `src/modules/archive-pipeline.ts` — Load `colmap_sfm` entries
- `src/modules/export-controller.ts` — Include colmap transform in manifest
- `src/modules/ui-controller.ts` — Add colmap to `updateTransformInputs`, `updateTransformPaneSelection`
- `src/modules/kiosk-main.ts` — Lazy import + toggle button
- `src/editor/index.html` — Cameras section in Assets pane, select button in Transform pane
- `src/index.html` — Toggle button for kiosk
- `src/types.ts` — `ColmapCamera` interface, `colmapGroup` in `SceneRefs`, update `EventWiringDeps`
- `src/main.ts` — Wire colmap group, add to deps factories, handle file input
- `src/themes/*/layout.css` — Toggle button styles

**Patterns followed**:
- Deps pattern (no circular imports)
- Archive key/role pattern (`colmap_sfm_0`, role `'colmap_sfm'`)
- Transform sync pattern (tracking vectors + delta sync in "both" mode)
- Lazy-import pattern for kiosk

**Testing**: Binary parsing, timestamp extraction from DJI filenames, Umeyama similarity transform with known input/output pairs, point matching with time tolerance.
