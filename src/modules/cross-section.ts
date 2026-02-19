/**
 * Cross-Section Tool
 *
 * Adds a movable, rotatable clipping plane to the scene using material-level
 * clipping (material.clippingPlanes). The Gaussian splat mesh is intentionally
 * excluded — Spark.js uses a custom shader incompatible with Three.js clipping.
 *
 * Usage:
 *   const cs = new CrossSectionTool(scene, camera, renderer, controls,
 *                                   modelGroup, pointcloudGroup, stlGroup);
 *   cs.start(new THREE.Vector3(0, 0, 0)); // activate with bbox center
 *   cs.updatePlane();                     // call each frame in animate()
 *   cs.stop();                            // deactivate
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Logger } from './utilities.js';

const log = Logger.getLogger('cross-section');

export class CrossSectionTool {
    private _active = false;

    /** Shared THREE.Plane instance — mutated each frame; referenced by material.clippingPlanes. */
    private _plane: THREE.Plane;

    /** Invisible pivot Object3D that the gizmo attaches to; its world transform drives the plane. */
    private _planeAnchor: THREE.Object3D;

    /** Semi-transparent quad that visualises the cutting plane. */
    private _planeMesh: THREE.Mesh;

    /** Dedicated TransformControls for the plane anchor (independent of the asset gizmo). */
    private _transformControls: any;

    /** Materials that have had clippingPlanes set; tracked so we can clear them on stop(). */
    private _trackedMaterials: THREE.Material[] = [];

    constructor(
        private readonly _scene: THREE.Scene,
        private readonly _camera: any,
        private readonly _renderer: any,
        private readonly _orbitControls: any,         // OrbitControls — disabled while gizmo drags
        private readonly _modelGroup: THREE.Group,
        private readonly _pointcloudGroup: THREE.Group,
        private readonly _stlGroup: THREE.Group | null,
    ) {
        // Y-up normal, passing through origin (snapped to Y axis by default)
        this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

        // Invisible anchor — gizmo attaches here; its world transform drives the plane
        this._planeAnchor = new THREE.Object3D();
        this._scene.add(this._planeAnchor);

        // Semi-transparent visual plane mesh
        const geo = new THREE.PlaneGeometry(20, 20);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x0088ff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.15,
            depthWrite: false,
        });
        this._planeMesh = new THREE.Mesh(geo, mat);
        this._planeMesh.renderOrder = 1;
        this._planeMesh.visible = false;
        this._scene.add(this._planeMesh);

        // Dedicated TransformControls for the plane anchor
        this._transformControls = new TransformControls(this._camera, this._renderer.domElement);
        this._transformControls.setMode('translate');
        this._transformControls.attach(this._planeAnchor);

        // Block orbit controls while dragging the plane gizmo
        this._transformControls.addEventListener('dragging-changed', (event: any) => {
            if (this._orbitControls) {
                this._orbitControls.enabled = !event.value;
            }
        });

        const helper = this._transformControls.getHelper();
        helper.visible = false;
        this._scene.add(helper);

        log.info('CrossSectionTool initialized');
    }

    get active(): boolean { return this._active; }

    // ─── Lifecycle ────────────────────────────────────────────

    /**
     * Activate the tool — shows the gizmo, applies clipping to all tracked
     * asset groups, and centres the plane at `center`.
     */
    start(center: THREE.Vector3): void {
        this._active = true;
        this._planeAnchor.position.copy(center);
        this._planeAnchor.rotation.set(0, 0, 0);
        this._transformControls.setMode('translate');
        this._transformControls.getHelper().visible = true;
        this._planeMesh.visible = true;
        this._applyClipping();
        this.updatePlane();
        log.info('Cross-section activated at', center);
    }

    /** Deactivate — removes clipping from all materials and hides the gizmo. */
    stop(): void {
        this._active = false;
        this._transformControls.getHelper().visible = false;
        this._planeMesh.visible = false;
        this._removeClipping();
        // Ensure orbit controls are re-enabled if a drag was interrupted
        if (this._orbitControls) this._orbitControls.enabled = true;
        log.info('Cross-section deactivated');
    }

    // ─── Per-frame ────────────────────────────────────────────

    /**
     * Sync the THREE.Plane with the anchor's current world transform.
     * Call once per frame inside the animate() loop.
     */
    updatePlane(): void {
        if (!this._active) return;

        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        this._planeAnchor.getWorldPosition(pos);
        this._planeAnchor.getWorldQuaternion(quat);

        // Anchor's local +Y is the plane normal
        const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
        this._plane.setFromNormalAndCoplanarPoint(normal, pos);

        // Keep visual mesh aligned with anchor
        this._planeMesh.position.copy(pos);
        this._planeMesh.quaternion.copy(quat);
    }

    // ─── Controls ─────────────────────────────────────────────

    /** Switch the gizmo between translate and rotate modes. */
    setMode(mode: 'translate' | 'rotate'): void {
        this._transformControls.setMode(mode);
    }

    /**
     * Snap the cutting plane normal to a world axis.
     * 'x' → XZ plane, 'y' → XZ horizontal (default), 'z' → XY plane.
     */
    setAxis(axis: 'x' | 'y' | 'z'): void {
        this._planeAnchor.rotation.set(0, 0, 0);
        if (axis === 'x') {
            // Normal points +X: rotate anchor -90° around Z
            this._planeAnchor.rotation.z = -Math.PI / 2;
        } else if (axis === 'z') {
            // Normal points +Z: rotate anchor +90° around X
            this._planeAnchor.rotation.x = Math.PI / 2;
        }
        // 'y' = no rotation → +Y normal (default)
        this.updatePlane();
    }

    /** Flip the plane direction by rotating the anchor 180° around its local X. */
    flip(): void {
        this._planeAnchor.rotateX(Math.PI);
        this.updatePlane();
    }

    /** Recentre the plane at `center` and restore the default Y-up orientation. */
    reset(center: THREE.Vector3): void {
        this._planeAnchor.position.copy(center);
        this._planeAnchor.rotation.set(0, 0, 0);
        this.updatePlane();
    }

    /**
     * Re-walk asset groups and update tracked materials.
     * Call after new assets are loaded while the tool is active.
     */
    reapplyClipping(): void {
        if (!this._active) return;
        this._removeClipping();
        this._applyClipping();
    }

    // ─── Private helpers ──────────────────────────────────────

    private _applyClipping(): void {
        this._trackedMaterials = [];
        const groups: Array<THREE.Object3D | null> = [
            this._modelGroup,
            this._pointcloudGroup,
            this._stlGroup,
        ];
        for (const group of groups) {
            if (group) this._applyToObject(group);
        }
        log.debug('Clipping applied to', this._trackedMaterials.length, 'materials');
    }

    private _applyToObject(obj: THREE.Object3D): void {
        if ((obj as THREE.Mesh).isMesh || (obj as any).isPoints) {
            const anyObj = obj as any;
            const mats: THREE.Material[] = Array.isArray(anyObj.material)
                ? anyObj.material
                : [anyObj.material];
            for (const m of mats) {
                if (!m) continue;
                m.clippingPlanes = [this._plane];
                m.needsUpdate = true;
                this._trackedMaterials.push(m);
            }
        }
        for (const child of obj.children) {
            this._applyToObject(child);
        }
    }

    private _removeClipping(): void {
        for (const m of this._trackedMaterials) {
            m.clippingPlanes = [];
            m.needsUpdate = true;
        }
        this._trackedMaterials = [];
    }
}
