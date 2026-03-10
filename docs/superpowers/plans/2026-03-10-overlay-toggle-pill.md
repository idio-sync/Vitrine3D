# Overlay Toggle Pill Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new viewport pill that independently toggles visibility of SfM Cameras and Flight Paths overlay data.

**Architecture:** New `.vp-overlay-pill` container in the viewport toolbar row, reusing `.vp-pill-btn` styling. A new `updateOverlayPill()` function in `ui-controller.ts` manages button visibility. Toggle click handlers in `event-wiring.ts` flip `.active` class and call `colmapGroup.visible` / `flightPathManager.setVisible()`. `main.ts` calls `updateOverlayPill()` wherever it sets `state.flightPathLoaded` or `state.colmapLoaded`.

**Tech Stack:** TypeScript, Three.js, DOM manipulation

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/editor/index.html` | Modify (line ~276) | Add overlay pill HTML after display pill |
| `src/styles.css` | Modify (line ~261) | Add `.vp-overlay-pill` container style |
| `src/modules/ui-controller.ts` | Modify (after line 130) | Add `updateOverlayPill()` function, hide overlay pill when library active |
| `src/modules/event-wiring.ts` | Modify | Add overlay toggle click handlers |
| `src/main.ts` | Modify | Call `updateOverlayPill()` at load sites, wire toggle deps |

---

## Chunk 1: Implementation

### Task 1: Add HTML structure

**Files:**
- Modify: `src/editor/index.html:276` (after `vp-display-pill` closing div)

- [ ] **Step 1: Add overlay pill HTML**

Inside the `.vp-display-row` div, after the `#vp-display-pill` div (line 276), add:

```html
                <div class="vp-overlay-pill hidden" id="vp-overlay-pill">
                    <button class="vp-pill-btn active" id="btn-overlay-sfm" style="display:none">SfM Cameras</button>
                    <button class="vp-pill-btn active" id="btn-overlay-flightpath" style="display:none">Flight Paths</button>
                </div>
```

The container starts `.hidden` and individual buttons start `display:none`. Both use `.active` class because overlays start visible when their data loads.

- [ ] **Step 2: Verify HTML is well-formed**

Open `src/editor/index.html` and confirm the new div is inside `.vp-display-row`, after `#vp-display-pill` and before the closing `</div>` of `.vp-display-row` (line 277).

---

### Task 2: Add CSS for overlay pill container

**Files:**
- Modify: `src/styles.css:261` (after `#vp-display-pill` block)

- [ ] **Step 1: Add overlay pill styles**

After the `#vp-display-pill` rule block (line 261), add:

```css
#vp-overlay-pill {
    display: flex;
    background: var(--bg-deep);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    overflow: hidden;
}
```

This matches the existing `#vp-display-pill` styling exactly. The `.vp-pill-btn` styles (lines 263-285) are already shared and will apply to buttons inside this container.

- [ ] **Step 2: Commit HTML + CSS**

```bash
git add src/editor/index.html src/styles.css
git commit -m "feat(ui): add overlay toggle pill HTML and CSS structure"
```

---

### Task 3: Add `updateOverlayPill()` to ui-controller.ts

**Files:**
- Modify: `src/modules/ui-controller.ts:130` (after `updateDisplayPill`)

- [ ] **Step 1: Add the function**

After `updateDisplayPill()` (line 130), add:

```typescript
/**
 * Show/hide overlay toggle pill buttons based on which overlay types are loaded.
 * Each button appears individually when its data is present and starts active (visible).
 */
export function updateOverlayPill(loaded: { sfm: boolean; flightpath: boolean }): void {
    const show = (id: string, visible: boolean) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    };

    show('btn-overlay-sfm', loaded.sfm);
    show('btn-overlay-flightpath', loaded.flightpath);

    // Show container only if at least one overlay type is loaded
    const pill = document.getElementById('vp-overlay-pill');
    if (pill) {
        const anyLoaded = loaded.sfm || loaded.flightpath;
        pill.classList.toggle('hidden', !anyLoaded);
    }
}
```

- [ ] **Step 2: Hide overlay pill when library overlay is active**

In the `activateTool()` function (around line 265-266), there's already code hiding `vp-display-pill` when library is active. Add the same for the overlay pill. After the line:

```typescript
    const displayPill = document.getElementById('vp-display-pill');
    if (displayPill) displayPill.style.display = isLibrary ? 'none' : '';
```

Add:

```typescript
    const overlayPill = document.getElementById('vp-overlay-pill');
    if (overlayPill) overlayPill.style.display = isLibrary ? 'none' : '';
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/ui-controller.ts
git commit -m "feat(ui): add updateOverlayPill() and library-active hiding"
```

---

### Task 4: Add toggle click handlers in event-wiring.ts

**Files:**
- Modify: `src/modules/event-wiring.ts`

The `EventWiringDeps` interface (in `src/types.ts`) needs overlay toggle functions. But following the existing pattern (event-wiring calls into deps functions), the simplest approach is to add deps for toggling.

- [ ] **Step 1: Add overlay toggle handlers**

In `setupUIEvents()`, find the section with display mode button handlers (around line 100-105 where `btn-splat`, `btn-model` etc. are wired). After those, add:

```typescript
    // ─── Overlay toggle pill ────────────────────────────────
    addListener('btn-overlay-sfm', 'click', () => {
        const btn = document.getElementById('btn-overlay-sfm');
        if (!btn) return;
        const nowActive = !btn.classList.contains('active');
        btn.classList.toggle('active', nowActive);
        if (deps.overlay?.toggleSfm) deps.overlay.toggleSfm(nowActive);
    });

    addListener('btn-overlay-flightpath', 'click', () => {
        const btn = document.getElementById('btn-overlay-flightpath');
        if (!btn) return;
        const nowActive = !btn.classList.contains('active');
        btn.classList.toggle('active', nowActive);
        if (deps.overlay?.toggleFlightPath) deps.overlay.toggleFlightPath(nowActive);
    });
```

- [ ] **Step 2: Add overlay to EventWiringDeps**

In `src/types.ts`, find the `EventWiringDeps` interface. Add an optional `overlay` property:

```typescript
    overlay?: {
        toggleSfm: (visible: boolean) => void;
        toggleFlightPath: (visible: boolean) => void;
    };
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/event-wiring.ts src/types.ts
git commit -m "feat(ui): wire overlay toggle pill click handlers"
```

---

### Task 5: Integrate in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Import `updateOverlayPill`**

In the import block from `ui-controller.js` (around line 59), add `updateOverlayPill` to the existing import:

```typescript
    updateDisplayPill,
    updateOverlayPill,
    updateTransformPaneSelection
```

- [ ] **Step 2: Add overlay deps to `createEventWiringDeps()`**

Find the function that creates the `EventWiringDeps` object (search for `createEventWiringDeps` or where `setupUIEvents` is called with a deps object). Add the `overlay` property:

```typescript
        overlay: {
            toggleSfm: (visible: boolean) => {
                const colmapGroup = sceneManager?.colmapGroup;
                if (colmapGroup) colmapGroup.visible = visible;
            },
            toggleFlightPath: (visible: boolean) => {
                if (flightPathManager) flightPathManager.setVisible(visible);
            },
        },
```

- [ ] **Step 3: Call `updateOverlayPill()` at all load/unload sites**

There are 5 sites in `main.ts` where `state.flightPathLoaded` or `state.colmapLoaded` is set. After each, add a call to `updateOverlayPill()`.

The call is always the same:

```typescript
updateOverlayPill({ sfm: state.colmapLoaded, flightpath: state.flightPathLoaded });
```

Add this call after each of these existing lines:

1. **Line ~686** — after `state.flightPathLoaded = true;` (flight path import via file input)
2. **Line ~797** — after `state.colmapLoaded = true;` (colmap load from buffers)
3. **Line ~1265** — after `state.flightPathLoaded = true;` (flight path from archive)
4. **Line ~1290** — after `state.flightPathLoaded = true;` (flight path from DJI txt)
5. **Line ~1913** — after `state.flightPathLoaded = flightPathManager!.hasData;` (flight path removal)

Also add it in `archive-pipeline.ts`:

6. **`src/modules/archive-pipeline.ts:521`** — after `state.flightPathLoaded = true;`

For archive-pipeline.ts, import `updateOverlayPill` from `ui-controller.js` and call it. Check if `state.colmapLoaded` is set in archive-pipeline.ts too and add the call there as well.

- [ ] **Step 4: Ensure overlay pill reflects initial state after archive load**

In the `updateVisibility()` function (line ~1804), add the overlay pill update alongside `updateDisplayPill`:

```typescript
function updateVisibility() {
    updateVisibilityHandler(state.displayMode, splatMesh, modelGroup, pointcloudGroup, stlGroup);
    updateDisplayPill({
        splat: state.splatLoaded,
        model: state.modelLoaded,
        pointcloud: state.pointcloudLoaded,
        stl: state.stlLoaded
    });
    updateOverlayPill({ sfm: state.colmapLoaded, flightpath: state.flightPathLoaded });
    updateObjectSelectButtons();
}
```

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/modules/archive-pipeline.ts
git commit -m "feat(ui): integrate overlay toggle pill with load/unload lifecycle"
```

---

### Task 6: Build verification

- [ ] **Step 1: Run build**

```bash
npm run build
```

Expected: Clean build with no TypeScript errors.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: 0 errors (warnings OK).

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: All existing tests pass (this change doesn't affect test-covered code paths).

- [ ] **Step 4: Manual verification**

Open `npm run dev` and load the editor:
1. Confirm the overlay pill is NOT visible when no overlay data is loaded
2. Import a flight path file — confirm "Flight Paths" button appears in the pill, active (highlighted)
3. Click "Flight Paths" — confirm the flight path disappears from the 3D scene and button becomes inactive
4. Click again — confirm it reappears and button becomes active
5. Load SfM cameras — confirm "SfM Cameras" button appears, also active
6. Toggle each independently — confirm all 4 combinations (both on, both off, one on/one off) work
7. Remove a flight path — confirm the button disappears; if no overlays remain, the pill hides

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(ui): overlay toggle pill adjustments from manual testing"
```
