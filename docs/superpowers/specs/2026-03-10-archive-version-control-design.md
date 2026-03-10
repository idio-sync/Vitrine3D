# Archive Version Control — Design Spec

## Problem

When users re-export edited archives, the previous state is overwritten. There's no way to view history, restore a previous version, or compare changes. The manual `version_history` array in the manifest is just a changelog with no actual data attached.

## Requirements

- **Automatic versioning**: every upload/export creates a new version — no user action required
- **Delta storage**: only store what changed between versions (content-addressable blob store)
- **Server-side only**: archives remain portable `.ddim` ZIPs; version history lives on the server
- **View, restore, compare, cherry-pick**: full version operations from the library UI
- **Append-only history**: restoring a version creates a new version (no rewriting)
- **Count-based retention**: keep last N versions per archive (default 5), v1 always preserved

## Approach: Content-Addressable Blob Store

On each upload, the server unpacks the archive, stores each file by its SHA-256 hash in a flat blob store, and saves the manifest as a version record in SQLite. Identical assets across versions share one blob — no duplication.

A 500MB archive re-exported 20 times with only metadata changes costs ~500MB + 20 small manifest records instead of 10GB.

### Alternatives Considered

**Full archive snapshots**: Store complete `.ddim` per version. Simple but massive storage waste — O(versions × archive size).

**Binary delta patches (bsdiff/xdelta)**: Smallest storage but extremely complex, slow reconstruction, fragile patch chains, and cherry-pick is nearly impossible on binary diffs.

## Storage Architecture

### Blob Store

Directory: `/blobs/{first-2-chars}/{full-hash}` (subdirectories to avoid flat directory issues).

- On upload, server unpacks the archive and stores each file by SHA-256 hash
- Identical files across any archive or version share one blob
- The current `.ddim` is also kept as-is in `/archives/` for fast download (no reassembly for latest version)

### New SQLite Tables

```sql
-- Individual content-addressed files
CREATE TABLE blobs (
  hash TEXT PRIMARY KEY,
  size INTEGER,
  ref_count INTEGER DEFAULT 0,
  created_at TEXT
);

-- One row per version of an archive
CREATE TABLE archive_versions (
  id INTEGER PRIMARY KEY,
  archive_id INTEGER REFERENCES archives(id),
  version_number INTEGER,
  total_size INTEGER,
  manifest TEXT,
  summary TEXT,
  parent_version_id INTEGER REFERENCES archive_versions(id),
  restored_from INTEGER REFERENCES archive_versions(id),
  created_at TEXT,
  UNIQUE(archive_id, version_number)
);

-- Maps version → blob references (asset_path is full ZIP-internal path, e.g. "assets/mesh_0.glb")
CREATE TABLE version_assets (
  version_id INTEGER REFERENCES archive_versions(id),
  asset_path TEXT,
  blob_hash TEXT REFERENCES blobs(hash),
  PRIMARY KEY (version_id, asset_path)
);

CREATE INDEX idx_version_assets_blob ON version_assets(blob_hash);
```

### Ref-Count Protocol

`ref_count` on the `blobs` table tracks how many `version_assets` rows reference each blob:

- **Increment**: within the same transaction as `INSERT INTO version_assets`, run `UPDATE blobs SET ref_count = ref_count + 1 WHERE hash = ?`
- **Decrement**: within the same transaction as `DELETE FROM version_assets` (during pruning or archive deletion), run `UPDATE blobs SET ref_count = ref_count - 1 WHERE hash = ?`
- **GC**: after decrement, delete any blobs where `ref_count = 0` (same transaction)

### Retention

Server setting `max_versions_per_archive` (default 5). When exceeded, oldest version is pruned — except v1 (initial) which is never pruned. So with max 5: v1 + the 4 most recent.

Pruning deletes `version_assets` rows and garbage-collects blobs with `ref_count = 0`.

## Server API

### New Endpoints

```
GET  /api/archives/:hash/versions
     → List all versions (version_number, summary, created_at, restored_from)

GET  /api/archives/:hash/versions/:version
     → Version detail (full manifest, asset list with sizes)

GET  /api/archives/:hash/versions/:version/download
     → Reassemble and download that version as a standalone .ddim

GET  /api/archives/:hash/versions/:v1/diff/:v2
     → JSON diff between two versions (manifest changes + added/removed/changed assets)

POST /api/archives/:hash/versions/:version/restore
     → Creates a new version (append-only) with that version's state as current

POST /api/archives/:hash/versions/:version/cherry-pick
     Body: { sections: ["annotations", "alignment", "viewer_settings", ...] }
     → Creates a new version merging selected sections from target version into current
```

### Modified Existing Endpoint

```
POST /api/archives  (upload)
     → After normal upload: unpack to blobs, create archive_versions record,
       diff against previous version to generate summary, enforce retention limit
```

**Upload flow change**: The existing `handleUploadArchive` and `handleCompleteChunk` in `meta-server.js` currently reject duplicate filenames with 409. For versioning, re-uploads of an existing archive must be accepted: replace the `.ddim` file in `/archives/` (latest version cache), unpack blobs, create a new `archive_versions` record, and update the `archives` row via `ON CONFLICT(hash) DO UPDATE`. The 409 guard becomes a version-creation path.

### Cherry-Pickable Sections

Manifest top-level keys that can be independently swapped:

- `annotations` + `walkthrough`
- `alignment`
- `viewer_settings`
- `data_entries` (asset references + transforms, including per-asset blob references)
- `project` (title, description, tags)
- `provenance`
- `quality_metrics`

**Cherry-pick merge semantics for `data_entries`**: When cherry-picking `data_entries` from an older version, the entire `data_entries` section is replaced wholesale (all asset keys, blob references, and per-asset transforms). Assets present in the source version but absent in the current version are added; assets absent in the source are removed. This is a full section swap, not a merge. To selectively restore individual assets, users should use restore + re-edit instead. `ref_count` updates follow the standard protocol: decrement for replaced blob references, increment for newly referenced blobs, within a single transaction.

## Auto-Generated Change Summaries

On each new version, the server diffs the current manifest against the previous and generates a human-readable summary.

**Diff categories (checked in order):**

1. Assets added/removed/replaced — compare `data_entries` keys and blob hashes
2. Annotations — count added/removed/modified
3. Walkthrough — stops added/removed/reordered
4. Alignment — transform values changed
5. Viewer settings — camera, lighting, display mode changes
6. Project metadata — title, description, tags, license
7. Provenance/quality — capture info, quality metrics

**Examples:**
- "Mesh replaced (mesh_0: 142MB → 98MB)"
- "3 annotations added, 1 removed"
- "Camera position updated, auto-rotate enabled"
- "Title changed to 'Lincoln Memorial — Phase 2'"

**Identical re-upload:** If manifest + blob hashes are identical to the previous version, no new version is created.

## Library UI

Version history appears in the existing archive details panel (alongside rename/delete/regenerate).

### Version History Section

- **Collapsible** (collapsed by default)
- Vertical timeline list, newest at top
- Each entry: version number, relative timestamp, auto-generated summary, size delta
- Restore entries visually distinct: "Restored from v3" with link to source

### Actions Per Version

- **View** — expand to show full manifest diff against previous version (collapsible JSON sections)
- **Download** — download that version as a standalone `.ddim`
- **Restore** — confirmation dialog → creates new version based on selected version
- **Cherry-pick** — checklist of differing sections → confirmation → creates new version with merged sections

### Compare Mode

- Select two versions via checkboxes → "Compare" button
- Side-by-side diff: added (green), removed (red), changed (yellow) per manifest section
- Asset changes show filename + size change

### Settings

- "Max versions" number input (default 5) in server settings area
- Shows current storage used by version blobs

## Garbage Collection & Edge Cases

**Blob GC:** Runs synchronously after version pruning and archive deletion. Finds blobs with `ref_count = 0`, deletes from disk and SQLite.

| Scenario | Behavior |
|----------|----------|
| First upload | v1 created, summary "Initial version", no diff |
| Identical re-upload | Detected via hash comparison, version skipped |
| Archive deleted | All versions, version_assets, and unreferenced blobs cleaned up |
| Restore | Creates v(N+1) with `restored_from` set. Summary: "Restored from v3" |
| Cherry-pick | Creates v(N+1). Summary: "Cherry-picked annotations, alignment from v2" |
| Retention pruning | Oldest first, but v1 never pruned |
| Concurrent uploads | `version_number` assigned in SQLite transaction (serialized) |
| Old version download | Streams ZIP reassembly via `archiver` (Node.js), pipes blobs into ZIP entries using paths from `version_assets.asset_path` |
| Migration (existing archives) | No backfill — version history starts empty for pre-existing archives. First re-upload creates v1. |

## Implementation Notes

### Blob unpacking lives in meta-server.js, not extract-meta.sh

The existing `extract-meta.sh` handles `.a3d`/`.a3z` metadata extraction and does not handle `.ddim`. Blob unpacking (SHA-256 hashing, content-addressable storage, ref-count updates) is best implemented in Node.js within `meta-server.js` where `crypto` and SQLite are readily available. `extract-meta.sh` is not modified by this feature.

### ZIP reassembly for old version downloads

Use the `archiver` npm package (already common in Node.js) for streaming ZIP creation. For each `version_assets` row, pipe the blob file into the archive at the stored `asset_path`. The manifest JSON from `archive_versions.manifest` is written as `manifest.json`. No full ZIP is buffered in memory.

### Server settings integration

Add `max_versions_per_archive` to the `SETTINGS_DEFAULTS` registry in `meta-server.js` (type: number, default: 5, group: "Storage", label: "Max versions per archive"). Appears in the existing admin settings page.

## Files Affected

- `docker/meta-server.js` — new endpoints, blob store logic, version diffing, GC, upload flow changes (409 → version creation)
- `docker/package.json` — add `archiver` dependency for streaming ZIP creation
- Library UI HTML/JS (new collapsible version history panel in archive details)
- Server settings (max_versions_per_archive in SETTINGS_DEFAULTS)
