# Industrial Theme Design

**Date**: 2026-03-06
**Status**: Approved
**Purpose**: A kiosk theme for mesh inspection on automated scanning platforms, replacing MeshLab as the default viewer.

## Context

The industrial theme targets desktop workstation operators inspecting scan data (meshes, splats, point clouds) for quality. It prioritizes tool access and neutral presentation over decorative chrome. No touch optimization, no attract mode, no walkthrough support.

## Visual Identity

**Theme name**: `industrial`
**Layout name**: `industrial`
**Scene background**: `#2a2a2a` (neutral mid-dark gray)

### Color Palette

| Token | Value | Purpose |
|-------|-------|---------|
| `--kiosk-accent` | `#4A9EFF` | Tool-blue — selected tools, active states |
| `--kiosk-accent-rgb` | `74, 158, 255` | |
| `--kiosk-surface-rgb` | `38, 38, 42` | Toolbar/status bar background |
| `--kiosk-elevated-rgb` | `52, 52, 58` | Hover states, dropdown backgrounds |
| `--kiosk-bg-deep-rgb` | `24, 24, 28` | Loading screen background |
| `--kiosk-scene-bg` | `#2a2a2a` | Viewport background |

### Text

| Token | Value |
|-------|-------|
| `--kiosk-text-bright-rgb` | `220, 220, 225` |
| `--kiosk-text-body-rgb` | `175, 175, 182` |
| `--kiosk-text-dim-rgb` | `120, 120, 130` |
| `--kiosk-text-heading-rgb` | `235, 235, 240` |

### Typography

| Token | Value |
|-------|-------|
| `--kiosk-font-display` | `'Inter', 'Segoe UI', system-ui, sans-serif` |
| `--kiosk-font-body` | `'Inter', 'Segoe UI', system-ui, sans-serif` |
| `--kiosk-font-mono` | `'JetBrains Mono', 'SF Mono', Consolas, monospace` |

Visual tone: VS Code / Fusion 360 / Blender dark. Neutral grays, no warm/cool tint. Blue accent for interactivity only. No decorative elements, gradients, or glow effects. Subtle 1px borders.

## Layout: Approach A — CAD Workbench

```
+----------------------------------------------------------------------+
| [Slice] [Measure] [Annotate] | [Matcap] [Tex] [Wire] | [Light] [SS] |  <- 40px toolbar
+----------------------------------------------------------------------+
|                                                                      |
|                          3D Viewport                                 |
|                        (full bleed)                                  |
|                                                                      |
+----------------------------------------------------------------------+
| scan_001.glb  |  1,247,832 vertices  |  14.3 MB  |  2024-03-06      |  <- 28px status bar
+----------------------------------------------------------------------+
```

### Top Toolbar (40px)

- Background: `rgba(var(--kiosk-surface-rgb), 0.95)` + `backdrop-filter: blur(8px)`
- Bottom border: 1px solid `rgba(255,255,255,0.06)`
- Tool buttons: 36x36px icon-only with hover tooltips
- Three groups separated by 1px vertical dividers:
  1. **Inspection**: Slice, Measure, Annotate
  2. **Display**: Matcap, Texture, Wireframe
  3. **Utilities**: Light direction, Screenshot
- Active state: blue accent background tint + blue icon color
- Toggle tools (matcap, texture, wireframe) stay highlighted when active

### 3D Viewport

- Full bleed between toolbar and status bar
- Orbit-only controls (no pan, no transform gizmo)
- Orbit target locked to geometry bounding box center

### Bottom Status Bar (28px)

- Background: same as toolbar
- Top border: 1px solid `rgba(255,255,255,0.06)`
- Monospace font, 0.68rem, left-aligned
- Pipe-separated fields: filename, vertex count, file size, date
- Measurement readout appears right-aligned when measure tool is active

## Tool Behavior

### Mutually Exclusive Tools

| Tool | Behavior | Cursor |
|------|----------|--------|
| Slice | Section plane, drag to move along axis, small X/Y/Z axis picker near plane | `col-resize` |
| Measure | Click two points, line + dimension label in scene, accumulates until cleared | `crosshair` |
| Annotate | Click surface to place marker, popup for label entry | `crosshair` |
| Light | Hemisphere widget (~80px, top-right), click-drag to reposition directional light | `default` |
| Screenshot | Immediate action (not a mode) — captures viewport, triggers download | n/a |

### Independent Display Toggles

| Toggle | Default | Notes |
|--------|---------|-------|
| Matcap | Off | Replaces material with matcap shader. Disables texture toggle while active. |
| Texture | On (if textured) | Shows/hides diffuse texture. Disabled/dimmed if mesh has no texture. |
| Wireframe | Off | Overlays wireframe. Combinable with matcap or texture. |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` | Slice tool |
| `2` | Measure tool |
| `3` | Annotate tool |
| `M` | Toggle matcap |
| `T` | Toggle texture |
| `W` | Toggle wireframe |
| `L` | Light tool |
| `P` | Screenshot |
| `Esc` | Deactivate current tool |
| `F` | Fit camera to model |

## Loading Flow

1. Archive URL loads with thin progress bar + filename label (no spinner, no click gate)
2. Viewport appears immediately with toolbar + status bar after load

## Excluded Features

- No attract mode / idle animation
- No walkthrough support
- No info overlay / metadata panel (status bar only)
- No annotation strip (markers in viewport only)
- No click gate
- No pan controls
- No transform gizmo

## Theme Files

```
src/themes/industrial/
  theme.css      — CSS variable overrides (palette, typography)
  layout.css     — Toolbar, status bar, tool-specific UI styling
  layout.js      — DOM creation, tool wiring, keyboard shortcuts, status bar population
```

## New Capabilities Required

Several tools referenced in this theme do not yet exist in the codebase and will need to be implemented as shared modules (not theme-specific):

- **Slice/section plane** — new module
- **Measure tool** — new module
- **Matcap toggle** — new module (matcap shader material swap)
- **Wireframe toggle** — likely a simple `material.wireframe = true` toggle
- **Light direction control** — new UI widget + light manipulation
- **Orbit-only camera lock** — may leverage existing camera constraint system

The layout.js will wire these modules into the toolbar UI, but the underlying 3D functionality lives in shared modules so other themes can reuse them.
