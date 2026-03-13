/**
 * Drawing Loader — DXF file loading and parsing
 *
 * Handles .dxf format files with per-layer LineSegments rendering.
 * Coordinate system: DXF Z-up is mapped to Three.js Y-up: (x, y, z) → (x, z, −y).
 * Extracted from file-handlers.ts for modularity.
 */

import * as THREE from 'three';
import DxfParser from 'dxf-parser';
import { Logger, disposeObject, fetchWithProgress } from '../utilities.js';
import type { AppState } from '@/types.js';

const log = Logger.getLogger('drawing-loader');

type ProgressCallback = ((received: number, total: number) => void) | null;

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface LoadDrawingDeps {
    drawingGroup: THREE.Group;
    state: AppState;
    callbacks?: {
        onDrawingLoaded?: (obj: THREE.Object3D, source: File | Blob) => void;
    };
}

// =============================================================================
// DXF PARSING HELPERS
// =============================================================================

const DXF_CURVE_SEGMENTS = 32;

/** Convert a DXF point to Three.js coordinates (Z-up to Y-up): (x, y, z) → (x, z, -y) */
function dxfVec(x: number, y: number, z = 0): THREE.Vector3 {
    return new THREE.Vector3(x, z, -y);
}

/** Approximate an arc as discrete Vector3 points */
function dxfArcPoints(cx: number, cy: number, cz: number, r: number, startAngle: number, endAngle: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    let end = endAngle;
    if (end <= startAngle) end += Math.PI * 2;
    const steps = Math.max(2, Math.ceil(DXF_CURVE_SEGMENTS * (end - startAngle) / (Math.PI * 2)));
    for (let i = 0; i <= steps; i++) {
        const a = startAngle + (end - startAngle) * (i / steps);
        pts.push(dxfVec(cx + r * Math.cos(a), cy + r * Math.sin(a), cz));
    }
    return pts;
}

/** Convert consecutive Vector3 points to flat interleaved line-segment pairs */
function ptsToLineSegments(pts: THREE.Vector3[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        out.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    return out;
}

/** Append flat line-segment positions for one DXF entity into `out` */
function dxfEntityToSegments(entity: any, out: number[]): void {
    switch (entity.type) {
        case 'LINE': {
            const v = entity.vertices as Array<{ x: number; y: number; z?: number }>;
            if (v?.length >= 2) {
                const a = dxfVec(v[0].x, v[0].y, v[0].z ?? 0);
                const b = dxfVec(v[1].x, v[1].y, v[1].z ?? 0);
                out.push(a.x, a.y, a.z, b.x, b.y, b.z);
            }
            break;
        }
        case 'LWPOLYLINE': {
            const verts = entity.vertices as Array<{ x: number; y: number; z?: number }>;
            if (!verts?.length) break;
            const elev: number = entity.elevation ?? 0;
            const pts = verts.map((v: any) => dxfVec(v.x, v.y, v.z ?? elev));
            out.push(...ptsToLineSegments(pts));
            if (entity.shape && pts.length >= 2) {
                const last = pts[pts.length - 1], first = pts[0];
                out.push(last.x, last.y, last.z, first.x, first.y, first.z);
            }
            break;
        }
        case 'POLYLINE': {
            const verts = entity.vertices as Array<{ x: number; y: number; z?: number }> | undefined;
            if (!verts?.length) break;
            const pts = verts.map((v: any) => dxfVec(v.x, v.y, v.z ?? 0));
            out.push(...ptsToLineSegments(pts));
            if (entity.shape && pts.length >= 2) {
                const last = pts[pts.length - 1], first = pts[0];
                out.push(last.x, last.y, last.z, first.x, first.y, first.z);
            }
            break;
        }
        case 'ARC': {
            const c = entity.center as { x: number; y: number; z?: number };
            const pts = dxfArcPoints(c.x, c.y, c.z ?? 0, entity.radius, entity.startAngle, entity.endAngle);
            out.push(...ptsToLineSegments(pts));
            break;
        }
        case 'CIRCLE': {
            const c = entity.center as { x: number; y: number; z?: number };
            // Use a tiny gap to avoid duplicate start/end point, then close manually
            const pts = dxfArcPoints(c.x, c.y, c.z ?? 0, entity.radius, 0, Math.PI * 2 - 0.0001);
            out.push(...ptsToLineSegments(pts));
            if (pts.length >= 2) {
                const last = pts[pts.length - 1], first = pts[0];
                out.push(last.x, last.y, last.z, first.x, first.y, first.z);
            }
            break;
        }
        case '3DFACE': {
            const v = entity.vertices as Array<{ x: number; y: number; z?: number }> | undefined;
            if (!v?.length) break;
            const pts = v.map((p: any) => dxfVec(p.x, p.y, p.z ?? 0));
            for (let i = 0; i < pts.length; i++) {
                const next = pts[(i + 1) % pts.length];
                out.push(pts[i].x, pts[i].y, pts[i].z, next.x, next.y, next.z);
            }
            break;
        }
        case 'SPLINE': {
            const ctrl = entity.controlPoints as Array<{ x: number; y: number; z?: number }> | undefined;
            if (!ctrl?.length) break;
            const pts = ctrl.map((p: any) => dxfVec(p.x, p.y, p.z ?? 0));
            out.push(...ptsToLineSegments(pts));
            break;
        }
        default:
            break;
    }
}

/**
 * Parse DXF text into a Three.js Group with per-layer LineSegments.
 * Coordinate system: DXF Z-up is mapped to Three.js Y-up: (x, y, z) → (x, z, −y).
 */
function parseDXFText(text: string): THREE.Group {
    const parser = new DxfParser();
    const dxf = parser.parseSync(text);
    if (!dxf) throw new Error('DXF parse returned null');

    const root = new THREE.Group();
    root.name = 'dxf';

    // Collect line-segment positions per layer
    const layers = new Map<string, number[]>();
    for (const entity of (dxf.entities ?? [])) {
        const layer: string = (entity as any).layer ?? '0';
        if (!layers.has(layer)) layers.set(layer, []);
        try {
            dxfEntityToSegments(entity, layers.get(layer)!);
        } catch {
            // skip malformed entity
        }
    }

    for (const [layerName, positions] of layers) {
        if (positions.length === 0) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.85, transparent: true });
        const lines = new THREE.LineSegments(geo, mat);
        lines.name = `dxf-layer:${layerName}`;
        root.add(lines);
    }

    return root;
}

/** Load DXF from a File object */
async function loadDXFFromFile(file: File): Promise<THREE.Group> {
    const text = await file.text();
    return parseDXFText(text);
}

/** Load DXF from a URL (http or blob) */
async function loadDXFFromUrl(url: string, onProgress?: (loaded: number, total: number) => void): Promise<THREE.Group> {
    const blob = await fetchWithProgress(url, onProgress ?? null);
    const text = await blob.text();
    return parseDXFText(text);
}

// =============================================================================
// DRAWING LOADING (DXF — separate asset type)
// =============================================================================

/**
 * Load drawing from a file into the drawing group (separate asset type)
 */
export async function loadDrawingFromFile(files: FileList, deps: LoadDrawingDeps): Promise<THREE.Group | undefined> {
    const { drawingGroup, state, callbacks } = deps;
    const mainFile = files[0];

    // Clear existing drawing
    while (drawingGroup.children.length > 0) {
        const child = drawingGroup.children[0];
        disposeObject(child);
        drawingGroup.remove(child);
    }

    const loadedObject = await loadDXFFromFile(mainFile);

    if (loadedObject) {
        drawingGroup.add(loadedObject);
        state.drawingLoaded = true;
        state.currentDrawingUrl = null;

        if (callbacks?.onDrawingLoaded) {
            callbacks.onDrawingLoaded(loadedObject, mainFile);
        }
    }

    return loadedObject;
}

/**
 * Load drawing from URL into the drawing group (separate asset type)
 */
export async function loadDrawingFromUrl(url: string, deps: LoadDrawingDeps, onProgress?: ProgressCallback): Promise<THREE.Group | undefined> {
    const { drawingGroup, state, callbacks } = deps;

    log.info('Fetching DXF drawing from URL:', url);
    const blob = await fetchWithProgress(url, onProgress ?? null);
    log.info('DXF blob fetched, size:', blob.size);

    const blobUrl = URL.createObjectURL(blob);

    // Clear existing drawing
    while (drawingGroup.children.length > 0) {
        const child = drawingGroup.children[0];
        disposeObject(child);
        drawingGroup.remove(child);
    }

    const loadedObject = await loadDXFFromUrl(blobUrl);

    if (loadedObject) {
        drawingGroup.add(loadedObject);
        state.drawingLoaded = true;
        state.currentDrawingUrl = url;

        if (callbacks?.onDrawingLoaded) {
            callbacks.onDrawingLoaded(loadedObject, blob);
        }
    }

    URL.revokeObjectURL(blobUrl);
    return loadedObject;
}

/**
 * Load drawing from a blob URL (used by archive loader)
 */
export async function loadDrawingFromBlobUrl(blobUrl: string, fileName: string, deps: Pick<LoadDrawingDeps, 'drawingGroup' | 'state'>): Promise<{ object: THREE.Object3D | undefined }> {
    const { drawingGroup, state } = deps;

    // Clear existing drawing
    while (drawingGroup.children.length > 0) {
        const child = drawingGroup.children[0];
        disposeObject(child);
        drawingGroup.remove(child);
    }

    const loadedObject = await loadDXFFromUrl(blobUrl);

    if (loadedObject) {
        drawingGroup.add(loadedObject);
        state.drawingLoaded = true;
    }

    return { object: loadedObject };
}
