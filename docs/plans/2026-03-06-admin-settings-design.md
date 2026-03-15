# Admin Settings Panel — Design

**Date:** 2026-03-06
**Status:** Approved

## Overview

Enable the "Settings" tab in the Docker admin panel (`/admin`) with savable application settings. Settings are stored in SQLite, resolved via a fallback chain (SQLite → env var → hardcoded default), and served to both the admin UI and the frontend via API.

## Data Layer

### SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);
```

### Resolution Chain

For every setting, the server resolves in order:
1. **SQLite `settings` table** — admin-set value
2. **Environment variable** — Docker deployment override
3. **Hardcoded default** — defined in `SETTINGS_DEFAULTS` object in `meta-server.js`

A "Reset to Default" action DELETEs the row from SQLite, causing the fallback to kick in.

### Defaults Registry

A `SETTINGS_DEFAULTS` object in `meta-server.js` defines every setting with key, default value, type, label, group, and description:

```js
const SETTINGS_DEFAULTS = {
    'video.crf':              { default: '18',      type: 'number', label: 'Video CRF',              group: 'Video Transcode',  description: 'H.264 quality (0=lossless, 51=worst)', min: 0, max: 51 },
    'video.preset':           { default: 'fast',    type: 'select', label: 'Encoding Preset',         group: 'Video Transcode',  description: 'FFmpeg speed/quality tradeoff', options: ['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'] },
    'recording.bitrate':      { default: '5000000', type: 'number', label: 'Recording Bitrate (bps)', group: 'Video Recording',  description: 'WebM capture bitrate' },
    'recording.framerate':    { default: '30',      type: 'number', label: 'Recording FPS',           group: 'Video Recording',  min: 15, max: 60 },
    'recording.maxDuration':  { default: '60',      type: 'number', label: 'Max Recording Duration (s)', group: 'Video Recording', min: 10, max: 300 },
    'gif.fps':                { default: '15',      type: 'number', label: 'GIF FPS',                 group: 'GIF Generation',   min: 5, max: 30 },
    'gif.width':              { default: '480',     type: 'number', label: 'GIF Width (px)',           group: 'GIF Generation',   min: 240, max: 1280 },
    'thumbnail.size':         { default: '512',     type: 'number', label: 'Thumbnail Size (px)',      group: 'Media Output',     min: 128, max: 1024 },
    'upload.maxSizeMb':       { default: '1024',    type: 'number', label: 'Max Upload Size (MB)',     group: 'Upload',           min: 1 },
    'lod.budgetSd':           { default: '1000000', type: 'number', label: 'LOD Budget — SD',         group: 'Renderer',         description: 'Max splats per frame (SD tier)' },
    'lod.budgetHd':           { default: '5000000', type: 'number', label: 'LOD Budget — HD',         group: 'Renderer',         description: 'Max splats per frame (HD tier)' },
    'renderer.maxPixelRatio': { default: '2',       type: 'number', label: 'Max Pixel Ratio',         group: 'Renderer',         description: 'Cap for high-DPI displays', min: 1, max: 4 },
};
```

## API Endpoints

### `GET /api/settings` (public, no auth)

Returns every setting with its resolved value, default, metadata, and `isCustom` flag:

```json
{
  "video.crf": {
    "value": "18",
    "default": "18",
    "isCustom": false,
    "label": "Video CRF",
    "group": "Video Transcode",
    "type": "number",
    "description": "H.264 quality (0=lossless, 51=worst)",
    "min": 0,
    "max": 51
  }
}
```

### `PUT /api/settings` (auth required — CF Access)

Accepts partial key-value object. Validates against `SETTINGS_DEFAULTS` type/min/max. Returns 400 for invalid keys or out-of-range values. Upserts rows into `settings` table.

```json
{ "video.crf": "23", "gif.fps": "10" }
```

### `DELETE /api/settings/:key` (auth required)

Resets a single setting by deleting its row. Returns the resolved (now default) value.

## Admin UI

### Tab Activation

Enable the disabled "Settings" button in `docker/admin.html`. Add `<div id="tab-settings">` content panel.

### Layout

Settings grouped into collapsible sections matching the `group` field:

- **Video Transcode** — CRF, Encoding Preset
- **Video Recording** — Bitrate, FPS, Max Duration
- **GIF Generation** — FPS, Width
- **Media Output** — Thumbnail Size
- **Upload** — Max Upload Size
- **Renderer** — LOD Budget SD, LOD Budget HD, Max Pixel Ratio

Each setting row:
```
[Label]                    [Input]  [Reset ↺]
Description text           Default: 18
```

- Number → `<input type="number" min="..." max="...">`
- Select → `<select>` with options
- "Default: X" in muted text below each input
- Reset button visible only when `isCustom: true`
- "Save Changes" button at bottom

### Styling

Matches existing admin design system (`var(--bg-surface)`, `var(--text-primary)`, `var(--accent)`, etc.).

## Server-Side Integration

### `getSetting(key)` helper

Replaces hardcoded values in `meta-server.js`. Reads from resolution chain with short in-memory cache (5s TTL).

**Before:** `'-crf', '18'`
**After:** `'-crf', getSetting('video.crf')`

### Env Var Mapping

| Setting Key | Env Var | Status |
|------------|---------|--------|
| `upload.maxSizeMb` | `MAX_UPLOAD_SIZE` | Existing |
| `video.crf` | `VIDEO_CRF` | New |
| `video.preset` | `VIDEO_PRESET` | New |
| `gif.fps` | `GIF_FPS` | New |
| `gif.width` | `GIF_WIDTH` | New |
| `thumbnail.size` | `THUMBNAIL_SIZE` | New |

## Frontend Integration

`config.js` fetches `GET /api/settings` at boot, merges client-relevant values (`lod.*`, `renderer.*`, `recording.*`) into `window.APP_CONFIG`. Modules like `quality-tier.ts` and `recording-manager.ts` already read from `APP_CONFIG`.

Falls back silently to hardcoded defaults if API is unreachable (local dev, Tauri builds).

## Error Handling

- **Validation:** Server-side type/min/max checks; admin UI uses HTML5 attributes
- **Unknown keys:** Rejected with 400
- **Concurrent admins:** Last write wins
- **API failure:** Frontend falls back to hardcoded defaults
- **Audit logging:** Changes logged to `activity_log` table
