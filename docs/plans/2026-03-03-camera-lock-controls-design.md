# Camera Lock Controls — Design

## Goal

Add four camera constraint options to the Default View metadata tab. Each is a checkbox that applies live in the editor and persists to the archive manifest for kiosk mode.

## Controls

1. **Lock orbit point** — disables panning so the orbit center cannot be moved
2. **Lock camera distance** — freezes zoom at the current distance from the orbit target
3. **Keep camera above ground** — prevents orbiting below the horizontal plane
4. **Limit camera height** — caps camera Y position at a configurable value (numeric input + "Set to current" button)

## UI

Added to the "Opening Camera" subsection of the Default View tab (`#edit-tab-viewer`) in `index.html`:

```
┌─ Camera Constraints ──────────────────────────┐
│ ☐ Lock orbit point (disable panning)          │
│ ☐ Lock camera distance                        │
│ ☐ Keep camera above ground                    │
│ ☐ Limit camera height                         │
│     Max Y: [___12.5___] [Set to current]      │
└───────────────────────────────────────────────┘
```

- "Max Y" row only visible when "Limit camera height" is checked
- "Lock camera distance" captures current distance on toggle-on
- Element IDs follow `meta-viewer-lock-*` / `meta-viewer-max-*` convention

## Manifest Schema

New fields in `viewer_settings`:

```ts
lock_orbit: boolean;              // default: false — disables pan
lock_distance: number | null;     // null = unlocked, number = locked distance value
lock_above_ground: boolean;       // default: false — caps polar angle at PI/2
max_camera_height: number | null; // null = no limit, number = max camera Y
```

## Runtime Enforcement

| Lock | Mechanism |
|------|-----------|
| Lock orbit point | `controls.enablePan = false` |
| Lock distance | `controls.minDistance = controls.maxDistance = storedDistance` |
| Keep above ground | `controls.maxPolarAngle = Math.PI / 2` |
| Max camera height | `controls.addEventListener('change', clampY)` — clamps `camera.position.y` to max value |

Unlocking restores defaults: `enablePan = true`, min/maxDistance from `ORBIT_CONTROLS` constants, `maxPolarAngle = Math.PI`, remove clamp listener.

## Data Flow

### Save
1. Checkbox toggle → live constraint applied to controls
2. Values stored in hidden inputs (distance value, max height value)
3. `collectMetadata()` reads hidden inputs → `CollectedMetadata.viewerSettings`
4. `ArchiveCreator.updateViewerSettings()` writes to `manifest.viewer_settings`
5. Manifest serialized into ZIP archive

### Load (Editor)
1. Archive opened → `prefillMetadataFromArchive()` sets checkbox states + hidden input values
2. `applyViewerSettings()` reads lock fields → applies constraints to controls

### Load (Kiosk)
1. Manifest parsed → lock fields read from `viewer_settings`
2. Constraints applied to controls after camera position restore

## Files Changed

| File | Change |
|------|--------|
| `src/index.html` | Add 4 checkboxes + max height input/button in Opening Camera subsection |
| `src/modules/metadata-manager.ts` | Wire checkbox events with live preview, collect/prefill new fields |
| `src/modules/archive-creator.ts` | Add new fields to manifest interface + `updateViewerSettings()` |
| `src/modules/archive-pipeline.ts` | Apply lock settings in `applyViewerSettings()` |
| `src/modules/kiosk-main.ts` | Apply lock settings when loading manifest |
| `src/types.ts` | Update viewer settings type interfaces if applicable |
| `src/modules/constants.ts` | Add default values for lock settings if needed |
