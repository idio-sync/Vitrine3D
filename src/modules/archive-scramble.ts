/**
 * Archive Scramble Module
 *
 * Handles XOR-based obfuscation and de-obfuscation of .ddim archives.
 * NOT cryptographically secure — XOR with a repeating key is trivially
 * reversible by anyone who reads this source. The goal is to prevent
 * casual inspection / accidental misuse, not to resist determined attack.
 *
 * Supports two protection modes:
 *  - 'protected-vdim': on-disk format with embedded obfuscated key (.vdim header)
 *  - 'scrambled-transit': transit format de-obfuscated with HMAC-derived key
 *
 * The APP_SECRET build-time env var gates transit mode. Without it, only
 * plain ZIP archives and .vdim on-disk archives can be loaded.
 */

import { Logger } from './logger.js';

const log = Logger.getLogger('archive-scramble');

// .vdim header constants
export const VDIM_MAGIC = new Uint8Array([0x56, 0x44]); // "VD"
export const VDIM_VERSION = 0x01;
export const VDIM_HEADER_SIZE = 48;
export const VDIM_KEY_OFFSET = 8;
export const VDIM_KEY_FIELD_SIZE = 32;

// ZIP magic bytes for validation after descramble
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b]);

// App secret from build-time env var (empty string = disabled)
const APP_SECRET = import.meta.env.VITE_ARCHIVE_SECRET || '';

export type ArchiveFormat = 'plain' | 'protected-vdim' | 'scrambled-transit';

/**
 * Detect the format of an archive by inspecting its first two bytes.
 *
 * @param bytes - Raw archive bytes
 * @param transitEnabled - Whether transit-mode descramble is available
 * @returns Detected ArchiveFormat
 * @throws Error for ambiguous or too-short input
 */
export function detectArchiveFormat(bytes: Uint8Array, transitEnabled: boolean): ArchiveFormat {
    if (bytes.length < 2) {
        throw new Error('Unrecognized archive format');
    }

    if (bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1]) {
        return 'plain';
    }

    if (bytes[0] === VDIM_MAGIC[0] && bytes[1] === VDIM_MAGIC[1]) {
        return 'protected-vdim';
    }

    if (transitEnabled) {
        return 'scrambled-transit';
    }

    throw new Error('Unrecognized archive format');
}

/**
 * XOR data in-place with a repeating key starting at a given offset.
 * Mutates and returns the same array.
 *
 * @param data - Bytes to XOR (mutated in place)
 * @param key - Key bytes (repeating)
 * @param offset - Starting position within the repeating key cycle
 */
export function xorBytes(data: Uint8Array, key: Uint8Array, offset: number): Uint8Array {
    const keyLen = key.length;
    if (keyLen === 0) return data;
    for (let i = 0; i < data.length; i++) {
        data[i] ^= key[(offset + i) % keyLen];
    }
    return data;
}

/**
 * Descramble a chunk of bytes relative to its position in the full stream.
 * Returns a NEW Uint8Array — input is not mutated.
 *
 * @param chunk - Chunk to descramble
 * @param offset - Byte offset of this chunk within the full archive body
 * @param key - XOR key
 */
export function descrambleChunk(chunk: Uint8Array, offset: number, key: Uint8Array): Uint8Array {
    const copy = new Uint8Array(chunk);
    return xorBytes(copy, key, offset);
}

/**
 * Derive a 32-byte transit key via HMAC-SHA256(APP_SECRET, archiveHash).
 * Uses browser SubtleCrypto — must be called in a secure context.
 *
 * @param archiveHash - Input to HMAC (archive identifier or fixed label)
 */
export async function deriveTransitKey(archiveHash: string): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(APP_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(archiveHash));
    return new Uint8Array(signature);
}

/**
 * Returns true when transit-mode scrambling is available (APP_SECRET is set).
 */
export function isTransitEnabled(): boolean {
    return APP_SECRET.length > 0;
}

/**
 * Parse a 48-byte .vdim header and return the embedded key.
 * The stored key material is XOR-obfuscated with a derived header key.
 *
 * @param header - First VDIM_HEADER_SIZE bytes of the archive
 */
export async function parseVdimHeader(header: Uint8Array): Promise<{ version: number; key: Uint8Array }> {
    if (header.length < VDIM_HEADER_SIZE) {
        throw new Error('Invalid protected archive header');
    }

    if (header[0] !== VDIM_MAGIC[0] || header[1] !== VDIM_MAGIC[1]) {
        throw new Error('Invalid protected archive header');
    }

    const version = header[2];
    const keyLen = header[3];

    if (keyLen !== 16 && keyLen !== 32) {
        throw new Error('Invalid protected archive header');
    }

    // Extract obfuscated key material from bytes 8–39
    const encryptedKey = header.slice(VDIM_KEY_OFFSET, VDIM_KEY_OFFSET + keyLen);

    // Un-XOR with the derived header key to recover the original key
    const headerKey = await deriveTransitKey('vdim-header-key');
    const key = xorBytes(new Uint8Array(encryptedKey), headerKey, 0);

    log.debug(`Parsed .vdim header: version=${version}, keyLen=${keyLen}`);

    return { version, key };
}

/**
 * Descramble a full archive that was scrambled with a known key.
 * Validates that the result is a valid ZIP (starts with PK).
 *
 * @param bytes - Scrambled archive bytes (no header, raw XOR'd ZIP)
 * @param key - XOR key
 * @throws Error if result does not start with PK magic
 */
export function descrambleArchive(bytes: Uint8Array, key: Uint8Array): Uint8Array {
    const result = new Uint8Array(bytes);
    xorBytes(result, key, 0);

    if (result[0] !== ZIP_MAGIC[0] || result[1] !== ZIP_MAGIC[1]) {
        throw new Error(
            'Archive descrambling failed — verify ARCHIVE_SECRET matches the server configuration'
        );
    }

    return result;
}

/**
 * Descramble a .vdim archive (on-disk protected format).
 * Parses the 48-byte header, extracts the key, then descrambles the body.
 *
 * @param bytes - Full .vdim file bytes (header + scrambled body)
 */
export async function descrambleVdim(bytes: Uint8Array): Promise<Uint8Array> {
    const header = bytes.slice(0, VDIM_HEADER_SIZE);
    const { key } = await parseVdimHeader(header);
    const body = bytes.slice(VDIM_HEADER_SIZE);
    return descrambleArchive(body, key);
}

/**
 * Scramble a plain ZIP archive into .vdim format.
 * Generates a random 32-byte key, encrypts it into the header, and XORs the body.
 *
 * @param plainZip - Valid ZIP bytes (must start with PK)
 * @returns .vdim bytes: 48-byte header + XOR'd body
 * @throws Error if input is not a valid ZIP
 */
export async function scrambleArchive(plainZip: Uint8Array): Promise<Uint8Array> {
    if (plainZip.length < 2 || plainZip[0] !== ZIP_MAGIC[0] || plainZip[1] !== ZIP_MAGIC[1]) {
        throw new Error('scrambleArchive: input is not a valid ZIP archive (missing PK magic)');
    }

    // Generate random 32-byte key
    const key = crypto.getRandomValues(new Uint8Array(32));

    // Encrypt key for header storage: XOR key with derived header key
    const headerKey = await deriveTransitKey('vdim-header-key');
    const encryptedKey = xorBytes(new Uint8Array(key), headerKey, 0);

    // Build 48-byte header
    // [0]   magic[0]   = 0x56 ('V')
    // [1]   magic[1]   = 0x44 ('D')
    // [2]   version    = 0x01
    // [3]   keyLen     = 32
    // [4-7] reserved   = 0x00
    // [8-39] encrypted key (32 bytes)
    // [40-47] reserved = 0x00
    const header = new Uint8Array(VDIM_HEADER_SIZE);
    header[0] = VDIM_MAGIC[0];
    header[1] = VDIM_MAGIC[1];
    header[2] = VDIM_VERSION;
    header[3] = 32; // keyLen
    header.set(encryptedKey, VDIM_KEY_OFFSET);

    // XOR the ZIP content
    const scrambledBody = xorBytes(new Uint8Array(plainZip), key, 0);

    // Concatenate header + scrambled body
    const output = new Uint8Array(VDIM_HEADER_SIZE + scrambledBody.length);
    output.set(header, 0);
    output.set(scrambledBody, VDIM_HEADER_SIZE);

    log.debug(`scrambleArchive: produced ${output.length} bytes (${VDIM_HEADER_SIZE} header + ${scrambledBody.length} body)`);

    return output;
}
