// Detail Viewer Module
// Full-screen overlay with isolated Three.js renderer for inspecting detail models

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Logger } from './utilities.js';
import { AnnotationSystem } from './annotation-system.js';
import type { Annotation, DetailViewSettings } from '../types.js';

const log = Logger.getLogger('detail-viewer');

export interface DetailViewerDeps {
    extractDetailAsset: (key: string) => Promise<Blob | null>;
    parentRenderLoop: { pause: () => void; resume: () => void };
    theme: string | null;
    isEditor: boolean;
    imageAssets: Map<string, string>;
    /** Parent scene background color as hex string (e.g. '#1a1a2e') */
    parentBackgroundColor?: string;
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
    private heightClampCleanup: (() => void) | null = null;

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
        const bgColor = settings.background_color || this.deps.parentBackgroundColor || '#1a1a2e';
        this.renderer.setClearColor(new THREE.Color(bgColor));
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Create scene
        this.scene = new THREE.Scene();

        // Set up lighting
        const preset = settings.environment_preset || 'neutral';
        const intensity = settings.ambient_intensity ?? 1.0;
        LIGHTING_PRESETS[preset].setup(this.scene, intensity);

        // Create camera
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);

        // Create controls
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = settings.damping_factor ?? 0.08;
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
            const dracoLoader = new DRACOLoader();
            dracoLoader.setDecoderPath('/draco/');
            dracoLoader.setDecoderConfig({ type: 'js' });
            loader.setDRACOLoader(dracoLoader);
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
        // In editor mode, always create the AnnotationSystem so placement works even with no existing annotations
        const shouldCreateAnnotationSystem =
            this.deps.isEditor ||
            (annotation.detail_annotations && annotation.detail_annotations.length > 0);

        if (shouldCreateAnnotationSystem) {
            const markerContainer = this.overlay.querySelector('#detail-annotation-markers') as HTMLDivElement;
            if (markerContainer) {
                this.annotationSystem = new AnnotationSystem(
                    this.scene, this.camera, this.renderer, this.controls,
                    { markerContainer }
                );
                if (annotation.detail_annotations && annotation.detail_annotations.length > 0) {
                    this.annotationSystem.setAnnotations(annotation.detail_annotations);
                }

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

        // Apply saved camera constraints (after camera is positioned)
        this._applyCameraConstraints(settings);

        // Start render loop
        this.isOpen = true;
        this._animate();

        log.info(`Detail viewer opened for ${annotation.detail_asset_key}`);

        // Set up editor controls if in editor mode
        if (this.deps.isEditor) {
            this._setupEditorControls();
        }
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
            if (this.heightClampCleanup) {
                this.controls.removeEventListener('change', this.heightClampCleanup);
                this.heightClampCleanup = null;
            }
            this.controls.dispose();
            this.controls = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
            // Do NOT call forceContextLoss — the canvas is reused on next open()
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

        // Hide settings panel
        const settingsPanel = document.getElementById('detail-view-settings-panel');
        if (settingsPanel) settingsPanel.classList.add('hidden');

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

    private _setupEditorControls(): void {
        const panel = document.getElementById('detail-view-settings-panel');
        if (!panel) return;
        panel.classList.remove('hidden');

        const settings = this.currentAnnotation?.detail_view_settings || {};

        // Populate current values
        const envSelect = document.getElementById('detail-env-preset') as HTMLSelectElement;
        const bgInput = document.getElementById('detail-bg-color') as HTMLInputElement;
        const descInput = document.getElementById('detail-description') as HTMLInputElement;
        const scaleInput = document.getElementById('detail-scale-ref') as HTMLInputElement;
        const autoRotateCheck = document.getElementById('detail-auto-rotate') as HTMLInputElement;
        const gridCheck = document.getElementById('detail-show-grid') as HTMLInputElement;
        const zoomCursorCheck = document.getElementById('detail-zoom-cursor') as HTMLInputElement;

        if (envSelect) envSelect.value = settings.environment_preset || 'neutral';
        if (bgInput) bgInput.value = settings.background_color || this.deps.parentBackgroundColor || '#1a1a2e';
        if (descInput) descInput.value = settings.description || '';
        if (scaleInput) scaleInput.value = settings.scale_reference || '';
        if (autoRotateCheck) autoRotateCheck.checked = settings.auto_rotate || false;
        if (gridCheck) gridCheck.checked = false;
        if (zoomCursorCheck) zoomCursorCheck.checked = settings.zoom_to_cursor || false;

        // Live-preview handlers
        envSelect?.addEventListener('change', () => {
            const s = this._ensureSettings();
            s.environment_preset = envSelect.value as EnvironmentPreset;
            this._rebuildLighting(s);
        });

        bgInput?.addEventListener('input', () => {
            const s = this._ensureSettings();
            s.background_color = bgInput.value;
            this.renderer?.setClearColor(new THREE.Color(bgInput.value));
        });

        descInput?.addEventListener('change', () => {
            const s = this._ensureSettings();
            s.description = descInput.value || undefined;
            const titleEl = this.overlay?.querySelector('.detail-viewer-title');
            if (titleEl) titleEl.textContent = descInput.value || this.currentAnnotation?.title || '';
        });

        scaleInput?.addEventListener('change', () => {
            const s = this._ensureSettings();
            s.scale_reference = scaleInput.value || undefined;
            const scaleEl = this.overlay?.querySelector('.detail-viewer-scale');
            if (scaleEl) scaleEl.textContent = scaleInput.value;
        });

        autoRotateCheck?.addEventListener('change', () => {
            const s = this._ensureSettings();
            s.auto_rotate = autoRotateCheck.checked;
            if (this.controls) this.controls.autoRotate = autoRotateCheck.checked;
        });

        gridCheck?.addEventListener('change', () => {
            // Grid is a local-only editor aid — not saved to archive
            if (this.scene) {
                const existing = this.scene.getObjectByName('detail-grid');
                if (gridCheck.checked && !existing) {
                    const grid = new THREE.GridHelper(10, 20, 0x444444, 0x333333);
                    grid.name = 'detail-grid';
                    this.scene.add(grid);
                } else if (!gridCheck.checked && existing) {
                    this.scene.remove(existing);
                }
            }
        });

        zoomCursorCheck?.addEventListener('change', () => {
            const s = this._ensureSettings();
            s.zoom_to_cursor = zoomCursorCheck.checked;
        });

        const annotationsVisibleCheck = document.getElementById('detail-annotations-visible') as HTMLInputElement;
        if (annotationsVisibleCheck) annotationsVisibleCheck.checked = settings.annotations_visible_on_open !== false;
        annotationsVisibleCheck?.addEventListener('change', () => {
            const s = this._ensureSettings();
            s.annotations_visible_on_open = annotationsVisibleCheck.checked;
        });

        // Set current view as initial camera position
        document.getElementById('btn-detail-set-camera')?.addEventListener('click', () => {
            if (!this.camera || !this.controls || !this.currentAnnotation) return;
            const s = this._ensureSettings();
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
            log.info('Saved initial camera position');
        });

        // Capture thumbnail
        document.getElementById('btn-detail-capture-thumb')?.addEventListener('click', () => {
            const dataUrl = this.captureThumbnail();
            if (!dataUrl || !this.currentAnnotation) return;

            fetch(dataUrl).then(r => r.blob()).then(blob => {
                const key = this.currentAnnotation!.detail_asset_key;
                if (!key) return;
                const thumbPath = `images/${key}_thumb.png`;
                this.currentAnnotation!.detail_thumbnail = thumbPath;

                if (this.deps.storeThumbnail) {
                    this.deps.storeThumbnail(key, blob);
                }
                log.info('Captured detail thumbnail');
            });
        });

        // Camera constraint checkboxes (matches main editor pattern)
        const lockOrbitCheck = document.getElementById('detail-lock-orbit') as HTMLInputElement;
        const lockDistCheck = document.getElementById('detail-lock-distance') as HTMLInputElement;
        const lockDistValue = document.getElementById('detail-lock-distance-value') as HTMLInputElement;
        const lockAboveCheck = document.getElementById('detail-lock-above-ground') as HTMLInputElement;
        const lockMaxHeightCheck = document.getElementById('detail-lock-max-height') as HTMLInputElement;
        const maxHeightControls = document.getElementById('detail-max-height-controls');
        const maxHeightInput = document.getElementById('detail-max-height-value') as HTMLInputElement;
        const setMaxHeightBtn = document.getElementById('btn-detail-set-max-height-current');

        // Populate from saved settings
        if (lockOrbitCheck) lockOrbitCheck.checked = settings.lock_orbit || false;
        if (lockDistCheck) lockDistCheck.checked = settings.lock_distance !== undefined && settings.lock_distance !== null;
        if (lockDistValue && settings.lock_distance != null) lockDistValue.value = String(settings.lock_distance);
        if (lockAboveCheck) lockAboveCheck.checked = settings.lock_above_ground || false;
        if (lockMaxHeightCheck) {
            const hasMaxHeight = settings.max_camera_height !== undefined && settings.max_camera_height !== null;
            lockMaxHeightCheck.checked = hasMaxHeight;
            if (maxHeightControls) maxHeightControls.style.display = hasMaxHeight ? '' : 'none';
            if (maxHeightInput && hasMaxHeight) maxHeightInput.value = String(settings.max_camera_height);
        }

        const applyConstraints = () => {
            const s = this._ensureSettings();

            s.lock_orbit = lockOrbitCheck?.checked || false;

            if (lockDistCheck?.checked) {
                let dist = lockDistValue?.value ? parseFloat(lockDistValue.value) : null;
                if (dist === null || isNaN(dist)) {
                    // Capture current distance
                    dist = this.camera!.position.distanceTo(this.controls!.target);
                    dist = parseFloat(dist.toFixed(4));
                    if (lockDistValue) lockDistValue.value = String(dist);
                }
                s.lock_distance = dist;
            } else {
                s.lock_distance = null;
            }

            s.lock_above_ground = lockAboveCheck?.checked || false;

            if (lockMaxHeightCheck?.checked) {
                const val = maxHeightInput?.value ? parseFloat(maxHeightInput.value) : null;
                s.max_camera_height = (val !== null && !isNaN(val)) ? val : null;
            } else {
                s.max_camera_height = null;
            }

            this._applyCameraConstraints(s);
        };

        lockOrbitCheck?.addEventListener('change', applyConstraints);

        lockDistCheck?.addEventListener('change', () => {
            if (lockDistCheck.checked && this.camera && this.controls) {
                // Capture current distance when checking the box
                const dist = parseFloat(this.camera.position.distanceTo(this.controls.target).toFixed(4));
                if (lockDistValue) lockDistValue.value = String(dist);
            }
            applyConstraints();
        });

        lockAboveCheck?.addEventListener('change', applyConstraints);

        lockMaxHeightCheck?.addEventListener('change', () => {
            if (maxHeightControls) maxHeightControls.style.display = lockMaxHeightCheck.checked ? '' : 'none';
            if (lockMaxHeightCheck.checked && !maxHeightInput?.value && this.camera) {
                // Default to current camera Y
                if (maxHeightInput) maxHeightInput.value = this.camera.position.y.toFixed(1);
            }
            applyConstraints();
        });

        maxHeightInput?.addEventListener('change', applyConstraints);

        setMaxHeightBtn?.addEventListener('click', () => {
            if (this.camera && maxHeightInput) {
                maxHeightInput.value = this.camera.position.y.toFixed(1);
                applyConstraints();
            }
        });

        // Annotation placement UI
        this._setupAnnotationPlacement();
    }

    private _setupAnnotationPlacement(): void {
        const placeBtn = document.getElementById('btn-detail-place-annotation');
        const createPanel = document.getElementById('detail-annotation-create-panel');
        const annoFields = document.getElementById('detail-anno-fields');
        const titleInput = document.getElementById('detail-anno-title') as HTMLInputElement;
        const bodyInput = document.getElementById('detail-anno-body') as HTMLTextAreaElement;
        const saveBtn = document.getElementById('btn-detail-anno-save');
        const cancelBtn = document.getElementById('btn-detail-anno-cancel');
        const instruction = createPanel?.querySelector('.detail-anno-instruction');

        if (!placeBtn || !createPanel || !this.annotationSystem) return;

        // Show the placement button now that we know annotation system exists
        placeBtn.classList.remove('hidden');

        const exitPlacement = () => {
            this.annotationSystem?.disablePlacementMode();
            placeBtn.classList.remove('active');
            createPanel.classList.add('hidden');
            if (annoFields) annoFields.classList.add('hidden');
            if (instruction) (instruction as HTMLElement).style.display = '';
            if (titleInput) titleInput.value = '';
            if (bodyInput) bodyInput.value = '';
        };

        // When a position is picked (pendingPosition set), show the fields
        this.annotationSystem.onAnnotationCreated = (_position, _cameraState) => {
            if (instruction) (instruction as HTMLElement).style.display = 'none';
            if (annoFields) annoFields.classList.remove('hidden');
            if (titleInput) titleInput.focus();
        };

        placeBtn.addEventListener('click', () => {
            if (!this.annotationSystem) return;
            if (this.annotationSystem.placementMode) {
                exitPlacement();
            } else {
                this.annotationSystem.enablePlacementMode();
                placeBtn.classList.add('active');
                createPanel.classList.remove('hidden');
                if (annoFields) annoFields.classList.add('hidden');
                if (instruction) (instruction as HTMLElement).style.display = '';
            }
        });

        saveBtn?.addEventListener('click', () => {
            if (!this.annotationSystem) return;
            const id = `detail_anno_${Date.now()}`;
            const title = titleInput?.value.trim() || 'Untitled';
            const body = bodyInput?.value.trim() || '';
            this.annotationSystem.confirmAnnotation(id, title, body);
            exitPlacement();
            log.info('Detail annotation saved:', title);
        });

        cancelBtn?.addEventListener('click', () => {
            this.annotationSystem?.cancelAnnotation();
            exitPlacement();
        });
    }

    private _applyCameraConstraints(settings: DetailViewSettings): void {
        if (!this.controls || !this.camera) return;

        // Clean up previous height clamp listener
        if (this.heightClampCleanup) {
            this.controls.removeEventListener('change', this.heightClampCleanup);
            this.heightClampCleanup = null;
        }

        // Lock orbit point (disable panning)
        this.controls.enablePan = !settings.lock_orbit;

        // Lock camera distance
        if (settings.lock_distance !== undefined && settings.lock_distance !== null) {
            this.controls.minDistance = settings.lock_distance;
            this.controls.maxDistance = settings.lock_distance;
        } else {
            this.controls.minDistance = 0.01;
            this.controls.maxDistance = settings.max_camera_distance ?? 1000;
        }

        // Keep camera above ground
        this.controls.maxPolarAngle = settings.lock_above_ground ? Math.PI / 2 : Math.PI;

        // Max camera height — dynamically constrain minPolarAngle
        if (settings.max_camera_height !== undefined && settings.max_camera_height !== null) {
            const maxY = settings.max_camera_height;
            const camera = this.camera;
            const controls = this.controls;
            const updateHeightConstraint = () => {
                const distance = camera.position.distanceTo(controls.target);
                const targetY = controls.target.y;
                if (distance === 0 || maxY >= targetY + distance) {
                    controls.minPolarAngle = 0;
                } else {
                    const ratio = Math.min(1, Math.max(-1, (maxY - targetY) / distance));
                    controls.minPolarAngle = Math.acos(ratio);
                }
            };
            this.controls.addEventListener('change', updateHeightConstraint);
            updateHeightConstraint();
            this.heightClampCleanup = updateHeightConstraint;
        } else {
            this.controls.minPolarAngle = 0;
        }

        // Legacy backward compat: if new fields aren't set but old ones are, apply them
        if (settings.lock_orbit === undefined && settings.enable_pan === false) {
            this.controls.enablePan = false;
        }
        if (settings.lock_distance === undefined && settings.min_distance !== undefined) {
            this.controls.minDistance = settings.min_distance;
        }
        if (settings.lock_distance === undefined && settings.max_distance !== undefined) {
            this.controls.maxDistance = settings.max_distance;
        }
        if (settings.max_camera_height === undefined && settings.min_polar_angle !== undefined) {
            this.controls.minPolarAngle = settings.min_polar_angle;
        }
        if (!settings.lock_above_ground && settings.max_polar_angle !== undefined) {
            this.controls.maxPolarAngle = settings.max_polar_angle;
        }
    }

    private _ensureSettings(): DetailViewSettings {
        if (!this.currentAnnotation) throw new Error('No current annotation');
        if (!this.currentAnnotation.detail_view_settings) {
            this.currentAnnotation.detail_view_settings = {};
        }
        return this.currentAnnotation.detail_view_settings;
    }

    private _rebuildLighting(settings: DetailViewSettings): void {
        if (!this.scene) return;
        // Remove existing lights
        const lights = this.scene.children.filter(c =>
            c instanceof THREE.Light ||
            c instanceof THREE.AmbientLight ||
            c instanceof THREE.DirectionalLight ||
            c instanceof THREE.HemisphereLight
        );
        lights.forEach(l => this.scene!.remove(l));

        const preset = settings.environment_preset || 'neutral';
        const intensity = settings.ambient_intensity ?? 1.0;
        LIGHTING_PRESETS[preset].setup(this.scene, intensity);
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
