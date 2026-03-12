import { Logger } from './utilities.js';
import { ENVIRONMENT } from './constants.js';
import type { AppState, PostProcessingEffectConfig } from '../types.js';

const log = Logger.getLogger('rendering-presets');

// ===== Types =====

export interface RenderingPreset {
    name: string;
    label: string;
    hdri: string | null;
    toneMapping: string;
    toneMappingExposure: number;
    ambientIntensity: number;
    hemisphereIntensity: number;
    directional1Intensity: number;
    directional2Intensity: number;
    postProcessing: Partial<PostProcessingEffectConfig>;
    backgroundColor: string | null;
    envAsBackground: boolean;
}

export interface CurrentRenderingSettings {
    hdri: string | null;
    toneMapping: string;
    toneMappingExposure: number;
    ambientIntensity: number;
    hemisphereIntensity: number;
    directional1Intensity: number;
    directional2Intensity: number;
    envAsBackground: boolean;
}

// ===== Preset Definitions =====

export const RENDERING_PRESETS: Record<string, RenderingPreset> = {
    technical: {
        name: 'technical',
        label: 'Technical',
        hdri: null,
        toneMapping: 'None',
        toneMappingExposure: 1.0,
        ambientIntensity: 0.6,
        hemisphereIntensity: 0.4,
        directional1Intensity: 0.8,
        directional2Intensity: 0.3,
        postProcessing: {},
        backgroundColor: '#2a2a2a',
        envAsBackground: false,
    },
    studio: {
        name: 'studio',
        label: 'Studio',
        hdri: 'Studio',
        toneMapping: 'AgX',
        toneMappingExposure: 0.8,
        ambientIntensity: 0.2,
        hemisphereIntensity: 0,
        directional1Intensity: 0,
        directional2Intensity: 0,
        postProcessing: {
            sharpen: { enabled: true, intensity: 0.25 },
        },
        backgroundColor: '#2a2a2a',
        envAsBackground: false,
    },
    outdoor: {
        name: 'outdoor',
        label: 'Outdoor',
        hdri: 'Outdoor',
        toneMapping: 'ACESFilmic',
        toneMappingExposure: 1.0,
        ambientIntensity: 0,
        hemisphereIntensity: 0,
        directional1Intensity: 0,
        directional2Intensity: 0,
        postProcessing: {},
        backgroundColor: null,
        envAsBackground: true,
    },
    dramatic: {
        name: 'dramatic',
        label: 'Dramatic',
        hdri: 'Dark Studio',
        toneMapping: 'AgX',
        toneMappingExposure: 0.75,
        ambientIntensity: 0,
        hemisphereIntensity: 0,
        directional1Intensity: 0,
        directional2Intensity: 0,
        postProcessing: {
            sharpen: { enabled: true, intensity: 0.25 },
            vignette: { enabled: true, intensity: 0.3, offset: 1.1 },
        },
        backgroundColor: '#1a1a1a',
        envAsBackground: false,
    },
};

// ===== Helpers =====

/** Check if an environment preset URL points to a locally bundled file. */
export function isLocalPreset(preset: { name: string; url: string }): boolean {
    return preset.url.startsWith('/') && preset.url.length > 1;
}

/**
 * Compare current rendering settings against all presets.
 * Returns the matching preset name, or 'custom' if no match.
 */
export function getCurrentPresetName(settings: CurrentRenderingSettings): string {
    for (const [key, preset] of Object.entries(RENDERING_PRESETS)) {
        if (
            settings.hdri === preset.hdri &&
            settings.toneMapping === preset.toneMapping &&
            Math.abs(settings.toneMappingExposure - preset.toneMappingExposure) < 0.01 &&
            Math.abs(settings.ambientIntensity - preset.ambientIntensity) < 0.01 &&
            Math.abs(settings.hemisphereIntensity - preset.hemisphereIntensity) < 0.01 &&
            Math.abs(settings.directional1Intensity - preset.directional1Intensity) < 0.01 &&
            Math.abs(settings.directional2Intensity - preset.directional2Intensity) < 0.01 &&
            settings.envAsBackground === preset.envAsBackground
        ) {
            return key;
        }
    }
    return 'custom';
}

/**
 * Determine if a rendering preset should be auto-applied.
 * Only auto-apply when a mesh is loaded without a splat (splats bake their own lighting).
 */
export function shouldAutoApplyPreset(state: Pick<AppState, 'splatLoaded' | 'modelLoaded'>): boolean {
    return !state.splatLoaded && state.modelLoaded;
}

// ===== Apply Preset =====

export interface ApplyPresetDeps {
    sceneManager: {
        loadHDREnvironment: (url: string) => Promise<any>;
        clearEnvironment: () => void;
        setToneMapping: (type: string) => void;
        setToneMappingExposure: (value: number) => void;
        setAmbientLightIntensity: (value: number) => void;
        setHemisphereLightIntensity: (value: number) => void;
        setDirectionalLight1Intensity: (value: number) => void;
        setDirectionalLight2Intensity: (value: number) => void;
        setEnvironmentAsBackground: (show: boolean) => void;
        setBackgroundColor: (hex: string) => void;
    };
    postProcessing: {
        isEnabled: () => boolean;
        enable: (renderer: any, scene: any, camera: any) => void;
        setConfig: (config: any) => void;
        getConfig: () => PostProcessingEffectConfig;
    } | null;
    state: AppState;
}

/**
 * Apply a rendering preset by name.
 * Loads HDR (async), sets tone mapping, lighting, post-processing, and background.
 * Stores the HDR blob in state.environmentBlob for archive bundling.
 */
export async function applyPreset(
    name: string,
    deps: ApplyPresetDeps,
): Promise<void> {
    const preset = RENDERING_PRESETS[name];
    if (!preset) {
        log.warn(`Unknown rendering preset: ${name}`);
        return;
    }

    log.info(`Applying rendering preset: ${preset.label}`);

    // 1. Load or clear HDR environment
    if (preset.hdri) {
        const envPreset = ENVIRONMENT.PRESETS.find(p => p.name === preset.hdri);
        if (envPreset?.url) {
            // Fetch raw blob for archive bundling
            try {
                const response = await fetch(envPreset.url);
                const blob = await response.blob();
                deps.state.environmentBlob = blob;

                // Load into Three.js via blob URL
                const blobUrl = URL.createObjectURL(blob);
                try {
                    await deps.sceneManager.loadHDREnvironment(blobUrl);
                } finally {
                    URL.revokeObjectURL(blobUrl);
                }
            } catch (err) {
                log.error(`Failed to load HDR for preset ${name}:`, err);
                // Continue applying other settings even if HDR fails
            }
        }
    } else {
        deps.sceneManager.clearEnvironment();
        deps.state.environmentBlob = null;
    }

    // 2. Tone mapping
    deps.sceneManager.setToneMapping(preset.toneMapping);
    deps.sceneManager.setToneMappingExposure(preset.toneMappingExposure);

    // 3. Lighting
    deps.sceneManager.setAmbientLightIntensity(preset.ambientIntensity);
    deps.sceneManager.setHemisphereLightIntensity(preset.hemisphereIntensity);
    deps.sceneManager.setDirectionalLight1Intensity(preset.directional1Intensity);
    deps.sceneManager.setDirectionalLight2Intensity(preset.directional2Intensity);

    // 4. Environment as background
    deps.sceneManager.setEnvironmentAsBackground(preset.envAsBackground);

    // 5. Background color
    if (preset.backgroundColor) {
        deps.sceneManager.setBackgroundColor(preset.backgroundColor);
    }

    // 6. Post-processing
    if (deps.postProcessing && Object.keys(preset.postProcessing).length > 0) {
        const currentConfig = deps.postProcessing.getConfig();
        const mergedConfig = { ...currentConfig };
        // Reset all effects to disabled first
        for (const key of Object.keys(mergedConfig) as Array<keyof PostProcessingEffectConfig>) {
            if (typeof mergedConfig[key] === 'object' && 'enabled' in mergedConfig[key]) {
                (mergedConfig[key] as any).enabled = false;
            }
        }
        // Apply preset overrides
        for (const [key, value] of Object.entries(preset.postProcessing)) {
            (mergedConfig as any)[key] = { ...(mergedConfig as any)[key], ...value };
        }
        deps.postProcessing.setConfig(mergedConfig);
    } else if (deps.postProcessing) {
        // No post-processing in preset — disable all
        const currentConfig = deps.postProcessing.getConfig();
        const disabledConfig = { ...currentConfig };
        for (const key of Object.keys(disabledConfig) as Array<keyof PostProcessingEffectConfig>) {
            if (typeof disabledConfig[key] === 'object' && 'enabled' in disabledConfig[key]) {
                (disabledConfig[key] as any).enabled = false;
            }
        }
        deps.postProcessing.setConfig(disabledConfig);
    }

    // 7. Update state
    deps.state.renderingPreset = name;

    log.info(`Preset "${preset.label}" applied`);
}
