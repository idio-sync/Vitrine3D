# Kiosk / Editor Bundle Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the single Vite build into a minimal public kiosk bundle at `/` and a full editor bundle at `/editor/`, establishing `kiosk-main.ts` as the shared viewer layer.

**Architecture:** Two Vite entry points in one `npm run build`. `src/index.html` + `kiosk-web.ts` → `dist/index.html` (kiosk, public). `src/editor/index.html` + `main.ts` → `dist/editor/index.html` (editor). Three.js and Spark.js land in a shared chunk cached across both. `kiosk-main.ts` is the canonical viewer layer — new viewer features go there and are available in both bundles automatically.

**Tech Stack:** Vite 7, TypeScript, Rollup multi-entry, nginx, Docker

**Design doc:** `docs/plans/2026-03-02-kiosk-editor-bundle-split-design.md`

---

## Before You Start

Run the baseline test suite and confirm it passes:

```bash
npm test
npm run build
```

Both must be green before making any changes. If either fails, stop and fix first.

---

## Task 1: Create `src/editor/` and move the editor HTML there

**Files:**
- Create: `src/editor/` (directory)
- Create: `src/editor/index.html` (from current `src/index.html` with path adjustments)

The editor HTML needs to reference non-bundled scripts one level up. The file will live at `dist/editor/index.html` after build; `../config.js` resolves to `dist/config.js`. In Vite dev (`root: src/`), the file is served at `/editor/index.html` and `../config.js` resolves to `/config.js` → `src/config.js`. Both work without copying.

**Step 1: Create the directory and copy the file**

```bash
mkdir src/editor
cp src/index.html src/editor/index.html
```

**Step 2: Update the four path references in `src/editor/index.html`**

Find and replace these lines (they appear in the `<head>` and just before `</body>`):

| Old | New |
|---|---|
| `href="styles.css"` | `href="../styles.css"` |
| `href="kiosk.css"` | `href="../kiosk.css"` |
| `src="config.js"` | `src="../config.js"` |
| `src="pre-module.js"` | `src="../pre-module.js"` |
| `src="main.ts"` | `src="../main.ts"` |

**Step 3: Verify the file exists with correct paths**

```bash
grep -n 'href="\.\.\|src="\.\.' src/editor/index.html
```

Expected output: 5 lines showing `../styles.css`, `../kiosk.css`, `../config.js`, `../pre-module.js`, `../main.ts`.

**Step 4: Commit**

```bash
git add src/editor/index.html
git commit -m "feat: add src/editor/index.html as editor Vite entry"
```

---

## Task 2: Create the kiosk root HTML (`src/index.html` replacement)

**Files:**
- Modify: `src/index.html` (repurpose as kiosk entry; keep most DOM, change body class and module script)

The kiosk HTML is the public face at `/`. `kiosk-main.ts` + CSS already handle showing/hiding editor elements via `body.kiosk-mode`. The DOM cleanup (removing editor-only panels) is a follow-on task — for this split we only change the body class and module script.

**Step 1: In `src/index.html`, set kiosk-mode unconditionally on `<body>`**

Find:
```html
<body>
    <script>if(window.APP_CONFIG&&window.APP_CONFIG.kiosk)document.body.classList.add('kiosk-mode');</script>
```

Replace with:
```html
<body class="kiosk-mode">
```

The inline script was a runtime toggle; in the kiosk bundle kiosk-mode is always active so no JS needed.

**Step 2: Change the module script at the bottom of `src/index.html`**

Find (near line 2208):
```html
    <script src="pre-module.js"></script>
    <script type="module" src="main.ts"></script>
```

Replace with:
```html
    <script src="pre-module.js"></script>
    <script type="module" src="kiosk-web.ts"></script>
```

**Step 3: Verify**

```bash
grep -n 'kiosk-mode\|kiosk-web\|main.ts' src/index.html | tail -5
```

Expected: `kiosk-mode` on body, `kiosk-web.ts` as module, no `main.ts` reference.

**Step 4: Commit**

```bash
git add src/index.html
git commit -m "feat: repurpose src/index.html as kiosk entry point"
```

---

## Task 3: Create `src/kiosk-web.ts`

**Files:**
- Create: `src/kiosk-web.ts`

This is the kiosk Vite entry. It imports only `kiosk-main.ts` — everything else tree-shakes out. No editor code is reachable from this entry.

**Step 1: Create the file**

```typescript
// src/kiosk-web.ts
// Kiosk bundle entry point — imports viewer layer only.
// For the full editor, see src/editor/index.html → main.ts.
import { init } from './modules/kiosk-main.js';
init();
```

**Step 2: Verify TypeScript resolves the import**

```bash
npx tsc --noEmit --allowJs --moduleResolution bundler src/kiosk-web.ts 2>&1 | head -20
```

Expected: no errors (or only path-alias warnings that Vite resolves at build time).

**Step 3: Commit**

```bash
git add src/kiosk-web.ts
git commit -m "feat: add kiosk-web.ts entry point"
```

---

## Task 4: Update `vite.config.ts` for two entries

**Files:**
- Modify: `vite.config.ts`

**Step 1: Replace the `rollupOptions.input` block**

Find:
```typescript
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'src/index.html'),
            },
        },
```

Replace with:
```typescript
        rollupOptions: {
            input: {
                index: resolve(__dirname, 'src/index.html'),
                editor: resolve(__dirname, 'src/editor/index.html'),
            },
        },
```

Note: the key name `index` causes Vite to output `dist/index.html`; `editor` outputs to `dist/editor/index.html` mirroring the source path relative to `root: 'src'`.

**Step 2: Run the build and verify both HTML files appear**

```bash
npm run build 2>&1 | tail -20
```

```bash
ls dist/index.html dist/editor/index.html dist/editor/
```

Expected: both files exist. `dist/editor/` contains `index.html`.

**Step 3: Verify non-bundled scripts are accessible from the editor**

```bash
ls dist/config.js dist/pre-module.js dist/styles.css dist/kiosk.css
```

These live at `dist/` root. The editor HTML references them as `../config.js` which resolves correctly from `dist/editor/index.html`.

**Step 4: Check bundle sizes** (kiosk should be meaningfully smaller)

```bash
ls -lh dist/assets/*.js | sort -k5 -h
```

You should see at least three chunks: a kiosk entry, an editor entry, and a shared vendor chunk. The kiosk chunk should be smaller than the editor chunk.

**Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass.

**Step 6: Commit**

```bash
git add vite.config.ts
git commit -m "feat: add two-entry Vite build (kiosk at /, editor at /editor/)"
```

---

## Task 5: Wire CAD asset display into `kiosk-main.ts`

**Files:**
- Modify: `src/modules/kiosk-main.ts`

`archive-loader.ts` already tracks `contentInfo.hasCAD`. `scene-manager.ts` already creates `cadGroup: THREE.Group` on SceneRefs. `kiosk-main.ts` needs to: import `loadCADFromBlobUrl`, extract the CAD blob from the archive after loading, and pass it to the loader.

**Step 1: Add the import to `src/modules/kiosk-main.ts`**

After the existing file-handlers import block (around line 47), add:

```typescript
import { loadCADFromBlobUrl } from './cad-loader.js';
```

**Step 2: Find where kiosk-main.ts checks contentInfo after archive loads**

Search for `hasCAD` or `contentInfo` in `kiosk-main.ts`:

```bash
grep -n "contentInfo\|hasCAD\|hasSplat\|hasMesh" src/modules/kiosk-main.ts | head -20
```

This shows the block where kiosk-main.ts decides which assets to load after archive phase 1. The CAD loading call should go in the same block that handles `hasMesh`, `hasSplat`, etc.

**Step 3: Add CAD loading after the mesh/splat loading block**

The pattern follows the same structure used for other asset types. Look at how `main.ts` calls `loadCADFromBlobUrl` via `createCADDeps()` (around line 601–619 of `main.ts`) for the exact deps shape needed:

```typescript
// After contentInfo is available and hasCAD is true:
if (contentInfo.hasCAD) {
    const cadEntry = state.archiveLoader.getCADEntry();
    if (cadEntry) {
        const blob = await state.archiveLoader.extractEntry(cadEntry);
        const blobUrl = URL.createObjectURL(blob);
        try {
            await loadCADFromBlobUrl(blobUrl, cadEntry.file_name, {
                cadGroup: sceneManager.cadGroup,
                scene: sceneManager.scene,
            });
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    }
}
```

Adapt field names to match what `kiosk-main.ts` uses for `sceneManager` — search for how it accesses `sceneManager.modelGroup` or `sceneManager.scene` and follow the same pattern.

**Step 4: Build and verify no TypeScript errors**

```bash
npm run build 2>&1 | grep -i "error\|warning" | head -20
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/modules/kiosk-main.ts
git commit -m "feat: add CAD asset display to kiosk-main.ts"
```

---

## Task 6: Update nginx configs for `/editor/` routing

**Files:**
- Modify: `docker/nginx.conf` (local dev)
- Modify: `docker/nginx.conf.template` (Docker deployment)

**Step 1: In `docker/nginx.conf`, add the editor location block**

Find the root location block:
```nginx
    location / {
        try_files $uri $uri/ /index.html;
    }
```

Add after it:
```nginx
    # Editor — full authoring app
    # Future: add auth_basic block here to gate access
    location /editor/ {
        try_files $uri $uri/ /editor/index.html;
    }
```

**Step 2: Make the identical change in `docker/nginx.conf.template`**

Find the `og-location-root.conf.inc` include block. The root location is generated dynamically by the entrypoint. Add the `/editor/` block after the `og-oembed.conf.inc` include:

```nginx
    # Editor bundle — served from /editor/
    # Future: auth_basic goes here
    location /editor/ {
        try_files $uri $uri/ /editor/index.html;
    }
```

Place it before the `# Admin panel` include comment.

**Step 3: Verify nginx config syntax (if nginx is available)**

```bash
docker run --rm -v "$(pwd)/docker:/etc/nginx/test" nginx:alpine nginx -t -c /etc/nginx/test/nginx.conf 2>&1 || echo "nginx not available locally — skip"
```

**Step 4: Commit**

```bash
git add docker/nginx.conf docker/nginx.conf.template
git commit -m "feat: add /editor/ nginx location for editor bundle"
```

---

## Task 7: Update `docker-entrypoint.sh`

**Files:**
- Modify: `docker/docker-entrypoint.sh`

`KIOSK_LOCK` blocks editor module file fetches at the nginx layer. After the bundle split, the kiosk JS bundle genuinely doesn't contain editor modules — the nginx block is now redundant. Update the comment to reflect this.

**Step 1: Find the KIOSK_LOCK block**

```bash
grep -n "KIOSK_LOCK" docker/docker-entrypoint.sh
```

**Step 2: Update the echo message for KIOSK_LOCK**

Find:
```sh
    echo "  KIOSK_LOCK: ACTIVE (editor modules blocked)"
```

Replace with:
```sh
    echo "  KIOSK_LOCK: ACTIVE (legacy — editor modules are now separated at build time)"
```

**Step 3: Commit**

```bash
git add docker/docker-entrypoint.sh
git commit -m "docs: note KIOSK_LOCK is superseded by bundle split"
```

---

## Task 8: Update `src-tauri/tauri.conf.json`

**Files:**
- Modify: `src-tauri/tauri.conf.json`

`dist/index.html` is now the kiosk bundle directly. The `?kiosk=true` param was a runtime toggle and is no longer needed — the kiosk HTML sets `kiosk-mode` unconditionally. Remove it from both the dev URL and the production window URL. Keep `?theme=editorial`.

**Step 1: Update devUrl**

Find:
```json
"devUrl": "http://localhost:8080/?kiosk=true&theme=editorial",
```

Replace with:
```json
"devUrl": "http://localhost:8080/?theme=editorial",
```

**Step 2: Update production window url**

Find:
```json
"url": "index.html?kiosk=true&theme=editorial",
```

Replace with:
```json
"url": "index.html?theme=editorial",
```

**Step 3: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); console.log('valid')"
```

Expected: `valid`

**Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "fix: remove redundant ?kiosk=true from Tauri URLs"
```

---

## Task 9: Audit `scripts/build-branded.mjs`

**Files:**
- Modify: `scripts/build-branded.mjs` (if references to `dist/index.html` or `src/index.html` need updating)

**Step 1: Read the script**

```bash
cat scripts/build-branded.mjs
```

**Step 2: Check for hardcoded paths that reference the old single-entry structure**

```bash
grep -n "index.html\|dist/\|src/index\|main.ts" scripts/build-branded.mjs
```

**Step 3: Update any references**

- References to `src/index.html` (editor) → `src/editor/index.html`
- References to `dist/index.html` that expected the full editor → `dist/editor/index.html`
- The kiosk is now `dist/index.html`
- If the branded build serves both entries, ensure it runs `npm run build` (which now produces both)

**Step 4: Run the branded build to verify**

```bash
node scripts/build-branded.mjs 2>&1 | tail -20
```

Expected: completes without errors.

**Step 5: Commit if changes were needed**

```bash
git add scripts/build-branded.mjs
git commit -m "fix: update build-branded.mjs for two-entry build"
```

---

## Task 10: End-to-end verification

**Step 1: Clean build**

```bash
npm run build
```

Expected: exits 0, no errors.

**Step 2: Verify dist structure**

```bash
ls dist/index.html dist/editor/index.html dist/themes/ dist/modules/ dist/config.js dist/pre-module.js dist/styles.css dist/kiosk.css
```

All must exist.

**Step 3: Verify the kiosk HTML references kiosk-web entry, not main**

```bash
grep "kiosk-web\|main\." dist/index.html
```

Expected: a reference to a hashed kiosk asset, no reference to `main.ts`.

**Step 4: Verify the editor HTML references the editor entry**

```bash
grep "assets/" dist/editor/index.html | head -5
```

Expected: references to hashed asset files.

**Step 5: Verify editor HTML resolves non-bundled scripts correctly**

```bash
grep "config.js\|pre-module\|styles.css" dist/editor/index.html
```

Expected: `../config.js`, `../pre-module.js`, `../styles.css` (relative paths pointing up to dist/).

**Step 6: Verify themes are present for kiosk**

```bash
ls dist/themes/editorial/
```

Expected: `theme.css`, `layout.css`, `layout.js`, `logo.png`.

**Step 7: Verify kiosk bundle doesn't include editor-only modules**

```bash
grep -l "archive-creator\|export-controller\|library-panel" dist/assets/*.js 2>/dev/null || echo "not found (good)"
```

The kiosk chunk should not contain these strings. The editor chunk may contain them.

**Step 8: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

**Step 9: Commit verification result (no code change needed — this is the final check commit)**

```bash
git commit --allow-empty -m "verify: kiosk/editor bundle split complete and all tests pass"
```

---

## Task 11: Update ROADMAP.md

**Files:**
- Modify: `docs/ROADMAP.md`

Add a completed item under an appropriate section (create "Infrastructure" section if one doesn't exist):

```markdown
### Infrastructure
- [x] **Done** — Split Vite build into minimal public kiosk bundle (/) and full editor bundle (/editor/); established kiosk-main.ts as shared viewer layer
```

**Commit:**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark kiosk/editor bundle split as done in ROADMAP"
```

---

## Reference

**Key file relationships:**

```
src/index.html          → dist/index.html           (kiosk, served at /)
src/editor/index.html   → dist/editor/index.html    (editor, served at /editor/)
src/kiosk-web.ts        → dist/assets/kiosk-[hash].js
src/main.ts             → dist/assets/editor-[hash].js
src/modules/kiosk-main.ts  = shared viewer layer (both bundles use it)
```

**Viewer-only modules (kiosk bundle):** scene-manager, file-handlers, archive-loader, archive-pipeline, annotation-system, annotation-controller, measurement-system, cross-section, cad-loader, walkthrough-engine, walkthrough-controller, fly-controls, quality-tier, theme-loader, metadata-manager, metadata-profile, ui-controller, asset-store, constants, utilities, logger, url-validation

**Editor-only modules (not in kiosk bundle):** archive-creator, export-controller, library-panel, share-dialog, transform-controller, alignment, screenshot-manager, source-files-manager, walkthrough-editor, file-input-handlers, event-wiring, sip-validator, map-picker, kiosk-viewer, tauri-bridge

**Dev URLs after split:**
- Kiosk dev: `http://localhost:8080/` (served from `src/index.html`)
- Editor dev: `http://localhost:8080/editor/` (served from `src/editor/index.html`)
- Tauri dev: `http://localhost:8080/?theme=editorial`

**Future auth hook:** Add `auth_basic "Editor";` + `auth_basic_user_file /etc/nginx/.htpasswd;` inside the `location /editor/ { }` block in `nginx.conf.template`, following the existing `ADMIN_PASS` pattern in `docker-entrypoint.sh`.
