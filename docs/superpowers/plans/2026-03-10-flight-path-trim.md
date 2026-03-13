# Flight Path Trim Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-destructive trim (start/end range) to flight paths so users can hide takeoff/landing segments.

**Architecture:** Add `trimStart`/`trimEnd` index fields to `FlightPathData`. A `getTrimmedPoints()` helper returns the visible slice. All rendering, stats, and playback use trimmed points. A dual-handle slider per path row in the UI controls the trim range. Trim values persist in the archive via the existing `_flight_meta` field.

**Tech Stack:** TypeScript, Three.js (existing), inline DOM creation (matches existing path list pattern in `main.ts`).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts:207-215` | Modify | Add `trimStart?` and `trimEnd?` to `FlightPathData` |
| `src/modules/flight-path.ts` | Modify | `getTrimmedPoints()` helper, update rendering/stats/playback to use it, add `setTrim()`/`resetTrim()` public API |
| `src/main.ts:1872-1943` | Modify | Add trim slider UI per path row in `updateFlightPathUI()`, wire events |
| `src/modules/export-controller.ts:450-458` | Modify | Pass trim values via `flightMeta` when exporting |
| `src/main.ts:660-690` | Modify | Restore trim values from archive manifest entries after rendering flight paths |
| `src/styles.css` | Modify | Add CSS for `.fp-trim-bar` and handles |

---

## Task 1: Add trim fields to FlightPathData

**Files:**
- Modify: `src/types.ts:207-215`

- [ ] **Step 1: Add trim fields to the interface**

In `src/types.ts`, add two optional fields to `FlightPathData` after `maxAltM`:

```ts
trimStart?: number;  // index into points[] — first visible point
trimEnd?: number;    // index into points[] — last visible point (inclusive)
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no new errors (fields are optional, so all existing code remains valid).

- [ ] **Step 3: Commit**

```
feat(types): add trimStart/trimEnd to FlightPathData
```

---

## Task 2: Add getTrimmedPoints helper and setTrim/resetTrim API

**Files:**
- Modify: `src/modules/flight-path.ts`

- [ ] **Step 1: Add the getTrimmedPoints helper**

Add this private method to `FlightPathManager`, after the constructor (around line 156):

```ts
/** Return the visible slice of a path's points, respecting trim bounds. */
private getTrimmedPoints(data: FlightPathData): FlightPoint[] {
    const start = data.trimStart ?? 0;
    const end = data.trimEnd ?? (data.points.length - 1);
    return data.points.slice(start, end + 1);
}
```

- [ ] **Step 2: Add setTrim public method**

Add after the `deletePath()` method (around line 558):

```ts
/** Set trim range for a path. Indices are clamped and must leave at least 2 points visible. */
setTrim(pathId: string, startIdx: number, endIdx: number): void {
    const data = this.paths.find(p => p.id === pathId);
    if (!data) return;

    // Clamp and validate
    const maxIdx = data.points.length - 1;
    const s = Math.max(0, Math.min(startIdx, maxIdx));
    const e = Math.max(s + 1, Math.min(endIdx, maxIdx)); // minimum 2 points

    data.trimStart = s === 0 ? undefined : s;
    data.trimEnd = e === maxIdx ? undefined : e;

    this.reRenderPath(pathId);
    log.info(`Trim set on ${pathId}: [${s}..${e}] of ${data.points.length} points`);
}

/** Reset trim for a path (show all points). */
resetTrim(pathId: string): void {
    const data = this.paths.find(p => p.id === pathId);
    if (!data) return;
    data.trimStart = undefined;
    data.trimEnd = undefined;
    this.reRenderPath(pathId);
    log.info(`Trim reset on ${pathId}`);
}
```

- [ ] **Step 3: Add reRenderPath helper**

Add a private method that removes and re-renders a single path (unlike `recolorAll` which does all of them):

```ts
/** Remove and re-render a single path. */
private reRenderPath(pathId: string): void {
    const data = this.paths.find(p => p.id === pathId);
    const entry = this.meshes.get(pathId);
    if (!data || !entry) return;

    // Dispose old meshes
    entry.line.geometry.dispose();
    (entry.line.material as THREE.Material).dispose();
    entry.markers.geometry.dispose();
    (entry.markers.material as THREE.Material).dispose();
    this.group.remove(entry.line);
    this.group.remove(entry.markers);

    entry.endpointGroup.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) { mesh.geometry.dispose(); (mesh.material as THREE.Material)?.dispose(); }
    });
    this.group.remove(entry.endpointGroup);

    entry.directionGroup.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) { mesh.geometry.dispose(); (mesh.material as THREE.Material)?.dispose(); }
    });
    this.group.remove(entry.directionGroup);

    this.meshes.delete(pathId);

    // Re-render with current trim
    this.renderPath(data);

    // Restore visibility
    const visible = this._pathVisibility.get(pathId) !== false;
    const newEntry = this.meshes.get(pathId);
    if (newEntry && !visible) {
        newEntry.line.visible = false;
        newEntry.markers.visible = false;
        newEntry.endpointGroup.visible = false;
        newEntry.directionGroup.visible = false;
    }
}
```

- [ ] **Step 4: Update renderPath to use trimmed points**

In `renderPath()` (line 246), change:

```ts
// Before:
const renderPoints = subsample(data.points, FLIGHT_LOG.MAX_RENDER_POINTS);

// After:
const trimmedPoints = this.getTrimmedPoints(data);
const renderPoints = subsample(trimmedPoints, FLIGHT_LOG.MAX_RENDER_POINTS);
```

- [ ] **Step 5: Update getStats to use trimmed points**

In `getStats()` (line 568), change the loop to use trimmed points:

```ts
// Before:
for (const p of visible) {
    totalDuration += p.durationS;
    totalDistanceM += computeGpsDistanceM(p.points);
    if (p.maxAltM > maxAlt) maxAlt = p.maxAltM;
    for (const pt of p.points) {

// After:
for (const p of visible) {
    const trimmed = this.getTrimmedPoints(p);
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    totalDuration += Math.round((last.timestamp - first.timestamp) / 1000);
    totalDistanceM += computeGpsDistanceM(trimmed);
    const trimMaxAlt = Math.max(...trimmed.map(pt => pt.alt));
    if (trimMaxAlt > maxAlt) maxAlt = trimMaxAlt;
    for (const pt of trimmed) {
```

Also update the points count to show trimmed vs total. Change the return statement:

```ts
// Before:
points: totalPoints.toLocaleString(),

// After:
points: totalTrimmedPoints < totalOriginalPoints
    ? `${totalTrimmedPoints.toLocaleString()} (of ${totalOriginalPoints.toLocaleString()})`
    : totalOriginalPoints.toLocaleString(),
```

You'll need to track both counts in the loop:

```ts
let totalOriginalPoints = 0;
let totalTrimmedPoints = 0;
// In the loop:
totalOriginalPoints += p.points.length;
totalTrimmedPoints += trimmed.length;
```

- [ ] **Step 6: Update playback to respect trim bounds**

In `startPlayback()` (line 617), after finding `pathData`, if trim is active, clamp `_playbackTime` to the trimmed time window:

```ts
// After: if (!pathData || pathData.points.length < 2) return;
const trimmed = this.getTrimmedPoints(pathData);
if (trimmed.length < 2) return;
// Clamp playback to trimmed time window
const trimStartMs = trimmed[0].timestamp;
if (this._playbackTime < trimStartMs) {
    this._playbackTime = trimStartMs;
}
```

In `updatePlayback()` (line 697), clamp the total time to trimmed range:

```ts
// After finding pathData:
const trimmed = this.getTrimmedPoints(pathData);
const trimStartMs = trimmed[0].timestamp;
const trimEndMs = trimmed[trimmed.length - 1].timestamp;
const totalMs = trimEndMs - trimStartMs;

this._playbackTime += deltaTime * 1000 * this._playbackSpeed;
// Clamp to trim range
if (this._playbackTime < trimStartMs) this._playbackTime = trimStartMs;
if (this._playbackTime >= trimEndMs) {
    this._playbackTime = trimEndMs;
    this._playing = false;
    this._onPlaybackEnd?.();
}
```

In `updatePlaybackPosition()`, the interpolation already searches `points` by timestamp so it will work correctly with the full array — the playback time is just clamped to the trimmed range.

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```
feat(flight-path): add non-destructive trim support with getTrimmedPoints helper
```

---

## Task 3: Add trim slider CSS

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add trim bar styles**

Add after the existing `.trim-timeline:hover` rule (around line 1740):

```css
/* Flight path trim bar */
.fp-trim-bar {
    position: relative;
    height: 16px;
    background: #1a1a1a;
    border-radius: 3px;
    margin: 4px 0 2px;
    cursor: pointer;
    user-select: none;
}
.fp-trim-range {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(79, 195, 247, 0.25);
    border-radius: 2px;
}
.fp-trim-handle {
    position: absolute;
    top: -1px;
    bottom: -1px;
    width: 6px;
    background: #4FC3F7;
    border-radius: 2px;
    cursor: ew-resize;
    z-index: 1;
}
.fp-trim-handle:hover,
.fp-trim-handle.dragging {
    background: #81D4FA;
}
.fp-trim-handle-start { left: 0; }
.fp-trim-handle-end { right: 0; }
.fp-trim-reset {
    font-size: 9px;
    color: var(--text-muted);
    cursor: pointer;
    margin-left: auto;
}
.fp-trim-reset:hover {
    color: var(--text-secondary);
}
```

- [ ] **Step 2: Commit**

```
style: add flight path trim bar CSS
```

---

## Task 4: Add trim UI to path list rows

**Files:**
- Modify: `src/main.ts:1898-1943` (the `updateFlightPathUI` path list loop)

- [ ] **Step 1: Add trim bar creation after each path row**

In the `updateFlightPathUI()` function, after `listEl.appendChild(row)` (line 1941), add trim bar creation for each path. The full replacement of the path list loop (lines 1900–1943):

```ts
if (listEl) {
    listEl.innerHTML = '';
    for (const p of paths) {
        // --- Path row (visibility checkbox + name + delete) ---
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:3px 0; font-size:11px;';

        const vis = document.createElement('input');
        vis.type = 'checkbox';
        vis.checked = flightPathManager.isPathVisible(p.id);
        vis.title = 'Toggle visibility';
        vis.style.cssText = 'margin:0; flex-shrink:0;';
        vis.addEventListener('change', () => {
            flightPathManager!.setPathVisible(p.id, vis.checked);
        });

        const name = document.createElement('span');
        name.textContent = p.fileName;
        name.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary);';
        name.title = `${p.fileName} — ${p.points.length} pts, ${p.durationS}s`;

        // Reset trim link (shown only when trim is active)
        const isTrimmed = p.trimStart !== undefined || p.trimEnd !== undefined;
        const resetLink = document.createElement('span');
        resetLink.className = 'fp-trim-reset';
        resetLink.textContent = 'reset';
        resetLink.title = 'Reset trim to full path';
        resetLink.style.display = isTrimmed ? '' : 'none';
        resetLink.addEventListener('click', () => {
            flightPathManager!.resetTrim(p.id);
            updateFlightPathUI();
        });

        const del = document.createElement('button');
        del.textContent = '\u00D7';
        del.className = 'prop-btn danger small';
        del.style.cssText = 'padding:0 5px; min-width:0; line-height:1.4; font-size:13px;';
        del.title = 'Remove path';
        del.addEventListener('click', () => {
            flightPathManager!.deletePath(p.id);
            const fpStore = getStore();
            const idx = fpStore.flightPathBlobs.findIndex((b: any) => b.fileName === p.fileName);
            if (idx >= 0) fpStore.flightPathBlobs.splice(idx, 1);
            state.flightPathLoaded = flightPathManager!.hasData;
            updateObjectSelectButtons();
            updateFlightPathUI();
            updateOverlayPill({ sfm: state.colmapLoaded, flightpath: state.flightPathLoaded });
        });

        row.appendChild(vis);
        row.appendChild(name);
        row.appendChild(resetLink);
        row.appendChild(del);
        listEl.appendChild(row);

        // --- Trim bar ---
        const totalPts = p.points.length;
        if (totalPts > 2) {
            const trimStart = p.trimStart ?? 0;
            const trimEnd = p.trimEnd ?? (totalPts - 1);

            const bar = document.createElement('div');
            bar.className = 'fp-trim-bar';

            const range = document.createElement('div');
            range.className = 'fp-trim-range';

            const handleStart = document.createElement('div');
            handleStart.className = 'fp-trim-handle fp-trim-handle-start';

            const handleEnd = document.createElement('div');
            handleEnd.className = 'fp-trim-handle fp-trim-handle-end';

            function updateBarPositions(): void {
                const startPct = (trimStart / (totalPts - 1)) * 100;
                const endPct = (trimEnd / (totalPts - 1)) * 100;
                range.style.left = `${startPct}%`;
                range.style.width = `${endPct - startPct}%`;
                handleStart.style.left = `${startPct}%`;
                handleEnd.style.left = `${endPct}%`;
            }
            updateBarPositions();

            bar.appendChild(range);
            bar.appendChild(handleStart);
            bar.appendChild(handleEnd);

            // Drag logic
            function setupDrag(handle: HTMLElement, isStart: boolean): void {
                let dragging = false;

                const onMove = (e: MouseEvent) => {
                    if (!dragging) return;
                    const rect = bar.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    const idx = Math.round(pct * (totalPts - 1));

                    if (isStart) {
                        const newStart = Math.min(idx, trimEnd - 1);
                        flightPathManager!.setTrim(p.id, newStart, trimEnd);
                    } else {
                        const newEnd = Math.max(idx, trimStart + 1);
                        flightPathManager!.setTrim(p.id, trimStart, newEnd);
                    }
                    updateFlightPathUI();
                };

                const onUp = () => {
                    dragging = false;
                    handle.classList.remove('dragging');
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };

                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dragging = true;
                    handle.classList.add('dragging');
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });
            }

            setupDrag(handleStart, true);
            setupDrag(handleEnd, false);

            listEl.appendChild(bar);
        }
    }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual test**

1. `npm run dev`
2. Open editor, import a flight path CSV
3. Verify trim bar appears below the path name
4. Drag start handle right — path should shorten from the beginning
5. Drag end handle left — path should shorten from the end
6. Click "reset" — path should return to full length
7. Check that stats update (points count shows "X (of Y)")
8. Check that playback respects trim bounds

- [ ] **Step 4: Commit**

```
feat(editor): add flight path trim slider UI
```

---

## Task 5: Persist trim in archives

**Files:**
- Modify: `src/modules/export-controller.ts:450-458`
- Modify: `src/main.ts:660-690`

- [ ] **Step 1: Pass trim values during export**

In `export-controller.ts`, in the flight path export loop (line 452-457), pass trim metadata via `flightMeta`. The `flightPathManager` is accessible via `sceneRefs` — but currently the export doesn't have a reference to it. Instead, we need the trim values from the paths data.

The simplest approach: look up trim values from the `FlightPathManager` via `sceneRefs`. First check if `flightPathGroup` has a reference. Actually, the export function doesn't have access to `flightPathManager`. The cleanest path is to store trim values alongside the blob store entries.

Update the export loop in `export-controller.ts` (lines 450-458):

```ts
// Add flight paths if loaded
if (state.flightPathLoaded && assets.flightPathBlobs.length > 0) {
    log.info(` Adding ${assets.flightPathBlobs.length} flight path(s)`);
    for (let i = 0; i < assets.flightPathBlobs.length; i++) {
        const fp = assets.flightPathBlobs[i];
        const position = flightPathGroup ? [flightPathGroup.position.x, flightPathGroup.position.y, flightPathGroup.position.z] : [0, 0, 0];
        const rotation = flightPathGroup ? [flightPathGroup.rotation.x, flightPathGroup.rotation.y, flightPathGroup.rotation.z] : [0, 0, 0];
        const scale = flightPathGroup ? flightPathGroup.scale.x : 1;
        const flightMeta: Record<string, unknown> = {};
        if (fp.trimStart !== undefined) flightMeta.trim_start = fp.trimStart;
        if (fp.trimEnd !== undefined) flightMeta.trim_end = fp.trimEnd;
        archiveCreator.addFlightPath(fp.blob, fp.fileName, { position, rotation, scale, flightMeta });
    }
}
```

This requires adding `trimStart?` and `trimEnd?` to the blob store entries. Update `src/types.ts` — find the `flightPathBlobs` type (line 250):

```ts
// Before:
flightPathBlobs: Array<{ blob: Blob; fileName: string }>;

// After:
flightPathBlobs: Array<{ blob: Blob; fileName: string; trimStart?: number; trimEnd?: number }>;
```

- [ ] **Step 2: Store trim values in blob store when trim changes**

In `main.ts`, in the `updateFlightPathUI()` function, after `flightPathManager!.setTrim(...)` is called (inside the drag handlers), also update the blob store. Add a helper function near `updateFlightPathUI`:

```ts
/** Sync trim values from FlightPathManager to the blob store. */
function syncTrimToStore(pathId: string): void {
    if (!flightPathManager) return;
    const pathData = flightPathManager.getPaths().find(p => p.id === pathId);
    if (!pathData) return;
    const fpStore = getStore();
    const blobEntry = fpStore.flightPathBlobs.find((b: any) => b.fileName === pathData.fileName);
    if (blobEntry) {
        blobEntry.trimStart = pathData.trimStart;
        blobEntry.trimEnd = pathData.trimEnd;
    }
}
```

Call `syncTrimToStore(p.id)` after each `flightPathManager!.setTrim(...)` and `flightPathManager!.resetTrim(...)` call in the trim UI code.

- [ ] **Step 3: Restore trim from archive on load**

In `main.ts`, in the `renderFlightPaths` callback (around line 660-690), after all paths are imported and settings applied, restore trim values from the archive manifest. The manifest entries are accessible via the `archiveLoader` in the deps. But `renderFlightPaths` is a closure in main.ts that doesn't receive manifest data.

The simplest approach: store trim values in the blob store during archive load (in `archive-pipeline.ts`), then apply them in `renderFlightPaths`.

In `src/modules/archive-pipeline.ts`, around line 507-525 where flight path blobs are loaded, read `_flight_meta` from manifest entries and store trim values:

```ts
// After building fpResults, store trim metadata:
for (let i = 0; i < flightEntries.length; i++) {
    const r = fpResults[i];
    if (r) {
        const meta = flightEntries[i].entry._flight_meta as Record<string, unknown> | undefined;
        if (meta?.trim_start !== undefined) r.trimStart = meta.trim_start as number;
        if (meta?.trim_end !== undefined) r.trimEnd = meta.trim_end as number;
        fpStore.flightPathBlobs.push(r);
    }
}
```

Replace the existing `for (const r of fpResults) { if (r) fpStore.flightPathBlobs.push(r); }` line.

Then in `main.ts` `renderFlightPaths`, after importing each path, apply trim from the blob store:

```ts
renderFlightPaths: async () => {
    if (!flightPathManager) return;
    const fpStore = getStore();
    for (const fp of fpStore.flightPathBlobs) {
        try {
            const ext = fp.fileName.split('.').pop()?.toLowerCase() || '';
            let data;
            if (ext === 'txt') {
                const buffer = await fp.blob.arrayBuffer();
                data = await flightPathManager.importBinary(buffer, fp.fileName, 'dji-txt');
            } else {
                const text = await fp.blob.text();
                data = flightPathManager.importFromText(text, fp.fileName);
            }
            // Restore trim from blob store
            if (data && (fp.trimStart !== undefined || fp.trimEnd !== undefined)) {
                flightPathManager.setTrim(data.id,
                    fp.trimStart ?? 0,
                    fp.trimEnd ?? (data.points.length - 1)
                );
            }
        } catch (err) {
            console.warn('[main] Failed to parse flight path:', fp.fileName, err);
        }
    }
    // ... rest of the existing code unchanged
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual test — round-trip**

1. Import a flight path, apply trim
2. Export archive
3. Reload the archive
4. Verify trim is preserved (path shows trimmed, stats match)

- [ ] **Step 6: Commit**

```
feat(archive): persist flight path trim range in archive manifest
```

---

## Task 6: Final verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: clean build, no errors.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: all existing tests pass (no flight-path trim tests needed — this is UI-only with no security implications).

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK).
