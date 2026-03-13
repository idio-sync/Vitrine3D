# VAAPI GPU-Accelerated Video Transcode

**Date:** 2026-03-12
**Status:** Approved

## Problem

The video recording pipeline captures WebGL canvas via MediaRecorder (VP9 at 5Mbps), then re-encodes server-side with `libx264 -crf 18 -preset fast`. The double-encode at low source bitrate produces visible blockiness — compression artifacts from the VP9 source are amplified during H.264 re-encoding.

## Solution

Two-part fix:

1. **Bump client capture bitrate** from 5Mbps to 16Mbps so the source VP9 WebM is high quality.
2. **Hardware-accelerated AV1 encoding** via Intel VAAPI on an Intel Arc A310 GPU passed through to Docker on Unraid. AV1 is ~30-50% more efficient than VP9/H.264 at equivalent quality, producing smaller files with better visual fidelity.

## Deployment Context

- **Server:** Dedicated Unraid server
- **GPU:** Intel Arc A310 (shared via `/dev/dri` across containers)
- **Container:** Docker with alpine base, GPU passthrough via `--device /dev/dri:/dev/dri`

## Design

### Client-Side Capture Bitrate

Update `recording.bitrate` default from 5,000,000 (5Mbps) to 16,000,000 (16Mbps).

- `docker/meta-server.js` settings registry default
- `src/modules/recording-manager.ts` fallback default

16Mbps at 1080p/30fps produces ~120MB/min raw uploads (vs ~37MB/min at 5Mbps). Raw files are ephemeral — deleted after transcode. No UI changes needed; the admin settings panel already exposes this setting.

**Upload size limit:** The existing `upload.maxSizeMb` setting (default 200MB) accommodates recordings up to ~100 seconds at 16Mbps. For longer recordings at max duration (300s = ~360MB), the admin should increase this setting. The spec does not change the default — 200MB covers the default 60s max duration comfortably.

### Docker GPU Passthrough

**Dockerfile additions:**

```dockerfile
apk add --no-cache ffmpeg libva-utils \
  --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community intel-media-driver
```

- `intel-media-driver`: VAAPI iHD driver for Intel Arc GPUs. **Not available in Alpine stable** — must pull from `edge/community` repo explicitly. The `--repository` flag scopes this to a single package without switching the entire image to edge.
- `libva-utils`: Provides `vainfo` for runtime GPU capability probing (available in stable)

**Unraid deployment:** User configures `--device /dev/dri:/dev/dri` on the container. This is a standard Unraid GPU passthrough pattern used by Plex/Jellyfin containers. No code change — deployment configuration only.

**Runtime GPU probe:** On `meta-server.js` startup, run `vainfo` and parse output to build a capability map:

```javascript
// Success case:
{ vaapi: true, encoders: ['av1_vaapi', 'hevc_vaapi', 'h264_vaapi'], device: 'Intel Arc A310' }

// No GPU case:
{ vaapi: false, encoders: ['libx264'], device: null }
```

Result is stored in memory and logged. No hard dependency on GPU — graceful fallback to software encoding.

### Admin Settings

**New setting: `video.codec`** (select dropdown)

| Value | Encoder | Requires GPU |
|-------|---------|-------------|
| `auto` (default) | AV1 if VAAPI available, else H.264 software | No |
| `av1` | `av1_vaapi` | Yes |
| `hevc` | `hevc_vaapi` | Yes |
| `h264-hw` | `h264_vaapi` | Yes |
| `h264` | `libx264` software | No |

Explicit GPU codec selection errors if no GPU is detected, rather than silently falling back. This surfaces GPU problems to the admin.

**Renamed setting: `video.crf` → display label "Quality"**

The existing `video.crf` SQLite key and `VIDEO_CRF` env var are kept as-is to avoid breaking existing deployments. Only the admin panel display label changes to "Quality" since the value now maps to either `crf` (libx264) or `global_quality` (VAAPI ICQ mode). Same numeric scale — lower values = higher quality. Default: 18.

**GPU info display** in admin settings panel: shows detected device name and available hardware encoders, or "No GPU detected — software encoding only." Read-only, populated from startup probe.

### FFmpeg Pipeline Changes

**Encoder selection function** resolves final encoder + FFmpeg args based on `video.codec` setting and runtime GPU capabilities:

- `auto` + VAAPI available → `av1_vaapi`
- `auto` + no VAAPI → `libx264`
- Explicit codec → use requested encoder; error if hardware unavailable

**VAAPI encode command (Step 1 replacement):**

```bash
ffmpeg -vaapi_device /dev/dri/renderD128 \
  -ss {trimStart} -to {trimEnd} -i raw.webm \
  -vf "format=nv12,pad=ceil(iw/2)*2:ceil(ih/2)*2,hwupload" \
  -c:v av1_vaapi \
  -global_quality {quality} \
  -an -y output.mp4
```

**Note:** The VAAPI device path `/dev/dri/renderD128` is the default for single-GPU passthrough. A new setting `video.vaapi_device` (default: `/dev/dri/renderD128`) allows admins with non-standard device paths to override.

Key differences from current software path:

- `-vaapi_device` opens the GPU render node
- `-vf` filter ordering: `pad` runs on CPU *before* `hwupload` pushes frames to GPU memory. Any filters after `hwupload` must use VAAPI variants (e.g., `scale_vaapi` not `scale`).
- `-global_quality` replaces `-crf` (maps to ICQ on Intel Arc)
- `-preset` dropped (VAAPI doesn't use it; quality controlled by `global_quality` alone)
- Output stays `.mp4` — AV1 in MP4 container is well-supported

**Software fallback command (unchanged structure):**

```bash
ffmpeg -ss {trimStart} -to {trimEnd} -i raw.webm \
  -vf pad=ceil(iw/2)*2:ceil(ih/2)*2 \
  -c:v libx264 -preset {preset} -crf {quality} \
  -movflags +faststart -an -y output.mp4
```

**Steps 2-4 unchanged:** Thumbnail (JPEG), GIF palette generation, and GIF encode are CPU-bound and unaffected by this change.

**Error handling:** If hardware encode fails mid-transcode (GPU reset, driver issue), log error and set media status to `error` with descriptive message. No automatic fallback to software — silent fallback would mask GPU problems.

## Files Changed

| File | Change |
|------|--------|
| `docker/meta-server.js` | GPU probe on startup, `video.codec` + `video.vaapi_device` settings, encoder selection function, VAAPI encode path, relabel `video.crf` display to "Quality" |
| `docker/Dockerfile` | Add `intel-media-driver libva-utils` to `apk add` |
| `src/modules/recording-manager.ts` | Update default bitrate fallback to 16Mbps |

## Not In Scope

- GIF/thumbnail pipeline changes (CPU-bound, no GPU benefit)
- Client-side codec selection UI (server decides)
- Share page changes (serves MP4 regardless of internal codec)
- Client-side MediaRecorder codec changes (VP9 is a browser limitation)
- HEVC as a separate output format (AV1 covers all browser delivery needs)
- 4K recording support
- QSV/oneVPL (VAAPI is sufficient; QSV can be evaluated later if needed)
