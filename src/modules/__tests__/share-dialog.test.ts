/**
 * Tests for share-dialog.ts URL generation logic
 *
 * Since buildShareUrl, addAlignmentParams, and formatVec3 are module-private,
 * we re-implement the pure URL-building logic here for unit testing.
 * This follows the pattern from archive-loader.test.ts.
 */
import { describe, it, expect } from 'vitest';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface Transform {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale?: number;
}

interface ShareState {
    archiveUrl?: string | null;
    splatUrl?: string | null;
    modelUrl?: string | null;
    pointcloudUrl?: string | null;
    displayMode?: string;
    splatTransform?: Transform | null;
    modelTransform?: Transform | null;
    pointcloudTransform?: Transform | null;
}

interface ShareOptions {
    displayMode: string;
    controlsPanel: string;
    toolbar: string;
    sidebar: string;
}

// =============================================================================
// RE-IMPLEMENTED LOGIC FOR TESTING
// =============================================================================

/**
 * Format a vector3 array to URL parameter string with 4 decimal precision
 */
function formatVec3(arr: [number, number, number]): string {
    return arr.map(n => parseFloat(n.toFixed(4))).join(',');
}

/**
 * Add alignment/transform parameters to URLSearchParams
 */
function addAlignmentParams(params: URLSearchParams, state: ShareState): void {
    if (state.splatTransform) {
        const t = state.splatTransform;
        const pos: [number, number, number] = [t.position.x, t.position.y, t.position.z];
        const rot: [number, number, number] = [t.rotation.x, t.rotation.y, t.rotation.z];

        if (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0) {
            params.set('sp', formatVec3(pos));
        }
        if (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0) {
            params.set('sr', formatVec3(rot));
        }
        if (t.scale !== undefined && t.scale !== 1) {
            params.set('ss', parseFloat(t.scale.toFixed(4)).toString());
        }
    }

    if (state.modelTransform) {
        const t = state.modelTransform;
        const pos: [number, number, number] = [t.position.x, t.position.y, t.position.z];
        const rot: [number, number, number] = [t.rotation.x, t.rotation.y, t.rotation.z];

        if (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0) {
            params.set('mp', formatVec3(pos));
        }
        if (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0) {
            params.set('mr', formatVec3(rot));
        }
        if (t.scale !== undefined && t.scale !== 1) {
            params.set('ms', parseFloat(t.scale.toFixed(4)).toString());
        }
    }

    if (state.pointcloudTransform) {
        const t = state.pointcloudTransform;
        const pos: [number, number, number] = [t.position.x, t.position.y, t.position.z];
        const rot: [number, number, number] = [t.rotation.x, t.rotation.y, t.rotation.z];

        if (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0) {
            params.set('pp', formatVec3(pos));
        }
        if (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0) {
            params.set('pr', formatVec3(rot));
        }
        if (t.scale !== undefined && t.scale !== 1) {
            params.set('ps', parseFloat(t.scale.toFixed(4)).toString());
        }
    }
}

/**
 * Build share URL based on state and options
 */
function buildShareUrl(
    baseUrl: string,
    state: ShareState,
    options: ShareOptions,
    includeAlignment: boolean = false
): string {
    const params = new URLSearchParams();

    // Add content URLs
    if (state.archiveUrl) {
        params.set('archive', state.archiveUrl);
    } else {
        if (state.splatUrl) {
            params.set('splat', state.splatUrl);
        }
        if (state.modelUrl) {
            params.set('model', state.modelUrl);
        }
        if (state.pointcloudUrl) {
            params.set('pointcloud', state.pointcloudUrl);
        }
    }

    // Add display mode (always include)
    params.set('mode', options.displayMode);

    // Add controls panel setting (only if not default)
    if (options.controlsPanel !== 'full') {
        params.set('controls', options.controlsPanel);
    }

    // Add toolbar setting (only if not default)
    if (options.toolbar !== 'show') {
        params.set('toolbar', options.toolbar);
    }

    // Add sidebar setting (only if not default)
    if (options.sidebar !== 'closed') {
        params.set('sidebar', options.sidebar);
    }

    // Add alignment data if requested and no archive URL
    if (includeAlignment && !state.archiveUrl) {
        addAlignmentParams(params, state);
    }

    return baseUrl + '?' + params.toString();
}

// =============================================================================
// UI PRESETS (from share-dialog.ts)
// =============================================================================

const UI_PRESETS = {
    full: {
        label: 'Full Editor',
        description: 'All controls and editing features',
        settings: {
            controlsPanel: 'full',
            toolbar: 'show',
            sidebar: 'closed'
        }
    },
    viewer: {
        label: 'Viewer Mode',
        description: 'View-only with metadata visible',
        settings: {
            controlsPanel: 'none',
            toolbar: 'hide',
            sidebar: 'view'
        }
    },
    kiosk: {
        label: 'Kiosk Mode',
        description: 'Clean display, no UI elements',
        settings: {
            controlsPanel: 'none',
            toolbar: 'hide',
            sidebar: 'closed'
        }
    },
    minimal: {
        label: 'Minimal',
        description: 'Toolbar only, no panels',
        settings: {
            controlsPanel: 'none',
            toolbar: 'show',
            sidebar: 'closed'
        }
    }
};

// =============================================================================
// TESTS
// =============================================================================

describe('formatVec3', () => {
    it('formats simple integer coordinates', () => {
        expect(formatVec3([1, 2, 3])).toBe('1,2,3');
    });

    it('formats with 4 decimal precision and strips trailing zeros', () => {
        expect(formatVec3([1.123456, 2.654321, 3.999999])).toBe('1.1235,2.6543,4');
    });

    it('formats all zeros', () => {
        expect(formatVec3([0, 0, 0])).toBe('0,0,0');
    });

    it('formats negative values', () => {
        expect(formatVec3([-1.5, 0, 2.5])).toBe('-1.5,0,2.5');
    });

    it('rounds very small values to zero at 4 decimals', () => {
        expect(formatVec3([0.00001, 0.00001, 0.00001])).toBe('0,0,0');
    });

    it('preserves precision for values with exactly 4 decimals', () => {
        expect(formatVec3([1.2345, 2.3456, 3.4567])).toBe('1.2345,2.3456,3.4567');
    });
});

describe('addAlignmentParams', () => {
    it('adds no params when state has no transforms', () => {
        const params = new URLSearchParams();
        const state: ShareState = {};
        addAlignmentParams(params, state);
        expect(params.toString()).toBe('');
    });

    it('adds splat position param when non-zero', () => {
        const params = new URLSearchParams();
        const state: ShareState = {
            splatTransform: {
                position: { x: 1, y: 2, z: 3 },
                rotation: { x: 0, y: 0, z: 0 }
            }
        };
        addAlignmentParams(params, state);
        expect(params.get('sp')).toBe('1,2,3');
        expect(params.has('sr')).toBe(false); // Zero rotation not added
    });

    it('does not add splat position param when all zeros', () => {
        const params = new URLSearchParams();
        const state: ShareState = {
            splatTransform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 }
            }
        };
        addAlignmentParams(params, state);
        expect(params.has('sp')).toBe(false);
    });

    it('adds splat rotation param when non-zero', () => {
        const params = new URLSearchParams();
        const state: ShareState = {
            splatTransform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0.5, y: 1.0, z: 1.5 }
            }
        };
        addAlignmentParams(params, state);
        expect(params.get('sr')).toBe('0.5,1,1.5');
        expect(params.has('sp')).toBe(false); // Zero position not added
    });

    it('adds splat scale param when not 1', () => {
        const params = new URLSearchParams();
        const state: ShareState = {
            splatTransform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: 2.5
            }
        };
        addAlignmentParams(params, state);
        expect(params.get('ss')).toBe('2.5');
    });

    it('does not add splat scale param when exactly 1', () => {
        const params = new URLSearchParams();
        const state: ShareState = {
            splatTransform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: 1
            }
        };
        addAlignmentParams(params, state);
        expect(params.has('ss')).toBe(false);
    });

    it('uses mp, mr, ms prefixes for model transform', () => {
        const params = new URLSearchParams();
        const state: ShareState = {
            modelTransform: {
                position: { x: 5, y: 6, z: 7 },
                rotation: { x: 0.1, y: 0.2, z: 0.3 },
                scale: 1.5
            }
        };
        addAlignmentParams(params, state);
        expect(params.get('mp')).toBe('5,6,7');
        expect(params.get('mr')).toBe('0.1,0.2,0.3');
        expect(params.get('ms')).toBe('1.5');
    });

    it('uses pp, pr, ps prefixes for pointcloud transform', () => {
        const params = new URLSearchParams();
        const state: ShareState = {
            pointcloudTransform: {
                position: { x: 10, y: 20, z: 30 },
                rotation: { x: 1, y: 2, z: 3 },
                scale: 0.5
            }
        };
        addAlignmentParams(params, state);
        expect(params.get('pp')).toBe('10,20,30');
        expect(params.get('pr')).toBe('1,2,3');
        expect(params.get('ps')).toBe('0.5');
    });

    it('adds multiple transform params simultaneously', () => {
        const params = new URLSearchParams();
        const state: ShareState = {
            splatTransform: {
                position: { x: 1, y: 2, z: 3 },
                rotation: { x: 0.1, y: 0.2, z: 0.3 },
                scale: 2
            },
            modelTransform: {
                position: { x: 4, y: 5, z: 6 },
                rotation: { x: 0.4, y: 0.5, z: 0.6 },
                scale: 1.5
            }
        };
        addAlignmentParams(params, state);
        expect(params.get('sp')).toBe('1,2,3');
        expect(params.get('sr')).toBe('0.1,0.2,0.3');
        expect(params.get('ss')).toBe('2');
        expect(params.get('mp')).toBe('4,5,6');
        expect(params.get('mr')).toBe('0.4,0.5,0.6');
        expect(params.get('ms')).toBe('1.5');
    });

    it('adds only rotation when position is zero', () => {
        const params = new URLSearchParams();
        const state: ShareState = {
            splatTransform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 1, y: 2, z: 3 }
            }
        };
        addAlignmentParams(params, state);
        expect(params.has('sp')).toBe(false);
        expect(params.get('sr')).toBe('1,2,3');
    });

    it('formats scale with 4 decimal precision', () => {
        const params = new URLSearchParams();
        const state: ShareState = {
            splatTransform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: 1.123456
            }
        };
        addAlignmentParams(params, state);
        expect(params.get('ss')).toBe('1.1235');
    });
});

describe('buildShareUrl - Asset URLs', () => {
    const baseUrl = 'https://example.com/viewer';
    const defaultOptions: ShareOptions = {
        displayMode: 'both',
        controlsPanel: 'full',
        toolbar: 'show',
        sidebar: 'closed'
    };

    it('generates URL with archive parameter', () => {
        const state: ShareState = {
            archiveUrl: 'https://cdn.example.com/scene.a3z'
        };
        const url = buildShareUrl(baseUrl, state, defaultOptions);
        expect(url).toBe('https://example.com/viewer?archive=https%3A%2F%2Fcdn.example.com%2Fscene.a3z&mode=both');
    });

    it('generates URL with splat parameter only', () => {
        const state: ShareState = {
            splatUrl: 'https://cdn.example.com/model.splat'
        };
        const url = buildShareUrl(baseUrl, state, { ...defaultOptions, displayMode: 'splat' });
        expect(url).toBe('https://example.com/viewer?splat=https%3A%2F%2Fcdn.example.com%2Fmodel.splat&mode=splat');
    });

    it('generates URL with model parameter only', () => {
        const state: ShareState = {
            modelUrl: 'https://cdn.example.com/model.glb'
        };
        const url = buildShareUrl(baseUrl, state, { ...defaultOptions, displayMode: 'model' });
        expect(url).toBe('https://example.com/viewer?model=https%3A%2F%2Fcdn.example.com%2Fmodel.glb&mode=model');
    });

    it('generates URL with pointcloud parameter only', () => {
        const state: ShareState = {
            pointcloudUrl: 'https://cdn.example.com/scan.e57'
        };
        const url = buildShareUrl(baseUrl, state, { ...defaultOptions, displayMode: 'pointcloud' });
        expect(url).toBe('https://example.com/viewer?pointcloud=https%3A%2F%2Fcdn.example.com%2Fscan.e57&mode=pointcloud');
    });

    it('generates URL with both splat and model parameters', () => {
        const state: ShareState = {
            splatUrl: 'https://cdn.example.com/model.splat',
            modelUrl: 'https://cdn.example.com/model.glb'
        };
        const url = buildShareUrl(baseUrl, state, defaultOptions);
        expect(url).toContain('splat=https%3A%2F%2Fcdn.example.com%2Fmodel.splat');
        expect(url).toContain('model=https%3A%2F%2Fcdn.example.com%2Fmodel.glb');
        expect(url).toContain('mode=both');
    });

    it('archive URL takes precedence over individual URLs', () => {
        const state: ShareState = {
            archiveUrl: 'https://cdn.example.com/scene.a3z',
            splatUrl: 'https://cdn.example.com/model.splat',
            modelUrl: 'https://cdn.example.com/model.glb'
        };
        const url = buildShareUrl(baseUrl, state, defaultOptions);
        expect(url).toContain('archive=');
        expect(url).not.toContain('splat=');
        expect(url).not.toContain('model=');
    });
});

describe('buildShareUrl - UI Options', () => {
    const baseUrl = 'https://example.com/viewer';
    const state: ShareState = {
        splatUrl: 'https://cdn.example.com/model.splat'
    };

    it('only includes mode param with all default options', () => {
        const options: ShareOptions = {
            displayMode: 'splat',
            controlsPanel: 'full',
            toolbar: 'show',
            sidebar: 'closed'
        };
        const url = buildShareUrl(baseUrl, state, options);
        expect(url).toContain('mode=splat');
        expect(url).not.toContain('controls=');
        expect(url).not.toContain('toolbar=');
        expect(url).not.toContain('sidebar=');
    });

    it('includes controls param when not "full"', () => {
        const options: ShareOptions = {
            displayMode: 'splat',
            controlsPanel: 'none',
            toolbar: 'show',
            sidebar: 'closed'
        };
        const url = buildShareUrl(baseUrl, state, options);
        expect(url).toContain('controls=none');
    });

    it('does not include controls param when "full" (default)', () => {
        const options: ShareOptions = {
            displayMode: 'splat',
            controlsPanel: 'full',
            toolbar: 'show',
            sidebar: 'closed'
        };
        const url = buildShareUrl(baseUrl, state, options);
        expect(url).not.toContain('controls=');
    });

    it('includes toolbar param when "hide"', () => {
        const options: ShareOptions = {
            displayMode: 'splat',
            controlsPanel: 'full',
            toolbar: 'hide',
            sidebar: 'closed'
        };
        const url = buildShareUrl(baseUrl, state, options);
        expect(url).toContain('toolbar=hide');
    });

    it('does not include toolbar param when "show" (default)', () => {
        const options: ShareOptions = {
            displayMode: 'splat',
            controlsPanel: 'full',
            toolbar: 'show',
            sidebar: 'closed'
        };
        const url = buildShareUrl(baseUrl, state, options);
        expect(url).not.toContain('toolbar=');
    });

    it('includes sidebar param when "view"', () => {
        const options: ShareOptions = {
            displayMode: 'splat',
            controlsPanel: 'full',
            toolbar: 'show',
            sidebar: 'view'
        };
        const url = buildShareUrl(baseUrl, state, options);
        expect(url).toContain('sidebar=view');
    });

    it('includes sidebar param when "edit"', () => {
        const options: ShareOptions = {
            displayMode: 'splat',
            controlsPanel: 'full',
            toolbar: 'show',
            sidebar: 'edit'
        };
        const url = buildShareUrl(baseUrl, state, options);
        expect(url).toContain('sidebar=edit');
    });

    it('does not include sidebar param when "closed" (default)', () => {
        const options: ShareOptions = {
            displayMode: 'splat',
            controlsPanel: 'full',
            toolbar: 'show',
            sidebar: 'closed'
        };
        const url = buildShareUrl(baseUrl, state, options);
        expect(url).not.toContain('sidebar=');
    });

    it('includes all non-default options', () => {
        const options: ShareOptions = {
            displayMode: 'model',
            controlsPanel: 'minimal',
            toolbar: 'hide',
            sidebar: 'edit'
        };
        const url = buildShareUrl(baseUrl, state, options);
        expect(url).toContain('mode=model');
        expect(url).toContain('controls=minimal');
        expect(url).toContain('toolbar=hide');
        expect(url).toContain('sidebar=edit');
    });
});

describe('buildShareUrl - Alignment Data', () => {
    const baseUrl = 'https://example.com/viewer';
    const defaultOptions: ShareOptions = {
        displayMode: 'both',
        controlsPanel: 'full',
        toolbar: 'show',
        sidebar: 'closed'
    };

    it('includes alignment params when includeAlignment=true and no archive', () => {
        const state: ShareState = {
            splatUrl: 'https://cdn.example.com/model.splat',
            splatTransform: {
                position: { x: 1, y: 2, z: 3 },
                rotation: { x: 0, y: 0, z: 0 }
            }
        };
        const url = buildShareUrl(baseUrl, state, defaultOptions, true);
        expect(url).toContain('sp=1%2C2%2C3'); // URL-encoded comma
    });

    it('does not include alignment params when includeAlignment=false', () => {
        const state: ShareState = {
            splatUrl: 'https://cdn.example.com/model.splat',
            splatTransform: {
                position: { x: 1, y: 2, z: 3 },
                rotation: { x: 0, y: 0, z: 0 }
            }
        };
        const url = buildShareUrl(baseUrl, state, defaultOptions, false);
        expect(url).not.toContain('sp=');
    });

    it('does not include alignment params when archive URL exists', () => {
        const state: ShareState = {
            archiveUrl: 'https://cdn.example.com/scene.a3z',
            splatTransform: {
                position: { x: 1, y: 2, z: 3 },
                rotation: { x: 0, y: 0, z: 0 }
            }
        };
        const url = buildShareUrl(baseUrl, state, defaultOptions, true);
        expect(url).not.toContain('sp=');
    });

    it('includes multiple transform types in URL', () => {
        const state: ShareState = {
            splatUrl: 'https://cdn.example.com/model.splat',
            splatTransform: {
                position: { x: 1, y: 2, z: 3 },
                rotation: { x: 0, y: 0, z: 0 }
            },
            modelTransform: {
                position: { x: 4, y: 5, z: 6 },
                rotation: { x: 0, y: 0, z: 0 }
            }
        };
        const url = buildShareUrl(baseUrl, state, defaultOptions, true);
        expect(url).toContain('sp=1%2C2%2C3');
        expect(url).toContain('mp=4%2C5%2C6');
    });
});

describe('UI Presets', () => {
    it('full preset has correct settings', () => {
        const preset = UI_PRESETS.full;
        expect(preset.settings.controlsPanel).toBe('full');
        expect(preset.settings.toolbar).toBe('show');
        expect(preset.settings.sidebar).toBe('closed');
    });

    it('viewer preset has correct settings', () => {
        const preset = UI_PRESETS.viewer;
        expect(preset.settings.controlsPanel).toBe('none');
        expect(preset.settings.toolbar).toBe('hide');
        expect(preset.settings.sidebar).toBe('view');
    });

    it('kiosk preset has correct settings', () => {
        const preset = UI_PRESETS.kiosk;
        expect(preset.settings.controlsPanel).toBe('none');
        expect(preset.settings.toolbar).toBe('hide');
        expect(preset.settings.sidebar).toBe('closed');
    });

    it('minimal preset has correct settings', () => {
        const preset = UI_PRESETS.minimal;
        expect(preset.settings.controlsPanel).toBe('none');
        expect(preset.settings.toolbar).toBe('show');
        expect(preset.settings.sidebar).toBe('closed');
    });
});
