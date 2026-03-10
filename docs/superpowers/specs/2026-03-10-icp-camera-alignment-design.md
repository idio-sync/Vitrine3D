# ICP Camera Data Alignment — Design Spec

**Date:** 2026-03-10
**Status:** Approved

## Problem

Aligning splats, meshes, colmap cameras, and flight paths in Vitrine3D is entirely manual (transform gizmo or 3-point landmark picker). The existing colmap↔flight path timestamp-based alignment (`colmap-alignment.ts`) fails in practice due to timestamp offset mismatches and coordinate space incompatibility. Users spend significant time manually nudging assets that should share the same spatial reference.

## Solution

Add `points3D.bin` import to the existing colmap camera data pipeline, then use ICP (Iterative Closest Point) with coarse rotation search to automatically align colmap data to the splat. Flight paths inherit the alignment via the colmap↔GPS geometric relationship.

## Design

### 1. Camera Data Asset Group

New asset category in the Assets pane called "Camera Data" accepting three colmap files:

- `cameras.bin` — camera intrinsics (existing)
- `images.bin` — camera extrinsics/poses (existing)
- `points3D.bin` — sparse reconstruction points (new)

**Loading behavior:**
- All three files loaded together (multi-file input) or individually
- `cameras.bin` + `images.bin` behave as they do now (frustum/marker visualization via `ColmapManager`)
- `points3D.bin` parsed and stored as a typed array of xyz positions — data only, no visualization
- Status indicators show which files are loaded

**Archive support:**
- New checkbox in export dialog: "Include camera data" (off by default)
- When checked, all loaded colmap files stored under `assets/colmap_0/` in the archive
- Manifest entry with role `'colmap'` includes a flag for which files are present

### 2. points3D.bin Parser

Added to `colmap-alignment.ts`.

Colmap `points3D.bin` binary format (per point, variable-length records):
- `point3D_id`: uint64 (8 bytes)
- `xyz`: 3x float64 (24 bytes — extracted)
- `rgb`: 3x uint8 (3 bytes)
- `error`: float64 (8 bytes)
- `track_length`: uint64 (8 bytes)
- `track_length` × 8 bytes of track data: pairs of (image_id: int32, point2d_idx: int32) — 4 bytes each, 8 bytes per pair. Skip `track_length * 8` bytes to advance to the next point record.

Parser extracts xyz positions into `Float64Array`. Subsamples to ~20K points if file contains more.

**Storage:** `ColmapManager` gets a `points3D: Float64Array | null` property (flat xyz, length = numPoints * 3). Stored alongside existing camera data.

### 3. ICP Auto-Alignment Engine

New module: `src/modules/icp-alignment.ts`

#### Phase 1 — Point Extraction

- `sampleSplatPoints(splatMesh, count=20000)`: stride-based subsampling via existing `forEachSplat` API (proven pattern from `computeSplatBoundsFromPositions`). Applies `splatMesh.matrixWorld` to each point to return world-space positions (as `computeSplatBoundsFromPositions` does). This accounts for the `Math.PI` X-rotation applied at load time.
- `parsePoints3D(buffer)`: see section 2 above. Returned positions are coordinate-converted from Colmap convention (Y-down, Z-forward) to Three.js convention (Y-up, Z-backward) by negating Y and Z, matching what `colmap-loader.ts` does for camera positions.
- Both functions return world-space / Three.js-convention arrays suitable for ICP input.

#### Phase 2 — Coarse Rotation Search

- 24 principal axis rotation candidates (all 90-degree increment combinations around X, Y, Z)
- For each candidate: apply rotation to source points, centroid-align, compute overlap score (sum of nearest-neighbor distances via spatial hash)
- Select rotation with best overlap score
- Uses ~2000 subsampled points for speed

#### Phase 3 — ICP Refinement

Starting from best coarse rotation + centroid alignment:
1. Find closest points between source and target (spatial hash grid, O(1) average lookup)
2. Reject outlier pairs (distance > 3x median)
3. Compute similarity transform via Umeyama (reuse existing `computeSimilarityTransform`)
4. Apply transform, check convergence (RMSE delta < threshold)
5. Max 30 iterations

Returns: `{ rotation: Quaternion, scale: number, translation: Vector3, rmse: number, matchCount: number, converged: boolean }`

#### Performance

- Run in `setTimeout` chunked loop to avoid blocking UI
- Show progress in loading overlay ("Aligning... phase 2/3")
- Spatial hash grid for nearest-neighbor (O(1) average vs O(n) brute force)

### 4. UI — Transform Pane Button

**"Align from Camera Data" button** in existing Transform pane alignment section:

- **Disabled state:** grayed out with tooltip "Load camera data (cameras.bin, images.bin, points3D.bin) to enable" when any colmap file or splat is missing
- **Enabled state:** active when all three colmap files + splat are loaded
- **Click flow:**
  1. Show loading overlay ("Auto-aligning from camera data...")
  2. Run ICP (coarse search → refinement)
  3. Apply resulting transform to colmap group (splat stays fixed as anchor)
  4. If flight path loaded: compute Umeyama(source=GPS_local, target=colmap_camera_positions), compose with ICP transform (T_icp ∘ T_geo), apply to flight path group
  5. Toast notification: "Aligned: RMSE 0.042, 847 matches" or "Alignment failed — insufficient overlap"
  6. Update transform inputs
  7. User can undo via existing alignment reset

### 5. Flight Path Alignment via Camera Data

The existing timestamp-based `alignCamerasToFlightPath` is unreliable because:
1. Camera filename timestamps and flight log timestamps have an unknown offset
2. Colmap positions (reconstruction space) and flight GPS positions (meters, Y-up) are in incompatible coordinate systems
3. The result overwrites the colmap↔splat relationship

**New approach (no timestamp matching needed):**
1. ICP solves `points3D → splat world-space` (gives transform T_icp: Colmap Three.js-convention → splat world-space)
2. Colmap camera positions (already converted to Three.js Y-up by `colmap-loader.ts`) correspond geometrically to flight GPS local positions (also Y-up) from the same drone session
3. Compute T_geo = `computeSimilarityTransform(source=GPS_local_positions, target=colmap_camera_positions)` — this maps GPS-space → Colmap Three.js-convention space. Source/target order matters: GPS positions are "source" because that's the space we want to transform *from*.
4. Compose: `T_flight_to_splat = T_icp ∘ T_geo` — first T_geo maps flight GPS points into Colmap Three.js-convention space, then T_icp maps that into splat world-space.
5. Apply `T_flight_to_splat` to the flight path group (set group position/quaternion/scale from the decomposed similarity transform)

Note: `colmapManager.colmapCameras[i].position` values are used directly (already Y-up/Z-backward). Flight point `[x, y, z]` values are also Y-up local coordinates. No additional coordinate conversion needed for T_geo.

The old timestamp-based approach remains in the codebase as a fallback for when `points3D.bin` is unavailable.

### 6. Existing Alignment — No Changes

- 3-point landmark alignment: kept as manual fallback
- autoCenterAlign: kept for initial rough positioning
- Transform gizmo: kept for manual fine-tuning
- Existing colmap↔flight timestamp alignment: kept as fallback

## Files Changed

| File | Change |
|------|--------|
| `src/modules/icp-alignment.ts` | **New** — coarse rotation search, ICP loop, spatial hash |
| `src/modules/colmap-alignment.ts` | Add `parsePoints3D()` |
| `src/modules/colmap-loader.ts` | Add `points3D: Float64Array` storage to `ColmapManager` |
| `src/main.ts` | Wire button, compose transforms, update UI |
| `src/editor/index.html` | Camera Data section in Assets pane, button in Transform pane, export checkbox |
| `src/modules/archive-creator.ts` | Serialize `points3D.bin` in archives |
| `src/modules/archive-loader.ts` | Deserialize `points3D.bin` from archives |
| `src/modules/export-controller.ts` | Respect "include camera data" checkbox |

## Why This Works

- `points3D.bin` shares the exact coordinate system as colmap cameras (both from Metashape)
- The splat was trained from those same images, so points3D geometry overlaps the splat geometry — ICP can find the transform Brush applied during training
- Coarse rotation search (24 candidates) handles arbitrary orientation differences (Brush conventions, coordinate flips, etc.). ICP operates on splat world-space points (with `matrixWorld` applied) and coordinate-converted points3D — this means the orientation difference is always the fixed Brush training transform regardless of any user-applied transforms on the splat gizmo.
- Flight paths inherit alignment through the colmap↔GPS geometric relationship, avoiding fragile timestamp matching
- RMSE provides a confidence metric the user can see
