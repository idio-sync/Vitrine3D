# DJI Flight Path Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import DJI flight logs (CSV, KML/KMZ, SRT) and render drone flight paths as 3D lines with data point markers over models/splats, stored in archives.

**Architecture:** New `flight-parsers.ts` (pure parsing functions) and `flight-path.ts` (FlightPathManager class for rendering/interaction). Follows existing asset patterns: `flightpath_N` entries in manifest, `flightPathGroup` on SceneRefs, blob storage in asset-store, transform gizmo integration.

**Tech Stack:** Three.js (Line, InstancedMesh, BufferGeometry, Raycaster), fflate (KMZ extraction), DOMParser (KML), Vitest (tests)

---

### Task 1: Types and Constants

**Files:**
- Modify: `src/types.ts:186-195` (AssetStore interface)
- Modify: `src/types.ts:34-89` (AppState interface)
- Modify: `src/types.ts:92-114` (SceneRefs interface)
- Modify: `src/modules/constants.ts` (add FLIGHT_LOG section)

**Step 1: Add FlightPoint and FlightPathData interfaces to types.ts**

Add after the Walkthrough section (after line 182), before the AssetStore section:

```typescript
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
    sourceFormat: string;    // 'dji-csv' | 'kml' | 'srt'
    fileName: string;        // original filename
    originGps: [number, number]; // [lat, lon] of first point
    durationS: number;       // total flight duration in seconds
    maxAltM: number;         // max altitude in meters
}
```

**Step 2: Add flightPathGroup to SceneRefs**

Add after `drawingGroup` (line 104):

```typescript
readonly flightPathGroup: any;    // THREE.Group
```

**Step 3: Add flight path state to AppState**

Add after `drawingLoaded` (line 46):

```typescript
flightPathLoaded: boolean;
```

**Step 4: Add flight path blobs to AssetStore interface and LocalAssetStore**

In `src/types.ts`, add to the `AssetStore` interface after `cadFileName`:

```typescript
flightPathBlobs: Array<{ blob: Blob; fileName: string }>;
```

**Step 5: Add FLIGHT_LOG extensions to constants.ts**

Add a new section after the DECIMATION_PRESETS section:

```typescript
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
```

**Step 6: Commit**

```bash
git add src/types.ts src/modules/constants.ts
git commit -m "feat(flight-path): add types and constants for drone flight log import"
```

---

### Task 2: Flight Log Parsers (TDD)

**Files:**
- Create: `src/modules/flight-parsers.ts`
- Create: `src/modules/__tests__/flight-parsers.test.ts`

**Step 1: Write failing tests for all three parsers and GPS conversion**

Create `src/modules/__tests__/flight-parsers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
    parseDjiCsv,
    parseKml,
    parseSrt,
    detectFormat,
    gpsToLocal,
} from '../flight-parsers.js';

describe('detectFormat', () => {
    it('detects CSV by extension', () => {
        expect(detectFormat('flight.csv', '')).toBe('dji-csv');
    });
    it('detects KML by extension', () => {
        expect(detectFormat('path.kml', '')).toBe('kml');
    });
    it('detects KMZ by extension', () => {
        expect(detectFormat('path.kmz', '')).toBe('kmz');
    });
    it('detects SRT by extension', () => {
        expect(detectFormat('DJI_0001.srt', '')).toBe('srt');
    });
    it('falls back to content detection for CSV', () => {
        expect(detectFormat('data.txt', 'latitude,longitude,altitude')).toBe('dji-csv');
    });
    it('falls back to content detection for KML', () => {
        expect(detectFormat('data.txt', '<?xml version="1.0"?><kml')).toBe('kml');
    });
    it('falls back to content detection for SRT', () => {
        expect(detectFormat('data.txt', '1\n00:00:00,000 --> 00:00:01,000\n[latitude: 38.0]')).toBe('srt');
    });
    it('returns null for unknown format', () => {
        expect(detectFormat('readme.txt', 'hello world')).toBeNull();
    });
});

describe('gpsToLocal', () => {
    it('converts origin point to (0,0,0)', () => {
        const result = gpsToLocal(38.8893, -77.0502, 100, 38.8893, -77.0502, 100);
        expect(result.x).toBeCloseTo(0, 1);
        expect(result.y).toBeCloseTo(0, 1);
        expect(result.z).toBeCloseTo(0, 1);
    });
    it('positive altitude difference maps to positive Y', () => {
        const result = gpsToLocal(38.8893, -77.0502, 150, 38.8893, -77.0502, 100);
        expect(result.y).toBeCloseTo(50, 1);
    });
    it('north movement maps to positive Z', () => {
        const result = gpsToLocal(38.8903, -77.0502, 100, 38.8893, -77.0502, 100);
        expect(result.z).toBeGreaterThan(0);
        expect(result.x).toBeCloseTo(0, 1);
    });
    it('east movement maps to positive X', () => {
        const result = gpsToLocal(38.8893, -77.0492, 100, 38.8893, -77.0502, 100);
        expect(result.x).toBeGreaterThan(0);
        expect(result.z).toBeCloseTo(0, 1);
    });
});

describe('parseDjiCsv', () => {
    const csvData = [
        'time(millisecond),latitude,longitude,altitude(m),speed(m/s),heading(°)',
        '0,38.8893,-77.0502,100,0,0',
        '1000,38.8894,-77.0501,105,2.5,45',
        '2000,38.8895,-77.0500,110,3.0,90',
    ].join('\n');

    it('parses correct number of points', () => {
        const points = parseDjiCsv(csvData);
        expect(points).toHaveLength(3);
    });
    it('preserves original GPS coordinates', () => {
        const points = parseDjiCsv(csvData);
        expect(points[0].lat).toBeCloseTo(38.8893, 4);
        expect(points[0].lon).toBeCloseTo(-77.0502, 4);
    });
    it('first point is at local origin', () => {
        const points = parseDjiCsv(csvData);
        expect(points[0].x).toBeCloseTo(0, 1);
        expect(points[0].y).toBeCloseTo(0, 1);
        expect(points[0].z).toBeCloseTo(0, 1);
    });
    it('parses speed when available', () => {
        const points = parseDjiCsv(csvData);
        expect(points[1].speed).toBeCloseTo(2.5);
    });
    it('handles alternative column names', () => {
        const altCsv = 'time,lat,lon,alt\n0,38.8893,-77.0502,100';
        const points = parseDjiCsv(altCsv);
        expect(points).toHaveLength(1);
        expect(points[0].lat).toBeCloseTo(38.8893, 4);
    });
    it('skips rows with invalid GPS data', () => {
        const badCsv = 'latitude,longitude,altitude(m)\n38.8893,-77.0502,100\n,,\n38.8894,-77.0501,105';
        const points = parseDjiCsv(badCsv);
        expect(points).toHaveLength(2);
    });
});

describe('parseKml', () => {
    const kmlData = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Placemark>
    <LineString>
      <coordinates>
        -77.0502,38.8893,100
        -77.0501,38.8894,105
        -77.0500,38.8895,110
      </coordinates>
    </LineString>
  </Placemark>
</Document>
</kml>`;

    it('parses correct number of points', () => {
        const points = parseKml(kmlData);
        expect(points).toHaveLength(3);
    });
    it('extracts lon/lat/alt correctly (KML order is lon,lat,alt)', () => {
        const points = parseKml(kmlData);
        expect(points[0].lat).toBeCloseTo(38.8893, 4);
        expect(points[0].lon).toBeCloseTo(-77.0502, 4);
        expect(points[0].alt).toBeCloseTo(100, 0);
    });
    it('first point is at local origin', () => {
        const points = parseKml(kmlData);
        expect(points[0].x).toBeCloseTo(0, 1);
        expect(points[0].y).toBeCloseTo(0, 1);
        expect(points[0].z).toBeCloseTo(0, 1);
    });
    it('handles Point coordinates', () => {
        const pointKml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2">
        <Document><Placemark><Point><coordinates>-77.0502,38.8893,100</coordinates></Point></Placemark></Document></kml>`;
        const points = parseKml(pointKml);
        expect(points).toHaveLength(1);
    });
});

describe('parseSrt', () => {
    const srtData = [
        '1',
        '00:00:00,000 --> 00:00:01,000',
        '[latitude: 38.8893] [longitude: -77.0502] [altitude: 100.0]',
        '',
        '2',
        '00:00:01,000 --> 00:00:02,000',
        '[latitude: 38.8894] [longitude: -77.0501] [altitude: 105.0]',
        '',
        '3',
        '00:00:02,000 --> 00:00:03,000',
        '[latitude: 38.8895] [longitude: -77.0500] [altitude: 110.0]',
    ].join('\n');

    it('parses correct number of points', () => {
        const points = parseSrt(srtData);
        expect(points).toHaveLength(3);
    });
    it('extracts GPS coordinates', () => {
        const points = parseSrt(srtData);
        expect(points[0].lat).toBeCloseTo(38.8893, 4);
        expect(points[0].lon).toBeCloseTo(-77.0502, 4);
    });
    it('extracts timestamps', () => {
        const points = parseSrt(srtData);
        expect(points[0].timestamp).toBe(0);
        expect(points[1].timestamp).toBe(1000);
    });
    it('first point is at local origin', () => {
        const points = parseSrt(srtData);
        expect(points[0].x).toBeCloseTo(0, 1);
    });
    it('handles DJI format with brackets', () => {
        const djiSrt = '1\n00:00:00,000 --> 00:00:01,000\n[latitude : 38.8893] [longtitude : -77.0502] [altitude: 100.0]\n';
        const points = parseSrt(djiSrt);
        expect(points).toHaveLength(1);
        // Note: DJI misspells "longitude" as "longtitude" in some firmware versions
    });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/modules/__tests__/flight-parsers.test.ts
```

Expected: FAIL — module `../flight-parsers.js` does not exist.

**Step 3: Implement the parsers**

Create `src/modules/flight-parsers.ts`:

```typescript
/**
 * Flight Log Parsers — Pure functions for parsing DJI drone telemetry files.
 *
 * Supported formats:
 * - DJI CSV (exported from DJI Fly / DJI Pilot 2 / AirData)
 * - KML/KMZ (Google Earth format, exported by many flight tools)
 * - SRT (DJI subtitle telemetry embedded in video files)
 *
 * All parsers return FlightPoint[] with GPS coords converted to local 3D space.
 */

import type { FlightPoint } from '@/types.js';

// ===== GPS → Local Coordinate Conversion =====

/** Convert a GPS coordinate to local XYZ relative to an origin point.
 *  Uses flat-earth approximation — accurate within ~1km of origin. */
export function gpsToLocal(
    lat: number, lon: number, alt: number,
    originLat: number, originLon: number, originAlt: number
): { x: number; y: number; z: number } {
    const latRad = originLat * Math.PI / 180;
    const x = (lon - originLon) * Math.cos(latRad) * 111320; // meters east
    const z = (lat - originLat) * 111320;                     // meters north
    const y = alt - originAlt;                                 // meters up
    return { x, y, z };
}

// ===== Format Detection =====

/** Detect flight log format from filename extension or content peek. */
export function detectFormat(fileName: string, contentPeek: string): string | null {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'csv') return 'dji-csv';
    if (ext === 'kml') return 'kml';
    if (ext === 'kmz') return 'kmz';
    if (ext === 'srt') return 'srt';

    // Content-based fallback
    const lower = contentPeek.toLowerCase();
    if (lower.includes('latitude') && lower.includes('longitude')) return 'dji-csv';
    if (lower.includes('<kml') || lower.includes('<?xml')) return 'kml';
    if (/\[latitude[:\s]/i.test(contentPeek)) return 'srt';

    return null;
}

// ===== Column Alias Matching =====

const COLUMN_ALIASES: Record<string, string[]> = {
    time: ['time(millisecond)', 'time', 'time_ms', 'elapsed_time', 'timestamp'],
    lat: ['latitude', 'lat', 'gps_lat', 'gps.lat'],
    lon: ['longitude', 'lon', 'lng', 'gps_lon', 'gps.lon', 'longtitude'], // DJI typo
    alt: ['altitude(m)', 'altitude', 'alt', 'height', 'gps_alt', 'abs_alt', 'altitude_above_seaLevel(feet)'],
    speed: ['speed(m/s)', 'speed', 'ground_speed', 'gps_speed'],
    heading: ['heading(°)', 'heading', 'compass_heading', 'yaw'],
    gimbalPitch: ['gimbal_pitch(°)', 'gimbal_pitch', 'gimbal.pitch'],
    gimbalYaw: ['gimbal_yaw(°)', 'gimbal_yaw', 'gimbal.yaw'],
};

function findColumn(headers: string[], field: string): number {
    const aliases = COLUMN_ALIASES[field] || [field];
    const lowerHeaders = headers.map(h => h.trim().toLowerCase());
    for (const alias of aliases) {
        const idx = lowerHeaders.indexOf(alias.toLowerCase());
        if (idx !== -1) return idx;
    }
    return -1;
}

// ===== DJI CSV Parser =====

/** Parse a DJI CSV flight log. Returns FlightPoint[] in local coordinates. */
export function parseDjiCsv(csvText: string): FlightPoint[] {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',');
    const timeIdx = findColumn(headers, 'time');
    const latIdx = findColumn(headers, 'lat');
    const lonIdx = findColumn(headers, 'lon');
    const altIdx = findColumn(headers, 'alt');
    const speedIdx = findColumn(headers, 'speed');
    const headingIdx = findColumn(headers, 'heading');
    const gimbalPitchIdx = findColumn(headers, 'gimbalPitch');
    const gimbalYawIdx = findColumn(headers, 'gimbalYaw');

    if (latIdx === -1 || lonIdx === -1) return [];

    const points: FlightPoint[] = [];
    let originLat = 0, originLon = 0, originAlt = 0;

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const lat = parseFloat(cols[latIdx]);
        const lon = parseFloat(cols[lonIdx]);
        const alt = altIdx !== -1 ? parseFloat(cols[altIdx]) : 0;

        if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) continue;

        if (points.length === 0) {
            originLat = lat;
            originLon = lon;
            originAlt = alt;
        }

        const local = gpsToLocal(lat, lon, alt, originLat, originLon, originAlt);
        const timestamp = timeIdx !== -1 ? parseFloat(cols[timeIdx]) || 0 : (points.length * 1000);

        points.push({
            ...local,
            lat, lon, alt, timestamp,
            speed: speedIdx !== -1 ? parseFloat(cols[speedIdx]) || undefined : undefined,
            heading: headingIdx !== -1 ? parseFloat(cols[headingIdx]) || undefined : undefined,
            gimbalPitch: gimbalPitchIdx !== -1 ? parseFloat(cols[gimbalPitchIdx]) || undefined : undefined,
            gimbalYaw: gimbalYawIdx !== -1 ? parseFloat(cols[gimbalYawIdx]) || undefined : undefined,
        });
    }

    return points;
}

// ===== KML Parser =====

/** Parse a KML document. Returns FlightPoint[] in local coordinates. */
export function parseKml(kmlText: string): FlightPoint[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlText, 'text/xml');

    // Collect all coordinate strings from LineString and Point elements
    const coordElements = [
        ...Array.from(doc.getElementsByTagName('coordinates')),
        // Also check namespace-prefixed variants
        ...Array.from(doc.getElementsByTagNameNS('http://www.opengis.net/kml/2.2', 'coordinates')),
    ];

    // Deduplicate elements (namespace query may return same nodes)
    const seen = new Set<Element>();
    const rawCoords: string[] = [];
    for (const el of coordElements) {
        if (seen.has(el)) continue;
        seen.add(el);
        rawCoords.push(el.textContent || '');
    }

    // Parse all coordinate tuples
    const tuples: Array<{ lon: number; lat: number; alt: number }> = [];
    for (const coordStr of rawCoords) {
        const matches = coordStr.trim().split(/\s+/);
        for (const m of matches) {
            const parts = m.split(',').map(Number);
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                tuples.push({ lon: parts[0], lat: parts[1], alt: parts[2] || 0 });
            }
        }
    }

    // Collect timestamps from <when> elements (if any)
    const whenElements = [
        ...Array.from(doc.getElementsByTagName('when')),
        ...Array.from(doc.getElementsByTagNameNS('http://www.opengis.net/kml/2.2', 'when')),
    ];
    const whenSeen = new Set<Element>();
    const timestamps: number[] = [];
    for (const el of whenElements) {
        if (whenSeen.has(el)) continue;
        whenSeen.add(el);
        const t = Date.parse(el.textContent || '');
        if (!isNaN(t)) timestamps.push(t);
    }
    const baseTime = timestamps.length > 0 ? timestamps[0] : 0;

    if (tuples.length === 0) return [];

    const originLat = tuples[0].lat;
    const originLon = tuples[0].lon;
    const originAlt = tuples[0].alt;

    return tuples.map((t, i) => {
        const local = gpsToLocal(t.lat, t.lon, t.alt, originLat, originLon, originAlt);
        const timestamp = i < timestamps.length ? timestamps[i] - baseTime : i * 1000;
        return { ...local, lat: t.lat, lon: t.lon, alt: t.alt, timestamp };
    });
}

// ===== SRT Parser =====

/** Parse a DJI SRT subtitle file. Returns FlightPoint[] in local coordinates. */
export function parseSrt(srtText: string): FlightPoint[] {
    // DJI SRT format: blocks separated by blank lines
    // Each block: index, timestamp range, telemetry line(s)
    // Telemetry: [latitude: 38.8893] [longitude: -77.0502] [altitude: 100.0]
    // Note: some DJI firmware misspells "longitude" as "longtitude"

    const blocks = srtText.trim().split(/\n\s*\n/);
    const points: FlightPoint[] = [];
    let originLat = 0, originLon = 0, originAlt = 0;

    const latRe = /\[latitude\s*:\s*([-\d.]+)\]/i;
    const lonRe = /\[(?:longitude|longtitude)\s*:\s*([-\d.]+)\]/i;
    const altRe = /\[altitude\s*:\s*([-\d.]+)\]/i;
    const timeRe = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        const text = lines.join(' ');

        const latMatch = latRe.exec(text);
        const lonMatch = lonRe.exec(text);
        const altMatch = altRe.exec(text);
        if (!latMatch || !lonMatch) continue;

        const lat = parseFloat(latMatch[1]);
        const lon = parseFloat(lonMatch[1]);
        const alt = altMatch ? parseFloat(altMatch[1]) : 0;

        if (isNaN(lat) || isNaN(lon)) continue;

        // Parse timestamp from the time range line
        let timestamp = points.length * 200; // fallback: assume ~5Hz
        const timeMatch = timeRe.exec(text);
        if (timeMatch) {
            timestamp = parseInt(timeMatch[1]) * 3600000 +
                        parseInt(timeMatch[2]) * 60000 +
                        parseInt(timeMatch[3]) * 1000 +
                        parseInt(timeMatch[4]);
        }

        if (points.length === 0) {
            originLat = lat;
            originLon = lon;
            originAlt = alt;
        }

        const local = gpsToLocal(lat, lon, alt, originLat, originLon, originAlt);
        points.push({ ...local, lat, lon, alt, timestamp });
    }

    return points;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/modules/__tests__/flight-parsers.test.ts
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/modules/flight-parsers.ts src/modules/__tests__/flight-parsers.test.ts
git commit -m "feat(flight-path): add DJI CSV, KML, and SRT flight log parsers with tests"
```

---

### Task 3: Asset Store and Scene Manager

**Files:**
- Modify: `src/modules/asset-store.ts:27-47` (LocalAssetStore interface + store object)
- Modify: `src/modules/asset-store.ts:61-71` (resetBlobs)
- Modify: `src/modules/scene-manager.ts:126-203` (group declarations)
- Modify: `src/modules/scene-manager.ts:441-447` (group creation in setupScene)

**Step 1: Add flight path blob storage to asset-store.ts**

In the `LocalAssetStore` interface (after `cadFileName` at line 34), add:

```typescript
flightPathBlobs: Array<{ blob: Blob; fileName: string }>;
```

In the `store` object (after `cadFileName: null` at line 46), add:

```typescript
flightPathBlobs: [],
```

In `resetBlobs()` (before the log.info line at ~line 70), add:

```typescript
store.flightPathBlobs = [];
```

**Step 2: Add flightPathGroup to SceneManager**

In scene-manager.ts, add the property declaration after `drawingGroup` (~line 129):

```typescript
flightPathGroup: Group | null;
```

Initialize to null in the constructor (after `this.drawingGroup = null` at ~line 203):

```typescript
this.flightPathGroup = null;
```

Create the group in `setupScene()` (after the cadGroup creation at ~line 447):

```typescript
this.flightPathGroup = new Group();
this.flightPathGroup.name = 'flightPathGroup';
this.scene.add(this.flightPathGroup);
```

**Step 3: Run build to verify no type errors**

```bash
npm run build
```

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/modules/asset-store.ts src/modules/scene-manager.ts
git commit -m "feat(flight-path): add flight path group to scene manager and asset store"
```

---

### Task 4: FlightPathManager — Core Rendering

**Files:**
- Create: `src/modules/flight-path.ts`

**Step 1: Create FlightPathManager with import and render methods**

Create `src/modules/flight-path.ts`:

```typescript
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

        // Check all marker meshes
        for (const [id, { markers, renderPoints }] of this.meshes) {
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
    toManifestEntries(): Array<{ id: string; sourceFormat: string; fileName: string; meta: any }> {
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
```

**Step 2: Run build to verify no type errors**

```bash
npm run build
```

Expected: Build succeeds (module is tree-shaken if not imported yet, but should compile).

**Step 3: Commit**

```bash
git add src/modules/flight-path.ts
git commit -m "feat(flight-path): add FlightPathManager with line rendering, markers, and hover tooltip"
```

---

### Task 5: Archive Creator — addFlightPath

**Files:**
- Modify: `src/modules/archive-creator.ts:1432-1456` (after addCAD method)

**Step 1: Add addFlightPath method to ArchiveCreator**

Add after the `addCAD` method (after line 1456):

```typescript
    addFlightPath(blob: Blob, fileName: string, options: AddAssetOptions & { flightMeta?: any } = {}): string {
        const index = this._countEntriesOfType('flightpath_');
        const entryKey = `flightpath_${index}`;
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const archivePath = `assets/flightpath_${index}.${ext}`;

        this.files.set(archivePath, { blob, originalName: fileName });

        this.manifest.data_entries[entryKey] = {
            file_name: archivePath,
            created_by: options.created_by || "unknown",
            _created_by_version: options.created_by_version || "",
            _source_notes: options.source_notes || "",
            role: 'flightpath',
            _source_format: ext === 'csv' ? 'dji-csv' : ext,
            original_name: fileName,
            _parameters: {
                position: options.position || [0, 0, 0],
                rotation: options.rotation || [0, 0, 0],
                scale: options.scale !== undefined ? options.scale : 1,
                ...(options.parameters || {})
            },
            _flight_meta: options.flightMeta || {},
        };

        return entryKey;
    }
```

**Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/modules/archive-creator.ts
git commit -m "feat(flight-path): add addFlightPath method to archive creator"
```

---

### Task 6: Archive Loader — getFlightPathEntries

**Files:**
- Modify: `src/modules/archive-loader.ts:903-932` (after getCADEntry, before getContentInfo)

**Step 1: Add getFlightPathEntries and update getContentInfo**

Add after `getCADEntry()` (after line 906):

```typescript
    getFlightPathEntries(): Array<{ key: string; entry: ManifestDataEntry }> {
        return this.findEntriesByPrefix('flightpath_');
    }
```

In `getContentInfo()`, add after the `cad` line (~line 915):

```typescript
const flightPaths = this.getFlightPathEntries();
```

In the return object, add after `hasCAD` (~line 927):

```typescript
hasFlightPath: flightPaths.length > 0,
flightPathCount: flightPaths.length,
```

Also add `hasFlightPath` and `flightPathCount` to the `ContentInfo` interface (find its definition, likely near the top of the file).

**Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/modules/archive-loader.ts
git commit -m "feat(flight-path): add flight path entry helpers to archive loader"
```

---

### Task 7: Archive Pipeline — Load Flight Paths

**Files:**
- Modify: `src/modules/archive-pipeline.ts` (add flight path loading after CAD loading block)

**Step 1: Add flight path loading to the archive pipeline**

Find the section where CAD loading happens (around line 475-501). After the CAD `else if` block and before the `return false` at line 504, add a new `else if` block:

```typescript
        } else if (assetType === 'flightpath') {
            const flightEntries = archiveLoader.getFlightPathEntries();
            if (flightEntries.length === 0) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return false;
            }
            // Dynamically import FlightPathManager to avoid circular deps
            const { FlightPathManager } = await import('./flight-path.js');
            const fpGroup = sceneRefs.flightPathGroup;
            if (!fpGroup) { state.assetStates[assetType] = ASSET_STATE.ERROR; return false; }

            for (const { key, entry } of flightEntries) {
                const fileData = await archiveLoader.extractFile(entry.file_name);
                if (!fileData) continue;
                const text = await fileData.blob.text();
                // Store blob for re-export
                const fpStore = getStore();
                fpStore.flightPathBlobs.push({ blob: fileData.blob, fileName: entry.original_name || entry.file_name.split('/').pop() || entry.file_name });
            }

            state.flightPathLoaded = true;
            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return true;
```

Note: The actual parsing and rendering will happen in main.ts / kiosk-main.ts where the FlightPathManager instance lives — the pipeline just extracts and stores the blobs. This matches how other assets work (pipeline extracts, caller renders).

**Step 2: Add 'flightpath' to the asset loading sequence**

Find where the asset loading order is defined (the array or sequence of `loadAsset` calls). Add `'flightpath'` after `'cad'`.

**Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/modules/archive-pipeline.ts
git commit -m "feat(flight-path): load flight path entries from archives in pipeline"
```

---

### Task 8: Editor HTML — File Input and Tooltip

**Files:**
- Modify: `src/editor/index.html` (add flight log input section + tooltip div)

**Step 1: Add flight log file input section**

Find the CAD input section (~line 1124-1135). After the drawing input block (~line 1135), add:

```html
<!-- Flight Path section -->
<div class="prop-row" style="gap:4px; align-items:center;">
    <span class="prop-label" style="flex-shrink:0;">Flight</span>
    <span id="flightpath-filename" class="filename-display" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; color:#888;">—</span>
    <label for="flightpath-input" class="prop-btn" style="cursor:pointer; margin-bottom:0;"><span style="color:#4FC3F7;">+</span> File</label>
</div>
<input type="file" id="flightpath-input" accept=".csv,.kml,.kmz,.srt" style="display:none" />
```

**Step 2: Add telemetry tooltip div**

Add before the closing `</body>` tag:

```html
<!-- Flight path telemetry tooltip -->
<div id="flight-tooltip" style="display:none; position:fixed; pointer-events:none; background:rgba(0,0,0,0.85); color:#fff; padding:6px 10px; border-radius:4px; font-size:11px; line-height:1.5; z-index:10000; font-family:monospace;"></div>
```

**Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(flight-path): add flight log file input and tooltip to editor HTML"
```

---

### Task 9: Kiosk HTML — Tooltip and Toggle

**Files:**
- Modify: `src/index.html`

**Step 1: Add tooltip div and toggle button**

Add the same tooltip div before `</body>`:

```html
<!-- Flight path telemetry tooltip -->
<div id="flight-tooltip" style="display:none; position:fixed; pointer-events:none; background:rgba(0,0,0,0.85); color:#fff; padding:6px 10px; border-radius:4px; font-size:11px; line-height:1.5; z-index:10000; font-family:monospace;"></div>
```

Find the annotation toggle button (`btn-toggle-annotations`). Add a flight path toggle nearby:

```html
<button id="btn-toggle-flightpath" class="viewer-btn" title="Toggle Flight Path" style="display:none;">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 17l4-4 4 4 4-8 6 6"/>
        <circle cx="21" cy="15" r="2"/>
    </svg>
</button>
```

**Step 2: Commit**

```bash
git add src/index.html
git commit -m "feat(flight-path): add flight path tooltip and toggle to kiosk HTML"
```

---

### Task 10: Editor Integration — main.ts Wiring

**Files:**
- Modify: `src/main.ts`

**Step 1: Import FlightPathManager and wire into init()**

Find where other modules are imported at the top of main.ts. Add:

```typescript
import { FlightPathManager } from './modules/flight-path.js';
```

**Step 2: Add flightPathManager to module-scope variables**

Find where `let annotationSystem`, `let measurementSystem` etc. are declared. Add:

```typescript
let flightPathManager: FlightPathManager | null = null;
```

**Step 3: Initialize in init()**

Find where annotationSystem or measurementSystem is initialized in `init()`. Add nearby:

```typescript
// Flight path manager
if (sceneManager.flightPathGroup) {
    flightPathManager = new FlightPathManager(
        sceneManager.flightPathGroup,
        scene,
        camera,
        renderer
    );
    const flightTooltip = document.getElementById('flight-tooltip');
    if (flightTooltip) flightPathManager.setupTooltip(flightTooltip);
}
```

**Step 4: Add flightPathLoaded to state initialization**

Find the `state` object declaration. Add:

```typescript
flightPathLoaded: false,
```

**Step 5: Wire up file input handler**

Find in `init()` or event wiring where CAD/drawing file handlers are registered. Add:

```typescript
const flightInput = document.getElementById('flightpath-input') as HTMLInputElement;
if (flightInput) {
    flightInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file || !flightPathManager) return;
        document.getElementById('flightpath-filename')!.textContent = file.name;
        showLoading('Importing flight log...');
        try {
            const data = flightPathManager.importFile(file);
            // Store blob for archive export
            const assets = getStore();
            assets.flightPathBlobs.push({ blob: file, fileName: file.name });
            state.flightPathLoaded = true;
            hideLoading();
            notify.success(`Flight path loaded: ${(await data).points.length} points`);
        } catch (err: any) {
            hideLoading();
            notify.error('Error loading flight log: ' + err.message);
        }
    });
}
```

**Step 6: Wire into export pipeline**

Find where `archiveCreator.addCAD` or similar calls happen during export. Add flight path export:

```typescript
// Export flight paths
const fpAssets = getStore().flightPathBlobs;
for (let i = 0; i < fpAssets.length; i++) {
    const fp = fpAssets[i];
    const group = sceneRefs.flightPathGroup;
    archiveCreator.addFlightPath(fp.blob, fp.fileName, {
        position: group ? [group.position.x, group.position.y, group.position.z] : [0, 0, 0],
        rotation: group ? [group.rotation.x, group.rotation.y, group.rotation.z] : [0, 0, 0],
        scale: group ? group.scale.x : 1,
        flightMeta: flightPathManager?.toManifestEntries()[i]?.meta || {},
    });
}
```

**Step 7: Add flightPathGroup to SceneRefs extraction**

Find where `sceneRefs` is built from the SceneManager in `init()`. Add `flightPathGroup`:

```typescript
flightPathGroup: sceneManager.flightPathGroup,
```

**Step 8: Run build**

```bash
npm run build
```

Expected: Build succeeds.

**Step 9: Commit**

```bash
git add src/main.ts
git commit -m "feat(flight-path): wire FlightPathManager into editor with import, export, and tooltip"
```

---

### Task 11: Kiosk Integration — kiosk-main.ts

**Files:**
- Modify: `src/modules/kiosk-main.ts`

**Step 1: Add flight path loading after archive load**

Find where the archive pipeline loads assets (splat, mesh, pointcloud, CAD). After those, add flight path loading:

```typescript
// Load flight paths from archive
const fpEntries = archiveLoader.getFlightPathEntries();
if (fpEntries.length > 0 && sceneRefs.flightPathGroup) {
    const { FlightPathManager } = await import('./flight-path.js');
    const fpManager = new FlightPathManager(
        sceneRefs.flightPathGroup,
        sceneRefs.scene,
        sceneRefs.camera,
        sceneRefs.renderer
    );
    const fpTooltip = document.getElementById('flight-tooltip');
    if (fpTooltip) fpManager.setupTooltip(fpTooltip);

    for (const { key, entry } of fpEntries) {
        const fileData = await archiveLoader.extractFile(entry.file_name);
        if (!fileData) continue;
        const text = await fileData.blob.text();
        try {
            fpManager.importFromText(text, entry.original_name || entry.file_name);
            // Apply saved transform
            const transform = archiveLoader.getEntryTransform(entry);
            const group = sceneRefs.flightPathGroup;
            const s = normalizeScale(transform.scale);
            if (transform.position.some((v: number) => v !== 0) || transform.rotation.some((v: number) => v !== 0) || s.some(v => v !== 1)) {
                group.position.fromArray(transform.position);
                group.rotation.set(...transform.rotation);
                group.scale.set(...s);
            }
        } catch (err) {
            log.warn(`Failed to load flight path ${key}:`, err);
        }
    }

    // Show toggle button if paths loaded
    if (fpManager.hasData) {
        const toggleBtn = document.getElementById('btn-toggle-flightpath');
        if (toggleBtn) {
            toggleBtn.style.display = '';
            let visible = true;
            toggleBtn.addEventListener('click', () => {
                visible = !visible;
                fpManager.setVisible(visible);
                toggleBtn.classList.toggle('active', visible);
            });
        }
    }
}
```

**Step 2: Add normalizeScale import if not already present**

Check if `normalizeScale` is already imported from `@/types.js`. If not, add it to the import.

**Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(flight-path): display flight paths in kiosk mode with toggle and tooltip"
```

---

### Task 12: Update Deps Interfaces

**Files:**
- Modify: `src/types.ts` (ArchivePipelineDeps, ExportDeps, EventWiringDeps)

**Step 1: Add flightPathGroup to ArchivePipelineDeps sceneRefs Pick**

In `ArchivePipelineDeps` (~line 242), add `'flightPathGroup'` to the Pick:

```typescript
sceneRefs: Pick<SceneRefs, 'scene' | 'camera' | 'controls' | 'renderer' | 'splatMesh' | 'modelGroup' | 'pointcloudGroup' | 'cadGroup' | 'drawingGroup' | 'flightPathGroup'>;
```

**Step 2: Add handleFlightPathFile to EventWiringDeps if using deps pattern**

If the flight path file handler is wired through event-wiring.ts (via deps), add to the `files` block in `EventWiringDeps`:

```typescript
handleFlightPathFile: (e: Event) => void;
```

Otherwise, if wired directly in main.ts init(), skip this step.

**Step 3: Run build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(flight-path): update deps interfaces with flightPathGroup"
```

---

### Task 13: Final Verification

**Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass including the new flight-parsers tests.

**Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

**Step 3: Run lint**

```bash
npm run lint
```

Expected: No new lint errors (warnings OK).

**Step 4: Manual smoke test**

1. `npm run dev`
2. Open `/editor/`
3. Click the Flight "File" button
4. Import a test CSV with GPS data
5. Verify: blue line appears in the scene
6. Verify: hover over markers shows telemetry tooltip
7. Verify: transform gizmo can move/rotate the path
8. Export as archive, reload — verify path persists

**Step 5: Final commit (if any lint fixes needed)**

```bash
git add -A
git commit -m "chore(flight-path): lint fixes and cleanup"
```
