# Archive Obfuscation Design

**Date:** 2026-03-13
**Status:** Draft
**Goal:** Make .ddim archives served via UUID URLs resistant to casual extraction, while preserving Range request support and backward compatibility.

## Problem

Archives are standard ZIP files served with `Content-Type: application/zip`. Even though kiosk URLs use clean `/view/{uuid}` paths, the network tab reveals fetch requests to `/archives/*.ddim` files. Anyone who downloads the file can rename it to `.zip` and extract raw 3D assets (PLY splats, GLB meshes, E57 point clouds).

## Threat Model

| Audience | Skill Level | Goal | Defense |
|----------|------------|------|---------|
| Casual user | Opens DevTools, sees URL | Download and open with 7-Zip | Surface obfuscation — unrecognizable format |
| Semi-technical | Reads minified JS | Extract assets programmatically | XOR scrambling — must reverse-engineer key and write custom tool |
| Determined reverse-engineer | Full browser debugging | Rip assets at any cost | Not fully preventable — browser must have access to render |

This is an **anti-convenience measure**, not cryptographic security. The browser must be able to render the scene, so a sufficiently motivated attacker with browser access will always win. The goal is to deter 99% of casual and semi-technical users.

## Approach: XOR Byte Scrambling

XOR the entire archive with a repeating key. The scrambled file is not a valid ZIP — no tool recognizes it. The viewer descrambles in memory after fetching.

**Why XOR works with Range requests:** XOR with a repeating key is position-independent. For any byte at position `N`, the descramble is `byte XOR key[N % keyLength]`. Each Range response chunk can be descrambled independently with no state or buffering.

## Two Scrambling Modes

The system has two distinct scrambling modes with different key derivation strategies:

### Mode 1: Scrambled-in-Transit (server-side, headerless)

For kiosk serving via `/view/{uuid}`, the server XORs archive bytes on the fly using a **deterministic key** derived from `HMAC-SHA256(ARCHIVE_SECRET, archiveHash)`, truncated to 32 bytes.

- **No header prepended** — the scrambled stream is the exact same size as the original file
- **Byte offsets are 1:1** — Range requests work identically, no offset adjustment needed
- **Key derivation is deterministic** — same archive always produces the same scrambled output, so CDN/browser caching works
- The client derives the same key using the same HMAC: it knows the app secret (baked in at build time) and the archive hash (from the URL/config injected by `/view/{uuid}`)

### Mode 2: Scrambled-on-Disk (.vdim files)

For distributable protected archives, a self-contained format with an embedded key:

**Header (48 bytes):**

```
Offset  Size  Field
0-1     2     Magic bytes: 0x56 0x44 ("VD" — Vitrine Defended)
2       1     Format version: 0x01
3       1     Key length in bytes (16 or 32)
4-7     4     Reserved (zeros)
8-39    32    Key material (random XOR key, itself XORed with app secret; zero-padded if key < 32)
40-47   8     Reserved (zeros, future use)
```

**Body:** The original ZIP archive XORed byte-for-byte with the per-archive random key. Byte offsets in the body map 1:1 to the original ZIP (offset 48 in the .vdim = offset 0 in the ZIP).

### Format Detection

The loader checks the first 2 bytes of any archive data:
- `PK` (0x50 0x4B) → plain ZIP → existing pipeline, no changes
- `VD` (0x56 0x44) → protected `.vdim` file → strip 48-byte header, extract key, descramble, then existing pipeline
- Neither → if transit scrambling is configured, assume scrambled-in-transit (no header, derive key from HMAC)
- Files shorter than 2 bytes or other unrecognized signatures → error: "Unrecognized archive format"

Legacy `.a3d`/`.a3z` files also start with `PK` and are handled by the existing plain ZIP path.

## Architecture

### New Module: `src/modules/archive-scramble.ts`

Single-purpose module for all scrambling/descrambling logic.

```typescript
// Detect format from first bytes
// transitEnabled: whether ARCHIVE_SECRET is configured — needed to distinguish
// "scrambled-in-transit" from "corrupted/unknown" when bytes are neither PK nor VD
function detectArchiveFormat(bytes: Uint8Array, transitEnabled: boolean): 'plain' | 'protected-vdim' | 'scrambled-transit';

// Derive a deterministic key for transit mode from app secret + archive hash
// Async because browser SubtleCrypto.sign() is promise-based; result is cached
// synchronously on the ArchiveLoader instance after first derivation
async function deriveTransitKey(archiveHash: string): Promise<Uint8Array>;

// Descramble a full buffer (works for both modes)
function descrambleArchive(bytes: Uint8Array, key: Uint8Array): Uint8Array;

// Descramble a .vdim file (parses header, extracts key, descrambles body)
function descrambleVdim(bytes: Uint8Array): Uint8Array;

// Descramble a chunk at a known byte offset (for Range requests, both modes)
function descrambleChunk(chunk: Uint8Array, offset: number, key: Uint8Array): Uint8Array;

// Scramble a plain ZIP into .vdim format (generates random key, prepends header, XORs content)
function scrambleArchive(bytes: Uint8Array): Uint8Array;

// Parse the 48-byte .vdim header and extract the XOR key
function parseVdimHeader(header: Uint8Array): { version: number; key: Uint8Array };
```

The **app secret** is sourced from `import.meta.env.VITE_ARCHIVE_SECRET`. For transit mode, it is used with HMAC to derive the key. For .vdim mode, it is used to encrypt/decrypt the per-archive random key in the header.

### Modified: `src/modules/archive-loader.ts`

Changes to integrate descrambling into both loading paths:

**Full download path** (`loadFromArrayBuffer`, `loadFromFile`):
1. Fetch archive → receive bytes
2. `detectArchiveFormat()` on first 2 bytes
3. If `'protected-vdim'`: `descrambleVdim()` → plain ZIP bytes
4. If `'scrambled-transit'`: `descrambleArchive(bytes, deriveTransitKey(hash))` → plain ZIP bytes
5. Existing ZIP pipeline (validate PK, index central directory, extract assets)

**Range request path** (`loadRemoteIndex` → `_parseCentralDirectory`, `extractFileBuffer`):

This is the primary kiosk loading path. `loadRemoteIndex()` uses HEAD + Range requests — it never does a full download.

For transit-scrambled archives (no header, 1:1 byte offsets):
1. HEAD request → `Content-Length` matches original file size (no offset adjustment needed)
2. `_parseCentralDirectory()` reads the last ~64KB via Range request → `descrambleChunk(chunk, offset, transitKey)` before parsing EOCD
3. `extractFileBuffer()` fetches asset byte ranges → `descrambleChunk()` before decompression
4. The transit key is derived once via `deriveTransitKey(archiveHash)` and cached on the `ArchiveLoader` instance

For .vdim files loaded via URL (unlikely but supported):
1. HEAD request → `Content-Length` = original size + 48
2. First Range request: fetch bytes 0-47 → `parseVdimHeader()` → cache key
3. All subsequent Range offsets adjusted by +48; `descrambleChunk()` applied to each response
4. `_fileSize` adjusted by -48 for central directory offset calculations

The key integration point is `_readBytes()` — it gains an optional post-fetch transform that applies `descrambleChunk()` with the cached key and correct offset.

**Local file loading (Tauri / file input):**
- Same `detectArchiveFormat()` check on first bytes
- `.vdim` files: `descrambleVdim()` then existing pipeline
- `.ddim` files: pass through unchanged
- No Range requests involved — full buffer descramble

### New Endpoint: `docker/meta-server.js`

**The `/view/{uuid}` route is NOT modified.** It continues to serve HTML with `window.__VITRINE_CLEAN_URL` injected. However, the archive URL it injects changes:

- Without `ARCHIVE_SECRET`: injects `/archives/{filename}.ddim` (current behavior)
- With `ARCHIVE_SECRET`: injects `/api/archive-stream/{hash}` (new scrambling endpoint)

**New route: `GET /api/archive-stream/{hash}`**

This endpoint streams archive bytes through the XOR transform:

1. Resolve hash → file path from SQLite (existing `archives` table lookup)
2. Derive key: `HMAC-SHA256(ARCHIVE_SECRET, hash)` truncated to 32 bytes
3. If no `Range` header: stream entire file through XOR transform via `fs.createReadStream()`, pipe through a `Transform` stream that XORs each chunk
4. If `Range` header present: parse byte range, `fs.createReadStream({ start, end })`, XOR the chunk, respond with `206 Partial Content` and `Content-Range: bytes {start}-{end}/{total}` header
5. Response headers:
   - `Content-Type: application/octet-stream`
   - `Accept-Ranges: bytes`
   - `Content-Length`: same as original file (no header, 1:1 size)
   - No `Content-Disposition` header (no filename hint)

**Key property:** Because transit mode uses no header and 1:1 byte offsets, the Range request handling is straightforward — no offset adjustment needed. The server reads bytes `N-M` from the plain file and XORs them. The client requests bytes `N-M` and descrambles them.

The archive hash is already available to the client (injected by `/view/{uuid}` in the page config or derivable from the URL path).

### Modified: `docker/nginx.conf` and `docker/nginx.conf.template`

- Change MIME type for archive extensions from `application/zip` to `application/octet-stream`
- Direct `/archives/*.ddim` paths remain accessible (editor behind auth) but no longer advertise as ZIP
- Both `nginx.conf` and `nginx.conf.template` updated for consistency

### Modified: `vite.config.ts`

- Expose `VITE_ARCHIVE_SECRET` from `process.env.ARCHIVE_SECRET` as a build-time variable
- No `KIOSK_MODULES` change needed — `archive-scramble.ts` is imported by `archive-loader.ts` (which is already in the module graph), so Vite bundles it automatically

### Modified: `src/modules/archive-creator.ts` / `export-controller.ts`

- Export dialog gains optional "Export as protected archive (.vdim)" checkbox
- When checked: create archive as normal → `scrambleArchive()` → save with `.vdim` extension
- Default: unchecked (`.ddim` remains standard internal format)

### Modified: Tauri Configs

- `tauri.conf.json` and `tauri.pass.conf.json`: add `.vdim` to file associations alongside `.ddim`
- File dialogs and drag-and-drop accept both extensions

## Secret Management

| Context | Source | Mechanism |
|---------|--------|-----------|
| Docker (server-side scrambling) | `ARCHIVE_SECRET` env var | Read by meta-server.js at runtime for HMAC key derivation |
| Vite build (browser descrambling) | `VITE_ARCHIVE_SECRET` build var | Baked into JS bundle at build time |
| Tauri build (desktop descrambling) | Same Vite build var | Baked into app bundle |

**If `ARCHIVE_SECRET` is not set:** Scrambling is disabled. `/view/{uuid}` injects the direct `/archives/` URL. Server serves plain archives. Full backward compatibility with zero configuration.

**The secret is not exposed in any settings UI.** It is a deployment-level concern — changing it would invalidate all previously distributed `.vdim` files and break in-flight transit scrambling until clients reload.

## Three Operating Modes

| Mode | When | Key Source | Header? | Range Offsets |
|------|------|-----------|---------|---------------|
| Plain `.ddim` | Editor, local dev, legacy archives | N/A | No | Unchanged |
| Scrambled-in-transit | Kiosk via `/view/{uuid}` when `ARCHIVE_SECRET` is set | HMAC(secret, hash) — deterministic | No | 1:1 (unchanged) |
| Scrambled-on-disk `.vdim` | Distributed protected files for offline Tauri use | Random per-archive key in 48-byte header | Yes (48 bytes) | +48 offset for .vdim-via-URL |

## Backward Compatibility

- All existing `.ddim` files load without change (`PK` magic byte detection)
- If `ARCHIVE_SECRET` is not set, no scrambling occurs anywhere
- Editor always reads/writes plain `.ddim` unless user explicitly exports `.vdim`
- No migration needed for existing archives on disk
- No changes to: kiosk-main.ts, config.js, theme code, annotation system, metadata

## Error Handling

- **Wrong app secret (transit mode):** Descrambled bytes fail `PK` magic byte check → specific error: "Archive descrambling failed — verify ARCHIVE_SECRET matches the server configuration"
- **Wrong app secret (.vdim):** `parseVdimHeader()` extracts garbage key → descrambled body fails `PK` check → same specific error message
- **Corrupted .vdim header:** Magic bytes present but header fields invalid (e.g., key length not 16 or 32) → error: "Invalid protected archive header"
- **Plain archive when transit expected:** If `detectArchiveFormat()` sees `PK` bytes but transit mode is configured, it loads as plain (graceful fallback for unscrambled archives on the same server)

## Testing

### New: `src/modules/__tests__/archive-scramble.test.ts`

- **Round-trip (transit):** `descrambleArchive(scrambled, key)` where scrambled = XOR(plain, key) produces original bytes
- **Round-trip (.vdim):** `scrambleArchive(plain)` → `descrambleVdim(result)` === original bytes
- **Chunk consistency:** `descrambleChunk()` at arbitrary offsets matches corresponding bytes from full-buffer descramble
- **Transit key derivation:** `deriveTransitKey(hash)` is deterministic — same inputs always produce same key
- **Format detection:** `PK` bytes → `'plain'`, `VD` bytes → `'protected-vdim'`, other bytes with transit configured → `'scrambled-transit'`
- **Header parsing:** correct version, key extraction with app secret, key lengths 16 and 32, zero-padding for 16-byte keys
- **Edge cases:** empty archive, 1-byte chunks, chunk at key length boundary, files shorter than 2 bytes
- **Wrong secret:** descramble with wrong secret → result does not start with `PK`
- **Error messages:** wrong secret produces specific "descrambling failed" error, not generic "invalid ZIP"

### Existing tests unaffected

URL validation, theme parsing, flight parsers, archive filename sanitization — none touch the scrambling layer.

## Files Changed

| File | Change Type | Description |
|------|------------|-------------|
| `src/modules/archive-scramble.ts` | New | XOR scramble/descramble, format detection, HMAC key derivation, .vdim header parsing |
| `src/modules/__tests__/archive-scramble.test.ts` | New | Test suite for scrambling module |
| `src/modules/archive-loader.ts` | Modified | Format detection, descramble integration in `_readBytes()` / `loadFromArrayBuffer()` / `loadFromFile()` |
| `src/modules/archive-pipeline.ts` | Modified | Pass archive hash to loader for transit key derivation |
| `src/modules/archive-creator.ts` | Modified | Optional `.vdim` export path |
| `src/modules/export-controller.ts` | Modified | Export dialog checkbox for protected format |
| `docker/meta-server.js` | Modified | New `/api/archive-stream/{hash}` endpoint; `/view/{uuid}` injects stream URL when secret is set |
| `docker/nginx.conf` | Modified | Content-Type change for archive paths |
| `docker/nginx.conf.template` | Modified | Same Content-Type change |
| `vite.config.ts` | Modified | `VITE_ARCHIVE_SECRET` env var |
| `src-tauri/tauri.conf.json` | Modified | `.vdim` file association |
| `src-tauri/tauri.pass.conf.json` | Modified | `.vdim` file association |
| `src/editor/index.html` | Modified | Export dialog checkbox UI |

## Security Considerations

- **This is not encryption.** XOR with a client-accessible key is obfuscation, not security. The app secret is in the JS bundle.
- **The goal is friction**, not impenetrability. A determined attacker can always intercept decrypted assets in browser memory.
- **The secret should not be committed to git.** Use `.env` files or CI/CD secrets.
- **Do not deploy source maps to production** if this feature is enabled — source maps make the `VITE_ARCHIVE_SECRET` env var name trivially searchable in the bundle.
- **The app secret is the single point of trust.** For transit mode, knowledge of the secret + archive hash is sufficient to derive the key. For .vdim files, knowledge of the secret is sufficient to extract the per-archive key from any header. Per-archive random keys in .vdim headers prevent brute-force pattern matching across archives but do not provide independent security — they are all unlockable with the same app secret.
- **HMAC-SHA256 for key derivation** ensures the transit key is cryptographically derived (not just the raw secret), making it infeasible to reverse the secret from an observed key even if the scrambling itself is simple XOR.
