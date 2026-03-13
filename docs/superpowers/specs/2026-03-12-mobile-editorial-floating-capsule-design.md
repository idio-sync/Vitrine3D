# Mobile Editorial Layout — Floating Capsule Redesign

**Date**: 2026-03-12
**Status**: Draft
**Theme**: Editorial (mobile tiers only)
**Scope**: `src/themes/editorial/layout.js`, `src/themes/editorial/layout.css`

## Problem

The current mobile editorial layout has three usability issues:

1. **Drawer hides the 3D object.** The bottom-sheet metadata sidebar (peek/half/full snap states) obscures the viewport — the primary content clients are visiting to see.
2. **Drawer is hard to navigate.** Snap-state interaction is fiddly on mobile, especially for non-technical clients receiving share links.
3. **Annotation navigation is oversized.** The dropdown takes too much vertical space relative to its importance.

## Audience

Clients receiving share links and viewing presentations. Non-technical users who need clear, labeled controls. The 3D object is always the star — UI should support it, not compete with it.

## Design Priorities (ranked)

1. **Visual impact** — 3D viewport always visible and dominant
2. **Tool controls** — Material view toggles always accessible
3. **Metadata** — Viewable on demand without leaving the viewport
4. **Annotations** — Navigable when present, invisible when absent

## Solution: Floating Capsule Toolbar

Replace the full-width mobile pill bar and bottom-sheet drawer with a compact floating capsule toolbar and a full-viewport info overlay.

### 1. Capsule Toolbar

A pill-shaped bar floating ~12px above the bottom edge, horizontally centered. Always visible.

**Visual treatment:**
- Background: `rgba(22,24,29,0.88)` with `backdrop-filter: blur(12px)`
- Border: `1px solid rgba(255,192,58,0.2)` (subtle gold accent)
- Border radius: 20px
- Height: ~38px

**Buttons (left to right, with tiny labels underneath icons):**

| Button | Label | Action | State | Conditional |
|--------|-------|--------|-------|-------------|
| Texture | Tex | Toggle texture visibility via `updateModelTextures` | Independent on/off toggle | Only when `hasMeshContent` |
| Matcap | Mat | `setMaterialView('matcap:clay')` | Mutually exclusive with Nrm/Wire | Only when `hasMeshContent` |
| Normals | Nrm | `setMaterialView('normals')` | Mutually exclusive with Mat/Wire | Only when `hasMeshContent` |
| Wireframe | Wire | `setMaterialView('wireframe')` | Mutually exclusive with Mat/Nrm | Only when `hasMeshContent` |
| *(separator)* | | | | |
| Info | Info | Toggle info overlay | On/off | Always |
| *(separator)* | | | | |
| Annotations | Anno | Toggle annotation strip | On/off | Only when `annotations.length > 0` |
| More | ⋮ | Open popover: Share, Fullscreen, Quality | Popover menu | Always |

**Texture button:** Independent of material views. Calls `updateModelTextures()` to toggle texture visibility (the `texturesVisible` flag). Can be on simultaneously with any material view.

**Material view behavior (Mat/Nrm/Wire):** Mutually exclusive. Tapping an active material view returns to default. Active state uses accent color (`#ffc03a`). Calls existing `setMaterialView()` with the mode strings listed above. Matcap defaults to `'matcap:clay'` preset.

**Conditional rendering:** Material view buttons (Tex, Mat, Nrm, Wire) are only rendered when `hasMeshContent` is true, matching the existing pill behavior. For splat-only or point-cloud-only archives, only the Info/Anno/More buttons appear.

**Button sizing:** 34px touch targets, icon 13px, label ~5.5px uppercase. Touch target enlarged to 44px via `@media (pointer: coarse)`.

### 2. Info Overlay

Toggled by the Info button. Full-viewport overlay covering the entire screen, rendered behind the capsule toolbar.

**Visual treatment:**
- Background: `rgba(14,16,22,0.82)` with `backdrop-filter: blur(20px)`
- The 3D object remains visible as a subtle silhouette through the overlay
- No clear/opaque split — the entire viewport is covered uniformly

**Dismiss:** Tap the × close button (top-right) or tap the Info button again.

**Animation:** Fade in/out, ~200ms duration.

**Content (curated subset, scrollable):**
- Title (13px, bold, uppercase)
- Gold accent rule (26px × 2px, `#ffc03a`)
- Description (8px, muted, 1.65 line-height)
- Divider (1px, subtle gold)
- Detail rows (key-value): Creator, Date, Location
- Stats grid (2-column): Vertices count, Gaussians/Faces count

**Field source:** Reads from the same metadata the existing `createInfoOverlay()` uses, but displays only the curated fields above. Deep archival sections (Dublin Core technical fields, rights, coverage) are omitted on mobile.

### 3. Annotation Navigation Strip

Appears just above the capsule when the Anno button is tapped. Compact horizontal strip.

**Visual treatment:** Same frosted glass as capsule.

**Layout:** `◀  2/5  "Front Entrance"  ▶`
- Left/right arrows cycle through annotations
- Shows current index and annotation title
- Selecting an annotation flies camera to position and shows annotation popup

**Visibility:**
- Anno button only rendered when annotations exist
- Badge on Anno button shows annotation count when strip is hidden
- Strip auto-hides after 5 seconds of inactivity
- Reappears on Anno button tap

### 4. More Menu (Kebab)

Popover menu anchored to the ⋮ button. Contains secondary actions:
- Share
- Fullscreen toggle
- Quality toggle (SD/HD)

Same popover pattern as the current `barViewBtn` popover in the existing mobile pill.

## What Gets Removed

| Current Element | Replacement |
|----------------|-------------|
| `editorial-mobile-pill` (full-width 58px bar) | Floating capsule (~38px, auto-width) — **retains `.editorial-mobile-pill` class name** for backward compatibility with walkthrough mode and cleanup |
| Bottom-sheet metadata sidebar (peek/half/full snap states) | Full-viewport info overlay; `#metadata-sidebar` hidden via `display:none` in Tier 3 CSS |
| Annotation dropdown (oversized) | Compact horizontal annotation strip |
| `barDetailsBtn` (details button opening drawer) | Info button on capsule |
| `sheet-peek` / `sheet-half` / `sheet-full` class manipulation | Removed entirely on mobile — no snap-state logic |

## Technical Implementation

### Files Modified

1. **`src/themes/editorial/layout.js`** (~2030 lines)
   - Replace mobile pill creation (lines ~1523-1637) with capsule toolbar. **Retain the class name `.editorial-mobile-pill`** on the capsule element so that `onWalkthroughStart` (line ~1916) and `onWalkthroughEnd` (line ~2013) continue to find and swap children correctly.
   - Add info overlay creation for mobile (curated field subset)
   - Add annotation strip creation and navigation logic
   - Remove bottom-sheet sidebar creation and all `sheet-peek`/`sheet-half`/`sheet-full` class manipulation on mobile
   - Wire texture button to `updateModelTextures()` (independent toggle)
   - Wire material view buttons (Mat/Nrm/Wire) to existing `setMaterialView()` with correct mode strings
   - Wire annotation navigation to existing `onAnnotationSelect`/`onAnnotationDeselect`
   - Update `createInfoOverlay()` close handler: accept a toggle callback instead of querying `.editorial-details-link`, so the capsule Info button state syncs correctly on close

2. **`src/themes/editorial/layout.css`** (~3700 lines)
   - Replace mobile pill styles (lines ~2479-2692) with capsule styles
   - Replace Tier 3 bottom-sheet styles (lines ~2943-3410) with overlay + strip styles
   - Update Tier 4 styles (lines ~3412-3519) for capsule on narrow screens
   - **Update landscape orientation query** (lines ~3531-3562): remove stale `.editorial-mobile-pill` height/radius overrides and `#metadata-sidebar` bottom-sheet offsets; replace with capsule-appropriate landscape layout
   - Add `#metadata-sidebar { display: none !important; }` in Tier 3 to ensure the sidebar is fully hidden on mobile
   - Add info overlay styles (full-viewport, 82% opacity, blur, content layout)
   - Add annotation strip styles (positioned above capsule)

### Files NOT Modified

- `src/index.html` — No new DOM elements needed; capsule and overlay are created dynamically by layout.js. Note: `#annotation-info-popup` z-index must be verified as higher than capsule z-index to prevent popups rendering behind the toolbar.
- `src/styles.css` — No base style changes
- `src/kiosk.css` — No changes
- Desktop layout — Unchanged; all changes scoped to Tier 3/4 media queries
- Other themes — No changes (editorial only)

### Key Integration Points

- **`setMaterialView()`** (layout.js line ~1383): Handles mutual exclusivity for Mat/Nrm/Wire. Capsule buttons call with `'matcap:clay'`, `'normals'`, or `'wireframe'`. Texture toggle is separate — calls `updateModelTextures()`.
- **`syncMobileView`** (layout.js line ~1365): Late-bound `null`-initialized closure, assigned inside the `if (hasMeshContent)` block. Will be reassigned inside the same conditional block to sync capsule button active states instead of pill button states. When `hasMeshContent` is false, `syncMobileView` remains `null` and `setMaterialView`'s call to it is a safe no-op.
- **`createInfoOverlay()`** (layout.js): Existing function generates rich metadata content. Will be made **tier-aware** — on mobile (Tier 3/4), it produces the curated subset markup. Reuses the same `.editorial-info-overlay` class and single DOM element (no second overlay created). The close handler will be refactored to call `syncInfoOverlayState(false)` instead of querying `.editorial-details-link` directly.
- **`syncInfoOverlayState(isOpen)`**: New module-scope callback (same late-bound pattern as `syncMobileView`). Initialized to `null`, assigned by capsule setup code to sync the capsule Info button active state. Called by: (1) `createInfoOverlay()` close handler, (2) `onKeyboardShortcut` when `'m'` or `Escape` toggles/closes the overlay. This replaces all direct `.editorial-details-link` queries for overlay state sync on mobile. No explicit teardown needed — the closure is re-initialized on each `layout.js` execution, matching the `syncMobileView` pattern.
- **`onKeyboardShortcut()`** (layout.js line ~1842): Currently queries `.editorial-details-link` for `'m'` key (line ~1842) and `Escape` (line ~1851). Must be updated to call `syncInfoOverlayState(isOpen)` instead, so the capsule Info button desyncs correctly when keyboard shortcuts toggle the overlay on mobile (iPad with keyboard, foldable Android, etc.).
- **`onAnnotationSelect()`** / **`onAnnotationDeselect()`** (layout.js lines ~1807, ~1824): Module-scope functions. Annotation strip wires into these for navigation state.
- **`onWalkthroughStart()`** (layout.js line ~1916) / **`onWalkthroughEnd()`** (line ~2013): Query `.editorial-mobile-pill` by class name to swap children with walkthrough controls. **Capsule retains this class name** so walkthrough mode continues to work without modification.
- **`EDITORIAL_ROOT_CLASSES`** (layout.js line ~708): Already contains `'editorial-mobile-pill'` and `'editorial-info-overlay'`. The capsule reuses `.editorial-mobile-pill` and the overlay reuses `.editorial-info-overlay` (single element, tier-aware), so no changes needed for those entries. New entry required: `'editorial-anno-strip'` for the annotation navigation strip.

### CSS Architecture

All new styles scoped within existing media query breakpoints:
- **Tier 3** (`max-width: 699px`): Capsule visible, full layout active
- **Tier 3 landscape** (`max-width: 699px` + `orientation: landscape`): Updated to remove stale pill/sidebar dimensions; capsule adapts to landscape (may reduce to icon-only to save vertical space)
- **Tier 4** (`max-width: 479px`): Capsule may compress (smaller labels or icon-only)
- **Tier 1-2** (`≥700px`): No changes, desktop layout preserved

### Safe Area Insets (Notch / Camera Cutout Handling)

The kiosk entry point already has `viewport-fit=cover` in the viewport meta tag, and `kiosk.css` applies `env(safe-area-inset-*)` padding on `body.kiosk-mode`. However, the editorial theme has **zero safe-area handling** of its own. The capsule and title must explicitly respect device insets.

**Elements that need safe-area offsets:**

| Element | Inset | Rule |
|---------|-------|------|
| Capsule toolbar | Bottom | `bottom: calc(12px + env(safe-area-inset-bottom))` — prevents overlap with home indicator / gesture bar |
| Annotation strip | Bottom | Positioned relative to capsule, so inherits its safe-area offset |
| Info overlay | Bottom padding | `padding-bottom: calc(56px + env(safe-area-inset-bottom))` — room for capsule + inset |
| Info overlay | Top padding | `padding-top: calc(32px + env(safe-area-inset-top))` — content starts below notch |
| Archive title (editorial title block) | Top | `top: calc(existing-value + env(safe-area-inset-top))` — title must never be hidden behind a camera notch |
| Info overlay close button (×) | Top | `top: calc(18px + env(safe-area-inset-top))` — close button stays below notch |

**Back button (`#kiosk-back-library`) positioning:** The collections browser measures `titleBlock.offsetTop + titleBlock.offsetHeight` via `requestAnimationFrame` and sets `--back-btn-top`. Since the title block gets safe-area padding, the back button auto-adjusts — no separate safe-area offset needed.

**Note:** `env(safe-area-inset-*)` resolves to `0px` on devices without notches, so these additions are no-ops on standard screens. The `body.kiosk-mode` padding from `kiosk.css` provides a baseline, but since editorial theme elements use `position: absolute/fixed`, they escape that padding and need their own inset offsets.

**Tauri Android status bar:** The current Tauri config has no edge-to-edge or status bar configuration. On Android, the WebView may render under the system status bar (clock/notifications) depending on the device and Android version. For `env(safe-area-inset-top)` to report correct values, the Tauri Android app may need edge-to-edge mode enabled. This requires investigation during implementation:
- Check if `viewport-fit=cover` is sufficient in Tauri's Android WebView
- If not, add `WindowCompat.setDecorFitsSystemWindows(window, false)` in the Android activity (via Tauri plugin or Kotlin code in `src-tauri/gen/android/`)
- Test on a physical notched device — emulator notch simulation may not report accurate safe-area values
- Fallback: if `env(safe-area-inset-top)` always returns 0 on Android, add a hardcoded `padding-top` of ~28px in a Tauri-specific CSS override (detect via `body.tauri-android` or `window.__TAURI__`)

### Z-Index Stacking Order

From lowest to highest (values chosen to fit the existing z-index scale in `styles.css`):
1. 3D viewport / annotation markers (existing values)
2. Annotation strip (`z-index: 200`)
3. Info overlay (`z-index: 210`)
4. Capsule toolbar (`z-index: 220`)
5. Info overlay close button (`z-index: 230`)
6. `#annotation-info-popup` (`z-index: 300` — existing value in styles.css, no change needed)

### Animations

- Info overlay: `opacity 0→1` fade, 200ms ease-out
- Annotation strip: `translateY(10px) + opacity` slide-up, 150ms
- Material button active state: instant color change (no transition needed)
- Auto-hide annotation strip: 5s timeout, fade out 200ms

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Capsule overlaps annotation markers near bottom | Markers use CSS `z-index` below capsule; `pointer-events: none` on capsule background pass-through |
| Info overlay backdrop-filter performance on low-end Android | Test on target devices; fallback to solid `rgba(14,16,22,0.92)` without blur if needed |
| Touch targets too small on Tier 4 | `@media (pointer: coarse)` enlarges to 44px minimum |
| Anno button shown when no annotations | Conditionally render only when `annotations.length > 0` |
| Walkthrough mode breaks if capsule class name changes | Capsule retains `.editorial-mobile-pill` class; walkthrough functions find it unchanged |
| Annotation popup renders behind capsule | Explicit z-index stacking order defined; popup at z-index 300, capsule at z-index 220 |
| Info overlay close button desyncs from capsule Info button | Close handler accepts toggle callback instead of querying `.editorial-details-link` |
| Camera notch hides archive title or capsule | All positioned elements use `env(safe-area-inset-*)` offsets; resolves to 0px on non-notched devices |
| Android system status bar overlaps title | Investigate Tauri edge-to-edge mode; fallback to hardcoded 28px top padding via `window.__TAURI__` detection |
| Back button mispositioned after title safe-area change | Back button uses dynamic measurement (`offsetTop + offsetHeight`) — auto-adjusts, no separate fix needed |

## Success Criteria

1. 3D object is visible at all times (default state — no overlay, no drawer)
2. All four material view toggles accessible with a single tap
3. Metadata viewable without leaving the viewport (overlay, not navigation)
4. Annotation navigation compact and unobtrusive
5. Desktop editorial layout completely unchanged
6. No regressions in other themes (gallery, exhibit, minimal)
7. Archive title and capsule toolbar are never obscured by camera notches or home indicators on notched devices (Tauri Android, mobile Safari)
