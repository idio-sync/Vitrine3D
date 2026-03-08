/**
 * Flight Path Manager — Import, render, and interact with drone flight paths.
 *
 * Renders flight paths as THREE.Line + THREE.InstancedMesh markers.
 * Supports hover telemetry tooltips via raycasting.
 */

import * as THREE from 'three';
import { Logger } from './utilities.js';
import { FLIGHT_LOG } from './constants.js';
import { parseDjiCsv, parseKml, parseSrt, detectFormat } from './flight-parsers.js';
import type { FlightPoint, FlightPathData } from '@/types.js';

const log = Logger.getLogger('flight-path');

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

/** Format milliseconds as MM:SS */
function formatTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export class FlightPathManager {
    private group: THREE.Group;
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private renderer: THREE.WebGLRenderer;
    private paths: FlightPathData[] = [];
    private meshes: Map<string, { line: THREE.Line; markers: THREE.InstancedMesh; renderPoints: FlightPoint[] }> = new Map();
    private raycaster = new THREE.Raycaster();
    private tooltip: HTMLElement | null = null;
    private _onMouseMove: ((e: MouseEvent) => void) | null = null;

    constructor(group: THREE.Group, scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
        this.group = group;
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.raycaster.params.Points = { threshold: 0.05 };
    }

    /** Import a flight log file. Returns the parsed FlightPathData. */
    async importFile(file: File): Promise<FlightPathData> {
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
            maxAltM: Math.max(...points.map(p => p.alt)),
        };

        this.paths.push(data);
        this.renderPath(data);
        log.info(`Imported flight path "${fileName}": ${points.length} points, ${data.durationS}s duration`);
        return data;
    }

    /** Render a flight path as line + markers. */
    private renderPath(data: FlightPathData): void {
        const renderPoints = subsample(data.points, FLIGHT_LOG.MAX_RENDER_POINTS);

        // Line
        const positions = new Float32Array(renderPoints.length * 3);
        for (let i = 0; i < renderPoints.length; i++) {
            positions[i * 3] = renderPoints[i].x;
            positions[i * 3 + 1] = renderPoints[i].y;
            positions[i * 3 + 2] = renderPoints[i].z;
        }
        const lineGeom = new THREE.BufferGeometry();
        lineGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const lineMat = new THREE.LineBasicMaterial({
            color: FLIGHT_LOG.LINE_COLOR,
            depthTest: true,
            depthWrite: false,
            transparent: true,
            opacity: 0.85,
        });
        const line = new THREE.Line(lineGeom, lineMat);
        line.name = `${data.id}_line`;
        line.renderOrder = 998;

        // Instanced markers
        const sphereGeom = new THREE.SphereGeometry(FLIGHT_LOG.MARKER_RADIUS, 8, 6);
        const markerMat = new THREE.MeshBasicMaterial({
            color: FLIGHT_LOG.LINE_COLOR,
            depthTest: true,
            depthWrite: false,
            transparent: true,
            opacity: 0.7,
        });
        const markers = new THREE.InstancedMesh(sphereGeom, markerMat, renderPoints.length);
        markers.name = `${data.id}_markers`;
        markers.renderOrder = 999;
        const dummy = new THREE.Object3D();
        for (let i = 0; i < renderPoints.length; i++) {
            dummy.position.set(renderPoints[i].x, renderPoints[i].y, renderPoints[i].z);
            dummy.updateMatrix();
            markers.setMatrixAt(i, dummy.matrix);
        }
        markers.instanceMatrix.needsUpdate = true;

        this.group.add(line);
        this.group.add(markers);
        this.meshes.set(data.id, { line, markers, renderPoints });
    }

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

    /** Get all parsed paths. */
    getPaths(): FlightPathData[] {
        return this.paths;
    }

    /** Toggle visibility of all flight paths. */
    setVisible(visible: boolean): void {
        this.group.visible = visible;
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

    /** Clean up all Three.js resources. */
    dispose(): void {
        if (this._onMouseMove) {
            this.renderer.domElement.removeEventListener('mousemove', this._onMouseMove);
        }
        for (const { line, markers } of this.meshes.values()) {
            line.geometry.dispose();
            (line.material as THREE.Material).dispose();
            markers.geometry.dispose();
            (markers.material as THREE.Material).dispose();
            this.group.remove(line);
            this.group.remove(markers);
        }
        this.meshes.clear();
        this.paths = [];
        this.hideTooltip();
    }
}
