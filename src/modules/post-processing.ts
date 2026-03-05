import {
    WebGLRenderer,
    Scene,
    PerspectiveCamera,
    Vector2,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Logger } from './logger.js';
import { POST_PROCESSING } from './constants.js';
import type { PostProcessingEffectConfig } from '../types.js';

const log = Logger.getLogger('post-processing');

// =============================================================================
// UBER-SHADER
// =============================================================================

const uberVertexShader = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const uberFragmentShader = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 uResolution;

uniform bool uSharpenEnabled;
uniform float uSharpenIntensity;

uniform bool uVignetteEnabled;
uniform float uVignetteIntensity;
uniform float uVignetteOffset;

uniform bool uChromaticAberrationEnabled;
uniform float uChromaticAberrationIntensity;

uniform bool uColorBalanceEnabled;
uniform vec3 uColorBalanceShadows;
uniform vec3 uColorBalanceMidtones;
uniform vec3 uColorBalanceHighlights;

uniform bool uGrainEnabled;
uniform float uGrainIntensity;
uniform float uTime;

varying vec2 vUv;

void main() {
    vec2 uv = vUv;

    // 1. Chromatic aberration — offsets UV before other effects read colour
    vec4 color;
    if (uChromaticAberrationEnabled) {
        vec2 dir = uv - 0.5;
        float dist = length(dir);
        vec2 offset = normalize(dir) * dist * uChromaticAberrationIntensity;
        float r = texture2D(tDiffuse, uv + offset).r;
        float g = texture2D(tDiffuse, uv).g;
        float b = texture2D(tDiffuse, uv - offset).b;
        color = vec4(r, g, b, texture2D(tDiffuse, uv).a);
    } else {
        color = texture2D(tDiffuse, uv);
    }

    // 2. Sharpen — 3×3 unsharp mask
    if (uSharpenEnabled) {
        vec2 texel = 1.0 / uResolution;
        vec4 up    = texture2D(tDiffuse, uv + vec2(0.0,  texel.y));
        vec4 down  = texture2D(tDiffuse, uv + vec2(0.0, -texel.y));
        vec4 left  = texture2D(tDiffuse, uv + vec2(-texel.x, 0.0));
        vec4 right = texture2D(tDiffuse, uv + vec2( texel.x, 0.0));
        vec4 blur  = (up + down + left + right) * 0.25;
        color = color + (color - blur) * uSharpenIntensity;
    }

    // 3. Color balance — lift-gamma-gain via luminance weighting
    if (uColorBalanceEnabled) {
        float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float shadowW    = 1.0 - smoothstep(0.0, 0.35, lum);
        float highlightW = smoothstep(0.55, 1.0, lum);
        float midtoneW   = 1.0 - shadowW - highlightW;
        color.rgb += shadowW    * uColorBalanceShadows
                   + midtoneW   * uColorBalanceMidtones
                   + highlightW * uColorBalanceHighlights;
    }

    // 4. Grain — hash noise
    if (uGrainEnabled) {
        float noise = fract(sin(dot(uv * uResolution + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453);
        noise = (noise - 0.5) * uGrainIntensity;
        color.rgb += noise;
    }

    // 5. Vignette — darken edges last
    if (uVignetteEnabled) {
        float vignette = smoothstep(uVignetteOffset, uVignetteOffset - uVignetteIntensity, length(vUv - 0.5));
        color.rgb *= vignette;
    }

    gl_FragColor = color;
}
`;

const uberShader = {
    uniforms: {
        tDiffuse:                   { value: null },
        uResolution:                { value: new Vector2(1, 1) },

        uSharpenEnabled:            { value: false },
        uSharpenIntensity:          { value: POST_PROCESSING.SHARPEN.intensity },

        uVignetteEnabled:           { value: false },
        uVignetteIntensity:         { value: POST_PROCESSING.VIGNETTE.intensity },
        uVignetteOffset:            { value: POST_PROCESSING.VIGNETTE.offset },

        uChromaticAberrationEnabled: { value: false },
        uChromaticAberrationIntensity: { value: POST_PROCESSING.CHROMATIC_ABERRATION.intensity },

        uColorBalanceEnabled:       { value: false },
        uColorBalanceShadows:       { value: new Vector2(0, 0) }, // placeholder; set as vec3 below
        uColorBalanceMidtones:      { value: new Vector2(0, 0) },
        uColorBalanceHighlights:    { value: new Vector2(0, 0) },

        uGrainEnabled:              { value: false },
        uGrainIntensity:            { value: POST_PROCESSING.GRAIN.intensity },
        uTime:                      { value: 0 },
    },
    vertexShader:   uberVertexShader,
    fragmentShader: uberFragmentShader,
};

// Fix vec3 uniforms — ShaderPass expects typed THREE objects, plain objects with .value work too
// but we need actual Vector3-compatible values. We'll set them after ShaderPass is created.

// =============================================================================
// MODULE STATE
// =============================================================================

let composer:   EffectComposer | null  = null;
let renderPass: RenderPass | null      = null;
let ssaoPass:   SSAOPass | null        = null;
let bloomPass:  UnrealBloomPass | null = null;
let uberPass:   ShaderPass | null      = null;
let _renderer:  WebGLRenderer | null   = null;
let _scene:     Scene | null           = null;
let _camera:    PerspectiveCamera | null = null;

const config: PostProcessingEffectConfig = {
    ssao:               { enabled: POST_PROCESSING.SSAO.enabled, radius: POST_PROCESSING.SSAO.radius, intensity: POST_PROCESSING.SSAO.intensity },
    bloom:              { enabled: POST_PROCESSING.BLOOM.enabled, strength: POST_PROCESSING.BLOOM.strength, radius: POST_PROCESSING.BLOOM.radius, threshold: POST_PROCESSING.BLOOM.threshold },
    sharpen:            { enabled: POST_PROCESSING.SHARPEN.enabled, intensity: POST_PROCESSING.SHARPEN.intensity },
    vignette:           { enabled: POST_PROCESSING.VIGNETTE.enabled, intensity: POST_PROCESSING.VIGNETTE.intensity, offset: POST_PROCESSING.VIGNETTE.offset },
    chromaticAberration: { enabled: POST_PROCESSING.CHROMATIC_ABERRATION.enabled, intensity: POST_PROCESSING.CHROMATIC_ABERRATION.intensity },
    colorBalance:       {
        enabled:    POST_PROCESSING.COLOR_BALANCE.enabled,
        shadows:    [...POST_PROCESSING.COLOR_BALANCE.shadows] as [number, number, number],
        midtones:   [...POST_PROCESSING.COLOR_BALANCE.midtones] as [number, number, number],
        highlights: [...POST_PROCESSING.COLOR_BALANCE.highlights] as [number, number, number],
    },
    grain:              { enabled: POST_PROCESSING.GRAIN.enabled, intensity: POST_PROCESSING.GRAIN.intensity },
};

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

function anyEffectEnabled(): boolean {
    if (!ssaoPass || !bloomPass) return false;
    return (
        ssaoPass.enabled ||
        bloomPass.enabled ||
        config.sharpen.enabled ||
        config.vignette.enabled ||
        config.chromaticAberration.enabled ||
        config.colorBalance.enabled ||
        config.grain.enabled
    );
}

function applyUberUniforms(): void {
    if (!uberPass) return;
    const u = uberPass.uniforms;

    u['uSharpenEnabled'].value             = config.sharpen.enabled;
    u['uSharpenIntensity'].value           = config.sharpen.intensity;

    u['uVignetteEnabled'].value            = config.vignette.enabled;
    u['uVignetteIntensity'].value          = config.vignette.intensity;
    u['uVignetteOffset'].value             = config.vignette.offset;

    u['uChromaticAberrationEnabled'].value  = config.chromaticAberration.enabled;
    u['uChromaticAberrationIntensity'].value = config.chromaticAberration.intensity;

    u['uColorBalanceEnabled'].value        = config.colorBalance.enabled;
    u['uColorBalanceShadows'].value        = config.colorBalance.shadows;
    u['uColorBalanceMidtones'].value       = config.colorBalance.midtones;
    u['uColorBalanceHighlights'].value     = config.colorBalance.highlights;

    u['uGrainEnabled'].value               = config.grain.enabled;
    u['uGrainIntensity'].value             = config.grain.intensity;
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function enable(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
): void {
    if (composer) {
        log.warn('Post-processing already enabled; call disable() first.');
        return;
    }

    _renderer = renderer;
    _scene    = scene;
    _camera   = camera;

    const size = renderer.getSize(new Vector2());
    const w = size.x;
    const h = size.y;

    composer = new EffectComposer(renderer);

    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    ssaoPass = new SSAOPass(scene, camera, w, h);
    ssaoPass.enabled = false;
    composer.addPass(ssaoPass);

    bloomPass = new UnrealBloomPass(new Vector2(w, h), config.bloom.strength, config.bloom.radius, config.bloom.threshold);
    bloomPass.enabled = false;
    composer.addPass(bloomPass);

    uberPass = new ShaderPass(uberShader);
    // Correct vec3 uniforms to plain arrays (GLSL uniform upload works with arrays)
    uberPass.uniforms['uColorBalanceShadows'].value    = config.colorBalance.shadows;
    uberPass.uniforms['uColorBalanceMidtones'].value   = config.colorBalance.midtones;
    uberPass.uniforms['uColorBalanceHighlights'].value = config.colorBalance.highlights;
    uberPass.uniforms['uResolution'].value             = new Vector2(w, h);
    applyUberUniforms();
    composer.addPass(uberPass);

    log.info(`Post-processing enabled (${w}×${h})`);
}

export function disable(): void {
    if (composer) {
        composer.dispose();
        composer = null;
    }
    renderPass = null;
    ssaoPass   = null;
    bloomPass  = null;
    uberPass   = null;
    _renderer  = null;
    _scene     = null;
    _camera    = null;
    log.info('Post-processing disabled.');
}

export function isEnabled(): boolean {
    return composer !== null;
}

export function render(): void {
    if (!composer || !_renderer || !_scene || !_camera) return;

    if (!anyEffectEnabled()) {
        _renderer.render(_scene, _camera);
        return;
    }

    // Advance time uniform for grain animation
    if (uberPass) {
        uberPass.uniforms['uTime'].value += 0.016;
    }

    composer.render();
}

export function resize(width: number, height: number, pixelRatio: number): void {
    if (!composer) return;

    composer.setSize(width, height);

    if (ssaoPass) {
        ssaoPass.setSize(width, height);
    }

    if (uberPass) {
        uberPass.uniforms['uResolution'].value = new Vector2(width * pixelRatio, height * pixelRatio);
    }
}

export function dispose(): void {
    disable();
}

export function getConfig(): PostProcessingEffectConfig {
    return {
        ssao:               { ...config.ssao },
        bloom:              { ...config.bloom },
        sharpen:            { ...config.sharpen },
        vignette:           { ...config.vignette },
        chromaticAberration: { ...config.chromaticAberration },
        colorBalance: {
            enabled:    config.colorBalance.enabled,
            shadows:    [...config.colorBalance.shadows] as [number, number, number],
            midtones:   [...config.colorBalance.midtones] as [number, number, number],
            highlights: [...config.colorBalance.highlights] as [number, number, number],
        },
        grain: { ...config.grain },
    };
}

export function setSSAO(opts: Partial<PostProcessingEffectConfig['ssao']>): void {
    config.ssao = { ...config.ssao, ...opts };
    if (!ssaoPass) return;
    ssaoPass.enabled      = config.ssao.enabled;
    ssaoPass.kernelRadius = config.ssao.radius;
    // Approximate intensity via minDistance/maxDistance scaling
    const base = 0.005;
    ssaoPass.minDistance = base * config.ssao.intensity * 0.1;
    ssaoPass.maxDistance = base * config.ssao.intensity;
}

export function setBloom(opts: Partial<PostProcessingEffectConfig['bloom']>): void {
    config.bloom = { ...config.bloom, ...opts };
    if (!bloomPass) return;
    bloomPass.enabled    = config.bloom.enabled;
    bloomPass.strength   = config.bloom.strength;
    bloomPass.radius     = config.bloom.radius;
    bloomPass.threshold  = config.bloom.threshold;
}

export function setUberEffects(opts: Partial<Omit<PostProcessingEffectConfig, 'ssao' | 'bloom'>>): void {
    if (opts.sharpen)            config.sharpen            = { ...config.sharpen, ...opts.sharpen };
    if (opts.vignette)           config.vignette           = { ...config.vignette, ...opts.vignette };
    if (opts.chromaticAberration) config.chromaticAberration = { ...config.chromaticAberration, ...opts.chromaticAberration };
    if (opts.colorBalance)       config.colorBalance       = { ...config.colorBalance, ...opts.colorBalance };
    if (opts.grain)              config.grain              = { ...config.grain, ...opts.grain };
    applyUberUniforms();
}

export function setConfig(newConfig: Partial<PostProcessingEffectConfig>): void {
    if (newConfig.ssao)   setSSAO(newConfig.ssao);
    if (newConfig.bloom)  setBloom(newConfig.bloom);
    const uberOpts: Partial<Omit<PostProcessingEffectConfig, 'ssao' | 'bloom'>> = {};
    if (newConfig.sharpen)             uberOpts.sharpen             = newConfig.sharpen;
    if (newConfig.vignette)            uberOpts.vignette            = newConfig.vignette;
    if (newConfig.chromaticAberration) uberOpts.chromaticAberration = newConfig.chromaticAberration;
    if (newConfig.colorBalance)        uberOpts.colorBalance        = newConfig.colorBalance;
    if (newConfig.grain)               uberOpts.grain               = newConfig.grain;
    if (Object.keys(uberOpts).length)  setUberEffects(uberOpts);
}
