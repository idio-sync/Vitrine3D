# Chunked RAD LOD Export — Design Document

**Date:** 2026-03-14
**Goal:** Add chunked `.rad` files with hierarchical LOD as an archive export option for Gaussian splats, enabling streaming LOD delivery in the kiosk viewer to maximize user experience.

## Background

The editor currently offers a "Generate Splat LOD at archive export" checkbox that transcodes splats to LOD-ordered `.spz` via Spark.js's `transcodeSpz` WASM function. This produces a single file with LOD ordering but no chunked streaming — the entire file must be downloaded before rendering.

Spark.js 2.0's `.rad` format supports **chunked hierarchical LOD**: the file is split into independently-loadable chunks, each containing a subset of the LOD tree. The renderer streams chunks on demand based on camera position and splat budget (`lodSplatCount`), enabling progressive rendering where coarse LOD appears immediately and detail loads as needed.

## Architecture Overview

```
EXPORT (Editor)                              LOAD (Kiosk Viewer)
─────────────────                            ───────────────────
User's .ply/.splat                           Archive manifest
       │                                            │
       ▼                                            ▼
WASM rad-encoder (Web Worker)                Detect chunked_lod
  decode → bhatt_lod → chunk_tree                   │
  → RAD encode per chunk                            ▼
       │                                     Build proxy URL
       ▼                                     /api/asset/{uuid}/scene_0-lod-0.rad
Multiple .rad chunk files                           │
  assets/scene_0-lod-0.rad                          ▼
  assets/scene_0-lod-1.rad                   SplatMesh({ url: rootUrl })
  assets/scene_0-lod-N.rad                     Spark fetches chunk 0 → render
       │                                       LOD budget requests chunk 3 →
       ▼                                       GET /api/asset/{uuid}/scene_0-lod-3.rad
Archive (.ddim/.vdim ZIP)                      → server reads from ZIP → stream bytes
  with manifest referencing chunks               → progressive quality improvement
```

## Section 1: WASM RAD Encoder Crate

### What gets built

A standalone Rust → WASM crate at `src/wasm/rad-encoder/` that depends on `spark-lib` (git dependency, pinned to `v2.0.0-preview` tag) and exposes a single `encode_rad_chunked` function.

### Why WASM is necessary

- `transcodeSpz` (the existing JS-accessible WASM export) does NOT build an LOD tree — it just re-encodes splats
- LOD tree construction (`bhatt_lod`, `tiny_lod`) and chunk tree organization (`chunk_tree`) only exist in Rust (`spark-lib`)
- These functions are already compiled to WASM inside Spark.js's internal inline worker, but are NOT exported — they're private to the worker's RPC handler
- RAD binary encoding (property serialization, compression, header construction) is complex and already implemented in `spark-lib/src/rad.rs`
- The `spark-lib` crate is proven WASM-compatible — `spark-worker-rs` and `spark-rs` both compile it to `cdylib` WASM targets

### Crate structure

```
src/wasm/rad-encoder/
  Cargo.toml          # cdylib, depends on spark-lib (git), wasm-bindgen
  src/lib.rs          # ~100-150 lines of glue
  build.sh            # wasm-pack build --target web
```

### Dependencies

```toml
[dependencies]
spark-lib = { git = "https://github.com/sparkjsdev/spark", tag = "v2.0.0-preview" }
wasm-bindgen = "0.2.100"
serde-wasm-bindgen = "0.6.5"
serde_json = "1"
js-sys = "0.3.77"
console_error_panic_hook = "0.1"
```

### Exposed API

```rust
#[wasm_bindgen]
pub fn encode_rad_chunked(
    file_bytes: &[u8],
    file_type: &str,          // "ply", "spz", "splat", "ksplat"
    chunk_size: Option<u32>,   // default 65536
    lod_method: Option<String>,// "tiny" or "quality", default "quality"
    lod_base: Option<f32>,     // default 1.75 for quality, 1.5 for tiny
    max_sh: Option<u8>,        // 0-3, default 3
) -> Result<JsValue, JsValue>
```

### Internal pipeline

```
1. MultiDecoder::decode(file_bytes, file_type) → CsplatArray
2. csplat_array.bhatt_lod(base)               → LOD tree built in-place
3. chunk_tree::chunk_tree(&mut array, root)    → splats reordered into chunks
4. RadEncoder::new(meta).encode_chunked()      → Vec<(RadChunkMeta, Vec<u8>)>
5. Return to JS: { meta: JSON, chunks: [{index, bytes}] }
```

### Return value

```typescript
interface RadEncodeResult {
    meta: {
        version: number;
        count: number;
        maxSh: number;
        chunkCount: number;
        splatEncoding: object;
    };
    chunks: Array<{
        index: number;
        bytes: Uint8Array;  // complete RADC chunk (header + payloads)
    }>;
}
```

### Build integration

WASM output (`rad_encoder_bg.wasm` + `rad_encoder.js`) placed in `src/wasm/rad-encoder/pkg/`. Vite handles WASM imports natively. CI builds WASM and commits `pkg/` so most developers don't need Rust locally.

### Risks

| Risk | Mitigation |
|------|------------|
| `spark-lib` has WASM-incompatible deps (`zip`, `image`) | Feature-gate or vendor only needed modules (decoder, bhatt_lod, chunk_tree, rad, splat_encode) |
| WASM bundle size | `opt-level=3` + `lto="fat"`. Expect 500KB-2MB gzipped |
| `spark-lib` not on crates.io | Git dependency pinned to tag |
| Build toolchain | Requires `rustup` + `wasm-pack`. CI builds so devs don't need Rust |

## Section 2: Export Pipeline Integration

### Current SPZ flow

```
prepareArchive() → state.splatLodEnabled?
  → transcodeSpzInWorker(fileBytes, ext)
  → archiveCreator.addScene(spzBlob, "scene.spz", transform)
```

### New RAD flow

```
prepareArchive() → state.splatLodFormat === 'rad'?
  → transcodeRadInWorker(fileBytes, ext, options)
  → Returns { meta, chunks: [{index, bytes}] }
  → archiveCreator.addSceneChunked(chunks, "scene_0", meta, transform)
    → Stores: assets/scene_0-lod-0.rad, assets/scene_0-lod-1.rad, ...
    → Manifest gets chunked_lod metadata
```

### New files

- `src/modules/workers/transcode-rad.worker.ts` — Web Worker that initializes WASM and calls `encode_rad_chunked`. Mirrors `transcode-spz.worker.ts` pattern.

### Modified files

- `src/modules/export-controller.ts` — New `transcodeRadInWorker()` function; LOD branch checks `state.splatLodFormat`
- `src/modules/archive-creator.ts` — New `addSceneChunked()` method that stores each chunk as a separate file
- `src/types.ts` — `splatLodFormat: 'rad' | 'spz' | 'none'` replaces `splatLodEnabled: boolean`

### Progress reporting

Export UI shows "Generating chunked RAD LOD... (chunk 3/12)" via the worker status callback pattern.

## Section 3: Archive Format Changes

### Manifest schema for chunked RAD

```json
{
  "data_entries": {
    "scene_0": {
      "file_name": "assets/scene_0-lod-0.rad",
      "type": "scene",
      "format": "rad",
      "transform": { "position": [0,0,0], "rotation": [0,0,0], "scale": 1 },
      "created_by": "...",
      "hash_sha256": "...",
      "chunked_lod": {
        "chunk_count": 12,
        "total_splats": 786432,
        "chunk_size": 65536,
        "lod_method": "bhatt",
        "max_sh": 3,
        "chunks": [
          { "file_name": "assets/scene_0-lod-0.rad", "index": 0, "bytes": 4521984 },
          { "file_name": "assets/scene_0-lod-1.rad", "index": 1, "bytes": 3891200 },
          { "file_name": "assets/scene_0-lod-2.rad", "index": 2, "bytes": 3645440 }
        ]
      }
    }
  }
}
```

### Design decisions

- **`file_name` points to chunk 0**: Backward compatibility — older viewers load chunk 0 and get a coarse (but usable) render
- **Each chunk is a separate file in the ZIP**: Individually addressable via central directory; existing `extractFileBuffer()` works
- **`format: "rad"` signals chunked loading path** to the kiosk
- **Chunk naming**: `{base}-lod-{index}.rad` — matches Spark's internal `chunkUrl()` resolution pattern
- **`chunked_lod` field is optional**: Absence means single-file splat (current behavior)

### RAD header metadata

Each chunk 0 RAD file contains a header with `filename` fields (not inline offsets) so Spark resolves sibling chunks as separate URL fetches:

```json
{
  "chunks": [
    { "filename": "scene_0-lod-0.rad", "base": 0, "count": 65536 },
    { "filename": "scene_0-lod-1.rad", "base": 65536, "count": 65536 }
  ]
}
```

## Section 4: Kiosk Viewer — Streaming Chunked RAD

### Meta-server asset proxy

**`GET /api/asset/{uuid}/{filename}`** — new endpoint in `meta-server.js`

```javascript
// Look up archive by UUID
// Parse ZIP central directory to find assets/{filename}
// Compute exact byte offset within ZIP (STORE, no decompression)
// Stream bytes via fs.createReadStream({ start, end })
// Cache-Control: public, max-age=31536000, immutable
```

Archives are stored as plain ZIPs on disk. The server streams raw bytes directly — no scrambling at this layer.

### Kiosk loading flow

In `archive-pipeline.ts`, when `scene_0` has `format: "rad"` + `chunked_lod`:

```typescript
const rootChunkName = sceneEntry.chunked_lod.chunks[0].file_name.replace('assets/', '');
const rootUrl = `/api/asset/${state.archiveUuid}/asset/${rootChunkName}`;
const splatMesh = new SplatMesh({ url: rootUrl, fileType: 'rad' });
```

Spark's URL resolution handles the rest:
- `new URL("scene_0-lod-3.rad", "/api/asset/{uuid}/scene_0-lod-0.rad")` → `/api/asset/{uuid}/scene_0-lod-3.rad`

### Streaming behavior

1. Kiosk loads manifest (~100KB Range request)
2. Detects `chunked_lod` → constructs proxy URL for chunk 0
3. SplatMesh fetches chunk 0 (~2-5MB) → immediate coarse render
4. Spark's LOD system requests chunks on demand based on camera + `lodSplatCount` budget
5. Each chunk = one HTTP request → server reads from ZIP → streams bytes
6. Only chunks needed for current view are transferred

### Fallback for local/Tauri

No meta-server available. Extract all chunks from archive into memory, assemble monolithic RAD blob, pass to SplatMesh. Acceptable for local files.

### Files changed

| File | Change |
|------|--------|
| `docker/meta-server.js` | New `/api/asset/{uuid}/{filename}` endpoint |
| `src/modules/archive-pipeline.ts` | Detect `chunked_lod`, construct proxy URL |
| `src/modules/kiosk-main.ts` | Handle `format: "rad"` in splat loading path |

## Section 5: Editor UI Changes

### Current UI

Checkbox: "Generate Splat LOD at archive export" → produces `.spz`

### New UI

Radio button group in the Optimization section (RAD default):

- **Chunked RAD** *(streaming LOD — recommended)* — default
- **SPZ** *(single file LOD)*
- **None** *(original format, no LOD preprocessing)*

### State change

```typescript
// Old
splatLodEnabled: boolean;

// New
splatLodFormat: 'rad' | 'spz' | 'none';  // default: 'rad'
```

### Files changed

| File | Change |
|------|--------|
| `src/editor/index.html` | Replace LOD checkbox with radio group |
| `src/types.ts` | `splatLodEnabled` → `splatLodFormat` |
| `src/main.ts` | Update state init, remove `splatLodEnabled` refs |
| `src/modules/event-wiring.ts` | Wire radio group change events |
| `src/modules/export-controller.ts` | Check `splatLodFormat` instead of `splatLodEnabled` |

## Deferred Work

### VDIM scrambling for RAD chunks
When serving chunks from `.vdim` (XOR-scrambled) archives, the asset proxy should apply `createXorTransform` to chunk bytes, and the client needs a descrambling layer between Spark's fetch and the raw bytes. This likely requires a Service Worker interceptor or custom fetch wrapper. Defer until core RAD support is working.

### Editor RAD preview
Currently the editor doesn't benefit from chunked streaming (splats are loaded from local files). A future enhancement could use RAD chunks for in-editor LOD preview with large splats.

## Implementation Order

1. **WASM crate** — Build `rad-encoder`, verify `spark-lib` compiles to WASM, test encoding a .ply → chunked RAD
2. **Export pipeline** — Web Worker, archive-creator `addSceneChunked`, manifest schema
3. **Editor UI** — Radio buttons, state change
4. **Meta-server endpoint** — `/api/asset/{uuid}/{filename}` with ZIP file extraction
5. **Kiosk loading** — Detect chunked_lod, construct proxy URLs, pass to SplatMesh
6. **Testing** — Round-trip: export RAD archive → load in kiosk → verify streaming behavior

## Reference

- Spark.js `build-lod` CLI: https://github.com/sparkjsdev/spark/tree/v2.0.0-preview/rust/build-lod
- RAD format: magic `0x30444152` ("RAD0"), chunk magic `0x43444152` ("RADC"), JSON metadata + per-chunk property payloads
- RAD chunk properties: center, alpha, rgb, scales, orientation, sh1-3, child_count (u16), child_start (u32)
- SPZ format: magic `0x5053474e`, flag `0x80` = LOD tree present
- Spark LOD budget: `SparkRenderer.lodSplatCount` controls per-frame splat cap
