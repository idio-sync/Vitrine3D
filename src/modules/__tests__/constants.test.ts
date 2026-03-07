// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
    CAMERA,
    ORBIT_CONTROLS,
    TIMING,
    MATERIAL,
    ASSET_STATE,
    QUALITY_TIER,
    DEVICE_THRESHOLDS,
    MESH_LOD,
    SHADOWS,
    WALKTHROUGH,
    POST_PROCESSING,
    DECIMATION_PRESETS,
    DEFAULT_DECIMATION_PRESET,
    type DecimationPreset,
} from '../constants.js';

describe('CAMERA', () => {
    it('has positive FOV, near, and far', () => {
        expect(CAMERA.FOV).toBeGreaterThan(0);
        expect(CAMERA.NEAR).toBeGreaterThan(0);
        expect(CAMERA.FAR).toBeGreaterThan(CAMERA.NEAR);
    });
});

describe('ORBIT_CONTROLS', () => {
    it('min distance < max distance', () => {
        expect(ORBIT_CONTROLS.MIN_DISTANCE).toBeLessThan(ORBIT_CONTROLS.MAX_DISTANCE);
    });

    it('damping factor is between 0 and 1', () => {
        expect(ORBIT_CONTROLS.DAMPING_FACTOR).toBeGreaterThan(0);
        expect(ORBIT_CONTROLS.DAMPING_FACTOR).toBeLessThan(1);
    });
});

describe('TIMING', () => {
    it('all delays are positive numbers', () => {
        for (const [key, value] of Object.entries(TIMING)) {
            expect(value, `TIMING.${key}`).toBeGreaterThan(0);
        }
    });
});

describe('MATERIAL', () => {
    it('defaults are in valid ranges', () => {
        expect(MATERIAL.DEFAULT_METALNESS).toBeGreaterThanOrEqual(0);
        expect(MATERIAL.DEFAULT_METALNESS).toBeLessThanOrEqual(1);
        expect(MATERIAL.DEFAULT_ROUGHNESS).toBeGreaterThanOrEqual(0);
        expect(MATERIAL.DEFAULT_ROUGHNESS).toBeLessThanOrEqual(1);
        expect(MATERIAL.DEFAULT_OPACITY).toBeGreaterThanOrEqual(0);
        expect(MATERIAL.DEFAULT_OPACITY).toBeLessThanOrEqual(1);
    });
});

describe('ASSET_STATE', () => {
    it('has all four lifecycle states', () => {
        expect(ASSET_STATE.UNLOADED).toBe('unloaded');
        expect(ASSET_STATE.LOADING).toBe('loading');
        expect(ASSET_STATE.LOADED).toBe('loaded');
        expect(ASSET_STATE.ERROR).toBe('error');
    });
});

describe('QUALITY_TIER', () => {
    it('has sd, hd, and auto', () => {
        expect(QUALITY_TIER.SD).toBe('sd');
        expect(QUALITY_TIER.HD).toBe('hd');
        expect(QUALITY_TIER.AUTO).toBe('auto');
    });
});

describe('DEVICE_THRESHOLDS', () => {
    it('all thresholds are positive', () => {
        for (const [key, value] of Object.entries(DEVICE_THRESHOLDS)) {
            expect(value, `DEVICE_THRESHOLDS.${key}`).toBeGreaterThan(0);
        }
    });
});

describe('MESH_LOD', () => {
    it('desktop warning threshold > mobile warning threshold', () => {
        expect(MESH_LOD.DESKTOP_WARNING_FACES).toBeGreaterThan(MESH_LOD.MOBILE_WARNING_FACES);
    });
});

describe('SHADOWS', () => {
    it('map size is a power of 2', () => {
        expect(Math.log2(SHADOWS.MAP_SIZE) % 1).toBe(0);
    });

    it('camera near < far', () => {
        expect(SHADOWS.CAMERA_NEAR).toBeLessThan(SHADOWS.CAMERA_FAR);
    });
});

describe('WALKTHROUGH', () => {
    it('min < default < max for fly duration', () => {
        expect(WALKTHROUGH.MIN_FLY_DURATION).toBeLessThan(WALKTHROUGH.DEFAULT_FLY_DURATION);
        expect(WALKTHROUGH.DEFAULT_FLY_DURATION).toBeLessThan(WALKTHROUGH.MAX_FLY_DURATION);
    });

    it('default dwell time is within max', () => {
        expect(WALKTHROUGH.DEFAULT_DWELL_TIME).toBeLessThanOrEqual(WALKTHROUGH.MAX_DWELL_TIME);
    });
});

describe('POST_PROCESSING', () => {
    it('all effects start disabled', () => {
        for (const [name, effect] of Object.entries(POST_PROCESSING)) {
            expect((effect as any).enabled, `POST_PROCESSING.${name}.enabled`).toBe(false);
        }
    });
});

describe('DECIMATION_PRESETS', () => {
    const presetKeys = Object.keys(DECIMATION_PRESETS);

    it('has at least one preset', () => {
        expect(presetKeys.length).toBeGreaterThan(0);
    });

    it('DEFAULT_DECIMATION_PRESET exists in presets', () => {
        expect(DECIMATION_PRESETS).toHaveProperty(DEFAULT_DECIMATION_PRESET);
    });

    it('every preset has all required DecimationPreset fields', () => {
        const requiredKeys: (keyof DecimationPreset)[] = [
            'name', 'targetRatio', 'maxFaces', 'errorThreshold',
            'lockBorder', 'preserveUVSeams', 'textureMaxRes',
            'textureFormat', 'textureQuality',
        ];
        for (const [key, preset] of Object.entries(DECIMATION_PRESETS)) {
            for (const field of requiredKeys) {
                expect(preset, `DECIMATION_PRESETS.${key}`).toHaveProperty(field);
            }
        }
    });

    it('targetRatio is between 0 and 1 for all presets', () => {
        for (const [key, preset] of Object.entries(DECIMATION_PRESETS)) {
            expect(preset.targetRatio, `${key}.targetRatio`).toBeGreaterThan(0);
            expect(preset.targetRatio, `${key}.targetRatio`).toBeLessThanOrEqual(1);
        }
    });

    it('textureQuality is between 0 and 1 for all presets', () => {
        for (const [key, preset] of Object.entries(DECIMATION_PRESETS)) {
            expect(preset.textureQuality, `${key}.textureQuality`).toBeGreaterThan(0);
            expect(preset.textureQuality, `${key}.textureQuality`).toBeLessThanOrEqual(1);
        }
    });

    it('textureFormat is a valid value for all presets', () => {
        const validFormats = ['jpeg', 'png', 'keep'];
        for (const [key, preset] of Object.entries(DECIMATION_PRESETS)) {
            expect(validFormats, `${key}.textureFormat`).toContain(preset.textureFormat);
        }
    });

    it('presets are ordered by increasing targetRatio', () => {
        const ratios = presetKeys.map(k => DECIMATION_PRESETS[k].targetRatio);
        for (let i = 1; i < ratios.length; i++) {
            expect(ratios[i], `preset ${presetKeys[i]}`).toBeGreaterThanOrEqual(ratios[i - 1]);
        }
    });
});
