import { Logger } from './utilities.js';
import type { SelectedObject } from '@/types.js';

const log = Logger.getLogger('undo-manager');

/** Snapshot of one or more object matrices (keyed by object type name) */
export type MatrixSnapshot = Partial<Record<string, { elements: ArrayLike<number>; clone(): any }>>;

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

    canUndo(): boolean { return this.undoStack.length > 0; }
    canRedo(): boolean { return this.redoStack.length > 0; }

    clear(): void {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        log.info('Undo history cleared');
    }
}
