# Editorial Kiosk Responsive Adaptation

## Problem

The editorial theme kiosk mode has a 4-tier CSS degradation system for viewport width, but:
- At Tier 3 (480–699px), all editorial UI is hidden and the user falls back to the generic base kiosk — losing the gold/navy identity entirely.
- No phone-specific editorial experience exists.
- Touch targets on tablets are below the 44px minimum (ribbon is 32px tall).
- A 69px dead zone between the JS mobile threshold (699px) and base kiosk CSS threshold (768px) causes inconsistent behavior.
- Short iframes (<400px tall) render the info panel unusable.

## Design

Seven sequential changes, each building on the last.

### Step 1: Unify breakpoints to 699px

**Files:** `src/kiosk.css`, `src/modules/constants.ts`

Change base kiosk CSS `max-width: 768px` rules to `max-width: 699px`. Update `MOBILE_WIDTH_PX` from 768 to 699. Aligns JS `isMobileKiosk()`, editorial CSS tiers, and base kiosk CSS on a single mobile boundary.

### Step 2: Editorial bottom nav at <700px

**Files:** `src/themes/editorial/layout.js`, `src/themes/editorial/layout.css`

Replace `display: none !important` on the ribbon at Tier 3 with an editorial bottom nav bar:
- 48px tall, navy background, gold top border (same visual language as ribbon).
- 4 icon buttons (44px targets): view mode cycle, quality SD/HD, annotation toggle, details.
- Gold active/selected states matching ribbon link styling.
- Created in `layout.js` `setup()`, visibility controlled by media query.
- Wired to the same handlers the ribbon currently uses.

The desktop ribbon stays in the DOM for resize-back. At <700px the ribbon hides and the bottom nav shows.

### Step 3: Touch targets via `pointer: coarse`

**Files:** `src/themes/editorial/layout.css`

One `@media (pointer: coarse)` block:
- Desktop ribbon height 32px → 40px with increased button padding to meet 44px targets.
- Matcap dropdown items to 36px height.
- Bottom nav already 48px, no change needed.

### Step 4: Editorial-styled bottom sheet

**Files:** `src/themes/editorial/layout.css`, `src/themes/editorial/layout.js`

Style `#metadata-sidebar` inside `.kiosk-editorial` at mobile widths:
- Navy background with blur backdrop, gold drag handle.
- Section headers in Georgia with gold accent, matching desktop info panel collapsible style.
- Content text in Source Sans with editorial color variables.
- Gold scrollbar matching desktop info panel.

In `layout.js`, populate sidebar with same collapsible sections as desktop info panel (subject, technical, file) when at mobile widths.

### Step 5: Phone annotation handling + title tap-to-reveal

**Files:** `src/themes/editorial/layout.css`, `src/themes/editorial/layout.js`

**Annotations:** Tapping a marker at mobile width slides the bottom sheet to half-snap with editorial-styled annotation detail (gold title underline, navy surface, matching desktop popup typography).

**Title:** Touch listener on viewer canvas reveals title block for 3s on tap. Fixes the desktop auto-fade behavior (mousemove idle detection) not working on touch devices where mousemove never fires.

### Step 6: Walkthrough phone mode

**Files:** `src/themes/editorial/layout.js`, `src/themes/editorial/layout.css`

When walkthrough starts at mobile width, bottom nav content swaps to walkthrough controls:
- Left arrow / "3 of 7" counter / right arrow.
- Same 48px bar, same editorial styling.
- Exit restores normal bottom nav.
- Hooks into existing `onWalkthroughStart`, `onWalkthroughStopChange`, `onWalkthroughEnd` callbacks.

### Step 7: Short viewport + landscape

**Files:** `src/themes/editorial/layout.css`

**Short viewport:** `@media (max-height: 400px)` hides `.editorial-info-overlay`.

**Landscape phone:** `@media (max-width: 699px) and (orientation: landscape)`:
- Bottom nav 48px → 40px.
- Title block hidden.
- Bottom sheet max-height: 60dvh.

## Dependency Chain

```
Step 1 (breakpoints)
  └→ Step 2 (bottom nav)
       ├→ Step 3 (touch targets)
       ├→ Step 4 (styled sheet)
       │    └→ Step 5 (annotations + title)
       ├→ Step 6 (walkthrough)
       └→ Step 7 (landscape + height)
```

Steps 3, 4, 6, 7 are independent of each other once step 2 is done.

## Out of Scope

- Phone as primary design target (phone gets editorial identity, not a phone-native redesign).
- Gesture-driven/minimal modes, poster lazy-loading, card stack layouts.
- Container queries (media queries work correctly in iframes and match the existing tier system).
