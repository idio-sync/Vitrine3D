# Gaussian Splat Performance Guide — Vitrine3D

> Splat count budgets, file format selection, LOD tuning, and optimization strategies for delivering 3D Gaussian Splatting data across device tiers. All recommendations account for mesh co-rendering via Three.js and Spark.js 2.0's hierarchical LOD system.

---

## Table of Contents

1. [Device Tiers](#device-tiers)
2. [Splat Count Budgets by Device](#splat-count-budgets-by-device)
3. [Splat Count Standards by Object Size](#splat-count-standards-by-object-size)
4. [Spherical Harmonics Degree Tradeoffs](#spherical-harmonics-degree-tradeoffs)
5. [File Format Comparison](#file-format-comparison)
6. [GPU Memory Costs](#gpu-memory-costs)
7. [Spark.js 2.0 LOD Tuning](#sparkjs-20-lod-tuning)
8. [Optimization Pipeline](#optimization-pipeline)
9. [WebGL-Specific Constraints](#webgl-specific-constraints)
10. [Quick Reference Card](#quick-reference-card)

---

## Device Tiers

Same six tiers as the [Mesh Performance Guide](MESH_PERFORMANCE_GUIDE.md). The existing `quality-tier.ts` module auto-detects SD vs HD at runtime via GPU benchmarking.

| Tier | Example Hardware | GPU Class | VRAM | Quality Tier |
|------|-----------------|-----------|------|-------------|
| **Budget Mobile** | Snapdragon 4xx, Mali-G52 | Low | 512MB–1GB | SD (forced) |
| **Mid-range Mobile** | Snapdragon 7xx, Apple A15 | Mid | 2–4GB | SD (forced) |
| **Flagship Mobile / Tablet** | A17 Pro, Snapdragon 8 Gen 3, M-series iPad | High mobile | 4–8GB | SD (forced*) |
| **Integrated GPU Laptop** | Intel Iris Xe, AMD Radeon integrated | Low desktop | 4–8GB shared | SD or HD (benchmark) |
| **Mid-range Dedicated GPU** | GTX 1650, RTX 3050, RX 6600 | Mid desktop | 4–8GB | HD |
| **High-end Desktop** | RTX 3070+, RTX 4070+ | High desktop | 8–16GB | HD |

*All iOS/Android devices are forced to SD regardless of hardware — Safari and WebView have strict process memory limits (~1.5GB).

### Key Difference from Mesh Rendering

Gaussian splats are **alpha-blended** — every visible splat must be sorted back-to-front and composited. This makes splat rendering fundamentally **fill-rate bound** rather than vertex-throughput bound like mesh rendering. High-DPI displays, MSAA, and dense splat clustering all amplify the fill-rate cost disproportionately on mobile GPUs.

---

## Splat Count Budgets by Device

### Splat-Only Rendering (No Mesh)

Maximum sustainable splat counts at target frame rates via Spark.js 2.0 with LOD enabled:

| Device Tier | @60 FPS | @30 FPS | Notes |
|-------------|---------|---------|-------|
| Budget Mobile | 200K–400K | 500K–800K | Reduce pixel ratio to 1.0 |
| Mid-range Mobile | 500K–1M | 1M–2M | Disable MSAA (critical) |
| Flagship Mobile / Tablet | 1M–2M | 2M–3M | iOS: disable MSAA, cap pixel ratio at 2 |
| Integrated GPU Laptop | 1M–2M | 2M–4M | SD LOD budget recommended |
| Mid-range Dedicated GPU | 3M–5M | 5M–10M | HD LOD budget |
| High-end Desktop | 5M–10M | 10M–20M+ | Can push lodSplatCount to 10M+ |

> **Source:** Spark.js official guidance: Quest 3 ≤1M, Android 1–2M, iPhone 1–3M, Desktop 1–5M (10–20M+ on some high-end desktops). Desktop benchmarks show RTX 3080 Ti rendering 6.1M splats at 147 FPS in native Vulkan — WebGL adds ~30–50% overhead.

### With Mesh Co-Rendering (Vitrine3D Typical)

When rendering splats alongside meshes, both compete for fill rate and GPU memory. Reduce splat budgets based on mesh load:

| Mesh Load | Splat Budget Reduction | Reasoning |
|-----------|----------------------|-----------|
| Light (<50K faces) | No reduction | Mesh cost negligible vs splat fill rate |
| Medium (50K–300K faces) | −10–20% | Some vertex processing + texture memory |
| Heavy (300K–1M faces) | −20–35% | Significant shared GPU resource pressure |
| Very Heavy (1M+ faces) | −35–50% | Consider whether both are needed |

**Vitrine3D combined budgets** (splats + mesh, targeting 30+ FPS):

| Device Tier | Spark LOD Budget | Safe Total Splats | Safe Mesh Triangles |
|-------------|-----------------|-------------------|---------------------|
| **Budget Mobile** | 500K (SD) | **300K–500K** | **30K–60K** |
| **Mid-range Mobile** | 1M (SD) | **800K–1.5M** | **100K–200K** |
| **Flagship Mobile / Tablet** | 1M (SD) | **1M–2M** | **180K–350K** |
| **Integrated GPU Laptop** | 1.5M (SD/HD) | **1.5M–3M** | **200K–350K** |
| **Mid-range Dedicated GPU** | 5M (HD) | **3M–5M** | **700K–1.5M** |
| **High-end Desktop** | 5M+ (HD) | **5M–10M+** | **2M–4M** |

> **Current app thresholds** (in `quality-tier.ts`): `DEFAULT_LOD_BUDGETS` are SD: 1,000,000 and HD: 5,000,000. Overridable via Docker env vars `LOD_BUDGET_SD` / `LOD_BUDGET_HD`.

---

## Splat Count Standards by Object Size

For each physical size category, we define three quality tiers:

- **Archive** — Maximum splat count from training, preserved for future reprocessing
- **Presentation Quality** — Highest fidelity suitable for web delivery with LOD
- **Web Optimized** — Balanced for broad device compatibility

### Small Objects (5–50 cm)
*Shoes, artifacts, pottery, jewelry, small sculptures*

| Quality Level | Splat Count | SH Degree | File Format | Use Case |
|--------------|-------------|-----------|-------------|----------|
| Archive | 1M–3M | 3 | PLY | Preservation, offline viewing |
| Presentation Quality | 500K–1M | 1–2 | SPZ (LOD) | Desktop web, detail inspection |
| Web Optimized | 200K–500K | 0–1 | SPZ (LOD) | Universal, mobile-safe |

**Rationale:** Small objects are viewed close-up with limited background. Most splats are concentrated in the object itself. 500K splats captures virtually all surface detail visible at web resolution. SH degree 1 provides adequate view-dependent color for most materials; degree 0 is acceptable for matte/diffuse objects.

### Medium Objects (0.5–3 m)
*Furniture, full sculptures, vehicle parts, architectural details*

| Quality Level | Splat Count | SH Degree | File Format | Use Case |
|--------------|-------------|-----------|-------------|----------|
| Archive | 2M–5M | 3 | PLY | Preservation |
| Presentation Quality | 1M–2M | 1–2 | SPZ (LOD) | Desktop web |
| Web Optimized | 500K–1M | 0–1 | SPZ (LOD) | Universal |

**Rationale:** Medium objects typically have more surface area and are viewed from multiple distances. 1–2M splats provides excellent quality at typical viewing distances. The LOD system in Spark 2.0 ensures distant views render quickly by budgeting fewer splats.

### Large Objects (3–30 m)
*Monuments, building facades, room interiors, large machinery*

| Quality Level | Splat Count | SH Degree | File Format | Use Case |
|--------------|-------------|-----------|-------------|----------|
| Archive | 5M–20M | 3 | PLY | Preservation |
| Presentation Quality | 2M–5M | 1 | SPZ (LOD) | Desktop web |
| Web Optimized | 1M–2M | 0–1 | SPZ (LOD) | Universal |

**Rationale:** Large scenes require more splats to cover the surface area, but the LOD system becomes essential — users can't see full detail everywhere at once. Spark's hierarchical LOD tree renders the `lodSplatCount` budget-worth of splats per frame, prioritizing what's near the camera. SH degree 1 is usually sufficient since large-scale lighting variations dominate over specular reflections.

### Massive Objects (30+ m)
*Full buildings, building complexes, terrain*

| Quality Level | Splat Count | SH Degree | File Format | Use Case |
|--------------|-------------|-----------|-------------|----------|
| Archive | 20M–100M+ | 3 | PLY (split) | Preservation |
| Presentation Quality | 5M–10M | 0–1 | SPZ (LOD) | Desktop web, LOD required |
| Web Optimized | 2M–5M | 0 | SPZ (LOD) | Universal, LOD required |

**Rationale:** At this scale, LOD is mandatory. Spark 2.0's hierarchical LOD tree is designed for exactly this scenario. The `lodSplatCount` budget ensures only the most relevant splats render per frame. SH degree 0 (base color only) is often acceptable — at building scale, view-dependent lighting effects are subtle relative to the geometric detail.

### Summary Table — Recommended Web Delivery Targets

| Object Scale | Presentation (splats) | Web Optimized (splats) | SH Degree | File Format |
|-------------|----------------------|----------------------|-----------|-------------|
| Small (5–50cm) | 500K–1M | 200K–500K | 0–1 | SPZ |
| Medium (0.5–3m) | 1M–2M | 500K–1M | 0–1 | SPZ |
| Large (3–30m) | 2M–5M | 1M–2M | 0–1 | SPZ |
| Massive (30m+) | 5M–10M | 2M–5M | 0 | SPZ |

---

## Spherical Harmonics Degree Tradeoffs

Spherical harmonics (SH) encode view-dependent color — how the appearance changes as the camera moves. Higher degrees capture more complex lighting (specular reflections, iridescence) but cost significantly more memory. SH coefficients account for **over 80% of total splat storage** at degree 3.

### SH Coefficients Per Splat

| SH Degree | Coefficients per Splat | Bytes (FP32) | Bytes (8-bit quantized) | Visual Effect |
|-----------|----------------------|-------------|------------------------|---------------|
| 0 | 0 (base color only) | 0 | 0 | Flat color, no view-dependent effects |
| 1 | 9 (3 per RGB) | 36 | 9 | Basic directional shading |
| 2 | 24 (8 per RGB) | 96 | 24 | Smooth reflections, glossy surfaces |
| 3 | 45 (15 per RGB) | 180 | 45 | Full specular, complex BRDF |

### Memory Impact

For a scene with 1 million splats:

| SH Degree | SH Storage (FP32) | SH Storage (8-bit) | Total Splat Size (FP32) | Total Splat Size (8-bit) |
|-----------|-------------------|--------------------|-----------------------|------------------------|
| 0 | 0 MB | 0 MB | ~68 MB | ~20 MB |
| 1 | 36 MB | 9 MB | ~104 MB | ~29 MB |
| 2 | 96 MB | 24 MB | ~164 MB | ~44 MB |
| 3 | 180 MB | 45 MB | ~248 MB | ~65 MB |

> **Base splat data** (position + rotation + scale + color, no SH): ~68 bytes/splat (FP32) or ~20 bytes/splat (quantized).

### When to Use Each Degree

| SH Degree | Best For | Avoid For |
|-----------|----------|-----------|
| **0** | Matte/diffuse objects, large-scale scenes, mobile delivery, massive buildings | Glossy/metallic objects, jewelry, glass |
| **1** | Most web delivery, adequate for most scanned objects, good quality/size tradeoff | Highly specular surfaces |
| **2** | Desktop presentation, objects with moderate reflectance | Mobile unless heavily LOD'd |
| **3** | Archive/preservation, objects with complex reflections | Web delivery (memory cost rarely justified) |

**Practical rule for Vitrine3D:** Default to SH degree 1 for web delivery. Use degree 0 for massive scenes or strict mobile targets. Reserve degree 2–3 for archival PLY files.

### Typical Training Output by Capture Method

Standard unconstrained 3DGS training produces approximately 1,000–10,000 splats per input image. These are pre-optimization counts — pruning reduces them significantly (see [Optimization Pipeline](#optimization-pipeline)):

| Capture Method | Typical Unoptimized Output | Notes |
|---------------|--------------------------|-------|
| Phone video (Polycam, KIRI, Luma AI) | 300K–2M | Cloud-processed, not user-configurable |
| DSLR photogrammetry (100–300 images) | 500K–3M | Standard quality, local training |
| DSLR photogrammetry (300–600 images) | 1M–5M | More coverage, denser output |
| LiDAR + photos (RealityCapture) | 1M–4M | Geometric prior assists convergence |
| Drone aerial (100–500m AGL) | 5M–30M+ | Requires partitioned training |
| Multi-camera array (200+ cameras) | 2M–8M | Dense angular coverage |

> **For Vitrine3D archives:** The client receives the optimized/pruned output, not the raw training output. Archive the pre-pruned PLY as a source file; deliver the optimized SPZ.

---

## File Format Comparison

### Bytes Per Splat by Format

| Format | Bytes/Splat (SH3) | Bytes/Splat (SH0) | 1M Splats File Size | Compression vs PLY | LOD Support | WASM Required |
|--------|-------------------|-------------------|--------------------|--------------------|-------------|---------------|
| **PLY** (FP32) | ~248 | ~68 | ~248 MB / ~68 MB | 1x (baseline) | No | No |
| **PLY** (FP16) | ~144 | ~40 | ~144 MB / ~40 MB | 1.7x | No | No |
| **.splat** | ~32 | ~32 | ~32 MB | 7–8x | No | No |
| **SPZ** | ~12–25 | ~12 | ~12–25 MB | 10x typical | Yes (Spark LOD tree) | Yes |
| **KSPLAT** | ~11–23 | ~11 | ~11–23 MB | 10–11x | No | No |
| **SOG** | ~16 | ~16 | ~16 MB | ~15x | No | Yes |

> **Benchmark data:** For a 500K gaussian scene, PLY averages 118 MB, .splat 16.2 MB (7.3x), KSPLAT 11.4 MB (10.4x), SPZ 11.8 MB (10.0x). PLY-to-SPZ compression ranges from 8.1x to 14.7x across scenes.

### Format Details

**PLY (Polygon File Format)**
- Original 3DGS output format. Stores all attributes as 32-bit or 16-bit floats.
- 248 bytes/splat with SH degree 3 (position: 12B, rotation: 16B, scale: 12B, color: 12B, SH: 192B, opacity: 4B).
- No compression, no LOD. Large files but zero decode overhead.
- Use for: archive storage, training pipeline interchange.

**.splat (Antimatter15)**
- Quantized format: position (12B), scale+rotation (16B), RGBA (4B) = ~32 bytes/splat.
- Drops all SH data (base color only). Simple, fast to parse.
- Use for: quick web previews, mobile-first delivery where view-dependent effects aren't needed.

**SPZ (Niantic/Spark)**
- Gzipped stream: 24-bit fixed-point positions, 8-bit log-encoded scales, 10-bit rotations, 8-bit colors, variable SH quantization (5-bit SH1, 4-bit SH2+).
- ~10x smaller than PLY with "virtually no perceptible loss in visual quality."
- **LOD support via Spark.js:** SPZ files with pre-built LOD trees are ~30% larger than base SPZ but enable instant hierarchical rendering without runtime LOD tree construction.
- Adopted as official compressed encoding in Khronos glTF extension (`KHR_gaussian_splatting_compression_spz`).
- Use for: **primary web delivery format in Vitrine3D.** Best balance of size, quality, and LOD support.

**KSPLAT (Kevin Kwok)**
- Chunk-based quantization: 256 splats per chunk with local bounds. Position/scale/rotation/color packed into 4 × uint32 = 16 bytes/splat + 48 bytes/chunk overhead.
- Good compression with fast decode. No SH support beyond base color.
- Use for: alternative to .splat with slightly better compression.

**SOG (Aether/PlayCanvas)**
- Compressed format requiring WASM decode. ~16 bytes/splat.
- In Spark.js 2.0, SOG files must be pre-decoded via the legacy `unpackSplats()` worker — the new PackedSplats path doesn't support `pcsogszip`.
- Use for: PlayCanvas ecosystem interop.

### Recommended Format for Vitrine3D

```
Archive (preservation):     PLY (SH3, full precision)
Web delivery (all tiers):   SPZ with pre-built LOD tree
Quick preview / embeds:     .splat (smallest decode overhead)
```

---

## GPU Memory Costs

### Runtime Memory Per Splat

GPU memory during rendering exceeds file size due to sorting buffers, projected 2D data, and SH evaluation caches. The render-pass overhead is a fixed ~68 bytes/splat regardless of SH degree:

| Component | Bytes/Splat | Notes |
|-----------|-------------|-------|
| **Stored splat data** | | |
| Position + rotation + scale + opacity | 44 | Fixed, all SH degrees |
| SH degree 0 (DC color only) | 12 | 3 floats (RGB) |
| SH degree 1 | 48 | +36 bytes over SH0 |
| SH degree 2 | 108 | +60 bytes over SH1 |
| SH degree 3 (full) | 192 | +84 bytes over SH2 |
| **Render-pass overhead** | | |
| 2D projection + conic + alpha | 24 | Per-frame precompute |
| Pre-evaluated RGB from SH | 12 | View-dependent color |
| Tile bounds + touch count | 8 | Tile rasterizer |
| Radix sort key + value + aux | ~24 | Back-to-front ordering |
| **Render subtotal** | **~68** | Fixed per splat |

**Total GPU memory per splat (stored + render pass):**

| SH Degree | Stored | + Render Overhead | Total/Splat |
|-----------|--------|-------------------|-------------|
| 0 (DC only) | 56 B | 68 B | **124 B** |
| 1 | 92 B | 68 B | **160 B** |
| 2 | 152 B | 68 B | **220 B** |
| 3 (full) | 236 B | 68 B | **304 B** |

> **Source:** CUDA rasterizer attribute layout analysis (Kerbl et al. 2023). WebGL packs attributes into textures, adding ~10–20% overhead from alignment padding vs CUDA's tightly-packed arrays.

### Total GPU Memory by Scene Size

Includes ~50 MB fixed framebuffer overhead (color, depth, alpha-accumulation buffers at 1080p):

| Splat Count | VRAM (SH0) | VRAM (SH1) | VRAM (SH3) | Typical SPZ File | Typical PLY File |
|-------------|-----------|-----------|-----------|-----------------|-----------------|
| 100K | ~62 MB | ~66 MB | ~80 MB | ~1–2 MB | ~7–25 MB |
| 500K | ~112 MB | ~130 MB | ~202 MB | ~6–12 MB | ~34–124 MB |
| 1M | ~174 MB | ~210 MB | ~354 MB | ~12–25 MB | ~68–248 MB |
| 2M | ~298 MB | ~370 MB | ~658 MB | ~24–50 MB | ~136–496 MB |
| 5M | ~670 MB | ~850 MB | ~1,570 MB | ~60–125 MB | ~340 MB–1.2 GB |
| 10M | ~1,290 MB | ~1,650 MB | ~3,090 MB | ~120–250 MB | ~680 MB–2.5 GB |

### Memory Budget Guidelines

| Device Tier | Safe Splat GPU Budget | Notes |
|-------------|----------------------|-------|
| Budget Mobile | ~100–200 MB | Leave room for OS, browser, mesh textures |
| Mid-range Mobile | ~200–400 MB | iOS Safari kills tabs above ~1.5 GB total process memory |
| Flagship Mobile / Tablet | ~300–500 MB | Even M-series iPads hit Safari memory ceiling |
| Integrated GPU Laptop | ~500 MB–1 GB | Shared system memory |
| Mid-range Dedicated GPU | ~1–2 GB | Dedicated VRAM |
| High-end Desktop | ~2–4 GB | Dedicated VRAM, plenty of headroom |

> **Critical:** These budgets must account for mesh textures, Three.js scene overhead, and browser/OS overhead. A single uncompressed 4K texture with mipmaps costs ~85 MB — see [Mesh Performance Guide](MESH_PERFORMANCE_GUIDE.md) for texture memory details.

---

## Spark.js 2.0 LOD Tuning

Spark.js 2.0 introduces a hierarchical LOD system that renders only a budgeted subset of splats per frame, prioritizing those closest to the camera and within the view frustum.

### Core LOD Parameters

| Parameter | Default | Range | Effect |
|-----------|---------|-------|--------|
| `lodSplatCount` | 1.5M (desktop) | 100K–20M+ | Hard cap on splats rendered per frame |
| `lodSplatScale` | 1.0 | 0.1–10+ | Multiplier on default budget (2.0 = 3M desktop) |
| `behindFoveate` | 1.0 | 0.0–1.0 | Scale for splats behind camera. Lower = more aggressive culling |
| `coneFov` | 0.0 | 0.0–π | Half-angle of priority cone. 1.0 ≈ 57° (matches 60° camera FOV) |
| `coneFoveate` | 1.0 | 0.0–1.0 | Scale at cone edge. Lower = more center-focused |
| `enableLod` | true | — | Master LOD toggle |

### Vitrine3D Current Settings (in `constants.ts`)

```typescript
export const SPARK_DEFAULTS = {
    CLIP_XY: 2.0,           // Prevent edge popping
    MIN_ALPHA: 3 / 255,     // Cull near-invisible splats (0.012)
    BEHIND_FOVEATE: 0.1,    // Aggressive behind-camera culling
    CONE_FOV: 1.0,          // ~57° half-angle priority cone
    CONE_FOVEATE: 0.3,      // Deprioritize splats outside view cone
};
```

### LOD Budget by Quality Tier

| Quality Tier | LOD Budget | Rationale |
|-------------|-----------|-----------|
| SD (mobile/low-end) | 1,000,000 | Balance quality with mobile GPU limits |
| HD (desktop/high-end) | 5,000,000 | Full detail for capable hardware |
| VR PC-tethered | 2,000,000 | Stereo rendering doubles fill cost |
| VR Standalone (Quest) | 500,000 | Mobile GPU with stereo overhead |
| Background loading | 250,000 | Reduced to free GPU for asset decode |

> These are overridable via Docker env vars `LOD_BUDGET_SD` and `LOD_BUDGET_HD`, or `APP_CONFIG.lodBudgetSd` / `APP_CONFIG.lodBudgetHd`.

### LOD Tree Construction

Spark 2.0 builds a hierarchical tree that allows efficient subset selection:

- **On-demand:** Set `lod: true` on SplatMesh construction. Tree builds in background worker.
- **Pre-built (SPZ):** Export with LOD tree pre-computed. Files are ~30% larger but load faster (no runtime tree construction). Generated via `transcodeSpz()` at archive export time.
- **LOD base parameter:** Default 1.5 (smooth transitions). Range 1.1–2.0. Value 2.0 uses powers-of-2 downsampling (more discontinuous but faster).

### Recommended Settings by Tier

| Device Tier | lodSplatCount | behindFoveate | coneFov | coneFoveate | maxStdDev | antialias |
|-------------|--------------|---------------|---------|-------------|-----------|-----------|
| Budget Mobile | 500K | 0.05 | 1.0 | 0.2 | √5 | **false** |
| Mid-range Mobile | 1M | 0.1 | 1.0 | 0.3 | √5 | **false** |
| Flagship Mobile | 1M–2M | 0.1 | 1.0 | 0.3 | √8 | **false** |
| Integrated Laptop | 1.5M | 0.1 | 1.0 | 0.3 | √8 | false |
| Mid-range Desktop | 5M | 0.1 | 1.0 | 0.3 | √8 | optional |
| High-end Desktop | 5M–10M | 0.2 | 0.0 | 1.0 | √8 | optional |

> **Critical mobile optimization:** Disabling MSAA (`antialias: false` on WebGLRenderer) is the single most impactful optimization for splat rendering on mobile. MSAA increases bandwidth usage per fragment — combined with high-DPI screens and the heavy overdraw of alpha-blended splats, it can halve frame rates on iOS devices (30–40 FPS → 60 FPS stable). Use FXAA post-process if edge smoothing is desired.

---

## Optimization Pipeline

### Recommended Pipeline for Vitrine3D Archives

```
1. Training Output (1M–50M+ splats, SH3)
   │
   ├─→ Archive (preserve original PLY in .ddim as source file)
   │
   ▼
2. Splat Pruning (optional, in training software)
   │  Remove low-opacity / low-significance splats
   │  Typical reduction: 30–50% with minimal quality loss
   │  Tools: LightGaussian, Mini-Splatting, Nerfstudio prune
   │
   ▼
3. SH Degree Reduction (optional)
   │  Reduce SH3 → SH1 or SH0 for web delivery
   │  SH3 → SH1: ~75% storage reduction, minimal visual impact for most objects
   │  SH3 → SH0: ~80% storage reduction, loses view-dependent effects
   │  Tools: LightGaussian (knowledge distillation), 3dgsconverter
   │
   ▼
4. SPZ Export
   │  Convert to SPZ format (~10x smaller than PLY)
   │  Tools: Niantic spz library, 3dgsconverter, Spark.js transcodeSpz()
   │
   ▼
5. LOD Tree Generation (at archive export in Vitrine3D)
   │  transcodeSpz() generates hierarchical LOD tree
   │  Output: SPZ with pre-built LOD (~30% larger than base SPZ)
   │  This runs automatically when "Generate Splat LOD" is checked in editor
   │
   ▼
6. Include in .ddim Archive
   │  Splat stored as assets/scene_0.spz (or scene_0.ply for archive)
   │  SD proxy: scene_0_proxy.spz (lower splat count, SH0)
   │  Serve with gzip/brotli for additional transfer savings
```

### Pruning Strategies

| Strategy | Typical Reduction | Quality Impact | Best For |
|----------|------------------|---------------|----------|
| **Opacity threshold** | 10–20% | None (removes invisible splats) | All scenes, first pass |
| **Significance scoring** | 30–50% | Minimal (<0.1 dB PSNR loss) | Dense scenes with redundant coverage |
| **Spatial redistribution** | 80–87% | Minimal (−0.17 dB) | All scenes; requires retraining |
| **Importance-guided** | 85–90% | Low (−0.1–0.3 dB) | Mobile-first delivery |
| **Aggressive (LightGaussian)** | ~93% (15x total) | Low–moderate | Maximum compression |

> **Academic consensus (6 papers, 2024–2026):** 50% pruning → near-zero quality loss. 90% pruning → 0.1–0.3 dB PSNR loss, below the typical perceptual threshold (~0.5 dB). Simple opacity-threshold pruning (the `minAlpha` slider) does **not** achieve these results — importance-guided methods (Mini-Splatting, PUP 3D-GS, LightGaussian) are required for aggressive pruning.

**Key result:** Mini-Splatting (ECCV 2024) achieves equivalent quality using only 200K–570K splats from scenes that train to 1.8M–4.9M — a 7–8x reduction with PSNR within 0.17 dB and rendering speed 4.2x faster.

### SH Compression Techniques

| Technique | Size Reduction | Quality Impact |
|-----------|---------------|---------------|
| FP32 → FP16 | 2x on SH data | Negligible |
| FP32 → 8-bit quantized | 4x on SH data | Minimal |
| Vector quantization (16K palette) | ~15x on SH data | Minor artifacts in reflections |
| Knowledge distillation (SH3→SH1) | ~4x total | Subtle loss of specular detail |
| Remove SH entirely (SH0) | ~4x total | Flat color, no view-dependent effects |

---

## WebGL-Specific Constraints

### Fill Rate is the Primary Bottleneck

Unlike mesh rendering (draw-call bound), Gaussian splat rendering is **fill-rate bound**. Every splat is alpha-blended, meaning:

- Each pixel may be touched by 10–50+ overlapping splats (high overdraw)
- Sorting is required per-frame (CPU cost for sort, GPU cost for blending)
- Higher resolution = proportionally more fill work (no LOD shortcut for this)

| Factor | Impact on Splat Performance |
|--------|---------------------------|
| **Screen resolution** | Linear. 4K = 4x fill cost vs 1080p |
| **Pixel ratio** | Quadratic. ratio 2 = 4x pixels vs ratio 1 |
| **MSAA** | Severe. 4x MSAA = 4x bandwidth per fragment. **Disable for splats.** |
| **Splat density** | Localized overdraw spikes (e.g., 1M splats in a small area is worse than 1M spread across a room) |
| **Alpha complexity** | More semi-transparent splats = more blending passes |
| **Thermal throttling** | Mobile GPUs throttle 40–60% after 2–3 min of sustained rendering |

### Overdraw by Scene Type

Every pixel within a splat's projected ellipse incurs a read + blend operation. Typical scenes exhibit 10–30x overdraw — far higher than opaque mesh rendering:

| Scene Type | Avg Overdraw | Examples |
|------------|-------------|---------|
| Sparse outdoor / aerial | 3–8x | Drone captures, terrain overviews |
| Bounded outdoor | 10–20x | Garden, bicycle, street-level scans |
| Dense indoor | 20–40x | Room interiors, kitchens, offices |
| Close-up product / macro | 30–60x | Jewelry, small artifact scans |

> **Implication:** A dense indoor scene at 1M splats with 30x overdraw requires ~0.93 Gfrag/s at 30 FPS (1080p). Budget mobile GPUs (Mali-G52: ~1–2 Gfrag/s sustained) are at their limit; flagship mobile (Apple A17 Pro: ~14 Gfrag/s sustained) has comfortable headroom.

### Antialiasing Recommendations

| Method | Cost | Quality | Recommendation |
|--------|------|---------|---------------|
| MSAA (native) | Very high | Good for geometry, wasted on splats | **Disable** (`antialias: false`) |
| FXAA (post-process) | Low | Adequate edge smoothing | Use if needed |
| No AA | Zero | Acceptable for splat-heavy scenes | Default for mobile |

> **Real-world data:** iPhone 15 Pro: 30–40 FPS with MSAA → 60 FPS stable without MSAA on the same scene. Samsung S24: 60–120 FPS without MSAA.

### Pixel Ratio Considerations

Spark.js docs note that reducing `devicePixelRatio` can improve performance when scenes are primarily splats. The existing `RENDERER.MAX_PIXEL_RATIO: 2` cap in `constants.ts` is appropriate; consider reducing to 1.5 or 1.0 for mobile splat-heavy scenes.

### maxStdDev Tuning

`maxStdDev` controls the maximum splat extent. Default is `Math.sqrt(8)` ≈ 2.83. Reducing to `Math.sqrt(5)` ≈ 2.24 provides:
- ~35% fewer pixels rendered per large splat
- "Perceptually very similar to the default" (Spark.js docs)
- Recommended for VR and mobile (`VR.MAX_STD_DEV` already set to `Math.sqrt(5)`)

### Memory Management

Spark.js splat data is stored in GPU buffers. Like Three.js geometries, these are **not garbage collected**. Always call `.dispose()` on SplatMesh when removing from the scene. The existing `disposeObject()` utility handles this for standard Three.js objects; SplatMesh disposal is handled in `splat-loader.ts`.

---

## Quick Reference Card

### "How many splats should I use?"

| I'm scanning a... | Size | SD Devices (Mobile) | HD Devices (Desktop) |
|-------------------|------|--------------------|--------------------|
| Ring / jewelry | 5–10 cm | 100K–200K | 300K–500K |
| Shoe / artifact | 15–40 cm | 200K–400K | 500K–1M |
| Bust / pottery | 30–60 cm | 300K–500K | 700K–1M |
| Chair / small sculpture | 0.5–1.5 m | 500K–1M | 1M–2M |
| Full figure / large sculpture | 1.5–3 m | 800K–1.5M | 1.5M–3M |
| Car / large machinery | 3–6 m | 1M–2M | 2M–5M |
| Monument / room interior | 5–15 m | 1.5M–2M | 3M–5M |
| Building facade | 15–30 m | 2M–3M | 5M–8M |
| Full building / complex | 30+ m | 2M–5M | 5M–10M+ |

### "What file format should I use?"

| Purpose | Format | Why |
|---------|--------|-----|
| Archive / preservation | PLY (SH3) | Full fidelity, no lossy compression |
| Web delivery (primary) | SPZ with LOD | 10x smaller, LOD support, Khronos standardized |
| Quick embed / preview | .splat | Smallest decode overhead, widest viewer support |
| PlayCanvas interop | SOG | PlayCanvas ecosystem native format |

### "What SH degree should I use?"

| Scenario | SH Degree | Why |
|----------|-----------|-----|
| Mobile delivery | 0 | Smallest file size, adequate for most objects |
| Desktop web delivery | 1 | Good quality/size tradeoff, basic view-dependent color |
| Desktop presentation | 1–2 | Smooth reflections for glossy/metallic objects |
| Archive / reprocessing | 3 | Full fidelity preservation |

### "What Spark settings should I use?"

| Scenario | lodSplatCount | behindFoveate | antialias | pixelRatio |
|----------|--------------|---------------|-----------|------------|
| Mobile kiosk | 1M | 0.1 | false | 1.0–1.5 |
| Desktop kiosk | 5M | 0.1 | optional | ≤2 |
| Editor (desktop) | 5M | 0.1 | optional | ≤2 |
| VR (PC tethered) | 2M | 0.1 | false | 0.5 (XR) |
| VR (standalone) | 500K | 0.05 | false | 0.5 (XR) |
| During asset loading | 250K | 0.05 | false | 1.0 |

---

## Sources

- [Spark.js — Performance Tuning](https://sparkjs.dev/docs/performance/)
- [Spark.js — New SparkRenderer 2.0 (LOD Deep Dive)](https://sparkjs.dev/2.0.0-preview/docs/new-spark-renderer/)
- [Niantic — SPZ Open Source Format](https://github.com/nianticlabs/spz)
- [Khronos — glTF Gaussian Splatting Extension](https://www.ogc.org/blog-article/ogc-khronos-and-geospatial-leaders-add-3d-gaussian-splats-to-the-gltf-asset-standard/)
- [3D Gaussian Splatting (Kerbl et al. 2023)](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)
- [PlayCanvas — Compressing Gaussian Splats](https://blog.playcanvas.com/compressing-gaussian-splats/)
- [Aras Pranckevičius — Making Gaussian Splats Smaller](https://aras-p.info/blog/2023/09/13/Making-Gaussian-Splats-smaller/)
- [Aras Pranckevičius — Making Gaussian Splats More Smaller](https://aras-p.info/blog/2023/09/27/Making-Gaussian-Splats-more-smaller/)
- [LightGaussian — 15x Compression, 200+ FPS](https://lightgaussian.github.io/)
- [Reducing the Memory Footprint of 3D Gaussian Splatting (Papantonakis et al. 2024)](https://repo-sam.inria.fr/fungraph/reduced_3dgs/)
- [NVIDIA — Real-Time GPU-Accelerated Gaussian Splatting](https://developer.nvidia.com/blog/real-time-gpu-accelerated-gaussian-splatting-with-nvidia-designworks-sample-vk_gaussian_splatting/)
- [Babylon.js Forum — iOS vs Android Splat Performance](https://forum.babylonjs.com/t/gaussian-splat-low-performance-on-ios-devices-vs-android/62455)
- [3DGS.zip — Survey on 3DGS Compression Methods (2025)](https://onlinelibrary.wiley.com/doi/10.1111/cgf.70078)
- [Mini-Splatting — ECCV 2024 (Fang & Wang)](https://arxiv.org/abs/2403.14166)
- [LightGaussian — NeurIPS 2024 Spotlight (Fan et al.)](https://lightgaussian.github.io/)
- [PUP 3D-GS — CVPR 2025 (Hanson et al.)](https://arxiv.org/abs/2406.10219)
- [Reducing the Memory Footprint of 3DGS — I3D 2024 (Papantonakis et al.)](https://repo-sam.inria.fr/fungraph/reduced_3dgs/)
- [GaussianSpa — CVPR 2025 (Zhang et al.)](https://arxiv.org/abs/2411.06966)
- [HuggingFace — Introduction to 3D Gaussian Splatting](https://huggingface.co/blog/gaussian-splatting)
