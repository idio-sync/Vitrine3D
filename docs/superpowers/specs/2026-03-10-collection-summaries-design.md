# Collection Summaries & Preview Images

## Problem

The browse collections page in the editorial Tauri app shows collection cards, but they lack meaningful preview images and descriptions. Collections have `thumbnail` and `description` fields in the database, but there is no UI for populating them and no auto-generation fallback.

## Solution

A collection manager sidebar panel in the library view, server-side mosaic thumbnail generation, and thumbnail upload/management API endpoints.

## Design

### Collection Manager Sidebar Panel

When a user clicks a collection in the library view's collection list, the right sidebar shows a management panel:

- **Collection name** — editable text input
- **Description** — plain textarea (~3-4 rows)
- **Preview image** section:
  - Current thumbnail preview (mosaic or custom image)
  - "Choose from archives" — grid of archive thumbnails within the collection to pick as cover
  - "Upload image" — file input for a custom image
  - "Auto-generate" button — triggers server-side mosaic regeneration
  - "Reset to auto" link — visible only when a manual image is set, clears the override
- **Save** button — PATCHes name/description via `PATCH /api/collections/:slug`

Clicking a collection switches the sidebar to collection management. Clicking an archive switches back to archive details. The panel lives in a new module.

### Server-side Mosaic Generation

When a collection has no manual thumbnail, the server auto-generates a mosaic from archive thumbnails using Sharp:

- **Layout:** 2x2 grid for 4+ archives, 2x1 for 2-3, single (centered) for 1, placeholder for 0
- **Output size:** 640x360px (16:9 aspect ratio, matches `.cb-coll-thumb` card containers which use `aspect-ratio: 16 / 9`)
- **Format:** JPEG at 85% quality
- **Storage paths:**
  - Auto-generated: `/thumbs/collection-{slug}-auto.jpg`
  - Manual upload: `/thumbs/collection-{slug}.jpg`
- **Regeneration triggers:** Auto-mosaic regenerates when archives are added to or removed from the collection (via existing membership endpoints), but only if no manual thumbnail is set
- **Fallback:** If archive thumbnails are unavailable, generates a solid navy (#08182a) rectangle with the collection name rendered in gold (#FEC03A)

The `thumbnail` field in the `GET /api/collections` response resolves to: manual upload path if present, otherwise auto-generated mosaic path, otherwise null. This replaces the existing fallback in meta-server.js that uses the first archive's thumbnail — the mosaic generation subsumes that behavior.

### API Changes

New endpoints (all auth-gated via CF Access):

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/collections/:slug/thumbnail` | Upload a custom thumbnail (multipart form via busboy). Saves to `/thumbs/collection-{slug}.jpg`, updates DB `thumbnail` field. |
| `DELETE` | `/api/collections/:slug/thumbnail` | Remove manual override. Deletes the manual file, reverts `thumbnail` to auto-generated path (or null). |
| `POST` | `/api/collections/:slug/generate-thumbnail` | Force-regenerate the auto mosaic. Used by the "Auto-generate" button. |

Modified endpoints:

| Method | Endpoint | Change |
|--------|----------|--------|
| `POST` | `/api/collections/:slug/archives` | After adding archive, regenerate auto-mosaic if no manual thumbnail is set |
| `DELETE` | `/api/collections/:slug/archives/:hash` | After removing archive, regenerate auto-mosaic if no manual thumbnail is set |

Existing `PATCH /api/collections/:slug` is unchanged — already handles name and description updates.

### Collections Browser Display

On the browse collections page (editorial Tauri app), collection cards use the resolved thumbnail:

- **Card thumbnail:** Displays the resolved image (manual or auto-mosaic). If null, shows a CSS-only placeholder — navy gradient with a subtle collection icon.
- **Card text:** Collection name + description preview (truncated to ~2 lines via CSS `line-clamp`). Falls back to the existing archive count string if no description is set.
- **Collection detail page:** Full description renders under the collection name in the `.cp-header` area (already wired, just starts showing real content).

No behavioral changes to the existing navigation flow.

### Database Changes

None. The existing `collections` table already has `name`, `description`, and `thumbnail` columns. The `thumbnail` column stores a path string — the server resolves whether it points to a manual or auto-generated file.

### New Dependencies

- **Sharp** (`sharp`) — added to `docker/package.json` for server-side image compositing. Lightweight, widely used, handles resize + composite operations needed for mosaic generation.

## Files Affected

| File | Change |
|------|--------|
| `src/modules/collection-manager.ts` | Add sidebar panel UI for editing name, description, and thumbnail |
| `docker/meta-server.js` | Add thumbnail upload/delete/generate endpoints, mosaic generation logic, regeneration on archive membership changes |
| `docker/package.json` | Add `sharp` dependency |
| `src/modules/collections-browser.ts` | Minimal changes — card rendering already supports description with line-clamp and CSS placeholders; verify resolved thumbnail URL (manual vs auto) works correctly |
| `src/modules/collection-page.ts` | Show full description in `.cp-header` when available |

## Out of Scope

- Batch operations (setting thumbnails for multiple collections at once)
- Thumbnail cropping/editing UI
- Rich text / markdown descriptions
- Automatic text summarization from archive metadata
