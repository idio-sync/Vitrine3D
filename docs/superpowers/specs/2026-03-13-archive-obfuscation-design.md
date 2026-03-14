# Archive Obfuscation Design

**Date:** 2026-03-13
**Status:** Draft
**Goal:** Make .ddim archives served via UUID URLs resistant to casual extraction, while preserving Range request support and backward compatibility.

## Problem

Archives are standard ZIP files served with `Content-Type: application/zip`. Even though kiosk URLs use clean `/view/{uuid}` paths, the network tab reveals fetch requests to `.ddim` files. Anyone who downloads the file can rename it to `.zip` and extract raw 3D assets (PLY splats, GLB meshes, E57 point clouds).

## Threat Model

| Audience | Skill Level | Goal | Defense |
|----------|------------|------|---------|
| Casual user | Opens DevTools, sees URL | Download and open with 7-Zip | Surface obfuscation — unrecognizable format |
| Semi-technical | Reads minified JS | Extract assets programmatically | XOR scrambling — must reverse-engineer key and write custom tool |
| Determined reverse-engineer | Full browser debugging | Rip assets at any cost | Not fully preventable — browser must have access to render |

This is an **anti-convenience measure**, not cryptographic security. The browser must be able to render the scene, so a sufficiently motivated attacker with browser access will always win. The goal is to deter 99% of casual and semi-technical users.

## Approach: XOR Byte Scrambling

XOR the entire archive with a repeating key. The scrambled file is not a valid ZIP — no tool recognizes it. The viewer descrambles in memory after fetching.

**Why XOR works with Range requests:** XOR with a repeating key is position-independent. For any byte at position `N`, the descramble is `byte XOR key[(N - headerSize) % keyLength]`. Each Range response chunk can be descrambled independently with no state or buffering.

## Protected Archive Format (.vdim)

### Header (32 bytes)

```
Offset  Size  Field
0-1     2     Magic bytes: 0x56 0x44 ("VD" — Vitrine Defended)
2       1     Format version: 0x01
3       1     Key length in bytes (16 or 32)
4-7     4     Reserved (zeros)
8-31    24    Key material (random XOR key, itself XORed with app secret)
```

### Body

The remainder of the file is the original ZIP archive, XORed byte-for-byte with the repeating key. Byte offsets are preserved — the ZIP central directory, file entries, and all content are at their original positions plus the 32-byte header offset.

### Format Detection

The loader checks the first 2 bytes of any archive:
- `PK` (0x50 0x4B) → plain ZIP → existing pipeline, no changes
- `VD` (0x56 0x44) → protected archive → strip header, extract key, descramble, then existing pipeline

## Architecture

### New Module: `src/modules/archive-scramble.ts`

Single-purpose module for all scrambling/descrambling logic.

```typescript
// Detect format from first bytes
function detectArchiveFormat(bytes: Uint8Array): 'plain' | 'protected';

// Descramble a full protected archive buffer (strips header, returns plain ZIP bytes)
function descrambleArchive(bytes: Uint8Array): Uint8Array;

// Descramble a chunk at a known byte offset (for Range requests)
// offset is relative to the original ZIP content (after header)
function descrambleChunk(chunk: Uint8Array, offset: number, key: Uint8Array): Uint8Array;

// Scramble a plain ZIP into protected format (prepends header, XORs content)
function scrambleArchive(bytes: Uint8Array): Uint8Array;

// Parse the 32-byte header and extract the XOR key
function parseProtectedHeader(header: Uint8Array): { version: number; key: Uint8Array };
```

The **app secret** is a constant in this module, sourced from `import.meta.env.VITE_ARCHIVE_SECRET`. It is used solely to obscure the per-archive key stored in the header — it is not the XOR key itself.

### Modified: `src/modules/archive-loader.ts`

Minimal changes to the existing loading pipeline:

**Full download path:**
1. Fetch archive → receive bytes
2. `detectArchiveFormat()` on first 2 bytes
3. If `'protected'`: `descrambleArchive()` → plain ZIP bytes
4. Existing ZIP pipeline (validate PK, index central directory, extract assets)

**Range request path:**
1. Server prepends 32-byte header, so all byte positions shift by 32
2. First Range request: fetch bytes 0-31 to get the header → `parseProtectedHeader()` → cache key
3. Subsequent Range requests: request bytes `N+32` to `M+32`, apply `descrambleChunk(chunk, N, key)`
4. Existing central directory parsing and asset extraction

**Local file loading (Tauri / file input):**
- Same `detectArchiveFormat()` check on first bytes
- `.vdim` files: `descrambleArchive()` then existing pipeline
- `.ddim` files: pass through unchanged

### Modified: `docker/meta-server.js`

The `/view/{uuid}` route currently resolves a UUID to a file path and redirects. With obfuscation enabled:

1. Resolve UUID → file path (existing logic)
2. If `ARCHIVE_SECRET` env var is not set → redirect as today (backward compatible)
3. If set → stream the file through a XOR transform:
   - Generate or retrieve the per-archive key
   - Prepend the 32-byte VD header
   - XOR file bytes as they stream through
   - Set `Content-Type: application/octet-stream`
   - Set `Accept-Ranges: bytes`
   - Handle `Range` header: adjust for 32-byte offset, read file slice with `fs.createReadStream({ start, end })`, XOR the chunk, respond with `206 Partial Content`
   - Set `Content-Length` = original file size + 32

### Modified: `docker/nginx.conf`

- Change MIME type for archive extensions from `application/zip` to `application/octet-stream`
- Direct `/archives/*.ddim` paths remain accessible (editor behind auth) but no longer advertise as ZIP

### Modified: `vite.config.ts`

- Expose `VITE_ARCHIVE_SECRET` from `process.env.ARCHIVE_SECRET` as a build-time variable

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
| Docker (server-side scrambling) | `ARCHIVE_SECRET` env var | Read by meta-server.js at runtime |
| Vite build (browser descrambling) | `VITE_ARCHIVE_SECRET` build var | Baked into JS bundle at build time |
| Tauri build (desktop descrambling) | Same Vite build var | Baked into app bundle |

**If `ARCHIVE_SECRET` is not set:** Scrambling is disabled. Server serves plain archives. Full backward compatibility with zero configuration.

**The secret is not exposed in any settings UI.** It is a deployment-level concern — changing it would invalidate all previously distributed `.vdim` files.

## Three Operating Modes

| Mode | When | Scrambled? | Range Requests? |
|------|------|-----------|----------------|
| Plain `.ddim` | Editor, local dev, legacy archives | No | Yes (existing) |
| Scrambled-in-transit | Kiosk via `/view/{uuid}` when `ARCHIVE_SECRET` is set | Yes (server streams XOR) | Yes (offset-adjusted) |
| Scrambled-on-disk `.vdim` | Distributed protected files for offline Tauri use | Yes (file is XORed) | Yes (position-independent XOR) |

## Backward Compatibility

- All existing `.ddim` files load without change (magic byte detection)
- If `ARCHIVE_SECRET` is not set, no scrambling occurs anywhere
- Editor always reads/writes plain `.ddim` unless user explicitly exports `.vdim`
- No migration needed for existing archives on disk
- No changes to: kiosk-main.ts, config.js, theme code, annotation system, metadata

## Testing

### New: `src/modules/__tests__/archive-scramble.test.ts`

- **Round-trip:** `scrambleArchive(plain)` → `descrambleArchive(result)` === original bytes
- **Chunk consistency:** `descrambleChunk()` at arbitrary offsets matches corresponding bytes from full-buffer descramble
- **Format detection:** `PK` bytes → `'plain'`, `VD` bytes → `'protected'`, invalid → error
- **Header parsing:** correct version, key extraction with app secret, invalid header rejection
- **Edge cases:** empty archive, 1-byte chunks, chunk at key length boundary, oversized key field
- **Key isolation:** different app secrets produce different scrambled output; wrong secret fails to descramble

### Existing tests unaffected

URL validation, theme parsing, flight parsers, archive filename sanitization — none touch the scrambling layer.

## Files Changed

| File | Change Type | Description |
|------|------------|-------------|
| `src/modules/archive-scramble.ts` | New | XOR scramble/descramble, format detection, header parsing |
| `src/modules/__tests__/archive-scramble.test.ts` | New | Test suite for scrambling module |
| `src/modules/archive-loader.ts` | Modified | Format detection + descramble calls in load and Range paths |
| `src/modules/archive-creator.ts` | Modified | Optional `.vdim` export |
| `src/modules/export-controller.ts` | Modified | Export dialog checkbox for protected format |
| `docker/meta-server.js` | Modified | `/view/{uuid}` streams through XOR transform |
| `docker/nginx.conf` | Modified | Content-Type change for archive paths |
| `vite.config.ts` | Modified | `VITE_ARCHIVE_SECRET` env var |
| `src-tauri/tauri.conf.json` | Modified | `.vdim` file association |
| `src-tauri/tauri.pass.conf.json` | Modified | `.vdim` file association |
| `src/editor/index.html` | Modified | Export dialog checkbox UI |

## Security Considerations

- **This is not encryption.** XOR with a client-accessible key is obfuscation, not security. The app secret is in the JS bundle.
- **The goal is friction**, not impenetrability. A determined attacker can always intercept decrypted assets in browser memory.
- **The secret should not be committed to git.** Use `.env` files or CI/CD secrets.
- **Per-archive random keys** (stored in the header) mean that even if one archive's key is extracted, it doesn't help with others — the attacker still needs the app secret for each header.
