# Post-Processing Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full post-processing pipeline with 7 screen-space effects (SSAO, bloom, sharpen, vignette, chromatic aberration, color balance, grain) to both the editor and kiosk viewer.

**Architecture:** Three.js `EffectComposer` with 3 passes: RenderPass, SSAOPass, UnrealBloomPass, and a custom uber-ShaderPass combining 5 lightweight effects. New `post-processing.ts` module owns the composer lifecycle. Settings serialize to `viewer_settings.post_processing` in archives.

**Tech Stack:** Three.js 0.182.0 postprocessing addons (EffectComposer, RenderPass, SSAOPass, UnrealBloomPass, ShaderPass), custom GLSL uber-shader.

**Design doc:** `docs/plans/2026-03-04-post-processing-design.md`

---

### Task 1: Create PostProcessingConfig type and defaults

**Files:**
- Modify: `src/types.ts`
- Modify: `src/modules/constants.js`

**Step 1: Add PostProcessingConfig type to types.ts**

Add after the existing type exports (around line 224, after `EventWiringDeps`):

```typescript
export interface PostProcessingEffectConfig {
    ssao: { enabled: boolean; radius: number; intensity: number };
    bloom: { enabled: boolean; strength: number; radius: number; threshold: number };
    sharpen: { enabled: boolean; intensity: number };
    vignette: { enabled: boolean; intensity: number; offset: number };
    chromaticAberration: { enabled: boolean; intensity: number };
    colorBalance: {
        enabled: boolean;
        shadows: [number, number, number];
        midtones: [number, number, number];
        highlights: [number, number, number];
    };
    grain: { enabled: boolean; intensity: number };
}
```

**Step 2: Add defaults to constants.js**

Add a new `POST_PROCESSING` export to `src/modules/constants.js` with the default values for each effect:

```javascript
export const POST_PROCESSING = {
    SSAO: { enabled: false, radius: 0.5, intensity: 1.0 },
    BLOOM: { enabled: false, strength: 0.5, radius: 0.4, threshold: 0.85 },
    SHARPEN: { enabled: false, intensity: 0.3 },
    VIGNETTE: { enabled: false, intensity: 0.5, offset: 1.0 },
    CHROMATIC_ABERRATION: { enabled: false, intensity: 0.005 },
    COLOR_BALANCE: { enabled: false, shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] },
    GRAIN: { enabled: false, intensity: 0.05 },
};
```

**Step 3: Run build to verify**

Run: `npm run build`
Expected: Clean build, no type errors.

**Step 4: Commit**

```
feat: add PostProcessingConfig type and default constants
```

---

### Task 2: Create the uber-shader GLSL

**Files:**
- Create: `src/modules/post-processing.ts` (shader material only, no composer yet)

**Step 1: Create post-processing.ts with the UberShaderMaterial**

Create the module with:
- Logger setup: `const log = Logger.getLogger('post-processing');`
- Import `ShaderMaterial`, `Vector2` from `three`
- Define `UberShaderMaterial` as a `ShaderMaterial` subclass (or factory) with:
  - Vertex shader: standard fullscreen quad passthrough (use `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`)
  - Fragment shader implementing all 5 effects with uniform-gated branches:
    - **Chromatic aberration** (applied first, before other effects read the color): offset R/G/B channel UVs from center
    - **Sharpen**: 3x3 unsharp mask kernel on tDiffuse
    - **Color balance**: lift-gamma-gain using luminance to weight shadows/midtones/highlights
    - **Grain**: hash-based noise overlay `fract(sin(dot(...)))` scaled by intensity
    - **Vignette** (applied last, darkens edges): `smoothstep(offset, offset - intensity, length(uv - 0.5))`
  - All uniforms as listed in the design doc

**Step 2: Run build to verify shader compiles**

Run: `npm run build`
Expected: Clean build. Shader is just a string — no runtime validation yet, but TS should compile.

**Step 3: Commit**

```
feat: add uber-shader material for post-processing effects
```

---

### Task 3: Build the EffectComposer pipeline

**Files:**
- Modify: `src/modules/post-processing.ts`

**Step 1: Add the full composer pipeline**

Add imports:
```typescript
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
```

Implement the public API:
- `enable(renderer, scene, camera)`: Create `EffectComposer`, add passes in order (RenderPass → SSAOPass → UnrealBloomPass → ShaderPass with uber-shader). Set SSAOPass and UnrealBloomPass `.enabled = false` by default.
- `disable()`: Dispose composer, null references.
- `isEnabled()`: Return whether composer exists.
- `render()`: If any pass beyond RenderPass is enabled, call `composer.render()`. Otherwise call `renderer.render(scene, camera)` directly (zero overhead when all effects off but pipeline is "enabled").
- `resize(width, height, pixelRatio)`: Update composer size and SSAOPass resolution.
- `dispose()`: Full cleanup of render targets and passes.
- `setConfig(config)` / `getConfig()`: Bulk get/set all effect parameters. Updates uniforms on the passes.
- `setSSAO({enabled, radius, intensity})`: Toggle SSAOPass.enabled, set kernelRadius, set output intensity.
- `setBloom({enabled, strength, radius, threshold})`: Toggle UnrealBloomPass.enabled, set strength/radius/threshold.
- `setUberEffects(opts)`: Update uber-shader uniforms for sharpen/vignette/chromaticAberration/colorBalance/grain.

Important: the uber-shader ShaderPass should always be in the pipeline but checks its own uniforms — no need to toggle its `.enabled` property. It's a no-op when all 5 sub-effects are disabled.

**Step 2: Run build**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```
feat: implement EffectComposer pipeline with SSAO, bloom, and uber-shader passes
```

---

### Task 4: Integrate into SceneManager render loop

**Files:**
- Modify: `src/modules/scene-manager.ts`

**Step 1: Add post-processing support to SceneManager**

Add a private field and setter:
```typescript
private postProcessing: any = null;

setPostProcessing(pp: any): void {
    this.postProcessing = pp;
}
```

**Step 2: Update the `render()` method**

In `SceneManager.render()` (around line 1273):
- In the `else` branch (normal view, line 1311-1312), replace `this.renderer!.render(this.scene!, this.camera!)` with:
  ```typescript
  if (this.postProcessing?.isEnabled()) {
      this.postProcessing.render();
  } else {
      this.renderer!.render(this.scene!, this.camera!);
  }
  ```
- In the `split` branch (line 1296), apply post-processing to the left (main) canvas only. The right canvas keeps `this.rendererRight!.render()` unchanged.

**Step 3: Update `onWindowResize()`**

After the existing `this.renderer!.setSize(...)` call, add:
```typescript
if (this.postProcessing?.isEnabled()) {
    this.postProcessing.resize(width, height, this.renderer!.getPixelRatio());
}
```

Handle both `split` and normal branches (use the width that matches the renderer being resized).

**Step 4: Run build**

Run: `npm run build`
Expected: Clean build.

**Step 5: Commit**

```
feat: integrate post-processing into SceneManager render loop
```

---

### Task 5: Wire post-processing into editor (main.ts)

**Files:**
- Modify: `src/main.ts`

**Step 1: Import and initialize post-processing**

Find where `SceneManager` is created in `init()`. After the scene manager is initialized and its properties are extracted to loose variables, create the post-processing module:

```typescript
import * as postProcessingModule from './modules/post-processing.js';
```

In `init()`, after sceneManager creation:
```typescript
// Initialize post-processing (disabled by default, WebGL only)
if (sceneManager.rendererType === 'webgl') {
    postProcessingModule.enable(renderer, scene, camera);
    sceneManager.setPostProcessing(postProcessingModule);
}
```

**Step 2: Handle renderer switching**

In the `onRendererChanged` callback (the one passed to SceneManager or set after creation), add logic:
- If switched to WebGPU: `postProcessingModule.disable(); sceneManager.setPostProcessing(null);` + notify user
- If switched to WebGL: `postProcessingModule.enable(renderer, scene, camera); sceneManager.setPostProcessing(postProcessingModule);`

**Step 3: Update screenshot capture**

In `screenshot-manager.ts`, the `captureScreenshot()` function calls `renderer.render(scene, camera)` before `canvas.toBlob()`. Pass the post-processing module reference so it calls `postProcessingModule.render()` instead when active. The simplest approach: add an optional `postProcessing` parameter to the function, or check if `sceneManager.postProcessing?.isEnabled()`.

**Step 4: Run build and test manually**

Run: `npm run build`
Expected: Clean build. Open `/editor/` in browser, verify scene still renders normally (no effects enabled yet).

**Step 5: Commit**

```
feat: wire post-processing module into editor initialization
```

---

### Task 6: Add editor UI controls

**Files:**
- Modify: `src/editor/index.html`
- Modify: `src/modules/event-wiring.ts`

**Step 1: Add HTML for Post-Processing section**

In `src/editor/index.html`, find the Tone Mapping (Live) section (around line 706-726). After the closing `</div>` of that prop-section (line 726), add a new Post-Processing collapsible section.

Use the same markup patterns as the existing sections (`prop-section`, `prop-section-hd`, `prop-section-body`, `sl-row`, `cb-row`). IDs for elements:

- Master: `pp-master-enable` (checkbox)
- SSAO: `pp-ssao-enable` (checkbox), `pp-ssao-radius` (range), `pp-ssao-intensity` (range)
- Bloom: `pp-bloom-enable` (checkbox), `pp-bloom-strength` (range), `pp-bloom-radius` (range), `pp-bloom-threshold` (range)
- Sharpen: `pp-sharpen-enable` (checkbox), `pp-sharpen-intensity` (range)
- Vignette: `pp-vignette-enable` (checkbox), `pp-vignette-intensity` (range), `pp-vignette-offset` (range)
- Chromatic Aberration: `pp-ca-enable` (checkbox), `pp-ca-intensity` (range)
- Color Balance: `pp-cb-enable` (checkbox), `pp-cb-shadows-r/g/b` (range), `pp-cb-midtones-r/g/b` (range), `pp-cb-highlights-r/g/b` (range)
- Grain: `pp-grain-enable` (checkbox), `pp-grain-intensity` (range)

Each range input has a corresponding `<span class="sl-val" id="pp-{effect}-{param}-value">` for numeric readout.

Use the slider ranges from the design doc:
| Effect | Parameter | Min | Max | Default | Step |
|--------|-----------|-----|-----|---------|------|
| SSAO | radius | 0.1 | 2.0 | 0.5 | 0.05 |
| SSAO | intensity | 0 | 3.0 | 1.0 | 0.1 |
| Bloom | strength | 0 | 3.0 | 0.5 | 0.05 |
| Bloom | radius | 0 | 1.0 | 0.4 | 0.05 |
| Bloom | threshold | 0 | 1.0 | 0.85 | 0.05 |
| Sharpen | intensity | 0 | 1.0 | 0.3 | 0.05 |
| Vignette | intensity | 0 | 1.5 | 0.5 | 0.05 |
| Vignette | offset | 0 | 2.0 | 1.0 | 0.05 |
| Chromatic Aberration | intensity | 0 | 0.05 | 0.005 | 0.001 |
| Color Balance | all channels | -1.0 | 1.0 | 0 | 0.05 |
| Grain | intensity | 0 | 0.5 | 0.05 | 0.01 |

**Step 2: Wire events in event-wiring.ts**

In `setupUIEvents()`, add a new section for post-processing controls. The function receives `deps: EventWiringDeps` — the post-processing module reference needs to be accessible. Either:
- Add `postProcessing` to `EventWiringDeps` in `src/types.ts`, or
- Access it via `deps.sceneManager` (since sceneManager already has the reference via `setPostProcessing`)

For each checkbox: `addListener('pp-{effect}-enable', 'change', ...)` → call the corresponding setter.
For each slider: `addListener('pp-{effect}-{param}', 'input', ...)` → update the value display span and call the setter.

The master enable checkbox should:
- When checked: if on WebGPU, auto-switch to WebGL first, then enable the pipeline
- When unchecked: disable all effects (set each enabled=false), disable the pipeline

**Step 3: Run build and test manually**

Run: `npm run build`
Expected: Clean build. Open `/editor/`, Scene Settings panel shows Post-Processing section. Toggling controls should update the renderer in real time.

**Step 4: Commit**

```
feat: add post-processing UI controls to editor scene settings
```

---

### Task 7: Archive serialization — save post-processing settings

**Files:**
- Modify: `src/modules/archive-creator.ts`

**Step 1: Add post_processing to manifest type**

In `archive-creator.ts`, find the `viewer_settings` type in the manifest interface (around line 286). Add after the last field (around `measurement_unit`):

```typescript
post_processing?: {
    ssao: { enabled: boolean; radius: number; intensity: number };
    bloom: { enabled: boolean; strength: number; radius: number; threshold: number };
    sharpen: { enabled: boolean; intensity: number };
    vignette: { enabled: boolean; intensity: number; offset: number };
    chromatic_aberration: { enabled: boolean; intensity: number };
    color_balance: {
        enabled: boolean;
        shadows: [number, number, number];
        midtones: [number, number, number];
        highlights: [number, number, number];
    };
    grain: { enabled: boolean; intensity: number };
};
```

**Step 2: Add to default manifest**

In the default manifest object (around line 661), add `post_processing: undefined` (or omit — it's optional).

**Step 3: Update setViewerSettings()**

In `setViewerSettings()` (around line 1142), add:

```typescript
if (settings.postProcessing !== undefined) {
    this.manifest.viewer_settings.post_processing = settings.postProcessing;
}
```

The camelCase→snake_case conversion happens here: `settings.postProcessing` (JS) maps to `manifest.viewer_settings.post_processing` (JSON).

**Step 4: Update the export flow**

Wherever `setViewerSettings()` is called during archive export (in `main.ts` or `export-controller.ts`), ensure the post-processing config is included in the settings object. Search for `setViewerSettings` calls and add `postProcessing: postProcessingModule.getConfig()` to the settings object being passed.

**Step 5: Run build**

Run: `npm run build`
Expected: Clean build.

**Step 6: Commit**

```
feat: serialize post-processing settings in archive manifests
```

---

### Task 8: Archive deserialization — apply post-processing on load (editor)

**Files:**
- Modify: `src/modules/archive-pipeline.ts`

**Step 1: Update applyViewerSettings()**

In `applyViewerSettings()` (line 731 in `archive-pipeline.ts`), after the tone mapping section (around line 838), add:

```typescript
// Apply saved post-processing settings
if (settings.post_processing) {
    const pp = deps.sceneManager?.postProcessing;
    if (pp) {
        // Ensure pipeline is enabled
        if (!pp.isEnabled() && deps.sceneRefs.renderer) {
            pp.enable(deps.sceneRefs.renderer, deps.sceneRefs.scene, deps.sceneRefs.camera);
            deps.sceneManager.setPostProcessing(pp);
        }
        // Convert snake_case manifest to camelCase config
        pp.setConfig({
            ssao: settings.post_processing.ssao,
            bloom: settings.post_processing.bloom,
            sharpen: settings.post_processing.sharpen,
            vignette: settings.post_processing.vignette,
            chromaticAberration: settings.post_processing.chromatic_aberration,
            colorBalance: settings.post_processing.color_balance,
            grain: settings.post_processing.grain,
        });
    }
}
```

Also update the UI controls to reflect loaded values — set checkbox states and slider values for each loaded setting.

**Step 2: Run build**

Run: `npm run build`
Expected: Clean build.

**Step 3: Test round-trip**

Manual test: Load editor → enable some effects → export archive → reload archive → verify effects are restored.

**Step 4: Commit**

```
feat: apply post-processing settings from archive manifests in editor
```

---

### Task 9: Kiosk integration

**Files:**
- Modify: `src/modules/kiosk-main.ts`

**Step 1: Import post-processing module**

Add import at top of `kiosk-main.ts`:
```typescript
import * as postProcessingModule from './post-processing.js';
```

**Step 2: Initialize on archive load**

In the kiosk's archive loading section (around line 1590, where viewer_settings are applied), after the tone mapping application, add:

```typescript
// Apply saved post-processing
if (manifest.viewer_settings.post_processing) {
    const ppSettings = manifest.viewer_settings.post_processing;
    const anyEnabled = ppSettings.ssao?.enabled || ppSettings.bloom?.enabled ||
        ppSettings.sharpen?.enabled || ppSettings.vignette?.enabled ||
        ppSettings.chromatic_aberration?.enabled || ppSettings.color_balance?.enabled ||
        ppSettings.grain?.enabled;

    if (anyEnabled && renderer && sceneManager?.rendererType === 'webgl') {
        // Force WebGL if on WebGPU
        if (sceneManager.rendererType === 'webgpu') {
            await sceneManager.switchRenderer('webgl');
            // renderer reference updates after switch
        }
        postProcessingModule.enable(renderer, scene, camera);
        sceneManager.setPostProcessing(postProcessingModule);
        postProcessingModule.setConfig({
            ssao: ppSettings.ssao,
            bloom: ppSettings.bloom,
            sharpen: ppSettings.sharpen,
            vignette: ppSettings.vignette,
            chromaticAberration: ppSettings.chromatic_aberration,
            colorBalance: ppSettings.color_balance,
            grain: ppSettings.grain,
        });

        // SD quality: disable SSAO (too expensive for mobile)
        if (state.qualityResolved === 'sd') {
            postProcessingModule.setSSAO({ enabled: false });
        }

        log.info('Post-processing enabled from archive settings');
    }
}
```

**Step 3: The kiosk animate() loop already uses sceneManager.render()**

Since `sceneManager.render()` was updated in Task 4 to check `postProcessing.isEnabled()`, no changes needed in the kiosk `animate()` function.

**Step 4: Handle quality tier switching**

If the kiosk has a quality toggle (SD/HD), hook into it: when switching to SD, disable SSAO via `postProcessingModule.setSSAO({ enabled: false })`. When switching to HD, restore it.

**Step 5: Run build**

Run: `npm run build`
Expected: Clean build.

**Step 6: Test kiosk**

Manual test: Export an archive with post-processing effects from editor → load in kiosk viewer → verify effects render.

**Step 7: Commit**

```
feat: apply post-processing effects in kiosk viewer from archive settings
```

---

### Task 10: WebGPU auto-switch and renderer change handling

**Files:**
- Modify: `src/modules/post-processing.ts`
- Modify: `src/main.ts` (or wherever renderer change callback lives)
- Modify: `src/modules/kiosk-main.ts`

**Step 1: Handle renderer changes in the editor**

In `main.ts`, find the `onRendererChanged` callback (called after `sceneManager.switchRenderer()`). Add:

```typescript
// Post-processing requires WebGL
if (sceneManager.rendererType === 'webgpu') {
    if (postProcessingModule.isEnabled()) {
        postProcessingModule.disable();
        sceneManager.setPostProcessing(null);
        notify('Post-processing disabled (requires WebGL)', 'info');
        // Uncheck the master enable checkbox
        const masterEl = document.getElementById('pp-master-enable') as HTMLInputElement;
        if (masterEl) masterEl.checked = false;
    }
} else {
    // WebGL — post-processing can be re-enabled if user toggles it
}
```

**Step 2: Add WebGPU-to-WebGL auto-switch when enabling effects**

In the master enable checkbox handler (event-wiring.ts), when the user checks the box:

```typescript
if (sceneManager.rendererType === 'webgpu') {
    await sceneManager.switchRenderer('webgl');
    notify('Switched to WebGL for post-processing effects', 'info');
}
postProcessingModule.enable(renderer, scene, camera);
sceneManager.setPostProcessing(postProcessingModule);
```

**Step 3: Same pattern in kiosk-main.ts**

Already handled in Task 9 — the kiosk checks renderer type before enabling.

**Step 4: Run build**

Run: `npm run build`
Expected: Clean build.

**Step 5: Commit**

```
feat: auto-switch to WebGL when enabling post-processing effects
```

---

### Task 11: Final verification and cleanup

**Files:**
- All modified files

**Step 1: Run full build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 2: Run tests**

Run: `npm test`
Expected: All existing tests pass (post-processing has no test-critical paths yet).

**Step 3: Run lint**

Run: `npm run lint`
Expected: 0 errors.

**Step 4: Manual testing checklist**

- [ ] Editor: Open `/editor/`, enable each effect one at a time, verify visual changes
- [ ] Editor: Enable all effects simultaneously, verify no crashes
- [ ] Editor: Take a screenshot with effects on — verify screenshot captures effects
- [ ] Editor: Split view — verify effects on left canvas only
- [ ] Editor: Toggle WebGPU — verify effects auto-disable with notification
- [ ] Editor: Export archive with effects → reload → verify settings persist
- [ ] Kiosk: Load archive with effects → verify they render
- [ ] Kiosk: Load archive without effects → verify clean render (no regression)
- [ ] Performance: Enable all effects, check FPS counter stays above 30 on test scene

**Step 5: Commit**

```
feat: post-processing pipeline with SSAO, bloom, sharpen, vignette, chromatic aberration, color balance, and grain
```

---

## File Summary

| File | Action | Task |
|------|--------|------|
| `src/types.ts` | Modify — add `PostProcessingEffectConfig` | 1 |
| `src/modules/constants.js` | Modify — add `POST_PROCESSING` defaults | 1 |
| `src/modules/post-processing.ts` | **Create** — full module | 2, 3 |
| `src/modules/scene-manager.ts` | Modify — add postProcessing field, update render/resize | 4 |
| `src/main.ts` | Modify — initialize and wire post-processing | 5, 10 |
| `src/modules/screenshot-manager.ts` | Modify — use composer render when active | 5 |
| `src/editor/index.html` | Modify — add Post-Processing UI section | 6 |
| `src/modules/event-wiring.ts` | Modify — wire post-processing controls | 6 |
| `src/modules/archive-creator.ts` | Modify — add post_processing to manifest | 7 |
| `src/modules/archive-pipeline.ts` | Modify — apply post-processing on load | 8 |
| `src/modules/kiosk-main.ts` | Modify — initialize post-processing from manifest | 9 |
