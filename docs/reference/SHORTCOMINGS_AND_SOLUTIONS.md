# Shortcomings & Solutions Roadmap

**Date:** 2026-02-06
**Scope:** Viewer application and .ddim container format
**Status:** Proof of concept — this document tracks known gaps and proposed solutions for moving toward a production-quality tool and a genuinely preservable archive format.

---

## Table of Contents

1. [Technology — Rendering & Runtime](#1-technology--rendering--runtime)
2. [Technology — Alignment & Analysis](#2-technology--alignment--analysis)
3. [Preservation — Format Specification](#3-preservation--format-specification)
4. [Preservation — Standards Compliance](#4-preservation--standards-compliance)
5. [Preservation — Integrity & Trust](#5-preservation--integrity--trust)
6. [Preservation — Kiosk Viewer Durability](#6-preservation--kiosk-viewer-durability)
7. [Usability — Measurement & Analysis Tools](#7-usability--measurement--analysis-tools)
8. [Usability — Metadata Authoring](#8-usability--metadata-authoring)
9. [Usability — Collaboration & Versioning](#9-usability--collaboration--versioning)
10. [Usability — Annotation System](#10-usability--annotation-system)
11. [Architecture — Format Independence](#11-architecture--format-independence)
12. [Architecture — Data Hierarchy](#12-architecture--data-hierarchy)

---

## 1. Technology — Rendering & Runtime

### 1.1 Gaussian Splat Formats Are Unstable

**Problem:** 3D Gaussian Splatting (published August 2023) is a rapidly evolving research area. The splat formats supported (`.splat`, `.ksplat`, `.spz`, `.sog`, and custom-attribute `.ply`) have no formal specification, no standards body, and no stability guarantees. These formats may fragment, merge, or become obsolete within years.

**Solutions:**
- **Short-term:** Add a prominent `format_stability: "experimental"` flag to splat entries in the manifest, distinguishing them from stable formats like GLB and E57. Document in the manifest spec that splat files are considered derived visualization products, not primary archival records.
- **Medium-term:** Monitor the emerging standardization efforts around radiance fields. When a stable format emerges (likely through Khronos Group, given their stewardship of glTF), add support and provide a migration path. Consider supporting the [3DGS specification draft](https://github.com/mkkellogg/GaussianSplats3D) or whatever consolidates.
- **Long-term:** Build a migration tool that can re-derive splats from the archived mesh/point cloud when newer splat formats become available. The archival mesh and E57 are the ground truth — the splat is always regenerable.

### 1.2 WebGL 2.0 Dependency Has a Limited Lifespan

**Problem:** The viewer requires WebGL 2.0, which is being superseded by WebGPU. The kiosk viewer freezes a WebGL-dependent rendering stack. Browser vendors may eventually deprecate WebGL 2.0 as they did WebGL 1.0 extensions.

**Solutions:**
- **Short-term:** Abstract the rendering backend behind an interface so the Three.js/Spark.js dependency can be swapped without rewriting the application logic. Three.js already has a `WebGPURenderer` in development.
- **Medium-term:** Add a WebGPU rendering path alongside WebGL 2.0, with runtime detection and fallback. Update the kiosk viewer generator to embed whichever backend the target browser supports.
- **Long-term:** When generating kiosk viewers, include both WebGL and WebGPU code paths so the file remains renderable as browsers evolve. Document the rendering API version in the manifest's `preservation.rendering_requirements` as a structured object rather than a free-text string:
  ```json
  "rendering_requirements": {
    "apis": ["WebGPU", "WebGL 2.0"],
    "minimum_gpu_memory_mb": 2048,
    "notes": "WebGPU preferred; WebGL 2.0 fallback included"
  }
  ```

### 1.3 CDN Dependency at Export Time

**Problem:** ~~Kiosk export fetches dependencies from `esm.sh` at build time. If the CDN is unavailable, restructures URLs, or changes bundling behavior, export fails entirely.~~ The downloadable kiosk HTML generator is deprecated. The kiosk viewer is now served as a separate Vite bundle at `/`, with all dependencies bundled at build time. CDN dependency at runtime is eliminated for the web-served kiosk.

**Solutions:**
- ~~**Short-term:** Add a local cache of fetched dependencies using the Cache API or IndexedDB.~~
- ~~**Medium-term:** Bundle the required dependencies as local assets within the application's deployment.~~
- **Long-term:** Provide a CLI or build script that pre-fetches and bundles all dependencies for air-gapped or institutional deployments where external network access may be restricted.

  **Status: Largely Resolved (2026-03-04)**
  - Kiosk/editor bundle split: both bundles are built by Vite with all dependencies bundled at build time — no runtime CDN fetching
  - `scripts/vendor-deps.mjs` downloads CDN dependencies to `dist/vendor/` and rewrites the import map for Tauri desktop builds
  - The deprecated downloadable kiosk HTML generator (`kiosk-viewer.ts`) still uses CDN fetching, but this code path is no longer the primary kiosk delivery mechanism

### 1.4 No Progressive or Level-of-Detail Loading

**Problem:** The viewer loads entire files into memory. Large assets (45M-face meshes, 1.2B-point E57 clouds) either load completely or not at all. There's no tiling, streaming, octree, or LOD system. This limits usability to machines with substantial GPU memory.

**Solutions:**
- **Short-term:** Add file size warnings in the UI. When loading assets above a threshold (e.g., 100MB mesh, 500MB E57), warn the user and offer to skip.
- **Medium-term:** Implement mesh simplification on load — use a decimation algorithm to create a display-resolution proxy while keeping the full-resolution file in the archive. For E57 point clouds, implement an octree-based renderer that loads visible nodes on demand.

  **Status: Implemented (2026-02-13) — via upload, not on-load decimation**
  - Users can upload pre-simplified mesh and splat proxies alongside full-resolution assets
  - Archive manifest stores proxies as separate `data_entries` with `lod: "proxy"` and `derived_from` linking to the primary entry
  - Kiosk viewer auto-detects device capability (`quality-tier.ts`) and defaults to SD (proxy) on low-end devices
  - SD/HD toggle allows manual switching between proxy and full-resolution at runtime
  - On-load decimation (in-browser) remains unimplemented

- **Long-term:** Support multi-resolution archives. The manifest could list multiple LOD versions of each asset:
  ```json
  "mesh_0": {
    "file_name": "assets/mesh_0_full.glb",
    "lod_variants": [
      { "file_name": "assets/mesh_0_lod1.glb", "face_count": 1000000 },
      { "file_name": "assets/mesh_0_lod2.glb", "face_count": 100000 }
    ]
  }
  ```
  The viewer loads the appropriate LOD based on device capability. Potree-style tiled point cloud formats could replace monolithic E57 files for web display.

  **Status: Partially Implemented (2026-02-08)**
  - LOD proxy system added to archives: upload a pre-simplified mesh as `mesh_0_proxy` with `lod: "proxy"` and `derived_from: "mesh_0"`
  - Kiosk viewer auto-loads proxy mesh when available (mobile/bandwidth-constrained scenarios)
  - Quality tier detection (`quality-tier.ts`) adapts asset loading to device capability
  - Full multi-resolution LOD chain (multiple levels) and in-browser decimation not yet implemented

  **Note:** The implemented approach uses separate `data_entries` (e.g. `mesh_0_proxy`) rather than an `lod_variants` array. The separate-entry pattern was chosen because it preserves per-entry metadata (transform, provenance) and integrates with the existing `role: "derived"` / `derived_from` hierarchy.

---

## 2. Technology — Alignment & Analysis

### 2.1 ICP Alignment — Improved but Not Complete

**Problem:** ~~The ICP implementation uses basic nearest-neighbor matching with a KD-tree but lacks RANSAC outlier rejection, multi-scale coarse-to-fine alignment, convergence criteria beyond iteration count, or point-to-plane variants.~~ The ICP implementation has been significantly improved but still lacks some advanced features.

**Status: Partially Implemented (2026-03-07)**
- **Rigid transforms** in ICP iterations prevent scale accumulation (previously a source of drift)
- **Coarse rotation search** provides better initial alignment before ICP refinement
- **points3D.bin support** — Colmap sparse reconstruction points can be used as alignment targets alongside mesh/splat geometry
- **SpatialHash** nearest-neighbor lookup added as a faster alternative for large point sets
- **Splat point sampling** (`sampleSplatPoints`) enables ICP alignment directly against Gaussian splat data
- Alignment quality metrics (RMSE, match count) displayed in the UI after Colmap↔flight path alignment

**Remaining solutions:**
- **Medium-term:** Implement point-to-plane ICP (requires normals), which converges faster and more accurately on planar surfaces common in architecture and sculpture. Add RANSAC-based initial alignment for cases where the starting positions are far apart.
- **Long-term:** Integrate a WASM-compiled alignment library (e.g., Open3D's registration module compiled to WebAssembly) for robust, production-quality registration.

---

## 3. Preservation — Format Specification

### 3.1 No Formal Specification Document

**Problem:** The `.ddim` format is defined implicitly by the code in `archive-loader.ts` and `archive-creator.ts`. There is no standalone specification document. Anyone writing an independent reader must reverse-engineer the behavior from JavaScript source code. For a preservation format, the specification should be a document, not an implementation.

**Solutions:**
- **Short-term:** Write a standalone specification document (`SPECIFICATION.md` or a versioned PDF) that defines the archive structure, manifest schema, required and optional fields, data types, and processing rules independent of any implementation. Publish it in the `archive-3d` repository.

  **Status: Implemented (2026-02-06)**
  - Standalone [SPECIFICATION.md](../archive/SPECIFICATION.md) written (~1,000 lines, RFC-style)
  - Covers archive structure, manifest schema, field types, requirement levels, and processing rules
  - Published independently of viewer implementation
- **Medium-term:** Create a formal JSON Schema for `manifest.json` and include it in the archive itself (or reference it by URL). Validators can then check any manifest against the schema without running the viewer. Version the schema and include the schema version in the manifest:
  ```json
  {
    "$schema": "https://archive-3d.org/schemas/manifest/1.0.json",
    "container_version": "1.0",
    ...
  }
  ```
- **Long-term:** Register the format with relevant bodies — submit to PRONOM for a format ID, register an IANA media type (`application/vnd.archive-3d+zip`), and seek review from digital preservation communities (Digital Preservation Coalition, NDSA, Library of Congress). Formal recognition builds institutional trust.

### 3.2 No Forward/Backward Compatibility Strategy

**Problem:** `container_version: "1.0"` exists but there's no defined behavior for how a v1.0 reader handles v2.0 manifests, or how a v2.0 reader handles v1.0 manifests. The presence of underscore-prefixed fields (`_creation_date`, `_parameters`, `_created_by_version`) suggests a convention for "private" fields, but this isn't documented.

**Solutions:**
- **Short-term:** Document the versioning contract in the spec:
  - Readers MUST ignore unknown fields (forward compatibility)
  - New required fields bump the major version
  - New optional fields bump the minor version
  - Underscore-prefixed fields are implementation-specific and MUST NOT be required for basic parsing

  **Status: Implemented (2026-02-06)**
  - Specification Section 8 defines forward/backward compatibility rules
  - Underscore-prefix convention documented for implementation-specific fields
  - Versioning contract (MUST ignore unknown fields, major/minor bump rules) codified in spec
- **Medium-term:** Add a `minimum_reader_version` field so archives can declare the oldest reader version that can process them. Add a `extensions` array for optional capability declarations.
- **Long-term:** Consider adopting a linked-data approach (JSON-LD context) so fields are self-describing and new vocabularies can be mixed in without schema conflicts.

---

## 4. Preservation — Standards Compliance

### 4.1 Dublin Core Mapping Is Informal

**Problem:** The manifest field names resemble Dublin Core but are not interoperable with DC. A DC processor cannot read the manifest directly. The fields use custom names (`creation.creator`, `coverage.spatial`) rather than Dublin Core qualified names (`dc:creator`, `dcterms:spatial`).

**Solutions:**
- **Short-term:** Add a mapping table to the specification document showing exactly which manifest field corresponds to which Dublin Core element and qualifier. This lets humans do the crosswalk even if machines can't.

  **Status: Implemented (2026-02-06)**
  - Specification Section 12 contains a standards crosswalk table
  - Maps manifest fields to Dublin Core, VRA Core, PREMIS, and PRONOM standards
  - Covers all major metadata sections (project, provenance, archival, preservation)
- **Medium-term:** Add an optional `@context` field (JSON-LD) that provides machine-readable mappings to Dublin Core, Schema.org, and other vocabularies:
  ```json
  {
    "@context": {
      "creator": "dc:creator",
      "date_created": "dcterms:created",
      "spatial": "dcterms:spatial"
    }
  }
  ```
- **Long-term:** Provide export functions that generate standards-compliant metadata sidecar files:
  - Dublin Core XML (`dc.xml`)
  - METS (Metadata Encoding and Transmission Standard) wrapper
  - PREMIS (Preservation Metadata) for preservation events
  These could optionally be included in the archive or generated on demand.

### 4.2 PRONOM IDs Are Misleading for Splat PLY Files

**Problem:** The manifest lists `fmt/831` (PLY) for Gaussian splat PLY files. But splat PLY files contain non-standard custom attributes (spherical harmonics, opacity, scale, rotation quaternions) that no standard PLY reader understands. A preservation system trusting the PRONOM ID would misidentify the file's nature.

**Solutions:**
- **Short-term:** Add a `format_variant` or `format_note` field alongside the PRONOM ID:
  ```json
  "format_registry": {
    "ply_splat": {
      "pronom_id": "fmt/831",
      "variant": "3D Gaussian Splatting (non-standard attributes)",
      "note": "Contains spherical harmonics, opacity, scale, and rotation quaternion attributes not part of the PLY specification"
    },
    "glb": { "pronom_id": "fmt/861" },
    "e57": { "pronom_id": "fmt/643" }
  }
  ```
- **Medium-term:** When/if a PRONOM ID is assigned specifically for Gaussian splat formats, use it. Consider submitting a format description to PRONOM for the splat PLY variant.
- **Long-term:** If Gaussian splats gain a formal specification, update the format registry accordingly. Until then, the variant annotation ensures archivists aren't misled.

### 4.3 No OAIS Reference Model Mapping

**Problem:** The format mixes Submission Information Package (SIP) concerns (provenance, processing notes), Archival Information Package (AIP) concerns (integrity, format registry), and Dissemination Information Package (DIP) concerns (rendering requirements, kiosk viewer) without distinguishing them. Preservation professionals working within OAIS (ISO 14721) expect clear separation.

**Solutions:**
- **Short-term:** Add an OAIS mapping section to the specification document explaining which manifest sections correspond to which OAIS information package components. Identify the manifest as primarily an AIP with DIP generation capability (kiosk export).
- **Medium-term:** Structure the manifest to clearly separate concerns:
  ```json
  {
    "descriptive_information": { /* Dublin Core, archival record */ },
    "provenance_information": { /* capture, processing, operator */ },
    "fixity_information": { /* integrity hashes, checksums */ },
    "representation_information": { /* format registry, rendering requirements */ },
    "context_information": { /* relationships, collection membership */ }
  }
  ```
- **Long-term:** Generate PREMIS metadata for preservation events (creation, migration, integrity checks). Include a METS structural map that describes the relationship between files in the archive. These are the interchange formats that institutional repositories actually ingest.

---

## 5. Preservation — Integrity & Trust

### 5.1 No Digital Signatures

**Problem:** SHA-256 hashes detect accidental corruption but not intentional tampering. For heritage documentation used in legal proceedings, insurance claims, or forensic analysis, the absence of cryptographic signatures means there's no way to verify that the archive hasn't been modified since creation.

**Solutions:**
- **Short-term:** Document this limitation in the spec. Add a `signature` field to the manifest schema as reserved/optional.
- **Medium-term:** Implement optional signing using the Web Crypto API. The creator generates a keypair, signs the manifest hash, and includes the public key and signature in the archive:
  ```json
  "integrity": {
    "algorithm": "SHA-256",
    "manifest_hash": "a1b2c3...",
    "signature": {
      "algorithm": "ECDSA-P256",
      "value": "base64-encoded-signature",
      "public_key": "base64-encoded-public-key",
      "signer": "Jane Smith",
      "signer_orcid": "0000-0002-1234-5678",
      "timestamp": "2026-01-15T08:30:00Z"
    }
  }
  ```
- **Long-term:** Support institutional PKI certificates and timestamping authorities (RFC 3161) so signatures can be verified against a chain of trust. This is what legal and forensic contexts require.

### 5.2 SHA-256 Fails Silently on HTTP

**Problem:** The Web Crypto API's `SubtleCrypto` requires a secure context (HTTPS). On HTTP deployments (common in development and some institutional intranets), hashing silently returns `null`. Archives created over HTTP have empty integrity sections with no user-visible warning.

**Solutions:**
- **Short-term:** Display a prominent UI warning when `crypto.subtle` is unavailable: "Integrity hashing unavailable — HTTPS required. Archives created here will not include checksums."

  **Status: Implemented (2026-02-08)**
  - Warning banner added to Integrity tab (shows when crypto.subtle unavailable)
  - Toast notification on page load for HTTP contexts
  - Advisory only, does not block archive creation

- **Medium-term:** Bundle a pure-JavaScript SHA-256 fallback (e.g., from the `js-sha256` library, ~4KB minified). Use `crypto.subtle` when available for performance, fall back to the JS implementation on HTTP. This ensures integrity data is always present.
- **Long-term:** Enforce HTTPS for the application in production deployments. The Docker/nginx configuration should redirect HTTP to HTTPS. Document HTTPS as a deployment requirement.

---

## 6. Preservation — Kiosk Viewer Durability

> **Note (2026-03-04):** The downloadable kiosk HTML generator is deprecated. The kiosk viewer is now served as a separate Vite bundle at `/`, eliminating the polyglot HTML+ZIP format and the frozen JS stack concerns described below. These issues remain relevant only for any previously-generated offline kiosk HTML files and for the Tauri desktop app.

### 6.1 ~~Polyglot HTML+ZIP Format Is Fragile~~ (DEPRECATED)

~~**Problem:** The kiosk viewer appends raw ZIP bytes after `</html>`. This polyglot format can be corrupted by: HTML sanitizers that strip content after `</html>`, email systems that transcode attachments, CMS platforms, charset-aware file transfers (FTP ASCII mode), or any tool that processes "HTML files" and doesn't expect trailing binary data.~~

**Status: No longer applicable.** The kiosk viewer is now served via a standard Vite build at `/`. The downloadable kiosk HTML generator is deprecated. Alternative self-contained formats remain relevant for offline distribution:
  - Tauri v2 desktop app (`src-tauri/`), defaults to kiosk mode with editorial theme — **implemented**
  - Web Bundle (`.wbn`) — a W3C format for self-contained web content — not yet implemented
  - Service Worker-based ZIP viewer — not yet implemented

### 6.2 ~~Embedded JavaScript Will Age~~ (DEPRECATED)

~~**Problem:** The kiosk viewer embeds Three.js 0.170.0 and Spark.js 0.1.10 as base64 blobs. These libraries use JavaScript patterns, APIs, and WebGL calls that may break as browsers evolve.~~

**Status: No longer applicable.** The web-served kiosk uses the same Vite-bundled Three.js 0.182.0 and Spark.js 2.0.0-preview as the editor, updated with each deployment. The JS aging concern now applies only to the Tauri desktop app (which bundles a specific version).

**Remaining long-term consideration:** Investigate pre-rendered turntable images/video as a preservation fallback:
  ```json
  "preservation_fallback": {
    "turntable_video": "assets/preview_orbit.mp4",
    "preview_images": [
      "assets/preview_front.jpg",
      "assets/preview_side.jpg",
      "assets/preview_top.jpg"
    ]
  }
  ```

---

## 7. Usability — Measurement & Analysis Tools

### 7.1 ~~No~~ Measurement Tools

**Problem:** ~~The quality metrics section documents sub-millimeter accuracy, but the viewer has no distance measurement, area calculation, cross-section, or volume estimation tools. Users can read that the data is precise but cannot actually measure anything.~~

**Status: Partially Implemented (2026-02-24)**
- **Point-to-point distance measurement** — two-click flow, 3D line overlay, DOM distance markers, configurable units (m/cm/mm/in/ft). Works in main app and kiosk viewer. (`measurement-system.ts`)
- **Cross-section tool** — arbitrary-orientation clipping plane with draggable 3D handle, normal flip, and depth snap. Works in main app and kiosk viewer. (`cross-section.ts`)

**Additional implementation (2026-03-07):**
- **Coordinate readout** — hover over the surface, display XYZ coordinates in real-time. Implemented in the Industrial kiosk theme (`src/themes/industrial/`).

**Remaining solutions:**
- **Medium-term:** Add:
  - **Multi-point polyline measurement** — click a series of points, display cumulative distance
  - **Surface area measurement** — select a region, compute area from the mesh triangles within it
- **Long-term:** Add:
  - **Volume estimation** from closed mesh regions
  - **Deviation analysis** — color-map the distance between two representations (e.g., mesh vs. point cloud) to visualize reconstruction accuracy
  - **Change detection** — compare two versions of the same capture over time, highlight differences
  - Store measurement results as a special annotation type in the manifest so they persist across sessions

---

## 8. Usability — Metadata Authoring

### 8.1 Metadata UI Is Overwhelming

**Problem:** Eight metadata tabs with many free-text fields require domain expertise. Fields like PRONOM IDs, ORCID, accuracy grades, and PBR workflow types are opaque to non-specialists. Most users will leave them blank.

**Solutions:**
- **Short-term:** Add tooltips/help text to every field explaining what it is and why it matters. Add placeholder text with realistic examples (e.g., "0000-0002-1234-5678" for ORCID).
- **Medium-term:** Implement metadata templates for common scenarios:
  - "Heritage Survey" — pre-fills relevant preservation fields, quality tier, Dublin Core structure
  - "Research Capture" — emphasizes provenance, processing chain, ORCID
  - "Quick Archive" — minimal required fields only (title, creator, license)

  Add auto-detection where possible:
  - Parse EXIF data from images to pre-fill capture date, device, GPS coordinates
  - ~~Detect file format and auto-populate PRONOM IDs~~ **Done** — auto-detected from loaded assets
  - ~~Infer mesh statistics (face count, vertex count, bounding box dimensions) from loaded files~~ **Done** — displayed as read-only statistics

  **Status: Partially Implemented (2026-02-24)**
  - PRONOM format IDs auto-detected from loaded assets
  - Mesh face/vertex counts displayed as read-only statistics
  - Metadata completeness profile selector (Basic / Standard / Archival) controls which tabs and fields are visible
  - SIP compliance validation at export time: required/recommended field checking, format validation, compliance scoring, manifest audit trail

- **Long-term:** Implement ORCID lookup (autocomplete from the ORCID API) and PRONOM lookup (search the PRONOM registry). Support import of metadata from external sources (CSV, Dublin Core XML, institutional collection management systems).

### 8.2 No Metadata Validation

**Problem:** There's no validation that metadata values are well-formed. An ORCID field accepts any string, coordinates accept any text, dates accept any format. Invalid metadata is silently accepted and persisted.

**Solutions:**
- **Short-term:** Add format validation for structured fields:
  - ORCID: regex `\d{4}-\d{4}-\d{4}-\d{3}[\dX]` with checksum verification
  - Coordinates: numeric latitude/longitude within valid ranges
  - Dates: ISO 8601 format validation
  - PRONOM IDs: regex `fmt/\d+` or `x-fmt/\d+`
  Display validation errors inline next to the field.

  **Status: Implemented (2026-02-08)**
  - Format validation for ORCID, coordinates, dates, PRONOM IDs
  - Inline error display with blur-triggered validation
  - Advisory only, does not block export
  - CSS classes for error/valid states

- **Medium-term:** Validate the entire manifest against a JSON Schema before export. Show a validation report listing errors, warnings, and suggestions. Allow export with warnings but block export with errors (e.g., missing required fields).
- **Long-term:** Implement a pre-submission validation service that checks metadata against institutional requirements. Different institutions may have different required fields — support configurable validation profiles.

---

## 9. Usability — Collaboration & Versioning

### 9.1 No Versioning Within Archives

**Problem:** Each export creates a new, complete archive. There's no diff, no changelog, no mechanism to track what changed between versions. The `replaces` relationship field exists but is free text with no linking.

**Solutions:**
- **Short-term:** Add a `version_history` array to the manifest that records previous versions:
  ```json
  "version_history": [
    {
      "version": "1.0",
      "date": "2026-01-15T08:30:00Z",
      "author": "Sarah Chen",
      "notes": "Initial capture and processing"
    },
    {
      "version": "1.1",
      "date": "2026-03-20T14:00:00Z",
      "author": "James Park",
      "notes": "Added condition annotations, updated mesh with gap-filled regions"
    }
  ]
  ```

  **Status: Implemented (2026-02-08)**
  - version_history array added to manifest root
  - UI in Project tab with "Add Version Entry" button
  - Each entry contains: version, date, description
  - Preserved on archive re-import (round-trip support)

- **Medium-term:** Implement a diff tool that can compare two `.ddim` archives and report changes: new/modified/removed files, metadata differences, annotation changes, transform differences.
- **Long-term:** Support incremental archives that reference a base archive and contain only the changed files. This reduces storage for large datasets with frequent updates. Implement a PREMIS-style event log that records every significant action (creation, annotation, re-alignment, export).

### 9.2 No Collaboration Model

**Problem:** The annotation system is single-user. There's no attribution on individual annotations, no timestamps, no review workflow. For institutional use (museum condition reports, survey team reviews), multi-user annotation with attribution is essential.

**Solutions:**
- **Short-term:** Add `author`, `created_date`, and `modified_date` fields to each annotation:
  ```json
  {
    "id": "anno_1",
    "title": "Crack on left armrest",
    "body": "...",
    "author": "Sarah Chen",
    "author_orcid": "0000-0002-7391-5482",
    "created_date": "2026-01-15T09:45:00Z",
    "modified_date": "2026-03-20T14:12:00Z",
    "status": "confirmed"
  }
  ```
- **Medium-term:** Add annotation status workflow: `draft` → `submitted` → `reviewed` → `confirmed`. Add a `replies` array so annotations can have threaded comments. Support multiple annotation layers (e.g., "Condition Assessment 2026", "Historical Notes", "Survey Control Points") that can be toggled independently.
- **Long-term:** Implement a Web Annotation Data Model (W3C standard) compatible export. This makes annotations interoperable with other annotation tools and institutional systems. Support real-time collaboration via a server component for teams working on the same archive simultaneously.

---

## 10. Usability — Annotation System

### 10.1 Annotations Are Text-Only

**Problem:** Annotations support title, body, and 3D position but no measurements, area highlighting, polyline markup, or domain-specific types. For condition documentation, free text is insufficient — assessors need to mark crack lengths, areas of loss, severity classifications, and comparable regions.

**Solutions:**
- **Short-term:** Add annotation types with type-specific fields:
  ```json
  {
    "id": "anno_3",
    "type": "condition_observation",
    "title": "Hairline crack — torso seam",
    "severity": "minor",
    "category": "structural/crack",
    "measurement": { "length_mm": 420, "width_mm_min": 0.08, "width_mm_max": 0.22 },
    "body": "...",
    "position": { "x": 0.04, "y": 2.85, "z": 0.41 }
  }
  ```
- **Medium-term:** Support geometric annotation primitives beyond single points:
  - **Polyline annotations** — trace a crack path as a series of 3D points
  - **Area annotations** — define a polygon on the surface to mark a region (loss area, biological growth zone)
  - **Measurement annotations** — store two endpoints and the computed distance
  - **Cross-reference annotations** — link two annotations together (e.g., "this crack is the same feature as anno_5")
- **Long-term:** ~~Support image attachments on annotations (e.g., a close-up photograph taken during the survey).~~ Support annotation import/export in the Web Annotation Data Model format for interoperability with IIIF, Mirador, and other cultural heritage annotation tools.

  **Status: Partially Implemented (2026-02-08)**
  - Image attachments in annotations implemented via `asset:images/filename.ext` protocol
  - Images stored as separate ZIP entries under `images/`, resolved to `blob:` URLs at runtime via `resolveAssetRefs()`
  - Rendered inline in annotation display with markdown support
  - Annotation types, polyline/area annotations, and W3C Web Annotation export not yet implemented

---

## 11. Architecture — Format Independence

### 11.1 The Archive Format Is Coupled to the Viewer

**Problem:** `packer: "vitrine3d"` in the manifest, and the absence of an independent specification, means the `.ddim` format is defined by this specific tool. If the project is abandoned, the format specification effectively dies with it. Contrast with IIIF (independent spec, consortium governance, multiple implementations) or E57 (ASTM standard).

**Solutions:**
- **Short-term:** Give the format its own identity separate from the viewer. The `archive-3d` repository is a start — flesh it out with a standalone specification, examples, and a validator. Change `packer` to reference the tool, but add a `format` field that references the spec:
  ```json
  {
    "format": "archive-3d",
    "format_version": "1.0",
    "format_spec": "https://archive-3d.org/spec/1.0",
    "packer": "vitrine3d",
    "packer_version": "1.0.0"
  }
  ```
- **Medium-term:** Write reference implementations in at least two languages (JavaScript for the web, Python for institutional workflows/scripting). A Python reader/writer would significantly increase adoption in the heritage and survey communities where Python tooling is standard (Open3D, CloudCompare scripting, Agisoft Metashape scripts).
- **Long-term:** Form a small governance group (even 3-5 people from different institutions) to steward the specification. Publish the spec under a permissive license (CC-BY or similar). Seek endorsement from relevant professional bodies (CIPA Heritage Documentation, ISPRS, AIA).

### 11.2 Tension Between Self-Contained and Open

**Problem:** The `.ddim` archive requires this viewer to display. ~~The kiosk export is self-contained but depends on a frozen JavaScript stack.~~ The kiosk is now served as a standard Vite bundle at `/`, updated with each deployment. The Tauri desktop app bundles a specific version for offline use. Neither is truly self-contained in the archival sense — one needs software, the other needs a compatible browser or the desktop app.

**Solutions:**
- **Short-term:** Accept and document the two-tier model explicitly:
  - **Tier 1 (Archive, .ddim):** Long-term preservation. Standard ZIP + JSON + standard file formats. Any ZIP library + JSON parser can extract and read the contents. The data survives without any specific viewer.
  - **Tier 2 (Kiosk, web-served or Tauri desktop):** Convenient access. The web-served kiosk at `/` stays current with each deployment. The Tauri desktop app bundles a specific version for offline use. The viewer is a convenience, not a preservation guarantee.
- **Medium-term:** Ensure the archive's data files are fully self-describing without the viewer. Include a `README.txt` in every archive explaining the structure in plain text:
  ```
  This is a Direct Dimensions archive container (version 1.0).
  It is a standard ZIP file. To extract:
    unzip archive.ddim
  Contents:
    manifest.json - Metadata (JSON format)
    assets/       - 3D data files (GLB, PLY, E57)
    preview.jpg   - Thumbnail image
  For the specification, see: https://archive-3d.org/spec
  ```

  **Status: Implemented (2026-02-08)**
  - `README.txt` auto-generated and included in every archive on export
  - Explains that the file is a standard ZIP, how to extract, and describes contents
  - Includes link to the format specification
- **Long-term:** Provide export to established institutional formats:
  - **BagIt** (Library of Congress) — a standard packaging format used by digital preservation repositories
  - **OCFL** (Oxford Common File Layout) — used by institutional repositories for versioned digital objects
  - **SIP generator** — create submission packages for specific repository systems (Archivematica, Preservica, DSpace)

---

## 12. Architecture — Data Hierarchy

### 12.1 Splats, Meshes, and Point Clouds Are Treated as Peers

**Problem:** All data entries in the manifest have equal standing. A Gaussian splat (derived visualization product, experimental format) sits alongside an E57 point cloud (primary measurement artifact, ASTM standard) as a sibling entry. This obscures the archival hierarchy — some representations are primary records; others are derived products for convenience.

**Solutions:**
- **Short-term:** Add a `role` field to each data entry:
  ```json
  "data_entries": {
    "pointcloud_0": {
      "file_name": "assets/scan.e57",
      "role": "primary",
      "role_description": "Original measurement data from terrestrial laser scanner"
    },
    "mesh_0": {
      "file_name": "assets/mesh.glb",
      "role": "derived",
      "derived_from": "pointcloud_0",
      "role_description": "Surface reconstruction from point cloud"
    },
    "splat_0": {
      "file_name": "assets/scene.ply",
      "role": "derived",
      "derived_from": "mesh_0",
      "role_description": "Gaussian splat visualization trained from photogrammetric images"
    }
  }
  ```

  **Status: Implemented (2026-02-08)**
  - Role field added to each data entry (primary/derived/blank)
  - Dropdown in Assets tab for splat, mesh, and pointcloud
  - Stored in manifest as data_entries[key].role
  - Preserved on round-trip

- **Medium-term:** Support a derivation chain in the manifest that records how each file was produced from its parent: which software, which parameters, which version. This creates a full processing provenance graph within the archive, not just a flat list of files.
- **Long-term:** Align the data hierarchy with PREMIS (Preservation Metadata: Implementation Strategies) object relationships. PREMIS defines relationship types like `isDerivedFrom`, `hasSource`, `isPartOf` that map naturally to this hierarchy and are understood by preservation systems worldwide.

---

## Priority Matrix

| # | Issue | Impact | Effort | Priority | Status |
|---|-------|--------|--------|----------|--------|
| 3.1 | No formal specification | High | Medium | **Critical** | **Done** |
| 11.1 | Format coupled to viewer | High | Medium | **Critical** | |
| 12.1 | No data hierarchy | High | Low | **Critical** | **Done** |
| 4.2 | PRONOM IDs misleading | Medium | Low | **High** | |
| 5.2 | SHA-256 fails on HTTP | Medium | Low | **High** | **Done** |
| 7.1 | No measurement tools | High | Medium | **High** | Partial |
| 8.1 | Metadata UI overwhelming | Medium | Medium | **High** | Partial |
| 3.2 | No compatibility strategy | Medium | Low | **High** | **Done** |
| 10.1 | Annotations text-only | Medium | Medium | **High** | Partial |
| 9.2 | No collaboration model | Medium | Medium | **Medium** | |
| 5.1 | No digital signatures | Medium | High | **Medium** | |
| 1.1 | Splat format instability | High | Low (document) | **Medium** | |
| 1.2 | WebGL 2.0 lifespan | Medium | High | **Medium** | |
| 6.1 | Polyglot format fragile | Medium | Medium | **Medium** | Deprecated |
| 4.1 | Dublin Core informal | Medium | Medium | **Medium** | **Done** |
| 4.3 | No OAIS mapping | Low | Medium | **Medium** | |
| 1.4 | No LOD loading | Medium | High | **Medium** | Partial |
| 8.2 | No metadata validation | Medium | Medium | **Medium** | **Done** |
| 9.1 | No versioning | Medium | Medium | **Medium** | **Done** |
| 1.3 | CDN dependency | Low | Low | **Low** | Resolved |
| 2.1 | ICP alignment naive | Low | High | **Low** | Partial |
| 6.2 | Embedded JS will age | Low | High | **Low** | Deprecated |

---

## Summary

The three most impactful areas of work were:

1. **~~Write a standalone format specification~~ (3.1, 3.2, 11.1) — Done.** The [SPECIFICATION.md](../archive/SPECIFICATION.md) covers archive structure, manifest schema, versioning rules, and standards crosswalks. The `.ddim` format is now independently documented. Remaining work: JSON Schema for machine validation, PRONOM/IANA registration, and further decoupling the format identity from the viewer (11.1).

2. **~~Add data hierarchy and role classification~~ (12.1, 4.2, 1.1) — Partially done.** Data entries now support `role` (primary/derived) classification. PRONOM variant annotations (4.2) and splat format stability documentation (1.1) remain open.

3. **~~Add measurement and structured annotation tools~~ (7.1, 10.1) — Partially done.** Point-to-point distance measurement and cross-section clipping plane are implemented. Image attachments in annotations are implemented via the `asset:` protocol. Remaining: polyline/area measurement, annotation types, and W3C Web Annotation export.

Of the 22 items tracked, 7 are fully implemented, 2 are deprecated (kiosk viewer durability 6.1/6.2), 1 is largely resolved (CDN dependency 1.3), and 4 are partially implemented. The highest-impact remaining work is format independence from the viewer (11.1), structured annotation types (10.1), and advanced measurement tools (area, polyline).
