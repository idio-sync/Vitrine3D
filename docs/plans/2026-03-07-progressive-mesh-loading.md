# Progressive Mesh Loading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Load SD proxy mesh first in kiosk mode for fast time-to-interactive, then seamlessly swap in HD mesh in the background.

**Architecture:** Modify kiosk archive loading to force SD-first when device tier is HD and a mesh proxy exists. Add a new `swapMeshInPlace()` function that replaces geometry/materials on the existing modelGroup without clearing the scene. Refactor `loadArchiveFullResMesh()` to use this swap. Add a CSS-only background loading indicator.

**Tech Stack:** TypeScript, Three.js, CSS animations

---

### Task 1: Add background loading indicator HTML + CSS

**Files:**
- Modify: `src/index.html:56-58` (inside `#viewer-container`)
- Modify: `src/styles.css:1394-1405` (near existing `.loading-spinner`)

**Step 1: Add indicator element to HTML**

In `src/index.html`, inside the `#viewer-container` div (after the canvas elements), add:

```html
<div id="bg-loading-indicator" class="bg-loading-indicator hidden" title="Loading full resolution...">
    <div class="bg-loading-spinner"></div>
</div>
```

**Step 2: Add CSS styles**

In `src/styles.css`, after the existing `@keyframes spin` block (line ~1405), add:

```css
/* Background loading indicator — shown while HD mesh loads behind SD proxy */
.bg-loading-indicator {
    position: absolute;
    bottom: 12px;
    left: 12px;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.5;
    transition: opacity 0.3s ease;
    pointer-events: auto;
    cursor: default;
}

.bg-loading-indicator.hidden {
    display: none;
}

.bg-loading-indicator.fade-out {
    opacity: 0;
}

.bg-loading-spinner {
    width: 24px;
    height: 24px;
    border: 2.5px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    color: var(--text-secondary, rgba(255, 255, 255, 0.6));
}
```

**Step 3: Verify indicator renders**

Temporarily remove the `hidden` class in the HTML to confirm the spinner appears in the bottom-left of the viewer. Then re-add `hidden`.

**Step 4: Commit**

```bash
git add src/index.html src/styles.css
git commit -m "feat(kiosk): add background loading indicator element and styles"
```

---

### Task 2: Create `swapMeshInPlace()` function in file-handlers.ts

**Files:**
- Modify: `src/modules/file-handlers.ts:1620-1665` (before `loadArchiveFullResMesh`)

**Step 1: Add the swap helper function**

Insert before `loadArchiveFullResMesh` (line ~1620) in `src/modules/file-handlers.ts`:

```typescript
/**
 * Parse a mesh from a blob URL into a temporary off-scene group.
 * Returns the loaded object without adding it to any scene graph.
 */
async function parseMeshOffScene(blobUrl: string, fileName: string, onProgress?: (loaded: number, total: number) => void): Promise<{ object: THREE.Object3D; faceCount: number } | null> {
    const extension = fileName.split('.').pop()?.toLowerCase();
    let loadedObject: THREE.Object3D | undefined;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(blobUrl, onProgress);
    } else if (extension === 'obj') {
        loadedObject = await loadOBJFromUrl(blobUrl, onProgress);
    } else if (extension === 'stl') {
        loadedObject = await loadSTLFromUrl(blobUrl, onProgress);
    } else if (extension === 'drc') {
        loadedObject = await loadDRC(blobUrl, onProgress);
    }

    if (!loadedObject) return null;

    const faceCount = computeMeshFaceCount(loadedObject);
    return { object: loadedObject, faceCount };
}

/**
 * Swap mesh geometry and materials in-place on modelGroup.
 * Performs a synchronous swap so the renderer never draws an empty frame.
 *
 * Strategy:
 * - Collect all Mesh children from both old (modelGroup) and new (parsed HD object)
 * - If counts match, swap geometry + material per-child (fastest, no scene graph change)
 * - If counts differ, bulk remove-all + add-all in one synchronous block
 * - Dispose old geometry/materials after swap
 */
function swapMeshChildren(modelGroup: THREE.Group, newObject: THREE.Object3D): void {
    const oldMeshes: THREE.Mesh[] = [];
    modelGroup.traverse((child: any) => {
        if (child.isMesh) oldMeshes.push(child);
    });

    const newMeshes: THREE.Mesh[] = [];
    newObject.traverse((child: any) => {
        if (child.isMesh) newMeshes.push(child);
    });

    if (oldMeshes.length === newMeshes.length && oldMeshes.length > 0) {
        // Per-child geometry/material swap — no scene graph mutation
        for (let i = 0; i < oldMeshes.length; i++) {
            const oldGeo = oldMeshes[i].geometry;
            const oldMat = oldMeshes[i].material;

            oldMeshes[i].geometry = newMeshes[i].geometry;
            oldMeshes[i].material = newMeshes[i].material;

            // Dispose old resources
            if (oldGeo) oldGeo.dispose();
            if (Array.isArray(oldMat)) {
                oldMat.forEach(m => { if (m.dispose) m.dispose(); });
            } else if (oldMat && (oldMat as THREE.Material).dispose) {
                (oldMat as THREE.Material).dispose();
            }
        }
    } else {
        // Mesh count mismatch — bulk swap in one synchronous block
        // Collect old children for disposal
        const oldChildren = [...modelGroup.children];

        // Remove all old children
        while (modelGroup.children.length > 0) {
            modelGroup.remove(modelGroup.children[0]);
        }

        // Add all new children
        if (newObject.children) {
            // Move children from the loaded object to modelGroup
            const newChildren = [...newObject.children];
            for (const child of newChildren) {
                modelGroup.add(child);
            }
        } else {
            modelGroup.add(newObject);
        }

        // Dispose old resources
        for (const child of oldChildren) {
            disposeObject(child);
        }
    }
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/modules/file-handlers.ts
git commit -m "feat(file-handlers): add parseMeshOffScene and swapMeshChildren helpers"
```

---

### Task 3: Refactor `loadArchiveFullResMesh()` to use in-place swap

**Files:**
- Modify: `src/modules/file-handlers.ts:1625-1665`

**Step 1: Refactor the function**

Replace the body of `loadArchiveFullResMesh` (lines 1625-1665) with:

```typescript
export async function loadArchiveFullResMesh(archiveLoader: ArchiveLoader, deps: LoadFullResDeps): Promise<AssetLoadResult> {
    const { state, callbacks = {} } = deps;
    const meshEntry = archiveLoader.getMeshEntry();
    if (!meshEntry) {
        return { loaded: false, blob: null, error: 'No full-resolution mesh in archive' };
    }

    const meshData = await archiveLoader.extractFile(meshEntry.file_name);
    if (!meshData) {
        return { loaded: false, blob: null, error: 'Failed to extract full-resolution mesh' };
    }

    const { modelGroup } = deps;

    // Capture current modelGroup transform (preserves user edits during quality switch)
    const currentTransform = modelGroup ? {
        position: [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z] as [number, number, number],
        rotation: [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z] as [number, number, number],
        scale: [modelGroup.scale.x, modelGroup.scale.y, modelGroup.scale.z] as [number, number, number]
    } : null;

    // Parse HD mesh off-scene (no visual disruption)
    const parsed = await parseMeshOffScene(meshData.url, meshEntry.file_name);
    if (!parsed) {
        return { loaded: false, blob: null, error: 'Failed to parse full-resolution mesh' };
    }

    // In-place swap: synchronous, no empty frames
    if (modelGroup && modelGroup.children.length > 0) {
        swapMeshChildren(modelGroup, parsed.object);
    } else {
        // No existing mesh to swap — just add directly (first load, no proxy)
        if (modelGroup) {
            modelGroup.add(parsed.object);
        }
    }

    state.modelLoaded = true;

    // Re-apply the captured transform, falling back to manifest
    const transform = currentTransform || archiveLoader.getEntryTransform(meshEntry);
    if (callbacks.onApplyModelTransform) {
        callbacks.onApplyModelTransform(transform);
    }

    state.assetStates.mesh = ASSET_STATE.LOADED;
    return { loaded: true, blob: meshData.blob, error: null, faceCount: parsed.faceCount };
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Verify the existing quality toggle still works**

Manually test: open an archive with a mesh proxy in the editor, toggle quality SD <-> HD. The mesh should swap without a blank frame.

**Step 4: Commit**

```bash
git add src/modules/file-handlers.ts
git commit -m "refactor(file-handlers): use in-place swap in loadArchiveFullResMesh"
```

---

### Task 4: Add show/hide helpers for the background indicator in kiosk-main.ts

**Files:**
- Modify: `src/modules/kiosk-main.ts` (near other UI helper functions)

**Step 1: Add indicator helpers**

Find the UI helper section in `kiosk-main.ts` (near `showLoading`/`hideLoading`) and add:

```typescript
/** Show the background loading indicator (bottom-left spinner) */
function showBgLoadingIndicator(): void {
    const el = document.getElementById('bg-loading-indicator');
    if (el) {
        el.classList.remove('hidden', 'fade-out');
    }
}

/** Hide the background loading indicator with a fade-out */
function hideBgLoadingIndicator(): void {
    const el = document.getElementById('bg-loading-indicator');
    if (!el || el.classList.contains('hidden')) return;
    el.classList.add('fade-out');
    setTimeout(() => {
        el.classList.add('hidden');
        el.classList.remove('fade-out');
    }, 300);
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(kiosk): add show/hide helpers for background loading indicator"
```

---

### Task 5: Modify `handleArchiveFile()` for SD-first loading with background HD swap

**Files:**
- Modify: `src/modules/kiosk-main.ts:1317-1320` (quality tier resolution)
- Modify: `src/modules/kiosk-main.ts:1710-1751` (Phase 3 background loading)

**Step 1: Force SD-first when HD tier + mesh proxy exists**

In `handleArchiveFile()`, after quality tier resolution (line ~1320) and BEFORE the `ensureAssetLoaded` call, add logic to override the quality tier for initial mesh load:

```typescript
// Resolve quality tier based on device capabilities
const glContext = renderer ? renderer.getContext() : null;
state.qualityResolved = resolveQualityTier(state.qualityTier, glContext);
log.info('Quality tier resolved:', state.qualityResolved);

// Progressive loading: if device is HD-capable and archive has a mesh proxy,
// load SD first for fast time-to-interactive, then upgrade to HD in background.
const shouldProgressiveLoad = state.qualityResolved === 'hd'
    && contentInfo.hasMeshProxy
    && (primaryType === 'mesh' || state.displayMode === 'model' || state.displayMode === 'both');
const initialQualityOverride = shouldProgressiveLoad ? 'sd' : state.qualityResolved;
```

Then modify the `createArchiveDeps()` call used by `ensureAssetLoaded` to use `initialQualityOverride` instead of `state.qualityResolved` for the initial load. The cleanest way: temporarily set `state.qualityResolved` to `'sd'` before the primary load, then restore it after.

Right before the `ensureAssetLoaded` call for the primary asset (~line 1348):

```typescript
// Temporarily override quality tier for initial load if progressive loading
const originalQualityResolved = state.qualityResolved;
if (shouldProgressiveLoad) {
    state.qualityResolved = 'sd';
    log.info('Progressive load: using SD proxy for initial display');
}
```

Right after `ensureAssetLoaded` completes and before Phase 3 (~after line 1365):

```typescript
// Restore original quality tier after initial load
if (shouldProgressiveLoad) {
    state.qualityResolved = originalQualityResolved;
}
```

**Step 2: Add background HD upgrade to Phase 3**

In the Phase 3 background loading section (line ~1710), add the progressive HD upgrade BEFORE the existing remaining-types loop:

```typescript
// === Phase 3: Background-load remaining assets ===

// Progressive mesh upgrade: swap SD proxy for HD in the background
if (shouldProgressiveLoad && state.archiveLoader) {
    showBgLoadingIndicator();
    log.info('Progressive load: starting background HD mesh upgrade');
    try {
        const result = await loadArchiveFullResMesh(state.archiveLoader, createFullResDeps());
        if (result.loaded) {
            log.info(`Progressive load: HD mesh swapped (${result.faceCount?.toLocaleString()} faces)`);
            // Update face count display
            const facesEl = document.getElementById('model-faces');
            if (facesEl && result.faceCount) facesEl.textContent = result.faceCount.toLocaleString();
        }
    } catch (e: any) {
        log.warn('Progressive load: HD mesh upgrade failed, keeping SD proxy:', e.message);
    } finally {
        hideBgLoadingIndicator();
    }
}

const remainingTypes = ['splat', 'mesh', 'pointcloud'].filter(
    t => state.assetStates[t] === ASSET_STATE.UNLOADED
);
```

**Step 3: Add `createFullResDeps` helper**

Near the existing `createArchiveDeps` function (line ~1872), add:

```typescript
function createFullResDeps(): LoadFullResDeps {
    return {
        scene,
        getSplatMesh: () => splatMesh,
        setSplatMesh: (mesh) => { splatMesh = mesh; },
        modelGroup,
        state: state as any,
        sceneManager,
        callbacks: {
            onApplyModelTransform: (transform) => {
                if (!modelGroup || !transform) return;
                const hasRealTransform = transform.position?.some((v: number) => v !== 0) ||
                    transform.rotation?.some((v: number) => v !== 0) ||
                    (transform.scale != null && normalizeScale(transform.scale).some(v => v !== 1));
                if (!hasRealTransform) return;
                if (transform.position) modelGroup.position.fromArray(transform.position);
                if (transform.rotation) modelGroup.rotation.set(...transform.rotation as [number, number, number]);
                if (transform.scale) {
                    const s = normalizeScale(transform.scale);
                    modelGroup.scale.set(...s as [number, number, number]);
                }
            },
        },
    };
}
```

Ensure `LoadFullResDeps` is imported at the top of `kiosk-main.ts` from `file-handlers.js`.

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(kiosk): progressive mesh loading — SD first, HD in background"
```

---

### Task 6: Verify `shouldProgressiveLoad` is false for SD devices

**Files:**
- No changes — verification only

**Step 1: Trace the logic for mobile devices**

Verify that when `resolveQualityTier` returns `'sd'` (iOS/Android), `shouldProgressiveLoad` evaluates to `false` because the first condition `state.qualityResolved === 'hd'` fails. No background HD load happens, no indicator is shown. This preserves existing mobile behavior exactly.

**Step 2: Trace the logic for archives without mesh proxy**

Verify that when `contentInfo.hasMeshProxy` is false, `shouldProgressiveLoad` is `false`. The archive loads HD directly (current behavior, unchanged).

**Step 3: Trace the logic for manual quality toggle**

Verify that the existing quality toggle code in `kiosk-main.ts:1830-1866` calls `loadArchiveFullResMesh` which now uses the in-place swap. This benefits all platforms including mobile when a user explicitly toggles to HD.

**Step 4: Commit (no changes needed)**

No commit — this is verification only.

---

### Task 7: End-to-end manual testing

**Files:**
- No changes — testing only

**Step 1: Test progressive loading on desktop**

1. Build: `npm run build`
2. Open a kiosk link with an archive that has a mesh proxy: `?archive=<url>&kiosk=true`
3. Verify: SD mesh loads and scene becomes interactive quickly
4. Verify: background loading indicator appears in bottom-left
5. Verify: HD mesh swaps in seamlessly (no blank frame, no pop)
6. Verify: indicator fades out after swap

**Step 2: Test fallback — archive without mesh proxy**

1. Open a kiosk link with an archive that has NO mesh proxy
2. Verify: HD mesh loads directly (current behavior, no indicator shown)

**Step 3: Test mobile behavior (or simulate via DevTools)**

1. Open DevTools, toggle device toolbar to an iOS/Android UA
2. Open the same archive with mesh proxy
3. Verify: SD mesh loads, NO background HD load, NO indicator shown

**Step 4: Test manual quality toggle**

1. Load an archive with mesh proxy in kiosk mode
2. After load, use the quality toggle to switch SD <-> HD
3. Verify: mesh swaps without blank frame in both directions

**Step 5: Test splat-only archive**

1. Open an archive that has only a splat (no mesh)
2. Verify: no progressive loading triggered, no indicator, normal behavior

---
