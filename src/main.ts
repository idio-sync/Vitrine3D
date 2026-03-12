// ES Module imports (these are hoisted - execute first before any other code)
import * as THREE from 'three';
import { SplatMesh, createSparkRenderer } from './modules/spark-compat.js';
import { ArchiveLoader } from './modules/archive-loader.js';
// hasAnyProxy moved to archive-pipeline.ts (Phase 2.2)
import { AnnotationSystem } from './modules/annotation-system.js';
import { CrossSectionTool } from './modules/cross-section.js';
import { MeasurementSystem } from './modules/measurement-system.js';
import { FlightPathManager } from './modules/flight-path.js';
import { ColmapManager } from './modules/colmap-loader.js';
import { alignCamerasToFlightPath, computeSimilarityTransform, matchCamerasToFlightPoints } from './modules/colmap-alignment.js';
import { runICP, sampleSplatPoints } from './modules/icp-alignment.js';
import { ArchiveCreator, CRYPTO_AVAILABLE } from './modules/archive-creator.js';
import { CAMERA, TIMING, ASSET_STATE, MESH_LOD, QUALITY_TIER, COLORS, DECIMATION_PRESETS, DEFAULT_DECIMATION_PRESET, SPARK_DEFAULTS } from './modules/constants.js';
import { getLodBudget } from './modules/quality-tier.js';
import { Logger, notify, disposeObject } from './modules/utilities.js';
import { FlyControls } from './modules/fly-controls.js';
import { getStore } from './modules/asset-store.js';
import { validateUserUrl as validateUserUrlCore } from './modules/url-validation.js';
import { initLibraryPanel } from './modules/library-panel.js';
import {
    initWalkthroughController,
    addStop as wtAddStop,
    addStopFromAnnotation as wtAddStopFromAnnotation,
    deleteStop as wtDeleteStop,
    updateStopCamera as wtUpdateStopCamera,
    playPreview as wtPlayPreview,
    stopPreview as wtStopPreview,
    isPreviewAnimating,
} from './modules/walkthrough-controller.js';
import { SceneManager } from './modules/scene-manager.js';
import * as postProcessing from './modules/post-processing.js';
import {
    LandmarkAlignment,
    autoCenterAlign as autoCenterAlignHandler,
    fitToView as fitToViewHandler,
    resetAlignment as resetAlignmentHandler,
    resetCamera as resetCameraHandler,
    centerModelOnGrid,
    applyAlignmentData as applyAlignmentDataHandler,
    loadAlignmentFromUrl as loadAlignmentFromUrlHandler
} from './modules/alignment.js';
import {
    showLoading,
    hideLoading,
    updateProgress,
    addListener,
    showInlineLoading,
    hideInlineLoading,
    hideExportPanel,
    setDisplayMode as setDisplayModeHandler,
    updateVisibility as updateVisibilityHandler,
    updateTransformInputs as updateTransformInputsHandler,
    showExportPanel as showExportPanelHandler,
    applyControlsMode as applyControlsModeHandler,
    applyControlsVisibility as applyControlsVisibilityHandler,
    ensureToolbarVisibility as ensureToolbarVisibilityHandler,
    applyViewerModeSettings as applyViewerModeSettingsHandler,
    updateStatusBar,
    updateDisplayPill,
    updateOverlayPill,
    updateTransformPaneSelection
} from './modules/ui-controller.js';
import {
    formatFileSize,
    collectMetadata,
    hideMetadataSidebar,
    showMetadataSidebar as showMetadataSidebarHandler,
    toggleMetadataDisplay as toggleMetadataDisplayHandler,
    populateMetadataDisplay as populateMetadataDisplayHandler,
    clearArchiveMetadata as clearArchiveMetadataHandler,
    showAnnotationPopup as showAnnotationPopupHandler,
    updateAnnotationPopupPosition as updateAnnotationPopupPositionHandler,
    hideAnnotationPopup as hideAnnotationPopupHandler,
    setupMetadataSidebar as setupMetadataSidebarHandler,
    prefillMetadataFromArchive as prefillMetadataFromArchiveHandler,
    updatePronomRegistry,
    invalidatePopupLayoutCache,
    initImageLightbox
} from './modules/metadata-manager.js';
import {
    loadSplatFromFile as loadSplatFromFileHandler,
    loadModelFromFile as loadModelFromFileHandler,
    loadPointcloudFromFile as loadPointcloudFromFileHandler,
    getAssetTypesForMode,
    updateModelOpacity as updateModelOpacityFn,
    updateModelWireframe as updateModelWireframeFn,
    updateModelMatcap as updateModelMatcapFn,
    updateModelNormals as updateModelNormalsFn,
    updateModelRoughness as updateModelRoughnessFn,
    updateModelMetalness as updateModelMetalnessFn,
    updateModelSpecularF0 as updateModelSpecularF0Fn,
    loadSTLFile as loadSTLFileHandler,
} from './modules/file-handlers.js';
import {
    handleLoadArchiveFromUrlPrompt as handleLoadArchiveFromUrlPromptCtrl,
    handleSplatFile as handleSplatFileCtrl,
    handleModelFile as handleModelFileCtrl,
    handleSTLFile as handleSTLFileCtrl,
    handleCADFile as handleCADFileCtrl,
    handleDrawingFile as handleDrawingFileCtrl,
    handlePointcloudFile as handlePointcloudFileCtrl,
    handleProxyMeshFile as handleProxyMeshFileCtrl,
    handleProxySplatFile as handleProxySplatFileCtrl,
    loadSplatFromUrl as loadSplatFromUrlCtrl,
    loadModelFromUrl as loadModelFromUrlCtrl,
    loadPointcloudFromUrl as loadPointcloudFromUrlCtrl
} from './modules/file-input-handlers.js';
import {
    downloadScreenshot as downloadScreenshotHandler,
    captureScreenshotToList as captureScreenshotToListHandler,
    showViewfinder as showViewfinderHandler,
    hideViewfinder as hideViewfinderHandler,
    captureManualPreview as captureManualPreviewHandler
} from './modules/screenshot-manager.js';
import {
    initRecordingManager,
    startRecording as startRecordingHandler,
    stopRecording as stopRecordingHandler,
    discardRecording,
    uploadRecording,
    pollMediaStatus,
    type RecordingMode,
} from './modules/recording-manager.js';
import { showTrimUI } from './modules/recording-trim.js';
import {
    startAnnotationTour,
    stopAnnotationTour,
} from './modules/annotation-tour.js';
import {
    setSelectedObject as setSelectedObjectHandler,
    syncBothObjects as syncBothObjectsHandler,
    storeLastPositions as storeLastPositionsHandler,
    setTransformMode as setTransformModeHandler,
    resetTransform as resetTransformHandler,
    applyPivotRotation as applyPivotRotationHandler,
    applyUniformScale as applyUniformScaleHandler,
    centerAtOrigin as centerAtOriginHandler
} from './modules/transform-controller.js';
import {
    handleSourceFilesInput,
    updateSourceFilesUI
} from './modules/source-files-manager.js';
import {
    getCurrentPopupAnnotationId,
    dismissPopup as dismissPopupHandler,
    onAnnotationPlaced as onAnnotationPlacedHandler,
    onAnnotationSelected as onAnnotationSelectedHandler,
    onPlacementModeChanged as onPlacementModeChangedHandler,
    toggleAnnotationMode as toggleAnnotationModeHandler,
    saveAnnotation as saveAnnotationHandler,
    cancelAnnotation as cancelAnnotationHandler,
    updateSelectedAnnotationCamera as updateSelectedAnnotationCameraHandler,
    deleteSelectedAnnotation as deleteSelectedAnnotationHandler,
    updateAnnotationsUI as updateAnnotationsUIHandler,
    updateSidebarAnnotationsList as updateSidebarAnnotationsListHandler,
    loadAnnotationsFromArchive as loadAnnotationsFromArchiveHandler
} from './modules/annotation-controller.js';
import {
    handleArchiveFile as handleArchiveFileCtrl,
    loadArchiveFromUrl as loadArchiveFromUrlCtrl,
    ensureAssetLoaded as ensureAssetLoadedCtrl,
    processArchive as processArchiveCtrl,
    clearArchiveMetadata as clearArchiveMetadataCtrl,
    switchQualityTier as switchQualityTierCtrl,
    handleLoadFullResMesh as handleLoadFullResMeshCtrl
} from './modules/archive-pipeline.js';
import {
    setupUIEvents as setupUIEventsCtrl
} from './modules/event-wiring.js';
import { UndoManager } from './modules/undo-manager.js';
import type { MatrixSnapshot } from './modules/undo-manager.js';
import type { AppState, SceneRefs, ExportDeps, ArchivePipelineDeps, EventWiringDeps, DisplayMode, SelectedObject, TransformMode, DecimationOptions, EditorAlignmentDeps, FileHandlerDeps, AlignmentIODeps } from './types.js';
import type { AnnotationControllerDeps } from './modules/annotation-controller.js';
import type { MetadataDeps } from './modules/metadata-manager.js';
import type { LoadCADDeps } from './modules/cad-loader.js';
import type { ControlsPanelDeps } from './modules/ui-controller.js';
import type { FileInputDeps } from './modules/file-input-handlers.js';
import type { LoadPointcloudDeps } from './modules/file-handlers.js';
import { generateProxy, estimateFaceCount } from './modules/mesh-decimator.js';

declare global {
    interface Window {
        APP_CONFIG?: any;
        moduleLoaded?: boolean;
        THREE?: typeof THREE;
        notify?: typeof notify;
    }
}

// Tauri desktop integration (lazy-loaded to avoid errors in browser)
let tauriBridge: any = null;
if (window.__TAURI__) {
    import('./modules/tauri-bridge.js').then((mod: any) => {
        tauriBridge = mod;
        console.log('[main] Tauri bridge loaded — native dialogs available');
    }).catch((err: any) => {
        console.warn('[main] Tauri bridge failed to load:', err);
    });
}

// Create logger for this module
const log = Logger.getLogger('main');

// Mark module as loaded (for pre-module error detection)
window.moduleLoaded = true;
log.info('Module loaded successfully, THREE:', !!THREE, 'SplatMesh:', !!SplatMesh);

// Expose THREE globally for debugging and potential library compatibility
window.THREE = THREE;
log.debug('THREE.REVISION:', THREE.REVISION);

// Expose notify for use by dynamically loaded modules (share dialog, etc.)
window.notify = notify;

// Global error handler for runtime errors
window.onerror = function(message: string | Event, source?: string, lineno?: number, _colno?: number, _error?: Error) {
    log.error(' Runtime error:', message, 'at', source, 'line', lineno);
    return false;
};

// Get configuration from window (set by config.js)
const config: any = window.APP_CONFIG || {
    defaultArchiveUrl: '',
    defaultSplatUrl: '',
    defaultModelUrl: '',
    defaultPointcloudUrl: '',
    defaultAlignmentUrl: '',
    inlineAlignment: null,
    showControls: true,
    showToolbar: true, // Default to showing toolbar
    controlsMode: 'full', // full, minimal, none
    initialViewMode: 'both' // splat, model, both, split
};

// =============================================================================
// URL VALIDATION - Security measure for user-provided URLs
// =============================================================================

// Allowed external domains — reads from APP_CONFIG (set by config.js / Docker env var)
// Falls back to empty array for local dev without config.js
const ALLOWED_EXTERNAL_DOMAINS: string[] = window.APP_CONFIG?.allowedDomains || [];

/**
 * Validates a URL to prevent loading from untrusted sources.
 * Thin wrapper around url-validation.ts that provides browser context.
 *
 * @param {string} urlString - The URL string to validate
 * @param {string} resourceType - Type of resource (for error messages)
 * @returns {{valid: boolean, url: string, error: string}} - Validation result
 */
function validateUserUrl(urlString: string, resourceType: string) {
    const result = validateUserUrlCore(urlString, resourceType, {
        allowedDomains: ALLOWED_EXTERNAL_DOMAINS,
        currentOrigin: window.location.origin,
        currentProtocol: window.location.protocol
    });
    if (result.valid) {
        console.info(`[main] Validated ${resourceType} URL:`, result.url);
    }
    return result;
}

// Global state
const state: AppState = {
    displayMode: config.initialViewMode || 'model', // 'splat', 'model', 'pointcloud', 'both', 'split'
    selectedObject: 'none', // 'splat', 'mesh', 'both', 'none'
    transformMode: 'translate', // 'translate', 'rotate', 'scale'
    rotationPivot: 'object', // 'object' | 'origin'
    scaleLockProportions: true, // lock proportions when scaling
    splatLoaded: false,
    modelLoaded: false,
    pointcloudLoaded: false,
    stlLoaded: false,
    cadLoaded: false,
    currentCadUrl: null,
    drawingLoaded: false,
    flightPathLoaded: false,
    colmapLoaded: false,
    currentDrawingUrl: null,
    modelOpacity: 1,
    modelWireframe: false,
    modelMatcap: false,
    matcapStyle: 'clay',
    modelNormals: false,
    modelRoughness: false,
    modelMetalness: false,
    modelSpecularF0: false,
    pointcloudPointSize: 0.01,
    pointcloudOpacity: 1,
    controlsVisible: config.showControls,
    currentSplatUrl: config.defaultSplatUrl || null,
    currentModelUrl: config.defaultModelUrl || null,
    currentPointcloudUrl: config.defaultPointcloudUrl || null,
    // Per-mode background color overrides
    meshBackgroundColor: null,
    splatBackgroundColor: null,
    // Archive state
    archiveLoaded: false,
    archiveManifest: null,
    archiveFileName: null,
    currentArchiveUrl: config.defaultArchiveUrl || null,
    archiveLoader: null,
    // Per-asset loading state for lazy archive extraction
    assetStates: { splat: ASSET_STATE.UNLOADED, mesh: ASSET_STATE.UNLOADED, pointcloud: ASSET_STATE.UNLOADED },
    // Whether the currently displayed mesh is a proxy (display-quality LOD)
    viewingProxy: false,
    // Quality tier (main app defaults to HD — authoring tool)
    qualityTier: 'hd',
    qualityResolved: 'hd',
    // Embedded images for annotation/description markdown
    imageAssets: new Map(),
    // Screenshot captures for archive export
    screenshots: [],          // Array of { id, blob, dataUrl, timestamp }
    manualPreviewBlob: null,  // If set, overrides auto-capture during export
    // Decimation / SD proxy
    meshFaceCount: 0,
    proxyMeshGroup: null,
    proxyMeshSettings: null,
    proxyMeshFaceCount: null,
    originalMeshBlob: null,
    originalMeshGroup: null,
    meshOptimized: false,
    meshOptimizationSettings: null,
    // Detected asset format extensions (set during file load)
    meshFormat: null,
    pointcloudFormat: null,
    splatFormat: null,
    splatLodEnabled: true,
    viewDefaults: {
        sfmCameras: { visible: false, displayMode: 'frustums' },
        flightPath: { visible: false, lineColor: '#00ffff', lineOpacity: 1.0, showMarkers: true, markerDensity: 'all' },
    },
    environmentBlob: null,
    renderingPreset: null,
};

// Scene manager instance (handles scene, camera, renderer, controls, lighting)
let sceneManager: any = null;

// Three.js objects - Main view (references extracted from SceneManager for backward compatibility)
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: any; // WebGLRenderer | WebGPURenderer — widened for auto-switching
let controls: any; // OrbitControls
let transformControls: any; // TransformControls
let flyControls: any = null; // FlyControls (custom)
let sparkRenderer: any = null; // SparkRenderer instance
let splatMesh: any = null; // SplatMesh from Spark
let modelGroup: THREE.Group;
let pointcloudGroup: THREE.Group;
let stlGroup: THREE.Group;
let cadGroup: THREE.Group;
let drawingGroup: THREE.Group;
let ambientLight: THREE.AmbientLight;
let hemisphereLight: THREE.HemisphereLight;
let directionalLight1: THREE.DirectionalLight;
let directionalLight2: THREE.DirectionalLight;

// Annotation, alignment, archive creation, and measurement
let annotationSystem: any = null;
let measurementSystem: any = null;
let landmarkAlignment: any = null;
let archiveCreator: any = null;
let crossSection: CrossSectionTool | null = null;
let flightPathManager: FlightPathManager | null = null;
let colmapManager: ColmapManager | null = null;
let _dragBeforeMatrices: MatrixSnapshot | null = null;
let _numericEditBefore: MatrixSnapshot | null = null;
let undoManager: UndoManager;

// Trim undo stack (separate from transform undo — stores before/after trim indices)
interface TrimUndoEntry {
    pathId: string;
    before: { trimStart?: number; trimEnd?: number };
    after: { trimStart?: number; trimEnd?: number };
}
const trimUndoStack: TrimUndoEntry[] = [];
const trimRedoStack: TrimUndoEntry[] = [];

// Asset blob store (ES module singleton — shared with archive-pipeline, export-controller, etc.)
const assets = getStore();

// Dynamic getter object for mutable Three.js references — prevents stale-reference bugs
// when splatMesh/modelGroup etc. are reassigned after loading new files.
// Pass to extracted modules instead of individual objects.
const sceneRefs: SceneRefs = {
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get controls() { return controls; },
    get transformControls() { return transformControls; },
    get splatMesh() { return splatMesh; },
    get modelGroup() { return modelGroup; },
    get pointcloudGroup() { return pointcloudGroup; },
    get stlGroup() { return stlGroup; },
    get cadGroup() { return cadGroup; },
    get drawingGroup() { return drawingGroup; },
    get flightPathGroup() { return flightPathManager ? sceneManager?.flightPathGroup : null; },
    get colmapGroup() { return sceneManager?.colmapGroup || null; },
    get flyControls() { return flyControls; },
    get annotationSystem() { return annotationSystem; },
    get archiveCreator() { return archiveCreator; },
    get measurementSystem() { return measurementSystem; },
    get landmarkAlignment() { return landmarkAlignment; },
    get ambientLight() { return ambientLight; },
    get hemisphereLight() { return hemisphereLight; },
    get directionalLight1() { return directionalLight1; },
    get directionalLight2() { return directionalLight2; }
};

// Three.js objects - Split view (right side)
let controlsRight: any = null;

// DOM elements (with null checks for debugging)
const canvas: HTMLElement | null = document.getElementById('viewer-canvas');
const canvasRight = document.getElementById('viewer-canvas-right') as HTMLCanvasElement | null;
const loadingOverlay: HTMLElement | null = document.getElementById('loading-overlay');
const loadingText: HTMLElement | null = document.getElementById('loading-text');

log.info(' DOM elements found:', {
    canvas: !!canvas,
    canvasRight: !!canvasRight,
    loadingOverlay: !!loadingOverlay,
    loadingText: !!loadingText
});

// Helper function to create dependencies object for file-handlers.js
function createFileHandlerDeps(): FileHandlerDeps {
    return {
        scene,
        modelGroup,
        stlGroup,
        drawingGroup,
        getSplatMesh: () => splatMesh,
        setSplatMesh: (mesh: any) => { splatMesh = mesh; },
        getModelGroup: () => modelGroup,
        state,
        sceneManager,
        archiveCreator,
        callbacks: {
            onSplatLoaded: (mesh: any, file: any) => {
                // Detect splat format from filename
                const splatName = file?.name || '';
                const splatExt = splatName.split('.').pop()?.toLowerCase() || 'splat';
                state.splatFormat = splatExt;
                // Auto-switch display mode to show the newly loaded splat
                if (state.modelLoaded && state.displayMode === 'model') {
                    setDisplayMode('both');
                } else if (!state.modelLoaded && state.displayMode !== 'splat') {
                    setDisplayMode('splat');
                }
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();
                updateObjectSelectButtons();
                assets.splatBlob = file;
                const splatVertEl = document.getElementById('splat-vertices');
                if (splatVertEl) {
                    splatVertEl.textContent = 'Loaded';
                    const splatRow = document.getElementById('splat-vertices-row');
                    if (splatRow) splatRow.style.display = '';
                }
                // Auto center-align if model is already loaded
                if (state.modelLoaded && !state.archiveLoaded) {
                    setTimeout(() => autoCenterAlign(), TIMING.AUTO_ALIGN_DELAY);
                }
                if (!state.archiveLoaded) {
                    clearArchiveMetadata();
                }
                updatePronomRegistry(state);
                enableRemoveBtn('btn-remove-splat', true);
            },
            onModelLoaded: (object: any, file: any, faceCount: number) => {
                state.meshFaceCount = faceCount;
                // Detect mesh format — prefer _meshFileName (set by loadModelFromFile for GLB conversions)
                const meshName = state._meshFileName || file?.name || '';
                const meshExt = meshName.split('.').pop()?.toLowerCase() || 'glb';
                state.meshFormat = meshExt;
                // Auto-switch display mode to show the newly loaded model
                if (state.splatLoaded && state.displayMode === 'splat') {
                    setDisplayMode('both');
                } else if (!state.splatLoaded && state.displayMode !== 'model') {
                    setDisplayMode('model');
                }
                updateModelOpacity();
                updateModelWireframe();
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();
                updateObjectSelectButtons();
                assets.meshBlob = file;
                const facesEl = document.getElementById('model-faces');
                if (facesEl) {
                    facesEl.textContent = (faceCount || 0).toLocaleString();
                    const facesRow = document.getElementById('model-faces-row');
                    if (facesRow) facesRow.style.display = '';
                }
                // Update decimation panel estimate
                const hdFacesEl = document.getElementById('decimation-hd-faces');
                if (hdFacesEl) hdFacesEl.textContent = (faceCount || 0).toLocaleString();
                const sdFacesEl = document.getElementById('decimation-sd-faces');
                if (sdFacesEl) {
                    const presetSelect = document.getElementById('decimation-preset') as HTMLSelectElement | null;
                    const est = estimateFaceCount(faceCount, { preset: presetSelect?.value || DEFAULT_DECIMATION_PRESET });
                    sdFacesEl.textContent = est.toLocaleString();
                }
                // Update texture info display
                if (state.meshTextureInfo) {
                    const texEl = document.getElementById('model-textures');
                    if (texEl && state.meshTextureInfo.count > 0) {
                        texEl.textContent = `${state.meshTextureInfo.count} × ${state.meshTextureInfo.maxResolution}²`;
                        const texRow = texEl.closest('.prop-row') as HTMLElement;
                        if (texRow) texRow.style.display = '';
                    }
                }
                showQualityToggleIfNeeded();
                // Show web optimization section
                const webOptSection = document.getElementById('web-opt-section');
                if (webOptSection) {
                    webOptSection.classList.remove('hidden');
                }
                const webOptFaces = document.getElementById('web-opt-current-faces');
                if (webOptFaces) {
                    webOptFaces.textContent = `Current faces: ${state.meshFaceCount.toLocaleString()}`;
                }
                enableRemoveBtn('btn-remove-model', true);
                // Advisory face count warnings
                if (faceCount > MESH_LOD.DESKTOP_WARNING_FACES) {
                    notify.warning(`Mesh has ${faceCount.toLocaleString()} faces. A display proxy is recommended for broad device support.`);
                } else if (faceCount > MESH_LOD.MOBILE_WARNING_FACES) {
                    notify.info(`Mesh has ${faceCount.toLocaleString()} faces — may not display on mobile/tablet. Consider adding a display proxy.`);
                }
                // Auto center-align if splat is already loaded, otherwise center on grid
                // Skip when loading from an archive — saved transforms must be preserved
                if (!state.archiveLoaded) {
                    if (state.splatLoaded) {
                        setTimeout(() => autoCenterAlign(), TIMING.AUTO_ALIGN_DELAY);
                    } else {
                        // Center model on grid when loaded standalone
                        setTimeout(() => centerModelOnGrid(modelGroup), TIMING.AUTO_ALIGN_DELAY);
                    }
                    clearArchiveMetadata();
                }
                updatePronomRegistry(state);
            },
            onSTLLoaded: (object: any, file: any, _faceCount: number) => {
                // Switch to STL display mode
                setDisplayMode('stl');
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();
                updateObjectSelectButtons();
                const filenameEl = document.getElementById('stl-filename');
                if (filenameEl) filenameEl.textContent = file.name || 'STL loaded';
                // Center STL on grid
                setTimeout(() => centerModelOnGrid(stlGroup), TIMING.AUTO_ALIGN_DELAY);
                updatePronomRegistry(state);
                enableRemoveBtn('btn-remove-stl', true);
            },
            onDrawingLoaded: (object: any, file: any) => {
                updateVisibility();
                updateObjectSelectButtons();
                const filenameEl = document.getElementById('drawing-filename');
                if (filenameEl) filenameEl.textContent = file.name || 'DXF loaded';
                // Center drawing on grid
                setTimeout(() => centerModelOnGrid(drawingGroup), TIMING.AUTO_ALIGN_DELAY);
                enableRemoveBtn('btn-remove-drawing', true);
            }
        }
    };
}

// Helper function to create dependencies object for alignment.js
function createAlignmentDeps(): EditorAlignmentDeps {
    return {
        splatMesh,
        modelGroup,
        pointcloudGroup,
        camera,
        controls,
        state,
        showLoading,
        hideLoading,
        updateTransformInputs,
        storeLastPositions,
        initialPosition: CAMERA.INITIAL_POSITION
    };
}

// Helper function to create dependencies object for annotation-controller.js
function createAnnotationControllerDeps(): AnnotationControllerDeps {
    return {
        annotationSystem,
        showAnnotationPopup: (annotation: any) => {
            const id = showAnnotationPopupHandler(annotation, state.imageAssets);
            updateAnnotationPopupPositionHandler(id);
            return id;
        },
        hideAnnotationPopup: () => {
            hideAnnotationPopupHandler();
        }
    };
}

// Helper function to create dependencies object for metadata-manager.js
function createMetadataDeps(): MetadataDeps {
    return {
        state,
        annotationSystem,
        imageAssets: state.imageAssets,
        currentSplatBlob: assets.splatBlob,
        currentMeshBlob: assets.meshBlob,
        currentPointcloudBlob: assets.pointcloudBlob,
        updateAnnotationsList: updateSidebarAnnotationsList,
        onAddAnnotation: toggleAnnotationMode,
        onUpdateAnnotationCamera: updateSelectedAnnotationCamera,
        onDeleteAnnotation: deleteSelectedAnnotation,
        onAnnotationUpdated: () => { updateAnnotationsUI(); updateSidebarAnnotationsList(); },
        getCameraState: () => ({
            position: {
                x: parseFloat(camera.position.x.toFixed(4)),
                y: parseFloat(camera.position.y.toFixed(4)),
                z: parseFloat(camera.position.z.toFixed(4))
            },
            target: {
                x: parseFloat(controls.target.x.toFixed(4)),
                y: parseFloat(controls.target.y.toFixed(4)),
                z: parseFloat(controls.target.z.toFixed(4))
            }
        }),
        getControls: () => ({ controls, camera }),
    };
}

// Helper function to create dependencies object for export-controller.ts
function createExportDeps(): ExportDeps {
    return {
        sceneRefs,
        state,
        tauriBridge,
        ui: {
            showLoading,
            hideLoading,
            updateProgress,
            hideExportPanel,
            showExportPanelHandler,
            showMetadataPanel
        },
        metadata: {
            collectMetadata,
            prefillMetadataFromArchive,
            populateMetadataDisplay,
            loadAnnotationsFromArchive
        }
    };
}

// Helper function to create dependencies object for archive-pipeline.ts
function createArchivePipelineDeps(): ArchivePipelineDeps {
    return {
        sceneRefs,
        state,
        sceneManager,
        setSplatMesh: (mesh: any) => { splatMesh = mesh; },
        createFileHandlerDeps,
        ui: {
            showLoading,
            hideLoading,
            updateProgress,
            showInlineLoading,
            hideInlineLoading,
            updateVisibility,
            updateTransformInputs,
            updateModelOpacity,
            updateModelWireframe
        },
        alignment: {
            applyAlignmentData,
            storeLastPositions
        },
        annotations: {
            loadAnnotationsFromArchive
        },
        metadata: {
            prefillMetadataFromArchive,
            clearArchiveMetadataHandler
        },
        sourceFiles: {
            updateSourceFilesUI
        },
        measurementSystem,
        renderFlightPaths: async () => {
            if (!flightPathManager) return;
            const fpStore = getStore();
            for (const fp of fpStore.flightPathBlobs) {
                try {
                    const ext = fp.fileName.split('.').pop()?.toLowerCase() || '';
                    let data;
                    if (ext === 'txt') {
                        const buffer = await fp.blob.arrayBuffer();
                        data = await flightPathManager.importBinary(buffer, fp.fileName, 'dji-txt');
                    } else {
                        const text = await fp.blob.text();
                        data = flightPathManager.importFromText(text, fp.fileName);
                    }
                    // Restore trim from blob store
                    if (data && (fp.trimStart !== undefined || fp.trimEnd !== undefined)) {
                        flightPathManager.setTrim(data.id,
                            fp.trimStart ?? 0,
                            fp.trimEnd ?? (data.points.length - 1)
                        );
                    }
                } catch (err) {
                    console.warn('[main] Failed to parse flight path:', fp.fileName, err);
                }
            }
            if (flightPathManager.hasData) {
                // Restore transform from manifest (round-trip preservation)
                if (state.archiveLoader) {
                    const fpEntries = state.archiveLoader.getFlightPathEntries();
                    if (fpEntries.length > 0) {
                        const t = state.archiveLoader.getEntryTransform(fpEntries[0].entry);
                        const group = sceneManager?.flightPathGroup;
                        if (group && (t.position.some((v: number) => v !== 0) ||
                            t.rotation.some((v: number) => v !== 0) ||
                            (typeof t.scale === 'number' ? t.scale : 1) !== 1)) {
                            group.position.fromArray(t.position);
                            group.rotation.set(...(t.rotation as [number, number, number]));
                            const s = typeof t.scale === 'number' ? t.scale : 1;
                            group.scale.setScalar(s);
                        }
                    }
                }
                // Apply settings from prefilled UI (set by prefillMetadataFromArchive)
                const colorModeEl = document.getElementById('flight-color-mode') as HTMLSelectElement | null;
                const endpointsEl = document.getElementById('flight-show-endpoints') as HTMLInputElement | null;
                const directionEl = document.getElementById('flight-show-direction') as HTMLInputElement | null;
                flightPathManager.applySettings({
                    colorMode: colorModeEl?.value || 'speed',
                    showEndpoints: endpointsEl?.checked ?? true,
                    showDirection: directionEl?.checked ?? true,
                });
                // Apply view defaults: visibility, line styling, marker density
                flightPathManager.setVisible(state.viewDefaults.flightPath.visible);
                if (flightPathManager.setLineOpacity) flightPathManager.setLineOpacity(state.viewDefaults.flightPath.lineOpacity);
                if (flightPathManager.setMarkerDensity) {
                    const density = state.viewDefaults.flightPath.showMarkers ? state.viewDefaults.flightPath.markerDensity : 'off';
                    flightPathManager.setMarkerDensity(density);
                }
                state.flightPathLoaded = true;
                updateObjectSelectButtons();
                updateFlightPathUI();
                updateColmapUI();
                updateOverlayPill({ sfm: state.colmapLoaded, flightpath: state.flightPathLoaded });
                // Sync overlay pill button to view default
                const fpPillBtn = document.getElementById('btn-overlay-flightpath');
                if (fpPillBtn) fpPillBtn.classList.toggle('active', state.viewDefaults.flightPath.visible);
            }
        },
        colmap: {
            loadFromBuffers: (camerasBuffer: ArrayBuffer, imagesBuffer: ArrayBuffer) => {
                if (!colmapManager) return;
                colmapManager.loadFromBuffers(camerasBuffer, imagesBuffer);
                state.colmapLoaded = true;
                updateObjectSelectButtons();
                updateColmapUI();
            },
            loadPoints3D: (positions: Float64Array, count: number) => {
                colmapManager?.loadPoints3D(positions, count);
            },
            get points3DBuffer() { return colmapManager?.points3DBuffer ?? null; },
            set points3DBuffer(buf: ArrayBuffer | null) { if (colmapManager) colmapManager.points3DBuffer = buf; },
        },
    };
}

// Helper function to create dependencies object for file-input-handlers.ts
function createCADDeps(): LoadCADDeps {
    return {
        cadGroup,
        state,
        showLoading,
        hideLoading,
        onLoaded: () => {
            updateTransformInputs();
            storeLastPositions();
            updateObjectSelectButtons();
            enableRemoveBtn('btn-remove-cad', true);
        },
    };
}

function createFileInputDeps(): FileInputDeps {
    return {
        validateUserUrl, state, sceneManager, tauriBridge, assets,
        createFileHandlerDeps, createPointcloudDeps, createArchivePipelineDeps,
        createCADDeps,
        loadArchiveFromUrl, processArchive,
        showLoading, hideLoading, updateProgress, formatFileSize, updateSourceFilesUI
    };
}

// Helper function to create dependencies object for event-wiring.ts
function createEventWiringDeps(): EventWiringDeps {
    return {
        sceneRefs,
        state,
        sceneManager,
        files: {
            handleSplatFile, handleModelFile, handleArchiveFile,
            handlePointcloudFile, handleProxyMeshFile, handleProxySplatFile,
            handleSTLFile, handleCADFile, handleDrawingFile, handleSourceFilesInput,
            handleLoadArchiveFromUrlPrompt,
            handleLoadFullResMesh, switchQualityTier,
            removeSplat, removeModel, removePointcloud, removeSTL, removeCAD, removeDrawing, removeFlightPath
        },
        display: {
            setDisplayMode, updateModelOpacity, updateModelWireframe,
            updateModelMatcap, updateModelNormals, updateModelRoughnessView,
            updateModelMetalnessView, updateModelSpecularF0View,
            toggleGridlines, setBackgroundColor
        },
        camera: { resetCamera, fitToView, resetOrbitCenter, toggleFlyMode },
        alignment: { resetAlignment, toggleAlignment, centerAtOrigin },
        annotations: {
            toggleAnnotationMode, saveAnnotation, cancelAnnotation,
            updateSelectedAnnotationCamera, deleteSelectedAnnotation,
            dismissPopup: () => dismissPopupHandler(createAnnotationControllerDeps())
        },
        export: { showExportPanel, downloadArchive, saveToLibrary },
        screenshots: { downloadScreenshot, captureScreenshotToList, showViewfinder, captureManualPreview, hideViewfinder },
        recording: { startRecording: handleStartRecording, stopRecording: handleStopRecording },
        metadata: { hideMetadataPanel, toggleMetadataDisplay, setupMetadataSidebar, populateMetadataDisplay },
        transform: { setSelectedObject, setTransformMode, resetTransform, updateTransformInputs },
        crossSection: crossSection!,
        walkthrough: {
            addStop: wtAddStop,
            addStopFromAnnotation: wtAddStopFromAnnotation,
            deleteStop: wtDeleteStop,
            updateStopCamera: wtUpdateStopCamera,
            playPreview: wtPlayPreview,
            stopPreview: wtStopPreview,
        },
        tauri: {
            wireNativeDialogsIfAvailable: () => {
                if (window.__TAURI__ && tauriBridge) {
                    wireNativeFileDialogs();
                } else if (window.__TAURI__) {
                    import('./modules/tauri-bridge.js').then((mod: any) => {
                        tauriBridge = mod;
                        wireNativeFileDialogs();
                    }).catch(() => {});
                }
            }
        },
        undo: {
            performUndo,
            performRedo,
            captureBeforeNumericEdit: () => {
                _numericEditBefore = captureTransformMatrices();
            },
            pushAfterNumericEdit: () => {
                if (_numericEditBefore) {
                    const after = captureTransformMatrices();
                    undoManager.push({
                        objectId: state.selectedObject,
                        beforeMatrices: _numericEditBefore,
                        afterMatrices: after,
                    });
                    _numericEditBefore = null;
                }
            },
        },
        colmap: {
            loadFromBuffers: (camerasBuffer: ArrayBuffer, imagesBuffer: ArrayBuffer) => {
                if (!colmapManager) return;
                colmapManager.loadFromBuffers(camerasBuffer, imagesBuffer);
                // Store blobs for archive export
                const assets = getStore();
                assets.colmapBlobs.push({
                    camerasBlob: new Blob([camerasBuffer]),
                    imagesBlob: new Blob([imagesBuffer]),
                });
                // Restore saved transform from archive if available; otherwise copy
                // the splat's current transform (initial import — cameras share splat space).
                const colmapGrp = sceneManager?.colmapGroup;
                if (colmapGrp) {
                    const manifest = state.archiveManifest as any;
                    const colmapEntry = manifest?.data_entries &&
                        Object.values(manifest.data_entries).find((e: any) => e.role === 'colmap_sfm');
                    const params = (colmapEntry as any)?._parameters;
                    if (params?.position || params?.rotation || params?.scale != null) {
                        if (params.position) colmapGrp.position.set(...(params.position as [number, number, number]));
                        if (params.rotation) colmapGrp.rotation.set(...(params.rotation as [number, number, number]));
                        if (params.scale != null) colmapGrp.scale.setScalar(typeof params.scale === 'number' ? params.scale : 1);
                    } else if (splatMesh) {
                        colmapGrp.position.copy(splatMesh.position);
                        colmapGrp.rotation.copy(splatMesh.rotation);
                        colmapGrp.scale.copy(splatMesh.scale);
                    }
                }
                state.colmapLoaded = true;
                // Apply view defaults: visibility and display mode
                const colmapGrpVis = sceneManager?.colmapGroup;
                if (colmapGrpVis) colmapGrpVis.visible = state.viewDefaults.sfmCameras.visible;
                if (colmapManager) colmapManager.setDisplayMode(state.viewDefaults.sfmCameras.displayMode);
                updateObjectSelectButtons();
                updateColmapUI();
                storeLastPositions();
                updateTransformInputs();
                updateOverlayPill({ sfm: state.colmapLoaded, flightpath: state.flightPathLoaded });
                // Sync overlay pill button to view default
                const sfmPillBtn = document.getElementById('btn-overlay-sfm');
                if (sfmPillBtn) sfmPillBtn.classList.toggle('active', state.viewDefaults.sfmCameras.visible);
            },
            setDisplayMode: (mode: string) => colmapManager?.setDisplayMode(mode as any),
            setFrustumScale: (scale: number) => colmapManager?.setFrustumScale(scale),
            alignFlightPath: () => {
                if (!colmapManager?.hasData || !flightPathManager?.hasData) return;
                const fpGroup = sceneManager?.flightPathGroup;
                if (!fpGroup) return;
                fpGroup.updateMatrixWorld(true);
                const result = alignCamerasToFlightPath(
                    colmapManager.colmapCameras,
                    flightPathManager.getAllPoints(),
                    fpGroup.matrixWorld,
                );
                if (!result) {
                    notify.error('Could not align: insufficient matches (need >= 3)');
                    return;
                }
                const group = sceneManager?.colmapGroup;
                if (group) {
                    group.position.copy(result.position);
                    group.rotation.copy(result.rotation);
                    group.scale.setScalar(result.scale);
                    updateTransformInputs();
                    storeLastPositions();
                }
                const el = document.getElementById('align-result');
                if (el) {
                    el.style.display = '';
                    el.textContent = `Aligned: ${result.matchCount} matches, RMSE ${result.rmse.toFixed(3)}`;
                }
                if (result.rmse > 1.0) {
                    notify.warning(`Alignment RMSE is high (${result.rmse.toFixed(2)}). Verify match quality.`);
                } else {
                    notify.success(`Cameras aligned to flight path (${result.matchCount} matches, RMSE: ${result.rmse.toFixed(3)})`);
                }
            },
            get hasData() { return colmapManager?.hasData ?? false; },
            get hasPoints3D() { return colmapManager?.hasPoints3D ?? false; },
            loadPoints3D: (positions: Float64Array, count: number) => {
                colmapManager?.loadPoints3D(positions, count);
            },
            get points3DBuffer() { return colmapManager?.points3DBuffer ?? null; },
            set points3DBuffer(buf: ArrayBuffer | null) {
                if (colmapManager) colmapManager.points3DBuffer = buf;
                // Also store in asset store for export
                const assets = getStore();
                if (assets.colmapBlobs.length > 0 && buf) {
                    assets.colmapBlobs[assets.colmapBlobs.length - 1].points3DBuffer = buf;
                }
            },
            alignFromCameraData: async () => {
                console.log('[ICP-DEBUG] alignFromCameraData called, hasPoints3D:', colmapManager?.hasPoints3D, 'splatMesh:', !!splatMesh);
                if (!colmapManager?.hasPoints3D || !splatMesh) {
                    notify.error('Load splat + camera data first');
                    return;
                }

                showLoading('Auto-aligning from camera data...');

                try {
                    const splatSample = sampleSplatPoints(splatMesh);
                    if (!splatSample) {
                        notify.error('Could not sample splat points');
                        return;
                    }

                    const points3D = colmapManager.points3D!;
                    const points3DCount = colmapManager.points3DCount;

                    // Diagnostic: log point cloud stats
                    {
                        const logStats = (name: string, pts: Float64Array, count: number) => {
                            let cx = 0, cy = 0, cz = 0;
                            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
                            for (let i = 0; i < count; i++) {
                                const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
                                cx += x; cy += y; cz += z;
                                if (x < minX) minX = x; if (x > maxX) maxX = x;
                                if (y < minY) minY = y; if (y > maxY) maxY = y;
                                if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
                            }
                            cx /= count; cy /= count; cz /= count;
                            console.log(`[ICP-DEBUG] ${name}: count=${count}, centroid=(${cx.toFixed(3)}, ${cy.toFixed(3)}, ${cz.toFixed(3)}), ` +
                                `extent=(${(maxX-minX).toFixed(3)}, ${(maxY-minY).toFixed(3)}, ${(maxZ-minZ).toFixed(3)}), ` +
                                `range X=[${minX.toFixed(3)},${maxX.toFixed(3)}] Y=[${minY.toFixed(3)},${maxY.toFixed(3)}] Z=[${minZ.toFixed(3)},${maxZ.toFixed(3)}]`);
                        };
                        logStats('points3D (source)', points3D, points3DCount);
                        logStats('splatSample (target)', splatSample.points, splatSample.count);
                        console.log(`[ICP-DEBUG] splatMesh.matrixWorld:`, splatMesh.matrixWorld.elements.map(v => v.toFixed(4)).join(', '));
                    }

                    // Pre-transform points3D by colmapGroup's current transform (copied
                    // from splatMesh on load).  This puts them approximately into world
                    // space so the ICP only needs to find a small correction (e.g. the
                    // rotation baked in by Supersplat), not the entire transform chain.
                    const colmapGrp = sceneManager?.colmapGroup;
                    let preTransformedPts = points3D;
                    let initialMatrix: THREE.Matrix4 | null = null;

                    if (colmapGrp) {
                        colmapGrp.updateMatrixWorld(true);
                        initialMatrix = colmapGrp.matrixWorld.clone();
                        preTransformedPts = new Float64Array(points3DCount * 3);
                        for (let i = 0; i < points3DCount; i++) {
                            const v = new THREE.Vector3(
                                points3D[i * 3], points3D[i * 3 + 1], points3D[i * 3 + 2]
                            ).applyMatrix4(initialMatrix);
                            preTransformedPts[i * 3] = v.x;
                            preTransformedPts[i * 3 + 1] = v.y;
                            preTransformedPts[i * 3 + 2] = v.z;
                        }
                        console.log('[ICP-DEBUG] Pre-transformed points3D by colmapGroup matrix');
                    }

                    const icpResult = runICP(preTransformedPts, points3DCount, splatSample.points, splatSample.count,
                        initialMatrix ? { skipCoarseSearch: true } : undefined);
                    if (!icpResult) {
                        notify.error('Alignment failed — insufficient point overlap');
                        return;
                    }

                    // Diagnostic: log ICP result
                    {
                        const euler = new THREE.Euler().setFromQuaternion(icpResult.rotation);
                        console.log(`[ICP-DEBUG] Result: scale=${icpResult.scale.toFixed(6)}, RMSE=${icpResult.rmse.toFixed(6)}, matches=${icpResult.matchCount}, converged=${icpResult.converged}`);
                        console.log(`[ICP-DEBUG] Rotation (deg): X=${THREE.MathUtils.radToDeg(euler.x).toFixed(2)}, Y=${THREE.MathUtils.radToDeg(euler.y).toFixed(2)}, Z=${THREE.MathUtils.radToDeg(euler.z).toFixed(2)}`);
                        console.log(`[ICP-DEBUG] Translation: (${icpResult.translation.x.toFixed(4)}, ${icpResult.translation.y.toFixed(4)}, ${icpResult.translation.z.toFixed(4)})`);
                    }

                    // Compose: final = ICP_correction × initial_transform
                    if (colmapGrp) {
                        const correctionMatrix = new THREE.Matrix4().compose(
                            icpResult.translation,
                            icpResult.rotation,
                            new THREE.Vector3(icpResult.scale, icpResult.scale, icpResult.scale)
                        );
                        const finalMatrix = correctionMatrix.multiply(initialMatrix ?? new THREE.Matrix4());

                        const pos = new THREE.Vector3();
                        const rot = new THREE.Quaternion();
                        const scl = new THREE.Vector3();
                        finalMatrix.decompose(pos, rot, scl);

                        colmapGrp.position.copy(pos);
                        colmapGrp.quaternion.copy(rot);
                        colmapGrp.scale.copy(scl);
                        colmapGrp.updateMatrix();
                        colmapGrp.updateMatrixWorld(true);
                    }

                    if (flightPathManager?.hasData && colmapManager.colmapCameras.length >= 3) {
                        const fpGroup = sceneManager?.flightPathGroup;
                        if (fpGroup) {
                            const matchedPairs = matchCamerasToFlightPoints(
                                colmapManager.colmapCameras,
                                flightPathManager.getAllPoints()
                            );

                            if (matchedPairs.length >= 3) {
                                const gpsSlice = matchedPairs.map(p => p.gpsPos);
                                const colmapSlice = matchedPairs.map(p => p.colmapPos);

                                const tGeo = computeSimilarityTransform(gpsSlice, colmapSlice);
                                if (tGeo) {
                                    const composedQ = icpResult.rotation.clone().multiply(tGeo.rotation);
                                    const composedScale = icpResult.scale * tGeo.scale;
                                    const composedT = tGeo.translation.clone()
                                        .applyQuaternion(icpResult.rotation)
                                        .multiplyScalar(icpResult.scale)
                                        .add(icpResult.translation);

                                    fpGroup.quaternion.copy(composedQ);
                                    fpGroup.scale.setScalar(composedScale);
                                    fpGroup.position.copy(composedT);
                                    fpGroup.updateMatrix();
                                    fpGroup.updateMatrixWorld(true);

                                    notify.success(`Aligned camera data + flight path — RMSE: ${icpResult.rmse.toFixed(3)}`);
                                } else {
                                    notify.success(`Aligned camera data — RMSE: ${icpResult.rmse.toFixed(3)}`);
                                    notify.warning('Flight path alignment failed (insufficient GPS↔camera matches)');
                                }
                            } else {
                                notify.success(`Aligned camera data — RMSE: ${icpResult.rmse.toFixed(3)}`);
                                notify.warning('Flight path: insufficient camera↔GPS matches (need >= 3)');
                            }
                        }
                    } else {
                        notify.success(`Aligned camera data — RMSE: ${icpResult.rmse.toFixed(3)}, ${icpResult.matchCount} matches`);
                    }

                    const resultEl = document.getElementById('icp-align-result');
                    if (resultEl) {
                        resultEl.style.display = '';
                        resultEl.textContent = `RMSE: ${icpResult.rmse.toFixed(3)} | ${icpResult.matchCount} matches | ${icpResult.converged ? 'converged' : 'max iter'}`;
                    }

                    updateTransformInputs();
                    storeLastPositions();
                } catch (err) {
                    log.error('Alignment failed:', err);
                    notify.error('Alignment failed — see console for details');
                } finally {
                    hideLoading();
                }
            },
        },
        overlay: {
            toggleSfm: (visible: boolean) => {
                const colmapGroup = sceneManager?.colmapGroup;
                if (colmapGroup) colmapGroup.visible = visible;
            },
            toggleFlightPath: (visible: boolean) => {
                if (flightPathManager) flightPathManager.setVisible(visible);
            },
        },
        validateUrl: validateUserUrl,
    };
}

/** Wire up the SD Proxy / Decimation panel events. */
function setupDecimationPanel(): void {
    const presetSelect = document.getElementById('decimation-preset') as HTMLSelectElement | null;
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
    const dracoInput = document.getElementById('decimation-draco') as HTMLInputElement | null;
    const generateBtn = document.getElementById('btn-generate-proxy') as HTMLButtonElement | null;
    const statusDiv = document.getElementById('decimation-status');
    const statusText = document.getElementById('decimation-status-text');
    const progressDiv = document.getElementById('decimation-progress');
    const progressFill = document.getElementById('decimation-progress-fill');
    const progressText = document.getElementById('decimation-progress-text');
    const previewBtn = document.getElementById('btn-preview-proxy');
    const _removeBtn = document.getElementById('btn-remove-proxy');

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
            dracoCompress: dracoInput?.checked ?? true,
        };
    }

    function updateEstimate(): void {
        const hdFaces = state.meshFaceCount || 0;
        if (!hdFaces || !sdFacesEl) return;
        const opts = readOptionsFromUI();
        const est = estimateFaceCount(hdFaces, opts);
        sdFacesEl.textContent = est.toLocaleString();
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

    // Collapsible subsections
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

    // Preset change
    presetSelect?.addEventListener('change', () => {
        const key = presetSelect.value;
        if (key !== 'custom') applyPresetToUI(key);
        updateEstimate();
    });

    // Advanced field changes -> switch to Custom
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

    // Texture quality label
    texQualityInput?.addEventListener('input', () => {
        if (texQualityLabel) texQualityLabel.textContent = `${Math.round(parseFloat(texQualityInput.value) * 100)}%`;
    });

    // Splat LOD checkbox
    const splatLodCheckbox = document.getElementById('chk-splat-lod') as HTMLInputElement | null;
    if (splatLodCheckbox) {
        splatLodCheckbox.checked = state.splatLodEnabled;
        splatLodCheckbox.addEventListener('change', () => {
            state.splatLodEnabled = splatLodCheckbox.checked;
        });
    }

    // Generate SD Proxy
    addListener('btn-generate-proxy', 'click', async () => {
        if (!modelGroup || !state.modelLoaded) {
            notify.warning('No mesh loaded to decimate');
            return;
        }

        progressDiv?.classList.remove('hidden');
        statusDiv?.classList.add('hidden');
        if (generateBtn) generateBtn.disabled = true;

        try {
            const userOpts = readOptionsFromUI();
            const result = await generateProxy(modelGroup, userOpts, (stage, pct) => {
                if (progressFill) (progressFill as HTMLElement).style.width = `${pct}%`;
                if (progressText) progressText.textContent = stage;
            });

            // Store result
            const assets = getStore();
            assets.proxyMeshBlob = result.blob;
            state.proxyMeshSettings = result.options;
            state.proxyMeshFaceCount = result.faceCount;

            // Update proxy filename so export-controller uses a valid .glb extension
            const proxyFilenameEl = document.getElementById('proxy-mesh-filename');
            if (proxyFilenameEl) proxyFilenameEl.textContent = 'mesh_proxy.glb';

            // Clean up old proxy preview
            if (state.proxyMeshGroup) {
                scene.remove(state.proxyMeshGroup);
                disposeObject(state.proxyMeshGroup);
                state.proxyMeshGroup = null;
            }

            // Load the decimated GLB as a preview group
            const blobUrl = URL.createObjectURL(result.blob);
            try {
                const { loadGLTF } = await import('./modules/file-handlers.js');
                const loaded = await loadGLTF(blobUrl);
                state.proxyMeshGroup = loaded;
                // Copy transform from full-res model (proxy GLB is in local space)
                if (modelGroup) {
                    loaded.position.copy(modelGroup.position);
                    loaded.rotation.copy(modelGroup.rotation);
                    loaded.scale.copy(modelGroup.scale);
                }
                state.proxyMeshGroup.visible = false;
                scene.add(state.proxyMeshGroup);
            } finally {
                URL.revokeObjectURL(blobUrl);
            }

            // Update UI
            if (statusText) statusText.textContent = `Proxy ready (${result.faceCount.toLocaleString()} faces, ${(result.blob.size / 1024 / 1024).toFixed(1)} MB)`;
            statusDiv?.classList.remove('hidden');
            if (previewBtn) previewBtn.textContent = 'Preview SD';
            showQualityToggleIfNeeded();
            notify.success(`SD proxy generated: ${result.faceCount.toLocaleString()} faces`);
        } catch (err: any) {
            log.error('Decimation failed:', err);
            notify.error(`Decimation failed: ${err.message}`);
        } finally {
            progressDiv?.classList.add('hidden');
            if (generateBtn) generateBtn.disabled = false;
        }
    });

    // Preview toggle
    addListener('btn-preview-proxy', 'click', () => {
        if (!state.proxyMeshGroup || !modelGroup) return;
        const showingProxy = state.proxyMeshGroup.visible;
        if (showingProxy) {
            state.proxyMeshGroup.visible = false;
            modelGroup.visible = true;
            if (previewBtn) previewBtn.textContent = 'Preview SD';
        } else {
            state.proxyMeshGroup.visible = true;
            modelGroup.visible = false;
            if (previewBtn) previewBtn.textContent = 'Preview HD';
        }
    });

    // Remove proxy
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
        state.viewingProxy = false;
        updateQualityButtonStates('hd');
        statusDiv?.classList.add('hidden');
        showQualityToggleIfNeeded();
        notify.info('SD proxy removed');
    });

    // ── HD Web Optimization ──
    // Web-opt mode toggle — switch between face count and ratio inputs
    const webOptModeSelect = document.getElementById('web-opt-mode') as HTMLSelectElement | null;
    const webOptFacesRow = document.getElementById('web-opt-faces-row');
    const webOptRatioRow = document.getElementById('web-opt-ratio-row');
    const webOptRatioInput = document.getElementById('web-opt-target-ratio') as HTMLInputElement | null;
    const webOptRatioEstimate = document.getElementById('web-opt-ratio-estimate');
    if (webOptModeSelect) {
        webOptModeSelect.addEventListener('change', () => {
            const isRatio = webOptModeSelect.value === 'ratio';
            if (webOptFacesRow) webOptFacesRow.style.display = isRatio ? 'none' : '';
            if (webOptRatioRow) webOptRatioRow.style.display = isRatio ? '' : 'none';
            // Update estimate when switching to ratio
            if (isRatio && webOptRatioInput && webOptRatioEstimate && state.meshFaceCount > 0) {
                const est = Math.round(state.meshFaceCount * parseFloat(webOptRatioInput.value));
                webOptRatioEstimate.textContent = `~${est.toLocaleString()} faces`;
            }
        });
    }
    if (webOptRatioInput && webOptRatioEstimate) {
        webOptRatioInput.addEventListener('input', () => {
            if (state.meshFaceCount > 0) {
                const est = Math.round(state.meshFaceCount * parseFloat(webOptRatioInput.value));
                webOptRatioEstimate.textContent = `~${est.toLocaleString()} faces`;
            }
        });
    }

    addListener('btn-web-opt-generate', 'click', async () => {
        const assets = getStore();
        if (!modelGroup || !assets.meshBlob) {
            notify.warning('No mesh loaded');
            return;
        }

        const modeEl = document.getElementById('web-opt-mode') as HTMLSelectElement | null;
        const targetFacesEl = document.getElementById('web-opt-target-faces') as HTMLInputElement;
        const targetRatioEl = document.getElementById('web-opt-target-ratio') as HTMLInputElement;
        const dracoEl = document.getElementById('web-opt-draco') as HTMLInputElement;
        const dracoEnabled = dracoEl?.checked ?? true;
        const mode = modeEl?.value || 'faces';

        let targetFaces: number;
        let targetRatio: number;

        if (mode === 'ratio') {
            targetRatio = parseFloat(targetRatioEl?.value || '0.5');
            if (targetRatio <= 0 || targetRatio >= 1) {
                notify.warning('Target ratio must be between 0 and 1');
                return;
            }
            targetFaces = Math.round(state.meshFaceCount * targetRatio);
        } else {
            targetFaces = parseInt(targetFacesEl?.value || '1000000', 10);
            if (targetFaces >= state.meshFaceCount) {
                notify.warning('Target face count must be less than current faces');
                return;
            }
            targetRatio = targetFaces / state.meshFaceCount;
        }

        // Save originals for revert (only if not already optimized).
        // Clone must happen before decimation which disposes geometry/material refs.
        // We re-load from the original blob on revert to guarantee fresh GPU data.
        if (!state.meshOptimized) {
            state.originalMeshBlob = assets.meshBlob;
        }

        // Show progress
        const progressEl = document.getElementById('web-opt-progress');
        const progressFill = document.getElementById('web-opt-progress-fill') as HTMLElement;
        const progressText = document.getElementById('web-opt-progress-text');
        if (progressEl) progressEl.classList.remove('hidden');

        const btnGenerate = document.getElementById('btn-web-opt-generate') as HTMLButtonElement;
        if (btnGenerate) btnGenerate.disabled = true;

        try {
            showLoading('Optimizing mesh...');

            const { decimateScene, exportAsGLB, dracoCompressGLB } = await import('./modules/mesh-decimator.js');

            // Decimation options
            const result = await decimateScene(modelGroup, {
                targetRatio: Math.min(targetRatio, 1),
                targetFaceCount: targetFaces,
                errorThreshold: 0.1,
                lockBorder: true,
                preserveUVSeams: true,
                textureMaxRes: 4096,
                textureFormat: 'keep',
                textureQuality: 1.0,
                dracoCompress: false,
                preset: 'custom',
            }, (stage: string, pct: number) => {
                if (progressFill) progressFill.style.width = `${pct * 100}%`;
                if (progressText) progressText.textContent = stage;
            });

            // Export as GLB blob (with or without Draco)
            let blob = await exportAsGLB(result.group, false);
            if (dracoEnabled) {
                if (progressText) progressText.textContent = 'Applying Draco compression...';
                blob = await dracoCompressGLB(blob);
            }

            // Replace the displayed mesh
            while (modelGroup.children.length > 0) {
                const child = modelGroup.children[0];
                modelGroup.remove(child);
                if ((child as any).geometry) (child as any).geometry.dispose();
                if ((child as any).material) {
                    const mat = (child as any).material;
                    if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose());
                    else mat.dispose();
                }
            }
            for (const child of result.group.children) {
                modelGroup.add(child.clone(true));
            }

            // Update blob reference for export
            assets.meshBlob = blob;

            // Update state
            state.meshOptimized = true;
            state.meshOptimizationSettings = {
                targetFaces,
                dracoEnabled,
                originalFaces: result.totalOriginalFaces || state.meshFaceCount,
                resultFaces: result.totalNewFaces,
            };
            state.meshFaceCount = result.totalNewFaces;

            // Update UI
            const statusEl = document.getElementById('web-opt-status');
            if (statusEl) {
                statusEl.textContent = `Optimized: ${result.totalNewFaces.toLocaleString()} faces`;
                statusEl.classList.remove('hidden');
            }
            const revertBtn = document.getElementById('btn-web-opt-revert');
            if (revertBtn) revertBtn.classList.remove('hidden');

            const webOptFaces = document.getElementById('web-opt-current-faces');
            if (webOptFaces) {
                webOptFaces.textContent = `Original: ${state.meshOptimizationSettings.originalFaces.toLocaleString()} faces`;
            }

            // Also update the SD proxy HD face count display
            const hdFacesEl = document.getElementById('decimation-hd-faces');
            if (hdFacesEl) hdFacesEl.textContent = result.totalNewFaces.toLocaleString();

            notify.success(`Mesh optimized to ${result.totalNewFaces.toLocaleString()} faces`);
        } catch (err) {
            log.error('Web optimization failed:', err);
            notify.error('Mesh optimization failed: ' + (err as Error).message);
        } finally {
            hideLoading();
            if (progressEl) progressEl.classList.add('hidden');
            if (btnGenerate) btnGenerate.disabled = false;
        }
    });

    addListener('btn-web-opt-revert', 'click', async () => {
        const assets = getStore();
        if (!state.originalMeshBlob) {
            notify.warning('No original mesh to revert to');
            return;
        }

        try {
            showLoading('Reverting to original mesh...');

            // Re-load the original mesh from the saved blob (guarantees fresh GPU data)
            const { loadGLTF } = await import('./modules/loaders/mesh-loader.js');
            const blobUrl = URL.createObjectURL(state.originalMeshBlob);

            // Clear current decimated mesh
            while (modelGroup.children.length > 0) {
                const child = modelGroup.children[0];
                disposeObject(child);
                modelGroup.remove(child);
            }

            // Determine format from blob type or state
            const ext = (state.meshFormat || 'glb').toLowerCase();
            let loadedObject: THREE.Object3D;
            if (ext === 'obj') {
                const { loadOBJFromUrl } = await import('./modules/loaders/mesh-loader.js');
                loadedObject = await loadOBJFromUrl(blobUrl);
            } else {
                loadedObject = await loadGLTF(blobUrl);
            }
            URL.revokeObjectURL(blobUrl);

            modelGroup.add(loadedObject);

            // Restore blob
            assets.meshBlob = state.originalMeshBlob;

            // Restore face count
            const originalFaces = state.meshOptimizationSettings?.originalFaces ?? 0;
            state.meshFaceCount = originalFaces;

            // Clear optimization state
            state.meshOptimized = false;
            state.meshOptimizationSettings = null;
            state.originalMeshBlob = null;

            // Update UI
            const statusEl = document.getElementById('web-opt-status');
            if (statusEl) statusEl.classList.add('hidden');
            const revertBtn = document.getElementById('btn-web-opt-revert');
            if (revertBtn) revertBtn.classList.add('hidden');
            const webOptFaces = document.getElementById('web-opt-current-faces');
            if (webOptFaces) webOptFaces.textContent = `Current faces: ${originalFaces.toLocaleString()}`;

            // Update SD proxy face count display
            const hdFacesEl = document.getElementById('decimation-hd-faces');
            if (hdFacesEl) hdFacesEl.textContent = originalFaces.toLocaleString();

            notify.success('Reverted to original mesh');
        } catch (err) {
            log.error('Revert failed:', err);
            notify.error('Revert failed: ' + (err as Error).message);
        } finally {
            hideLoading();
        }
    });
}

// Initialize the scene
async function init() {
    log.info(' init() starting...');

    // Verify required DOM elements
    if (!canvas) {
        log.error(' FATAL: viewer-canvas not found!');
        return;
    }
    if (!canvasRight) {
        log.error(' FATAL: viewer-canvas-right not found!');
        return;
    }

    // Create and initialize SceneManager
    sceneManager = new SceneManager();
    if (!await sceneManager.init(canvas as HTMLCanvasElement, canvasRight)) {
        log.error(' FATAL: SceneManager initialization failed!');
        return;
    }
    log.info('Renderer type:', sceneManager.rendererType);

    // Extract objects to global variables for backward compatibility
    scene = sceneManager.scene;
    camera = sceneManager.camera;
    renderer = sceneManager.renderer;
    controls = sceneManager.controls;
    controlsRight = sceneManager.controlsRight;
    transformControls = sceneManager.transformControls;
    ambientLight = sceneManager.ambientLight;
    hemisphereLight = sceneManager.hemisphereLight;
    directionalLight1 = sceneManager.directionalLight1;
    directionalLight2 = sceneManager.directionalLight2;
    modelGroup = sceneManager.modelGroup;
    pointcloudGroup = sceneManager.pointcloudGroup;
    stlGroup = sceneManager.stlGroup;
    cadGroup = sceneManager.cadGroup;
    drawingGroup = sceneManager.drawingGroup;

    // Initialize fly camera controls (disabled by default, orbit mode is default)
    flyControls = new FlyControls(camera, renderer.domElement);

    // Create SparkRenderer only when starting with WebGL — Spark.js requires
    // WebGL context (uses .flush()). If starting with WebGPU, SparkRenderer
    // will be created in onRendererChanged when switching to WebGL for splat loading.
    if (sceneManager.rendererType === 'webgl') {
        sparkRenderer = createSparkRenderer({
            renderer: renderer,
            clipXY: SPARK_DEFAULTS.CLIP_XY,
            autoUpdate: true,
            minAlpha: SPARK_DEFAULTS.MIN_ALPHA,
            lodSplatCount: getLodBudget(QUALITY_TIER.HD),
            behindFoveate: SPARK_DEFAULTS.BEHIND_FOVEATE,
            coneFov: SPARK_DEFAULTS.CONE_FOV,
            coneFoveate: SPARK_DEFAULTS.CONE_FOVEATE,
        });
        scene.add(sparkRenderer);
        log.info(`SparkRenderer created with clipXY=2.0, minAlpha=3/255, lodSplatCount=${getLodBudget(QUALITY_TIER.HD)}`);
    } else {
        log.info('SparkRenderer deferred — will be created after WebGL switch');
    }

    // Initialize post-processing pipeline (all effects disabled by default)
    if (sceneManager.rendererType === 'webgl') {
        postProcessing.enable(renderer, scene, camera);
        sceneManager.setPostProcessing(postProcessing);
    }

    // Register callback for renderer switches (WebGPU <-> WebGL)
    sceneManager.onRendererChanged = (newRenderer: any) => {
        renderer = newRenderer;
        controls = sceneManager.controls;
        controlsRight = sceneManager.controlsRight;
        transformControls = sceneManager.transformControls;
        if (annotationSystem) annotationSystem.updateRenderer(newRenderer);
        if (measurementSystem) measurementSystem.updateRenderer(newRenderer);
        if (flyControls) {
            flyControls.dispose();
            flyControls = new FlyControls(camera, newRenderer.domElement);
        }
        if (landmarkAlignment) {
            landmarkAlignment.updateRenderer(newRenderer);
        }
        // Recreate SparkRenderer only for WebGL — Spark.js requires WebGL context (.flush())
        if (sparkRenderer) {
            scene.remove(sparkRenderer);
            if (sparkRenderer.dispose) sparkRenderer.dispose();
            sparkRenderer = null;
        }
        if (sceneManager.rendererType === 'webgl') {
            sparkRenderer = createSparkRenderer({
                renderer: newRenderer,
                clipXY: SPARK_DEFAULTS.CLIP_XY,
                autoUpdate: true,
                minAlpha: SPARK_DEFAULTS.MIN_ALPHA,
                lodSplatCount: getLodBudget(QUALITY_TIER.HD),
                behindFoveate: SPARK_DEFAULTS.BEHIND_FOVEATE,
                coneFov: SPARK_DEFAULTS.CONE_FOV,
                coneFoveate: SPARK_DEFAULTS.CONE_FOVEATE,
            });
            scene.add(sparkRenderer);
            log.info(`Renderer changed, SparkRenderer recreated for WebGL (lodSplatCount=${getLodBudget(QUALITY_TIER.HD)})`);
        } else {
            log.info('Renderer changed to WebGPU, SparkRenderer removed');
        }
        // Handle post-processing on renderer change
        if (sceneManager.rendererType === 'webgl') {
            postProcessing.enable(newRenderer, scene, camera);
            sceneManager.setPostProcessing(postProcessing);
        } else {
            postProcessing.disable();
            sceneManager.setPostProcessing(null);
            const masterEl = document.getElementById('pp-master-enable') as HTMLInputElement;
            if (masterEl) masterEl.checked = false;
        }
    };

    // Set up SceneManager callbacks for transform controls
    sceneManager.onTransformChange = () => {
        updateTransformInputs();
        _markersDirty = true; // Object moved — marker positions may be stale
        // If both selected, sync the other object
        if (state.selectedObject === 'both') {
            syncBothObjects();
        }
        // If rotating around world origin, adjust position to orbit around (0,0,0)
        applyPivotRotation();
        // If scale lock is on, enforce uniform scaling
        applyUniformScale();
    };

    // Initialize undo manager for transform operations
    undoManager = new UndoManager(20);

    sceneManager.onDraggingChanged = (dragging: boolean) => {
        if (dragging) {
            _dragBeforeMatrices = captureTransformMatrices();
        } else if (_dragBeforeMatrices) {
            const afterMatrices = captureTransformMatrices();
            undoManager.push({
                objectId: state.selectedObject,
                beforeMatrices: _dragBeforeMatrices,
                afterMatrices,
            });
            _dragBeforeMatrices = null;
        }
    };

    // Initialize annotation system
    annotationSystem = new AnnotationSystem(scene, camera, renderer, controls);
    annotationSystem.onAnnotationCreated = onAnnotationPlaced;
    annotationSystem.onAnnotationSelected = onAnnotationSelected;
    annotationSystem.onPlacementModeChanged = onPlacementModeChanged;
    log.info(' Annotation system initialized:', !!annotationSystem);

    // Initialize walkthrough controller
    initWalkthroughController({
        camera,
        controls,
        annotationSystem,
        getAnnotations: () => annotationSystem ? annotationSystem.toJSON() : [],
    });
    log.info(' Walkthrough controller initialized');

    // Initialize recording manager
    initRecordingManager({
        renderer,
        scene,
        camera,
        controls,
        canvas: renderer.domElement,
        postProcessing,
    });
    log.info(' Recording manager initialized');

    // Initialize measurement system
    measurementSystem = new MeasurementSystem(scene, camera, renderer, controls);
    _wireMeasurementControls();
    log.info(' Measurement system initialized:', !!measurementSystem);

    // Initialize flight path manager
    if (sceneManager.flightPathGroup) {
        flightPathManager = new FlightPathManager(
            sceneManager.flightPathGroup,
            scene,
            camera,
            renderer
        );
        const flightTooltip = document.getElementById('flight-tooltip');
        if (flightTooltip) flightPathManager.setupTooltip(flightTooltip);
        log.info(' FlightPathManager initialized');
    }

    // Initialize colmap manager
    if (sceneManager.colmapGroup) {
        colmapManager = new ColmapManager(sceneManager.colmapGroup);
        log.info(' ColmapManager initialized');
    }

    // Wire flight path file input
    if (sceneManager.flightPathGroup) {
        // Shared handler for flight path file inputs (toolbar + Flight Path pane)
        async function handleFlightPathFile(e: Event, inputEl: HTMLInputElement) {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file || !flightPathManager) return;
            const filenameEl = document.getElementById('flightpath-filename');
            if (filenameEl) filenameEl.textContent = file.name;
            showLoading('Importing flight log...');
            try {
                const data = await flightPathManager.importFile(file);
                const fpStore = getStore();
                fpStore.flightPathBlobs.push({ blob: file, fileName: file.name });
                state.flightPathLoaded = true;
                updateObjectSelectButtons();
                updateFlightPathUI();
                updateColmapUI();
                updateOverlayPill({ sfm: state.colmapLoaded, flightpath: state.flightPathLoaded });
                hideLoading();
                notify.success('Flight path loaded: ' + data.points.length + ' points');
            } catch (err: unknown) {
                hideLoading();
                notify.error('Error loading flight log: ' + (err instanceof Error ? err.message : String(err)));
            }
            inputEl.value = '';
        }

        const flightInput = document.getElementById('flightpath-input') as HTMLInputElement | null;
        if (flightInput) {
            flightInput.addEventListener('change', (e) => handleFlightPathFile(e, flightInput));
        }

        const flightInputPane = document.getElementById('flightpath-input-pane') as HTMLInputElement | null;
        if (flightInputPane) {
            flightInputPane.addEventListener('change', (e) => handleFlightPathFile(e, flightInputPane));
        }

        // Wire color mode dropdown
        addListener('flight-color-mode', 'change', (e: Event) => {
            if (!flightPathManager) return;
            const mode = (e.target as HTMLSelectElement).value;
            flightPathManager.setColorMode(mode as any);
        });

        // Wire endpoint toggle
        addListener('flight-show-endpoints', 'change', (e: Event) => {
            if (!flightPathManager) return;
            flightPathManager.setShowEndpoints((e.target as HTMLInputElement).checked);
        });

        // Wire direction toggle
        addListener('flight-show-direction', 'change', (e: Event) => {
            if (!flightPathManager) return;
            flightPathManager.setShowDirection((e.target as HTMLInputElement).checked);
        });

        // Wire playback controls
        addListener('fp-play-btn', 'click', () => {
            if (!flightPathManager) return;
            if (flightPathManager.isPlaying) {
                flightPathManager.pausePlayback();
                const btn = document.getElementById('fp-play-btn');
                if (btn) btn.textContent = '\u25B6';
            } else {
                flightPathManager.startPlayback();
                const btn = document.getElementById('fp-play-btn');
                if (btn) btn.textContent = '\u23F8';
            }
        });

        addListener('fp-stop-btn', 'click', () => {
            if (!flightPathManager) return;
            flightPathManager.stopPlayback();
            const btn = document.getElementById('fp-play-btn');
            if (btn) btn.textContent = '\u25B6';
            const scrubber = document.getElementById('fp-scrubber') as HTMLInputElement | null;
            if (scrubber) scrubber.value = '0';
            const timeCur = document.getElementById('fp-time-current');
            if (timeCur) timeCur.textContent = '00:00';
        });

        addListener('fp-speed', 'change', (e: Event) => {
            if (!flightPathManager) return;
            flightPathManager.setPlaybackSpeed(parseFloat((e.target as HTMLSelectElement).value));
        });

        addListener('fp-scrubber', 'input', (e: Event) => {
            if (!flightPathManager) return;
            const val = parseInt((e.target as HTMLInputElement).value, 10);
            flightPathManager.seekTo(val / 1000);
        });

        addListener('fp-follow-camera', 'change', (e: Event) => {
            if (!flightPathManager) return;
            flightPathManager.setFollowCamera((e.target as HTMLInputElement).checked);
        });

        // Playback callbacks
        flightPathManager.onPlaybackUpdate((currentMs, totalMs) => {
            const scrubber = document.getElementById('fp-scrubber') as HTMLInputElement | null;
            if (scrubber) scrubber.value = String(Math.round((currentMs / totalMs) * 1000));
            const timeCur = document.getElementById('fp-time-current');
            if (timeCur) {
                const s = Math.floor(currentMs / 1000);
                timeCur.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
            }
        });

        flightPathManager.onPlaybackEnd(() => {
            const btn = document.getElementById('fp-play-btn');
            if (btn) btn.textContent = '\u25B6';
        });
    }

    // Initialize landmark alignment system
    landmarkAlignment = new LandmarkAlignment({
        scene, camera, renderer, controls,
        splatMesh, modelGroup,
        updateTransformInputs, storeLastPositions
    });
    addListener('btn-alignment-cancel', 'click', () => {
        if (landmarkAlignment.isActive()) {
            landmarkAlignment.cancel();
            notify.info('Alignment cancelled');
        }
    });
    addListener('btn-alignment-apply', 'click', () => {
        if (landmarkAlignment?.isActive()) {
            landmarkAlignment.apply();
        }
    });
    addListener('btn-alignment-undo', 'click', () => {
        if (landmarkAlignment?.isActive()) {
            landmarkAlignment.undo();
        }
    });

    // Initialize archive creator
    archiveCreator = new ArchiveCreator();

    // Initialize cross-section tool
    crossSection = new CrossSectionTool(scene, camera, renderer, controls, modelGroup, pointcloudGroup, stlGroup);

    // Check crypto availability and warn user
    if (!CRYPTO_AVAILABLE) {
        notify.warning('SHA-256 hashing is unavailable (requires HTTPS). Archives will be created without integrity verification.');
        const banner = document.getElementById('crypto-warning-banner');
        if (banner) banner.classList.remove('hidden');
    }

    // Handle resize
    window.addEventListener('resize', onWindowResize);

    // Keyboard shortcuts
    window.addEventListener('keydown', onKeyDown);

    // Setup UI events (delegated to event-wiring.ts)
    setupUIEventsCtrl(createEventWiringDeps());

    // Wire image lightbox dismiss handlers
    initImageLightbox();

    // Initialize library panel (shows rail button if libraryEnabled)
    initLibraryPanel();

    // Wire up SD Proxy / Decimation panel
    setupDecimationPanel();

    // Apply initial controls visibility and mode
    applyControlsVisibility();
    applyControlsMode();

    // Show grid by default
    toggleGridlines(true);

    // Apply viewer mode settings (toolbar visibility, sidebar state)
    applyViewerModeSettings();

    // Set initial display mode from config
    setDisplayMode(state.displayMode);

    // Load default files if configured
    loadDefaultFiles();

    // Start render loop
    animate();

    // Ensure toolbar visibility is maintained after all initialization
    // This safeguard addresses potential race conditions with async file loading
    ensureToolbarVisibility();

    log.info(' init() completed successfully');
}

function onWindowResize() {
    const container = document.getElementById('viewer-container');
    if (sceneManager) {
        sceneManager.onWindowResize(state.displayMode, container);
    }
    _markersDirty = true; // Viewport changed — marker screen positions are stale
    invalidatePopupLayoutCache(); // Viewer rect changed
}

function onKeyDown(event: KeyboardEvent) {
    // Don't handle transform shortcuts when fly mode is active
    // (WASD/Q/E are used for camera movement in fly mode)
    if (flyControls && flyControls.enabled) {
        if (event.key === 'Escape') {
            toggleFlyMode(); // ESC exits fly mode
        }
        return;
    }

    switch (event.key.toLowerCase()) {
        case 'w':
            setTransformMode('translate' as TransformMode);
            break;
        case 'e':
            setTransformMode('rotate' as TransformMode);
            break;
        case 'r':
            setTransformMode('scale' as TransformMode);
            break;
        case 'escape':
            setSelectedObject('none' as SelectedObject);
            break;
        case 'f11':
            event.preventDefault();
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
            break;
    }
}

// ==================== Fly Camera Mode ====================

function toggleFlyMode() {
    if (!flyControls) return;

    const btn = document.getElementById('btn-fly-mode');
    const hint = document.getElementById('fly-mode-hint');
    const isActive = flyControls.enabled;

    if (isActive) {
        // Disable fly mode, re-enable orbit
        flyControls.disable();
        controls.connect();
        controls.enabled = true;
        if (controlsRight) { controlsRight.connect(); controlsRight.enabled = true; }
        // Re-sync orbit controls target to where camera is looking
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        controls.target.copy(camera.position).add(dir.multiplyScalar(5));
        controls.update();
        if (btn) btn.classList.remove('active');
        if (hint) hint.classList.add('hidden');
        log.info('Switched to Orbit camera mode');
    } else {
        // Enable fly mode, disable orbit
        controls.enabled = false;
        controls.disconnect();
        if (controlsRight) { controlsRight.enabled = false; controlsRight.disconnect(); }
        flyControls.enable();
        if (btn) btn.classList.add('active');
        if (hint) hint.classList.remove('hidden');
        log.info('Switched to Fly camera mode');
    }
}

// setupUIEvents extracted to event-wiring.ts (Phase 2, Step 2.5)

function applyBackgroundForMode(mode: string) {
    if (!scene) return;
    // If no overrides configured at all, don't touch the background
    if (!state.meshBackgroundColor && !state.splatBackgroundColor) return;

    let color: string | null = null;
    if (mode === 'model') color = state.meshBackgroundColor;
    else if (mode === 'splat' || mode === 'both') color = state.splatBackgroundColor;

    if (color) {
        scene.background = new THREE.Color(color);
    } else {
        // Restore theme/default background
        scene.background = sceneManager?.savedBackgroundColor?.clone()
            || new THREE.Color(COLORS.SCENE_BACKGROUND);
    }
}

function setDisplayMode(mode: DisplayMode) {
    setDisplayModeHandler(mode, {
        state,
        canvasRight,
        onResize: onWindowResize,
        updateVisibility
    });
    applyBackgroundForMode(mode);

    // Lazy-load any archive assets needed for this mode that aren't loaded yet
    if (state.archiveLoaded && state.archiveLoader) {
        const neededTypes = getAssetTypesForMode(mode);
        for (const type of neededTypes) {
            if (state.assetStates[type] === ASSET_STATE.UNLOADED) {
                ensureAssetLoaded(type).then(loaded => {
                    if (loaded) {
                        updateVisibility();
                        updateTransformInputs();
                    }
                });
            }
        }
    }
}

// Toggle gridlines visibility
function toggleGridlines(show: boolean) {
    if (sceneManager) {
        sceneManager.toggleGrid(show);
    }
}

// Set background color
function setBackgroundColor(hexColor: string) {
    if (sceneManager) {
        sceneManager.setBackgroundColor(hexColor);
    }
}

// Transform controls (delegated to transform-controller.js)
function setSelectedObject(selection: SelectedObject) {
    const flightpathGroup = sceneManager?.flightPathGroup || null;
    const colmapGroup = sceneManager?.colmapGroup || null;
    setSelectedObjectHandler(selection, { transformControls, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, flightpathGroup, colmapGroup, state });
    updateTransformPaneSelection(selection as string, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, flightpathGroup, colmapGroup);
}

function syncBothObjects() {
    const flightpathGroup = sceneManager?.flightPathGroup || null;
    const colmapGroup = sceneManager?.colmapGroup || null;
    syncBothObjectsHandler({ transformControls, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, flightpathGroup, colmapGroup });
}

function applyPivotRotation() {
    const flightpathGroup = sceneManager?.flightPathGroup || null;
    const colmapGroup = sceneManager?.colmapGroup || null;
    applyPivotRotationHandler({ transformControls, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, flightpathGroup, colmapGroup, state });
}

function applyUniformScale() {
    const flightpathGroup = sceneManager?.flightPathGroup || null;
    const colmapGroup = sceneManager?.colmapGroup || null;
    applyUniformScaleHandler({ transformControls, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, flightpathGroup, colmapGroup, state });
}

function captureTransformMatrices(): MatrixSnapshot {
    const result: MatrixSnapshot = {};
    const flightpathGroup = sceneManager?.flightPathGroup || null;
    const colmapGroup = sceneManager?.colmapGroup || null;
    const objects: [any, string][] = [
        [splatMesh, 'splat'],
        [modelGroup, 'model'],
        [pointcloudGroup, 'pointcloud'],
        [stlGroup, 'stl'],
        [cadGroup, 'cad'],
        [drawingGroup, 'drawing'],
        [flightpathGroup, 'flightpath'],
        [colmapGroup, 'colmap'],
    ];
    for (const [obj, key] of objects) {
        if (obj) {
            obj.updateMatrix();
            result[key] = obj.matrix.clone();
        }
    }
    return result;
}

function applyTransformMatrices(snapshot: MatrixSnapshot): void {
    const flightpathGroup = sceneManager?.flightPathGroup || null;
    const colmapGroup = sceneManager?.colmapGroup || null;
    const objects: [any, string][] = [
        [splatMesh, 'splat'],
        [modelGroup, 'model'],
        [pointcloudGroup, 'pointcloud'],
        [stlGroup, 'stl'],
        [cadGroup, 'cad'],
        [drawingGroup, 'drawing'],
        [flightpathGroup, 'flightpath'],
        [colmapGroup, 'colmap'],
    ];
    for (const [obj, key] of objects) {
        const mat = snapshot[key];
        if (!obj || !mat) continue;
        (mat as THREE.Matrix4).decompose(obj.position, obj.quaternion, obj.scale);
        obj.rotation.setFromQuaternion(obj.quaternion);
    }
    storeLastPositions();
    updateTransformInputs();
}

function performUndo(): void {
    // Try trim undo first (most recent action wins)
    if (trimUndoStack.length > 0) {
        const lastTransform = undoManager.canUndo() ? undoManager['undoStack'][undoManager['undoStack'].length - 1] : null;
        const lastTrim = trimUndoStack[trimUndoStack.length - 1];
        // Simple heuristic: trim undo stack is always more recent if it has entries
        // (transforms push to their own stack, trims push to theirs)
        if (lastTrim && flightPathManager) {
            trimUndoStack.pop();
            trimRedoStack.push(lastTrim);
            flightPathManager.setTrim(lastTrim.pathId, lastTrim.before.trimStart ?? 0, lastTrim.before.trimEnd ?? (flightPathManager.getPaths().find(p => p.id === lastTrim.pathId)?.points.length ?? 1) - 1);
            if (lastTrim.before.trimStart === undefined && lastTrim.before.trimEnd === undefined) {
                flightPathManager.resetTrim(lastTrim.pathId);
            }
            syncTrimToStore(lastTrim.pathId);
            updateFlightPathUI();
            notify.info('Undo trim');
            return;
        }
    }
    const entry = undoManager.undo();
    if (entry) {
        applyTransformMatrices(entry.beforeMatrices);
        notify.info('Undo transform');
    }
}

function performRedo(): void {
    if (trimRedoStack.length > 0) {
        const lastTrim = trimRedoStack[trimRedoStack.length - 1];
        if (lastTrim && flightPathManager) {
            trimRedoStack.pop();
            trimUndoStack.push(lastTrim);
            flightPathManager.setTrim(lastTrim.pathId, lastTrim.after.trimStart ?? 0, lastTrim.after.trimEnd ?? (flightPathManager.getPaths().find(p => p.id === lastTrim.pathId)?.points.length ?? 1) - 1);
            syncTrimToStore(lastTrim.pathId);
            updateFlightPathUI();
            notify.info('Redo trim');
            return;
        }
    }
    const entry = undoManager.redo();
    if (entry) {
        applyTransformMatrices(entry.afterMatrices);
        notify.info('Redo transform');
    }
}

function storeLastPositions() {
    const flightpathGroup = sceneManager?.flightPathGroup || null;
    const colmapGroup = sceneManager?.colmapGroup || null;
    storeLastPositionsHandler({ splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, flightpathGroup, colmapGroup });
}

function setTransformMode(mode: TransformMode) {
    const flightpathGroup = sceneManager?.flightPathGroup || null;
    const colmapGroup = sceneManager?.colmapGroup || null;
    setTransformModeHandler(mode, { transformControls, state, splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, flightpathGroup, colmapGroup });
}

function centerAtOrigin() {
    const flightpathGroup = sceneManager?.flightPathGroup || null;
    const colmapGroup = sceneManager?.colmapGroup || null;
    centerAtOriginHandler({ splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, flightpathGroup, colmapGroup, camera, controls, state });
    updateTransformInputs();
}

function resetTransform() {
    const flightpathGroup = sceneManager?.flightPathGroup || null;
    const colmapGroup = sceneManager?.colmapGroup || null;
    resetTransformHandler({ splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, flightpathGroup, colmapGroup, state });
    updateTransformInputs();
}

// ── Asset removal ───────────────────────────────────────────
function enableRemoveBtn(id: string, enabled: boolean) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) btn.disabled = !enabled;
}

function removeAssetGroup(group: THREE.Group, stateKey: keyof AppState, filenameId: string, defaultHint: string, blobKey?: keyof ReturnType<typeof getStore>) {
    // Detach transform controls if attached to this group
    if (transformControls?.object === group) {
        setSelectedObject('none' as SelectedObject);
    }
    while (group.children.length > 0) {
        const child = group.children[0];
        disposeObject(child);
        group.remove(child);
    }
    (state as any)[stateKey] = false;
    const el = document.getElementById(filenameId);
    if (el) el.textContent = defaultHint;
    if (blobKey) (getStore() as any)[blobKey] = null;
    updateVisibility();
    updateTransformInputs();
    storeLastPositions();
    updateObjectSelectButtons();
}

function removeSplat() {
    if (!state.splatLoaded) return;
    // Detach transform controls if attached to the splat
    if (transformControls?.object === splatMesh) {
        setSelectedObject('none' as SelectedObject);
    }
    if (splatMesh) {
        scene.remove(splatMesh);
        if (splatMesh.dispose) splatMesh.dispose();
        splatMesh = null;
    }
    state.splatLoaded = false;
    assets.splatBlob = null;
    const el = document.getElementById('splat-filename');
    if (el) el.textContent = '.ply, .splat, .ksplat, .spz';
    const vertRow = document.getElementById('splat-vertices-row');
    if (vertRow) vertRow.style.display = 'none';
    enableRemoveBtn('btn-remove-splat', false);
    if (state.displayMode === 'splat' || state.displayMode === 'both') {
        setDisplayMode(state.modelLoaded ? 'model' : 'splat');
    }
    updateVisibility();
    updateTransformInputs();
    storeLastPositions();
    updateObjectSelectButtons();
}

function removeModel() {
    if (!state.modelLoaded) return;
    removeAssetGroup(modelGroup, 'modelLoaded', 'model-filename', '.glb, .obj (+.mtl)', 'meshBlob');
    const facesRow = document.getElementById('model-faces-row');
    if (facesRow) facesRow.style.display = 'none';
    const texRow = document.getElementById('model-textures-row');
    if (texRow) texRow.style.display = 'none';
    enableRemoveBtn('btn-remove-model', false);
    if (state.displayMode === 'model' || state.displayMode === 'both') {
        setDisplayMode(state.splatLoaded ? 'splat' : 'model');
    }
}

function removePointcloud() {
    if (!state.pointcloudLoaded) return;
    removeAssetGroup(pointcloudGroup, 'pointcloudLoaded', 'pointcloud-filename', '.e57', 'pointcloudBlob');
    const ptsRow = document.getElementById('pointcloud-points-row');
    if (ptsRow) ptsRow.style.display = 'none';
    enableRemoveBtn('btn-remove-pointcloud', false);
}

function removeSTL() {
    if (!state.stlLoaded) return;
    removeAssetGroup(stlGroup, 'stlLoaded', 'stl-filename', '.stl');
    enableRemoveBtn('btn-remove-stl', false);
    if (state.displayMode === 'stl') {
        setDisplayMode(state.modelLoaded ? 'model' : 'splat');
    }
}

function removeCAD() {
    if (!state.cadLoaded) return;
    removeAssetGroup(cadGroup, 'cadLoaded', 'cad-filename', '.step, .iges', 'cadBlob');
    const store = getStore();
    store.cadFileName = null;
    state.currentCadUrl = null;
    enableRemoveBtn('btn-remove-cad', false);
}

function removeDrawing() {
    if (!state.drawingLoaded) return;
    removeAssetGroup(drawingGroup, 'drawingLoaded', 'drawing-filename', '.dxf');
    state.currentDrawingUrl = null;
    enableRemoveBtn('btn-remove-drawing', false);
}

function removeFlightPath() {
    if (!state.flightPathLoaded) return;
    flightPathManager?.dispose();
    const store = getStore();
    store.flightPathBlobs = [];
    state.flightPathLoaded = false;
    const filenameEl = document.getElementById('flightpath-filename');
    if (filenameEl) filenameEl.textContent = '.csv, .kml, .kmz, .srt, .txt';
    enableRemoveBtn('btn-remove-flightpath', false);
    updateObjectSelectButtons();
    updateFlightPathUI();
    updateOverlayPill({ sfm: state.colmapLoaded, flightpath: state.flightPathLoaded });
}

function updateVisibility() {
    updateVisibilityHandler(state.displayMode, splatMesh, modelGroup, pointcloudGroup, stlGroup);
    updateDisplayPill({
        splat: state.splatLoaded,
        model: state.modelLoaded,
        pointcloud: state.pointcloudLoaded,
        stl: state.stlLoaded
    });
    updateOverlayPill({ sfm: state.colmapLoaded, flightpath: state.flightPathLoaded });
    updateObjectSelectButtons();
}

function updateTransformInputs() {
    const flightpathGroup = sceneManager?.flightPathGroup || null;
    const colmapGroup = sceneManager?.colmapGroup || null;
    updateTransformInputsHandler(splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, flightpathGroup, colmapGroup);
}

/** Show/hide the object-select buttons in the Transform pane based on what is loaded. */
function updateObjectSelectButtons() {
    const show = (id: string, visible: boolean) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    };
    show('btn-select-splat', state.splatLoaded);
    show('btn-select-mesh', state.modelLoaded);
    show('btn-select-pointcloud', state.pointcloudLoaded);
    show('btn-select-stl', state.stlLoaded);
    show('btn-select-cad', state.cadLoaded);
    show('btn-select-drawing', state.drawingLoaded);
    show('btn-select-flightpath', state.flightPathLoaded);
    show('btn-select-colmap', state.colmapLoaded);
    // Sync remove buttons with loaded state
    enableRemoveBtn('btn-remove-splat', state.splatLoaded);
    enableRemoveBtn('btn-remove-model', state.modelLoaded);
    enableRemoveBtn('btn-remove-pointcloud', state.pointcloudLoaded);
    enableRemoveBtn('btn-remove-stl', state.stlLoaded);
    enableRemoveBtn('btn-remove-cad', state.cadLoaded);
    enableRemoveBtn('btn-remove-drawing', state.drawingLoaded);
    enableRemoveBtn('btn-remove-flightpath', state.flightPathLoaded);
    // "All" only when 2+ types are loaded
    const loadedCount = [state.splatLoaded, state.modelLoaded, state.pointcloudLoaded, state.stlLoaded, state.cadLoaded, state.drawingLoaded, state.flightPathLoaded, state.colmapLoaded].filter(Boolean).length;
    show('btn-select-both', loadedCount >= 2);

    // Show/hide flight path tool button and drone flight settings section
    const fpToolBtn = document.getElementById('btn-tool-flightpath');
    if (fpToolBtn) fpToolBtn.style.display = state.flightPathLoaded ? '' : 'none';
    const droneSection = document.getElementById('drone-flight-section');
    if (droneSection) droneSection.style.display = state.flightPathLoaded ? '' : 'none';
}

/** Sync trim values from FlightPathManager to the blob store. */
function syncTrimToStore(pathId: string): void {
    if (!flightPathManager) return;
    const pathData = flightPathManager.getPaths().find(p => p.id === pathId);
    if (!pathData) return;
    const fpStore = getStore();
    const blobEntry = fpStore.flightPathBlobs.find((b: { fileName: string }) => b.fileName === pathData.fileName);
    if (blobEntry) {
        blobEntry.trimStart = pathData.trimStart;
        blobEntry.trimEnd = pathData.trimEnd;
    }
}

/** Update the flight path pane UI: stats, path list. */
function updateFlightPathUI(): void {
    if (!flightPathManager) return;

    const paths = flightPathManager.getPaths();
    const stats = flightPathManager.getStats();

    // Stats
    const emptyEl = document.getElementById('flight-stats-empty');
    const contentEl = document.getElementById('flight-stats-content');
    if (emptyEl) emptyEl.style.display = stats ? 'none' : '';
    if (contentEl) contentEl.style.display = stats ? '' : 'none';
    if (stats) {
        const set = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('fp-stat-duration', stats.duration);
        set('fp-stat-distance', stats.distance);
        set('fp-stat-max-alt', stats.maxAlt);
        set('fp-stat-max-speed', stats.maxSpeed);
        set('fp-stat-avg-speed', stats.avgSpeed);
        set('fp-stat-points', stats.points);
    }

    // Path count
    const countEl = document.getElementById('fp-path-count');
    if (countEl) countEl.textContent = paths.length > 0 ? `${paths.length}` : '';

    // Path list
    const listEl = document.getElementById('fp-path-list');
    if (listEl) {
        listEl.innerHTML = '';
        for (const p of paths) {
            // --- Path row (visibility checkbox + name + reset + delete) ---
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:3px 0; font-size:11px;';

            const vis = document.createElement('input');
            vis.type = 'checkbox';
            vis.checked = flightPathManager.isPathVisible(p.id);
            vis.title = 'Toggle visibility';
            vis.style.cssText = 'margin:0; flex-shrink:0;';
            vis.addEventListener('change', () => {
                flightPathManager!.setPathVisible(p.id, vis.checked);
            });

            const name = document.createElement('span');
            name.textContent = p.fileName;
            name.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary);';
            name.title = `${p.fileName} — ${p.points.length} pts, ${p.durationS}s`;

            // Reset trim link (shown only when trim is active)
            const isTrimmed = p.trimStart !== undefined || p.trimEnd !== undefined;
            const resetLink = document.createElement('span');
            resetLink.className = 'fp-trim-reset';
            resetLink.textContent = 'reset';
            resetLink.title = 'Reset trim to full path';
            resetLink.style.display = isTrimmed ? '' : 'none';
            resetLink.addEventListener('click', () => {
                const before = { trimStart: p.trimStart, trimEnd: p.trimEnd };
                flightPathManager!.resetTrim(p.id);
                trimUndoStack.push({ pathId: p.id, before, after: { trimStart: undefined, trimEnd: undefined } });
                trimRedoStack.length = 0;
                if (trimUndoStack.length > 20) trimUndoStack.shift();
                syncTrimToStore(p.id);
                updateFlightPathUI();
            });

            const del = document.createElement('button');
            del.textContent = '\u00D7';
            del.className = 'prop-btn danger small';
            del.style.cssText = 'padding:0 5px; min-width:0; line-height:1.4; font-size:13px;';
            del.title = 'Remove path';
            del.addEventListener('click', () => {
                flightPathManager!.deletePath(p.id);
                // Remove from blob store
                const fpStore = getStore();
                const idx = fpStore.flightPathBlobs.findIndex((b: any) => b.fileName === p.fileName);
                if (idx >= 0) fpStore.flightPathBlobs.splice(idx, 1);
                // Update state
                state.flightPathLoaded = flightPathManager!.hasData;
                updateObjectSelectButtons();
                updateFlightPathUI();
                updateOverlayPill({ sfm: state.colmapLoaded, flightpath: state.flightPathLoaded });
            });

            row.appendChild(vis);
            row.appendChild(name);
            row.appendChild(resetLink);
            row.appendChild(del);
            listEl.appendChild(row);

            // --- Trim bar ---
            const totalPts = p.points.length;
            if (totalPts > 2) {
                const trimStart = p.trimStart ?? 0;
                const trimEnd = p.trimEnd ?? (totalPts - 1);

                const bar = document.createElement('div');
                bar.className = 'fp-trim-bar';

                const range = document.createElement('div');
                range.className = 'fp-trim-range';

                const handleStart = document.createElement('div');
                handleStart.className = 'fp-trim-handle fp-trim-handle-start';

                const handleEnd = document.createElement('div');
                handleEnd.className = 'fp-trim-handle fp-trim-handle-end';

                const startPct = (trimStart / (totalPts - 1)) * 100;
                const endPct = (trimEnd / (totalPts - 1)) * 100;
                range.style.left = `${startPct}%`;
                range.style.width = `${endPct - startPct}%`;
                handleStart.style.left = `${startPct}%`;
                handleEnd.style.left = `${endPct}%`;

                bar.appendChild(range);
                bar.appendChild(handleStart);
                bar.appendChild(handleEnd);

                // Drag logic — update handle/range positions directly during drag,
                // only rebuild full UI on mouseup to avoid detaching the bar element.
                const setupDrag = (handle: HTMLElement, isStart: boolean) => {
                    let dragging = false;
                    let beforeTrim: { trimStart?: number; trimEnd?: number } | null = null;

                    const updatePositions = (startIdx: number, endIdx: number) => {
                        const sPct = (startIdx / (totalPts - 1)) * 100;
                        const ePct = (endIdx / (totalPts - 1)) * 100;
                        handleStart.style.left = `${sPct}%`;
                        handleEnd.style.left = `${ePct}%`;
                        range.style.left = `${sPct}%`;
                        range.style.width = `${ePct - sPct}%`;
                    };

                    const onMove = (e: MouseEvent) => {
                        if (!dragging) return;
                        const rect = bar.getBoundingClientRect();
                        if (rect.width === 0) return; // safety: bar detached
                        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        const idx = Math.round(pct * (totalPts - 1));

                        // Read live trim values from the path data
                        const liveStart = p.trimStart ?? 0;
                        const liveEnd = p.trimEnd ?? (totalPts - 1);

                        if (isStart) {
                            const newStart = Math.min(idx, liveEnd - 1);
                            flightPathManager!.setTrim(p.id, newStart, liveEnd);
                            updatePositions(newStart, liveEnd);
                        } else {
                            const newEnd = Math.max(idx, liveStart + 1);
                            flightPathManager!.setTrim(p.id, liveStart, newEnd);
                            updatePositions(liveStart, newEnd);
                        }
                    };

                    const onUp = () => {
                        dragging = false;
                        handle.classList.remove('dragging');
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);

                        // Push trim undo entry
                        if (beforeTrim) {
                            const afterTrim = { trimStart: p.trimStart, trimEnd: p.trimEnd };
                            if (beforeTrim.trimStart !== afterTrim.trimStart || beforeTrim.trimEnd !== afterTrim.trimEnd) {
                                trimUndoStack.push({ pathId: p.id, before: beforeTrim, after: afterTrim });
                                trimRedoStack.length = 0;
                                if (trimUndoStack.length > 20) trimUndoStack.shift();
                            }
                            beforeTrim = null;
                        }

                        syncTrimToStore(p.id);
                        updateFlightPathUI(); // full rebuild only on mouseup
                    };

                    handle.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        dragging = true;
                        beforeTrim = { trimStart: p.trimStart, trimEnd: p.trimEnd };
                        handle.classList.add('dragging');
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                    });
                };

                setupDrag(handleStart, true);
                setupDrag(handleEnd, false);

                listEl.appendChild(bar);
            }
        }
    }

    // Total time label
    const timeTotal = document.getElementById('fp-time-total');
    if (timeTotal && paths.length > 0) {
        const totalS = paths.reduce((sum, p) => sum + p.durationS, 0);
        const m = Math.floor(totalS / 60);
        const s = totalS % 60;
        timeTotal.textContent = `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
}

/** Update the colmap pane UI: camera count, button visibility. */
function updateColmapUI(): void {
    const info = document.getElementById('colmap-info');
    const count = document.getElementById('colmap-camera-count');
    const selectBtn = document.getElementById('btn-select-colmap');
    const alignBtn = document.getElementById('btn-align-flightpath');
    const noData = document.getElementById('colmap-no-data');
    if (info) info.style.display = state.colmapLoaded ? '' : 'none';
    if (noData) noData.style.display = state.colmapLoaded ? 'none' : '';
    if (count && colmapManager) count.textContent = String(colmapManager.cameraCount);
    if (selectBtn) selectBtn.style.display = state.colmapLoaded ? '' : 'none';
    if (alignBtn) alignBtn.style.display = (state.colmapLoaded && state.flightPathLoaded) ? '' : 'none';
    const sfmSection = document.getElementById('sfm-camera-section');
    if (sfmSection) sfmSection.style.display = state.colmapLoaded ? '' : 'none';
}

// Handle loading archive from URL via prompt
function handleLoadArchiveFromUrlPrompt() {
    handleLoadArchiveFromUrlPromptCtrl(createFileInputDeps());
}

// Handle point cloud file input
async function handlePointcloudFile(event: Event) {
    return handlePointcloudFileCtrl(event, createFileInputDeps());
}

// Handle archive file input (delegated to archive-pipeline.ts)
async function handleArchiveFile(event: Event) { clearRecordingPreview(); return handleArchiveFileCtrl(event, createArchivePipelineDeps()); }

// Load archive from URL (delegated to archive-pipeline.ts)
async function loadArchiveFromUrl(url: string) { clearRecordingPreview(); return loadArchiveFromUrlCtrl(url, createArchivePipelineDeps()); }

// Ensure archive asset loaded (delegated to archive-pipeline.ts)
async function ensureAssetLoaded(assetType: string) { return ensureAssetLoadedCtrl(assetType, createArchivePipelineDeps()); }

// Process loaded archive (delegated to archive-pipeline.ts)
async function processArchive(archiveLoader: any, archiveName: string) { return processArchiveCtrl(archiveLoader, archiveName, createArchivePipelineDeps()); }

// Clear archive metadata (delegated to archive-pipeline.ts)
function clearArchiveMetadata() { clearArchiveMetadataCtrl(createArchivePipelineDeps()); }

// ==================== Annotation Functions ====================

// Called when user places an annotation (clicks on model in placement mode)
function onAnnotationPlaced(position: any, cameraState: any) {
    onAnnotationPlacedHandler(position, cameraState, createAnnotationControllerDeps());
}

// Called when an annotation is selected
function onAnnotationSelected(annotation: any) {
    onAnnotationSelectedHandler(annotation, createAnnotationControllerDeps());
}

// Called when placement mode changes
function onPlacementModeChanged(active: boolean) {
    onPlacementModeChangedHandler(active);
}

// Toggle annotation placement mode
function toggleAnnotationMode() {
    toggleAnnotationModeHandler(createAnnotationControllerDeps());
}

// Save the pending annotation
function saveAnnotation() {
    saveAnnotationHandler(createAnnotationControllerDeps());
}

// Cancel annotation placement
function cancelAnnotation() {
    cancelAnnotationHandler(createAnnotationControllerDeps());
}

// Update camera for selected annotation
function updateSelectedAnnotationCamera() {
    updateSelectedAnnotationCameraHandler(createAnnotationControllerDeps());
}

// Delete selected annotation
function deleteSelectedAnnotation() {
    deleteSelectedAnnotationHandler(createAnnotationControllerDeps());
}

// Update annotations UI (list and bar)
function updateAnnotationsUI() {
    updateAnnotationsUIHandler(createAnnotationControllerDeps());
}

// Update sidebar annotations list - delegates to annotation-controller.js
function updateSidebarAnnotationsList() {
    updateSidebarAnnotationsListHandler(createAnnotationControllerDeps());
}

// Load annotations from archive - delegates to annotation-controller.js
function loadAnnotationsFromArchive(annotations: any[]) {
    loadAnnotationsFromArchiveHandler(annotations, createAnnotationControllerDeps());
}

// ==================== Export/Archive Creation Functions (delegated to export-controller.ts) ====================

async function showExportPanel() {
    const { showExportPanel: ctrl } = await import('./modules/export-controller.js');
    ctrl(createExportDeps());
}

// =============================================================================
// SCREENSHOT FUNCTIONS (delegated to screenshot-manager.js)
// =============================================================================

function downloadScreenshot() {
    return downloadScreenshotHandler({ renderer, scene, camera, state, postProcessing });
}

function captureScreenshotToList() {
    return captureScreenshotToListHandler({ renderer, scene, camera, state, postProcessing });
}

function showViewfinder() {
    showViewfinderHandler();
}

function hideViewfinder() {
    hideViewfinderHandler();
}

function captureManualPreview() {
    return captureManualPreviewHandler({ renderer, scene, camera, state, postProcessing });
}

// =============================================================================
// RECORDING FUNCTIONS (delegated to recording-manager.ts)
// =============================================================================

function handleStartRecording(): void {
    const activeMode = document.querySelector('.rec-mode-btn.active') as HTMLElement | null;
    const mode = (activeMode?.dataset.recMode || 'free') as RecordingMode;

    const startBtn = document.getElementById('btn-rec-start');
    const stopBtn = document.getElementById('btn-rec-stop');
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'flex';

    const started = startRecordingHandler(mode, async (result) => {
        if (startBtn) startBtn.style.display = 'flex';
        if (stopBtn) stopBtn.style.display = 'none';

        const container = document.getElementById('rec-trim-container');
        if (!container) return;

        const archiveTitle = state.metadata?.title || 'Untitled';
        const defaultTitle = `${archiveTitle} - ${mode} - ${new Date().toLocaleDateString()}`;

        const trimResult = await showTrimUI(container, result.blob, defaultTitle);
        if (!trimResult) {
            discardRecording();
            return;
        }

        const statusEl = document.getElementById('rec-upload-status');
        const statusText = document.getElementById('rec-upload-text');
        if (statusEl) statusEl.classList.remove('hidden');
        if (statusText) statusText.textContent = 'Uploading...';

        const uploadResult = await uploadRecording({
            title: trimResult.title,
            archiveHash: state.currentArchiveUrl
                ? new URL(state.currentArchiveUrl, window.location.origin).pathname
                : state.archiveFileName ? '/archives/' + state.archiveFileName : undefined,
            trimStart: trimResult.trimStart,
            trimEnd: trimResult.trimEnd,
        });

        if (uploadResult) {
            if (statusText) statusText.textContent = 'Processing...';
            pollMediaStatus(uploadResult.id, (status, data) => {
                if (statusText) {
                    if (status === 'ready') {
                        statusText.textContent = 'Ready!';
                        setTimeout(() => { if (statusEl) statusEl.classList.add('hidden'); }, 3000);
                        showRecordingPreview(data);
                    } else if (status === 'error') {
                        statusText.textContent = 'Transcode failed — try again';
                    }
                }
            });
        } else {
            if (statusEl) statusEl.classList.add('hidden');
        }
    });

    if (!started) {
        if (startBtn) startBtn.style.display = 'flex';
        if (stopBtn) stopBtn.style.display = 'none';
        return;
    }

    // Mode-specific automation
    if (mode === 'turntable') {
        controls.autoRotate = true;
        const speedSlider = document.getElementById('rec-turntable-speed') as HTMLInputElement | null;
        controls.autoRotateSpeed = parseFloat(speedSlider?.value || '2') * 2;
    } else if (mode === 'walkthrough') {
        import('./modules/walkthrough-controller.js').then(wc => wc.playPreview());
    } else if (mode === 'annotation-tour') {
        const dwellSlider = document.getElementById('rec-tour-dwell') as HTMLInputElement | null;
        const dwellTime = (parseInt(dwellSlider?.value || '3')) * 1000;
        startAnnotationTour(
            { camera, controls, annotationSystem },
            {
                dwellTime,
                flyDuration: 1500,
                onComplete: () => stopRecordingHandler(),
            }
        );
    }
}

function handleStopRecording(): void {
    stopRecordingHandler();
    controls.autoRotate = false;
    stopAnnotationTour();
}

function showRecordingPreview(media: any): void {
    const container = document.getElementById('rec-result-preview');
    if (!container || !media) return;
    container.classList.remove('hidden');
    container.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'rec-preview-card';

    // Thumbnail with click-to-play
    if (media.thumb_path) {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'rec-preview-thumb';
        const img = document.createElement('img');
        img.src = media.thumb_path;
        img.alt = media.title || 'Recording';
        if (media.gif_path) {
            const thumbSrc = media.thumb_path;
            img.addEventListener('mouseenter', () => { img.src = media.gif_path; });
            img.addEventListener('mouseleave', () => { img.src = thumbSrc; });
        }
        if (media.mp4_path) {
            img.style.cursor = 'pointer';
            img.addEventListener('click', () => {
                thumbWrap.innerHTML = '';
                const video = document.createElement('video');
                video.src = media.mp4_path;
                video.controls = true;
                video.autoplay = true;
                video.style.cssText = 'width:100%; border-radius:4px; background:#000;';
                thumbWrap.appendChild(video);
            });
        }
        thumbWrap.appendChild(img);
        card.appendChild(thumbWrap);
    }

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'rec-preview-actions';

    if (media.share_url) {
        const shareBtn = document.createElement('button');
        shareBtn.className = 'prop-btn';
        shareBtn.textContent = 'Copy Share Link';
        shareBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(location.origin + media.share_url);
                notify.success('Share link copied');
            } catch { notify.error('Copy failed'); }
        });
        actions.appendChild(shareBtn);
    }

    if (media.gif_path) {
        const gifBtn = document.createElement('button');
        gifBtn.className = 'prop-btn';
        gifBtn.textContent = 'Copy GIF URL';
        gifBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(location.origin + media.gif_path);
                notify.success('GIF URL copied');
            } catch { notify.error('Copy failed'); }
        });
        actions.appendChild(gifBtn);
    }

    card.appendChild(actions);
    container.appendChild(card);
}

function clearRecordingPreview(): void {
    const container = document.getElementById('rec-result-preview');
    if (container) { container.innerHTML = ''; container.classList.add('hidden'); }
}

// Download archive — delegated to export-controller.ts
async function downloadArchive() {
    const { downloadArchive: ctrl } = await import('./modules/export-controller.js');
    return ctrl(createExportDeps());
}

// Save archive to library — delegated to export-controller.ts
async function saveToLibrary() {
    const { saveToLibrary: ctrl } = await import('./modules/export-controller.js');
    return ctrl(createExportDeps());
}

// ==================== Metadata Sidebar Functions ====================

// Show metadata sidebar - delegates to metadata-manager.js
function showMetadataSidebar(mode: 'view' | 'edit' | 'annotations' = 'view') {
    showMetadataSidebarHandler(mode, createMetadataDeps());
    setTimeout(onWindowResize, 300);
}

// Legacy function names for compatibility
function showMetadataPanel() {
    showMetadataSidebar('edit');
}

function hideMetadataPanel() {
    hideMetadataSidebar();
}

// Setup metadata sidebar - delegates to metadata-manager.js
function setupMetadataSidebar() {
    setupMetadataSidebarHandler({
        ...createMetadataDeps(),
        onExportMetadata: exportMetadataManifest,
        onImportMetadata: importMetadataManifest
    });
}

// Export/Import metadata manifest — delegated to export-controller.ts
async function exportMetadataManifest() {
    const { exportMetadataManifest: ctrl } = await import('./modules/export-controller.js');
    return ctrl(createExportDeps());
}
async function importMetadataManifest() {
    const { importMetadataManifest: ctrl } = await import('./modules/export-controller.js');
    ctrl(createExportDeps());
}

// Prefill metadata panel from archive manifest
// Prefill metadata - delegates to metadata-manager.js
function prefillMetadataFromArchive(manifest: any) {
    prefillMetadataFromArchiveHandler(manifest);
}

// ==================== Museum-Style Metadata Display ====================

// Toggle metadata display - delegates to metadata-manager.js
function toggleMetadataDisplay() { toggleMetadataDisplayHandler(createMetadataDeps()); }

// Populate the museum-style metadata display - delegates to metadata-manager.js
function populateMetadataDisplay() { populateMetadataDisplayHandler(createMetadataDeps()); }

// ==================== Annotation Info Popup ====================

// Update annotation popup position - delegates to metadata-manager.js
function updateAnnotationPopupPosition() {
    updateAnnotationPopupPositionHandler(getCurrentPopupAnnotationId());
}

// ==================== End Annotation/Export Functions ====================

// ==================== Tauri Native File Dialogs ====================

/**
 * Wire up native file dialogs for all file inputs when running in Tauri.
 * Overrides the <label for="..."> click to open a native OS dialog instead
 * of the browser's file picker, then feeds the result into the existing handler.
 */
// Wire native file dialogs (structural wiring delegated to tauri-bridge.js)
function wireNativeFileDialogs() {
    if (!tauriBridge || !tauriBridge.isTauri()) return;
    tauriBridge.wireNativeFileDialogs({
        onSplatFiles: async (files: any[]) => {
            const el = document.getElementById('splat-filename');
            if (el) el.textContent = files[0].name;
            showLoading('Loading Gaussian Splat...');
            try { await loadSplatFromFileHandler(files[0], createFileHandlerDeps()); hideLoading(); }
            catch (e) { log.error('Error loading splat:', e); hideLoading(); notify.error('Error loading Gaussian Splat: ' + e.message); }
        },
        onModelFiles: async (files: any[]) => {
            const el = document.getElementById('model-filename');
            if (el) el.textContent = files[0].name;
            showLoading('Loading 3D Model...');
            try { await loadModelFromFileHandler(files as any, createFileHandlerDeps()); hideLoading(); }
            catch (e) { log.error('Error loading model:', e); hideLoading(); notify.error('Error loading model: ' + e.message); }
        },
        onArchiveFiles: async (files: any[]) => {
            const el = document.getElementById('archive-filename');
            if (el) el.textContent = files[0].name;
            showLoading('Loading archive...');
            try {
                if (state.archiveLoader) state.archiveLoader.dispose();
                const archiveLoader = new ArchiveLoader();
                await archiveLoader.loadFromFile(files[0]);
                await processArchive(archiveLoader, files[0].name);
                state.currentArchiveUrl = null;
            } catch (e) { log.error('Error loading archive:', e); hideLoading(); notify.error('Error loading archive: ' + e.message); }
        },
        onPointcloudFiles: async (files: any[]) => {
            const el = document.getElementById('pointcloud-filename');
            if (el) el.textContent = files[0].name;
            showLoading('Loading point cloud...');
            try { await loadPointcloudFromFileHandler(files[0], createPointcloudDeps()); hideLoading(); }
            catch (e) { log.error('Error loading point cloud:', e); hideLoading(); notify.error('Error loading point cloud: ' + e.message); }
        },
        onSTLFiles: async (files: any[]) => {
            const el = document.getElementById('stl-filename');
            if (el) el.textContent = files[0].name;
            showLoading('Loading STL Model...');
            try { await loadSTLFileHandler([files[0]] as any, createFileHandlerDeps()); hideLoading(); }
            catch (e) { log.error('Error loading STL:', e); hideLoading(); notify.error('Error loading STL: ' + e.message); }
        },
        onProxyMeshFiles: async (files: any[]) => {
            assets.proxyMeshBlob = files[0];
            const el = document.getElementById('proxy-mesh-filename');
            if (el) el.textContent = files[0].name;
            notify.info(`Display proxy "${files[0].name}" ready — will be included in archive exports.`);
        },
        onSourceFiles: async (files: any[]) => {
            const category = (document.getElementById('source-files-category') as HTMLInputElement)?.value || '';
            for (const file of files) { assets.sourceFiles.push({ file, name: file.name, size: file.size, category, fromArchive: false }); }
            updateSourceFilesUI();
            notify.info(`Added ${files.length} source file(s) for archival.`);
        },
        onBgImageFiles: async (files: any[]) => {
            if (!sceneManager) return;
            try {
                await sceneManager.loadBackgroundImageFromFile(files[0]);
                const filenameEl = document.getElementById('bg-image-filename');
                if (filenameEl) filenameEl.textContent = files[0].name;
                const statusRow = document.getElementById('bg-image-status');
                if (statusRow) statusRow.style.display = '';
                const envBgToggle = document.getElementById('toggle-env-background') as HTMLInputElement | null;
                if (envBgToggle) envBgToggle.checked = false;
                document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
            } catch (err) { notify.error('Failed to load background image: ' + err.message); }
        },
        onHdrFiles: async (files: any[]) => {
            showLoading('Loading HDR environment...');
            try {
                await sceneManager.loadHDREnvironmentFromFile(files[0]);
                const filenameEl = document.getElementById('hdr-filename');
                if (filenameEl) { filenameEl.textContent = files[0].name; filenameEl.style.display = ''; }
                const select = document.getElementById('env-map-select') as HTMLSelectElement | null;
                if (select) select.value = '';
                hideLoading();
                notify.success('HDR environment loaded');
            } catch (err) { hideLoading(); notify.error('Failed to load HDR: ' + err.message); }
        }
    });
}

async function handleSplatFile(event: Event) {
    return handleSplatFileCtrl(event, createFileInputDeps());
}

async function handleModelFile(event: Event) {
    return handleModelFileCtrl(event, createFileInputDeps());
}

async function handleSTLFile(event: Event) {
    return handleSTLFileCtrl(event, createFileInputDeps());
}

async function handleDrawingFile(event: Event) {
    return handleDrawingFileCtrl(event, createFileInputDeps());
}

async function handleCADFile(event: Event) {
    return handleCADFileCtrl(event, createFileInputDeps());
}

async function handleProxyMeshFile(event: Event) {
    await handleProxyMeshFileCtrl(event, createFileInputDeps());
    showQualityToggleIfNeeded();
}

async function handleProxySplatFile(event: Event) {
    return handleProxySplatFileCtrl(event, createFileInputDeps());
}

/** Show or hide the SD/HD toggle in the status bar based on proxy availability. */
function showQualityToggleIfNeeded() {
    const container = document.getElementById('quality-toggle-container');
    if (!container) return;
    const assets = getStore();
    const hasProxy = !!(assets.proxyMeshBlob || state.proxyMeshGroup);
    const hasMesh = state.modelLoaded;
    if (hasMesh && hasProxy) {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}

/** Update SD/HD button active states. */
function updateQualityButtonStates(tier: string) {
    document.querySelectorAll('.quality-toggle-btn').forEach((btn: Element) => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.tier === tier);
    });
}

/**
 * Editor quality tier switch — handles both archive-loaded and local proxies.
 * For archive proxies, delegates to archive-pipeline switchQualityTier.
 * For local proxies (decimator or manual upload), toggles visibility directly.
 */
async function switchQualityTier(newTier: string) {
    // Archive-loaded proxy: delegate to archive-pipeline
    if (state.archiveLoader) {
        const contentInfo = state.archiveLoader.getContentInfo();
        if (contentInfo.hasMeshProxy || contentInfo.hasSceneProxy) {
            await switchQualityTierCtrl(newTier, createArchivePipelineDeps());
            return;
        }
    }

    // Local proxy (decimator or manual upload)
    const assets = getStore();
    if (newTier === 'sd') {
        // Load proxy blob into a THREE.Group if not already loaded
        if (!state.proxyMeshGroup && assets.proxyMeshBlob) {
            const blobUrl = URL.createObjectURL(assets.proxyMeshBlob);
            try {
                const { loadGLTF } = await import('./modules/file-handlers.js');
                const loaded = await loadGLTF(blobUrl);
                state.proxyMeshGroup = loaded;
                // Copy transform from full-res model
                if (modelGroup) {
                    loaded.position.copy(modelGroup.position);
                    loaded.rotation.copy(modelGroup.rotation);
                    loaded.scale.copy(modelGroup.scale);
                }
                loaded.visible = false;
                scene.add(loaded);
            } finally {
                URL.revokeObjectURL(blobUrl);
            }
        }
        if (state.proxyMeshGroup && modelGroup) {
            state.proxyMeshGroup.visible = true;
            modelGroup.visible = false;
            state.viewingProxy = true;
        }
    } else {
        // Switch to HD — show full-res, hide proxy
        if (state.proxyMeshGroup) state.proxyMeshGroup.visible = false;
        if (modelGroup) modelGroup.visible = true;
        state.viewingProxy = false;
    }

    updateQualityButtonStates(newTier);
    // Sync the decimation panel preview button text if present
    const previewBtn = document.getElementById('btn-preview-proxy');
    if (previewBtn) previewBtn.textContent = newTier === 'sd' ? 'Preview HD' : 'Preview SD';
}

// ==================== Source Files ====================
// Extracted to source-files-manager.ts

// Handle load full res mesh (delegated to archive-pipeline.ts)
async function handleLoadFullResMesh() { return handleLoadFullResMeshCtrl(createArchivePipelineDeps()); }

function updateModelOpacity() { updateModelOpacityFn(modelGroup, state.modelOpacity); }

function updateModelWireframe() { updateModelWireframeFn(modelGroup, state.modelWireframe); }

function updateModelMatcap() { updateModelMatcapFn(modelGroup, state.modelMatcap, state.matcapStyle); }

function updateModelNormals() { updateModelNormalsFn(modelGroup, state.modelNormals); }

function updateModelRoughnessView() { updateModelRoughnessFn(modelGroup, state.modelRoughness); }

function updateModelMetalnessView() { updateModelMetalnessFn(modelGroup, state.modelMetalness); }

function updateModelSpecularF0View() { updateModelSpecularF0Fn(modelGroup, state.modelSpecularF0); }

// Alignment I/O (delegated to alignment.js)
function createAlignmentIODeps(): AlignmentIODeps {
    return {
        splatMesh, modelGroup, pointcloudGroup, tauriBridge,
        updateTransformInputs, storeLastPositions
    };
}

function applyAlignmentData(data: any) {
    applyAlignmentDataHandler(data, createAlignmentIODeps());
}

function loadAlignmentFromUrl(url: string) {
    return loadAlignmentFromUrlHandler(url, createAlignmentIODeps());
}


function resetAlignment() {
    resetAlignmentHandler(createAlignmentDeps());
}

function resetCamera() {
    resetCameraHandler(createAlignmentDeps());
    // Also update right controls for split view
    if (controlsRight) {
        controlsRight.target.set(0, 0, 0);
        controlsRight.update();
    }
}

function fitToView() {
    fitToViewHandler(createAlignmentDeps());
    // Also update right controls for split view
    if (controlsRight) {
        controlsRight.target.copy(controls.target);
        controlsRight.update();
    }
}

function resetOrbitCenter() {
    const box = new THREE.Box3();
    let hasContent = false;

    // Prefer mesh/pointcloud bounds — splat bounding boxes can be noisy
    if (modelGroup && modelGroup.children.length > 0) { box.expandByObject(modelGroup); hasContent = true; }
    if (pointcloudGroup && pointcloudGroup.children.length > 0) { box.expandByObject(pointcloudGroup); hasContent = true; }

    // Only use splat bounds as fallback when no mesh/pointcloud is loaded
    if (!hasContent && splatMesh && splatMesh.visible) {
        if (typeof splatMesh.getBoundingBox === 'function') {
            const splatBox = splatMesh.getBoundingBox(false);
            if (splatBox && !splatBox.isEmpty()) { box.union(splatBox); hasContent = true; }
        } else {
            box.expandByObject(splatMesh); hasContent = true;
        }
    }

    const center = hasContent ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);
    controls.target.copy(center);
    controls.update();
    if (controlsRight) { controlsRight.target.copy(center); controlsRight.update(); }
}

// Controls panel visibility (delegated to ui-controller.js)
function createControlsDeps(): ControlsPanelDeps {
    return { state, config, onWindowResize };
}

function applyControlsVisibility(shouldShowOverride?: boolean) {
    applyControlsVisibilityHandler(createControlsDeps(), shouldShowOverride);
}

function applyControlsMode() {
    applyControlsModeHandler(config.controlsMode || 'full');
}

function ensureToolbarVisibility() {
    ensureToolbarVisibilityHandler(config);
}

function applyViewerModeSettings() {
    applyViewerModeSettingsHandler(config);
}

function _wireMeasurementControls() {
    // Show the measure button (starts display:none in HTML)
    const measureBtn = document.getElementById('btn-measure');
    if (measureBtn) measureBtn.style.display = '';

    // Toggle measure mode on/off
    addListener('btn-measure', 'click', () => {
        if (!measurementSystem) return;
        const active = !measurementSystem.isActive;
        measurementSystem.setMeasureMode(active);
        const btn = document.getElementById('btn-measure');
        if (btn) btn.classList.toggle('active', active);
    });

    // Scale factor inputs
    let _scaleUnit = 'm';
    addListener('measure-scale-value', 'input', (e) => {
        const val = parseFloat((e as InputEvent & { target: HTMLInputElement }).target.value);
        if (measurementSystem && !isNaN(val) && val > 0) {
            measurementSystem.setScale(val, _scaleUnit);
        }
    });
    addListener('measure-scale-unit', 'change', (e) => {
        _scaleUnit = (e as Event & { target: HTMLSelectElement }).target.value;
        const valueInput = document.getElementById('measure-scale-value') as HTMLInputElement | null;
        const val = valueInput ? parseFloat(valueInput.value) : 1;
        if (measurementSystem && !isNaN(val) && val > 0) {
            measurementSystem.setScale(val, _scaleUnit);
        }
    });

    // Clear all measurements
    addListener('measure-clear-all', 'click', () => {
        if (measurementSystem) measurementSystem.clearAll();
    });

    // --- Calibration flow ---
    let _calibrateRawDistance = 0;
    let _calibrateCheckInterval: ReturnType<typeof setInterval> | null = null;
    const _calibrateBtn = document.getElementById('btn-calibrate-scale');

    addListener('btn-calibrate-scale', 'click', () => {
        if (!measurementSystem) return;
        // Enter measure mode to capture a reference measurement
        measurementSystem.setMeasureMode(true);
        if (_calibrateBtn) _calibrateBtn.textContent = 'Click two points...';
        const measureBtn = document.getElementById('btn-measure');
        if (measureBtn) measureBtn.classList.add('active');

        // Watch for a new measurement to appear
        const startCount = measurementSystem.getMeasurements().length;
        _calibrateCheckInterval = setInterval(() => {
            if (!measurementSystem) return;
            const measurements = measurementSystem.getMeasurements();
            if (measurements.length > startCount) {
                const last = measurements[measurements.length - 1];
                _calibrateRawDistance = last.rawDistance;
                if (_calibrateCheckInterval) clearInterval(_calibrateCheckInterval);
                _calibrateCheckInterval = null;

                // Show inline form with raw distance
                const rawEl = document.getElementById('calibrate-raw-distance');
                if (rawEl) rawEl.textContent = parseFloat(_calibrateRawDistance.toFixed(4)) + ' units';
                const form = document.getElementById('calibrate-inline-form');
                if (form) form.style.display = '';
                if (_calibrateBtn) _calibrateBtn.textContent = 'Calibrate Scale';

                measurementSystem.setMeasureMode(false);
                if (measureBtn) measureBtn.classList.remove('active');

                // Remove the reference measurement — it was just for calibration
                measurementSystem.removeMeasurement(last.id);
            }
        }, 100);
    });

    addListener('btn-calibrate-apply', 'click', () => {
        if (!measurementSystem || _calibrateRawDistance <= 0) return;
        const realDist = parseFloat((document.getElementById('calibrate-real-distance') as HTMLInputElement)?.value);
        const unit = (document.getElementById('calibrate-unit') as HTMLSelectElement)?.value || 'm';
        if (isNaN(realDist) || realDist <= 0) return;

        measurementSystem.calibrate(_calibrateRawDistance, realDist, unit);

        // Update calibration status
        const status = document.getElementById('measure-calibrate-status');
        if (status) {
            status.textContent = `Calibrated: 1 unit = ${parseFloat(measurementSystem.getScale().toFixed(4))} ${measurementSystem.getUnit()}`;
            status.classList.add('calibrated');
        }

        // Sync manual scale inputs
        const scaleInput = document.getElementById('measure-scale-value') as HTMLInputElement | null;
        const unitSelect = document.getElementById('measure-scale-unit') as HTMLSelectElement | null;
        if (scaleInput) scaleInput.value = String(parseFloat(measurementSystem.getScale().toFixed(4)));
        if (unitSelect) unitSelect.value = measurementSystem.getUnit();

        // Hide inline form
        const form = document.getElementById('calibrate-inline-form');
        if (form) form.style.display = 'none';
    });
}

// Load default files from configuration
async function loadDefaultFiles() {
    undoManager.clear();
    // Archive URL takes priority over splat/model URLs
    if (config.defaultArchiveUrl) {
        log.info(' Loading archive from URL:', config.defaultArchiveUrl);
        await loadArchiveFromUrl(config.defaultArchiveUrl);
        return; // Archive handles everything including alignment
    }

    if (config.defaultSplatUrl) {
        await loadSplatFromUrl(config.defaultSplatUrl);
    }

    if (config.defaultModelUrl) {
        await loadModelFromUrl(config.defaultModelUrl);
    }

    if (config.defaultPointcloudUrl) {
        await loadPointcloudFromUrl(config.defaultPointcloudUrl);
    }

    // Handle alignment priority:
    // 1. Inline alignment params (highest priority - encoded in URL)
    // 2. Alignment URL file
    // 3. Auto-align (fallback)
    if (state.splatLoaded || state.modelLoaded || state.pointcloudLoaded) {
        // Wait a moment for objects to fully initialize
        await new Promise(resolve => setTimeout(resolve, TIMING.URL_MODEL_LOAD_DELAY));

        if (config.inlineAlignment) {
            // Apply inline alignment from URL params
            log.info(' Applying inline alignment from URL params...');
            applyAlignmentData(config.inlineAlignment);
        } else if (config.defaultAlignmentUrl) {
            // Load alignment from URL file
            const alignmentLoaded = await loadAlignmentFromUrl(config.defaultAlignmentUrl);
            if (!alignmentLoaded && state.splatLoaded && state.modelLoaded) {
                // Fallback to auto-align if alignment URL fetch failed
                log.info(' Alignment URL failed, falling back to auto-center-align...');
                autoCenterAlign();
            }
        } else if (state.splatLoaded && state.modelLoaded) {
            // No alignment provided, run auto-center-align
            log.info('Both files loaded from URL, running auto-center-align...');
            autoCenterAlign();
        }
    }
}

// URL loaders — thin wrappers around file-handlers.js with progress UI
async function loadSplatFromUrl(url: string) {
    return loadSplatFromUrlCtrl(url, createFileInputDeps());
}

async function loadModelFromUrl(url: string) {
    return loadModelFromUrlCtrl(url, createFileInputDeps());
}

// ============================================================
// Point cloud loading - URL wrapper
// ============================================================

function createPointcloudDeps(): LoadPointcloudDeps {
    return {
        pointcloudGroup,
        state,
        archiveCreator,
        callbacks: {
            onPointcloudLoaded: (object: any, file: any, pointCount: number, blob: Blob) => {
                // Detect point cloud format from filename
                const pcName = typeof file === 'string' ? file : (file?.name || '');
                const pcExt = pcName.split('.').pop()?.toLowerCase() || 'e57';
                state.pointcloudFormat = pcExt;
                assets.pointcloudBlob = blob;
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();
                updateObjectSelectButtons();

                // Update UI
                const fileName = file.name || file;
                document.getElementById('pointcloud-filename').textContent = fileName;
                const pcPointsEl = document.getElementById('pointcloud-points');
                if (pcPointsEl) {
                    pcPointsEl.textContent = pointCount.toLocaleString();
                    const pcRow = document.getElementById('pointcloud-points-row');
                    if (pcRow) pcRow.style.display = '';
                }
                updatePronomRegistry(state);
                enableRemoveBtn('btn-remove-pointcloud', true);
            }
        }
    };
}

async function loadPointcloudFromUrl(url: string) {
    return loadPointcloudFromUrlCtrl(url, createFileInputDeps());
}

// ============================================================
// Alignment functions - wrappers for alignment.js module
// ============================================================

// Toggle landmark alignment mode
function toggleAlignment() {
    if (!splatMesh || !modelGroup || modelGroup.children.length === 0) {
        notify.warning('Both splat and model must be loaded for alignment');
        return;
    }
    // Update refs in case assets loaded after init
    landmarkAlignment.updateRefs(splatMesh, modelGroup);
    if (landmarkAlignment.isActive()) {
        landmarkAlignment.cancel();
    } else {
        landmarkAlignment.start();
    }
}

// Auto center align - simple bounding-box center match on load
function autoCenterAlign() {
    autoCenterAlignHandler(createAlignmentDeps());
}

// Antialiasing toggle — enable AA when a model is on screen (meshes benefit
// from MSAA), disable when only a splat is displayed (no visual benefit, pure
// GPU cost).  Called at ~2 Hz from the status-bar update block.
let _antialiasUpdatePending = false;
function updateAntialias() {
    if (_antialiasUpdatePending || !sceneManager) return;
    // Don't toggle AA until content is loaded — avoids a wasteful renderer
    // recreation at startup when the default (AA on) already matches what we want.
    if (!state.splatLoaded && !state.modelLoaded && !state.pointcloudLoaded) return;
    const needsAA = state.modelLoaded;
    _antialiasUpdatePending = true;
    sceneManager.setAntialias(needsAA).finally(() => { _antialiasUpdatePending = false; });
}

// Animation loop
let animationErrorCount = 0;
const MAX_ANIMATION_ERRORS = 10;
const fpsElement = document.getElementById('fps-counter');
let _statusBarFrameCount = 0;

// Camera dirty tracking — skip marker DOM updates when camera is stationary
const _prevCamPos = new THREE.Vector3();
const _prevCamQuat = new THREE.Quaternion();
let _markersDirty = true; // Start dirty so first frame always updates
const _clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    try {
        // Update active camera controls
        if (flyControls && flyControls.enabled) {
            flyControls.update();
        } else if (!annotationSystem?.isAnimating && !isPreviewAnimating()) {
            controls.update();
            // Only sync right controls when in split view (avoids unnecessary math per frame)
            if (state.displayMode === 'split') {
                controlsRight.target.copy(controls.target);
                controlsRight.update();
            }
        }

        // Track orbit center line to current pivot point
        sceneManager.updateOrbitCenterLine(controls.target);

        // Render using scene manager (handles split view)
        sceneManager.render(state.displayMode, splatMesh, modelGroup, pointcloudGroup, stlGroup);

        // Update cross-section plane (syncs THREE.Plane with gizmo anchor each frame)
        if (crossSection) crossSection.updatePlane();

        // Update flight path playback
        // Always get delta (keeps clock ticking even when not playing)
        // Clamp to 100ms to avoid huge first-frame jump (Clock starts on construction)
        const dt = Math.min(_clock.getDelta(), 0.1);
        if (flightPathManager?.isPlaying) {
            flightPathManager.updatePlayback(dt);
        }

        // Check if camera moved since last frame (skip marker DOM updates when idle)
        const camMoved = _markersDirty
            || !camera.position.equals(_prevCamPos)
            || !camera.quaternion.equals(_prevCamQuat);
        if (camMoved) {
            _prevCamPos.copy(camera.position);
            _prevCamQuat.copy(camera.quaternion);
            _markersDirty = false;

            // Update annotation marker positions
            if (annotationSystem) {
                annotationSystem.updateMarkerPositions();
            }

            // Update measurement marker positions
            if (measurementSystem) {
                measurementSystem.updateMarkerPositions();
            }

            // Update alignment marker positions
            if (landmarkAlignment) {
                landmarkAlignment.updateMarkerPositions();
            }

            // Update annotation popup position to follow marker
            updateAnnotationPopupPosition();
        }

        sceneManager.updateFPS(fpsElement);

        // Update status bar (~2 Hz to avoid DOM thrashing)
        _statusBarFrameCount++;
        if (_statusBarFrameCount >= 30) {
            _statusBarFrameCount = 0;
            const ri = renderer?.info;
            updateStatusBar({
                fps: sceneManager.lastFPS ?? 0,
                renderer: sceneManager.rendererType ?? 'WebGL',
                tris: ri?.render?.triangles ?? 0,
                splats: splatMesh?.packedSplats?.numSplats ?? 0,
                cameraMode: (flyControls && flyControls.enabled) ? 'Fly' : 'Orbit',
                filename: state.archiveFileName ?? ''
            });
            // Toggle antialiasing based on content (model loaded → AA on)
            updateAntialias();
        }

        // Reset error count on successful frame
        animationErrorCount = 0;
    } catch (e) {
        animationErrorCount++;
        if (animationErrorCount <= MAX_ANIMATION_ERRORS) {
            log.error(' Animation loop error:', e);
        }
        if (animationErrorCount === MAX_ANIMATION_ERRORS) {
            log.error(' Suppressing further animation errors...');
        }
    }
}

// Initialize when DOM is ready
log.info(' Setting up initialization, readyState:', document.readyState);

async function startApp() {
    // Apply browser tab title from env var (APP_TITLE, set in config.js.template)
    const appTitle = window.APP_CONFIG?.appTitle;
    if (appTitle) document.title = appTitle;

    // Belt-and-suspenders: if kioskLock is active server-side but kiosk flag
    // was somehow cleared (e.g., config tampering), force kiosk mode anyway
    if (window.APP_CONFIG?.kioskLock && !window.APP_CONFIG?.kiosk) {
        console.warn('[main] kioskLock active but kiosk flag was false — forcing kiosk mode');
        window.APP_CONFIG.kiosk = true;
    }

    // In kiosk mode, delegate to kiosk-main.js (slim viewer-only entry point)
    if (window.APP_CONFIG?.kiosk) {
        log.info(' Kiosk mode detected, loading kiosk-main.js');
        try {
            const { init: kioskInit } = await import('./modules/kiosk-main.js');
            await kioskInit();
        } catch (e) {
            log.error(' Kiosk init error:', e);
            log.error(' Stack:', e.stack);
        }
        return;
    }

    try {
        await init();
    } catch (e) {
        log.error(' Init error:', e);
        log.error(' Stack:', e.stack);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        log.info(' DOMContentLoaded fired');
        startApp();
    });
} else {
    log.info(' DOM already ready');
    startApp();
}
