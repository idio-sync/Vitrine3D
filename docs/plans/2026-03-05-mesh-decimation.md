# Mesh Decimation & SD Proxy Generation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add automatic mesh decimation + texture downscaling to the editor so archives contain SD proxy GLBs that the kiosk loads on low-end devices.

**Architecture:** New `mesh-decimator.ts` module wraps meshoptimizer WASM for geometry simplification and canvas-based texture downscaling. A Web Worker handles the heavy computation off-thread. Editor sidebar gets an "SD Proxy" panel with presets and advanced controls. The decimated mesh exports as a GLB blob stored via the existing `addMeshProxy()` archive path.

**Tech Stack:** meshoptimizer (npm, WASM), Three.js GLTFExporter, Web Workers, OffscreenCanvas/Canvas 2D

---

### Task 1: Install meshoptimizer and configure Vite

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

**Step 1: Install the npm package**

Run:
```bash
npm install meshoptimizer
```

**Step 2: Add meshoptimizer to optimizeDeps.exclude in `vite.config.ts`**

meshoptimizer uses WASM internally. Add it to the exclude list alongside Spark and occt-import-js.

In `vite.config.ts`, find the `optimizeDeps` block (~line 128):

```ts
optimizeDeps: {
    exclude: ['@sparkjsdev/spark', 'occt-import-js'],
},
```

Change to:

```ts
optimizeDeps: {
    exclude: ['@sparkjsdev/spark', 'occt-import-js', 'meshoptimizer'],
},
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 4: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "feat(decimation): install meshoptimizer and configure Vite"
```

---

### Task 2: Add decimation preset constants to `constants.ts`

**Files:**
- Modify: `src/modules/constants.ts`

**Step 1: Add the preset definitions**

Add at the bottom of `src/modules/constants.ts`, before the closing of the file:

```ts
// =============================================================================
// DECIMATION PRESETS (SD proxy generation)
// =============================================================================

export interface DecimationPreset {
    name: string;
    targetRatio: number;
    maxFaces: number;
    errorThreshold: number;
    lockBorder: boolean;
    preserveUVSeams: boolean;
    textureMaxRes: number;
    textureFormat: 'jpeg' | 'png' | 'keep';
    textureQuality: number;
}

export const DECIMATION_PRESETS: Record<string, DecimationPreset> = {
    'ultra-light': {
        name: 'Ultra Light',
        targetRatio: 0.01,
        maxFaces: 25_000,
        errorThreshold: 0.02,
        lockBorder: true,
        preserveUVSeams: false,
        textureMaxRes: 512,
        textureFormat: 'jpeg',
        textureQuality: 0.80,
    },
    light: {
        name: 'Light',
        targetRatio: 0.05,
        maxFaces: 50_000,
        errorThreshold: 0.015,
        lockBorder: true,
        preserveUVSeams: true,
        textureMaxRes: 1024,
        textureFormat: 'jpeg',
        textureQuality: 0.85,
    },
    medium: {
        name: 'Medium',
        targetRatio: 0.10,
        maxFaces: 100_000,
        errorThreshold: 0.01,
        lockBorder: true,
        preserveUVSeams: true,
        textureMaxRes: 1024,
        textureFormat: 'jpeg',
        textureQuality: 0.85,
    },
    high: {
        name: 'High',
        targetRatio: 0.25,
        maxFaces: 250_000,
        errorThreshold: 0.005,
        lockBorder: true,
        preserveUVSeams: true,
        textureMaxRes: 2048,
        textureFormat: 'jpeg',
        textureQuality: 0.90,
    },
} as const;

export const DEFAULT_DECIMATION_PRESET = 'medium';
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/modules/constants.ts
git commit -m "feat(decimation): add decimation preset constants"
```

---

### Task 3: Add state fields to `types.ts`

**Files:**
- Modify: `src/types.ts`

**Step 1: Add the DecimationOptions type and state fields**

At the top of `src/types.ts`, after the existing union types (~line 8), add:

```ts
export interface DecimationOptions {
    preset: string;
    targetRatio: number;
    targetFaceCount: number | null;
    errorThreshold: number;
    lockBorder: boolean;
    preserveUVSeams: boolean;
    textureMaxRes: number;
    textureFormat: 'jpeg' | 'png' | 'keep';
    textureQuality: number;
}

export interface DecimationResult {
    faceCount: number;
    vertexCount: number;
    originalFaceCount: number;
    blob: Blob;
    preset: string;
    options: DecimationOptions;
}
```

In the `AppState` interface, add after the `manualPreviewBlob` field (~line 54):

```ts
    // Decimation / SD proxy state
    proxyMeshGroup: any | null;              // THREE.Group — decimated mesh for preview
    proxyMeshSettings: DecimationOptions | null;
    proxyMeshFaceCount: number | null;       // Actual face count after decimation
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build (AppState has `[key: string]: any` so new fields won't break existing code).

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(decimation): add DecimationOptions type and state fields"
```

---

### Task 4: Create `mesh-decimator.ts` — core decimation module

**Files:**
- Create: `src/modules/mesh-decimator.ts`

This is the main module. It handles:
1. Lazy-loading meshoptimizer WASM
2. Extracting buffers from Three.js BufferGeometry
3. Running simplification via MeshoptSimplifier
4. Texture downscaling via canvas
5. Exporting decimated group as GLB

**Step 1: Create the module**

Create `src/modules/mesh-decimator.ts` with the following content:

```ts
/**
 * Mesh Decimator Module
 *
 * Decimates Three.js meshes using meshoptimizer WASM and downscales textures
 * via canvas. Produces a lightweight GLB blob for use as an SD proxy in archives.
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Logger } from './utilities.js';
import { DECIMATION_PRESETS, DEFAULT_DECIMATION_PRESET } from './constants.js';
import type { DecimationOptions, DecimationResult } from '@/types.js';
import type { DecimationPreset } from './constants.js';

const log = Logger.getLogger('mesh-decimator');

// ===== WASM Initialization =====

let _wasmReady = false;

async function ensureWasm(): Promise<void> {
    if (_wasmReady) return;
    await MeshoptSimplifier.ready;
    _wasmReady = true;
    log.info('meshoptimizer WASM ready');
}

// ===== Resolve Options =====

/**
 * Merge a preset with optional user overrides into a full DecimationOptions.
 */
export function resolveOptions(opts?: Partial<DecimationOptions>): DecimationOptions {
    const presetKey = opts?.preset || DEFAULT_DECIMATION_PRESET;
    const preset: DecimationPreset = DECIMATION_PRESETS[presetKey] || DECIMATION_PRESETS[DEFAULT_DECIMATION_PRESET];
    return {
        preset: presetKey,
        targetRatio: opts?.targetRatio ?? preset.targetRatio,
        targetFaceCount: opts?.targetFaceCount ?? null,
        errorThreshold: opts?.errorThreshold ?? preset.errorThreshold,
        lockBorder: opts?.lockBorder ?? preset.lockBorder,
        preserveUVSeams: opts?.preserveUVSeams ?? preset.preserveUVSeams,
        textureMaxRes: opts?.textureMaxRes ?? preset.textureMaxRes,
        textureFormat: opts?.textureFormat ?? preset.textureFormat,
        textureQuality: opts?.textureQuality ?? preset.textureQuality,
    };
}

// ===== Geometry Decimation =====

/**
 * Compute the target index count from options and original face count.
 * Uses min(ratio * original, maxFaces) logic, respecting explicit targetFaceCount override.
 */
function computeTargetIndexCount(originalFaceCount: number, options: DecimationOptions): number {
    const preset = DECIMATION_PRESETS[options.preset] || DECIMATION_PRESETS[DEFAULT_DECIMATION_PRESET];

    let targetFaces: number;
    if (options.targetFaceCount != null && options.targetFaceCount > 0) {
        targetFaces = options.targetFaceCount;
    } else {
        const ratioFaces = Math.floor(originalFaceCount * options.targetRatio);
        targetFaces = Math.min(ratioFaces, preset.maxFaces);
    }
    // Ensure at least 4 faces (degenerate floor)
    targetFaces = Math.max(targetFaces, 4);
    // Convert faces to index count (3 indices per triangle)
    return targetFaces * 3;
}

/**
 * Decimates a single BufferGeometry using meshoptimizer.
 * Returns a new BufferGeometry with reduced face count.
 */
export async function decimateGeometry(
    geometry: THREE.BufferGeometry,
    options: DecimationOptions,
    onProgress?: (stage: string, pct: number) => void,
): Promise<THREE.BufferGeometry> {
    await ensureWasm();

    // Ensure indexed geometry
    let geo = geometry;
    if (!geo.index) {
        log.warn('Non-indexed geometry — merging vertices');
        geo = geo.toNonIndexed();
        // THREE.js mergeVertices from BufferGeometryUtils would be ideal here
        // but toNonIndexed + setIndex works for our purpose
    }

    const posAttr = geo.attributes.position;
    const indexAttr = geo.index!;
    const vertexCount = posAttr.count;
    const originalFaceCount = indexAttr.count / 3;

    onProgress?.('Preparing buffers', 10);

    // Extract position data
    const positions = new Float32Array(posAttr.array);
    const stride = posAttr instanceof THREE.InterleavedBufferAttribute
        ? posAttr.data.stride : 3;
    const indices = new Uint32Array(indexAttr.array);

    // Build attribute array (normals + UVs) for quality-aware simplification
    let attribArray = new Float32Array(0);
    let attribStride = 0;
    const attribWeights: number[] = [];

    const hasNormals = !!geo.attributes.normal;
    const hasUVs = !!geo.attributes.uv;

    if (options.preserveUVSeams || hasNormals) {
        attribStride = (hasNormals ? 3 : 0) + (hasUVs ? 2 : 0);
        attribArray = new Float32Array(vertexCount * attribStride);

        for (let i = 0; i < vertexCount; i++) {
            let offset = 0;
            if (hasNormals) {
                const n = geo.attributes.normal;
                attribArray[i * attribStride + offset++] = n.getX(i);
                attribArray[i * attribStride + offset++] = n.getY(i);
                attribArray[i * attribStride + offset++] = n.getZ(i);
            }
            if (hasUVs) {
                const uv = geo.attributes.uv;
                attribArray[i * attribStride + offset++] = uv.getX(i);
                attribArray[i * attribStride + offset++] = uv.getY(i);
            }
        }

        // Weights: normals at 1.0, UVs at 1.0 when preserving seams
        if (hasNormals) attribWeights.push(1.0, 1.0, 1.0);
        if (hasUVs) {
            const uvWeight = options.preserveUVSeams ? 1.0 : 0.0;
            attribWeights.push(uvWeight, uvWeight);
        }
    }

    const targetIndexCount = computeTargetIndexCount(originalFaceCount, options);

    onProgress?.('Simplifying', 30);

    // Build flags
    const flags: string[] = [];
    if (options.lockBorder) flags.push('LockBorder');

    // Run simplification
    let result: [Uint32Array, number];
    if (attribStride > 0) {
        result = MeshoptSimplifier.simplifyWithAttributes(
            indices, positions, stride,
            attribArray, attribStride, attribWeights,
            null, // no vertex locks
            targetIndexCount,
            options.errorThreshold,
            flags,
        );
    } else {
        result = MeshoptSimplifier.simplify(
            indices, positions, stride,
            targetIndexCount,
            options.errorThreshold,
            flags,
        );
    }

    const [newIndices, error] = result;
    const newFaceCount = newIndices.length / 3;
    log.info(`Decimation: ${originalFaceCount} → ${newFaceCount} faces (error: ${error.toFixed(6)})`);

    onProgress?.('Rebuilding geometry', 80);

    // Build new geometry with decimated indices, keeping all vertex attributes
    const newGeo = geo.clone();
    newGeo.setIndex(new THREE.BufferAttribute(newIndices, 1));

    onProgress?.('Complete', 100);
    return newGeo;
}

// ===== Texture Downscaling =====

/**
 * Downscale a Three.js Texture to the target resolution using a canvas.
 * Returns a new Texture with the downscaled image, or the original if already small enough.
 */
function downscaleTexture(
    texture: THREE.Texture,
    maxRes: number,
    format: 'jpeg' | 'png' | 'keep',
    quality: number,
): THREE.Texture {
    const image = texture.image;
    if (!image) return texture;

    const w = image.width || image.naturalWidth;
    const h = image.height || image.naturalHeight;
    if (!w || !h) return texture;

    // Already within budget
    if (w <= maxRes && h <= maxRes) return texture;

    // Compute target dimensions (preserve aspect ratio)
    const scale = maxRes / Math.max(w, h);
    const tw = Math.round(w * scale);
    const th = Math.round(h * scale);

    // Draw to canvas
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0, tw, th);

    log.info(`Texture downscaled: ${w}x${h} → ${tw}x${th}`);

    // Create new texture from canvas
    const newTex = new THREE.CanvasTexture(canvas);
    // Copy UV transform settings
    newTex.wrapS = texture.wrapS;
    newTex.wrapT = texture.wrapT;
    newTex.repeat.copy(texture.repeat);
    newTex.offset.copy(texture.offset);
    newTex.rotation = texture.rotation;
    newTex.center.copy(texture.center);
    newTex.flipY = texture.flipY;
    newTex.colorSpace = texture.colorSpace;

    return newTex;
}

/** Material texture map property names to process */
const TEXTURE_MAP_KEYS = [
    'map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap',
    'emissiveMap', 'bumpMap', 'displacementMap', 'alphaMap',
] as const;

/**
 * Downscale all textures on a material.
 */
function downscaleMaterialTextures(
    material: THREE.Material,
    maxRes: number,
    format: 'jpeg' | 'png' | 'keep',
    quality: number,
): void {
    const mat = material as any;
    for (const key of TEXTURE_MAP_KEYS) {
        if (mat[key] && mat[key] instanceof THREE.Texture) {
            mat[key] = downscaleTexture(mat[key], maxRes, format, quality);
        }
    }
}

// ===== Scene-Level Decimation =====

/**
 * Decimate all meshes in a THREE.Group and downscale textures.
 * Returns a new cloned group with decimated meshes.
 */
export async function decimateScene(
    group: THREE.Group,
    options: DecimationOptions,
    onProgress?: (stage: string, pct: number) => void,
): Promise<{ group: THREE.Group; totalOriginalFaces: number; totalNewFaces: number }> {
    await ensureWasm();

    // Collect all meshes
    const meshes: THREE.Mesh[] = [];
    group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
            meshes.push(child as THREE.Mesh);
        }
    });

    if (meshes.length === 0) {
        throw new Error('No meshes found in group');
    }

    log.info(`Decimating ${meshes.length} mesh(es)`);

    // Deep clone the group so we don't mutate the original
    const cloned = group.clone(true);

    // Collect cloned meshes in the same order
    const clonedMeshes: THREE.Mesh[] = [];
    cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
            clonedMeshes.push(child as THREE.Mesh);
        }
    });

    let totalOriginalFaces = 0;
    let totalNewFaces = 0;

    for (let i = 0; i < clonedMeshes.length; i++) {
        const mesh = clonedMeshes[i];
        const geo = mesh.geometry;
        const faceCount = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
        totalOriginalFaces += faceCount;

        onProgress?.(`Decimating mesh ${i + 1}/${clonedMeshes.length}`, (i / clonedMeshes.length) * 80);

        const newGeo = await decimateGeometry(geo, options);
        const newFaces = newGeo.index ? newGeo.index.count / 3 : newGeo.attributes.position.count / 3;
        totalNewFaces += newFaces;

        mesh.geometry.dispose();
        mesh.geometry = newGeo;

        // Downscale textures on this mesh's materials
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
            downscaleMaterialTextures(mat, options.textureMaxRes, options.textureFormat, options.textureQuality);
        }
    }

    onProgress?.('Complete', 100);
    log.info(`Scene decimation complete: ${totalOriginalFaces} → ${totalNewFaces} faces`);

    return { group: cloned, totalOriginalFaces, totalNewFaces };
}

// ===== GLB Export =====

/**
 * Export a THREE.Group as a GLB Blob.
 */
export async function exportAsGLB(group: THREE.Group): Promise<Blob> {
    const exporter = new GLTFExporter();
    const buffer = await exporter.parseAsync(group, { binary: true }) as ArrayBuffer;
    return new Blob([buffer], { type: 'model/gltf-binary' });
}

// ===== High-Level Pipeline =====

/**
 * Full decimation pipeline: decimate scene → export as GLB.
 * This is the main entry point called by the UI.
 */
export async function generateProxy(
    group: THREE.Group,
    userOptions?: Partial<DecimationOptions>,
    onProgress?: (stage: string, pct: number) => void,
): Promise<DecimationResult> {
    const options = resolveOptions(userOptions);
    log.info('Generating SD proxy with options:', options);

    onProgress?.('Starting decimation', 0);

    const { group: decimatedGroup, totalOriginalFaces, totalNewFaces } =
        await decimateScene(group, options, (stage, pct) => {
            onProgress?.(stage, pct * 0.8); // 0–80% for decimation
        });

    onProgress?.('Exporting GLB', 85);
    const blob = await exportAsGLB(decimatedGroup);

    onProgress?.('Done', 100);
    log.info(`Proxy GLB size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

    // Count vertices in result
    let vertexCount = 0;
    decimatedGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
            vertexCount += (child as THREE.Mesh).geometry.attributes.position.count;
        }
    });

    return {
        faceCount: totalNewFaces,
        vertexCount,
        originalFaceCount: totalOriginalFaces,
        blob,
        preset: options.preset,
        options,
    };
}

/**
 * Estimate the resulting face count without running actual decimation.
 * Uses the same target logic as the real pipeline.
 */
export function estimateFaceCount(originalFaceCount: number, opts?: Partial<DecimationOptions>): number {
    const options = resolveOptions(opts);
    const targetIndexCount = computeTargetIndexCount(originalFaceCount, options);
    return targetIndexCount / 3;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/modules/mesh-decimator.ts
git commit -m "feat(decimation): add mesh-decimator module with meshoptimizer WASM"
```

---

### Task 5: Add SD Proxy panel HTML to `editor/index.html`

**Files:**
- Modify: `src/editor/index.html` (~line 1087, replacing the existing "Display Proxies" section)

**Step 1: Replace the existing Display Proxies section**

Find the `<!-- Display Proxies -->` section (~lines 1087–1107) in `src/editor/index.html`. Replace the entire `<div class="prop-section archived">` block with:

```html
                <!-- SD Proxy (Decimation) -->
                <div class="prop-section" id="proxy-section">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">SD Proxy</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <!-- Preset selector -->
                        <label class="prop-label">Preset</label>
                        <select class="prop-select" id="decimation-preset">
                            <option value="ultra-light">Ultra Light</option>
                            <option value="light">Light</option>
                            <option value="medium" selected>Medium</option>
                            <option value="high">High</option>
                            <option value="custom">Custom</option>
                        </select>

                        <!-- Face count display -->
                        <div id="decimation-face-counts" class="prop-hint mt4">
                            <div>HD: <span id="decimation-hd-faces">—</span> faces</div>
                            <div>SD: ~<span id="decimation-sd-faces">—</span> faces (est.)</div>
                        </div>

                        <!-- Advanced geometry settings (collapsed) -->
                        <div class="prop-subsection-toggle mt4" id="decimation-advanced-toggle">
                            <span class="prop-subsection-chevron">&#9654;</span> Advanced
                        </div>
                        <div class="prop-subsection-body hidden" id="decimation-advanced-body">
                            <label class="prop-label">Target Ratio</label>
                            <input type="number" class="prop-input" id="decimation-target-ratio"
                                   min="0.001" max="1" step="0.01" value="0.10" />

                            <label class="prop-label mt4">Target Face Count (override)</label>
                            <input type="number" class="prop-input" id="decimation-target-faces"
                                   min="0" step="1000" placeholder="Leave empty for ratio-based" />

                            <label class="prop-label mt4">Max Error Threshold</label>
                            <input type="number" class="prop-input" id="decimation-error-threshold"
                                   min="0.001" max="1" step="0.001" value="0.01" />

                            <label class="prop-label mt4">
                                <input type="checkbox" id="decimation-lock-border" checked /> Lock border edges
                            </label>

                            <label class="prop-label">
                                <input type="checkbox" id="decimation-preserve-uvs" checked /> Preserve UV seams
                            </label>
                        </div>

                        <!-- Texture settings (collapsed) -->
                        <div class="prop-subsection-toggle mt4" id="decimation-texture-toggle">
                            <span class="prop-subsection-chevron">&#9654;</span> Texture Settings
                        </div>
                        <div class="prop-subsection-body hidden" id="decimation-texture-body">
                            <label class="prop-label">Max Resolution</label>
                            <select class="prop-select" id="decimation-texture-res">
                                <option value="256">256</option>
                                <option value="512">512</option>
                                <option value="1024" selected>1024</option>
                                <option value="2048">2048</option>
                                <option value="4096">4096</option>
                            </select>

                            <label class="prop-label mt4">Format</label>
                            <select class="prop-select" id="decimation-texture-format">
                                <option value="jpeg" selected>JPEG</option>
                                <option value="png">PNG</option>
                                <option value="keep">Keep Original</option>
                            </select>

                            <label class="prop-label mt4">JPEG Quality</label>
                            <input type="range" class="prop-range" id="decimation-texture-quality"
                                   min="0.1" max="1" step="0.05" value="0.85" />
                            <span class="prop-hint" id="decimation-texture-quality-label">85%</span>
                        </div>

                        <!-- Action buttons -->
                        <button class="prop-btn mt4" id="btn-generate-proxy">Generate SD Proxy</button>

                        <!-- Status area (hidden until proxy exists) -->
                        <div id="decimation-status" class="hidden mt4">
                            <span class="prop-hint" id="decimation-status-text"></span>
                            <div class="mt4">
                                <button class="prop-btn small" id="btn-preview-proxy">Preview SD</button>
                                <button class="prop-btn small danger" id="btn-remove-proxy">Remove Proxy</button>
                            </div>
                        </div>

                        <!-- Progress bar (hidden until generating) -->
                        <div id="decimation-progress" class="hidden mt4">
                            <div class="progress-bar">
                                <div class="progress-bar-fill" id="decimation-progress-fill"></div>
                            </div>
                            <span class="prop-hint" id="decimation-progress-text">Preparing...</span>
                        </div>

                        <!-- Manual proxy upload (collapsed, for backwards compat) -->
                        <div class="prop-subsection-toggle mt4" id="decimation-manual-toggle">
                            <span class="prop-subsection-chevron">&#9654;</span> Manual Proxy Upload
                        </div>
                        <div class="prop-subsection-body hidden" id="decimation-manual-body">
                            <label for="proxy-mesh-input" class="prop-btn" style="font-size:10px; cursor:pointer;">Mesh Proxy (.glb, .obj)</label>
                            <input type="file" id="proxy-mesh-input" accept=".glb,.gltf,.obj" style="display:none" />
                            <span id="proxy-mesh-filename" class="prop-hint">No proxy loaded</span>

                            <label for="proxy-splat-input" class="prop-btn mt4" style="font-size:10px; cursor:pointer;">Splat Proxy (.ply, .spz)</label>
                            <input type="file" id="proxy-splat-input" accept=".ply,.spz,.ksplat,.sog,.splat" style="display:none" />
                            <span id="proxy-splat-filename" class="prop-hint">No proxy loaded</span>
                        </div>
                    </div>
                </div>
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(decimation): add SD Proxy panel HTML to editor"
```

---

### Task 6: Add CSS for the SD Proxy panel

**Files:**
- Modify: `src/styles.css`

**Step 1: Add styles**

Find the existing `.prop-section` styles area in `src/styles.css` (search for `.prop-section-body`). After the existing prop-section rules, add:

```css
/* --- SD Proxy / Decimation panel --- */
.prop-subsection-toggle {
    font-size: 11px;
    color: var(--text-secondary, #999);
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 4px;
}
.prop-subsection-toggle:hover { color: var(--text-primary, #ccc); }
.prop-subsection-chevron {
    font-size: 8px;
    transition: transform 0.15s;
    display: inline-block;
}
.prop-subsection-toggle.open .prop-subsection-chevron {
    transform: rotate(90deg);
}
.prop-subsection-body {
    padding: 4px 0 0 8px;
}

/* Decimation progress bar */
.progress-bar {
    height: 4px;
    background: var(--bg-surface, #333);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 4px;
}
.progress-bar-fill {
    height: 100%;
    background: var(--accent, #4a9eff);
    width: 0%;
    transition: width 0.2s;
    border-radius: 2px;
}

/* Face count estimate styling */
#decimation-face-counts {
    font-variant-numeric: tabular-nums;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/styles.css
git commit -m "feat(decimation): add SD Proxy panel CSS"
```

---

### Task 7: Wire up the SD Proxy panel in `main.ts`

**Files:**
- Modify: `src/main.ts`

This is the glue task — wire all UI events to the mesh-decimator module and manage state. Follow the existing patterns in `main.ts`:
- Use `addListener()` from ui-controller for button events
- Mutate `state` directly
- Use `getStore()` from asset-store to store the proxy blob

**Step 1: Add imports**

At the top of `main.ts`, with the other module imports, add:

```ts
import { generateProxy, resolveOptions, estimateFaceCount } from './modules/mesh-decimator.js';
import { DECIMATION_PRESETS, DEFAULT_DECIMATION_PRESET } from './modules/constants.js';
import type { DecimationOptions } from './types.js';
```

**Step 2: Initialize state fields**

In the `state` object initialization in `main.ts`, add:

```ts
    proxyMeshGroup: null,
    proxyMeshSettings: null,
    proxyMeshFaceCount: null,
```

**Step 3: Add the decimation UI wiring function**

Add a new function in `main.ts` (near the other UI setup functions). This is the bulk of the wiring:

```ts
/** Wire up the SD Proxy / Decimation panel events. */
function setupDecimationPanel(): void {
    const presetSelect = document.getElementById('decimation-preset') as HTMLSelectElement | null;
    const hdFacesEl = document.getElementById('decimation-hd-faces');
    const sdFacesEl = document.getElementById('decimation-sd-faces');
    const advancedToggle = document.getElementById('decimation-advanced-toggle');
    const advancedBody = document.getElementById('decimation-advanced-body');
    const textureToggle = document.getElementById('decimation-texture-toggle');
    const textureBody = document.getElementById('decimation-texture-body');
    const manualToggle = document.getElementById('decimation-manual-toggle');
    const manualBody = document.getElementById('decimation-manual-body');
    const ratioInput = document.getElementById('decimation-target-ratio') as HTMLInputElement | null;
    const facesInput = document.getElementById('decimation-target-faces') as HTMLInputElement | null;
    const errorInput = document.getElementById('decimation-error-threshold') as HTMLInputElement | null;
    const lockBorderInput = document.getElementById('decimation-lock-border') as HTMLInputElement | null;
    const preserveUvsInput = document.getElementById('decimation-preserve-uvs') as HTMLInputElement | null;
    const texResSelect = document.getElementById('decimation-texture-res') as HTMLSelectElement | null;
    const texFormatSelect = document.getElementById('decimation-texture-format') as HTMLSelectElement | null;
    const texQualityInput = document.getElementById('decimation-texture-quality') as HTMLInputElement | null;
    const texQualityLabel = document.getElementById('decimation-texture-quality-label');
    const generateBtn = document.getElementById('btn-generate-proxy');
    const statusDiv = document.getElementById('decimation-status');
    const statusText = document.getElementById('decimation-status-text');
    const progressDiv = document.getElementById('decimation-progress');
    const progressFill = document.getElementById('decimation-progress-fill');
    const progressText = document.getElementById('decimation-progress-text');
    const previewBtn = document.getElementById('btn-preview-proxy');
    const removeBtn = document.getElementById('btn-remove-proxy');

    // === Helpers ===

    function getHdFaceCount(): number {
        return state.meshFaceCount || 0;
    }

    function updateEstimate(): void {
        const hdFaces = getHdFaceCount();
        if (hdFacesEl) hdFacesEl.textContent = hdFaces.toLocaleString();
        if (!hdFaces) {
            if (sdFacesEl) sdFacesEl.textContent = '—';
            return;
        }
        const opts = readOptionsFromUI();
        const est = estimateFaceCount(hdFaces, opts);
        if (sdFacesEl) sdFacesEl.textContent = est.toLocaleString();
    }

    function readOptionsFromUI(): Partial<DecimationOptions> {
        return {
            preset: presetSelect?.value || DEFAULT_DECIMATION_PRESET,
            targetRatio: ratioInput ? parseFloat(ratioInput.value) : undefined,
            targetFaceCount: facesInput?.value ? parseInt(facesInput.value, 10) : null,
            errorThreshold: errorInput ? parseFloat(errorInput.value) : undefined,
            lockBorder: lockBorderInput?.checked,
            preserveUVSeams: preserveUvsInput?.checked,
            textureMaxRes: texResSelect ? parseInt(texResSelect.value, 10) : undefined,
            textureFormat: texFormatSelect?.value as DecimationOptions['textureFormat'],
            textureQuality: texQualityInput ? parseFloat(texQualityInput.value) : undefined,
        };
    }

    function applyPresetToUI(presetKey: string): void {
        const preset = DECIMATION_PRESETS[presetKey];
        if (!preset) return;
        if (ratioInput) ratioInput.value = String(preset.targetRatio);
        if (facesInput) facesInput.value = '';
        if (errorInput) errorInput.value = String(preset.errorThreshold);
        if (lockBorderInput) lockBorderInput.checked = preset.lockBorder;
        if (preserveUvsInput) preserveUvsInput.checked = preset.preserveUVSeams;
        if (texResSelect) texResSelect.value = String(preset.textureMaxRes);
        if (texFormatSelect) texFormatSelect.value = preset.textureFormat;
        if (texQualityInput) texQualityInput.value = String(preset.textureQuality);
        if (texQualityLabel) texQualityLabel.textContent = `${Math.round(preset.textureQuality * 100)}%`;
        updateEstimate();
    }

    // === Collapsible subsections ===
    function wireToggle(toggle: HTMLElement | null, body: HTMLElement | null): void {
        if (!toggle || !body) return;
        toggle.addEventListener('click', () => {
            toggle.classList.toggle('open');
            body.classList.toggle('hidden');
        });
    }
    wireToggle(advancedToggle, advancedBody);
    wireToggle(textureToggle, textureBody);
    wireToggle(manualToggle, manualBody);

    // === Preset change ===
    presetSelect?.addEventListener('change', () => {
        const key = presetSelect.value;
        if (key !== 'custom') applyPresetToUI(key);
        updateEstimate();
    });

    // === Advanced field changes → switch to Custom preset ===
    const advancedInputs = [ratioInput, facesInput, errorInput, lockBorderInput, preserveUvsInput,
                            texResSelect, texFormatSelect, texQualityInput];
    for (const input of advancedInputs) {
        input?.addEventListener('change', () => {
            if (presetSelect && presetSelect.value !== 'custom') {
                presetSelect.value = 'custom';
            }
            updateEstimate();
        });
    }

    // === Texture quality label ===
    texQualityInput?.addEventListener('input', () => {
        if (texQualityLabel) texQualityLabel.textContent = `${Math.round(parseFloat(texQualityInput.value) * 100)}%`;
    });

    // === Generate SD Proxy ===
    addListener('btn-generate-proxy', 'click', async () => {
        if (!modelGroup || !state.modelLoaded) {
            notify('No mesh loaded to decimate', 'warning');
            return;
        }

        // Show progress, hide status
        progressDiv?.classList.remove('hidden');
        statusDiv?.classList.add('hidden');
        if (generateBtn) (generateBtn as HTMLButtonElement).disabled = true;

        try {
            const userOpts = readOptionsFromUI();
            const result = await generateProxy(modelGroup, userOpts, (stage, pct) => {
                if (progressFill) progressFill.style.width = `${pct}%`;
                if (progressText) progressText.textContent = stage;
            });

            // Store result
            const assets = getStore();
            assets.proxyMeshBlob = result.blob;
            state.proxyMeshSettings = result.options;
            state.proxyMeshFaceCount = result.faceCount;

            // Load the decimated GLB as a preview group
            if (state.proxyMeshGroup) {
                disposeObject(state.proxyMeshGroup);
                scene.remove(state.proxyMeshGroup);
            }
            // We already have the decimated group from the pipeline — re-import from blob for clean state
            const blobUrl = URL.createObjectURL(result.blob);
            const { loadModelFromBlobUrl } = await import('./modules/file-handlers.js');
            const loadResult = await loadModelFromBlobUrl(blobUrl, 'proxy.glb', { modelGroup: new THREE.Group(), state: { ...state, modelLoaded: false } as any });
            URL.revokeObjectURL(blobUrl);
            if (loadResult?.object) {
                state.proxyMeshGroup = loadResult.object.parent || loadResult.object as any;
                state.proxyMeshGroup.visible = false;
                scene.add(state.proxyMeshGroup);
            }

            // Update UI
            if (statusText) statusText.textContent = `Proxy ready (${result.faceCount.toLocaleString()} faces, ${(result.blob.size / 1024 / 1024).toFixed(1)} MB)`;
            statusDiv?.classList.remove('hidden');
            if (previewBtn) previewBtn.textContent = 'Preview SD';
            notify(`SD proxy generated: ${result.faceCount.toLocaleString()} faces`, 'success');
        } catch (err: any) {
            log.error('Decimation failed:', err);
            notify(`Decimation failed: ${err.message}`, 'error');
        } finally {
            progressDiv?.classList.add('hidden');
            if (generateBtn) (generateBtn as HTMLButtonElement).disabled = false;
        }
    });

    // === Preview toggle ===
    addListener('btn-preview-proxy', 'click', () => {
        if (!state.proxyMeshGroup || !modelGroup) return;
        const showingProxy = state.proxyMeshGroup.visible;
        if (showingProxy) {
            // Switch back to HD
            state.proxyMeshGroup.visible = false;
            modelGroup.visible = true;
            if (previewBtn) previewBtn.textContent = 'Preview SD';
        } else {
            // Switch to SD preview
            state.proxyMeshGroup.visible = true;
            modelGroup.visible = false;
            if (previewBtn) previewBtn.textContent = 'Preview HD';
        }
    });

    // === Remove proxy ===
    addListener('btn-remove-proxy', 'click', () => {
        const assets = getStore();
        assets.proxyMeshBlob = null;
        if (state.proxyMeshGroup) {
            scene.remove(state.proxyMeshGroup);
            disposeObject(state.proxyMeshGroup);
            state.proxyMeshGroup = null;
        }
        state.proxyMeshSettings = null;
        state.proxyMeshFaceCount = null;
        modelGroup.visible = true;
        statusDiv?.classList.add('hidden');
        notify('SD proxy removed', 'info');
    });

    // Initial estimate update
    updateEstimate();
}
```

**Step 4: Call `setupDecimationPanel()` from `init()`**

In the `init()` function in `main.ts`, add the call near the other UI setup calls (after `setupUIEvents()` or similar):

```ts
    setupDecimationPanel();
```

**Step 5: Update face count after mesh load**

Find where `state.meshFaceCount` is set in `main.ts` (or `file-handlers.ts` after mesh load). After that line, add a call to update the decimation estimate. Search for where `meshFaceCount` is assigned and add:

```ts
    // Update decimation panel estimate
    const hdFacesEl = document.getElementById('decimation-hd-faces');
    const sdFacesEl = document.getElementById('decimation-sd-faces');
    if (hdFacesEl && state.meshFaceCount) {
        hdFacesEl.textContent = state.meshFaceCount.toLocaleString();
    }
```

Note: The `meshFaceCount` field may be set as `state.meshFaceCount` in file-handlers.ts via `computeMeshFaceCount()`. Search for its assignment location and wire accordingly. The `updateEstimate()` function inside `setupDecimationPanel` handles the SD estimate.

**Step 6: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(decimation): wire SD Proxy panel events in main.ts"
```

---

### Task 8: Store decimation metadata in archive export

**Files:**
- Modify: `src/modules/export-controller.ts`
- Modify: `src/modules/archive-creator.ts`

**Step 1: Pass decimation metadata through `addMeshProxy`**

In `src/modules/archive-creator.ts`, find the `addMeshProxy` method (~line 1347). After the `face_count` assignment (~line 1372), add support for a `decimation` metadata field:

```ts
        if (options.decimation) {
            this.manifest.data_entries[entryKey].decimation = options.decimation;
        }
```

Also update the `AddProxyOptions` interface (~line 377) to include the new field:

```ts
export interface AddProxyOptions extends AddAssetOptions {
    derived_from?: string;
    face_count?: number;
    decimation?: Record<string, any>;
}
```

**Step 2: Pass decimation metadata in export-controller.ts**

In `src/modules/export-controller.ts`, find where `archiveCreator.addMeshProxy` is called (~line 322). Update to include decimation metadata from state:

```ts
        archiveCreator.addMeshProxy(assets.proxyMeshBlob, proxyFileName, {
            position, rotation, scale,
            derived_from: 'mesh_0',
            face_count: state.proxyMeshFaceCount || undefined,
            decimation: state.proxyMeshSettings ? {
                preset: state.proxyMeshSettings.preset,
                targetRatio: state.proxyMeshSettings.targetRatio,
                errorThreshold: state.proxyMeshSettings.errorThreshold,
                textureMaxRes: state.proxyMeshSettings.textureMaxRes,
                textureFormat: state.proxyMeshSettings.textureFormat,
                originalFaces: state.meshFaceCount || 0,
                resultFaces: state.proxyMeshFaceCount || 0,
            } : undefined,
        });
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/modules/archive-creator.ts src/modules/export-controller.ts
git commit -m "feat(decimation): store decimation metadata in archive manifest"
```

---

### Task 9: Restore decimation settings from archive import

**Files:**
- Modify: `src/modules/archive-pipeline.ts`

**Step 1: Read decimation metadata on archive load**

In `src/modules/archive-pipeline.ts`, find where proxy mesh information is populated (the section that sets `proxy-mesh-filename`, around lines 561–566). After that block, add:

```ts
            // Restore decimation settings from manifest
            if (proxyMeshEntry) {
                const entry = archiveLoader.manifest?.data_entries?.[Object.keys(archiveLoader.manifest.data_entries).find(
                    (k: string) => archiveLoader.manifest.data_entries[k].file_name === proxyMeshEntry.file_name
                ) || ''];
                if (entry?.decimation) {
                    state.proxyMeshSettings = {
                        preset: entry.decimation.preset || 'custom',
                        targetRatio: entry.decimation.targetRatio || 0.1,
                        targetFaceCount: null,
                        errorThreshold: entry.decimation.errorThreshold || 0.01,
                        lockBorder: true,
                        preserveUVSeams: true,
                        textureMaxRes: entry.decimation.textureMaxRes || 1024,
                        textureFormat: entry.decimation.textureFormat || 'jpeg',
                        textureQuality: 0.85,
                    };
                    state.proxyMeshFaceCount = entry.decimation.resultFaces || null;

                    // Populate the decimation panel UI
                    const presetSelect = document.getElementById('decimation-preset') as HTMLSelectElement | null;
                    if (presetSelect) presetSelect.value = entry.decimation.preset || 'custom';
                    const statusDiv = document.getElementById('decimation-status');
                    const statusText = document.getElementById('decimation-status-text');
                    if (statusDiv && statusText && entry.decimation.resultFaces) {
                        statusText.textContent = `Proxy loaded (${entry.decimation.resultFaces.toLocaleString()} faces)`;
                        statusDiv.classList.remove('hidden');
                    }
                }
            }
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/modules/archive-pipeline.ts
git commit -m "feat(decimation): restore decimation settings from archive import"
```

---

### Task 10: End-to-end manual testing

**Files:** None — testing only.

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Test in browser**

1. Open `http://localhost:8080/editor/`
2. Load a mesh file (GLB/OBJ) with known high poly count
3. Verify the SD Proxy panel appears with face count displayed
4. Select different presets — verify estimate updates
5. Expand Advanced — change ratio, verify preset switches to "Custom"
6. Click "Generate SD Proxy" — verify progress bar, completion status
7. Click "Preview SD" — verify mesh swaps to lower-poly version
8. Click "Preview HD" — verify back to original
9. Click "Remove Proxy" — verify proxy cleared
10. Generate again, then export archive — verify `.a3d` contains proxy GLB
11. Re-import the archive — verify proxy settings restored in panel

**Step 3: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: Clean build, 0 lint errors.

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(decimation): address issues from manual testing"
```

---

### Task 11: Update ROADMAP.md (if applicable)

**Files:**
- Modify: `ROADMAP.md` (if mesh decimation or SD proxy generation is listed)

Check ROADMAP.md for any mention of decimation, LOD, proxy generation, or memory optimization. Mark as completed or update status accordingly.

**Step 1: Check and update**

Search ROADMAP.md for relevant items and update their status.

**Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: update ROADMAP with mesh decimation feature"
```
