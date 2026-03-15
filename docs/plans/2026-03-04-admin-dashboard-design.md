# Admin Dashboard Design

## Summary

Replace `docker/admin.html` (currently a duplicate library view) with a genuine operations dashboard. Tabbed SPA with Activity, Storage, System, and Settings sections. Phase 1 ships Activity + Storage; Phase 2 adds System + Settings.

## Context

- **Users:** Small team (2-5) at the scanning company
- **Auth:** Cloudflare Access (email header), unchanged
- **Editor library is independent:** `src/modules/library-panel.ts` + `editor/index.html` UI — unaffected by this change
- **Existing infrastructure:** `audit_log` SQLite table already tracks uploads/deletes/renames but has no read API; `archives` table has all metadata

## Architecture

**Single self-contained HTML file** (`docker/admin.html`), served by meta-server.js at `GET /admin`. No build step, no framework — vanilla JS with CSS-only tab switching via `.active` class and URL hash for bookmarkability (`#activity`, `#storage`, `#system`, `#settings`).

**Dark theme** to visually distinguish from client-facing kiosk.

## Layout

```
┌──────────────────────────────────────────────────┐
│  Vitrine3D Admin                    user@co.com  │
├──────────────────────────────────────────────────┤
│  [Archives: 42] [Storage: 12.3 GB] [Last: 2h ago] [DB: 1.2 MB] │
├──────────────────────────────────────────────────┤
│  Activity │ Storage │ System │ Settings           │
├──────────────────────────────────────────────────┤
│                                                  │
│              (tab content area)                   │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Stats bar** (always visible): archive count, total storage, last activity timestamp, DB file size.

## Phase 1: Activity + Storage

### Activity Tab

**New API endpoint:** `GET /api/audit-log`
- Auth: `requireAuth`
- Query params: `limit` (default 50), `offset`, `actor`, `action`, `from` (ISO date), `to` (ISO date)
- Response: `{ entries: [...], total: number }`

**Audit log gaps to fill:**
- Add audit entry for `regenerate` action in `handleRegenerateArchive`
- Add audit entry for chunk upload completion in `handleCompleteChunk`

**UI components:**
- Filterable table: timestamp, actor (email), action (color-coded badge), target (archive name/hash), detail (expandable)
- Filter bar: action type dropdown, actor dropdown (populated from distinct values), date range
- Relative timestamps ("2 hours ago") with full ISO on hover
- Auto-refresh toggle (30s poll interval)
- Pagination (prev/next with offset)

### Storage Tab

**New API endpoint:** `GET /api/storage`
- Auth: `requireAuth`
- Response: `{ archives: [{hash, filename, size, created_at}...], totalUsed: number, diskFree: number, diskTotal: number, orphans: [{filename, size}...], dbSize: number }`

**Implementation:**
- Archive sizes from `archives` table `size` column
- Disk stats via `fs.statfsSync` (Node 18.15+) on `/data` volume
- Orphan detection: list `/usr/share/nginx/html/archives/` files, diff against DB `filename` column
- DB size via `fs.statSync` on DB_PATH

**UI components:**
- Disk usage progress bar (used / total, color shifts at 80%+)
- Archive table sorted by size desc: filename, size (formatted), asset types, created date
- Orphan section (hidden if none): list with filename + size, "Clean up" button per item or bulk

**New API endpoint for cleanup:** `DELETE /api/storage/orphans/:filename`
- Auth: `requireAuth` + `checkCsrf`
- Deletes file from archives directory, logs to audit_log

## Phase 2: System + Settings

### System Tab

- Service health: ping `/health` endpoint, show green/red status
- SQLite stats: DB file size, row counts per table
- Node.js process: `process.memoryUsage()`, `process.uptime()`
- Server config dump: non-sensitive env vars (ADMIN_ENABLED, MAX_UPLOAD_SIZE, CHUNKED_UPLOAD, DEFAULT_KIOSK_THEME)

**New API endpoint:** `GET /api/system`
- Auth: `requireAuth`

### Settings Tab

- View/edit runtime config values
- Persisted to a new `settings` SQLite table (key/value)
- Read at request-time, override env var defaults
- Changes take effect without container restart

**New API endpoints:**
- `GET /api/settings` — current values
- `PATCH /api/settings` — update values, audit-logged

**Configurable values:** MAX_UPLOAD_SIZE, DEFAULT_KIOSK_THEME, CHUNKED_UPLOAD

## Files Modified

### Phase 1
- `docker/admin.html` — full rewrite (new dashboard SPA)
- `docker/meta-server.js` — add `GET /api/audit-log`, `GET /api/storage`, `DELETE /api/storage/orphans/:filename`, audit entries for regenerate + chunk completion

### Phase 2
- `docker/meta-server.js` — add `GET /api/system`, `GET /api/settings`, `PATCH /api/settings`, new `settings` table
- `docker/admin.html` — add System + Settings tab content

## Non-Goals

- No role-based permissions (CF Access handles auth at the edge)
- No real-time WebSocket updates (polling is sufficient for small team)
- No archive management in the dashboard (editor handles this)
- No log file streaming (too complex for phase 1; System tab shows summary stats)
