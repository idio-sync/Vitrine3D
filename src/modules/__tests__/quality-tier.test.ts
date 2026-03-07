/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectDeviceTier, resolveQualityTier, hasAnyProxy, getBenchmarkScore, _setBenchmarkFpsForTest } from '../quality-tier.js';

// Store original values for restoration
let originalDeviceMemory: PropertyDescriptor | undefined;
let originalHardwareConcurrency: PropertyDescriptor | undefined;
let originalUserAgent: PropertyDescriptor | undefined;
let originalScreenWidth: PropertyDescriptor | undefined;

describe('hasAnyProxy', () => {
    it('returns true when hasMeshProxy is true', () => {
        expect(hasAnyProxy({ hasMeshProxy: true })).toBe(true);
    });

    it('returns true when hasSceneProxy is true', () => {
        expect(hasAnyProxy({ hasSceneProxy: true })).toBe(true);
    });

    it('returns true when both are true', () => {
        expect(hasAnyProxy({ hasMeshProxy: true, hasSceneProxy: true })).toBe(true);
    });

    it('returns false when both are false', () => {
        expect(hasAnyProxy({ hasMeshProxy: false, hasSceneProxy: false })).toBe(false);
    });

    it('returns false when both are undefined', () => {
        expect(hasAnyProxy({ hasMeshProxy: undefined, hasSceneProxy: undefined })).toBe(false);
    });

    it('returns false for empty object', () => {
        expect(hasAnyProxy({})).toBe(false);
    });
});

describe('getBenchmarkScore', () => {
    afterEach(() => {
        _setBenchmarkFpsForTest(null);
    });

    it('returns 0 when benchmark has not run', () => {
        _setBenchmarkFpsForTest(null);
        expect(getBenchmarkScore()).toBe(0);
    });

    it('returns 0 for FPS below 120', () => {
        _setBenchmarkFpsForTest(80);
        expect(getBenchmarkScore()).toBe(0);
    });

    it('returns 0 at FPS boundary of 119', () => {
        _setBenchmarkFpsForTest(119);
        expect(getBenchmarkScore()).toBe(0);
    });

    it('returns 1 at FPS boundary of 120', () => {
        _setBenchmarkFpsForTest(120);
        expect(getBenchmarkScore()).toBe(1);
    });

    it('returns 1 for mid-range FPS', () => {
        _setBenchmarkFpsForTest(180);
        expect(getBenchmarkScore()).toBe(1);
    });

    it('returns 1 at FPS boundary of 239', () => {
        _setBenchmarkFpsForTest(239);
        expect(getBenchmarkScore()).toBe(1);
    });

    it('returns 2 at FPS boundary of 240', () => {
        _setBenchmarkFpsForTest(240);
        expect(getBenchmarkScore()).toBe(2);
    });

    it('returns 2 for high FPS', () => {
        _setBenchmarkFpsForTest(500);
        expect(getBenchmarkScore()).toBe(2);
    });
});

describe('resolveQualityTier', () => {
    it("returns 'sd' when tier is 'sd'", () => {
        expect(resolveQualityTier('sd')).toBe('sd');
    });

    it("returns 'hd' when tier is 'hd'", () => {
        expect(resolveQualityTier('hd')).toBe('hd');
    });

    it("calls detectDeviceTier when tier is 'auto'", () => {
        const result = resolveQualityTier('auto');
        // detectDeviceTier returns either 'sd' or 'hd'
        expect(['sd', 'hd']).toContain(result);
    });

    it('calls detectDeviceTier for unknown tier values', () => {
        const result = resolveQualityTier('unknown');
        expect(['sd', 'hd']).toContain(result);
    });
});

describe('detectDeviceTier', () => {
    beforeEach(() => {
        // Save original descriptors
        originalDeviceMemory = Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory');
        originalHardwareConcurrency = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency');
        originalUserAgent = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
        originalScreenWidth = Object.getOwnPropertyDescriptor(Screen.prototype, 'width');

        // Default to high benchmark score for existing tests so they
        // continue testing the static heuristics in isolation
        _setBenchmarkFpsForTest(500); // 2 points
    });

    afterEach(() => {
        // Restore original values
        if (originalDeviceMemory) {
            Object.defineProperty(Navigator.prototype, 'deviceMemory', originalDeviceMemory);
        } else {
            delete (Navigator.prototype as any).deviceMemory;
        }

        if (originalHardwareConcurrency) {
            Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', originalHardwareConcurrency);
        } else {
            delete (Navigator.prototype as any).hardwareConcurrency;
        }

        if (originalUserAgent) {
            Object.defineProperty(Navigator.prototype, 'userAgent', originalUserAgent);
        }

        if (originalScreenWidth) {
            Object.defineProperty(Screen.prototype, 'width', originalScreenWidth);
        }

        _setBenchmarkFpsForTest(null);
    });

    it('returns hd for desktop with high-end specs (score 7/7)', () => {
        // Mock all capabilities as high-end
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8 // 8GB
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8 // 8 cores
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920 // Desktop resolution
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        // Mock GL context
        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn((param) => {
                if (param === 0x0D33) return 16384; // High texture size
                return null;
            })
        } as any;

        expect(detectDeviceTier(mockGl)).toBe('hd');
    });

    it('returns sd for mobile device with low memory (iOS forced SD)', () => {
        // Mock mobile with low specs
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 2 // 2GB (below threshold)
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 2 // 2 cores (below threshold)
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 375 // Mobile resolution (below threshold)
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) Mobile'
        });

        // Mock GL context with low texture size
        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn((param) => {
                if (param === 0x0D33) return 4096; // Below threshold (8192)
                return null;
            })
        } as any;

        expect(detectDeviceTier(mockGl)).toBe('sd');
    });

    it('assumes capable when deviceMemory is undefined', () => {
        // Mock undefined deviceMemory (Safari, Firefox)
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => undefined
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        });

        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn(() => 16384)
        } as any;

        // Should score 5/5 (undefined deviceMemory counts as 1 point)
        expect(detectDeviceTier(mockGl)).toBe('hd');
    });

    it('assumes capable when hardwareConcurrency is undefined', () => {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => undefined
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn(() => 16384)
        } as any;

        // Should score 5/5 (undefined hardwareConcurrency counts as 1 point)
        expect(detectDeviceTier(mockGl)).toBe('hd');
    });

    it('assumes capable when GL context is null', () => {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        // No GL context provided
        expect(detectDeviceTier()).toBe('hd');
    });

    it('loses texture point when GL returns low MAX_TEXTURE_SIZE', () => {
        // Mock high-end except for texture size
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn((param) => {
                if (param === 0x0D33) return 4096; // Below threshold (8192)
                return null;
            })
        } as any;

        // Should score 4/5 (loses texture point)
        expect(detectDeviceTier(mockGl)).toBe('hd');
    });

    it('handles GL getParameter throwing error gracefully', () => {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn(() => {
                throw new Error('GL error');
            })
        } as any;

        // Should assume capable when error occurs (still scores point)
        expect(detectDeviceTier(mockGl)).toBe('hd');
    });

    it('detects iPad as mobile device', () => {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 4
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 6
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1024
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)'
        });

        // iOS/iPadOS forced to SD to prevent Safari tab crashes from GPU memory exhaustion
        expect(detectDeviceTier()).toBe('sd');
    });

    it('detects Android as mobile device', () => {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 3
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 4
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 412
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Linux; Android 11; Pixel 5)'
        });

        // Score: 0 (mem) + 1 (cores) + 0 (width) + 1 (no GL) + 0 (mobile) = 2 -> SD
        expect(detectDeviceTier()).toBe('sd');
    });

    it('forces SD for Android devices', () => {
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            configurable: true
        });
        // Give it high scores on everything else — Android should still force SD
        Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 12, configurable: true });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 8, configurable: true });
        Object.defineProperty(Screen.prototype, 'width', { get: () => 1080, configurable: true });

        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn((param) => {
                if (param === 0x0D33) return 16384;
                return null;
            })
        } as any;

        const result = detectDeviceTier(mockGl as any);
        expect(result).toBe('sd');
    });

    it('returns sd when benchmark score drags total below threshold', () => {
        // Desktop with 4/5 static points but terrible GPU benchmark
        _setBenchmarkFpsForTest(50); // 0 benchmark points

        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 2 // Below threshold — loses 1 static point
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn((param) => {
                if (param === 0x0D33) return 4096; // Below threshold — loses 1 static point
                return null;
            })
        } as any;

        // Score: 1(mem) + 0(cores) + 1(width) + 0(texture) + 1(ua) + 0(bench) = 3 -> SD
        expect(detectDeviceTier(mockGl)).toBe('sd');
    });

    it('returns hd when benchmark compensates for missing deviceMemory', () => {
        // Firefox/Safari desktop: deviceMemory undefined, good benchmark
        _setBenchmarkFpsForTest(300); // 2 benchmark points

        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => undefined
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'
        });

        // Score: 1(mem undefined=capable) + 1(cores) + 1(width) + 1(no gl=capable) + 1(ua) + 2(bench) = 7 -> HD
        expect(detectDeviceTier()).toBe('hd');
    });
});
