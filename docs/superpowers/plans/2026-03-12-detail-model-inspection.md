# Detail Model Inspection via Annotations — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow annotations to link to standalone GLB mesh models that open in a dedicated overlay viewer for close-up inspection, with their own camera constraints, lighting presets, and one level of text-only sub-annotations.

**Architecture:** New `detail-viewer.ts` module encapsulates an isolated Three.js renderer overlay. Annotations gain optional `detail_asset_key` linking to archive entries with `role: 'detail'`. Detail assets are lazy-loaded — only metadata is indexed on archive open; full extraction happens on user click. The `AnnotationSystem` constructor is extended to accept a custom container element, enabling a second instance scoped to the detail overlay.

**Tech Stack:** Three.js 0.183.2, TypeScript, Vite, fflate (ZIP)

**Spec:** `docs/superpowers/specs/2026-03-12-detail-model-inspection-design.md`

---

## Chunk 1: Data Model & Type Foundation

### Task 1: Add DetailViewSettings and extend Annotation interface

**Files:**
- Modify: `src/types.ts:234-249` (Annotation interface)
- Modify: `src/types.ts:63-134` (AppState interface)
- Test: `src/modules/__tests__/detail-types.test.ts`

- [ ] **Step 1: Write the test for type compatibility**

```typescript
// src/modules/__tests__/detail-types.test.ts
import { describe, it, expect } from 'vitest';
import type { Annotation, DetailViewSettings, AppState } from '../../types.js';

describe('Detail model type extensions', () => {
    it('Annotation accepts detail fields', () => {
        const anno: Annotation = {
            id: 'anno_1', title: 'Test', body: '',
            position: { x: 0, y: 0, z: 0 },
            camera_target: { x: 0, y: 0, z: 0 },
            camera_position: { x: 1, y: 1, z: 1 },
            detail_asset_key: 'detail_0',
            detail_button_label: 'View Stonework',
            detail_thumbnail: 'images/detail_0_thumb.png',
            detail_annotations: [],
            detail_view_settings: { environment_preset: 'warm' }
        };
        expect(anno.detail_asset_key).toBe('detail_0');
    });

    it('Annotation works without detail fields (backward compat)', () => {
        const anno: Annotation = {
            id: 'anno_1', title: 'Test', body: '',
            position: { x: 0, y: 0, z: 0 },
            camera_target: { x: 0, y: 0, z: 0 },
            camera_position: { x: 1, y: 1, z: 1 }
        };
        expect(anno.detail_asset_key).toBeUndefined();
    });

    it('DetailViewSettings accepts all optional fields', () => {
        const settings: DetailViewSettings = {
            min_distance: 0.5,
            max_distance: 10,
            min_polar_angle: 0,
            max_polar_angle: Math.PI,
            enable_pan: true,
            auto_rotate: true,
            auto_rotate_speed: 2,
            damping_factor: 0.05,
            zoom_to_cursor: true,
            initial_camera_position: { x: 1, y: 1, z: 1 },
            initial_camera_target: { x: 0, y: 0, z: 0 },
            background_color: '#1a1a2e',
            environment_preset: 'studio',
            ambient_intensity: 0.8,
            show_grid: false,
            description: 'Corinthian capital',
            scale_reference: '~30cm wide',
            annotations_visible_on_open: true
        };
        expect(settings.environment_preset).toBe('studio');
    });

    it('detail_annotations prevents nesting', () => {
        // Type system allows nesting but UI enforces single level.
        // Verify the type accepts Annotation[] without detail fields.
        const detailAnno: Annotation = {
            id: 'da_1', title: 'Crack', body: 'hairline crack',
            position: { x: 0.1, y: 0.5, z: -0.2 },
            camera_target: { x: 0.1, y: 0.5, z: -0.2 },
            camera_position: { x: 0.5, y: 0.8, z: 0.3 }
            // No detail_asset_key — enforced by UI, not type
        };
        const parent: Annotation = {
            id: 'anno_1', title: 'Capital', body: '',
            position: { x: 0, y: 0, z: 0 },
            camera_target: { x: 0, y: 0, z: 0 },
            camera_position: { x: 1, y: 1, z: 1 },
            detail_asset_key: 'detail_0',
            detail_annotations: [detailAnno]
        };
        expect(parent.detail_annotations).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/__tests__/detail-types.test.ts`
Expected: FAIL — `DetailViewSettings` type does not exist yet, `detail_asset_key` not on `Annotation`

- [ ] **Step 3: Add DetailViewSettings interface to types.ts**

Add after the `Annotation` interface (after line 249):

```typescript
/** View settings for the detail model inspection overlay. */
export interface DetailViewSettings {
    // Camera constraints
    min_distance?: number;
    max_distance?: number;
    min_polar_angle?: number;
    max_polar_angle?: number;
    enable_pan?: boolean;
    auto_rotate?: boolean;
    auto_rotate_speed?: number;
    damping_factor?: number;
    zoom_to_cursor?: boolean;

    // Initial camera
    initial_camera_position?: { x: number; y: number; z: number };
    initial_camera_target?: { x: number; y: number; z: number };

    // Display
    background_color?: string;
    environment_preset?: 'studio' | 'outdoor' | 'neutral' | 'warm';
    ambient_intensity?: number;
    show_grid?: boolean;

    // Presentation
    description?: string;
    scale_reference?: string;

    // Annotation behavior
    annotations_visible_on_open?: boolean;
}
```

- [ ] **Step 4: Extend Annotation interface with detail fields**

Add to the `Annotation` interface (inside the interface body, after `qa_notes`):

```typescript
    // Detail model inspection link
    detail_asset_key?: string;
    detail_button_label?: string;
    detail_thumbnail?: string;
    detail_annotations?: Annotation[];
    detail_view_settings?: DetailViewSettings;
```

- [ ] **Step 5: Add detail runtime state to AppState**

Add to `AppState` interface (after the `renderingPreset` field at the end):

```typescript
    // Detail model inspection (runtime-only, not serialized)
    detailAssetIndex: Map<string, { filename: string }>;
    loadedDetailBlobs: Map<string, string>;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/modules/__tests__/detail-types.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/modules/__tests__/detail-types.test.ts
git commit -m "feat(detail-model): add DetailViewSettings interface and Annotation detail fields"
```

---

### Task 2: Update AnnotationSystem toJSON to preserve detail fields

**Files:**
- Modify: `src/modules/annotation-system.ts:714-729` (toJSON method)

- [ ] **Step 1: Write the test**

Add to `src/modules/__tests__/detail-types.test.ts`:

```typescript
import { AnnotationSystem } from '../annotation-system.js';

describe('AnnotationSystem detail field serialization', () => {
    it('toJSON preserves detail fields on annotations', () => {
        // Create a minimal AnnotationSystem with mocked deps
        const mockScene = { add: () => {}, children: [] };
        const mockCamera = { position: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }) }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
        const mockRenderer = { domElement: document.createElement('canvas') };
        const mockControls = { target: { x: 0, y: 0, z: 0 } };

        const system = new AnnotationSystem(mockScene, mockCamera, mockRenderer, mockControls);

        // Directly set annotations with detail fields
        const annotations: Annotation[] = [{
            id: 'anno_1', title: 'Capital', body: 'ornate stonework',
            position: { x: 1, y: 2, z: 3 },
            camera_target: { x: 0, y: 0, z: 0 },
            camera_position: { x: 5, y: 5, z: 5 },
            detail_asset_key: 'detail_0',
            detail_button_label: 'View Stonework',
            detail_thumbnail: 'images/detail_0_thumb.png',
            detail_annotations: [{
                id: 'da_1', title: 'Crack', body: 'hairline',
                position: { x: 0.1, y: 0.5, z: -0.2 },
                camera_target: { x: 0.1, y: 0.5, z: -0.2 },
                camera_position: { x: 0.5, y: 0.8, z: 0.3 }
            }],
            detail_view_settings: {
                environment_preset: 'warm',
                auto_rotate: true,
                scale_reference: '~30cm wide'
            }
        }];

        system.setAnnotations(annotations);
        const json = system.toJSON();

        expect(json[0].detail_asset_key).toBe('detail_0');
        expect(json[0].detail_button_label).toBe('View Stonework');
        expect(json[0].detail_thumbnail).toBe('images/detail_0_thumb.png');
        expect(json[0].detail_annotations).toHaveLength(1);
        expect(json[0].detail_annotations![0].title).toBe('Crack');
        expect(json[0].detail_view_settings?.environment_preset).toBe('warm');
    });

    it('toJSON omits detail fields when not present', () => {
        const mockScene = { add: () => {}, children: [] };
        const mockCamera = { position: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }) }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
        const mockRenderer = { domElement: document.createElement('canvas') };
        const mockControls = { target: { x: 0, y: 0, z: 0 } };

        const system = new AnnotationSystem(mockScene, mockCamera, mockRenderer, mockControls);
        system.setAnnotations([{
            id: 'anno_1', title: 'Test', body: '',
            position: { x: 0, y: 0, z: 0 },
            camera_target: { x: 0, y: 0, z: 0 },
            camera_position: { x: 1, y: 1, z: 1 }
        }]);

        const json = system.toJSON();
        expect(json[0].detail_asset_key).toBeUndefined();
        expect(json[0].detail_annotations).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/__tests__/detail-types.test.ts`
Expected: FAIL — `toJSON()` does not copy detail fields

- [ ] **Step 3: Update toJSON in annotation-system.ts**

Replace the `toJSON()` method (lines 714-729) with:

```typescript
    toJSON(): Annotation[] {
        return this.annotations.map(a => {
            const obj: Annotation = {
                id: a.id,
                title: a.title,
                body: a.body,
                position: { ...a.position },
                camera_target: { ...a.camera_target },
                camera_position: { ...a.camera_position }
            };
            if (a.camera_quaternion) {
                obj.camera_quaternion = { ...a.camera_quaternion };
            }
            // Detail model fields
            if (a.detail_asset_key) obj.detail_asset_key = a.detail_asset_key;
            if (a.detail_button_label) obj.detail_button_label = a.detail_button_label;
            if (a.detail_thumbnail) obj.detail_thumbnail = a.detail_thumbnail;
            if (a.detail_annotations && a.detail_annotations.length > 0) {
                obj.detail_annotations = a.detail_annotations.map(da => ({
                    id: da.id,
                    title: da.title,
                    body: da.body,
                    position: { ...da.position },
                    camera_target: { ...da.camera_target },
                    camera_position: { ...da.camera_position },
                    ...(da.camera_quaternion ? { camera_quaternion: { ...da.camera_quaternion } } : {})
                }));
            }
            if (a.detail_view_settings) {
                obj.detail_view_settings = { ...a.detail_view_settings };
            }
            return obj;
        });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/__tests__/detail-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/annotation-system.ts src/modules/__tests__/detail-types.test.ts
git commit -m "feat(detail-model): preserve detail fields in AnnotationSystem.toJSON()"
```

---

### Task 3: Parameterize AnnotationSystem container element

**Files:**
- Modify: `src/modules/annotation-system.ts:84-144` (constructor + _createMarkerContainer)

The detail viewer needs its own `AnnotationSystem` instance with a different marker container (`#detail-annotation-markers`). Currently the constructor hardcodes `#annotation-markers`.

- [ ] **Step 1: Write the test**

Add to `src/modules/__tests__/detail-types.test.ts`:

```typescript
// @vitest-environment jsdom
describe('AnnotationSystem container parameterization', () => {
    it('uses default container when no override provided', () => {
        const container = document.createElement('div');
        container.id = 'annotation-markers';
        document.body.appendChild(container);

        const mockScene = { add: () => {}, children: [] };
        const mockCamera = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
        const mockRenderer = { domElement: document.createElement('canvas') };
        const mockControls = { target: { x: 0, y: 0, z: 0 } };

        const system = new AnnotationSystem(mockScene, mockCamera, mockRenderer, mockControls);
        expect(system.markerContainer).toBe(container);

        system.dispose();
        container.remove();
    });

    it('uses custom container when provided', () => {
        const customContainer = document.createElement('div');
        customContainer.id = 'detail-annotation-markers';
        document.body.appendChild(customContainer);

        const mockScene = { add: () => {}, children: [] };
        const mockCamera = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
        const mockRenderer = { domElement: document.createElement('canvas') };
        const mockControls = { target: { x: 0, y: 0, z: 0 } };

        const system = new AnnotationSystem(mockScene, mockCamera, mockRenderer, mockControls, {
            markerContainer: customContainer
        });
        expect(system.markerContainer).toBe(customContainer);

        system.dispose();
        customContainer.remove();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/__tests__/detail-types.test.ts`
Expected: FAIL — constructor does not accept options parameter

- [ ] **Step 3: Add options parameter to AnnotationSystem constructor**

Modify constructor signature (line 84) to accept an optional config object:

```typescript
    constructor(
        scene: Scene, camera: Camera, renderer: WebGLRenderer, controls: OrbitControls,
        options?: { markerContainer?: HTMLDivElement }
    ) {
```

Modify `_createMarkerContainer()` (lines 137-144) and its call:

```typescript
    _createMarkerContainer(override?: HTMLDivElement): void {
        if (override) {
            this.markerContainer = override;
            return;
        }
        this.markerContainer = document.getElementById('annotation-markers') as HTMLDivElement | null;
        if (!this.markerContainer) {
            this.markerContainer = document.createElement('div');
            this.markerContainer.id = 'annotation-markers';
            document.body.appendChild(this.markerContainer);
        }
    }
```

Update the call in the constructor (line 131):

```typescript
        this._createMarkerContainer(options?.markerContainer);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/__tests__/detail-types.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests PASS (no callers pass the new optional parameter)

- [ ] **Step 6: Commit**

```bash
git add src/modules/annotation-system.ts src/modules/__tests__/detail-types.test.ts
git commit -m "feat(detail-model): parameterize AnnotationSystem marker container"
```

---

### Task 4: Initialize detail state in main.ts and kiosk-main.ts

**Files:**
- Modify: `src/main.ts` (state initialization)
- Modify: `src/modules/kiosk-main.ts` (state initialization)

The `AppState` now requires `detailAssetIndex` and `loadedDetailBlobs` Maps. These need to be initialized wherever `state` is created.

- [ ] **Step 1: Find state initialization in main.ts**

Search for `const state:` or `state =` in main.ts to locate the state object literal. Add the two new fields:

```typescript
    detailAssetIndex: new Map(),
    loadedDetailBlobs: new Map(),
```

- [ ] **Step 2: Add detail fields to KioskState interface and state literal in kiosk-main.ts**

**IMPORTANT:** Kiosk uses its own `KioskState` interface (line ~78 in `kiosk-main.ts`), NOT `AppState` from `types.ts`. You must modify BOTH:

1. Add to the `KioskState` interface definition (search for `interface KioskState`):
```typescript
    detailAssetIndex: Map<string, { filename: string }>;
    loadedDetailBlobs: Map<string, string>;
```

2. Add to the state object literal (search for `const state: KioskState =`):
```typescript
    detailAssetIndex: new Map(),
    loadedDetailBlobs: new Map(),
```

- [ ] **Step 3: Run build to verify no type errors**

Run: `npx vite build 2>&1 | head -20`
Expected: Build succeeds (or unrelated warnings only)

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/modules/kiosk-main.ts
git commit -m "feat(detail-model): initialize detail asset state in main.ts and kiosk-main.ts"
```

---

### Task 5: Add pause/resume to main.ts animation loop

**Files:**
- Modify: `src/main.ts:3629-3631` (animate function)

Currently `animate()` calls `requestAnimationFrame(animate)` without saving the ID. The detail viewer needs to pause/resume the parent render loop.

- [ ] **Step 1: Store the rAF ID and add pause/resume functions**

At module scope near the animation loop (around line 3624):

```typescript
let _animFrameId: number = 0;
let _renderPaused = false;
```

Modify the `animate()` function (line 3629-3630):

```typescript
function animate() {
    if (_renderPaused) return;
    _animFrameId = requestAnimationFrame(animate);
```

Add pause/resume functions after the animate function:

```typescript
function pauseRenderLoop(): void {
    _renderPaused = true;
    if (_animFrameId) {
        cancelAnimationFrame(_animFrameId);
        _animFrameId = 0;
    }
}

function resumeRenderLoop(): void {
    if (!_renderPaused) return;
    _renderPaused = false;
    animate();
}
```

- [ ] **Step 2: Run build to verify no errors**

Run: `npx vite build 2>&1 | head -20`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(detail-model): add pause/resume to main.ts animation loop"
```

---

## Chunk 2: Archive Storage

### Task 6: Add addDetailModel to archive-creator.ts

**Files:**
- Modify: `src/modules/archive-creator.ts` (add method, following addMesh pattern)

- [ ] **Step 1: Add the addDetailModel method**

Add after the existing `addMesh` method block (after the `updateMeshMetadata` method). Follow the same pattern as `addMesh` (line 1324-1340):

```typescript
    addDetailModel(blob: Blob, fileName: string, options: AddAssetOptions = {}): string {
        const index = this._countEntriesOfType('detail_');
        const entryKey = `detail_${index}`;
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const archivePath = `assets/detail_${index}.${ext}`;

        this.files.set(archivePath, { blob, originalName: fileName });

        this.manifest.data_entries[entryKey] = {
            file_name: archivePath,
            created_by: options.created_by || "vitrine3d",
            _created_by_version: options.created_by_version || "",
            _source_notes: options.source_notes || "",
            role: "detail"
        };

        return entryKey;
    }

    removeDetailModel(entryKey: string): boolean {
        const entry = this.manifest.data_entries[entryKey];
        if (!entry) return false;

        this.files.delete(entry.file_name);
        delete this.manifest.data_entries[entryKey];

        // Remove associated thumbnail if present
        const thumbPath = `images/${entryKey}_thumb.png`;
        this.files.delete(thumbPath);

        return true;
    }
```

- [ ] **Step 2: Add orphan cleanup to the export method**

In the `build()` or `createArchive()` method, before writing ZIP entries, add cleanup for orphaned detail models:

```typescript
    // Remove orphaned detail models (not referenced by any annotation)
    private _cleanOrphanedDetailModels(): void {
        const referencedKeys = new Set<string>();
        for (const anno of this.manifest.annotations) {
            if (anno.detail_asset_key) {
                referencedKeys.add(anno.detail_asset_key);
            }
        }

        const detailKeys = Object.keys(this.manifest.data_entries)
            .filter(k => k.startsWith('detail_'));

        for (const key of detailKeys) {
            if (!referencedKeys.has(key)) {
                log.info(`Removing orphaned detail model: ${key}`);
                this.removeDetailModel(key);
            }
        }
    }
```

Call `this._cleanOrphanedDetailModels()` at the start of the `createArchive()` method.

- [ ] **Step 3: Add 'detail' to SUPPORTED_FORMATS in archive-loader.ts**

In archive-loader.ts, add to the `SUPPORTED_FORMATS` object (around line 19):

```typescript
    detail: ['.glb'],
```

- [ ] **Step 4: Run build to verify**

Run: `npx vite build 2>&1 | head -20`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/modules/archive-creator.ts src/modules/archive-loader.ts
git commit -m "feat(detail-model): add addDetailModel/removeDetailModel to archive-creator"
```

---

### Task 7: Index detail assets on archive load

**Files:**
- Modify: `src/modules/archive-loader.ts` (add extractDetailAsset method)
- Modify: `src/modules/archive-pipeline.ts` (index detail entries in phase 1)

- [ ] **Step 1: Add extractDetailAsset to archive-loader.ts**

Add a convenience method that wraps the existing `extractFile()`:

```typescript
    async extractDetailAsset(key: string, manifest: any): Promise<Blob | null> {
        const entry = manifest?.data_entries?.[key];
        if (!entry || !entry.file_name) return null;

        const result = await this.extractFile(entry.file_name);
        return result ? result.blob : null;
    }
```

- [ ] **Step 2: Add detail asset indexing to archive-pipeline.ts**

In `processArchivePhase1` (or equivalent load function), after existing asset dispatch, add:

```typescript
    // Index detail model entries (lazy — not loaded yet)
    const detailIndex = new Map<string, { filename: string }>();
    if (manifest.data_entries) {
        for (const [key, entry] of Object.entries(manifest.data_entries)) {
            if (key.startsWith('detail_') && (entry as any).role === 'detail') {
                detailIndex.set(key, { filename: (entry as any).file_name });
            }
        }
    }
    deps.state.detailAssetIndex = detailIndex;
    deps.state.loadedDetailBlobs = new Map();
```

- [ ] **Step 3: Run build to verify**

Run: `npx vite build 2>&1 | head -20`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/modules/archive-loader.ts src/modules/archive-pipeline.ts
git commit -m "feat(detail-model): index detail assets on archive load (lazy, no extraction)"
```

---

## Chunk 3: Detail Viewer Core

### Task 8: Create detail-viewer.ts — renderer lifecycle

**Files:**
- Create: `src/modules/detail-viewer.ts`

This is the largest new module. Build it incrementally.

- [ ] **Step 1: Create the module with types and constructor**

```typescript
// Detail Viewer Module
// Full-screen overlay with isolated Three.js renderer for inspecting detail models

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Logger } from './utilities.js';
import { AnnotationSystem } from './annotation-system.js';
import type { Annotation, DetailViewSettings } from '@/types.js';

const log = Logger.getLogger('detail-viewer');

export interface DetailViewerDeps {
    extractDetailAsset: (key: string) => Promise<Blob | null>;
    parentRenderLoop: { pause: () => void; resume: () => void };
    theme: string | null;
    isEditor: boolean;
    imageAssets: Map<string, string>;
    onDetailAnnotationsChanged?: (key: string, annotations: Annotation[]) => void;
    storeThumbnail?: (key: string, blob: Blob) => void;
}

type EnvironmentPreset = NonNullable<DetailViewSettings['environment_preset']>;

interface LightingConfig {
    setup: (scene: THREE.Scene, intensity: number) => void;
}

const LIGHTING_PRESETS: Record<EnvironmentPreset, LightingConfig> = {
    neutral: {
        setup(scene, intensity) {
            const ambient = new THREE.AmbientLight(0xffffff, intensity * 1.0);
            const dir = new THREE.DirectionalLight(0xffffff, intensity * 0.3);
            dir.position.set(5, 10, 7);
            scene.add(ambient, dir);
        }
    },
    studio: {
        setup(scene, intensity) {
            const hemi1 = new THREE.HemisphereLight(0xffeedd, 0x445566, intensity * 0.6);
            const hemi2 = new THREE.HemisphereLight(0xddddff, 0x554433, intensity * 0.4);
            const dir = new THREE.DirectionalLight(0xffffff, intensity * 0.5);
            dir.position.set(3, 8, 5);
            scene.add(hemi1, hemi2, dir);
        }
    },
    outdoor: {
        setup(scene, intensity) {
            const sun = new THREE.DirectionalLight(0xfff4e0, intensity * 1.0);
            sun.position.set(10, 15, 8);
            const hemi = new THREE.HemisphereLight(0x87ceeb, 0x8b7355, intensity * 0.5);
            scene.add(sun, hemi);
        }
    },
    warm: {
        setup(scene, intensity) {
            const dir1 = new THREE.DirectionalLight(0xffcc88, intensity * 0.7);
            dir1.position.set(5, 8, 3);
            const dir2 = new THREE.DirectionalLight(0xffddaa, intensity * 0.5);
            dir2.position.set(-3, 6, -5);
            const ambient = new THREE.AmbientLight(0xffe8cc, intensity * 0.3);
            scene.add(dir1, dir2, ambient);
        }
    }
};

export class DetailViewer {
    private deps: DetailViewerDeps;
    private overlay: HTMLDivElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private scene: THREE.Scene | null = null;
    private camera: THREE.PerspectiveCamera | null = null;
    private controls: OrbitControls | null = null;
    private annotationSystem: AnnotationSystem | null = null;
    private animFrameId = 0;
    private isOpen = false;
    private currentAnnotation: Annotation | null = null;
    private resizeHandler: (() => void) | null = null;
    private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
    private loadedObjects: THREE.Object3D[] = [];

    constructor(deps: DetailViewerDeps) {
        this.deps = deps;
    }

    get isActive(): boolean {
        return this.isOpen;
    }

    async open(annotation: Annotation, assetBlob: Blob): Promise<void> {
        if (this.isOpen) return;
        this.currentAnnotation = annotation;
        const settings = annotation.detail_view_settings || {};

        // Pause parent render loop
        this.deps.parentRenderLoop.pause();

        // Get overlay elements
        this.overlay = document.getElementById('detail-viewer-overlay') as HTMLDivElement;
        this.canvas = document.getElementById('detail-viewer-canvas') as HTMLCanvasElement;
        if (!this.overlay || !this.canvas) {
            log.error('Detail viewer overlay DOM elements not found');
            this.deps.parentRenderLoop.resume();
            return;
        }

        // Show overlay with fade
        this.overlay.classList.remove('hidden');
        this.overlay.classList.add('detail-viewer-entering');
        requestAnimationFrame(() => {
            this.overlay?.classList.add('detail-viewer-visible');
        });

        // Set up header
        const titleEl = this.overlay.querySelector('.detail-viewer-title');
        const scaleEl = this.overlay.querySelector('.detail-viewer-scale');
        if (titleEl) titleEl.textContent = settings.description || annotation.title;
        if (scaleEl) scaleEl.textContent = settings.scale_reference || '';

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false
        });
        const bgColor = settings.background_color || '#1a1a2e';
        this.renderer.setClearColor(new THREE.Color(bgColor));
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Create scene
        this.scene = new THREE.Scene();

        // Set up lighting
        const preset = settings.environment_preset || 'neutral';
        const intensity = settings.ambient_intensity ?? 1.0;
        LIGHTING_PRESETS[preset].setup(this.scene, intensity);

        // Optional grid
        if (settings.show_grid) {
            const grid = new THREE.GridHelper(10, 20, 0x444444, 0x333333);
            this.scene.add(grid);
        }

        // Create camera
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);

        // Create controls
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = settings.damping_factor ?? 0.08;
        if (settings.min_distance !== undefined) this.controls.minDistance = settings.min_distance;
        if (settings.max_distance !== undefined) this.controls.maxDistance = settings.max_distance;
        if (settings.min_polar_angle !== undefined) this.controls.minPolarAngle = settings.min_polar_angle;
        if (settings.max_polar_angle !== undefined) this.controls.maxPolarAngle = settings.max_polar_angle;
        if (settings.enable_pan === false) this.controls.enablePan = false;
        if (settings.auto_rotate) {
            this.controls.autoRotate = true;
            this.controls.autoRotateSpeed = settings.auto_rotate_speed ?? 2;
        }

        // Resize
        this._handleResize();
        this.resizeHandler = () => this._handleResize();
        window.addEventListener('resize', this.resizeHandler);

        // Escape to close
        this.escapeHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') this.close();
        };
        window.addEventListener('keydown', this.escapeHandler);

        // Load the model
        try {
            const url = URL.createObjectURL(assetBlob);
            const loader = new GLTFLoader();
            const gltf = await new Promise<any>((resolve, reject) => {
                loader.load(url, resolve, undefined, reject);
            });

            this.scene.add(gltf.scene);
            this.loadedObjects.push(gltf.scene);
            URL.revokeObjectURL(url);

            // Fit camera to model
            this._fitCameraToModel(gltf.scene, settings);
        } catch (err) {
            log.error('Failed to load detail model:', err);
            this._showError('Failed to load detail model');
            return;
        }

        // Set up detail annotations
        if (annotation.detail_annotations && annotation.detail_annotations.length > 0) {
            const markerContainer = this.overlay.querySelector('#detail-annotation-markers') as HTMLDivElement;
            if (markerContainer) {
                this.annotationSystem = new AnnotationSystem(
                    this.scene, this.camera, this.renderer, this.controls,
                    { markerContainer }
                );
                this.annotationSystem.setAnnotations(annotation.detail_annotations);

                if (settings.annotations_visible_on_open === false) {
                    this.annotationSystem.setMarkersVisible(false);
                }
            }
        }

        // Wire back button
        const backBtn = document.getElementById('btn-detail-back');
        if (backBtn) {
            backBtn.onclick = () => this.close();
        }

        // Start render loop
        this.isOpen = true;
        this._animate();

        log.info(`Detail viewer opened for ${annotation.detail_asset_key}`);
    }

    close(): void {
        if (!this.isOpen) return;
        this.isOpen = false;

        // Save detail annotations back if changed
        if (this.annotationSystem && this.currentAnnotation && this.deps.onDetailAnnotationsChanged) {
            const key = this.currentAnnotation.detail_asset_key;
            if (key) {
                this.deps.onDetailAnnotationsChanged(key, this.annotationSystem.toJSON());
            }
        }

        // Stop render loop
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = 0;
        }

        // Dispose annotation system
        if (this.annotationSystem) {
            this.annotationSystem.dispose();
            this.annotationSystem = null;
        }

        // Dispose Three.js objects
        this.loadedObjects.forEach(obj => this._disposeObject(obj));
        this.loadedObjects = [];

        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss();
            this.renderer = null;
        }

        this.scene = null;
        this.camera = null;

        // Remove event listeners
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        if (this.escapeHandler) {
            window.removeEventListener('keydown', this.escapeHandler);
            this.escapeHandler = null;
        }

        // Hide overlay
        if (this.overlay) {
            this.overlay.classList.remove('detail-viewer-visible', 'detail-viewer-entering');
            this.overlay.classList.add('hidden');
        }

        this.overlay = null;
        this.canvas = null;
        this.currentAnnotation = null;

        // Resume parent
        this.deps.parentRenderLoop.resume();

        log.info('Detail viewer closed');
    }

    captureThumbnail(): string | null {
        if (!this.renderer) return null;
        this.renderer.render(this.scene!, this.camera!);
        return this.renderer.domElement.toDataURL('image/png');
    }

    private _animate(): void {
        if (!this.isOpen) return;
        this.animFrameId = requestAnimationFrame(() => this._animate());

        this.controls?.update();
        this.annotationSystem?.updateMarkerPositions();

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    private _handleResize(): void {
        if (!this.overlay || !this.renderer || !this.camera) return;

        const rect = this.overlay.getBoundingClientRect();
        // Account for header height
        const header = this.overlay.querySelector('.detail-viewer-header');
        const headerH = header ? header.getBoundingClientRect().height : 0;
        const w = rect.width;
        const h = rect.height - headerH;

        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    private _fitCameraToModel(object: THREE.Object3D, settings: DetailViewSettings): void {
        if (!this.camera || !this.controls) return;

        if (settings.initial_camera_position && settings.initial_camera_target) {
            const p = settings.initial_camera_position;
            const t = settings.initial_camera_target;
            this.camera.position.set(p.x, p.y, p.z);
            this.controls.target.set(t.x, t.y, t.z);
            this.controls.update();
            return;
        }

        // Auto-fit: compute bounding box, position camera to see ~80% fill
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.25;

        this.camera.position.set(
            center.x + dist * 0.5,
            center.y + dist * 0.4,
            center.z + dist * 0.7
        );
        this.controls.target.copy(center);
        this.controls.update();
    }

    private _showError(message: string): void {
        if (!this.overlay) return;
        const errorDiv = document.createElement('div');
        errorDiv.className = 'detail-viewer-error';
        errorDiv.innerHTML = `<p>${message}</p><button class="detail-error-close">Close</button>`;
        errorDiv.querySelector('.detail-error-close')?.addEventListener('click', () => errorDiv.remove());
        this.overlay.appendChild(errorDiv);
    }

    private _disposeObject(obj: THREE.Object3D): void {
        obj.traverse((child: any) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((m: THREE.Material) => {
                        this._disposeMaterial(m);
                    });
                } else {
                    this._disposeMaterial(child.material);
                }
            }
        });
    }

    private _disposeMaterial(material: any): void {
        if (material.map) material.map.dispose();
        if (material.normalMap) material.normalMap.dispose();
        if (material.roughnessMap) material.roughnessMap.dispose();
        if (material.metalnessMap) material.metalnessMap.dispose();
        if (material.aoMap) material.aoMap.dispose();
        if (material.emissiveMap) material.emissiveMap.dispose();
        material.dispose();
    }
}
```

- [ ] **Step 2: Run build to verify module compiles**

Run: `npx vite build 2>&1 | head -20`
Expected: Build succeeds (module is tree-shaken if not imported yet)

- [ ] **Step 3: Commit**

```bash
git add src/modules/detail-viewer.ts
git commit -m "feat(detail-model): create detail-viewer.ts module with renderer lifecycle"
```

---

## Chunk 4: Annotation Popup Integration

### Task 9: Add inspect button to annotation popup

**Files:**
- Modify: `src/modules/metadata-manager.ts:2693` (showAnnotationPopup)
- Modify: `src/main.ts` (local showAnnotationPopup wrapper)
- Modify: `src/modules/kiosk-main.ts` (kiosk popup rendering)

**IMPORTANT:** Per CLAUDE.md dual-copy pattern, all three popup rendering locations must be updated.

- [ ] **Step 1: Add inspect button rendering to metadata-manager.ts showAnnotationPopup**

In `showAnnotationPopup()` (after the body is set, before the function returns), add:

```typescript
    // Detail model inspect button
    const inspectContainer = popup.querySelector('.annotation-detail-inspect');
    if (inspectContainer) {
        if (annotation.detail_asset_key) {
            const label = annotation.detail_button_label || 'Inspect Detail';

            let html = '';
            if (annotation.detail_thumbnail && imageAssets) {
                const thumbUrl = imageAssets.get(annotation.detail_thumbnail);
                if (thumbUrl) {
                    html += `<img class="detail-thumbnail" src="${thumbUrl}" alt="Detail preview">`;
                }
            }
            html += `<button class="detail-inspect-btn" data-detail-key="${annotation.detail_asset_key}">${label}</button>`;
            inspectContainer.innerHTML = html;
            (inspectContainer as HTMLElement).style.display = 'block';
        } else {
            inspectContainer.innerHTML = '';
            (inspectContainer as HTMLElement).style.display = 'none';
        }
    }
```

- [ ] **Step 2: Add the inspect container to popup DOM in both HTML files**

In both `src/editor/index.html` and `src/index.html`, inside the `#annotation-info-popup` div, add after the `.annotation-info-body` div:

```html
    <div class="annotation-detail-inspect"></div>
```

- [ ] **Step 3: Verify the main.ts wrapper passes through correctly**

The main.ts wrapper at line ~595 calls `showAnnotationPopupHandler(annotation, state.imageAssets)` which delegates to the metadata-manager version. The detail thumbnail path is resolved via `imageAssets` which already maps `images/` entries to blob URLs. No change needed in main.ts wrapper — it already passes `imageAssets`.

- [ ] **Step 4: Verify kiosk-main.ts calls pass imageAssets**

In kiosk-main.ts, `showAnnotationPopup(annotation, state.imageAssets)` already passes imageAssets. No change needed — the metadata-manager function handles the inspect button rendering.

- [ ] **Step 5: Add marker badge styling for annotations with detail models**

In annotation-system.ts `_createMarker()` (line 326), add a CSS class when the annotation has a detail model:

```typescript
    if (annotation.detail_asset_key) {
        markerEl.classList.add('has-detail');
    }
```

- [ ] **Step 6: Run build to verify**

Run: `npx vite build 2>&1 | head -20`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/modules/metadata-manager.ts src/modules/annotation-system.ts src/editor/index.html src/index.html
git commit -m "feat(detail-model): add inspect button to annotation popup with marker badge"
```

---

### Task 10: Wire inspect button click to detail viewer

**Files:**
- Modify: `src/modules/event-wiring.ts` (or create detail viewer wiring in main.ts)
- Modify: `src/main.ts` (deps factory, wiring)
- Modify: `src/modules/kiosk-main.ts` (kiosk wiring, lazy import)

- [ ] **Step 1: Add detail viewer deps factory and wiring in main.ts**

Add near the other deps factory functions:

```typescript
function createDetailViewerDeps(): DetailViewerDeps {
    return {
        extractDetailAsset: async (key: string) => {
            if (!state.archiveLoader) return null;
            const entry = state.detailAssetIndex.get(key);
            if (!entry) return null;
            const result = await state.archiveLoader.extractFile(entry.filename);
            return result ? result.blob : null;
        },
        parentRenderLoop: { pause: pauseRenderLoop, resume: resumeRenderLoop },
        theme: null,
        isEditor: true,
        imageAssets: state.imageAssets,
        onDetailAnnotationsChanged: (key, annotations) => {
            // Find the parent annotation and update its detail_annotations
            const parentAnno = annotationSystem?.getAnnotations().find(a => a.detail_asset_key === key);
            if (parentAnno) {
                parentAnno.detail_annotations = annotations;
            }
        }
    };
}
```

- [ ] **Step 2: Wire click handler for inspect buttons**

Add event delegation on the popup container. In main.ts init() or in event-wiring:

```typescript
// Detail inspect button click (event delegation on popup)
const popup = document.getElementById('annotation-info-popup');
if (popup) {
    popup.addEventListener('click', async (e) => {
        const btn = (e.target as HTMLElement).closest('.detail-inspect-btn') as HTMLElement;
        if (!btn) return;
        const key = btn.dataset.detailKey;
        if (!key) return;

        // Get or extract the blob
        let blob: Blob | null = null;
        const cached = state.loadedDetailBlobs.get(key);
        if (cached) {
            blob = await fetch(cached).then(r => r.blob());
        } else {
            const entry = state.detailAssetIndex.get(key);
            if (entry && state.archiveLoader) {
                const result = await state.archiveLoader.extractFile(entry.filename);
                if (result) {
                    blob = result.blob;
                    state.loadedDetailBlobs.set(key, result.url);
                }
            }
        }

        if (!blob) {
            notify('Could not load detail model', 'error');
            return;
        }

        // Find annotation
        const anno = annotationSystem?.getAnnotations().find(a => a.detail_asset_key === key);
        if (!anno) return;

        const viewer = new DetailViewer(createDetailViewerDeps());
        await viewer.open(anno, blob);
    });
}
```

- [ ] **Step 3: Add pause/resume to kiosk-main.ts animation loop**

The kiosk `animate()` function also calls `requestAnimationFrame(animate)` without saving the ID. Apply the same fix as Task 5:

At module scope near the kiosk animation loop (search for `function animate`):

```typescript
let _kioskAnimFrameId: number = 0;
let _kioskRenderPaused = false;
```

Modify the kiosk `animate()` function:

```typescript
function animate() {
    if (_kioskRenderPaused) return;
    _kioskAnimFrameId = requestAnimationFrame(animate);
```

Add pause/resume functions:

```typescript
function pauseRender(): void {
    _kioskRenderPaused = true;
    if (_kioskAnimFrameId) {
        cancelAnimationFrame(_kioskAnimFrameId);
        _kioskAnimFrameId = 0;
    }
}

function resumeRender(): void {
    if (!_kioskRenderPaused) return;
    _kioskRenderPaused = false;
    animate();
}
```

- [ ] **Step 4: Wire kiosk-main.ts with lazy import**

In kiosk-main.ts, add similar event delegation on the annotation popup. Use dynamic import:

```typescript
popup.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('.detail-inspect-btn') as HTMLElement;
    if (!btn) return;
    const key = btn.dataset.detailKey;
    if (!key) return;

    const entry = state.detailAssetIndex.get(key);
    if (!entry || !archiveLoader) return;

    showLoading('Loading detail model…');
    const result = await archiveLoader.extractFile(entry.filename);
    hideLoading();
    if (!result) return;

    const { DetailViewer } = await import('./detail-viewer.js');
    const anno = annotationSystem?.getAnnotations().find(a => a.detail_asset_key === key);
    if (!anno) return;

    const viewer = new DetailViewer({
        extractDetailAsset: async (k) => {
            const e = state.detailAssetIndex.get(k);
            if (!e) return null;
            const r = await archiveLoader.extractFile(e.filename);
            return r ? r.blob : null;
        },
        parentRenderLoop: { pause: pauseRender, resume: resumeRender },
        theme: state.theme || null,
        isEditor: false,
        imageAssets: state.imageAssets
    });
    await viewer.open(anno, result.blob);
});
```

Note: kiosk-main.ts will need its own `pauseRender`/`resumeRender` functions, following the same pattern as main.ts (store rAF ID, guard in animate).

- [ ] **Step 5: Run build to verify**

Run: `npx vite build 2>&1 | head -20`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/modules/kiosk-main.ts
git commit -m "feat(detail-model): wire inspect button to detail viewer in editor and kiosk"
```

---

## Chunk 5: Editor UI & Detail Model Import

### Task 11: Add detail model controls to annotation panel

**Files:**
- Modify: `src/editor/index.html` (annotation panel, detail viewer overlay DOM)
- Modify: `src/modules/annotation-controller.ts` (wire import + save logic)

- [ ] **Step 1: Add DOM elements to editor/index.html**

In the `#annotation-panel` div (after the `#anno-body` textarea and before the btn-group), add:

```html
    <div class="detail-model-section">
        <label>Detail Model</label>
        <div id="detail-model-attach" class="detail-attach-area">
            <input type="file" id="detail-model-file" accept=".glb" style="display:none">
            <button type="button" id="btn-attach-detail" class="action-btn secondary">Choose Detail Model (.glb)</button>
            <span id="detail-model-filename" class="detail-filename"></span>
            <button type="button" id="btn-remove-detail" class="action-btn danger" style="display:none">Remove</button>
        </div>
        <div id="detail-model-customize" style="display:none">
            <label for="detail-button-label">Button Label</label>
            <input type="text" id="detail-button-label" placeholder="Inspect Detail">
            <button type="button" id="btn-preview-detail" class="action-btn secondary">Preview in Detail Viewer</button>
        </div>
    </div>
```

- [ ] **Step 2: Add detail viewer overlay DOM to editor/index.html**

Before the closing `</body>` tag:

```html
    <div id="detail-viewer-overlay" class="hidden">
        <div class="detail-viewer-header">
            <button id="btn-detail-back" class="detail-back-btn">&#8592; Back</button>
            <span class="detail-viewer-title"></span>
            <span class="detail-viewer-scale"></span>
        </div>
        <canvas id="detail-viewer-canvas"></canvas>
        <div id="detail-annotation-markers"></div>
        <div id="detail-annotation-popup" class="hidden">
            <div class="annotation-info-header">
                <span class="annotation-info-number"></span>
                <h4 class="annotation-info-title"></h4>
            </div>
            <div class="annotation-info-body"></div>
        </div>
        <div id="detail-view-settings-panel" class="hidden">
            <!-- Editor-only view settings controls — wired in Task 12 -->
        </div>
    </div>
```

- [ ] **Step 3: Add the same overlay DOM to src/index.html (kiosk, without editor controls)**

Before the closing `</body>` tag in `src/index.html`:

```html
    <div id="detail-viewer-overlay" class="hidden">
        <div class="detail-viewer-header">
            <button id="btn-detail-back" class="detail-back-btn">&#8592; Back</button>
            <span class="detail-viewer-title"></span>
            <span class="detail-viewer-scale"></span>
        </div>
        <canvas id="detail-viewer-canvas"></canvas>
        <div id="detail-annotation-markers"></div>
        <div id="detail-annotation-popup" class="hidden">
            <div class="annotation-info-header">
                <span class="annotation-info-number"></span>
                <h4 class="annotation-info-title"></h4>
            </div>
            <div class="annotation-info-body"></div>
        </div>
    </div>
```

- [ ] **Step 4: Wire file import in main.ts**

Add the following to `main.ts` in the `init()` function, after annotation system setup:

```typescript
// Detail model import
const detailFileInput = document.getElementById('detail-model-file') as HTMLInputElement;
const attachBtn = document.getElementById('btn-attach-detail');
const filenameSpan = document.getElementById('detail-model-filename');
const removeBtn = document.getElementById('btn-remove-detail');
const customizeDiv = document.getElementById('detail-model-customize');

if (attachBtn && detailFileInput) {
    attachBtn.addEventListener('click', () => detailFileInput.click());
    detailFileInput.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        // Store blob in archive creator
        const archiveCreator = sceneRefs.archiveCreator;
        if (archiveCreator) {
            const key = archiveCreator.addDetailModel(file, file.name);
            // Store key on the current annotation being edited
            if (annotationSystem?.selectedAnnotation) {
                annotationSystem.selectedAnnotation.detail_asset_key = key;
            }
            if (filenameSpan) filenameSpan.textContent = file.name;
            if (removeBtn) removeBtn.style.display = '';
            if (customizeDiv) customizeDiv.style.display = '';
        }
    });
}

if (removeBtn) {
    removeBtn.addEventListener('click', () => {
        const anno = annotationSystem?.selectedAnnotation;
        if (anno?.detail_asset_key) {
            sceneRefs.archiveCreator?.removeDetailModel(anno.detail_asset_key);
            anno.detail_asset_key = undefined;
            anno.detail_button_label = undefined;
            anno.detail_thumbnail = undefined;
            anno.detail_annotations = undefined;
            anno.detail_view_settings = undefined;
        }
        if (filenameSpan) filenameSpan.textContent = '';
        if (removeBtn) removeBtn.style.display = 'none';
        if (customizeDiv) customizeDiv.style.display = 'none';
    });
}
```

- [ ] **Step 5: Wire button label save**

```typescript
const labelInput = document.getElementById('detail-button-label') as HTMLInputElement;
if (labelInput) {
    labelInput.addEventListener('change', () => {
        const anno = annotationSystem?.selectedAnnotation;
        if (anno) {
            anno.detail_button_label = labelInput.value || undefined;
        }
    });
}
```

- [ ] **Step 6: Run build to verify**

Run: `npx vite build 2>&1 | head -20`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/editor/index.html src/index.html src/main.ts
git commit -m "feat(detail-model): add detail model import controls to editor annotation panel"
```

---

### Task 12: Add view settings panel to detail viewer (editor only)

**Files:**
- Modify: `src/modules/detail-viewer.ts` (add editor settings panel methods)
- Modify: `src/editor/index.html` (populate the settings panel DOM)

- [ ] **Step 1: Populate the view settings panel DOM in editor/index.html**

Replace the `#detail-view-settings-panel` placeholder:

```html
<div id="detail-view-settings-panel" class="hidden">
    <h4>View Settings</h4>
    <label for="detail-env-preset">Lighting</label>
    <select id="detail-env-preset">
        <option value="neutral">Neutral</option>
        <option value="studio">Studio</option>
        <option value="outdoor">Outdoor</option>
        <option value="warm">Warm</option>
    </select>
    <label for="detail-bg-color">Background</label>
    <input type="color" id="detail-bg-color" value="#1a1a2e">
    <label for="detail-description">Description</label>
    <input type="text" id="detail-description" placeholder="e.g. Corinthian capital, west facade">
    <label for="detail-scale-ref">Scale Reference</label>
    <input type="text" id="detail-scale-ref" placeholder="e.g. ~30cm wide">
    <div class="toggle-row">
        <label><input type="checkbox" id="detail-auto-rotate"> Auto-Rotate</label>
    </div>
    <div class="toggle-row">
        <label><input type="checkbox" id="detail-show-grid"> Show Grid</label>
    </div>
    <div class="toggle-row">
        <label><input type="checkbox" id="detail-zoom-cursor"> Zoom to Cursor</label>
    </div>
    <button type="button" id="btn-detail-set-camera" class="action-btn secondary">Set Current View as Initial</button>
    <button type="button" id="btn-detail-capture-thumb" class="action-btn secondary">Capture Thumbnail</button>
</div>
```

- [ ] **Step 2: Add setupEditorControls method to DetailViewer**

In detail-viewer.ts, add a method called after `open()` when `isEditor` is true:

```typescript
    private setupEditorControls(): void {
        const panel = document.getElementById('detail-view-settings-panel');
        if (!panel) return;
        panel.classList.remove('hidden');

        const settings = this.currentAnnotation?.detail_view_settings || {};

        // Populate current values
        (document.getElementById('detail-env-preset') as HTMLSelectElement).value = settings.environment_preset || 'neutral';
        (document.getElementById('detail-bg-color') as HTMLInputElement).value = settings.background_color || '#1a1a2e';
        (document.getElementById('detail-description') as HTMLInputElement).value = settings.description || '';
        (document.getElementById('detail-scale-ref') as HTMLInputElement).value = settings.scale_reference || '';
        (document.getElementById('detail-auto-rotate') as HTMLInputElement).checked = settings.auto_rotate || false;
        (document.getElementById('detail-show-grid') as HTMLInputElement).checked = settings.show_grid || false;
        (document.getElementById('detail-zoom-cursor') as HTMLInputElement).checked = settings.zoom_to_cursor || false;

        // Live-preview handlers
        // (Each updates the setting on the annotation and applies immediately)
        // Wire change events to update settings + re-apply...
    }
```

Call `this.setupEditorControls()` at the end of `open()` when `this.deps.isEditor` is true.

- [ ] **Step 3: Wire "Set Current View as Initial" button**

```typescript
document.getElementById('btn-detail-set-camera')?.addEventListener('click', () => {
    if (!this.camera || !this.controls || !this.currentAnnotation) return;
    const s = this.currentAnnotation.detail_view_settings ??= {};
    s.initial_camera_position = {
        x: parseFloat(this.camera.position.x.toFixed(4)),
        y: parseFloat(this.camera.position.y.toFixed(4)),
        z: parseFloat(this.camera.position.z.toFixed(4))
    };
    s.initial_camera_target = {
        x: parseFloat(this.controls.target.x.toFixed(4)),
        y: parseFloat(this.controls.target.y.toFixed(4)),
        z: parseFloat(this.controls.target.z.toFixed(4))
    };
});
```

- [ ] **Step 4: Wire thumbnail capture**

```typescript
document.getElementById('btn-detail-capture-thumb')?.addEventListener('click', () => {
    const dataUrl = this.captureThumbnail();
    if (!dataUrl || !this.currentAnnotation) return;

    // Convert data URL to blob and store in archive creator via deps callback
    fetch(dataUrl).then(r => r.blob()).then(blob => {
        const key = this.currentAnnotation!.detail_asset_key;
        if (!key) return;
        const thumbPath = `images/${key}_thumb.png`;
        this.currentAnnotation!.detail_thumbnail = thumbPath;

        // Actually store the blob so it ends up in the archive ZIP
        if (this.deps.storeThumbnail) {
            this.deps.storeThumbnail(key, blob);
        }
    });
});
```

**Note:** The `storeThumbnail` callback in the deps factory (main.ts) should call the archive creator's image storage method:

```typescript
storeThumbnail: (key, blob) => {
    const archiveCreator = sceneRefs.archiveCreator;
    if (archiveCreator) {
        archiveCreator.addImage(blob, `${key}_thumb.png`);
    }
}
```

If `addImage()` does not exist on `ArchiveCreator`, add it following the same pattern as `addThumbnail()` — search for existing image/thumbnail storage methods in `archive-creator.ts`.

- [ ] **Step 5: Run build to verify**

Run: `npx vite build 2>&1 | head -20`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/modules/detail-viewer.ts src/editor/index.html
git commit -m "feat(detail-model): add view settings panel and thumbnail capture to editor"
```

---

## Chunk 6: CSS & Theme Integration

### Task 13: Add detail viewer and inspect button styles

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add detail viewer overlay styles**

```css
/* Detail Viewer Overlay */
#detail-viewer-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 10000;
    background: #1a1a2e;
    display: flex;
    flex-direction: column;
    opacity: 0;
    transition: opacity 0.3s ease;
}
#detail-viewer-overlay.hidden { display: none !important; }
#detail-viewer-overlay.detail-viewer-visible { opacity: 1; }
#detail-viewer-overlay.detail-viewer-entering { display: flex; }

.detail-viewer-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 20px;
    background: rgba(0,0,0,0.4);
    z-index: 1;
    flex-shrink: 0;
}
.detail-back-btn {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    color: #fff;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    min-width: 44px;
    min-height: 44px;
}
.detail-back-btn:hover { background: rgba(255,255,255,0.2); }
.detail-viewer-title {
    color: #fff;
    font-size: 16px;
    flex: 1;
}
.detail-viewer-scale {
    color: rgba(255,255,255,0.6);
    font-size: 13px;
    font-style: italic;
}

#detail-viewer-canvas {
    flex: 1;
    width: 100%;
    display: block;
}

/* Detail inspect button in annotation popup */
.annotation-detail-inspect {
    display: none;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(255,255,255,0.1);
}
.detail-thumbnail {
    width: 100%;
    max-height: 120px;
    object-fit: cover;
    border-radius: 4px;
    margin-bottom: 8px;
    cursor: pointer;
}
.detail-inspect-btn {
    width: 100%;
    padding: 10px 16px;
    background: #4a90d9;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
}
.detail-inspect-btn:hover { background: #5aa0e9; }

/* Marker badge for annotations with detail models */
.annotation-marker.has-detail::after {
    content: '🔍';
    position: absolute;
    bottom: -4px;
    right: -6px;
    font-size: 10px;
    line-height: 1;
}

/* Detail viewer error display */
.detail-viewer-error {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0,0,0,0.9);
    color: #ff6b6b;
    padding: 24px 32px;
    border-radius: 8px;
    text-align: center;
}
.detail-viewer-error button {
    margin-top: 12px;
    padding: 8px 20px;
    background: rgba(255,255,255,0.1);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 4px;
    cursor: pointer;
}

/* Editor: detail model attach section */
.detail-model-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(255,255,255,0.1);
}
.detail-filename {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    margin-left: 8px;
}

/* Editor: view settings panel */
#detail-view-settings-panel {
    position: absolute;
    right: 16px;
    top: 60px;
    width: 240px;
    background: rgba(0,0,0,0.85);
    border-radius: 8px;
    padding: 16px;
    color: #fff;
    z-index: 2;
}
#detail-view-settings-panel.hidden { display: none; }
#detail-view-settings-panel h4 { margin: 0 0 12px; }
#detail-view-settings-panel label {
    display: block;
    font-size: 12px;
    margin-top: 8px;
    color: rgba(255,255,255,0.7);
}
#detail-view-settings-panel select,
#detail-view-settings-panel input[type="text"],
#detail-view-settings-panel input[type="color"] {
    width: 100%;
    margin-top: 4px;
}
.toggle-row { margin-top: 6px; }
.toggle-row label {
    display: inline;
    font-size: 13px;
    color: #fff;
}
```

- [ ] **Step 2: Check all 5 theme directories for selectors that need overrides**

Run: `grep -r "annotation-info-popup\|annotation-marker" src/themes/`

If any theme overrides annotation popup or marker styling, add corresponding detail-viewer overrides.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "feat(detail-model): add detail viewer overlay and inspect button CSS"
```

---

### Task 14: Editorial theme sidebar-aware layout

**Files:**
- Modify: `src/themes/editorial/layout.css`

- [ ] **Step 1: Add Editorial-specific detail viewer styles**

```css
/* Editorial: Detail viewer uses sidebar layout */
body.kiosk-mode[data-theme="editorial"] #detail-viewer-overlay {
    display: grid;
    grid-template-columns: 38.2% 1fr;
    grid-template-rows: auto 1fr;
}

body.kiosk-mode[data-theme="editorial"] .detail-viewer-header {
    grid-column: 1;
    grid-row: 1;
    flex-direction: column;
    align-items: flex-start;
    padding: 20px;
    background: var(--editorial-sidebar-bg, #1a1a2e);
}

body.kiosk-mode[data-theme="editorial"] #detail-viewer-canvas {
    grid-column: 2;
    grid-row: 1 / -1;
}

body.kiosk-mode[data-theme="editorial"] #detail-annotation-markers {
    /* Markers only appear over the canvas area */
}
```

- [ ] **Step 2: Check gallery, exhibit, minimal for any needed overrides**

These themes use full-screen overlay (the default) so they likely need no overrides. Verify by checking if they override `.annotation-info-popup` positioning — if so, similar overrides may be needed for the detail viewer popup.

- [ ] **Step 3: Commit**

```bash
git add src/themes/editorial/layout.css
git commit -m "feat(detail-model): add Editorial theme sidebar-aware detail viewer layout"
```

---

## Chunk 7: Final Integration & Verification

### Task 15: End-to-end build verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```
Expected: Build succeeds with zero errors

- [ ] **Step 2: Run full test suite**

```bash
npm test
```
Expected: All tests pass including new detail-types tests

- [ ] **Step 3: Run lint**

```bash
npm run lint
```
Expected: Zero errors (warnings OK)

- [ ] **Step 4: Manual smoke test in dev**

```bash
npm run dev
```

Open http://localhost:8080/editor/ and verify:
1. Create an annotation → see "Detail Model" section in panel
2. Attach a .glb file → filename appears, customize section shows
3. Click "Preview in Detail Viewer" → overlay opens with the model
4. Orbit around model, verify lighting preset
5. Press Escape or Back → overlay closes, parent scene resumes
6. Export archive → verify detail model is included in ZIP

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix(detail-model): integration fixups from smoke testing"
```

---

## File Map Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/types.ts` | Modify | `DetailViewSettings` interface, `Annotation` detail fields, `AppState` detail maps |
| `src/modules/detail-viewer.ts` | Create | Core overlay module — renderer, scene, controls, lighting, annotations |
| `src/modules/annotation-system.ts` | Modify | Parameterized container, `toJSON` preserves detail fields |
| `src/modules/archive-creator.ts` | Modify | `addDetailModel()`, `removeDetailModel()`, orphan cleanup |
| `src/modules/archive-loader.ts` | Modify | `extractDetailAsset()`, `'detail'` in SUPPORTED_FORMATS |
| `src/modules/archive-pipeline.ts` | Modify | Index detail entries on load (metadata only) |
| `src/modules/metadata-manager.ts` | Modify | Inspect button + thumbnail in popup |
| `src/main.ts` | Modify | State init, pause/resume loop, detail viewer deps, click wiring |
| `src/modules/kiosk-main.ts` | Modify | State init, pause/resume, lazy detail viewer import, click wiring |
| `src/editor/index.html` | Modify | Annotation panel detail controls, detail viewer overlay DOM |
| `src/index.html` | Modify | Detail viewer overlay DOM, inspect container in popup |
| `src/styles.css` | Modify | Overlay styles, inspect button, marker badge, settings panel |
| `src/themes/editorial/layout.css` | Modify | Sidebar-aware detail viewer layout |
| `src/modules/__tests__/detail-types.test.ts` | Create | Type compat, toJSON serialization, container param tests |

---

## Deferred to Future Iterations

These items are in the spec but intentionally excluded from v1 implementation:

- **Pre-Import convenience workflow** — sidebar section listing all detail models with dropdown attach. v1 uses inline file picker only.
- **Focus trapping** — Tab/Shift+Tab cycling within the detail overlay. v1 has Escape-to-close only.
- **OBJ support** — requires MTL/texture dependency handling. v1 is GLB-only.
- **Detail annotation images** — `asset:images/` protocol in detail annotation bodies. v1 is text-only.

---

## Note on Line Numbers

Line numbers referenced in this plan are accurate as of the initial commit. As earlier tasks modify files, line numbers in later tasks will drift. Always search by function name or pattern (e.g., `function animate`, `toJSON()`, `showAnnotationPopup`) rather than relying on exact line numbers.
