# 3D Viewer Platform Comparison: VNTANA vs Sketchfab vs Vitrine3D

## Overview

| | VNTANA | Sketchfab | Vitrine3D |
|---|---|---|---|
| **Type** | Enterprise SaaS (content orchestration) | Community + SaaS marketplace | Self-hosted / Desktop app |
| **Target audience** | Enterprise (fashion, manufacturing, retail) | Creators, studios, cultural heritage | 3D scanning companies (deliverables pipeline) |
| **Hosting** | Fully hosted (GCS backend) | Fully hosted | Self-hosted (Docker + nginx) or Tauri desktop |
| **Pricing** | Enterprise (custom) + free tier | Free / $15 / $79 / Enterprise | Open source / self-hosted |
| **Notable customers** | Met Museum, Patagonia, Adidas, Armani, Kohler | British Museum, Smithsonian, NASA, game studios | Direct Dimensions (internal) |

## File Format Support

| Format | VNTANA | Sketchfab | Vitrine3D |
|---|---|---|---|
| **GLB/glTF** | Yes (primary web delivery) | Yes | Yes |
| **OBJ** | Yes | Yes | Yes |
| **FBX** | Yes (export) | Yes | No |
| **USDZ** | Yes (iOS AR) | Yes | No |
| **STL** | Yes | Yes | No |
| **PLY** | No | Yes | No |
| **STEP/IGES (CAD)** | Yes | No | Yes (occt-import-js) |
| **E57 (point cloud)** | No | No | Yes (WASM loader) |
| **Gaussian splats (.ply/.sog)** | No | No | Yes (Spark.js) |
| **DJI/KML flight logs** | No | No | Yes |
| **BLEND** | No | Yes (server-side conversion) | No |
| **Archive format** | Proprietary (cloud) | Proprietary (cloud) | .ddim ZIP (portable, offline) |

## Rendering & Visual Quality

| Feature | VNTANA | Sketchfab | Vitrine3D |
|---|---|---|---|
| **Rendering engine** | Custom WebGL viewer | Custom WebGL (proprietary) | Three.js 0.183 + Spark.js 2.0 |
| **PBR materials** | Yes | Yes (metalness + specular workflows) | Yes (via Three.js) |
| **Environment maps** | HDR (hosted on GCS) | IBL + 3 dynamic lights | HDR environment lighting |
| **Tone mapping** | Neutral (configurable exposure) | Multiple options | Three.js tone mapping |
| **Post-processing** | Sharpen filter | SSR, SSAO, DOF, bloom, chromatic aberration, vignette | None |
| **Shadows** | Yes | Real-time shadows | Yes |
| **Animation** | Limited | Skeleton, solid, morph target | No |
| **Gaussian splatting** | No | No | Yes (Spark.js LOD — 500K SD / 1.5M HD budget) |
| **Point clouds** | No | PLY point clouds | E57 via WASM (full fidelity) |

## Optimization Pipeline

| | VNTANA | Sketchfab | Vitrine3D |
|---|---|---|---|
| **Auto mesh decimation** | Yes — patented (98% reduction, e.g. 11.5M → 239K polys) | Server-side processing on upload | None (manual prep expected) |
| **Texture compression** | Yes (automated) | Yes (Draco, KTX2) | No |
| **LOD system** | Likely (enterprise pipeline) | Progressive loading | Spark.js LOD for splats only |
| **Scene graph preservation** | Yes | Yes | N/A (single-asset focus) |

## Viewer Features

| Feature | VNTANA | Sketchfab | Vitrine3D |
|---|---|---|---|
| **Annotations/hotspots** | Yes (animated hotspots) | Yes (5–100 depending on plan) | Yes (3D raycasted, unlimited) |
| **Measurements** | Unknown | Community add-on | No |
| **AR viewing** | Yes (WebXR + USDZ) | Yes (Premium+) | No |
| **VR viewing** | WebXR | WebVR (Vive, Oculus, Cardboard) | No |
| **Fullscreen** | Yes | Yes | Yes |
| **Auto-rotate** | Yes (configurable speed) | Yes | Yes |
| **Camera constraints** | Yes (FOV, distance, rotation limits) | Yes (camera limits) | Yes (per-archive config) |
| **First-person controls** | No | No | Yes (WASD + mouse-look) |
| **Flight path overlay** | No | No | Yes (DJI CSV, KML, SRT) |
| **Themes/white-label** | Bulk-editable with governance lock | Premium+ (white-label) | 5 built-in themes (editorial, gallery, exhibit, minimal, industrial) |
| **QR code sharing** | Yes | No | No |
| **Embeddable** | Yes (iframe) | Yes (iframe, oEmbed) | Yes (URL params, self-hosted) |
| **Offline viewing** | No | No (requires internet) | Yes (.ddim archive + Tauri desktop) |

## Architecture & Integration

| | VNTANA | Sketchfab | Vitrine3D |
|---|---|---|---|
| **API** | REST API + NPM package | REST API + Viewer API (Premium+) | None (file-based) |
| **DAM/PIM/PLM integration** | Yes (core selling point) | Limited (Enterprise) | No |
| **CMS embedding** | Yes (automated publishing) | iframe embed | URL param config |
| **Team/collaboration** | QA workflows, approval chains, permissions | Teams + folders (Premium+) | Single-user (editor) |
| **Analytics** | Likely (enterprise) | View counts, downloads | None |
| **Versioning** | Yes (governance layer) | Re-upload | Archive-level (new .ddim) |
| **Authentication** | Enterprise SSO | Sketchfab accounts | Cloudflare Access (Docker deploy) |
| **Desktop app** | No | No | Yes (Tauri v2 — Windows, Linux, macOS, Android) |
| **Storage** | Cloud (GCS) | Cloud | Self-hosted (nginx + SQLite) |

## Strengths by Platform

### VNTANA
- **Best for**: Enterprise product visualization pipelines (fashion, retail, manufacturing)
- Patented automatic mesh optimization (98%+ polygon reduction with quality preservation)
- Deep enterprise integration (DAM, PLM, PIM, CMS)
- Governance and approval workflows
- Multi-format output from single upload (GLB, USDZ, FBX)
- CAD file support (STEP, IGES, SOLIDWORKS)

### Sketchfab
- **Best for**: Community sharing, marketplace, cultural heritage digitization
- Largest 3D model community/marketplace
- Broadest input format support (50+ formats)
- Most advanced post-processing pipeline (SSR, SSAO, DOF, bloom)
- Animation support (skeleton, morph targets)
- VR/AR built-in
- Free tier with generous limits

### Vitrine3D
- **Best for**: 3D scanning deliverables requiring spatial context and offline access
- Only platform supporting Gaussian splats alongside meshes and point clouds
- E57 point cloud support (survey/scan industry standard)
- Flight path visualization from drone logs
- Fully self-hosted — no vendor lock-in, no recurring SaaS cost
- Portable .ddim archives (single ZIP with all assets + metadata)
- Offline desktop app via Tauri (Windows, macOS, Linux, Android)
- Multiple themed presentation modes for different client contexts
- First-person WASD navigation for walkthrough-style viewing
- CAD format support (STEP, IGES via occt-import-js WASM)

## Key Gaps for Vitrine3D

| Gap | Impact | Difficulty |
|---|---|---|
| No automatic mesh optimization | Users must pre-optimize assets | High (would need server-side decimation pipeline) |
| No texture compression (KTX2/Draco) | Larger download sizes for mesh-heavy scenes | Medium |
| No AR/VR/WebXR | Can't preview in physical space | Medium-High |
| No REST API | Can't integrate with external systems | Medium |
| No animation support | Static scenes only | Low priority (scan data is static) |
| No analytics/view tracking | No insight into client engagement | Low-Medium |
| Limited post-processing | Less cinematic rendering options | Low (Three.js EffectComposer available) |

## Summary

VNTANA and Sketchfab are cloud-hosted platforms optimized for different markets — VNTANA for enterprise content pipelines with automatic optimization, Sketchfab for community/creative sharing with rich rendering. Vitrine3D occupies a unique niche: it is the only platform in this comparison that combines Gaussian splats, E57 point clouds, meshes, CAD, and flight paths in a single portable archive format with offline desktop support. Its self-hosted model trades the convenience of SaaS for full data ownership and zero recurring costs — a strong fit for scanning companies delivering large datasets to clients who need persistent, offline access.
