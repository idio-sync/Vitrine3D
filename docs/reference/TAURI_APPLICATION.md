# Tauri Desktop Application

The 3D Archive Viewer can be built as a native desktop application using [Tauri v2](https://v2.tauri.app/). The desktop app defaults to **kiosk mode with the editorial theme**, providing a polished viewer experience. The web app (`npm start`) remains the full editor.

## Prerequisites

- **Rust toolchain**: Install via [rustup.rs](https://rustup.rs/) or `winget install Rustlang.Rustup`
- **Tauri CLI**: `cargo install tauri-cli --version "^2"`
- **Node.js 20+**

> **Note (Windows/Google Drive):** The npm package `@tauri-apps/cli` may fail to install on Google Drive due to symlink limitations. Use `cargo install tauri-cli` instead.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (unchanged, full editor mode) |
| `cargo tauri dev` | Launch native window loading from dev server |
| `cargo tauri build` | Production build with bundled dependencies |
| `npm run vendor` | Download CDN deps to `dist/` for offline use |
| `cargo tauri icon path/to/icon.png` | Generate all icon sizes from a source image |
| `npm run branded` | GUI tool to build branded executables with bundled archives |

## How It Works

### Dev Mode (`cargo tauri dev`)

1. Runs `npm run dev` — Vite dev server on port 8080 (the `beforeDevCommand`)
2. Compiles the Rust backend
3. Opens a native window pointing to `http://localhost:8080/?kiosk=true&theme=editorial`
4. Frontend loads dependencies from `node_modules/` via Vite (same as `npm run dev`)
5. File watcher auto-rebuilds on Rust/config changes

### Production Build (`cargo tauri build`)

1. Runs `npm run build` — Vite production build to `dist/` (the `beforeBuildCommand`)
   - Bundles all dependencies from `node_modules/` via Vite/Rollup
   - Compiles TypeScript, tree-shakes, and minifies
   - Copies runtime assets (themes, WASM files, Draco decoders)
2. Compiles the Rust backend in release mode
3. Bundles `dist/` into the executable as the frontend
4. Produces installers in `src-tauri/target/release/bundle/`

### Native File Dialogs

When running inside Tauri, the app detects `window.__TAURI__` and replaces HTML file inputs with native OS dialogs. This is handled by `src/modules/tauri-bridge.ts`, which is lazy-imported in `main.ts` only when Tauri is detected. All 9 file inputs and 4 download points use native dialogs in the desktop app, with browser fallbacks for the web version.

## Project Structure

```
src-tauri/
  tauri.conf.json          Tauri configuration (window, CSP, build commands)
  Cargo.toml               Rust dependencies
  src/
    main.rs                Entry point
    lib.rs                 Plugin registration (dialog, fs, shell)
  build.rs                 Tauri build hook
  capabilities/
    main-window.json       Permissions for dialog, fs, shell APIs
  icons/                   App icons (generated via `cargo tauri icon`)

scripts/
  vendor-deps.mjs          CDN dependency vendoring for offline builds

src/modules/
  tauri-bridge.ts          Native dialog bridge (feature-detected)
  tauri-auth.ts            Cloudflare Access JWT storage for library API auth
```

## CI/CD

`.github/workflows/tauri-build.yml` builds for all three platforms:

- **Windows**: `.msi` and `.exe` installers
- **Linux**: `.deb` and `.AppImage`
- **macOS**: `.dmg` and `.app`

Triggered by pushing a version tag (`v*`) or manual workflow dispatch. Uses `tauri-apps/tauri-action@v0` with Rust caching.

## Configuration Notes

### CSP (Content Security Policy)

Tauri manages CSP via `tauri.conf.json`. Key requirements:
- `'unsafe-eval'` in `script-src` — required for Spark.js WASM
- `dangerousDisableAssetCspModification: ["script-src"]` — prevents Tauri from stripping `unsafe-eval`
- `blob:` in connect-src and worker-src — required for asset loading

### Plugin Configuration

In Tauri v2, plugin permissions are managed through **capabilities** (`src-tauri/capabilities/`), not through the `plugins` section in `tauri.conf.json`. The `plugins` section should remain `{}`.

## Future Work

### File Association

Register `.a3d` and `.a3z` file extensions with the desktop app so users can:
- **Double-click** an archive file to open it directly in the viewer
- **Drag & drop** an archive onto the executable
- **Open from command line**: `3d-archive-viewer.exe scene.a3z`

This would use Tauri's `bundle.fileAssociations` config and a Rust-side handler to pass the file path to the frontend. A single executable handles any archive — no per-file rebuilds needed.

### Branded Per-Client Executables

Build branded executables with a bundled archive using the GUI builder:

```bash
npm run branded
```

This opens native file/text dialogs to collect:
1. **Archive** — the `.a3d`/`.a3z` file to bundle
2. **Product name** — used as the window title and installer name
3. **Icon** (optional) — a `.png` to replace the default app icon

The script then automates the full pipeline: patches `tauri.conf.json`, vendors dependencies, copies the archive into `dist/`, builds the Tauri app, and restores the original config.

CLI mode (skips GUI dialogs):
```bash
npm run branded -- --archive path/to/scene.a3z --name "Acme Site Tour" --icon icon.png
```

Output appears in `src-tauri/target/release/bundle/` (`.msi`/`.exe` on Windows).

### Android Support

Tauri v2 Android builds are functional. The project includes `@tauri-apps/cli` with Android target support and a custom app icon. Requires Android SDK and NDK for building. Touch interactions and WebView compatibility with Spark.js WASM have been validated.
