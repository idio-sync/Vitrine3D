# Multi-Subject Collections

**Date**: 2026-03-03
**Status**: Design approved, pending implementation

## Problem

Vitrine3D handles one 3D subject per archive. Clients often need related subjects presented together — multiple scans from the same site, different objects by the same creator, or assets documenting the same event. There's no way to tie them together presentationally or switch between them in kiosk mode.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Packaging | Single archive (.a3z) | One file to distribute, works offline, minimal format changes. Multi-archive can be added later. |
| Manifest approach | Additive `subjects[]` field | Backward compatible — old archives have no `subjects`, new archives degrade gracefully in old viewers. |
| Editor workflow | "Promote existing scene" | Build a scene as today, snapshot it as a subject, start the next. Natural extension of current workflow. |
| Navigation modes | Sequential (guided) + Browse (free), per-collection | Author chooses the presentation style. |
| Subject vs. walkthrough | Two separate layers | Subjects swap assets (heavy). Walkthroughs move the camera (light). A subject can have its own walkthrough. |
| Metadata | Inherit with override | Collection-level metadata applies to all subjects. Per-subject sparse overrides for fields that differ. |
| Spatial relationship | Both supported | Some subjects share coordinate space, some are independent. Format doesn't enforce either. |

## Archive Format (v1.1)

The manifest gains two new optional top-level fields. Archives without them behave exactly as v1.0.

```jsonc
{
  "format_version": "1.1",

  // NEW — collection-level settings
  "collection": {
    "mode": "sequential",             // "sequential" | "browse"
    "title": "123 Main Street",
    "description": "Full site documentation, March 2026"
  },

  // NEW — ordered subject list
  "subjects": [
    {
      "id": "exterior",
      "title": "Building Exterior",
      "description": "Front and side facades",
      "entries": ["scene_0", "mesh_0"],
      "camera": { "position": [x, y, z], "target": [x, y, z] },
      "thumbnail": "thumbnails/exterior.jpg",
      "metadata_overrides": {
        "provenance": { "captureDate": "2026-02-15" }
      }
    },
    {
      "id": "lobby",
      "title": "Lobby Interior",
      "entries": ["scene_1", "pointcloud_0"],
      "camera": { "position": [x, y, z], "target": [x, y, z] },
      "thumbnail": "thumbnails/lobby.jpg"
    }
  ],

  // UNCHANGED — flat asset registry
  "data_entries": {
    "scene_0": { "file": "assets/scene_0.ply", "role": "splat" },
    "scene_1": { "file": "assets/scene_1.ply", "role": "splat" },
    "mesh_0":  { "file": "assets/mesh_0.glb",  "role": "mesh" },
    "pointcloud_0": { "file": "assets/pointcloud_0.e57", "role": "pointcloud" }
  },

  // UNCHANGED — collection-level metadata (inherited by all subjects)
  "metadata": { ... },

  // Annotations gain optional subject_id field
  "annotations": [
    { "id": "a1", "subject_id": "exterior", "position": [...], "text": "..." },
    { "id": "a2", "position": [...], "text": "Global annotation, shown in all subjects" }
  ],

  "alignment": { ... }
}
```

### Key format rules

- `subjects` is an ordered array — order defines sequential presentation
- Each subject's `entries` references keys from the flat `data_entries`
- `metadata_overrides` is sparse — only fields that differ from collection level
- Annotations without `subject_id` are global (shown in all subjects)
- Two subjects can reference the same entry (shared-space collections)
- `format_version` bumps to `"1.1"` — loaders handle both `1.0` and `1.1`

## Editor Workflow

### "Add as Subject" flow

1. Build a scene as today — load splat, mesh, pointcloud, align, annotate
2. Click **"Add as Subject"** button:
   - Snapshots current asset blobs + transforms
   - Captures camera position/target as preset view
   - Takes viewport screenshot as thumbnail
   - Prompts for subject title (defaults to "Subject 1", "Subject 2", ...)
   - Clears viewport for the next subject
3. **Subject list panel** appears in sidebar once 2+ subjects exist:
   - Reorder via drag or up/down buttons
   - Click subject to reload it for editing
   - Delete, rename, update camera preset
4. **Collection settings** in metadata sidebar:
   - Collection title, description
   - Navigation mode toggle (Sequential / Browse)
   - Per-subject metadata overrides (expandable)
5. **Export** packs all subjects into one .a3z

### State changes

```typescript
// New AppState fields
activeSubjectIndex: number | null;    // null = no collection
subjects: SubjectState[];

interface SubjectState {
  id: string;
  title: string;
  description?: string;
  entries: Map<string, { blob: Blob; filename: string; transform: Transform }>;
  camera: { position: Vector3; target: Vector3 };
  thumbnail?: Blob;
  annotations: Annotation[];
  metadataOverrides?: Partial<Metadata>;
}
```

## Kiosk Presentation

### Loading

```
Open .a3z → Parse manifest
  If subjects[] exists:
    → Store subjects in KioskState
    → Set activeSubjectIndex = 0
    → Extract thumbnails for browse mode UI
    → Load first subject's entries only
    → Theme receives onSubjectChange(0, subject, total)
  If no subjects (legacy):
    → Existing behavior, unchanged
```

### Subject switching

```
switchSubject(newIndex):
  1. Theme.onSubjectTransitionStart(oldIndex, newIndex)
  2. Dispose current 3D assets
  3. Filter annotations to global + new subject's
  4. Extract new subject's entries (cached after first extract)
  5. Load assets into scene
  6. Animate camera to subject's preset
  7. Theme.onSubjectTransitionEnd(newIndex)
  8. If subject has walkthrough, hand off to walkthrough system
```

### Caching

Extracted blobs are kept in a `Map<string, Blob>` after first extraction. Only Three.js objects are disposed/recreated on switch. Switching back to a previously viewed subject skips ZIP extraction.

### Two-layer navigation

- **Outer layer (subjects)**: Switches which assets are in the scene. Managed by kiosk-main.ts.
- **Inner layer (walkthrough)**: Moves camera within the current subject. Existing system, unchanged.

In sequential mode: load subject → play its walkthrough (if any) → advance to next subject.

## Theme Integration

### Theme contract (optional hooks)

```javascript
// Themes that handle collections implement these optional callbacks:
return {
  setup: function(deps) { ... },
  onSubjectChange: function(index, subject, total) { ... },
  onSubjectTransitionStart: function(fromIndex, toIndex) { ... },
  onSubjectTransitionEnd: function(toIndex) { ... },
  // ... existing hooks unchanged
};
```

Themes that don't implement these hooks get a minimal fallback UI from kiosk-main.ts.

### Gallery theme

The gallery theme's existing walkthrough primitives (timeline dots, chapter cards, letterbox bars) map directly to subject navigation:

| Walkthrough primitive | Collection use |
|---|---|
| Timeline dots | Subject indicator dots |
| Chapter card (number + title + desc) | Subject title card |
| Letterbox bars | Transition between subjects |
| `gallery-walkthrough-jump` event | Subject switch event |

Sequential mode: timeline dots at top → letterbox close → chapter card → asset swap → letterbox open → camera animate.

Browse mode: timeline dots always visible, click to jump. No letterbox transitions.

### Editorial theme

Sequential mode: title block updates to `Subject 1 of N — "Building Exterior"` with subtle prev/next arrows. Smooth camera pans.

Browse mode: compact subject list below title block — numbered titles, click to switch.

### Minimal / no theme (fallback)

Sequential: prev/next buttons + `1 / 5` counter in corner.
Browse: dropdown or horizontal tab bar.

## Backward Compatibility

| Scenario | Behavior |
|---|---|
| Old archive (no `subjects`) in new viewer | Treated as single implicit subject. No collection UI. Zero behavior change. |
| New archive (with `subjects`) in old viewer | Old viewer ignores unknown fields. Loads first asset of each type. Degraded but functional. |
| Collection with 1 subject | Valid. No navigation UI shown. Same as non-collection. |

## Edge Cases

| Scenario | Behavior |
|---|---|
| Subject with no assets | Allowed (title slide with metadata/description only). |
| Subject referencing nonexistent entry | Skip entry, log warning, load remaining. |
| Annotations without `subject_id` | Shown in all subjects (global). |
| Annotations with unknown `subject_id` | Hidden, log warning. |
| Shared entry refs across subjects | Supported. Loader detects shared refs, skips dispose/reload. |
| Large collection (10+ subjects) | No hard limit. Browse scrolls. Sequential dots scroll. |

## Out of Scope (Future Extensions)

- Multi-archive collections (`.a3c` manifest linking separate `.a3z` files)
- Cross-subject walkthroughs (spanning multiple subjects)
- Subject-level permissions/access control
- Nested collections (a subject containing a collection)
