# LiDAR-Supervised Gaussian Splatting — Reference Guide

**Date:** 2026-03-14
**Purpose:** Compiled reference on using LiDAR data with depth/normal supervision to maximize Gaussian splat quality.

---

## 1. Why LiDAR Improves Splat Quality

Standard Gaussian splat training (3DGS) optimizes purely on photometric loss — it tries to make rendered images match training photos. This works well for appearance but produces geometry that is only "visually plausible" from trained viewpoints. Common artifacts:

- **Floaters** — splats suspended in free space that look correct from training angles but appear as noise from novel views
- **Blobby surfaces** — overlapping splats approximate a surface visually but don't align to the real surface plane
- **Novel view degradation** — the further you move from a training camera, the worse it looks
- **Textureless region failure** — white walls, floors, ceilings have no photometric signal to guide geometry placement

LiDAR provides millimeter-accurate geometry that photogrammetry cannot achieve on these surfaces. Using it during training constrains the optimizer to place splats where real surfaces actually are.

## 2. Three Ways LiDAR Data Enters the Pipeline

### 2a. Better Camera Poses (Indirect)

Register photos to LiDAR in Metashape before exporting COLMAP cameras. The bundle adjustment is constrained by LiDAR geometry, producing more accurate camera poses. Bad poses are the #1 killer of splat quality — this alone is a significant improvement.

**How:** Import E57 into Metashape as reference/control geometry. Run alignment with photos registered to the scan. Export COLMAP format.

### 2b. Point Cloud Initialization (Moderate Impact)

Use the LiDAR point cloud as the initial point cloud for splat training instead of SfM sparse points. The optimizer starts from accurate geometry rather than noisy sparse reconstruction.

**How:** Export LiDAR as PLY, downsample to 1-5M points, provide as initial points in the training data. Most frameworks (Nerfstudio, gsplat) accept this.

**Impact:** Fewer floaters, faster convergence. But without depth/normal supervision, the optimizer can still drift away from the LiDAR geometry during training.

### 2c. Depth + Normal Supervision (Highest Impact)

Generate per-camera depth and normal maps by projecting the LiDAR cloud into each training viewpoint. Add these as loss terms during training — the optimizer is penalized when rendered depth/normals diverge from LiDAR ground truth.

**How:** For each camera pose, raycasting or z-buffer projection of the LiDAR cloud produces a depth image. Normal maps are derived from the cloud's estimated normals projected the same way. These become supervision targets alongside RGB images.

**Impact:** This is where the largest quality gains come from:
- Splats align to real surface planes (not just visually approximate them)
- Floaters are eliminated — depth says nothing is there
- Textureless regions are correctly reconstructed
- Novel views remain consistent because geometry is physically correct
- Resulting splats are more compact (fewer splats needed when each is well-placed)

## 3. Is This the Highest Quality Path?

**For photorealistic reconstruction of real-world scenes: yes, this is the current state-of-the-art approach.**

The quality hierarchy for Gaussian splatting, from lowest to highest:

1. **Photos only (SfM poses, SfM sparse init)** — baseline 3DGS. Good appearance, unreliable geometry.
2. **Photos + monocular depth estimation (DPT, ZoeDepth, Depth Anything)** — uses AI-estimated depth from single images as weak supervision. Improves geometry without extra hardware, but monocular depth is relative (not metric) and can be inaccurate.
3. **Photos + LiDAR initialization** — better starting point, still drifts during training.
4. **Photos + LiDAR depth supervision** — metric depth constraint at every training step. Strong geometry.
5. **Photos + LiDAR depth AND normal supervision** — the full pipeline. Best geometry, most compact models, best novel view synthesis. This is what DN-Splatter implements.

**What won't improve further with this approach:**
- Color/appearance quality is bounded by your photo quality (lighting, exposure, lens sharpness, coverage). LiDAR doesn't help here.
- Specular/reflective surfaces remain challenging — splats represent diffuse appearance via spherical harmonics. Some newer methods (3DGS with specular extensions) address this but are not yet in DN-Splatter.

**Emerging methods that may push quality further (future, not ready for production):**
- **2D Gaussian Splatting (2DGS)** — flat disc splats instead of 3D ellipsoids. Naturally better surface representation. Has native normal supervision support.
- **GOF (Gaussian Opacity Fields)** — better surface extraction from splats.
- **Scaffold-GS** — structured anchor points reduce redundancy.
- These could be swapped into SplatForge as alternative training methods when they mature in Nerfstudio.

## 4. The Depth/Normal Map Generation Process

### Depth Maps

For each camera in the COLMAP export:

1. Load camera intrinsics (focal length, principal point, distortion) and extrinsics (position, orientation)
2. Load the LiDAR point cloud (E57 → numpy via pye57 → Open3D)
3. Project every LiDAR point into the camera's image plane
4. For each pixel, keep the nearest point (z-buffer)
5. Output: 32-bit float image where each pixel = distance from camera to surface in meters
6. Holes (pixels with no LiDAR coverage) are masked and excluded from the depth loss

### Normal Maps

1. Estimate normals on the LiDAR point cloud (Open3D `estimate_normals` with KNN or radius search)
2. Orient normals consistently (towards camera positions)
3. Project normals into each camera viewpoint the same way as depth
4. Output: 32-bit float RGB image where R/G/B = X/Y/Z components of the surface normal in camera space

### Key Parameters

- **Normal estimation radius:** Controls smoothness. Too small = noisy normals on sparse regions. Too large = over-smoothed edges. Auto-detect from median point spacing, allow manual override.
- **Depth map resolution:** Match source photo resolution by default. Can downscale 2x for faster training with minimal quality loss.
- **Hole filling:** Don't fill holes — masked pixels are simply excluded from the loss. Filling introduces false data.

## 5. How Supervision Works During Training

Standard 3DGS loss:
```
L = (1 - λ_ssim) * L1(rendered_rgb, target_rgb) + λ_ssim * SSIM(rendered_rgb, target_rgb)
```

With depth + normal supervision (DN-Splatter):
```
L = L_rgb + λ_depth * L_depth + λ_normal * L_normal

L_depth = L1(rendered_depth, lidar_depth)  [masked to valid pixels]
L_normal = 1 - dot(rendered_normal, lidar_normal)  [masked to valid pixels]
```

**Recommended loss weights:**
- `λ_depth = 0.2` — strong enough to constrain geometry, not so strong it overrides appearance
- `λ_normal = 0.1` — normals are noisier than depth, so weighted lower
- These are starting points. Increase depth weight for scenes with large textureless areas. Decrease for highly textured outdoor scenes where photometric loss is already informative.

## 6. What the Splat Stores vs. What LiDAR Provides

| Data | In the splat? | From LiDAR? |
|---|---|---|
| Position (xyz) | Yes — per splat | Used as initialization + depth supervision |
| Color (SH coefficients) | Yes — per splat | No — comes from photos |
| Covariance (shape/orientation) | Yes — per splat | Normal supervision guides orientation |
| Opacity | Yes — per splat | No |
| Depth map | No — but can be rendered from splat at any viewpoint | Yes — LiDAR ground truth, exportable as EXR |
| Normal map | No — but can be rendered from splat | Yes — LiDAR ground truth, exportable as EXR |
| Metric scale | Implicit if trained with LiDAR depth | Yes — millimeter accuracy |

The splat format itself is unchanged. LiDAR's contribution is entirely through training — the result is a standard .ply that any viewer can load, it just has better geometry than one trained without LiDAR.

## 7. Practical Capture Tips

- **Overlap is critical.** The E57 scan and photos must cover the same space. Gaps in LiDAR coverage = gaps in supervision = those areas fall back to photo-only quality.
- **Multiple scan positions** for interiors. A single scan has occlusion shadows behind furniture, corners, etc. Register multiple scans in your scanner software before bringing into Metashape.
- **Photo coverage still matters.** LiDAR fixes geometry but appearance comes from photos. Shoot enough photos to cover all surfaces with 60-80% overlap, consistent lighting.
- **Consistent coordinate system.** Register photos to LiDAR in Metashape BEFORE exporting COLMAP. If the coordinate systems don't match, depth supervision will actively hurt quality (wrong depth at every pixel).
- **E57 intensity is not used.** Only geometry (XYZ) and derived normals. LiDAR intensity/color is too noisy to contribute to appearance.

## 8. SplatForge — App Outline

See full design: `2026-03-14-splatforge-design.md`

**What it is:** A Python desktop app (DearPyGui) wrapping Nerfstudio + DN-Splatter. Handles the workflow from E57 + COLMAP input through depth/normal generation, training, and export.

**Three phases:**
1. **Project Setup** — point at folder with COLMAP cameras + E57 scans. App generates depth/normal maps via Open3D projection. Visual alignment check.
2. **Training** — one-click with presets (Quick ~5min, Standard ~20min, Max Quality ~40min on 4090). Live viewer via Nerfstudio. Adjustable loss weights, iterations, resolution.
3. **Export** — .ply splat (always), optional depth/normal EXRs, optional mesh extraction, optional compressed .splat for web.

**Key tech:** Python 3.11, PyTorch + CUDA, Nerfstudio, DN-Splatter, Open3D, pye57, DearPyGui.

**Output integrates with Vitrine3D** — load the .ply in the editor, add annotations/metadata, export as .ddim/.vdim archive.

**v1 scope boundary:** No Metashape automation, no scan registration, no multi-GPU, no batch processing. Single project, single GPU, local only.
