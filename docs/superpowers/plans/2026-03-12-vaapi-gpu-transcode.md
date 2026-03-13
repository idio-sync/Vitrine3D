# VAAPI GPU-Accelerated Video Transcode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace software H.264 encoding with hardware-accelerated AV1 via Intel VAAPI, and bump client capture bitrate to eliminate blockiness.

**Architecture:** Runtime GPU probe on server startup populates a capability map. Encoder selection function resolves codec + FFmpeg args from admin settings + capabilities. VAAPI encode path uses `/dev/dri` device passthrough. Software H.264 fallback when no GPU detected.

**Tech Stack:** FFmpeg (VAAPI, av1_vaapi, hevc_vaapi, h264_vaapi, libx264), Intel Media Driver (iHD), Docker alpine, Node.js (execFile)

**Spec:** `docs/superpowers/specs/2026-03-12-vaapi-gpu-transcode-design.md`

---

## Chunk 1: Client Bitrate + Dockerfile

### Task 1: Bump Client Capture Bitrate Default

**Files:**
- Modify: `src/modules/recording-manager.ts:119`

- [ ] **Step 1: Update default bitrate**

Change the fallback bitrate from 5Mbps to 16Mbps on line 119:

```typescript
// Before:
videoBitsPerSecond: (window as any).APP_CONFIG?.recordingBitrate || 5_000_000,

// After:
videoBitsPerSecond: (window as any).APP_CONFIG?.recordingBitrate || 16_000_000,
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/recording-manager.ts
git commit -m "feat(recording): bump default capture bitrate to 16Mbps

Higher source quality reduces blockiness from double-encode (VP9→AV1/H.264)."
```

---

### Task 2: Bump Server-Side Bitrate Default

**Files:**
- Modify: `docker/meta-server.js:64`

- [ ] **Step 1: Update settings registry default**

Change line 64 in `SETTINGS_DEFAULTS`:

```javascript
// Before:
'recording.bitrate':      { default: '5000000', type: 'number', label: 'Recording Bitrate (bps)', group: 'Video Recording',  description: 'WebM capture bitrate' },

// After:
'recording.bitrate':      { default: '16000000', type: 'number', label: 'Recording Bitrate (bps)', group: 'Video Recording',  description: 'WebM capture bitrate' },
```

- [ ] **Step 2: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(server): bump default recording bitrate to 16Mbps"
```

---

### Task 3: Add GPU Packages to Dockerfile

**Files:**
- Modify: `docker/Dockerfile:18`

- [ ] **Step 1: Add intel-media-driver and libva-utils**

Change line 18:

```dockerfile
# Before:
RUN apk add --no-cache xz gettext python3 unzip libstdc++ ffmpeg && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz

# After:
RUN apk add --no-cache xz gettext python3 unzip libstdc++ ffmpeg libva-utils && \
    apk add --no-cache --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community intel-media-driver && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz
```

The `intel-media-driver` (iHD) is only available in Alpine's `edge/community` repo. The `--repository` flag scopes the edge repo to just this one package — the rest of the image stays on stable alpine.

`libva-utils` provides `vainfo` for runtime GPU capability probing.

- [ ] **Step 2: Commit**

```bash
git add docker/Dockerfile
git commit -m "feat(docker): add Intel VAAPI driver and libva-utils

intel-media-driver from alpine edge/community for Arc GPU hardware encoding.
libva-utils provides vainfo for runtime GPU capability probing."
```

---

## Chunk 2: GPU Probe + Settings

### Task 4: Add VAAPI Runtime GPU Probe

**Files:**
- Modify: `docker/meta-server.js` (add after line 87, before the settings cache)

- [ ] **Step 1: Add GPU probe function and startup call**

Insert after the `SETTINGS_ENV_MAP` block (after line 87) and before the `_settingsCache` declaration:

Note: `execFileSync` is already imported at the top of `meta-server.js` (line 32: `const { execFileSync, execFile } = require('child_process');`). No additional require needed.

```javascript
// --- GPU capability probe ---
// Runs vainfo at startup to detect VAAPI encoders.
// Result stored in gpuCapabilities for use by transcodeMedia().
const gpuCapabilities = { vaapi: false, encoders: ['libx264'], device: null };

function probeGpu() {
    try {
        const output = execFileSync('vainfo', [], {
            encoding: 'utf8',
            timeout: 5000,
            env: { ...process.env, LIBVA_DRIVER_NAME: 'iHD' },
        });

        // Parse device name from "vainfo: Driver version:" line
        const driverMatch = output.match(/Driver version:\s*(.+)/i);
        const device = driverMatch ? driverMatch[1].trim() : 'Unknown VAAPI device';

        // Parse supported encoder profiles
        const encoders = [];
        if (/VAProfileH264/.test(output) && /VAEntrypointEncSlice/.test(output)) encoders.push('h264_vaapi');
        if (/VAProfileHEVC/.test(output) && /VAEntrypointEncSlice/.test(output)) encoders.push('hevc_vaapi');
        if (/VAProfileAV1/.test(output) && /VAEntrypointEncSlice/.test(output)) encoders.push('av1_vaapi');

        if (encoders.length > 0) {
            gpuCapabilities.vaapi = true;
            gpuCapabilities.encoders = [...encoders, 'libx264']; // always include software fallback
            gpuCapabilities.device = device;
            console.log('[gpu] VAAPI available — device:', device, 'encoders:', encoders.join(', '));
        } else {
            console.log('[gpu] VAAPI device found but no supported encoders');
        }
    } catch (err) {
        console.log('[gpu] No VAAPI available (vainfo failed) — using software encoding');
    }
}

probeGpu();
```

- [ ] **Step 2: Add GPU info API endpoint**

Find the existing `/api/settings` GET handler and add a new endpoint nearby:

```javascript
// GET /api/gpu — return GPU capabilities (no auth required, read-only info)
if (req.method === 'GET' && pathname === '/api/gpu') {
    return sendJson(res, 200, gpuCapabilities);
}
```

- [ ] **Step 3: Verify the probe doesn't crash without a GPU**

This runs at startup. Without `/dev/dri` mounted, `vainfo` will fail and the catch block sets the fallback. Verify by reading the code logic — no runtime test possible without Docker.

- [ ] **Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(server): add VAAPI GPU probe on startup

Runs vainfo to detect available hardware encoders (AV1, HEVC, H.264).
Falls back to software libx264 if no GPU detected.
Exposes /api/gpu endpoint for admin panel."
```

---

### Task 5: Add New Settings (video.codec, video.vaapi_device)

**Files:**
- Modify: `docker/meta-server.js:61-76` (SETTINGS_DEFAULTS)
- Modify: `docker/meta-server.js:79-87` (SETTINGS_ENV_MAP)

- [ ] **Step 1: Add video.codec and video.vaapi_device to SETTINGS_DEFAULTS**

Insert after the `video.preset` line (line 63):

```javascript
'video.codec':            { default: 'auto',              type: 'select', label: 'Video Codec',            group: 'Video Transcode',  description: 'auto = AV1 if GPU available, else H.264 software', options: ['auto','av1','hevc','h264-hw','h264'] },
'video.vaapi_device':     { default: '/dev/dri/renderD128', type: 'string', label: 'VAAPI Device Path',    group: 'Video Transcode',  description: 'Render node for hardware encoding' },
```

- [ ] **Step 2: Relabel video.crf display**

Change the existing `video.crf` entry (line 62):

```javascript
// Before:
'video.crf':              { default: '18',      type: 'number', label: 'Video CRF',              group: 'Video Transcode',  description: 'H.264 quality (0=lossless, 51=worst)', min: 0, max: 51 },

// After:
'video.crf':              { default: '18',      type: 'number', label: 'Quality',                 group: 'Video Transcode',  description: 'Encoding quality — maps to CRF (software) or ICQ (hardware). Lower = better.', min: 0, max: 51 },
```

- [ ] **Step 3: Add env var mappings**

Add to `SETTINGS_ENV_MAP`:

```javascript
'video.codec':        'VIDEO_CODEC',
'video.vaapi_device': 'VAAPI_DEVICE',
```

- [ ] **Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(server): add video.codec and video.vaapi_device settings

video.codec: auto/av1/hevc/h264-hw/h264 — controls encoder selection.
video.vaapi_device: configurable render node path (default /dev/dri/renderD128).
Relabeled video.crf to 'Quality' — same key, maps to CRF or ICQ."
```

---

### Task 6: Add GPU Info to Admin Panel

**Files:**
- Modify: `docker/admin.html` (~line 1308 GROUP_DESCRIPTIONS, ~line 1317 GROUP_ORDER, ~line 1329 renderSettings)

- [ ] **Step 1: Update group description for Video Transcode**

```javascript
// Before:
'Video Transcode': 'Controls FFmpeg encoding when converting recordings to MP4.',

// After:
'Video Transcode': 'Controls FFmpeg encoding when converting recordings to MP4. Hardware encoding requires /dev/dri GPU passthrough.',
```

- [ ] **Step 2: Add GPU info banner to renderSettings**

After `container.innerHTML = html;` (line 1377) and before the existing `document.getElementById('settings-actions').style.display = 'flex';` (line 1378), insert code to fetch and display GPU info at the top of the Video Transcode group. The `settings-actions` line must be preserved after this insertion:

```javascript
// Fetch GPU capabilities and show info banner in Video Transcode group
fetch('/api/gpu').then(r => r.json()).then(gpu => {
    const vtGroup = document.getElementById('sg-video-transcode');
    if (!vtGroup) return;
    const header = vtGroup.querySelector('.settings-group-header');
    const banner = document.createElement('div');
    banner.className = 'gpu-info-banner';
    if (gpu.vaapi) {
        banner.innerHTML = '<span class="gpu-status gpu-ok">&#9679;</span> ' +
            '<strong>GPU:</strong> ' + escapeHtml(gpu.device) +
            ' &mdash; ' + gpu.encoders.filter(e => e !== 'libx264').join(', ');
    } else {
        banner.innerHTML = '<span class="gpu-status gpu-none">&#9679;</span> ' +
            'No GPU detected &mdash; software encoding only';
    }
    header.after(banner);
}).catch(() => {});
```

- [ ] **Step 3: Add CSS for GPU info banner**

Add to the `<style>` block in admin.html:

```css
.gpu-info-banner {
    padding: 8px 12px;
    margin-bottom: 12px;
    border-radius: 6px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-secondary);
}
.gpu-status { font-size: 10px; margin-right: 4px; }
.gpu-ok { color: #22c55e; }
.gpu-none { color: var(--text-tertiary); }
```

- [ ] **Step 4: Commit**

```bash
git add docker/admin.html
git commit -m "feat(admin): show GPU info banner in Video Transcode settings

Fetches /api/gpu and displays device name + available encoders,
or 'No GPU detected' with fallback messaging."
```

---

## Chunk 3: Encoder Selection + VAAPI Pipeline

### Task 7: Build Encoder Selection Function

**Files:**
- Modify: `docker/meta-server.js` (add before `transcodeMedia` function, ~line 2730)

- [ ] **Step 1: Add resolveEncoder function**

Insert before the `transcodeMedia` function:

```javascript
/**
 * Resolve FFmpeg encoder + args based on video.codec setting and GPU capabilities.
 * Returns { encoder, args, isHardware } or throws if requested hardware is unavailable.
 */
function resolveEncoder() {
    const codec = getSetting('video.codec') || 'auto';
    const quality = getSetting('video.crf') || '18';
    const preset = getSetting('video.preset') || 'fast';
    const vaDevice = getSetting('video.vaapi_device') || '/dev/dri/renderD128';

    const hwEncoderMap = {
        'av1':     'av1_vaapi',
        'hevc':    'hevc_vaapi',
        'h264-hw': 'h264_vaapi',
    };

    // Auto mode: pick best available
    if (codec === 'auto') {
        if (gpuCapabilities.vaapi && gpuCapabilities.encoders.includes('av1_vaapi')) {
            return {
                encoder: 'av1_vaapi',
                isHardware: true,
                preInputArgs: ['-vaapi_device', vaDevice],
                vf: 'format=nv12,pad=ceil(iw/2)*2:ceil(ih/2)*2,hwupload',
                codecArgs: ['-c:v', 'av1_vaapi', '-global_quality', quality],
            };
        }
        // Fallback: software H.264
        return {
            encoder: 'libx264',
            isHardware: false,
            preInputArgs: [],
            vf: 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
            codecArgs: ['-c:v', 'libx264', '-preset', preset, '-crf', quality, '-movflags', '+faststart'],
        };
    }

    // Software H.264 — always available
    if (codec === 'h264') {
        return {
            encoder: 'libx264',
            isHardware: false,
            preInputArgs: [],
            vf: 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
            codecArgs: ['-c:v', 'libx264', '-preset', preset, '-crf', quality, '-movflags', '+faststart'],
        };
    }

    // Explicit hardware codec
    const hwEncoder = hwEncoderMap[codec];
    if (!hwEncoder) {
        throw new Error('Unknown video.codec setting: ' + codec);
    }
    if (!gpuCapabilities.vaapi || !gpuCapabilities.encoders.includes(hwEncoder)) {
        throw new Error('Hardware encoder ' + hwEncoder + ' requested but not available. GPU detected: ' + gpuCapabilities.vaapi);
    }

    return {
        encoder: hwEncoder,
        isHardware: true,
        preInputArgs: ['-vaapi_device', vaDevice],
        vf: 'format=nv12,pad=ceil(iw/2)*2:ceil(ih/2)*2,hwupload',
        codecArgs: ['-c:v', hwEncoder, '-global_quality', quality],
    };
}
```

- [ ] **Step 2: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(server): add resolveEncoder() for codec selection

Resolves FFmpeg encoder + args from video.codec setting and GPU capabilities.
auto mode picks AV1 VAAPI if available, else software H.264.
Explicit hardware codecs error if GPU unavailable (no silent fallback)."
```

---

### Task 8: Update transcodeMedia to Use resolveEncoder

**Files:**
- Modify: `docker/meta-server.js:2754-2765` (Step 1 MP4 args in transcodeMedia)

- [ ] **Step 1: Replace hardcoded libx264 args with resolveEncoder**

Replace lines 2754–2765 (the Step 1 MP4 args block) with:

```javascript
    // Step 1: WebM → MP4 (codec-aware)
    let enc;
    try {
        enc = resolveEncoder();
    } catch (encErr) {
        console.error('[media] Encoder selection failed:', encErr.message);
        db.prepare("UPDATE media SET status = 'error', error_msg = ? WHERE id = ?").run(encErr.message, mediaId);
        return;
    }

    console.log('[media] Transcoding', mediaId, 'with', enc.encoder, enc.isHardware ? '(hardware)' : '(software)');

    const mp4Args = [
        ...enc.preInputArgs,
        ...trimArgs,
        '-i', rawPath,
        '-vf', enc.vf,
        ...enc.codecArgs,
        '-an',
        '-y', mp4Path
    ];
```

This replaces the old hardcoded block (lines 2754–2765):
```javascript
    // Step 1: WebM → MP4
    const mp4Args = [
        ...trimArgs,
        '-i', rawPath,
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
        '-c:v', 'libx264',
        '-preset', getSetting('video.preset'),
        '-crf', getSetting('video.crf'),
        '-movflags', '+faststart',
        '-an',
        '-y', mp4Path
    ];
```

- [ ] **Step 2: Verify build (meta-server.js is plain JS, no build step needed)**

Review the code manually for syntax errors. The file is not compiled — it runs directly in Node.

- [ ] **Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(server): wire VAAPI encode path into transcodeMedia

Replaces hardcoded libx264 args with resolveEncoder() output.
Supports av1_vaapi, hevc_vaapi, h264_vaapi, and libx264 fallback."
```

---

### Task 9: Add Docker Environment Variables

**Files:**
- Modify: `docker/Dockerfile` (ENV block, ~line 50-72)

- [ ] **Step 1: Add VIDEO_CODEC and VAAPI_DEVICE env vars**

Add after the existing `DJI_API_KEY` line (line 72):

```dockerfile
ENV VIDEO_CODEC=""
ENV VAAPI_DEVICE=""
```

Empty defaults mean the settings system uses its own defaults (`auto` and `/dev/dri/renderD128`).

- [ ] **Step 2: Commit**

```bash
git add docker/Dockerfile
git commit -m "feat(docker): add VIDEO_CODEC and VAAPI_DEVICE env vars

Optional overrides for codec selection and VAAPI device path.
Empty = use settings defaults (auto codec, /dev/dri/renderD128)."
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: Clean build, no errors. Client-side change (recording-manager.ts) is the only file Vite touches.

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: All tests pass. No test changes needed — this feature touches server-side code (meta-server.js, Dockerfile) and one client default value.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: 0 errors.

- [ ] **Step 4: Final commit (if any lint fixes needed)**

```bash
git add -A
git commit -m "chore: lint fixes for VAAPI transcode changes"
```
