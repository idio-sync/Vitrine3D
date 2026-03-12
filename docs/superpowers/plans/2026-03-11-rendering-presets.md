# Rendering Presets & HDR Archive Bundling — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unified rendering presets (Technical/Studio/Outdoor/Dramatic) with built-in HDR files, and bundle HDR environments into `.ddim` archives so they load in both editor and kiosk mode.

**Architecture:** New `rendering-presets.ts` module owns preset definitions and application logic. HDR files ship in `public/hdri/` (served statically). Archives bundle the active HDR as `assets/environment_0.hdr`. The existing `environment_preset` skip comments in `archive-pipeline.ts:978` and `kiosk-main.ts:1974` are replaced with actual async HDR loading.

**Tech Stack:** Three.js (RGBELoader, PMREMGenerator), Vite static assets, fflate ZIP

**Spec:** `docs/superpowers/specs/2026-03-11-rendering-presets-design.md`

---

## Chunk 1: Foundation — Types, Constants, HDRI Files

### Task 1: Add AppState fields and update constants

**Files:**
- Modify: `src/types.ts:128-129` (end of AppState)
- Modify: `src/modules/constants.ts:231-238` (ENVIRONMENT.PRESETS)

- [ ] **Step 1: Add `environmentBlob` and `renderingPreset` to AppState**

In `src/types.ts`, after line 128 (`meshTextureInfo`), add:

```typescript
    // Environment / rendering preset state
    environmentBlob: Blob | null;          // raw HDR file for archive bundling
    renderingPreset: string | null;        // current preset name or 'custom'
```

- [ ] **Step 2: Update ENVIRONMENT.PRESETS in constants.ts**

Replace lines 231–238 in `src/modules/constants.ts`:

```typescript
export const ENVIRONMENT = {
    PRESETS: [
        { name: 'None', url: '' },
        { name: 'Studio', url: '/hdri/studio_small_09_1k.hdr' },
        { name: 'Outdoor', url: '/hdri/kloofendal_43d_clear_puresky_1k.hdr' },
        { name: 'Studio (Dramatic)', url: '/hdri/pav_studio_03_1k.hdr' },
        { name: 'Dark Studio', url: '/hdri/monochrome_studio_02_1k.hdr' },
        { name: 'Sunset', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr' },
    ]
} as const;
```

- [ ] **Step 3: Initialize new state fields in main.ts**

In `src/main.ts`, find the `state` object initialization (around line 264) and add after `meshTextureInfo`:

```typescript
    environmentBlob: null,
    renderingPreset: null,
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: No errors. The new fields are typed but not yet used.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/modules/constants.ts src/main.ts
git commit -m "feat(presets): add AppState fields and update ENVIRONMENT.PRESETS to local paths"
```

### Task 2: Download and add HDRI files

**Files:**
- Create: `public/hdri/studio_small_09_1k.hdr`
- Create: `public/hdri/kloofendal_43d_clear_puresky_1k.hdr`
- Create: `public/hdri/pav_studio_03_1k.hdr`
- Create: `public/hdri/monochrome_studio_02_1k.hdr`

- [ ] **Step 1: Create `public/hdri/` directory and download files**

```bash
mkdir -p public/hdri
curl -L -o public/hdri/studio_small_09_1k.hdr "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr"
curl -L -o public/hdri/kloofendal_43d_clear_puresky_1k.hdr "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_43d_clear_puresky_1k.hdr"
curl -L -o public/hdri/pav_studio_03_1k.hdr "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/pav_studio_03_1k.hdr"
curl -L -o public/hdri/monochrome_studio_02_1k.hdr "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/monochrome_studio_02_1k.hdr"
```

- [ ] **Step 2: Verify files downloaded correctly**

```bash
ls -la public/hdri/
```

Expected: 4 `.hdr` files, each 400KB–800KB, ~2.2MB total.

- [ ] **Step 3: Add `.hdr` to `.gitattributes` as binary**

Ensure `.hdr` files are tracked as binary (LFS or just binary attribute):

```bash
echo "*.hdr binary" >> .gitattributes
```

- [ ] **Step 4: Commit**

```bash
git add public/hdri/ .gitattributes
git commit -m "feat(presets): add 4 bundled HDRI files from Poly Haven (CC0)"
```

### Task 3: Create rendering-presets.ts module with tests

**Files:**
- Create: `src/modules/rendering-presets.ts`
- Create: `src/modules/__tests__/rendering-presets.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/modules/__tests__/rendering-presets.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
    RENDERING_PRESETS,
    getCurrentPresetName,
    shouldAutoApplyPreset,
    isLocalPreset,
} from '../rendering-presets.js';
import { ENVIRONMENT } from '../constants.js';

describe('rendering-presets', () => {
    describe('RENDERING_PRESETS', () => {
        it('should define all 4 built-in presets', () => {
            expect(Object.keys(RENDERING_PRESETS)).toEqual(
                expect.arrayContaining(['technical', 'studio', 'outdoor', 'dramatic'])
            );
            expect(Object.keys(RENDERING_PRESETS)).toHaveLength(4);
        });

        it('each preset should have all required fields', () => {
            const requiredFields = [
                'name', 'label', 'hdri', 'toneMapping', 'toneMappingExposure',
                'ambientIntensity', 'hemisphereIntensity',
                'directional1Intensity', 'directional2Intensity',
                'postProcessing', 'backgroundColor', 'envAsBackground',
            ];
            for (const [key, preset] of Object.entries(RENDERING_PRESETS)) {
                for (const field of requiredFields) {
                    expect(preset).toHaveProperty(field);
                }
            }
        });

        it('technical preset should have no HDR', () => {
            expect(RENDERING_PRESETS.technical.hdri).toBeNull();
        });

        it('studio preset should reference a valid ENVIRONMENT.PRESETS name', () => {
            const preset = RENDERING_PRESETS.studio;
            expect(preset.hdri).not.toBeNull();
            const envPreset = ENVIRONMENT.PRESETS.find(p => p.name === preset.hdri);
            expect(envPreset).toBeDefined();
            expect(envPreset!.url).toBeTruthy();
        });
    });

    describe('getCurrentPresetName', () => {
        it('should return preset name when settings match exactly', () => {
            const studio = RENDERING_PRESETS.studio;
            const result = getCurrentPresetName({
                hdri: studio.hdri,
                toneMapping: studio.toneMapping,
                toneMappingExposure: studio.toneMappingExposure,
                ambientIntensity: studio.ambientIntensity,
                hemisphereIntensity: studio.hemisphereIntensity,
                directional1Intensity: studio.directional1Intensity,
                directional2Intensity: studio.directional2Intensity,
                envAsBackground: studio.envAsBackground,
            });
            expect(result).toBe('studio');
        });

        it('should return "custom" when no preset matches', () => {
            const result = getCurrentPresetName({
                hdri: 'Studio',
                toneMapping: 'AgX',
                toneMappingExposure: 0.85, // differs from studio's 0.8
                ambientIntensity: 0.2,
                hemisphereIntensity: 0,
                directional1Intensity: 0,
                directional2Intensity: 0,
                envAsBackground: false,
            });
            expect(result).toBe('custom');
        });

        it('should return null when settings are empty/null', () => {
            const result = getCurrentPresetName({
                hdri: null,
                toneMapping: 'None',
                toneMappingExposure: 1.0,
                ambientIntensity: 0.8,
                hemisphereIntensity: 0.6,
                directional1Intensity: 1.5,
                directional2Intensity: 0.5,
                envAsBackground: false,
            });
            // These are default values, not a preset — but Technical has different values
            // so this should return 'custom'
            expect(result).toBe('custom');
        });
    });

    describe('shouldAutoApplyPreset', () => {
        it('should return true when only mesh is loaded', () => {
            expect(shouldAutoApplyPreset({
                splatLoaded: false,
                modelLoaded: true,
            } as any)).toBe(true);
        });

        it('should return false when splat is loaded', () => {
            expect(shouldAutoApplyPreset({
                splatLoaded: true,
                modelLoaded: true,
            } as any)).toBe(false);
        });

        it('should return false when nothing is loaded', () => {
            expect(shouldAutoApplyPreset({
                splatLoaded: false,
                modelLoaded: false,
            } as any)).toBe(false);
        });
    });

    describe('isLocalPreset', () => {
        it('should return true for paths starting with /', () => {
            expect(isLocalPreset({ name: 'Studio', url: '/hdri/studio.hdr' })).toBe(true);
        });

        it('should return false for CDN URLs', () => {
            expect(isLocalPreset({ name: 'Sunset', url: 'https://example.com/sunset.hdr' })).toBe(false);
        });

        it('should return false for empty URLs', () => {
            expect(isLocalPreset({ name: 'None', url: '' })).toBe(false);
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/__tests__/rendering-presets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the rendering-presets.ts module**

Create `src/modules/rendering-presets.ts`:

```typescript
import { Logger } from './utilities.js';
import { ENVIRONMENT } from './constants.js';
import type { AppState, PostProcessingEffectConfig } from '../types.js';

const log = Logger.getLogger('rendering-presets');

// ===== Types =====

export interface RenderingPreset {
    name: string;
    label: string;
    hdri: string | null;
    toneMapping: string;
    toneMappingExposure: number;
    ambientIntensity: number;
    hemisphereIntensity: number;
    directional1Intensity: number;
    directional2Intensity: number;
    postProcessing: Partial<PostProcessingEffectConfig>;
    backgroundColor: string | null;
    envAsBackground: boolean;
}

export interface CurrentRenderingSettings {
    hdri: string | null;
    toneMapping: string;
    toneMappingExposure: number;
    ambientIntensity: number;
    hemisphereIntensity: number;
    directional1Intensity: number;
    directional2Intensity: number;
    envAsBackground: boolean;
}

// ===== Preset Definitions =====

export const RENDERING_PRESETS: Record<string, RenderingPreset> = {
    technical: {
        name: 'technical',
        label: 'Technical',
        hdri: null,
        toneMapping: 'None',
        toneMappingExposure: 1.0,
        ambientIntensity: 0.6,
        hemisphereIntensity: 0.4,
        directional1Intensity: 0.8,
        directional2Intensity: 0.3,
        postProcessing: {},
        backgroundColor: '#2a2a2a',
        envAsBackground: false,
    },
    studio: {
        name: 'studio',
        label: 'Studio',
        hdri: 'Studio',
        toneMapping: 'AgX',
        toneMappingExposure: 0.8,
        ambientIntensity: 0.2,
        hemisphereIntensity: 0,
        directional1Intensity: 0,
        directional2Intensity: 0,
        postProcessing: {
            sharpen: { enabled: true, intensity: 0.25 },
        },
        backgroundColor: '#2a2a2a',
        envAsBackground: false,
    },
    outdoor: {
        name: 'outdoor',
        label: 'Outdoor',
        hdri: 'Outdoor',
        toneMapping: 'ACESFilmic',
        toneMappingExposure: 1.0,
        ambientIntensity: 0,
        hemisphereIntensity: 0,
        directional1Intensity: 0,
        directional2Intensity: 0,
        postProcessing: {},
        backgroundColor: null,
        envAsBackground: true,
    },
    dramatic: {
        name: 'dramatic',
        label: 'Dramatic',
        hdri: 'Dark Studio',
        toneMapping: 'AgX',
        toneMappingExposure: 0.75,
        ambientIntensity: 0,
        hemisphereIntensity: 0,
        directional1Intensity: 0,
        directional2Intensity: 0,
        postProcessing: {
            sharpen: { enabled: true, intensity: 0.25 },
            vignette: { enabled: true, intensity: 0.3, offset: 1.1 },
        },
        backgroundColor: '#1a1a1a',
        envAsBackground: false,
    },
};

// ===== Helpers =====

/** Check if an environment preset URL points to a locally bundled file. */
export function isLocalPreset(preset: { name: string; url: string }): boolean {
    return preset.url.startsWith('/') && preset.url.length > 1;
}

/**
 * Compare current rendering settings against all presets.
 * Returns the matching preset name, or 'custom' if no match.
 */
export function getCurrentPresetName(settings: CurrentRenderingSettings): string {
    for (const [key, preset] of Object.entries(RENDERING_PRESETS)) {
        if (
            settings.hdri === preset.hdri &&
            settings.toneMapping === preset.toneMapping &&
            Math.abs(settings.toneMappingExposure - preset.toneMappingExposure) < 0.01 &&
            Math.abs(settings.ambientIntensity - preset.ambientIntensity) < 0.01 &&
            Math.abs(settings.hemisphereIntensity - preset.hemisphereIntensity) < 0.01 &&
            Math.abs(settings.directional1Intensity - preset.directional1Intensity) < 0.01 &&
            Math.abs(settings.directional2Intensity - preset.directional2Intensity) < 0.01 &&
            settings.envAsBackground === preset.envAsBackground
        ) {
            return key;
        }
    }
    return 'custom';
}

/**
 * Determine if a rendering preset should be auto-applied.
 * Only auto-apply when a mesh is loaded without a splat (splats bake their own lighting).
 */
export function shouldAutoApplyPreset(state: Pick<AppState, 'splatLoaded' | 'modelLoaded'>): boolean {
    return !state.splatLoaded && state.modelLoaded;
}

// ===== Apply Preset =====

export interface ApplyPresetDeps {
    sceneManager: {
        loadHDREnvironment: (url: string) => Promise<any>;
        clearEnvironment: () => void;
        setToneMapping: (type: string) => void;
        setToneMappingExposure: (value: number) => void;
        setAmbientLightIntensity: (value: number) => void;
        setHemisphereLightIntensity: (value: number) => void;
        setDirectionalLight1Intensity: (value: number) => void;
        setDirectionalLight2Intensity: (value: number) => void;
        setEnvironmentAsBackground: (show: boolean) => void;
        setBackgroundColor: (hex: string) => void;
    };
    postProcessing: {
        isEnabled: () => boolean;
        enable: (renderer: any, scene: any, camera: any) => void;
        setConfig: (config: any) => void;
        getConfig: () => PostProcessingEffectConfig;
    } | null;
    state: AppState;
}

/**
 * Apply a rendering preset by name.
 * Loads HDR (async), sets tone mapping, lighting, post-processing, and background.
 * Stores the HDR blob in state.environmentBlob for archive bundling.
 */
export async function applyPreset(
    name: string,
    deps: ApplyPresetDeps,
): Promise<void> {
    const preset = RENDERING_PRESETS[name];
    if (!preset) {
        log.warn(`Unknown rendering preset: ${name}`);
        return;
    }

    log.info(`Applying rendering preset: ${preset.label}`);

    // 1. Load or clear HDR environment
    if (preset.hdri) {
        const envPreset = ENVIRONMENT.PRESETS.find(p => p.name === preset.hdri);
        if (envPreset?.url) {
            // Fetch raw blob for archive bundling
            try {
                const response = await fetch(envPreset.url);
                const blob = await response.blob();
                deps.state.environmentBlob = blob;

                // Load into Three.js via blob URL
                const blobUrl = URL.createObjectURL(blob);
                try {
                    await deps.sceneManager.loadHDREnvironment(blobUrl);
                } finally {
                    URL.revokeObjectURL(blobUrl);
                }
            } catch (err) {
                log.error(`Failed to load HDR for preset ${name}:`, err);
                // Continue applying other settings even if HDR fails
            }
        }
    } else {
        deps.sceneManager.clearEnvironment();
        deps.state.environmentBlob = null;
    }

    // 2. Tone mapping
    deps.sceneManager.setToneMapping(preset.toneMapping);
    deps.sceneManager.setToneMappingExposure(preset.toneMappingExposure);

    // 3. Lighting
    deps.sceneManager.setAmbientLightIntensity(preset.ambientIntensity);
    deps.sceneManager.setHemisphereLightIntensity(preset.hemisphereIntensity);
    deps.sceneManager.setDirectionalLight1Intensity(preset.directional1Intensity);
    deps.sceneManager.setDirectionalLight2Intensity(preset.directional2Intensity);

    // 4. Environment as background
    deps.sceneManager.setEnvironmentAsBackground(preset.envAsBackground);

    // 5. Background color
    if (preset.backgroundColor) {
        deps.sceneManager.setBackgroundColor(preset.backgroundColor);
    }

    // 6. Post-processing
    if (deps.postProcessing && Object.keys(preset.postProcessing).length > 0) {
        const currentConfig = deps.postProcessing.getConfig();
        const mergedConfig = { ...currentConfig };
        // Reset all effects to disabled first
        for (const key of Object.keys(mergedConfig) as Array<keyof PostProcessingEffectConfig>) {
            if (typeof mergedConfig[key] === 'object' && 'enabled' in mergedConfig[key]) {
                (mergedConfig[key] as any).enabled = false;
            }
        }
        // Apply preset overrides
        for (const [key, value] of Object.entries(preset.postProcessing)) {
            (mergedConfig as any)[key] = { ...(mergedConfig as any)[key], ...value };
        }
        deps.postProcessing.setConfig(mergedConfig);
    } else if (deps.postProcessing) {
        // No post-processing in preset — disable all
        const currentConfig = deps.postProcessing.getConfig();
        const disabledConfig = { ...currentConfig };
        for (const key of Object.keys(disabledConfig) as Array<keyof PostProcessingEffectConfig>) {
            if (typeof disabledConfig[key] === 'object' && 'enabled' in disabledConfig[key]) {
                (disabledConfig[key] as any).enabled = false;
            }
        }
        deps.postProcessing.setConfig(disabledConfig);
    }

    // 7. Update state
    deps.state.renderingPreset = name;

    log.info(`Preset "${preset.label}" applied`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/__tests__/rendering-presets.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/rendering-presets.ts src/modules/__tests__/rendering-presets.test.ts
git commit -m "feat(presets): add rendering-presets module with preset definitions and tests"
```

---

## Chunk 2: HTML & Select Value Migration

### Task 4: Update HTML select elements from index-based to name-based values

**Files:**
- Modify: `src/editor/index.html:695-700` (meta-viewer-env-preset)
- Modify: `src/editor/index.html:~1026` (env-map-select)
- Modify: `src/index.html:235-240` (env-map-select in kiosk)

- [ ] **Step 1: Update `meta-viewer-env-preset` in editor/index.html (line 695–700)**

Replace the select options:

```html
<select class="prop-select mb4" id="meta-viewer-env-preset">
    <option value="">None</option>
    <option value="Studio">Studio</option>
    <option value="Outdoor">Outdoor</option>
    <option value="Studio (Dramatic)">Studio (Dramatic)</option>
    <option value="Dark Studio">Dark Studio</option>
    <option value="Sunset">Sunset</option>
</select>
```

- [ ] **Step 2: Update `env-map-select` in editor/index.html (line ~1026)**

Replace the select options with the same name-based values:

```html
<select class="prop-select mb4" id="env-map-select">
    <option value="">None</option>
    <option value="Studio">Studio</option>
    <option value="Outdoor">Outdoor</option>
    <option value="Studio (Dramatic)">Studio (Dramatic)</option>
    <option value="Dark Studio">Dark Studio</option>
    <option value="Sunset">Sunset</option>
</select>
```

- [ ] **Step 3: Update `env-map-select` in index.html (kiosk, line 235–240)**

Same name-based options:

```html
<select class="prop-select mb4" id="env-map-select">
    <option value="">None</option>
    <option value="Studio">Studio</option>
    <option value="Outdoor">Outdoor</option>
    <option value="Studio (Dramatic)">Studio (Dramatic)</option>
    <option value="Dark Studio">Dark Studio</option>
    <option value="Sunset">Sunset</option>
</select>
```

- [ ] **Step 4: Commit**

```bash
git add src/editor/index.html src/index.html
git commit -m "refactor(presets): migrate env-map selects from index-based to name-based values"
```

### Task 5: Add Rendering Preset section to editor HTML

**Files:**
- Modify: `src/editor/index.html` (insert before line 609 "Lighting on Open")

- [ ] **Step 1: Insert the Rendering Preset archived section before "Lighting on Open"**

Add before line 609 (`<!-- Lighting on Open -->`):

```html
                <!-- Rendering Preset -->
                <div class="prop-section archived">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Rendering Preset</span>
                        <span class="archive-tag">archived</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <select class="prop-select mb4" id="rendering-preset-select">
                            <option value="">None (manual settings)</option>
                            <option value="technical">Technical</option>
                            <option value="studio">Studio</option>
                            <option value="outdoor">Outdoor</option>
                            <option value="dramatic">Dramatic</option>
                            <option value="custom" disabled>Custom</option>
                        </select>
                        <span class="prop-hint">Applies HDR environment, tone mapping, lighting, and post-processing as a unified look. Individual settings below can override.</span>
                    </div>
                </div>

```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(presets): add Rendering Preset archived section to editor UI"
```

---

## Chunk 3: Event Wiring & HDR Blob Capture

### Task 6: Wire up rendering-preset-select handler and blob capture

**Files:**
- Modify: `src/modules/event-wiring.ts` (add preset handler, update HDR handlers)
- Modify: `src/types.ts` (add rendering preset to EventWiringDeps if needed)

- [ ] **Step 1: Import rendering presets in event-wiring.ts**

Add import at top of `src/modules/event-wiring.ts`:

```typescript
import { RENDERING_PRESETS, applyPreset } from './rendering-presets.js';
import type { ApplyPresetDeps } from './rendering-presets.js';
```

- [ ] **Step 2: Add rendering-preset-select change handler**

After the existing post-processing handlers and before the `// ─── Scene settings — Environment map (IBL)` section (~line 875), add:

```typescript
    // ─── Rendering Presets ──────────────────────────────────
    addListener('rendering-preset-select', 'change', async (e: Event) => {
        const name = (e.target as HTMLSelectElement).value;
        if (!name || name === 'custom') return;

        showLoading('Applying rendering preset...');
        try {
            const presetDeps: ApplyPresetDeps = {
                sceneManager,
                postProcessing: deps.sceneManager?.postProcessing || null,
                state: deps.state,
            };
            await applyPreset(name, presetDeps);

            // Auto-check the "save with archive" checkboxes
            const lightingCb = document.getElementById('meta-viewer-lighting-enabled') as HTMLInputElement | null;
            const toneCb = document.getElementById('meta-viewer-tone-mapping-enabled') as HTMLInputElement | null;
            const envCb = document.getElementById('meta-viewer-env-enabled') as HTMLInputElement | null;
            if (lightingCb) { lightingCb.checked = true; lightingCb.dispatchEvent(new Event('change')); }
            if (toneCb) { toneCb.checked = true; toneCb.dispatchEvent(new Event('change')); }
            if (envCb) { envCb.checked = true; envCb.dispatchEvent(new Event('change')); }

            // Sync all live controls to preset values (suppress Custom flip during sync)
            const preset = RENDERING_PRESETS[name];
            if (preset) {
                _suppressPresetFlip = true;
                try {
                    syncLiveControlsToPreset(preset);
                    syncArchivedControlsToPreset(preset);
                } finally {
                    _suppressPresetFlip = false;
                }
            }

            notify.success(`Preset "${RENDERING_PRESETS[name]?.label || name}" applied`);
        } catch (err: any) {
            notify.error('Failed to apply preset: ' + err.message);
        } finally {
            hideLoading();
        }
    });
```

- [ ] **Step 3: Add helper functions for syncing controls**

Add these helper functions inside `setupUIEvents()`, before the rendering preset handler:

```typescript
    /** Sync live scene control UI elements to match a preset's values. */
    function syncLiveControlsToPreset(preset: import('./rendering-presets.js').RenderingPreset) {
        // Lighting sliders
        const setSlider = (id: string, val: number) => {
            const el = document.getElementById(id) as HTMLInputElement | null;
            if (el) { el.value = String(val); }
            const valEl = document.getElementById(id + '-value');
            if (valEl) valEl.textContent = val.toFixed(1);
        };
        setSlider('ambient-intensity', preset.ambientIntensity);
        setSlider('hemisphere-intensity', preset.hemisphereIntensity);
        setSlider('directional1-intensity', preset.directional1Intensity);
        setSlider('directional2-intensity', preset.directional2Intensity);

        // Tone mapping
        const toneSelect = document.getElementById('tone-mapping-select') as HTMLSelectElement | null;
        if (toneSelect) toneSelect.value = preset.toneMapping;
        setSlider('tone-mapping-exposure', preset.toneMappingExposure);

        // Environment select
        const envSelect = document.getElementById('env-map-select') as HTMLSelectElement | null;
        if (envSelect) envSelect.value = preset.hdri || '';

        // Env as background
        const envBgCb = document.getElementById('toggle-env-background') as HTMLInputElement | null;
        if (envBgCb) envBgCb.checked = preset.envAsBackground;
    }

    /** Sync archived (View Settings) controls to match a preset's values. */
    function syncArchivedControlsToPreset(preset: import('./rendering-presets.js').RenderingPreset) {
        const setSlider = (id: string, val: number) => {
            const el = document.getElementById(id) as HTMLInputElement | null;
            if (el) { el.value = String(val); }
            const valEl = document.getElementById(id + '-value');
            if (valEl) valEl.textContent = val.toFixed(1);
        };
        setSlider('meta-viewer-ambient-intensity', preset.ambientIntensity);
        setSlider('meta-viewer-hemisphere-intensity', preset.hemisphereIntensity);
        setSlider('meta-viewer-directional1-intensity', preset.directional1Intensity);
        setSlider('meta-viewer-directional2-intensity', preset.directional2Intensity);

        // Tone mapping
        const toneMethod = document.getElementById('meta-viewer-tone-mapping-method') as HTMLSelectElement | null;
        if (toneMethod) toneMethod.value = preset.toneMapping;
        setSlider('meta-viewer-tone-mapping-exposure', preset.toneMappingExposure);

        // Environment preset
        const envPreset = document.getElementById('meta-viewer-env-preset') as HTMLSelectElement | null;
        if (envPreset) envPreset.value = preset.hdri || '';

        // Env as background
        const envBg = document.getElementById('meta-viewer-env-as-background') as HTMLInputElement | null;
        if (envBg) envBg.checked = preset.envAsBackground;
    }
```

- [ ] **Step 4: Update `hdr-file-input` and `btn-load-hdr-url` handlers to capture blob and flip preset to Custom**

In the `hdr-file-input` handler (line ~899), after `await sceneManager.loadHDREnvironmentFromFile(file)`:

```typescript
            // Store blob for archive bundling
            deps.state.environmentBlob = file;
            deps.state.renderingPreset = 'custom';
            const presetSelect = document.getElementById('rendering-preset-select') as HTMLSelectElement | null;
            if (presetSelect) presetSelect.value = 'custom';
```

In the `btn-load-hdr-url` handler (line ~917), after `await sceneManager.loadHDREnvironment(url)`:

```typescript
            // Fetch and store blob for archive bundling
            try {
                const resp = await fetch(url);
                deps.state.environmentBlob = await resp.blob();
            } catch { /* non-critical — archive just won't include HDR */ }
            deps.state.renderingPreset = 'custom';
            const presetSelect = document.getElementById('rendering-preset-select') as HTMLSelectElement | null;
            if (presetSelect) presetSelect.value = 'custom';
```

- [ ] **Step 5: Add "flip to Custom" on manual control changes**

At the end of each existing lighting/tone mapping/environment handler in event-wiring.ts, add a small utility that flips the rendering preset to Custom. Add this helper near the sync helpers:

```typescript
    /** Flag to suppress Custom flip during programmatic syncing from applyPreset. */
    let _suppressPresetFlip = false;

    /** Flip the rendering preset dropdown to "Custom" when any individual control changes. */
    function markPresetAsCustom() {
        if (_suppressPresetFlip) return;
        if (deps.state.renderingPreset && deps.state.renderingPreset !== 'custom') {
            deps.state.renderingPreset = 'custom';
            const presetSelect = document.getElementById('rendering-preset-select') as HTMLSelectElement | null;
            if (presetSelect) presetSelect.value = 'custom';
        }
    }
```

Then add `markPresetAsCustom();` calls at the end of these existing handlers:
- `ambient-intensity` input (line ~323)
- `hemisphere-intensity` input (line ~330)
- `directional1-intensity` input (line ~337)
- `directional2-intensity` input (line ~344)
- `tone-mapping-select` change (line ~718)
- `tone-mapping-exposure` input (line ~724)
- `env-map-select` change (after the preset load succeeds)
- `toggle-env-background` change (line ~938)

- [ ] **Step 6: Refactor env-map-select handler: name-based lookup + blob capture**

Replace the entire `env-map-select` change handler (lines 876–897) with this version that does name-based lookup AND captures the HDR blob:

```typescript
    addListener('env-map-select', 'change', async (e: Event) => {
        const value = (e.target as HTMLSelectElement).value;
        if (!value) {
            if (sceneManager) sceneManager.clearEnvironment();
            deps.state.environmentBlob = null;
            markPresetAsCustom();
            return;
        }
        const preset = ENVIRONMENT.PRESETS.find((p: any) => p.name === value);
        if (preset?.url) {
            showLoading('Loading HDR environment...');
            try {
                // Fetch raw blob for archive bundling
                const response = await fetch(preset.url);
                const blob = await response.blob();
                deps.state.environmentBlob = blob;

                // Load into Three.js via blob URL
                const blobUrl = URL.createObjectURL(blob);
                try {
                    await sceneManager.loadHDREnvironment(blobUrl);
                } finally {
                    URL.revokeObjectURL(blobUrl);
                }
                notify.success('Environment loaded');
            } catch (err: any) {
                notify.error('Failed to load environment: ' + err.message);
            } finally {
                hideLoading();
            }
        }
        markPresetAsCustom();
    });
```

- [ ] **Step 7: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 8: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/modules/event-wiring.ts
git commit -m "feat(presets): wire rendering preset handler with blob capture and Custom flip"
```

---

## Chunk 4: Archive Bundling (Export & Import)

### Task 7: Add `addEnvironment()` to ArchiveCreator

**Files:**
- Modify: `src/modules/archive-creator.ts:308-331` (manifest type), `~1479` (after addFlightPath), `~1142` (setViewerSettings)

- [ ] **Step 1: Add `rendering_preset` to manifest viewer_settings type**

In `src/modules/archive-creator.ts`, after `environment_as_background: boolean | null;` (line 331), add:

```typescript
        rendering_preset: string | null;
```

- [ ] **Step 2: Add `rendering_preset: null` to manifest defaults**

In the manifest defaults object (after `environment_as_background: null,` around line 682):

```typescript
                rendering_preset: null,
```

- [ ] **Step 3: Add `renderingPreset` to ViewerSettings interface**

In `src/modules/archive-creator.ts`, after `environmentAsBackground` (line 136):

```typescript
    renderingPreset?: string | null;
```

- [ ] **Step 4: Add `renderingPreset` mapping in setViewerSettings**

After line 1168 (`environmentAsBackground`):

```typescript
        if (settings.renderingPreset !== undefined) this.manifest.viewer_settings.rendering_preset = settings.renderingPreset;
```

- [ ] **Step 5: Add `addEnvironment()` method**

After `addFlightPath()` method (after line 1479):

```typescript
    addEnvironment(blob: Blob, fileName: string): string {
        const entryKey = 'environment_0';
        const ext = fileName.split('.').pop()?.toLowerCase() || 'hdr';
        const archivePath = `assets/environment_0.${ext}`;

        this.files.set(archivePath, { blob, originalName: fileName });

        this.manifest.data_entries[entryKey] = {
            file_name: archivePath,
            created_by: "vitrine3d",
            _created_by_version: "",
            _source_notes: "",
            role: 'environment',
            original_name: fileName,
            _parameters: {},
        };

        return entryKey;
    }
```

- [ ] **Step 6: Wire environment blob into archive export**

In the `buildArchive()` method or wherever `addMesh`/`addFlightPath` are called during export (in `src/modules/export-controller.ts` or the export flow in `main.ts`), find where assets are added to the archive creator. Search for the call site where `archiveCreator.addMesh()` or similar is called.

Before the archive is finalized, add:

```typescript
        // Bundle HDR environment if one is loaded
        if (state.environmentBlob) {
            archiveCreator.addEnvironment(state.environmentBlob, 'environment_0.hdr');
        }
```

- [ ] **Step 7: Inject `renderingPreset` into export pipeline and prefill on archive open**

**Important:** `collectMetadata()` in `metadata-manager.ts` reads the DOM only — it has no access to `state`. Follow the existing pattern used by `measurementScale`: inject `renderingPreset` into `metadata.viewerSettings` in `export-controller.ts` after the `collectMetadata()` call.

In `src/modules/export-controller.ts`, after the measurement injection (~line 189), add:

```typescript
    // Inject current rendering preset into viewer settings
    if (deps.state.renderingPreset) {
        metadata.viewerSettings.renderingPreset = deps.state.renderingPreset;
    }
```

Do this in BOTH export functions (there are two — `downloadArchive` around line 184 and `saveToLibrary` around line 901). Search for both `measurementScale` injection sites and add `renderingPreset` injection after each.

Also add `renderingPreset` to the `ViewerSettings` interface in `metadata-manager.ts` (~line 232, after `flightMarkerDensity` or last field):

```typescript
    renderingPreset?: string | null;
```

In `prefillMetadataFromArchive()` around line 2155, after the environment section, add:

```typescript
        // Rendering preset
        const presetSelect = document.getElementById('rendering-preset-select') as HTMLSelectElement | null;
        if (presetSelect && manifest.viewer_settings.rendering_preset) {
            presetSelect.value = manifest.viewer_settings.rendering_preset;
        }
```

- [ ] **Step 8: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/modules/archive-creator.ts src/modules/metadata-manager.ts src/modules/export-controller.ts
git commit -m "feat(presets): add addEnvironment() to ArchiveCreator and rendering_preset to manifest"
```

### Task 8: Add `getEnvironmentEntry()` to ArchiveLoader

**Files:**
- Modify: `src/modules/archive-loader.ts:64-77` (ContentInfo), `~962` (after getFlightPathEntries)

- [ ] **Step 1: Add `hasEnvironment` to ContentInfo interface**

In `src/modules/archive-loader.ts`, after `flightPathCount: number;` (line 76), add:

```typescript
    hasEnvironment: boolean;
```

- [ ] **Step 2: Add `getEnvironmentEntry()` method**

After `getFlightPathEntries()` (line 962), add:

```typescript
    getEnvironmentEntry(): { entry: ManifestDataEntry; key: string } | null {
        const entries = this.findEntriesByPrefix('environment_');
        return entries.length > 0 ? { entry: entries[0].entry, key: entries[0].key } : null;
    }
```

- [ ] **Step 3: Update `getContentInfo()` to include `hasEnvironment`**

In the `getContentInfo()` method (~line 977), add after `const flightPaths = this.getFlightPathEntries();`:

```typescript
        const environment = this.getEnvironmentEntry();
```

And in the cache assignment (~line 991), after `flightPathCount`:

```typescript
            hasEnvironment: environment !== null,
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/archive-loader.ts
git commit -m "feat(presets): add getEnvironmentEntry() to ArchiveLoader with ContentInfo"
```

### Task 9: Load HDR from archive in archive-pipeline.ts (editor)

**Files:**
- Modify: `src/modules/archive-pipeline.ts:978` (remove NOTE comment)
- Modify: `src/modules/archive-pipeline.ts:770-772` (add HDR loading after applyViewerSettings)

**Important context:** `applyViewerSettings()` is a synchronous function that doesn't have access to `archiveLoader`. The HDR loading must happen in `processArchive()` (which is async and has `archiveLoader` as its first parameter), not inside `applyViewerSettings`.

- [ ] **Step 1: Remove the skip comment in applyViewerSettings**

In `src/modules/archive-pipeline.ts`, delete line 978:

```typescript
    // NOTE: environment_preset IBL would require async HDR loading; skipped here.
```

- [ ] **Step 2: Add async HDR loading in processArchive after applyViewerSettings call**

In `processArchive()`, after the `applyViewerSettings()` call at line 771, add:

```typescript
            // Load bundled HDR environment from archive
            const envEntry = archiveLoader.getEnvironmentEntry();
            if (envEntry) {
                try {
                    const envData = await archiveLoader.extractFile(envEntry.entry.file_name);
                    if (envData) {
                        const envBlob = new Blob([envData], { type: 'application/octet-stream' });
                        deps.state.environmentBlob = envBlob; // store for re-export round-trip
                        const blobUrl = URL.createObjectURL(envBlob);
                        try {
                            await deps.sceneManager.loadHDREnvironment(blobUrl);
                            if (manifest.viewer_settings?.environment_as_background) {
                                deps.sceneManager.setEnvironmentAsBackground(true);
                            }
                        } finally {
                            URL.revokeObjectURL(blobUrl);
                        }
                        log.info('Loaded HDR environment from archive');
                    }
                } catch (err: any) {
                    log.warn('Failed to load HDR environment from archive:', err.message);
                }
            }
```

Note: `archiveLoader` is the first parameter of `processArchive()` — use it directly, NOT `deps.state.archiveLoader`.

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/archive-pipeline.ts
git commit -m "feat(presets): load bundled HDR from archive in editor pipeline"
```

### Task 10: Load HDR from archive in kiosk-main.ts

**Files:**
- Modify: `src/modules/kiosk-main.ts:1974` (replace NOTE comment)

- [ ] **Step 1: Replace the kiosk skip comment with actual HDR loading**

In `src/modules/kiosk-main.ts`, replace line 1974:

```typescript
            // NOTE: environment_preset IBL would require async HDR loading; skipped here.
```

With (note: check local variable names — the archive loader is likely stored in a local variable, not `state.archiveLoader`; find the correct reference in the surrounding kiosk code):

```typescript
            // Load bundled HDR environment from archive
            if (archiveLoader) {
                const envEntry = archiveLoader.getEnvironmentEntry();
                if (envEntry) {
                    try {
                        const envData = await archiveLoader.extractFile(envEntry.entry.file_name);
                        if (envData) {
                            const envBlob = new Blob([envData], { type: 'application/octet-stream' });
                            const blobUrl = URL.createObjectURL(envBlob);
                            try {
                                await sceneManager.loadHDREnvironment(blobUrl);
                                if (manifest.viewer_settings.environment_as_background) {
                                    sceneManager.setEnvironmentAsBackground(true);
                                }
                            } finally {
                                URL.revokeObjectURL(blobUrl);
                            }
                            log.info('Loaded HDR environment from archive');
                        }
                    } catch (err: any) {
                        log.warn('Failed to load HDR from archive:', err.message);
                    }
                }
            }
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(presets): load bundled HDR from archive in kiosk mode"
```

---

## Chunk 5: Integration & Verification

### Task 11: Wire environment blob into the export pipeline

**Files:**
- Modify: `src/main.ts` or `src/modules/export-controller.ts` (wherever archive assets are added before export)

- [ ] **Step 1: Find the export call site**

Search for where `archiveCreator.addMesh()` or `archiveCreator.setMetadata()` is called during the export process. This is likely in a function like `downloadArchive()` or `buildArchive()` in `main.ts` or `export-controller.ts`.

- [ ] **Step 2: Add environment blob to archive before export**

Before the archive is finalized (before `.build()` or `.download()` is called), add:

```typescript
        // Bundle HDR environment
        if (state.environmentBlob) {
            archiveCreator.addEnvironment(state.environmentBlob, 'environment_0.hdr');
        }
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(presets): bundle environment HDR blob into archive on export"
```

### Task 12: Final verification

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass, including new rendering-presets tests.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: Clean build. Check that `dist/hdri/` contains the 4 HDRI files.

- [ ] **Step 4: Manual smoke test**

1. `npm run dev` — open editor
2. Load a mesh file (GLB/OBJ)
3. Select "Studio" from the Rendering Preset dropdown in View Settings
4. Verify: HDR loads, tone mapping changes to AgX, exposure to 0.8, lighting dims, sharpen activates
5. Change exposure slider manually — verify preset dropdown flips to "Custom"
6. Export as `.ddim` archive
7. Open the exported archive — verify HDR loads back, same visual appearance
8. Open in kiosk mode (`?kiosk=true&archive=...`) — verify HDR and settings apply

- [ ] **Step 5: Backward compatibility test**

Open an older `.ddim` archive that has no HDR. Verify no errors, settings load as before.

- [ ] **Step 6: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(presets): final cleanup and verification"
```
