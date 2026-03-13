# Design: Unified Optimization Section with Object Profiles

**Date:** 2026-03-13
**Status:** Reviewed

---

## Problem

The editor has two separate optimization panels (Web Optimization and SD Proxy) with generic settings that don't account for object size or target device capabilities. Users must manually determine appropriate face counts and texture resolutions by consulting external references. The performance guide (`docs/reference/MESH-PERFORMANCE-GUIDE.md`) defines clear standards per object category, but those standards aren't wired into the UI.

## Solution

Consolidate all optimization controls into a single "Optimization" section in the Assets pane, driven by an **Object Profile** dropdown that auto-fills appropriate HD and SD targets based on the physical size category of the scanned object.

---

## Data Model

### `ObjectProfile` interface and `OBJECT_PROFILES` constant (`constants.ts`)

```ts
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

### State changes (`types.ts`)

Add to `AppState`:

```ts
objectProfile: string | null;  // key into OBJECT_PROFILES, null = not yet selected
```

### Backward compatibility

The existing `DECIMATION_PRESETS` remain in `constants.ts` unchanged. Archives that reference preset names in their manifest (`decimation.preset`) continue to load correctly. New archives store the `objectProfile` key in manifest metadata instead.

---

## UI Structure

### New "Optimization" section in Assets pane (`editor/index.html`)

Replaces the current `#web-opt-section` and `#proxy-section`. The splat LOD checkbox moves here from its current location.

```
Optimization (collapsible section)
├── Object Profile: [Small ▾ Medium ▾ Large ▾ Massive ▾ Custom]
│
├── Web Optimization (sub-collapsible)
│   ├── Current faces: 2,450,000
│   ├── Target faces: [300,000]     ← auto-filled from profile.hd.targetFaces
│   ├── Texture max res: [2048]     ← auto-filled from profile.hd.textureMaxRes
│   ├── ☑ Draco compression
│   ├── [Optimize] [Revert]
│   └── (progress bar)
│
├── SD Proxy (sub-collapsible)
│   ├── HD: 300,000 faces → SD: 50,000 faces
│   ├── Target faces: [50,000]      ← auto-filled from profile.sd.targetFaces
│   ├── Texture max res: [1024]     ← auto-filled from profile.sd.textureMaxRes
│   ├── ☑ Draco compression
│   ├── [Generate] [Preview SD/HD] [Remove]
│   └── (progress bar)
│
└── Splat Quality
    └── ☑ Generate SD splat proxy
```

### Behavior

- **Section visibility:** The Optimization section is hidden until a mesh or splat is loaded, matching current `#web-opt-section` behavior. The Web Optimization and SD Proxy subsections are hidden individually until a mesh is loaded; the Splat Quality subsection is hidden until a splat is loaded.
- **Profile selection:** Changing the Object Profile dropdown fills `targetFaces` and `textureMaxRes` in both subsections. Does NOT trigger generation — user clicks buttons.
- **Custom profile:** Selecting "Custom" stops auto-filling but does not clear current values. The web-opt mode toggle (faces/ratio) is shown only when Custom is selected; otherwise hidden.
- **Manual edits:** If the user manually edits a field after selecting a profile, the dropdown stays on the selected value (no auto-switch to "Custom").
- **Default state:** "Medium" selected by default. Fields populated with medium profile values.
- **No ratio mode by default:** Both subsections default to absolute face count mode.
- **Low face count edge case:** If the loaded mesh has fewer faces than the profile's SD target, the "Generate" button remains enabled (meshoptimizer handles this gracefully by returning the original) but a hint is shown: "Mesh already below target."
- **Manual proxy file inputs:** The existing manual proxy mesh/splat file inputs (`#proxy-mesh-input`, `#proxy-splat-input`) remain in the SD Proxy subsection, below the Generate button, as an alternative to automated generation.

### Removed UI elements

- The old SD Proxy preset dropdown (`ultra-light / light / medium / high / custom`) — replaced by Object Profile.
- The old SD Proxy `#decimation-advanced-toggle` and advanced body — settings are now always visible in simplified form.

---

## File Changes

### `src/modules/constants.ts`
- Add `ObjectProfile` interface, `OBJECT_PROFILES` constant, `DEFAULT_OBJECT_PROFILE`
- Existing `DecimationPreset` and `DECIMATION_PRESETS` unchanged (backward compat)

### `src/types.ts`
- Add `objectProfile: string | null` to `AppState`

### `src/editor/index.html`
- Remove `#web-opt-section` and `#proxy-section` from current locations
- Add new `#optimization-section` containing:
  - Object Profile dropdown (`#object-profile-select`)
  - Web Optimization subsection (moved from `#web-opt-section`, add `textureMaxRes` input)
  - SD Proxy subsection (moved from `#proxy-section`, replace preset dropdown with `targetFaces` + `textureMaxRes` inputs)
  - Splat Quality subsection (splat LOD checkbox moved here)

### `src/main.ts`
- New `setupOptimizationPanel()` function replacing `setupDecimationPanel()` and web-opt event wiring
- Profile dropdown change handler: reads `OBJECT_PROFILES[value]`, fills both subsections
- Both "Optimize" and "Generate" buttons read from new input element IDs, build `DecimationOptions` via `resolveOptions()` with `targetFaceCount` override
- `state.objectProfile` set on profile change
- Remove old `setupDecimationPanel()` function

### `src/modules/archive-creator.ts`
- Add `objectProfile?: string` to the `QualityStats` interface
- Add `if (stats.objectProfile !== undefined) this.manifest._meta.quality.objectProfile = stats.objectProfile;` to `setQualityStats()`

### `src/modules/export-controller.ts`
- Pass `state.objectProfile` via `setQualityStats({ objectProfile: state.objectProfile })`
- Store `objectProfile` in per-proxy `decimation` block alongside `preset` for traceability
- Existing `decimation` block structure unchanged

### `src/modules/archive-pipeline.ts`
- On archive load, read `manifest._meta.quality.objectProfile` and set `state.objectProfile`
- Add optional `onProfileLoaded?: (profile: string) => void` callback to `ArchivePipelineDeps`
- `main.ts` provides the callback implementation that updates `#object-profile-select` and populates fields

### `src/modules/mesh-decimator.ts`
- No changes — `resolveOptions()` already accepts `targetFaceCount` and `textureMaxRes` overrides. Profile-driven generation constructs a full `DecimationOptions` from the `ObjectProfileTier` fields directly, bypassing `resolveOptions()` preset fallback.

---

## Archive Manifest Changes

New field in `_meta.quality`:

```json
{
  "_meta": {
    "quality": {
      "objectProfile": "small",
      "mesh_polygons": 300000,
      "mesh_vertices": 150000
    }
  }
}
```

Mesh proxy entries continue to use the existing `decimation` block:

```json
{
  "mesh_0_proxy": {
    "lod": "proxy",
    "derived_from": "mesh_0",
    "decimation": {
      "preset": "custom",
      "objectProfile": "small",
      "targetRatio": 0.01,
      "errorThreshold": 0.2,
      "textureMaxRes": 1024,
      "originalFaces": 2450000,
      "resultFaces": 50000
    }
  }
}
```

The `preset` field in the decimation block will be `"custom"` for profile-driven generation (since profiles bypass the old preset system). The `objectProfile` in `_meta.quality` is the authoritative record.

---

## Performance Guide Integration

Face count targets in `OBJECT_PROFILES` are derived from the "Quick Reference Card" in `docs/reference/MESH-PERFORMANCE-GUIDE.md`:

| Profile | HD Target | SD Target | Source Row |
|---------|-----------|-----------|------------|
| Small | 300K | 50K | "Shoe / artifact" HD + SD columns |
| Medium | 500K | 100K | "Chair / small sculpture" HD + SD |
| Large | 1M | 250K | "Monument / room interior" HD + SD |
| Massive | 2M | 500K | "Full building / complex" HD + SD |

Texture resolutions follow the guide's "What texture size?" table for SD/HD device tiers.

---

## What This Does NOT Change

- `mesh-decimator.ts` internals (meshoptimizer WASM, Draco worker, GLB export)
- `archive-loader.ts` (ZIP extraction, manifest parsing unchanged)
- `kiosk-main.ts` (kiosk doesn't show optimization UI)
- `quality-tier.ts` (runtime SD/HD detection unchanged)
- Existing `DECIMATION_PRESETS` (kept for manifest backward compatibility)

---

## Implementation Notes

- **Field name mapping:** `ObjectProfileTier.targetFaces` maps to `DecimationOptions.targetFaceCount`. The profile tier uses the semantic name; the options interface uses the technical one.
- **`dracoCompress`:** Not stored in `ObjectProfileTier`. Read from the UI checkbox (`#web-opt-draco` / `#decimation-draco`) at generation time.
- **`targetRatio` in manifest:** For profile-driven generation, `targetRatio` in the per-proxy `decimation` block is computed as `targetFaces / originalFaces` for traceability (not taken from a preset).
- **`preset` in manifest:** Set to `"custom"` for profile-driven generation. The `objectProfile` field is the authoritative record of which profile was used.
