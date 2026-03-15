# Post-Processing Pipeline Design

**Date:** 2026-03-04
**Status:** Approved

## Summary

Add a full post-processing pipeline to Vitrine3D with 7 screen-space effects: SSAO, bloom, sharpen, vignette, chromatic aberration, color balance, and grain. Effects are available in both the editor (with UI controls) and kiosk viewer (applied from archive settings). Uses Three.js's built-in `EffectComposer` with a hybrid approach: dedicated passes for SSAO and bloom, and a custom uber-shader pass combining the 5 lightweight effects into a single fragment shader.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Effects set | Full Sketchfab set (7 effects) | Matches competitive feature parity |
| Scope | Editor + kiosk | Settings serialized in `viewer_settings`, kiosk applies on load |
| WebGPU handling | Force WebGL when effects enabled | `EffectComposer` is WebGL-only; auto-switch with notification |
| Architecture | Hybrid uber-shader (Approach C) | 3 passes total, no new deps, full control |
| UI placement | Scene Settings panel | New collapsible section below tone mapping |

## Architecture

### New Module: `src/modules/post-processing.ts`

Self-contained module owning the `EffectComposer` lifecycle. Follows existing module conventions (Logger, exported functions, no main.ts imports).

**Imports from Three.js addons (already in node_modules):**
- `three/addons/postprocessing/EffectComposer.js`
- `three/addons/postprocessing/RenderPass.js`
- `three/addons/postprocessing/SSAOPass.js`
- `three/addons/postprocessing/UnrealBloomPass.js`
- `three/addons/postprocessing/ShaderPass.js`

**Public API:**

```typescript
interface PostProcessingConfig {
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

// Lifecycle
enable(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void
disable(): void
dispose(): void
isEnabled(): boolean

// Rendering
render(): void
resize(width: number, height: number, pixelRatio: number): void

// Configuration
setConfig(config: Partial<PostProcessingConfig>): void
getConfig(): PostProcessingConfig

// Per-effect setters (convenience)
setSSAO(opts: Partial<PostProcessingConfig['ssao']>): void
setBloom(opts: Partial<PostProcessingConfig['bloom']>): void
setUberEffects(opts: Partial<Pick<PostProcessingConfig, 'sharpen' | 'vignette' | 'chromaticAberration' | 'colorBalance' | 'grain'>>): void
```

### Pass Pipeline (3 passes)

```
RenderPass (scene, camera)
    ↓
SSAOPass (when enabled — needs normalBuffer)
    ↓
UnrealBloomPass (when enabled)
    ↓
ShaderPass (uber-shader — sharpen + vignette + chromatic aberration + color balance + grain)
```

When all effects are disabled, the module calls `renderer.render(scene, camera)` directly (zero overhead).

### Uber-Shader

Single GLSL fragment shader combining 5 lightweight screen-space effects. Each effect is gated by a boolean uniform — when disabled, that section is a no-op (no shader recompilation, just a branch skip).

**Uniforms:**
```glsl
// Sharpen
uniform bool uSharpenEnabled;
uniform float uSharpenIntensity;

// Vignette
uniform bool uVignetteEnabled;
uniform float uVignetteIntensity;
uniform float uVignetteOffset;

// Chromatic Aberration
uniform bool uChromaticAberrationEnabled;
uniform float uChromaticAberrationIntensity;

// Color Balance
uniform bool uColorBalanceEnabled;
uniform vec3 uColorBalanceShadows;
uniform vec3 uColorBalanceMidtones;
uniform vec3 uColorBalanceHighlights;

// Grain
uniform bool uGrainEnabled;
uniform float uGrainIntensity;
uniform float uTime;

// Common
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
```

**Effect implementations (fragment shader):**
- **Sharpen:** 3×3 unsharp mask kernel on tDiffuse, blended by intensity
- **Vignette:** `smoothstep(offset, offset - intensity, length(uv - 0.5))` radial darkening
- **Chromatic aberration:** Sample R/G/B channels at offset UV positions from center
- **Color balance:** Lift-gamma-gain using luminance to weight shadows/midtones/highlights
- **Grain:** Hash-based noise `fract(sin(dot(uv + time, vec2(12.9898, 78.233))) * 43758.5453)` multiplied by intensity

## Render Loop Integration

### SceneManager Changes

`SceneManager` receives an optional post-processing reference:

```typescript
// New field
private postProcessing: PostProcessingModule | null = null;

setPostProcessing(pp: PostProcessingModule | null): void
```

`SceneManager.render()` updated:

```typescript
render(displayMode, splatMesh, modelGroup, pointcloudGroup, stlGroup) {
    if (displayMode === 'split') {
        // Left canvas: use post-processing if enabled
        // ... visibility toggling (unchanged) ...
        if (this.postProcessing?.isEnabled()) {
            this.postProcessing.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }

        // Right canvas: always direct render (no post-processing)
        // ... (unchanged) ...
        this.rendererRight.render(this.scene, this.camera);

        // ... restore visibility (unchanged) ...
    } else {
        if (this.postProcessing?.isEnabled()) {
            this.postProcessing.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }
}
```

### Screenshot Capture

`screenshot-manager.ts` updated to use `postProcessing.render()` when active, before calling `canvas.toBlob()`. The composer renders to the default framebuffer (canvas), so `toBlob()` continues to work.

### Resize Handling

`SceneManager.onWindowResize()` calls `postProcessing.resize(w, h, pixelRatio)` when active, which updates the composer size and internal render targets (SSAOPass and bloom need resolution-dependent buffers).

## WebGPU Handling

- When any effect is toggled on and `sceneManager.rendererType === 'webgpu'`:
  1. Call `sceneManager.switchRenderer('webgl')` (existing method)
  2. Show notification: "Switched to WebGL for post-processing effects"
  3. Re-initialize post-processing with the new WebGL renderer
- When user manually switches to WebGPU:
  1. Auto-disable all post-processing effects
  2. Show notification: "Post-processing disabled (requires WebGL)"
  3. Call `postProcessing.disable()`
- The renderer-changed callback in both `main.ts` and `kiosk-main.ts` handles this.

## Archive Serialization

### Manifest Schema Addition

Add `post_processing` to `viewer_settings`:

```json
{
  "viewer_settings": {
    "...existing fields...",
    "post_processing": {
      "ssao": { "enabled": false, "radius": 0.5, "intensity": 1.0 },
      "bloom": { "enabled": false, "strength": 0.5, "radius": 0.4, "threshold": 0.85 },
      "sharpen": { "enabled": false, "intensity": 0.3 },
      "vignette": { "enabled": false, "intensity": 0.5, "offset": 1.0 },
      "chromatic_aberration": { "enabled": false, "intensity": 0.005 },
      "color_balance": {
        "enabled": false,
        "shadows": [0, 0, 0],
        "midtones": [0, 0, 0],
        "highlights": [0, 0, 0]
      },
      "grain": { "enabled": false, "intensity": 0.05 }
    }
  }
}
```

### File Changes

- **`archive-creator.ts`**: Add `post_processing` to manifest type definition and `setViewerSettings()` method
- **`archive-pipeline.ts`**: Read `manifest.viewer_settings.post_processing` in `applyViewerSettings()`, call `postProcessing.setConfig()` and `postProcessing.enable()` if any effect is enabled
- **`kiosk-main.ts`**: Same pattern — read settings, initialize post-processing on archive load

### Backward Compatibility

Archives without `post_processing` in `viewer_settings` load normally — the field is optional. Old viewers ignore unknown fields per existing forward-compatibility rules.

## Editor UI

New collapsible "Post-Processing" section in `editor/index.html`, inside the Scene Settings panel, below tone mapping controls.

### Layout

```
▼ Post-Processing
  ☐ Master Enable

  SSAO
    ☐ Enable
    Radius    [====o=====] 0.5
    Intensity [====o=====] 1.0

  Bloom
    ☐ Enable
    Strength  [====o=====] 0.5
    Radius    [====o=====] 0.4
    Threshold [========o=] 0.85

  Sharpen
    ☐ Enable
    Intensity [===o======] 0.3

  Vignette
    ☐ Enable
    Intensity [=====o====] 0.5
    Offset    [==========o] 1.0

  Chromatic Aberration
    ☐ Enable
    Intensity [o=========] 0.005

  Color Balance
    ☐ Enable
    Shadows   R[===o===] G[===o===] B[===o===]
    Midtones  R[===o===] G[===o===] B[===o===]
    Highlights R[===o===] G[===o===] B[===o===]

  Grain
    ☐ Enable
    Intensity [o=========] 0.05
```

### Control Ranges

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
| Color Balance | shadows/midtones/highlights | -1.0 | 1.0 | 0 | 0.05 |
| Grain | intensity | 0 | 0.5 | 0.05 | 0.01 |

### Event Wiring

Slider and checkbox events wired via `addListener()` in `event-wiring.ts`. Each change immediately calls the corresponding setter on the post-processing module — real-time preview with no apply button.

## Kiosk Integration

- `kiosk-main.ts` reads `manifest.viewer_settings.post_processing` during archive load
- If any effect has `enabled: true`, creates the post-processing module and calls `enable(renderer, scene, camera)` + `setConfig(settings)`
- The kiosk `animate()` function uses the same `postProcessing.render()` / `renderer.render()` conditional as the editor
- No UI controls exposed in kiosk — effects are baked from archive settings
- Quality tier affects post-processing: SD mode disables SSAO (too expensive for mobile); bloom and uber-shader remain available

## Spark.js Compatibility

`SparkRenderer` is added to the scene as a regular `Object3D` and renders during `RenderPass`. Implications:

- **Bloom:** Works on splats — bright Gaussians will glow
- **SSAO:** May not apply correctly to splats (no standard normal/depth buffer from splat geometry). Known limitation — document in UI tooltip. If artifacts appear, SSAO pass can be configured to skip splat contribution via depth range.
- **Uber-shader effects:** Full-screen, works on all content regardless of render source

## Performance

| Effect | Estimated FPS Cost | Passes |
|--------|-------------------|--------|
| SSAO | 15–20% | 1 (normal buffer + AO calculation) |
| Bloom | 5–10% | 1 (downsample + blur + composite) |
| Uber-shader (all 5) | 2–3% | 1 |
| **Total (all on)** | **~25–30%** | **3 + RenderPass** |

### Quality Presets (UI shortcuts)

- **Off:** All effects disabled
- **Low:** Uber-shader only (sharpen + vignette)
- **Medium:** Bloom + uber-shader
- **High:** SSAO + bloom + uber-shader

Individual toggles override presets. Preset selection is UI-only — not saved to archives (individual effect states are saved).

## Files Modified

| File | Change |
|------|--------|
| `src/modules/post-processing.ts` | **New** — module + uber-shader |
| `src/modules/scene-manager.ts` | Add `postProcessing` field, update `render()` and `onWindowResize()` |
| `src/modules/screenshot-manager.ts` | Use `postProcessing.render()` when active |
| `src/modules/archive-creator.ts` | Add `post_processing` to manifest type + `setViewerSettings()` |
| `src/modules/archive-pipeline.ts` | Apply post-processing settings on archive load |
| `src/modules/kiosk-main.ts` | Initialize post-processing from manifest, update `animate()` |
| `src/modules/event-wiring.ts` | Wire post-processing slider/checkbox events |
| `src/editor/index.html` | Add Post-Processing section to Scene Settings panel |
| `src/types.ts` | Add `PostProcessingConfig` type, extend `AppState` |
| `src/modules/constants.js` | Add default post-processing values |
