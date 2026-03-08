// @vitest-environment jsdom
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
    it('handles DJI format with misspelled longtitude', () => {
        const djiSrt = '1\n00:00:00,000 --> 00:00:01,000\n[latitude : 38.8893] [longtitude : -77.0502] [altitude: 100.0]\n';
        const points = parseSrt(djiSrt);
        expect(points).toHaveLength(1);
    });
});
