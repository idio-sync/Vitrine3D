# Transform Undo/Redo Design

## Summary

Add a global undo/redo stack for transform gizmo operations in the editor, triggered by Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y).

## Architecture

### New module: `src/modules/undo-manager.ts`

- `UndoManager` class with a fixed-size stack (max 20 entries)
- Each entry stores: `{ objectId: SelectedObject, matrix: Matrix4, timestamp: number }`
- Two stacks: `undoStack` and `redoStack`. Performing a new action clears the redo stack.
- Methods: `pushState(objectId, matrix)`, `undo()`, `redo()`, `canUndo()`, `canRedo()`, `clear()`
- `undo()` / `redo()` return the snapshot to apply — the caller applies the matrix to the actual object

### Integration points

1. **scene-manager.ts** — On `dragging-changed` event, snapshot the matrix before drag starts (→ true), push the before-state when drag ends (→ false).
2. **event-wiring.ts** — Replace the `if (e.ctrlKey || e.metaKey) return;` guard with a Ctrl+key handler that routes Ctrl+Z → undo, Ctrl+Shift+Z / Ctrl+Y → redo.
3. **transform-controller.ts** — Add a helper that applies a matrix snapshot back to the correct object (splat, model, pointcloud, CAD, flight path).
4. **main.ts** — Instantiate `UndoManager`, wire it into deps, call `clear()` when loading a new scene.

### Keyboard bindings

| Shortcut | Action |
|----------|--------|
| Ctrl+Z | Undo last transform |
| Ctrl+Shift+Z | Redo |
| Ctrl+Y | Redo (alternative) |

### Edge cases

- **Before-state capture**: Snapshot the matrix on `dragging-changed → true`, push on `dragging-changed → false`. Clean before/after pairs.
- **Numeric input changes**: Push state before applying typed transform values in the transform pane.
- **Object deletion/reload**: `clear()` the stacks on scene reset to avoid stale references.
- **Input focus guard**: Ctrl+Z passes through to native browser undo when a text input/textarea is focused.

### Not in scope

- Annotation undo, metadata undo, asset add/remove undo (future expansion)
- Persistent history across sessions
