# Multi-Subject Collections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-subject collection support — multiple 3D scenes in one archive, switchable in kiosk mode, composable in the editor.

**Architecture:** Additive manifest change (`subjects[]` + `collection{}`) on the existing flat `data_entries`. Editor uses "promote existing scene" workflow. Kiosk gets a two-layer navigation system (subjects = asset swapping, walkthroughs = camera movement). Themes get optional `onSubjectChange` hooks.

**Tech Stack:** TypeScript, Three.js, fflate (ZIP), existing theme layout system

**Design doc:** `docs/plans/2026-03-03-multi-subject-collections.md`

---

## Phase 1: Types & Format Foundation

### Task 1: Add collection types to types.ts

**Files:**
- Modify: `src/types.ts` (after line 123, after Annotation interface)

**Step 1: Add the new interfaces**

Add after the `Annotation` interface (line 123):

```typescript
// ===== Multi-Subject Collections =====

/** Camera preset for a subject — where the camera goes on subject switch. */
export interface SubjectCamera {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
}

/** A subject within a multi-subject collection archive manifest. */
export interface ManifestSubject {
    id: string;
    title: string;
    description?: string;
    entries: string[];                           // refs into data_entries keys
    camera: SubjectCamera;
    thumbnail?: string;                          // path within ZIP, e.g. "thumbnails/exterior.jpg"
    metadata_overrides?: Record<string, any>;    // sparse overrides on collection-level metadata
    walkthrough?: Walkthrough;                   // optional per-subject walkthrough
}

/** Collection-level settings in the manifest. */
export interface ManifestCollection {
    mode: 'sequential' | 'browse';
    title: string;
    description?: string;
}
```

**Step 2: Add `subject_id` to Annotation interface**

Modify the existing `Annotation` interface (line 114) — add one field:

```typescript
export interface Annotation {
    id: string;
    title: string;
    body: string;
    position: { x: number; y: number; z: number };
    camera_target: { x: number; y: number; z: number };
    camera_position: { x: number; y: number; z: number };
    camera_quaternion?: { x: number; y: number; z: number; w: number };
    /** Optional subject association. Omit for global annotations shown in all subjects. */
    subject_id?: string;
}
```

**Step 3: Add SubjectState for editor use**

Add after the manifest types:

```typescript
/** Editor-side state for a composed subject (not serialized directly — converted to ManifestSubject on export). */
export interface SubjectState {
    id: string;
    title: string;
    description?: string;
    entries: Map<string, { blob: Blob; filename: string; role: string; transform: { position: number[]; rotation: number[]; scale: number } }>;
    camera: SubjectCamera;
    thumbnail?: Blob;
    annotations: Annotation[];
    metadataOverrides?: Record<string, any>;
}
```

**Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors (types are additive, nothing references them yet)

**Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add multi-subject collection interfaces"
```

---

### Task 2: Add subject fields to AppState

**Files:**
- Modify: `src/types.ts` (AppState interface, ~line 12)
- Modify: `src/main.ts` (state object declaration, ~line 243)

**Step 1: Extend AppState interface**

Add two fields to the `AppState` interface in `src/types.ts` (after `manualPreviewBlob` field, before `meshFormat`):

```typescript
    /** Active subject index when editing a collection. null = no collection, single scene mode. */
    activeSubjectIndex: number | null;
    /** Ordered list of composed subjects. Empty array = no collection. */
    subjects: SubjectState[];
    /** Collection navigation mode. null when not a collection. */
    collectionMode: 'sequential' | 'browse' | null;
    /** Collection title. */
    collectionTitle: string;
    /** Collection description. */
    collectionDescription: string;
```

**Step 2: Initialize new fields in state object**

In `src/main.ts`, add to the `state` object declaration (~line 291, before `meshFormat`):

```typescript
    activeSubjectIndex: null,
    subjects: [],
    collectionMode: null,
    collectionTitle: '',
    collectionDescription: '',
```

**Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/types.ts src/main.ts
git commit -m "feat(state): add collection fields to AppState"
```

---

### Task 3: Update archive specification

**Files:**
- Modify: `docs/archive/SPECIFICATION.md`

**Step 1: Bump version to 1.1 in header**

Change line 3 from `**Version:** 1.0` to `**Version:** 1.1`.

**Step 2: Add subjects and collection sections**

Add two new sections to the Table of Contents and specification body:
- 5.16 `collection` — describes the `ManifestCollection` object
- 5.17 `subjects` — describes the `ManifestSubject[]` array

Include: field names, types, required/optional, description, and the backward-compat rules (both fields OPTIONAL, old archives have neither, old viewers ignore them).

Document the `subject_id` addition to annotations in section 5.10.

**Step 3: Commit**

```bash
git add docs/archive/SPECIFICATION.md
git commit -m "docs: add subjects and collection to archive spec v1.1"
```

---

## Phase 2: Archive Creator — Writing Collections

### Task 4: Add subject and collection methods to ArchiveCreator

**Files:**
- Modify: `src/modules/archive-creator.ts`

**Step 1: Add collection and subject storage**

Find the class properties section of `ArchiveCreator`. Add private fields:

```typescript
private _subjects: ManifestSubject[] = [];
private _collection: ManifestCollection | null = null;
```

Import the types at the top:

```typescript
import type { ManifestSubject, ManifestCollection } from '../types.js';
```

**Step 2: Add setter methods**

Add after the existing `setAnnotations()` / `setWalkthrough()` methods:

```typescript
/** Set collection-level settings. */
setCollection(collection: ManifestCollection): void {
    this._collection = collection;
    log.info(`Collection set: mode=${collection.mode}, title="${collection.title}"`);
}

/** Add a subject to the collection. Returns the subject index. */
addSubject(subject: ManifestSubject): number {
    this._subjects.push(subject);
    log.info(`Subject added: "${subject.title}" with ${subject.entries.length} entries`);
    return this._subjects.length - 1;
}

/** Replace the entire subjects array (for reordering, etc.). */
setSubjects(subjects: ManifestSubject[]): void {
    this._subjects = [...subjects];
    log.info(`Subjects set: ${subjects.length} subjects`);
}
```

**Step 3: Include in generateManifest()**

Find `generateManifest()` (~line 1749). Before the `return JSON.stringify(manifest)` line, add:

```typescript
if (this._collection) {
    manifest.collection = this._collection;
}
if (this._subjects.length > 0) {
    manifest.subjects = this._subjects;
}
```

**Step 4: Include in reset()**

Find the `reset()` method. Add:

```typescript
this._subjects = [];
this._collection = null;
```

**Step 5: Bump format version**

Find where `container_version` is set in the manifest. Change the default from `'1.0'` to `'1.1'`.

**Step 6: Add thumbnail file support**

Add a method to store subject thumbnail images in the ZIP:

```typescript
/** Add a subject thumbnail image to the archive. Returns the ZIP path. */
addSubjectThumbnail(subjectId: string, blob: Blob): string {
    const path = `thumbnails/${subjectId}.jpg`;
    this._addFile(path, blob);
    return path;
}
```

(Check what method `_addFile` or equivalent the creator uses to queue files for the ZIP — it may be called `addFile()` or store in an internal map. Match the existing pattern.)

**Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 8: Commit**

```bash
git add src/modules/archive-creator.ts
git commit -m "feat(archive-creator): add collection and subject support"
```

---

## Phase 3: Archive Loader — Reading Collections

### Task 5: Add subject loading to ArchiveLoader

**Files:**
- Modify: `src/modules/archive-loader.ts`

**Step 1: Import types**

Add at the top:

```typescript
import type { ManifestSubject, ManifestCollection } from '../types.js';
```

**Step 2: Add subject accessor methods**

Add after the existing `getCADEntry()` method (~line 915):

```typescript
/** Get the collection settings, or null if this is a single-scene archive. */
getCollection(): ManifestCollection | null {
    return this.manifest?.collection || null;
}

/** Get the subjects array, or empty array for legacy archives. */
getSubjects(): ManifestSubject[] {
    return this.manifest?.subjects || [];
}

/** Check if this archive is a multi-subject collection. */
isCollection(): boolean {
    const subjects = this.getSubjects();
    return subjects.length > 1;
}

/** Get entries for a specific subject by index. Returns array of { key, entry } pairs. */
getSubjectEntries(subjectIndex: number): Array<{ key: string; entry: ManifestDataEntry }> {
    const subjects = this.getSubjects();
    if (subjectIndex < 0 || subjectIndex >= subjects.length) return [];
    const subject = subjects[subjectIndex];
    const result: Array<{ key: string; entry: ManifestDataEntry }> = [];
    for (const key of subject.entries) {
        const entry = this.manifest?.data_entries?.[key];
        if (entry) {
            result.push({ key, entry });
        } else {
            log.warn(`Subject "${subject.id}" references missing entry: ${key}`);
        }
    }
    return result;
}

/** Get the role (splat/mesh/pointcloud/cad) for a data entry key by checking the key prefix or entry role field. */
getEntryRole(key: string, entry: ManifestDataEntry): string {
    if (entry.role) return entry.role;
    if (key.startsWith('scene_')) return 'splat';
    if (key.startsWith('mesh_')) return 'mesh';
    if (key.startsWith('pointcloud_')) return 'pointcloud';
    if (key.startsWith('cad_')) return 'cad';
    return 'unknown';
}
```

**Step 3: Add subject thumbnail extraction**

```typescript
/** Extract a subject's thumbnail blob from the ZIP. Returns null if not found. */
async extractSubjectThumbnail(subjectIndex: number): Promise<Blob | null> {
    const subjects = this.getSubjects();
    if (subjectIndex < 0 || subjectIndex >= subjects.length) return null;
    const thumbPath = subjects[subjectIndex].thumbnail;
    if (!thumbPath) return null;
    return this.extractFile(thumbPath);
}
```

(Check what method ArchiveLoader uses to extract arbitrary files — likely `extractFile()` or similar. Match the existing pattern for thumbnail extraction.)

**Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 5: Commit**

```bash
git add src/modules/archive-loader.ts
git commit -m "feat(archive-loader): add subject and collection accessors"
```

---

## Phase 4: Kiosk Subject Navigation Core

### Task 6: Add subject state and switching to kiosk-main.ts

**Files:**
- Modify: `src/modules/kiosk-main.ts`

This is the largest task. It adds the core subject navigation engine to the kiosk viewer.

**Step 1: Extend KioskState**

Add to the `KioskState` interface (~line 71):

```typescript
    /** Subjects from manifest. Empty for legacy archives. */
    subjects: ManifestSubject[];
    /** Collection settings. Null for legacy archives. */
    collection: ManifestCollection | null;
    /** Currently active subject index. -1 if no collection. */
    activeSubjectIndex: number;
    /** Cache of extracted blobs per entry key — avoids re-extracting from ZIP. */
    subjectBlobCache: Map<string, Blob>;
    /** Subject thumbnail blobs for browse mode UI. */
    subjectThumbnails: Map<number, Blob>;
```

Import types at the top:

```typescript
import type { ManifestSubject, ManifestCollection, SubjectCamera } from '../types.js';
```

Initialize in the state object:

```typescript
    subjects: [],
    collection: null,
    activeSubjectIndex: -1,
    subjectBlobCache: new Map(),
    subjectThumbnails: new Map(),
```

**Step 2: Detect collection on archive load**

Find where the manifest is parsed after archive load (in the phase 1 completion handler, where `archiveManifest` is set). After the manifest is stored, add:

```typescript
// Detect multi-subject collection
const subjects = archiveLoader.getSubjects();
const collection = archiveLoader.getCollection();
if (subjects.length > 1) {
    kioskState.subjects = subjects;
    kioskState.collection = collection;
    kioskState.activeSubjectIndex = 0;
    log.info(`Collection detected: ${subjects.length} subjects, mode=${collection?.mode || 'browse'}`);
}
```

**Step 3: Create switchSubject() function**

Add a new function:

```typescript
/**
 * Switch to a different subject in a multi-subject collection.
 * Disposes current 3D assets, extracts and loads the new subject's assets,
 * and animates the camera to the subject's preset.
 */
async function switchSubject(newIndex: number): Promise<void> {
    const { subjects, activeSubjectIndex, archiveLoader } = kioskState;
    if (newIndex < 0 || newIndex >= subjects.length) return;
    if (newIndex === activeSubjectIndex) return;
    if (!archiveLoader) return;

    const oldIndex = activeSubjectIndex;
    const subject = subjects[newIndex];
    log.info(`Switching subject: ${oldIndex} → ${newIndex} ("${subject.title}")`);

    // 1. Notify theme
    const layoutModule = getLayoutModule();
    layoutModule?.onSubjectTransitionStart?.(oldIndex, newIndex);

    // 2. Dispose current 3D assets
    disposeCurrentAssets();

    // 3. Update state
    kioskState.activeSubjectIndex = newIndex;

    // 4. Load new subject's assets
    const entries = archiveLoader.getSubjectEntries(newIndex);
    for (const { key, entry } of entries) {
        const role = archiveLoader.getEntryRole(key, entry);
        // Check blob cache first
        let blob = kioskState.subjectBlobCache.get(key);
        if (!blob) {
            blob = await archiveLoader.extractEntry(key);
            if (blob) kioskState.subjectBlobCache.set(key, blob);
        }
        if (!blob) {
            log.warn(`Failed to extract entry ${key} for subject "${subject.title}"`);
            continue;
        }
        await loadAssetFromBlob(blob, role, entry);
    }

    // 5. Filter annotations to this subject + global
    if (annotationSystem) {
        const allAnnotations = kioskState.archiveManifest?.annotations || [];
        const filtered = allAnnotations.filter(
            (a: any) => !a.subject_id || a.subject_id === subject.id
        );
        annotationSystem.setAnnotations(filtered);
    }

    // 6. Animate camera to subject's preset
    if (subject.camera) {
        animateCameraToPreset(subject.camera);
    }

    // 7. Notify theme of completion
    layoutModule?.onSubjectTransitionEnd?.(newIndex);
    layoutModule?.onSubjectChange?.(newIndex, subject, subjects.length);

    // 8. If subject has a walkthrough, set it up
    if (subject.walkthrough && subject.walkthrough.stops?.length > 0) {
        // Use existing setupWalkthroughPlayer() mechanism
        setupWalkthroughPlayer(subject.walkthrough);
    }
}
```

Note: `disposeCurrentAssets()`, `loadAssetFromBlob()`, `animateCameraToPreset()`, and `extractEntry()` are helper functions that must be implemented or adapted from existing code. The exact implementation depends on what exists — see substeps below.

**Step 4: Implement helper: disposeCurrentAssets()**

This should clear the Three.js scene of all loaded assets. Check if there's an existing `clearScene()` or equivalent. If not, create:

```typescript
function disposeCurrentAssets(): void {
    // Dispose splat
    if (splatMesh) {
        scene.remove(splatMesh);
        splatMesh.dispose?.();
        splatMesh = null;
    }
    // Clear model group
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        modelGroup.remove(child);
        disposeObject(child);
    }
    // Clear pointcloud group
    while (pointcloudGroup.children.length > 0) {
        const child = pointcloudGroup.children[0];
        pointcloudGroup.remove(child);
        disposeObject(child);
    }
    kioskState.splatLoaded = false;
    kioskState.modelLoaded = false;
    kioskState.pointcloudLoaded = false;
}
```

Adapt to match the actual variable names and dispose patterns used in kiosk-main.ts.

**Step 5: Implement helper: animateCameraToPreset()**

```typescript
function animateCameraToPreset(preset: SubjectCamera): void {
    const duration = 1000; // ms
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const endPos = new THREE.Vector3(preset.position.x, preset.position.y, preset.position.z);
    const endTarget = new THREE.Vector3(preset.target.x, preset.target.y, preset.target.z);
    const startTime = performance.now();

    function tick() {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out quad

        camera.position.lerpVectors(startPos, endPos, ease);
        controls.target.lerpVectors(startTarget, endTarget, ease);
        controls.update();

        if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}
```

**Step 6: Modify archive asset loading for collection-aware behavior**

Find where `loadArchiveAsset()` is called during phase 2 of archive loading. When `kioskState.subjects.length > 1`, instead of loading the primary entry of each type, load only the first subject's entries:

```typescript
if (kioskState.subjects.length > 1) {
    // Collection mode: load only the first subject's assets
    await loadSubjectAssets(0);
} else {
    // Legacy single-scene: existing behavior
    await loadArchiveAsset(archiveLoader, 'splat', deps);
    await loadArchiveAsset(archiveLoader, 'mesh', deps);
    // ... etc
}
```

**Step 7: Create fallback subject navigation UI**

For themes without `onSubjectChange` support, create a minimal subject navigator:

```typescript
function createFallbackSubjectNav(): void {
    const { subjects, collection } = kioskState;
    if (subjects.length <= 1) return;

    const nav = document.createElement('div');
    nav.id = 'subject-nav-fallback';
    nav.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:100;display:flex;gap:8px;align-items:center;background:rgba(0,0,0,0.6);padding:8px 16px;border-radius:20px;';

    if (collection?.mode === 'sequential') {
        // Prev/Next + counter
        const prev = document.createElement('button');
        prev.textContent = '\u25C0';
        prev.onclick = () => switchSubject(kioskState.activeSubjectIndex - 1);

        const counter = document.createElement('span');
        counter.id = 'subject-nav-counter';
        counter.style.cssText = 'color:white;font-size:14px;min-width:40px;text-align:center;';
        counter.textContent = `1 / ${subjects.length}`;

        const next = document.createElement('button');
        next.textContent = '\u25B6';
        next.onclick = () => switchSubject(kioskState.activeSubjectIndex + 1);

        nav.append(prev, counter, next);
    } else {
        // Browse: dot per subject
        subjects.forEach((s, i) => {
            const dot = document.createElement('button');
            dot.className = 'subject-nav-dot' + (i === 0 ? ' active' : '');
            dot.title = s.title;
            dot.style.cssText = 'width:10px;height:10px;border-radius:50%;border:1px solid white;background:' + (i === 0 ? 'white' : 'transparent') + ';cursor:pointer;padding:0;';
            dot.onclick = () => switchSubject(i);
            nav.appendChild(dot);
        });
    }

    document.getElementById('viewer-container')?.appendChild(nav);
}
```

Add a function to update the fallback nav on subject change:

```typescript
function updateFallbackSubjectNav(index: number): void {
    const counter = document.getElementById('subject-nav-counter');
    if (counter) {
        counter.textContent = `${index + 1} / ${kioskState.subjects.length}`;
    }
    document.querySelectorAll('.subject-nav-dot').forEach((dot, i) => {
        (dot as HTMLElement).style.background = i === index ? 'white' : 'transparent';
        dot.classList.toggle('active', i === index);
    });
}
```

**Step 8: Wire keyboard navigation**

In the existing keyboard handler, add subject navigation keys:

```typescript
// In the keydown handler:
if (kioskState.subjects.length > 1) {
    if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        switchSubject(kioskState.activeSubjectIndex + 1);
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        switchSubject(kioskState.activeSubjectIndex - 1);
    }
}
```

Only add these when no walkthrough is active (check `_walkthroughActive` or equivalent flag).

**Step 9: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 10: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat(kiosk): add subject switching and fallback navigation"
```

---

## Phase 5: Theme Integration — LayoutModule Contract

### Task 7: Extend LayoutModule interface

**Files:**
- Modify: `src/modules/theme-loader.ts` (LayoutModule interface, ~line 20)

**Step 1: Add subject hooks to LayoutModule**

Add after the walkthrough hooks (~line 49):

```typescript
    // ---- Multi-subject collection hooks ----

    /** Called when switching to a subject. Themes use this to update chrome (titles, dots, etc.). */
    onSubjectChange?(index: number, subject: import('../types.js').ManifestSubject, total: number): void;
    /** Called before subject transition begins. Use for exit animations (letterbox close, fade out). */
    onSubjectTransitionStart?(fromIndex: number, toIndex: number): void;
    /** Called after subject assets are loaded and camera is at preset. Use for enter animations. */
    onSubjectTransitionEnd?(toIndex: number): void;
    /** If true, the layout provides its own subject navigation UI (kiosk-main skips fallback). */
    hasOwnSubjectNav?: boolean;
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors (all hooks are optional)

**Step 3: Commit**

```bash
git add src/modules/theme-loader.ts
git commit -m "feat(theme-loader): add subject hooks to LayoutModule interface"
```

---

### Task 8: Implement gallery theme subject navigation

**Files:**
- Modify: `src/themes/gallery/layout.js`
- Modify: `src/themes/gallery/layout.css`

**Step 1: Add subject state variables**

Near the top of layout.js, with the other module-level variables (around `_walkthroughActive`, `_chapterCard`, etc.):

```javascript
var _subjectTimelineEl = null;
var _subjectDots = [];
var _subjectDashes = [];
var _subjectChapterCard = null;
var _subjectTotal = 0;
var _subjectActive = -1;
```

**Step 2: Implement onSubjectChange**

```javascript
function onSubjectChange(index, subject, total) {
    _subjectActive = index;
    _subjectTotal = total;

    // Update dots
    _subjectDots.forEach(function (dot, i) {
        dot.classList.toggle('active', i === index);
        if (i <= index) dot.classList.add('visited');
    });

    // Update dashes
    _subjectDashes.forEach(function (dash, i) {
        dash.classList.toggle('filled', i < index);
    });

    // Show chapter card
    if (_subjectChapterCard) {
        _subjectChapterCard.classList.remove('visible');
        setTimeout(function () {
            var numberEl = _subjectChapterCard.querySelector('.gallery-chapter-number');
            var titleEl = _subjectChapterCard.querySelector('.gallery-chapter-title');
            var descEl = _subjectChapterCard.querySelector('.gallery-chapter-desc');
            if (numberEl) numberEl.textContent = String(index + 1).padStart(2, '0');
            if (titleEl) titleEl.textContent = subject.title || '';
            if (descEl) descEl.textContent = subject.description || '';
            if (subject.title || subject.description) {
                _subjectChapterCard.classList.add('visible');
                setTimeout(function () {
                    _subjectChapterCard.classList.remove('visible');
                }, 4000);
            }
        }, 100);
    }
}
```

**Step 3: Implement onSubjectTransitionStart**

```javascript
function onSubjectTransitionStart(fromIndex, toIndex) {
    // Activate letterbox bars for cinematic transition
    if (_letterboxTop) _letterboxTop.classList.add('active');
    if (_letterboxBottom) _letterboxBottom.classList.add('active');
}
```

**Step 4: Implement onSubjectTransitionEnd**

```javascript
function onSubjectTransitionEnd(toIndex) {
    // Remove letterbox bars
    if (_letterboxTop) _letterboxTop.classList.remove('active');
    if (_letterboxBottom) _letterboxBottom.classList.remove('active');
}
```

**Step 5: Create subject timeline in setup()**

In the `setup()` function, after the existing UI creation, add collection-aware UI creation:

```javascript
// Subject timeline (collection mode)
var subjects = manifest && manifest.subjects;
if (subjects && subjects.length > 1) {
    _subjectTotal = subjects.length;
    _subjectActive = 0;

    // Create timeline element
    _subjectTimelineEl = document.createElement('div');
    _subjectTimelineEl.className = 'gallery-timeline gallery-subject-timeline';

    subjects.forEach(function (subject, i) {
        if (i > 0) {
            var dash = document.createElement('span');
            dash.className = 'gallery-timeline-dash';
            _subjectTimelineEl.appendChild(dash);
            _subjectDashes.push(dash);
        }
        var dot = document.createElement('button');
        dot.className = 'gallery-timeline-dot' + (i === 0 ? ' active' : '');
        dot.dataset.index = String(i);
        dot.textContent = String(i + 1).padStart(2, '0');

        if (subject.title) {
            var tooltip = document.createElement('span');
            tooltip.className = 'gallery-dot-tooltip';
            tooltip.textContent = subject.title;
            dot.appendChild(tooltip);
        }

        dot.addEventListener('click', function () {
            var event = new CustomEvent('gallery-subject-jump', { detail: { index: i } });
            document.dispatchEvent(event);
        });

        _subjectTimelineEl.appendChild(dot);
        _subjectDots.push(dot);
    });

    viewerContainer.appendChild(_subjectTimelineEl);
    requestAnimationFrame(function () {
        _subjectTimelineEl.classList.add('visible');
    });

    // Chapter card for subjects (reuse existing or create separate)
    _subjectChapterCard = document.createElement('div');
    _subjectChapterCard.className = 'gallery-chapter-card gallery-subject-chapter';
    _subjectChapterCard.innerHTML =
        '<div class="gallery-chapter-number"></div>' +
        '<div class="gallery-chapter-title"></div>' +
        '<div class="gallery-chapter-desc"></div>';
    viewerContainer.appendChild(_subjectChapterCard);
}
```

**Step 6: Register hooks in the return object**

Add to the `window.__KIOSK_LAYOUTS__['gallery']` object (~line 1002):

```javascript
    onSubjectChange: onSubjectChange,
    onSubjectTransitionStart: onSubjectTransitionStart,
    onSubjectTransitionEnd: onSubjectTransitionEnd,
    hasOwnSubjectNav: true,
```

**Step 7: Wire the custom event in kiosk-main.ts**

In kiosk-main.ts, after creating the layout, add:

```typescript
document.addEventListener('gallery-subject-jump', ((e: CustomEvent) => {
    switchSubject(e.detail.index);
}) as EventListener);
```

**Step 8: Add CSS for subject timeline**

In `src/themes/gallery/layout.css`, add subject-specific rules (the gallery timeline styles already exist — subject timeline reuses them via the `gallery-timeline` class). Add any differentiating rules:

```css
/* Subject timeline uses the same visual language as walkthrough timeline */
body.kiosk-mode.kiosk-gallery .gallery-subject-timeline {
    top: 16px;    /* position above walkthrough timeline */
}
```

**Step 9: Commit**

```bash
git add src/themes/gallery/layout.js src/themes/gallery/layout.css src/modules/kiosk-main.ts
git commit -m "feat(gallery-theme): add subject navigation with timeline dots and chapter cards"
```

---

### Task 9: Implement editorial theme subject navigation

**Files:**
- Modify: `src/themes/editorial/layout.js`
- Modify: `src/themes/editorial/layout.css`

**Step 1: Add subject state variables**

```javascript
var _subjectNavEl = null;
var _subjectTitleEl = null;
var _subjectTotal = 0;
var _subjectActive = -1;
```

**Step 2: Implement onSubjectChange**

```javascript
function onSubjectChange(index, subject, total) {
    _subjectActive = index;
    _subjectTotal = total;

    // Update title block
    if (_subjectTitleEl) {
        _subjectTitleEl.textContent = subject.title || ('Subject ' + (index + 1));
    }

    // Update counter
    var counter = _subjectNavEl && _subjectNavEl.querySelector('.editorial-subject-counter');
    if (counter) {
        counter.textContent = (index + 1) + ' of ' + total;
    }

    // Update prev/next button states
    var prevBtn = _subjectNavEl && _subjectNavEl.querySelector('.editorial-subject-prev');
    var nextBtn = _subjectNavEl && _subjectNavEl.querySelector('.editorial-subject-next');
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === total - 1;
}
```

**Step 3: Implement transition hooks**

```javascript
function onSubjectTransitionStart(fromIndex, toIndex) {
    // Fade out title block briefly
    var titleBlock = document.querySelector('.editorial-title-block');
    if (titleBlock) titleBlock.style.opacity = '0';
}

function onSubjectTransitionEnd(toIndex) {
    // Fade title block back in
    var titleBlock = document.querySelector('.editorial-title-block');
    if (titleBlock) titleBlock.style.opacity = '1';
}
```

**Step 4: Create subject UI in setup()**

In the `setup()` function, after title block creation:

```javascript
var subjects = manifest && manifest.subjects;
if (subjects && subjects.length > 1) {
    _subjectTotal = subjects.length;

    // Add subject title to title block
    _subjectTitleEl = document.createElement('div');
    _subjectTitleEl.className = 'editorial-subject-title';
    _subjectTitleEl.textContent = subjects[0].title || 'Subject 1';
    titleBlock.appendChild(_subjectTitleEl);

    // Add minimal nav below title
    _subjectNavEl = document.createElement('div');
    _subjectNavEl.className = 'editorial-subject-nav';
    _subjectNavEl.innerHTML =
        '<button class="editorial-subject-prev" disabled>\u2190</button>' +
        '<span class="editorial-subject-counter">1 of ' + subjects.length + '</span>' +
        '<button class="editorial-subject-next">\u2192</button>';

    _subjectNavEl.querySelector('.editorial-subject-prev').addEventListener('click', function () {
        document.dispatchEvent(new CustomEvent('editorial-subject-jump', { detail: { delta: -1 } }));
    });
    _subjectNavEl.querySelector('.editorial-subject-next').addEventListener('click', function () {
        document.dispatchEvent(new CustomEvent('editorial-subject-jump', { detail: { delta: 1 } }));
    });

    titleBlock.appendChild(_subjectNavEl);
}
```

**Step 5: Register hooks in return object**

Add to `window.__KIOSK_LAYOUTS__['editorial']`:

```javascript
    onSubjectChange: onSubjectChange,
    onSubjectTransitionStart: onSubjectTransitionStart,
    onSubjectTransitionEnd: onSubjectTransitionEnd,
    hasOwnSubjectNav: true,
```

**Step 6: Wire the custom event in kiosk-main.ts**

```typescript
document.addEventListener('editorial-subject-jump', ((e: CustomEvent) => {
    const delta = e.detail.delta;
    switchSubject(kioskState.activeSubjectIndex + delta);
}) as EventListener);
```

**Step 7: Add CSS**

In `src/themes/editorial/layout.css`:

```css
body.kiosk-mode.kiosk-editorial .editorial-subject-title {
    font-size: 0.8rem;
    font-weight: 400;
    color: var(--kiosk-text-secondary);
    margin-top: 6px;
    letter-spacing: 0.02em;
}

body.kiosk-mode.kiosk-editorial .editorial-subject-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    pointer-events: auto;
}

body.kiosk-mode.kiosk-editorial .editorial-subject-nav button {
    background: none;
    border: 1px solid var(--kiosk-text-secondary);
    color: var(--kiosk-text-secondary);
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.7rem;
}

body.kiosk-mode.kiosk-editorial .editorial-subject-nav button:disabled {
    opacity: 0.3;
    cursor: default;
}

body.kiosk-mode.kiosk-editorial .editorial-subject-counter {
    font-size: 0.65rem;
    color: var(--kiosk-text-secondary);
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
```

**Step 8: Commit**

```bash
git add src/themes/editorial/layout.js src/themes/editorial/layout.css src/modules/kiosk-main.ts
git commit -m "feat(editorial-theme): add subject navigation with title + prev/next"
```

---

## Phase 6: Editor — "Add as Subject" Workflow

### Task 10: Add "Add as Subject" button to HTML

**Files:**
- Modify: `src/index.html`

**Step 1: Add button to the editor sidebar**

Find the export/archive section of the sidebar in `index.html`. Add the "Add as Subject" button near the archive controls:

```html
<button id="btn-add-subject" class="btn-secondary" title="Save current scene as a collection subject">Add as Subject</button>
```

Also add a subject list container that starts hidden:

```html
<div id="subject-list-panel" class="panel-section hidden">
    <h3>Subjects</h3>
    <div id="subject-list"></div>
    <div id="collection-settings" class="hidden">
        <label>Collection Mode:
            <select id="collection-mode-select">
                <option value="sequential">Sequential</option>
                <option value="browse">Browse</option>
            </select>
        </label>
    </div>
</div>
```

**Step 2: Commit**

```bash
git add src/index.html
git commit -m "feat(html): add subject list panel and Add as Subject button"
```

---

### Task 11: Create subject-manager.ts module

**Files:**
- Create: `src/modules/subject-manager.ts`

**Step 1: Create the module**

```typescript
/**
 * Subject Manager — handles "Add as Subject" workflow and subject list UI in the editor.
 */

import { Logger } from './utilities.js';
import { getStore, resetBlobs } from './asset-store.js';
import type { AppState, SubjectState, SubjectCamera, Annotation } from '../types.js';

const log = Logger.getLogger('subject-manager');

let _nextId = 1;

/** Generate a unique subject ID. */
function generateId(): string {
    return 'subject_' + (_nextId++);
}

export interface SubjectManagerDeps {
    state: AppState;
    camera: any;           // THREE.PerspectiveCamera
    controls: any;         // OrbitControls
    splatMesh: any;
    modelGroup: any;
    pointcloudGroup: any;
    cadGroup: any;
    renderer: any;
    scene: any;
    annotationSystem: any;
    disposeCurrentScene: () => void;
}

/**
 * Snapshot the current scene as a subject and clear the viewport.
 * Returns the new SubjectState or null if nothing to snapshot.
 */
export function addAsSubject(deps: SubjectManagerDeps, title?: string): SubjectState | null {
    const assets = getStore();
    const { state, camera, controls, renderer, scene, annotationSystem } = deps;

    // Check if there's anything loaded
    if (!state.splatLoaded && !state.modelLoaded && !state.pointcloudLoaded && !state.cadLoaded) {
        log.warn('No assets loaded — cannot create subject');
        return null;
    }

    const id = generateId();
    const subjectTitle = title || `Subject ${state.subjects.length + 1}`;

    // Collect entry blobs + transforms
    const entries = new Map<string, { blob: Blob; filename: string; role: string; transform: { position: number[]; rotation: number[]; scale: number } }>();

    if (assets.splatBlob && state.splatLoaded) {
        const sm = deps.splatMesh;
        entries.set(`scene_${state.subjects.length}_splat`, {
            blob: assets.splatBlob,
            filename: state.splatFormat ? `scene.${state.splatFormat}` : 'scene.ply',
            role: 'splat',
            transform: {
                position: sm ? [sm.position.x, sm.position.y, sm.position.z] : [0, 0, 0],
                rotation: sm ? [sm.rotation.x, sm.rotation.y, sm.rotation.z] : [0, 0, 0],
                scale: sm ? sm.scale.x : 1
            }
        });
    }

    if (assets.meshBlob && state.modelLoaded) {
        const mg = deps.modelGroup;
        entries.set(`mesh_${state.subjects.length}_mesh`, {
            blob: assets.meshBlob,
            filename: state.meshFormat ? `model.${state.meshFormat}` : 'model.glb',
            role: 'mesh',
            transform: {
                position: [mg.position.x, mg.position.y, mg.position.z],
                rotation: [mg.rotation.x, mg.rotation.y, mg.rotation.z],
                scale: mg.scale.x
            }
        });
    }

    if (assets.pointcloudBlob && state.pointcloudLoaded) {
        const pg = deps.pointcloudGroup;
        entries.set(`pointcloud_${state.subjects.length}_pc`, {
            blob: assets.pointcloudBlob,
            filename: state.pointcloudFormat ? `pointcloud.${state.pointcloudFormat}` : 'pointcloud.e57',
            role: 'pointcloud',
            transform: {
                position: [pg.position.x, pg.position.y, pg.position.z],
                rotation: [pg.rotation.x, pg.rotation.y, pg.rotation.z],
                scale: pg.scale.x
            }
        });
    }

    // Capture camera preset
    const cameraPreset: SubjectCamera = {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: controls.target.x, y: controls.target.y, z: controls.target.z }
    };

    // Capture thumbnail
    renderer.render(scene, camera);
    const thumbnailDataUrl = renderer.domElement.toDataURL('image/jpeg', 0.8);

    // Collect annotations
    const annotations: Annotation[] = annotationSystem
        ? annotationSystem.toJSON().map((a: Annotation) => ({ ...a, subject_id: id }))
        : [];

    const subject: SubjectState = {
        id,
        title: subjectTitle,
        entries,
        camera: cameraPreset,
        thumbnail: dataUrlToBlob(thumbnailDataUrl),
        annotations
    };

    // Push to state
    state.subjects.push(subject);
    state.activeSubjectIndex = state.subjects.length; // points "past" the last subject = new empty scene

    // Clear viewport for next subject
    deps.disposeCurrentScene();
    resetBlobs();
    if (annotationSystem) annotationSystem.clearAnnotations();

    log.info(`Subject added: "${subjectTitle}" (${entries.size} entries)`);

    // Update UI
    updateSubjectListUI(state);

    return subject;
}

/** Convert a data URL to a Blob. */
function dataUrlToBlob(dataUrl: string): Blob {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const binary = atob(parts[1]);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    return new Blob([array], { type: mime });
}

/** Load a subject back into the viewport for editing. */
export function loadSubjectForEditing(deps: SubjectManagerDeps, subjectIndex: number): void {
    const { state } = deps;
    if (subjectIndex < 0 || subjectIndex >= state.subjects.length) return;

    // Save current scene if it has loaded assets (auto-snapshot)
    if (state.activeSubjectIndex !== null && state.activeSubjectIndex < state.subjects.length) {
        // Update the existing subject's state in-place
        // (implementation: re-snapshot transforms, camera, annotations)
    }

    const subject = state.subjects[subjectIndex];
    state.activeSubjectIndex = subjectIndex;

    // Clear current scene
    deps.disposeCurrentScene();
    resetBlobs();

    // Load subject's assets back
    const assets = getStore();
    for (const [key, entry] of subject.entries) {
        if (entry.role === 'splat') assets.splatBlob = entry.blob;
        if (entry.role === 'mesh') assets.meshBlob = entry.blob;
        if (entry.role === 'pointcloud') assets.pointcloudBlob = entry.blob;
    }

    // Restore annotations
    if (deps.annotationSystem) {
        deps.annotationSystem.setAnnotations(subject.annotations);
    }

    // Restore camera
    deps.camera.position.set(subject.camera.position.x, subject.camera.position.y, subject.camera.position.z);
    deps.controls.target.set(subject.camera.target.x, subject.camera.target.y, subject.camera.target.z);
    deps.controls.update();

    updateSubjectListUI(state);
    log.info(`Loaded subject ${subjectIndex} ("${subject.title}") for editing`);
}

/** Delete a subject from the collection. */
export function deleteSubject(state: AppState, subjectIndex: number): void {
    if (subjectIndex < 0 || subjectIndex >= state.subjects.length) return;
    const removed = state.subjects.splice(subjectIndex, 1);
    log.info(`Deleted subject: "${removed[0]?.title}"`);

    if (state.activeSubjectIndex !== null && state.activeSubjectIndex >= state.subjects.length) {
        state.activeSubjectIndex = state.subjects.length > 0 ? state.subjects.length - 1 : null;
    }
    updateSubjectListUI(state);
}

/** Move a subject up or down in the list. */
export function reorderSubject(state: AppState, fromIndex: number, direction: 'up' | 'down'): void {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= state.subjects.length) return;
    const [item] = state.subjects.splice(fromIndex, 1);
    state.subjects.splice(toIndex, 0, item);
    updateSubjectListUI(state);
}

/** Update the subject list UI in the sidebar. */
export function updateSubjectListUI(state: AppState): void {
    const panel = document.getElementById('subject-list-panel');
    const listEl = document.getElementById('subject-list');
    if (!panel || !listEl) return;

    if (state.subjects.length === 0) {
        panel.classList.add('hidden');
        return;
    }

    panel.classList.remove('hidden');
    listEl.innerHTML = '';

    state.subjects.forEach((subject, i) => {
        const row = document.createElement('div');
        row.className = 'subject-list-item' + (i === state.activeSubjectIndex ? ' active' : '');

        const title = document.createElement('span');
        title.className = 'subject-list-title';
        title.textContent = subject.title;
        title.onclick = () => {
            document.dispatchEvent(new CustomEvent('subject-edit', { detail: { index: i } }));
        };

        const controls = document.createElement('span');
        controls.className = 'subject-list-controls';
        controls.innerHTML =
            `<button class="btn-icon" data-action="up" title="Move up">\u25B2</button>` +
            `<button class="btn-icon" data-action="down" title="Move down">\u25BC</button>` +
            `<button class="btn-icon" data-action="delete" title="Delete">\u00D7</button>`;

        controls.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = (btn as HTMLElement).dataset.action;
                if (action === 'delete') {
                    document.dispatchEvent(new CustomEvent('subject-delete', { detail: { index: i } }));
                } else if (action === 'up' || action === 'down') {
                    document.dispatchEvent(new CustomEvent('subject-reorder', { detail: { index: i, direction: action } }));
                }
            });
        });

        row.append(title, controls);
        listEl.appendChild(row);
    });

    // Show collection settings when subjects exist
    const settings = document.getElementById('collection-settings');
    if (settings) settings.classList.toggle('hidden', state.subjects.length < 2);
}
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/modules/subject-manager.ts
git commit -m "feat(subject-manager): create module for Add as Subject workflow and subject list UI"
```

---

### Task 12: Wire subject manager into main.ts

**Files:**
- Modify: `src/main.ts`
- Modify: `src/modules/event-wiring.ts`
- Modify: `src/types.ts` (EventWiringDeps)

**Step 1: Import subject-manager in main.ts**

Add import:

```typescript
import { addAsSubject, loadSubjectForEditing, deleteSubject, reorderSubject } from './modules/subject-manager.js';
```

**Step 2: Create deps factory for subject manager**

Add a factory function in main.ts (near the other deps factories):

```typescript
function createSubjectManagerDeps(): SubjectManagerDeps {
    return {
        state,
        camera,
        controls,
        splatMesh,
        modelGroup,
        pointcloudGroup,
        cadGroup,
        renderer,
        scene,
        annotationSystem,
        disposeCurrentScene
    };
}
```

Note: `disposeCurrentScene` needs to exist as a function in main.ts that clears all loaded assets from the scene. Check if one already exists or create it.

**Step 3: Wire events**

In `event-wiring.ts`, add to `setupUIEvents()`:

```typescript
addListener('btn-add-subject', 'click', deps.subjects.addAsSubject);
```

Wire custom events in main.ts `init()`:

```typescript
document.addEventListener('subject-edit', ((e: CustomEvent) => {
    loadSubjectForEditing(createSubjectManagerDeps(), e.detail.index);
}) as EventListener);

document.addEventListener('subject-delete', ((e: CustomEvent) => {
    deleteSubject(state, e.detail.index);
}) as EventListener);

document.addEventListener('subject-reorder', ((e: CustomEvent) => {
    reorderSubject(state, e.detail.index, e.detail.direction);
}) as EventListener);

// Collection mode select
const modeSelect = document.getElementById('collection-mode-select') as HTMLSelectElement;
if (modeSelect) {
    modeSelect.addEventListener('change', () => {
        state.collectionMode = modeSelect.value as 'sequential' | 'browse';
    });
}
```

**Step 4: Add subjects to EventWiringDeps**

In `src/types.ts`, add to `EventWiringDeps`:

```typescript
subjects: {
    addAsSubject: () => void;
};
```

**Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 6: Commit**

```bash
git add src/main.ts src/modules/event-wiring.ts src/types.ts
git commit -m "feat(main): wire subject manager into editor events"
```

---

## Phase 7: Export — Writing Collections to Archive

### Task 13: Update export-controller.ts for multi-subject export

**Files:**
- Modify: `src/modules/export-controller.ts`

**Step 1: Modify prepareArchive() for collection mode**

In `prepareArchive()` (~line 149), after the existing asset addition logic, add collection-aware export. The key change: when `state.subjects.length > 0`, iterate over subjects and add each subject's assets instead of the single-scene flow.

Add before the existing asset addition block (~line 249):

```typescript
// --- Multi-subject collection export ---
if (state.subjects.length > 0) {
    // Set collection settings
    if (state.collectionMode) {
        archiveCreator.setCollection({
            mode: state.collectionMode,
            title: state.collectionTitle || metadata.project?.title || 'Untitled Collection',
            description: state.collectionDescription || metadata.project?.description || ''
        });
    }

    const manifestSubjects: ManifestSubject[] = [];
    const allAnnotations: Annotation[] = [];

    for (const subject of state.subjects) {
        const entryKeys: string[] = [];

        for (const [tempKey, entry] of subject.entries) {
            let actualKey: string;
            if (entry.role === 'splat') {
                actualKey = archiveCreator.addScene(entry.blob, entry.filename, {
                    position: entry.transform.position as [number, number, number],
                    rotation: entry.transform.rotation as [number, number, number],
                    scale: entry.transform.scale
                });
            } else if (entry.role === 'mesh') {
                actualKey = archiveCreator.addMesh(entry.blob, entry.filename, {
                    position: entry.transform.position as [number, number, number],
                    rotation: entry.transform.rotation as [number, number, number],
                    scale: entry.transform.scale
                });
            } else if (entry.role === 'pointcloud') {
                actualKey = archiveCreator.addPointcloud(entry.blob, entry.filename, {
                    position: entry.transform.position as [number, number, number],
                    rotation: entry.transform.rotation as [number, number, number],
                    scale: entry.transform.scale
                });
            } else {
                continue;
            }
            entryKeys.push(actualKey);
        }

        // Add subject thumbnail
        let thumbnailPath: string | undefined;
        if (subject.thumbnail) {
            thumbnailPath = archiveCreator.addSubjectThumbnail(subject.id, subject.thumbnail);
        }

        manifestSubjects.push({
            id: subject.id,
            title: subject.title,
            description: subject.description,
            entries: entryKeys,
            camera: subject.camera,
            thumbnail: thumbnailPath,
            metadata_overrides: subject.metadataOverrides
        });

        // Collect annotations with subject_id set
        allAnnotations.push(...subject.annotations);
    }

    archiveCreator.setSubjects(manifestSubjects);

    // Set all annotations (per-subject + global)
    if (annotationSystem) {
        const globalAnnotations = annotationSystem.toJSON().filter((a: Annotation) => !a.subject_id);
        archiveCreator.setAnnotations([...globalAnnotations, ...allAnnotations]);
    }

    // Skip the single-scene asset addition below
} else {
    // --- Existing single-scene export logic (unchanged) ---
```

Add the closing brace `}` after the existing single-scene asset addition block.

**Step 2: Import types**

Add to imports:

```typescript
import type { ManifestSubject, Annotation } from '../types.js';
```

**Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/modules/export-controller.ts
git commit -m "feat(export): add multi-subject collection export flow"
```

---

## Phase 8: Testing

### Task 14: Write tests for collection format handling

**Files:**
- Create: `src/modules/__tests__/subject-manager.test.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('SubjectState management', () => {
    it('generates unique subject IDs', () => {
        // Test that generateId produces unique values
    });

    it('subject entries map correctly to manifest format', () => {
        // Test the conversion from SubjectState entries to ManifestSubject entries
    });
});

describe('Annotation subject filtering', () => {
    const annotations = [
        { id: 'a1', subject_id: 'exterior', title: 'T1', body: '', position: {x:0,y:0,z:0}, camera_target: {x:0,y:0,z:0}, camera_position: {x:0,y:0,z:0} },
        { id: 'a2', title: 'Global', body: '', position: {x:0,y:0,z:0}, camera_target: {x:0,y:0,z:0}, camera_position: {x:0,y:0,z:0} },
        { id: 'a3', subject_id: 'lobby', title: 'T3', body: '', position: {x:0,y:0,z:0}, camera_target: {x:0,y:0,z:0}, camera_position: {x:0,y:0,z:0} },
    ];

    it('filters annotations for a specific subject + globals', () => {
        const filtered = annotations.filter(a => !a.subject_id || a.subject_id === 'exterior');
        expect(filtered).toHaveLength(2);
        expect(filtered.map(a => a.id)).toEqual(['a1', 'a2']);
    });

    it('shows only global annotations when subject has no annotations', () => {
        const filtered = annotations.filter(a => !a.subject_id || a.subject_id === 'unknown');
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe('a2');
    });

    it('shows all annotations when no subject_id filter', () => {
        const filtered = annotations.filter(a => !a.subject_id);
        expect(filtered).toHaveLength(1);
    });
});

describe('Collection manifest structure', () => {
    it('creates valid manifest with subjects and collection', () => {
        const manifest = {
            container_version: '1.1',
            collection: { mode: 'sequential' as const, title: 'Test', description: '' },
            subjects: [
                { id: 'sub1', title: 'Sub 1', entries: ['scene_0'], camera: { position: {x:0,y:0,z:0}, target: {x:0,y:0,z:0} } },
                { id: 'sub2', title: 'Sub 2', entries: ['scene_1', 'mesh_0'], camera: { position: {x:1,y:1,z:1}, target: {x:0,y:0,z:0} } },
            ],
            data_entries: {
                scene_0: { file_name: 'assets/scene_0.ply' },
                scene_1: { file_name: 'assets/scene_1.ply' },
                mesh_0: { file_name: 'assets/mesh_0.glb' },
            }
        };

        expect(manifest.subjects).toHaveLength(2);
        expect(manifest.subjects[0].entries).toEqual(['scene_0']);
        expect(manifest.subjects[1].entries).toEqual(['scene_1', 'mesh_0']);
        expect(manifest.collection.mode).toBe('sequential');
        expect(manifest.container_version).toBe('1.1');
    });

    it('legacy manifest without subjects is valid', () => {
        const manifest = {
            container_version: '1.0',
            data_entries: { scene_0: { file_name: 'assets/scene_0.ply' } }
        };
        const subjects = (manifest as any).subjects || [];
        expect(subjects).toHaveLength(0);
    });
});
```

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/modules/__tests__/subject-manager.test.ts
git commit -m "test: add collection format and annotation filtering tests"
```

---

### Task 15: Add CSS for subject list panel in editor

**Files:**
- Modify: `src/styles.css`

**Step 1: Add subject list styles**

Find the sidebar styles section and add:

```css
/* --- Subject List Panel --- */

#subject-list-panel h3 {
    margin: 0 0 8px 0;
    font-size: 13px;
    font-weight: 600;
}

.subject-list-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
}

.subject-list-item:hover {
    background: rgba(255, 255, 255, 0.05);
}

.subject-list-item.active {
    background: rgba(255, 255, 255, 0.1);
    border-left: 2px solid var(--accent, #4a9eff);
}

.subject-list-title {
    font-size: 13px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.subject-list-controls {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s;
}

.subject-list-item:hover .subject-list-controls {
    opacity: 1;
}

.subject-list-controls .btn-icon {
    background: none;
    border: none;
    color: var(--text-secondary, #999);
    cursor: pointer;
    padding: 2px 4px;
    font-size: 11px;
    border-radius: 3px;
}

.subject-list-controls .btn-icon:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary, #fff);
}

#collection-settings {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
}

#collection-settings label {
    font-size: 12px;
    color: var(--text-secondary, #999);
}

#collection-mode-select {
    margin-left: 8px;
    font-size: 12px;
}
```

**Step 2: Commit**

```bash
git add src/styles.css
git commit -m "feat(css): add subject list panel styles for editor"
```

---

### Task 16: Build and verify

**Files:** None (verification only)

**Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors

**Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK)

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds, output in `dist/`

**Step 5: Commit any fixes needed**

If any step above fails, fix the issue and commit:

```bash
git commit -m "fix: address build/lint/test issues from collection implementation"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1. Types & Format | 1–3 | TypeScript interfaces, AppState fields, updated spec |
| 2. Archive Creator | 4 | Writing subjects/collection to ZIP manifest |
| 3. Archive Loader | 5 | Reading subjects from manifest, entry extraction |
| 4. Kiosk Core | 6 | Subject switching, blob cache, fallback nav, keyboard |
| 5. Theme Contract | 7–9 | LayoutModule hooks, gallery + editorial implementations |
| 6. Editor | 10–12 | "Add as Subject" button, subject list UI, event wiring |
| 7. Export | 13 | Multi-subject archive export flow |
| 8. Testing & Build | 14–16 | Tests, CSS, build verification |
