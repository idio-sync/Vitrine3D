# Mesh Performance Guide — Vitrine3D

> Face count budgets, texture guidelines, and optimization strategies for delivering 3D scan data across device tiers. All recommendations account for Gaussian splat co-rendering via Spark.js.
>
> **See also:** [Splat Performance Guide](SPLAT_PERFORMANCE_GUIDE.md) for Gaussian splat-specific budgets, LOD tuning, and file format selection.

---

## Table of Contents

1. [Device Tiers](#device-tiers)
2. [Face Count Budgets by Device](#face-count-budgets-by-device)
3. [Face Count Standards by Object Size](#face-count-standards-by-object-size)
4. [Texture Resolution Guidelines](#texture-resolution-guidelines)
5. [Texel Density Standards](#texel-density-standards)
6. [Normal Map Baking — Polygon Reduction Ratios](#normal-map-baking--polygon-reduction-ratios)
7. [Industry Benchmarks](#industry-benchmarks)
8. [Optimization Pipeline](#optimization-pipeline)
9. [WebGL-Specific Constraints](#webgl-specific-constraints)
10. [Quick Reference Card](#quick-reference-card)

---

## Device Tiers

Vitrine3D targets six device tiers. The existing `quality-tier.ts` module auto-detects SD (mobile/low-end) vs HD (desktop/high-end) at runtime via GPU benchmarking.

| Tier | Example Hardware | GPU Class | VRAM | Quality Tier |
|------|-----------------|-----------|------|-------------|
| **Budget Mobile** | Snapdragon 4xx, Mali-G52 | Low | 512MB–1GB | SD (forced) |
| **Mid-range Mobile** | Snapdragon 7xx, Apple A15 | Mid | 2–4GB | SD (forced) |
| **Flagship Mobile / Tablet** | A17 Pro, Snapdragon 8 Gen 3, M-series iPad | High mobile | 4–8GB | SD (forced*) |
| **Integrated GPU Laptop** | Intel Iris Xe, AMD Radeon integrated | Low desktop | 4–8GB shared | SD or HD (benchmark) |
| **Mid-range Dedicated GPU** | GTX 1650, RTX 3050, RX 6600 | Mid desktop | 4–8GB | HD |
| **High-end Desktop** | RTX 3070+, RTX 4070+ | High desktop | 8–16GB | HD |

*All iOS/Android devices are forced to SD regardless of hardware — Safari and WebView have strict process memory limits (~1.5GB).

---

## Face Count Budgets by Device

### Mesh-Only Rendering (No Splats)

Maximum sustainable triangle counts with MeshStandardMaterial (PBR), 1–2 lights, no shadows:

| Device Tier | @60 FPS | @30 FPS | Draw Call Budget |
|-------------|---------|---------|-----------------|
| Budget Mobile | 50K–100K | 150K–300K | 30–50 |
| Mid-range Mobile | 150K–300K | 400K–700K | 50–80 |
| Flagship Mobile / Tablet | 300K–500K | 700K–1.5M | 80–120 |
| Integrated GPU Laptop | 300K–500K | 800K–1.5M | 100–150 |
| Mid-range Dedicated GPU | 1M–2M | 3M–5M | 200–500 |
| High-end Desktop | 3M–5M | 8M–15M | 500–1000+ |

### With Gaussian Splats Active (Vitrine3D Typical)

Splat rendering consumes significant GPU fill rate and memory bandwidth. Reduce mesh budgets based on splat load:

| Splat Load | Budget Reduction | Reasoning |
|------------|-----------------|-----------|
| Light (100K–300K splats) | −15–25% | Minimal fill rate competition |
| Medium (300K–1M splats) | −25–40% | Significant blending overhead |
| Heavy (1M–2M+ splats) | −40–60% | Splats dominate GPU resources |

**Vitrine3D combined budgets** (splats + mesh, targeting 30+ FPS):

| Device Tier | Spark LOD Budget | Safe Mesh Triangles @60fps | Safe Mesh Triangles @30fps |
|-------------|-----------------|---------------------------|---------------------------|
| **Budget Mobile** | 500K (SD) | **30K–60K** | **100K–200K** |
| **Mid-range Mobile** | 500K (SD) | **100K–200K** | **300K–500K** |
| **Flagship Mobile/Tablet** | 500K–1M (SD) | **180K–350K** | **500K–1M** |
| **Integrated GPU Laptop** | 1.5M (HD) | **200K–350K** | **500K–1M** |
| **Mid-range Dedicated GPU** | 1.5M (HD) | **700K–1.5M** | **2M–4M** |
| **High-end Desktop** | 2.5M+ (HD) | **2M–4M** | **5M–10M** |

> **Current app thresholds** (in `constants.ts`): `MOBILE_WARNING_FACES: 300,000` and `DESKTOP_WARNING_FACES: 10,000,000` — these align well with these budgets.

---

## Face Count Standards by Object Size

For each physical size category, we define three quality tiers:

- **Archive** — Full-resolution scan data preserved for future use
- **Museum Quality** — Highest fidelity suitable for web delivery with normal maps
- **Web Optimized** — Balanced for broad device compatibility

### Small Objects (5–50 cm)
*Shoes, artifacts, pottery, jewelry, small sculptures*

| Quality Level | Face Count | Texture | Use Case |
|--------------|------------|---------|----------|
| Archive | 1–10M | 8K color | Preservation, offline viewing |
| Museum Quality | 200K–500K | 4K color + 4K normal | Desktop web, detail inspection |
| Web Optimized | 50K–100K | 2K color + 2K normal | Universal, mobile-safe |

**Rationale:** Small objects are viewed close-up. Surface micro-detail matters. Normal maps from a 5M-face source preserve nearly all visible detail at 200K faces. At 50K faces the silhouette is smooth and the normal map carries the surface texture.

### Medium Objects (0.5–3 m)
*Furniture, full sculptures, vehicle parts, architectural details*

| Quality Level | Face Count | Texture | Use Case |
|--------------|------------|---------|----------|
| Archive | 5–50M | 8K or multi-4K atlas | Preservation |
| Museum Quality | 500K–1M | 4K color + 4K normal | Desktop web |
| Web Optimized | 100K–300K | 2K color + 2K normal | Universal |

**Rationale:** Medium objects are typically viewed from 1–3 meters. At this distance, geometric detail below ~2mm is invisible. A 500K mesh captures all perceptible form; normal maps handle surface grain.

### Large Objects (3–30 m)
*Monuments, building facades, room interiors, large machinery*

| Quality Level | Face Count | Texture | Use Case |
|--------------|------------|---------|----------|
| Archive | 50–200M | Multi-8K atlas | Preservation |
| Museum Quality | 1M–2M | Multi-4K atlas (4–8 tiles) | Desktop web |
| Web Optimized | 250K–500K | Multi-2K atlas (4–8 tiles) | Universal |

**Rationale:** Large objects are viewed from further away. Geometric detail below ~1cm is invisible at typical viewing distances. The texture atlas approach (multiple 2K or 4K maps tiled across the surface) maintains consistent texel density across the large surface area.

### Massive Objects (30+ m)
*Full buildings, building complexes, terrain*

| Quality Level | Face Count | Texture | Use Case |
|--------------|------------|---------|----------|
| Archive | 200M–1B+ | Point cloud or tiled mesh | Preservation |
| Museum Quality | 2M–5M | Tiled 4K atlas (8–16 tiles) | Desktop web, LOD required |
| Web Optimized | 500K–1M | Tiled 2K atlas (8–16 tiles) | Universal, LOD required |

**Rationale:** At this scale, LOD (Level of Detail) is mandatory. No single mesh at full detail can render in real-time on any device. The face counts above represent the highest LOD level; lower LODs at 50%, 25%, and 10% are generated for distant viewing.

### Summary Table — Recommended Web Delivery Targets

| Object Scale | Museum Quality (faces) | Web Optimized (faces) | Texture Resolution |
|-------------|----------------------|----------------------|-------------------|
| Small (5–50cm) | 200K–500K | 50K–100K | 2K–4K |
| Medium (0.5–3m) | 500K–1M | 100K–300K | 2K–4K |
| Large (3–30m) | 1M–2M | 250K–500K | Multi-2K/4K atlas |
| Massive (30m+) | 2M–5M + LOD | 500K–1M + LOD | Tiled 2K/4K atlas |

---

## Texture Resolution Guidelines

### GPU Memory Cost (Uncompressed vs Compressed)

A texture must be fully decompressed in GPU memory regardless of file format. PNG/JPEG compression only affects download size, not runtime memory.

| Resolution | RGBA Uncompressed | With Mipmaps | KTX2 (BC7/ASTC) | KTX2 + Mipmaps |
|-----------|-------------------|-------------|-----------------|----------------|
| 1024×1024 | 4 MB | 5.3 MB | 1 MB | 1.3 MB |
| 2048×2048 | 16 MB | 21.3 MB | 4 MB | 5.3 MB |
| 4096×4096 | 64 MB | 85.3 MB | 16 MB | 21.3 MB |
| 8192×8192 | 256 MB | 341 MB | 64 MB | 85.3 MB |

**Key takeaway:** A single uncompressed 4K texture with mipmaps costs ~85 MB of VRAM. With 4 PBR channels (color, normal, roughness, AO), that's **340 MB** for one material — exceeding mobile budgets entirely.

### Recommended Texture Budgets by Device

| Device Tier | Max Texture Size | Total VRAM Budget | PBR Channels |
|-------------|-----------------|-------------------|-------------|
| Budget Mobile | 1024×1024 | 256 MB | Color only, or Color + Normal |
| Mid-range Mobile | 2048×2048 | 512 MB | Color + Normal |
| Flagship Mobile / Tablet | 2048×2048 | 512 MB | Color + Normal + Roughness |
| Integrated GPU Laptop | 4096×4096 | 1 GB | Full PBR (4 channels) |
| Mid-range Dedicated GPU | 4096×4096 | 2 GB | Full PBR |
| High-end Desktop | 8192×8192 | 4 GB+ | Full PBR, multi-material |

### PBR Channel Priority

When texture budget is limited, prioritize channels in this order:

1. **Color/Albedo** — Most visible, defines the object's appearance
2. **Normal Map** — Adds surface detail without geometry cost; biggest visual impact per byte
3. **Roughness/Metalness** — Packed into a single texture (R=roughness, G=metalness). Subtle but important for realistic lighting
4. **Ambient Occlusion** — Can often be baked into the color map or vertex colors to save a texture slot

### MAX_TEXTURE_SIZE by Platform

| Platform | Typical MAX_TEXTURE_SIZE | Safe Maximum |
|----------|------------------------|-------------|
| Desktop (modern) | 16384 | 8192 |
| Desktop (99% coverage) | 8192 | 4096 |
| Mobile (modern Android) | 4096–8192 | 4096 |
| Mobile (iOS) | 4096 | 4096 |
| Safe cross-platform | 4096 | 2048 |

The existing `DEVICE_THRESHOLDS.LOW_MAX_TEXTURE: 8192` in `constants.ts` queries this at runtime.

---

## Texel Density Standards

Texel density (pixels per centimeter of physical surface) determines how sharp textures appear at a given viewing distance.

### Standard Texel Densities

| Use Case | Texel Density | Equivalent |
|----------|--------------|-----------|
| Background / distant | 2.56 px/cm | 256 px/m |
| Standard web viewing | 5.12 px/cm | 512 px/m |
| Close-up inspection | 10.24 px/cm | 1024 px/m |
| Archival / maximum fidelity | 20.48 px/cm | 2048 px/m |

### Texture Resolution by Object Size (at Standard 5.12 px/cm)

| Object Size | Surface Area (approx) | Texture Resolution |
|-------------|----------------------|-------------------|
| 10 cm (ring, small artifact) | ~0.03 m² | 512×512 |
| 30 cm (shoe, pottery) | ~0.3 m² | 1024×1024 |
| 1 m (sculpture bust) | ~3 m² | 2048×2048 |
| 2 m (full figure) | ~12 m² | 4096×4096 or 2×2K atlas |
| 5 m (monument detail) | ~75 m² | 4×4K atlas |
| 20 m (building facade) | ~1200 m² | 8–16×4K atlas or tiled |

### Vitrine3D Recommendations

For a 3D scanning deliverables viewer, target **5.12 px/cm** as the baseline for web-optimized assets and **10.24 px/cm** for museum-quality desktop viewing. Objects smaller than 30cm benefit most from higher texel density since users zoom in close.

---

## Normal Map Baking — Polygon Reduction Ratios

Baking high-poly detail into normal maps on a low-poly mesh is the single most effective optimization for scan data. The achievable reduction ratio depends on surface complexity:

### Typical Ratios by Object Type

| Object Type | High Poly | Low Poly + Normal | Ratio | Notes |
|------------|-----------|-------------------|-------|-------|
| Smooth object (shoe, phone) | 2M | 50K | 40:1 | Simple silhouette, detail is surface texture |
| Organic sculpture | 10M | 200K–500K | 20–50:1 | Complex silhouette needs more faces |
| Architectural detail (cornice) | 5M | 100K–250K | 20–50:1 | Geometric repetition helps |
| Rough natural surface (rock, bark) | 10M | 100K | 100:1 | Normal maps excel at surface noise |
| Building facade | 50M | 500K–1M | 50–100:1 | Large flat areas decimate aggressively |
| Mechanical part | 5M | 50K–200K | 25–100:1 | Hard edges need edge loops preserved |

### Texture Resolution Limits on Baking

Normal maps have a resolution ceiling — baking 50M polygons of detail onto a 2K normal map won't capture any more than baking 5M polygons, because the pixel density can't represent finer detail.

| Normal Map Resolution | Max Useful Source Polygons |
|----------------------|--------------------------|
| 1024×1024 | ~1M |
| 2048×2048 | ~4M |
| 4096×4096 | ~16M |
| 8192×8192 | ~67M |

**Practical rule:** Match your normal map resolution to your source polygon count. Don't use an 8K normal map if your source is only 2M faces — a 2K map will capture all the detail.

---

## Industry Benchmarks

### Sketchfab

| Metric | Recommendation |
|--------|---------------|
| Triangle target | 100K–500K for smooth performance |
| Upper bound | ~1M (slow on mobile/older devices) |
| Mobile (32-bit) | Under 100K |
| Textures | 1–4 textures at max 4K; 2K preferred for mobile |
| File size limit (free) | 100 MB per model |

### Smithsonian 3D (Voyager)

- Uses RapidCompact pipeline for automated decimation + UV unwrap + normal map baking
- Web delivery in glTF/GLB format with optional Draco compression
- Decimation targets are per-recipe (configurable per object), no single fixed number
- Pipeline: MeshLab (decimation) → RapidCompact (web-ready) → Voyager (viewer)

### Google Arts & Culture

- Extremely aggressive: **under 12,000 polygons** per model
- Designed for universal mobile accessibility
- Textures in JPG/PNG, HDR files under 150 KB

### Verge3D / Soft8Soft

- Scene total: **1M triangles max**
- Per model: **100K triangles max**
- Mobile: **300K–500K triangles** with ≤3 lights, ≤5 textures per shader

---

## Optimization Pipeline

### Recommended Pipeline for Vitrine3D Archives

```
1. Raw Scan (5M–200M faces)
   │
   ├─→ Archive (preserve original in .ddim as source file)
   │
   ▼
2. Decimation (in scan processing software)
   │  Target: Museum Quality face count (see table above)
   │  Tools: MeshLab, RapidCompact, Blender Decimate modifier
   │
   ▼
3. Normal Map Baking
   │  Bake high-poly → low-poly normal map
   │  Tools: RapidCompact, xNormal, Blender
   │  Resolution: Match to object size (see texel density table)
   │
   ▼
4. GLB Export
   │  Include: color map, normal map, roughness (if available)
   │  UV: Auto-unwrap if not already done
   │
   ▼
5. Mesh Optimization (gltfpack)
   │  gltfpack -i input.glb -o output.glb -cc -tc -vp 14 -vt 12
   │  • -cc  : meshopt compression (fast decode, gzip-friendly)
   │  • -tc  : KTX2 texture compression (75% VRAM savings)
   │  • -vp 14 : 14-bit position quantization
   │  • -vt 12 : 12-bit texcoord quantization
   │
   ▼
6. Optional: Generate LOD Levels (for large/massive objects)
   │  gltfpack -si 0.5 → LOD1 (50%)
   │  gltfpack -si 0.25 → LOD2 (25%)
   │  gltfpack -si 0.1 → LOD3 (10%)
   │
   ▼
7. Include in .ddim Archive
   │  Mesh stored as assets/mesh_0.glb (or mesh_0_sd.glb for proxy)
   │  Serve with gzip/brotli for additional 30–50% transfer savings
```

### Compression Comparison

| Method | File Size Reduction | Decode Speed | Morph Targets | Best For |
|--------|-------------------|-------------|---------------|----------|
| **Draco** | Highest (95%+) | Slower (WASM decode) | No | Maximum file size reduction |
| **Meshopt** | High (70–90%) | Fast (1–3 GB/s) | Yes | Fast loading, gzip-friendly |
| **Meshopt + gzip** | Very high (85–95%) | Fast | Yes | Best balance for CDN delivery |

**Recommendation for Vitrine3D:** Use meshopt (`-cc`) — faster decode than Draco and pairs well with nginx gzip. Draco is only justified for extremely bandwidth-constrained scenarios.

### KTX2 Texture Compression

| Codec | Quality | Best For |
|-------|---------|----------|
| **ETC1S** | Lower (lossy) | Color maps, solid-color textures |
| **UASTC** | Higher (near-lossless) | Normal maps, detail textures |

**GPU compressed texture formats (auto-selected by KTX2Loader):**

| Format | bpp | Platform |
|--------|-----|----------|
| BC7 | 8 | Desktop (Windows/Linux/Mac) |
| ASTC 4×4 | 8 | Mobile (modern Android, iOS) |
| ETC2 | 4–8 | Mobile (Android), WebGL 2 |

---

## WebGL-Specific Constraints

### Draw Call Overhead

WebGL's primary bottleneck is draw call overhead, not raw triangle throughput. On Windows, WebGL runs through ANGLE (translating to D3D11), adding 10–20× draw call overhead vs native OpenGL.

| Draw Calls | Performance Impact |
|-----------|-------------------|
| <50 | Smooth on all devices |
| 50–100 | OK on desktop, heavy on mobile |
| 100–200 | Desktop-only comfortable range |
| 200–500 | Mid-range desktop minimum |
| 500+ | High-end desktop only |

**Key insight:** Scenes with minimal draw calls have "basically identical performance between WebGL and native" (Emscripten benchmarks). The overhead is CPU-side command dispatch, not GPU execution.

### Optimization Techniques

| Technique | Same Geometry? | Same Material? | Dynamic? | When to Use |
|-----------|---------------|----------------|----------|-------------|
| InstancedMesh | Yes | Yes | Transforms only | Repeated objects (markers, bolts) |
| BatchedMesh | No | Yes | Add/remove | Multiple scan chunks, same material |
| Merged Geometry | No | Yes | No | Static scene elements |
| Individual Meshes | N/A | N/A | Full | Default for scan objects |

### MeshStandardMaterial Overhead

PBR material overhead vs MeshBasicMaterial is only ~10% — smaller than commonly assumed. The Three.js shader cache minimizes recompilation. **Do not downgrade materials for performance; reduce geometry instead.**

### Memory Management

Three.js does NOT garbage-collect GPU resources. Always call `.dispose()` on geometries, materials, and textures when removing objects. The existing `disposeObject()` in `utilities.js` handles this.

**Memory budget guidelines:**
- Mobile WebGL: ~256–512 MB VRAM total
- Desktop WebGL: ~1–2 GB usable VRAM
- Rule of thumb: Keep total texture VRAM under 256 MB for broad compatibility

---

## Quick Reference Card

### "What face count should I use?"

| I'm scanning a... | Size | SD Devices (Mobile) | HD Devices (Desktop) |
|-------------------|------|--------------------|--------------------|
| Ring / jewelry | 5–10 cm | 30K–50K | 200K–300K |
| Shoe / artifact | 15–40 cm | 50K–100K | 300K–500K |
| Bust / pottery | 30–60 cm | 80K–150K | 400K–500K |
| Chair / small sculpture | 0.5–1.5 m | 100K–200K | 500K–1M |
| Full figure / large sculpture | 1.5–3 m | 150K–300K | 700K–1M |
| Car / large machinery | 3–6 m | 200K–400K | 1M–2M |
| Monument / room interior | 5–15 m | 250K–500K | 1M–2M |
| Building facade | 15–30 m | 300K–500K + LOD | 1.5M–3M + LOD |
| Full building / complex | 30+ m | 500K–1M + LOD | 2M–5M + LOD |

### "What texture size should I use?"

| Object Size | SD (Mobile) | HD (Desktop) |
|-------------|------------|-------------|
| Under 30 cm | 1024×1024 | 2048×2048 |
| 30 cm – 2 m | 1024×1024 | 4096×4096 |
| 2 m – 10 m | 2× 1024×1024 atlas | 2× 4096×4096 atlas |
| 10 m+ | 4× 1024×1024 atlas | 4–8× 4096×4096 atlas |

### "Do I need LOD?"

- **Under 1M faces (web optimized):** No LOD needed
- **1M–3M faces:** LOD recommended for mobile compatibility
- **3M+ faces:** LOD required — generate 3–4 levels (100% → 50% → 25% → 10%)

---

## Sources

- [Three.js Forum — Millions of facets](https://discourse.threejs.org/t/millions-of-facets-with-three-js/9799)
- [Three.js Forum — Reasonable performance limits](https://discourse.threejs.org/t/how-to-test-performance-what-are-the-reasonable-limits/32430)
- [Verge3D/Soft8Soft — Performance Bottlenecks](https://www.soft8soft.com/docs/manual/en/introduction/Performance-Bottlenecks.html)
- [MDN — WebGL Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- [Emscripten — Optimizing WebGL](https://emscripten.org/docs/optimizing/Optimizing-WebGL.html)
- [Spark.js — Performance Tuning](https://sparkjs.dev/docs/performance/)
- [Spark.js — LOD Deep Dive](https://sparkjs.dev/2.0.0-preview/docs/new-spark-renderer/)
- [Sketchfab — Improving Viewer Performance](https://help.sketchfab.com/hc/en-us/articles/201766675-Improving-Viewer-Performance)
- [Smithsonian Cook Pipeline](https://smithsonian.github.io/dpo-cook/)
- [Google Arts & Culture — Supported Media](https://support.google.com/culturalinstitute/partners/answer/6002820)
- [meshoptimizer](https://meshoptimizer.org/)
- [glTF-Transform](https://gltf-transform.dev/)
- [Khronos — KTX Developer Guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXDeveloperGuide.md)
- [Beyond Extent — Texel Density Deep Dive](https://www.beyondextent.com/deep-dives/deepdive-texeldensity)
- [RapidPipeline — 3D Model Optimization](https://rapidpipeline.com/en/3d-model-optimization/)
