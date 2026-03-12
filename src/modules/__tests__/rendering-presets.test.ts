// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
    RENDERING_PRESETS,
    getCurrentPresetName,
    shouldAutoApplyPreset,
    isLocalPreset,
} from '../rendering-presets.js';
import { ENVIRONMENT } from '../constants.js';

describe('rendering-presets', () => {
    describe('RENDERING_PRESETS', () => {
        it('should define all 4 built-in presets', () => {
            expect(Object.keys(RENDERING_PRESETS)).toEqual(
                expect.arrayContaining(['technical', 'studio', 'outdoor', 'dramatic'])
            );
            expect(Object.keys(RENDERING_PRESETS)).toHaveLength(4);
        });

        it('each preset should have all required fields', () => {
            const requiredFields = [
                'name', 'label', 'hdri', 'toneMapping', 'toneMappingExposure',
                'ambientIntensity', 'hemisphereIntensity',
                'directional1Intensity', 'directional2Intensity',
                'postProcessing', 'backgroundColor', 'envAsBackground',
            ];
            for (const [, preset] of Object.entries(RENDERING_PRESETS)) {
                for (const field of requiredFields) {
                    expect(preset).toHaveProperty(field);
                }
            }
        });

        it('technical preset should have no HDR', () => {
            expect(RENDERING_PRESETS.technical.hdri).toBeNull();
        });

        it('studio preset should reference a valid ENVIRONMENT.PRESETS name', () => {
            const preset = RENDERING_PRESETS.studio;
            expect(preset.hdri).not.toBeNull();
            const envPreset = ENVIRONMENT.PRESETS.find(p => p.name === preset.hdri);
            expect(envPreset).toBeDefined();
            expect(envPreset!.url).toBeTruthy();
        });
    });

    describe('getCurrentPresetName', () => {
        it('should return preset name when settings match exactly', () => {
            const studio = RENDERING_PRESETS.studio;
            const result = getCurrentPresetName({
                hdri: studio.hdri,
                toneMapping: studio.toneMapping,
                toneMappingExposure: studio.toneMappingExposure,
                ambientIntensity: studio.ambientIntensity,
                hemisphereIntensity: studio.hemisphereIntensity,
                directional1Intensity: studio.directional1Intensity,
                directional2Intensity: studio.directional2Intensity,
                envAsBackground: studio.envAsBackground,
            });
            expect(result).toBe('studio');
        });

        it('should return "custom" when no preset matches', () => {
            const result = getCurrentPresetName({
                hdri: 'Studio',
                toneMapping: 'AgX',
                toneMappingExposure: 0.85,
                ambientIntensity: 0.2,
                hemisphereIntensity: 0,
                directional1Intensity: 0,
                directional2Intensity: 0,
                envAsBackground: false,
            });
            expect(result).toBe('custom');
        });
    });

    describe('shouldAutoApplyPreset', () => {
        it('should return true when only mesh is loaded', () => {
            expect(shouldAutoApplyPreset({
                splatLoaded: false,
                modelLoaded: true,
            } as any)).toBe(true);
        });

        it('should return false when splat is loaded', () => {
            expect(shouldAutoApplyPreset({
                splatLoaded: true,
                modelLoaded: true,
            } as any)).toBe(false);
        });

        it('should return false when nothing is loaded', () => {
            expect(shouldAutoApplyPreset({
                splatLoaded: false,
                modelLoaded: false,
            } as any)).toBe(false);
        });
    });

    describe('isLocalPreset', () => {
        it('should return true for paths starting with /', () => {
            expect(isLocalPreset({ name: 'Studio', url: '/hdri/studio.hdr' })).toBe(true);
        });

        it('should return false for CDN URLs', () => {
            expect(isLocalPreset({ name: 'Sunset', url: 'https://example.com/sunset.hdr' })).toBe(false);
        });

        it('should return false for empty URLs', () => {
            expect(isLocalPreset({ name: 'None', url: '' })).toBe(false);
        });
    });
});
