// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    yieldToRenderer,
    enterReducedQualityMode, exitReducedQualityMode,
    isReducedQualityActive, LOADING_LOD_BUDGET, _resetForTest,
} from '../background-loader.js';

describe('yieldToRenderer', () => {
    let rafSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
            (cb: FrameRequestCallback) => { cb(0); return 0; }
        );
    });

    afterEach(() => {
        rafSpy.mockRestore();
    });

    it('resolves after requestAnimationFrame + setTimeout', async () => {
        vi.useFakeTimers();
        const promise = yieldToRenderer();
        await vi.runAllTimersAsync();
        await expect(promise).resolves.toBeUndefined();
        vi.useRealTimers();
    });

    it('calls requestAnimationFrame exactly once', async () => {
        // Restore beforeEach spy, enable fake timers, then re-spy
        rafSpy.mockRestore();
        vi.useFakeTimers();
        rafSpy = vi.spyOn(window, 'requestAnimationFrame');
        const promise = yieldToRenderer();
        await vi.runAllTimersAsync();
        await promise;
        expect(rafSpy).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});

describe('enterReducedQualityMode / exitReducedQualityMode', () => {
    let mockRenderer: any;
    let mockSparkRenderer: any;
    let resizeCalled: boolean;

    beforeEach(() => {
        _resetForTest();
        resizeCalled = false;
        mockRenderer = {
            getPixelRatio: () => 2,
            setPixelRatio: vi.fn(),
        };
        mockSparkRenderer = {
            lodSplatCount: 5_000_000,
        };
    });

    it('reduces LOD budget and pixel ratio', () => {
        enterReducedQualityMode({
            renderer: mockRenderer,
            sparkRenderer: mockSparkRenderer,
            onResize: () => { resizeCalled = true; },
        });

        expect(mockSparkRenderer.lodSplatCount).toBe(LOADING_LOD_BUDGET);
        expect(mockRenderer.setPixelRatio).toHaveBeenCalledWith(1);
        expect(resizeCalled).toBe(true);
        expect(isReducedQualityActive()).toBe(true);
    });

    it('restores original values on exit', () => {
        const targets = {
            renderer: mockRenderer,
            sparkRenderer: mockSparkRenderer,
            onResize: () => { resizeCalled = true; },
        };

        enterReducedQualityMode(targets);
        mockRenderer.setPixelRatio.mockClear();
        resizeCalled = false;

        exitReducedQualityMode(targets);

        expect(mockSparkRenderer.lodSplatCount).toBe(5_000_000);
        expect(mockRenderer.setPixelRatio).toHaveBeenCalledWith(2);
        expect(resizeCalled).toBe(true);
        expect(isReducedQualityActive()).toBe(false);
    });

    it('is a no-op if already active', () => {
        const targets = { renderer: mockRenderer, sparkRenderer: mockSparkRenderer };
        enterReducedQualityMode(targets);
        mockSparkRenderer.lodSplatCount = 999; // simulate external change
        enterReducedQualityMode(targets); // should not overwrite captured state
        expect(mockSparkRenderer.lodSplatCount).toBe(999); // unchanged
    });

    it('is a no-op if not active on exit', () => {
        const targets = { renderer: mockRenderer, sparkRenderer: mockSparkRenderer };
        exitReducedQualityMode(targets); // should not throw
        expect(mockSparkRenderer.lodSplatCount).toBe(5_000_000); // unchanged
    });

    it('works with null sparkRenderer', () => {
        const targets = { renderer: mockRenderer, sparkRenderer: null };
        enterReducedQualityMode(targets);
        expect(isReducedQualityActive()).toBe(true);
        expect(mockRenderer.setPixelRatio).toHaveBeenCalledWith(1);

        exitReducedQualityMode(targets);
        expect(isReducedQualityActive()).toBe(false);
    });

    it('restores SD-tier budget (1M) correctly, not HD', () => {
        mockSparkRenderer.lodSplatCount = 1_000_000; // SD tier
        const targets = { renderer: mockRenderer, sparkRenderer: mockSparkRenderer };

        enterReducedQualityMode(targets);
        expect(mockSparkRenderer.lodSplatCount).toBe(LOADING_LOD_BUDGET);

        exitReducedQualityMode(targets);
        expect(mockSparkRenderer.lodSplatCount).toBe(1_000_000); // back to SD, not HD
    });
});
