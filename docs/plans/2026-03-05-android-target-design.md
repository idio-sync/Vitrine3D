# Android Target for Tauri + GitHub Actions CI

**Date:** 2026-03-05
**Status:** Approved
**Approach:** Manual Gradle build in GitHub Actions (no tauri-action for Android)

## Summary

Enable Android as a Tauri build target. Produce unsigned APKs via GitHub Actions CI, added as an extra job to the existing `tauri-build.yml`. The Android app runs kiosk mode only (client viewer), defaults to SD quality for mobile GPU performance, and supports URL deep linking for archive loading.

## Requirements

- Client-facing kiosk viewer only (no editor)
- URL deep links to open archives (`https://site.com/view?archive=...`)
- Option to bundle archives for offline use (follow-up)
- Unsigned APKs for now (signing added later)
- Single workflow — Android job added alongside desktop builds
- Default to SD quality tier on Android

## Architecture

### Local scaffold

Run `tauri android init` to generate `src-tauri/gen/android/` (Gradle project, AndroidManifest.xml, Kotlin activity). Committed to the repo.

Config:
- Min SDK 24 (Android 7.0 — 95%+ device coverage, WebView WASM support)
- Target SDK 34
- No Rust code changes needed — `lib.rs` already has `#[cfg_attr(mobile, tauri::mobile_entry_point)]` and `"cdylib"` crate type

### GitHub Actions: Android job

Added to `tauri-build.yml` matrix. Runs on `ubuntu-latest`:

1. Checkout
2. Setup Java 17 (`actions/setup-java@v4`, temurin distribution)
3. Setup Android SDK (`android-actions/setup-android@v3`)
4. Install NDK via `sdkmanager` (latest LTS)
5. Setup Node 20 + `npm install`
6. Install Rust stable + Android targets (`aarch64-linux-android`, `armv7-linux-androideabi`)
7. Rust cache (`swatinem/rust-cache@v2`)
8. Set `ANDROID_HOME`, `NDK_HOME` environment variables
9. `npx tauri android build --apk --target aarch64 --target armv7`
10. Upload APK to GitHub release via `softprops/action-gh-release`

Build targets: **aarch64 + armv7** only (99%+ device coverage, skips x86 emulator targets).

### SD quality default on Android

Detect Android platform in `quality-tier.ts` or `kiosk-main.ts` and force SD quality tier as the default. Detection via Tauri's `navigator.userAgent` (Android WebView) or `window.__TAURI__` platform API. This reduces the Spark.js LOD splat budget to 500K (vs 1.5M for HD), appropriate for mobile GPUs.

### Deep linking

Register an Android intent filter so archive URLs open the app. Configured via `tauri.conf.json` `app.deepLink` or directly in the generated `AndroidManifest.xml`. The kiosk entry point already reads `archive` URL params — no JS changes needed for basic deep link support.

### Bundled archives (follow-up)

For offline delivery, archives placed in `src-tauri/gen/android/app/src/main/assets/` and loaded as a fallback when no URL param is provided. This requires a small JS addition to detect and load bundled assets. Not part of the initial CI setup.

## What does NOT change

- No editor on Android — kiosk entry point only
- No Rust code changes — IPC file commands work on Android
- No APK signing — added later via keystore GitHub secrets
- Desktop builds unaffected — Android is an additive job

## Known follow-ups (runtime concerns)

### Touch input
`fly-controls.ts` uses mouse-look with pointer lock — non-functional on Android. Fly mode toggle should be hidden on mobile, or a touch-based alternative built. OrbitControls works with touch natively.

### Theme responsiveness
The 5 themes were designed for desktop viewports. Annotation popups, sidebar panels, and the golden-ratio layout may need responsive adjustments for phone/tablet screens (especially the `editorial` theme at 360px width).

### Android back button
Hardware back closes the app by default. A handler could be added to close popups/panels before exiting. Not critical for v1.

### APK size
Spark.js vendor (~5MB) + Rust binary (~10-15MB for two architectures) = ~20-30MB APK.

### WebView fragmentation
Min SDK 24 covers 95%+ but oldest devices may have WebGL2/WASM quirks. SDK 26 (Android 8) would be safer if Android 7 support isn't needed.

### Memory limits
Android WebView has a lower memory ceiling than desktop. The SD quality default mitigates this. Large point clouds (E57) remain a risk — existing lack of size limits applies.
