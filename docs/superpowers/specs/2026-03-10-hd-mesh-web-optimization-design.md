# HD Mesh Web Optimization

**Date:** 2026-03-10
**Status:** Approved

## Overview

A new "Web Optimization" section in the editor sidebar that lets users decimate the primary HD mesh to a target face count and optionally Draco-compress it. The decimated mesh replaces the HD mesh for display and export, with revert available during the session.

## Motivation

Some HD mesh assets are too heavy for mid-range systems to render smoothly in the web viewer. Users need a way to reduce mesh complexity before archiving, while previewing the result in the editor.

## UI Section

New collapsible section in the editor sidebar, placed **above** the SD Proxy section (affects the primary asset):

```
┌─ Web Optimization ──────────────────┐
│                                      │
│  Current faces: 4,200,000            │
│                                      │
│  Target face count: [1,000,000    ]  │
│  ☑ Draco compression                 │
│                                      │
│  [Optimize]  [Revert]               │
│                                      │
│  Status: Optimized (1,000,000 faces) │
└──────────────────────────────────────┘
```

- **Current faces** — read-only, shows original HD mesh face count
- **Target face count** — text input, defaults to 1,000,000
- **Draco compression** — checkbox, enabled by default
- **Optimize** button — runs decimation + optional Draco, replaces viewport mesh
- **Revert** button — hidden until optimization is applied, restores original HD mesh
- **Status line** — shows result after optimization (face count achieved)

## Data Flow

1. **Generate**: Call `decimateScene()` from `mesh-decimator.ts` with the target face count, then optionally `dracoCompressGLB()`. Replace the visible mesh group in the scene. Store the original HD blob and group in state for revert.
2. **Preview**: Automatic — the decimated mesh replaces the displayed mesh immediately after generation.
3. **Revert**: Restore original HD blob and mesh group from state. Clear optimization status.
4. **Export**: `prepareArchive()` uses whatever mesh blob is current — if optimized, the decimated/compressed blob goes into the archive as the primary `mesh_0.glb`. No special export-panel logic needed.

## State Changes

New fields on `AppState` in `src/types.ts`:

```typescript
originalMeshBlob: Blob | null;       // preserved for revert
originalMeshGroup: THREE.Group | null; // preserved for revert
meshOptimized: boolean;               // tracks if current mesh is decimated
meshOptimizationSettings: {           // for display/manifest metadata
  targetFaces: number;
  dracoEnabled: boolean;
  originalFaces: number;
  resultFaces: number;
} | null;
```

## Engine Reuse

Uses the same functions from `mesh-decimator.ts` that the SD proxy system uses:

- `decimateScene()` — geometry simplification via meshoptimizer WASM
- `exportAsGLB()` — re-export as GLB
- `dracoCompressGLB()` — Draco compression

Key difference from SD proxy: **no texture downscaling** (HD textures preserved). Target face count comes from the user input rather than a preset ratio.

## Archive Manifest

When optimized, the manifest's `mesh_0` entry gets additional metadata:

```json
{
  "web_optimization": {
    "originalFaces": 4200000,
    "resultFaces": 1000000,
    "dracoCompressed": true
  }
}
```

Informational only — the mesh file itself is the decimated version.

## Edge Cases

- **No mesh loaded**: Section hidden (same pattern as SD proxy section)
- **Mesh is not GLB**: Draco checkbox disabled (Draco only works on GLB). Decimation still available — output exported as GLB.
- **Target >= current faces**: Show warning, no-op
- **SD Proxy interaction**: SD proxy remains valid after HD optimization (separate derived asset). No automatic invalidation if optimized HD becomes smaller than SD proxy.

## Files Affected

| File | Change |
|------|--------|
| `src/editor/index.html` | New "Web Optimization" section above SD Proxy |
| `src/types.ts` | New state fields on `AppState` |
| `src/main.ts` | Wire up UI events, optimize/revert logic, state management |
| `src/modules/export-controller.ts` | Add `web_optimization` metadata to manifest |
| `src/modules/mesh-decimator.ts` | No changes — reuse existing functions |
