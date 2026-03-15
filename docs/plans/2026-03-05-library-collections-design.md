# Library Collections

**Date**: 2026-03-05
**Status**: Design approved, pending implementation

## Problem

The library stores archives as a flat list. There's no way to group related archives — e.g. all scans from one client, all assets from one site, or a curated portfolio. Users need arbitrary groupings where one archive can belong to multiple collections, with a public-facing kiosk page per collection.

> **Not to be confused with** multi-subject collections (`2026-03-03-multi-subject-collections.md`), which pack multiple 3D subjects into a single archive. This feature groups separate archives at the server/library level.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data store | SQLite join table | Consistent with existing architecture, proper many-to-many, transactional |
| URL scheme | Slug-based (`/collection/downtown-scans`) | Human-readable, shareable, editable |
| Collection metadata | Rich: name, slug, description, thumbnail, sort order, theme override | Full presentation control per collection |
| Kiosk display | Card grid | Consistent with editor library gallery, responsive, visual |
| Editor UI | Integrated into existing library panel | No new tool/overlay, collections as a filter/grouping layer |
| Security | Read endpoints public, mutation admin-gated | Same model as existing archive CRUD |

## Data Model

Two new tables, created at `meta-server.js` startup via `CREATE TABLE IF NOT EXISTS`:

### `collections`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | Internal ID |
| `slug` | TEXT UNIQUE NOT NULL | URL-safe identifier, e.g. `downtown-scans` |
| `name` | TEXT NOT NULL | Display name, e.g. "Downtown Scans" |
| `description` | TEXT | Optional longer description |
| `thumbnail` | TEXT | Path to cover image (e.g. `/thumbs/collection-{slug}.jpg`), or null to use first archive's thumbnail |
| `theme` | TEXT | Theme override: `editorial`, `gallery`, `exhibit`, or null (uses default) |
| `created_at` | TEXT DEFAULT datetime('now') | ISO datetime |
| `updated_at` | TEXT DEFAULT datetime('now') | ISO datetime |

### `collection_archives` (join table)

| Column | Type | Notes |
|--------|------|-------|
| `collection_id` | INTEGER FK | References `collections.id` ON DELETE CASCADE |
| `archive_id` | INTEGER FK | References `archives.id` ON DELETE CASCADE |
| `sort_order` | INTEGER DEFAULT 0 | Per-collection ordering |
| PRIMARY KEY | `(collection_id, archive_id)` | Prevents duplicates |

Indexes on both foreign keys. `ON DELETE CASCADE` on both sides: deleting a collection removes its memberships; deleting an archive removes it from all collections.

## API Endpoints

All added to `meta-server.js`. Mutation endpoints gated behind `ADMIN_ENABLED` + CSRF.

### Read (public)

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/api/collections` | `{ collections: [...] }` — all collections with archive count |
| `GET` | `/api/collections/:slug` | Collection metadata + ordered array of archive objects (same shape as `/api/archives` items) |
| `GET` | `/collection/:slug` | HTML page with OG meta injection, serves kiosk HTML |

### Mutation (admin-gated)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/collections` | Create collection `{ name, slug, description?, thumbnail?, theme? }` |
| `PATCH` | `/api/collections/:slug` | Update collection metadata |
| `DELETE` | `/api/collections/:slug` | Delete collection (cascades memberships, archives untouched) |
| `POST` | `/api/collections/:slug/archives` | Add archive(s) `{ hashes: ["abc123..."] }` |
| `DELETE` | `/api/collections/:slug/archives/:hash` | Remove single archive from collection |
| `PATCH` | `/api/collections/:slug/order` | Reorder archives `{ hashes: ["hash1", "hash2", ...] }` — sets `sort_order` by array position |

Slug is auto-generated from name (lowercase, hyphens, strip special chars) but editable via `PATCH`. Uniqueness enforced at DB level.

## Editor UI — Collection Management

Collections integrate into the existing library panel (`#library-overlay`), not a new tool.

### Collection sidebar

A collapsible section above the archive gallery in `#library-gallery`:
- List of collections as compact rows (name + archive count)
- "All Archives" entry at top (current behavior, always visible)
- "+ New Collection" button at bottom
- Clicking a collection filters the gallery to show only its archives
- Active collection highlighted

### Collection actions

When a collection is selected (not "All Archives"):
- Edit button (pencil icon) opens inline form: name, slug, description, theme dropdown
- Delete button with confirmation
- Drag-to-reorder archives within the filtered gallery view (updates `sort_order`)

### Adding archives to collections

Two entry points:
1. **From archive detail pane**: New "Collections" section showing chips for each collection the archive belongs to. "+ Add to collection" dropdown to add more. Click `×` on a chip to remove.
2. **Multi-select in gallery**: Checkbox mode (shift-click or "Select" toggle), then "Add to Collection..." button in a toolbar that appears.

### Collection thumbnail

Defaults to the first archive's thumbnail. Can be overridden in the collection edit form via file picker (uploaded to `/thumbs/collection-{slug}.jpg`).

## Kiosk Collection Page

### Server-side (`/collection/:slug`)

meta-server looks up the slug, injects OG meta tags (title, description, thumbnail URL) into the kiosk HTML response — same pattern as `/view/:uuid`. Passes slug to client via inline `<script>` setting `window.COLLECTION_SLUG`.

### Client-side

New `src/modules/collection-page.ts` module, loaded conditionally by `kiosk-web.ts` when `window.COLLECTION_SLUG` is detected.

### Layout

- Header: collection name, description, archive count
- Responsive card grid (CSS grid with `auto-fill` / `minmax()`)
- Each card: thumbnail, title, asset type icons, file size
- Clicking a card navigates to `/view/{uuid}` (or `/?archive=...` fallback)
- Back link in kiosk viewer to return to the collection page

### Theming

If the collection has a `theme` override, it's applied to the collection page. Individual archive viewers use their own theme settings.

### Responsive

CSS grid handles mobile through desktop without breakpoint complexity.

## New & Modified Files

### New files

| File | Purpose |
|------|---------|
| `src/modules/collection-manager.ts` | Editor-side collection CRUD, gallery filtering, drag-reorder, add/remove archives |
| `src/modules/collection-page.ts` | Kiosk collection page: fetch data, render card grid, handle navigation |

### Modified files

| File | Changes |
|------|---------|
| `docker/meta-server.js` | New tables, 8 new API endpoints, `/collection/:slug` route with OG injection |
| `src/editor/index.html` | Collection sidebar markup in `#library-overlay`, collection chips in detail pane, multi-select toolbar |
| `src/index.html` | Minimal: script slot for collection slug |
| `src/kiosk-web.ts` | Detect collection slug, conditionally load `collection-page.ts` |
| `src/modules/library-panel.ts` | Wire collection sidebar, filter gallery by active collection |
| `src/styles.css` | Collection sidebar styles, kiosk card grid, multi-select toolbar |
| `src/modules/event-wiring.ts` | Wire collection-related button events |
| `src/types.ts` | `Collection` and `CollectionArchive` type interfaces |

### Not changed

Archive format, manifest.json, archive-loader, archive-creator, config.js, existing themes. Collections are purely a server + UI layer.
