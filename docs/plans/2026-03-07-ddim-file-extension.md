# .ddim File Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `.a3d`/`.a3z` with `.ddim` in all user-facing UI, add `.zip` export option, keep backward-compatible import of old formats.

**Architecture:** Single new extension `.ddim` replaces both `.a3d` (standard) and `.a3z` (compressed) — both were uncompressed ZIPs anyway. Export dialog gets two radio options: `.ddim` (default) and `.zip`. "Save to Library" hides when `.zip` is selected. All file pickers, help text, tooltips, and prompts updated. Import still silently accepts `.a3d`/`.a3z`.

**Tech Stack:** TypeScript, HTML, Vite (no new dependencies)

---

### Task 1: Update archive-creator.ts types and download logic

**Files:**
- Modify: `src/modules/archive-creator.ts:450-455` (CreateArchiveOptions, DownloadArchiveOptions)
- Modify: `src/modules/archive-creator.ts:1988` (downloadName)
- Modify: `src/modules/archive-creator.ts:1998` (Tauri save dialog filter)

**Step 1: Update CreateArchiveOptions type**

At line 451, change:
```typescript
// Before
format?: 'a3d' | 'a3z';

// After
format?: 'ddim' | 'zip';
```

**Step 2: Update default format in downloadArchive**

At line 1980, change:
```typescript
// Before
format = 'a3d',

// After
format = 'ddim',
```

**Step 3: Update Tauri save dialog filter label**

At line 1998, change:
```typescript
// Before
filters: [{ name: '3D Archive', extensions: [format] }],

// After
filters: [{ name: 'Direct Dimensions Archive', extensions: [format] }],
```

**Step 4: Run build to verify**

Run: `npm run build`
Expected: Build succeeds (type changes may surface downstream errors — those are fixed in subsequent tasks)

**Step 5: Commit**

```
feat: update archive format types from a3d/a3z to ddim/zip
```

---

### Task 2: Update export-controller.ts format handling and Save to Library visibility

**Files:**
- Modify: `src/modules/export-controller.ts:183` (default format fallback)
- Modify: `src/modules/export-controller.ts:557` (JSDoc comment)
- Modify: `src/modules/export-controller.ts:590` (JSDoc comment)

**Step 1: Update default format fallback**

At line 183, change:
```typescript
// Before
const format = formatRadio?.value || 'a3d';

// After
const format = formatRadio?.value || 'ddim';
```

**Step 2: Update JSDoc comments**

At line 557, change `.a3d/.a3z` to `.ddim/.zip` in the comment.
At line 590, update the JSDoc similarly.

**Step 3: Add format-change listener to toggle Save to Library visibility**

Add a new exported function and wire it into the export panel initialization. In `export-controller.ts`, add after the `saveToLibrary` function:

```typescript
/**
 * Toggle "Save to Library" button visibility based on selected export format.
 * .ddim shows it, .zip hides it (local download only).
 */
export function setupExportFormatToggle(): void {
    const radios = document.querySelectorAll('input[name="export-format"]');
    const saveBtn = document.getElementById('btn-save-to-library');
    if (!saveBtn) return;

    const wasPreviouslyVisible = saveBtn.style.display !== 'none';

    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            const selected = (document.querySelector('input[name="export-format"]:checked') as HTMLInputElement)?.value;
            if (selected === 'zip') {
                saveBtn.style.display = 'none';
            } else if (wasPreviouslyVisible) {
                saveBtn.style.display = '';
            }
        });
    });
}
```

**Step 4: Call setupExportFormatToggle from event-wiring.ts**

In `src/modules/event-wiring.ts`, import and call `setupExportFormatToggle` in the export controls section (around line 507-513):

```typescript
import { setupExportFormatToggle } from './export-controller.js';

// Inside setupUIEvents, after the export button listeners:
setupExportFormatToggle();
```

**Step 5: Commit**

```
feat: update export format to ddim, toggle Save to Library by format
```

---

### Task 3: Update editor/index.html — export dialog, file pickers, tooltips, labels

**Files:**
- Modify: `src/editor/index.html:173` (export button tooltip)
- Modify: `src/editor/index.html:327` (library drop zone text)
- Modify: `src/editor/index.html:334` (library file input accept)
- Modify: `src/editor/index.html:340` (library empty hint)
- Modify: `src/editor/index.html:1062` (archive open label)
- Modify: `src/editor/index.html:1065` (archive input accept)
- Modify: `src/editor/index.html:2507-2514` (format radio buttons)

**Step 1: Update export button tooltip**

Line 173, change:
```html
<!-- Before -->
title="Export scene as .a3d/.a3z archive"

<!-- After -->
title="Export scene as .ddim archive"
```

**Step 2: Update library drop zone text**

Line 327, change:
```html
<!-- Before -->
<span>Drop .a3d or .a3z files here, or ...

<!-- After -->
<span>Drop .ddim files here, or ...
```

**Step 3: Update library file input accept**

Line 334, change:
```html
<!-- Before -->
accept=".a3d,.a3z"

<!-- After -->
accept=".ddim,.a3d,.a3z"
```

**Step 4: Update library empty hint**

Line 340, change:
```html
<!-- Before -->
Upload .a3d or .a3z files to build your library

<!-- After -->
Upload .ddim files to build your library
```

**Step 5: Update archive open label**

Line 1062, change:
```html
<!-- Before -->
Open .a3d / .a3z

<!-- After -->
Open .ddim
```

**Step 6: Update archive input accept**

Line 1065, change:
```html
<!-- Before -->
accept=".a3d,.a3z"

<!-- After -->
accept=".ddim,.a3d,.a3z"
```

**Step 7: Replace format radio buttons**

Lines 2507-2514, replace with:
```html
<div class="radio-row">
    <input type="radio" name="export-format" value="ddim" id="fmt-ddim" checked>
    <label for="fmt-ddim">.ddim (Direct Dimensions Archive)</label>
</div>
<div class="radio-row">
    <input type="radio" name="export-format" value="zip" id="fmt-zip">
    <label for="fmt-zip">.zip (Standard ZIP)</label>
</div>
```

**Step 8: Commit**

```
feat: update editor HTML to use .ddim extension in all UI
```

---

### Task 4: Update archive-loader.ts — add .ddim to recognized extensions

**Files:**
- Modify: `src/modules/archive-loader.ts:16` (ARCHIVE_EXTENSIONS)

**Step 1: Add ddim to extensions array**

Line 16, change:
```typescript
// Before
const _ARCHIVE_EXTENSIONS = ['a3d', 'a3z'];

// After
const _ARCHIVE_EXTENSIONS = ['ddim', 'a3d', 'a3z'];
```

**Step 2: Commit**

```
feat: recognize .ddim as archive extension (alongside legacy a3d/a3z)
```

---

### Task 5: Update kiosk-main.ts — file pickers, help text, fallback filenames, download labels

**Files:**
- Modify: `src/modules/kiosk-main.ts:242` (archive extensions array)
- Modify: `src/modules/kiosk-main.ts:696` (picker formats text)
- Modify: `src/modules/kiosk-main.ts:702` (file input accept)
- Modify: `src/modules/kiosk-main.ts:832,842,916,1292,1346,1373` (fallback filenames `archive.a3d` → `archive.ddim`)
- Modify: `src/modules/kiosk-main.ts:887` (MIME mapping comment)
- Modify: `src/modules/kiosk-main.ts:4129` (source files note)
- Modify: `src/modules/kiosk-main.ts:4421-4426` (download archive button)

**Step 1: Update archive extensions array**

Line 242, change:
```typescript
// Before
archive:    ['.a3d', '.a3z'],

// After
archive:    ['.ddim', '.a3d', '.a3z'],
```

**Step 2: Update picker formats text**

Line 696, change:
```html
<!-- Before -->
Archives: .a3d, .a3z<br>

<!-- After -->
Archives: .ddim<br>
```

**Step 3: Update file input accept**

Line 702, change:
```html
<!-- Before -->
accept=".a3z,.a3d,.glb,...

<!-- After -->
accept=".ddim,.a3z,.a3d,.glb,...
```

**Step 4: Update all fallback filenames**

Replace all `'archive.a3d'` with `'archive.ddim'` at lines 832, 842, 916, 1292, 1346, 1373.

**Step 5: Update MIME mapping comment**

Line 887, change `.a3d/.a3z` to `.ddim/.a3d/.a3z`.

**Step 6: Update source files note**

Line 4129, change:
```typescript
// Before
note.textContent = 'Source files are included in the .a3d archive. Unpack to access.';

// After
note.textContent = 'Source files are included in the .ddim archive. Unpack to access.';
```

**Step 7: Update download archive button in kiosk export**

Lines 4421-4426, change:
```typescript
// Before
'Download Full Archive (.a3d)',
`${baseName}.a3d`,
// ...
a.download = `${baseName}.a3d`;

// After
'Download Full Archive (.ddim)',
`${baseName}.ddim`,
// ...
a.download = `${baseName}.ddim`;
```

**Step 8: Commit**

```
feat: update kiosk mode to use .ddim extension in all UI
```

---

### Task 6: Update file-input-handlers.ts and archive-pipeline.ts

**Files:**
- Modify: `src/modules/file-input-handlers.ts:188` (URL prompt text)
- Modify: `src/modules/archive-pipeline.ts:265` (fallback filename)

**Step 1: Update archive URL prompt**

Line 188, change:
```typescript
// Before
const url = prompt('Enter Archive URL (.a3d, .a3z):');

// After
const url = prompt('Enter Archive URL (.ddim):');
```

**Step 2: Update fallback filename**

Line 265, change:
```typescript
// Before
const fileName = url.split('/').pop() || 'archive.a3d';

// After
const fileName = url.split('/').pop() || 'archive.ddim';
```

**Step 3: Commit**

```
feat: update file-input and archive-pipeline to use .ddim
```

---

### Task 7: Update theme layout files — file picker accept attributes

**Files:**
- Modify: `src/themes/editorial/layout.js:1849` (file input accept)
- Modify: `src/themes/gallery/layout.js:846` (file input accept)
- Modify: `src/themes/exhibit/layout.js:982` (file input accept)

**Step 1: Update all three theme file pickers**

In each file, change:
```html
<!-- Before -->
accept=".a3z,.a3d,.glb,...

<!-- After -->
accept=".ddim,.a3z,.a3d,.glb,...
```

**Step 2: Commit**

```
feat: add .ddim to theme file picker accept attributes
```

---

### Task 8: Update library-panel.ts and tauri-bridge.ts

**Files:**
- Modify: `src/modules/library-panel.ts:1013` (extension check for drag-drop)
- Modify: `src/modules/tauri-bridge.ts:175` (comment about MIME mapping)

**Step 1: Update library drag-drop extension check**

Line 1013, change:
```typescript
// Before
if (f.name.endsWith('.a3d') || f.name.endsWith('.a3z')) {

// After
if (f.name.endsWith('.ddim') || f.name.endsWith('.a3d') || f.name.endsWith('.a3z')) {
```

**Step 2: Update tauri-bridge comment**

Line 175, change `.a3d` to `.ddim` in the comment.

**Step 3: Commit**

```
feat: update library-panel and tauri-bridge for .ddim extension
```

---

### Task 9: Update config.js comments

**Files:**
- Modify: `src/config.js:10,39,44` (URL param comments)

**Step 1: Update comments**

These are developer-facing comments in the IIFE config, not user-facing UI. Update the references:
- Line 10: `.a3d, .a3z` → `.ddim`
- Line 39: `scene.a3d` → `scene.ddim`
- Line 44: `scene.a3d` → `scene.ddim`

**Step 2: Commit**

```
chore: update config.js comments for .ddim extension
```

---

### Task 10: Build and test

**Step 1: Run build**

Run: `npm run build`
Expected: No errors

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass. Archive loader tests should still work since `.a3d`/`.a3z` are still in the recognized extensions array.

**Step 3: Run lint**

Run: `npm run lint`
Expected: 0 errors

**Step 4: Commit any fixes if needed**

---

### Task 11: Update CLAUDE.md and ROADMAP.md

**Files:**
- Modify: `CLAUDE.md` — update references to `.a3d`/`.a3z` in project description and archive sections
- Modify: `docs/ROADMAP.md` — update if `.a3d`/`.a3z` format is mentioned

**Step 1: Update CLAUDE.md**

Replace user-facing references to `.a3d`/`.a3z` with `.ddim`. Keep internal/backward-compat mentions where appropriate (e.g., "silently accepts `.a3d`/`.a3z` for backward compatibility").

**Step 2: Update ROADMAP.md if applicable**

**Step 3: Commit**

```
docs: update project docs for .ddim file extension
```
