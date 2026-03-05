# Editor UX Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove redundant UI elements and improve element placement in the editor screen for a cleaner, more efficient workflow.

**Architecture:** HTML-only changes to `src/index.html` with supporting CSS in `src/styles.css` and minor JS cleanup in `src/modules/event-wiring.ts`. No new modules or dependencies. Each task is independently shippable and testable via `npm run build`.

**Tech Stack:** HTML, CSS, TypeScript (Vite + Three.js project)

**Key file locations:**
- `src/index.html` — all DOM structure (~2100 lines)
- `src/styles.css` — all CSS (~5300 lines)
- `src/modules/event-wiring.ts` — UI event bindings (~927 lines)
- `src/modules/ui-controller.ts` — `activateTool()`, pane switching

---

## Stage 1: Quick Win — Label Clarity (Low Risk)

### Task 1: Rename Walkthrough "Settings" section to avoid ambiguity

**Files:**
- Modify: `src/index.html:863`

**Step 1: Change section title**

```html
<!-- BEFORE -->
<span class="prop-section-title">Settings</span>

<!-- AFTER -->
<span class="prop-section-title">Walkthrough</span>
```

This is inside `#pane-walkthrough`, line ~863.

**Step 2: Commit**

```bash
git add src/index.html
git commit -m "fix: rename walkthrough Settings section to avoid ambiguity with Settings pane"
```

---

## Stage 2: Consolidate Transform Pane (Medium Risk)

### Task 2: Merge "Actions" section into "Position & Rotation" section

The standalone "Actions" section contains only one button (Reset Transform). Move it into the Position & Rotation section as an inline action.

**Files:**
- Modify: `src/index.html:780-789` (remove Actions section)
- Modify: `src/index.html:747` (add Reset button into transform-values-group)

**Step 1: Remove the standalone Actions section**

Delete lines ~780-789:

```html
<!-- DELETE THIS BLOCK -->
                <!-- Actions (NEW) -->
                <div class="prop-section open">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Actions</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <button class="prop-btn danger" id="btn-reset-transform">Reset Transform</button>
                    </div>
                </div>
```

**Step 2: Add Reset Transform button inside transform-values-group**

Find the closing `</div>` of `#transform-values-group` (~after line 775) and add the button before it:

```html
                            <span id="transform-both-hint" class="prop-hint mt4" style="display:none; font-style:italic;">(showing primary object)</span>
                            <button class="prop-btn danger mt4" id="btn-reset-transform">Reset Transform</button>
                        </div>
```

**Step 3: Verify build and that the button still works**

Run: `npm run build`
The event handler in `event-wiring.ts:445` binds by ID (`btn-reset-transform`) — unchanged, so it still works.

**Step 4: Commit**

```bash
git add src/index.html
git commit -m "refactor: move Reset Transform button into Position & Rotation section"
```

---

## Stage 3: Declutter Model Settings (Medium Risk)

### Task 3: Group debug visualization checkboxes into a collapsible sub-section

Normals, Roughness, Metalness, and Specular F0 are PBR debug channels most users never need. Move them into a collapsed sub-group.

**Files:**
- Modify: `src/index.html:610-622`
- Modify: `src/styles.css` (add debug-channels style)

**Step 1: Wrap debug checkboxes in a collapsible group**

Replace lines ~610-622 with:

```html
                        <details class="debug-channels">
                            <summary>Debug Channels</summary>
                            <div class="debug-channels-body">
                                <div class="cb-row">
                                    <input type="checkbox" id="model-normals"><label for="model-normals">Show Normals</label>
                                </div>
                                <div class="cb-row">
                                    <input type="checkbox" id="model-roughness"><label for="model-roughness">Roughness</label>
                                </div>
                                <div class="cb-row">
                                    <input type="checkbox" id="model-metalness"><label for="model-metalness">Metalness</label>
                                </div>
                                <div class="cb-row">
                                    <input type="checkbox" id="model-specular-f0"><label for="model-specular-f0">Specular F0</label>
                                </div>
                            </div>
                        </details>
```

**Step 2: Add CSS for the debug-channels `<details>` element**

Add to `src/styles.css` after the `.cb-row` rules (~line 487):

```css
/* Debug channel disclosure */
.debug-channels {
    margin-top: 6px;
    border-top: 1px solid var(--border-subtle);
    padding-top: 6px;
}

.debug-channels summary {
    font-size: 10px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 4px;
}

.debug-channels summary::before {
    content: '▸';
    font-size: 8px;
    transition: transform 0.15s;
}

.debug-channels[open] summary::before {
    transform: rotate(90deg);
}

.debug-channels-body {
    padding-top: 4px;
}
```

**Step 3: Verify build**

Run: `npm run build`
Event handlers bind by checkbox IDs — all unchanged.

**Step 4: Commit**

```bash
git add src/index.html src/styles.css
git commit -m "refactor: collapse debug visualization channels into details element"
```

---

## Stage 4: Fix Source Files Workflow (Low Risk)

### Task 4: Move category dropdown above the file input

Users should pick a category *before* adding files, but the dropdown is currently below.

**Files:**
- Modify: `src/index.html:546-571`

**Step 1: Reorder elements in Source Files section body**

Rearrange the section body so the category select comes first:

```html
                    <div class="prop-section-body">
                        <select class="prop-select" id="source-files-category" style="font-size:10px;">
                            <option value="">Category (optional)</option>
                            <option value="raw_photography">Raw Photography</option>
                            <option value="processing_report">Processing Report</option>
                            <option value="ground_control">Ground Control Points</option>
                            <option value="calibration">Calibration Data</option>
                            <option value="project_file">Project File</option>
                            <option value="reference">Reference Material</option>
                            <option value="other">Other</option>
                        </select>
                        <label for="source-files-input" class="prop-btn mt4" style="font-size:10px; cursor:pointer;">+ Add Source Files</label>
                        <input type="file" id="source-files-input" multiple style="display:none" />
                        <div id="source-files-list" class="source-files-list"></div>
                        <div id="source-files-summary" class="source-files-summary" style="display:none">
                            <span id="source-files-count">0</span> files
                            (<span id="source-files-size">0 MB</span>)
                        </div>
                        <p class="prop-hint mt4">Archived alongside 3D data. Not loaded into viewer.</p>
                    </div>
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/index.html
git commit -m "fix: move source files category selector above file input for better workflow"
```

---

## Stage 5: Remove Settings Pane (Higher Risk)

The Settings pane shows only 5 stats — all available in the status bar or metadata. Removing it reclaims a tool rail slot and reduces cognitive load.

### Task 5: Remove the Settings tool rail button and pane

**Files:**
- Modify: `src/index.html:188-194` (remove Settings button from tool rail)
- Modify: `src/index.html:1987-2001` (remove pane-settings)
- Modify: `src/modules/event-wiring.ts:769` (remove keyboard shortcut)

**Step 1: Remove the Settings button from the tool rail**

Delete lines ~188-194:

```html
<!-- DELETE THIS BLOCK -->
            <!-- Settings — Stats and preferences -->
            <button class="tool-btn" data-tool="settings" data-tooltip="Settings  ," title="Application settings and stats">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l..."/>
                </svg>
            </button>
```

**Step 2: Remove the Settings pane**

Delete the `#pane-settings` div (lines ~1987-2001):

```html
<!-- DELETE THIS BLOCK -->
            <div class="props-pane" id="pane-settings">
                <div class="prop-section open">
                    ...stats rows...
                </div>
            </div>
```

**Step 3: Remove the keyboard shortcut in event-wiring.ts**

In `src/modules/event-wiring.ts`, delete line 769:

```typescript
// DELETE THIS LINE
            case ',': activateTool('settings'); activatedTool = 'settings'; break;
```

**Step 4: Verify no other code references pane-settings or activates settings**

Run: `grep -r "pane-settings\|activateTool.*settings\|data-tool.*settings" src/`

Only the lines we're deleting should match.

**Step 5: Verify build**

Run: `npm run build`

**Step 6: Commit**

```bash
git add src/index.html src/modules/event-wiring.ts
git commit -m "refactor: remove Settings pane — stats already shown in status bar and metadata"
```

---

## Stage 6: Compact Load Files Section (Higher Risk)

### Task 6: Default-collapse the Load Files section when assets are loaded

Rather than restructuring the entire load section (which would require significant JS changes), make it auto-collapse after files are loaded so subsequent panel views are compact.

**Files:**
- Modify: `src/modules/file-handlers.ts` — after successful load, collapse Load Files section
- Modify: `src/index.html:480` — remove `open` class from Load Files section

**Step 1: Remove default-open from Load Files section**

In `src/index.html` line ~480, change:

```html
<!-- BEFORE -->
<div class="prop-section open">
    <div class="prop-section-hd">
        <span class="prop-section-title">Load Files</span>

<!-- AFTER -->
<div class="prop-section">
    <div class="prop-section-hd">
        <span class="prop-section-title">Load Files</span>
```

This means Load Files starts collapsed. Users click to expand. The Asset settings sections remain always visible.

**Step 2: Consider UX impact**

On first load with no assets, users need to discover the Load Files section. However, URL-loaded assets and archive loads happen automatically. For file-based loading, the section header "Load Files" is descriptive enough.

If this feels too aggressive: alternatively, keep it open by default but add JS to collapse it after the first asset loads. To do that instead:

In `src/modules/file-handlers.ts`, after a successful load (search for calls to `hideLoading()` after asset load), add:

```typescript
// Collapse Load Files section after first asset loaded
const loadSection = document.querySelector('#pane-assets .prop-section:first-child');
if (loadSection) loadSection.classList.remove('open');
```

**Step 3: Verify build and test loading a file**

Run: `npm run build`
Manual test: load a .glb file, confirm Load Files collapses and Model Settings is visible without scrolling.

**Step 4: Commit**

```bash
git add src/index.html
# or if using the JS approach:
git add src/index.html src/modules/file-handlers.ts
git commit -m "ux: collapse Load Files section by default to prioritize editing controls"
```

---

## Summary & Ordering

| Stage | Task | Risk | Impact | Est. |
|-------|------|------|--------|------|
| 1 | Rename Walkthrough "Settings" | Low | Low | 1 min |
| 2 | Merge Actions into Position & Rotation | Med | Medium | 5 min |
| 3 | Collapse debug channels | Med | Medium | 5 min |
| 4 | Reorder source files category | Low | Low | 2 min |
| 5 | Remove Settings pane | High | High | 5 min |
| 6 | Compact Load Files | High | High | 5 min |

Total: ~23 minutes of implementation for 6 tasks across 6 stages.

Each stage is independently shippable. Stop after any stage if desired.

---

## Removed from plan

- **Display pill labels (M/S→Both, Cloud→Points):** Removed per user request.
- **Export Include checkboxes:** Investigation revealed these are already functional — `updateArchiveAssetCheckboxes()` in `export-controller.ts` enables them when assets are loaded, and `prepareArchive()` reads their checked state to conditionally include/exclude assets. No changes needed.
