/**
 * DJI .txt Flight Log Parser
 *
 * Parses DJI binary flight record files (.txt) using dji-log-parser-js (WASM).
 * Handles all log versions (1–14). Versions 13+ require a DJI API key
 * configured via Docker env var DJI_API_KEY or admin settings (flight.djiApiKey).
 */

import { Logger } from './utilities.js';
import { gpsToLocal } from './flight-parsers.js';
import type { FlightPoint } from '@/types.js';

const log = Logger.getLogger('dji-txt-parser');

// ===== Lazy module singleton =====

let _mod: typeof import('dji-log-parser-js') | null = null;

async function getModule(): Promise<typeof import('dji-log-parser-js')> {
    if (_mod) return _mod;
    log.info('Loading dji-log-parser-js WASM...');
    _mod = await import('dji-log-parser-js');
    log.info('dji-log-parser-js ready');
    return _mod;
}

// ===== Public API =====

/**
 * Parse a DJI binary .txt flight record from an ArrayBuffer.
 * Returns FlightPoint[] compatible with FlightPathManager.
 */
export async function parseDjiTxt(buffer: ArrayBuffer): Promise<FlightPoint[]> {
    const mod = await getModule();
    const parser = new mod.DJILog(new Uint8Array(buffer));

    // For v13+ logs, fetch keychains via server-side proxy to avoid CORS
    let keychains;

    if (parser.version >= 13) {
        try {
            log.info(`Log version ${parser.version} — fetching decryption keychains via proxy...`);
            const reqBody = parser.keychainsRequest();
            const resp = await fetch('/api/dji-keychains', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ error: resp.statusText }));
                throw new Error((err as any).error || `HTTP ${resp.status}`);
            }
            const result = await resp.json();
            keychains = (result as any).data;
        } catch (err: any) {
            throw new Error(
                `Failed to fetch DJI decryption keychains: ${err?.message || err}. ` +
                'Check that DJI_API_KEY is set correctly (Docker env var or admin settings), ' +
                'or export the log as CSV from airdata.com'
            );
        }
    }

    let frames;
    try {
        frames = parser.frames(keychains);
    } catch (err: any) {
        throw new Error(`Failed to parse DJI flight log: ${err?.message || err}`);
    }

    // Convert frames to FlightPoints
    // Use osd.height (AGL — above ground/takeoff) instead of osd.altitude (ASL — sea level)
    // so the flight path starts near ground level and shows relative flight height.
    const points: FlightPoint[] = [];
    let originLat = 0, originLon = 0;

    for (const frame of frames) {
        const osd = frame.osd;
        const lat = osd.latitude;
        const lon = osd.longitude;
        const alt = osd.height; // AGL: 0 at takeoff, positive = up

        if (lat === 0 && lon === 0) continue;

        if (points.length === 0) {
            originLat = lat;
            originLon = lon;
        }

        // Pass height as both alt and originAlt=0 so gpsToLocal uses it directly as Y
        const local = gpsToLocal(lat, lon, alt, originLat, originLon, 0);
        const speed = Math.sqrt(osd.xSpeed * osd.xSpeed + osd.ySpeed * osd.ySpeed) || undefined;

        points.push({
            ...local,
            lat, lon, alt,
            timestamp: osd.flyTime * 1000,
            speed,
            heading: osd.yaw,
            gimbalPitch: frame.gimbal.pitch,
            gimbalYaw: frame.gimbal.yaw,
        });
    }

    return points;
}
