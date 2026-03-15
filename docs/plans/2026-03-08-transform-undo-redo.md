# Transform Undo/Redo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Ctrl+Z / Ctrl+Shift+Z undo/redo for transform gizmo operations in the editor.

**Architecture:** New `UndoManager` class tracks before/after matrix snapshots for each gizmo drag. Scene-manager's existing `dragging-changed` callback captures snapshots. Event-wiring routes Ctrl+Z/Y to undo/redo. For "both" mode, all object matrices are captured as a group.

**Tech Stack:** Three.js Matrix4, existing transform-controller.ts patterns, Vitest for tests.

---

### Task 1: Create UndoManager module with tests

**Files:**
- Create: `src/modules/undo-manager.ts`
- Create: `src/modules/__tests__/undo-manager.test.ts`

**Step 1: Write the test file**

```typescript
// src/modules/__tests__/undo-manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { UndoManager } from '../undo-manager.js';
import type { SelectedObject } from '@/types.js';

// Minimal Matrix4-like for testing (just needs toArray/fromArray)
function makeMatrix(values: number[]) {
    return {
        elements: Float64Array.from(values),
        clone() {
            return makeMatrix([...this.elements]);
        },
    };
}

function identity() {
    return makeMatrix([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

function translated(x: number, y: number, z: number) {
    return makeMatrix([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);
}

describe('UndoManager', () => {
    let mgr: UndoManager;

    beforeEach(() => {
        mgr = new UndoManager(20);
    });

    it('starts empty', () => {
        expect(mgr.canUndo()).toBe(false);
        expect(mgr.canRedo()).toBe(false);
    });

    it('push makes undo available', () => {
        mgr.push({ objectId: 'splat', beforeMatrices: { splat: identity() }, afterMatrices: { splat: translated(1,0,0) } });
        expect(mgr.canUndo()).toBe(true);
        expect(mgr.canRedo()).toBe(false);
    });

    it('undo returns the before-state', () => {
        const before = { splat: identity() };
        const after = { splat: translated(5,0,0) };
        mgr.push({ objectId: 'splat', beforeMatrices: before, afterMatrices: after });
        const entry = mgr.undo();
        expect(entry).not.toBeNull();
        expect(entry!.beforeMatrices.splat.elements[12]).toBe(0); // x=0
    });

    it('redo returns the after-state', () => {
        const before = { splat: identity() };
        const after = { splat: translated(5,0,0) };
        mgr.push({ objectId: 'splat', beforeMatrices: before, afterMatrices: after });
        mgr.undo();
        expect(mgr.canRedo()).toBe(true);
        const entry = mgr.redo();
        expect(entry).not.toBeNull();
        expect(entry!.afterMatrices.splat.elements[12]).toBe(5); // x=5
    });

    it('new push clears redo stack', () => {
        mgr.push({ objectId: 'splat', beforeMatrices: { splat: identity() }, afterMatrices: { splat: translated(1,0,0) } });
        mgr.undo();
        expect(mgr.canRedo()).toBe(true);
        mgr.push({ objectId: 'model', beforeMatrices: { model: identity() }, afterMatrices: { model: translated(2,0,0) } });
        expect(mgr.canRedo()).toBe(false);
    });

    it('respects max stack size', () => {
        const small = new UndoManager(3);
        for (let i = 0; i < 5; i++) {
            small.push({ objectId: 'splat', beforeMatrices: { splat: translated(i,0,0) }, afterMatrices: { splat: translated(i+1,0,0) } });
        }
        // Should only be able to undo 3 times
        expect(small.undo()).not.toBeNull();
        expect(small.undo()).not.toBeNull();
        expect(small.undo()).not.toBeNull();
        expect(small.undo()).toBeNull();
    });

    it('clear resets everything', () => {
        mgr.push({ objectId: 'splat', beforeMatrices: { splat: identity() }, afterMatrices: { splat: translated(1,0,0) } });
        mgr.clear();
        expect(mgr.canUndo()).toBe(false);
        expect(mgr.canRedo()).toBe(false);
    });

    it('undo on empty returns null', () => {
        expect(mgr.undo()).toBeNull();
    });

    it('redo on empty returns null', () => {
        expect(mgr.redo()).toBeNull();
    });

    it('handles both-mode with multiple object matrices', () => {
        const before = { splat: identity(), model: identity() };
        const after = { splat: translated(1,0,0), model: translated(1,0,0) };
        mgr.push({ objectId: 'both', beforeMatrices: before, afterMatrices: after });
        const entry = mgr.undo();
        expect(entry).not.toBeNull();
        expect(entry!.beforeMatrices.splat).toBeDefined();
        expect(entry!.beforeMatrices.model).toBeDefined();
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/__tests__/undo-manager.test.ts`
Expected: FAIL — module not found

**Step 3: Write the UndoManager module**

```typescript
// src/modules/undo-manager.ts
import { Logger } from './utilities.js';
import type { SelectedObject } from '@/types.js';

const log = Logger.getLogger('undo-manager');

/** Matrix-like object — uses Three.js Matrix4 at runtime, but typed loosely for testability */
interface MatrixLike {
    elements: ArrayLike<number>;
    clone(): MatrixLike;
}

/** Snapshot of one or more object matrices (keyed by object type) */
export type MatrixSnapshot = Partial<Record<string, MatrixLike>>;

export interface UndoEntry {
    objectId: SelectedObject;
    beforeMatrices: MatrixSnapshot;
    afterMatrices: MatrixSnapshot;
}

/**
 * Fixed-size undo/redo stack for transform operations.
 * Stores before/after matrix snapshots. The caller is responsible for
 * applying the returned matrices to the actual scene objects.
 */
export class UndoManager {
    private undoStack: UndoEntry[] = [];
    private redoStack: UndoEntry[] = [];
    private maxSize: number;

    constructor(maxSize = 20) {
        this.maxSize = maxSize;
    }

    push(entry: UndoEntry): void {
        this.undoStack.push(entry);
        if (this.undoStack.length > this.maxSize) {
            this.undoStack.shift();
        }
        this.redoStack.length = 0;
        log.info(`Pushed undo entry for ${entry.objectId} (stack: ${this.undoStack.length})`);
    }

    undo(): UndoEntry | null {
        const entry = this.undoStack.pop() ?? null;
        if (entry) {
            this.redoStack.push(entry);
            log.info(`Undo: ${entry.objectId} (undo: ${this.undoStack.length}, redo: ${this.redoStack.length})`);
        }
        return entry;
    }

    redo(): UndoEntry | null {
        const entry = this.redoStack.pop() ?? null;
        if (entry) {
            this.undoStack.push(entry);
            log.info(`Redo: ${entry.objectId} (undo: ${this.undoStack.length}, redo: ${this.redoStack.length})`);
        }
        return entry;
    }

    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    clear(): void {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        log.info('Undo history cleared');
    }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/__tests__/undo-manager.test.ts`
Expected: All 9 tests PASS

**Step 5: Commit**

```bash
git add src/modules/undo-manager.ts src/modules/__tests__/undo-manager.test.ts
git commit -m "feat(editor): add UndoManager class for transform undo/redo"
```

---

### Task 2: Wire undo snapshots into SceneManager drag events

**Files:**
- Modify: `src/main.ts` (around lines 1088-1100, the `onTransformChange` / `onDraggingChanged` area)
- Modify: `src/types.ts` (add `undoManager` to `EventWiringDeps`)

**Step 1: Add UndoManager to main.ts**

In `main.ts`, after the existing imports, add:
```typescript
import { UndoManager } from './modules/undo-manager.js';
```

In `init()`, before the `sceneManager.onTransformChange` assignment (~line 1088), add:
```typescript
const undoManager = new UndoManager(20);
```

**Step 2: Capture before-state on drag start**

Add a `_dragBeforeMatrices` variable at module scope (near the other module-scope variables):
```typescript
import type { MatrixSnapshot } from './modules/undo-manager.js';
let _dragBeforeMatrices: MatrixSnapshot | null = null;
```

Set `sceneManager.onDraggingChanged` in `init()` (it may already be null or unused — add/replace it):
```typescript
sceneManager.onDraggingChanged = (dragging: boolean) => {
    if (dragging) {
        // Capture before-state when drag starts
        _dragBeforeMatrices = captureTransformMatrices();
    } else if (_dragBeforeMatrices) {
        // Drag ended — push undo entry
        const afterMatrices = captureTransformMatrices();
        undoManager.push({
            objectId: state.selectedObject,
            beforeMatrices: _dragBeforeMatrices,
            afterMatrices,
        });
        _dragBeforeMatrices = null;
    }
};
```

**Step 3: Add the `captureTransformMatrices` helper**

Add this function in `main.ts` (near the other transform helpers):
```typescript
import * as THREE from 'three';

function captureTransformMatrices(): MatrixSnapshot {
    const snap: MatrixSnapshot = {};
    if (splatMesh) snap.splat = splatMesh.matrix.clone();
    if (modelGroup) snap.model = modelGroup.matrix.clone();
    if (pointcloudGroup) snap.pointcloud = pointcloudGroup.matrix.clone();
    if (stlGroup) snap.stl = stlGroup.matrix.clone();
    if (cadGroup) snap.cad = cadGroup.matrix.clone();
    if (drawingGroup) snap.drawing = drawingGroup.matrix.clone();
    if (flightPathGroup) snap.flightpath = flightPathGroup.matrix.clone();
    // Force matrix update so we capture current state
    for (const obj of [splatMesh, modelGroup, pointcloudGroup, stlGroup, cadGroup, drawingGroup, flightPathGroup]) {
        if (obj) obj.updateMatrix();
    }
    const result: MatrixSnapshot = {};
    if (splatMesh) result.splat = splatMesh.matrix.clone();
    if (modelGroup) result.model = modelGroup.matrix.clone();
    if (pointcloudGroup) result.pointcloud = pointcloudGroup.matrix.clone();
    if (stlGroup) result.stl = stlGroup.matrix.clone();
    if (cadGroup) result.cad = cadGroup.matrix.clone();
    if (drawingGroup) result.drawing = drawingGroup.matrix.clone();
    if (flightPathGroup) result.flightpath = flightPathGroup.matrix.clone();
    return result;
}
```

**Step 4: Add `applyTransformMatrices` helper**

```typescript
function applyTransformMatrices(snapshot: MatrixSnapshot): void {
    const apply = (obj: THREE.Object3D | null, key: string) => {
        const mat = snapshot[key];
        if (!obj || !mat) return;
        const m = mat as THREE.Matrix4;
        m.decompose(obj.position, obj.quaternion, obj.scale);
        obj.rotation.setFromQuaternion(obj.quaternion);
    };
    apply(splatMesh, 'splat');
    apply(modelGroup, 'model');
    apply(pointcloudGroup, 'pointcloud');
    apply(stlGroup, 'stl');
    apply(cadGroup, 'cad');
    apply(drawingGroup, 'drawing');
    apply(flightPathGroup, 'flightpath');

    // Re-sync transform-controller's tracking state
    storeLastPositions();
    updateTransformInputs();
}
```

**Step 5: Expose undoManager for event-wiring**

Make `undoManager` accessible to the keyboard handler. Add `performUndo` and `performRedo` wrapper functions in `main.ts`:
```typescript
function performUndo(): void {
    const entry = undoManager.undo();
    if (entry) {
        applyTransformMatrices(entry.beforeMatrices);
        notify('Undo transform', 'info');
    }
}

function performRedo(): void {
    const entry = undoManager.redo();
    if (entry) {
        applyTransformMatrices(entry.afterMatrices);
        notify('Redo transform', 'info');
    }
}
```

**Step 6: Add undo/redo to EventWiringDeps**

In `src/types.ts`, add to `EventWiringDeps`:
```typescript
undo: {
    performUndo: () => void;
    performRedo: () => void;
};
```

In `main.ts`, update `createEventWiringDeps()` to include:
```typescript
undo: {
    performUndo,
    performRedo,
},
```

**Step 7: Commit**

```bash
git add src/main.ts src/types.ts
git commit -m "feat(editor): wire undo snapshot capture into transform drag events"
```

---

### Task 3: Add Ctrl+Z / Ctrl+Shift+Z keyboard handler

**Files:**
- Modify: `src/modules/event-wiring.ts` (lines 897-912, the keyboard handler)

**Step 1: Replace the Ctrl+key guard with undo/redo routing**

In `event-wiring.ts`, replace line 912:
```typescript
if (e.ctrlKey || e.metaKey) return;
```

With:
```typescript
// Handle Ctrl/Cmd shortcuts
if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        deps.undo.performUndo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        deps.undo.performRedo();
    }
    return;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add src/modules/event-wiring.ts
git commit -m "feat(editor): add Ctrl+Z/Ctrl+Shift+Z keyboard shortcuts for undo/redo"
```

---

### Task 4: Push undo state for numeric transform input changes

**Files:**
- Modify: `src/modules/event-wiring.ts` (lines 347-420, the transform pane input handlers)

**Step 1: Capture before-state before each numeric input applies**

At the top of each `addListener(`transform-pos-${axis}`, 'change', ...)`, `transform-rot-${axis}`, and `transform-scale-${axis}` handler, add a call to capture and push undo state. The cleanest approach: add a `captureBeforeTransform` and `pushAfterTransform` pair to the `undo` deps.

Update `EventWiringDeps` in `src/types.ts`:
```typescript
undo: {
    performUndo: () => void;
    performRedo: () => void;
    captureBeforeNumericEdit: () => void;
    pushAfterNumericEdit: () => void;
};
```

In `main.ts`, add to the undo deps:
```typescript
let _numericEditBefore: MatrixSnapshot | null = null;

// In createEventWiringDeps():
undo: {
    performUndo,
    performRedo,
    captureBeforeNumericEdit: () => {
        _numericEditBefore = captureTransformMatrices();
    },
    pushAfterNumericEdit: () => {
        if (_numericEditBefore) {
            const after = captureTransformMatrices();
            undoManager.push({
                objectId: state.selectedObject,
                beforeMatrices: _numericEditBefore,
                afterMatrices: after,
            });
            _numericEditBefore = null;
        }
    },
},
```

**Step 2: Wire into numeric input handlers**

In `event-wiring.ts`, in each of the three `addListener` blocks (pos, rot, scale), add before the first mutation:
```typescript
deps.undo.captureBeforeNumericEdit();
```
And after the last mutation (before the closing `}`):
```typescript
deps.undo.pushAfterNumericEdit();
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/modules/event-wiring.ts src/main.ts src/types.ts
git commit -m "feat(editor): track undo state for numeric transform input changes"
```

---

### Task 5: Clear undo on scene reset / new archive load

**Files:**
- Modify: `src/main.ts` (in `loadDefaultFiles` and archive-loading paths)

**Step 1: Clear undo stack in clearScene or equivalent**

Search for where state/scene is reset (clearing splats, models, etc.) and add `undoManager.clear()` at the start. Likely locations:
- The `loadDefaultFiles()` function
- Any `clearScene()` or scene-reset handler
- The archive pipeline load path

Add `undoManager.clear()` at the start of `loadDefaultFiles()` and wherever assets are bulk-replaced.

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(editor): clear undo stack on scene reset and archive load"
```

---

### Task 6: Run all tests and verify

**Step 1: Run full test suite**

Run: `npm test`
Expected: All existing tests pass + new undo-manager tests pass

**Step 2: Run build**

Run: `npm run build`
Expected: Clean build, no errors

**Step 3: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK)

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address lint/test issues from undo/redo feature"
```
