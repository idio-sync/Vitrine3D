# SplatForge — LiDAR-Supervised Gaussian Splat Training Tool

**Date:** 2026-03-14
**Status:** Approved
**Repo:** Standalone (new repo, separate from Vitrine3D)

## Problem

Gaussian splat training from photogrammetry alone produces splats with geometric inaccuracies — floaters, blobby surfaces, and poor novel view synthesis. LiDAR data can dramatically improve quality by providing depth and normal supervision during training, but no GUI tool exists to streamline this workflow on Windows.

## Solution

A Python desktop app (DearPyGui) that wraps Nerfstudio + DN-Splatter. The GUI handles E57 ingestion, depth/normal map generation, training configuration, and export. The user's existing workflow (Metashape → COLMAP cameras) stays unchanged — SplatForge picks up where Metashape leaves off.

## Architecture

```
┌──────────────────────────────────┐
│        DearPyGui Desktop GUI     │
│  ┌────────┬─────────┬──────────┐ │
│  │Project │Training │  Export   │ │
│  │ Setup  │ Monitor │ & Viewer │ │
│  └────┬───┴────┬────┴────┬─────┘ │
│       │        │         │       │
│  ┌────▼────────▼─────────▼─────┐ │
│  │     Pipeline Orchestrator    │ │
│  └────┬────────┬─────────┬─────┘ │
└───────│────────│─────────│───────┘
        │        │         │
   ┌────▼───┐ ┌─▼──────┐ ┌▼────────┐
   │  E57   │ │Nerfstudio│ │ Export  │
   │Ingest +│ │  + DN-  │ │ (splat  │
   │Depth/  │ │Splatter │ │ + depth │
   │Normal  │ │Training │ │ + normals│
   │Gen     │ │         │ │  maps)  │
   └────────┘ └─────────┘ └─────────┘
       ▲           ▲
   Open3D      PyTorch/gsplat
   pye57       nerfacc, etc.
```

## Three-Phase Workflow

### Phase 1: Project Setup

**Input:** A folder containing:
- `colmap/` — Metashape COLMAP export (cameras.txt, images.txt, points3D.txt)
- `images/` — Source photos
- `scans/` — One or more E57 files

**Processing:**
1. Detect and validate folder contents
2. Show 3D preview (point cloud + camera frustums) for visual alignment confirmation
3. Project E57 cloud into each camera viewpoint via Open3D raycasting → 32-bit depth maps
4. Estimate normals from E57 cloud, project into each camera view → 32-bit normal maps
5. Write depth/normal maps to project folder, save config as JSON

**Exposed knobs:**
- Depth map resolution (default: match source images, option to downscale)
- Normal estimation radius (auto-detected from point density, manual override)
- Multi-scan merge toggle

**Performance:** ~2-5 minutes for 200 images + one E57 on a 4090. E57 loading is the bottleneck.

### Phase 2: Training

**One-click "Train" with sensible defaults:**

| Parameter | Default | GUI Control |
|---|---|---|
| Method | dn-splatter | Dropdown: dn-splatter, splatfacto, nerfacto |
| Iterations | 30,000 | Slider: 10k–100k |
| Depth loss weight | 0.2 | Slider: 0.0–1.0 |
| Normal loss weight | 0.1 | Slider: 0.0–1.0 |
| RGB loss | L1 + SSIM | Toggle: L1-only / L1+SSIM / L1+SSIM+LPIPS |
| Resolution | Match source | Dropdown: full / half / quarter |
| Output format | .ply | Dropdown: .ply / .splat |

**Presets:**
- **Quick preview** — 10k iters, half res, depth only. ~5 min.
- **Standard** — 30k iters, full res, depth + normal. ~15-20 min.
- **Maximum quality** — 60k iters, full res, depth + normal + LPIPS. ~40 min.

**Monitoring:**
- Training runs as a Nerfstudio subprocess
- GUI shows: iteration count, loss curves (RGB/depth/normal), elapsed time, ETA
- Nerfstudio web viewer auto-opens at localhost:7007 for live preview
- "Stop Early" button preserves latest checkpoint

### Phase 3: Export

**Always produced:**
- `splat.ply` — standard 3DGS format, loadable in Vitrine3D, SuperSplat, etc.

**Optional exports (checkboxes):**
- Depth/normal maps (EXR) — LiDAR-derived, per-keyframe, 32-bit float
- Mesh extraction — TSDF fusion or SuGaR → .glb
- Compact .splat — compressed format for web delivery

**Export structure:**
```
my-project/export/
├── splat.ply
├── splat.splat          # If compact selected
├── mesh.glb             # If mesh extraction selected
├── depth/               # If depth maps selected
│   ├── DSC_0001_depth.exr
│   └── ...
└── normals/             # If normal maps selected
    ├── DSC_0001_normal.exr
    └── ...
```

**Vitrine3D integration:** Output .ply/.splat drops directly into the Vitrine3D editor for annotations, metadata, and .ddim/.vdim archive creation.

## Tech Stack

| Package | Purpose |
|---|---|
| Python 3.11 | Runtime |
| PyTorch 2.1+ (CUDA 12.1) | Training backend |
| Nerfstudio | Training framework |
| DN-Splatter | Depth + normal supervised splatting |
| gsplat | CUDA Gaussian splatting kernels |
| Open3D | E57 projection, normal estimation, TSDF |
| pye57 | E57 file reading |
| DearPyGui | Desktop GUI |
| numpy, opencv-python | Image processing |
| OpenEXR / Imath | EXR I/O |

**Environment:** Conda (environment.yml). First-run script validates CUDA and installs DN-Splatter as a Nerfstudio method.

## Repo Structure

```
splatforge/
├── environment.yml
├── setup.py
├── README.md
├── splatforge/
│   ├── __init__.py
│   ├── app.py               # GUI entry point
│   ├── project.py           # Project creation, validation, config I/O
│   ├── ingest/
│   │   ├── e57_loader.py    # E57 → Open3D point cloud
│   │   ├── depth_gen.py     # Cloud → per-camera depth maps
│   │   └── normal_gen.py    # Estimate + project normals
│   ├── training/
│   │   ├── config.py        # Presets, param mapping
│   │   ├── launcher.py      # Nerfstudio subprocess management
│   │   └── monitor.py       # Log parsing, loss curves
│   ├── export/
│   │   ├── splat_export.py  # .ply/.splat output
│   │   ├── mesh_export.py   # TSDF/SuGaR mesh extraction
│   │   └── maps_export.py   # Depth/normal EXR packaging
│   └── ui/
│       ├── setup_panel.py   # Project setup view
│       ├── train_panel.py   # Training + monitor view
│       ├── export_panel.py  # Export options view
│       └── preview.py       # 3D alignment preview
└── tests/
    ├── test_depth_gen.py
    ├── test_normal_gen.py
    └── test_config.py
```

## Out of Scope (v1)

- Metashape automation (Python API integration)
- E57 scan-to-scan registration
- Photo-to-LiDAR registration (Metashape's job)
- Multi-GPU training
- Cloud/remote training
- Batch processing (multiple projects)
- Custom splat viewer (uses Nerfstudio's web viewer + Vitrine3D)

## How LiDAR Depth/Normal Supervision Works

Depth and normal maps are used as **training supervision signals**, not stored in the splat format. Each Gaussian splat stores position, covariance, color (SH coefficients), and opacity. During training, DN-Splatter adds loss terms that penalize rendered depth/normals diverging from the LiDAR ground truth. The result is a splat with better geometry — fewer floaters, surfaces aligned to real surfaces, consistent novel views — without any format changes.

For deliverables requiring raw measurement data, the LiDAR-derived depth/normal EXRs can be exported alongside the splat as an optional step.

## Hardware Requirements

- NVIDIA GPU with CUDA 12.1+ (tested on RTX 4090 24GB)
- 32GB+ system RAM recommended for large E57 files
- Windows 10/11
