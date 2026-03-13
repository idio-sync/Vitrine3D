/**
 * Mesh Material Updates — visual mode toggles for mesh rendering
 *
 * Handles opacity, wireframe, texture toggle, matcap, normals,
 * and PBR debug views (roughness, metalness, specular F0).
 * Extracted from file-handlers.ts for modularity.
 */

import * as THREE from 'three';

// =============================================================================
// MODEL MATERIAL UPDATES
// =============================================================================

/**
 * Update model opacity
 */
export function updateModelOpacity(modelGroup: THREE.Group, opacity: number): void {
    if (modelGroup) {
        modelGroup.traverse((child) => {
            if ((child as any).isMesh && (child as any).material) {
                const materials = Array.isArray((child as any).material) ? (child as any).material : [(child as any).material];
                materials.forEach((mat: any) => {
                    mat.transparent = opacity < 1;
                    mat.opacity = opacity;
                    mat.needsUpdate = true;
                });
            }
        });
    }
}

/**
 * Update model wireframe mode
 */
export function updateModelWireframe(modelGroup: THREE.Group, wireframe: boolean): void {
    if (modelGroup) {
        modelGroup.traverse((child) => {
            if ((child as any).isMesh && (child as any).material) {
                const materials = Array.isArray((child as any).material) ? (child as any).material : [(child as any).material];
                materials.forEach((mat: any) => {
                    mat.wireframe = wireframe;
                    mat.needsUpdate = true;
                });
            }
        });
    }
}

// =============================================================================
// MODEL TEXTURE TOGGLE
// =============================================================================

// Per-mesh storage of original materials (same pattern as _storedMaterials for matcap).
// Whole-material swap avoids setting map=null+needsUpdate=true which causes WebGPU
// pipeline recompilation errors in Three.js r170+.
const _storedTexturedMaterials = new WeakMap<any, any>();

/**
 * Toggle model textures on/off by swapping whole materials (WebGPU-safe).
 */
export function updateModelTextures(modelGroup: THREE.Group, showTextures: boolean): void {
    if (!modelGroup) return;
    modelGroup.traverse((child) => {
        if (!(child as any).isMesh || !(child as any).material) return;

        const isArray = Array.isArray((child as any).material);
        const materials: any[] = isArray ? (child as any).material : [(child as any).material];

        if (!showTextures) {
            // Store originals on the mesh object (only once)
            if (!_storedTexturedMaterials.has(child)) {
                _storedTexturedMaterials.set(child, isArray ? [...materials] : materials[0]);
            }
            // Replace with texture-free clones — no map=null, no needsUpdate
            const noTexMats = materials.map((mat: any) => {
                const noTex = new THREE.MeshStandardMaterial({
                    color: mat.color ? mat.color.clone() : new THREE.Color(0xcccccc),
                    roughness: mat.roughness ?? 0.8,
                    metalness: mat.metalness ?? 0.0,
                    side: mat.side,
                    transparent: mat.transparent,
                    opacity: mat.opacity,
                    wireframe: mat.wireframe ?? false,
                });
                return noTex;
            });
            (child as any).material = isArray ? noTexMats : noTexMats[0];
        } else {
            const stored = _storedTexturedMaterials.get(child);
            if (stored) {
                (child as any).material = stored;
            }
        }
    });
}

// =============================================================================
// MATCAP RENDERING MODE
// =============================================================================

const _storedMaterials = new WeakMap<any, any>();
const _matcapTextureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Generate a matcap texture procedurally using canvas gradients.
 */
function generateMatcapTexture(style: string): THREE.CanvasTexture {
    if (_matcapTextureCache.has(style)) return _matcapTextureCache.get(style)!;

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size / 2, cy = size / 2, r = size / 2;

    const presets: Record<string, { stops: Array<[number, string]> }> = {
        clay:   { stops: [[0, '#d4c8b8'], [0.5, '#a89880'], [0.85, '#6b5d4f'], [1, '#3a3028']] },
        chrome: { stops: [[0, '#ffffff'], [0.3, '#e0e0e0'], [0.6, '#888888'], [0.85, '#333333'], [1, '#111111']] },
        pearl:  { stops: [[0, '#faf0f0'], [0.4, '#e8d8e0'], [0.7, '#c0a8b8'], [0.9, '#8a7088'], [1, '#504058']] },
        jade:   { stops: [[0, '#c8e8c0'], [0.4, '#80c078'], [0.7, '#488040'], [0.9, '#285828'], [1, '#183818']] },
        copper: { stops: [[0, '#f0c8a0'], [0.35, '#d89860'], [0.6, '#b07038'], [0.85, '#704020'], [1, '#402010']] },
        bronze: { stops: [[0, '#f4c27a'], [0.3, '#c8864a'], [0.55, '#8b5a2b'], [0.8, '#5a3518'], [1, '#1a0a00']] },
        'dark-bronze': { stops: [[0, '#8a7260'], [0.3, '#6b5545'], [0.5, '#4e3a2a'], [0.75, '#332215'], [1, '#1a0f08']] },
    };

    const preset = presets[style] || presets.clay;

    // Radial gradient for the sphere shape
    const grad = ctx.createRadialGradient(cx * 0.9, cy * 0.85, 0, cx, cy, r);
    preset.stops.forEach(([offset, color]) => grad.addColorStop(offset, color));

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Add subtle specular highlight for realism
    const highlight = ctx.createRadialGradient(cx * 0.7, cy * 0.6, 0, cx * 0.7, cy * 0.6, r * 0.4);
    highlight.addColorStop(0, 'rgba(255,255,255,0.25)');
    highlight.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = highlight;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    _matcapTextureCache.set(style, texture);
    return texture;
}

/**
 * Toggle matcap rendering mode on all meshes in a model group.
 * When enabled, replaces materials with MeshMatcapMaterial.
 * When disabled, restores original materials.
 */
export function updateModelMatcap(modelGroup: THREE.Group, enabled: boolean, style: string = 'clay'): void {
    if (!modelGroup) return;
    const matcapTexture = enabled ? generateMatcapTexture(style) : null;

    modelGroup.traverse((child) => {
        if (!(child as any).isMesh || !(child as any).material) return;

        const isArray = Array.isArray((child as any).material);
        const materials = isArray ? (child as any).material : [(child as any).material];

        if (enabled) {
            // Store originals (only on first enable, not on style change)
            if (!_storedMaterials.has(child)) {
                _storedMaterials.set(child, isArray ? [...materials] : materials[0]);
            }

            const matcapMats = materials.map((mat: any) => {
                const matcapMat = new THREE.MeshMatcapMaterial({
                    matcap: matcapTexture!,
                    color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
                    flatShading: false,
                });
                return matcapMat;
            });

            (child as any).material = isArray ? matcapMats : matcapMats[0];
        } else {
            // Restore originals
            const stored = _storedMaterials.get(child);
            if (stored) {
                // Dispose the matcap materials
                const currentMats = isArray ? (child as any).material : [(child as any).material];
                currentMats.forEach((m: any) => { if (m && m.dispose) m.dispose(); });

                (child as any).material = stored;
                _storedMaterials.delete(child);
            }
        }
    });
}

// =============================================================================
// VERTEX NORMALS VISUALIZATION
// =============================================================================

/**
 * Toggle vertex normals visualization on all meshes in a model group.
 * When enabled, replaces materials with MeshNormalMaterial (RGB = XYZ normals).
 * When disabled, restores original materials.
 * Mutually exclusive with matcap mode (shares _storedMaterials).
 */
export function updateModelNormals(modelGroup: THREE.Group, enabled: boolean): void {
    if (!modelGroup) return;

    modelGroup.traverse((child) => {
        if (!(child as any).isMesh || !(child as any).material) return;

        const isArray = Array.isArray((child as any).material);
        const materials = isArray ? (child as any).material : [(child as any).material];

        if (enabled) {
            // Store originals (only if not already stored by matcap)
            if (!_storedMaterials.has(child)) {
                _storedMaterials.set(child, isArray ? [...materials] : materials[0]);
            }

            const normalMats = materials.map(() => {
                return new THREE.MeshNormalMaterial({ flatShading: false });
            });

            (child as any).material = isArray ? normalMats : normalMats[0];
        } else {
            // Restore originals
            const stored = _storedMaterials.get(child);
            if (stored) {
                const currentMats = isArray ? (child as any).material : [(child as any).material];
                currentMats.forEach((m: any) => { if (m && m.dispose) m.dispose(); });

                (child as any).material = stored;
                _storedMaterials.delete(child);
            }
        }
    });
}

// =============================================================================
// PBR CHANNEL DEBUG VIEWS (Roughness / Metalness / Specular F0)
// =============================================================================

const _pbrDebugVert = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const _pbrDebugFrag = /* glsl */`
uniform int uMode;
uniform float uRoughness;
uniform float uMetalness;
uniform float uF0;
uniform vec3 uBaseColor;
uniform sampler2D uRoughnessMap;
uniform sampler2D uMetalnessMap;
uniform sampler2D uBaseColorMap;
uniform bool uHasRoughnessMap;
uniform bool uHasMetalnessMap;
uniform bool uHasBaseColorMap;
varying vec2 vUv;
void main() {
    if (uMode == 0) {
        float val = uRoughness;
        if (uHasRoughnessMap) val *= texture2D(uRoughnessMap, vUv).g;
        gl_FragColor = vec4(vec3(val), 1.0);
    } else if (uMode == 1) {
        float val = uMetalness;
        if (uHasMetalnessMap) val *= texture2D(uMetalnessMap, vUv).b;
        gl_FragColor = vec4(vec3(val), 1.0);
    } else {
        float met = uMetalness;
        if (uHasMetalnessMap) met *= texture2D(uMetalnessMap, vUv).b;
        vec3 base = uBaseColor;
        if (uHasBaseColorMap) base *= texture2D(uBaseColorMap, vUv).rgb;
        gl_FragColor = vec4(mix(vec3(uF0), base, met), 1.0);
    }
}`;

/**
 * Create a ShaderMaterial that visualises a single PBR channel.
 */
function _createPBRDebugMaterial(mat: any, mode: number): THREE.ShaderMaterial {
    const roughness = mat.roughness !== undefined ? mat.roughness : 0.8;
    const metalness = mat.metalness !== undefined ? mat.metalness : 0.1;
    const ior = mat.ior !== undefined ? mat.ior : 1.5;
    const f0 = Math.pow((ior - 1) / (ior + 1), 2);
    const baseColor = mat.color ? mat.color.clone() : new THREE.Color(1, 1, 1);

    return new THREE.ShaderMaterial({
        vertexShader: _pbrDebugVert,
        fragmentShader: _pbrDebugFrag,
        uniforms: {
            uMode: { value: mode },
            uRoughness: { value: roughness },
            uMetalness: { value: metalness },
            uF0: { value: f0 },
            uBaseColor: { value: baseColor },
            uRoughnessMap: { value: mat.roughnessMap || null },
            uMetalnessMap: { value: mat.metalnessMap || null },
            uBaseColorMap: { value: mat.map || null },
            uHasRoughnessMap: { value: !!mat.roughnessMap },
            uHasMetalnessMap: { value: !!mat.metalnessMap },
            uHasBaseColorMap: { value: !!mat.map },
        },
    });
}

/**
 * Generic PBR debug view toggle. Saves/restores originals via _storedMaterials.
 */
function _togglePBRDebugView(modelGroup: THREE.Group, enabled: boolean, mode: number): void {
    if (!modelGroup) return;

    modelGroup.traverse((child) => {
        if (!(child as any).isMesh || !(child as any).material) return;

        const isArray = Array.isArray((child as any).material);
        const materials = isArray ? (child as any).material : [(child as any).material];

        if (enabled) {
            if (!_storedMaterials.has(child)) {
                _storedMaterials.set(child, isArray ? [...materials] : materials[0]);
            }

            const debugMats = materials.map((mat: any) => _createPBRDebugMaterial(mat, mode));
            (child as any).material = isArray ? debugMats : debugMats[0];
        } else {
            const stored = _storedMaterials.get(child);
            if (stored) {
                const currentMats = isArray ? (child as any).material : [(child as any).material];
                currentMats.forEach((m: any) => { if (m && m.dispose) m.dispose(); });
                (child as any).material = stored;
                _storedMaterials.delete(child);
            }
        }
    });
}

/**
 * Toggle roughness debug view — grayscale visualisation of roughness values.
 * Mutually exclusive with matcap, normals, and other debug views (shares _storedMaterials).
 */
export function updateModelRoughness(modelGroup: THREE.Group, enabled: boolean): void {
    _togglePBRDebugView(modelGroup, enabled, 0);
}

/**
 * Toggle metalness debug view — grayscale visualisation of metalness values.
 * Mutually exclusive with matcap, normals, and other debug views (shares _storedMaterials).
 */
export function updateModelMetalness(modelGroup: THREE.Group, enabled: boolean): void {
    _togglePBRDebugView(modelGroup, enabled, 1);
}

/**
 * Toggle specular F0 debug view — shows Fresnel reflectance at normal incidence.
 * Dielectrics show a dark ~0.04 value; metals show their base color.
 * Mutually exclusive with matcap, normals, and other debug views (shares _storedMaterials).
 */
export function updateModelSpecularF0(modelGroup: THREE.Group, enabled: boolean): void {
    _togglePBRDebugView(modelGroup, enabled, 2);
}
