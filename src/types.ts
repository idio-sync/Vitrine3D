// ===== Union Types =====

export type DisplayMode = 'splat' | 'model' | 'pointcloud' | 'both' | 'split' | 'stl';
export type SelectedObject = 'splat' | 'model' | 'pointcloud' | 'stl' | 'cad' | 'drawing' | 'flightpath' | 'colmap' | 'both' | 'none';
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type RotationPivot = 'object' | 'origin';
export type QualityTier = 'sd' | 'hd';
export type AssetStateValue = 'unloaded' | 'loading' | 'loaded' | 'error';
export type MarkerDensity = 'off' | 'sparse' | 'all';
export type SfmDisplayMode = 'frustums' | 'markers';

export interface ViewDefaults {
    sfmCameras: {
        visible: boolean;
        displayMode: SfmDisplayMode;
    };
    flightPath: {
        visible: boolean;
        lineColor: string;
        lineOpacity: number;
        showMarkers: boolean;
        markerDensity: MarkerDensity;
    };
}

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
    dracoCompress: boolean;
}

export interface DecimationResult {
    faceCount: number;
    vertexCount: number;
    originalFaceCount: number;
    blob: Blob;
    preset: string;
    options: DecimationOptions;
}

// ===== Main State =====

export interface AppState {
    displayMode: DisplayMode;
    selectedObject: SelectedObject;
    transformMode: TransformMode;
    rotationPivot: RotationPivot;
    scaleLockProportions: boolean;
    splatLoaded: boolean;
    modelLoaded: boolean;
    pointcloudLoaded: boolean;
    stlLoaded: boolean;
    cadLoaded: boolean;
    drawingLoaded: boolean;
    flightPathLoaded: boolean;
    colmapLoaded: boolean;
    currentDrawingUrl: string | null;
    currentCadUrl: string | null;
    modelOpacity: number;
    modelWireframe: boolean;
    modelMatcap: boolean;
    matcapStyle: string;
    modelNormals: boolean;
    modelRoughness: boolean;
    modelMetalness: boolean;
    modelSpecularF0: boolean;
    pointcloudPointSize: number;
    pointcloudOpacity: number;
    controlsVisible: boolean;
    currentSplatUrl: string | null;
    currentModelUrl: string | null;
    currentPointcloudUrl: string | null;
    // Archive state
    archiveLoaded: boolean;
    archiveManifest: any | null;         // Manifest shape varies per version
    archiveFileName: string | null;
    currentArchiveUrl: string | null;
    archiveLoader: any | null;           // ArchiveLoader instance (JS module, untyped)
    assetStates: Record<string, string>;  // Values are ASSET_STATE constants (untyped JS)
    viewingProxy: boolean;
    qualityTier: string;                   // 'sd' | 'hd' — widened because constants.js is untyped
    meshBackgroundColor: string | null;
    splatBackgroundColor: string | null;
    qualityResolved: string;               // 'sd' | 'hd' — widened because constants.js is untyped
    imageAssets: Map<string, any>;         // Map of asset key → blob URL or metadata
    screenshots: Array<{ id: string; blob: Blob; dataUrl: string; timestamp: number }>;
    manualPreviewBlob: Blob | null;
    // Decimation / SD proxy state
    proxyMeshGroup: any | null;
    proxyMeshSettings: DecimationOptions | null;
    proxyMeshFaceCount: number | null;
    // HD web optimization (revert support)
    originalMeshBlob: Blob | null;
    originalMeshGroup: any | null;
    meshOptimized: boolean;
    meshOptimizationSettings: {
        targetFaces: number;
        dracoEnabled: boolean;
        originalFaces: number;
        resultFaces: number;
    } | null;
    // Detected asset format extensions (set during file load)
    meshFormat: string | null;
    pointcloudFormat: string | null;
    splatFormat: string | null;
    splatLodEnabled: boolean;             // "Generate Splat LOD at archive export" checkbox
    viewDefaults: ViewDefaults;           // Archive-embeddable overlay display defaults
    meshVertexCount?: number;              // Dynamically set by file-handlers.js after mesh load
    meshTextureInfo?: import('./modules/utilities.js').TextureInfo;  // Dynamically set after mesh load
}

// ===== Scene References =====

export interface SceneRefs {
    readonly scene: any;              // THREE.Scene
    readonly camera: any;             // THREE.PerspectiveCamera
    readonly renderer: any;           // THREE.WebGLRenderer
    readonly controls: any;           // OrbitControls
    readonly transformControls: any;  // TransformControls
    readonly splatMesh: any;          // SplatMesh | null
    readonly modelGroup: any;         // THREE.Group
    readonly pointcloudGroup: any;    // THREE.Group
    readonly stlGroup: any;           // THREE.Group
    readonly cadGroup: any;           // THREE.Group
    readonly drawingGroup: any;       // THREE.Group
    readonly flightPathGroup: any;    // THREE.Group
    readonly colmapGroup: any;        // THREE.Group
    readonly flyControls: any;        // FlyControls | null
    readonly annotationSystem: any;   // AnnotationSystem | null
    readonly archiveCreator: any;     // ArchiveCreator | null
    readonly measurementSystem: any;  // MeasurementSystem | null
    readonly landmarkAlignment: any;  // LandmarkAlignment | null
    readonly ambientLight: any;       // THREE.AmbientLight
    readonly hemisphereLight: any;    // THREE.HemisphereLight
    readonly directionalLight1: any;  // THREE.DirectionalLight
    readonly directionalLight2: any;  // THREE.DirectionalLight
}

// ===== Common UI Callback Shapes =====

export interface UICallbacks {
    showLoading: (msg: string, withProgress?: boolean) => void;
    hideLoading: () => void;
    updateProgress?: (percent: number, stage?: string) => void;
}

// ===== 3D Data Types =====

/** 3D position/rotation/scale transform, used in alignment data and archive manifests. */
export interface Transform {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: number | [number, number, number];
}

/** Normalize a scale value from manifest (scalar or 3-tuple) into [x, y, z]. */
export function normalizeScale(s: number | [number, number, number] | undefined): [number, number, number] {
    if (s === undefined || s === null) return [1, 1, 1];
    if (Array.isArray(s)) return s;
    return [s, s, s];
}

/** A 3D annotation placed on a surface via raycasting. */
export interface Annotation {
    id: string;
    title: string;
    body: string;
    position: { x: number; y: number; z: number };
    camera_target: { x: number; y: number; z: number };
    camera_position: { x: number; y: number; z: number };
    /** Camera orientation quaternion — captures exact view direction. Optional for backward compat with older archives. */
    camera_quaternion?: { x: number; y: number; z: number; w: number };
    // QA / defect marking fields (Phase 3)
    severity?: 'low' | 'medium' | 'high' | 'critical';
    category?: 'surface_defect' | 'gap' | 'missing_data' | 'scan_artifact' | 'dimensional_variance' | 'other';
    status?: 'pass' | 'fail' | 'review';
    qa_notes?: string;
}

// ===== Walkthrough =====

export type WalkthroughTransition = 'fly' | 'fade' | 'cut';

/** A single stop in a guided walkthrough sequence. */
export interface WalkthroughStop {
    id: string;
    title: string;
    description?: string;
    camera_position: { x: number; y: number; z: number };
    camera_target: { x: number; y: number; z: number };
    camera_quaternion?: { x: number; y: number; z: number; w: number };
    /** Optional link to an existing annotation — shows marker + popup on arrival. */
    annotation_id?: string;
    /** How the camera arrives at this stop. First stop's transition is used when looping or jumping. */
    transition: WalkthroughTransition;
    /** Camera fly duration in ms (for 'fly' transitions). */
    fly_duration?: number;
    /** Fade duration per half in ms (for 'fade' transitions — total is 2x). */
    fade_duration?: number;
    /** Time in ms to dwell before auto-advancing. 0 = manual advance only. */
    dwell_time: number;
}

/** A guided walkthrough — ordered sequence of camera stops with transitions. */
export interface Walkthrough {
    title: string;
    stops: WalkthroughStop[];
    auto_play?: boolean;
    loop?: boolean;
}

// ===== Flight Path =====

/** A single telemetry point from a drone flight log. */
export interface FlightPoint {
    x: number;        // local coords (converted from GPS)
    y: number;        // altitude mapped to Y-up
    z: number;        // local coords
    lat: number;      // original GPS latitude
    lon: number;      // original GPS longitude
    alt: number;      // altitude in meters
    timestamp: number; // ms since flight start
    speed?: number;    // m/s ground speed
    gimbalPitch?: number;
    gimbalYaw?: number;
    heading?: number;  // drone heading degrees
}

/** Parsed flight path data with metadata, ready for rendering. */
export interface FlightPathData {
    id: string;              // e.g. 'flightpath_0'
    points: FlightPoint[];   // full parsed data
    sourceFormat: string;    // 'dji-csv' | 'kml' | 'srt' | 'dji-txt'
    fileName: string;        // original filename
    originGps: [number, number]; // [lat, lon] of first point
    durationS: number;       // total flight duration in seconds
    maxAltM: number;         // max altitude in meters
    trimStart?: number;      // index into points[] — first visible point
    trimEnd?: number;        // index into points[] — last visible point (inclusive)
}

// ===== Colmap =====

/** Parsed Colmap camera intrinsics */
export interface ColmapIntrinsics {
    cameraId: number;
    modelId: number;
    width: number;
    height: number;
    focalLength: number; // fx (or f for simple models)
    cx: number;
    cy: number;
}

/** Parsed Colmap image (camera extrinsics + filename) */
export interface ColmapCamera {
    imageId: number;
    quaternion: [number, number, number, number]; // [x, y, z, w] (Three.js order)
    position: [number, number, number]; // world-space camera position
    cameraId: number; // references ColmapIntrinsics
    name: string; // image filename
    focalLength: number; // resolved from intrinsics
}

// ===== Asset Store =====

export interface AssetStore {
    splatBlob: Blob | null;
    meshBlob: Blob | null;
    proxyMeshBlob: Blob | null;
    proxySplatBlob: Blob | null;
    pointcloudBlob: Blob | null;
    cadBlob: Blob | null;
    cadFileName: string | null;
    flightPathBlobs: Array<{ blob: Blob; fileName: string; trimStart?: number; trimEnd?: number }>;
    colmapBlobs: Array<{ camerasBlob: Blob; imagesBlob: Blob; points3DBuffer?: ArrayBuffer }>;
    sourceFiles: Array<{ name: string; blob: Blob }>;
}

// ===== Library Collections =====

/** A named collection of archives, displayed as a group in the library and kiosk. */
export interface Collection {
    id: number;
    slug: string;
    name: string;
    description: string;
    thumbnail: string | null;
    theme: string | null;
    archiveCount: number;
    created_at: string;
    updated_at: string;
}

/** An archive's membership in a collection, with sort order. */
export interface CollectionArchive {
    collection_id: number;
    archive_id: number;
    sort_order: number;
}

// ===== Module Dependencies =====

export interface ExportDeps {
    sceneRefs: Pick<SceneRefs, 'renderer' | 'scene' | 'camera' | 'controls' | 'splatMesh' | 'modelGroup' | 'pointcloudGroup' | 'cadGroup' | 'flightPathGroup' | 'colmapGroup' | 'annotationSystem' | 'archiveCreator' | 'measurementSystem'>;
    state: AppState;
    tauriBridge: any | null;
    ui: {
        showLoading: (msg: string, withProgress?: boolean) => void;
        hideLoading: () => void;
        updateProgress: (percent: number, stage?: string) => void;
        hideExportPanel: () => void;
        showExportPanelHandler: () => void;
        showMetadataPanel: () => void;
    };
    metadata: {
        collectMetadata: () => any;
        prefillMetadataFromArchive: (manifest: any) => void;
        populateMetadataDisplay: () => void;
        loadAnnotationsFromArchive: (annotations: any[]) => void;
    };
}

export interface ArchivePipelineDeps {
    sceneRefs: Pick<SceneRefs, 'scene' | 'camera' | 'controls' | 'renderer' | 'splatMesh' | 'modelGroup' | 'pointcloudGroup' | 'cadGroup' | 'drawingGroup'>;
    state: AppState;
    sceneManager: any;
    setSplatMesh: (mesh: any) => void;
    createFileHandlerDeps: () => any;
    ui: {
        showLoading: (msg: string, withProgress?: boolean) => void;
        hideLoading: () => void;
        updateProgress: (percent: number, stage?: string | null) => void;
        showInlineLoading: (type: string) => void;
        hideInlineLoading: (type: string) => void;
        updateVisibility: () => void;
        updateTransformInputs: () => void;
        updateModelOpacity: () => void;
        updateModelWireframe: () => void;
    };
    alignment: {
        applyAlignmentData: (data: any) => void;
        storeLastPositions: () => void;
    };
    annotations: {
        loadAnnotationsFromArchive: (annotations: any[]) => void;
    };
    metadata: {
        prefillMetadataFromArchive: (manifest: any) => void;
        clearArchiveMetadataHandler: () => void;
    };
    sourceFiles: {
        updateSourceFilesUI: () => void;
    };
    measurementSystem?: any;
    renderFlightPaths?: () => Promise<void>;
    colmap?: {
        loadFromBuffers: (cameras: ArrayBuffer, images: ArrayBuffer) => void;
        loadPoints3D?: (positions: Float64Array, count: number) => void;
        points3DBuffer?: ArrayBuffer | null;
    };
}

export interface EventWiringDeps {
    sceneRefs: Pick<SceneRefs, 'scene' | 'camera' | 'controls' | 'transformControls' | 'splatMesh' | 'modelGroup' | 'pointcloudGroup' | 'stlGroup' | 'drawingGroup' | 'flyControls' | 'ambientLight' | 'hemisphereLight' | 'directionalLight1' | 'directionalLight2'>;
    state: AppState;
    sceneManager: any;
    files: {
        handleSplatFile: (e: Event) => void;
        handleModelFile: (e: Event) => void;
        handleArchiveFile: (e: Event) => void;
        handlePointcloudFile: (e: Event) => void;
        handleProxyMeshFile: (e: Event) => void;
        handleProxySplatFile: (e: Event) => void;
        handleSTLFile: (e: Event) => void;
        handleCADFile: (e: Event) => void;
        handleDrawingFile: (e: Event) => void;
        handleSourceFilesInput: (e: Event) => void;
        handleLoadArchiveFromUrlPrompt: () => void;
        handleLoadFullResMesh: () => void;
        switchQualityTier: (tier: string) => void;
        removeSplat: () => void;
        removeModel: () => void;
        removePointcloud: () => void;
        removeSTL: () => void;
        removeCAD: () => void;
        removeDrawing: () => void;
        removeFlightPath: () => void;
    };
    display: {
        setDisplayMode: (mode: string) => void;
        updateModelOpacity: () => void;
        updateModelWireframe: () => void;
        updateModelMatcap: () => void;
        updateModelNormals: () => void;
        updateModelRoughnessView: () => void;
        updateModelMetalnessView: () => void;
        updateModelSpecularF0View: () => void;
        toggleGridlines: (show: boolean) => void;
        setBackgroundColor: (hex: string) => void;
    };
    camera: {
        resetCamera: () => void;
        fitToView: () => void;
        resetOrbitCenter: () => void;
        toggleFlyMode: () => void;
    };
    alignment: {
        resetAlignment: () => void;
        toggleAlignment: () => void;
        centerAtOrigin: () => void;
    };
    annotations: {
        toggleAnnotationMode: () => void;
        saveAnnotation: () => void;
        cancelAnnotation: () => void;
        updateSelectedAnnotationCamera: () => void;
        deleteSelectedAnnotation: () => void;
        dismissPopup: () => void;
    };
    export: {
        showExportPanel: () => void;
        downloadArchive: () => void;
        downloadGenericViewer: () => void;
        saveToLibrary: () => void;
    };
    screenshots: {
        downloadScreenshot: () => void;
        captureScreenshotToList: () => void;
        showViewfinder: () => void;
        captureManualPreview: () => void;
        hideViewfinder: () => void;
    };
    metadata: {
        hideMetadataPanel: () => void;
        toggleMetadataDisplay: () => void;
        setupMetadataSidebar: () => void;
        populateMetadataDisplay: () => void;
    };
    share: {
        copyShareLink: () => void;
    };
    transform: {
        setSelectedObject: (selection: SelectedObject) => void;
        setTransformMode: (mode: TransformMode) => void;
        resetTransform: () => void;
        updateTransformInputs: () => void;
    };
    crossSection: {
        active: boolean;
        start: (center: import('three').Vector3) => void;
        stop: () => void;
        setMode: (mode: 'translate' | 'rotate') => void;
        setAxis: (axis: 'x' | 'y' | 'z') => void;
        flip: () => void;
        reset: (center: import('three').Vector3) => void;
    };
    walkthrough: {
        addStop: () => void;
        addStopFromAnnotation: () => void;
        deleteStop: () => void;
        updateStopCamera: () => void;
        playPreview: () => void;
        stopPreview: () => void;
    };
    recording?: {
        startRecording: () => void;
        stopRecording: () => void;
    };
    tauri: {
        wireNativeDialogsIfAvailable: () => void;
    };
    undo: {
        performUndo: () => void;
        performRedo: () => void;
        captureBeforeNumericEdit: () => void;
        pushAfterNumericEdit: () => void;
    };
    colmap: {
        loadFromBuffers: (cameras: ArrayBuffer, images: ArrayBuffer) => void;
        setDisplayMode: (mode: string) => void;
        setFrustumScale: (scale: number) => void;
        alignFlightPath: () => void;
        hasData: boolean;
        hasPoints3D: boolean;
        loadPoints3D: (positions: Float64Array, count: number) => void;
        points3DBuffer: ArrayBuffer | null;
        alignFromCameraData: () => Promise<void>;
    };
    overlay?: {
        toggleSfm: (visible: boolean) => void;
        toggleFlightPath: (visible: boolean) => void;
    };
    validateUrl?: (url: string, resourceType: string) => { valid: boolean; url: string; error: string };
}

export interface PostProcessingEffectConfig {
    ssao: { enabled: boolean; radius: number; intensity: number };
    bloom: { enabled: boolean; strength: number; radius: number; threshold: number };
    sharpen: { enabled: boolean; intensity: number };
    vignette: { enabled: boolean; intensity: number; offset: number };
    chromaticAberration: { enabled: boolean; intensity: number };
    colorBalance: {
        enabled: boolean;
        shadows: [number, number, number];
        midtones: [number, number, number];
        highlights: [number, number, number];
    };
    grain: { enabled: boolean; intensity: number };
}
