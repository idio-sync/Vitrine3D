// Comparison Viewer Module
// Full-screen overlay with side-by-side, slider, and toggle modes for before/after GLB comparison

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Logger } from './logger.js';
import type { ComparisonMode, Transform } from '../types.js';
import { normalizeScale } from '../types.js';

const log = Logger.getLogger('comparison-viewer');

// ===== Public Interfaces =====

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

// ===== Class =====

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
    private modelA: THREE.Object3D | null = null;
    private modelB: THREE.Object3D | null = null;

    private mode: ComparisonMode = 'side-by-side';
    private syncCameras = true;
    private animFrameId = 0;
    private config: ComparisonConfig | null = null;
    private overlay: HTMLElement | null = null;

    private sliderPosition = 0.5;
    private activeLeader: 'A' | 'B' = 'A';
    private crossfadeValue = 0;

    private _eventsWired = false;
    private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(deps: ComparisonViewerDeps) {
        this.deps = deps;
    }

    // ===== Public Methods =====

    async open(config: ComparisonConfig, beforeBlob: Blob, afterBlob: Blob): Promise<void> {
        this.config = config;

        this.deps.parentRenderLoop.pause();

        this._showOverlay();
        this._initRenderer();
        this._initScenes();

        await this._loadModels(beforeBlob, afterBlob);

        if (config.alignment && this.modelB) {
            this._applyAlignment(config.alignment);
        }

        this._fitCameras();

        const savedMode = sessionStorage.getItem('comparison-mode') as ComparisonMode | null;
        const initialMode = savedMode || config.default_mode || 'side-by-side';
        this.setMode(initialMode);

        this._wireEvents();
        this._startAnimationLoop();

        log.info('ComparisonViewer opened, mode:', this.mode);
    }

    close(): void {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }

        this._stopAnimationLoop();
        this._disposeAll();
        this._hideOverlay();
        this._eventsWired = false;

        this.deps.parentRenderLoop.resume();
        log.info('ComparisonViewer closed');
    }

    setMode(mode: ComparisonMode): void {
        this.mode = mode;
        sessionStorage.setItem('comparison-mode', mode);
        this._updateModeUI();
        this._updateAlignmentWarning();
        log.info('Comparison mode set to:', mode);
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
        log.info('Camera sync:', this.syncCameras);
    }

    toggleInstant(): void {
        this.crossfadeValue = this.crossfadeValue >= 0.5 ? 0 : 1;
    }

    // ===== Private: Overlay =====

    private _showOverlay(): void {
        const overlay = document.getElementById('comparison-viewer-overlay');
        if (!overlay) {
            log.error('comparison-viewer-overlay element not found');
            return;
        }
        this.overlay = overlay;
        overlay.classList.remove('hidden');

        // Set title
        const titleEl = overlay.querySelector('.comparison-viewer-title');
        if (titleEl && this.config?.title) {
            titleEl.textContent = this.config.title;
        }

        // Set before label/date
        const beforeLabelEl = overlay.querySelector('.comparison-before-label');
        if (beforeLabelEl) {
            beforeLabelEl.textContent = this.config?.before?.label || 'Before';
        }
        const beforeDateEl = overlay.querySelector('.comparison-before-date');
        if (beforeDateEl) {
            beforeDateEl.textContent = this.config?.before?.date || '';
        }

        // Set after label/date
        const afterLabelEl = overlay.querySelector('.comparison-after-label');
        if (afterLabelEl) {
            afterLabelEl.textContent = this.config?.after?.label || 'After';
        }
        const afterDateEl = overlay.querySelector('.comparison-after-date');
        if (afterDateEl) {
            afterDateEl.textContent = this.config?.after?.date || '';
        }
    }

    private _hideOverlay(): void {
        if (this.overlay) {
            this.overlay.classList.add('hidden');
            this.overlay = null;
        }
    }

    // ===== Private: Renderer & Scenes =====

    private _initRenderer(): void {
        this.canvas = document.getElementById('comparison-viewer-canvas') as HTMLCanvasElement;
        if (!this.canvas) {
            log.error('comparison-viewer-canvas element not found');
            return;
        }

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.autoClear = false;

        const bgHex = this.deps.parentBackgroundColor || '#1a1a2e';
        this.renderer.setClearColor(new THREE.Color(bgHex));
    }

    private _initScenes(): void {
        const aspect = this.canvas ? this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight) : 1;

        // Scene A (before)
        this.sceneA = new THREE.Scene();
        {
            const ambient = new THREE.AmbientLight(0xffffff, 0.6);
            const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
            dir1.position.set(5, 10, 7);
            const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
            dir2.position.set(-5, 5, -5);
            this.sceneA.add(ambient, dir1, dir2);
        }

        // Scene B (after)
        this.sceneB = new THREE.Scene();
        {
            const ambient = new THREE.AmbientLight(0xffffff, 0.6);
            const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
            dir1.position.set(5, 10, 7);
            const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
            dir2.position.set(-5, 5, -5);
            this.sceneB.add(ambient, dir1, dir2);
        }

        // Cameras
        this.cameraA = new THREE.PerspectiveCamera(50, aspect, 0.01, 1000);
        this.cameraA.position.set(0, 0, 5);

        this.cameraB = new THREE.PerspectiveCamera(50, aspect, 0.01, 1000);
        this.cameraB.position.set(0, 0, 5);

        // Controls — only wire to canvas after renderer is initialized
        if (this.canvas) {
            this.controlsA = new OrbitControls(this.cameraA, this.canvas);
            this.controlsA.enableDamping = true;
            this.controlsA.dampingFactor = 0.08;

            this.controlsB = new OrbitControls(this.cameraB, this.canvas);
            this.controlsB.enableDamping = true;
            this.controlsB.dampingFactor = 0.08;
        }
    }

    // ===== Private: Model Loading =====

    private async _loadModels(beforeBlob: Blob, afterBlob: Blob): Promise<void> {
        const loader = new GLTFLoader();

        const loadGltf = (blob: Blob): Promise<THREE.Object3D | null> => {
            const url = URL.createObjectURL(blob);
            return new Promise((resolve) => {
                loader.load(
                    url,
                    (gltf) => {
                        URL.revokeObjectURL(url);
                        resolve(gltf.scene);
                    },
                    undefined,
                    (err) => {
                        URL.revokeObjectURL(url);
                        log.error('GLTF load error:', err);
                        resolve(null);
                    }
                );
            });
        };

        const [resultA, resultB] = await Promise.allSettled([
            loadGltf(beforeBlob),
            loadGltf(afterBlob)
        ]);

        if (resultA.status === 'fulfilled' && resultA.value) {
            this.modelA = resultA.value;
            this.sceneA?.add(this.modelA);
        } else {
            log.warn('Before model failed to load');
        }

        if (resultB.status === 'fulfilled' && resultB.value) {
            this.modelB = resultB.value;
            this.sceneB?.add(this.modelB);
        } else {
            log.warn('After model failed to load');
        }
    }

    // ===== Private: Alignment & Camera Fit =====

    private _applyAlignment(transform: Transform): void {
        if (!this.modelB) return;

        const [sx, sy, sz] = normalizeScale(transform.scale);
        this.modelB.position.set(transform.position.x, transform.position.y, transform.position.z);
        this.modelB.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
        this.modelB.scale.set(sx, sy, sz);
    }

    private _fitCameras(): void {
        if (!this.cameraA || !this.cameraB || !this.controlsA || !this.controlsB) return;

        const box = new THREE.Box3();
        if (this.modelA) box.expandByObject(this.modelA);
        if (this.modelB) box.expandByObject(this.modelB);

        if (box.isEmpty()) {
            log.warn('No models to fit cameras to');
            return;
        }

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.cameraA.fov * (Math.PI / 180);
        const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.5;

        const pos = new THREE.Vector3(
            center.x + dist * 0.5,
            center.y + dist * 0.4,
            center.z + dist * 0.7
        );

        this.cameraA.position.copy(pos);
        this.controlsA.target.copy(center);
        this.controlsA.update();

        this.cameraB.position.copy(pos);
        this.controlsB.target.copy(center);
        this.controlsB.update();
    }

    // ===== Private: Animation Loop =====

    private _startAnimationLoop(): void {
        const loop = () => {
            this.animFrameId = requestAnimationFrame(loop);
            this._syncCamerasIfNeeded();
            this.controlsA?.update();
            this.controlsB?.update();
            this._render();
        };
        this.animFrameId = requestAnimationFrame(loop);
    }

    private _stopAnimationLoop(): void {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = 0;
        }
    }

    // ===== Private: Rendering =====

    private _render(): void {
        if (!this.renderer || !this.canvas) return;

        // Check for canvas resize
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.renderer.setSize(w, h, false);
            const aspect = w / Math.max(1, h);
            if (this.cameraA) {
                this.cameraA.aspect = aspect;
                this.cameraA.updateProjectionMatrix();
            }
            if (this.cameraB) {
                this.cameraB.aspect = aspect;
                this.cameraB.updateProjectionMatrix();
            }
        }

        this.renderer.clear();

        switch (this.mode) {
            case 'side-by-side':
                this._renderSideBySide(w, h);
                break;
            case 'slider':
                this._renderSlider(w, h);
                break;
            case 'toggle':
                this._renderToggle(w, h);
                break;
        }
    }

    private _renderSideBySide(w: number, h: number): void {
        if (!this.renderer || !this.sceneA || !this.sceneB || !this.cameraA || !this.cameraB) return;

        const halfW = Math.floor(w / 2);

        // Update camera aspects for half-width viewports
        this.cameraA.aspect = halfW / Math.max(1, h);
        this.cameraA.updateProjectionMatrix();
        this.cameraB.aspect = (w - halfW) / Math.max(1, h);
        this.cameraB.updateProjectionMatrix();

        this.renderer.setScissorTest(true);

        // Left: scene A (before)
        this.renderer.setViewport(0, 0, halfW, h);
        this.renderer.setScissor(0, 0, halfW, h);
        this.renderer.render(this.sceneA, this.cameraA);

        this.renderer.clearDepth();

        // Right: scene B (after)
        this.renderer.setViewport(halfW, 0, w - halfW, h);
        this.renderer.setScissor(halfW, 0, w - halfW, h);
        this.renderer.render(this.sceneB, this.cameraB);

        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, w, h);

        // Restore full aspect
        this.cameraA.aspect = w / Math.max(1, h);
        this.cameraA.updateProjectionMatrix();
        this.cameraB.aspect = w / Math.max(1, h);
        this.cameraB.updateProjectionMatrix();
    }

    private _renderSlider(w: number, h: number): void {
        if (!this.renderer || !this.sceneA || !this.sceneB || !this.cameraA || !this.cameraB) return;

        // Sync cameraB to cameraA
        this.cameraB.position.copy(this.cameraA.position);
        this.cameraB.quaternion.copy(this.cameraA.quaternion);
        if (this.controlsB && this.controlsA) {
            this.controlsB.target.copy(this.controlsA.target);
        }

        const dividerX = Math.floor(w * this.sliderPosition);

        this.cameraA.aspect = w / Math.max(1, h);
        this.cameraA.updateProjectionMatrix();
        this.cameraB.aspect = w / Math.max(1, h);
        this.cameraB.updateProjectionMatrix();

        this.renderer.setScissorTest(true);

        // Left of divider: scene A
        this.renderer.setViewport(0, 0, w, h);
        this.renderer.setScissor(0, 0, dividerX, h);
        this.renderer.render(this.sceneA, this.cameraA);

        this.renderer.clearDepth();

        // Right of divider: scene B
        this.renderer.setViewport(0, 0, w, h);
        this.renderer.setScissor(dividerX, 0, w - dividerX, h);
        this.renderer.render(this.sceneB, this.cameraB);

        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, w, h);
    }

    private _renderToggle(w: number, h: number): void {
        if (!this.renderer || !this.sceneA || !this.sceneB || !this.cameraA || !this.cameraB) return;

        // Sync cameraB to cameraA
        this.cameraB.position.copy(this.cameraA.position);
        this.cameraB.quaternion.copy(this.cameraA.quaternion);
        if (this.controlsB && this.controlsA) {
            this.controlsB.target.copy(this.controlsA.target);
        }

        this.renderer.setViewport(0, 0, w, h);

        if (this.crossfadeValue <= 0) {
            this.renderer.render(this.sceneA, this.cameraA);
        } else if (this.crossfadeValue >= 1) {
            this.renderer.render(this.sceneB, this.cameraB);
        } else {
            // Render A fully, then blend B on top
            this.renderer.render(this.sceneA, this.cameraA);
            if (this.modelB) {
                this._setModelOpacity(this.modelB, this.crossfadeValue);
            }
            this.renderer.autoClear = false;
            this.renderer.clearDepth();
            this.renderer.render(this.sceneB, this.cameraB);
            this.renderer.autoClear = false;
            if (this.modelB) {
                this._setModelOpacity(this.modelB, 1);
            }
        }
    }

    private _setModelOpacity(model: THREE.Object3D, opacity: number): void {
        model.traverse((child: any) => {
            if (!child.isMesh) return;
            if (Array.isArray(child.material)) {
                child.material.forEach((mat: THREE.Material) => {
                    mat.transparent = opacity < 1;
                    (mat as any).opacity = opacity;
                });
            } else if (child.material) {
                child.material.transparent = opacity < 1;
                child.material.opacity = opacity;
            }
        });
    }

    // ===== Private: Camera Sync =====

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

    // ===== Private: Event Wiring =====

    private _wireEvents(): void {
        if (this._eventsWired) return;
        this._eventsWired = true;

        // Back button
        const backBtn = document.getElementById('btn-comparison-back');
        if (backBtn) backBtn.addEventListener('click', () => this.close());

        // Mode buttons
        const modeBtns = document.querySelectorAll('.comparison-mode-btn');
        modeBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = (btn as HTMLElement).dataset.mode as ComparisonMode;
                if (mode) this.setMode(mode);
            });
        });

        // Sync button
        const syncBtn = document.getElementById('btn-comparison-sync');
        if (syncBtn) syncBtn.addEventListener('click', () => this.toggleSync());

        // Toggle/instant button
        const toggleBtn = document.getElementById('btn-comparison-toggle');
        if (toggleBtn) toggleBtn.addEventListener('click', () => this.toggleInstant());

        // Crossfade slider
        const crossfadeInput = document.getElementById('comparison-crossfade') as HTMLInputElement | null;
        if (crossfadeInput) {
            crossfadeInput.addEventListener('input', () => {
                this.setCrossfade(parseFloat(crossfadeInput.value) / 100);
            });
        }

        // Slider drag
        this._wireSliderDrag();

        // Keydown
        this._handleKeydown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'Escape':
                    this.close();
                    break;
                case ' ':
                    e.preventDefault();
                    this.toggleInstant();
                    break;
                case 'ArrowLeft':
                    this.setSliderPosition(this.sliderPosition - 0.02);
                    break;
                case 'ArrowRight':
                    this.setSliderPosition(this.sliderPosition + 0.02);
                    break;
                case 'Home':
                    this.setSliderPosition(0);
                    break;
                case 'End':
                    this.setSliderPosition(1);
                    break;
            }
        };
        document.addEventListener('keydown', this._handleKeydown);
        this._keydownHandler = this._handleKeydown;

        // Canvas pointer — detect left/right half for activeLeader
        if (this.canvas) {
            this.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
                if (this.mode !== 'side-by-side') return;
                const rect = this.canvas!.getBoundingClientRect();
                const x = e.clientX - rect.left;
                this.activeLeader = x < rect.width / 2 ? 'A' : 'B';
            });
        }
    }

    private _handleKeydown: (e: KeyboardEvent) => void = () => {};

    private _wireSliderDrag(): void {
        const divider = document.getElementById('comparison-slider-divider');
        if (!divider || !this.canvas) return;

        let dragging = false;

        divider.addEventListener('pointerdown', (e: PointerEvent) => {
            dragging = true;
            divider.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        divider.addEventListener('pointermove', (e: PointerEvent) => {
            if (!dragging || !this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this.setSliderPosition(x / rect.width);
        });

        divider.addEventListener('pointerup', () => {
            dragging = false;
        });

        divider.addEventListener('pointercancel', () => {
            dragging = false;
        });
    }

    // ===== Private: UI Updates =====

    private _updateModeUI(): void {
        // Toggle active class on mode buttons
        const modeBtns = document.querySelectorAll('.comparison-mode-btn');
        modeBtns.forEach((btn) => {
            const btnMode = (btn as HTMLElement).dataset.mode;
            btn.classList.toggle('active', btnMode === this.mode);
        });

        // Show/hide slider divider
        const divider = document.getElementById('comparison-slider-divider');
        if (divider) {
            divider.style.display = this.mode === 'slider' ? '' : 'none';
        }

        // Show/hide crossfade container
        const crossfadeContainer = document.getElementById('comparison-crossfade-container');
        if (crossfadeContainer) {
            crossfadeContainer.style.display = this.mode === 'toggle' ? '' : 'none';
        }

        this._updateSliderUI();
    }

    private _updateAlignmentWarning(): void {
        const warning = document.getElementById('comparison-alignment-warning');
        if (!warning) return;
        const showWarning = this.mode !== 'side-by-side' && !this.config?.alignment;
        warning.style.display = showWarning ? '' : 'none';
    }

    private _updateSliderUI(): void {
        const divider = document.getElementById('comparison-slider-divider');
        if (divider) {
            divider.style.left = `${this.sliderPosition * 100}%`;
        }
    }

    // ===== Private: Disposal =====

    private _disposeAll(): void {
        const disposeObject = (obj: THREE.Object3D | null) => {
            if (!obj) return;
            obj.traverse((child: any) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach((mat: any) => {
                            this._disposeMaterial(mat);
                        });
                    } else {
                        this._disposeMaterial(child.material);
                    }
                }
            });
        };

        disposeObject(this.modelA);
        disposeObject(this.modelB);
        this.modelA = null;
        this.modelB = null;

        this.controlsA?.dispose();
        this.controlsB?.dispose();
        this.controlsA = null;
        this.controlsB = null;

        this.sceneA = null;
        this.sceneB = null;
        this.cameraA = null;
        this.cameraB = null;

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        this.canvas = null;
        this.config = null;
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
