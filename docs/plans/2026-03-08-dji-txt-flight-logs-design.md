# DJI .txt Flight Log Support

**Date:** 2026-03-08
**Status:** Approved

## Problem

The app supports DJI CSV, KML/KMZ, and SRT flight logs but not DJI's native `.txt` flight record files — the binary logs stored on-device by DJI Fly / DJI GO 4 apps. Users with newer DJI drones (Mini 3/4 Pro, Mavic 3, Air 2S) must manually convert logs before importing.

## Approach

Use `dji-log-parser-js` — the official JS/WASM binding of the `dji-log-parser` Rust crate. Browser-compatible (since v0.5.2), handles all log versions (1–14), including AES-encrypted v13+ with a DJI API key.

### Why not alternatives?

- **Hand-rolled binary parser**: Only covers versions ≤12 (older drones). Team flies newer drones producing v13+ logs.
- **Server-side parsing**: Only works in Docker deployment, not local dev or Tauri. Adds Rust dependency to server.

## Design

### New dependency

`dji-log-parser-js` (npm, WASM). Add to `optimizeDeps.exclude` in `vite.config.ts`.

### New module: `src/modules/dji-txt-parser.ts`

Thin wrapper around `dji-log-parser-js`:
1. Lazy WASM singleton (same pattern as `cad-loader.ts`)
2. Reads `.txt` file as `ArrayBuffer`
3. Parses frames via the library
4. For v13+ logs, passes `VITE_DJI_API_KEY` env var for decryption
5. If v13+ and no key, throws descriptive error with conversion suggestions
6. Maps `FrameOSD` fields → `FlightPoint[]`

### Data mapping

| FrameOSD / FrameGimbal | FlightPoint |
|------------------------|-------------|
| `latitude` | `lat` |
| `longitude` | `lon` |
| `altitude` | `alt` (sea level) |
| `x_speed`, `y_speed` | `speed` (computed magnitude) |
| `yaw` | `heading` |
| `fly_time` | `timestamp` (s → ms) |
| `gimbal.pitch` | `gimbalPitch` |
| `gimbal.yaw` | `gimbalYaw` |

### Integration points

**`flight-parsers.ts`** — `detectFormat()`:
- Add `ext === 'txt'` → `'dji-txt'`

**`flight-path.ts`** — `importFile()`:
- `.txt` files are binary; add a branch that uses `file.arrayBuffer()` instead of `file.text()`, passing to `dji-txt-parser.ts`
- Add `'dji-txt'` case to format switch

**`vite.config.ts`**:
- Add `'dji-log-parser-js'` to `optimizeDeps.exclude`

**Flight path file extensions**:
- Add `.txt` to accepted extensions wherever they're listed

### Error handling

- **No GPS data**: "No valid GPS points found" (existing pattern)
- **v13+ encrypted, no API key**: `notify()` — "This flight log requires a DJI API key for decryption. Set VITE_DJI_API_KEY in your environment, or export the log as CSV from airdata.com"
- **WASM init failure**: catch and throw with context
- **Corrupt/unrecognized binary**: catch library error, re-throw with user-friendly message

### What doesn't change

- Archive storage format (`flightpath_N` prefix, raw file under `assets/`)
- `FlightPathManager` rendering (same `FlightPoint[]`)
- Kiosk display
- Existing CSV/KML/SRT parsers
