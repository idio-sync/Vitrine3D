/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { UndoManager } from '../undo-manager.js';
import type { UndoEntry } from '../undo-manager.js';
import type { SelectedObject } from '@/types.js';

/** Helper to create a mock matrix object */
function mockMatrix(values: number[]) {
    return { elements: values, clone() { return mockMatrix([...values]); } };
}

function makeEntry(
    objectId: SelectedObject,
    beforeValues: number[],
    afterValues: number[],
): UndoEntry {
    return {
        objectId,
        beforeMatrices: { [objectId]: mockMatrix(beforeValues) },
        afterMatrices: { [objectId]: mockMatrix(afterValues) },
    };
}

describe('UndoManager', () => {
    let mgr: UndoManager;

    beforeEach(() => {
        mgr = new UndoManager();
    });

    it('starts empty — canUndo and canRedo both false', () => {
        expect(mgr.canUndo()).toBe(false);
        expect(mgr.canRedo()).toBe(false);
    });

    it('push makes undo available', () => {
        mgr.push(makeEntry('model', [1], [2]));
        expect(mgr.canUndo()).toBe(true);
        expect(mgr.canRedo()).toBe(false);
    });

    it('undo returns the entry with before-state', () => {
        const entry = makeEntry('splat', [1, 2, 3], [4, 5, 6]);
        mgr.push(entry);
        const result = mgr.undo();
        expect(result).not.toBeNull();
        expect(result!.objectId).toBe('splat');
        expect(Array.from(result!.beforeMatrices['splat']!.elements)).toEqual([1, 2, 3]);
    });

    it('redo returns the entry with after-state', () => {
        const entry = makeEntry('model', [10], [20]);
        mgr.push(entry);
        mgr.undo();
        const result = mgr.redo();
        expect(result).not.toBeNull();
        expect(result!.objectId).toBe('model');
        expect(Array.from(result!.afterMatrices['model']!.elements)).toEqual([20]);
    });

    it('new push clears redo stack', () => {
        mgr.push(makeEntry('splat', [1], [2]));
        mgr.undo();
        expect(mgr.canRedo()).toBe(true);

        mgr.push(makeEntry('model', [3], [4]));
        expect(mgr.canRedo()).toBe(false);
    });

    it('respects max stack size', () => {
        const small = new UndoManager(3);
        for (let i = 0; i < 5; i++) {
            small.push(makeEntry('splat', [i], [i + 10]));
        }
        expect(small.canUndo()).toBe(true);

        // Should only be able to undo 3 times
        expect(small.undo()).not.toBeNull();
        expect(small.undo()).not.toBeNull();
        expect(small.undo()).not.toBeNull();
        expect(small.undo()).toBeNull();
    });

    it('clear resets everything', () => {
        mgr.push(makeEntry('splat', [1], [2]));
        mgr.push(makeEntry('model', [3], [4]));
        mgr.undo(); // one in redo
        expect(mgr.canUndo()).toBe(true);
        expect(mgr.canRedo()).toBe(true);

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
        const entry: UndoEntry = {
            objectId: 'both',
            beforeMatrices: {
                splat: mockMatrix([1, 0, 0, 0]),
                model: mockMatrix([0, 1, 0, 0]),
            },
            afterMatrices: {
                splat: mockMatrix([2, 0, 0, 0]),
                model: mockMatrix([0, 2, 0, 0]),
            },
        };
        mgr.push(entry);

        const undone = mgr.undo()!;
        expect(undone.objectId).toBe('both');
        expect(Array.from(undone.beforeMatrices['splat']!.elements)).toEqual([1, 0, 0, 0]);
        expect(Array.from(undone.beforeMatrices['model']!.elements)).toEqual([0, 1, 0, 0]);

        const redone = mgr.redo()!;
        expect(Array.from(redone.afterMatrices['splat']!.elements)).toEqual([2, 0, 0, 0]);
        expect(Array.from(redone.afterMatrices['model']!.elements)).toEqual([0, 2, 0, 0]);
    });
});
