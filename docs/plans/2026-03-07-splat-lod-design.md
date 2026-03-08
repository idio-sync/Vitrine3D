# Splat LOD Design

## Problem

The SD/HD quality toggle does not work for Gaussian splats. The current system uses `lodSplatCount` on SparkRenderer as a frame budget, but without an LOD tree the renderer just truncates splats in storage order — showing a random area of the scene with the rest missing. The `.sog` cap (`decoded.numSplats = maxSplats`) similarly takes the first N splats rather than a spatially coherent subset. Lower-end hardware always struggles because there is no intelligent downsampling.

## Root Cause

`lod: true` is never passed to `SplatMesh`. Spark 2.0's LOD system (`tinyLodExtSplats` / `qualityLodExtSplats` WASM algorithms) builds a spatial importance tree that lets the renderer pick the most visually important splats for a given camera position and budget. Without this tree, `lodSplatCount` is just a blind cap.

## Solution Overview

Two-layer approach:

1. **Runtime LOD (always active)**: Enable Spark's built-in LOD tree computation on every splat load. This makes `lodSplatCount` work correctly everywhere — editor, kiosk, raw file loads, and archives without precomputed LOD.

2. **Export-time LOD (opt-in via checkbox)**: At archive export, precompute the LOD tree and write the splat as LOD-ordered SPZ. When kiosk loads this SPZ with `lod: true`, the tree rebuilds near-instantly because splats are already in importance order. This eliminates the 10-30s runtime cost for large splats.

## Technical Details

### Runtime LOD Changes

**`file-handlers.ts` — `createSplatMesh()`**:
- URL path (`.ply`, `.spz`, `.splat`): Pass `lod: true` to `SplatMesh({ url, lod: true })`.
- `.sog` decode path: After creating `SplatMesh({ packedSplats })`, call `packedSplats.createLodSplats()` to build the LOD tree in a WebWorker.
- Use `quality: false` (tinyLod) for editor, `quality: true` (bhattLod) for kiosk to balance speed vs quality.

**`kiosk-main.ts`**: No changes to `lodSplatCount` budgets or SparkRenderer setup — the existing 1M (SD) / 5M (HD) budgets now work correctly because the LOD tree provides intelligent splat selection.

**Fallback behavior**: If a splat is `.sog` in an archive, runtime LOD still fires. The user sees a "Building LOD..." phase during loading. For 10M+ splats this takes ~10-30s but produces a functional result.

### Export-time LOD Changes

**UI — `editor/index.html`**:
- New checkbox in assets area: **"Generate Splat LOD at archive export"** (checked by default).
- Note beneath checkbox: _"Requires .spz or .ply input. .sog files use runtime LOD instead."_

**`archive-creator.ts` / `export-controller.ts`**:
- When checkbox is checked and loaded splat originated from `.spz` or `.ply`:
  1. Load splat data into `PackedSplats` with LOD tree computation (`createLodSplats({ quality: true })`)
  2. Use `transcodeSpz()` to serialize the LOD-reordered splats as plain SPZ
  3. Store the `.spz` file in the archive manifest (role `scene`, replacing the original splat file)
  4. Progress view shows: _"Generating splat LOD..."_ during this step
- When unchecked or input is `.sog`: store the original file as-is.

**`archive-pipeline.ts` / `kiosk-main.ts`**:
- When loading a splat from an archive, always pass `lod: true`.
- LOD-precomputed SPZ files rebuild the tree near-instantly (splats already in LOD order).
- Non-LOD files (`.sog`, legacy archives) still get runtime LOD — slower but functional.

### State tracking

- `state.splatLodEnabled` (boolean): Whether the LOD checkbox is checked (persisted in `APP_CONFIG` for export).
- `state.splatSourceFormat` (string): Track the original file format to gate export-time LOD (only `.spz`/`.ply`).

### What the LOD tree does

Spark's LOD algorithm (tinyLod or bhattLod) spatially partitions splats into a tree where:
- Root splats are the most visually important (largest contribution to the scene)
- Each node's children represent finer detail in that spatial region
- SparkRenderer traverses the tree per frame, stopping at the `lodSplatCount` budget
- Camera-aware: detail is prioritized near the viewpoint and within the view cone

### Format notes

- **SPZ**: Spark's compressed splat format. ~30% larger than SOG for equivalent data, but well-supported and the only format `transcodeSpz()` can write.
- **Extended SPZ / .rad**: SPZ with LOD tree metadata (childCounts/childStarts + flag 0x80). Spark can read this format, but the JS build cannot write it — the WASM `lodTree` object is opaque. Future Spark releases may expose a write API.
- **SOG**: Best compression (~95% reduction from PLY), but `transcodeSpz()` cannot read it and `createLodSplats()` works on decoded `PackedSplats` — so `.sog` files can only get runtime LOD, not export-time LOD.

## Files to Modify

| File | Change |
|---|---|
| `src/modules/file-handlers.ts` | Pass `lod: true` to SplatMesh; call `createLodSplats()` for `.sog` path |
| `src/modules/kiosk-main.ts` | Pass `lod: true` when loading splats from archives |
| `src/editor/index.html` | Add "Generate Splat LOD at archive export" checkbox + note |
| `src/modules/archive-creator.ts` | LOD generation + SPZ transcoding at export time |
| `src/modules/export-controller.ts` | Wire checkbox state, progress messaging |
| `src/modules/archive-pipeline.ts` | Pass `lod: true` when loading splats from archives |
| `src/main.ts` | Track `state.splatLodEnabled`, `state.splatSourceFormat`; wire checkbox |
| `src/types.ts` | Add `splatLodEnabled` and `splatSourceFormat` to `AppState` |

## Behavior Matrix

| Input format | LOD checkbox | Archive contains | Kiosk load behavior |
|---|---|---|---|
| `.spz` / `.ply` | Checked | LOD-ordered `.spz` | Fast LOD tree rebuild, quality toggle works |
| `.spz` / `.ply` | Unchecked | Original `.spz`/`.ply` | Runtime LOD (~10-30s for 10M), quality toggle works |
| `.sog` | Either | Original `.sog` | Runtime LOD (~10-30s for 10M), quality toggle works |
| Raw file (no archive) | N/A | N/A | Runtime LOD, quality toggle works |

## Future: Phase 3

When Spark 2.0 reaches stable release:
- If `SpzWriter` gains extended SPZ support, switch to writing proper `.rad` files with zero runtime cost
- If `build-lod` ships as npm/WASM, use it for higher-quality precomputation
- Consider server-side LOD generation in the Docker pipeline for automated workflows

## Sources

- [Spark 2.0 New Features](https://sparkjs.dev/2.0.0-preview/docs/new-features-2.0/)
- [Spark LOD Deep Dive](https://sparkjs.dev/2.0.0-preview/docs/new-spark-renderer/)
- [PlayCanvas splat-transform](https://github.com/playcanvas/splat-transform) (evaluated, not used — output format incompatible with Spark)
- [PlayCanvas SOG Format](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/)
