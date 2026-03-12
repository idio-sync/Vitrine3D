# Rendering Presets & HDR Archive Bundling — Design Spec

**Date:** 2026-03-11
**Status:** Draft
**Approach:** B — Rendering Presets Module + HDR-in-Archive

## Problem

Vitrine3D has all the individual rendering controls needed for museum-quality presentation (HDR environment maps, 6 tone mapping algorithms, 7 post-processing effects, per-light intensity), but:

1. **HDR environments are not bundled into `.ddim` archives.** The `environment_preset` field is saved to the manifest but never applied on load — both `archive-pipeline.ts:978` and `kiosk-main.ts:1974` have `// NOTE: environment_preset IBL would require async HDR loading; skipped here.` Clients opening archives in kiosk mode get no environment lighting.

2. **No unified "look" presets.** Users must manually configure HDR, tone mapping, exposure, lighting, and post-processing individually. There's no way to apply a curated combination in one click.

3. **HDR presets are CDN-only.** The 3 existing environment presets in `constants.ts` fetch from Poly Haven's CDN. This fails offline (Tauri desktop) and adds latency.

## Solution Overview

Three deliverables:
1. **HDR files bundled into `.ddim` archives** — extracted and applied on load in both editor and kiosk
2. **Built-in HDRI files shipped locally** — 4 curated 1K HDRIs in `public/hdri/`, CDN fallbacks for extras
3. **Rendering presets module** — `rendering-presets.ts` with 4 built-in presets + Custom, one-shot apply pattern

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| HDR delivery | Hybrid — 4 local + CDN extras | Offline support for core presets, no repo bloat |
| Preset behavior | One-shot apply, then customize | Matches existing decimation preset pattern |
| Preset scope | Mesh-only scenes | Splats bake in their own lighting; IBL would look wrong |
| Preset UI location | Archived section (View Settings pane) | Ensures preset gets saved to archive; also updates live controls |
| Existing archived sections | Keep as-is below preset | Backward compatible, serve as advanced overrides |
| Archive HDR format | Raw `.hdr` file in ZIP | Same format as input, no conversion needed |
| Env preset option values | Name-based (`value="Studio"`) not index-based (`value="preset:0"`) | Avoids fragile index coupling when presets are reordered or added |
| HDR blob capture | Fetch HDR URL with `fetch()` at apply time, store raw blob | Decouples blob capture from Three.js internal RGBELoader |

## Architecture

### New Module: `src/modules/rendering-presets.ts`

Owns preset definitions, application logic, and mesh-only guard.

```typescript
interface RenderingPreset {
    name: string;                    // internal key: 'technical' | 'studio' | 'outdoor' | 'dramatic'
    label: string;                   // display label: 'Studio' | 'Outdoor' | etc.
    hdri: string | null;             // key into ENVIRONMENT.PRESETS by name, or null
    toneMapping: string;             // 'None' | 'AgX' | 'ACESFilmic' | etc.
    toneMappingExposure: number;
    ambientIntensity: number;
    hemisphereIntensity: number;
    directional1Intensity: number;
    directional2Intensity: number;
    postProcessing: Partial<PostProcessingEffectConfig>;
    backgroundColor: string | null;  // hex color, null = keep current
    envAsBackground: boolean;
}
```

**Exports:**
- `RENDERING_PRESETS: Record<string, RenderingPreset>` — preset definitions
- `applyPreset(name, sceneManager, postProcessing): Promise<void>` — async (HDR load), applies all values
- `getCurrentPresetName(currentSettings): string` — compares state against presets, returns match or `'custom'`
- `shouldAutoApplyPreset(state): boolean` — returns `true` only when `splatLoaded === false && modelLoaded === true`

### Built-in Presets

| Preset | HDR | Tone Map | Exposure | Lights (amb/hemi/dir1/dir2) | Post-Processing | Background |
|---|---|---|---|---|---|---|
| **Technical** | None | None | 1.0 | 0.6 / 0.4 / 0.8 / 0.3 | `{}` (all disabled) | `#2a2a2a` |
| **Studio** | studio_small_09 | AgX | 0.8 | 0.2 / 0 / 0 / 0 | `{ sharpen: { enabled: true, intensity: 0.25 } }` | `#2a2a2a` |
| **Outdoor** | kloofendal_43d_clear_puresky | ACESFilmic | 1.0 | 0 / 0 / 0 / 0 | `{}` (all disabled) | env-as-background |
| **Dramatic** | monochrome_studio_02 | AgX | 0.75 | 0 / 0 / 0 / 0 | `{ sharpen: { enabled: true, intensity: 0.25 }, vignette: { enabled: true, intensity: 0.3, offset: 1.1 } }` | `#1a1a1a` |

### Built-in HDRI Files

Shipped in `public/hdri/`, served at `/hdri/` by Vite, copied to `dist/hdri/` at build.

| File | Size (~) | Style | Source |
|---|---|---|---|
| `studio_small_09_1k.hdr` | 500KB | Neutral soft studio | Poly Haven (CC0) |
| `kloofendal_43d_clear_puresky_1k.hdr` | 500KB | Bright outdoor daylight | Poly Haven (CC0) |
| `pav_studio_03_1k.hdr` | 700KB | Studio with softbox + window | Poly Haven (CC0) |
| `monochrome_studio_02_1k.hdr` | 500KB | Dark studio with spots | Poly Haven (CC0) |

Total: ~2.2MB added to build.

**`ENVIRONMENT.PRESETS` update in `constants.ts`:**
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

Locality is implicit from the URL format: paths starting with `/` are local, `https://` are CDN. The `isLocalPreset(preset)` helper in `rendering-presets.ts` derives this from the URL. The entry shape is unchanged — only `name` and `url` fields.

**Breaking change: `preset:N` index scheme → name-based values.** All three `<select>` elements that use `env-map-select` or `meta-viewer-env-preset` must switch from `value="preset:0"` to `value="Studio"` etc. The `event-wiring.ts` handler must look up by name instead of filtering + indexing:

```typescript
// Before (fragile):
const index = parseInt(value.split(':')[1]);
const presets = ENVIRONMENT.PRESETS.filter(p => p.url);
if (presets[index]) { ... }

// After (robust):
const preset = ENVIRONMENT.PRESETS.find(p => p.name === value);
if (preset?.url) { ... }
```

### HDR Bundling in Archives

**New asset type — follows existing key-prefix pattern (not role-based):**
- Archive key prefix: `environment_` (e.g., `environment_0`)
- Stored as: `assets/environment_0.hdr`
- Manifest asset entry: `{ key: "environment_0", file_name: "assets/environment_0.hdr" }` — same shape as mesh/splat/cad entries

**New `addEnvironment()` method on ArchiveCreator:**
```typescript
addEnvironment(blob: Blob, fileName: string): string
```
Follows the same pattern as `addMesh()`, `addCad()`, etc. — handles key naming, path construction, and manifest entry creation. Returns the entry key string (e.g., `"environment_0"`).

**New `getEnvironmentEntry()` method on ArchiveLoader:**
```typescript
getEnvironmentEntry(): { entry: ManifestDataEntry; key: string } | null
```
Uses `findEntriesByPrefix('environment_')`. Add `hasEnvironment: boolean` to `ContentInfo` interface.

**HDR blob capture strategy:**
When an HDR is loaded (via preset, file upload, or URL), the raw HDR bytes are captured by fetching the URL with `fetch()` before passing it to `sceneManager.loadHDREnvironment()`. This is necessary because Three.js's `RGBELoader` does not expose the raw file bytes. The blob is stored in `state.environmentBlob` for later archive bundling (consistent with existing patterns like `originalMeshBlob` and `manualPreviewBlob` in `AppState`).

For built-in presets: `fetch('/hdri/studio_small_09_1k.hdr')` → store blob → pass blob URL to RGBELoader.
For custom file uploads: the `File` object is already a blob — store directly.
For custom URLs: `fetch(url)` → store blob → pass blob URL to RGBELoader.

**On export** (`archive-creator.ts`):
- If `state.environmentBlob` is non-null, call `archiveCreator.addEnvironment(blob, 'environment_0.hdr')`
- `viewer_settings.rendering_preset` stores the preset name (e.g., `"studio"`) or `"custom"`
- Individual settings (tone mapping, exposure, lighting, post-processing) continue to be saved as they are today

**On load** (`archive-pipeline.ts` + `kiosk-main.ts`):
- `archive-loader.getEnvironmentEntry()` extracts `assets/environment_0.hdr`
- Create blob URL → `fetch()` to capture blob → store in `state.environmentBlob` for re-export round-trip
- Pass blob URL to `sceneManager.loadHDREnvironment(blobUrl)`
- Blob URL is revoked in the `.finally()` of the load promise (matching the pattern in `loadHDREnvironmentFromFile`)
- Apply `environment_as_background` setting
- Apply remaining `viewer_settings` (tone mapping, exposure, lighting, post-processing) as today
- Replaces the `// NOTE: environment_preset IBL would require async HDR loading; skipped here.` comments

**Re-export round-trip:** When an archive containing an HDR is opened and re-exported without changes, `state.environmentBlob` is populated during archive load, ensuring the HDR survives the round-trip without requiring the user to re-select it.

**Mesh-only guard:**
- The guard only prevents *automatic* preset application on mesh load — not manual selection
- If an archive explicitly contains an HDR (user chose to save it), it loads regardless of whether splats are present
- `shouldAutoApplyPreset()` is only called for the hypothetical "auto-apply on first mesh load" feature, not for archive restore

### Editor UI Changes

**New "Rendering Preset on Open" section** in the View Settings pane (`editor/index.html`), positioned as the first archived section (above "Lighting on Open"):

```html
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

**Behavior on preset selection:**
1. Calls `applyPreset()` — loads HDR, sets tone mapping, adjusts lighting, configures post-processing
2. Auto-checks "Save lighting/tone mapping/environment with archive" checkboxes
3. Populates all archived sub-section controls with preset values
4. Updates all live controls for immediate preview
5. Stores HDR blob in `state.environmentBlob` for export

**Behavior on individual control change:**
- If any archived lighting/tone mapping/environment/post-processing control is changed manually, the rendering preset dropdown flips to "Custom" (set programmatically via `select.value = 'custom'` — the `disabled` attribute prevents manual selection but allows programmatic assignment)

**"Custom" option:** The `<option value="custom" disabled>` cannot be selected by the user directly — it's a display-only state that indicates manual overrides are active. Selecting "None" resets to default behavior without a preset.

**Kiosk environment dropdown update:**
- The existing `env-map-select` in `index.html` (kiosk) should also be updated with the new preset list for consistency, though it's only visible in themes that expose scene controls.

### State Changes

**`AppState` additions in `types.ts`:**
```typescript
environmentBlob: Blob | null;       // raw HDR file for archive bundling
renderingPreset: string | null;      // current preset name or 'custom'
```

**Manifest `viewer_settings` addition in `archive-creator.ts`:**
```typescript
rendering_preset: string | null;     // preset name that was active at export time
```

**Coexistence with `environment_preset`:** The existing `environment_preset` field (stores env map select value like `"preset:0"`) is retained for backward compatibility but its format changes from index-based (`"preset:0"`) to name-based (`"Studio"`). When `rendering_preset` is set, it takes precedence — the individual `environment_preset`, tone mapping, lighting, and post-processing fields serve as the actual applied values. `rendering_preset` is informational (records which preset was active), while the individual fields are authoritative. Old archives with `environment_preset: "preset:0"` are handled by a migration fallback in the loader.

**`metadata-manager.ts` impact:** The existing `collectMetadata()` reads `meta-viewer-env-preset` select value as `environmentPreset`. After the value format change from `"preset:0"` to `"Studio"`, this read path produces name strings automatically — no code change needed beyond updating the HTML option values. `prefillMetadataFromArchive()` sets the select value from `manifest.viewer_settings.environment_preset` — this also works with name strings. Add `rendering_preset` read/write alongside the existing fields.

### Backward Compatibility

| Scenario | Behavior |
|---|---|
| Old archive, no HDR asset | No HDR loaded, behaves exactly as today |
| Old archive with `environment_preset` but no HDR file | Ignored (can't load what's not bundled) |
| New archive opened in old viewer | `rendering_preset` field ignored, individual settings still applied, HDR asset ignored (unrecognized role) |
| Archive with HDR + splat scene | HDR loads (user explicitly saved it), no auto-preset behavior |

**Schema version:** The manifest `schemaVersion` should be bumped to indicate the new `environment_0` asset type and `rendering_preset` viewer setting. Older viewers will ignore unrecognized asset keys and unknown `viewer_settings` fields, so this is informational — no breaking change.

## Files Changed

| File | Change |
|---|---|
| `src/modules/rendering-presets.ts` | **New** — preset definitions, `applyPreset()`, `getCurrentPresetName()`, `shouldAutoApplyPreset()` |
| `src/modules/constants.ts` | Update `ENVIRONMENT.PRESETS` with local paths, add new entries |
| `src/modules/archive-creator.ts` | Add `addEnvironment(blob, fileName)` method, bundle HDR blob into ZIP, add `rendering_preset` to manifest `viewer_settings` |
| `src/modules/archive-pipeline.ts` | Extract + load HDR on archive open, store blob for re-export, replace skip comment |
| `src/modules/kiosk-main.ts` | Extract + load HDR on archive open, replace skip comment |
| `src/modules/archive-loader.ts` | Add `getEnvironmentEntry()` using `findEntriesByPrefix('environment_')`, add `hasEnvironment` to `ContentInfo` |
| `src/modules/event-wiring.ts` | Wire up `rendering-preset-select` change handler, detect manual overrides → flip to Custom, **refactor env-map-select handler from index-based to name-based lookup**, update `hdr-file-input` and `btn-load-hdr-url` handlers to also flip `rendering-preset-select` to `'custom'` when a custom HDR is loaded |
| `src/main.ts` | Add `environmentBlob` + `renderingPreset` to state, import preset module, update deps factory, capture HDR blob on load (fetch + store) |
| `src/editor/index.html` | Add "Rendering Preset" archived section in View Settings pane, **update both `env-map-select` (line ~1026) and `meta-viewer-env-preset` (line ~695) to name-based option values** |
| `src/index.html` | Update `env-map-select` options to name-based values matching new preset list |
| `src/types.ts` | Add `environmentBlob: Blob \| null` and `renderingPreset: string \| null` to `AppState` |
| `src/modules/metadata-manager.ts` | Read/write `rendering_preset` in manifest display/save |
| `src/modules/scene-manager.ts` | No changes needed — existing `loadHDREnvironment(url)` API is sufficient for blob URLs |
| `public/hdri/` | **New directory** — 4 HDRI files (~2.2MB total) |

## Testing

- **Unit test:** `rendering-presets.test.ts` — verify preset definitions are complete, `getCurrentPresetName()` matches correctly, `shouldAutoApplyPreset()` logic
- **Manual test:** Load mesh → select Studio preset → verify HDR loads + tone mapping + lighting + post-processing all apply → export archive → open in kiosk mode → verify identical appearance
- **Backward compat test:** Open an old `.ddim` archive without HDR → verify no errors, behaves as before
- **Splat guard test:** Load a splat → verify preset dropdown doesn't auto-apply → manually select Studio → verify HDR loads (user choice respected)

## Out of Scope

- User-saveable custom presets (localStorage) — can layer on top later
- Auto-apply preset on first mesh load (could be a future default)
- HDR resolution options (2K/4K) — 1K is sufficient for IBL, keeps archives small
- Environment map rotation control — would enhance positioning of highlights but not critical for v1
