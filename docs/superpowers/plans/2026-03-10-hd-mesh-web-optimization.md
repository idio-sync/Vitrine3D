# HD Mesh Web Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editor UI section that decimates the HD mesh to a user-specified face count with optional Draco compression, replacing the primary mesh for display and export while keeping the original in memory for revert.

**Architecture:** New "Web Optimization" collapsible section in the editor sidebar above the SD Proxy section. Reuses `decimateScene()`, `exportAsGLB()`, and `dracoCompressGLB()` from `mesh-decimator.ts`. New state fields on `AppState` track the original mesh for revert. Export path uses whatever blob is current — no special branching needed.

**Tech Stack:** TypeScript, Three.js, meshoptimizer WASM (existing), gltf-transform + Draco (existing)

**Spec:** `docs/superpowers/specs/2026-03-10-hd-mesh-web-optimization-design.md`

---

## Chunk 1: State, UI, and Wiring

### Task 1: Add state fields to AppState

**Files:**
- Modify: `src/types.ts` — `AppState` interface (around line 50-109)
- Modify: `src/main.ts` — state initialization (around line 300-325)

- [ ] **Step 1: Add new fields to `AppState` in `src/types.ts`**

Add these fields to the `AppState` interface, after the existing proxy fields (around line 98):

```typescript
// HD web optimization (revert support)
originalMeshBlob: Blob | null;
originalMeshGroup: THREE.Group | null;
meshOptimized: boolean;
meshOptimizationSettings: {
    targetFaces: number;
    dracoEnabled: boolean;
    originalFaces: number;
    resultFaces: number;
} | null;
```

Note: `THREE.Group` may need to use `any` here if the existing pattern uses `any` for Three.js types (check what `proxyMeshGroup` uses — it's typed as `any | null` on line 96).

- [ ] **Step 2: Initialize new fields in `state` object in `src/main.ts`**

Find the state initialization block (around line 312-315 where `proxyMeshGroup`, `proxyMeshSettings`, `proxyMeshFaceCount` are initialized). Add after them:

```typescript
originalMeshBlob: null,
originalMeshGroup: null,
meshOptimized: false,
meshOptimizationSettings: null,
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/main.ts
git commit -m "feat(web-opt): add AppState fields for HD mesh optimization"
```

---

### Task 2: Add HTML section to editor

**Files:**
- Modify: `src/editor/index.html` — insert new section above the SD Proxy section (before line 1242)

- [ ] **Step 1: Add "Web Optimization" section HTML**

Insert this block immediately before `<div class="prop-section" id="proxy-section">` (line 1242):

```html
<!-- HD Web Optimization -->
<div class="prop-section hidden" id="web-opt-section">
    <div class="prop-section-hd">
        <span class="prop-section-title">Web Optimization</span>
        <span class="prop-section-chevron">&#9654;</span>
    </div>
    <div class="prop-section-body">
        <div class="prop-hint" id="web-opt-current-faces">
            Current faces: &mdash;
        </div>

        <label class="prop-label mt4">Target face count</label>
        <input type="number" class="prop-input" id="web-opt-target-faces"
               min="1000" step="1000" value="1000000" />

        <label class="prop-label mt4">
            <input type="checkbox" id="web-opt-draco" checked />
            Draco compression
        </label>

        <div class="mt4" style="display: flex; gap: 4px;">
            <button class="prop-btn" id="btn-web-opt-generate">Optimize</button>
            <button class="prop-btn small danger hidden" id="btn-web-opt-revert">Revert</button>
        </div>

        <div id="web-opt-status" class="prop-hint mt4 hidden"></div>

        <!-- Progress bar -->
        <div id="web-opt-progress" class="hidden mt4">
            <div class="progress-bar">
                <div class="progress-bar-fill" id="web-opt-progress-fill"></div>
            </div>
            <span class="prop-hint" id="web-opt-progress-text">Preparing...</span>
        </div>
    </div>
</div>
```

The section starts `hidden` and is shown by JS when a mesh is loaded (same pattern as `proxy-section`).

- [ ] **Step 2: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(web-opt): add Web Optimization section to editor HTML"
```

---

### Task 3: Wire up optimize/revert logic in main.ts

**Files:**
- Modify: `src/main.ts` — add event wiring and handler functions

This task wires up the Optimize and Revert buttons. The pattern follows the existing SD proxy wiring (lines 1013-1109 of main.ts).

- [ ] **Step 1: Add section visibility toggle when mesh loads**

The `proxy-section` is always visible in HTML (never toggled by JS), but `web-opt-section` starts with `hidden` class and needs to be shown when a mesh loads. Find where `state.meshFaceCount` is set after mesh load (around line 464 of main.ts, in the mesh load callback). Add visibility toggling there:

```typescript
// Show/hide web optimization section based on mesh loaded state
const webOptSection = document.getElementById('web-opt-section');
if (webOptSection) {
    webOptSection.classList.toggle('hidden', !state.modelLoaded);
}
```

Also update the face count display whenever `state.meshFaceCount` is set:

```typescript
const webOptFaces = document.getElementById('web-opt-current-faces');
if (webOptFaces) {
    const count = state.meshOptimized
        ? state.meshOptimizationSettings?.originalFaces ?? state.meshFaceCount
        : state.meshFaceCount;
    webOptFaces.textContent = `Current faces: ${count.toLocaleString()}`;
}
```

- [ ] **Step 2: Add the Optimize button handler**

Add near the existing proxy button wiring (after line ~1109). Follow the same pattern as `btn-generate-proxy`:

```typescript
addListener('btn-web-opt-generate', 'click', async () => {
    if (!modelGroup || !assets.meshBlob) {
        notify('No mesh loaded', 'warning');
        return;
    }

    const targetFacesEl = document.getElementById('web-opt-target-faces') as HTMLInputElement;
    const dracoEl = document.getElementById('web-opt-draco') as HTMLInputElement;
    const targetFaces = parseInt(targetFacesEl?.value || '1000000', 10);
    const dracoEnabled = dracoEl?.checked ?? true;

    if (targetFaces >= state.meshFaceCount) {
        notify('Target face count must be less than current faces', 'warning');
        return;
    }

    // Save originals for revert (only if not already optimized)
    if (!state.meshOptimized) {
        state.originalMeshBlob = assets.meshBlob;
        state.originalMeshGroup = modelGroup.clone(true);
    }

    // Show progress
    const progressEl = document.getElementById('web-opt-progress');
    const progressFill = document.getElementById('web-opt-progress-fill') as HTMLElement;
    const progressText = document.getElementById('web-opt-progress-text');
    if (progressEl) progressEl.classList.remove('hidden');

    const btnGenerate = document.getElementById('btn-web-opt-generate') as HTMLButtonElement;
    if (btnGenerate) btnGenerate.disabled = true;

    try {
        showLoading('Optimizing mesh...');

        const { decimateScene, exportAsGLB, dracoCompressGLB } = await import('./modules/mesh-decimator.js');

        // Decimation options — use target face count, no texture downscaling
        const targetRatio = targetFaces / state.meshFaceCount;
        const result = await decimateScene(modelGroup, {
            targetRatio: Math.min(targetRatio, 1),
            targetFaceCount: targetFaces,
            errorThreshold: 0.1,
            lockBorder: true,
            preserveUVSeams: true,
            textureMaxRes: 4096,      // preserve HD textures
            textureFormat: 'keep',     // no texture conversion
            textureQuality: 1.0,
            dracoCompress: false,      // handled separately via dracoCompressGLB
            preset: 'custom',
        }, (stage, pct) => {
            if (progressFill) progressFill.style.width = `${pct * 100}%`;
            if (progressText) progressText.textContent = stage;
        });

        // Export as GLB blob (with or without Draco)
        let blob = await exportAsGLB(result.group, false);
        if (dracoEnabled) {
            if (progressText) progressText.textContent = 'Applying Draco compression...';
            blob = await dracoCompressGLB(blob);
        }

        // Replace the displayed mesh
        // Remove old mesh children from modelGroup, add decimated children
        while (modelGroup.children.length > 0) {
            const child = modelGroup.children[0];
            modelGroup.remove(child);
            if ((child as any).geometry) (child as any).geometry.dispose();
            if ((child as any).material) {
                const mat = (child as any).material;
                if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose());
                else mat.dispose();
            }
        }
        for (const child of result.group.children) {
            modelGroup.add(child.clone(true));
        }

        // Update blob reference for export
        assets.meshBlob = blob;

        // Update state
        state.meshOptimized = true;
        state.meshOptimizationSettings = {
            targetFaces,
            dracoEnabled,
            originalFaces: result.totalOriginalFaces || state.meshFaceCount,
            resultFaces: result.totalNewFaces,
        };
        state.meshFaceCount = result.totalNewFaces;

        // Update UI
        const statusEl = document.getElementById('web-opt-status');
        if (statusEl) {
            statusEl.textContent = `Optimized: ${result.totalNewFaces.toLocaleString()} faces`;
            statusEl.classList.remove('hidden');
        }
        const revertBtn = document.getElementById('btn-web-opt-revert');
        if (revertBtn) revertBtn.classList.remove('hidden');

        // Update face count display
        const webOptFaces = document.getElementById('web-opt-current-faces');
        if (webOptFaces) {
            webOptFaces.textContent = `Original: ${state.meshOptimizationSettings.originalFaces.toLocaleString()} faces`;
        }

        // Also update the SD proxy HD face count display
        const hdFacesEl = document.getElementById('decimation-hd-faces');
        if (hdFacesEl) hdFacesEl.textContent = result.totalNewFaces.toLocaleString();

        notify(`Mesh optimized to ${result.totalNewFaces.toLocaleString()} faces`, 'success');
    } catch (err) {
        log.error('Web optimization failed:', err);
        notify('Mesh optimization failed: ' + (err as Error).message, 'error');
    } finally {
        hideLoading();
        if (progressEl) progressEl.classList.add('hidden');
        if (btnGenerate) btnGenerate.disabled = false;
    }
});
```

- [ ] **Step 3: Add the Revert button handler**

Add immediately after the optimize handler:

```typescript
addListener('btn-web-opt-revert', 'click', async () => {
    if (!state.originalMeshBlob || !state.originalMeshGroup) {
        notify('No original mesh to revert to', 'warning');
        return;
    }

    // Restore original mesh in scene
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        modelGroup.remove(child);
        if ((child as any).geometry) (child as any).geometry.dispose();
        if ((child as any).material) {
            const mat = (child as any).material;
            if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose());
            else mat.dispose();
        }
    }
    for (const child of state.originalMeshGroup.children) {
        modelGroup.add(child.clone(true));
    }

    // Restore blob
    assets.meshBlob = state.originalMeshBlob;

    // Restore face count
    const originalFaces = state.meshOptimizationSettings?.originalFaces ?? 0;
    state.meshFaceCount = originalFaces;

    // Clear optimization state
    state.meshOptimized = false;
    state.meshOptimizationSettings = null;
    state.originalMeshBlob = null;
    state.originalMeshGroup = null;

    // Update UI
    const statusEl = document.getElementById('web-opt-status');
    if (statusEl) statusEl.classList.add('hidden');
    const revertBtn = document.getElementById('btn-web-opt-revert');
    if (revertBtn) revertBtn.classList.add('hidden');
    const webOptFaces = document.getElementById('web-opt-current-faces');
    if (webOptFaces) webOptFaces.textContent = `Current faces: ${originalFaces.toLocaleString()}`;

    // Update SD proxy face count display
    const hdFacesEl = document.getElementById('decimation-hd-faces');
    if (hdFacesEl) hdFacesEl.textContent = originalFaces.toLocaleString();

    notify('Reverted to original mesh', 'success');
});
```

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(web-opt): wire up optimize and revert handlers"
```

---

### Task 4: Add web_optimization metadata to archive manifest

**Files:**
- Modify: `src/modules/export-controller.ts` — in `prepareArchive()`, around lines 355-362

- [ ] **Step 1: Add web_optimization metadata to mesh manifest entry**

In `export-controller.ts`, find the `archiveCreator.addMesh()` call (around line 355). After the `addMesh()` call, add metadata if the mesh was optimized. The `addMesh` method returns an entry key (e.g., `'mesh_0'`). Use it to attach metadata:

```typescript
const meshEntryKey = archiveCreator.addMesh(meshBlob, fileName, {
    position, rotation, scale,
    created_by: metadata.meshMetadata.createdBy || 'unknown',
    created_by_version: metadata.meshMetadata.version || '',
    source_notes: metadata.meshMetadata.sourceNotes || '',
    role: metadata.meshMetadata.role || ''
});

// Add web optimization metadata if mesh was optimized
if (state.meshOptimized && state.meshOptimizationSettings) {
    const manifest = archiveCreator.getManifest();
    if (manifest.data_entries[meshEntryKey]) {
        manifest.data_entries[meshEntryKey].web_optimization = {
            originalFaces: state.meshOptimizationSettings.originalFaces,
            resultFaces: state.meshOptimizationSettings.resultFaces,
            dracoCompressed: state.meshOptimizationSettings.dracoEnabled,
        };
    }
}
```

Note: Check if `archiveCreator` exposes a `getManifest()` method or if the manifest is accessible differently. The `addMesh()` already returns the entry key. If no `getManifest()` exists, the metadata can be passed via the `parameters` option in `AddAssetOptions`:

```typescript
archiveCreator.addMesh(meshBlob, fileName, {
    position, rotation, scale,
    created_by: metadata.meshMetadata.createdBy || 'unknown',
    created_by_version: metadata.meshMetadata.version || '',
    source_notes: metadata.meshMetadata.sourceNotes || '',
    role: metadata.meshMetadata.role || '',
    parameters: state.meshOptimized && state.meshOptimizationSettings ? {
        web_optimization: {
            originalFaces: state.meshOptimizationSettings.originalFaces,
            resultFaces: state.meshOptimizationSettings.resultFaces,
            dracoCompressed: state.meshOptimizationSettings.dracoEnabled,
        }
    } : undefined,
});
```

The `parameters` field spreads into `_parameters` in the manifest (see archive-creator.ts line 1362: `...(options.parameters || {})`).

- [ ] **Step 2: Leave existing `export-draco-hd` logic unchanged**

The existing `export-draco-hd` checkbox and its logic in export-controller.ts (lines 346-351) handle Draco compression at export time for non-optimized meshes. This is independent of the web optimization feature — users may want Draco at export without decimating. Do not remove it.

- [ ] **Step 3: Ensure `state` is accessible in export-controller.ts**

The `prepareArchive` function receives deps. Check that `state` (specifically `meshOptimized` and `meshOptimizationSettings`) is available via the deps object. If not, it needs to be added to `ExportDeps` in `src/types.ts` and the factory in `main.ts`.

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/export-controller.ts src/types.ts src/editor/index.html
git commit -m "feat(web-opt): add web_optimization metadata to archive manifest"
```

---

### Task 5: Manual testing

- [ ] **Step 1: Run dev server and test the full flow**

```bash
npm run dev
```

Open `http://localhost:8080/editor/` in a browser. Test:

1. Load a GLB mesh — verify "Web Optimization" section appears with correct face count
2. Set target face count to something lower than current — click Optimize
3. Verify progress shows, mesh updates in viewport, status shows result face count
4. Verify Revert button appears — click it, confirm original mesh restores
5. Optimize again, then export archive — verify archive contains decimated mesh
6. Verify SD Proxy section still works independently after optimization

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: 0 errors.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: All existing tests pass.

- [ ] **Step 4: Final commit if any lint/test fixes needed**
