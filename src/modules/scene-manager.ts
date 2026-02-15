/**
 * Scene Manager Module
 *
 * Handles Three.js scene setup and rendering:
 * - Scene, camera, renderer initialization
 * - Lighting setup
 * - Grid helper
 * - Split view rendering
 * - Animation loop
 * - FPS counter
 * - Window resize handling
 */

import * as THREE from 'three';
import {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    AmbientLight,
    HemisphereLight,
    DirectionalLight,
    GridHelper,
    Group,
    Color,
    Texture,
    PMREMGenerator,
    Mesh,
    ShadowMaterial,
    Object3D,
    PlaneGeometry,
    ToneMapping,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { CAMERA, ORBIT_CONTROLS, RENDERER, LIGHTING, GRID, COLORS, SHADOWS } from './constants.js';
import { Logger } from './utilities.js';

const log = Logger.getLogger('scene-manager');

// =============================================================================
// CALLBACK TYPES
// =============================================================================

type TransformChangeCallback = () => void;
type DraggingChangedCallback = (isDragging: boolean) => void;

// =============================================================================
// SCENE MANAGER CLASS
// =============================================================================

/**
 * Manages the Three.js scene, camera, renderers, and animation loop.
 */
export class SceneManager {
    // Three.js core objects
    scene: Scene | null;
    camera: PerspectiveCamera | null;
    renderer: WebGLRenderer | null;
    rendererRight: WebGLRenderer | null;
    controls: OrbitControls | null;
    controlsRight: OrbitControls | null;
    transformControls: TransformControls | null;

    // Lighting
    ambientLight: AmbientLight | null;
    hemisphereLight: HemisphereLight | null;
    directionalLight1: DirectionalLight | null;
    directionalLight2: DirectionalLight | null;

    // Grid
    gridHelper: GridHelper | null;

    // Environment
    pmremGenerator: PMREMGenerator | null;
    currentEnvTexture: Texture | null;
    currentEnvMap: Texture | null;
    envAsBackground: boolean;
    savedBackgroundColor: Color | null;

    // Shadow catcher
    shadowCatcherPlane: Mesh<PlaneGeometry, ShadowMaterial> | null;

    // Background image
    backgroundImageTexture: Texture | null;

    // Model group
    modelGroup: Group | null;

    // Point cloud group
    pointcloudGroup: Group | null;

    // STL group
    stlGroup: Group | null;

    // FPS tracking
    frameCount: number;
    lastFpsTime: number;

    // Callbacks
    onTransformChange: TransformChangeCallback | null;
    onDraggingChanged: DraggingChangedCallback | null;

    constructor() {
        // Three.js core objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.rendererRight = null;
        this.controls = null;
        this.controlsRight = null;
        this.transformControls = null;

        // Lighting
        this.ambientLight = null;
        this.hemisphereLight = null;
        this.directionalLight1 = null;
        this.directionalLight2 = null;

        // Grid
        this.gridHelper = null;

        // Environment
        this.pmremGenerator = null;
        this.currentEnvTexture = null;
        this.currentEnvMap = null;
        this.envAsBackground = false;
        this.savedBackgroundColor = null;

        // Shadow catcher
        this.shadowCatcherPlane = null;

        // Background image
        this.backgroundImageTexture = null;

        // Model group
        this.modelGroup = null;

        // Point cloud group
        this.pointcloudGroup = null;

        // STL group
        this.stlGroup = null;

        // FPS tracking
        this.frameCount = 0;
        this.lastFpsTime = performance.now();

        // Callbacks
        this.onTransformChange = null;
        this.onDraggingChanged = null;
    }

    /**
     * Initialize the scene with all components
     */
    init(canvas: HTMLCanvasElement, canvasRight: HTMLCanvasElement): boolean {
        if (!canvas) {
            log.error('FATAL: Main canvas not found!');
            return false;
        }
        if (!canvasRight) {
            log.error('FATAL: Right canvas not found!');
            return false;
        }

        log.info('Initializing scene...');

        // Scene
        this.scene = new Scene();
        this.scene.background = new Color(COLORS.SCENE_BACKGROUND);

        // Camera
        this.camera = new PerspectiveCamera(
            CAMERA.FOV,
            canvas.clientWidth / canvas.clientHeight,
            CAMERA.NEAR,
            CAMERA.FAR
        );
        this.camera.position.set(
            CAMERA.INITIAL_POSITION.x,
            CAMERA.INITIAL_POSITION.y,
            CAMERA.INITIAL_POSITION.z
        );

        // Main Renderer
        this.renderer = new WebGLRenderer({
            canvas: canvas,
            antialias: true
        });
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.MAX_PIXEL_RATIO));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.shadowMap.enabled = false;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Right Renderer (for split view)
        this.rendererRight = new WebGLRenderer({
            canvas: canvasRight,
            antialias: true
        });
        this.rendererRight.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.MAX_PIXEL_RATIO));
        this.rendererRight.outputColorSpace = THREE.SRGBColorSpace;
        this.rendererRight.toneMapping = THREE.NoToneMapping;
        this.rendererRight.toneMappingExposure = 1.0;
        this.rendererRight.shadowMap.enabled = false;
        this.rendererRight.shadowMap.type = THREE.PCFSoftShadowMap;

        // Orbit Controls - Main
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = ORBIT_CONTROLS.DAMPING_FACTOR;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance = ORBIT_CONTROLS.MIN_DISTANCE;
        this.controls.maxDistance = ORBIT_CONTROLS.MAX_DISTANCE;
        // Explicit mouse mapping: left=orbit, middle=zoom, right=pan
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };
        // Touch: one finger orbits, two fingers pinch-zoom + pan
        this.controls.touches = {
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN
        };
        this.controls.rotateSpeed = 1.0;
        this.controls.autoRotate = false;
        this.controls.autoRotateSpeed = ORBIT_CONTROLS.AUTO_ROTATE_SPEED;

        // Orbit Controls - Right
        this.controlsRight = new OrbitControls(this.camera, this.rendererRight.domElement);
        this.controlsRight.enableDamping = true;
        this.controlsRight.dampingFactor = ORBIT_CONTROLS.DAMPING_FACTOR;
        this.controlsRight.screenSpacePanning = true;
        this.controlsRight.minDistance = ORBIT_CONTROLS.MIN_DISTANCE;
        this.controlsRight.maxDistance = ORBIT_CONTROLS.MAX_DISTANCE;
        this.controlsRight.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };
        this.controlsRight.rotateSpeed = 1.0;

        // Transform Controls
        this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControls.addEventListener('dragging-changed', (event: any) => {
            this.controls!.enabled = !event.value;
            this.controlsRight!.enabled = !event.value;
            if (this.onDraggingChanged) {
                this.onDraggingChanged(event.value);
            }
        });
        this.transformControls.addEventListener('objectChange', () => {
            if (this.onTransformChange) {
                this.onTransformChange();
            }
        });

        // Add TransformControls to scene
        log.info('TransformControls instanceof THREE.Object3D:', this.transformControls instanceof THREE.Object3D);
        if (!(this.transformControls instanceof THREE.Object3D)) {
            log.error('WARNING: TransformControls is NOT an instance of THREE.Object3D!');
            log.error('This indicates THREE.js is loaded multiple times (import map issue).');
        }
        try {
            this.scene.add(this.transformControls as unknown as Object3D);
            log.info('TransformControls added to scene successfully');
        } catch (tcError) {
            log.error('Failed to add TransformControls to scene:', tcError);
            log.error('Transform gizmos will not be visible, but app should still work');
        }

        // Setup lighting
        this.setupLighting();

        // Model group
        this.modelGroup = new Group();
        this.modelGroup.name = 'modelGroup';
        this.scene.add(this.modelGroup);

        this.pointcloudGroup = new Group();
        this.pointcloudGroup.name = 'pointcloudGroup';
        this.scene.add(this.pointcloudGroup);

        this.stlGroup = new Group();
        this.stlGroup.name = 'stlGroup';
        this.scene.add(this.stlGroup);

        log.info('Scene initialization complete');
        return true;
    }

    /**
     * Setup scene lighting
     */
    setupLighting(): void {
        // Ambient light
        this.ambientLight = new AmbientLight(
            LIGHTING.AMBIENT.COLOR,
            LIGHTING.AMBIENT.INTENSITY
        );
        this.scene!.add(this.ambientLight);

        // Hemisphere light
        this.hemisphereLight = new HemisphereLight(
            LIGHTING.HEMISPHERE.SKY_COLOR,
            LIGHTING.HEMISPHERE.GROUND_COLOR,
            LIGHTING.HEMISPHERE.INTENSITY
        );
        this.scene!.add(this.hemisphereLight);

        // Directional light 1
        this.directionalLight1 = new DirectionalLight(
            LIGHTING.DIRECTIONAL_1.COLOR,
            LIGHTING.DIRECTIONAL_1.INTENSITY
        );
        this.directionalLight1.position.set(
            LIGHTING.DIRECTIONAL_1.POSITION.x,
            LIGHTING.DIRECTIONAL_1.POSITION.y,
            LIGHTING.DIRECTIONAL_1.POSITION.z
        );
        this.directionalLight1.castShadow = false;
        this.directionalLight1.shadow.mapSize.width = SHADOWS.MAP_SIZE;
        this.directionalLight1.shadow.mapSize.height = SHADOWS.MAP_SIZE;
        this.directionalLight1.shadow.camera.near = SHADOWS.CAMERA_NEAR;
        this.directionalLight1.shadow.camera.far = SHADOWS.CAMERA_FAR;
        this.directionalLight1.shadow.camera.left = -SHADOWS.CAMERA_SIZE;
        this.directionalLight1.shadow.camera.right = SHADOWS.CAMERA_SIZE;
        this.directionalLight1.shadow.camera.top = SHADOWS.CAMERA_SIZE;
        this.directionalLight1.shadow.camera.bottom = -SHADOWS.CAMERA_SIZE;
        this.directionalLight1.shadow.bias = SHADOWS.BIAS;
        this.directionalLight1.shadow.normalBias = SHADOWS.NORMAL_BIAS;
        this.scene!.add(this.directionalLight1);

        // Directional light 2
        this.directionalLight2 = new DirectionalLight(
            LIGHTING.DIRECTIONAL_2.COLOR,
            LIGHTING.DIRECTIONAL_2.INTENSITY
        );
        this.directionalLight2.position.set(
            LIGHTING.DIRECTIONAL_2.POSITION.x,
            LIGHTING.DIRECTIONAL_2.POSITION.y,
            LIGHTING.DIRECTIONAL_2.POSITION.z
        );
        this.scene!.add(this.directionalLight2);

        log.info('Lighting setup complete');
    }

    /**
     * Toggle grid visibility
     */
    toggleGrid(show: boolean): void {
        if (show && !this.gridHelper) {
            this.gridHelper = new GridHelper(
                GRID.SIZE,
                GRID.DIVISIONS,
                GRID.COLOR_PRIMARY,
                GRID.COLOR_SECONDARY
            );
            this.gridHelper.position.y = GRID.Y_OFFSET;
            this.scene!.add(this.gridHelper);
        } else if (!show && this.gridHelper) {
            this.scene!.remove(this.gridHelper);
            this.gridHelper.dispose();
            this.gridHelper = null;
        }
    }

    /**
     * Set scene background color
     */
    setBackgroundColor(hexColor: string): void {
        const color = new Color(hexColor);
        this.scene!.background = color;
        this.savedBackgroundColor = color.clone();
        this.envAsBackground = false;
        this.clearBackgroundImage();
        document.documentElement.style.setProperty('--scene-bg-color', hexColor);
    }

    // =========================================================================
    // TONE MAPPING
    // =========================================================================

    /**
     * Set tone mapping algorithm
     */
    setToneMapping(type: string): void {
        const mappings: Record<string, ToneMapping> = {
            'None': THREE.NoToneMapping,
            'Linear': THREE.LinearToneMapping,
            'Reinhard': THREE.ReinhardToneMapping,
            'Cineon': THREE.CineonToneMapping,
            'ACESFilmic': THREE.ACESFilmicToneMapping,
            'AgX': THREE.AgXToneMapping
        };
        const mapping = mappings[type] || THREE.NoToneMapping;
        this.renderer!.toneMapping = mapping;
        this.rendererRight!.toneMapping = mapping;
    }

    /**
     * Set tone mapping exposure
     */
    setToneMappingExposure(value: number): void {
        this.renderer!.toneMappingExposure = value;
        this.rendererRight!.toneMappingExposure = value;
    }

    // =========================================================================
    // HDR ENVIRONMENT MAPS (IBL)
    // =========================================================================

    /**
     * Load an HDR environment map from URL
     */
    loadHDREnvironment(url: string): Promise<Texture> {
        return new Promise((resolve, reject) => {
            if (!this.pmremGenerator) {
                this.pmremGenerator = new PMREMGenerator(this.renderer!);
                this.pmremGenerator.compileEquirectangularShader();
            }

            const loader = new RGBELoader();
            loader.load(
                url,
                (texture) => {
                    texture.mapping = THREE.EquirectangularReflectionMapping;

                    // Dispose old env map
                    if (this.currentEnvMap) this.currentEnvMap.dispose();
                    if (this.currentEnvTexture) this.currentEnvTexture.dispose();

                    this.currentEnvTexture = texture;
                    this.currentEnvMap = this.pmremGenerator!.fromEquirectangular(texture).texture;

                    // Apply as environment lighting (IBL)
                    this.scene!.environment = this.currentEnvMap;

                    // If env-as-background is enabled, also set as background
                    if (this.envAsBackground) {
                        this.scene!.background = this.currentEnvTexture;
                    }

                    log.info('HDR environment loaded:', url);
                    resolve(this.currentEnvMap);
                },
                undefined,
                (error) => {
                    log.error('Failed to load HDR environment:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Load HDR environment from a File object
     */
    loadHDREnvironmentFromFile(file: File): Promise<Texture> {
        const url = URL.createObjectURL(file);
        return this.loadHDREnvironment(url).finally(() => {
            URL.revokeObjectURL(url);
        });
    }

    /**
     * Clear the current HDR environment
     */
    clearEnvironment(): void {
        this.scene!.environment = null;
        if (this.envAsBackground) {
            this.scene!.background = this.savedBackgroundColor || new Color(COLORS.SCENE_BACKGROUND);
            this.envAsBackground = false;
        }
        if (this.currentEnvMap) {
            this.currentEnvMap.dispose();
            this.currentEnvMap = null;
        }
        if (this.currentEnvTexture) {
            this.currentEnvTexture.dispose();
            this.currentEnvTexture = null;
        }
        log.info('Environment cleared');
    }

    /**
     * Toggle environment as scene background
     */
    setEnvironmentAsBackground(show: boolean): void {
        this.envAsBackground = show;
        if (show && this.currentEnvTexture) {
            if (this.scene!.background instanceof Color) {
                this.savedBackgroundColor = this.scene!.background.clone();
            }
            this.scene!.background = this.currentEnvTexture;
            this.clearBackgroundImage();
        } else if (!show) {
            if (this.backgroundImageTexture) {
                this.scene!.background = this.backgroundImageTexture;
            } else {
                this.scene!.background = this.savedBackgroundColor || new Color(COLORS.SCENE_BACKGROUND);
            }
        }
    }

    // =========================================================================
    // SHADOWS
    // =========================================================================

    /**
     * Enable or disable shadow rendering
     */
    enableShadows(enabled: boolean): void {
        this.renderer!.shadowMap.enabled = enabled;
        this.rendererRight!.shadowMap.enabled = enabled;
        this.directionalLight1!.castShadow = enabled;

        // Enable castShadow on all meshes in modelGroup
        if (this.modelGroup) {
            this.modelGroup.traverse((child) => {
                if ((child as Mesh).isMesh) {
                    (child as Mesh).castShadow = enabled;
                    (child as Mesh).receiveShadow = enabled;
                }
            });
        }

        // Toggle shadow catcher plane
        if (enabled) {
            this.createShadowCatcher();
        } else {
            this.removeShadowCatcher();
        }

        // Force shadow map rebuild
        this.renderer!.shadowMap.needsUpdate = true;
        this.rendererRight!.shadowMap.needsUpdate = true;

        log.info('Shadows', enabled ? 'enabled' : 'disabled');
    }

    /**
     * Apply shadow properties to all meshes in an object.
     * Call after loading new models when shadows are enabled.
     */
    applyShadowProperties(object: Object3D): void {
        const shadowsEnabled = this.renderer!.shadowMap.enabled;
        object.traverse((child) => {
            if ((child as Mesh).isMesh) {
                (child as Mesh).castShadow = shadowsEnabled;
                (child as Mesh).receiveShadow = shadowsEnabled;
            }
        });
    }

    /**
     * Create a shadow catcher ground plane
     */
    createShadowCatcher(): void {
        if (this.shadowCatcherPlane) return;

        const geometry = new PlaneGeometry(
            SHADOWS.GROUND_PLANE_SIZE,
            SHADOWS.GROUND_PLANE_SIZE
        );
        const material = new ShadowMaterial({
            opacity: 0.3,
            color: 0x000000
        });

        this.shadowCatcherPlane = new Mesh(geometry, material);
        this.shadowCatcherPlane.rotation.x = -Math.PI / 2;
        this.shadowCatcherPlane.position.y = SHADOWS.GROUND_PLANE_Y;
        this.shadowCatcherPlane.receiveShadow = true;
        this.shadowCatcherPlane.name = 'shadowCatcher';

        // Exclude from raycasting so annotations/alignment pass through
        this.shadowCatcherPlane.raycast = () => {};

        this.scene!.add(this.shadowCatcherPlane);
        log.info('Shadow catcher plane created');
    }

    /**
     * Remove the shadow catcher ground plane
     */
    removeShadowCatcher(): void {
        if (this.shadowCatcherPlane) {
            this.scene!.remove(this.shadowCatcherPlane);
            this.shadowCatcherPlane.geometry.dispose();
            this.shadowCatcherPlane.material.dispose();
            this.shadowCatcherPlane = null;
            log.info('Shadow catcher plane removed');
        }
    }

    /**
     * Set shadow catcher opacity
     */
    setShadowCatcherOpacity(opacity: number): void {
        if (this.shadowCatcherPlane && this.shadowCatcherPlane.material) {
            this.shadowCatcherPlane.material.opacity = opacity;
        }
    }

    // =========================================================================
    // BACKGROUND IMAGE
    // =========================================================================

    /**
     * Load a background image from URL
     */
    loadBackgroundImage(url: string): Promise<Texture> {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                url,
                (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    if (this.backgroundImageTexture) {
                        this.backgroundImageTexture.dispose();
                    }
                    this.backgroundImageTexture = texture;
                    this.scene!.background = texture;
                    this.envAsBackground = false;
                    log.info('Background image loaded');
                    resolve(texture);
                },
                undefined,
                (error) => {
                    log.error('Failed to load background image:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Load a background image from a File object
     */
    loadBackgroundImageFromFile(file: File): Promise<Texture> {
        const url = URL.createObjectURL(file);
        return this.loadBackgroundImage(url).then((texture) => {
            URL.revokeObjectURL(url);
            return texture;
        }).catch((error) => {
            URL.revokeObjectURL(url);
            throw error;
        });
    }

    /**
     * Clear the background image and revert to solid color
     */
    clearBackgroundImage(): void {
        if (this.backgroundImageTexture) {
            this.backgroundImageTexture.dispose();
            this.backgroundImageTexture = null;
        }
    }

    /**
     * Handle window resize
     */
    onWindowResize(displayMode: string, container: HTMLElement): void {
        if (displayMode === 'split') {
            const halfWidth = container.clientWidth / 2;
            this.camera!.aspect = halfWidth / container.clientHeight;
            this.camera!.updateProjectionMatrix();
            this.renderer!.setSize(halfWidth, container.clientHeight);
            this.rendererRight!.setSize(halfWidth, container.clientHeight);
        } else {
            this.camera!.aspect = container.clientWidth / container.clientHeight;
            this.camera!.updateProjectionMatrix();
            this.renderer!.setSize(container.clientWidth, container.clientHeight);
        }
    }

    /**
     * Update light intensity
     */
    setLightIntensity(lightType: string, intensity: number): void {
        switch (lightType) {
            case 'ambient':
                if (this.ambientLight) this.ambientLight.intensity = intensity;
                break;
            case 'hemisphere':
                if (this.hemisphereLight) this.hemisphereLight.intensity = intensity;
                break;
            case 'directional1':
                if (this.directionalLight1) this.directionalLight1.intensity = intensity;
                break;
            case 'directional2':
                if (this.directionalLight2) this.directionalLight2.intensity = intensity;
                break;
        }
    }

    /**
     * Set transform controls mode
     */
    setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
        this.transformControls!.setMode(mode);
    }

    /**
     * Attach transform controls to an object
     */
    attachTransformControls(object: Object3D | null): void {
        try {
            this.transformControls!.detach();
        } catch (e) {
            log.warn('Error detaching transform controls:', e);
        }

        if (object) {
            try {
                this.transformControls!.attach(object);
            } catch (attachError) {
                log.error('Error attaching transform controls:', attachError);
            }
        }
    }

    /**
     * Detach transform controls
     */
    detachTransformControls(): void {
        try {
            this.transformControls!.detach();
        } catch (e) {
            log.warn('Error detaching transform controls:', e);
        }
    }

    /**
     * Update FPS counter
     */
    updateFPS(fpsElement: HTMLElement | null): void {
        this.frameCount++;
        const currentTime = performance.now();
        if (currentTime - this.lastFpsTime >= 1000) {
            if (fpsElement) {
                fpsElement.textContent = this.frameCount.toString();
            }
            this.frameCount = 0;
            this.lastFpsTime = currentTime;
        }
    }

    /**
     * Render a single frame
     */
    render(
        displayMode: string,
        splatMesh: Object3D | null,
        modelGroup: Group | null,
        pointcloudGroup: Group | null,
        stlGroup: Group | null
    ): void {
        if (displayMode === 'split') {
            // Split view - render splat on left, model + pointcloud + stl on right
            const splatVisible = splatMesh ? splatMesh.visible : false;
            const modelVisible = modelGroup ? modelGroup.visible : false;
            const pcVisible = pointcloudGroup ? pointcloudGroup.visible : false;
            const stlVisible = stlGroup ? stlGroup.visible : false;

            // Left view - splat only
            if (splatMesh) splatMesh.visible = true;
            if (modelGroup) modelGroup.visible = false;
            if (pointcloudGroup) pointcloudGroup.visible = false;
            if (stlGroup) stlGroup.visible = false;
            this.renderer!.render(this.scene!, this.camera!);

            // Right view - model + pointcloud + stl
            if (splatMesh) splatMesh.visible = false;
            if (modelGroup) modelGroup.visible = true;
            if (pointcloudGroup) pointcloudGroup.visible = true;
            if (stlGroup) stlGroup.visible = true;
            this.rendererRight!.render(this.scene!, this.camera!);

            // Restore visibility
            if (splatMesh) splatMesh.visible = splatVisible;
            if (modelGroup) modelGroup.visible = modelVisible;
            if (pointcloudGroup) pointcloudGroup.visible = pcVisible;
            if (stlGroup) stlGroup.visible = stlVisible;
        } else {
            // Normal view
            this.renderer!.render(this.scene!, this.camera!);
        }
    }

    /**
     * Add an object to the scene
     */
    addToScene(object: Object3D): void {
        this.scene!.add(object);
    }

    /**
     * Remove an object from the scene
     */
    removeFromScene(object: Object3D): void {
        this.scene!.remove(object);
    }

    /**
     * Dispose of scene resources
     */
    dispose(): void {
        // Clean up environment
        if (this.currentEnvMap) {
            this.currentEnvMap.dispose();
            this.currentEnvMap = null;
        }
        if (this.currentEnvTexture) {
            this.currentEnvTexture.dispose();
            this.currentEnvTexture = null;
        }
        if (this.pmremGenerator) {
            this.pmremGenerator.dispose();
            this.pmremGenerator = null;
        }
        if (this.backgroundImageTexture) {
            this.backgroundImageTexture.dispose();
            this.backgroundImageTexture = null;
        }
        this.removeShadowCatcher();

        if (this.gridHelper) {
            this.scene!.remove(this.gridHelper);
            this.gridHelper.dispose();
            this.gridHelper = null;
        }

        if (this.transformControls) {
            this.scene!.remove(this.transformControls as unknown as Object3D);
            this.transformControls.dispose();
        }

        if (this.controls) {
            this.controls.dispose();
        }

        if (this.controlsRight) {
            this.controlsRight.dispose();
        }

        if (this.renderer) {
            this.renderer.dispose();
        }

        if (this.rendererRight) {
            this.rendererRight.dispose();
        }

        log.info('Scene manager disposed');
    }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create and initialize a scene manager
 */
export function createSceneManager(canvas: HTMLCanvasElement, canvasRight: HTMLCanvasElement): SceneManager | null {
    const manager = new SceneManager();
    const success = manager.init(canvas, canvasRight);
    return success ? manager : null;
}

export default SceneManager;
