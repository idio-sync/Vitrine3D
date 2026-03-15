# Draco Compression for Proxy GLB

**Date**: 2026-03-06
**Status**: Approved

## Goal

Add Draco mesh compression to the SD proxy generation pipeline, producing smaller GLB files with `KHR_draco_mesh_compression`. Controlled by a default-on checkbox in the editor UI.

## Approach

Post-process the GLB output from Three.js `GLTFExporter` using gltf-transform's `WebIO` and `draco()` transform — the same approach used by gltf.report.

## Dependencies

- `@gltf-transform/core` — Document model, WebIO for binary read/write
- `@gltf-transform/extensions` — `KHRDracoMeshCompression` extension registration
- `draco3dgltf` — WASM encoder/decoder module for gltf-transform

## UI

Checkbox added to the SD Proxy section in `src/editor/index.html`, between the preset dropdown and face count display:

```html
<label class="prop-label">
    <input type="checkbox" id="decimation-draco" checked /> Draco compress
</label>
```

Default: checked. Not inside any collapsed subsection.

## Code Changes

### types.ts
- Add `dracoCompress: boolean` to `DecimationOptions`

### mesh-decimator.ts
- Module-level: create `WebIO` singleton, register `KHRDracoMeshCompression` and `draco3d` encoder
- `exportAsGLB(group, dracoCompress?)`: after `GLTFExporter` produces ArrayBuffer, if `dracoCompress`:
  - `WebIO.readBinary()` → Document
  - `document.transform(draco({ method: 'edgebreaker' }))`
  - `WebIO.writeBinary()` → Uint8Array → Blob
- `generateProxy()`: pass `options.dracoCompress` to `exportAsGLB()`
- `resolveOptions()`: default `dracoCompress` to `true`

### main.ts
- Read `#decimation-draco` checkbox value when generating proxy, pass into options

### constants.ts
- No changes — Draco is orthogonal to decimation presets

## Data Flow

```
User clicks "Generate SD Proxy"
  -> main.ts reads #decimation-draco checkbox
  -> generateProxy(group, { ...opts, dracoCompress })
    -> decimateScene() (unchanged)
    -> exportAsGLB(group, dracoCompress)
      -> GLTFExporter.parseAsync() -> ArrayBuffer
      -> if dracoCompress: WebIO.readBinary() -> transform(draco()) -> writeBinary()
    -> Blob
```

## What Doesn't Change

- Draco decoding in file-handlers.ts (DRACOLoader already handles compressed GLBs)
- Archive format (proxy stored as .glb blob)
- Kiosk loading path
- Decimation presets and geometry simplification logic
