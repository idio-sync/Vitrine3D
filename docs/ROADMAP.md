# Roadmap

Prioritized list of future work, drawn from the [code review](reference/CODE_REVIEW.md), [shortcomings analysis](reference/SHORTCOMINGS_AND_SOLUTIONS.md), and general codebase assessment. Items marked **Done** were completed during the initial development cycle and are listed for context.

---

## Critical

### Format Specification & Independence
- [ ] Create a formal JSON Schema for `manifest.json` and include schema version in the manifest
- [ ] Define forward/backward compatibility rules (readers MUST ignore unknown fields, major version bump for new required fields)
- [ ] Decouple the format identity from the viewer — add `format` and `format_spec` fields alongside `packer`

### Data Hierarchy
- [ ] Support a derivation chain recording how each file was produced from its parent (software, parameters, version)
- [ ] Align data hierarchy with PREMIS object relationships (`isDerivedFrom`, `hasSource`, `isPartOf`)

---

## High Priority

### Measurement & Analysis Tools
- [ ] Coordinate readout on hover (XYZ in scene units)
- [ ] Multi-point polyline measurement with cumulative distance

### Metadata Improvements
- [ ] Add tooltips/help text to every metadata field explaining purpose and format
- [ ] Implement metadata templates for common scenarios (Heritage Survey, Research Capture, Quick Archive)

### Annotation Enhancements
- [ ] Annotation types with type-specific fields (condition observation, measurement, general note)
- [ ] Polyline annotations — trace a path as a series of 3D points
- [ ] Area annotations — define a surface polygon for marking regions
- [ ] Measurement annotations — store two endpoints and computed distance
- [ ] Add `author`, `created_date`, `modified_date` fields to each annotation

### Standards Compliance
- [ ] Add `format_variant` / `format_note` alongside PRONOM IDs to distinguish splat PLY from standard PLY
- [ ] Add a Dublin Core mapping table to the specification document
- [ ] Add optional `@context` field (JSON-LD) for machine-readable mappings to Dublin Core and Schema.org

### Archive Integrity
- [ ] Bundle a pure-JavaScript SHA-256 fallback for HTTP development environments
- [ ] Add optional digital signatures (ECDSA via Web Crypto API) with signer identity and timestamp
- [ ] Enforce HTTPS in production Docker deployments (nginx redirect)

---

## Medium Priority

### Infrastructure
- [ ] Auth gate for `/editor/`: add Cloudflare Access protection to the nginx `/editor/` location block (mirrors existing admin route protection)

### Code Quality
- [ ] Add file size limits for uploaded/downloaded files (e.g., 500 MB max)
- [ ] Replace inline style manipulation with CSS classes and custom properties
- [ ] Add WebGL context loss handler with user-friendly recovery message
- [ ] Implement event listener cleanup / dispose pattern
- [ ] Replace `setTimeout`-based async sequencing with proper promise chains or event-driven patterns

### Testing
- [ ] Add tests for: archive parsing/creation, alignment algorithms
- [ ] Add E2E smoke tests for archive round-trip (create, load, verify metadata)

### Type Safety
- [ ] Phase 5: Enable `strict: true` and fix resulting type errors
- [ ] Add comprehensive JSDoc type annotations to any remaining `.js` exported functions

### Versioning & Collaboration
- [ ] Build a diff tool to compare two `.a3d` archives (file changes, metadata differences, annotation changes)
- [ ] Add annotation status workflow: `draft` -> `submitted` -> `reviewed` -> `confirmed`
- [ ] Support multiple annotation layers that can be toggled independently

### Rendering & Runtime
- [ ] Add file size warnings in the UI for large assets (>100 MB mesh, >500 MB E57)
- [ ] Cache fetched CDN dependencies (Cache API or IndexedDB) so kiosk exports survive CDN outages
- [ ] Bundle CDN dependencies as local assets for air-gapped/institutional deployments

### Preservation Standards
- [ ] Add OAIS reference model mapping to the specification document
- [ ] Generate standards-compliant metadata sidecar files on demand (Dublin Core XML, METS, PREMIS)

---

## Low Priority / Long-Term

### Advanced Measurement
- [ ] Surface area measurement from mesh triangles within a selected region
- [ ] Volume estimation from closed mesh regions
- [ ] Deviation analysis — color-map distance between two representations (mesh vs. point cloud)
- [ ] Change detection — compare two captures of the same subject over time

### Progressive Loading
- [ ] Octree-based point cloud renderer that loads visible nodes on demand

### Alignment
- [ ] Add convergence criteria and maximum correspondence distance to ICP
- [ ] Implement point-to-plane ICP for better convergence on planar surfaces
- [ ] RANSAC-based initial alignment for distant starting positions
- [ ] Display alignment quality metrics (RMSE, overlap percentage) in the UI

### Format Registration
- [ ] Register `.a3d` format with PRONOM for a format ID
- [ ] Register an IANA media type (`application/vnd.archive-3d+zip`)
- [ ] Seek review from digital preservation communities (DPC, NDSA, Library of Congress)

### Institutional Integration
- [ ] Python reference implementation for reading/writing `.a3d` archives
- [ ] Export to BagIt (Library of Congress) and OCFL (Oxford Common File Layout)
- [ ] SIP generator for institutional repositories (Archivematica, Preservica, DSpace)
- [ ] ORCID lookup (autocomplete from ORCID API) and PRONOM lookup (search registry)
- [ ] Web Annotation Data Model (W3C) compatible annotation export

### Alternative Kiosk Formats
- [ ] Web Bundle (`.wbn`) — W3C format for self-contained web content
- [ ] Service Worker-based ZIP viewer (`.zip` where `index.html` is the entry point)
- [ ] Investigate pre-rendered turntable images/video as a preservation fallback

---

<details>
<summary>Completed</summary>

### Mobile & Progressive Loading
- [x] **Done** — Add mobile friendly layout and view for kiosk mode
- [x] **Done** — Display proxy (LOD) support in archives — upload pre-simplified mesh and/or splat, kiosk viewer loads them automatically
- [x] **Done** — Auto-detect mobile/low-end devices in kiosk viewer via `quality-tier.ts` and default to SD (proxy) assets; SD/HD toggle lets users switch manually
- [x] **Done** — Multi-resolution archives with LOD proxy variants in the manifest (`lod: "proxy"`, `derived_from`)
- [x] **Done** — In-browser mesh decimation via meshoptimizer WASM with configurable presets, texture downscaling, and SD proxy GLB generation in the editor
- [x] **Done** — Draco/meshopt geometry compression for smaller archive transfer size (Draco-compressed GLB files now supported via DRACOLoader; WASM decoder served from `public/draco/`)

### Measurement & Analysis
- [x] **Done** — Point-to-point distance measurement (two-click flow, 3D line overlay, DOM markers, configurable units m/cm/mm/in/ft; works in main editor and kiosk viewer)
- [x] **Done** — Cross-section tool (define a cutting plane, display intersection profile; arbitrary-orientation clipping plane)

### Metadata & Standards
- [x] **Done** — Inline field validation (ORCID, coordinates, dates, PRONOM IDs)
- [x] **Done** — Auto-detect PRONOM format IDs from loaded assets; mesh face/vertex counts displayed as read-only statistics
- [x] **Done** — SIP compliance validation at export time: required/recommended field checking, format validation (ORCID, dates, coordinates), compliance scoring, and manifest audit trail
- [x] **Done** — Display warning when SHA-256 hashing is unavailable on HTTP
- [x] **Done** — Add `role` field (primary/derived) to each data entry
- [x] **Done** — Write a standalone specification document for the `.a3d`/`.a3z` format, independent of the viewer implementation (see [SPECIFICATION.md](archive/SPECIFICATION.md))
- [x] Include a plain-text `README.txt` in every archive explaining how to extract and read the contents

### Asset Types
- [x] **Done** — DXF drawing files as an independent asset type (loaded via `three-dxf-loader`, displayed in a dedicated drawing layer)
- [x] **Done** — STEP/IGES parametric CAD files as an independent asset type (loaded via `occt-import-js` OpenCASCADE WASM, tessellated and rendered in a dedicated CAD layer; stored as `cad_` entries in archives)

### Annotations & Walkthrough
- [x] **Done** — Image attachments in annotations via `asset:` protocol
- [x] **Done** — Guided walkthrough engine — author camera-stop sequences with configurable transitions (fly/fade/cut), dwell times, annotation links, auto-play and loop; playback in both editor and kiosk viewer

### Infrastructure & Code Quality
- [x] **Done** — Split Vite build into minimal public kiosk bundle (`/`) and full editor bundle (`/editor/`); established `kiosk-main.ts` as the shared viewer layer
- [x] **Done** — Add ESLint 9 + Prettier linting (lenient baseline, 0 errors)
- [x] **Done** — Refactor main.ts from ~3,900 to ~1,900 lines (module extractions across Phase 1-4)
- [x] **Done** — Version history array in manifest with UI for adding entries
- [x] **Done** — Tauri v2 packaged viewer for institutional desktops (defaults to kiosk mode + editorial theme)

### Testing & Type Safety
- [x] **Done** — Add a testing framework (Vitest) with 90 tests across 5 suites (url-validation, theme-loader, archive-loader, utilities, quality-tier)
- [x] **Done** — Prioritize tests for: filename sanitization, URL validation, theme metadata parsing, utilities, quality-tier detection
- [x] **Done** — Add shared TypeScript types (`src/types.ts`): `AppState`, `SceneRefs`, deps interfaces with JSDoc `@returns` on factory functions
- [x] **Done** — TypeScript migration Phases 1–3 complete: 26 of 29 modules converted to `.ts`, hybrid `allowJs: true` setup, `@types/three` installed
- [x] **Done** — Phase 4: Convert `main.js` → `main.ts` (~1,900 lines), extract `source-files-manager.ts` and `file-input-handlers.ts`

### Rendering
- [x] Abstract the rendering backend to allow swapping Three.js WebGL for WebGPU when mature
- [x] **Done** — N-point landmark alignment with live preview, RMSE quality metric, and undo (`LandmarkAlignment` class)

</details>
