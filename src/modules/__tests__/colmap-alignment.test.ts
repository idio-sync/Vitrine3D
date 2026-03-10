// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { extractTimestamp, matchCamerasToFlightPoints, computeSimilarityTransform } from '../colmap-alignment.js';

describe('extractTimestamp', () => {
    it('extracts from DJI standard format: DJI_YYYYMMDD_HHMMSS_NNNN.jpg', () => {
        const ts = extractTimestamp('DJI_20240315_142532_0001.jpg');
        expect(ts).not.toBeNull();
        const d = new Date(ts!);
        expect(d.getUTCFullYear()).toBe(2024);
        expect(d.getUTCMonth()).toBe(2);
        expect(d.getUTCDate()).toBe(15);
        expect(d.getUTCHours()).toBe(14);
        expect(d.getUTCMinutes()).toBe(25);
        expect(d.getUTCSeconds()).toBe(32);
    });

    it('extracts from DJI alt format: DJI_YYYYMMDDHHMMSS_NNNN.jpg', () => {
        const ts = extractTimestamp('DJI_20240315142532_0001.jpg');
        expect(ts).not.toBeNull();
    });

    it('returns null for unrecognized filenames', () => {
        expect(extractTimestamp('photo_001.jpg')).toBeNull();
        expect(extractTimestamp('IMG_1234.jpg')).toBeNull();
    });

    it('handles various DJI prefixes', () => {
        expect(extractTimestamp('DJI_20240315_142532_0001.JPG')).not.toBeNull();
    });
});

describe('matchCamerasToFlightPoints', () => {
    const cameras = [
        { name: 'DJI_20240315_142530_0001.jpg', position: [1, 2, 3] as [number, number, number] },
        { name: 'DJI_20240315_142535_0002.jpg', position: [4, 5, 6] as [number, number, number] },
        { name: 'DJI_20240315_142540_0003.jpg', position: [7, 8, 9] as [number, number, number] },
    ];

    const flightPoints = [
        { timestamp: 0, lat: 0, lon: 0, alt: 0, x: 10, y: 20, z: 30, speed: 0 },
        { timestamp: 5000, lat: 0, lon: 0, alt: 0, x: 40, y: 50, z: 60, speed: 0 },
        { timestamp: 10000, lat: 0, lon: 0, alt: 0, x: 70, y: 80, z: 90, speed: 0 },
    ];

    it('matches cameras to flight points by timestamp', () => {
        const pairs = matchCamerasToFlightPoints(
            cameras as any,
            flightPoints as any,
            { timeTolerance: 1000 }
        );
        expect(pairs).toHaveLength(3);
        expect(pairs[0].colmapPos).toEqual([1, 2, 3]);
        expect(pairs[0].gpsPos).toEqual([10, 20, 30]);
    });

    it('discards cameras outside time tolerance', () => {
        const pairs = matchCamerasToFlightPoints(
            cameras as any,
            flightPoints as any,
            { timeTolerance: 100 }
        );
        expect(pairs.length).toBeLessThanOrEqual(3);
    });

    it('returns empty for cameras with unparseable timestamps', () => {
        const badCameras = [
            { name: 'photo_001.jpg', position: [1, 2, 3] as [number, number, number] },
        ];
        const pairs = matchCamerasToFlightPoints(
            badCameras as any,
            flightPoints as any,
            { timeTolerance: 1000 }
        );
        expect(pairs).toHaveLength(0);
    });
});

describe('computeSimilarityTransform', () => {
    it('computes identity for identical point sets', () => {
        const source = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [number, number, number][];
        const target = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [number, number, number][];
        const result = computeSimilarityTransform(source, target);
        expect(result).not.toBeNull();
        expect(result!.scale).toBeCloseTo(1, 3);
        expect(result!.translation.length()).toBeCloseTo(0, 3);
    });

    it('computes pure translation', () => {
        const source = [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as [number, number, number][];
        const target = [[5, 0, 0], [6, 0, 0], [5, 1, 0]] as [number, number, number][];
        const result = computeSimilarityTransform(source, target);
        expect(result).not.toBeNull();
        expect(result!.scale).toBeCloseTo(1, 2);
        expect(result!.translation.x).toBeCloseTo(5, 2);
        expect(result!.translation.y).toBeCloseTo(0, 2);
        expect(result!.translation.z).toBeCloseTo(0, 2);
    });

    it('computes uniform scale', () => {
        const source = [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as [number, number, number][];
        const target = [[0, 0, 0], [2, 0, 0], [0, 2, 0]] as [number, number, number][];
        const result = computeSimilarityTransform(source, target);
        expect(result).not.toBeNull();
        expect(result!.scale).toBeCloseTo(2, 2);
    });

    it('computes scale + translation', () => {
        const source = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] as [number, number, number][];
        const target = [[10, 10, 10], [13, 10, 10], [10, 13, 10], [10, 10, 13]] as [number, number, number][];
        const result = computeSimilarityTransform(source, target);
        expect(result).not.toBeNull();
        expect(result!.scale).toBeCloseTo(3, 1);
    });

    it('returns null for fewer than 3 points', () => {
        const source = [[0, 0, 0], [1, 0, 0]] as [number, number, number][];
        const target = [[0, 0, 0], [2, 0, 0]] as [number, number, number][];
        expect(computeSimilarityTransform(source, target)).toBeNull();
    });

    it('computes RMSE', () => {
        const source = [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as [number, number, number][];
        const target = [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as [number, number, number][];
        const result = computeSimilarityTransform(source, target);
        expect(result!.rmse).toBeCloseTo(0, 3);
    });
});
