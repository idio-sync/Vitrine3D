# Library Media Section Design

**Date:** 2026-03-06
**Status:** Approved

## Problem

Recordings (media) are linked to archives via `media.archive_id` and accessible through the API, but there is no way to view or manage them from the library panel. Users must use the admin panel or raw API to find their transcoded videos.

## Design

### Location

New **"Recordings"** collapsible section in the library detail pane (right sidebar), positioned after Actions and before Assets:

1. Preview
2. Details
3. Collections
4. Actions
5. **Recordings** (new)
6. Assets
7. Metadata

Section is hidden when no media exists for the selected archive (same pattern as Assets/Metadata).

### Media Item Layout

Each media item renders as a card within the section:

- **Thumbnail** (`thumb.jpg`) — static image by default
- **GIF hover preview** — on mouseenter, swap `src` to the GIF URL; on mouseleave, swap back to thumb
- **Info line** — title + mode badge + duration (e.g. "Turntable · 12s")
- **Click thumbnail** — expands to inline `<video>` player (MP4 src), click again or video ends → collapse back to thumbnail
- **Action row** — three buttons per item:
  - Copy Share Link (copies `/share/{mediaId}` full URL)
  - Copy GIF URL (copies direct GIF URL for embedding)
  - Delete (trash icon → confirm dialog → DELETE API call)

### Status Handling

| Status | Display |
|--------|---------|
| `ready` | Full UI: thumb, GIF hover, player, all actions |
| `processing` / `pending` | Placeholder with spinner animation, actions disabled, auto-poll every 3s |
| `error` | Red badge with `error_msg` as tooltip, only Delete action available |

### Data Flow

1. On `selectArchive(hash)`, call `GET /api/media?archive_hash={hash}`
2. Cache results in a `Map<string, MediaItem[]>` keyed by archive hash
3. Render the Recordings section from the cached array
4. For items in `processing`/`pending` status, start a poll interval (3s) that re-fetches and updates the item when status changes to `ready` or `error`

### Delete Flow

Trash icon → `confirm('Delete recording "title"?')` → `DELETE /api/media/:id` with `authHeaders()` → remove from local cache → re-render section.

## Files Touched

- `src/editor/index.html` — Add Recordings section HTML skeleton to `pane-library`
- `src/modules/library-panel.ts` — Media fetch, cache, render, GIF hover, inline player, copy actions, delete, poll logic
- `src/styles.css` — Media card styles (thumbnail, hover swap, inline player, action icons, status badges)

## Not In Scope

- No new modules (rendering stays in library-panel.ts, matching renderAssets/renderMetadata pattern)
- No server/API changes (existing endpoints are sufficient)
- No changes to recording-manager.ts or recording-trim.ts
