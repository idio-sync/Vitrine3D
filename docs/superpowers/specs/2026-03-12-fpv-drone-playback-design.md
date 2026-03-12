# First-Person View (FPV) Drone Flight Playback

**Date:** 2026-03-12
**Scope:** Editor only (kiosk theme integration deferred)
**Status:** Design

## Summary

Add first-person camera view to drone flight path playback in the editor. Users can experience the drone's perspective during flight replay — either locked to gimbal orientation or free-looking — with a picture-in-picture option for simultaneous orbit + FPV views.

## Use Cases

- **Client review:** Clients "ride along" with the drone to understand coverage and what was captured
- **QA/planning:** Team verifies flight path coverage and gimbal angles
- **Presentation:** Cinematic flythrough following the drone's exact path

## Camera Modes

Three modes, selectable from the flight path settings panel:

### 1. Orbit (default)
Existing orbit controls. No camera follow. Playback marker animates along the path but the user controls the camera freely.

### 2. Chase (existing `_followCamera`)
Camera positioned behind and above the drone, looking at it. Third-person perspective. Already implemented in `FlightPathManager` — just needs animate loop integration.

### 3. FPV (new)
Camera placed *at* the drone position, oriented to match what the drone's camera saw.

**Orientation logic:**
- **Gimbal-locked:** When `gimbalPitch` and `gimbalYaw` exist on flight points, camera orientation matches the drone's gimbal. Applied via Euler angles (yaw from `gimbalYaw`, pitch from `gimbalPitch`, roll assumed 0).
- **Heading-forward fallback:** When gimbal data is absent (common in KML/SRT files), camera faces the direction of travel with a -15° downward pitch (natural aerial perspective). For sparse paths (<50 points, typical of KML waypoint files), direction is computed using Catmull-Rom interpolation across neighboring segments rather than simple point-to-point, to avoid abrupt heading changes.
- **Smoothing:** Orientation interpolated via spherical lerp (slerp) with a tuned default factor (~0.85 per frame) to tame noisy gimbal telemetry. No UI slider — just a well-tuned constant.

**Gimbal data availability by format:**
| Format | Position | Altitude | Speed | Heading | Gimbal Pitch/Yaw | Timestamp |
|--------|----------|----------|-------|---------|-------------------|-----------|
| DJI CSV | Yes | Yes | Yes | Yes | Yes | Yes |
| DJI TXT | Yes | Yes | Yes | Yes | Likely | Yes |
| KML/KMZ | Yes | Yes | No | No | No | Yes |
| SRT | Yes | Yes | No | No | No | Yes |

**Free-look:** In FPV mode, the user can click-drag to look around freely (mouse-look, similar to fly-controls). A "Re-center" button (or double-click) smoothly animates back to the gimbal/heading orientation. Free-look state is tracked as a quaternion offset from the base orientation.

## Transitions

**Smooth fly-in/fly-out (~1 second):**
- Entering Chase or FPV mode: camera smoothly animates from current position/orientation to the target position/orientation using position lerp + quaternion slerp over ~1s.
- Exiting (Stop or switching to Orbit): camera smoothly animates back to the position/orientation it had before entering follow mode.
- Orbit controls are disabled during Chase/FPV and re-enabled on exit. This is done in `main.ts` (sets `controls.enabled = false/true`) in response to camera mode changes, since `FlightPathManager` does not have access to OrbitControls.
- Previous camera state (position + quaternion + controls target) is saved on mode entry and restored on exit.

**Transition state machine:**
- A `_transitioning` flag on `FlightPathManager` is set during fly-in/fly-out animations.
- While `_transitioning` is true, `updatePlayback()` still advances the playback marker position and time, but **skips camera updates** — the transition animation drives the camera exclusively.
- When the transition completes (~1s), `_transitioning` is cleared and normal per-frame camera updates resume.

## Picture-in-Picture (PiP)

**Inset FPV window** for simultaneous orbit + first-person views:

- Available when view mode is Orbit. Toggle in the flight path panel (off by default).
- Renders in the bottom-right corner of the 3D viewport, ~25% of viewport width, 16:9 aspect ratio.
- Uses a **second `PerspectiveCamera`** tracking the drone position/orientation (same logic as FPV mode).
- Rendered via `renderer.setViewport()` / `renderer.setScissor()` on the same WebGL renderer — no second WebGL context.
- **Full scene rendering including splats.** Since PiP is off by default, the performance cost is opt-in. See "PiP rendering" under Key Implementation Details for Spark.js considerations.
- Small border + "FPV" label — a CSS-positioned `<div>` overlay on top of the canvas corner (the PiP viewport itself is rendered on the main canvas via viewport/scissor; the label/border is a separate DOM element).
- Fixed position (not draggable). Click-to-expand (swap views) is out of scope.

## Playback Controls (Flight Path Panel)

All controls in the existing flight path settings panel in `editor/index.html`. New sections added below existing trim/color/marker controls.

### Playback Section
- **Play / Pause** — single toggle button with icon swap
- **Stop** — resets to start, exits FPV/Chase, restores previous camera position
- **Progress scrubber** — `<input type="range">` showing current position, draggable for seeking
- **Time display** — elapsed / total as `MM:SS`
- **Speed selector** — button group or dropdown: 0.5x, 1x, 2x, 5x, 10x

### Camera Section
- **View mode** — three radio-style buttons: Orbit, Chase, FPV
- **Re-center button** — visible only in FPV mode, smoothly returns free-look to gimbal/heading orientation
- **PiP toggle** — checkbox, enabled only when view mode is Orbit. Off by default.

### Telemetry Readout
- Visible during playback
- Displays current altitude, speed, heading — small text row updating each frame
- Data sourced from the interpolated flight point (same data the hover tooltip already computes)

## Architecture

### Files Modified

**`src/modules/flight-path.ts`** (FlightPathManager) — primary implementation:
- New `CameraMode` type: `'orbit' | 'chase' | 'fpv'`
- `setCameraMode(mode)` — sets mode, triggers fly-in/fly-out transition
- FPV camera positioning: place camera at interpolated drone position
- FPV orientation: gimbal-locked or heading-forward, with slerp smoothing
- Free-look state: quaternion offset tracking, re-center animation
- Smooth transitions: save/restore camera state, animate position + quaternion over ~1s
- PiP camera: second `PerspectiveCamera`, updated each frame in `updatePlayback()`
- `renderPiP(renderer, scene)` method for main loop to call when PiP is active
- Telemetry data getter: expose current interpolated point's alt/speed/heading
- Refactor `_followCamera` boolean into `_cameraMode` — chase is now `_cameraMode === 'chase'`

**`src/main.ts`** — wiring:
- Replace the hardcoded `1/60` deltaTime in the existing `updatePlayback()` call with `THREE.Clock.getDelta()` for accurate frame timing across all display refresh rates
- Wire new panel UI elements to FlightPathManager methods
- On camera mode change: set `controls.enabled = false` for Chase/FPV, `controls.enabled = true` for Orbit (FlightPathManager does not have access to OrbitControls)
- Call `flightPathManager.renderPiP(renderer, scene)` after ALL per-frame updates (after annotation/measurement marker updates) when PiP active
- Manage PiP label/border overlay DOM element lifecycle
- Disable/enable orbit controls based on camera mode

**`src/editor/index.html`** — new DOM elements in flight path panel:
- Playback controls: play/pause, stop, scrubber, time display, speed selector
- Camera controls: mode selector (orbit/chase/FPV), re-center button, PiP toggle
- Telemetry readout row
- PiP overlay element (hidden by default)

**`src/types.ts`** — extend if needed:
- Camera mode type export
- Any new properties on deps interfaces for FPV state

### No New Modules
All logic lives in `flight-path.ts` (camera/playback) and `main.ts` (wiring). No new module files.

### Key Implementation Details

**Prerequisite — fix deltaTime in animate loop:**
`updatePlayback(deltaTime)` is already called from the animate loop, but with a hardcoded `1/60` delta. This is inaccurate on 120Hz/144Hz displays and during frame drops. Replace with `THREE.Clock.getDelta()` (Three.js Clock is already available) for real frame timing.

**Backward compatibility:**
The private `_followCamera` boolean becomes `_cameraMode === 'chase'`. All existing public API (`setFollowCamera()`, `get followCamera`) can be preserved as thin wrappers if needed, though they're only used internally.

**PiP rendering:**
Uses viewport/scissor on the existing renderer. Render order: main scene first (full viewport), then PiP (restricted viewport/scissor in bottom-right). The PiP camera copies FPV orientation logic but is independent of the main camera.

- `renderPiP()` must save and restore the renderer's viewport, scissor rect, and scissor test state. Called after ALL per-frame updates (annotation markers, measurements) to avoid corrupting projection-based DOM position calculations.
- PiP always renders without post-processing effects. When post-processing is active, `renderPiP()` calls `renderer.render(scene, pipCamera)` directly (not through the post-processing pipeline).
- **Spark.js double-render risk:** SparkRenderer hooks into Three.js's render pipeline and runs its own GPU sort pass per `renderer.render()` call. Rendering twice per frame (main + PiP) doubles the sort cost. For scenes at the LOD budget (500K–1.5M splats), this may cause frame drops. Mitigations: (1) PiP is off by default; (2) PiP could use a lower `lodSplatCount` budget (e.g., half the main view's budget); (3) if SparkRenderer's internal state conflicts with the second camera (sort buffer caching), fall back to hiding splats during the PiP pass. **A prototype spike should verify SparkRenderer handles two render calls with different cameras in the same frame before committing to full-splat PiP.**

**Free-look mechanics:**
- `pointerdown` + `pointermove` on the renderer canvas during FPV mode applies yaw/pitch delta to a quaternion offset
- Free-look pointer events are only captured when FPV mode is active and orbit controls are disabled. Events use `stopPropagation()` to prevent conflicts with annotation placement, measurement, and transform gizmo handlers that also listen on the canvas.
- The offset is composed with the base gimbal/heading quaternion each frame
- Re-center smoothly slerps the offset back to identity over ~0.5s
- No pointer lock (unlike fly-controls) — simple drag interaction

**Playback end behavior:**
When playback reaches the end naturally (not user-initiated stop) while in Chase or FPV mode, the camera freezes at the last position. The user can then manually stop (which triggers the fly-out transition back to their saved orbit view) or seek/restart. This avoids a jarring auto-transition.

**UI visibility:**
All playback, camera mode, PiP, and telemetry controls are disabled (or the entire playback section is hidden) when no flight paths are loaded. Controls become enabled when a flight path is imported.

## Out of Scope

- Kiosk theme integration (deferred)
- Draggable/resizable PiP window
- Click-to-expand PiP (swap main and PiP views)
- UI slider for smoothing factor
- Roll axis from flight data
- VR/stereoscopic rendering
