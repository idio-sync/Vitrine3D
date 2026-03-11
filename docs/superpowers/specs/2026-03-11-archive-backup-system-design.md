# Archive Backup System — Design Spec

Supersedes: `2026-03-10-archive-version-control-design.md` (retained for future expansion reference)

## Problem

When users re-upload an edited archive via "Save to Library," the server rejects it with a 409 duplicate error. There's no way to update an existing archive, and no backup of previous versions. Users must manually delete and re-upload, losing all history.

## Requirements

- **Automatic backup rotation**: when an archive with the same filename is re-uploaded, the existing file is moved to a history directory before the new one takes its place
- **Configurable retention**: keep the N most recent backups per archive (default 5), oldest pruned automatically
- **Download previous versions**: users can download any backup from the admin panel or library page
- **Delete individual backups**: users can remove specific backups to reclaim disk space
- **No editor changes**: the existing `saveToLibrary()` flow works as-is — the server handles versioning transparently

## Approach: Full Archive Snapshots

Each backup is a complete copy of the `.ddim` file, stored in a per-archive subdirectory under `history/`. No deduplication, no unpacking, no blob store.

### Why Not Content-Addressable Blobs?

The prior spec (`2026-03-10-archive-version-control-design.md`) proposed a content-addressable blob store with delta storage, ref-counting, and ZIP reassembly. That approach saves disk space when large assets are unchanged across versions, but adds:

- 3 new tables, ref-count bookkeeping, garbage collection
- ZIP reassembly on download (new `archiver` dependency, streaming complexity)
- Cherry-pick/restore/compare logic

For a 5-version default limit, storage savings rarely justify the complexity. A 500MB archive × 5 versions = 2.5GB — manageable for a self-hosted Docker deployment. The blob store approach remains documented for future expansion if storage becomes a concern.

## Storage Layout

```
archives/
  my-project.ddim                                    ← current version (served by nginx)
  history/
    my-project/
      my-project.2026-03-11T14-30-00Z.ddim           ← backup 1 (newest)
      my-project.2026-03-11T10-15-00Z.ddim           ← backup 2
      my-project.2026-03-10T16-45-00Z.ddim           ← backup 3
```

- History subdirectory named after the archive basename (without extension)
- Backup filenames use ISO 8601 timestamps with `-` replacing `:` for filesystem safety
- Sidecar files (meta JSON, thumbnail) are not backed up — they describe the current version only and are regenerated on each upload

## Database Changes

### New Table

```sql
CREATE TABLE IF NOT EXISTS archive_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    archive_id  INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
    filename    TEXT    NOT NULL,
    size        INTEGER NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_av_archive ON archive_versions(archive_id);
```

- `archive_id`: FK to the parent archive row
- `filename`: path relative to `ARCHIVES_DIR` (e.g., `history/my-project/my-project.2026-03-11T14-30-00Z.ddim`)
- `size`: file size in bytes (for display, no re-stat needed)
- `created_at`: when this backup was created
- `ON DELETE CASCADE`: when an archive is deleted, all its version rows are removed automatically

### New Setting

Add to `SETTINGS_DEFAULTS`:

```js
'backup.maxVersions': {
    default: '5',
    type: 'number',
    label: 'Max Backup Versions',
    group: 'Storage',
    description: 'Maximum backup versions kept per archive (0 to disable backups)',
    min: 0,
    max: 50
}
```

## Server Changes (meta-server.js)

### Modified: Upload Handler (`handleUploadArchive`)

Current behavior: returns 409 if filename exists.

New behavior when filename exists:

1. Look up existing archive row by filename
2. If `backup.maxVersions` > 0:
   a. Create `history/{basename}/` directory if needed
   b. Generate timestamp string: `new Date().toISOString().replace(/:/g, '-')`
   c. Move existing file to `history/{basename}/{basename}.{timestamp}.{ext}`
   d. Insert row into `archive_versions` with the backup path and size
   e. Prune: count versions for this archive; if exceeding limit, delete oldest rows + files
3. Replace the current file with the new upload (existing flow)
4. Update the `archives` DB row via the existing `ON CONFLICT(hash) DO UPDATE` path
5. Audit log: action `'upload_replace'` (distinct from `'upload'` for new archives)

If `backup.maxVersions` is 0, the existing file is overwritten with no backup.

### Transaction Boundary

The entire backup-and-replace sequence (steps 1–5) must execute within a single `db.transaction()` call. This prevents FK integrity issues if a concurrent delete removes the archive row between the backup insert and the upsert. Filesystem operations (move, copy) happen inside the transaction; on any filesystem failure, the transaction rolls back and the upload returns 500.

### Shared Helper: `backupAndReplace`

Both `handleUploadArchive` and `handleCompleteChunk` share identical duplicate-detection and DB upsert logic. Extract a shared helper:

```js
function backupAndReplace(existingRow, tmpPath, filename, req)
```

This function encapsulates steps 1–5 above. Both handlers call it when `fs.existsSync(finalPath)` is true, avoiding logic duplication. The helper receives the existing archive DB row, the temp file path, the target filename, and the request (for audit actor extraction).

### Backup Filename Construction

Backup filenames are constructed directly — they must **not** pass through `sanitizeFilename()`, which only accepts `.a3d`/`.a3z` extensions and would corrupt `.ddim` filenames. The backup path is built from trusted inputs (existing filename from DB + server-generated timestamp), so sanitization is unnecessary.

### New: Version Pruning Function

```
function pruneArchiveVersions(archiveId, maxVersions)
```

- Query `archive_versions` for the given archive, ordered by `created_at DESC, id DESC` (secondary sort by `id` breaks ties for sub-second uploads)
- Skip the first `maxVersions` rows
- For each excess row: delete the file from disk, delete the DB row
- If the history subdirectory is now empty, remove it
- Runs within the same `db.transaction()` as the backup insert

### New API Endpoints

#### `GET /api/archives/:hash/versions`

List backup versions for an archive.

All `:hash` parameters in version endpoints are 16-character lowercase hex strings (`[a-f0-9]{16}`), matching the existing routing pattern.

Response:
```json
{
  "versions": [
    { "id": 7, "size": 524288000, "created_at": "2026-03-11T14:30:00Z" },
    { "id": 5, "size": 510000000, "created_at": "2026-03-11T10:15:00Z" }
  ]
}
```

Requires auth. Returns empty `versions` array if no backups exist.

#### `GET /api/archives/:hash/versions/:id/download`

Stream-download a specific backup file.

- Validate that the version belongs to the archive (prevent IDOR)
- Path traversal protection: resolve the full path via `path.join(ARCHIVES_DIR, row.filename)`, then verify with `fs.realpathSync()` that the resolved path starts with `path.join(ARCHIVES_DIR, 'history') + '/'`. This is stricter than the existing delete handler's `ARCHIVES_DIR` check — backup files must live under `history/`, never at the archives root.
- Set `Content-Disposition: attachment; filename="..."`
- Stream file with `fs.createReadStream()`

Requires auth.

#### `DELETE /api/archives/:hash/versions/:id`

Delete a specific backup.

- Validate ownership + path traversal
- Delete file from disk
- Delete DB row
- Clean up empty history subdirectory
- Audit log: action `'delete_version'`

Requires auth + CSRF.

### Modified: Delete Handler (`handleDeleteArchive`)

Add after existing file/sidecar cleanup:

```js
// Delete history directory for this archive
const basename = path.parse(row.filename).name;
const historyDir = path.join(ARCHIVES_DIR, 'history', basename);
try { fs.rmSync(historyDir, { recursive: true }); } catch {}
```

DB rows are cleaned up automatically via `ON DELETE CASCADE`.

### Modified: Rename Handler (`handleRenameArchive`)

When an archive is renamed, its history subdirectory must also be renamed to match the new basename:

1. Compute `oldBasename` and `newBasename` from the old/new filenames
2. If `history/{newBasename}/` already exists, return 409 — do not merge history directories
3. `fs.renameSync(history/{oldBasename}, history/{newBasename})` — move the directory
4. Update version filenames in a transaction: `UPDATE archive_versions SET filename = replace(filename, oldBasename, newBasename) WHERE archive_id = ?`
5. If the directory rename fails, abort before updating DB rows (filesystem-first, DB-second)

Backup filenames in the rename path must **not** pass through `sanitizeFilename()` (same rationale as backup creation — `.ddim` extension would be corrupted).

## Client-Side Changes

### Admin Panel — Archive Detail View

Add a "Version History" section below the existing archive actions (rename/delete/regenerate):

- **Collapsed by default**, expandable header: "Version History (N backups)"
- Table columns: Date (relative, e.g., "2 hours ago"), Size, Actions
- Actions per row: Download button, Delete button (with confirmation)
- If no backups exist: "No previous versions"

### Library Page — Archive Cards

Add a small clock icon to each archive card (visible only when backups exist):

- Clicking opens a dropdown/popover listing backup dates + sizes
- Each entry has a download link
- No delete from library view (admin-only action)

### No Editor Changes

The existing `saveToLibrary()` in `export-controller.ts` uploads via `POST /api/archives` with the archive filename. The server now accepts duplicates and handles backup rotation transparently. No client-side changes needed.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| First upload of a filename | Normal upload, no backup created |
| Re-upload same filename | Existing file backed up, new file takes its place |
| Re-upload with `maxVersions = 0` | Existing file overwritten, no backup |
| Delete archive | History directory + all backup files deleted, DB rows cascade-deleted |
| Rename archive | History subdirectory renamed, version filenames updated |
| Concurrent re-uploads | SQLite transaction serializes; both succeed, both create backups |
| Disk full during backup move | Clean up partial history file (`try { fs.unlinkSync(backupDest) } catch {}`), then fail with 500. Original file unchanged. Do not proceed without backup when `maxVersions > 0`. |
| Migration (existing archives) | No backfill — history starts empty. First re-upload creates the first backup. |
| Chunked upload re-upload | Same logic — `handleCompleteChunk` calls into the same backup rotation path |

## Files Affected

- `docker/meta-server.js` — new table, modified upload/delete/rename handlers, new version endpoints, pruning function, settings entry
- Admin panel HTML (in `meta-server.js` `generateAdminHtml()`) — version history section in archive detail
- Library page HTML (in `meta-server.js` `generateLibraryHtml()`) — history icon + dropdown on archive cards

- `docker/nginx.conf` — add `location /archives/history/ { deny all; }` to block direct access to backup files (downloads must go through the authenticated API endpoint)

No new npm dependencies. No editor-side changes.

## Testing Considerations

- Upload → re-upload → verify backup exists in `history/` + DB row created
- Upload N+1 times → verify oldest backup pruned
- Download backup → verify file contents match original
- Delete backup → verify file removed + DB row gone
- Delete archive → verify history directory cleaned up
- Rename archive → verify history directory renamed
- `maxVersions = 0` → verify no backups created
- Path traversal attempts on version download/delete endpoints
