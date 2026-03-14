# Comparison System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add before/after temporal comparison viewing for GLB meshes at both the scene level and annotation detail level.

**Architecture:** A new `ComparisonViewer` module (full-screen overlay, single WebGLRenderer, two scenes with viewport/scissor rendering) supports three modes: side-by-side, slider, and toggle. Scene-level comparisons reference existing mesh keys (`mesh_0` vs `mesh_1`). Annotation-level comparisons pair two detail models. All data lives in one archive.

**Tech Stack:** Three.js 0.183.2, TypeScript, Vite, existing deps pattern

**Spec:** `docs/superpowers/specs/2026-03-13-comparison-system-design.md`

---

## File Structure

| File | Role |
|------|------|
| `src/modules/comparison-viewer.ts` | **CREATE** — Core comparison viewer: single renderer, dual scenes, three viewing modes, camera sync, alignment |
| `src/types.ts` | **MODIFY** — Add `ComparisonSide`, `ComparisonPair`, `ComparisonMode` types; extend `Annotation` |
| `src/modules/annotation-system.ts` | **MODIFY** — Serialize/deserialize comparison fields in `toJSON()` |
| `src/modules/archive-creator.ts` | **MODIFY** — Serialize `comparisons` to manifest; extend orphan cleanup |
| `src/modules/archive-loader.ts` | **MODIFY** — Parse `comparisons` from manifest |
| `src/modules/archive-pipeline.ts` | **MODIFY** — Suppress loading comparison mesh on archive open |
| `src/modules/metadata-manager.ts` | **MODIFY** — Render "Compare" button when comparison exists |
| `src/modules/kiosk-main.ts` | **MODIFY** — Wire compare button; lazy-import ComparisonViewer |
| `src/main.ts` | **MODIFY** — Wire editor comparison panel; create deps factory; update local `showAnnotationPopup` |
| `src/modules/event-wiring.ts` | **MODIFY** — Wire comparison panel UI events |
| `src/editor/index.html` | **MODIFY** — Add comparison panel, comparison overlay DOM, annotation comparison sub-section |
| `src/index.html` | **MODIFY** — Add compare button to kiosk toolbar, comparison overlay DOM |
| `src/styles.css` | **MODIFY** — Comparison overlay styles, all three modes, responsive |

---

## Chunk 1: Data Model & Serialization

### Task 1: Add Comparison Types to `types.ts`

**Files:**
- Modify: `src/types.ts:15-17` (union types area), `src/types.ts:239-260` (Annotation interface)

- [ ] **Step 1: Add ComparisonMode type and ComparisonSide/ComparisonPair interfaces**

After the existing union types block (line 23), add:

```typescript
export type ComparisonMode = 'side-by-side' | 'slider' | 'toggle';

export interface ComparisonSide {
    asset_key: string;
    label?: string;
    date?: string;
    description?: string;
}

export interface ComparisonPair {
    id: string;
    before: ComparisonSide;
    after: ComparisonSide;
    alignment?: Transform;
    default_mode?: ComparisonMode;
}

export interface AnnotationComparison {
    before_label?: string;
    before_date?: string;
    before_description?: string;
    after_label?: string;
    after_date?: string;
    after_description?: string;
    alignment?: Transform;
    default_mode?: ComparisonMode;
}
```

- [ ] **Step 2: Extend Annotation interface with comparison fields**

In the `Annotation` interface (after `detail_view_settings` at line 259), add:

```typescript
    // Comparison (before/after) link
    comparison_asset_key?: string;
    comparison?: AnnotationComparison;
```

- [ ] **Step 3: Run build to verify types compile**

Run: `npm run build`
Expected: Clean build, no type errors

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add ComparisonPair, ComparisonSide, AnnotationComparison types"
```

---

### Task 2: Serialize Comparison Fields in `annotation-system.ts`

**Files:**
- Modify: `src/modules/annotation-system.ts:739-754` (toJSON serialization)

- [ ] **Step 1: Add comparison fields to toJSON()**

After the `detail_view_settings` serialization (line 754), add:

```typescript
            if (a.comparison_asset_key) obj.comparison_asset_key = a.comparison_asset_key;
            if (a.comparison) obj.comparison = { ...a.comparison };
```

- [ ] **Step 2: Verify round-trip serialization**

Read `setAnnotations()` to confirm it preserves all fields from input objects (it pushes annotation objects directly). The key risk is `toJSON()` which builds objects field-by-field — Step 1 addresses this. Verify by mentally tracing: load archive → `setAnnotations()` preserves `comparison_asset_key` → edit → `toJSON()` includes `comparison_asset_key` (from Step 1) → export → re-load. Both directions must preserve the field.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add src/modules/annotation-system.ts
git commit -m "feat(annotations): serialize comparison_asset_key and comparison in toJSON"
```

---

### Task 3: Serialize Comparisons in `archive-creator.ts`

**Files:**
- Modify: `src/modules/archive-creator.ts:1957-1979` (orphan cleanup + manifest serialization)

- [ ] **Step 1: Extend orphan cleanup to check comparison_asset_key**

In `_cleanOrphanedDetailModels()` (line 1960), after the `detail_asset_key` check, add:

```typescript
                if (anno.comparison_asset_key) {
                    referencedKeys.add(anno.comparison_asset_key);
                }
```

- [ ] **Step 2: Extend Manifest type and add comparisons array serialization**

First, find the `Manifest` interface/type inside `archive-creator.ts` and add `comparisons?: ComparisonPair[]` to it. Without this, TypeScript will reject the assignment.

Then add a public property and setter to the `ArchiveCreator` class:

```typescript
public comparisons: ComparisonPair[] = [];

setComparisons(pairs: ComparisonPair[]): void {
    this.comparisons = pairs;
}
```

In the manifest assembly code (where `annotations` is written to `this.manifest`), add:

```typescript
if (this.comparisons && this.comparisons.length > 0) {
    this.manifest.comparisons = this.comparisons;
}
```

Import `ComparisonPair` from `../types.js`.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add src/modules/archive-creator.ts
git commit -m "feat(archive): serialize comparisons to manifest and extend orphan cleanup"
```

---

### Task 4: Parse Comparisons in `archive-loader.ts`

**Files:**
- Modify: `src/modules/archive-loader.ts` (manifest parsing section)

- [ ] **Step 1: Extract comparisons from parsed manifest**

In the manifest parsing logic (where annotations, data_entries, etc. are extracted), add:

```typescript
getComparisons(): ComparisonPair[] {
    return this.manifest?.comparisons || [];
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/modules/archive-loader.ts
git commit -m "feat(archive): parse comparisons from manifest"
```

---

### Task 5: Suppress Comparison Mesh Loading in `archive-pipeline.ts`

**Files:**
- Modify: `src/modules/archive-pipeline.ts:401-446` (mesh loading section)

- [ ] **Step 1: Check manifest for comparisons and skip "after" mesh**

The current pipeline uses `archiveLoader.getMeshEntry()` (line 401) which returns a single mesh entry. The pipeline only loads one mesh today. To support comparison, after the mesh loads, check if a second mesh exists that is the "after" side of a comparison pair. Do NOT load it into the scene — it will be extracted on demand when the Compare button is clicked.

Concrete approach: after the mesh loading block (around line 446), add:

```typescript
// Store comparison "after" mesh info for lazy extraction (do not load into scene)
const comparisons = archiveLoader.getComparisons();
if (comparisons.length > 0) {
    const afterKey = comparisons[0].after.asset_key;
    const afterEntry = manifest?.data_entries?.[afterKey];
    if (afterEntry) {
        // Store reference for lazy extraction — DO NOT load into scene
        state.comparisonAfterEntry = { key: afterKey, filename: afterEntry.file_name };
    }
}
```

This also requires adding `comparisonAfterEntry?: { key: string; filename: string } | null` to `AppState` in `types.ts` (add to Task 1). This field is runtime-only, not serialized.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/modules/archive-pipeline.ts
git commit -m "feat(archive): skip loading comparison 'after' mesh on archive open"
```

---

## Chunk 2: ComparisonViewer Core Module

### Task 6: Create ComparisonViewer — Scaffold and Lifecycle

**Files:**
- Create: `src/modules/comparison-viewer.ts`

- [ ] **Step 1: Create module with deps interface, constructor, open/close lifecycle**

```typescript
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Logger } from './logger.js';
import type { ComparisonPair, ComparisonMode, AnnotationComparison, Transform } from '../types.js';
import { normalizeScale } from '../types.js';

const log = Logger.getLogger('comparison-viewer');

export interface ComparisonViewerDeps {
    parentRenderLoop: { pause: () => void; resume: () => void };
    theme: string | null;
    isEditor: boolean;
    parentBackgroundColor?: string;
}

export interface ComparisonConfig {
    title?: string;
    before: { label?: string; date?: string; description?: string };
    after: { label?: string; date?: string; description?: string };
    alignment?: Transform;
    default_mode?: ComparisonMode;
}

export class ComparisonViewer {
    private deps: ComparisonViewerDeps;
    private renderer: THREE.WebGLRenderer | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private sceneA: THREE.Scene | null = null;
    private sceneB: THREE.Scene | null = null;
    private cameraA: THREE.PerspectiveCamera | null = null;
    private cameraB: THREE.PerspectiveCamera | null = null;
    private controlsA: OrbitControls | null = null;
    private controlsB: OrbitControls | null = null;
    private modelA: THREE.Group | null = null;
    private modelB: THREE.Group | null = null;
    private mode: ComparisonMode = 'side-by-side';
    private syncCameras = true;
    private animFrameId = 0;
    private config: ComparisonConfig | null = null;
    private overlay: HTMLElement | null = null;
    private sliderPosition = 0.5; // 0-1, for slider mode
    private activeLeader: 'A' | 'B' = 'A';
    private crossfadeValue = 0; // 0 = before, 1 = after

    constructor(deps: ComparisonViewerDeps) {
        this.deps = deps;
    }

    async open(config: ComparisonConfig, beforeBlob: Blob, afterBlob: Blob): Promise<void> {
        this.config = config;
        this.mode = config.default_mode || 'side-by-side';
        this.deps.parentRenderLoop.pause();
        this._showOverlay();
        this._initRenderer();
        this._initScenes();
        await this._loadModels(beforeBlob, afterBlob);
        if (config.alignment) this._applyAlignment(config.alignment);
        this._fitCameras();
        this._startAnimationLoop();
        log.info('ComparisonViewer opened');
    }

    close(): void {
        this._stopAnimationLoop();
        this._disposeAll();
        this._hideOverlay();
        this.deps.parentRenderLoop.resume();
        log.info('ComparisonViewer closed');
    }

    // ... private methods in subsequent steps
}
```

- [ ] **Step 2: Implement _showOverlay / _hideOverlay**

These get the overlay element by ID and toggle the `.hidden` class:

```typescript
    private _showOverlay(): void {
        this.overlay = document.getElementById('comparison-viewer-overlay');
        if (this.overlay) this.overlay.classList.remove('hidden');
    }

    private _hideOverlay(): void {
        if (this.overlay) this.overlay.classList.add('hidden');
    }
```

- [ ] **Step 3: Implement _initRenderer**

Single WebGLRenderer on the comparison canvas:

```typescript
    private _initRenderer(): void {
        this.canvas = document.getElementById('comparison-viewer-canvas') as HTMLCanvasElement;
        if (!this.canvas) throw new Error('comparison-viewer-canvas not found');
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.autoClear = false;
        const bgColor = this.deps.parentBackgroundColor || '#1a1a2e';
        this.renderer.setClearColor(new THREE.Color(bgColor));
    }
```

- [ ] **Step 4: Implement _initScenes with lighting**

Two independent scenes, each with ambient + directional lights:

```typescript
    private _initScenes(): void {
        const createScene = (): THREE.Scene => {
            const scene = new THREE.Scene();
            const ambient = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambient);
            const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
            dir1.position.set(5, 10, 7);
            scene.add(dir1);
            const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
            dir2.position.set(-5, 5, -5);
            scene.add(dir2);
            return scene;
        };
        this.sceneA = createScene();
        this.sceneB = createScene();

        const aspect = this.canvas!.clientWidth / this.canvas!.clientHeight;
        this.cameraA = new THREE.PerspectiveCamera(50, aspect, 0.01, 1000);
        this.cameraA.position.set(0, 1, 3);
        this.cameraB = this.cameraA.clone();

        this.controlsA = new OrbitControls(this.cameraA, this.canvas!);
        this.controlsA.enableDamping = true;
        this.controlsB = new OrbitControls(this.cameraB, this.canvas!);
        this.controlsB.enableDamping = true;
    }
```

- [ ] **Step 5: Implement _loadModels**

Load both GLBs in parallel using GLTFLoader:

```typescript
    private async _loadModels(beforeBlob: Blob, afterBlob: Blob): Promise<void> {
        const loader = new GLTFLoader();
        const loadOne = (blob: Blob): Promise<THREE.Group> => {
            return new Promise((resolve, reject) => {
                const url = URL.createObjectURL(blob);
                loader.load(url, (gltf) => {
                    URL.revokeObjectURL(url);
                    resolve(gltf.scene);
                }, undefined, (err) => {
                    URL.revokeObjectURL(url);
                    reject(err);
                });
            });
        };

        const [a, b] = await Promise.allSettled([loadOne(beforeBlob), loadOne(afterBlob)]);

        if (a.status === 'fulfilled') {
            this.modelA = a.value;
            this.sceneA!.add(this.modelA);
        } else {
            log.error('Failed to load before model:', a.reason);
        }
        if (b.status === 'fulfilled') {
            this.modelB = b.value;
            this.sceneB!.add(this.modelB);
        } else {
            log.error('Failed to load after model:', b.reason);
        }
    }
```

- [ ] **Step 6: Implement _applyAlignment**

Apply transform to model B:

```typescript
    private _applyAlignment(transform: Transform): void {
        if (!this.modelB) return;
        const { position, rotation, scale } = transform;
        this.modelB.position.set(position.x, position.y, position.z);
        this.modelB.rotation.set(rotation.x, rotation.y, rotation.z);
        const [sx, sy, sz] = normalizeScale(scale);
        this.modelB.scale.set(sx, sy, sz);
    }
```

- [ ] **Step 7: Implement _fitCameras**

Fit camera to bounding box of whichever models loaded:

```typescript
    private _fitCameras(): void {
        const box = new THREE.Box3();
        if (this.modelA) box.expandByObject(this.modelA);
        if (this.modelB) box.expandByObject(this.modelB);
        if (box.isEmpty()) return;

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.cameraA!.fov * (Math.PI / 180);
        const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.5;

        this.cameraA!.position.set(center.x, center.y + maxDim * 0.3, center.z + dist);
        this.cameraA!.lookAt(center);
        this.controlsA!.target.copy(center);

        this.cameraB!.position.copy(this.cameraA!.position);
        this.cameraB!.quaternion.copy(this.cameraA!.quaternion);
        this.controlsB!.target.copy(center);
    }
```

- [ ] **Step 8: Implement _disposeAll**

Full cleanup:

```typescript
    private _disposeAll(): void {
        const disposeGroup = (group: THREE.Group | null) => {
            if (!group) return;
            group.traverse((child) => {
                if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
                if ((child as THREE.Mesh).material) {
                    const materials = Array.isArray((child as THREE.Mesh).material)
                        ? (child as THREE.Mesh).material as THREE.Material[]
                        : [(child as THREE.Mesh).material as THREE.Material];
                    materials.forEach(m => {
                        if ((m as any).map) (m as any).map.dispose();
                        if ((m as any).normalMap) (m as any).normalMap.dispose();
                        m.dispose();
                    });
                }
            });
        };
        disposeGroup(this.modelA);
        disposeGroup(this.modelB);
        this.controlsA?.dispose();
        this.controlsB?.dispose();
        this.renderer?.dispose();
        this.renderer = null;
        this.sceneA = null;
        this.sceneB = null;
        this.modelA = null;
        this.modelB = null;
    }
```

- [ ] **Step 9: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 10: Commit**

```bash
git add src/modules/comparison-viewer.ts
git commit -m "feat(comparison): create ComparisonViewer scaffold with lifecycle and model loading"
```

---

### Task 7: ComparisonViewer — Rendering Modes

**Files:**
- Modify: `src/modules/comparison-viewer.ts`

- [ ] **Step 1: Implement _startAnimationLoop / _stopAnimationLoop with mode dispatch**

```typescript
    private _startAnimationLoop(): void {
        const animate = () => {
            this.animFrameId = requestAnimationFrame(animate);
            this._syncCamerasIfNeeded();
            this.controlsA?.update();
            this.controlsB?.update();
            this._render();
        };
        animate();
    }

    private _stopAnimationLoop(): void {
        if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
        this.animFrameId = 0;
    }

    private _render(): void {
        if (!this.renderer || !this.canvas) return;
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;

        // Check canvas resize
        if (this.canvas.width !== w * devicePixelRatio || this.canvas.height !== h * devicePixelRatio) {
            this.renderer.setSize(w, h);
        }

        this.renderer.clear();

        switch (this.mode) {
            case 'side-by-side': this._renderSideBySide(w, h); break;
            case 'slider': this._renderSlider(w, h); break;
            case 'toggle': this._renderToggle(w, h); break;
        }
    }
```

- [ ] **Step 2: Implement _renderSideBySide**

Two viewport halves, one scene each:

```typescript
    private _renderSideBySide(w: number, h: number): void {
        const halfW = Math.floor(w / 2);

        // Update cameras for half-width aspect
        this.cameraA!.aspect = halfW / h;
        this.cameraA!.updateProjectionMatrix();
        this.cameraB!.aspect = halfW / h;
        this.cameraB!.updateProjectionMatrix();

        // Left half — scene A (before)
        this.renderer!.setViewport(0, 0, halfW, h);
        this.renderer!.setScissor(0, 0, halfW, h);
        this.renderer!.setScissorTest(true);
        if (this.sceneA && this.cameraA) this.renderer!.render(this.sceneA, this.cameraA);

        // Clear depth buffer between passes — prevents cross-scene depth artifacts
        this.renderer!.clearDepth();

        // Right half — scene B (after)
        this.renderer!.setViewport(halfW, 0, w - halfW, h);
        this.renderer!.setScissor(halfW, 0, w - halfW, h);
        if (this.sceneB && this.cameraB) this.renderer!.render(this.sceneB, this.cameraB);

        this.renderer!.setScissorTest(false);
    }
```

- [ ] **Step 3: Implement _renderSlider**

Two-pass rendering at divider position. Both scenes use cameraA:

```typescript
    private _renderSlider(w: number, h: number): void {
        const dividerX = Math.floor(w * this.sliderPosition);

        this.cameraA!.aspect = w / h;
        this.cameraA!.updateProjectionMatrix();

        // Sync cameraB to cameraA for slider mode
        this.cameraB!.position.copy(this.cameraA!.position);
        this.cameraB!.quaternion.copy(this.cameraA!.quaternion);
        this.cameraB!.aspect = w / h;
        this.cameraB!.updateProjectionMatrix();

        this.renderer!.setScissorTest(true);

        // Left of divider — scene A (before)
        this.renderer!.setViewport(0, 0, w, h);
        this.renderer!.setScissor(0, 0, dividerX, h);
        if (this.sceneA && this.cameraA) this.renderer!.render(this.sceneA, this.cameraA);

        // Right of divider — scene B (after)
        this.renderer!.setScissor(dividerX, 0, w - dividerX, h);
        if (this.sceneB && this.cameraB) this.renderer!.render(this.sceneB, this.cameraB);

        this.renderer!.setScissorTest(false);
    }
```

- [ ] **Step 4: Implement _renderToggle**

Toggle between scenes, with crossfade support:

```typescript
    private _renderToggle(w: number, h: number): void {
        this.cameraA!.aspect = w / h;
        this.cameraA!.updateProjectionMatrix();

        // Sync cameraB to cameraA
        this.cameraB!.position.copy(this.cameraA!.position);
        this.cameraB!.quaternion.copy(this.cameraA!.quaternion);
        this.cameraB!.aspect = w / h;
        this.cameraB!.updateProjectionMatrix();

        this.renderer!.setViewport(0, 0, w, h);

        if (this.crossfadeValue <= 0) {
            // Full before
            if (this.sceneA && this.cameraA) this.renderer!.render(this.sceneA, this.cameraA);
        } else if (this.crossfadeValue >= 1) {
            // Full after
            if (this.sceneB && this.cameraB) this.renderer!.render(this.sceneB, this.cameraB);
        } else {
            // Crossfade — render A, then B with reduced opacity
            if (this.sceneA && this.cameraA) this.renderer!.render(this.sceneA, this.cameraA);
            this._setModelOpacity(this.modelB, this.crossfadeValue);
            this.renderer!.autoClear = false;
            if (this.sceneB && this.cameraB) this.renderer!.render(this.sceneB, this.cameraB);
            this.renderer!.autoClear = true;
            this._setModelOpacity(this.modelB, 1); // restore
        }
    }

    private _setModelOpacity(model: THREE.Group | null, opacity: number): void {
        if (!model) return;
        model.traverse((child) => {
            if ((child as THREE.Mesh).material) {
                const mats = Array.isArray((child as THREE.Mesh).material)
                    ? (child as THREE.Mesh).material as THREE.Material[]
                    : [(child as THREE.Mesh).material as THREE.Material];
                mats.forEach(m => {
                    (m as any).transparent = opacity < 1;
                    (m as any).opacity = opacity;
                });
            }
        });
    }
```

- [ ] **Step 5: Implement _syncCamerasIfNeeded**

Camera sync for side-by-side mode:

```typescript
    private _syncCamerasIfNeeded(): void {
        if (this.mode !== 'side-by-side' || !this.syncCameras) return;
        if (!this.cameraA || !this.cameraB || !this.controlsA || !this.controlsB) return;

        if (this.activeLeader === 'A') {
            this.cameraB.position.copy(this.cameraA.position);
            this.cameraB.quaternion.copy(this.cameraA.quaternion);
            this.controlsB.target.copy(this.controlsA.target);
        } else {
            this.cameraA.position.copy(this.cameraB.position);
            this.cameraA.quaternion.copy(this.cameraB.quaternion);
            this.controlsA.target.copy(this.controlsB.target);
        }
    }
```

- [ ] **Step 6: Add public setMode / setSliderPosition / setCrossfade / toggleSync methods**

```typescript
    setMode(mode: ComparisonMode): void {
        this.mode = mode;
        this._updateModeUI();
        this._updateAlignmentWarning();
        try { sessionStorage.setItem('comparison-mode', mode); } catch { /* ignore */ }
    }

    /** Show alignment warning badge for slider/toggle modes when no alignment is set */
    private _updateAlignmentWarning(): void {
        const badge = document.getElementById('comparison-alignment-warning');
        if (!badge) return;
        const show = this.mode !== 'side-by-side' && !this.config?.alignment;
        badge.style.display = show ? '' : 'none';
    }

    setSliderPosition(pos: number): void {
        this.sliderPosition = Math.max(0, Math.min(1, pos));
        this._updateSliderUI();
    }

    setCrossfade(value: number): void {
        this.crossfadeValue = Math.max(0, Math.min(1, value));
    }

    toggleSync(): void {
        this.syncCameras = !this.syncCameras;
    }

    toggleInstant(): void {
        this.crossfadeValue = this.crossfadeValue < 0.5 ? 1 : 0;
    }

    private _updateModeUI(): void {
        // Update mode button active states — implemented with DOM wiring
    }

    private _updateSliderUI(): void {
        // Update slider divider position — implemented with DOM wiring
    }
```

- [ ] **Step 7: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 8: Commit**

```bash
git add src/modules/comparison-viewer.ts
git commit -m "feat(comparison): implement three rendering modes — side-by-side, slider, toggle"
```

---

### Task 8: ComparisonViewer — UI Event Wiring

**Files:**
- Modify: `src/modules/comparison-viewer.ts`

- [ ] **Step 1: Wire overlay DOM events in constructor or open()**

Add event wiring for mode buttons, back button, slider drag, crossfade, sync toggle, and keyboard shortcuts:

```typescript
    private _wireEvents(): void {
        // Back button
        const backBtn = document.getElementById('btn-comparison-back');
        if (backBtn) backBtn.addEventListener('click', () => this.close());

        // Mode buttons
        const modeButtons = document.querySelectorAll('.comparison-mode-btn');
        modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.setMode(btn.getAttribute('data-mode') as ComparisonMode);
            });
        });

        // Sync toggle
        const syncBtn = document.getElementById('btn-comparison-sync');
        if (syncBtn) syncBtn.addEventListener('click', () => this.toggleSync());

        // Toggle button (instant swap)
        const toggleBtn = document.getElementById('btn-comparison-toggle');
        if (toggleBtn) toggleBtn.addEventListener('click', () => this.toggleInstant());

        // Crossfade slider
        const crossfadeSlider = document.getElementById('comparison-crossfade') as HTMLInputElement;
        if (crossfadeSlider) {
            crossfadeSlider.addEventListener('input', () => {
                this.setCrossfade(parseFloat(crossfadeSlider.value) / 100);
            });
        }

        // Slider divider drag
        this._wireSliderDrag();

        // Keyboard
        document.addEventListener('keydown', this._handleKeydown);

        // Leader detection (which side user interacts with)
        this.canvas?.addEventListener('pointerdown', (e) => {
            const rect = this.canvas!.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this.activeLeader = x < rect.width / 2 ? 'A' : 'B';
        });
    }

    private _handleKeydown = (e: KeyboardEvent): void => {
        if (!this.overlay || this.overlay.classList.contains('hidden')) return;
        if (e.key === 'Escape') this.close();
        if (e.key === ' ') { e.preventDefault(); this.toggleInstant(); }
        if (this.mode === 'slider') {
            if (e.key === 'ArrowLeft') this.setSliderPosition(this.sliderPosition - 0.02);
            if (e.key === 'ArrowRight') this.setSliderPosition(this.sliderPosition + 0.02);
            if (e.key === 'Home') this.setSliderPosition(0);
            if (e.key === 'End') this.setSliderPosition(1);
        }
    };
```

- [ ] **Step 2: Implement _wireSliderDrag for mouse and touch**

```typescript
    private _wireSliderDrag(): void {
        const divider = document.getElementById('comparison-slider-divider');
        if (!divider || !this.canvas) return;

        let dragging = false;
        const onMove = (clientX: number) => {
            if (!dragging || !this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            const pos = (clientX - rect.left) / rect.width;
            this.setSliderPosition(pos);
        };

        divider.addEventListener('pointerdown', (e) => {
            dragging = true;
            divider.setPointerCapture(e.pointerId);
        });
        divider.addEventListener('pointermove', (e) => onMove(e.clientX));
        divider.addEventListener('pointerup', () => { dragging = false; });
    }
```

- [ ] **Step 3: Call _wireEvents() from open() after _showOverlay(). Guard with a flag to prevent duplicate listeners.**

Add `private _eventsWired = false;` to the class. In `_wireEvents()`, check `if (this._eventsWired) return;` at the top and set `this._eventsWired = true;` at the end. Store button listener references so they can be removed in close.

- [ ] **Step 4: Remove all listeners in close()**

```typescript
    close(): void {
        document.removeEventListener('keydown', this._handleKeydown);
        this._eventsWired = false;
        // ... rest of close
    }
```

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 6: Commit**

```bash
git add src/modules/comparison-viewer.ts
git commit -m "feat(comparison): wire UI events — mode switching, slider drag, keyboard, sync"
```

---

## Chunk 3: HTML & CSS

### Task 9: Add Comparison Overlay to Kiosk HTML

**Files:**
- Modify: `src/index.html:367` (after annotations toggle button), `src/index.html:580` (after detail-viewer-overlay)

- [ ] **Step 1: Add compare button to kiosk toolbar**

After the `btn-toggle-annotations` button (line 367), add:

```html
                <button id="btn-toggle-compare" class="viewer-btn" title="Compare Before/After" style="display:none;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="3" width="8" height="18" rx="1"/>
                        <rect x="14" y="3" width="8" height="18" rx="1"/>
                        <line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="2 2"/>
                    </svg>
                </button>
```

- [ ] **Step 2: Add comparison viewer overlay DOM**

After the `detail-viewer-overlay` block (after line 580), add:

```html
    <!-- Comparison viewer overlay -->
    <div id="comparison-viewer-overlay" class="hidden">
        <div class="comparison-header">
            <button id="btn-comparison-back" class="detail-back-btn">&#8592; Back</button>
            <span id="comparison-title" class="comparison-title"></span>
            <div class="comparison-mode-switcher">
                <button class="comparison-mode-btn" data-mode="side-by-side" title="Side by Side">&#9776;</button>
                <button class="comparison-mode-btn" data-mode="slider" title="Slider">&#10072;</button>
                <button class="comparison-mode-btn" data-mode="toggle" title="Toggle">&#8644;</button>
            </div>
        </div>
        <div class="comparison-canvas-container">
            <canvas id="comparison-viewer-canvas"></canvas>
            <div id="comparison-slider-divider" class="comparison-slider-divider" style="display:none;">
                <div class="comparison-slider-handle"></div>
            </div>
            <div id="comparison-alignment-warning" class="comparison-alignment-warning" style="display:none;">Models may not be aligned</div>
            <div id="comparison-labels" class="comparison-labels">
                <span id="comparison-label-before" class="comparison-label left"></span>
                <span id="comparison-label-after" class="comparison-label right"></span>
            </div>
        </div>
        <div class="comparison-toolbar">
            <button id="btn-comparison-sync" class="comparison-toolbar-btn" title="Sync Cameras">&#128279; Sync</button>
            <div id="comparison-crossfade-container" style="display:none;">
                <input type="range" id="comparison-crossfade" min="0" max="100" value="0" class="comparison-crossfade-slider">
                <button id="btn-comparison-toggle" class="comparison-toolbar-btn">Toggle</button>
            </div>
        </div>
        <div id="comparison-metadata" class="comparison-metadata"></div>
    </div>
```

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add src/index.html
git commit -m "feat(kiosk): add compare button and comparison viewer overlay DOM"
```

---

### Task 10: Add Comparison UI to Editor HTML

**Files:**
- Modify: `src/editor/index.html:1688-1700` (annotation detail section), `src/editor/index.html:3200-3210` (after detail-viewer-overlay)

- [ ] **Step 1: Add comparison sub-section to annotation sidebar detail section**

After the existing `sidebar-detail-customize` div (around line 1700), add:

```html
                                <div id="sidebar-comparison-section" style="display:none;">
                                    <label>Comparison Model</label>
                                    <div class="detail-attach-area">
                                        <input type="file" id="sidebar-comparison-file" accept=".glb" style="display:none">
                                        <button type="button" id="btn-sidebar-attach-comparison" class="prop-btn small">Attach Comparison .glb</button>
                                        <span id="sidebar-comparison-filename" class="detail-filename"></span>
                                        <button type="button" id="btn-sidebar-remove-comparison" class="prop-btn danger small" style="display:none">Remove</button>
                                    </div>
                                    <div id="sidebar-comparison-customize" style="display:none">
                                        <label for="sidebar-comparison-before-label">Before Label</label>
                                        <input type="text" id="sidebar-comparison-before-label" class="prop-input" placeholder="Before">
                                        <label for="sidebar-comparison-before-date">Before Date</label>
                                        <input type="date" id="sidebar-comparison-before-date" class="prop-input">
                                        <label for="sidebar-comparison-after-label">After Label</label>
                                        <input type="text" id="sidebar-comparison-after-label" class="prop-input" placeholder="After">
                                        <label for="sidebar-comparison-after-date">After Date</label>
                                        <input type="date" id="sidebar-comparison-after-date" class="prop-input">
                                        <label for="sidebar-comparison-default-mode">Default Mode</label>
                                        <select id="sidebar-comparison-default-mode" class="prop-input">
                                            <option value="side-by-side">Side by Side</option>
                                            <option value="slider">Slider</option>
                                            <option value="toggle">Toggle</option>
                                        </select>
                                        <div class="comparison-actions">
                                            <button type="button" id="btn-sidebar-align-comparison" class="prop-btn small">Align</button>
                                            <button type="button" id="btn-sidebar-preview-comparison" class="prop-btn small">Preview Compare</button>
                                        </div>
                                    </div>
                                </div>
```

- [ ] **Step 2: Add scene-level comparison panel to editor sidebar**

Find an appropriate location in the editor sidebar (after the metadata/export section). Add a collapsible panel:

```html
                    <details id="comparison-panel" class="sidebar-section" style="display:none;">
                        <summary>Comparison</summary>
                        <div class="comparison-panel-body">
                            <p id="comparison-panel-hint" style="display:none;">Load a second mesh to enable comparisons.</p>
                            <div id="comparison-panel-form" style="display:none;">
                                <label for="comparison-before-select">Before</label>
                                <select id="comparison-before-select" class="prop-input"></select>
                                <label for="comparison-before-label">Label</label>
                                <input type="text" id="comparison-before-label" class="prop-input" placeholder="e.g., Pre-Restoration">
                                <label for="comparison-before-date">Date</label>
                                <input type="date" id="comparison-before-date" class="prop-input">
                                <label for="comparison-before-desc">Description</label>
                                <textarea id="comparison-before-desc" class="prop-input" rows="2"></textarea>

                                <label for="comparison-after-select">After</label>
                                <select id="comparison-after-select" class="prop-input"></select>
                                <label for="comparison-after-label">Label</label>
                                <input type="text" id="comparison-after-label" class="prop-input" placeholder="e.g., Post-Restoration">
                                <label for="comparison-after-date">Date</label>
                                <input type="date" id="comparison-after-date" class="prop-input">
                                <label for="comparison-after-desc">Description</label>
                                <textarea id="comparison-after-desc" class="prop-input" rows="2"></textarea>

                                <label for="comparison-default-mode">Default Mode</label>
                                <select id="comparison-default-mode" class="prop-input">
                                    <option value="side-by-side">Side by Side</option>
                                    <option value="slider">Slider</option>
                                    <option value="toggle">Toggle</option>
                                </select>
                                <div class="comparison-actions">
                                    <button type="button" id="btn-align-comparison" class="action-btn secondary">Align Models</button>
                                    <button type="button" id="btn-preview-comparison" class="action-btn secondary">Preview Compare</button>
                                </div>
                            </div>
                        </div>
                    </details>
```

- [ ] **Step 3: Add comparison overlay DOM to editor** (same as kiosk overlay from Task 9 step 2)

Add after the `detail-viewer-overlay` block (line 3250+).

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(editor): add comparison panel, annotation comparison section, and overlay DOM"
```

---

### Task 11: Add Comparison CSS

**Files:**
- Modify: `src/styles.css` (add new section at end)

- [ ] **Step 1: Add comparison overlay and layout styles**

```css
/* ===== Comparison Viewer ===== */

#comparison-viewer-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: var(--bg-primary, #1a1a2e);
    display: flex;
    flex-direction: column;
}
#comparison-viewer-overlay.hidden { display: none !important; }

.comparison-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.3);
    z-index: 1;
}
.comparison-title {
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
}
.comparison-mode-switcher {
    display: flex;
    gap: 4px;
}
.comparison-mode-btn {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.7);
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
}
.comparison-mode-btn.active {
    background: rgba(255, 255, 255, 0.25);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.4);
}
.comparison-canvas-container {
    flex: 1;
    position: relative;
    overflow: hidden;
}
#comparison-viewer-canvas {
    width: 100%;
    height: 100%;
    display: block;
}

/* Slider divider */
.comparison-slider-divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 4px;
    background: rgba(255, 255, 255, 0.6);
    cursor: ew-resize;
    z-index: 2;
    left: 50%;
    transform: translateX(-50%);
}
.comparison-slider-handle {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.9);
    border: 2px solid rgba(0, 0, 0, 0.3);
    cursor: ew-resize;
    display: flex;
    align-items: center;
    justify-content: center;
}
.comparison-slider-handle::before {
    content: '◀▶';
    font-size: 10px;
    color: #333;
}

/* Labels */
.comparison-labels {
    position: absolute;
    bottom: 16px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    padding: 0 24px;
    pointer-events: none;
    z-index: 1;
}
.comparison-label {
    background: rgba(0, 0, 0, 0.6);
    color: rgba(255, 255, 255, 0.9);
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 13px;
}

/* Toolbar */
.comparison-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.3);
}
.comparison-toolbar-btn {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.7);
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
}
.comparison-crossfade-slider {
    width: 200px;
    margin: 0 12px;
}

/* Metadata */
.comparison-metadata {
    padding: 8px 16px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
}
.comparison-metadata:empty { display: none; }

/* Responsive: stacked layout on narrow screens */
@media (max-width: 640px) {
    .comparison-labels {
        flex-direction: column;
        align-items: center;
        gap: 4px;
    }
}

/* Alignment warning badge */
.comparison-alignment-warning {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(255, 200, 0, 0.8);
    color: #333;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    z-index: 1;
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "feat(css): add comparison viewer overlay styles — all three modes plus responsive"
```

---

## Chunk 4: Integration — Kiosk & Editor Wiring

### Task 12: Wire Kiosk Compare Button

**Files:**
- Modify: `src/modules/kiosk-main.ts:412-429` (annotation detail inspect handler area)

- [ ] **Step 1: Show compare button when comparisons exist in manifest**

After archive loading completes and the annotation toggle is shown, add:

```typescript
// Show compare button if comparisons exist
const comparisons = archiveLoader.getComparisons();
if (comparisons.length > 0) {
    const compareBtn = document.getElementById('btn-toggle-compare');
    if (compareBtn) compareBtn.style.display = '';
}
```

- [ ] **Step 2: Wire compare button click to open ComparisonViewer**

Note: Scene-level comparison assets are meshes (`mesh_0`, `mesh_1`) — these are NOT in `detailAssetIndex` (which only contains `detail_N` entries). Use `data_entries` from the manifest directly for scene-level comparisons. Annotation-level comparisons use `detailAssetIndex` since they reference `detail_N` keys.

```typescript
const compareBtn = document.getElementById('btn-toggle-compare');
if (compareBtn) {
    compareBtn.addEventListener('click', async () => {
        const comparisons = archiveLoader.getComparisons();
        const pair = comparisons[0]; // Use first comparison
        if (!pair || !state.archiveLoader) return;

        // Scene-level: extract mesh blobs via data_entries (meshes are not in detailAssetIndex)
        const manifest = state.archiveLoader.getManifest();
        const beforeEntry = manifest?.data_entries?.[pair.before.asset_key];
        const afterEntry = manifest?.data_entries?.[pair.after.asset_key];
        if (!beforeEntry || !afterEntry) return;

        const [beforeResult, afterResult] = await Promise.all([
            state.archiveLoader.extractFile(beforeEntry.file_name),
            state.archiveLoader.extractFile(afterEntry.file_name),
        ]);
        if (!beforeResult || !afterResult) return;

        const { ComparisonViewer } = await import('./comparison-viewer.js');
        const viewer = new ComparisonViewer({
            parentRenderLoop: { pause: pauseRender, resume: resumeRender },
            theme: state.theme || null,
            isEditor: false,
            // parentBackgroundColor is optional, defaults to #1a1a2e in ComparisonViewer
        });
        await viewer.open({
            title: pair.before.label && pair.after.label
                ? `${pair.before.label} → ${pair.after.label}` : 'Comparison',
            before: pair.before,
            after: pair.after,
            alignment: pair.alignment,
            default_mode: pair.default_mode,
        }, beforeResult.blob, afterResult.blob);
    });
}
```

- [ ] **Step 3: Modify annotation detail button to route to ComparisonViewer when comparison exists**

In the existing `.detail-inspect-btn` click handler (around line 412), add a check:

```typescript
// Check if this annotation has a comparison
const anno = annotationSystem?.getAnnotations().find((a: any) => a.detail_asset_key === key);
if (anno?.comparison_asset_key) {
    // Annotation-level comparisons use detailAssetIndex (both are detail_N keys)
    const beforeEntry = state.detailAssetIndex.get(anno.detail_asset_key);
    const afterEntry = state.detailAssetIndex.get(anno.comparison_asset_key);
    if (!beforeEntry || !afterEntry || !state.archiveLoader) return;

    const [beforeResult, afterResult] = await Promise.all([
        state.archiveLoader.extractFile(beforeEntry.filename),
        state.archiveLoader.extractFile(afterEntry.filename),
    ]);
    if (!beforeResult || !afterResult) return;

    const { ComparisonViewer } = await import('./comparison-viewer.js');
    const viewer = new ComparisonViewer({
        parentRenderLoop: { pause: pauseRender, resume: resumeRender },
        theme: state.theme || null,
        isEditor: false,
    });
    await viewer.open({
        title: anno.title || 'Comparison',
        before: {
            label: anno.comparison?.before_label,
            date: anno.comparison?.before_date,
            description: anno.comparison?.before_description,
        },
        after: {
            label: anno.comparison?.after_label,
            date: anno.comparison?.after_date,
            description: anno.comparison?.after_description,
        },
        alignment: anno.comparison?.alignment,
        default_mode: anno.comparison?.default_mode,
    }, beforeResult.blob, afterResult.blob);
    return;
}
// ... existing DetailViewer code (unchanged)
```

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(kiosk): wire compare button and annotation comparison routing"
```

---

### Task 13: Update Metadata Manager — Compare Button

**Files:**
- Modify: `src/modules/metadata-manager.ts:2754-2766` (annotation popup detail button rendering)

- [ ] **Step 1: Change button label when annotation has comparison**

In `showAnnotationPopup()`, where the detail inspect button is rendered (line 2756-2766), change the label logic. The click handler will look up the annotation from `annotationSystem` to check `comparison_asset_key` — no need for a data attribute:

```typescript
if (annotation.detail_asset_key) {
    const hasComparison = !!annotation.comparison_asset_key;
    const label = annotation.detail_button_label || (hasComparison ? 'Compare' : 'Inspect');
    html += `<button class="detail-inspect-btn" data-detail-key="${annotation.detail_asset_key}">${label}</button>`;
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/modules/metadata-manager.ts
git commit -m "feat(metadata): show Compare button label when annotation has comparison"
```

---

### Task 14: Update `main.ts` — Editor Comparison Wiring

**Files:**
- Modify: `src/main.ts:3073` (local showAnnotationPopup), `src/main.ts:1792-1995` (detail model handling), `src/main.ts:4098` (createDetailViewerDeps)

**Important:** `main.ts` has local copies of popup functions. Both the local version and `metadata-manager.ts` version must show "Compare" vs "Inspect".

- [ ] **Step 1: Update local annotation popup to show Compare button**

In `main.ts`'s local popup rendering (around line 3073 where `detail_asset_key` is checked), mirror the change from Task 13:

```typescript
if (annotation.detail_asset_key) {
    const hasComparison = !!annotation.comparison_asset_key;
    const label = annotation.detail_button_label || (hasComparison ? 'Compare' : 'Inspect');
    // ... render button with data-has-comparison attribute
}
```

- [ ] **Step 2: Add createComparisonViewerDeps factory**

Near `createDetailViewerDeps()` (line 4098), add:

```typescript
function createComparisonViewerDeps(): ComparisonViewerDeps {
    return {
        parentRenderLoop: {
            pause: () => { /* pause animate loop */ },
            resume: () => { /* resume animate loop */ },
        },
        theme: null,
        isEditor: true,
        parentBackgroundColor: sceneManager.getBackgroundColor?.() || '#1a1a2e',
    };
}
```

- [ ] **Step 3: Wire scene-level comparison panel**

Add logic to show/hide the comparison panel based on mesh count, populate dropdowns, and handle preview:

```typescript
// Show comparison panel when 2+ meshes loaded
function updateComparisonPanelVisibility(): void {
    const panel = document.getElementById('comparison-panel');
    if (!panel) return;
    const meshCount = /* count loaded meshes */;
    panel.style.display = meshCount >= 2 ? '' : 'none';
    // Populate dropdowns...
}
```

- [ ] **Step 4: Wire annotation-level comparison attachment**

Handle the sidebar comparison file input, attaching a comparison model to the selected annotation:

```typescript
// btn-sidebar-attach-comparison click → open file picker
// On file selected → archiveCreator.addDetailModel(file) → set annotation.comparison_asset_key
```

- [ ] **Step 5: Route comparison annotations to ComparisonViewer in detail inspect handler**

In the existing `.detail-inspect-btn` click handler (around line 1792), add a comparison check before opening DetailViewer:

```typescript
if (anno?.comparison_asset_key) {
    const { ComparisonViewer } = await import('./modules/comparison-viewer.js');
    // Extract both blobs, open viewer
    return;
}
```

- [ ] **Step 6: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(editor): wire comparison panel, annotation comparison, and viewer routing"
```

---

### Task 15: Wire Comparison Panel Events

**Files:**
- Modify: `src/main.ts` (wire directly, matching the pattern used for detail model sidebar events)

The comparison panel events should be wired directly in `main.ts` after `setupUIEvents()`, NOT in `event-wiring.ts`. This matches the existing pattern: detail model sidebar events (attach, remove, preview) are wired inline in `main.ts`, not through `EventWiringDeps`. Adding to `EventWiringDeps` would require extending that large typed interface for a self-contained feature.

- [ ] **Step 1: Wire comparison panel buttons in main.ts**

After the existing detail model event wiring block in `main.ts`, add:

```typescript
// Comparison panel events
addListener('btn-sidebar-attach-comparison', 'click', () => {
    document.getElementById('sidebar-comparison-file')?.click();
});
addListener('sidebar-comparison-file', 'change', (e: Event) => {
    // Handle comparison file attachment
});
addListener('btn-sidebar-remove-comparison', 'click', () => {
    // Remove comparison model from annotation
});
addListener('btn-sidebar-preview-comparison', 'click', () => {
    // Open ComparisonViewer with current annotation's detail + comparison
});
addListener('btn-preview-comparison', 'click', () => {
    // Open ComparisonViewer with scene-level comparison
});
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(editor): wire comparison panel button events"
```

---

## Chunk 5: Final Integration & Verification

### Task 16: End-to-End Manual Testing

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: Clean build with no errors

- [ ] **Step 2: Run existing tests**

Run: `npm test`
Expected: All existing tests pass (no regressions)

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: 0 errors

- [ ] **Step 4: Manual test — editor comparison panel**

1. Open editor, load two GLB meshes
2. Verify comparison panel appears in sidebar
3. Set before/after dropdowns, labels, dates
4. Click "Preview Compare" — verify overlay opens with both models
5. Test all three modes (side-by-side, slider, toggle)
6. Close overlay, verify main scene resumes

- [ ] **Step 5: Manual test — annotation comparison**

1. Create an annotation, attach a detail model
2. Attach a comparison model to the same annotation
3. Verify comparison metadata fields appear
4. Click the annotation — verify button says "Compare"
5. Click Compare — verify ComparisonViewer opens with both detail models
6. Close, verify normal behavior

- [ ] **Step 6: Manual test — kiosk comparison**

1. Export archive with a comparison defined
2. Open in kiosk mode
3. Verify Compare button appears in toolbar
4. Click Compare — verify overlay opens
5. Test all three modes
6. Test keyboard shortcuts (Space for toggle, arrows for slider, Escape to close)

- [ ] **Step 7: Manual test — backward compatibility**

1. Open an existing archive (no comparisons)
2. Verify no Compare button appears
3. Verify detail models still open in DetailViewer (not ComparisonViewer)
4. Verify no console errors

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix(comparison): address issues found during integration testing"
```

---

## Summary

| Chunk | Tasks | Focus |
|-------|-------|-------|
| 1 | 1-5 | Data model, types, serialization, archive format |
| 2 | 6-8 | ComparisonViewer core — lifecycle, rendering, events |
| 3 | 9-11 | HTML overlays and CSS for both kiosk and editor |
| 4 | 12-15 | Integration wiring — kiosk, editor, main.ts, event system |
| 5 | 16 | End-to-end testing and verification |

**Dependencies:** Chunk 1 must complete before Chunks 2-3 (types needed). Chunks 2 and 3 are independent of each other. Chunk 4 depends on Chunks 2+3. Chunk 5 depends on all.

**Parallelization:** Tasks 1-5 are sequential. Tasks 6-8 are sequential. Tasks 9-11 can run in parallel with Tasks 6-8. Tasks 12-15 depend on prior chunks but can be partially parallelized.

## Deferred: Alignment Tool (Follow-up Task)

The spec describes an alignment tool (editor-only) that opens ComparisonViewer with `TransformControls` on the "after" model, a "Fit to Before" ICP button using `alignment.ts`, and a "Save Alignment" callback. This is the most complex editor feature and is deferred to a follow-up implementation cycle. The core comparison viewer, archive format, and kiosk UI should be fully functional without alignment — side-by-side mode works well without alignment, and slider/toggle show a warning badge when no alignment is set.

When implementing the alignment tool:
- Create a new `TransformControls` instance inside ComparisonViewer's sceneB (do NOT reuse main scene's `TransformController`)
- Add `onSaveAlignment?: (transform: Transform) => void` to `ComparisonViewerDeps`
- Wire ICP from `alignment.ts` (the `runICP()` function) to a "Fit to Before" button
- The "Align Models" button in the editor panel should be disabled/hidden until this follow-up is implemented

## Deferred: Mobile Swipe Toggle (Follow-up Task)

The spec requires swipe left/right as a toggle alternative on mobile. This requires touch gesture detection (`touchstart`/`touchend` delta X) and is deferred. The toggle button and crossfade slider work on mobile without swipe.
