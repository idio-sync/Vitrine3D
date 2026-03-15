# Draco Proxy Compression Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Draco mesh compression to the SD proxy GLB export pipeline, controlled by a default-on checkbox.

**Architecture:** Post-process GLB output from Three.js GLTFExporter using gltf-transform's WebIO + draco() transform. A new `dracoCompress` boolean flows through the existing DecimationOptions pipeline.

**Tech Stack:** @gltf-transform/core, @gltf-transform/extensions, draco3dgltf, Three.js GLTFExporter, meshoptimizer (existing)

**Design doc:** `docs/plans/2026-03-06-draco-proxy-compression-design.md`

---

### Task 1: Install npm dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install the three packages**

Run:
```bash
npm install @gltf-transform/core @gltf-transform/extensions draco3dgltf
```

**Step 2: Verify installation**

Run:
```bash
node -e "require('@gltf-transform/core'); require('@gltf-transform/extensions'); require('draco3dgltf'); console.log('OK')"
```
Expected: `OK`

**Step 3: Verify build still works**

Run:
```bash
npm run build
```
Expected: Build succeeds with no new errors.

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add gltf-transform and draco3dgltf dependencies"
```

---

### Task 2: Add `dracoCompress` to DecimationOptions type

**Files:**
- Modify: `src/types.ts:10-20`

**Step 1: Add the field**

In `src/types.ts`, add `dracoCompress: boolean;` to the `DecimationOptions` interface, after `textureQuality`:

```typescript
export interface DecimationOptions {
    preset: string;
    targetRatio: number;
    targetFaceCount: number | null;
    errorThreshold: number;
    lockBorder: boolean;
    preserveUVSeams: boolean;
    textureMaxRes: number;
    textureFormat: 'jpeg' | 'png' | 'keep';
    textureQuality: number;
    dracoCompress: boolean;
}
```

**Step 2: Verify no type errors**

Run:
```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: May show errors in `mesh-decimator.ts` `resolveOptions()` since it doesn't set `dracoCompress` yet — that's expected and fixed in Task 3.

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add dracoCompress to DecimationOptions"
```

---

### Task 3: Implement Draco compression in mesh-decimator.ts

**Files:**
- Modify: `src/modules/mesh-decimator.ts`

**Step 1: Add imports**

At the top of `mesh-decimator.ts`, after the existing imports (line ~14), add:

```typescript
import { WebIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
```

**Step 2: Create the WebIO singleton**

After the WASM initialization section (after line ~28), add:

```typescript
// ===== Draco Compression (gltf-transform) =====

let _dracoIO: WebIO | null = null;

async function ensureDracoIO(): Promise<WebIO> {
    if (_dracoIO) return _dracoIO;
    const io = new WebIO()
        .registerExtensions([KHRDracoMeshCompression])
        .registerDependencies({
            'draco3d.encoder': await draco3d.createEncoderModule(),
            'draco3d.decoder': await draco3d.createDecoderModule(),
        });
    _dracoIO = io;
    log.info('gltf-transform Draco IO ready');
    return io;
}
```

**Step 3: Update `resolveOptions()` to include `dracoCompress`**

In `resolveOptions()` (line ~35), add the `dracoCompress` field to the returned object:

```typescript
export function resolveOptions(opts?: Partial<DecimationOptions>): DecimationOptions {
    const presetKey = opts?.preset || DEFAULT_DECIMATION_PRESET;
    const preset: DecimationPreset = DECIMATION_PRESETS[presetKey] || DECIMATION_PRESETS[DEFAULT_DECIMATION_PRESET];
    return {
        preset: presetKey,
        targetRatio: opts?.targetRatio ?? preset.targetRatio,
        targetFaceCount: opts?.targetFaceCount ?? null,
        errorThreshold: opts?.errorThreshold ?? preset.errorThreshold,
        lockBorder: opts?.lockBorder ?? preset.lockBorder,
        preserveUVSeams: opts?.preserveUVSeams ?? preset.preserveUVSeams,
        textureMaxRes: opts?.textureMaxRes ?? preset.textureMaxRes,
        textureFormat: opts?.textureFormat ?? preset.textureFormat,
        textureQuality: opts?.textureQuality ?? preset.textureQuality,
        dracoCompress: opts?.dracoCompress ?? true,
    };
}
```

**Step 4: Update `exportAsGLB()` to accept and apply Draco compression**

Replace the existing `exportAsGLB` function (line ~316):

```typescript
export async function exportAsGLB(group: THREE.Group, dracoCompress = true): Promise<Blob> {
    const exporter = new GLTFExporter();
    const buffer = await exporter.parseAsync(group, { binary: true }) as ArrayBuffer;

    if (!dracoCompress) {
        return new Blob([buffer], { type: 'model/gltf-binary' });
    }

    const io = await ensureDracoIO();
    const doc = await io.readBinary(new Uint8Array(buffer));
    await doc.transform(draco({ method: 'edgebreaker' }));
    const compressed = await io.writeBinary(doc);

    log.info(`Draco compression: ${(buffer.byteLength / 1024).toFixed(0)} KB → ${(compressed.byteLength / 1024).toFixed(0)} KB`);

    return new Blob([compressed], { type: 'model/gltf-binary' });
}
```

**Step 5: Update `generateProxy()` to pass `dracoCompress`**

In `generateProxy()` (line ~328), change the `exportAsGLB` call:

```typescript
    onProgress?.('Exporting GLB', 85);
    const blob = await exportAsGLB(decimatedGroup, options.dracoCompress);
```

**Step 6: Verify build**

Run:
```bash
npm run build
```
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add src/modules/mesh-decimator.ts
git commit -m "feat(decimator): add Draco compression to GLB export via gltf-transform"
```

---

### Task 4: Add checkbox to editor HTML

**Files:**
- Modify: `src/editor/index.html:1131`

**Step 1: Add the Draco checkbox**

In `src/editor/index.html`, after the `</select>` closing the preset dropdown (line ~1131) and before the face count display div (`decimation-face-counts`), add:

```html

                        <label class="prop-label">
                            <input type="checkbox" id="decimation-draco" checked /> Draco compress
                        </label>
```

**Step 2: Verify visually**

Run `npm run dev`, open `/editor/`, scroll to SD Proxy section. Confirm checkbox appears between preset dropdown and face counts, checked by default.

**Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(editor): add Draco compression checkbox to SD Proxy panel"
```

---

### Task 5: Wire checkbox in main.ts

**Files:**
- Modify: `src/main.ts:732-754`

**Step 1: Add element reference**

In the decimation setup block (around line ~732, near the other `getElementById` calls), add:

```typescript
    const dracoInput = document.getElementById('decimation-draco') as HTMLInputElement | null;
```

**Step 2: Add `dracoCompress` to `readOptionsFromUI()`**

In the `readOptionsFromUI()` function (line ~743), add `dracoCompress` to the returned object:

```typescript
    function readOptionsFromUI(): Partial<DecimationOptions> {
        return {
            preset: presetSelect?.value || DEFAULT_DECIMATION_PRESET,
            targetRatio: ratioInput ? parseFloat(ratioInput.value) : undefined,
            targetFaceCount: facesInput?.value ? parseInt(facesInput.value, 10) : null,
            errorThreshold: errorInput ? parseFloat(errorInput.value) : undefined,
            lockBorder: lockBorderInput?.checked,
            preserveUVSeams: preserveUvsInput?.checked,
            textureMaxRes: texResSelect ? parseInt(texResSelect.value, 10) : undefined,
            textureFormat: texFormatSelect?.value as DecimationOptions['textureFormat'],
            textureQuality: texQualityInput ? parseFloat(texQualityInput.value) : undefined,
            dracoCompress: dracoInput?.checked ?? true,
        };
    }
```

**Step 3: Verify build**

Run:
```bash
npm run build
```
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(editor): wire Draco checkbox to proxy generation options"
```

---

### Task 6: Verify end-to-end and run tests

**Step 1: Run existing tests**

Run:
```bash
npm test
```
Expected: All 90 tests pass (no regressions).

**Step 2: Run lint**

Run:
```bash
npm run lint
```
Expected: 0 errors.

**Step 3: Final build**

Run:
```bash
npm run build
```
Expected: Clean build, no errors.

**Step 4: Manual smoke test**

Run `npm run dev`, open `/editor/`:
1. Load a GLB mesh
2. In SD Proxy section, confirm "Draco compress" checkbox is visible and checked
3. Click "Generate SD Proxy" — confirm proxy generates successfully
4. Check browser console for log lines:
   - `gltf-transform Draco IO ready`
   - `Draco compression: XXX KB → YYY KB` (YYY should be significantly smaller)
5. Uncheck "Draco compress", regenerate — confirm no Draco log line, file is larger
6. Export archive, reload it — confirm proxy mesh loads correctly (DRACOLoader handles decoding)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(decimator): Draco compression for proxy GLB generation"
```
