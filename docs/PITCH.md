# Vitrine3D — Pitch Document

## The Problem

3D scanning companies produce rich, multi-format deliverables — Gaussian splats, photogrammetric meshes, LiDAR point clouds, CAD models — but have no unified way to **package, present, and preserve** them together. Clients receive loose files they can't open. Teams rely on Sketchfab or custom portals that strip context, lose metadata, and lock data into proprietary platforms.

There is no open, standards-aligned container that keeps scan data spatially registered, richly annotated, and viewable in a browser — until now.

---

## What Vitrine3D Is

Vitrine3D is a **browser-based 3D viewer and authoring tool** for assembling and delivering scan data. It combines a full-featured **Editor** for composing scenes with a client-facing **Kiosk Viewer** for polished presentation — all built around an open, ZIP-based archive format (`.a3d` / `.a3z`) designed for long-term preservation.

Think of it as **a publishing platform for 3D captures**: load your assets, align them in shared space, annotate surfaces, fill in preservation-grade metadata, export a single archive, and share a link your client can open in any modern browser.

---

## Key Features

### Multi-Format 3D Viewing
- **Gaussian Splats** (PLY, SPLAT, KSplat, SPZ, SOG) — powered by Spark.js
- **3D Meshes** (GLB, glTF, OBJ, STL) — with Draco decompression support
- **Point Clouds** (E57) — WASM-accelerated parsing
- **Parametric CAD** (STEP, IGES) — OpenCASCADE WASM tessellation
- **Drawings** (DXF) — displayed as an independent layer
- All formats can be loaded **simultaneously** and overlaid in the same 3D space

### Scene Composition & Alignment
- **Transform controls** — position, rotate, and scale each asset independently
- **Landmark alignment** — interactive N-point matching with RMSE quality metric and live preview
- **Cross-section tool** — arbitrary clipping plane with draggable 3D handle

### Spatial Annotation & Measurement
- **3D annotations** — click any surface to place depth-aware markers with titles, descriptions, and image attachments
- **Point-to-point measurement** — two-click distance tool with configurable units (m/cm/mm/in/ft)
- **Guided walkthroughs** — author camera tours with fly/fade/cut transitions, dwell times, and annotation links

### Archive Format (.a3d / .a3z)
- **Open, ZIP-based container** — bundle all assets, metadata, alignment, annotations, and screenshots into a single file
- **SHA-256 integrity hashing** — streaming verification for files over 10 MB
- **LOD proxy support** — include pre-simplified assets for mobile/low-bandwidth clients
- **SIP compliance validation** — required/recommended field checking, compliance scoring, and audit trail at export time
- **Dublin Core & PRONOM aligned** — metadata schema maps to established digital preservation standards

### Presentation & Sharing
- **Four kiosk themes** — Editorial (golden ratio layout), Gallery (cinematic full-bleed), Exhibit (institutional with attract mode), and Industrial (Mimics MeshLab with tools)
- **Share dialog** — generate customized links, embed codes, and QR codes
- **Create and share video and GIfs** - Record models and camera movements for easy sharing and viewing on the web
- **Clean URLs** — `/view/{hash}` paths for shareable, parameter-free links
- **Social link previews** — Open Graph, Twitter Card, and oEmbed for rich previews on Slack, Discord, and social media
- **Camera constraints** — lock orbit, pan, zoom, and height limits per archive for controlled presentations

### Preservation-Grade Metadata
- **8-tab metadata editor** — project info, provenance, archival records, quality metrics, material properties, preservation details, asset statistics, and integrity
- **Inline validation** — ORCID, ISO dates, GPS coordinates, PRONOM format IDs
- **Metadata profiles** — Basic, Standard, and Archival tiers controlling field visibility and completeness scoring
- **GPS map picker** — interactive Leaflet/OpenStreetMap modal for coordinate selection with reverse geocoding

---

## Architecture

### Two-Bundle Design

```
                    Vitrine3D
                   /          \
            Editor              Kiosk Viewer
       (internal tool)         (client-facing)
       
```

- **Editor** (`/editor/`) — Full authoring environment: load assets, align spatially, annotate, edit metadata, author walkthroughs, capture screenshots, and export `.a3d` archives.
- **Kiosk Viewer** (`/`) — Lightweight, read-only presentation layer. Loads archives via URL, applies themes, enforces camera constraints. No editor code in this bundle, but viewer tools are included on a per-theme basis.

Both are built as **separate Vite bundles** from the same codebase, sharing core modules (scene management, file handlers, annotations, walkthrough engine) without duplication.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| 3D Rendering | Three.js 0.182 + Spark.js 2.0 (Gaussian splats) |
| Point Clouds | three-e57-loader / web-e57 (WASM) |
| CAD | occt-import-js (OpenCASCADE WASM) |
| Compression | fflate (ZIP), Draco / meshoptimizer (geometry) |
| Build | Vite + TypeScript |
| Testing | Vitest (200+ tests on security-critical paths) |
| Apps | Tauri v2 (Windows, macOS, Linux, Android) |
| Server | Docker (nginx + Node API), SQLite, s6-overlay |
| Auth | Cloudflare Access |

### Module Architecture

The codebase is organized as **~30 focused TypeScript modules** orchestrated by a central glue layer. Modules communicate through a typed dependency-injection pattern — no global imports, no circular dependencies.

```
Scene Management -----> Three.js setup, rendering, camera, lighting
File Handlers --------> Asset loading (splats, meshes, point clouds, CAD)
Archive System -------> ZIP creation/extraction, manifest parsing, integrity
Alignment Tools ------> ICP, landmark matching, auto-align, fit-to-view
Annotation System ----> 3D surface annotations with raycasting
Walkthrough Engine ---> Camera tour state machine (pure logic, no DOM)
Metadata Manager -----> 8-tab editor, Dublin Core schema, SIP validation
Theme Loader ---------> Runtime CSS/JS theme injection for kiosk
Quality Tier ---------> Device capability detection, SD/HD asset selection
```

### Deployment Options

- **Static hosting** — `npm run build` produces a static `dist/` folder deployable anywhere
- **Docker** — Multi-stage image with nginx (static files + CORS + CSP) and a Node API (SQLite metadata storage, archive CRUD, upload handling)
- **Desktop app** — Tauri v2 builds for Windows, macOS, Linux, and Android with native file dialogs and deep linking
- **Embeddable** — Share dialog generates iframe embed codes for integration into any website

---

## What Sets Vitrine3D Apart

| | Sketchfab | Potree | Custom Portals | **Vitrine3D** |
|---|---|---|---|---|
| Multi-format overlay | Limited | Point clouds only | Varies | Splats + Meshes + Point Clouds + CAD |
| Open archive format | No | No | No | .a3d/.a3z (ZIP-based, documented spec) |
| Preservation metadata | None | None | Minimal | Dublin Core, PRONOM, SIP compliance |
| Spatial alignment tools | None | None | Rare | ICP, landmark, auto-align |
| Self-hosted | No | Yes | Yes | Yes (Docker or static) |
| Desktop app | No | No | Rare | Tauri v2 (Win/Mac/Linux/Android) |
| Themeable presentation | Limited | No | Custom | 4 built-in themes + template system |
| Guided walkthroughs | Basic | No | Rare | Full authoring + playback engine |

---

## Target Users

- **3D scanning companies** delivering multi-format scan packages to clients
- **Cultural heritage organizations** preserving and presenting digitized artifacts and sites
- **Survey and engineering firms** sharing registered scan data with stakeholders
- **Museums and archives** creating interactive 3D exhibits with preservation-grade metadata
- **Research institutions** publishing 3D capture data with provenance and annotation

---

## Current Status

- **v1.0** — Production-ready editor and kiosk viewer
- **200+ automated tests** on security-critical code paths
- **Full TypeScript migration** (26/29 modules converted, hybrid `allowJs` for remainder)
- **Docker deployment** in production with SQLite metadata, Cloudflare Access auth
- **Tauri v2 desktop builds** for Windows, macOS, Linux, and Android
- **Open archive format** with published specification and standards alignment

### On the Roadmap

- JSON Schema for manifest validation
- Digital signatures (ECDSA) for archive integrity
- Advanced measurement (polyline, area, volume)
- Institutional integration (BagIt, OCFL, Archivematica export)
- PRONOM format registration for `.a3d`

---

## Get Started

```bash
npm install
npm run dev          # http://localhost:8080 (kiosk) / http://localhost:8080/editor/ (editor)
npm run build        # Production build
npm run docker:build # Docker image
```

**License:** MIT
