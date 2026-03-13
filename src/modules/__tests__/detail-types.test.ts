// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Annotation, DetailViewSettings } from '@/types.js';

// Mock THREE.js for jsdom environment
vi.mock('three', () => {
    class Vector3 {
        x: number; y: number; z: number;
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
        set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
        copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
        clone() { return new Vector3(this.x, this.y, this.z); }
        project() { return this; }
        normalize() { return this; }
        dot() { return 1; }
        lerpVectors() { return this; }
        distanceTo() { return 0; }
    }
    class Vector2 {
        x: number; y: number;
        constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    }
    class Group {
        name = '';
        children: any[] = [];
        add() {}
        remove() {}
    }
    class Raycaster {
        setFromCamera() {}
        intersectObjects() { return []; }
    }
    return { Vector3, Vector2, Group, Raycaster };
});

describe('DetailViewSettings interface', () => {
    it('accepts all optional fields', () => {
        const settings: DetailViewSettings = {
            min_distance: 0.5,
            max_distance: 100,
            min_polar_angle: 0,
            max_polar_angle: Math.PI,
            enable_pan: true,
            auto_rotate: true,
            auto_rotate_speed: 2.0,
            damping_factor: 0.05,
            zoom_to_cursor: true,
            initial_camera_position: { x: 1, y: 2, z: 3 },
            initial_camera_target: { x: 0, y: 0, z: 0 },
            background_color: '#ffffff',
            environment_preset: 'studio',
            ambient_intensity: 0.5,
            show_grid: false,
            description: 'Test detail view',
            scale_reference: '1m ruler',
            annotations_visible_on_open: true,
        };
        expect(settings.min_distance).toBe(0.5);
        expect(settings.environment_preset).toBe('studio');
        expect(settings.annotations_visible_on_open).toBe(true);
    });

    it('accepts empty object (all fields optional)', () => {
        const settings: DetailViewSettings = {};
        expect(settings).toEqual({});
    });
});

describe('Annotation detail fields', () => {
    const baseAnnotation: Annotation = {
        id: 'anno_1',
        title: 'Test',
        body: 'Body text',
        position: { x: 1, y: 2, z: 3 },
        camera_target: { x: 0, y: 0, z: 0 },
        camera_position: { x: 5, y: 5, z: 5 },
    };

    it('accepts detail fields', () => {
        const annotation: Annotation = {
            ...baseAnnotation,
            detail_asset_key: 'detail_0',
            detail_button_label: 'Inspect Detail',
            detail_thumbnail: 'thumb.jpg',
            detail_view_settings: { auto_rotate: true, background_color: '#000' },
            detail_annotations: [
                {
                    id: 'da_1',
                    title: 'Sub annotation',
                    body: 'Detail body',
                    position: { x: 0.1, y: 0.2, z: 0.3 },
                    camera_target: { x: 0, y: 0, z: 0 },
                    camera_position: { x: 1, y: 1, z: 1 },
                },
            ],
        };
        expect(annotation.detail_asset_key).toBe('detail_0');
        expect(annotation.detail_button_label).toBe('Inspect Detail');
        expect(annotation.detail_thumbnail).toBe('thumb.jpg');
        expect(annotation.detail_annotations).toHaveLength(1);
        expect(annotation.detail_view_settings?.auto_rotate).toBe(true);
    });

    it('works without detail fields (backward compat)', () => {
        const annotation: Annotation = { ...baseAnnotation };
        expect(annotation.detail_asset_key).toBeUndefined();
        expect(annotation.detail_button_label).toBeUndefined();
        expect(annotation.detail_thumbnail).toBeUndefined();
        expect(annotation.detail_annotations).toBeUndefined();
        expect(annotation.detail_view_settings).toBeUndefined();
    });

    it('supports nested detail_annotations', () => {
        const nested: Annotation = {
            ...baseAnnotation,
            detail_annotations: [
                {
                    id: 'da_1',
                    title: 'Nested 1',
                    body: '',
                    position: { x: 0, y: 0, z: 0 },
                    camera_target: { x: 0, y: 0, z: 0 },
                    camera_position: { x: 1, y: 1, z: 1 },
                    camera_quaternion: { x: 0, y: 0, z: 0, w: 1 },
                },
                {
                    id: 'da_2',
                    title: 'Nested 2',
                    body: 'note',
                    position: { x: 1, y: 1, z: 1 },
                    camera_target: { x: 0, y: 0, z: 0 },
                    camera_position: { x: 2, y: 2, z: 2 },
                },
            ],
        };
        expect(nested.detail_annotations).toHaveLength(2);
        expect(nested.detail_annotations![0].camera_quaternion).toBeDefined();
        expect(nested.detail_annotations![1].camera_quaternion).toBeUndefined();
    });
});

describe('AnnotationSystem.toJSON() detail fields', () => {
    let AnnotationSystem: any;

    beforeEach(async () => {
        const mod = await import('../annotation-system.js');
        AnnotationSystem = mod.AnnotationSystem;
    });

    function createMockSystem() {
        const canvas = document.createElement('canvas');
        const mockRenderer = {
            domElement: canvas,
        };
        const mockControls = {
            target: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }) },
            autoRotate: false,
            enableDamping: false,
            enabled: true,
            update: () => {},
        };
        const mockScene = {
            add: () => {},
            remove: () => {},
            children: [],
        };
        const mockCamera = {
            position: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }), distanceTo: () => 0, copy: () => {} },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
        };
        return new AnnotationSystem(mockScene, mockCamera, mockRenderer, mockControls);
    }

    it('preserves detail fields in toJSON output', () => {
        const system = createMockSystem();
        system.annotations = [
            {
                id: 'anno_1',
                title: 'With Detail',
                body: 'Has detail model',
                position: { x: 1, y: 2, z: 3 },
                camera_target: { x: 0, y: 0, z: 0 },
                camera_position: { x: 5, y: 5, z: 5 },
                camera_quaternion: { x: 0, y: 0, z: 0, w: 1 },
                detail_asset_key: 'detail_0',
                detail_button_label: 'View Detail',
                detail_thumbnail: 'thumb.png',
                detail_annotations: [
                    {
                        id: 'da_1',
                        title: 'Sub',
                        body: 'sub body',
                        position: { x: 0.1, y: 0.2, z: 0.3 },
                        camera_target: { x: 0, y: 0, z: 0 },
                        camera_position: { x: 1, y: 1, z: 1 },
                        camera_quaternion: { x: 0, y: 0, z: 0, w: 1 },
                    },
                ],
                detail_view_settings: {
                    auto_rotate: true,
                    background_color: '#222',
                    environment_preset: 'warm' as const,
                },
            },
        ];

        const json = system.toJSON();
        expect(json).toHaveLength(1);
        expect(json[0].detail_asset_key).toBe('detail_0');
        expect(json[0].detail_button_label).toBe('View Detail');
        expect(json[0].detail_thumbnail).toBe('thumb.png');
        expect(json[0].detail_annotations).toHaveLength(1);
        expect(json[0].detail_annotations[0].id).toBe('da_1');
        expect(json[0].detail_annotations[0].camera_quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
        expect(json[0].detail_view_settings).toEqual({
            auto_rotate: true,
            background_color: '#222',
            environment_preset: 'warm',
        });
    });

    it('omits detail fields when not present', () => {
        const system = createMockSystem();
        system.annotations = [
            {
                id: 'anno_1',
                title: 'Plain',
                body: 'No detail',
                position: { x: 1, y: 2, z: 3 },
                camera_target: { x: 0, y: 0, z: 0 },
                camera_position: { x: 5, y: 5, z: 5 },
            },
        ];

        const json = system.toJSON();
        expect(json).toHaveLength(1);
        expect(json[0].detail_asset_key).toBeUndefined();
        expect(json[0].detail_button_label).toBeUndefined();
        expect(json[0].detail_thumbnail).toBeUndefined();
        expect(json[0].detail_annotations).toBeUndefined();
        expect(json[0].detail_view_settings).toBeUndefined();
    });

    it('omits detail_annotations when array is empty', () => {
        const system = createMockSystem();
        system.annotations = [
            {
                id: 'anno_1',
                title: 'Empty detail annos',
                body: '',
                position: { x: 0, y: 0, z: 0 },
                camera_target: { x: 0, y: 0, z: 0 },
                camera_position: { x: 1, y: 1, z: 1 },
                detail_asset_key: 'detail_0',
                detail_annotations: [],
            },
        ];

        const json = system.toJSON();
        expect(json[0].detail_asset_key).toBe('detail_0');
        expect(json[0].detail_annotations).toBeUndefined();
    });
});

describe('AnnotationSystem container parameterization', () => {
    let AnnotationSystem: any;

    beforeEach(async () => {
        const mod = await import('../annotation-system.js');
        AnnotationSystem = mod.AnnotationSystem;
    });

    function createDeps(options?: { markerContainer?: HTMLDivElement }) {
        const canvas = document.createElement('canvas');
        const mockRenderer = { domElement: canvas };
        const mockControls = {
            target: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }) },
            autoRotate: false,
            enableDamping: false,
            enabled: true,
            update: () => {},
        };
        const mockScene = { add: () => {}, remove: () => {}, children: [] };
        const mockCamera = {
            position: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }), distanceTo: () => 0, copy: () => {} },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
        };
        return new AnnotationSystem(mockScene, mockCamera, mockRenderer, mockControls, options);
    }

    it('uses default container when no override provided', () => {
        const system = createDeps();
        // Should have created or found a container
        expect(system.markerContainer).toBeTruthy();
        expect(system.markerContainer.id).toBe('annotation-markers');
    });

    it('uses custom container when provided', () => {
        const customDiv = document.createElement('div');
        customDiv.id = 'custom-marker-container';
        const system = createDeps({ markerContainer: customDiv });
        expect(system.markerContainer).toBe(customDiv);
        expect(system.markerContainer.id).toBe('custom-marker-container');
    });
});
