// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

describe('VR Session', () => {
    describe('module exports', () => {
        it('exports public API', async () => {
            const mod = await import('../vr-session.js');
            expect(mod.initVR).toBeDefined();
            expect(mod.updateVR).toBeDefined();
            expect(mod.isInVR).toBeDefined();
            expect(mod.shouldSkipRAF).toBeDefined();
            expect(mod.disposeVR).toBeDefined();
            expect(mod.getLocomotionMode).toBeDefined();
            expect(mod.setLocomotionMode).toBeDefined();
        });

        it('isInVR returns false before init', async () => {
            const { isInVR } = await import('../vr-session.js');
            expect(isInVR()).toBe(false);
        });

        it('shouldSkipRAF returns false before init', async () => {
            const { shouldSkipRAF } = await import('../vr-session.js');
            expect(shouldSkipRAF()).toBe(false);
        });

        it('getLocomotionMode defaults to teleport', async () => {
            const { getLocomotionMode } = await import('../vr-session.js');
            expect(getLocomotionMode()).toBe('teleport');
        });
    });

    describe('teleport arc calculation', () => {
        it('generates correct number of points', async () => {
            const { calculateArc } = await import('../vr-session.js');
            const origin = new THREE.Vector3(0, 1.5, 0);
            const direction = new THREE.Vector3(0, 0.3, -1).normalize();
            const points = calculateArc(origin, direction, 5.0);
            expect(points.length).toBe(30); // TELEPORT_ARC_SEGMENTS
        });

        it('arc descends due to gravity', async () => {
            const { calculateArc } = await import('../vr-session.js');
            const origin = new THREE.Vector3(0, 1.5, 0);
            const direction = new THREE.Vector3(0, 0, -1);
            const points = calculateArc(origin, direction, 5.0);
            // Last point should be lower than first due to gravity
            expect(points[points.length - 1].y).toBeLessThan(points[0].y);
        });

        it('arc starts at origin', async () => {
            const { calculateArc } = await import('../vr-session.js');
            const origin = new THREE.Vector3(1, 2, 3);
            const direction = new THREE.Vector3(0, 0, -1);
            const points = calculateArc(origin, direction, 5.0);
            expect(points[0].x).toBeCloseTo(1);
            expect(points[0].y).toBeCloseTo(2);
            expect(points[0].z).toBeCloseTo(3);
        });

        it('higher velocity produces longer arc', async () => {
            const { calculateArc } = await import('../vr-session.js');
            const origin = new THREE.Vector3(0, 1.5, 0);
            const direction = new THREE.Vector3(0, 0, -1);
            const slowArc = calculateArc(origin, direction, 3.0);
            const fastArc = calculateArc(origin, direction, 8.0);
            // Fast arc last point should be further from origin in Z
            expect(Math.abs(fastArc[fastArc.length - 1].z)).toBeGreaterThan(
                Math.abs(slowArc[slowArc.length - 1].z)
            );
        });
    });

    describe('teleport landing detection', () => {
        // Raycasting requires WebGL which jsdom does not provide.
        // These tests verify the function signature and empty-scene behavior.
        it('returns null when no walkable surface', async () => {
            const { calculateArc, findTeleportLanding } = await import('../vr-session.js');
            const scene = new THREE.Scene(); // Empty scene

            const origin = new THREE.Vector3(0, 2, 0);
            const direction = new THREE.Vector3(0, 0, -1);
            const points = calculateArc(origin, direction, 5.0);
            const landing = findTeleportLanding(points, scene, 20);

            expect(landing).toBeNull();
        });
    });

    describe('VR constants', () => {
        it('VR constants are properly defined', async () => {
            const { VR } = await import('../constants.js');
            expect(VR.SPLAT_BUDGET_PC).toBe(2_000_000);
            expect(VR.SPLAT_BUDGET_STANDALONE).toBe(500_000);
            expect(VR.TELEPORT_MAX_DISTANCE).toBe(20);
            expect(VR.SNAP_TURN_DEGREES).toBe(30);
            expect(VR.MARKER_SCALE_VR).toBe(2.0);
            expect(VR.MAX_STD_DEV).toBeCloseTo(Math.sqrt(5));
            expect(VR.FRAMEBUFFER_SCALE).toBe(0.5);
            expect(VR.TELEPORT_FADE_MS).toBe(200);
            expect(VR.WRIST_MENU_LOOK_THRESHOLD).toBe(0.7);
        });
    });
});
