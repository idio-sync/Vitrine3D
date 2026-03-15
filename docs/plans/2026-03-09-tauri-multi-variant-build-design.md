# Tauri Multi-Variant Build Design

**Date:** 2026-03-09
**Status:** Approved

## Problem

The Windows Tauri app currently ships as a single build with the editorial theme as the default. A second branded variant — "Direct Dimensions PASS Viewer" — is needed with the industrial theme as default, a distinct product name, and a separate app identifier. Both installers should ship in the same GitHub release.

## Chosen Approach: Tauri Config Merging (Override File)

Tauri v2 supports `--config <file>` which deep-merges the override file on top of `tauri.conf.json`. A small override file contains only the fields that differ. The base editorial config is untouched.

## Files Changed

### New: `src-tauri/tauri.pass.conf.json`

Override file for the PASS Viewer variant. Contains only the fields that differ from the base `tauri.conf.json`:

```json
{
  "productName": "Direct Dimensions PASS Viewer",
  "identifier": "com.directdimensions.passviewer",
  "app": {
    "windows": [
      {
        "title": "Direct Dimensions PASS Viewer",
        "url": "index.html?home=true&kiosk=true&theme=industrial",
        "width": 1400,
        "height": 900,
        "resizable": true,
        "fullscreen": false,
        "minWidth": 800,
        "minHeight": 600
      }
    ]
  },
  "build": {
    "beforeDevCommand": "npx vite --port 8080",
    "devUrl": "http://localhost:8080/?home=true&kiosk=true&theme=industrial",
    "beforeBuildCommand": "npx vite build",
    "frontendDist": "../dist"
  }
}
```

**Note:** `app.windows` is a full array replacement (not merged) in Tauri v2, so all window properties must be included. `build` section is repeated with `devUrl` updated so local dev opens the correct theme.

### Modified: `.github/workflows/tauri-build.yml`

Add a `variant` dimension to the `build` job matrix. The PASS entry targets `windows-latest` only. Both variants upload artifacts to the same draft release.

Matrix additions:
- `variant: editorial` added to existing three platform entries (no behavior change)
- New `variant: pass` entry: `platform: windows-latest`, `config_args: "--config ./src-tauri/tauri.pass.conf.json"`
- `releaseName` becomes `${{ matrix.release_name }}` per-row
- Build step gains `args: ${{ matrix.config_args }}`

Installer filenames in the release (Tauri uses `productName`):
- `Vitrine3D_1.0.0_x64-setup.exe`
- `Direct Dimensions PASS Viewer_1.0.0_x64-setup.exe`

### Modified: `package.json` (optional convenience scripts)

```json
"tauri:dev:pass": "npx tauri dev --config ./src-tauri/tauri.pass.conf.json",
"tauri:build:pass": "npx tauri build --config ./src-tauri/tauri.pass.conf.json"
```

## Local Development

```bash
# Editorial (unchanged)
npx tauri dev
npx tauri build

# PASS Viewer
npx tauri dev --config ./src-tauri/tauri.pass.conf.json
npx tauri build --config ./src-tauri/tauri.pass.conf.json
```

## Future Extensions

- Add Linux/macOS PASS builds: add two more matrix entries with the same `config_args`, no other changes
- Add distinct PASS icons: add `bundle.icon` to `tauri.pass.conf.json` pointing to a separate icon set
- Additional variants (e.g., gallery theme): create another override file and add a matrix entry

## Non-Goals

- Android build is not affected (single variant)
- The Vite frontend build is shared — both variants load the same `dist/` bundle; the theme is selected at runtime via URL param
