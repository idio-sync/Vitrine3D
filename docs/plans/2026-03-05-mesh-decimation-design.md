# Mesh Decimation & SD Proxy Generation — Design

**Date:** 2026-03-05
**Status:** Approved
**Problem:** Clients on lower-end devices run out of memory loading HD mesh assets in the kiosk viewer.

## Summary

Add automatic mesh decimation to the editor. When a user loads an HD mesh, they can generate an SD proxy with configurable quality settings. The proxy is a decimated + texture-downscaled GLB stored in the archive as an `lod: "proxy"` entry. The existing SD/HD quality tier system in the kiosk already loads proxy entries on SD devices — zero kiosk changes needed.

## Requirements

- Decimate meshes (GLB/OBJ/STL/GLTF) in-browser using meshoptimizer WASM
- Downscale textures via canvas to reduce GPU memory
- Configurable via presets (Ultra Light → High) plus full manual control
- Preview SD proxy in the editor before exporting
- Store proxy as a separate GLB in the archive with decimation metadata
- Round-trip: re-opening an archive in the editor restores proxy + settings

## Architecture

### New Module: `mesh-decimator.ts`

Self-contained module (no deps factory). Responsibilities:

- Lazy-load meshoptimizer WASM singleton (same pattern as E57Loader)
- `decimateMesh(geometry, options)` — takes `BufferGeometry`, returns decimated `BufferGeometry`
- `decimateScene(group, options)` — walks a `THREE.Group`, decimates all mesh geometries, downscales textures, returns a new cloned group
- `exportAsGLB(group)` — wraps `GLTFExporter.parseAsync()` to produce a `Blob`

### New Module: `decimation-worker.ts`

Web Worker for off-thread simplification:

- Receives serialized vertex/index/attribute buffers via `postMessage`
- Runs meshoptimizer `simplify()` on the buffers
- Returns decimated buffers + progress updates
- Main thread handles Three.js geometry extraction → worker → geometry reconstruction

### Configuration

```ts
interface DecimationPreset {
    name: string;
    targetRatio: number;       // 0.0–1.0 fraction of original faces
    maxFaces?: number;         // Hard ceiling — whichever is lower wins
    errorThreshold: number;    // 0.0–1.0 normalized max geometric error
    lockBorder: boolean;       // Preserve mesh boundary edges
    preserveUVSeams: boolean;  // Weight UV seam edges higher
    textureMaxRes: number;     // Max texture resolution (px)
    textureFormat: string;     // 'jpeg' | 'png' | 'keep'
    textureQuality: number;    // JPEG quality 0.0–1.0
}

interface DecimationOptions {
    preset?: string;
    targetRatio?: number;
    targetFaceCount?: number;
    errorThreshold?: number;
    lockBorder?: boolean;
    preserveUVSeams?: boolean;
    textureMaxRes?: number;
    textureFormat?: string;
    textureQuality?: number;
}
```

### Built-in Presets

| Preset | Ratio | Max Faces | Error | Lock Border | UV Seams | Tex Res | Tex Format |
|---|---|---|---|---|---|---|---|
| Ultra Light | 1% | 25K | 0.02 | yes | no | 512 | JPEG 80% |
| Light | 5% | 50K | 0.015 | yes | yes | 1024 | JPEG 85% |
| Medium (default) | 10% | 100K | 0.01 | yes | yes | 1024 | JPEG 85% |
| High | 25% | 250K | 0.005 | yes | yes | 2048 | JPEG 90% |
| Custom | — | — | — | — | — | — | — |

Target logic: `min(originalFaces * targetRatio, maxFaces)` — keeps SD proxies consistently lightweight regardless of input size.

## Editor UI

New "SD Proxy" panel in the editor sidebar, visible after a mesh is loaded.

```
┌─ SD Proxy ─────────────────────────────┐
│                                        │
│  Preset: [Medium ▾]                    │
│                                        │
│  HD: 2,413,892 faces                   │
│  SD: ~100,000 faces (estimated)        │
│                                        │
│  [▸ Advanced]                          │
│  ┌──────────────────────────────────┐  │
│  │ Target: [Ratio ▾] [10%    ]     │  │
│  │    — or —                        │  │
│  │ Target: [Faces ▾] [100000 ]     │  │
│  │ Max Error:         [0.01  ]     │  │
│  │ ☑ Lock border edges             │  │
│  │ ☑ Preserve UV seams             │  │
│  └──────────────────────────────────┘  │
│                                        │
│  [▸ Texture Settings]                  │
│  ┌──────────────────────────────────┐  │
│  │ Max Resolution: [1024 ▾]        │  │
│  │   (256 / 512 / 1024 / 2048)     │  │
│  │ Format:         [JPEG ▾]        │  │
│  │   (JPEG 85% / PNG / Keep)       │  │
│  └──────────────────────────────────┘  │
│                                        │
│  [Generate SD Proxy]                   │
│                                        │
│  Status: ✓ Proxy ready (98,412 faces)  │
│  [Preview SD] [Remove Proxy]           │
│                                        │
└────────────────────────────────────────┘
```

### Panel Behavior

- **Preset dropdown** — selecting a preset populates all fields. Changing any field auto-switches to "Custom".
- **Advanced / Texture Settings** — collapsed by default via toggle.
- **Generate SD Proxy** — runs decimation in Web Worker, shows progress. Produces decimated `THREE.Group` in memory + exports to GLB `Blob` stored as `proxyMeshBlob` in `asset-store.ts`.
- **Preview SD / Preview HD** — toggle that swaps mesh group visibility for visual comparison.
- **Remove Proxy** — clears proxy blob, disposes decimated group.
- **Face count estimate** — updates live as settings change (ratio calculation, not actual decimation).

### State Additions

```ts
// In AppState (types.ts)
proxyMeshGroup: THREE.Group | null;
proxyMeshSettings: DecimationOptions | null;
```

## Integration

### Archive Export (`archive-creator.ts`)

When `proxyMeshBlob` exists in `asset-store.ts`:

1. Call existing `addMeshProxy(proxyMeshBlob, 'assets/mesh_0_proxy.glb', ...)`
2. Store decimation metadata in manifest:

```json
{
    "file_name": "assets/mesh_0_proxy.glb",
    "role": "mesh",
    "lod": "proxy",
    "decimation": {
        "preset": "medium",
        "targetRatio": 0.1,
        "errorThreshold": 0.01,
        "textureMaxRes": 1024,
        "textureFormat": "jpeg",
        "originalFaces": 2413892,
        "resultFaces": 98412
    }
}
```

### Archive Import (`archive-pipeline.ts`)

When re-opening an archive in the editor:

1. Existing proxy blob extraction works unchanged
2. Read `decimation` metadata from manifest → populate SD Proxy panel with previous settings
3. Proxy mesh available for preview without re-decimating

### Kiosk — No Changes

`archive-pipeline.ts` already loads the proxy entry when `qualityResolved === 'sd'`. A decimated GLB proxy is just another GLB. Zero kiosk changes.

### WASM Loading

- meshoptimizer WASM served from `/meshopt/` (same pattern as Draco from `/draco/`)
- Dev: served via Vite plugin (like `serveOcctWasm()` in vite.config.ts)
- Production: copied to `dist/meshopt/` at build time
- Lazy-loaded on first decimation — not at startup

## Texture Downscaling

Part of the same "Generate SD Proxy" pipeline — no separate step:

1. After geometry decimation, walk the decimated group's materials
2. Find all texture maps (`map`, `normalMap`, `aoMap`, `roughnessMap`, `metalnessMap`, etc.)
3. For each texture exceeding `textureMaxRes`:
   - Draw to offscreen `<canvas>` at target resolution
   - Export as JPEG (at configured quality) or PNG
   - Replace material texture with downscaled version
4. `GLTFExporter` embeds the downscaled textures in the proxy GLB

No new dependencies — canvas downscaling is browser-native.

## Files

### New Files

| File | Purpose |
|---|---|
| `src/modules/mesh-decimator.ts` | Core decimation logic, presets, texture downscaling, GLB export |
| `src/modules/decimation-worker.ts` | Web Worker for off-thread meshoptimizer simplification |

### Modified Files

| File | Change |
|---|---|
| `src/editor/index.html` | Add SD Proxy panel HTML |
| `src/styles.css` | Styles for the proxy panel |
| `src/main.ts` | Wire proxy panel events, manage `proxyMeshGroup`, preview toggle |
| `src/types.ts` | Add `proxyMeshGroup` and `proxyMeshSettings` to `AppState` |
| `src/modules/archive-creator.ts` | Store decimation metadata in manifest proxy entry |
| `src/modules/archive-pipeline.ts` | Read decimation metadata on import, populate panel |
| `src/modules/constants.ts` | Add decimation preset defaults |
| `vite.config.ts` | Serve meshopt WASM in dev, copy to dist |
| `package.json` | Add `meshoptimizer` dependency |

### Not Touched

- `kiosk-main.ts`, `kiosk-web.ts` — proxy loading already works
- `quality-tier.ts` — SD/HD detection unchanged
- `archive-loader.ts` — manifest parsing already handles `lod: "proxy"`
- Theme files — no visual changes
- `asset-store.ts` — already has `proxyMeshBlob`

## Excluded (YAGNI)

- Auto-decimation on import (manual "Generate" button only for v1)
- Splat proxy generation (splats already have LOD budgets via Spark)
- Multiple LOD levels (only HD + single SD proxy)
- Batch decimation of multiple meshes (v1 handles the primary mesh)
- Draco compression of proxy GLB (can add later — minimal size win over texture downscaling)

## New Dependency

- `meshoptimizer` (npm) — WASM build, ~200KB. Provides `MeshoptSimplifier.simplify()` and `simplifyWithAttributes()`. MIT licensed.
