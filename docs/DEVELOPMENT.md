# Development Guide

## Prerequisites

- **Node.js 20+**
- **npm** (bundled with Node.js)

## Setup

```bash
git clone <repo-url>
cd Vitrine3D
npm install
```

The `postinstall` script automatically copies Draco decoder WASM files from `node_modules/` to `public/draco/`.

## Development Server

```bash
npm run dev
```

Opens at http://localhost:8080. The kiosk viewer is at `/`, the editor at `/editor/`.

Vite serves on port 8080 (strict) with hot module replacement. Two custom Vite plugins handle runtime assets:

- **`serveOcctWasm`** — serves `occt-import-js.wasm` from `node_modules/` at `/occt-import-js.wasm`
- **`copyRuntimeAssets`** — at build time, copies kiosk module sources, themes, config scripts, and raw CSS to `dist/`

## Project Structure

```
src/
  index.html              Kiosk viewer HTML
  kiosk-web.ts             Kiosk Vite entry point
  editor/index.html        Editor HTML
  main.ts                  Editor glue layer (~1,900 lines)
  config.js                URL parameter parsing (IIFE, non-module)
  pre-module.js            Pre-module error handler
  types.ts                 Shared TypeScript interfaces
  styles.css               All styling
  kiosk.css                Kiosk-specific styles
  modules/                 57 TypeScript modules
  themes/                  Kiosk theme packages
  vendor/                  Vendored dependencies (Spark.js 2.0 preview)

docker/                    Dockerfile, nginx config, meta-server, admin panel
docs/                      Documentation
public/                    Static assets (Draco WASM decoders)
```

## Build

```bash
npm run build       # Vite production build to dist/
npm run preview     # Preview production build locally
```

The build produces two Vite bundles via multi-page rollup input:
- `dist/index.html` — kiosk viewer bundle
- `dist/editor/index.html` — editor bundle

## Two-Bundle Architecture

The codebase compiles into two separate bundles from the same source:

| Bundle | Entry Point | URL | Purpose |
|--------|------------|-----|---------|
| Kiosk | `src/kiosk-web.ts` | `/` | Read-only viewer with themes |
| Editor | `src/main.ts` | `/editor/` | Full authoring environment |

Both share core modules (`scene-manager`, `file-handlers`, `annotation-system`, etc.) but the kiosk bundle excludes editor code (metadata editing, alignment tools, export).

## Module Patterns

### Dependency Injection ("deps pattern")

Modules don't import each other's state directly. Instead, `main.ts` builds typed dependency objects and passes them to module functions:

```typescript
// types.ts
interface ExportDeps {
    state: AppState;
    sceneRefs: SceneRefs;
    archiveCreator: ArchiveCreator;
    // ...
}

// main.ts
const deps = createExportDeps();
exportArchive(deps);
```

Deps interfaces are defined in `src/types.ts`.

### Module Singleton Pattern

Some modules use module-scope state initialized via an `init*()` function:

```typescript
// collection-manager.ts
let collections: Collection[] = [];
export function initCollectionManager(config: Config) { ... }
```

### Logger

All modules use the structured logger:

```typescript
import { Logger } from './utilities.js';
const log = Logger.getLogger('module-name');
log.info('Message');
```

Log level is configurable via `?log=debug|info|warn|error|none` URL parameter.

## Resolve Aliases

Configured in `vite.config.ts`:

| Alias | Target |
|-------|--------|
| `three/addons/` | `three/examples/jsm/` |
| `@/` | `src/` |
| `@sparkjsdev/spark` | `src/vendor/spark-2.0.0-preview.module.js` |

## Linting & Formatting

```bash
npm run lint        # ESLint check
npm run lint:fix    # ESLint auto-fix
npm run format      # Prettier format
npm run format:check # Prettier check
```

ESLint 9 flat config is in `eslint.config.js`. Prettier config is in `.prettierrc`.

## Testing

```bash
npm test            # Run all tests once
npm run test:watch  # Watch mode
```

Tests use **Vitest** with jsdom environment. Test files live in `src/modules/__tests__/`.

Current test suites (21 suites, ~420 tests):
- `url-validation.test.ts` — URL validation and domain allowlisting
- `archive-loader.test.ts` — ZIP extraction, filename sanitization
- `archive-creator.test.ts` — Archive creation and SHA-256 hashing
- `theme-loader.test.ts` — Theme CSS parsing and metadata extraction
- `utilities.test.ts` — Shared helpers
- `quality-tier.test.ts` — Device capability detection
- `share-dialog.test.ts` — Share link URL generation
- `alignment.test.ts` — Alignment algorithms
- `flight-parsers.test.ts` — DJI CSV, KML/KMZ, and SRT telemetry parsing
- `colmap-alignment.test.ts` — Umeyama similarity transform and camera alignment
- `colmap-loader.test.ts` — Colmap binary file parsing
- `icp-alignment.test.ts` — ICP rigid transform and convergence
- `points3d-parser.test.ts` — Colmap points3D.bin parsing and subsampling
- `mesh-decimator.test.ts` — Draco compression detection
- `format-file-size.test.ts` — File size formatting
- `sip-validator.test.ts` — SIP compliance validation
- `metadata-profile.test.ts` — Metadata tier visibility
- `walkthrough-engine.test.ts` — Walkthrough playback state machine
- `undo-manager.test.ts` — Undo/redo stack
- `asset-store.test.ts` — Blob reference management
- `constants.test.ts` — Constants module contracts

## Docker Build

```bash
npm run docker:build    # Vite build + Docker image
npm run docker:run      # Run on http://localhost:8080

# Development with admin panel
npm run docker:admin
```

The Docker build requires `dist/` to exist first (`npm run build` runs automatically via the `docker:build` script). See [docker/README.md](../docker/README.md) for Docker infrastructure details.

## Tauri Desktop App

```bash
npm run tauri:dev       # Launch native window with dev server
npm run tauri:build     # Production build with installers
npm run branded         # GUI tool for branded executables
```

Requires Rust toolchain. See [TAURI_APPLICATION.md](docs/reference/TAURI_APPLICATION.md) for details.

## Key Files to Know

| File | What it does |
|------|-------------|
| `src/main.ts` | Editor orchestration — state, init, render loop, deps factories |
| `src/modules/kiosk-main.ts` | Shared kiosk viewer layer |
| `src/config.js` | Boot-time URL parameter parsing and security validation |
| `src/types.ts` | All shared TypeScript interfaces |
| `src/modules/constants.ts` | Numeric/string constants (no logic) |
| `vite.config.ts` | Build config, aliases, custom plugins |
| `docker/meta-server.js` | Node.js API server (OG tags, admin, video transcode, collections) |

## Adding a New Module

1. Create `src/modules/your-module.ts`
2. Define a deps interface in `src/types.ts` if the module needs state from `main.ts`
3. Import and wire it in `main.ts` (editor) or `kiosk-main.ts` (kiosk)
4. If it's needed by the deprecated offline kiosk generator, add it to `KIOSK_MODULES` in `vite.config.ts`
5. Add a description to `docs/reference/ARCHITECTURE.md`

## Adding a Kiosk Theme

1. Copy `src/themes/_template/` to `src/themes/your-name/`
2. Edit `theme.css` — override CSS variables, set `@theme`, `@layout`, `@scene-bg` in the comment block
3. Optionally add `layout.css` and `layout.js` for custom DOM layouts
4. Use with `?theme=your-name`

See [KIOSK-VIEWER.md](docs/KIOSK-VIEWER.md#themes) for full theming documentation.
