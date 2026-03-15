# Design: HD Mesh Draco Compression on Archive Export

**Date:** 2026-03-09
**Status:** Approved

## Problem

When exporting a `.ddim` archive, the main HD mesh asset (`assets/mesh_0.glb`) is written to the ZIP verbatim — no compression is applied to the GLB geometry. Draco compression (`KHR_draco_mesh_compression`) can reduce mesh size by 50–90% depending on geometry complexity. The SD proxy mesh already supports Draco compression via `mesh-decimator.ts` and `gltf-transform`; the HD path has no equivalent.

## Goal

Add an opt-out checkbox to the export panel that Draco-compresses the HD mesh blob before it is written to the archive. On by default. Skips silently if the mesh is already Draco-compressed.

---

## Design

### UI — `src/editor/index.html`

Add an indented sub-row beneath the "3D Model" row in the **Include** section of the export panel (`#pane-export`):

```html
<div class="cb-row">
    <input type="checkbox" id="archive-include-model" checked disabled>
    <label for="archive-include-model">3D Model</label>
</div>
<div class="cb-row cb-subrow" id="export-draco-hd-row" style="display:none;">
    <input type="checkbox" id="export-draco-hd" checked>
    <label for="export-draco-hd">Draco compress</label>
</div>
```

- `id="export-draco-hd"` — the checkbox read at export time
- `id="export-draco-hd-row"` — the wrapper, shown/hidden by `export-controller.ts` when a mesh asset is present (same conditional pattern as other model-dependent UI)
- Only shown for GLB files — OBJ meshes are skipped silently
- `.cb-subrow` — indented sub-option style (add to `styles.css` if not already present: `padding-left: 16px;`)

---

### New helper — `isAlreadyDracoCompressed` in `src/modules/mesh-decimator.ts`

Reads only the GLB JSON chunk to check for the `KHR_draco_mesh_compression` extension. No full parse, no gltf-transform involved.

```typescript
async function isAlreadyDracoCompressed(blob: Blob): Promise<boolean> {
    // GLB binary layout: 12-byte file header, then chunk0: 4-byte length + 4-byte type + data
    const header = await blob.slice(0, 20).arrayBuffer();
    const view = new DataView(header);
    const jsonLength = view.getUint32(12, true);
    const jsonBytes = await blob.slice(20, 20 + jsonLength).arrayBuffer();
    const json = JSON.parse(new TextDecoder().decode(jsonBytes));
    return (json.extensionsUsed ?? []).includes('KHR_draco_mesh_compression');
}
```

---

### New export function — `dracoCompressGLB` in `src/modules/mesh-decimator.ts`

Pure blob-to-blob pipeline using the already-initialized `ensureDracoIO()` singleton. No Three.js round-trip — preserves all textures, PBR materials, animations, and morph targets exactly.

```typescript
export async function dracoCompressGLB(blob: Blob): Promise<Blob> {
    if (await isAlreadyDracoCompressed(blob)) {
        log.info('HD mesh already Draco-compressed, skipping');
        return blob;
    }
    const io = await ensureDracoIO();
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const doc = await io.readBinary(buffer);
    await doc.transform(draco({ method: 'edgebreaker' }));
    const compressed = await io.writeBinary(doc);
    log.info(`HD Draco: ${(buffer.byteLength / 1024).toFixed(0)} KB → ${(compressed.byteLength / 1024).toFixed(0)} KB`);
    return new Blob([compressed], { type: 'model/gltf-binary' });
}
```

---

### Export flow change — `src/modules/export-controller.ts`

In `prepareArchive()`, after the HD mesh blob is resolved (around line 328), read the checkbox and conditionally compress before passing to `archiveCreator.addMesh()`:

```typescript
const dracoHdEl = document.getElementById('export-draco-hd') as HTMLInputElement | null;
const shouldDracoHD = dracoHdEl?.checked ?? true;

if (includeModel && assets.meshBlob && state.modelLoaded) {
    let meshBlob = assets.meshBlob;
    const fileName = state._meshFileName || document.getElementById('model-filename')?.textContent || 'mesh.glb';

    if (shouldDracoHD && fileName.toLowerCase().endsWith('.glb')) {
        onProgress?.('Draco compressing HD mesh…', 30);
        meshBlob = await dracoCompressGLB(meshBlob);
    }

    archiveCreator.addMesh(meshBlob, fileName, { ... });
}
```

- Only applied to `.glb` files (not `.obj`)
- Falls back to `true` if the element is absent (default-on)
- Uses the existing `onProgress` overlay for user feedback during compression

---

### Show/hide sub-row

In `export-controller.ts` `showExportPanel()` (or wherever the export panel is populated), show `#export-draco-hd-row` when a GLB mesh is loaded:

```typescript
const dracoHdRow = document.getElementById('export-draco-hd-row');
if (dracoHdRow) {
    const isGlb = (state._meshFileName || '').toLowerCase().endsWith('.glb');
    dracoHdRow.style.display = (state.modelLoaded && isGlb) ? '' : 'none';
}
```

---

## What Doesn't Change

- No new `AppState` fields — checkbox read directly at export time
- No changes to `archive-creator.ts`, `kiosk-main.ts`, or any kiosk path
- `ensureDracoIO()` singleton is already lazy-initialized; calling it from a new path adds no overhead if the proxy path already ran it
- The `KHR_draco_mesh_compression` extension is already declared in `KHRDracoMeshCompression` import in `mesh-decimator.ts`

## Files Changed

| File | Change |
|------|--------|
| `src/editor/index.html` | Add `#export-draco-hd` checkbox + `#export-draco-hd-row` wrapper |
| `src/styles.css` | Add `.cb-subrow` indent style if not present |
| `src/modules/mesh-decimator.ts` | Add `isAlreadyDracoCompressed()` + `dracoCompressGLB()` |
| `src/modules/export-controller.ts` | Read checkbox, call `dracoCompressGLB`, show/hide sub-row |
