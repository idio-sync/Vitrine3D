# Mobile Editorial Floating Capsule — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile editorial bottom bar + drawer with a floating capsule toolbar, full-viewport info overlay, and compact annotation strip.

**Architecture:** All changes scoped to `src/themes/editorial/layout.js` and `src/themes/editorial/layout.css`. The capsule retains the `.editorial-mobile-pill` class name for backward compat with walkthrough mode. Info overlay is made tier-aware (curated mobile subset). New `syncInfoOverlayState` callback pattern syncs capsule Info button with keyboard shortcuts.

**Tech Stack:** Vanilla JS (layout.js is an ES module with `export function setup/cleanup`), CSS media queries (Tier 3/4), `env(safe-area-inset-*)` for notch handling.

**Spec:** `docs/superpowers/specs/2026-03-12-mobile-editorial-floating-capsule-design.md`

---

## Chunk 1: CSS Foundation — Capsule Base Styles + Safe Area Insets

### Task 1: Add safe-area inset to title block (Tier 3)

**Files:**
- Modify: `src/themes/editorial/layout.css:2953-2956` (Tier 3 title block)

- [ ] **Step 1: Update Tier 3 title block padding to include safe-area-inset-top**

In the `@media (max-width: 699px)` block, change:
```css
body.kiosk-mode.kiosk-editorial .editorial-title-block {
    padding: 12px 20px 10px 14px;
    max-width: 70%;
}
```
to:
```css
body.kiosk-mode.kiosk-editorial .editorial-title-block {
    padding: calc(12px + env(safe-area-inset-top)) 20px 10px calc(14px + env(safe-area-inset-left));
    max-width: 70%;
}
```

- [ ] **Step 2: Run build to verify CSS compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/themes/editorial/layout.css
git commit -m "feat(editorial): add safe-area-inset-top to mobile title block"
```

---

### Task 2: Replace Tier 3 pill styles with floating capsule styles

**Files:**
- Modify: `src/themes/editorial/layout.css:2977-2995` (Tier 3 pill override)
- Modify: `src/themes/editorial/layout.css:2970-2974` (hide ribbon + info overlay)

- [ ] **Step 1: Replace the Tier 3 pill override**

In the `@media (max-width: 699px)` block, find:
```css
/* Hide ribbon and info panel — floating pill replaces ribbon */
body.kiosk-mode.kiosk-editorial .editorial-bottom-ribbon,
body.kiosk-mode.kiosk-editorial .editorial-info-overlay {
    display: none !important;
}

/* Show pill as full-width anchored toolbar — flat top distinguishes it from the sheet above */
body.kiosk-mode.kiosk-editorial .editorial-mobile-pill {
    display: flex !important;
    bottom: 0;
    left: 0;
    right: 0;
    transform: none;
    max-width: 100%;
    height: 58px;
    border-radius: 0;
    border-left: none;
    border-right: none;
    border-bottom: none;
    border-top: 1px solid rgba(var(--kiosk-accent-rgb), 0.25);
    padding: 0 4px;
    justify-content: flex-start;
    gap: 0;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.35);
    animation: editorialBarIn 0.45s cubic-bezier(0.33, 1, 0.68, 1) 0.3s both;
}
```

Replace with:
```css
/* Hide ribbon and desktop info overlay — floating capsule replaces them */
body.kiosk-mode.kiosk-editorial .editorial-bottom-ribbon,
body.kiosk-mode.kiosk-editorial .editorial-info-overlay {
    display: none !important;
}

/* Hide metadata sidebar — mobile info overlay replaces it */
body.kiosk-mode.kiosk-editorial #metadata-sidebar {
    display: none !important;
}

/* Floating capsule — centered, compact, frosted glass */
body.kiosk-mode.kiosk-editorial .editorial-mobile-pill {
    display: flex !important;
    bottom: calc(12px + env(safe-area-inset-bottom));
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    max-width: calc(100vw - 32px);
    height: 38px;
    border-radius: 20px;
    border: 1px solid rgba(var(--kiosk-accent-rgb), 0.2);
    background: rgba(22, 24, 29, 0.88);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    padding: 0 4px;
    justify-content: center;
    align-items: center;
    gap: 0;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.15);
    z-index: 220;
    animation: editorialPillIn 0.5s cubic-bezier(0.33, 1, 0.68, 1) 0.4s both;
}

@keyframes editorialPillIn {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
```

- [ ] **Step 2: Run build to verify**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/themes/editorial/layout.css
git commit -m "feat(editorial): replace Tier 3 full-width bar with floating capsule"
```

---

### Task 3: Replace bottom-sheet sidebar styles with info overlay styles

**Files:**
- Modify: `src/themes/editorial/layout.css:2997-3410` (Tier 3 bar buttons + sidebar sheet + annotation detail styles)

- [ ] **Step 1: Remove all bottom-sheet sidebar styles from Tier 3**

Remove the following blocks from the `@media (max-width: 699px)` section (lines ~2997-3410):
- `.editorial-bar-details-btn` styles
- `.editorial-bar-anno-badge` styles
- `.editorial-bar-btn` / `.editorial-bar-label` / `.editorial-bar-divider` styles
- `.editorial-bar-popover` styles
- `#viewer-container` / `#viewer-canvas` block layout revert
- `#metadata-sidebar` sheet styles (`.sheet-peek`, `.sheet-half`, `.sheet-full`)
- `.drag-handle-bar` styles
- `#sidebar-view` / `.sidebar-mode-tabs` / `.kiosk-view-switcher` hide rules
- Editorial typography in sidebar
- Gold scrollbar for sidebar
- Metadata field label styles

- [ ] **Step 2: Add capsule button styles**

Insert after the capsule base styles:
```css
/* Capsule button — icon + tiny label */
body.kiosk-mode.kiosk-editorial .editorial-capsule-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    width: 34px;
    height: 34px;
    border: none;
    background: none;
    color: rgba(200, 204, 212, 0.6);
    border-radius: 50%;
    font-size: 5.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: color 0.15s;
}

body.kiosk-mode.kiosk-editorial .editorial-capsule-btn svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
}

body.kiosk-mode.kiosk-editorial .editorial-capsule-btn.active {
    color: var(--kiosk-accent);
}

body.kiosk-mode.kiosk-editorial .editorial-capsule-btn.off {
    color: rgba(200, 204, 212, 0.3);
}

body.kiosk-mode.kiosk-editorial .editorial-capsule-sep {
    width: 1px;
    height: 18px;
    background: rgba(var(--kiosk-accent-rgb), 0.15);
    flex-shrink: 0;
    margin: 0 2px;
}

/* Annotation count badge on capsule button */
body.kiosk-mode.kiosk-editorial .editorial-capsule-badge {
    position: absolute;
    top: 1px;
    right: 1px;
    min-width: 12px;
    height: 12px;
    padding: 0 3px;
    border-radius: 6px;
    background: var(--kiosk-accent);
    color: var(--kiosk-surface);
    font-size: 7px;
    font-weight: 700;
    line-height: 12px;
    text-align: center;
}
```

- [ ] **Step 3: Add base hide rule for mobile info content (outside media query)**

This rule must go **outside** any media query — in the base editorial styles section (around line ~605, near the `.editorial-info-overlay` base styles). This ensures the mobile content div is hidden at all viewport widths:
```css
/* Mobile info content — hidden at all widths, shown only via .mobile-open parent in Tier 3 */
body.kiosk-mode.kiosk-editorial .editorial-mobile-info-content {
    display: none;
}
```

- [ ] **Step 4: Add info overlay styles**

Insert after the capsule button styles (inside the `@media (max-width: 699px)` block):
```css
/* Mobile info overlay — full viewport, 82% opacity */
body.kiosk-mode.kiosk-editorial .editorial-info-overlay {
    display: none;
}

body.kiosk-mode.kiosk-editorial .editorial-info-overlay.mobile-open {
    display: flex !important;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 210;
    flex-direction: column;
    padding: calc(32px + env(safe-area-inset-top)) 20px calc(56px + env(safe-area-inset-bottom)) 20px;
    background: rgba(14, 16, 22, 0.82);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    overflow-y: auto;
    animation: editorialOverlayIn 0.2s ease-out;
}

@keyframes editorialOverlayIn {
    from { opacity: 0; }
    to   { opacity: 1; }
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-close {
    /* Use absolute within the overlay (position:fixed), not fixed — backdrop-filter
       on the overlay creates a new stacking context that confines fixed children.
       Close button is a direct child of overlay, positioned at top-right. */
    position: absolute;
    top: calc(18px + env(safe-area-inset-top));
    right: 16px;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 230;
    -webkit-tap-highlight-color: transparent;
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-title {
    font-family: var(--kiosk-font-body);
    font-size: 13px;
    font-weight: 700;
    color: var(--kiosk-text-primary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: 5px;
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-rule {
    width: 26px;
    height: 2px;
    background: var(--kiosk-accent);
    margin-bottom: 10px;
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-desc {
    font-family: var(--kiosk-font-body);
    font-size: 0.75rem;
    color: var(--kiosk-text-muted);
    line-height: 1.65;
    margin-bottom: 10px;
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-divider {
    height: 1px;
    background: rgba(var(--kiosk-accent-rgb), 0.15);
    margin: 8px 0;
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-label {
    font-family: var(--kiosk-font-body);
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(200, 204, 212, 0.35);
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-value {
    font-family: var(--kiosk-font-body);
    font-size: 0.65rem;
    color: var(--kiosk-text-primary);
    text-align: right;
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 10px;
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-stat {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 6px;
    padding: 6px 8px;
    text-align: center;
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-stat-num {
    font-family: var(--kiosk-font-body);
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--kiosk-text-primary);
    font-variant-numeric: tabular-nums;
}

body.kiosk-mode.kiosk-editorial .editorial-mobile-info-stat-label {
    font-family: var(--kiosk-font-body);
    font-size: 0.5rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(200, 204, 212, 0.35);
    margin-top: 1px;
}
```

- [ ] **Step 5: Add annotation strip styles**

```css
/* Annotation navigation strip — above capsule */
body.kiosk-mode.kiosk-editorial .editorial-anno-strip {
    position: fixed;
    bottom: calc(56px + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 10px;
    background: rgba(22, 24, 29, 0.88);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(var(--kiosk-accent-rgb), 0.15);
    border-radius: 16px;
    z-index: 200;
    animation: editorialStripIn 0.15s ease-out;
    max-width: calc(100vw - 48px);
}

body.kiosk-mode.kiosk-editorial .editorial-anno-strip.fade-out {
    opacity: 0;
    transition: opacity 0.2s ease-out;
}

@keyframes editorialStripIn {
    from { opacity: 0; transform: translateX(-50%) translateY(10px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

body.kiosk-mode.kiosk-editorial .editorial-anno-strip-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    color: var(--kiosk-text-muted);
    cursor: pointer;
    border-radius: 50%;
    font-size: 0.7rem;
    -webkit-tap-highlight-color: transparent;
}

body.kiosk-mode.kiosk-editorial .editorial-anno-strip-btn:active {
    color: var(--kiosk-accent);
}

body.kiosk-mode.kiosk-editorial .editorial-anno-strip-label {
    font-family: var(--kiosk-font-body);
    font-size: 0.6rem;
    color: var(--kiosk-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
    letter-spacing: 0.02em;
}

body.kiosk-mode.kiosk-editorial .editorial-anno-strip-counter {
    font-family: var(--kiosk-font-body);
    font-size: 0.6rem;
    font-weight: 600;
    color: var(--kiosk-accent);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 6: Add More menu popover styles (reuse existing pattern)**

```css
/* More menu — popover above capsule */
body.kiosk-mode.kiosk-editorial .editorial-capsule-popover {
    display: none;
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    background: rgba(var(--kiosk-surface-rgb), 0.92);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(var(--kiosk-accent-rgb), 0.2);
    border-radius: 8px;
    padding: 6px 0;
    min-width: 140px;
    z-index: 250;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
}

body.kiosk-mode.kiosk-editorial .editorial-capsule-popover.open {
    display: flex;
    flex-direction: column;
    animation: editorialPillMenuIn 0.15s ease-out;
}

body.kiosk-mode.kiosk-editorial .editorial-capsule-popover-item {
    font-family: var(--kiosk-font-body);
    font-size: 0.72rem;
    font-weight: 400;
    color: var(--kiosk-text-secondary);
    letter-spacing: 0.03em;
    text-transform: uppercase;
    background: none;
    border: none;
    padding: 10px 16px;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    transition: color 0.1s, background 0.1s;
    -webkit-tap-highlight-color: transparent;
}

body.kiosk-mode.kiosk-editorial .editorial-capsule-popover-item:active {
    background: rgba(var(--kiosk-accent-rgb), 0.1);
}

body.kiosk-mode.kiosk-editorial .editorial-capsule-popover-item.active {
    color: var(--kiosk-accent);
    font-weight: 600;
}
```

- [ ] **Step 7: Run build to verify all new CSS compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/themes/editorial/layout.css
git commit -m "feat(editorial): add capsule buttons, info overlay, annotation strip, more menu CSS"
```

---

### Task 4: Update landscape and Tier 4 queries

**Files:**
- Modify: `src/themes/editorial/layout.css:3414-3519` (Tier 4)
- Modify: `src/themes/editorial/layout.css:3531-3562` (landscape)

- [ ] **Step 1: Update Tier 4 — keep title hidden, no additional capsule changes needed**

Tier 4 already hides the title block (line 3416). No capsule changes needed at this tier — the base capsule styles from Tier 3 work. Verify the Tier 4 block does NOT have any `.editorial-mobile-pill` overrides that contradict the floating capsule. Currently it does not.

No code change needed for Tier 4.

- [ ] **Step 2: Replace landscape query**

Find the landscape block (lines 3531-3562):
```css
@media (max-width: 699px) and (orientation: landscape) {
    /* Compact pill for landscape */
    body.kiosk-mode.kiosk-editorial .editorial-mobile-pill {
        height: 50px;
        border-radius: 12px 12px 0 0;
    }

    /* Hide title block — too little vertical room */
    body.kiosk-mode.kiosk-editorial .editorial-title-block {
        display: none !important;
    }

    /* Shorter bottom sheet in landscape — sits above 50px bar */
    body.kiosk-mode.kiosk-editorial #metadata-sidebar {
        height: calc(60dvh - 50px);
        max-height: calc(60dvh - 50px);
        bottom: 50px;
        transform: translateY(calc(100% - 44px));
    }

    body.kiosk-mode.kiosk-editorial #metadata-sidebar.sheet-peek {
        transform: translateY(calc(100% - 44px));
    }

    body.kiosk-mode.kiosk-editorial #metadata-sidebar.sheet-half {
        transform: translateY(calc(100% - 26dvh));
    }

    body.kiosk-mode.kiosk-editorial #metadata-sidebar.sheet-full {
        transform: translateY(0);
    }
}
```

Replace with:
```css
@media (max-width: 699px) and (orientation: landscape) {
    /* Hide title block — too little vertical room */
    body.kiosk-mode.kiosk-editorial .editorial-title-block {
        display: none !important;
    }

    /* Capsule: icon-only in landscape to save vertical space */
    body.kiosk-mode.kiosk-editorial .editorial-capsule-btn span {
        display: none;
    }

    body.kiosk-mode.kiosk-editorial .editorial-mobile-pill {
        height: 34px;
    }

    /* Annotation strip closer to capsule (34px capsule + 12px bottom) */
    body.kiosk-mode.kiosk-editorial .editorial-anno-strip {
        bottom: calc(52px + env(safe-area-inset-bottom));
    }
}
```

- [ ] **Step 3: Run build to verify**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/themes/editorial/layout.css
git commit -m "feat(editorial): update landscape + Tier 4 queries for floating capsule"
```

---

### Task 5: Add touch target enlargement for capsule

**Files:**
- Modify: `src/themes/editorial/layout.css:2697+` (touch targets media query)

- [ ] **Step 1: Add capsule touch target rules inside existing `@media (pointer: coarse)` block**

Find the existing `@media (pointer: coarse)` block (line 2697) and add inside it:
```css
/* Capsule buttons — larger touch targets */
body.kiosk-mode.kiosk-editorial .editorial-capsule-btn {
    min-width: 44px;
    min-height: 44px;
}

body.kiosk-mode.kiosk-editorial .editorial-anno-strip-btn {
    min-width: 44px;
    min-height: 44px;
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/themes/editorial/layout.css
git commit -m "feat(editorial): enlarge capsule touch targets on coarse-pointer devices"
```

---

## Chunk 2: JavaScript — Capsule Creation + syncInfoOverlayState

### Task 6: Add `syncInfoOverlayState` module-scope variable and update `EDITORIAL_ROOT_CLASSES`

**Files:**
- Modify: `src/themes/editorial/layout.js:708-714` (root classes)
- Modify: `src/themes/editorial/layout.js:1861-1866` (module-scope walkthrough vars)

- [ ] **Step 1: Add `syncInfoOverlayState` declaration at module scope**

Find the walkthrough module-level variables (around line 1863):
```js
let wtStopDots = null;
let wtTitleEl = null;
let wtMobileControls = null;
let wtTotalStops = 0;
```

Add **before** this block:
```js
let syncInfoOverlayState = null; // late-bound: assigned inside setup() capsule creation, called from module-level createInfoOverlay()
```

**Why module scope (not next to `syncMobileView`)?** `syncMobileView` is function-scoped inside `setup()` and only called by `setMaterialView()` — also inside `setup()`. But `syncInfoOverlayState` is called from `createInfoOverlay()`'s close button handler, and `createInfoOverlay()` is a **module-level** function that cannot access `setup()`-scoped variables. The variable is reassigned each time `setup()` runs (capsule creation block).

- [ ] **Step 2: Add `'editorial-anno-strip'` to `EDITORIAL_ROOT_CLASSES`**

Find (line 708-714):
```js
const EDITORIAL_ROOT_CLASSES = [
    'editorial-spine',
    'editorial-title-block',
    'editorial-bottom-ribbon',
    'editorial-mobile-pill',
    'editorial-info-overlay'
];
```

Replace with:
```js
const EDITORIAL_ROOT_CLASSES = [
    'editorial-spine',
    'editorial-title-block',
    'editorial-bottom-ribbon',
    'editorial-mobile-pill',
    'editorial-info-overlay',
    'editorial-anno-strip'
];
```

- [ ] **Step 2b: Reset `syncInfoOverlayState` in `cleanup()`**

Since `syncInfoOverlayState` is now module-scoped (unlike function-scoped `syncMobileView`), it persists across `setup()` calls and must be explicitly reset in `cleanup()`.

Find (line 716-726):
```js
    // Reset walkthrough module state
    wtStopDots = null;
    wtTitleEl = null;
    if (wtMobileControls) { wtMobileControls.remove(); wtMobileControls = null; }
    wtTotalStops = 0;
```

Add after `wtTotalStops = 0;`:
```js
    syncInfoOverlayState = null;
```

- [ ] **Step 3: Run build to verify**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/themes/editorial/layout.js
git commit -m "feat(editorial): add syncInfoOverlayState + anno-strip to root classes"
```

---

### Task 7: Replace mobile pill creation with floating capsule

**Files:**
- Modify: `src/themes/editorial/layout.js:1523-1641` (pill creation block)

- [ ] **Step 1: Replace the entire mobile pill creation block**

Find the block from line 1523 (`// --- 4b. Floating Pill`) through line 1641 (`const mobileNav = mobilePill;`). Replace with:

```js
// --- 4b. Floating Capsule (replaces mobile nav at <700px) ---
const mobilePill = document.createElement('div');
mobilePill.className = 'editorial-mobile-pill';

const createCapsuleBtn = (iconSvg, label, extraClass) => {
    const btn = document.createElement('button');
    btn.className = 'editorial-capsule-btn' + (extraClass ? ' ' + extraClass : '');
    btn.innerHTML = iconSvg + '<span>' + label + '</span>';
    return btn;
};

const createSep = () => {
    const sep = document.createElement('div');
    sep.className = 'editorial-capsule-sep';
    return sep;
};

// --- Tool buttons (texture + material views) — only when mesh is present ---
const hasMeshContent = contentInfo && contentInfo.hasMesh;
if (hasMeshContent) {
    // Texture toggle button
    barTexBtn = createCapsuleBtn(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
        'Tex'
    );
    barTexBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        texturesVisible = !texturesVisible;
        updateModelTextures(modelGroup, texturesVisible);
        barTexBtn.classList.toggle('off', !texturesVisible);
        textureToggle.classList.toggle('off', !texturesVisible);
    });
    mobilePill.appendChild(barTexBtn);

    // Matcap button
    const capsuleMatBtn = createCapsuleBtn(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
        'Mat'
    );
    // Normals button
    const capsuleNrmBtn = createCapsuleBtn(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
        'Nrm'
    );
    // Wireframe button
    const capsuleWireBtn = createCapsuleBtn(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l10 6v8l-10 6L2 16V8z"/></svg>',
        'Wire'
    );

    capsuleMatBtn.addEventListener('click', (e) => { e.stopPropagation(); setMaterialView('matcap:clay'); });
    capsuleNrmBtn.addEventListener('click', (e) => { e.stopPropagation(); setMaterialView('normals'); });
    capsuleWireBtn.addEventListener('click', (e) => { e.stopPropagation(); setMaterialView('wireframe'); });

    syncMobileView = (view) => {
        capsuleMatBtn.classList.toggle('active', view === 'matcap:clay');
        capsuleNrmBtn.classList.toggle('active', view === 'normals');
        capsuleWireBtn.classList.toggle('active', view === 'wireframe');
    };

    mobilePill.appendChild(capsuleMatBtn);
    mobilePill.appendChild(capsuleNrmBtn);
    mobilePill.appendChild(capsuleWireBtn);
    mobilePill.appendChild(createSep());
}

// --- Info button (always shown) ---
const capsuleInfoBtn = createCapsuleBtn(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    'Info'
);
capsuleInfoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const overlay = document.querySelector('.editorial-info-overlay');
    if (!overlay) return;
    const isOpen = overlay.classList.toggle('mobile-open');
    capsuleInfoBtn.classList.toggle('active', isOpen);
});

syncInfoOverlayState = (isOpen) => {
    capsuleInfoBtn.classList.toggle('active', isOpen);
};

mobilePill.appendChild(capsuleInfoBtn);

// --- Annotation button + strip (only when annotations exist) ---
let annoStrip = null;
let annoStripTimeout = null;
let capsuleAnnoIndex = 0;

if (annotations.length > 0) {
    mobilePill.appendChild(createSep());

    const capsuleAnnoBtn = createCapsuleBtn(
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        'Anno'
    );
    capsuleAnnoBtn.style.position = 'relative';

    // Badge
    const annoBadge = document.createElement('span');
    annoBadge.className = 'editorial-capsule-badge';
    annoBadge.textContent = String(annotations.length);
    capsuleAnnoBtn.appendChild(annoBadge);

    // Annotation strip
    annoStrip = document.createElement('div');
    annoStrip.className = 'editorial-anno-strip';
    annoStrip.style.display = 'none';

    const stripPrev = document.createElement('button');
    stripPrev.className = 'editorial-anno-strip-btn';
    stripPrev.innerHTML = '&#9664;';

    const stripCounter = document.createElement('span');
    stripCounter.className = 'editorial-anno-strip-counter';

    const stripLabel = document.createElement('span');
    stripLabel.className = 'editorial-anno-strip-label';

    const stripNext = document.createElement('button');
    stripNext.className = 'editorial-anno-strip-btn';
    stripNext.innerHTML = '&#9654;';

    const updateStripUI = () => {
        const anno = annotations[capsuleAnnoIndex];
        stripCounter.textContent = (capsuleAnnoIndex + 1) + '/' + annotations.length;
        stripLabel.textContent = anno ? (anno.title || anno.label || '') : '';
    };

    const navigateAnno = (index) => {
        capsuleAnnoIndex = ((index % annotations.length) + annotations.length) % annotations.length;
        updateStripUI();
        const anno = annotations[capsuleAnnoIndex];
        if (anno && anno.id) {
            // Trigger annotation selection via the existing system
            const marker = document.querySelector('.annotation-marker[data-annotation-id="' + anno.id + '"]');
            if (marker) marker.click();
        }
        // Reset auto-hide timer
        clearTimeout(annoStripTimeout);
        annoStripTimeout = setTimeout(() => {
            if (annoStrip) {
                annoStrip.classList.add('fade-out');
                setTimeout(() => { if (annoStrip) annoStrip.style.display = 'none'; annoStrip.classList.remove('fade-out'); }, 200);
            }
        }, 5000);
    };

    stripPrev.addEventListener('click', (e) => { e.stopPropagation(); navigateAnno(capsuleAnnoIndex - 1); });
    stripNext.addEventListener('click', (e) => { e.stopPropagation(); navigateAnno(capsuleAnnoIndex + 1); });

    annoStrip.appendChild(stripPrev);
    annoStrip.appendChild(stripCounter);
    annoStrip.appendChild(stripLabel);
    annoStrip.appendChild(stripNext);

    capsuleAnnoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (annoStrip.style.display === 'none') {
            annoStrip.style.display = 'flex';
            annoStrip.classList.remove('fade-out');
            updateStripUI();
            navigateAnno(capsuleAnnoIndex);
        } else {
            clearTimeout(annoStripTimeout);
            annoStrip.classList.add('fade-out');
            setTimeout(() => { annoStrip.style.display = 'none'; annoStrip.classList.remove('fade-out'); }, 200);
        }
    });

    mobilePill.appendChild(capsuleAnnoBtn);
    viewerContainer.appendChild(annoStrip);
}

// --- More button (kebab ⋮) ---
const moreWrapper = document.createElement('div');
moreWrapper.style.cssText = 'position:relative;display:flex;';

const capsuleMoreBtn = createCapsuleBtn(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="17" r="1"/></svg>',
    ''
);
capsuleMoreBtn.title = 'More';

const morePopover = document.createElement('div');
morePopover.className = 'editorial-capsule-popover';

// Note: Share is listed in the spec's More menu but editorial layout.js has no
// share dialog in its deps interface. Share can be added later when a share
// module is wired into the editorial theme deps. For now, only Fullscreen + Quality.

// Fullscreen item
const fsItem = document.createElement('button');
fsItem.className = 'editorial-capsule-popover-item';
fsItem.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
fsItem.addEventListener('click', (e) => {
    e.stopPropagation();
    morePopover.classList.remove('open');
    if (document.fullscreenElement) {
        document.exitFullscreen();
        fsItem.textContent = 'Fullscreen';
    } else {
        document.documentElement.requestFullscreen();
        fsItem.textContent = 'Exit Fullscreen';
    }
});
morePopover.appendChild(fsItem);

// Quality toggle item (uses deps.qualityResolved + deps.switchQualityTier — same pattern as ribbon)
if (deps.switchQualityTier) {
    let currentTier = deps.qualityResolved || 'sd';
    const qualItem = document.createElement('button');
    qualItem.className = 'editorial-capsule-popover-item';
    qualItem.textContent = 'Quality: ' + currentTier.toUpperCase();
    qualItem.addEventListener('click', (e) => {
        e.stopPropagation();
        currentTier = currentTier === 'sd' ? 'hd' : 'sd';
        deps.switchQualityTier(currentTier);
        qualItem.textContent = 'Quality: ' + currentTier.toUpperCase();
    });
    morePopover.appendChild(qualItem);
}

capsuleMoreBtn.addEventListener('click', (e) => { e.stopPropagation(); morePopover.classList.toggle('open'); });
document.addEventListener('click', () => morePopover.classList.remove('open'));

moreWrapper.appendChild(capsuleMoreBtn);
moreWrapper.appendChild(morePopover);
mobilePill.appendChild(moreWrapper);

viewerContainer.appendChild(mobilePill);

// Keep legacy reference — walkthrough uses querySelector('.editorial-mobile-pill') not this var,
// but other downstream code between here and section 5 may reference mobileNav.
const mobileNav = mobilePill; // eslint-disable-line no-unused-vars
```

- [ ] **Step 2: Run build to verify**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/themes/editorial/layout.js
git commit -m "feat(editorial): replace mobile pill with floating capsule toolbar"
```

---

### Task 8: Update `createInfoOverlay()` close button to use `syncInfoOverlayState`

**Files:**
- Modify: `src/themes/editorial/layout.js:235-238` (close button handler)

- [ ] **Step 1: Update the close button handler**

Find (line 235-238):
```js
closeBtn.addEventListener('click', () => {
    overlay.classList.remove('open');
    const detailsBtn = document.querySelector('.editorial-details-link');
    if (detailsBtn) detailsBtn.classList.remove('active');
});
```

Replace with:
```js
closeBtn.addEventListener('click', () => {
    overlay.classList.remove('open');
    overlay.classList.remove('mobile-open');
    const detailsBtn = document.querySelector('.editorial-details-link');
    if (detailsBtn) detailsBtn.classList.remove('active');
    if (syncInfoOverlayState) syncInfoOverlayState(false);
});
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/themes/editorial/layout.js
git commit -m "feat(editorial): sync capsule Info button on overlay close"
```

---

### Task 9: Update `onKeyboardShortcut()` to use `syncInfoOverlayState`

**Files:**
- Modify: `src/themes/editorial/layout.js:1839-1858` (keyboard handler)

- [ ] **Step 1: Update the 'm' key and 'escape' handlers**

Find (lines 1839-1858):
```js
function onKeyboardShortcut(key) {
    if (key === 'm') {
        const panel = document.querySelector('.editorial-info-overlay');
        const btn = document.querySelector('.editorial-details-link');
        if (panel) {
            const isOpen = panel.classList.toggle('open');
            if (btn) btn.classList.toggle('active', isOpen);
        }
        return true;
    }
    if (key === 'escape') {
        const panel = document.querySelector('.editorial-info-overlay');
        const btn = document.querySelector('.editorial-details-link');
        if (panel && panel.classList.contains('open')) {
            panel.classList.remove('open');
            if (btn) btn.classList.remove('active');
            return true;
        }
    }
    return false;
}
```

Replace with:
```js
function onKeyboardShortcut(key) {
    if (key === 'm') {
        const panel = document.querySelector('.editorial-info-overlay');
        const btn = document.querySelector('.editorial-details-link');
        if (panel) {
            // Toggle both desktop and mobile open states
            const isMobileOpen = panel.classList.contains('mobile-open');
            const isDesktopOpen = panel.classList.contains('open');
            if (isMobileOpen) {
                panel.classList.remove('mobile-open');
                if (syncInfoOverlayState) syncInfoOverlayState(false);
            } else if (isDesktopOpen) {
                panel.classList.remove('open');
                if (btn) btn.classList.remove('active');
            } else {
                // Open — detect if mobile tier
                const isMobile = window.matchMedia('(max-width: 699px)').matches;
                if (isMobile) {
                    panel.classList.add('mobile-open');
                    if (syncInfoOverlayState) syncInfoOverlayState(true);
                } else {
                    panel.classList.add('open');
                    if (btn) btn.classList.add('active');
                }
            }
        }
        return true;
    }
    if (key === 'escape') {
        const panel = document.querySelector('.editorial-info-overlay');
        if (panel && panel.classList.contains('mobile-open')) {
            panel.classList.remove('mobile-open');
            if (syncInfoOverlayState) syncInfoOverlayState(false);
            return true;
        }
        if (panel && panel.classList.contains('open')) {
            panel.classList.remove('open');
            const btn = document.querySelector('.editorial-details-link');
            if (btn) btn.classList.remove('active');
            return true;
        }
    }
    return false;
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/themes/editorial/layout.js
git commit -m "feat(editorial): keyboard shortcuts sync capsule info state on mobile"
```

---

## Chunk 3: Mobile Info Overlay Content + Verification

### Task 10: Create mobile info overlay content builder

**Files:**
- Modify: `src/themes/editorial/layout.js` (after capsule creation, around the overlay wiring at line ~1644)

- [ ] **Step 1: Add mobile info overlay content creation after the overlay is appended**

Find (around line 1644-1645):
```js
// --- 5. Info Panel (side panel) ---
const overlay = createInfoOverlay(manifest, deps);
viewerContainer.appendChild(overlay);
```

Add after `viewerContainer.appendChild(overlay);`:
```js
// --- Mobile info overlay: curated content for mobile tier ---
// Build curated mobile content inside the existing overlay element.
// On mobile, the .mobile-open class shows this content; on desktop, .open shows the full panel.
const mobileInfoContent = document.createElement('div');
mobileInfoContent.className = 'editorial-mobile-info-content';
// Hidden by default via CSS (.editorial-mobile-info-content { display: none; })
// Shown when parent has .mobile-open class — do NOT use inline style.display here
// because inline styles defeat CSS !important rules.

const mobileCloseBtn = document.createElement('button');
mobileCloseBtn.className = 'editorial-mobile-info-close';
mobileCloseBtn.innerHTML = '&times;';
mobileCloseBtn.addEventListener('click', () => {
    overlay.classList.remove('mobile-open');
    if (syncInfoOverlayState) syncInfoOverlayState(false);
});

// Title
const title = manifest?.title || manifest?.project?.title || 'Untitled';
const mobileTitle = document.createElement('div');
mobileTitle.className = 'editorial-mobile-info-title';
mobileTitle.textContent = title;

const mobileRule = document.createElement('div');
mobileRule.className = 'editorial-mobile-info-rule';

// Close button appended directly to overlay (not mobileInfoContent) so position:sticky
// works reliably — it needs to be a direct child of the scroll container (overlay).
mobileInfoContent.appendChild(mobileTitle);
mobileInfoContent.appendChild(mobileRule);

// Description
const desc = manifest?.description || manifest?.project?.description || '';
if (desc) {
    const mobileDesc = document.createElement('div');
    mobileDesc.className = 'editorial-mobile-info-desc';
    mobileDesc.textContent = desc.replace(/<[^>]+>/g, '').substring(0, 300);
    mobileInfoContent.appendChild(mobileDesc);

    const divider = document.createElement('div');
    divider.className = 'editorial-mobile-info-divider';
    mobileInfoContent.appendChild(divider);
}

// Detail rows: Creator, Date, Location
const detailFields = [
    ['Creator', manifest?.creator || manifest?.project?.creator || ''],
    ['Date', manifest?.date || manifest?.project?.date || ''],
    ['Location', manifest?.coverage || manifest?.project?.coverage || '']
];
detailFields.forEach(([label, value]) => {
    if (!value) return;
    const row = document.createElement('div');
    row.className = 'editorial-mobile-info-row';
    row.innerHTML = '<span class="editorial-mobile-info-label">' + escapeHtml(label) + '</span><span class="editorial-mobile-info-value">' + escapeHtml(String(value)) + '</span>';
    mobileInfoContent.appendChild(row);
});

// Stats grid
const statsGrid = document.createElement('div');
statsGrid.className = 'editorial-mobile-info-stats';
const fmt = (n) => n >= 1000000 ? (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n);

if (modelGroup && modelGroup.children.length > 0) {
    let vertexCount = 0;
    modelGroup.traverse(child => {
        if (child.isMesh && child.geometry && child.geometry.attributes.position) {
            vertexCount += child.geometry.attributes.position.count;
        }
    });
    if (vertexCount > 0) {
        const vertStat = document.createElement('div');
        vertStat.className = 'editorial-mobile-info-stat';
        vertStat.innerHTML = '<div class="editorial-mobile-info-stat-num">' + fmt(vertexCount) + '</div><div class="editorial-mobile-info-stat-label">Vertices</div>';
        statsGrid.appendChild(vertStat);
    }
}

// Gaussian count from manifest
const gaussianCount = manifest?.splat_count || manifest?.project?.splat_count || 0;
if (gaussianCount > 0) {
    const gaussStat = document.createElement('div');
    gaussStat.className = 'editorial-mobile-info-stat';
    gaussStat.innerHTML = '<div class="editorial-mobile-info-stat-num">' + fmt(gaussianCount) + '</div><div class="editorial-mobile-info-stat-label">Gaussians</div>';
    statsGrid.appendChild(gaussStat);
}

if (statsGrid.children.length > 0) {
    mobileInfoContent.appendChild(statsGrid);
}

// Close button is a direct child of overlay (the scroll container) for sticky positioning
overlay.appendChild(mobileCloseBtn);
overlay.appendChild(mobileInfoContent);
```

- [ ] **Step 2: Add CSS rule to show mobile content only during mobile-open**

In `layout.css`, inside the `@media (max-width: 699px)` block, add:
```css
body.kiosk-mode.kiosk-editorial .editorial-info-overlay.mobile-open .editorial-mobile-info-content {
    display: block !important;
}

body.kiosk-mode.kiosk-editorial .editorial-info-overlay.mobile-open .editorial-panel-inner {
    display: none !important;
}
```

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/themes/editorial/layout.js src/themes/editorial/layout.css
git commit -m "feat(editorial): add curated mobile info overlay content"
```

---

### Task 11: Visual verification

- [ ] **Step 1: Run dev server**

Run: `npm run dev`
Open `http://localhost:8080/?kiosk=true&theme=editorial&url=<test-archive>` in Chrome DevTools mobile emulation (375×812, iPhone 14 Pro).

- [ ] **Step 2: Verify default state**

Expected:
- 3D viewport fills screen
- Floating capsule centered at bottom with frosted glass
- Title block visible at top-left
- No drawer, no bottom bar

- [ ] **Step 3: Verify material buttons (with mesh archive)**

Expected:
- Tex/Mat/Nrm/Wire buttons visible when mesh is loaded
- Tapping Mat highlights it gold, applies matcap
- Tapping Mat again returns to default
- Tapping Wire while Mat is active: Mat deactivates, Wire activates

- [ ] **Step 4: Verify Info overlay**

Expected:
- Tapping Info shows full-viewport overlay at 82% opacity
- 3D object visible as silhouette through overlay
- Title, description, creator, date, stats visible
- × close button works; Info button deactivates
- Pressing 'm' key toggles overlay (with keyboard attached)

- [ ] **Step 5: Verify annotation strip (with annotated archive)**

Expected:
- Anno button shows badge count
- Tapping Anno shows strip above capsule: ◀ 1/5 "Title" ▶
- Arrows navigate; camera flies to annotation
- Strip auto-hides after 5s

- [ ] **Step 6: Verify landscape mode**

Rotate to landscape in DevTools:
- Title block hidden
- Capsule icons only (no labels)
- Anno strip positioned correctly

- [ ] **Step 7: Verify desktop is unchanged**

Open at 1200px width:
- Full editorial layout unchanged (ribbon, spine, info panel)
- No capsule visible

- [ ] **Step 8: Run full build and lint**

Run: `npm run build && npm run lint`
Expected: 0 errors.

- [ ] **Step 9: Commit any final fixes**

```bash
git add -A
git commit -m "fix(editorial): polish mobile capsule after visual verification"
```

---

## Summary

| Chunk | Tasks | Focus |
|-------|-------|-------|
| 1 | Tasks 1-5 | CSS: capsule base, info overlay, anno strip, landscape, touch targets, safe areas |
| 2 | Tasks 6-9 | JS: module scope vars, capsule creation, syncInfoOverlayState, keyboard shortcuts |
| 3 | Tasks 10-11 | JS: mobile info content, visual verification |
