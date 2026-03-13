# Flight Path Trim — Design Spec

**Date:** 2026-03-10
**Status:** Approved

## Problem

When a drone takes off far from the scan subject, the flight path shows a long line from the takeoff point to the survey area. Users need to trim the beginning and/or end of flight paths to show only the relevant portion over the subject.

## Solution

A non-destructive dual-handle range slider for trimming flight paths. The original point data is always preserved; only the visible range changes.

## Data Model

Add two optional fields to `FlightPathData` in `types.ts`:

```ts
trimStart?: number;  // index into points[] — first visible point
trimEnd?: number;    // index into points[] — last visible point (inclusive)
```

A helper `getTrimmedPoints(data)` returns `data.points.slice(trimStart ?? 0, (trimEnd ?? data.points.length - 1) + 1)`. All rendering, stats, playback, and export use this helper instead of raw `points[]`.

## UI

Each path row in `#fp-path-list` gets a slim dual-handle trim bar below the filename. The bar shows:
- Colored fill for the active (visible) portion
- Muted fill for trimmed (hidden) portions
- Two drag handles for start/end

A "Reset" button appears when any trim is active.

The trim bars are dynamically created per-path — no new static HTML in `editor/index.html`.

## Affected Files

### flight-path.ts
- New `getTrimmedPoints(data)` helper
- `renderPath()` and `recolorAll()` use trimmed points for line/markers/endpoints/direction
- `buildEndpoints()` uses first/last of trimmed range
- Playback respects trim bounds (start at trim-start time, end at trim-end time)
- `getStats()` computes on trimmed data
- New public methods: `setTrim(pathId, startIdx, endIdx)`, `resetTrim(pathId)`
- `setTrim` triggers re-render of the affected path
- Path list UI rendering includes trim bar per path

### types.ts
- Add `trimStart?: number` and `trimEnd?: number` to `FlightPathData`

### event-wiring.ts
- Wire trim slider drag events and reset button (if wiring is done here vs. flight-path.ts)

### archive-pipeline.ts / export-controller.ts
- Serialize `trimStart`/`trimEnd` in manifest metadata under the flight path entry
- Restore trim values on archive load

## Not Affected

- **Kiosk mode** — renders whatever trim range is in the archive, no editing UI
- **Flight parsers** — trim is post-parse
- **Original points array** — never mutated

## Edge Cases

- Trim handles can't cross each other; minimum 2 visible points
- Paths with <10 points: trim slider works with coarser granularity
- Playback: starts at trimmed-start time, ends at trimmed-end time
- Stats: "Points" shows trimmed count with original, e.g. "1,204 (of 3,891)"
- Scrubber range maps to trimmed time window

## Non-destructive Guarantee

The `points[]` array on `FlightPathData` is never modified by trim operations. Trim state is stored as index references. Resetting trim restores full visibility immediately.
