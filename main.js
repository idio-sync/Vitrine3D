import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

// Global state
const state = {
    displayMode: 'both', // 'splat', 'model', 'both'
    splatLoaded: false,
    modelLoaded: false,
    splatScale: 1,
    splatOpacity: 1,
    modelScale: 1,
    modelOpacity: 1,
    modelWireframe: false
};

// Three.js objects
let scene, camera, renderer, controls;
let splatViewer = null;
let modelGroup = null;

// DOM elements
const canvas = document.getElementById('viewer-canvas');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// Initialize the scene
function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Camera
    camera = new THREE.PerspectiveCamera(
        60,
        canvas.clientWidth / canvas.clientHeight,
        0.1,
        1000
    );
    camera.position.set(0, 1, 3);

    // Renderer
    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true
    });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.1;
    controls.maxDistance = 100;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-5, 3, -5);
    scene.add(directionalLight2);

    // Grid helper
    const gridHelper = new THREE.GridHelper(10, 10, 0x4a4a6a, 0x2a2a4a);
    scene.add(gridHelper);

    // Model group
    modelGroup = new THREE.Group();
    modelGroup.name = 'modelGroup';
    scene.add(modelGroup);

    // Handle resize
    window.addEventListener('resize', onWindowResize);

    // Setup UI events
    setupUIEvents();

    // Start render loop
    animate();
}

function onWindowResize() {
    const container = document.getElementById('viewer-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function setupUIEvents() {
    // Display mode toggles
    document.getElementById('btn-splat').addEventListener('click', () => setDisplayMode('splat'));
    document.getElementById('btn-model').addEventListener('click', () => setDisplayMode('model'));
    document.getElementById('btn-both').addEventListener('click', () => setDisplayMode('both'));

    // File inputs
    document.getElementById('splat-input').addEventListener('change', handleSplatFile);
    document.getElementById('model-input').addEventListener('change', handleModelFile);

    // Splat settings
    document.getElementById('splat-scale').addEventListener('input', (e) => {
        state.splatScale = parseFloat(e.target.value);
        document.getElementById('splat-scale-value').textContent = state.splatScale.toFixed(1);
        updateSplatTransform();
    });

    document.getElementById('splat-opacity').addEventListener('input', (e) => {
        state.splatOpacity = parseFloat(e.target.value);
        document.getElementById('splat-opacity-value').textContent = state.splatOpacity.toFixed(2);
        // Note: Opacity control depends on the splat library's capabilities
    });

    // Model settings
    document.getElementById('model-scale').addEventListener('input', (e) => {
        state.modelScale = parseFloat(e.target.value);
        document.getElementById('model-scale-value').textContent = state.modelScale.toFixed(1);
        updateModelTransform();
    });

    document.getElementById('model-opacity').addEventListener('input', (e) => {
        state.modelOpacity = parseFloat(e.target.value);
        document.getElementById('model-opacity-value').textContent = state.modelOpacity.toFixed(2);
        updateModelOpacity();
    });

    document.getElementById('model-wireframe').addEventListener('change', (e) => {
        state.modelWireframe = e.target.checked;
        updateModelWireframe();
    });

    // Camera buttons
    document.getElementById('btn-reset-camera').addEventListener('click', resetCamera);
    document.getElementById('btn-fit-view').addEventListener('click', fitToView);
}

function setDisplayMode(mode) {
    state.displayMode = mode;

    // Update button states
    document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${mode}`).classList.add('active');

    // Update visibility
    updateVisibility();
}

function updateVisibility() {
    const showSplat = state.displayMode === 'splat' || state.displayMode === 'both';
    const showModel = state.displayMode === 'model' || state.displayMode === 'both';

    // Update model visibility
    if (modelGroup) {
        modelGroup.visible = showModel;
    }

    // Update splat visibility
    if (splatViewer) {
        // The gaussian-splats-3d library handles its own rendering
        // We need to control it through the viewer's scene group
        const splatMesh = scene.getObjectByName('splatMesh');
        if (splatMesh) {
            splatMesh.visible = showSplat;
        }
    }
}

function showLoading(text = 'Loading...') {
    loadingText.textContent = text;
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

async function handleSplatFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('splat-filename').textContent = file.name;
    showLoading('Loading Gaussian Splat...');

    try {
        // Clean up existing splat viewer
        if (splatViewer) {
            splatViewer.dispose();
            splatViewer = null;
        }

        // Create object URL for the file
        const fileUrl = URL.createObjectURL(file);

        // Determine format based on extension
        const extension = file.name.split('.').pop().toLowerCase();

        // Initialize gaussian splat viewer
        // Using the GaussianSplats3D library from CDN
        splatViewer = new GaussianSplats3D.Viewer({
            cameraUp: [0, 1, 0],
            initialCameraPosition: [0, 1, 3],
            initialCameraLookAt: [0, 0, 0],
            selfDrivenMode: false,
            renderer: renderer,
            camera: camera,
            threeScene: scene,
            useBuiltInControls: false,
            dynamicScene: true
        });

        // Add splat to viewer
        await splatViewer.addSplatScene(fileUrl, {
            splatAlphaRemovalThreshold: 5,
            showLoadingUI: false,
            progressiveLoad: true
        });

        // Clean up URL
        URL.revokeObjectURL(fileUrl);

        state.splatLoaded = true;
        updateSplatTransform();
        updateVisibility();

        // Update info
        const splatCount = splatViewer.getSplatCount ? splatViewer.getSplatCount() : 'N/A';
        document.getElementById('splat-vertices').textContent = splatCount.toLocaleString ? splatCount.toLocaleString() : splatCount;

        hideLoading();
    } catch (error) {
        console.error('Error loading splat:', error);
        hideLoading();
        alert('Error loading Gaussian Splat: ' + error.message);
    }
}

async function handleModelFile(event) {
    const files = event.target.files;
    if (!files.length) return;

    const mainFile = files[0];
    document.getElementById('model-filename').textContent = mainFile.name;
    showLoading('Loading 3D Model...');

    try {
        // Clear existing model
        while (modelGroup.children.length > 0) {
            const child = modelGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
            modelGroup.remove(child);
        }

        const extension = mainFile.name.split('.').pop().toLowerCase();
        let loadedObject;

        if (extension === 'glb' || extension === 'gltf') {
            loadedObject = await loadGLTF(mainFile);
        } else if (extension === 'obj') {
            // Look for MTL file in the same selection
            let mtlFile = null;
            for (const f of files) {
                if (f.name.toLowerCase().endsWith('.mtl')) {
                    mtlFile = f;
                    break;
                }
            }
            loadedObject = await loadOBJ(mainFile, mtlFile);
        }

        if (loadedObject) {
            modelGroup.add(loadedObject);
            state.modelLoaded = true;
            updateModelTransform();
            updateModelOpacity();
            updateModelWireframe();
            updateVisibility();

            // Count faces
            let faceCount = 0;
            loadedObject.traverse((child) => {
                if (child.isMesh && child.geometry) {
                    const geo = child.geometry;
                    if (geo.index) {
                        faceCount += geo.index.count / 3;
                    } else if (geo.attributes.position) {
                        faceCount += geo.attributes.position.count / 3;
                    }
                }
            });
            document.getElementById('model-faces').textContent = Math.round(faceCount).toLocaleString();
        }

        hideLoading();
    } catch (error) {
        console.error('Error loading model:', error);
        hideLoading();
        alert('Error loading model: ' + error.message);
    }
}

function loadGLTF(file) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        const url = URL.createObjectURL(file);

        loader.load(
            url,
            (gltf) => {
                URL.revokeObjectURL(url);
                resolve(gltf.scene);
            },
            undefined,
            (error) => {
                URL.revokeObjectURL(url);
                reject(error);
            }
        );
    });
}

function loadOBJ(objFile, mtlFile) {
    return new Promise(async (resolve, reject) => {
        const objUrl = URL.createObjectURL(objFile);

        try {
            const objLoader = new OBJLoader();

            if (mtlFile) {
                const mtlUrl = URL.createObjectURL(mtlFile);
                const mtlLoader = new MTLLoader();

                mtlLoader.load(
                    mtlUrl,
                    (materials) => {
                        materials.preload();
                        objLoader.setMaterials(materials);

                        objLoader.load(
                            objUrl,
                            (object) => {
                                URL.revokeObjectURL(objUrl);
                                URL.revokeObjectURL(mtlUrl);
                                resolve(object);
                            },
                            undefined,
                            (error) => {
                                URL.revokeObjectURL(objUrl);
                                URL.revokeObjectURL(mtlUrl);
                                reject(error);
                            }
                        );
                    },
                    undefined,
                    (error) => {
                        URL.revokeObjectURL(mtlUrl);
                        // Try loading without materials
                        loadOBJWithoutMaterials(objLoader, objUrl, resolve, reject);
                    }
                );
            } else {
                loadOBJWithoutMaterials(objLoader, objUrl, resolve, reject);
            }
        } catch (error) {
            URL.revokeObjectURL(objUrl);
            reject(error);
        }
    });
}

function loadOBJWithoutMaterials(loader, url, resolve, reject) {
    loader.load(
        url,
        (object) => {
            URL.revokeObjectURL(url);
            // Apply default material
            object.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x888888,
                        metalness: 0.1,
                        roughness: 0.8
                    });
                }
            });
            resolve(object);
        },
        undefined,
        (error) => {
            URL.revokeObjectURL(url);
            reject(error);
        }
    );
}

function updateSplatTransform() {
    if (splatViewer) {
        // The GaussianSplats3D viewer handles transforms internally
        // Scale can be applied via the splatScene transform if supported
    }
}

function updateModelTransform() {
    if (modelGroup) {
        modelGroup.scale.setScalar(state.modelScale);
    }
}

function updateModelOpacity() {
    if (modelGroup) {
        modelGroup.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    mat.transparent = state.modelOpacity < 1;
                    mat.opacity = state.modelOpacity;
                    mat.needsUpdate = true;
                });
            }
        });
    }
}

function updateModelWireframe() {
    if (modelGroup) {
        modelGroup.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    mat.wireframe = state.modelWireframe;
                    mat.needsUpdate = true;
                });
            }
        });
    }
}

function resetCamera() {
    camera.position.set(0, 1, 3);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
}

function fitToView() {
    const box = new THREE.Box3();
    let hasContent = false;

    // Include model in bounding box
    if (modelGroup && modelGroup.children.length > 0) {
        modelGroup.traverse((child) => {
            if (child.isMesh) {
                box.expandByObject(child);
                hasContent = true;
            }
        });
    }

    if (!hasContent) {
        // Default bounds if nothing loaded
        box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 2));
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraDistance = maxDim / (2 * Math.tan(fov / 2));
    cameraDistance *= 1.5; // Add some padding

    camera.position.set(center.x + cameraDistance * 0.5, center.y + cameraDistance * 0.3, center.z + cameraDistance);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
}

// FPS counter
let frameCount = 0;
let lastTime = performance.now();

function updateFPS() {
    frameCount++;
    const currentTime = performance.now();
    if (currentTime - lastTime >= 1000) {
        document.getElementById('fps-counter').textContent = frameCount;
        frameCount = 0;
        lastTime = currentTime;
    }
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    controls.update();

    // Update splat viewer if present
    if (splatViewer) {
        splatViewer.update();
        splatViewer.render();
    } else {
        renderer.render(scene, camera);
    }

    updateFPS();
}

// Initialize when DOM is ready
init();
