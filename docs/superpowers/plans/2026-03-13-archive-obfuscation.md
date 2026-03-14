# Archive Obfuscation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** XOR-scramble archives served via UUID URLs so downloaded files are not recognizable as ZIPs, while preserving Range request support and backward compatibility with plain .ddim files.

**Architecture:** Two scrambling modes — headerless transit mode (server XORs on the fly, deterministic HMAC key, 1:1 byte offsets) and on-disk .vdim mode (48-byte header with embedded per-archive key). A new `archive-scramble.ts` module handles all XOR logic. `archive-loader.ts` gains format detection + descramble hooks. `meta-server.js` gets a new `/api/archive-stream/{hash}` endpoint.

**Tech Stack:** Web Crypto API (SubtleCrypto HMAC-SHA256), Node.js `crypto.createHmac`, fflate (existing), Vite env vars.

**Spec:** [2026-03-13-archive-obfuscation-design.md](../specs/2026-03-13-archive-obfuscation-design.md)

---

## File Structure

| File | Type | Responsibility |
|------|------|---------------|
| `src/modules/archive-scramble.ts` | New | XOR scramble/descramble, format detection, HMAC key derivation, .vdim header parse/create |
| `src/modules/__tests__/archive-scramble.test.ts` | New | Unit tests for all scramble module functions |
| `src/modules/archive-loader.ts` | Modify | Format detection in load paths, `_readBytes()` descramble transform, transit key caching |
| `src/modules/archive-pipeline.ts` | Modify | Pass archive hash to loader for transit key derivation |
| `src/modules/archive-creator.ts` | Modify | Add `scrambleArchive()` call for .vdim export |
| `src/modules/export-controller.ts` | Modify | Wire protected export checkbox to archive creator |
| `src/editor/index.html` | Modify | Add "Export as protected (.vdim)" checkbox in export panel |
| `docker/meta-server.js` | Modify | New `/api/archive-stream/{hash}` endpoint; modify `/view/` URL injection |
| `docker/nginx.conf` | Modify | Change archive Content-Type to `application/octet-stream` |
| `docker/nginx.conf.template` | Modify | Same Content-Type change |
| `vite.config.ts` | Modify | Add `VITE_ARCHIVE_SECRET` define |
| `src-tauri/tauri.conf.json` | Modify | Add `.vdim` file association |
| `src-tauri/tauri.pass.conf.json` | Modify | Add `.vdim` file association |

---

## Chunk 1: Core Scramble Module + Tests

### Task 1: Create `archive-scramble.ts` with XOR primitives

**Files:**
- Create: `src/modules/archive-scramble.ts`

- [ ] **Step 1: Create the module with constants and logger**

```typescript
// src/modules/archive-scramble.ts
import { Logger } from './utilities.js';

const log = Logger.getLogger('archive-scramble');

// .vdim header constants
export const VDIM_MAGIC = new Uint8Array([0x56, 0x44]); // "VD"
export const VDIM_VERSION = 0x01;
export const VDIM_HEADER_SIZE = 48;
export const VDIM_KEY_OFFSET = 8;
export const VDIM_KEY_FIELD_SIZE = 32;

// ZIP magic bytes for validation after descramble
const ZIP_MAGIC = new Uint8Array([0x50, 0x4B]);

// App secret from build-time env var (empty string = disabled)
const APP_SECRET = import.meta.env.VITE_ARCHIVE_SECRET || '';

export type ArchiveFormat = 'plain' | 'protected-vdim' | 'scrambled-transit';
```

- [ ] **Step 2: Implement `detectArchiveFormat()`**

```typescript
/**
 * Detect archive format from the first bytes.
 * transitEnabled: whether ARCHIVE_SECRET is configured — needed to distinguish
 * "scrambled-in-transit" from "corrupted/unknown" when bytes are neither PK nor VD.
 */
export function detectArchiveFormat(bytes: Uint8Array, transitEnabled: boolean): ArchiveFormat {
    if (bytes.length < 2) {
        throw new Error('Unrecognized archive format: file too short');
    }
    // Plain ZIP (PK magic) — includes .ddim, .a3d, .a3z
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
        return 'plain';
    }
    // .vdim protected archive (VD magic)
    if (bytes[0] === 0x56 && bytes[1] === 0x44) {
        return 'protected-vdim';
    }
    // If transit scrambling is configured, assume scrambled-in-transit
    if (transitEnabled) {
        return 'scrambled-transit';
    }
    throw new Error('Unrecognized archive format');
}
```

- [ ] **Step 3: Implement `xorBytes()` and `descrambleChunk()`**

```typescript
/**
 * XOR a byte array with a repeating key at a given offset.
 * Operates in-place for performance; returns the same array.
 */
function xorBytes(data: Uint8Array, key: Uint8Array, offset: number): Uint8Array {
    const keyLen = key.length;
    for (let i = 0; i < data.length; i++) {
        data[i] ^= key[(offset + i) % keyLen];
    }
    return data;
}

/**
 * Descramble a chunk at a known byte offset.
 * Returns a NEW Uint8Array (does not mutate input).
 */
export function descrambleChunk(chunk: Uint8Array, offset: number, key: Uint8Array): Uint8Array {
    const result = new Uint8Array(chunk);
    return xorBytes(result, key, offset);
}
```

- [ ] **Step 4: Implement `deriveTransitKey()`**

```typescript
/**
 * Derive a deterministic 32-byte XOR key for transit mode.
 * Uses HMAC-SHA256(APP_SECRET, archiveHash).
 * Async because browser SubtleCrypto is promise-based.
 */
export async function deriveTransitKey(archiveHash: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const secretBytes = encoder.encode(APP_SECRET);
    const hashBytes = encoder.encode(archiveHash);

    const cryptoKey = await crypto.subtle.importKey(
        'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, hashBytes);
    return new Uint8Array(signature); // 32 bytes (SHA-256 output)
}

/** Whether transit scrambling is enabled (app secret is configured). */
export function isTransitEnabled(): boolean {
    return APP_SECRET.length > 0;
}
```

- [ ] **Step 5: Implement `parseVdimHeader()`**

```typescript
/**
 * Parse a 48-byte .vdim header and extract the XOR key.
 * The key material in the header is XORed with a key derived from APP_SECRET.
 */
export async function parseVdimHeader(header: Uint8Array): Promise<{ version: number; key: Uint8Array }> {
    if (header.length < VDIM_HEADER_SIZE) {
        throw new Error('Invalid protected archive header: too short');
    }
    if (header[0] !== 0x56 || header[1] !== 0x44) {
        throw new Error('Invalid protected archive header: bad magic bytes');
    }

    const version = header[2];
    const keyLength = header[3];
    if (keyLength !== 16 && keyLength !== 32) {
        throw new Error('Invalid protected archive header: key length must be 16 or 32');
    }

    // Extract key material and un-XOR it with a key derived from APP_SECRET
    const encryptedKey = header.slice(VDIM_KEY_OFFSET, VDIM_KEY_OFFSET + keyLength);
    const secretDerivedKey = await deriveTransitKey('vdim-header-key');
    const key = new Uint8Array(keyLength);
    for (let i = 0; i < keyLength; i++) {
        key[i] = encryptedKey[i] ^ secretDerivedKey[i];
    }

    return { version, key };
}
```

- [ ] **Step 6: Implement `descrambleArchive()` and `descrambleVdim()`**

```typescript
/**
 * Descramble a full buffer with a known key. Returns plain ZIP bytes.
 */
export function descrambleArchive(bytes: Uint8Array, key: Uint8Array): Uint8Array {
    const result = new Uint8Array(bytes);
    xorBytes(result, key, 0);

    // Validate descrambled output starts with PK
    if (result[0] !== 0x50 || result[1] !== 0x4B) {
        throw new Error('Archive descrambling failed — verify ARCHIVE_SECRET matches the server configuration');
    }
    return result;
}

/**
 * Descramble a .vdim file: parse header, extract key, descramble body.
 */
export async function descrambleVdim(bytes: Uint8Array): Promise<Uint8Array> {
    const headerBytes = bytes.slice(0, VDIM_HEADER_SIZE);
    const { key } = await parseVdimHeader(headerBytes);

    const body = bytes.slice(VDIM_HEADER_SIZE);
    return descrambleArchive(body, key);
}
```

- [ ] **Step 7: Implement `scrambleArchive()` for .vdim export**

```typescript
/**
 * Scramble a plain ZIP into .vdim format.
 * Generates a random 32-byte key, XORs the content, prepends 48-byte header.
 */
export async function scrambleArchive(plainZip: Uint8Array): Promise<Uint8Array> {
    // Validate input is a ZIP
    if (plainZip[0] !== 0x50 || plainZip[1] !== 0x4B) {
        throw new Error('Cannot scramble: input is not a valid ZIP file');
    }

    // Generate random 32-byte key
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);

    // Encrypt the key with APP_SECRET-derived key for header storage
    const secretDerivedKey = await deriveTransitKey('vdim-header-key');
    const encryptedKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        encryptedKey[i] = key[i] ^ secretDerivedKey[i];
    }

    // Build 48-byte header
    const header = new Uint8Array(VDIM_HEADER_SIZE);
    header[0] = 0x56; // V
    header[1] = 0x44; // D
    header[2] = VDIM_VERSION;
    header[3] = 32; // key length
    // bytes 4-7: reserved (zeros)
    header.set(encryptedKey, VDIM_KEY_OFFSET);
    // bytes 40-47: reserved (zeros)

    // XOR the ZIP content
    const scrambled = new Uint8Array(plainZip);
    xorBytes(scrambled, key, 0);

    // Concatenate header + scrambled body
    const result = new Uint8Array(VDIM_HEADER_SIZE + scrambled.length);
    result.set(header);
    result.set(scrambled, VDIM_HEADER_SIZE);
    return result;
}
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/archive-scramble.ts
git commit -m "feat(archive): add XOR scramble/descramble module

Core archive-scramble.ts with format detection, HMAC key derivation,
.vdim header parsing, and scramble/descramble for both transit and
on-disk modes."
```

---

### Task 2: Write tests for `archive-scramble.ts`

**Files:**
- Create: `src/modules/__tests__/archive-scramble.test.ts`

- [ ] **Step 1: Write test setup and format detection tests**

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock import.meta.env before importing the module
vi.stubEnv('VITE_ARCHIVE_SECRET', 'test-secret-key-for-unit-tests');

const {
    detectArchiveFormat,
    descrambleChunk,
    deriveTransitKey,
    parseVdimHeader,
    descrambleArchive,
    descrambleVdim,
    scrambleArchive,
    isTransitEnabled,
    VDIM_HEADER_SIZE,
    VDIM_MAGIC,
} = await import('../archive-scramble.js');

// Helper: create a minimal valid ZIP (just PK magic + padding)
function fakeZip(size = 64): Uint8Array {
    const data = new Uint8Array(size);
    data[0] = 0x50; // P
    data[1] = 0x4B; // K
    return data;
}

describe('detectArchiveFormat', () => {
    it('detects plain ZIP (PK magic)', () => {
        expect(detectArchiveFormat(fakeZip(), false)).toBe('plain');
    });

    it('detects .vdim (VD magic)', () => {
        const vdim = new Uint8Array([0x56, 0x44, 0x01, 0x20]);
        expect(detectArchiveFormat(vdim, false)).toBe('protected-vdim');
    });

    it('detects scrambled-transit when transit enabled', () => {
        const scrambled = new Uint8Array([0xAA, 0xBB, 0xCC]);
        expect(detectArchiveFormat(scrambled, true)).toBe('scrambled-transit');
    });

    it('throws on unknown format when transit disabled', () => {
        const unknown = new Uint8Array([0xAA, 0xBB]);
        expect(() => detectArchiveFormat(unknown, false)).toThrow('Unrecognized archive format');
    });

    it('throws on files shorter than 2 bytes', () => {
        expect(() => detectArchiveFormat(new Uint8Array([0x50]), false)).toThrow('too short');
    });

    it('handles legacy .a3d/.a3z as plain (PK magic)', () => {
        expect(detectArchiveFormat(fakeZip(), true)).toBe('plain');
    });
});
```

- [ ] **Step 2: Run tests to verify format detection passes**

Run: `npx vitest run src/modules/__tests__/archive-scramble.test.ts`
Expected: all format detection tests PASS

- [ ] **Step 3: Write XOR chunk and round-trip tests**

```typescript
describe('descrambleChunk', () => {
    it('XORs bytes with key at correct offset', () => {
        const key = new Uint8Array([0xFF, 0x00, 0xAA, 0x55]);
        const data = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
        const result = descrambleChunk(data, 0, key);
        expect(result[0]).toBe(0x12 ^ 0xFF);
        expect(result[1]).toBe(0x34 ^ 0x00);
        expect(result[2]).toBe(0x56 ^ 0xAA);
        expect(result[3]).toBe(0x78 ^ 0x55);
    });

    it('handles offset wrapping around key length', () => {
        const key = new Uint8Array([0xFF, 0x00]);
        const data = new Uint8Array([0x12, 0x34]);
        // offset=3 means key index starts at 3%2=1
        const result = descrambleChunk(data, 3, key);
        expect(result[0]).toBe(0x12 ^ 0x00); // key[1]
        expect(result[1]).toBe(0x34 ^ 0xFF); // key[0]
    });

    it('does not mutate the input array', () => {
        const key = new Uint8Array([0xFF]);
        const data = new Uint8Array([0x12]);
        const original = data[0];
        descrambleChunk(data, 0, key);
        expect(data[0]).toBe(original);
    });

    it('chunk descramble matches full-buffer descramble at same positions', () => {
        const key = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
        const full = fakeZip(100);
        // Scramble full buffer
        const scrambled = new Uint8Array(full);
        for (let i = 0; i < scrambled.length; i++) {
            scrambled[i] ^= key[i % key.length];
        }
        // Descramble chunk at offset 20, length 30
        const chunk = scrambled.slice(20, 50);
        const descrambledChunk = descrambleChunk(chunk, 20, key);
        expect(descrambledChunk).toEqual(full.slice(20, 50));
    });

    it('handles 1-byte chunks', () => {
        const key = new Uint8Array([0xAB, 0xCD]);
        const data = new Uint8Array([0x12]);
        const result = descrambleChunk(data, 5, key);
        expect(result[0]).toBe(0x12 ^ key[5 % 2]);
    });

    it('handles empty chunks', () => {
        const key = new Uint8Array([0xFF]);
        const result = descrambleChunk(new Uint8Array(0), 0, key);
        expect(result.length).toBe(0);
    });
});

describe('descrambleArchive', () => {
    it('round-trips: XOR then descramble produces original', () => {
        const key = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
        const plain = fakeZip(200);
        // Scramble
        const scrambled = new Uint8Array(plain);
        for (let i = 0; i < scrambled.length; i++) {
            scrambled[i] ^= key[i % key.length];
        }
        const result = descrambleArchive(scrambled, key);
        expect(result).toEqual(plain);
    });

    it('throws when descrambled bytes lack PK magic (wrong key)', () => {
        const wrongKey = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
        const scrambled = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);
        expect(() => descrambleArchive(scrambled, wrongKey)).toThrow('descrambling failed');
    });
});
```

- [ ] **Step 4: Write transit key derivation tests**

```typescript
describe('deriveTransitKey', () => {
    it('returns a 32-byte Uint8Array', async () => {
        const key = await deriveTransitKey('some-hash');
        expect(key).toBeInstanceOf(Uint8Array);
        expect(key.length).toBe(32);
    });

    it('is deterministic — same input produces same key', async () => {
        const key1 = await deriveTransitKey('abc123');
        const key2 = await deriveTransitKey('abc123');
        expect(key1).toEqual(key2);
    });

    it('different hashes produce different keys', async () => {
        const key1 = await deriveTransitKey('hash-a');
        const key2 = await deriveTransitKey('hash-b');
        expect(key1).not.toEqual(key2);
    });
});

describe('isTransitEnabled', () => {
    it('returns true when VITE_ARCHIVE_SECRET is set', () => {
        expect(isTransitEnabled()).toBe(true);
    });
});
```

- [ ] **Step 5: Write .vdim header and scramble/descramble tests**

```typescript
describe('scrambleArchive + descrambleVdim round-trip', () => {
    it('round-trips: scramble then descramble produces original', async () => {
        const plain = fakeZip(500);
        const vdim = await scrambleArchive(plain);
        // Should start with VD magic
        expect(vdim[0]).toBe(0x56);
        expect(vdim[1]).toBe(0x44);
        // Should be headerSize + original length
        expect(vdim.length).toBe(VDIM_HEADER_SIZE + plain.length);
        // Round-trip
        const restored = await descrambleVdim(vdim);
        expect(restored).toEqual(plain);
    });

    it('scrambled body is not a valid ZIP', async () => {
        const plain = fakeZip(100);
        const vdim = await scrambleArchive(plain);
        const body = vdim.slice(VDIM_HEADER_SIZE);
        // Body should NOT start with PK
        expect(body[0] === 0x50 && body[1] === 0x4B).toBe(false);
    });
});

describe('parseVdimHeader', () => {
    it('rejects headers shorter than 48 bytes', async () => {
        await expect(parseVdimHeader(new Uint8Array(10))).rejects.toThrow('too short');
    });

    it('rejects bad magic bytes', async () => {
        const bad = new Uint8Array(VDIM_HEADER_SIZE);
        bad[0] = 0x00;
        await expect(parseVdimHeader(bad)).rejects.toThrow('bad magic');
    });

    it('rejects invalid key lengths', async () => {
        const bad = new Uint8Array(VDIM_HEADER_SIZE);
        bad[0] = 0x56; bad[1] = 0x44; bad[2] = 0x01;
        bad[3] = 24; // invalid — must be 16 or 32
        await expect(parseVdimHeader(bad)).rejects.toThrow('key length must be 16 or 32');
    });

    it('extracts correct version from valid header', async () => {
        const plain = fakeZip(100);
        const vdim = await scrambleArchive(plain);
        const { version } = await parseVdimHeader(vdim.slice(0, VDIM_HEADER_SIZE));
        expect(version).toBe(1);
    });
});

describe('error messages', () => {
    it('wrong secret produces specific error, not generic ZIP error', () => {
        const garbage = new Uint8Array(100);
        crypto.getRandomValues(garbage);
        const wrongKey = new Uint8Array(32);
        expect(() => descrambleArchive(garbage, wrongKey)).toThrow('descrambling failed');
    });
});
```

- [ ] **Step 6: Run full test suite to verify all pass**

Run: `npx vitest run src/modules/__tests__/archive-scramble.test.ts`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/__tests__/archive-scramble.test.ts
git commit -m "test(archive): add archive-scramble unit tests

Round-trip, chunk consistency, format detection, header parsing,
transit key derivation, error messages, and edge cases."
```

---

## Chunk 2: Vite Config + Client-Side Integration

### Task 3: Add `VITE_ARCHIVE_SECRET` to Vite config

**Files:**
- Modify: `vite.config.ts:99-103`

- [ ] **Step 1: Add the env var to the `define` block**

In `vite.config.ts`, add `VITE_ARCHIVE_SECRET` to the existing `define` object at line 99:

```typescript
define: {
    'import.meta.env.VITE_APP_LIBRARY_URL': JSON.stringify(
        process.env.SITE_URL || 'https://jakemarino.fyi'
    ),
    'import.meta.env.VITE_ARCHIVE_SECRET': JSON.stringify(
        process.env.ARCHIVE_SECRET || ''
    ),
},
```

**Note:** Do NOT add `archive-scramble.ts` to the `KIOSK_MODULES` array. The bundled kiosk entry picks it up automatically via the import graph. The deprecated offline kiosk viewer's standalone module compilation will have an unresolved import — this is acceptable since the offline viewer is deprecated.

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build`
Expected: build completes without errors

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "build: expose ARCHIVE_SECRET as Vite build-time variable"
```

---

### Task 4: Integrate descrambling into `archive-loader.ts`

**Files:**
- Modify: `src/modules/archive-loader.ts:1-16` (imports)
- Modify: `src/modules/archive-loader.ts:270-282` (`loadFromFile`)
- Modify: `src/modules/archive-loader.ts:388-400` (`loadFromArrayBuffer`)
- Modify: `src/modules/archive-loader.ts:411-447` (`_readBytes`)
- Modify: `src/modules/archive-loader.ts:332-357` (`loadRemoteIndex`)

- [ ] **Step 1: Add imports and scramble state to `ArchiveLoader` class**

At the top of `archive-loader.ts`, add the import:

```typescript
import {
    detectArchiveFormat,
    descrambleChunk,
    descrambleVdim,
    descrambleArchive,
    deriveTransitKey,
    isTransitEnabled,
    VDIM_HEADER_SIZE,
    type ArchiveFormat,
} from './archive-scramble.js';
```

Add `'vdim'` to the `_ARCHIVE_EXTENSIONS` array (line 16) so `.vdim` files pass input filters:

```typescript
const _ARCHIVE_EXTENSIONS = ['ddim', 'a3d', 'a3z', 'zip', 'vdim'];
```

Add instance properties to the `ArchiveLoader` class for scramble state:

```typescript
private _scrambleKey: Uint8Array | null = null;
private _archiveFormat: ArchiveFormat = 'plain';
private _vdimOffset: number = 0; // 48 for .vdim-via-URL, 0 otherwise
```

- [ ] **Step 2: Add `setTransitHash()` method**

Add a public method for the pipeline to provide the archive hash before loading:

```typescript
/**
 * Set the archive hash for transit key derivation.
 * Must be called before loadRemoteIndex() if transit scrambling is enabled.
 */
async setTransitHash(archiveHash: string): Promise<void> {
    if (!isTransitEnabled()) return;
    this._scrambleKey = await deriveTransitKey(archiveHash);
    log.info('Transit descramble key derived for hash:', archiveHash);
}
```

- [ ] **Step 3: Modify `_readBytes()` to apply descrambling**

After the existing `_readBytes()` returns raw bytes from any source (File, rawData, IPC, URL), add a descramble step. Wrap the URL fetch branch to descramble Range response chunks:

In the `_readBytes` method, after the existing `if (this._url)` branch that returns bytes (around line 431), add descrambling. The cleanest approach: add a private method `_descrambleIfNeeded()` and call it at the end of `_readBytes()`:

```typescript
private _descrambleIfNeeded(data: Uint8Array, offset: number): Uint8Array {
    if (!this._scrambleKey || this._archiveFormat === 'plain') return data;
    // For transit: 1:1 offsets, just XOR
    // For vdim-via-URL: offset is already adjusted by caller
    return descrambleChunk(data, offset - this._vdimOffset, this._scrambleKey);
}
```

Call `_descrambleIfNeeded()` as the **last step** of `_readBytes()` unconditionally, regardless of which branch produced the data. For `_rawData` and `_file` branches with `_archiveFormat === 'plain'`, the guard returns early (no-op). This also handles the 200-fallback edge case: when the server ignores Range headers and returns a full download (lines 439-442), `_readBytes` stores the **still-scrambled** bytes in `_rawData`. Without universal descrambling, all subsequent subarray reads from `_rawData` would return scrambled data.

**Critical:** In the 200-fallback path (line 440), descramble the full buffer before storing:

```typescript
// In the _url branch, 200 fallback:
this._rawData = new Uint8Array(await resp.arrayBuffer());
if (this._scrambleKey && this._archiveFormat !== 'plain') {
    this._rawData = descrambleArchive(this._rawData, this._scrambleKey);
    this._archiveFormat = 'plain'; // now descrambled, no further transform needed
}
this._url = null;
return this._rawData.subarray(offset, offset + length);
```

- [ ] **Step 4: Modify `loadFromArrayBuffer()` to detect format and descramble**

Replace the PK magic check (lines 390-393) with format detection:

```typescript
async loadFromArrayBuffer(arrayBuffer: ArrayBuffer): Promise<void> {
    const bytes = new Uint8Array(arrayBuffer);
    const format = detectArchiveFormat(bytes, isTransitEnabled());

    let plainBytes: Uint8Array;
    if (format === 'protected-vdim') {
        plainBytes = await descrambleVdim(bytes);
    } else if (format === 'scrambled-transit' && this._scrambleKey) {
        plainBytes = descrambleArchive(bytes, this._scrambleKey);
    } else if (format === 'plain') {
        plainBytes = bytes;
    } else {
        throw new Error('Invalid archive: Not a valid ZIP file');
    }

    this._rawData = plainBytes;
    this._file = null;
    this._fileCache = new Map();
    await this._parseCentralDirectory();
}
```

- [ ] **Step 5: Modify `loadFromFile()` to detect format**

Replace the PK magic check (lines 272-275) with format detection:

```typescript
async loadFromFile(file: File): Promise<void> {
    const header = new Uint8Array(await file.slice(0, VDIM_HEADER_SIZE).arrayBuffer());
    const format = detectArchiveFormat(header, isTransitEnabled());

    if (format === 'protected-vdim') {
        // Full-buffer load for .vdim files
        const fullBuffer = new Uint8Array(await file.arrayBuffer());
        const plainBytes = await descrambleVdim(fullBuffer);
        this._rawData = plainBytes;
        this._file = null;
        this._fileCache = new Map();
        await this._parseCentralDirectory();
        return;
    }

    if (format !== 'plain') {
        throw new Error('Invalid archive: Not a valid ZIP file');
    }

    // Existing plain ZIP path
    this._file = file;
    this._rawData = null;
    this._fileCache = new Map();
    await this._parseCentralDirectory();
}
```

- [ ] **Step 6: Modify `loadRemoteIndex()` to handle transit scrambling**

In `loadRemoteIndex()` (line 332), after setting `this._fileSize`, configure the scramble state so that `_readBytes()` descrambles Range response chunks:

```typescript
async loadRemoteIndex(url: string): Promise<number> {
    // ... existing HEAD request code ...

    this._url = url;
    this._fileSize = size;
    this._file = null;
    this._rawData = null;
    this._fileCache = new Map();

    // If transit key was pre-derived via setTransitHash(), mark format
    if (this._scrambleKey && isTransitEnabled()) {
        this._archiveFormat = 'scrambled-transit';
    }

    await this._parseCentralDirectory();
    return size;
}
```

- [ ] **Step 7: Verify build succeeds**

Run: `npm run build`
Expected: build completes without errors

- [ ] **Step 8: Run existing tests to check for regressions**

Run: `npm test`
Expected: all existing tests still pass

- [ ] **Step 9: Commit**

```bash
git add src/modules/archive-loader.ts
git commit -m "feat(archive): integrate XOR descrambling into archive-loader

Format detection in loadFromFile/loadFromArrayBuffer, transit key
caching, descramble transform in _readBytes for Range request path.
Plain .ddim files pass through unchanged."
```

---

### Task 5: Pass archive hash from pipeline to loader

**Files:**
- Modify: `src/modules/archive-pipeline.ts`

- [ ] **Step 1: Find where `loadRemoteIndex()` is called and add hash derivation**

In `archive-pipeline.ts`, find where `ArchiveLoader` is created and `loadRemoteIndex()` is called. Before that call, derive the archive hash from the URL and call `setTransitHash()`:

```typescript
import { isTransitEnabled } from './archive-scramble.js';

// Before loadRemoteIndex():
if (isTransitEnabled()) {
    // Extract hash from URL — e.g., /api/archive-stream/{hash} → hash
    const hashMatch = url.match(/\/api\/archive-stream\/([a-f0-9]+)/);
    if (hashMatch) {
        await archiveLoader.setTransitHash(hashMatch[1]);
    }
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build`
Expected: build completes without errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/archive-pipeline.ts
git commit -m "feat(archive): pass archive hash to loader for transit key derivation"
```

---

## Chunk 3: Server-Side Scrambling

### Task 6: Add `/api/archive-stream/{hash}` endpoint to meta-server

**Files:**
- Modify: `docker/meta-server.js`

- [ ] **Step 1: Add HMAC key derivation function near the top of meta-server.js**

`crypto` is already imported at line 30 of meta-server.js — do NOT add a duplicate require. Add only the secret and derivation function:

```javascript
const ARCHIVE_SECRET = process.env.ARCHIVE_SECRET || '';

/**
 * Derive a 32-byte XOR key for archive scrambling.
 * HMAC-SHA256(ARCHIVE_SECRET, archiveHash) — deterministic.
 */
function deriveArchiveKey(archiveHash) {
    return crypto.createHmac('sha256', ARCHIVE_SECRET).update(archiveHash).digest();
    // Returns a 32-byte Buffer
}
```

- [ ] **Step 2: Implement the XOR Transform stream**

```javascript
const { Transform } = require('stream');

/**
 * Create a Transform stream that XORs all bytes with a repeating key.
 * @param {Buffer} key - The XOR key
 * @param {number} startOffset - Byte offset for key alignment (for Range requests)
 */
function createXorTransform(key, startOffset = 0) {
    let position = startOffset;
    return new Transform({
        transform(chunk, encoding, callback) {
            const output = Buffer.alloc(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
                output[i] = chunk[i] ^ key[(position + i) % key.length];
            }
            position += chunk.length;
            callback(null, output);
        }
    });
}
```

- [ ] **Step 3: Implement the `/api/archive-stream/{hash}` route handler**

```javascript
function handleArchiveStream(req, res, hash) {
    if (!ARCHIVE_SECRET) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Archive streaming not configured');
        return;
    }

    const row = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
    if (!row) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Archive not found');
        return;
    }

    const filePath = path.join(ARCHIVES_DIR, row.filename);
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const key = deriveArchiveKey(hash);

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
        // Parse Range: bytes=start-end
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (!match) {
            res.writeHead(416, { 'Content-Type': 'text/plain' });
            res.end('Invalid Range header');
            return;
        }
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize || start > end) {
            res.writeHead(416, {
                'Content-Range': `bytes */${fileSize}`,
                'Content-Type': 'text/plain'
            });
            res.end('Range not satisfiable');
            return;
        }

        const chunkSize = end - start + 1;
        res.writeHead(206, {
            'Content-Type': 'application/octet-stream',
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': chunkSize,
            'Accept-Ranges': 'bytes',
        });
        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(createXorTransform(key, start)).pipe(res);
    } else {
        // Full download
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': fileSize,
            'Accept-Ranges': 'bytes',
        });
        const stream = fs.createReadStream(filePath);
        stream.pipe(createXorTransform(key, 0)).pipe(res);
    }
}
```

- [ ] **Step 4: Register the route in the request handler**

Find the existing URL routing section in meta-server.js and add:

```javascript
// Archive stream endpoint (XOR scrambled)
if (pathname.startsWith('/api/archive-stream/')) {
    const hash = pathname.slice('/api/archive-stream/'.length);
    return handleArchiveStream(req, res, hash);
}
```

- [ ] **Step 5: Modify `handleViewArchive()` and `handleViewArchiveByUuid()` to inject stream URL**

In both `handleViewArchive()` (line 2483) and `handleViewArchiveByUuid()` (line 2531), change the `archiveUrl` when `ARCHIVE_SECRET` is set:

```javascript
const archiveUrl = ARCHIVE_SECRET
    ? '/api/archive-stream/' + row.hash
    : '/archives/' + row.filename;
```

- [ ] **Step 6: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(server): add /api/archive-stream endpoint for XOR scrambled serving

Streams archive bytes through XOR transform with HMAC-derived key.
Supports Range requests with correct byte alignment.
/view/ routes inject stream URL when ARCHIVE_SECRET is configured."
```

---

### Task 7: Update nginx Content-Type for archives

**Files:**
- Modify: `docker/nginx.conf:37-45`
- Modify: `docker/nginx.conf.template`

- [ ] **Step 1: Change Content-Type in `nginx.conf`**

Replace the archive types block (lines 37-45):

```nginx
    # Serve archive files (.ddim, .a3d, .a3z) — no ZIP content-type hint
    location ~* \.(ddim|a3d|a3z)$ {
        expires 1d;
        add_header Cache-Control "public";
        types {
            application/octet-stream ddim a3d a3z;
        }
    }
```

- [ ] **Step 2: Make the same change in `nginx.conf.template`**

Apply the identical change to `docker/nginx.conf.template`.

- [ ] **Step 3: Commit**

```bash
git add docker/nginx.conf docker/nginx.conf.template
git commit -m "fix(server): serve archives as application/octet-stream

Prevents browsers from recognizing archives as ZIP files in the
network tab."
```

---

## Chunk 4: Export + Tauri Integration

### Task 8: Add .vdim export option to editor

**Files:**
- Modify: `src/editor/index.html:2869-2878`
- Modify: `src/modules/export-controller.ts:188-191`
- Modify: `src/modules/archive-creator.ts:466-468, 2092-2102`

- [ ] **Step 1: Add .vdim radio option to export panel HTML**

In `src/editor/index.html`, after the `.zip` radio button (around line 2878), add:

```html
<div class="radio-row">
    <input type="radio" name="export-format" value="vdim" id="fmt-vdim">
    <label for="fmt-vdim">.vdim (Protected Archive)</label>
</div>
```

- [ ] **Step 2: Add `'vdim'` to the format type in archive-creator.ts**

In `src/modules/archive-creator.ts`, update the `CreateArchiveOptions` interface (line 466):

```typescript
export interface CreateArchiveOptions {
    format?: 'ddim' | 'zip' | 'vdim';
    includeHashes?: boolean;
}
```

- [ ] **Step 3: Add `'vdim'` to `PreparedArchive` and fix `prepareArchive()` in export-controller.ts**

In `src/modules/export-controller.ts`, update the interface (line 190):

```typescript
interface PreparedArchive {
    filename: string;
    format: 'ddim' | 'zip' | 'vdim';
    includeHashes: boolean;
}
```

**Critical:** Also update the format coercion in `prepareArchive()` (around line 237). The current code silently maps any non-`'zip'` value to `'ddim'`, which would swallow the `'vdim'` radio selection:

```typescript
// Before (line ~237):
const format = (formatRadio?.value === 'zip' ? 'zip' : 'ddim') as 'ddim' | 'zip';

// After:
const formatValue = formatRadio?.value;
const format = (formatValue === 'zip' ? 'zip' : formatValue === 'vdim' ? 'vdim' : 'ddim') as 'ddim' | 'zip' | 'vdim';
```

- [ ] **Step 4: Modify `downloadArchive()` in archive-creator.ts to scramble for .vdim**

In `src/modules/archive-creator.ts`, in the `downloadArchive()` method (around line 2092), after creating the blob, add scrambling for .vdim:

```typescript
import { scrambleArchive } from './archive-scramble.js';

// In downloadArchive(), after creating the blob:
async downloadArchive(options: DownloadArchiveOptions = {}, onProgress: ((percent: number, stage: string) => void) | null = null): Promise<void> {
    const {
        filename = 'archive',
        format = 'ddim',
        ...createOptions
    } = options;

    const blob = await this.createArchive(
        { format: format === 'vdim' ? 'ddim' : format, ...createOptions },
        onProgress
    );

    let finalBlob = blob;
    let ext = format === 'zip' ? '.zip' : '.ddim';

    if (format === 'vdim') {
        const plainBytes = new Uint8Array(await blob.arrayBuffer());
        const scrambledBytes = await scrambleArchive(plainBytes);
        finalBlob = new Blob([scrambledBytes], { type: 'application/octet-stream' });
        ext = '.vdim';
    }

    // Use finalBlob and ext for the download link...
```

- [ ] **Step 5: Verify build succeeds**

Run: `npm run build`
Expected: build completes without errors

- [ ] **Step 6: Commit**

```bash
git add src/editor/index.html src/modules/archive-creator.ts src/modules/export-controller.ts
git commit -m "feat(export): add .vdim protected archive export option

New radio button in export panel. Archives created as .ddim internally
then scrambled via archive-scramble.ts before download."
```

---

### Task 9: Add `.vdim` file association to Tauri configs

**Files:**
- Modify: `src-tauri/tauri.conf.json:56-62`
- Modify: `src-tauri/tauri.pass.conf.json`

- [ ] **Step 1: Add .vdim file association to tauri.conf.json**

In `src-tauri/tauri.conf.json`, add a new entry to the `fileAssociations` array after the existing `.ddim` entry:

```json
"fileAssociations": [
    {
        "ext": ["ddim"],
        "mimeType": "application/octet-stream",
        "description": "Vitrine3D Scene Archive"
    },
    {
        "ext": ["vdim"],
        "mimeType": "application/octet-stream",
        "description": "Vitrine3D Protected Archive"
    }
],
```

- [ ] **Step 2: Add .vdim file association to tauri.pass.conf.json**

Add the same `fileAssociations` block to `tauri.pass.conf.json` if it doesn't already have one, or extend the existing one.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/tauri.pass.conf.json
git commit -m "feat(tauri): add .vdim file association for protected archives"
```

---

## Chunk 5: Final Verification

### Task 10: Run full test suite and build verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all tests pass, including the new `archive-scramble.test.ts` suite

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: build succeeds, `dist/` contains both kiosk and editor bundles

- [ ] **Step 4: Verify archive-scramble is bundled**

Run: `grep -r "descrambleChunk\|VDIM_MAGIC\|archive-scramble" dist/ --include="*.js" -l`
Expected: at least one bundled JS file contains the scramble module code

- [ ] **Step 5: Commit any final fixes, then tag completion**

```bash
git log --oneline -8  # verify all commits are clean
```
