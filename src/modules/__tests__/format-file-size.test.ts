// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { formatFileSize } from '../metadata-manager.js';

describe('formatFileSize', () => {
    it('returns "0 B" for zero bytes', () => {
        expect(formatFileSize(0)).toBe('0 B');
    });

    it('formats bytes', () => {
        expect(formatFileSize(500)).toBe('500 B');
        expect(formatFileSize(1)).toBe('1 B');
    });

    it('formats kilobytes', () => {
        expect(formatFileSize(1024)).toBe('1 KB');
        expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
        expect(formatFileSize(1048576)).toBe('1 MB');
        expect(formatFileSize(5.5 * 1024 * 1024)).toBe('5.5 MB');
    });

    it('formats gigabytes', () => {
        expect(formatFileSize(1073741824)).toBe('1 GB');
        expect(formatFileSize(2.25 * 1024 * 1024 * 1024)).toBe('2.25 GB');
    });

    it('rounds to 2 decimal places', () => {
        expect(formatFileSize(1234567)).toBe('1.18 MB');
    });
});
