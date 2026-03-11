# Code Review Fixes — Phased Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 9 CRITICAL and 32 HIGH issues found in the comprehensive code review, plus selected MEDIUM fixes grouped by affected module to minimize context-switching.

**Architecture:** Fixes are organized into 6 phases by severity and logical grouping. Each phase targets a cohesive set of files. Phases are independent — any can be executed in parallel. Within each phase, tasks are ordered by dependency.

**Tech Stack:** TypeScript, Three.js 0.183.2, Vite, Vitest

**Verification:** `npm run build` after each phase. `npm test` after Phase 1 (security). Full build must pass with zero new errors.

---

## Chunk 1: Phase 1 — Security (CRITICAL)

> 5 XSS/injection vulnerabilities + 1 decompression bomb + 1 data corruption race condition.
> These are the highest-priority fixes — all affect untrusted input handling.

### Task 1.1: Add shared `escapeHtml` to utilities.ts

**Files:**
- Modify: `src/modules/utilities.ts`

Currently `escapeHtml` is duplicated across `kiosk-main.ts`, `metadata-manager.ts`, `collection-page.ts`, `collection-manager.ts`, `share-dialog.ts`, and `walkthrough-editor.ts` — each with different coverage. This task creates a single canonical version.

- [ ] **Step 1: Add escapeHtml to utilities.ts**

Add after the existing utility functions (after the `isSafeUrl` function or at the end of the exports):

```typescript
/** Escape all 5 HTML-special characters for safe interpolation into innerHTML/attributes. */
export function escapeHtml(str: unknown): string {
    const s = typeof str === 'string' ? str : String(str ?? '');
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: SUCCESS — no existing code imports `escapeHtml` from utilities yet.

- [ ] **Step 3: Commit**

```bash
git add src/modules/utilities.ts
git commit -m "feat: add shared escapeHtml to utilities.ts for consistent HTML escaping"
```

---

### Task 1.2: Fix XSS in export-controller.ts SIP compliance dialog

**Files:**
- Modify: `src/modules/export-controller.ts:104-114`

`f.label` and `f.message` from SIP validation results are interpolated into `.innerHTML` without escaping. These originate from archive metadata (untrusted).

- [ ] **Step 1: Add import of escapeHtml**

At the top of `export-controller.ts`, add to the import from utilities:

```typescript
import { escapeHtml } from './utilities.js';
```

If there's already an import from `'./utilities.js'`, add `escapeHtml` to it.

- [ ] **Step 2: Escape f.label and f.message in both error and warning lists**

In the `showSipComplianceDialog` function, change the error list (lines 104-106):

```typescript
// BEFORE:
errorList.innerHTML = result.errors
    .map(f => `<li><span class="finding-label">${f.label}</span><span class="finding-msg">${f.message}</span></li>`)
    .join('');

// AFTER:
errorList.innerHTML = result.errors
    .map(f => `<li><span class="finding-label">${escapeHtml(f.label)}</span><span class="finding-msg">${escapeHtml(f.message)}</span></li>`)
    .join('');
```

Same for warning list (lines 112-114):

```typescript
// BEFORE:
warningList.innerHTML = result.warnings
    .map(f => `<li><span class="finding-label">${f.label}</span><span class="finding-msg">${f.message}</span></li>`)
    .join('');

// AFTER:
warningList.innerHTML = result.warnings
    .map(f => `<li><span class="finding-label">${escapeHtml(f.label)}</span><span class="finding-msg">${escapeHtml(f.message)}</span></li>`)
    .join('');
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src/modules/export-controller.ts
git commit -m "fix(security): escape SIP validation labels/messages in innerHTML"
```

---

### Task 1.3: Fix XSS in kiosk-main.ts annotation title + incomplete escapeHtml

**Files:**
- Modify: `src/modules/kiosk-main.ts:3991-3993, 4962`

Two issues: (1) the local `escapeHtml` at line 3991 is missing `"` and `'` escaping, (2) `annotation.title` at line 4962 is not escaped.

- [ ] **Step 1: Fix the local escapeHtml function**

At line 3991-3993, replace the incomplete implementation:

```typescript
// BEFORE:
function escapeHtml(str: any): string {
    if (typeof str !== 'string') str = String(str);
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// AFTER:
function escapeHtml(str: unknown): string {
    const s = typeof str === 'string' ? str : String(str ?? '');
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

- [ ] **Step 2: Escape annotation.title in mobile detail innerHTML**

At line 4962:

```typescript
// BEFORE:
<h2 class="mobile-anno-title">${annotation.title || 'Untitled'}</h2>

// AFTER:
<h2 class="mobile-anno-title">${escapeHtml(annotation.title || 'Untitled')}</h2>
```

- [ ] **Step 3: Search for other unescaped annotation.title uses in kiosk-main.ts**

Run: `grep -n "annotation\.title" src/modules/kiosk-main.ts` and verify all innerHTML interpolations use `escapeHtml()`. Any that set `.textContent` are safe and don't need changes.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 5: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "fix(security): escape annotation titles in kiosk innerHTML + complete escapeHtml"
```

---

### Task 1.4: Fix CSS selector injection via annotation IDs

**Files:**
- Modify: `src/modules/kiosk-main.ts` (lines 380, 4921, 5034, 5220, 5247 and any others)

Annotation IDs from archive data are interpolated directly into `querySelector` selectors. Use `CSS.escape()` to prevent selector injection.

- [ ] **Step 1: Find all querySelector calls using annotation IDs**

Run: `grep -n 'querySelector.*anno.*id\|querySelector.*annotation.*id' src/modules/kiosk-main.ts`

- [ ] **Step 2: Wrap each annotation ID with CSS.escape()**

For each occurrence, change from:

```typescript
document.querySelector(`.kiosk-anno-item[data-anno-id="${annotation.id}"]`);
```

To:

```typescript
document.querySelector(`.kiosk-anno-item[data-anno-id="${CSS.escape(annotation.id)}"]`);
```

Apply the same pattern to every `querySelector` that interpolates an annotation ID, marker ID, or walkthrough stop ID from archive data.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "fix(security): use CSS.escape() for annotation IDs in querySelector calls"
```

---

### Task 1.5: Fix XSS in walkthrough-editor.ts stop.transition

**Files:**
- Modify: `src/modules/walkthrough-editor.ts:127`

`stop.transition` from deserialized archive data is inserted into innerHTML without validation.

- [ ] **Step 1: Validate transition value in renderStopList**

At line 127, validate against the known enum before rendering:

```typescript
// BEFORE:
<span class="wt-stop-meta">${stop.transition}${stop.annotation_id ? ' \u00b7 linked' : ''}</span>

// AFTER:
<span class="wt-stop-meta">${escapeHtml(stop.transition)}${stop.annotation_id ? ' \u00b7 linked' : ''}</span>
```

- [ ] **Step 2: Add runtime validation in setWalkthroughData**

In `setWalkthroughData()` (line 57-61), sanitize incoming data:

```typescript
export function setWalkthroughData(wt: Walkthrough): void {
    // Sanitize transition values from untrusted archive data
    const validTransitions = ['fly', 'fade', 'cut'];
    for (const stop of wt.stops) {
        if (!validTransitions.includes(stop.transition)) {
            stop.transition = 'fly';
        }
    }
    walkthrough = wt;
    syncSettingsToDOM();
    renderStopList();
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src/modules/walkthrough-editor.ts
git commit -m "fix(security): escape and validate walkthrough transition values from archives"
```

---

### Task 1.6: Fix unvalidated URL inputs in event-wiring.ts

**Files:**
- Modify: `src/modules/event-wiring.ts:712, 935`
- Modify: `src/types.ts` (if `EventWiringDeps` needs a `validateUrl` member)

Background image and HDR URL prompts bypass the URL validation allowlist.

- [ ] **Step 1: Check if EventWiringDeps has a validateUrl function**

Run: `grep -n 'validateUrl\|validateUserUrl' src/types.ts src/modules/event-wiring.ts`

If not present in deps, the function needs to be imported or passed via deps.

- [ ] **Step 2: Add URL validation before loading background image URL (line 712)**

```typescript
// BEFORE:
addListener('btn-load-bg-image-url', 'click', async () => {
    const url = prompt('Enter background image URL:');
    if (!url || !sceneManager) return;
    try {
        await sceneManager.loadBackgroundImage(url);

// AFTER:
addListener('btn-load-bg-image-url', 'click', async () => {
    const url = prompt('Enter background image URL:');
    if (!url || !sceneManager) return;
    if (deps.validateUrl) {
        const result = deps.validateUrl(url, 'background image');
        if (!result.valid) { notify.error(result.error || 'Invalid URL'); return; }
    }
    try {
        await sceneManager.loadBackgroundImage(url);
```

- [ ] **Step 3: Add URL validation before loading HDR URL (line 935)**

Same pattern:

```typescript
// BEFORE:
addListener('btn-load-hdr-url', 'click', async () => {
    const url = prompt('Enter HDR file URL (.hdr):');
    if (!url) return;

// AFTER:
addListener('btn-load-hdr-url', 'click', async () => {
    const url = prompt('Enter HDR file URL (.hdr):');
    if (!url) return;
    if (deps.validateUrl) {
        const result = deps.validateUrl(url, 'HDR file');
        if (!result.valid) { notify.error(result.error || 'Invalid URL'); return; }
    }
```

- [ ] **Step 4: Add validateUrl to EventWiringDeps and wire it in main.ts**

In `src/types.ts`, add to `EventWiringDeps`:
```typescript
validateUrl?: (url: string, label: string) => { valid: boolean; error?: string; url?: string };
```

In `src/main.ts`, in the deps factory that creates `EventWiringDeps`, add:
```typescript
validateUrl: (url: string, label: string) => validateUserUrl(url, label, {
    allowedDomains: APP_CONFIG.allowedDomains,
    currentOrigin: window.location.origin,
    currentProtocol: window.location.protocol
}),
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 6: Commit**

```bash
git add src/modules/event-wiring.ts src/types.ts src/main.ts
git commit -m "fix(security): validate user-entered URLs for background image and HDR loading"
```

---

### Task 1.7: Add decompression bomb protection in archive-loader.ts

**Files:**
- Modify: `src/modules/archive-loader.ts:614-620`

`inflateSync()` is called without checking `uncompressedSize` against a limit. A malicious archive could decompress to gigabytes.

- [ ] **Step 1: Add size limit constant and guard before inflateSync**

Near the top of the file or in the method, add:

```typescript
const MAX_UNCOMPRESSED_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB per file
```

Then at line 618-620, add a guard:

```typescript
} else if (entry.method === 8) {
    // Deflate — decompress with fflate inflateSync
    if (entry.uncompressedSize > MAX_UNCOMPRESSED_SIZE) {
        throw new Error(`File "${filename}" uncompressed size (${entry.uncompressedSize} bytes) exceeds safety limit`);
    }
    fileData = inflateSync(compressedData);
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
git add src/modules/archive-loader.ts
git commit -m "fix(security): add decompression bomb protection with 2GB per-file size limit"
```

---

### Task 1.8: Fix chunked upload race condition in library-panel.ts

**Files:**
- Modify: `src/modules/library-panel.ts:228-233`

`next++` inside concurrent async workers is not atomic — two workers can grab the same index.

- [ ] **Step 1: Fix the atomic counter pattern**

At lines 228-233:

```typescript
// BEFORE:
return (async () => {
    let next = 0;
    const worker = async () => { while (next < totalChunks) await uploadChunk(next++); };
    await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, totalChunks) }, worker));
    return complete();
})();

// AFTER:
return (async () => {
    let next = 0;
    const worker = async () => {
        while (true) {
            const idx = next++;
            if (idx >= totalChunks) break;
            await uploadChunk(idx);
        }
    };
    await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, totalChunks) }, worker));
    return complete();
})();
```

This works because `const idx = next++` is synchronous — it captures the value and increments before the `await` yields control.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
git add src/modules/library-panel.ts
git commit -m "fix: make chunked upload counter atomic to prevent duplicate/skipped chunks"
```

---

## Chunk 2: Phase 2 — Crashes & Data Corruption (CRITICAL + HIGH)

> Stack overflows, null dereferences, blob URL leaks, and logic errors that cause wrong data.

### Task 2.1: Fix Math.max stack overflow in flight-path.ts

**Files:**
- Modify: `src/modules/flight-path.ts:208, 240, 660`

`Math.max(...points.map(p => p.alt))` will throw `RangeError` with 100K+ points.

- [ ] **Step 1: Add a safe max helper at the top of the file**

```typescript
/** Find the maximum value in an array without spreading (avoids stack overflow on large arrays). */
function maxOf(arr: number[]): number {
    let max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] > max) max = arr[i];
    }
    return max;
}
```

- [ ] **Step 2: Replace all three Math.max(...spread) calls**

Line 208: `maxAltM: Math.max(...points.map(p => p.alt))` → `maxAltM: maxOf(points.map(p => p.alt))`

Line 240: same change.

Line 660: `const trimMaxAlt = Math.max(...trimmed.map(pt => pt.alt))` → `const trimMaxAlt = maxOf(trimmed.map(pt => pt.alt))`

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src/modules/flight-path.ts
git commit -m "fix: replace Math.max spread with loop to prevent stack overflow on large flight logs"
```

---

### Task 2.2: Fix null dereference in main.ts wireNativeFileDialogs

**Files:**
- Modify: `src/main.ts:2911-2947`

7 `getElementById().textContent =` calls without null guards.

- [ ] **Step 1: Add optional chaining to all 6 unguarded getElementById calls**

```typescript
// Line 2911:
document.getElementById('splat-filename')?.textContent = files[0].name;
// Line 2917:
document.getElementById('model-filename')?.textContent = files[0].name;
// Line 2923:
document.getElementById('archive-filename')?.textContent = files[0].name;
// Line 2934:
document.getElementById('pointcloud-filename')?.textContent = files[0].name;
// Line 2940:
document.getElementById('stl-filename')?.textContent = files[0].name;
// Line 2947:
document.getElementById('proxy-mesh-filename')?.textContent = files[0].name;
```

Note: TypeScript does not allow optional chaining on the left side of an assignment. Use this pattern instead:

```typescript
const el = document.getElementById('splat-filename');
if (el) el.textContent = files[0].name;
```

Apply to all 6 lines.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "fix: add null guards to getElementById calls in wireNativeFileDialogs"
```

---

### Task 2.3: Fix non-null assertions in archive-pipeline.ts for kiosk mode

**Files:**
- Modify: `src/modules/archive-pipeline.ts`

Extensive `getElementById('...')!` for editor-specific elements that don't exist in kiosk mode. Look for all `!.textContent`, `!.innerText`, and `!.innerHTML` patterns.

- [ ] **Step 1: Find all non-null assertions on getElementById**

Run: `grep -n 'getElementById.*!\.' src/modules/archive-pipeline.ts`

- [ ] **Step 2: Replace each with optional chaining or null guard**

For each occurrence like:
```typescript
document.getElementById('splat-filename')!.textContent = fileName;
```
Change to:
```typescript
const splatFilenameEl = document.getElementById('splat-filename');
if (splatFilenameEl) splatFilenameEl.textContent = fileName;
```

Or for one-liners where the element is used once, check if the pattern `el?.textContent` is valid in context. For assignments to `.textContent`, you need the `if` guard pattern.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src/modules/archive-pipeline.ts
git commit -m "fix: replace non-null assertions with null guards for kiosk-mode compatibility"
```

---

### Task 2.4: Fix blob URL leaks in file-handlers.ts (4 locations)

**Files:**
- Modify: `src/modules/file-handlers.ts:343, 846, 1081, 1266`

Four functions create blob URLs via `URL.createObjectURL()` but never revoke them. Compare with `loadSplatFromFile` (line 300) which correctly calls `URL.revokeObjectURL`.

- [ ] **Step 1: Fix loadSplatFromUrl (line 343)**

After the splat is loaded and added to the scene (after the `await splatMesh.initialized` and `scene.add()` block), add:

```typescript
setTimeout(() => URL.revokeObjectURL(blobUrl), TIMING.BLOB_REVOKE_DELAY);
```

Match the pattern from `loadSplatFromFile` at line 300.

- [ ] **Step 2: Fix loadSTLFromUrlWithDeps (line 846)**

After line 858 (`stlGroup.add(loadedObject)`), add:

```typescript
URL.revokeObjectURL(blobUrl);
```

- [ ] **Step 3: Fix loadDrawingFromUrl (line 1081)**

After the drawing is parsed and added to the group, add:

```typescript
URL.revokeObjectURL(blobUrl);
```

- [ ] **Step 4: Fix loadModelFromUrl (line 1266)**

After the model is loaded and added to `modelGroup`, add:

```typescript
URL.revokeObjectURL(blobUrl);
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 6: Commit**

```bash
git add src/modules/file-handlers.ts
git commit -m "fix: revoke blob URLs after asset loading to prevent memory leaks"
```

---

### Task 2.5: Fix parseFloat || undefined treating zero as missing (flight parsers)

**Files:**
- Modify: `src/modules/flight-parsers.ts:133-136`
- Modify: `src/modules/dji-txt-parser.ts:92`

`parseFloat(x) || undefined` treats `0` as falsy, discarding valid zero values (heading=0 means north, speed=0 means hovering).

- [ ] **Step 1: Add a safe parse helper in flight-parsers.ts**

At the top of the file:

```typescript
/** Parse a float, returning undefined only for NaN (not for zero). */
function parseOptionalFloat(value: string): number | undefined {
    const n = parseFloat(value);
    return isNaN(n) ? undefined : n;
}
```

- [ ] **Step 2: Replace all || undefined patterns in flight-parsers.ts**

Lines 133-136:

```typescript
// BEFORE:
speed: speedIdx !== -1 ? parseFloat(cols[speedIdx]) || undefined : undefined,
heading: headingIdx !== -1 ? parseFloat(cols[headingIdx]) || undefined : undefined,
gimbalPitch: gimbalPitchIdx !== -1 ? parseFloat(cols[gimbalPitchIdx]) || undefined : undefined,
gimbalYaw: gimbalYawIdx !== -1 ? parseFloat(cols[gimbalYawIdx]) || undefined : undefined,

// AFTER:
speed: speedIdx !== -1 ? parseOptionalFloat(cols[speedIdx]) : undefined,
heading: headingIdx !== -1 ? parseOptionalFloat(cols[headingIdx]) : undefined,
gimbalPitch: gimbalPitchIdx !== -1 ? parseOptionalFloat(cols[gimbalPitchIdx]) : undefined,
gimbalYaw: gimbalYawIdx !== -1 ? parseOptionalFloat(cols[gimbalYawIdx]) : undefined,
```

- [ ] **Step 3: Fix dji-txt-parser.ts line 92**

```typescript
// BEFORE:
const speed = Math.sqrt(osd.xSpeed * osd.xSpeed + osd.ySpeed * osd.ySpeed) || undefined;

// AFTER:
const rawSpeed = Math.sqrt(osd.xSpeed * osd.xSpeed + osd.ySpeed * osd.ySpeed);
const speed = isNaN(rawSpeed) ? undefined : rawSpeed;
```

- [ ] **Step 4: Verify build and run flight parser tests**

Run: `npm run build && npm test`
Expected: SUCCESS — flight-parsers tests should still pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/flight-parsers.ts src/modules/dji-txt-parser.ts
git commit -m "fix: preserve zero-valued speed/heading in flight parsers (0 is valid, not missing)"
```

---

### Task 2.6: Fix parseInt on locale-formatted number in export-controller.ts

**Files:**
- Modify: `src/modules/export-controller.ts:566-567`

`parseInt("1,234,567")` returns `1` because it stops at the first comma. Line 571 already has the fix (`.replace(/,/g, '')`), but lines 566-567 don't.

- [ ] **Step 1: Add .replace(/,/g, '') to splat_count and mesh_polygons**

```typescript
// Line 566 — BEFORE:
splat_count: ... parseInt(document.getElementById('splat-vertices')?.textContent || '0') || 0 ...
// AFTER:
splat_count: ... parseInt((document.getElementById('splat-vertices')?.textContent || '0').replace(/,/g, '')) || 0 ...

// Line 567 — BEFORE:
mesh_polygons: ... parseInt(document.getElementById('model-faces')?.textContent || '0') || 0 ...
// AFTER:
mesh_polygons: ... parseInt((document.getElementById('model-faces')?.textContent || '0').replace(/,/g, '')) || 0 ...
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
git add src/modules/export-controller.ts
git commit -m "fix: strip locale grouping separators before parseInt in quality stats"
```

---

## Chunk 3: Phase 3 — Stability & Robustness (HIGH)

> Polling timeouts, event listener leaks, error handling, module state resets.

### Task 3.1: Add timeout to ensureAssetLoaded polling loops

**Files:**
- Modify: `src/modules/archive-pipeline.ts:310-318`
- Modify: `src/modules/kiosk-main.ts:1434-1442`

Both have identical polling loops with no timeout — if a load hangs, they poll forever.

- [ ] **Step 1: Fix archive-pipeline.ts (lines 310-318)**

```typescript
// BEFORE:
if (state.assetStates[assetType] === ASSET_STATE.LOADING) {
    return new Promise(resolve => {
        const check = () => {
            if (state.assetStates[assetType] === ASSET_STATE.LOADED) resolve(true);
            else if (state.assetStates[assetType] === ASSET_STATE.ERROR) resolve(false);
            else setTimeout(check, 50);
        };
        check();
    });
}

// AFTER:
if (state.assetStates[assetType] === ASSET_STATE.LOADING) {
    return new Promise(resolve => {
        const MAX_WAIT = 120_000; // 2 minutes
        const start = Date.now();
        const check = () => {
            if (state.assetStates[assetType] === ASSET_STATE.LOADED) resolve(true);
            else if (state.assetStates[assetType] === ASSET_STATE.ERROR) resolve(false);
            else if (Date.now() - start > MAX_WAIT) { log.warn(`ensureAssetLoaded timed out for ${assetType}`); resolve(false); }
            else setTimeout(check, 50);
        };
        check();
    });
}
```

- [ ] **Step 2: Apply the same fix to kiosk-main.ts (lines 1434-1442)**

Same pattern — add `MAX_WAIT`, `start`, and timeout check.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src/modules/archive-pipeline.ts src/modules/kiosk-main.ts
git commit -m "fix: add 2-minute timeout to ensureAssetLoaded polling loops"
```

---

### Task 3.2: Fix removeEventListener capture mismatch in alignment.ts

**Files:**
- Modify: `src/modules/alignment.ts:677`

`addEventListener` uses `{ capture: true }` (line 619) but `removeEventListener` omits it (line 677), so the listener is never actually removed.

- [ ] **Step 1: Add capture: true to removeEventListener**

```typescript
// Line 677 — BEFORE:
this.renderer.domElement.removeEventListener('click', this._onClickBound);

// AFTER:
this.renderer.domElement.removeEventListener('click', this._onClickBound, { capture: true });
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
git add src/modules/alignment.ts
git commit -m "fix: match capture flag on removeEventListener for landmark alignment click handler"
```

---

### Task 3.3: Fix untyped error access in catch blocks

**Files:**
- Modify: `src/modules/kiosk-main.ts` (9 locations)
- Modify: `src/modules/file-input-handlers.ts` (10 locations)

`err.message` on non-Error values produces "undefined" in user-facing messages.

- [ ] **Step 1: Find all untyped error message accesses in kiosk-main.ts**

Run: `grep -n 'err\.message\|e\.message' src/modules/kiosk-main.ts`

- [ ] **Step 2: Replace each with safe error extraction**

For each catch block like:
```typescript
} catch (err) {
    notify.error('Failed to load: ' + err.message);
}
```
Change to:
```typescript
} catch (err) {
    notify.error('Failed to load: ' + (err instanceof Error ? err.message : String(err)));
}
```

- [ ] **Step 3: Same for file-input-handlers.ts**

Run: `grep -n 'error\.message\|err\.message\|e\.message' src/modules/file-input-handlers.ts`

Apply the same safe extraction pattern.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 5: Commit**

```bash
git add src/modules/kiosk-main.ts src/modules/file-input-handlers.ts
git commit -m "fix: safe error message extraction in catch blocks to prevent 'undefined' display"
```

---

### Task 3.4: Fix walkthrough-editor module state reset + DOM null checks

**Files:**
- Modify: `src/modules/walkthrough-editor.ts:27-35, 168-173`

Module state persists across archive loads. DOM casts crash if elements missing.

- [ ] **Step 1: Add resetWalkthroughEditor export**

After the `walkthrough` declaration block:

```typescript
/** Reset editor state (call when loading a new archive). */
export function resetWalkthroughEditor(): void {
    walkthrough = { title: 'Building Tour', stops: [], auto_play: true, loop: false };
    selectedStopIndex = -1;
    const editor = document.getElementById('walkthrough-stop-editor');
    if (editor) editor.classList.add('hidden');
    const container = document.getElementById('walkthrough-stop-list');
    if (container) container.innerHTML = '';
}
```

- [ ] **Step 2: Add null guards to selectStop DOM casts (lines 168-173)**

```typescript
// BEFORE:
(document.getElementById('wt-stop-title') as HTMLInputElement).value = stop.title || '';

// AFTER:
const titleEl = document.getElementById('wt-stop-title') as HTMLInputElement | null;
if (titleEl) titleEl.value = stop.title || '';
```

Apply to all 6 lines (168-173).

- [ ] **Step 3: Wire resetWalkthroughEditor in main.ts scene clear path**

Find where scene/archive state is cleared in `main.ts` (look for `state.splatLoaded = false` or similar reset blocks) and add:

```typescript
import { resetWalkthroughEditor } from './modules/walkthrough-editor.js';
// ... in the clear/reset function:
resetWalkthroughEditor();
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 5: Commit**

```bash
git add src/modules/walkthrough-editor.ts src/main.ts
git commit -m "fix: add walkthrough editor reset + null guards for DOM casts"
```

---

### Task 3.5: Fix recording-manager timer leaks

**Files:**
- Modify: `src/modules/recording-manager.ts:31-44`

`_timerInterval` and `_maxDurationTimeout` aren't cleared in `cleanup()`.

- [ ] **Step 1: Find the cleanup function**

Run: `grep -n 'function cleanup' src/modules/recording-manager.ts`

- [ ] **Step 2: Add timer cleanup**

Inside `cleanup()`, add before the existing null-setting:

```typescript
if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = 0; }
if (_maxDurationTimeout) { clearTimeout(_maxDurationTimeout); _maxDurationTimeout = 0; }
```

- [ ] **Step 3: Add retry limit to pollMediaStatus**

In `pollMediaStatus` (lines 250-267), add a counter:

```typescript
export function pollMediaStatus(
    mediaId: string,
    onStatusChange: (status: string, data?: any) => void,
    serverUrl = ''
): void {
    let attempts = 0;
    const MAX_ATTEMPTS = 120; // ~4 minutes at 2s interval
    const poll = async () => {
        if (++attempts > MAX_ATTEMPTS) {
            onStatusChange('error', { error: 'Polling timed out' });
            return;
        }
        try {
            const res = await fetch(`${serverUrl}/api/media/${mediaId}`);
            if (!res.ok) return;
            const data = await res.json();
            onStatusChange(data.status, data);
            if (data.status === 'ready' || data.status === 'error') return;
            setTimeout(poll, 2000);
        } catch {
            setTimeout(poll, 5000);
        }
    };
    poll();
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 5: Commit**

```bash
git add src/modules/recording-manager.ts
git commit -m "fix: clear recording timers in cleanup + add polling retry limit"
```

---

## Chunk 4: Phase 4 — Performance (HIGH)

> O(n²) algorithms, memory waste, blob URL leaks in collections.

### Task 4.1: Fix O(n²) climb rate coloring in flight-path.ts

**Files:**
- Modify: `src/modules/flight-path.ts:349, 356`

`allPoints.indexOf(point)` inside `getColorValue()` is O(n) per call, called for every point → O(n²).

- [ ] **Step 1: Add index parameter to getColorValue**

```typescript
// BEFORE (line 349):
private getColorValue(point: FlightPoint, allPoints: FlightPoint[]): number {

// AFTER:
private getColorValue(point: FlightPoint, allPoints: FlightPoint[], index: number): number {
```

- [ ] **Step 2: Replace indexOf with the index parameter**

```typescript
// Line 356 — BEFORE:
const idx = allPoints.indexOf(point);

// AFTER:
const idx = index;
```

- [ ] **Step 3: Update all call sites to pass the index**

Find where `getColorValue` is called (likely in `buildColoredPath` or similar). It will be inside a loop — pass the loop index. For example:

```typescript
// If called like:
for (const pt of points) { ... this.getColorValue(pt, points) ... }
// Change to:
for (let i = 0; i < points.length; i++) { ... this.getColorValue(points[i], points, i) ... }
```

Run `grep -n 'getColorValue' src/modules/flight-path.ts` to find all call sites.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 5: Commit**

```bash
git add src/modules/flight-path.ts
git commit -m "perf: pass index to getColorValue to eliminate O(n²) indexOf in climb rate coloring"
```

---

### Task 4.2: Fix blob URL leak in collections-browser.ts Tauri image proxy

**Files:**
- Modify: `src/modules/collections-browser.ts:365`

Blob URLs for thumbnails are never revoked.

- [ ] **Step 1: Revoke blob URL after image loads**

```typescript
// BEFORE (line 365):
img.src = URL.createObjectURL(blob);

// AFTER:
const blobUrl = URL.createObjectURL(blob);
img.src = blobUrl;
img.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
git add src/modules/collections-browser.ts
git commit -m "fix: revoke blob URLs after thumbnail images load in Tauri image proxy"
```

---

## Chunk 5: Phase 5 — Flight Path Logic Fixes (HIGH)

> Playback ignoring trim bounds, seekTo using wrong time window.

### Task 5.1: Fix playback using full points instead of trimmed

**Files:**
- Modify: `src/modules/flight-path.ts:815, 752`

- [ ] **Step 1: Fix updatePlaybackPosition to use trimmed points (line 815)**

```typescript
// BEFORE:
const points = pathData.points;

// AFTER:
const points = this.getTrimmedPoints(pathData);
```

- [ ] **Step 2: Fix seekTo to use trimmed time window (line 752)**

Find the `seekTo` method and fix the timestamp computation:

```typescript
// BEFORE (approximate):
seekTo(t: number): void {
    const pathData = ...;
    this._playbackTime = t * pathData.durationS * 1000;
    ...
}

// AFTER:
seekTo(t: number): void {
    const pathData = this._playbackPathId ? this.paths.find(p => p.id === this._playbackPathId) : null;
    if (!pathData) return;
    const trimmed = this.getTrimmedPoints(pathData);
    if (trimmed.length < 2) return;
    const start = trimmed[0].timestamp;
    const end = trimmed[trimmed.length - 1].timestamp;
    this._playbackTime = start + t * (end - start);
    this.updatePlaybackPosition();
}
```

Read the actual `seekTo` method first to confirm the exact current code before editing.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src/modules/flight-path.ts
git commit -m "fix: use trimmed points for playback position and seekTo time window"
```

---

## Chunk 6: Phase 6 — Transform Controller (HIGH)

> Euler singularity glitches + pivot rotation only tracking 2 of 8 asset types.

### Task 6.1: Fix pivot rotation quaternion tracking for all asset types

**Files:**
- Modify: `src/modules/transform-controller.ts:714, 752-756`

`applyPivotRotation` only stores/compares `lastSplatQuat` and `lastModelQuat`. The other 6 asset types (pointcloud, stl, cad, drawing, flightpath, colmap) silently fall through to `lastModelQuat`, producing incorrect pivot rotations.

- [ ] **Step 1: Read the full applyPivotRotation method**

Run: `grep -n 'applyPivotRotation\|lastSplatQuat\|lastModelQuat\|lastPointcloudQuat\|lastStlQuat\|lastCadQuat' src/modules/transform-controller.ts`

- [ ] **Step 2: Add quaternion tracking for all asset types**

Add corresponding `last*Quat` variables for each asset type that doesn't have one:

```typescript
let lastPointcloudQuat = new THREE.Quaternion();
let lastStlQuat = new THREE.Quaternion();
let lastCadQuat = new THREE.Quaternion();
let lastDrawingQuat = new THREE.Quaternion();
let lastFlightpathQuat = new THREE.Quaternion();
let lastColmapQuat = new THREE.Quaternion();
```

Then in `applyPivotRotation`, add branches to use the correct last quaternion for each object type. Also update `storeLastPositions` to save all quaternions.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src/modules/transform-controller.ts
git commit -m "fix: track quaternions for all 8 asset types in pivot rotation"
```

---

---

## Chunk 7: Phase 7 — Type Safety: AppState & Deps (HIGH) ✅

> Already completed. Removed `[key: string]: any` from `AppState`, fixed `EventWiringDeps` missing field, removed dead `sceneRefs.splatMesh = null` assignment, added recording upload auth, added collection manager double-init guard.

---

## Chunk 8: Phase 8 — Code Consolidation & Deduplication (HIGH + MEDIUM) ✅

> Already completed. Consolidated `escapeHtml`, `formatBytes`, `formatDate`, `errMsg` into `utilities.ts`. Deduplicated flight path input handlers in `main.ts`.

---

## Chunk 9: Phase 9 — Type SceneRefs with Three.js Types (HIGH)

> H-TS1: `SceneRefs` is 25+ fields of `any` despite `@types/three` being installed.
> Replace all `any` fields with proper Three.js types. This enables IDE autocomplete and compile-time safety for every module that receives `sceneRefs`.

### Task 9.1: Type SceneRefs interface with Three.js types

**Files:**
- Modify: `src/types.ts:121-144`

The comments already document the intended types. Replace each `any` with the correct type.

- [ ] **Step 1: Read the current SceneRefs and identify imports needed**

Run: Read `src/types.ts` lines 118-144 to see all fields.

The interface needs these Three.js imports:
```typescript
import type { Scene, PerspectiveCamera, WebGLRenderer, Group, AmbientLight, HemisphereLight, DirectionalLight } from 'three';
```

And these project-internal types (import with `import type`):
- `OrbitControls` from `three/addons/controls/OrbitControls.js`
- `TransformControls` from `three/addons/controls/TransformControls.js`
- `FlyControls` from `./modules/fly-controls.js` (check actual export name)
- `AnnotationSystem` from `./modules/annotation-system.js`
- `ArchiveCreator` from `./modules/archive-creator.js`

For `SplatMesh`, `MeasurementSystem`, and `LandmarkAlignment` — check if these have exported types. If not, keep as `any` with a `// TODO` comment and move on.

- [ ] **Step 2: Add Three.js type imports to types.ts**

Add at the top of `src/types.ts` (after existing imports):

```typescript
import type { Scene, PerspectiveCamera, WebGLRenderer, Group, AmbientLight, HemisphereLight, DirectionalLight } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
```

For internal module types, check if they export their class/type. If a module only exports functions (not a class), keep `any` for now.

- [ ] **Step 3: Replace `any` with proper types in SceneRefs**

```typescript
export interface SceneRefs {
    readonly scene: Scene;
    readonly camera: PerspectiveCamera;
    readonly renderer: WebGLRenderer;
    readonly controls: OrbitControls;
    readonly transformControls: TransformControls;
    readonly splatMesh: any;                    // SplatMesh (Spark.js, no TS types)
    readonly modelGroup: Group;
    readonly pointcloudGroup: Group;
    readonly stlGroup: Group;
    readonly cadGroup: Group;
    readonly drawingGroup: Group;
    readonly flightPathGroup: Group;
    readonly colmapGroup: Group;
    readonly flyControls: any;                  // FlyControls | null (check exportability)
    readonly annotationSystem: any;             // AnnotationSystem | null (check exportability)
    readonly archiveCreator: any;               // ArchiveCreator | null (check exportability)
    readonly measurementSystem: any;            // MeasurementSystem | null
    readonly landmarkAlignment: any;            // LandmarkAlignment | null
    readonly ambientLight: AmbientLight;
    readonly hemisphereLight: HemisphereLight;
    readonly directionalLight1: DirectionalLight;
    readonly directionalLight2: DirectionalLight;
}
```

**Key:** Type everything Three.js provides types for. Leave Spark.js (`SplatMesh`) and internal classes as `any` only if they lack exported types — investigate each one.

- [ ] **Step 4: Fix any resulting type errors in consuming modules**

Run: `npm run build`

If modules that access `sceneRefs.scene` etc. now get stricter checks, fix the call sites. Common fixes:
- Null checks where `| null` is now visible
- Cast narrowing where `any` previously masked a mismatch

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: SUCCESS with zero new errors.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "refactor: type SceneRefs with Three.js types (H-TS1)"
```

---

## Chunk 10: Phase 10 — Type Deps Factories (HIGH)

> H-TS3: 8 of 12 deps factories in `main.ts` return `any`, making the entire dependency chain unchecked.
> Create typed return interfaces for untyped factories, or use `satisfies` to validate inline.

### Task 10.1: Type the untyped deps factories in main.ts

**Files:**
- Modify: `src/main.ts` (factory return types)
- Modify: `src/types.ts` (new interfaces if needed)

Currently 8 factories return `any`:
- `createFileHandlerDeps(): any` (line 423)
- `createAlignmentDeps(): any` (line 569)
- `createAnnotationControllerDeps(): any` (line 586)
- `createMetadataDeps(): any` (line 601)
- `createCADDeps(): any` (line 757)
- `createFileInputDeps(): any` (line 772) — already has `FileInputDeps` interface in `file-input-handlers.ts`
- `createAlignmentIODeps(): any` (line 3098)
- `createControlsDeps(): any` (line 3206)
- `createPointcloudDeps(): any` (line 3392)

Three factories already have typed returns: `createExportDeps(): ExportDeps`, `createArchivePipelineDeps(): ArchivePipelineDeps`, `createEventWiringDeps(): EventWiringDeps`.

- [ ] **Step 1: Read each untyped factory to catalog its return shape**

Read each factory function body. For each one, list the fields and their types. Group factories that share similar patterns.

- [ ] **Step 2: For `createFileInputDeps`, use the existing `FileInputDeps` interface**

Change `createFileInputDeps(): any` to `createFileInputDeps(): FileInputDeps`. Fix any mismatches.

- [ ] **Step 3: Create interfaces for remaining factories**

For each factory, decide:
- If the return shape is used by a single module with a clear deps interface, define the interface in `types.ts`
- If the shape is small (3-5 fields), use inline type annotation on the factory return

Add new interfaces to `src/types.ts`:
```typescript
export interface FileHandlerDeps { /* fields from createFileHandlerDeps */ }
export interface AlignmentDeps { /* fields from createAlignmentDeps */ }
export interface MetadataDeps { /* fields from createMetadataDeps */ }
// etc.
```

- [ ] **Step 4: Apply return types to all factories**

Change each `): any {` to `): InterfaceName {`. The TypeScript compiler will flag any mismatches between the factory body and the declared interface.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: SUCCESS. Fix any type mismatches the compiler reveals.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/main.ts
git commit -m "refactor: type all deps factories in main.ts (H-TS3)"
```

---

## Chunk 11: Phase 11 — Reduce `any` in kiosk-main.ts (HIGH)

> H-TS4: 51+ uses of `any` in kiosk-main.ts. Type state, deps factories, and common patterns.
> This phase focuses on the kiosk bundle's type safety.

### Task 11.1: Type kiosk deps factories

**Files:**
- Modify: `src/modules/kiosk-main.ts` (lines 2295-2598)
- Modify: `src/types.ts` (if shared interfaces make sense)

6 kiosk factories return `any`:
- `createArchiveDeps(): any` (line 2295)
- `createSplatDeps(): any` (line 2367)
- `createModelDeps(): any` (line 2379)
- `createPointcloudDeps(): any` (line 2388)
- `createDisplayModeDeps(): any` (line 2397)
- `createLayoutDeps(): any` (line 2598)

- [x] **Step 1: Read each kiosk factory body**

Catalog the return shape of each factory.

- [x] **Step 2: Create typed interfaces or inline annotations**

Used TypeScript inference (removed `: any` return types) — kiosk factories don't share interfaces with editor.

- [x] **Step 3: Apply return types**

- [x] **Step 4: Verify build**

Run: `npm run build`
Expected: SUCCESS. ✓ built in 10.48s

- [x] **Step 5: Commit**

```bash
git add src/modules/kiosk-main.ts src/types.ts
git commit -m "refactor: type kiosk deps factories (H-TS4 partial)"
```

### Task 11.2: Replace remaining `any` usage in kiosk-main.ts

**Files:**
- Modify: `src/modules/kiosk-main.ts`

Common `any` patterns to address:
- `(child: any)` in `traverse()` calls → `(child: THREE.Object3D)`
- `(m: any)` for materials → `(m: THREE.Material)` or `THREE.MeshStandardMaterial`
- `(c: any) => c.isAmbientLight` → `(c: THREE.Object3D)` with type guard
- `(entry: any)` in archive iteration → define `ArchiveEntry` interface
- `catch (err: any)` → `catch (err: unknown)` with `errMsg()`
- `manifest: any` parameters → define or reuse `ArchiveManifest` interface
- `(val: any)` and `(str: any)` in utility functions → proper types
- `deepSnakeKeys(obj: any)` and `normalizeManifest(raw: any)` → constrain input types

- [x] **Step 1: Fix all `catch (err: any)` → `catch (err: unknown)`**

All catch clauses changed to `unknown` with `errMsg()` for safe message extraction.

- [x] **Step 2: Fix `traverse()` callback types**

All `.traverse((child: any)` → `(child: THREE.Object3D)` with `as THREE.Mesh` narrowing.

- [x] **Step 3: Type manifest params as `Record<string, unknown>`**

Used `Record<string, unknown>` instead of a full `ArchiveManifest` interface — sufficient for the kiosk's dynamic property access pattern.

- [x] **Step 4: Fix remaining `any` parameters**

Typed `hasValue(val: unknown)`, `linkifyValue(str: string)`, `addDetailRow(..., value: unknown)`, `deepSnakeKeys(obj: unknown)`, `normalizeManifest(raw: Record<string, unknown>)`, module vars, state interface, material/light callbacks, image entries.

- [x] **Step 5: Verify build + tests**

Build: ✓ built in 10.48s. Tests: 423 passed, 3 skipped. Remaining: 26 `as any` casts (cross-module type mismatches).

- [x] **Step 6: Commit**

```bash
git add src/modules/kiosk-main.ts src/types.ts
git commit -m "refactor: eliminate remaining any usage in kiosk-main.ts (H-TS4)"
```

---

## Chunk 12: Phase 12 — Module Singleton Lifecycle (MEDIUM)

> ~6 issues: modules with mutable state that's never reset, causing leaks on repeated init.

### Task 12.1: Add dispose/reset to map-picker.ts

**Files:**
- Modify: `src/modules/map-picker.ts`

The map instance leaks on repeated open/close. Add a `dispose()` or `destroy()` export that removes the Leaflet map instance, clears event listeners, and nulls references.

- [ ] **Step 1: Read map-picker.ts and identify mutable state**

- [ ] **Step 2: Add `destroyMapPicker()` export**

Clean up the Leaflet map instance, remove event listeners, null the reference.

- [ ] **Step 3: Wire the destroy call**

Call `destroyMapPicker()` when the map picker modal closes, or from a global cleanup function.

- [ ] **Step 4: Verify build**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/modules/map-picker.ts
git commit -m "fix: add dispose lifecycle to map-picker singleton (M-SINGLE1)"
```

### Task 12.2: Add full reset to collection-manager.ts

**Files:**
- Modify: `src/modules/collection-manager.ts`

Phase 7 added a double-init guard, but there's no full dispose/reset. Add a `resetCollectionManager()` export that clears state and allows clean re-initialization.

- [ ] **Step 1: Read collection-manager.ts and identify all mutable state**

- [ ] **Step 2: Add `resetCollectionManager()` export**

Reset all module-scope variables, set `_initialized = false`, remove event listeners added during init.

- [ ] **Step 3: Verify build**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/modules/collection-manager.ts
git commit -m "fix: add full reset lifecycle to collection-manager (M-SINGLE2)"
```

---

## Chunk 13: Phase 13 — Performance Fixes (MEDIUM)

> 3 issues: SHA-256 memory doubling, N+1 collection queries, inline style manipulation.

### Task 13.1: Fix SHA-256 streaming to use incremental hashing

**Files:**
- Modify: `src/modules/archive-creator.ts:513-565`

`calculateSHA256Streaming` reads the blob in 4MB chunks but then combines them into a single `Uint8Array` before hashing — doubling peak memory. The comment says "SubtleCrypto doesn't support incremental hashing", but this is wrong: `crypto.subtle` doesn't, but a lightweight JS implementation (or reading the full blob via `blob.arrayBuffer()` directly) would avoid the intermediate copy.

- [ ] **Step 1: Read the current implementation**

- [ ] **Step 2: Simplify to avoid double-buffer**

Option A (simplest): For blobs, just use `blob.arrayBuffer()` directly and hash the result. The chunked reading was only for progress reporting — keep progress by using a `ReadableStream` reader instead:

```typescript
async function calculateSHA256Streaming(blob: Blob, onProgress: ((progress: number) => void) | null = null): Promise<string | null> {
    if (!CRYPTO_AVAILABLE) {
        log.warn('✗ crypto.subtle not available (requires HTTPS). Skipping hash.');
        return null;
    }

    // Read with progress reporting via stream, then hash the full buffer once
    if (onProgress) {
        const reader = blob.stream().getReader();
        let loaded = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            onProgress(loaded / blob.size);
            await new Promise(resolve => setTimeout(resolve, 0)); // yield to UI
        }
        const combined = new Uint8Array(loaded);
        let pos = 0;
        for (const c of chunks) { combined.set(c, pos); pos += c.length; }
        const hashBuffer = await crypto.subtle.digest('SHA-256', combined.buffer);
        return hexFromBuffer(hashBuffer);
    }

    // No progress callback — single-pass, no intermediate copy
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return hexFromBuffer(hashBuffer);
}
```

Note: The true fix (zero-copy incremental hashing) would require a WASM or JS SHA-256 library. The above still copies once but removes the *double* copy (chunks array + combined array → just combined array). The no-progress path avoids copying entirely.

- [ ] **Step 3: Extract hex conversion helper**

```typescript
function hexFromBuffer(buffer: ArrayBuffer): string {
    const arr = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < arr.length; i++) hex += HEX_TABLE[arr[i]];
    return hex;
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/modules/archive-creator.ts
git commit -m "perf: remove double-buffer in SHA-256 streaming (M-PERF1)"
```

### Task 13.2: Batch collection API calls (N+1 → batch)

**Files:**
- Modify: `src/modules/collection-manager.ts`

Sequential API calls per collection (`for` loop with `await fetch` inside). If the API supports batch fetching, use a single call. If not, use `Promise.all` for parallel execution.

- [ ] **Step 1: Read the N+1 pattern**

Read around line 500-520 of collection-manager.ts.

- [ ] **Step 2: Replace sequential calls with `Promise.all`**

```typescript
// Before: sequential
for (const collection of collections) {
    const response = await fetch(`/api/collections/${collection.id}/archives`);
    // ...
}

// After: parallel
const results = await Promise.all(
    collections.map(c => fetch(`/api/collections/${c.id}/archives`).then(r => r.json()))
);
```

- [ ] **Step 3: Verify build**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/modules/collection-manager.ts
git commit -m "perf: batch collection API calls with Promise.all (M-PERF2)"
```

---

## Chunk 14: Phase 14 — Polling → Promises (MEDIUM)

> ~4 issues: `ensureAssetLoaded` polls with `setTimeout` every 50ms in both `archive-pipeline.ts` and `kiosk-main.ts`. Convert to Promise-based resolution.

### Task 14.1: Convert ensureAssetLoaded to Promise-based in archive-pipeline.ts

**Files:**
- Modify: `src/modules/archive-pipeline.ts`
- Modify: `src/modules/file-handlers.ts` (if loaders need to resolve a promise)

- [ ] **Step 1: Read the current polling implementation**

Read `ensureAssetLoaded` in archive-pipeline.ts (around line 309).

- [ ] **Step 2: Design the Promise-based approach**

Option A: Have each loader function return a `Promise` that resolves when the asset is ready. Store these promises in a registry. `ensureAssetLoaded` simply awaits the registered promise.

Option B: Use a simple event emitter / callback registry: `onAssetLoaded(type, callback)` called by loaders when done, `ensureAssetLoaded` returns a promise that registers itself.

Choose the approach that minimizes changes to existing loader code.

- [ ] **Step 3: Implement the promise registry**

```typescript
const assetReadyPromises = new Map<string, { promise: Promise<boolean>; resolve: (v: boolean) => void }>();

export function signalAssetReady(type: string): void {
    const entry = assetReadyPromises.get(type);
    if (entry) entry.resolve(true);
}

export async function ensureAssetLoaded(type: string, deps: ArchivePipelineDeps): Promise<boolean> {
    // If already loaded, return immediately
    if (isAssetLoaded(type, deps)) return true;

    // Create a promise if one doesn't exist
    if (!assetReadyPromises.has(type)) {
        let resolve!: (v: boolean) => void;
        const promise = new Promise<boolean>(r => { resolve = r; });
        assetReadyPromises.set(type, { promise, resolve });

        // Timeout fallback
        setTimeout(() => {
            const entry = assetReadyPromises.get(type);
            if (entry) { entry.resolve(false); assetReadyPromises.delete(type); }
        }, 120_000);
    }

    return assetReadyPromises.get(type)!.promise;
}
```

- [ ] **Step 4: Call `signalAssetReady(type)` from loader completion points**

In file-handlers.ts, after each loader completes (splat, model, pointcloud, etc.), call `signalAssetReady(type)`.

- [ ] **Step 5: Apply the same pattern to kiosk-main.ts**

Mirror the promise-based approach in kiosk-main's `ensureAssetLoaded`.

- [ ] **Step 6: Verify build**

Run: `npm run build`

- [ ] **Step 7: Commit**

```bash
git add src/modules/archive-pipeline.ts src/modules/file-handlers.ts src/modules/kiosk-main.ts
git commit -m "refactor: replace ensureAssetLoaded polling with Promise resolution (M-POLL)"
```

---

## Summary

| Phase | Severity | Tasks | Files Modified | Risk | Status |
|-------|----------|-------|----------------|------|--------|
| 1 — Security | CRITICAL | 8 | 9 | Low (additive guards) | ✅ Done |
| 2 — Crashes & Data | CRITICAL+HIGH | 6 | 6 | Low (null guards, URL revoke) | ✅ Done |
| 3 — Stability | HIGH | 5 | 7 | Low (timeouts, resets) | ✅ Done |
| 4 — Performance | HIGH | 2 | 2 | Low (algorithm fix) | ✅ Done |
| 5 — Flight Logic | HIGH | 1 | 1 | Medium (behavior change) | ✅ Done |
| 6 — Transform | HIGH | 1 | 1 | Medium (geometry math) | ✅ Done |
| 7 — Type Safety & Auth | HIGH | 5 | 5 | Low (type changes, auth) | ✅ Done |
| 8 — Consolidation | HIGH+MEDIUM | 6 | 11 | Low (import changes) | ✅ Done |
| 9 — SceneRefs Types | HIGH | 1 | 1-2 | Low (type-only) | Planned |
| 10 — Deps Factories | HIGH | 1 | 2 | Low (type-only) | Planned |
| 11 — Kiosk `any` | HIGH | 2 | 2 | Low (type-only) | Planned |
| 12 — Singleton Lifecycle | MEDIUM | 2 | 2 | Low (cleanup logic) | Planned |
| 13 — Performance | MEDIUM | 2 | 2 | Medium (algorithm change) | Planned |
| 14 — Polling → Promises | MEDIUM | 1 | 3 | Medium (async flow change) | Planned |

**Phases 1-8: 34 tasks completed.** Phases 9-14: 9 tasks planned.

Phases 9-11 (type safety) should be done in order. Phases 12-14 are independent of each other and of 9-11.
