/**
 * Flight Path Manager — Import, render, and interact with drone flight paths.
 *
 * Renders flight paths as THREE.Line + THREE.InstancedMesh markers.
 * Supports hover telemetry tooltips via raycasting.
 * Color modes: speed, altitude, climb rate.
 * Takeoff/landing markers, direction indicators, playback animation.
 */

import * as THREE from 'three';
import { Logger } from './utilities.js';
import { FLIGHT_LOG } from './constants.js';
import { parseDjiCsv, parseKml, parseSrt, detectFormat } from './flight-parsers.js';
import { parseDjiTxt } from './dji-txt-parser.js';
import type { FlightPoint, FlightPathData } from '@/types.js';

const log = Logger.getLogger('flight-path');

export type ColorMode = 'speed' | 'altitude' | 'climbrate';

/** Find the maximum value in an array without spreading (avoids stack overflow on large arrays). */
function maxOf(arr: number[]): number {
    let max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] > max) max = arr[i];
    }
    return max;
}

/** Subsample an array to at most maxPoints entries, evenly spaced. */
function subsample<T>(arr: T[], maxPoints: number): T[] {
    if (arr.length <= maxPoints) return arr;
    const step = (arr.length - 1) / (maxPoints - 1);
    const result: T[] = [];
    for (let i = 0; i < maxPoints; i++) {
        result.push(arr[Math.round(i * step)]);
    }
    return result;
}

/** Speed color ramp: blue (slow) → cyan → green → yellow → red (fast) */
const SPEED_RAMP: [number, number, number][] = [
    [59, 130, 246],   // blue
    [34, 211, 238],   // cyan
    [34, 197, 94],    // green
    [250, 204, 21],   // yellow
    [239, 68, 68],    // red
];

/** Altitude ramp: deep blue (low) → teal → green → orange → red (high) */
const ALTITUDE_RAMP: [number, number, number][] = [
    [30, 58, 138],    // deep blue
    [20, 150, 150],   // teal
    [34, 197, 94],    // green
    [245, 158, 11],   // orange
    [220, 38, 38],    // red
];

/** Climb rate ramp: blue (descending) → white (level) → red (climbing) */
const CLIMB_RAMP: [number, number, number][] = [
    [59, 130, 246],   // blue  (descent)
    [140, 160, 200],  // light blue-gray
    [200, 200, 210],  // near white (level)
    [230, 140, 100],  // warm
    [220, 38, 38],    // red   (climb)
];

/** Interpolate a color from a ramp. t is clamped to [0, 1]. */
function rampColor(ramp: [number, number, number][], t: number): [number, number, number] {
    const c = Math.max(0, Math.min(1, t));
    const maxIdx = ramp.length - 1;
    const scaled = c * maxIdx;
    const lo = Math.floor(scaled);
    const hi = Math.min(lo + 1, maxIdx);
    const f = scaled - lo;
    return [
        (ramp[lo][0] + (ramp[hi][0] - ramp[lo][0]) * f) / 255,
        (ramp[lo][1] + (ramp[hi][1] - ramp[lo][1]) * f) / 255,
        (ramp[lo][2] + (ramp[hi][2] - ramp[lo][2]) * f) / 255,
    ];
}

/** Format milliseconds as MM:SS */
function formatTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Format seconds as Xm Ys or Xs */
function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Compute GPS distance in meters using Haversine */
function computeGpsDistanceM(points: FlightPoint[]): number {
    let dist = 0;
    for (let i = 1; i < points.length; i++) {
        const R = 6371000;
        const dLat = (points[i].lat - points[i - 1].lat) * Math.PI / 180;
        const dLon = (points[i].lon - points[i - 1].lon) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(points[i - 1].lat * Math.PI / 180) * Math.cos(points[i].lat * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        dist += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    return dist;
}

interface PathMeshes {
    line: THREE.Line;
    markers: THREE.InstancedMesh;
    renderPoints: FlightPoint[];
    endpointGroup: THREE.Group;
    directionGroup: THREE.Group;
}

export interface FlightPathStats {
    duration: string;
    distance: string;
    maxAlt: string;
    maxSpeed: string;
    avgSpeed: string;
    points: string;
}

export class FlightPathManager {
    private group: THREE.Group;
    private camera: THREE.Camera;
    private renderer: THREE.WebGLRenderer;
    private paths: FlightPathData[] = [];
    private meshes: Map<string, PathMeshes> = new Map();
    private raycaster = new THREE.Raycaster();
    private tooltip: HTMLElement | null = null;
    private _onMouseMove: ((e: MouseEvent) => void) | null = null;

    // Settings
    private _colorMode: ColorMode = 'speed';
    private _showEndpoints = true;
    private _showDirection = true;

    // Path visibility
    private _pathVisibility: Map<string, boolean> = new Map();

    // Playback
    private _playing = false;
    private _playbackSpeed = 1;
    private _playbackTime = 0; // ms into the flight
    private _playbackPathId: string | null = null;
    private _playbackMarker: THREE.Mesh | null = null;
    private _followCamera = false;
    private _onPlaybackUpdate: ((currentMs: number, totalMs: number) => void) | null = null;
    private _onPlaybackEnd: (() => void) | null = null;

    constructor(group: THREE.Group, _scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
        this.group = group;
        this.camera = camera;
        this.renderer = renderer;
        this.raycaster.params.Points = { threshold: 0.05 };
    }

    /** Return the visible slice of a path's points, respecting trim bounds. */
    private getTrimmedPoints(data: FlightPathData): FlightPoint[] {
        const start = data.trimStart ?? 0;
        const end = data.trimEnd ?? (data.points.length - 1);
        return data.points.slice(start, end + 1);
    }

    // ─── Import ───────────────────────────────────────────────────────

    /** Import a flight log file. Returns the parsed FlightPathData. */
    async importFile(file: File): Promise<FlightPathData> {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        if (ext === 'txt') {
            const buffer = await file.arrayBuffer();
            return this.importBinary(buffer, file.name, 'dji-txt');
        }
        const text = await file.text();
        return this.importFromText(text, file.name);
    }

    /** Import from raw text + filename. Used for both file import and archive reload. */
    importFromText(text: string, fileName: string): FlightPathData {
        const format = detectFormat(fileName, text.slice(0, 500));
        if (!format) throw new Error(`Unrecognized flight log format: ${fileName}`);

        let points: FlightPoint[];
        switch (format) {
            case 'dji-csv':
                points = parseDjiCsv(text);
                break;
            case 'kml':
                points = parseKml(text);
                break;
            case 'srt':
                points = parseSrt(text);
                break;
            default:
                throw new Error(`Unsupported format: ${format}`);
        }

        if (points.length === 0) throw new Error('No valid GPS points found in flight log');

        const id = `flightpath_${this.paths.length}`;
        const lastPoint = points[points.length - 1];
        const data: FlightPathData = {
            id,
            points,
            sourceFormat: format,
            fileName,
            originGps: [points[0].lat, points[0].lon],
            durationS: Math.round(lastPoint.timestamp / 1000),
            maxAltM: maxOf(points.map(p => p.alt)),
        };

        this.paths.push(data);
        this._pathVisibility.set(id, true);
        this.renderPath(data);
        log.info(`Imported flight path "${fileName}": ${points.length} points, ${data.durationS}s duration`);
        return data;
    }

    /** Import from binary ArrayBuffer. Used for DJI .txt flight records. */
    async importBinary(buffer: ArrayBuffer, fileName: string, format: string): Promise<FlightPathData> {
        let points: FlightPoint[];
        switch (format) {
            case 'dji-txt':
                points = await parseDjiTxt(buffer);
                break;
            default:
                throw new Error(`Unsupported binary format: ${format}`);
        }

        if (points.length === 0) throw new Error('No valid GPS points found in flight log');

        const id = `flightpath_${this.paths.length}`;
        const lastPoint = points[points.length - 1];
        const data: FlightPathData = {
            id,
            points,
            sourceFormat: format,
            fileName,
            originGps: [points[0].lat, points[0].lon],
            durationS: Math.round(lastPoint.timestamp / 1000),
            maxAltM: maxOf(points.map(p => p.alt)),
        };

        this.paths.push(data);
        this._pathVisibility.set(id, true);
        this.renderPath(data);
        log.info(`Imported flight path "${fileName}": ${points.length} points, ${data.durationS}s duration`);
        return data;
    }

    // ─── Rendering ────────────────────────────────────────────────────

    /** Render a flight path as line + markers with color-mode-based vertex coloring. */
    private renderPath(data: FlightPathData): void {
        const trimmedPoints = this.getTrimmedPoints(data);
        const renderPoints = subsample(trimmedPoints, FLIGHT_LOG.MAX_RENDER_POINTS);

        // Build line + markers
        const { line, markers } = this.buildColoredPath(renderPoints);
        line.name = `${data.id}_line`;
        markers.name = `${data.id}_markers`;

        // Endpoint markers (takeoff + landing)
        const endpointGroup = this.buildEndpoints(renderPoints);
        endpointGroup.name = `${data.id}_endpoints`;
        endpointGroup.visible = this._showEndpoints;

        // Direction indicators
        const directionGroup = this.buildDirectionIndicators(renderPoints);
        directionGroup.name = `${data.id}_direction`;
        directionGroup.visible = this._showDirection;

        this.group.add(line);
        this.group.add(markers);
        this.group.add(endpointGroup);
        this.group.add(directionGroup);
        this.meshes.set(data.id, { line, markers, renderPoints, endpointGroup, directionGroup });
    }

    /** Build colored line + instanced markers based on current color mode. */
    private buildColoredPath(renderPoints: FlightPoint[]): { line: THREE.Line; markers: THREE.InstancedMesh } {
        // Compute value range for the active color mode
        const values = renderPoints.map((p, i) => this.getColorValue(p, renderPoints, i));
        let minVal = Infinity, maxVal = -Infinity;
        for (const v of values) {
            if (v < minVal) minVal = v;
            if (v > maxVal) maxVal = v;
        }
        const range = maxVal - minVal || 1;

        const ramp = this.getColorRamp();

        // Line with per-vertex colors
        const positions = new Float32Array(renderPoints.length * 3);
        const colors = new Float32Array(renderPoints.length * 3);
        for (let i = 0; i < renderPoints.length; i++) {
            positions[i * 3] = renderPoints[i].x;
            positions[i * 3 + 1] = renderPoints[i].y;
            positions[i * 3 + 2] = renderPoints[i].z;

            const t = (values[i] - minVal) / range;
            const [r, g, b] = rampColor(ramp, t);
            colors[i * 3] = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        }
        const lineGeom = new THREE.BufferGeometry();
        lineGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        lineGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const lineMat = new THREE.LineBasicMaterial({
            vertexColors: true,
            depthTest: true,
            depthWrite: false,
            transparent: true,
            opacity: 0.85,
        });
        const line = new THREE.Line(lineGeom, lineMat);
        line.renderOrder = 998;

        // Instanced markers with per-instance colors
        const sphereGeom = new THREE.SphereGeometry(FLIGHT_LOG.MARKER_RADIUS, 8, 6);
        const markerMat = new THREE.MeshBasicMaterial({
            depthTest: true,
            depthWrite: false,
            transparent: true,
            opacity: 0.7,
        });
        const markers = new THREE.InstancedMesh(sphereGeom, markerMat, renderPoints.length);
        markers.renderOrder = 999;
        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        for (let i = 0; i < renderPoints.length; i++) {
            dummy.position.set(renderPoints[i].x, renderPoints[i].y, renderPoints[i].z);
            dummy.updateMatrix();
            markers.setMatrixAt(i, dummy.matrix);

            const t = (values[i] - minVal) / range;
            const [r, g, b] = rampColor(ramp, t);
            color.setRGB(r, g, b);
            markers.setColorAt(i, color);
        }
        markers.instanceMatrix.needsUpdate = true;
        if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
        markers.userData.totalCount = markers.count;

        return { line, markers };
    }

    /** Get the numeric value for color mapping based on current mode. */
    private getColorValue(point: FlightPoint, allPoints: FlightPoint[], index: number): number {
        switch (this._colorMode) {
            case 'speed':
                return point.speed ?? 0;
            case 'altitude':
                return point.alt;
            case 'climbrate': {
                const idx = index;
                if (idx <= 0) return 0;
                const prev = allPoints[idx - 1];
                const dt = (point.timestamp - prev.timestamp) / 1000;
                return dt > 0 ? (point.alt - prev.alt) / dt : 0;
            }
            default:
                return point.speed ?? 0;
        }
    }

    /** Return the appropriate color ramp for the current mode. */
    private getColorRamp(): [number, number, number][] {
        switch (this._colorMode) {
            case 'altitude': return ALTITUDE_RAMP;
            case 'climbrate': return CLIMB_RAMP;
            default: return SPEED_RAMP;
        }
    }

    /** Build takeoff (green) and landing (red) endpoint markers. */
    private buildEndpoints(renderPoints: FlightPoint[]): THREE.Group {
        const group = new THREE.Group();
        if (renderPoints.length < 2) return group;

        const radius = FLIGHT_LOG.MARKER_RADIUS * 4;
        const geom = new THREE.SphereGeometry(radius, 12, 8);

        // Takeoff — green
        const takeoffMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.9, depthWrite: false });
        const takeoff = new THREE.Mesh(geom, takeoffMat);
        const p0 = renderPoints[0];
        takeoff.position.set(p0.x, p0.y, p0.z);
        takeoff.renderOrder = 1000;
        takeoff.name = 'takeoff';
        group.add(takeoff);

        // Landing — red
        const landingMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.9, depthWrite: false });
        const landing = new THREE.Mesh(geom, landingMat);
        const pN = renderPoints[renderPoints.length - 1];
        landing.position.set(pN.x, pN.y, pN.z);
        landing.renderOrder = 1000;
        landing.name = 'landing';
        group.add(landing);

        return group;
    }

    /** Build direction arrow indicators along the path. */
    private buildDirectionIndicators(renderPoints: FlightPoint[]): THREE.Group {
        const group = new THREE.Group();
        if (renderPoints.length < 4) return group;

        // Place arrows every ~5% of the path
        const interval = Math.max(1, Math.floor(renderPoints.length / 20));
        const coneGeom = new THREE.ConeGeometry(FLIGHT_LOG.MARKER_RADIUS * 2.5, FLIGHT_LOG.MARKER_RADIUS * 8, 6);
        // Rotate cone so it points along +Z by default (we'll orient with lookAt)
        coneGeom.rotateX(Math.PI / 2);

        const coneMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.6,
            depthTest: true,
            depthWrite: false,
        });

        for (let i = interval; i < renderPoints.length - 1; i += interval) {
            const p = renderPoints[i];
            const pNext = renderPoints[Math.min(i + 1, renderPoints.length - 1)];

            const arrow = new THREE.Mesh(coneGeom, coneMat);
            arrow.position.set(p.x, p.y, p.z);

            // Orient arrow along direction of travel
            const dir = new THREE.Vector3(pNext.x - p.x, pNext.y - p.y, pNext.z - p.z);
            if (dir.lengthSq() > 0) {
                arrow.lookAt(p.x + dir.x, p.y + dir.y, p.z + dir.z);
            }

            arrow.renderOrder = 999;
            group.add(arrow);
        }

        return group;
    }

    /** Re-render all paths with current color mode. Called when color mode changes. */
    private recolorAll(): void {
        for (const [id, entry] of this.meshes) {
            // Dispose old line + markers
            entry.line.geometry.dispose();
            (entry.line.material as THREE.Material).dispose();
            entry.markers.geometry.dispose();
            (entry.markers.material as THREE.Material).dispose();
            this.group.remove(entry.line);
            this.group.remove(entry.markers);

            // Rebuild with new colors
            const { line, markers } = this.buildColoredPath(entry.renderPoints);
            line.name = `${id}_line`;
            markers.name = `${id}_markers`;
            this.group.add(line);
            this.group.add(markers);

            // Check visibility
            const visible = this._pathVisibility.get(id) !== false;
            line.visible = visible;
            markers.visible = visible;

            entry.line = line;
            entry.markers = markers;
        }
    }

    // ─── Settings ─────────────────────────────────────────────────────

    /** Set the color mode and re-render all paths. */
    setColorMode(mode: ColorMode): void {
        if (this._colorMode === mode) return;
        this._colorMode = mode;
        this.recolorAll();
        log.info(`Color mode changed to: ${mode}`);
    }

    get colorMode(): ColorMode {
        return this._colorMode;
    }

    /** Toggle takeoff/landing endpoint markers. */
    setShowEndpoints(show: boolean): void {
        this._showEndpoints = show;
        for (const entry of this.meshes.values()) {
            entry.endpointGroup.visible = show;
        }
    }

    get showEndpoints(): boolean {
        return this._showEndpoints;
    }

    /** Toggle direction indicators. */
    setShowDirection(show: boolean): void {
        this._showDirection = show;
        for (const entry of this.meshes.values()) {
            entry.directionGroup.visible = show;
        }
    }

    get showDirection(): boolean {
        return this._showDirection;
    }

    // ─── Path List Management ─────────────────────────────────────────

    /** Set visibility of a specific path. */
    setPathVisible(pathId: string, visible: boolean): void {
        this._pathVisibility.set(pathId, visible);
        const entry = this.meshes.get(pathId);
        if (entry) {
            entry.line.visible = visible;
            entry.markers.visible = visible;
            entry.endpointGroup.visible = visible && this._showEndpoints;
            entry.directionGroup.visible = visible && this._showDirection;
        }
    }

    /** Delete a specific path. */
    deletePath(pathId: string): void {
        const entry = this.meshes.get(pathId);
        if (entry) {
            entry.line.geometry.dispose();
            (entry.line.material as THREE.Material).dispose();
            entry.markers.geometry.dispose();
            (entry.markers.material as THREE.Material).dispose();
            this.group.remove(entry.line);
            this.group.remove(entry.markers);

            // Dispose endpoint meshes
            entry.endpointGroup.traverse((child: THREE.Object3D) => {
                const mesh = child as THREE.Mesh;
                if (mesh.geometry) {
                    mesh.geometry.dispose();
                    (mesh.material as THREE.Material)?.dispose();
                }
            });
            this.group.remove(entry.endpointGroup);

            // Dispose direction meshes
            entry.directionGroup.traverse((child: THREE.Object3D) => {
                const mesh = child as THREE.Mesh;
                if (mesh.geometry) {
                    mesh.geometry.dispose();
                    (mesh.material as THREE.Material)?.dispose();
                }
            });
            this.group.remove(entry.directionGroup);

            this.meshes.delete(pathId);
        }

        this._pathVisibility.delete(pathId);
        this.paths = this.paths.filter(p => p.id !== pathId);

        // Stop playback if playing the deleted path
        if (this._playbackPathId === pathId) {
            this.stopPlayback();
        }

        log.info(`Deleted flight path: ${pathId}`);
    }

    /** Set trim range for a path. Indices are clamped and must leave at least 2 points visible. */
    setTrim(pathId: string, startIdx: number, endIdx: number): void {
        const data = this.paths.find(p => p.id === pathId);
        if (!data) return;

        const maxIdx = data.points.length - 1;
        const s = Math.max(0, Math.min(startIdx, maxIdx));
        const e = Math.max(s + 1, Math.min(endIdx, maxIdx));

        data.trimStart = s === 0 ? undefined : s;
        data.trimEnd = e === maxIdx ? undefined : e;

        this.reRenderPath(pathId);
        log.info(`Trim set on ${pathId}: [${s}..${e}] of ${data.points.length} points`);
    }

    /** Reset trim for a path (show all points). */
    resetTrim(pathId: string): void {
        const data = this.paths.find(p => p.id === pathId);
        if (!data) return;
        data.trimStart = undefined;
        data.trimEnd = undefined;
        this.reRenderPath(pathId);
        log.info(`Trim reset on ${pathId}`);
    }

    /** Remove and re-render a single path. */
    private reRenderPath(pathId: string): void {
        const data = this.paths.find(p => p.id === pathId);
        const entry = this.meshes.get(pathId);
        if (!data || !entry) return;

        entry.line.geometry.dispose();
        (entry.line.material as THREE.Material).dispose();
        entry.markers.geometry.dispose();
        (entry.markers.material as THREE.Material).dispose();
        this.group.remove(entry.line);
        this.group.remove(entry.markers);

        entry.endpointGroup.traverse((child: THREE.Object3D) => {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) { mesh.geometry.dispose(); (mesh.material as THREE.Material)?.dispose(); }
        });
        this.group.remove(entry.endpointGroup);

        entry.directionGroup.traverse((child: THREE.Object3D) => {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) { mesh.geometry.dispose(); (mesh.material as THREE.Material)?.dispose(); }
        });
        this.group.remove(entry.directionGroup);

        this.meshes.delete(pathId);
        this.renderPath(data);

        const visible = this._pathVisibility.get(pathId) !== false;
        const newEntry = this.meshes.get(pathId);
        if (newEntry && !visible) {
            newEntry.line.visible = false;
            newEntry.markers.visible = false;
            newEntry.endpointGroup.visible = false;
            newEntry.directionGroup.visible = false;
        }
    }

    /** Get visibility state of a path */
    isPathVisible(pathId: string): boolean {
        return this._pathVisibility.get(pathId) !== false;
    }

    // ─── Stats ────────────────────────────────────────────────────────

    /** Get aggregated stats across all visible paths. */
    getStats(): FlightPathStats | null {
        const visible = this.paths.filter(p => this._pathVisibility.get(p.id) !== false);
        if (visible.length === 0) return null;

        let totalDuration = 0;
        let totalDistanceM = 0;
        let maxAlt = 0;
        let maxSpeed = 0;
        let totalSpeed = 0;
        let speedCount = 0;
        let totalOriginalPoints = 0;
        let totalTrimmedPoints = 0;

        for (const p of visible) {
            const trimmed = this.getTrimmedPoints(p);
            const first = trimmed[0];
            const last = trimmed[trimmed.length - 1];
            totalDuration += Math.round((last.timestamp - first.timestamp) / 1000);
            totalDistanceM += computeGpsDistanceM(trimmed);
            const trimMaxAlt = maxOf(trimmed.map(pt => pt.alt));
            if (trimMaxAlt > maxAlt) maxAlt = trimMaxAlt;
            for (const pt of trimmed) {
                if (pt.speed !== undefined) {
                    if (pt.speed > maxSpeed) maxSpeed = pt.speed;
                    totalSpeed += pt.speed;
                    speedCount++;
                }
            }
            totalOriginalPoints += p.points.length;
            totalTrimmedPoints += trimmed.length;
        }

        const avgSpeed = speedCount > 0 ? totalSpeed / speedCount : 0;

        // Format distance
        let distStr: string;
        if (totalDistanceM >= 1000) {
            distStr = `${(totalDistanceM / 1000).toFixed(2)} km`;
        } else {
            distStr = `${Math.round(totalDistanceM)} m`;
        }

        return {
            duration: formatDuration(totalDuration),
            distance: distStr,
            maxAlt: `${maxAlt.toFixed(1)} m`,
            maxSpeed: `${maxSpeed.toFixed(1)} m/s`,
            avgSpeed: `${avgSpeed.toFixed(1)} m/s`,
            points: totalTrimmedPoints < totalOriginalPoints
                ? `${totalTrimmedPoints.toLocaleString()} (of ${totalOriginalPoints.toLocaleString()})`
                : totalOriginalPoints.toLocaleString(),
        };
    }

    // ─── Playback ─────────────────────────────────────────────────────

    /** Start or resume playback of the first visible path. */
    startPlayback(pathId?: string): void {
        const targetId = pathId || this.paths.find(p => this._pathVisibility.get(p.id) !== false)?.id;
        if (!targetId) return;
        const pathData = this.paths.find(p => p.id === targetId);
        if (!pathData || pathData.points.length < 2) return;
        const trimmed = this.getTrimmedPoints(pathData);
        if (trimmed.length < 2) return;

        this._playbackPathId = targetId;
        this._playing = true;

        // Clamp playback to trimmed time window
        const trimStartMs = trimmed[0].timestamp;
        if (this._playbackTime < trimStartMs) {
            this._playbackTime = trimStartMs;
        }

        // Create playback marker if needed
        if (!this._playbackMarker) {
            const geom = new THREE.SphereGeometry(FLIGHT_LOG.MARKER_RADIUS * 5, 12, 8);
            const mat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.95, depthWrite: false });
            this._playbackMarker = new THREE.Mesh(geom, mat);
            this._playbackMarker.renderOrder = 1001;
            this._playbackMarker.name = 'playback_marker';
            this.group.add(this._playbackMarker);
        }
        this._playbackMarker.visible = true;
    }

    /** Pause playback. */
    pausePlayback(): void {
        this._playing = false;
    }

    /** Stop playback and reset to start. */
    stopPlayback(): void {
        this._playing = false;
        this._playbackTime = 0;
        this._playbackPathId = null;
        if (this._playbackMarker) {
            this._playbackMarker.visible = false;
        }
        this._onPlaybackEnd?.();
    }

    /** Set playback speed multiplier. */
    setPlaybackSpeed(speed: number): void {
        this._playbackSpeed = speed;
    }

    /** Set playback position by normalized t (0–1). */
    seekTo(t: number): void {
        const pathData = this._playbackPathId ? this.paths.find(p => p.id === this._playbackPathId) : null;
        if (!pathData) return;
        this._playbackTime = t * pathData.durationS * 1000;
        this.updatePlaybackPosition();
    }

    /** Toggle follow-camera mode. */
    setFollowCamera(follow: boolean): void {
        this._followCamera = follow;
    }

    get followCamera(): boolean {
        return this._followCamera;
    }

    get isPlaying(): boolean {
        return this._playing;
    }

    get playbackProgress(): number {
        const pathData = this._playbackPathId ? this.paths.find(p => p.id === this._playbackPathId) : null;
        if (!pathData || pathData.durationS === 0) return 0;
        return Math.min(1, this._playbackTime / (pathData.durationS * 1000));
    }

    /** Register a callback for playback position updates. */
    onPlaybackUpdate(cb: (currentMs: number, totalMs: number) => void): void {
        this._onPlaybackUpdate = cb;
    }

    /** Register a callback for when playback ends. */
    onPlaybackEnd(cb: () => void): void {
        this._onPlaybackEnd = cb;
    }

    /** Called each frame from the animate loop. deltaTime in seconds. */
    updatePlayback(deltaTime: number): void {
        if (!this._playing || !this._playbackPathId) return;

        const pathData = this.paths.find(p => p.id === this._playbackPathId);
        if (!pathData) return;

        const trimmed = this.getTrimmedPoints(pathData);
        const trimStartMs = trimmed[0].timestamp;
        const trimEndMs = trimmed[trimmed.length - 1].timestamp;
        const totalMs = trimEndMs - trimStartMs;

        this._playbackTime += deltaTime * 1000 * this._playbackSpeed;
        if (this._playbackTime < trimStartMs) this._playbackTime = trimStartMs;

        if (this._playbackTime >= trimEndMs) {
            this._playbackTime = trimEndMs;
            this._playing = false;
            this._onPlaybackEnd?.();
        }

        this.updatePlaybackPosition();
        this._onPlaybackUpdate?.(this._playbackTime - trimStartMs, totalMs);
    }

    /** Update the playback marker position by interpolating between points. */
    private updatePlaybackPosition(): void {
        const pathData = this._playbackPathId ? this.paths.find(p => p.id === this._playbackPathId) : null;
        if (!pathData || !this._playbackMarker) return;

        const points = pathData.points;
        const t = this._playbackTime;

        // Find the two points we're between
        let i = 0;
        while (i < points.length - 1 && points[i + 1].timestamp <= t) i++;

        if (i >= points.length - 1) {
            const last = points[points.length - 1];
            this._playbackMarker.position.set(last.x, last.y, last.z);
        } else {
            const p0 = points[i];
            const p1 = points[i + 1];
            const dt = p1.timestamp - p0.timestamp;
            const f = dt > 0 ? (t - p0.timestamp) / dt : 0;
            this._playbackMarker.position.set(
                p0.x + (p1.x - p0.x) * f,
                p0.y + (p1.y - p0.y) * f,
                p0.z + (p1.z - p0.z) * f
            );
        }

        // Follow camera
        if (this._followCamera && this.camera instanceof THREE.PerspectiveCamera) {
            const pos = this._playbackMarker.position;
            // Position camera slightly behind and above
            const heading = this.getPlaybackHeading(points, t);
            const camDist = 0.5;
            const camHeight = 0.3;
            const camX = pos.x - Math.sin(heading) * camDist;
            const camZ = pos.z - Math.cos(heading) * camDist;
            this.camera.position.set(camX, pos.y + camHeight, camZ);
            this.camera.lookAt(pos);
        }
    }

    /** Get heading angle at the current playback time. */
    private getPlaybackHeading(points: FlightPoint[], timeMs: number): number {
        let i = 0;
        while (i < points.length - 1 && points[i + 1].timestamp <= timeMs) i++;
        if (points[i].heading !== undefined) {
            return points[i].heading! * Math.PI / 180;
        }
        // Fallback: compute from consecutive points
        if (i < points.length - 1) {
            return Math.atan2(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
        }
        return 0;
    }

    // ─── Tooltip ──────────────────────────────────────────────────────

    /** Set up hover tooltip for telemetry display. */
    setupTooltip(tooltipElement: HTMLElement): void {
        this.tooltip = tooltipElement;
        this._onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
        this.renderer.domElement.addEventListener('mousemove', this._onMouseMove);
    }

    private handleMouseMove(e: MouseEvent): void {
        if (!this.tooltip || this.paths.length === 0) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(mouse, this.camera);

        for (const [, { markers, renderPoints }] of this.meshes) {
            const hits = this.raycaster.intersectObject(markers);
            if (hits.length > 0 && hits[0].instanceId !== undefined) {
                const point = renderPoints[hits[0].instanceId];
                this.showTooltip(e.clientX, e.clientY, point);
                return;
            }
        }

        this.hideTooltip();
    }

    private showTooltip(x: number, y: number, point: FlightPoint): void {
        if (!this.tooltip) return;
        const lines: string[] = [];
        lines.push(`Alt: ${point.alt.toFixed(1)}m`);
        if (point.speed !== undefined) lines.push(`Speed: ${point.speed.toFixed(1)} m/s`);
        lines.push(`Time: ${formatTime(point.timestamp)}`);
        if (point.heading !== undefined) lines.push(`Heading: ${point.heading.toFixed(0)}°`);

        this.tooltip.innerHTML = lines.join('<br>');
        this.tooltip.style.left = `${x + 12}px`;
        this.tooltip.style.top = `${y - 10}px`;
        this.tooltip.style.display = 'block';
    }

    private hideTooltip(): void {
        if (this.tooltip) this.tooltip.style.display = 'none';
    }

    // ─── Public API ───────────────────────────────────────────────────

    /** Get all parsed paths. */
    getPaths(): FlightPathData[] {
        return this.paths;
    }

    /** Get all flight points from all paths (flattened). */
    getAllPoints(): FlightPoint[] {
        return this.paths.flatMap(p => p.points);
    }

    /** Toggle visibility of all flight paths. */
    setVisible(visible: boolean): void {
        this.group.visible = visible;
    }

    /** Update the line opacity for all flight paths. */
    setLineOpacity(opacity: number): void {
        for (const [, entry] of this.meshes) {
            const mat = entry.line.material as THREE.LineBasicMaterial;
            mat.opacity = opacity;
            mat.transparent = opacity < 1;
            mat.needsUpdate = true;
        }
    }

    /** Set marker density: 'off' hides all markers, 'sparse' shows ~200, 'all' shows everything. */
    setMarkerDensity(density: 'off' | 'sparse' | 'all'): void {
        for (const [id, entry] of this.meshes) {
            if (!entry.markers) continue;
            const total = entry.markers.userData?.totalCount ?? entry.markers.count;
            if (density === 'off') {
                entry.markers.visible = false;
            } else if (density === 'all') {
                entry.markers.count = total;
                entry.markers.visible = this._pathVisibility.get(id) !== false;
            } else {
                // sparse: show ~200 evenly spaced
                const target = Math.min(200, total);
                entry.markers.count = target;
                entry.markers.visible = this._pathVisibility.get(id) !== false;
            }
        }
    }

    /** Check if any flight paths are loaded. */
    get hasData(): boolean {
        return this.paths.length > 0;
    }

    /** Serialize paths for manifest export. Returns array of manifest entry data. */
    toManifestEntries(): Array<{ id: string; sourceFormat: string; fileName: string; meta: Record<string, unknown> }> {
        return this.paths.map(p => ({
            id: p.id,
            sourceFormat: p.sourceFormat,
            fileName: p.fileName,
            meta: {
                point_count: p.points.length,
                duration_s: p.durationS,
                origin_gps: p.originGps,
                max_alt_m: p.maxAltM,
                source_format: p.sourceFormat,
            },
        }));
    }

    /** Get current settings for archive persistence. */
    getSettings(): { colorMode: ColorMode; showEndpoints: boolean; showDirection: boolean } {
        return {
            colorMode: this._colorMode,
            showEndpoints: this._showEndpoints,
            showDirection: this._showDirection,
        };
    }

    /** Apply settings from archive. */
    applySettings(settings: { colorMode?: string; showEndpoints?: boolean; showDirection?: boolean }): void {
        if (settings.colorMode && ['speed', 'altitude', 'climbrate'].includes(settings.colorMode)) {
            this._colorMode = settings.colorMode as ColorMode;
        }
        if (settings.showEndpoints !== undefined) {
            this._showEndpoints = settings.showEndpoints;
        }
        if (settings.showDirection !== undefined) {
            this._showDirection = settings.showDirection;
        }
        // Re-render with applied settings
        if (this.paths.length > 0) {
            this.recolorAll();
            for (const entry of this.meshes.values()) {
                entry.endpointGroup.visible = this._showEndpoints;
                entry.directionGroup.visible = this._showDirection;
            }
        }
    }

    /** Clean up all Three.js resources. */
    dispose(): void {
        this.stopPlayback();
        if (this._playbackMarker) {
            this._playbackMarker.geometry.dispose();
            (this._playbackMarker.material as THREE.Material).dispose();
            this.group.remove(this._playbackMarker);
            this._playbackMarker = null;
        }
        if (this._onMouseMove) {
            this.renderer.domElement.removeEventListener('mousemove', this._onMouseMove);
        }
        for (const entry of this.meshes.values()) {
            entry.line.geometry.dispose();
            (entry.line.material as THREE.Material).dispose();
            entry.markers.geometry.dispose();
            (entry.markers.material as THREE.Material).dispose();
            this.group.remove(entry.line);
            this.group.remove(entry.markers);

            entry.endpointGroup.traverse(child => {
                if ((child as THREE.Mesh).geometry) {
                    (child as THREE.Mesh).geometry.dispose();
                    ((child as THREE.Mesh).material as THREE.Material)?.dispose();
                }
            });
            this.group.remove(entry.endpointGroup);

            entry.directionGroup.traverse(child => {
                if ((child as THREE.Mesh).geometry) {
                    (child as THREE.Mesh).geometry.dispose();
                    ((child as THREE.Mesh).material as THREE.Material)?.dispose();
                }
            });
            this.group.remove(entry.directionGroup);
        }
        this.meshes.clear();
        this.paths = [];
        this._pathVisibility.clear();
        this.hideTooltip();
    }
}
