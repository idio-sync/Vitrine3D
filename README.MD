# Vitrine3D

A web-based application for viewing multiple types of 3D data, including 3D models, Gaussian splats, and E57 point clouds individually or overlayed with each other in the same space. Designed for cultural heritage and digital preservation applications, with a standards-based archive container format for long-term archival of real-world 3D captures with extensive metadata support.

Powered by [Three.js](https://github.com/mrdoob/three.js/) and [Spark](https://sparkjs.dev/).

The application is built as two separate bundles: a **kiosk viewer** (`/`) for client-facing presentation, and an **editor** (`/editor/`) for composing scenes, editing metadata, and exporting archives.

## Features

### Multi-Format 3D Viewing
- **Gaussian splats** — PLY, SPLAT, KSplat, SPZ, SOG via Spark.js with runtime LOD
- **3D meshes** — GLB/glTF (Draco-compressed), OBJ, STL
- **Point clouds** — E57 via WASM parser
- **Parametric CAD** — STEP/IGES via OpenCASCADE WASM
- **Drawings** — DXF as an independent layer
- **Flight paths** — DJI CSV, KML/KMZ, SRT rendered as 3D lines with telemetry tooltips
- **SfM cameras** — Colmap binary import with frustum visualization and flight path alignment
- All formats loadable simultaneously in the same 3D space

### Scene Composition & Analysis
- **Transform controls** — position, rotate, and scale each asset independently
- **Alignment tools** — ICP, N-point landmark matching, auto-align, fit-to-view
- **Measurement** — point-to-point distance with configurable units (m/cm/mm/in/ft)
- **Cross-section** — arbitrary clipping plane with draggable 3D handle
- **Annotations** — depth-aware 3D surface markers with image attachments
- **Detail model inspection** — annotation-linked GLB overlays with sub-annotations and per-model view settings
- **Before/after comparison** — temporal comparison viewer with side-by-side, slider, and toggle/crossfade modes for scene-level meshes and annotation detail models

### Rendering & Media
- **Scene settings** — tone mapping, HDR environment maps, skybox, shadows, background images
- **Post-processing** — SSAO, bloom, vignette, chromatic aberration, film grain
- **Video & GIF recording** — turntable, walkthrough, annotation tour, and free camera modes with server-side FFmpeg transcode
- **Screenshot capture** — viewfinder-based capture with thumbnail gallery

### Archive Format (.ddim)
- **ZIP-based container** — bundle assets, metadata, alignment, annotations, and screenshots (.zip also accepted)
- **Preservation metadata** — 8-tab editor aligned with Dublin Core, PRONOM, and Smithsonian EDAN
- **SIP compliance validation** — required/recommended field checking with compliance scoring
- **SHA-256 integrity hashing** — streaming verification for large files
- **Object optimization profiles** — size-aware presets (Small/Medium/Large/Massive) for HD and SD mesh targets
- **Lazy loading** — only the manifest is decompressed on open; assets load on demand

### Presentation & Sharing
- **5 kiosk themes** — Editorial, Gallery, Exhibit, Industrial, and Minimal
- **Walkthrough engine** — authored camera tours with fly/fade/cut transitions and annotation links
- **WebXR VR mode** — teleport locomotion, snap turning, wrist menu, VR annotations, auto performance tuning
- **Share dialog** — customized links, embed codes, and QR codes
- **Social link previews** — Open Graph, Twitter Card, and oEmbed
- **Camera constraints** — lockable orbit, pan, zoom, and height limits per archive
- **Collections** — organize archives into browsable, themed collections

### Infrastructure
- **Two-bundle build** — kiosk viewer (`/`) and editor (`/editor/`) from the same codebase
- **Docker deployment** — nginx + Node API with SQLite, Cloudflare Access auth, s6-overlay
- **Tauri desktop app** — native builds for Windows, macOS, Linux, and Android
- **Library & admin** — archive browser, upload, rename, delete at `/library` and `/admin`

## Quick Start

### Development
```bash
npm install
npm run dev
```
Then open http://localhost:8080 in your browser. This serves the kiosk viewer; the editor is at http://localhost:8080/editor/.

### Production Build
```bash
npm run build       # Vite production build to dist/
npm run preview     # Preview production build locally
```

### Using Docker
```bash
npm run docker:build    # Vite build + Docker image
npm run docker:run      # http://localhost:8080

# Or with pre-loaded archive
docker run -p 8080:80 \
  -e DEFAULT_ARCHIVE_URL="https://example.com/scene.ddim" \
  vitrine3d

# Or with pre-loaded files
docker run -p 8080:80 \
  -e DEFAULT_SPLAT_URL="https://example.com/model.ply" \
  -e DEFAULT_MODEL_URL="https://example.com/model.glb" \
  -e DEFAULT_POINTCLOUD_URL="https://example.com/scan.e57" \
  vitrine3d
```

## Supported Formats

### Archive Containers
- `.ddim` — Direct Dimensions archive container with metadata (ZIP-based)
- `.zip` — plain ZIP archives with the same internal structure are also accepted

### 3D Models (via Three.js)
- `.glb` — Binary glTF (Draco-compressed GLBs supported via DRACOLoader)
- `.gltf` — glTF with external resources
- `.obj` — Wavefront OBJ
- `.stl` — STL mesh

### Gaussian Splats (via Spark)
- `.ply` — Standard PLY format with Gaussian splat data
- `.splat` — Compressed splat format
- `.ksplat` — Compressed splat format
- `.spz` — Spark compressed format
- `.sog` — SOG format

### Drawings (WIP)
- `.dxf` — AutoCAD DXF (via [three-dxf-loader](https://www.npmjs.com/package/three-dxf-loader), displayed as an independent drawing layer)

### Point Clouds
- `.e57` — ASTM E57 format (via [three-e57-loader](https://www.npmjs.com/package/three-e57-loader), which uses the [web-e57](https://www.npmjs.com/package/web-e57) WASM parser)

### Parametric CAD (WIP)
- `.step` / `.stp` — ISO 10303 STEP (via [occt-import-js](https://github.com/kovacsv/occt-import-js) OpenCASCADE WASM)
- `.iges` / `.igs` — Initial Graphics Exchange Specification (via [occt-import-js](https://github.com/kovacsv/occt-import-js) OpenCASCADE WASM)

### Flight Logs (WIP)
- `.csv` — DJI flight log CSV (auto-detected column aliases for firmware variations)
- `.kml` / `.kmz` — KML/KMZ flight tracks
- `.srt` — DJI SRT subtitle telemetry

### SfM Camera Data
- `cameras.bin` + `images.bin` — Colmap sparse reconstruction binary format (camera intrinsics/extrinsics)

## Documentation

| Guide | Description |
|-------|-------------|
| [Development Guide](docs/DEVELOPMENT.md) | Setup, building, testing, module patterns, adding features |
| [Usage Guide](docs/USAGE.md) | Controls, camera, alignment, annotations, scene settings, keyboard shortcuts |
| [Configuration](docs/CONFIGURATION.md) | URL parameters, share/embed, URL security |
| [Archive Format](docs/archive/ARCHIVE-GUIDE.md) | Container structure, manifest schema, loading/exporting, preservation |
| [Metadata Editor](docs/archive/METADATA.md) | 8-tab editor, field validation, Dublin Core alignment |
| [Kiosk Viewer](docs/KIOSK-VIEWER.md) | Display only view for presentation |
| [Deployment](docs/DEPLOYMENT.md) | Docker env vars, compose, nginx, admin/library, clean URLs, link previews |
| [Architecture](docs/reference/ARCHITECTURE.md) | Codebase structure and module relationships |
| [Specification](docs/archive/SPECIFICATION.md) | Formal archive-3d container format spec |
| [Tauri Desktop App](docs/reference/TAURI_APPLICATION.md) | Native desktop builds via Tauri v2 |
| [Mesh Performance Guide](docs/reference/MESH_PERFORMANCE_GUIDE.md) | Face count budgets by device tier and object size |
| [Roadmap](docs/ROADMAP.md) | Planned features and priorities |

## Technologies

- [Spark](https://sparkjs.dev/) — 3D Gaussian Splatting renderer for Three.js
- [Three.js](https://threejs.org/) — 3D rendering, model loading, and scene management
- [three-e57-loader](https://www.npmjs.com/package/three-e57-loader) — E57 point cloud loading (WASM-based via web-e57)
- [three-dxf-loader](https://www.npmjs.com/package/three-dxf-loader) — DXF drawing file loading
- [occt-import-js](https://github.com/kovacsv/occt-import-js) — STEP/IGES parametric CAD loading (OpenCASCADE WASM)
- [fflate](https://github.com/101arrowz/fflate) — Fast ZIP compression/decompression
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — SQLite database for server-side metadata storage
- [busboy](https://github.com/mscdex/busboy) — Streaming multipart form parser for uploads
- [s6-overlay](https://github.com/just-containers/s6-overlay) — Process supervision in Docker (nginx + Node API)
- [FFmpeg](https://ffmpeg.org/) — Server-side video transcoding (WebM to MP4/GIF) in Docker container
- [nginx](https://nginx.org/) — Web server for Docker deployment
- [Vite](https://vitejs.dev/) — Dev server, bundler, and build toolchain
- [Vitest](https://vitest.dev/) — Test runner
- TypeScript with ESLint and Prettier

Runtime dependencies are installed via npm and resolved by Vite from `node_modules/`.

## Browser Compatibility

Requires a modern browser with WebGL 2.0 support:
- Chrome 79+
- Firefox 72+
- Safari 15+
- Edge 79+

E57 and STEP/IGES loading additionally require WebAssembly support (available in all the above browsers).

VR mode requires a WebXR-compatible browser and headset (Chrome 79+, Edge 79+). Firefox and Safari do not support WebXR.

## Related Projects

- [archive-3d](https://github.com/idio-sync/archive-3d) — Archive container format specification and tools