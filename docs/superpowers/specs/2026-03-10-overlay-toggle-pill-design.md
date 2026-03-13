# Overlay Toggle Pill Design

## Summary

Add a new pill toggle group to the editor viewport toolbar that controls visibility of overlay data types (SfM Cameras and Flight Paths). Unlike the display mode pill (radio-style), this pill uses independent toggles where each button can be on/off in any combination.

## Placement

Same viewport toolbar row, positioned to the right of the SD/HD quality pill:

```
[ Model | Splat | Cloud | STL | M/S | Split ]    [ SD | HD ]    [ SfM Cameras | Flight Paths ]
```

## Behavior

- Two independent toggle buttons: "SfM Cameras" and "Flight Paths"
- Each button appears individually when its data type is loaded, starting in the ON (active) state
- The entire pill container is hidden when no overlay data is loaded
- Clicking a button toggles visibility of that overlay type and updates the active class
- Any combination of on/off is valid (both on, both off, one on one off)

## HTML Structure

```html
<div class="vp-overlay-pill hidden" id="vp-overlay-pill">
    <button class="vp-pill-btn active" id="btn-overlay-sfm" style="display:none">SfM Cameras</button>
    <button class="vp-pill-btn active" id="btn-overlay-flightpath" style="display:none">Flight Paths</button>
</div>
```

Added to `src/editor/index.html` in the viewport toolbar, after the quality toggle container.

## CSS

Reuses `.vp-pill-btn` active/hover styling. New `.vp-overlay-pill` container gets the same flex layout as `.vp-display-pill`.

## Visibility Logic

`updateOverlayPill()` function in `ui-controller.ts`:
- Called when SfM cameras or flight paths are loaded/removed
- Shows individual buttons when their data exists
- Shows/hides the container based on whether any buttons are visible
- New buttons start with `.active` class (ON)

## Toggle Logic

Click handlers toggle `.active` class and call into the relevant module:
- SfM Cameras: toggle `colmapGroup` visibility
- Flight Paths: toggle flight path visibility via `FlightPathManager`

## Files Changed

1. `src/editor/index.html` — add pill HTML in viewport toolbar
2. `src/styles.css` — `.vp-overlay-pill` container styling
3. `src/modules/ui-controller.ts` — `updateOverlayPill()` function
4. `src/modules/event-wiring.ts` — toggle click handlers
5. `src/main.ts` — call `updateOverlayPill()` after overlay data loads
