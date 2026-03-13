/**
 * Flight Log Parsers — Pure functions for parsing drone telemetry files.
 *
 * Supported formats:
 * - DJI CSV (exported from DJI Fly / DJI Pilot 2 / AirData)
 * - KML/KMZ (Google Earth format, exported by many flight tools)
 * - SRT (DJI subtitle telemetry embedded in video files)
 * - GPX (universal exchange format — used for pre-decoded DJI binary logs in archives)
 *
 * All parsers return FlightPoint[] with GPS coords converted to local 3D space.
 */

import type { FlightPoint } from '../types.js';

/** Parse a float, returning undefined only for NaN (not for zero). */
function parseOptionalFloat(value: string): number | undefined {
    const n = parseFloat(value);
    return isNaN(n) ? undefined : n;
}

// ===== GPS → Local Coordinate Conversion =====

/** Convert a GPS coordinate to local XYZ relative to an origin point.
 *  Uses flat-earth approximation — accurate within ~1km of origin. */
export function gpsToLocal(
    lat: number, lon: number, alt: number,
    originLat: number, originLon: number, originAlt: number
): { x: number; y: number; z: number } {
    const latRad = originLat * Math.PI / 180;
    const x = (lon - originLon) * Math.cos(latRad) * 111320;
    const z = (lat - originLat) * 111320;
    const y = alt - originAlt;
    return { x, y, z };
}

// ===== Helpers =====

/** Check if a string contains non-printable (binary) characters. */
function hasBinaryChars(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if ((c >= 0 && c <= 8) || (c >= 14 && c <= 31)) return true;
    }
    return false;
}

// ===== Format Detection =====

export function detectFormat(fileName: string, contentPeek: string): string | null {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'csv') return 'dji-csv';
    if (ext === 'kml') return 'kml';
    if (ext === 'kmz') return 'kmz';
    if (ext === 'srt') return 'srt';
    if (ext === 'gpx') return 'gpx';

    // Content-based detection (for files with ambiguous extensions like .txt)
    const lower = contentPeek.toLowerCase();
    if (lower.includes('latitude') && lower.includes('longitude')) return 'dji-csv';
    if (lower.includes('<kml') || (lower.includes('<?xml') && lower.includes('kml'))) return 'kml';
    if (/\[latitude[:\s]/i.test(contentPeek)) return 'srt';

    // DJI binary .txt flight records — only match DJI naming pattern or
    // files whose content starts with binary (non-printable) data
    if (ext === 'txt') {
        const baseName = fileName.split('/').pop()?.split('\\').pop() || '';
        if (/^DJIFlightRecord/i.test(baseName)) return 'dji-txt';
        // Check for binary content: DJI logs start with a binary header,
        // so if the first bytes contain non-printable characters it's likely a DJI log
        const head = contentPeek.slice(0, 20);
        if (head.length > 0 && hasBinaryChars(head)) return 'dji-txt';
    }

    return null;
}

// ===== Column Alias Matching =====

const COLUMN_ALIASES: Record<string, string[]> = {
    time: ['time(millisecond)', 'time', 'time_ms', 'elapsed_time', 'timestamp'],
    lat: ['latitude', 'lat', 'gps_lat', 'gps.lat'],
    lon: ['longitude', 'lon', 'lng', 'gps_lon', 'gps.lon', 'longtitude'],
    alt: ['altitude(m)', 'altitude', 'alt', 'height', 'gps_alt', 'abs_alt'],
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
            speed: speedIdx !== -1 ? parseOptionalFloat(cols[speedIdx]) : undefined,
            heading: headingIdx !== -1 ? parseOptionalFloat(cols[headingIdx]) : undefined,
            gimbalPitch: gimbalPitchIdx !== -1 ? parseOptionalFloat(cols[gimbalPitchIdx]) : undefined,
            gimbalYaw: gimbalYawIdx !== -1 ? parseOptionalFloat(cols[gimbalYawIdx]) : undefined,
        });
    }

    return points;
}

// ===== KML Parser =====

export function parseKml(kmlText: string): FlightPoint[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlText, 'text/xml');

    const coordElements = [
        ...Array.from(doc.getElementsByTagName('coordinates')),
        ...Array.from(doc.getElementsByTagNameNS('http://www.opengis.net/kml/2.2', 'coordinates')),
    ];

    const seen = new Set<Element>();
    const rawCoords: string[] = [];
    for (const el of coordElements) {
        if (seen.has(el)) continue;
        seen.add(el);
        rawCoords.push(el.textContent || '');
    }

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

export function parseSrt(srtText: string): FlightPoint[] {
    const blocks = srtText.trim().split(/\n\s*\n/);
    const points: FlightPoint[] = [];
    let originLat = 0, originLon = 0, originAlt = 0;

    const latRe = /\[latitude\s*:\s*([-\d.]+)\]/i;
    const lonRe = /\[(?:longitude|longtitude)\s*:\s*([-\d.]+)\]/i;
    const relAltRe = /\[?rel_alt\s*:\s*([-\d.]+)/i;
    const absAltRe = /\[?abs_alt\s*:\s*([-\d.]+)/i;
    const altRe = /\[(?:altitude|height)\s*:\s*([-\d.]+)\]/i;
    const timeRe = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        const text = lines.join(' ');

        const latMatch = latRe.exec(text);
        const lonMatch = lonRe.exec(text);
        const altMatch = relAltRe.exec(text) || absAltRe.exec(text) || altRe.exec(text);
        if (!latMatch || !lonMatch) continue;

        const lat = parseFloat(latMatch[1]);
        const lon = parseFloat(lonMatch[1]);
        const alt = altMatch ? parseFloat(altMatch[1]) : 0;

        if (isNaN(lat) || isNaN(lon)) continue;

        let timestamp = points.length * 200;
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

// ===== GPX Parser =====

export function parseGpx(gpxText: string): FlightPoint[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxText, 'text/xml');

    // Collect all <trkpt> elements (GPX 1.0/1.1, with or without namespace)
    const trkpts = [
        ...Array.from(doc.getElementsByTagName('trkpt')),
        ...Array.from(doc.getElementsByTagNameNS('http://www.topografix.com/GPX/1/1', 'trkpt')),
    ];
    const seen = new Set<Element>();

    const points: FlightPoint[] = [];
    let originLat = 0, originLon = 0, originAlt = 0;
    let baseTime = 0;

    for (const pt of trkpts) {
        if (seen.has(pt)) continue;
        seen.add(pt);

        const lat = parseFloat(pt.getAttribute('lat') || '');
        const lon = parseFloat(pt.getAttribute('lon') || '');
        if (isNaN(lat) || isNaN(lon)) continue;

        // Elevation — <ele> child
        const eleEl = pt.getElementsByTagName('ele')[0] ?? pt.getElementsByTagNameNS('http://www.topografix.com/GPX/1/1', 'ele')[0];
        const alt = eleEl ? parseFloat(eleEl.textContent || '0') : 0;

        // Time — <time> child → ms since flight start
        const timeEl = pt.getElementsByTagName('time')[0] ?? pt.getElementsByTagNameNS('http://www.topografix.com/GPX/1/1', 'time')[0];
        let timestamp = points.length * 1000;
        if (timeEl?.textContent) {
            const t = Date.parse(timeEl.textContent);
            if (!isNaN(t)) {
                if (points.length === 0) baseTime = t;
                timestamp = t - baseTime;
            }
        }

        // Extensions — speed, heading, gimbalPitch, gimbalYaw
        let speed: number | undefined;
        let heading: number | undefined;
        let gimbalPitch: number | undefined;
        let gimbalYaw: number | undefined;
        const extensions = pt.getElementsByTagName('extensions')[0];
        if (extensions) {
            speed = parseExtVal(extensions, 'speed');
            heading = parseExtVal(extensions, 'heading');
            gimbalPitch = parseExtVal(extensions, 'gimbalPitch');
            gimbalYaw = parseExtVal(extensions, 'gimbalYaw');
        }

        if (points.length === 0) {
            originLat = lat;
            originLon = lon;
            originAlt = alt;
        }

        const local = gpsToLocal(lat, lon, alt, originLat, originLon, originAlt);
        points.push({ ...local, lat, lon, alt, timestamp, speed, heading, gimbalPitch, gimbalYaw });
    }

    return points;
}

/** Extract a numeric value from a GPX <extensions> block by tag name. */
function parseExtVal(extensions: Element, tag: string): number | undefined {
    // Try bare tag name first, then namespaced
    const el = extensions.getElementsByTagName(tag)[0]
        ?? extensions.getElementsByTagNameNS('http://vitrine3d.app/gpx/1', tag)[0];
    if (!el?.textContent) return undefined;
    const n = parseFloat(el.textContent);
    return isNaN(n) ? undefined : n;
}

// ===== GPX Serializer =====

/** Convert FlightPoint[] to a GPX 1.1 XML string with Vitrine3D extensions for telemetry. */
export function flightPointsToGpx(points: FlightPoint[], name = 'Flight Path'): string {
    const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="Vitrine3D"',
        '     xmlns="http://www.topografix.com/GPX/1/1"',
        '     xmlns:v3d="http://vitrine3d.app/gpx/1">',
        '<trk>',
        `<name>${escapeXml(name)}</name>`,
        '<trkseg>',
    ];

    // Use a synthetic base time (epoch) so timestamps are absolute ISO strings
    const baseTime = Date.now();

    for (const p of points) {
        lines.push(`<trkpt lat="${p.lat}" lon="${p.lon}">`);
        lines.push(`<ele>${p.alt}</ele>`);
        lines.push(`<time>${new Date(baseTime + p.timestamp).toISOString()}</time>`);

        const exts: string[] = [];
        if (p.speed !== undefined) exts.push(`<v3d:speed>${p.speed}</v3d:speed>`);
        if (p.heading !== undefined) exts.push(`<v3d:heading>${p.heading}</v3d:heading>`);
        if (p.gimbalPitch !== undefined) exts.push(`<v3d:gimbalPitch>${p.gimbalPitch}</v3d:gimbalPitch>`);
        if (p.gimbalYaw !== undefined) exts.push(`<v3d:gimbalYaw>${p.gimbalYaw}</v3d:gimbalYaw>`);
        if (exts.length > 0) {
            lines.push(`<extensions>${exts.join('')}</extensions>`);
        }

        lines.push('</trkpt>');
    }

    lines.push('</trkseg>', '</trk>', '</gpx>');
    return lines.join('\n');
}

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
