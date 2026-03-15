# Progressive Mesh Loading for Kiosk Mode

## Problem

When opening kiosk mode links that load archives with large meshes (up to 5M faces), users wait for the full HD mesh to extract, parse, and render before seeing anything interactive. This delay is especially painful for remote archives over slower connections.

## Solution

Load the SD proxy mesh first to get users into the 3D view as fast as possible, then load the HD mesh in the background and swap it in seamlessly.

## Loading Flow

```
Archive has mesh proxy?
+-- YES
|   +-- Device tier = HD (desktop, auto-detected)
|   |   +-- Load SD proxy mesh -> show scene -> user can interact
|   |   +-- Show bottom-left loading indicator
|   |   +-- Background: extract + parse HD mesh
|   |   +-- In-place geometry swap (per-child on modelGroup)
|   |   +-- Dismiss loading indicator
|   |
|   +-- Device tier = SD (iOS/Android, auto-detected)
|       +-- Load SD proxy mesh -> show scene -> done
|       +-- No background HD load, no indicator
|
+-- NO (no proxy in archive)
    +-- Load HD mesh directly (current behavior, unchanged)
```

Manual quality toggle (any device) uses the improved in-place swap path.

## In-Place Geometry Swap

Current `loadArchiveFullResMesh` is destructive: clears all modelGroup children, leaving the scene empty while HD parses. The new approach:

1. Extract HD mesh data from archive (background, no scene impact)
2. Parse HD GLB into a temporary Group (off-scene)
3. Synchronous swap in a single JS execution block:
   - For each child in modelGroup, replace .geometry and .material with HD equivalents
   - If child counts differ, fall back to bulk remove-all + add-all in one synchronous block
4. Dispose old SD geometry/materials after swap
5. Transform on modelGroup is untouched (position/rotation/scale preserved)

The swap happens between animation frames so the renderer never draws an empty scene.

## Background Loading Indicator

- CSS-only spinner, ~24px, bottom-left of viewer canvas
- Semi-transparent, themed via CSS custom properties
- Tooltip: "Loading full resolution..."
- Fade-out over ~300ms when HD swap completes
- Not shown when: device tier is SD, no proxy exists, or archive has no mesh

## Files to Modify

1. **kiosk-main.ts** - `handleArchiveFile()`: force SD-first load when HD tier + proxy exists, kick off background HD load after scene is interactive, show/hide indicator
2. **file-handlers.ts** - New `swapArchiveMeshInPlace()` function + refactor `loadArchiveFullResMesh()` to use in-place swap
3. **Kiosk HTML/CSS** - Background loading indicator element and styles

## Files NOT Modified

- `quality-tier.ts` - iOS/Android forced-SD unchanged
- `archive-pipeline.ts` - Gets improved swap for free via shared `loadArchiveFullResMesh`
- Splat loading - Untouched (mesh only for now)

## Constraints

- iOS/Android devices stay SD-only by default; HD only loads if user explicitly toggles
- If no SD proxy exists in the archive, fall back to current direct HD load behavior
- SD proxies range 5-50MB; HD meshes can be 100MB+ (up to 5M faces)
