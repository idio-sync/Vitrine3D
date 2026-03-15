# Measurement Calibration & Kiosk Units

**Date:** 2026-03-04
**Status:** Approved

## Problem

In kiosk mode, the measure tool requires users to manually define units ("1 unit = X meters") before measurements are meaningful. This is confusing for clients who don't know the scene's scale. The editor user knows the real-world dimensions but has no way to embed that knowledge into the archive.

## Solution

1. Add a reference-based calibration workflow to the editor
2. Save calibration (scale factor + unit) in the archive manifest
3. Auto-apply calibration in kiosk mode with a unit toggle on measurement labels

## Manifest Schema

Two new optional fields in `viewer_settings`:

```json
{
  "viewer_settings": {
    "measurement_scale": 0.3048,
    "measurement_unit": "ft",
    ...
  }
}
```

- `measurement_scale` (number): multiplier from scene units to real-world units in the specified unit. Default `1`.
- `measurement_unit` (string): `"ft"` | `"in"` | `"m"` | `"cm"` | `"mm"`. Default `"m"`.

## Editor: Reference Calibration

The measure pane is restructured into three sections:

### Calibrate (primary, top)
- "Calibrate Scale" button enters a special two-click mode
- After two points are clicked, inline UI appears:
  - Raw scene distance (read-only)
  - "Real distance" number input + unit dropdown (ft, in, m, cm, mm — imperial first)
  - "Apply" button — computes `scale = realDistance / rawDistance`
- Status line: "Calibrated: 1 unit = 0.3048 ft" or "Not calibrated"

### Advanced (collapsed)
- Manual "1 unit = X [unit]" input — existing behavior, fallback for power users

### Measurements (same as today)
- "Start Measuring" button, "Clear All"

## MeasurementSystem API Changes

New methods:
- `setBaseScale(value, unit)` — stores calibrated scale from archive or calibration flow
- `setDisplayUnit(unit)` — for kiosk unit toggle
- `calibrate(rawDistance, realDistance, unit)` — convenience: computes and applies scale
- `getScale()` / `getUnit()` — getters for archive saving

Internal conversion table (all relative to meters):
- `m: 1`, `cm: 100`, `mm: 1000`, `ft: 3.28084`, `in: 39.3701`

Display formula:
```
displayDistance = rawDistance × baseScale × conversionFactor(baseUnit → displayUnit)
```

## Kiosk: Unit Badge on Labels

Each measurement label renders as `[ 2.45 m ▾ ]`. Clicking the dropdown shows all 5 units (ft, in, m, cm, mm — imperial first). Selecting a unit converts all measurement labels globally.

- When archive has calibration data: scale panel is hidden, unit badge is the only control
- When archive lacks calibration data (old archives): existing scale panel shown as fallback

## Archive Integration

- **Save** (`archive-creator.ts`): read `measurementSystem.getScale()` / `getUnit()` → write to `viewer_settings.measurement_scale` / `measurement_unit`
- **Load editor** (`main.ts`): read manifest → `measurementSystem.setBaseScale()` → populate calibration status + advanced inputs
- **Load kiosk** (`kiosk-main.ts`): read manifest → `measurementSystem.setBaseScale()` → hide scale panel

## Files Changed

| File | Change |
|------|--------|
| `src/modules/measurement-system.ts` | Calibration methods, unit conversion, display unit toggle |
| `src/modules/archive-creator.ts` | Save measurement_scale/unit to manifest viewer_settings |
| `src/modules/kiosk-main.ts` | Read manifest scale on load, hide scale panel, wire unit toggle |
| `src/main.ts` | Wire calibration UI, read/write scale on archive load/save |
| `src/editor/index.html` | Restructure measure pane (calibrate + advanced + measurements) |
| `src/index.html` | Unit dropdown markup near measure labels |
| `src/styles.css` | Calibration inline UI styles |
| `src/kiosk.css` | Unit badge and dropdown styles |

## Backward Compatibility

- Archives without the new fields behave exactly as today (1 unit = 1m, scale panel visible)
- Fields are optional in the TypeScript manifest type — no breaking change
