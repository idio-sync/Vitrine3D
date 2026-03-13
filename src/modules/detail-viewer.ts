// Detail Viewer Module
// Full-screen overlay with isolated Three.js renderer for inspecting detail models

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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
