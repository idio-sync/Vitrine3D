# Optimization Object Profiles Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate Web Optimization, SD Proxy, and Splat Quality controls into a unified "Optimization" section driven by object-size profiles that auto-fill face count and texture targets.

**Architecture:** New `OBJECT_PROFILES` constant in `constants.ts` defines HD+SD targets per size category (Small/Medium/Large/Massive/Custom). A new `#optimization-section` in the editor HTML replaces the separate `#web-opt-section` and `#proxy-section`. A new `setupOptimizationPanel()` in `main.ts` wires the profile dropdown to fill both subsections. Archive round-trip stores/restores the selected profile via `_meta.quality.objectProfile`.

**Tech Stack:** TypeScript, Three.js, meshoptimizer WASM, Draco Web Worker, HTML/CSS

**Spec:** `docs/superpowers/specs/2026-03-13-optimization-object-profiles-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/modules/constants.ts` | Modify | Add `ObjectProfileTier`, `ObjectProfile`, `OBJECT_PROFILES`, `DEFAULT_OBJECT_PROFILE` |
| `src/types.ts` | Modify | Add `objectProfile` to `AppState` |
| `src/editor/index.html` | Modify | Replace `#web-opt-section` + `#proxy-section` with unified `#optimization-section` |
| `src/main.ts` | Modify | Replace `setupDecimationPanel()` with `setupOptimizationPanel()`, add profile logic |
| `src/modules/archive-creator.ts` | Modify | Add `objectProfile` to `QualityStats` + `setQualityStats()` |
| `src/modules/export-controller.ts` | Modify | Pass `objectProfile` in quality stats and decimation block |
| `src/modules/archive-pipeline.ts` | Modify | Read `objectProfile` from manifest on load, call `onProfileLoaded` callback |

---

## Chunk 1: Data Model

### Task 1: Add ObjectProfile types and OBJECT_PROFILES to constants.ts

**Files:**
- Modify: `src/modules/constants.ts:256-319` (after existing `DECIMATION_PRESETS` block)

- [ ] **Step 1: Add interfaces and constant**

Add after line 319 (`export const DEFAULT_DECIMATION_PRESET = 'medium';`):

```ts
// =============================================================================
// OBJECT PROFILES (size-aware optimization presets)
// =============================================================================

export interface ObjectProfileTier {
    targetFaces: number;
    textureMaxRes: number;
    errorThreshold: number;
    lockBorder: boolean;
    preserveUVSeams: boolean;
    textureFormat: 'jpeg' | 'png' | 'keep';
    textureQuality: number;
}

export interface ObjectProfile {
    name: string;
    description: string;
    hd: ObjectProfileTier;
    sd: ObjectProfileTier;
}

export const OBJECT_PROFILES: Record<string, ObjectProfile> = {
    'small': {
        name: 'Small Object',
        description: 'Jewelry, shoes, pottery',
        hd: { targetFaces: 300_000, textureMaxRes: 2048, errorThreshold: 0.05,
               lockBorder: true, preserveUVSeams: true, textureFormat: 'jpeg', textureQuality: 0.90 },
        sd: { targetFaces: 50_000,  textureMaxRes: 1024, errorThreshold: 0.2,
               lockBorder: true, preserveUVSeams: false, textureFormat: 'jpeg', textureQuality: 0.80 },
    },
    'medium': {
        name: 'Medium Object',
        description: 'Furniture, busts, sculptures',
        hd: { targetFaces: 500_000, textureMaxRes: 4096, errorThreshold: 0.05,
               lockBorder: true, preserveUVSeams: true, textureFormat: 'jpeg', textureQuality: 0.90 },
        sd: { targetFaces: 100_000, textureMaxRes: 1024, errorThreshold: 0.15,
               lockBorder: true, preserveUVSeams: true, textureFormat: 'jpeg', textureQuality: 0.85 },
    },
    'large': {
        name: 'Large Object',
        description: 'Monuments, room interiors',
        hd: { targetFaces: 1_000_000, textureMaxRes: 4096, errorThreshold: 0.03,
               lockBorder: true, preserveUVSeams: true, textureFormat: 'jpeg', textureQuality: 0.90 },
        sd: { targetFaces: 250_000,   textureMaxRes: 2048, errorThreshold: 0.1,
               lockBorder: true, preserveUVSeams: true, textureFormat: 'jpeg', textureQuality: 0.85 },
    },
    'massive': {
        name: 'Massive / Building',
        description: 'Full buildings, complexes',
        hd: { targetFaces: 2_000_000, textureMaxRes: 4096, errorThreshold: 0.02,
               lockBorder: true, preserveUVSeams: true, textureFormat: 'jpeg', textureQuality: 0.90 },
        sd: { targetFaces: 500_000,   textureMaxRes: 2048, errorThreshold: 0.08,
               lockBorder: true, preserveUVSeams: true, textureFormat: 'jpeg', textureQuality: 0.85 },
    },
    'custom': {
        name: 'Custom',
        description: 'Set values manually',
        hd: { targetFaces: 1_000_000, textureMaxRes: 4096, errorThreshold: 0.05,
               lockBorder: true, preserveUVSeams: true, textureFormat: 'jpeg', textureQuality: 0.90 },
        sd: { targetFaces: 100_000,   textureMaxRes: 1024, errorThreshold: 0.1,
               lockBorder: true, preserveUVSeams: true, textureFormat: 'jpeg', textureQuality: 0.85 },
    },
};

export const DEFAULT_OBJECT_PROFILE = 'medium';
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: SUCCESS — no type errors, no import issues

- [ ] **Step 3: Commit**

```bash
git add src/modules/constants.ts
git commit -m "feat(constants): add ObjectProfile types and OBJECT_PROFILES presets"
```

---

### Task 2: Add objectProfile to AppState

**Files:**
- Modify: `src/types.ts:108-116` (AppState decimation/proxy block)

- [ ] **Step 1: Add objectProfile field**

In `AppState`, after `meshOptimized: boolean;` (around line 115), add:

```ts
    objectProfile: string | null;
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: FAIL — `main.ts` will error because the `state` object literal doesn't include `objectProfile`. That's expected and will be fixed in Task 5.

- [ ] **Step 3: Add default to state object in main.ts**

In `src/main.ts`, find the `const state: AppState = {` object (around line 300). Add after `meshOptimizationSettings: null,` (around line 326):

```ts
    objectProfile: null,
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/main.ts
git commit -m "feat(types): add objectProfile to AppState"
```

---

### Task 3: Add objectProfile to QualityStats in archive-creator.ts

**Files:**
- Modify: `src/modules/archive-creator.ts:371-382` (QualityStats interface)
- Modify: `src/modules/archive-creator.ts:1660-1674` (setQualityStats method)

- [ ] **Step 1: Add field to QualityStats interface**

At `archive-creator.ts:382`, before the closing `}` of `QualityStats`, add:

```ts
    objectProfile?: string;
```

- [ ] **Step 2: Add handler in setQualityStats**

At `archive-creator.ts:1673`, after the `texture_maps` line and before the closing `}`, add:

```ts
        if (stats.objectProfile !== undefined) this.manifest._meta.quality.objectProfile = stats.objectProfile;
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All existing tests pass (archive-creator tests should still pass)

- [ ] **Step 5: Commit**

```bash
git add src/modules/archive-creator.ts
git commit -m "feat(archive-creator): add objectProfile to QualityStats"
```

---

## Chunk 2: HTML Restructure

### Task 4: Replace web-opt-section and proxy-section with unified optimization-section

**Files:**
- Modify: `src/editor/index.html:1312-1485` (replace both sections)

This is the largest single change. Replace the entire `#web-opt-section` (lines 1312-1361) and `#proxy-section` (lines 1363-1485) with a single `#optimization-section`.

- [ ] **Step 1: Replace both sections**

Delete lines 1312-1485 (from `<!-- HD Web Optimization -->` through the closing `</div>` of `#proxy-section`). Replace with:

```html
                <!-- Optimization (unified) -->
                <div class="prop-section hidden" id="optimization-section">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Optimization</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">

                        <!-- Object Profile selector -->
                        <label class="prop-label">Object Profile</label>
                        <select class="prop-select" id="object-profile-select">
                            <option value="small">Small Object</option>
                            <option value="medium" selected>Medium Object</option>
                            <option value="large">Large Object</option>
                            <option value="massive">Massive / Building</option>
                            <option value="custom">Custom</option>
                        </select>

                        <!-- Web Optimization sub-section -->
                        <div class="prop-section hidden" id="web-opt-subsection" style="margin-top:8px;">
                            <div class="prop-section-hd">
                                <span class="prop-section-title">Web Optimization</span>
                                <span class="prop-section-chevron">&#9654;</span>
                            </div>
                            <div class="prop-section-body">
                                <div class="prop-hint" id="web-opt-current-faces">
                                    Current faces: &mdash;
                                </div>

                                <div id="web-opt-faces-row" class="mt4">
                                    <label class="prop-label">Target face count</label>
                                    <input type="number" class="prop-input" id="web-opt-target-faces"
                                           min="1000" step="1000" value="500000" />
                                </div>

                                <!-- Ratio mode (shown only for Custom profile) -->
                                <div id="web-opt-ratio-row" class="mt4" style="display:none">
                                    <label class="prop-label">Target mode</label>
                                    <select class="prop-select" id="web-opt-mode">
                                        <option value="faces">Face count</option>
                                        <option value="ratio">Ratio</option>
                                    </select>
                                    <div id="web-opt-ratio-input-row" class="mt4" style="display:none">
                                        <label class="prop-label">Target ratio</label>
                                        <input type="number" class="prop-input" id="web-opt-target-ratio"
                                               min="0.01" max="0.99" step="0.01" value="0.5" />
                                        <span class="prop-hint" id="web-opt-ratio-estimate"></span>
                                    </div>
                                </div>

                                <div class="mt4">
                                    <label class="prop-label">Texture max resolution</label>
                                    <select class="prop-select" id="web-opt-texture-res">
                                        <option value="1024">1024</option>
                                        <option value="2048">2048</option>
                                        <option value="4096" selected>4096</option>
                                        <option value="8192">8192</option>
                                    </select>
                                </div>

                                <label class="prop-label mt4">
                                    <input type="checkbox" id="web-opt-draco" checked />
                                    Draco compression
                                </label>

                                <div class="mt4" style="display: flex; gap: 4px;">
                                    <button class="prop-btn" id="btn-web-opt-generate">Optimize</button>
                                    <button class="prop-btn small danger hidden" id="btn-web-opt-revert">Revert</button>
                                </div>

                                <div id="web-opt-status" class="prop-hint mt4 hidden"></div>

                                <div id="web-opt-progress" class="hidden mt4">
                                    <div class="progress-bar">
                                        <div class="progress-bar-fill" id="web-opt-progress-fill"></div>
                                    </div>
                                    <span class="prop-hint" id="web-opt-progress-text">Preparing...</span>
                                </div>
                            </div>
                        </div>

                        <!-- SD Proxy sub-section -->
                        <div class="prop-section hidden" id="sd-proxy-subsection" style="margin-top:8px;">
                            <div class="prop-section-hd">
                                <span class="prop-section-title">SD Proxy</span>
                                <span class="prop-section-chevron">&#9654;</span>
                            </div>
                            <div class="prop-section-body">
                                <div id="decimation-face-counts" class="prop-hint">
                                    <div>HD: <span id="decimation-hd-faces">&mdash;</span> faces</div>
                                    <div>SD target: <span id="decimation-sd-faces">&mdash;</span> faces</div>
                                </div>
                                <div id="decimation-below-target" class="prop-hint hidden" style="color: var(--accent-color);">
                                    Mesh already below target.
                                </div>

                                <div class="mt4">
                                    <label class="prop-label">Target face count</label>
                                    <input type="number" class="prop-input" id="decimation-target-faces"
                                           min="1000" step="1000" value="100000" />
                                </div>

                                <div class="mt4">
                                    <label class="prop-label">Texture max resolution</label>
                                    <select class="prop-select" id="decimation-texture-res">
                                        <option value="256">256</option>
                                        <option value="512">512</option>
                                        <option value="1024" selected>1024</option>
                                        <option value="2048">2048</option>
                                        <option value="4096">4096</option>
                                    </select>
                                </div>

                                <label class="prop-label mt4">
                                    <input type="checkbox" id="decimation-draco" checked /> Draco compress
                                </label>

                                <button class="prop-btn mt4" id="btn-generate-proxy">Generate SD Proxy</button>

                                <div id="decimation-status" class="hidden mt4">
                                    <span class="prop-hint" id="decimation-status-text"></span>
                                    <div class="mt4">
                                        <button class="prop-btn small" id="btn-preview-proxy">Preview SD</button>
                                        <button class="prop-btn small danger" id="btn-remove-proxy">Remove Proxy</button>
                                    </div>
                                </div>

                                <div id="decimation-progress" class="hidden mt4">
                                    <div class="progress-bar">
                                        <div class="progress-bar-fill" id="decimation-progress-fill"></div>
                                    </div>
                                    <span class="prop-hint" id="decimation-progress-text">Preparing...</span>
                                </div>

                                <!-- Manual proxy upload -->
                                <div class="prop-subsection-toggle mt4" id="decimation-manual-toggle">
                                    <span class="prop-subsection-chevron">&#9654;</span> Manual Proxy Upload
                                </div>
                                <div class="prop-subsection-body hidden" id="decimation-manual-body">
                                    <label for="proxy-mesh-input" class="prop-btn" style="font-size:10px; cursor:pointer;">Mesh Proxy (.glb, .obj)</label>
                                    <input type="file" id="proxy-mesh-input" accept=".glb,.gltf,.obj,.mtl,.png,.jpg,.jpeg,.tga,.bmp,.webp" multiple style="display:none" />
                                    <span id="proxy-mesh-filename" class="prop-hint">No proxy loaded</span>

                                    <label for="proxy-splat-input" class="prop-btn mt4" style="font-size:10px; cursor:pointer;">Splat Proxy (.ply, .spz)</label>
                                    <input type="file" id="proxy-splat-input" accept=".ply,.spz,.ksplat,.sog,.splat" style="display:none" />
                                    <span id="proxy-splat-filename" class="prop-hint">No proxy loaded</span>
                                </div>
                            </div>
                        </div>

                        <!-- Splat Quality sub-section -->
                        <div class="prop-section hidden" id="splat-quality-subsection" style="margin-top:8px;">
                            <div class="prop-section-hd">
                                <span class="prop-section-title">Splat Quality</span>
                                <span class="prop-section-chevron">&#9654;</span>
                            </div>
                            <div class="prop-section-body">
                                <label style="font-size: 10px; display: flex; align-items: flex-start; gap: 4px; cursor: pointer;">
                                    <input type="checkbox" id="chk-splat-lod" checked style="margin-top: 2px;" />
                                    <span>Generate Splat LOD at archive export</span>
                                </label>
                                <span class="prop-hint" style="font-size: 9px; margin-left: 18px; display: block;">Requires .spz or .ply input. .sog files use runtime LOD instead.</span>
                            </div>
                        </div>

                    </div>
                </div>
```

- [ ] **Step 2: Verify the HTML is well-formed**

Run: `npm run build`
Expected: Vite bundles both entry points without HTML parse errors

- [ ] **Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(editor): replace web-opt + proxy sections with unified optimization section"
```

---

## Chunk 3: Main.ts Wiring

### Task 5: Replace setupDecimationPanel() with setupOptimizationPanel()

**Files:**
- Modify: `src/main.ts:1149-1591` (setupDecimationPanel function + web-opt wiring)
- Modify: `src/main.ts:2268` (call site)
- Modify: `src/main.ts:523-530` (web-opt section show on mesh load)

This is the largest code change. The new `setupOptimizationPanel()` function handles:
1. Profile dropdown → fills both subsections
2. Web Optimization generate/revert (existing logic, updated element IDs)
3. SD Proxy generate/preview/remove (existing logic, updated to use `targetFaceCount` from input)
4. Section visibility (show on mesh/splat load)

- [ ] **Step 1: Add import for OBJECT_PROFILES**

At the top of `main.ts`, in the constants import (find the existing import from `'./modules/constants.js'`), add `OBJECT_PROFILES` and `DEFAULT_OBJECT_PROFILE` to the import:

```ts
import { OBJECT_PROFILES, DEFAULT_OBJECT_PROFILE } from './modules/constants.js';
```

Add the type import:

```ts
import type { ObjectProfileTier } from './modules/constants.js';
```

- [ ] **Step 2: Add helper to build DecimationOptions from ObjectProfileTier**

Add this helper function above `setupOptimizationPanel()`:

```ts
/** Build a DecimationOptions from an ObjectProfileTier + UI checkbox state. */
function buildDecimationOptions(tier: ObjectProfileTier, dracoCompress: boolean): DecimationOptions {
    return {
        preset: 'custom',
        targetRatio: 0, // not used when targetFaceCount is set
        targetFaceCount: tier.targetFaces,
        errorThreshold: tier.errorThreshold,
        lockBorder: tier.lockBorder,
        preserveUVSeams: tier.preserveUVSeams,
        textureMaxRes: tier.textureMaxRes,
        textureFormat: tier.textureFormat,
        textureQuality: tier.textureQuality,
        dracoCompress,
    };
}
```

- [ ] **Step 3: Write setupOptimizationPanel()**

Replace the entire `setupDecimationPanel()` function (lines ~1149-1591, including web-opt wiring) with `setupOptimizationPanel()`. The function must:

**a) Profile dropdown handler:**
```ts
const profileSelect = document.getElementById('object-profile-select') as HTMLSelectElement | null;
if (profileSelect) {
    profileSelect.value = DEFAULT_OBJECT_PROFILE;
    state.objectProfile = DEFAULT_OBJECT_PROFILE;

    profileSelect.addEventListener('change', () => {
        const key = profileSelect.value;
        state.objectProfile = key;

        // Show/hide ratio mode row (must be before early return)
        const ratioRow = document.getElementById('web-opt-ratio-row');
        if (ratioRow) ratioRow.style.display = key === 'custom' ? '' : 'none';

        const profile = OBJECT_PROFILES[key];
        if (!profile || key === 'custom') return;

        // Fill HD (web-opt) fields
        const hdFaces = document.getElementById('web-opt-target-faces') as HTMLInputElement | null;
        const hdTexRes = document.getElementById('web-opt-texture-res') as HTMLSelectElement | null;
        if (hdFaces) hdFaces.value = String(profile.hd.targetFaces);
        if (hdTexRes) hdTexRes.value = String(profile.hd.textureMaxRes);

        // Fill SD (proxy) fields
        const sdFaces = document.getElementById('decimation-target-faces') as HTMLInputElement | null;
        const sdTexRes = document.getElementById('decimation-texture-res') as HTMLSelectElement | null;
        if (sdFaces) sdFaces.value = String(profile.sd.targetFaces);
        if (sdTexRes) sdTexRes.value = String(profile.sd.textureMaxRes);

        // Update SD face estimate display
        updateSdFaceEstimate();
    });

    // Trigger initial fill
    profileSelect.dispatchEvent(new Event('change'));
}
```

**b) SD face estimate helper (define at module scope, above `setupOptimizationPanel`, so the mesh-load callback at line ~523 can also call it):**
```ts
function updateSdFaceEstimate(): void {
    const sdFacesEl = document.getElementById('decimation-sd-faces');
    const sdTargetInput = document.getElementById('decimation-target-faces') as HTMLInputElement | null;
    const belowTargetEl = document.getElementById('decimation-below-target');
    if (sdFacesEl && sdTargetInput) {
        const target = parseInt(sdTargetInput.value) || 0;
        sdFacesEl.textContent = target.toLocaleString();
        if (belowTargetEl) {
            belowTargetEl.classList.toggle('hidden', !(state.meshFaceCount > 0 && state.meshFaceCount <= target));
        }
    }
    const hdFacesEl = document.getElementById('decimation-hd-faces');
    if (hdFacesEl) hdFacesEl.textContent = (state.meshFaceCount || 0).toLocaleString();
}
```

**c) Web-opt generate button:** Reuse existing `btn-web-opt-generate` click handler logic from the current code (lines ~1390-1520). Key change: read `targetFaceCount` from `#web-opt-target-faces`, `textureMaxRes` from `#web-opt-texture-res`, and build options using `buildDecimationOptions()` with an `ObjectProfileTier` constructed from the UI values. Keep ratio mode support for Custom profile.

**d) Web-opt revert button:** Reuse existing `btn-web-opt-revert` logic unchanged (lines ~1525-1580).

**e) SD Proxy generate button:** Reuse existing `btn-generate-proxy` click handler logic (lines ~1250-1325). Key change: instead of reading from `#decimation-preset` dropdown and calling `resolveOptions({ preset })`, read `targetFaceCount` from `#decimation-target-faces`, `textureMaxRes` from `#decimation-texture-res`, and build options using `buildDecimationOptions()`.

**f) Preview/remove proxy buttons:** Reuse existing logic unchanged.

**g) Manual proxy upload toggles:** Reuse existing `#decimation-manual-toggle` logic.

**h) Sub-section collapsible toggles:** Add click handlers for `#web-opt-subsection .prop-section-hd`, `#sd-proxy-subsection .prop-section-hd`, and `#splat-quality-subsection .prop-section-hd` to toggle their bodies.

**i) Splat LOD checkbox wiring:** Migrate the `chk-splat-lod` change handler from the old `setupDecimationPanel()` (lines ~1251-1258 in current code). This handler updates `state.splatLodEnabled` when the checkbox changes. Without this, the splat LOD state will never be updated from the UI:

```ts
const splatLodCheckbox = document.getElementById('chk-splat-lod') as HTMLInputElement | null;
if (splatLodCheckbox) {
    splatLodCheckbox.addEventListener('change', () => {
        state.splatLodEnabled = splatLodCheckbox.checked;
    });
}
```

- [ ] **Step 4: Update the call site**

At `main.ts:2268`, change `setupDecimationPanel();` to `setupOptimizationPanel();`

- [ ] **Step 5: Update mesh load visibility logic**

At `main.ts:523-530`, change the code that shows `#web-opt-section` to instead show `#optimization-section`, `#web-opt-subsection`, and `#sd-proxy-subsection`:

```ts
// Show optimization section
const optSection = document.getElementById('optimization-section');
if (optSection) optSection.classList.remove('hidden');
const webOptSub = document.getElementById('web-opt-subsection');
if (webOptSub) webOptSub.classList.remove('hidden');
const sdProxySub = document.getElementById('sd-proxy-subsection');
if (sdProxySub) sdProxySub.classList.remove('hidden');
// Update face counts
const webOptFaces = document.getElementById('web-opt-current-faces');
if (webOptFaces) {
    webOptFaces.textContent = `Current faces: ${state.meshFaceCount.toLocaleString()}`;
}
updateSdFaceEstimate();
```

- [ ] **Step 6: Update splat load visibility**

Find the code that shows splat-related UI on splat load. Add:

```ts
const optSection = document.getElementById('optimization-section');
if (optSection) optSection.classList.remove('hidden');
const splatQualitySub = document.getElementById('splat-quality-subsection');
if (splatQualitySub) splatQualitySub.classList.remove('hidden');
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 8: Manual smoke test**

Run: `npm run dev`, open http://localhost:8080/editor/
1. Verify the "Optimization" section appears in the Assets pane when a mesh is loaded
2. Verify the Object Profile dropdown has 5 options (Small, Medium, Large, Massive, Custom)
3. Change profile → verify face count and texture res fields update in both subsections
4. Click "Generate SD Proxy" → verify proxy is generated
5. Click "Optimize" in Web Optimization → verify mesh is optimized
6. Select "Custom" → verify ratio mode toggle appears

- [ ] **Step 9: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): replace setupDecimationPanel with setupOptimizationPanel

Unified optimization panel with Object Profile dropdown that auto-fills
HD and SD targets. Existing generate/revert/preview logic preserved."
```

---

## Chunk 4: Archive Round-Trip

### Task 6: Store objectProfile in export-controller.ts

**Files:**
- Modify: `src/modules/export-controller.ts:432-445` (proxy decimation block)
- Modify: `src/modules/export-controller.ts` (qualityStats call)

- [ ] **Step 1: Add objectProfile to decimation block**

At `export-controller.ts:437-445`, update the decimation object to include `objectProfile`:

```ts
            decimation: state.proxyMeshSettings ? {
                preset: state.proxyMeshSettings.preset,
                objectProfile: state.objectProfile || undefined,
                targetRatio: state.proxyMeshSettings.targetFaceCount
                    ? (state.proxyMeshSettings.targetFaceCount / (state.meshFaceCount || 1))
                    : state.proxyMeshSettings.targetRatio,
                errorThreshold: state.proxyMeshSettings.errorThreshold,
                textureMaxRes: state.proxyMeshSettings.textureMaxRes,
                textureFormat: state.proxyMeshSettings.textureFormat,
                originalFaces: state.meshFaceCount || 0,
                resultFaces: state.proxyMeshFaceCount || 0,
            } : undefined,
```

- [ ] **Step 2: Add objectProfile to qualityStats**

Find the `setQualityStats()` call in export-controller.ts (grep for `setQualityStats`). Add `objectProfile: state.objectProfile || undefined` to the stats object.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src/modules/export-controller.ts
git commit -m "feat(export): store objectProfile in manifest quality stats and decimation block"
```

---

### Task 7: Read objectProfile on archive load in archive-pipeline.ts

**Files:**
- Modify: `src/types.ts` (ArchivePipelineDeps)
- Modify: `src/modules/archive-pipeline.ts`
- Modify: `src/main.ts` (provide callback in deps factory)

- [ ] **Step 1: Add onProfileLoaded callback to ArchivePipelineDeps**

In `src/types.ts`, find the `ArchivePipelineDeps` interface (line ~428). Add to its properties:

```ts
    onProfileLoaded?: (profile: string) => void;
```

- [ ] **Step 2: Read objectProfile in archive-pipeline.ts**

In `archive-pipeline.ts`, find where the manifest is processed after loading (grep for `manifest._meta` or where state is restored from the manifest). Add:

```ts
// Restore object profile from manifest
const objectProfile = manifest?._meta?.quality?.objectProfile;
if (objectProfile && typeof objectProfile === 'string') {
    deps.state.objectProfile = objectProfile;
    deps.onProfileLoaded?.(objectProfile);
}
```

- [ ] **Step 3: Provide callback in main.ts deps factory**

In `main.ts`, find the `createArchivePipelineDeps()` factory function. Add the `onProfileLoaded` callback:

```ts
onProfileLoaded: (profile: string) => {
    state.objectProfile = profile;
    const select = document.getElementById('object-profile-select') as HTMLSelectElement | null;
    if (select && profile in OBJECT_PROFILES) {
        select.value = profile;
        select.dispatchEvent(new Event('change'));
    }
},
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/modules/archive-pipeline.ts src/main.ts
git commit -m "feat(archive): restore objectProfile on archive load

Reads _meta.quality.objectProfile from manifest and updates the
optimization panel dropdown + field values via onProfileLoaded callback."
```

---

## Chunk 5: Verification

### Task 8: Build and lint verification

**Files:** None (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: SUCCESS with zero errors

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: Zero errors (warnings OK)

- [ ] **Step 3: Tests**

Run: `npm test`
Expected: All existing tests pass

- [ ] **Step 4: Manual end-to-end test**

Run: `npm run dev`, open http://localhost:8080/editor/

Test matrix:
1. Load a mesh → Optimization section appears with Web Opt + SD Proxy subsections
2. Load a splat → Splat Quality subsection appears
3. Change Object Profile → both subsections update values
4. Generate SD Proxy → proxy appears, Preview SD/HD toggle works
5. Optimize (web-opt) → mesh face count changes, Revert works
6. Export archive → re-import → Object Profile dropdown shows saved value, fields populated
7. Select Custom → ratio mode toggle appears in web-opt subsection
8. Load mesh with fewer faces than SD target → "Mesh already below target" hint shown
