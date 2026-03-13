# PASS Viewer Phase 3: QA Defect Annotation

**Date:** 2026-03-10
**Scope:** Industrial theme — defect annotation fields, editing UI, CSV export
**Complexity:** MEDIUM

---

## Context

The industrial theme kiosk already supports read-only annotation display via `buildAnnotationsSection()` (layout.js ~line 1448) and callbacks `onAnnotationSelect` / `onAnnotationDeselect`. Phase 3 makes annotations writable inside the viewer: adds QA fields (severity, category, status, notes), an inline editing form in the info panel, and a CSV export button.

Key constraint: kiosk mode is normally read-only. The industrial theme already breaks from this for the annotation tool; Phase 3 extends that pattern further.

---

## Work Objectives

1. Extend the `Annotation` interface with optional QA fields (no breaking changes).
2. Build an annotation detail/edit form in the industrial info panel.
3. Wire form save → `annotationSystem.updateAnnotation()` → persist to archive manifest.
4. Add CSV export of defect data to the annotations section header.
5. Verify the build is clean.

---

## Guardrails

**Must Have**
- QA fields are optional — existing archives with no QA fields load and display without error.
- Form appears when an annotation is selected; list view is restored on deselect.
- Save persists to the in-memory manifest so a subsequent archive export includes QA fields.
- CSV export includes: title, severity, category, status, notes, x/y/z coordinates.

**Must NOT Have**
- No changes to `kiosk-main.ts` annotation save/load path — QA fields ride along as plain object properties.
- No new npm dependencies.
- Do not modify the `Annotation` interface in a way that breaks the editor or existing archive round-trips.
- Do not touch `annotation-system.ts` internal marker rendering — only the interface and `updateAnnotation` call surface.

---

## Task Flow

### Step 1 — Extend Annotation interface (`annotation-system.ts`)

Add optional QA fields directly to the existing `Annotation` interface:

```typescript
// In annotation-system.ts, existing Annotation interface
interface Annotation {
    id: string;
    title: string;
    description: string;
    position: { x: number; y: number; z: number };
    camera_position: { x: number; y: number; z: number };
    timestamp: string;
    image?: string;
    // QA fields (Phase 3)
    severity?: 'low' | 'medium' | 'high' | 'critical';
    category?: 'surface_defect' | 'gap' | 'missing_data' | 'scan_artifact' | 'dimensional_variance' | 'other';
    status?: 'pass' | 'fail' | 'review';
    qa_notes?: string;
}
```

**Acceptance criteria:**
- `npm run build` passes with no type errors after the change.
- Existing annotation objects without QA fields satisfy the interface (all fields optional).

---

### Step 2 — Annotation detail/edit form in layout.js

Add a new function `buildAnnotationDetailForm(annotation, onSave, onCancel)` in `layout.js` that returns a DOM element containing:

- Title input (pre-filled)
- Description textarea (pre-filled)
- Severity dropdown: Low / Medium / High / Critical — styled with color indicator dots (green / yellow / orange / red) via inline style or CSS class
- Category dropdown: Surface Defect / Gap / Missing Data / Scan Artifact / Dimensional Variance / Other
- Status toggle: three buttons Pass / Fail / Review — active state highlighted
- Notes textarea
- Save button + Cancel button

Use the existing `createEl(tag, className, innerHTML)` helper throughout. No external dependencies.

**Acceptance criteria:**
- Function exists and returns a DOM node.
- All fields pre-populate from the passed annotation object.
- Cancel button calls `onCancel()` without side effects.

---

### Step 3 — Wire form into `onAnnotationSelect` / `onAnnotationDeselect`

Modify `onAnnotationSelect(annotationId)` in layout.js:

1. After showing the annotation popup (existing behavior), also call a new helper `showAnnotationDetailPanel(annotation)` that:
   - Finds or creates a `#annotation-detail-panel` section in the info panel body.
   - Replaces the annotations list content with the edit form from Step 2.
2. On Save: read form values, call `_deps.annotationSystem.updateAnnotation(annotation.id, { severity, category, status, qa_notes, title, description })`, then restore the list view and rebuild `buildAnnotationsSection`.
3. On Cancel / `onAnnotationDeselect`: restore the list view (call `buildAnnotationsSection` again with the current manifest).

**Acceptance criteria:**
- Clicking an annotation in the 3D view shows the edit form in the info panel.
- Saving updates the annotation in memory (verify via `_deps.annotationSystem.getAnnotations()`).
- Cancelling or clicking away restores the list without side effects.
- No console errors when selecting/deselecting rapidly.

---

### Step 4 — CSV export button

In `buildAnnotationsSection(body, manifest)`, add an "Export CSV" button to the section header (alongside any existing header controls).

On click:
1. Call `_deps.annotationSystem.getAnnotations()` to get current (possibly edited) annotations.
2. Build a CSV string: `title,severity,category,status,notes,x,y,z` — one row per annotation, values quoted.
3. Create a `Blob` with `type: 'text/csv'` and trigger a download via a temporary `<a>` element with `download="defects.csv"`.

**Acceptance criteria:**
- Button appears in the annotations section header.
- Clicking exports a valid CSV file.
- CSV includes all annotations, including any QA fields set to `undefined` as empty strings.
- If there are no annotations, the CSV exports with only the header row.

---

### Step 5 — Build verification

Run `npm run build` and confirm:
- Zero TypeScript errors.
- Both bundles (kiosk + editor) compile successfully.
- Run `npm test` to confirm no regressions in annotation-related test suites.

**Acceptance criteria:**
- `npm run build` exits 0.
- `npm test` exits 0 (or any pre-existing failures are unchanged).

---

## File Inventory

| File | Change type |
|------|-------------|
| `src/modules/annotation-system.ts` | Extend `Annotation` interface — add 4 optional QA fields |
| `src/themes/industrial/layout.js` | Add `buildAnnotationDetailForm()`, `showAnnotationDetailPanel()`, modify `onAnnotationSelect`, `onAnnotationDeselect`, `buildAnnotationsSection` |

No other files require changes. QA fields are plain object properties that flow through the existing manifest serialization in `archive-creator.ts` / `archive-loader.ts` at no cost.

---

## Success Criteria

- A user can click an annotation in the 3D view → see/edit severity, category, status, notes → save → the updated data is included in the next archive export.
- "Export CSV" produces a valid, downloadable file from the annotations panel.
- No regressions in editor or kiosk builds.
- No new npm dependencies added.
