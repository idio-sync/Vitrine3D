# Industrial Theme — Functional Menu Dropdowns

**Date:** 2026-03-09
**Status:** Approved
**Scope:** `src/themes/industrial/layout.js`, `src/themes/industrial/layout.css`

---

## Problem

The industrial theme menu bar (`File | View | Render | Tools | Help`) highlights on hover but does nothing when clicked. The toolbar below it is fully functional, but the menu bar is purely decorative. This makes the theme feel like a mockup rather than a real application.

## Goal

Replace decorative menu spans with fully functional Qt-style click-to-open dropdown menus that expose new viewer functionality not currently accessible via the toolbar (camera presets, orthographic mode, open file, reset scene, keyboard shortcut reference, etc.).

---

## Approach

**Click-to-open with focus management** — the standard Qt/MeshLab behavior:
- Click a menu label to open its dropdown; clicking another label closes the first and opens the new one
- Click outside → close all (document `mousedown` listener)
- Press `Escape` → close all
- Click an item → execute action, close all menus
- No hover-open (hover-open feels web-generic, not application-like)

---

## Menu Structure

### File
| Item | Action |
|------|--------|
| Open File... | Hidden `<input type="file">` covering all supported formats; calls `deps.loadFile(file)` |
| ─── | separator |
| Take Screenshot | Same as toolbar screenshot button |
| Reset View | `deps.resetOrbitCenter()` + fit camera to scene |
| ─── | separator |
| Reset Scene | `window.location.reload()` |

**Supported file formats for Open File:**
`.ddim` `.a3d` `.a3z` `.glb` `.gltf` `.obj` `.e57` `.ply` `.splat` `.sog` `.step` `.stp` `.iges` `.igs` `.csv` `.kml` `.kmz` `.srt`

### View
| Item | Action |
|------|--------|
| Fit to View | Same as toolbar F button |
| ─── | separator |
| Front | Set camera to +Z axis view |
| Back | Set camera to −Z axis view |
| Left | Set camera to +X axis view |
| Right | Set camera to −X axis view |
| Top | Set camera to +Y axis view |
| Bottom | Set camera to −Y axis view |
| ─── | separator |
| Perspective / Orthographic | Toggle `PerspectiveCamera` ↔ `OrthographicCamera`; checkmark shows current mode |
| ─── | separator |
| Show Trackball | Toggle `.ind-trackball-overlay.hidden`; checkmark state |
| Show Toolbar | Toggle toolbar visibility; checkmark state |

### Render
| Item | Action |
|------|--------|
| Solid | Default shading; bullet indicator when active; calls `updateModelWireframe(false)` + `updateModelMatcap(false)` |
| Wireframe | `updateModelWireframe(true)`; bullet when active |
| Matcap | `updateModelMatcap(true)`; bullet when active |
| ─── | separator |
| Texture On/Off | `updateModelTextures(bool)`; checkmark state |
| ─── | separator |
| Lighting | Same as toolbar L button (shows light widget) |

Render mode items are mutually exclusive (radio group). Default: Solid.

### Tools
| Item | Action |
|------|--------|
| Section Plane | Same as toolbar button 1 (`activateTool('section')`) |
| Measure | Same as toolbar button 2 (`activateTool('measure')`) |
| Annotate | Same as toolbar button 3 (`activateTool('annotate')`) |
| ─── | separator |
| Show Annotations | `deps.annotationSystem.setVisible(bool)`; checkmark state |

### Help
| Item | Action |
|------|--------|
| Keyboard Shortcuts | Opens keyboard shortcut overlay (see below) |
| ─── | separator |
| About | Small overlay: theme name + version from manifest |

---

## New Dependencies Required

`kiosk-main.ts` must inject a `loadFile(file: File)` function into the theme deps. This function routes by file extension:

| Extension(s) | Loader |
|---|---|
| `.ddim` `.a3d` `.a3z` | Archive pipeline |
| `.glb` `.gltf` `.obj` | Mesh loader |
| `.ply` `.splat` `.sog` | Splat loader |
| `.e57` | E57 / point cloud loader |
| `.step` `.stp` `.iges` `.igs` | CAD loader |
| `.csv` `.kml` `.kmz` `.srt` | Flight path loader |

The function is the same loading logic already available in the kiosk; it just needs to be surfaced via deps so the theme can call it.

---

## CSS

All rules scoped under `body.kiosk-mode.kiosk-industrial`.

**Dropdown panel:**
- Absolute position below menu label
- `min-width: 180px`
- Background: `rgb(var(--kiosk-surface-rgb))`
- Border: `1px solid var(--kiosk-border-dark)`, no border-radius (Qt-flat)
- `box-shadow: 1px 2px 4px rgba(0,0,0,0.3)`
- `z-index: 110`
- `display: none` by default; `display: block` when parent `.ind-menu-item` has `.open`

**Dropdown items:**
- Height: 22px, `padding: 0 16px 0 24px`
- Font: `0.72rem`, same as menu bar
- Hover: `background: var(--kiosk-accent)`, `color: #fff`
- Left 24px gutter reserved for `✓` (checkmark) or `•` (radio bullet)
- Keyboard shortcut hint: right-aligned, muted color

**Separator:** 1px `var(--kiosk-border-dark)`, `margin: 4px 0`, no interaction.

**Disabled items:** `opacity: 0.4`, `pointer-events: none`.

**Keyboard Shortcuts overlay:**
- Centered fixed modal, same surface bg, 1px border
- Two-column table: shortcut left, description right
- Close on Escape or click outside
- No animation

---

## State

New module-scope state added to `layout.js`:

```js
let _openMenu = null;          // 'file' | 'view' | 'render' | 'tools' | 'help' | null
let _renderMode = 'solid';     // 'solid' | 'wireframe' | 'matcap'
let _cameraMode = 'perspective'; // 'perspective' | 'orthographic'
// _toggles gains: trackball, toolbar, annotations
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/themes/industrial/layout.js` | Replace decorative `createMenuBar()` with functional dropdown system; add camera preset logic; add orthographic toggle; add keyboard shortcuts overlay; add about overlay |
| `src/themes/industrial/layout.css` | Add dropdown panel, item, separator, checkmark/bullet, overlay styles |
| `src/modules/kiosk-main.ts` | Expose `loadFile(file: File)` in deps passed to `setup()` |

---

## Out of Scope

- Mobile layout changes (industrial theme is desktop-only)
- Editor changes
- Any toolbar changes (toolbar remains as-is)
