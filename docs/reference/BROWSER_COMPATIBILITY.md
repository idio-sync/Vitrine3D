# Browser Compatibility Audit

Last updated: 2026-03-11

Cross-browser compatibility findings for Vitrine3D. Covers Chrome, Firefox, Safari, and the Tauri desktop shell.

---

## Critical / Medium Issues

### 1. WebGPU Crash Risk on Firefox (Latent)

**Files:** `src/modules/scene-manager.ts`, `src/main.ts`

WebGPU is currently hard-disabled (`webgpuSupported = false`). If re-enabled without the dynamic import guard, Firefox crashes because `GPUShaderStage` is evaluated at module load time and doesn't exist in Firefox's WebGPU implementation.

Dead code paths remain in `main.ts` (`onRendererChanged` callback infrastructure) that could confuse future maintainers.

**Action:** If re-enabling WebGPU, use dynamic `import('three/webgpu')` — never a static import. Clean up dead `onRendererChanged` wiring.

### 2. occt-import-js WASM Path in Tauri

**File:** `src/modules/cad-loader.ts:27-30`

`locateFile` returns `/occt-import-js.wasm` as an absolute path. In Tauri v2, the asset URL scheme is `asset://` / `https://asset.localhost`, so this path won't resolve in the desktop app.

**Action:** Detect Tauri environment and adjust the WASM path accordingly.

---

## Low Severity Issues

### 3. CSS `:has()` Selector

**Files:** `src/kiosk.css:180`, `src/themes/editorial/layout.css`

Requires Firefox 121+ (Dec 2023). Older Firefox silently skips font-size and responsive layout rules — minor visual degradation only.

### 4. `backdrop-filter` Missing `-webkit-` Prefix in Editor

**File:** `src/styles.css` (6+ instances)

Kiosk themes correctly use both `-webkit-backdrop-filter` and `backdrop-filter`, but `styles.css` (editor UI) only uses the unprefixed form. Safari <15.4 loses blur effects on editor UI elements.

Additionally, the `@supports not (backdrop-filter)` fallback in `kiosk.css` only covers `#annotation-info-popup`, not other elements.

### 5. Clipboard API — No execCommand Fallback

**Files:** `src/modules/share-dialog.ts`, `src/modules/ui-controller.ts`, `src/modules/library-panel.ts`

`navigator.clipboard.writeText()` requires HTTPS. All call sites have try/catch but no `document.execCommand('copy')` fallback. Fails silently on plain HTTP.

Safari requires the call within a direct user gesture handler — all current call sites satisfy this.

### 6. Scrollbar Styling Inconsistency

**File:** `src/styles.css:71-73`

Base editor styles only use `::-webkit-scrollbar` pseudo-elements (Chrome/Safari). No `scrollbar-width` / `scrollbar-color` properties for Firefox. Firefox shows default system scrollbars in the editor.

Theme files (including the industrial theme) use both approaches correctly.

### 7. Screenshot Reliability

**File:** `src/modules/archive-creator.ts`

`preserveDrawingBuffer` defaults to `false` on the WebGL renderer. Screenshot capture depends on a synchronous `renderer.render()` call immediately before `canvas.toBlob()`. Any async interleaving could produce a blank screenshot. Affects all browsers.

**Action:** Consider setting `preserveDrawingBuffer: true` on the renderer, or at minimum ensure the render-to-capture path remains synchronous.

### 8. Drop Handler Missing Null Check

**File:** `src/modules/kiosk-main.ts:792`

`e.dataTransfer.files` accessed without optional chaining. Could throw `TypeError` if `dataTransfer` is null (unlikely but possible from non-file drag sources). Compare with `library-panel.ts:735` which correctly uses `e.dataTransfer?.files`.

### 9. No `pointerlockerror` Handler

**File:** `src/modules/fly-controls.ts`

If the browser denies pointer lock, the right-click-to-look behavior silently fails with no user feedback.

---

## Cosmetic / Informational

### 10. `navigator.deviceMemory` — Chrome/Edge Only

**File:** `src/modules/quality-tier.ts:13-18`

Only available in Chromium browsers. Handled correctly — absent browsers are assumed capable. No action needed.

### 11. CSP Uses `'unsafe-eval'` Instead of `'wasm-unsafe-eval'`

**Files:** `src/index.html`, `src/editor/index.html`, `docker/nginx.conf`

The more precise `'wasm-unsafe-eval'` directive (Chrome 95+, Firefox 102+, Safari 15.4+) would tighten security while still permitting WASM compilation. Current `'unsafe-eval'` is universally compatible but broader than necessary.

### 12. nginx WASM MIME Type

**File:** `docker/nginx.conf`

`application/wasm` MIME type for `.wasm` files relies on nginx defaults rather than an explicit `types {}` block. Works on nginx 1.15.6+ but isn't explicitly declared.

### 13. Deprecated `kiosk-viewer.ts` — Unguarded `crypto.subtle`

**File:** `src/modules/kiosk-viewer.ts:180`

Uses `crypto.subtle.digest()` without checking `CRYPTO_AVAILABLE`. Would throw on plain HTTP. Low risk since the module is deprecated and hidden.

---

## Things Done Right

| Area | Status |
|------|--------|
| Fullscreen API | Correctly guarded by `fullscreenEnabled` — hidden on iOS Safari |
| Spark.js WASM loading | Proper `instantiateStreaming` → `instantiate` fallback |
| `crypto.subtle` in editor | Checked via `CRYPTO_AVAILABLE` before use |
| SharedArrayBuffer | Not used — no COOP/COEP headers needed |
| CSP `worker-src` | Correctly includes `blob:` for Spark.js Blob-URL workers |
| Storage APIs | No localStorage/IndexedDB/ServiceWorker dependencies |
| `ResizeObserver` | Guarded with `typeof ResizeObserver !== 'undefined'` |
| Pointer Lock API | Unprefixed API supported in all modern browsers |
| `navigator.userAgentData` | Spark.js handles absence gracefully (falls back to UA string) |

---

## Browser Support Matrix

| Feature | Chrome | Firefox | Safari | iOS Safari | Tauri |
|---------|--------|---------|--------|------------|-------|
| WebGL rendering | Yes | Yes | Yes | Yes | Yes |
| Spark.js splats | Yes | Yes | Yes | Yes | Yes |
| CAD loading (WASM) | Yes | Yes | Yes | Yes | **Broken** (path) |
| `:has()` CSS | 105+ | 121+ | 15.4+ | 15.4+ | Yes |
| Industrial theme | Yes | Yes | Yes | Yes | Yes |
| `backdrop-filter` | Yes | Yes | 15.4+ | 15.4+ | Yes |
| Fullscreen | Yes | Yes | 16.4+ | **No** (hidden) | Varies |
| Clipboard copy | HTTPS | HTTPS | HTTPS | HTTPS | Yes |
| Fly controls | Yes | Yes | Yes | N/A | Yes |
| Screenshots | Yes* | Yes* | Yes* | Yes* | Yes* |

\* Screenshot reliability depends on synchronous render-before-capture timing.
