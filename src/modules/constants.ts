/**
 * Application Constants
 *
 * Centralized configuration values for the Gaussian Splat & Mesh Viewer.
 * Edit these values to customize the application behavior.
 */

// =============================================================================
// CAMERA SETTINGS
// =============================================================================

export const CAMERA = {
    FOV: 60,                          // Field of view in degrees
    NEAR: 0.1,                        // Near clipping plane
    FAR: 1000,                        // Far clipping plane
    INITIAL_POSITION: { x: 0, y: 1, z: 3 }  // Starting camera position
} as const;

// =============================================================================
// ORBIT CONTROLS
// =============================================================================

export const ORBIT_CONTROLS = {
    DAMPING_FACTOR: 0.05,             // Smoothing factor for camera movement
    MIN_DISTANCE: 0.1,                // Minimum zoom distance
    MAX_DISTANCE: 100,                // Maximum zoom distance
    AUTO_ROTATE_SPEED: 2.0            // ~30s per revolution at 60fps (matches Sketchfab default)
} as const;

// =============================================================================
// RENDERER SETTINGS
// =============================================================================

export const RENDERER = {
    MAX_PIXEL_RATIO: 2                // Cap pixel ratio to prevent performance issues on high-DPI displays
} as const;

// =============================================================================
// LIGHTING CONFIGURATION
// =============================================================================

export const LIGHTING = {
    AMBIENT: {
        COLOR: 0xffffff,
        INTENSITY: 0.8
    },
    HEMISPHERE: {
        SKY_COLOR: 0xffffff,
        GROUND_COLOR: 0x444444,
        INTENSITY: 0.6
    },
    DIRECTIONAL_1: {
        COLOR: 0xffffff,
        INTENSITY: 1.5,
        POSITION: { x: 5, y: 5, z: 5 }
    },
    DIRECTIONAL_2: {
        COLOR: 0xffffff,
        INTENSITY: 0.5,
        POSITION: { x: -5, y: 3, z: -5 }
    }
} as const;

// =============================================================================
// GRID HELPER
// =============================================================================

export const GRID = {
    SIZE: 20,                         // Grid size in units
    DIVISIONS: 20,                    // Number of grid divisions
    COLOR_PRIMARY: 0x4a4a6a,          // Main grid line color
    COLOR_SECONDARY: 0x2a2a3a,        // Secondary grid line color
    Y_OFFSET: -0.01                   // Slight offset to avoid z-fighting
} as const;

// =============================================================================
// SCENE COLORS
// =============================================================================

export const COLORS = {
    // Default scene background
    SCENE_BACKGROUND: 0x1a1a2e,

    // Default material color for meshes without materials
    DEFAULT_MATERIAL: 0x888888,

    // Background color presets (matching CSS button data-color attributes)
    PRESETS: {
        DARK_PURPLE: '#1a1a2e',
        DARK_GRAY: '#2d2d2d',
        LIGHT_GRAY: '#808080',
        WHITE: '#f0f0f0',
        EDITORIAL_NAVY: '#11304e'
    }
} as const;

// =============================================================================
// TIMING / DELAYS (milliseconds)
// =============================================================================

export const TIMING = {
    // Delay after loading splat to ensure rendering is ready
    SPLAT_LOAD_DELAY: 100,

    // Delay after loading model from blob
    MODEL_LOAD_DELAY: 100,

    // Delay after loading point cloud
    POINTCLOUD_LOAD_DELAY: 100,

    // Delay before auto-alignment after archive load
    AUTO_ALIGN_DELAY: 500,

    // Delay before revoking blob URLs (cleanup)
    BLOB_REVOKE_DELAY: 5000,

    // Delay for URL-based model loading
    URL_MODEL_LOAD_DELAY: 500
} as const;

// =============================================================================
// MATERIAL DEFAULTS
// =============================================================================

export const MATERIAL = {
    DEFAULT_METALNESS: 0.1,
    DEFAULT_ROUGHNESS: 0.8,
    DEFAULT_OPACITY: 1.0
} as const;

// =============================================================================
// ASSET STATE (used by lazy archive loading)
// =============================================================================

export const ASSET_STATE = {
    UNLOADED: 'unloaded',
    LOADING: 'loading',
    LOADED: 'loaded',
    ERROR: 'error'
} as const;

// =============================================================================
// QUALITY TIER (SD/HD quality-aware loading)
// =============================================================================

export const QUALITY_TIER = {
    SD: 'sd',     // proxy / display-quality assets
    HD: 'hd',     // full resolution assets
    AUTO: 'auto'  // device-detected default
} as const;

export const DEVICE_THRESHOLDS = {
    LOW_MEMORY_GB: 4,         // navigator.deviceMemory threshold
    LOW_CORES: 4,             // navigator.hardwareConcurrency threshold
    MOBILE_WIDTH_PX: 768,     // screen.width threshold
    LOW_MAX_TEXTURE: 8192,    // gl.MAX_TEXTURE_SIZE threshold
    GPU_BENCHMARK_HD: 1000,   // FPS at 410k tris for 2 points (discrete GPU territory)
    GPU_BENCHMARK_MID: 500,   // FPS at 410k tris for 1 point (mid-range)
    GPU_BENCHMARK_MIN: 500,   // Hard gate: below this FPS → force SD regardless of static score
    // TODO: Make GPU_BENCHMARK thresholds overridable via
    // APP_CONFIG env vars (same pattern as LOD_BUDGET_SD/LOD_BUDGET_HD)
} as const;

// =============================================================================
// MESH LOD / PROXY THRESHOLDS
// =============================================================================

export const MESH_LOD = {
    // Face count above which a mobile warning is shown (advisory only)
    MOBILE_WARNING_FACES: 300_000,
    // Face count above which a general GPU memory warning is shown (advisory only)
    DESKTOP_WARNING_FACES: 10_000_000
} as const;

// =============================================================================
// SHADOW SETTINGS
// =============================================================================

export const SHADOWS = {
    MAP_SIZE: 4096,                   // Shadow map resolution (px)
    CAMERA_SIZE: 10,                  // Shadow camera frustum half-width
    CAMERA_NEAR: 0.5,
    CAMERA_FAR: 50,
    BIAS: 0.0001,                     // VSM needs slight positive bias
    NORMAL_BIAS: 0.01,
    RADIUS: 4,                        // VSM blur radius — smooth penumbra
    GROUND_PLANE_SIZE: 20,            // Shadow catcher plane size
    GROUND_PLANE_Y: -0.02             // Slightly below grid to avoid z-fighting
} as const;

// =============================================================================
// ENVIRONMENT MAP PRESETS
// =============================================================================

// =============================================================================
// WALKTHROUGH (guided tour playback)
// =============================================================================

export const WALKTHROUGH = {
    DEFAULT_FLY_DURATION: 1500,      // ms for fly transition between stops
    DEFAULT_FADE_DURATION: 400,      // ms per half of fade (total visible fade = 2x)
    DEFAULT_DWELL_TIME: 5000,        // ms to pause at each stop before auto-advancing
    DEFAULT_TRANSITION: 'fly' as const,
    MIN_FLY_DURATION: 200,
    MAX_FLY_DURATION: 10000,
    MAX_DWELL_TIME: 60000,
    AUTOPLAY_START_DELAY: 1500,      // ms delay before autoplay begins after load
} as const;

// =============================================================================
// ENVIRONMENT MAP PRESETS
// =============================================================================

export const ENVIRONMENT = {
    PRESETS: [
        { name: 'None', url: '' },
        { name: 'Outdoor', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_43d_clear_puresky_1k.hdr' },
        { name: 'Studio', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr' },
        { name: 'Sunset', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr' }
    ]
} as const;

// =============================================================================
// POST-PROCESSING EFFECT DEFAULTS
// =============================================================================

export const POST_PROCESSING = {
    SSAO: { enabled: false, radius: 0.5, intensity: 1.0 },
    BLOOM: { enabled: false, strength: 0.5, radius: 0.4, threshold: 0.85 },
    SHARPEN: { enabled: false, intensity: 0.3 },
    VIGNETTE: { enabled: false, intensity: 0.5, offset: 1.0 },
    CHROMATIC_ABERRATION: { enabled: false, intensity: 0.005 },
    COLOR_BALANCE: { enabled: false, shadows: [0, 0, 0] as [number, number, number], midtones: [0, 0, 0] as [number, number, number], highlights: [0, 0, 0] as [number, number, number] },
    GRAIN: { enabled: false, intensity: 0.05 },
} as const;

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
        errorThreshold: 0.5,
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
        errorThreshold: 0.2,
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
        errorThreshold: 0.1,
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
        errorThreshold: 0.05,
        lockBorder: true,
        preserveUVSeams: true,
        textureMaxRes: 2048,
        textureFormat: 'jpeg',
        textureQuality: 0.90,
    },
} as const;

export const DEFAULT_DECIMATION_PRESET = 'medium';

// =============================================================================
// FLIGHT LOG (drone telemetry import)
// =============================================================================

export const FLIGHT_LOG = {
    EXTENSIONS: ['.csv', '.kml', '.kmz', '.srt'],
    /** Default line color — light blue, distinct from annotation/measurement orange */
    LINE_COLOR: 0x4FC3F7,
    /** Max rendered segments before subsampling kicks in */
    MAX_RENDER_POINTS: 2000,
    /** Marker sphere radius (scene units) */
    MARKER_RADIUS: 0.02,
} as const;
