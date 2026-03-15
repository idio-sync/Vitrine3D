# HD Mesh Draco Compression on Archive Export — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an opt-out "Draco compress" checkbox to the export panel that Draco-compresses the HD mesh blob before writing it to the archive, skipping silently if the blob is already Draco-compressed.

**Architecture:** A new `dracoCompressGLB(blob)` function in `mesh-decimator.ts` runs a pure gltf-transform blob-to-blob pipeline (no Three.js round-trip), reusing the existing `ensureDracoIO()` singleton. A pre-flight `isAlreadyDracoCompressed(blob)` helper reads only the GLB JSON chunk to detect the `KHR_draco_mesh_compression` extension. `export-controller.ts` reads the new checkbox and calls `dracoCompressGLB` before handing the blob to `archiveCreator.addMesh()`.

**Tech Stack:** `gltf-transform` (`@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`), `draco3dgltf` — both already in `package.json` and used by `mesh-decimator.ts` for SD proxy compression.

---

## Task 1: Add `.cb-subrow` style to `styles.css`

**Files:**
- Modify: `src/styles.css` (after line 520, after `.cb-row:last-child`)

**Step 1: Add the style**

In `src/styles.css`, after the `.cb-row:last-child` rule (around line 520), add:

```css
.cb-row.cb-subrow {
    padding-left: 18px;
}
```

**Step 2: Verify no visual regression**

Open the editor in dev (`npm run dev`) and check the decimation panel — existing `.cb-row` elements should be unaffected.

**Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style: add cb-subrow indent class for export sub-options"
```

---

## Task 2: Add Draco compress checkbox to export panel HTML

**Files:**
- Modify: `src/editor/index.html` (the "Include" section of `#pane-export`, after the `archive-include-model` row)

**Step 1: Locate the insertion point**

Find this block in `src/editor/index.html` (around line 2652):

```html
<div class="cb-row">
    <input type="checkbox" id="archive-include-model" checked disabled><label for="archive-include-model">3D Model</label>
</div>
```

**Step 2: Add the sub-row immediately after it**

```html
<div class="cb-row cb-subrow" id="export-draco-hd-row" style="display:none;">
    <input type="checkbox" id="export-draco-hd" checked>
    <label for="export-draco-hd">Draco compress</label>
</div>
```

The row starts hidden (`style="display:none"`). It will be shown by `export-controller.ts` when a GLB mesh is loaded.

**Step 3: Verify HTML is valid**

```bash
npm run build
```

Expected: build succeeds, no errors.

**Step 4: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(export): add Draco compress checkbox to export panel"
```

---

## Task 3: Add `isAlreadyDracoCompressed` and `dracoCompressGLB` to `mesh-decimator.ts`

**Files:**
- Modify: `src/modules/mesh-decimator.ts` (after the `exportAsGLB` function, around line 394)
- Test: `src/modules/__tests__/mesh-decimator.test.ts` (create new)

**Step 1: Write the failing tests first**

Create `src/modules/__tests__/mesh-decimator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { dracoCompressGLB } from '../mesh-decimator.js';

// Minimal valid GLB: header + JSON chunk with no extensionsUsed
function makeMinimalGLB(extensionsUsed?: string[]): Blob {
    const json = JSON.stringify({ asset: { version: '2.0' }, ...(extensionsUsed ? { extensionsUsed } : {}) });
    const jsonBytes = new TextEncoder().encode(json);
    // Pad to 4-byte boundary
    const padded = Math.ceil(jsonBytes.length / 4) * 4;
    const paddedJson = new Uint8Array(padded);
    paddedJson.set(jsonBytes);

    // GLB layout: 12-byte header + 8-byte chunk header + json data
    const totalLength = 12 + 8 + padded;
    const buf = new ArrayBuffer(totalLength);
    const view = new DataView(buf);
    // File header
    view.setUint32(0, 0x46546C67, true); // magic "glTF"
    view.setUint32(4, 2, true);           // version 2
    view.setUint32(8, totalLength, true); // total length
    // Chunk 0 header
    view.setUint32(12, padded, true);     // chunk length
    view.setUint32(16, 0x4E4F534A, true); // chunk type "JSON"
    // Chunk 0 data
    new Uint8Array(buf, 20).set(paddedJson);
    return new Blob([buf], { type: 'model/gltf-binary' });
}

describe('dracoCompressGLB', () => {
    it('returns the same blob when already Draco-compressed', async () => {
        const blob = makeMinimalGLB(['KHR_draco_mesh_compression']);
        const result = await dracoCompressGLB(blob);
        // Should return the exact same reference (no re-compression)
        expect(result).toBe(blob);
    });
});
```

**Step 2: Run the test to confirm it fails**

```bash
npm test -- mesh-decimator
```

Expected: FAIL — `dracoCompressGLB` is not exported yet.

**Step 3: Add the implementation to `mesh-decimator.ts`**

After the `exportAsGLB` function (around line 394), add:

```typescript
// ===== HD Mesh Draco Compression =====

/**
 * Cheaply check if a GLB blob is already Draco-compressed by reading only
 * the JSON chunk header and looking for KHR_draco_mesh_compression in extensionsUsed.
 * Does not parse geometry or invoke gltf-transform.
 */
async function isAlreadyDracoCompressed(blob: Blob): Promise<boolean> {
    // GLB binary layout:
    //   bytes  0-11: file header (magic, version, length)
    //   bytes 12-15: JSON chunk length
    //   bytes 16-19: JSON chunk type (0x4E4F534A = "JSON")
    //   bytes 20+  : JSON chunk data
    const header = await blob.slice(0, 20).arrayBuffer();
    const view = new DataView(header);
    const jsonLength = view.getUint32(12, true);
    const jsonBytes = await blob.slice(20, 20 + jsonLength).arrayBuffer();
    const json = JSON.parse(new TextDecoder().decode(jsonBytes));
    return (json.extensionsUsed ?? []).includes('KHR_draco_mesh_compression');
}

/**
 * Draco-compress a GLB blob using gltf-transform.
 * Pure blob-to-blob pipeline — no Three.js round-trip.
 * Preserves all textures, PBR materials, animations, and morph targets exactly.
 * Returns the original blob unchanged if already Draco-compressed.
 */
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

**Step 4: Run the tests to confirm they pass**

```bash
npm test -- mesh-decimator
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/modules/mesh-decimator.ts src/modules/__tests__/mesh-decimator.test.ts
git commit -m "feat(mesh-decimator): add dracoCompressGLB with already-compressed detection"
```

---

## Task 4: Show/hide sub-row in `export-controller.ts`

**Files:**
- Modify: `src/modules/export-controller.ts` — `updateArchiveAssetCheckboxes` function (around line 35)

**Step 1: Locate `updateArchiveAssetCheckboxes`**

The function is at line ~35 in `export-controller.ts`. It currently iterates a list of `{ id, loaded }` pairs and sets `checked`/`disabled` on each.

**Step 2: Add sub-row show/hide after the existing checkbox loop**

After the `checkboxes.forEach(...)` call, add:

```typescript
// Show Draco sub-row only when a GLB mesh is loaded
const dracoHdRow = document.getElementById('export-draco-hd-row');
if (dracoHdRow) {
    const fileName = (state._meshFileName || '').toLowerCase();
    const isGlb = fileName.endsWith('.glb');
    dracoHdRow.style.display = (state.modelLoaded && isGlb) ? '' : 'none';
}
```

**Step 3: Verify build**

```bash
npm run build
```

Expected: no TypeScript errors.

**Step 4: Commit**

```bash
git add src/modules/export-controller.ts
git commit -m "feat(export): show Draco HD sub-row when a GLB mesh is loaded"
```

---

## Task 5: Wire Draco compression into `prepareArchive`

**Files:**
- Modify: `src/modules/export-controller.ts` — `prepareArchive` function (around line 328)

**Step 1: Add the import at the top of `export-controller.ts`**

Add to the existing imports block:

```typescript
import { dracoCompressGLB } from './mesh-decimator.js';
```

**Step 2: Locate the mesh blob section in `prepareArchive`**

Find this block (around line 328):

```typescript
if (includeModel && assets.meshBlob && state.modelLoaded) {
    const fileName = state._meshFileName || document.getElementById('model-filename')?.textContent || 'mesh.glb';
    ...
    archiveCreator.addMesh(assets.meshBlob, fileName, {
```

**Step 3: Insert the Draco compression step**

Replace the `archiveCreator.addMesh` call site so it reads the checkbox and conditionally compresses:

```typescript
if (includeModel && assets.meshBlob && state.modelLoaded) {
    const fileName = state._meshFileName || document.getElementById('model-filename')?.textContent || 'mesh.glb';
    const position = modelGroup ? [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z] : [0, 0, 0];
    const rotation = modelGroup ? [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z] : [0, 0, 0];
    const scale: [number, number, number] = modelGroup ? [modelGroup.scale.x, modelGroup.scale.y, modelGroup.scale.z] : [1, 1, 1];

    let meshBlob = assets.meshBlob;
    const dracoHdEl = document.getElementById('export-draco-hd') as HTMLInputElement | null;
    const shouldDracoHD = dracoHdEl?.checked ?? true;
    if (shouldDracoHD && fileName.toLowerCase().endsWith('.glb')) {
        onProgress?.('Draco compressing HD mesh…', 30);
        meshBlob = await dracoCompressGLB(meshBlob);
    }

    log.info(' Adding mesh:', { fileName, position, rotation, scale });
    archiveCreator.addMesh(meshBlob, fileName, {
        position, rotation, scale,
        created_by: metadata.meshMetadata.createdBy || 'unknown',
        created_by_version: metadata.meshMetadata.version || '',
        source_notes: metadata.meshMetadata.sourceNotes || '',
        role: metadata.meshMetadata.role || ''
    });
}
```

> Note: the `position`, `rotation`, `scale` variables are already declared just above this block in the existing code — do not re-declare them. Read the surrounding context carefully before inserting.

**Step 4: Verify build with no TypeScript errors**

```bash
npm run build
```

Expected: build succeeds.

**Step 5: Run all tests**

```bash
npm test
```

Expected: all suites pass.

**Step 6: Commit**

```bash
git add src/modules/export-controller.ts
git commit -m "feat(export): Draco-compress HD mesh on archive export (on by default)"
```

---

## Task 6: Manual smoke test

1. Run `npm run dev`
2. Open the editor at `http://localhost:8080/editor/`
3. Load a non-Draco GLB mesh (any `.glb` without Draco compression)
4. Open the export panel — confirm the "Draco compress" sub-row is visible and checked
5. Click "Download Archive" — confirm the loading overlay shows "Draco compressing HD mesh…" briefly
6. Unzip the resulting `.ddim` archive and confirm `assets/mesh_0.glb` contains `KHR_draco_mesh_compression` in its JSON chunk (use any GLB inspector or the browser console: `JSON.parse(new TextDecoder().decode(await blob.slice(20, 20 + new DataView(await blob.slice(0,20).arrayBuffer()).getUint32(12,true)).arrayBuffer()))`)
7. Load a Draco-compressed GLB — confirm "Draco compress" sub-row is still shown and checked, but the log shows "HD mesh already Draco-compressed, skipping"
8. Uncheck the checkbox — confirm export works and the output mesh is uncompressed
9. Load an `.obj` mesh — confirm the sub-row is hidden

---

## Task 7: Update ROADMAP.md if applicable

Check `ROADMAP.md` for any entry related to mesh compression or archive export. If a relevant item exists, mark it done or update the description.

```bash
git add ROADMAP.md
git commit -m "docs: update ROADMAP for HD mesh Draco export compression"
```
