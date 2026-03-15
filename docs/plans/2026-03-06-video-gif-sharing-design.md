# Video/GIF Sharing — Design Document

**Date:** 2026-03-06
**Status:** Approved

## Problem

Clients, team members, and marketing need shareable previews of 3D scans without requiring them to open the full viewer. Currently the only visual output is static screenshots bundled into archives. There's no way to share a rotating model, walkthrough replay, or annotation tour as a portable video or GIF.

## Goals

- Record video clips (up to 60s) from the editor with multiple camera modes
- Server-side transcode to MP4 + GIF for universal compatibility
- Store recordings linked to archives in the library with their own directory
- Shareable via preview page (with OG embed support) and direct file URLs
- Trim before upload, delete and re-record

## Non-Goals

- Live streaming
- Video editing beyond start/end trim
- Audio capture
- Automatic recording on archive save
- Batch recording across multiple archives

## Architecture: MediaRecorder + Server FFmpeg

### Why This Approach

Browser-native `MediaRecorder` API captures WebGL canvas as WebM with zero client-side dependencies. Server-side ffmpeg (battle-tested, ~30MB alpine package) transcodes to MP4 (H.264) and GIF (palette-optimized). Clean separation: browser records, server transcodes.

Alternatives considered:
- **Fully client-side** (gif.js + WebCodecs): Limited browser support for MP4, gif.js unmaintained, heavy client load. Rejected.
- **External transcode service** (AWS MediaConvert, etc.): Overkill for expected volume, adds cost/complexity. Rejected.

---

## Section 1: Recording Modes & Client-Side Capture

### Recording Module (`src/modules/recording-manager.ts`)

Orchestrates canvas capture across four recording modes:

**Turntable** — Temporarily enables `OrbitControls.autoRotate` with configurable speed. Records a full 360 degrees (or user-specified duration). Restores previous camera state on stop.

**Walkthrough Replay** — Hooks into existing `WalkthroughEngine` playback. Starts recording when playback begins, stops when sequence ends (or user stops early). No new camera logic needed.

**Annotation Tour** — New camera automation: iterates annotations in order, flies camera to each one (reusing `flyCamera()` from walkthrough-controller), dwells ~3s showing the popup, then moves to next. Essentially a dynamically-generated walkthrough from annotations.

**Free Record** — User clicks record, moves camera manually, clicks stop. Just captures whatever's on canvas.

### Capture Implementation

- `canvas.captureStream(30)` gets a MediaStream from the WebGL canvas at 30fps
- Feeds into `MediaRecorder` with `video/webm; codecs=vp9` (fallback to `vp8`)
- Collects chunks via `ondataavailable`, assembles into Blob on stop
- Resolution: current viewport size (with option to force specific resolution like 1080p by temporarily resizing renderer)

### Annotation Popup Compositing

`canvas.captureStream()` only captures the WebGL canvas — DOM-overlaid annotation popups won't appear. Solution: a compositing canvas layered on top that draws both the WebGL frame and a second overlay canvas (with popup text/images rendered via Canvas 2D API) each frame. `captureStream` captures from this compositing canvas.

---

## Section 2: Trim UI

After recording stops, a lightweight trim interface appears inline in the recording panel:

- `<video>` element playing back the recorded WebM
- Two draggable handles for start/end trim points on a timeline scrubber
- Preview button to play just the trimmed segment
- Title field (auto-populated: `"{Archive Title} - {Mode} - {Date}"`)
- "Upload" and "Discard" buttons
- Trimming is approximate (frame-level precision not needed) — actual trim done server-side by ffmpeg using the timestamps

---

## Section 3: Server-Side Pipeline & Storage

### API Endpoints (additions to `meta-server.js`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/media/upload` | POST | Receive WebM blob + metadata (archive ID, trim start/end, mode, title). Busboy multipart. |
| `/api/media/:id` | GET | Return media metadata (status, URLs, linked archive). |
| `/api/media?archive_id=xxx` | GET | List all media linked to an archive. |
| `/api/media/:id` | DELETE | Delete media files + DB record. |

### FFmpeg Transcode Pipeline

After upload, server spawns ffmpeg as a child process:

1. **Trim** — apply start/end timestamps from client
2. **MP4** — `ffmpeg -ss {start} -to {end} -i input.webm -c:v libx264 -preset fast -crf 23 -movflags +faststart output.mp4`
3. **GIF** — Two-pass for quality: generate palette first, then encode. Downsized to 480px wide, 15fps for reasonable file size at 60s.
4. **Thumbnail** — Extract first frame as 512x512 JPEG
5. Clean up raw WebM after successful transcode

Status tracked in SQLite: `pending -> processing -> ready -> error`

### Storage Layout

```
/usr/share/nginx/html/media/
  {media_id}/
    video.mp4        (H.264, original resolution)
    preview.gif      (480px wide, 15fps, palette-optimized)
    thumb.jpg        (first frame, 512x512)
```

Nginx serves `/media/` directly as static files with cache headers.

### SQLite Schema

```sql
CREATE TABLE media (
  id          TEXT PRIMARY KEY,
  archive_id  TEXT REFERENCES archives(id),
  title       TEXT,
  mode        TEXT,           -- turntable|walkthrough|annotation-tour|free
  duration_ms INTEGER,
  status      TEXT DEFAULT 'pending',  -- pending|processing|ready|error
  error_msg   TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  mp4_path    TEXT,
  gif_path    TEXT,
  thumb_path  TEXT
);
```

### Docker Changes

Add ffmpeg to alpine image: `RUN apk add --no-cache ffmpeg` (~30MB). No other infrastructure changes.

---

## Section 4: Library Integration

### Archive Detail — Media Tab

Each archive card gains a media badge/count if linked recordings exist. Archive detail view includes a **Media tab**:

- Thumbnail grid of all linked recordings
- Each thumbnail: preview GIF on hover, duration, recording mode icon
- Click opens lightbox with MP4 player
- Actions per media: copy link, copy direct URL, delete
- "Record New" button deep-links to editor with archive loaded + recording UI open

---

## Section 5: Share Preview Page

Lightweight HTML page at `/share/{media_id}` served by `meta-server.js`:

- OpenGraph + Twitter Card meta tags for auto-embed in Slack, Discord, iMessage, social media
- Native `<video>` player with the MP4
- Archive title, description, creator info from linked archive metadata
- "View in 3D" button linking to kiosk viewer URL for parent archive
- "Download GIF" link
- Minimal CSS, no framework, mobile-friendly

### URL Structure

| URL | Purpose |
|-----|---------|
| `/share/{media_id}` | Preview page (primary share link) |
| `/media/{media_id}/video.mp4` | Direct MP4 (for embedding) |
| `/media/{media_id}/preview.gif` | Direct GIF |
| `/media/{media_id}/thumb.jpg` | Thumbnail image |

### OG Tags

```html
<meta property="og:type" content="video.other" />
<meta property="og:video" content="https://domain.com/media/{id}/video.mp4" />
<meta property="og:video:type" content="video/mp4" />
<meta property="og:image" content="https://domain.com/media/{id}/thumb.jpg" />
```

---

## Section 6: Editor UI

### Recording Panel

New collapsible panel in editor sidebar (below screenshot section):

**Mode selector** — Four icon buttons: Turntable, Walkthrough, Annotation Tour, Free. Mode-specific options appear below.

**Mode options:**
- **Turntable**: Speed slider (slow/medium/fast), duration or "full 360" toggle
- **Walkthrough**: Dropdown to select saved walkthrough (grayed out if none)
- **Annotation Tour**: Dwell time per annotation (default 3s), order selection
- **Free**: No options

**Record button** — Large red circle, toggles to stop (square) while recording. Timer + red pulse indicator in viewport corner.

**Post-recording flow:**
1. Recording stops -> trim UI appears inline
2. Timeline scrubber with start/end handles, preview playback
3. Title field (auto-populated)
4. "Upload" -> progress -> "Processing..." until server returns `ready`
5. "Discard" -> confirm -> discard blob

### Viewport Indicators

- Red dot + "REC" badge in top-right corner during recording
- Annotation popups composited into recording canvas (not DOM overlay)

### HTML Changes

New panel markup in `editor/index.html`. Trim scrubber and mode options are DOM elements queried by recording module by ID.

---

## Section 7: Error Handling

| Scenario | Behavior |
|----------|----------|
| FFmpeg fails | Status -> `error`, editor shows "Transcode failed — try again" |
| Upload interrupted | Client retries once, then shows error with retry button |
| No VP9 support | Fall back to VP8, then bare `video/webm` |
| No ffmpeg (dev mode) | Skip transcode, serve raw WebM, skip GIF, show warning |

---

## New Files

| File | Purpose |
|------|---------|
| `src/modules/recording-manager.ts` | Recording orchestration, MediaRecorder, mode automation |
| `src/modules/recording-trim.ts` | Trim UI logic (timeline scrubber, preview playback) |
| `src/modules/annotation-tour.ts` | Camera automation for annotation-to-annotation flythrough |
| `docker/share-page.html` | Template for `/share/{id}` preview page |
| DB migration in `meta-server.js` | `media` table creation |
| API routes in `meta-server.js` | `/api/media/*` endpoints |

---

## Data Flow

```
Editor UI                    Server                      Static Files

1. Select mode, click Record
2. captureStream(30) ->
   MediaRecorder starts (WebM/VP9)
3. Camera automation runs +
   composite canvas captures overlays
4. Click Stop -> WebM blob
5. Trim UI -> set start/end, title
6. Upload -----------------> POST /api/media/upload
                             - Store WebM to temp/
                             - Insert DB (status: pending)
                             - Return media_id
                             - Spawn ffmpeg:
                               Trim -> MP4            -> /media/{id}/video.mp4
                               Trim -> GIF (480p 15fps)-> /media/{id}/preview.gif
                               First frame -> thumb    -> /media/{id}/thumb.jpg
                             - Update DB (status: ready)
                             - Delete temp WebM
7. Poll status <------------- GET /api/media/{id}
8. Show "Ready" + copy link
9. Share link -------------> GET /share/{media_id}
                             - Render HTML with OG tags,
                               video player, "View in 3D"
```
