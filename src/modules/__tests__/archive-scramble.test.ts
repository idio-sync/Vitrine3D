// @vitest-environment jsdom
/**
 * Tests for archive-scramble.ts
 *
 * VITE_ARCHIVE_SECRET is defined in vitest.config.ts so the module
 * picks it up at load time via import.meta.env.
 */
import { describe, it, expect } from 'vitest';
import {
    detectArchiveFormat,
    descrambleChunk,
    descrambleArchive,
    descrambleVdim,
    deriveTransitKey,
    isTransitEnabled,
    scrambleArchive,
    parseVdimHeader,
    xorBytes,
    VDIM_MAGIC,
    VDIM_HEADER_SIZE,
    VDIM_VERSION,
    VDIM_KEY_OFFSET,
} from '../archive-scramble.js';

function fakeZip(size = 64): Uint8Array {
    const data = new Uint8Array(size);
    data[0] = 0x50; // P
    data[1] = 0x4b; // K
    return data;
}

// ─── Format Detection ─────────────────────────────────────────────────────────

describe('detectArchiveFormat', () => {
    it('detects plain ZIP (PK magic)', () => {
        const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
        expect(detectArchiveFormat(bytes, false)).toBe('plain');
        expect(detectArchiveFormat(bytes, true)).toBe('plain');
    });

    it('detects protected-vdim (VD magic)', () => {
        const bytes = new Uint8Array([0x56, 0x44, 0x01, 0x20]);
        expect(detectArchiveFormat(bytes, false)).toBe('protected-vdim');
        expect(detectArchiveFormat(bytes, true)).toBe('protected-vdim');
    });

    it('returns scrambled-transit for unknown magic when transit enabled', () => {
        const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        expect(detectArchiveFormat(bytes, true)).toBe('scrambled-transit');
    });

    it('throws "Unrecognized archive format" for unknown magic when transit is disabled', () => {
        const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        expect(() => detectArchiveFormat(bytes, false)).toThrow('Unrecognized archive format');
    });

    it('throws "Unrecognized archive format" when buffer is less than 2 bytes', () => {
        expect(() => detectArchiveFormat(new Uint8Array([0x50]), false)).toThrow('Unrecognized archive format');
        expect(() => detectArchiveFormat(new Uint8Array([]), false)).toThrow('Unrecognized archive format');
    });

    it('treats legacy .a3d / .a3z archives (ZIP with PK magic) as plain', () => {
        const a3d = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
        expect(detectArchiveFormat(a3d, false)).toBe('plain');
    });
});

// ─── descrambleChunk ──────────────────────────────────────────────────────────

describe('descrambleChunk', () => {
    it('XORs correctly at offset 0', () => {
        const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
        const key = new Uint8Array([0xff, 0xfe]);
        const result = descrambleChunk(data, 0, key);
        expect(result[0]).toBe(0x01 ^ 0xff);
        expect(result[1]).toBe(0x02 ^ 0xfe);
        expect(result[2]).toBe(0x03 ^ 0xff); // key wraps
        expect(result[3]).toBe(0x04 ^ 0xfe);
    });

    it('handles key offset wrapping correctly', () => {
        const data = new Uint8Array([0xaa, 0xbb]);
        const key = new Uint8Array([0x01, 0x02, 0x03]);
        // offset=1: data[0] ^= key[(1+0)%3] = key[1], data[1] ^= key[(1+1)%3] = key[2]
        const result = descrambleChunk(data, 1, key);
        expect(result[0]).toBe(0xaa ^ 0x02);
        expect(result[1]).toBe(0xbb ^ 0x03);
    });

    it('does NOT mutate the input array', () => {
        const data = new Uint8Array([0x11, 0x22, 0x33]);
        const original = new Uint8Array(data);
        const key = new Uint8Array([0xab]);
        descrambleChunk(data, 0, key);
        expect(data).toEqual(original);
    });

    it('chunk result matches full-buffer XOR at same positions', () => {
        const full = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50]);
        const key = new Uint8Array([0x0f, 0xf0, 0x55]);

        // XOR the full buffer manually
        const fullCopy = new Uint8Array(full);
        xorBytes(fullCopy, key, 0);

        // Descramble just the last 3 bytes starting at offset 2
        const chunk = full.slice(2);
        const chunkResult = descrambleChunk(chunk, 2, key);

        expect(chunkResult[0]).toBe(fullCopy[2]);
        expect(chunkResult[1]).toBe(fullCopy[3]);
        expect(chunkResult[2]).toBe(fullCopy[4]);
    });

    it('handles 1-byte chunk', () => {
        const data = new Uint8Array([0xcc]);
        const key = new Uint8Array([0x33]);
        const result = descrambleChunk(data, 0, key);
        expect(result[0]).toBe(0xcc ^ 0x33);
        expect(result.length).toBe(1);
    });

    it('handles empty chunk', () => {
        const data = new Uint8Array([]);
        const key = new Uint8Array([0xab]);
        const result = descrambleChunk(data, 0, key);
        expect(result.length).toBe(0);
    });

    it('handles chunk at key-length boundary (offset = keyLen - 1)', () => {
        const key = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);
        const data = new Uint8Array([0x11, 0x22, 0x33]);
        // offset = 3 (keyLen - 1), so key indices are 3, 0, 1
        const result = descrambleChunk(data, 3, key);
        expect(result[0]).toBe(0x11 ^ 0xDD); // key[3]
        expect(result[1]).toBe(0x22 ^ 0xAA); // key[0] — wraps around
        expect(result[2]).toBe(0x33 ^ 0xBB); // key[1]
    });
});

// ─── descrambleArchive ────────────────────────────────────────────────────────

describe('descrambleArchive', () => {
    it('round-trips: XOR then descramble returns original', () => {
        const zip = fakeZip(32);
        const key = new Uint8Array(32).fill(0xab);
        const scrambled = xorBytes(new Uint8Array(zip), key, 0);
        const result = descrambleArchive(scrambled, key);
        expect(result).toEqual(zip);
    });

    it('throws specific error message when wrong key is used', () => {
        const zip = fakeZip(32);
        const key = new Uint8Array(32).fill(0xab);
        const scrambled = xorBytes(new Uint8Array(zip), key, 0);
        const wrongKey = new Uint8Array(32).fill(0x99);
        expect(() => descrambleArchive(scrambled, wrongKey)).toThrow(
            'Archive descrambling failed — verify ARCHIVE_SECRET matches the server configuration'
        );
    });
});

// ─── deriveTransitKey ─────────────────────────────────────────────────────────

describe('deriveTransitKey', () => {
    it('returns a 32-byte Uint8Array', async () => {
        const key = await deriveTransitKey('some-archive-hash');
        expect(key).toBeInstanceOf(Uint8Array);
        expect(key.length).toBe(32);
    });

    it('is deterministic — same inputs produce the same key', async () => {
        const a = await deriveTransitKey('test-hash-123');
        const b = await deriveTransitKey('test-hash-123');
        expect(a).toEqual(b);
    });

    it('different hash strings produce different keys', async () => {
        const a = await deriveTransitKey('hash-alpha');
        const b = await deriveTransitKey('hash-beta');
        expect(a).not.toEqual(b);
    });
});

// ─── isTransitEnabled ────────────────────────────────────────────────────────

describe('isTransitEnabled', () => {
    it('returns true when VITE_ARCHIVE_SECRET is set', () => {
        expect(isTransitEnabled()).toBe(true);
    });
});

// ─── scrambleArchive + descrambleVdim round-trip ──────────────────────────────

describe('scrambleArchive + descrambleVdim round-trip', () => {
    it('scramble then descramble returns the original ZIP', async () => {
        const zip = fakeZip(128);
        for (let i = 2; i < 128; i++) zip[i] = i & 0xff;

        const vdim = await scrambleArchive(zip);
        const recovered = await descrambleVdim(vdim);
        expect(recovered).toEqual(zip);
    });

    it('output starts with VD magic', async () => {
        const vdim = await scrambleArchive(fakeZip());
        expect(vdim[0]).toBe(VDIM_MAGIC[0]);
        expect(vdim[1]).toBe(VDIM_MAGIC[1]);
    });

    it('output length = HEADER_SIZE + input length', async () => {
        const zip = fakeZip(64);
        const vdim = await scrambleArchive(zip);
        expect(vdim.length).toBe(VDIM_HEADER_SIZE + zip.length);
    });

    it('scrambled body differs from original ZIP', async () => {
        const zip = fakeZip(64);
        const vdim = await scrambleArchive(zip);
        const body = vdim.slice(VDIM_HEADER_SIZE);
        expect(body).not.toEqual(zip);
    });

    it('throws if input is not a valid ZIP', async () => {
        const notZip = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        await expect(scrambleArchive(notZip)).rejects.toThrow('not a valid ZIP');
    });
});

// ─── parseVdimHeader ──────────────────────────────────────────────────────────

describe('parseVdimHeader', () => {
    function makeHeader(magic = [0x56, 0x44], version = 0x01, keyLen = 32): Uint8Array {
        const h = new Uint8Array(VDIM_HEADER_SIZE);
        h[0] = magic[0];
        h[1] = magic[1];
        h[2] = version;
        h[3] = keyLen;
        return h;
    }

    it('rejects headers shorter than VDIM_HEADER_SIZE', async () => {
        const short = new Uint8Array(10);
        await expect(parseVdimHeader(short)).rejects.toThrow('Invalid protected archive header');
    });

    it('rejects bad magic bytes', async () => {
        const h = makeHeader([0xde, 0xad]);
        await expect(parseVdimHeader(h)).rejects.toThrow('Invalid protected archive header');
    });

    it('rejects keyLen of 8 (not 16 or 32)', async () => {
        const h = makeHeader([0x56, 0x44], 0x01, 8);
        await expect(parseVdimHeader(h)).rejects.toThrow('Invalid protected archive header');
    });

    it('rejects keyLen of 64 (not 16 or 32)', async () => {
        const h = makeHeader([0x56, 0x44], 0x01, 64);
        await expect(parseVdimHeader(h)).rejects.toThrow('Invalid protected archive header');
    });

    it('accepts keyLen of 16', async () => {
        const h = makeHeader([0x56, 0x44], 0x01, 16);
        const { key } = await parseVdimHeader(h);
        expect(key.length).toBe(16);
    });

    it('16-byte key round-trip: manually built .vdim parses and descrambles correctly', async () => {
        const zip = fakeZip(64);
        for (let i = 2; i < 64; i++) zip[i] = i & 0xff;

        // Generate a 16-byte random key
        const key16 = new Uint8Array(16);
        crypto.getRandomValues(key16);

        // Encrypt the key for header storage (same as scrambleArchive does, but with 16 bytes)
        const secretKey = await deriveTransitKey('vdim-header-key');
        const encryptedKey = new Uint8Array(32); // zero-padded to 32
        for (let i = 0; i < 16; i++) encryptedKey[i] = key16[i] ^ secretKey[i];

        // Build header with keyLen=16
        const header = makeHeader([0x56, 0x44], 0x01, 16);
        header.set(encryptedKey, VDIM_KEY_OFFSET);

        // XOR the ZIP body with the 16-byte key
        const body = new Uint8Array(zip);
        for (let i = 0; i < body.length; i++) body[i] ^= key16[i % 16];

        // Concatenate header + body
        const vdim = new Uint8Array(VDIM_HEADER_SIZE + body.length);
        vdim.set(header);
        vdim.set(body, VDIM_HEADER_SIZE);

        // Parse header and descramble
        const parsed = await parseVdimHeader(vdim.slice(0, VDIM_HEADER_SIZE));
        expect(parsed.key.length).toBe(16);
        const recovered = descrambleArchive(vdim.slice(VDIM_HEADER_SIZE), parsed.key);
        expect(recovered).toEqual(zip);
    });

    it('accepts keyLen of 32 and extracts correct version', async () => {
        const h = makeHeader([0x56, 0x44], VDIM_VERSION, 32);
        const { version, key } = await parseVdimHeader(h);
        expect(version).toBe(VDIM_VERSION);
        expect(key.length).toBe(32);
    });
});

// ─── Error message specificity ────────────────────────────────────────────────

describe('error message specificity', () => {
    it('wrong secret produces the specific descrambling-failed error, not a generic one', () => {
        const zip = fakeZip(32);
        const key = new Uint8Array(32).fill(0x12);
        const scrambled = xorBytes(new Uint8Array(zip), key, 0);

        const wrongKey = new Uint8Array(32).fill(0x34);
        let caught: Error | undefined;
        try {
            descrambleArchive(scrambled, wrongKey);
        } catch (e) {
            caught = e as Error;
        }

        expect(caught).toBeDefined();
        expect(caught!.message).toContain('descrambling failed');
        expect(caught!.message).toContain('ARCHIVE_SECRET');
    });
});
