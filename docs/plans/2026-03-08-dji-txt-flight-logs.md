# DJI .txt Flight Log Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add support for importing DJI binary `.txt` flight record files via the `dji-log-parser-js` WASM library, with v13+ decryption when a DJI API key is configured.

**Architecture:** New `dji-txt-parser.ts` module wraps the WASM library (lazy singleton pattern matching `cad-loader.ts`). The existing `flight-path.ts` gains an `importBinaryFile()` method for binary formats, while text-based formats continue through `importFromText()`. Format detection, constants, HTML accept attributes, and archive reload paths are updated.

**Tech Stack:** `dji-log-parser-js` (npm, WASM), TypeScript, Vite

---

### Task 1: Install dji-log-parser-js

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts:134-137`

**Step 1: Install the dependency**

Run: `npm install dji-log-parser-js`

**Step 2: Add to optimizeDeps.exclude in vite.config.ts**

In `vite.config.ts`, find the `optimizeDeps.exclude` array (line ~137) and add `'dji-log-parser-js'`:

```ts
exclude: ['@sparkjsdev/spark', 'occt-import-js', 'meshoptimizer', 'dji-log-parser-js'],
```

**Step 3: Verify dev server starts**

Run: `npm run dev` — confirm no errors on startup.

**Step 4: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "feat(flight): add dji-log-parser-js dependency for DJI .txt flight logs"
```

---

### Task 2: Create dji-txt-parser.ts module

**Files:**
- Create: `src/modules/dji-txt-parser.ts`
- Reference: `src/modules/cad-loader.ts` (singleton pattern)
- Reference: `src/types.ts:190-202` (FlightPoint interface)

**Step 1: Create the parser module**

Create `src/modules/dji-txt-parser.ts`:

```ts
/**
 * DJI .txt Flight Log Parser
 *
 * Parses DJI binary flight record files (.txt) using dji-log-parser-js (WASM).
 * Handles all log versions (1–14). Versions 13+ require a DJI API key
 * configured via the VITE_DJI_API_KEY environment variable.
 */

import { Logger } from './utilities.js';
import { gpsToLocal } from './flight-parsers.js';
import type { FlightPoint } from '@/types.js';

const log = Logger.getLogger('dji-txt-parser');

// ===== Lazy WASM singleton =====

let _parserModule: typeof import('dji-log-parser-js') | null = null;

async function getParserModule(): Promise<typeof import('dji-log-parser-js')> {
    if (_parserModule) return _parserModule;
    log.info('Initializing dji-log-parser-js WASM...');
    _parserModule = await import('dji-log-parser-js');
    log.info('dji-log-parser-js WASM ready');
    return _parserModule;
}

// ===== Public API =====

/**
 * Parse a DJI binary .txt flight record from an ArrayBuffer.
 * Returns FlightPoint[] compatible with FlightPathManager.
 *
 * @throws Error if the log is v13+ encrypted and no API key is configured
 * @throws Error if no valid GPS data is found
 */
export async function parseDjiTxt(buffer: ArrayBuffer): Promise<FlightPoint[]> {
    const mod = await getParserModule();

    const bytes = new Uint8Array(buffer);
    const parser = new mod.DJILog(bytes);

    // Determine if we need an API key for decryption
    let frames;
    const apiKey = (import.meta.env.VITE_DJI_API_KEY as string | undefined) || '';

    try {
        if (apiKey) {
            frames = await parser.frames(apiKey);
        } else {
            // Try without key — works for versions ≤12
            frames = await parser.frames('');
        }
    } catch (err: any) {
        const msg = String(err?.message || err);
        if (msg.includes('decrypt') || msg.includes('key') || msg.includes('encrypt')) {
            throw new Error(
                'This DJI flight log is encrypted (v13+) and requires a DJI API key for decryption. ' +
                'Set VITE_DJI_API_KEY in your environment, or export the log as CSV from airdata.com'
            );
        }
        throw new Error(`Failed to parse DJI flight log: ${msg}`);
    }

    // Extract GPS data from OSD frames
    const points: FlightPoint[] = [];
    let originLat = 0, originLon = 0, originAlt = 0;

    for (const frame of frames) {
        const osd = frame.osd;
        if (!osd) continue;

        const lat = osd.latitude;
        const lon = osd.longitude;
        const alt = osd.altitude ?? 0;

        if (lat === undefined || lon === undefined || lat === 0 || lon === 0) continue;
        if (isNaN(lat) || isNaN(lon)) continue;

        if (points.length === 0) {
            originLat = lat;
            originLon = lon;
            originAlt = alt;
        }

        const local = gpsToLocal(lat, lon, alt, originLat, originLon, originAlt);

        // Compute ground speed from velocity components if available
        const xSpeed = osd.x_speed ?? 0;
        const ySpeed = osd.y_speed ?? 0;
        const speed = Math.sqrt(xSpeed * xSpeed + ySpeed * ySpeed) || undefined;

        const heading = osd.yaw ?? undefined;
        const timestamp = (osd.fly_time ?? points.length * 0.1) * 1000; // seconds → ms

        // Gimbal data from gimbal frame if available
        const gimbal = frame.gimbal;
        const gimbalPitch = gimbal?.pitch ?? undefined;
        const gimbalYaw = gimbal?.yaw ?? undefined;

        points.push({
            ...local,
            lat, lon, alt, timestamp,
            speed,
            heading,
            gimbalPitch,
            gimbalYaw,
        });
    }

    return points;
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
If type errors arise from `dji-log-parser-js`, add a minimal type declaration (see Task 3).

**Step 3: Commit**

```bash
git add src/modules/dji-txt-parser.ts
git commit -m "feat(flight): add DJI .txt binary parser module"
```

---

### Task 3: Add type declarations if needed

**Files:**
- Create (if needed): `src/types/dji-log-parser-js.d.ts`

**Step 1: Check if dji-log-parser-js ships its own types**

Run: `ls node_modules/dji-log-parser-js/*.d.ts 2>/dev/null`

If types exist, skip this task. If not, create `src/types/dji-log-parser-js.d.ts`:

```ts
declare module 'dji-log-parser-js' {
    export class DJILog {
        constructor(bytes: Uint8Array);
        frames(apiKey: string): Promise<DJIFrame[]>;
    }

    export interface DJIFrame {
        osd?: DJIFrameOSD;
        gimbal?: DJIFrameGimbal;
        battery?: DJIFrameBattery;
        rc?: DJIFrameRC;
        home?: DJIFrameHome;
    }

    export interface DJIFrameOSD {
        latitude: number;
        longitude: number;
        altitude?: number;
        height?: number;
        fly_time?: number;
        x_speed?: number;
        y_speed?: number;
        z_speed?: number;
        pitch?: number;
        roll?: number;
        yaw?: number;
        gps_num?: number;
        is_motor_on?: boolean;
        is_on_ground?: boolean;
    }

    export interface DJIFrameGimbal {
        pitch?: number;
        roll?: number;
        yaw?: number;
    }

    export interface DJIFrameBattery {
        charge_level?: number;
        voltage?: number;
        current?: number;
        temperature?: number;
    }

    export interface DJIFrameRC {
        aileron?: number;
        elevator?: number;
        throttle?: number;
        rudder?: number;
    }

    export interface DJIFrameHome {
        latitude?: number;
        longitude?: number;
        altitude?: number;
        height_limit?: number;
    }
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit` — should pass.

**Step 3: Commit (if file was created)**

```bash
git add src/types/dji-log-parser-js.d.ts
git commit -m "chore: add type declarations for dji-log-parser-js"
```

---

### Task 4: Update format detection and constants

**Files:**
- Modify: `src/modules/flight-parsers.ts:31-44` (detectFormat)
- Modify: `src/modules/constants.ts:307` (EXTENSIONS)
- Modify: `src/types.ts:208` (sourceFormat type comment)

**Step 1: Add `.txt` to FLIGHT_LOG.EXTENSIONS**

In `src/modules/constants.ts` line 307, change:

```ts
EXTENSIONS: ['.csv', '.kml', '.kmz', '.srt'],
```

to:

```ts
EXTENSIONS: ['.csv', '.kml', '.kmz', '.srt', '.txt'],
```

**Step 2: Add `'dji-txt'` to detectFormat**

In `src/modules/flight-parsers.ts`, in the `detectFormat` function, add after the `ext === 'srt'` check (line ~36):

```ts
if (ext === 'txt') return 'dji-txt';
```

**Step 3: Update the sourceFormat comment in types.ts**

In `src/types.ts` line 208, update the comment:

```ts
sourceFormat: string;    // 'dji-csv' | 'kml' | 'srt' | 'dji-txt'
```

**Step 4: Commit**

```bash
git add src/modules/constants.ts src/modules/flight-parsers.ts src/types.ts
git commit -m "feat(flight): add .txt to flight log format detection and constants"
```

---

### Task 5: Update FlightPathManager for binary import

**Files:**
- Modify: `src/modules/flight-path.ts:11` (imports)
- Modify: `src/modules/flight-path.ts:54-98` (importFile, importFromText, new importBinary)

**Step 1: Add import for parseDjiTxt**

At `src/modules/flight-path.ts` line 11, add:

```ts
import { parseDjiTxt } from './dji-txt-parser.js';
```

**Step 2: Update importFile to detect binary format**

Replace the `importFile` method (lines 55-58) with:

```ts
async importFile(file: File): Promise<FlightPathData> {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'txt') {
        const buffer = await file.arrayBuffer();
        return this.importBinary(buffer, file.name, 'dji-txt');
    }
    const text = await file.text();
    return this.importFromText(text, file.name);
}
```

**Step 3: Add importBinary method**

Add after `importFromText` (after line 98):

```ts
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
        maxAltM: Math.max(...points.map(p => p.alt)),
    };

    this.paths.push(data);
    this.renderPath(data);
    log.info(`Imported flight path "${fileName}": ${points.length} points, ${data.durationS}s duration`);
    return data;
}
```

**Step 4: Commit**

```bash
git add src/modules/flight-path.ts
git commit -m "feat(flight): add binary import path for DJI .txt files"
```

---

### Task 6: Update archive reload path

**Files:**
- Modify: `src/main.ts:651-661` (renderFlightPaths callback)

**Step 1: Update renderFlightPaths to handle binary .txt files**

In `src/main.ts` lines 651-661, replace the `renderFlightPaths` callback:

```ts
renderFlightPaths: async () => {
    if (!flightPathManager) return;
    const fpStore = getStore();
    for (const fp of fpStore.flightPathBlobs) {
        try {
            const ext = fp.fileName.split('.').pop()?.toLowerCase() || '';
            if (ext === 'txt') {
                const buffer = await fp.blob.arrayBuffer();
                await flightPathManager.importBinary(buffer, fp.fileName, 'dji-txt');
            } else {
                const text = await fp.blob.text();
                flightPathManager.importFromText(text, fp.fileName);
            }
        } catch (err) {
            console.warn('[main] Failed to parse flight path:', fp.fileName, err);
        }
    }
},
```

**Step 2: Commit**

```bash
git add src/main.ts
git commit -m "feat(flight): handle binary .txt flight paths in archive reload"
```

---

### Task 7: Update HTML file input accept attribute

**Files:**
- Modify: `src/editor/index.html:1143-1144`

**Step 1: Add .txt to accept attribute and hint text**

In `src/editor/index.html` line 1143, change:

```html
<input type="file" id="flightpath-input" accept=".csv,.kml,.kmz,.srt" style="display:none" />
<span id="flightpath-filename" class="prop-hint">.csv, .kml, .kmz, .srt</span>
```

to:

```html
<input type="file" id="flightpath-input" accept=".csv,.kml,.kmz,.srt,.txt" style="display:none" />
<span id="flightpath-filename" class="prop-hint">.csv, .kml, .kmz, .srt, .txt</span>
```

**Step 2: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(flight): accept .txt files in flight path file picker"
```

---

### Task 8: Build verification

**Step 1: Run the build**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 2: Run tests**

Run: `npm test`
Expected: All existing tests pass (flight parser tests still work for CSV/KML/SRT).

**Step 3: Run lint**

Run: `npm run lint`
Expected: 0 errors.

**Step 4: Final commit if any fixes were needed**

---

### Task 9: Update ROADMAP if applicable

**Files:**
- Modify: `ROADMAP.MD` (if flight path or DJI items are listed)

**Step 1: Check ROADMAP for relevant items**

Search for flight-related entries and mark as completed if present.

**Step 2: Commit if changed**

```bash
git add ROADMAP.MD
git commit -m "docs: mark DJI .txt flight log support as complete in roadmap"
```
