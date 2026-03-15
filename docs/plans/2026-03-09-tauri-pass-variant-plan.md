# Tauri PASS Viewer Variant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Direct Dimensions PASS Viewer" Tauri build variant that ships as a separate branded Windows installer alongside the existing editorial Vitrine3D installer in the same GitHub release.

**Architecture:** A small Tauri v2 config override file (`tauri.pass.conf.json`) deep-merges on top of the base `tauri.conf.json` to change only the product name, identifier, and window URL (theme). The CI workflow gains a fourth matrix entry for this variant, passing `--config` to the Tauri action. The Vite frontend build is shared — theme selection is runtime via URL param.

**Tech Stack:** Tauri v2 (`--config` merge), GitHub Actions matrix, NSIS Windows installer

---

### Task 1: Create the PASS Viewer Tauri config override

**Files:**
- Create: `src-tauri/tauri.pass.conf.json`

**Step 1: Create the file**

Create `src-tauri/tauri.pass.conf.json` with this exact content:

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

**Why the full `app.windows` array:** Tauri v2 replaces arrays (does not merge them). If you only specify `url`, the other window properties (width, height, etc.) would be lost. The values here match the base config exactly, with only `title` and `url` changed.

**Why `build` is repeated:** The `devUrl` must point to `?theme=industrial` so that `npx tauri dev --config ./src-tauri/tauri.pass.conf.json` opens the correct theme locally. The other `build` fields are carried forward to avoid losing them on merge.

**Step 2: Verify the config parses**

Run:
```bash
npx tauri info
```
Expected: no errors. This doesn't validate the override file directly, but confirms the toolchain is operational.

**Step 3: Smoke-test local dev (optional but recommended)**

```bash
npm run dev
```
Then in a second terminal:
```bash
npx tauri dev --config ./src-tauri/tauri.pass.conf.json
```
Expected: Tauri window opens with the industrial theme (MeshLab-style toolbar visible).

**Step 4: Commit**

```bash
git add src-tauri/tauri.pass.conf.json
git commit -m "feat(tauri): add PASS Viewer config override for industrial variant"
```

---

### Task 2: Update CI workflow to build both variants

**Files:**
- Modify: `.github/workflows/tauri-build.yml`

**Context:** The existing `build` job has a `matrix.include` with three entries (ubuntu, windows, macos). We need to:
1. Add `variant`, `config_args`, and `release_name` fields to all three existing entries
2. Add a fourth entry for the PASS Windows build
3. Update the `Build Tauri app` step to use `args: ${{ matrix.config_args }}` and `releaseName: '${{ matrix.release_name }} ...'`

**Step 1: Update the matrix**

In `.github/workflows/tauri-build.yml`, replace the `strategy` block of the `build` job:

Old:
```yaml
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: ubuntu-22.04
            target: linux
          - platform: windows-latest
            target: windows
          - platform: macos-latest
            target: macos
```

New:
```yaml
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: ubuntu-22.04
            target: linux
            variant: editorial
            config_args: ""
            release_name: "Vitrine3D"
          - platform: windows-latest
            target: windows
            variant: editorial
            config_args: ""
            release_name: "Vitrine3D"
          - platform: macos-latest
            target: macos
            variant: editorial
            config_args: ""
            release_name: "Vitrine3D"
          - platform: windows-latest
            target: windows
            variant: pass
            config_args: "--config ./src-tauri/tauri.pass.conf.json"
            release_name: "Direct Dimensions PASS Viewer"
```

**Step 2: Update the Build Tauri app step**

Find the `Build Tauri app` step (uses `tauri-apps/tauri-action@v0`) and update its `with:` block:

Old:
```yaml
        with:
          tagName: ${{ steps.release_tag.outputs.tag }}
          releaseName: 'Vitrine3D ${{ steps.release_tag.outputs.tag }}'
          releaseBody: 'Desktop release for Windows, Linux, and macOS.'
          releaseDraft: true
          prerelease: false
```

New:
```yaml
        with:
          tagName: ${{ steps.release_tag.outputs.tag }}
          releaseName: '${{ matrix.release_name }} ${{ steps.release_tag.outputs.tag }}'
          releaseBody: 'Desktop release for Windows, Linux, and macOS.'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.config_args }}
```

**Why `args` works with empty string:** When `matrix.config_args` is `""`, `tauri-action` passes no additional args — identical to the current behaviour for editorial builds.

**Step 3: Verify YAML is valid**

```bash
npx js-yaml .github/workflows/tauri-build.yml > /dev/null && echo "YAML valid"
```
Expected: `YAML valid`

If `js-yaml` is not installed: `npm install -g js-yaml` or just eyeball the indentation carefully.

**Step 4: Commit**

```bash
git add .github/workflows/tauri-build.yml
git commit -m "feat(ci): add PASS Viewer Windows build variant to tauri matrix"
```

---

### Task 3: Add convenience npm scripts

**Files:**
- Modify: `package.json`

**Step 1: Add the scripts**

In `package.json`, locate the `"scripts"` object and add two entries alongside the existing tauri-related scripts:

```json
"tauri:dev:pass": "npx tauri dev --config ./src-tauri/tauri.pass.conf.json",
"tauri:build:pass": "npx tauri build --config ./src-tauri/tauri.pass.conf.json"
```

**Step 2: Verify scripts parse**

```bash
node -e "require('./package.json')" && echo "package.json valid"
```
Expected: `package.json valid`

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add npm scripts for PASS Viewer tauri dev/build"
```

---

## Post-Implementation Verification

After all three tasks, trigger a manual workflow run to confirm both variants build:

1. Go to GitHub → Actions → "Build Tauri App"
2. Click "Run workflow" (workflow_dispatch trigger)
3. Confirm 4 jobs appear: ubuntu/editorial, windows/editorial, macos/editorial, windows/pass
4. Confirm the release draft contains both Windows installers with distinct filenames:
   - `Vitrine3D_x.x.x_x64-setup.exe`
   - `Direct Dimensions PASS Viewer_x.x.x_x64-setup.exe`

## Future Extensions

- **Add more platforms to PASS:** Add ubuntu/pass and macos/pass matrix entries with same `config_args` — no other changes needed
- **Add distinct PASS icons:** Add `"bundle": { "icon": [...] }` to `tauri.pass.conf.json` pointing to a separate icon set in `src-tauri/icons/pass/`
- **Additional variants:** Create another override file (e.g., `tauri.gallery.conf.json`) and add a matrix entry
