# Video/GIF Sharing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Record video clips from the editor (turntable, walkthrough, annotation tour, free camera), transcode server-side to MP4 + GIF, store linked to archives, share via preview pages with OG embeds.

**Architecture:** Browser MediaRecorder captures WebGL canvas as WebM. Upload to server. FFmpeg transcodes to MP4 + GIF + thumbnail. SQLite `media` table links to archives. Nginx serves `/media/` static files. Share pages at `/share/{id}` with OG meta tags.

**Tech Stack:** MediaRecorder API (browser), FFmpeg (server, alpine apk), better-sqlite3 (existing), busboy (existing), Three.js OrbitControls.autoRotate, WalkthroughEngine (existing).

**Design doc:** `docs/plans/2026-03-06-video-gif-sharing-design.md`

---

## Task 1: SQLite Schema — `media` Table

**Files:**
- Modify: `docker/meta-server.js` (add table creation near line 147 in `db.exec` block)

**Step 1: Add the media table to the existing schema init**

In `docker/meta-server.js`, inside the `db.exec(...)` block that creates `archives`, `audit_log`, `collections`, and `collection_archives`, append:

```sql
CREATE TABLE IF NOT EXISTS media (
    id          TEXT PRIMARY KEY,
    archive_id  INTEGER REFERENCES archives(id) ON DELETE SET NULL,
    title       TEXT,
    mode        TEXT,
    duration_ms INTEGER,
    status      TEXT DEFAULT 'pending',
    error_msg   TEXT,
    trim_start  REAL DEFAULT 0,
    trim_end    REAL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    mp4_path    TEXT,
    gif_path    TEXT,
    thumb_path  TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_archive ON media(archive_id);
CREATE INDEX IF NOT EXISTS idx_media_status ON media(status);
```

**Step 2: Add helper to generate media IDs**

At the top of `meta-server.js` (near the existing `crypto` require), add a function:

```js
function generateMediaId() {
    return crypto.randomBytes(8).toString('hex');
}
```

**Step 3: Create the media storage directory on startup**

After the existing `mkdir -p` equivalent in the server init (near line 146 where `db` is opened), add:

```js
const MEDIA_ROOT = path.join(HTML_ROOT, 'media');
if (!fs.existsSync(MEDIA_ROOT)) fs.mkdirSync(MEDIA_ROOT, { recursive: true });
```

Where `HTML_ROOT` is the existing `/usr/share/nginx/html` constant.

**Step 4: Verify by restarting meta-server**

Run: `node docker/meta-server.js` (will fail without full Docker env, but check for syntax errors)

**Step 5: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(media): add SQLite media table schema and storage directory"
```

---

## Task 2: Media Upload API Endpoint

**Files:**
- Modify: `docker/meta-server.js` (add POST `/api/media/upload` handler)

**Step 1: Add the upload handler function**

Add after the existing archive upload handlers (~line 930). This handler:
- Accepts multipart/form-data via busboy (already used for archive uploads)
- Expects fields: `archive_id` (optional), `title`, `mode`, `trim_start`, `trim_end`, `duration_ms`
- Expects file field: `video` (the WebM blob)
- Saves WebM to `MEDIA_ROOT/{id}/raw.webm`
- Inserts DB row with `status: 'pending'`
- Spawns async transcode (Task 3)
- Returns `{ id, status: 'pending' }`

```js
function handleMediaUpload(req, res) {
    if (!requireAuth(req, res)) return;

    const id = generateMediaId();
    const mediaDir = path.join(MEDIA_ROOT, id);
    fs.mkdirSync(mediaDir, { recursive: true });

    let fields = {};
    let fileSaved = false;

    const bb = busboy({ headers: req.headers, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB limit

    bb.on('field', (name, val) => { fields[name] = val; });

    bb.on('file', (fieldname, stream, info) => {
        if (fieldname !== 'video') { stream.resume(); return; }
        const dest = path.join(mediaDir, 'raw.webm');
        const ws = fs.createWriteStream(dest);
        stream.pipe(ws);
        ws.on('close', () => { fileSaved = true; });
    });

    bb.on('close', () => {
        if (!fileSaved) {
            fs.rmSync(mediaDir, { recursive: true, force: true });
            return sendJson(res, 400, { error: 'No video file provided' });
        }

        // Resolve archive_id from hash if provided
        let archiveDbId = null;
        if (fields.archive_hash) {
            const row = db.prepare('SELECT id FROM archives WHERE hash = ?').get(fields.archive_hash);
            if (row) archiveDbId = row.id;
        }

        db.prepare(`
            INSERT INTO media (id, archive_id, title, mode, duration_ms, trim_start, trim_end, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `).run(
            id,
            archiveDbId,
            fields.title || 'Untitled Recording',
            fields.mode || 'free',
            parseInt(fields.duration_ms) || 0,
            parseFloat(fields.trim_start) || 0,
            parseFloat(fields.trim_end) || 0
        );

        const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
        db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
          .run(actor, 'media_upload', id, JSON.stringify({ mode: fields.mode, archive_hash: fields.archive_hash }), req.headers['x-real-ip'] || null);

        // Start transcode asynchronously
        transcodeMedia(id);

        sendJson(res, 201, { id, status: 'pending' });
    });

    req.pipe(bb);
}
```

**Step 2: Wire the route into the request handler**

In the main `handleRequest` function (the big URL routing switch), add before the catch-all:

```js
// Media API routes
if (pathname === '/api/media/upload' && method === 'POST') return handleMediaUpload(req, res);
```

**Step 3: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(media): add POST /api/media/upload endpoint with busboy streaming"
```

---

## Task 3: FFmpeg Transcode Pipeline

**Files:**
- Modify: `docker/meta-server.js` (add `transcodeMedia` function)

**Step 1: Add the transcode function**

This function is called async after upload. It:
1. Updates status to `processing`
2. Runs ffmpeg to trim + convert to MP4
3. Runs ffmpeg two-pass GIF (palette + encode)
4. Extracts first frame as thumbnail
5. Updates DB with paths + status `ready`
6. Deletes raw WebM

```js
const { execFile } = require('child_process');

function transcodeMedia(mediaId) {
    const mediaDir = path.join(MEDIA_ROOT, mediaId);
    const rawPath = path.join(mediaDir, 'raw.webm');
    const mp4Path = path.join(mediaDir, 'video.mp4');
    const gifPath = path.join(mediaDir, 'preview.gif');
    const thumbPath = path.join(mediaDir, 'thumb.jpg');
    const palettePath = path.join(mediaDir, 'palette.png');

    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
    if (!row) return;

    db.prepare("UPDATE media SET status = 'processing' WHERE id = ?").run(mediaId);

    const trimArgs = [];
    if (row.trim_start > 0) trimArgs.push('-ss', String(row.trim_start));
    if (row.trim_end > 0) trimArgs.push('-to', String(row.trim_end));

    // Step 1: MP4
    const mp4Args = [
        ...trimArgs, '-i', rawPath,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-movflags', '+faststart', '-an', '-y', mp4Path
    ];

    execFile('ffmpeg', mp4Args, (err) => {
        if (err) {
            db.prepare("UPDATE media SET status = 'error', error_msg = ? WHERE id = ?")
              .run('MP4 transcode failed: ' + err.message, mediaId);
            return;
        }

        // Step 2: Thumbnail from MP4
        const thumbArgs = [
            '-i', mp4Path, '-vframes', '1',
            '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2',
            '-y', thumbPath
        ];

        execFile('ffmpeg', thumbArgs, (err2) => {
            if (err2) {
                // Non-fatal — continue without thumb
                console.error('Thumbnail extraction failed:', err2.message);
            }

            // Step 3: GIF palette generation
            const paletteArgs = [
                '-i', mp4Path,
                '-vf', 'fps=15,scale=480:-1:flags=lanczos,palettegen=stats_mode=diff',
                '-y', palettePath
            ];

            execFile('ffmpeg', paletteArgs, (err3) => {
                if (err3) {
                    // Non-fatal — skip GIF
                    console.error('GIF palette generation failed:', err3.message);
                    finishTranscode(mediaId, mp4Path, null, thumbPath, mediaDir, rawPath, palettePath);
                    return;
                }

                // Step 4: GIF encode with palette
                const gifArgs = [
                    '-i', mp4Path, '-i', palettePath,
                    '-lavfi', 'fps=15,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5',
                    '-y', gifPath
                ];

                execFile('ffmpeg', gifArgs, { maxBuffer: 50 * 1024 * 1024 }, (err4) => {
                    if (err4) {
                        console.error('GIF encode failed:', err4.message);
                        finishTranscode(mediaId, mp4Path, null, thumbPath, mediaDir, rawPath, palettePath);
                    } else {
                        finishTranscode(mediaId, mp4Path, gifPath, thumbPath, mediaDir, rawPath, palettePath);
                    }
                });
            });
        });
    });
}

function finishTranscode(mediaId, mp4Path, gifPath, thumbPath, mediaDir, rawPath, palettePath) {
    const mp4Rel = fs.existsSync(mp4Path) ? `/media/${mediaId}/video.mp4` : null;
    const gifRel = gifPath && fs.existsSync(gifPath) ? `/media/${mediaId}/preview.gif` : null;
    const thumbRel = fs.existsSync(thumbPath) ? `/media/${mediaId}/thumb.jpg` : null;

    db.prepare(`
        UPDATE media SET status = 'ready', mp4_path = ?, gif_path = ?, thumb_path = ? WHERE id = ?
    `).run(mp4Rel, gifRel, thumbRel, mediaId);

    // Cleanup temp files
    try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch {}
    try { if (fs.existsSync(palettePath)) fs.unlinkSync(palettePath); } catch {}
}
```

**Step 2: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(media): add FFmpeg transcode pipeline (MP4 + GIF + thumbnail)"
```

---

## Task 4: Media GET / LIST / DELETE API Endpoints

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add GET single media handler**

```js
function handleGetMedia(req, res, mediaId) {
    const row = db.prepare(`
        SELECT m.*, a.hash AS archive_hash, a.title AS archive_title
        FROM media m
        LEFT JOIN archives a ON a.id = m.archive_id
        WHERE m.id = ?
    `).get(mediaId);
    if (!row) return sendJson(res, 404, { error: 'Media not found' });
    sendJson(res, 200, buildMediaObject(row));
}
```

**Step 2: Add LIST media handler (by archive)**

```js
function handleListMedia(req, res, query) {
    let rows;
    if (query.archive_hash) {
        rows = db.prepare(`
            SELECT m.*, a.hash AS archive_hash, a.title AS archive_title
            FROM media m
            JOIN archives a ON a.id = m.archive_id
            WHERE a.hash = ?
            ORDER BY m.created_at DESC
        `).all(query.archive_hash);
    } else {
        rows = db.prepare(`
            SELECT m.*, a.hash AS archive_hash, a.title AS archive_title
            FROM media m
            LEFT JOIN archives a ON a.id = m.archive_id
            ORDER BY m.created_at DESC
        `).all();
    }
    sendJson(res, 200, rows.map(buildMediaObject));
}
```

**Step 3: Add DELETE media handler**

```js
function handleDeleteMedia(req, res, mediaId) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
    if (!row) return sendJson(res, 404, { error: 'Media not found' });

    // Delete files
    const mediaDir = path.join(MEDIA_ROOT, mediaId);
    if (fs.existsSync(mediaDir)) fs.rmSync(mediaDir, { recursive: true, force: true });

    db.prepare('DELETE FROM media WHERE id = ?').run(mediaId);

    const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
    db.prepare('INSERT INTO audit_log (actor, action, target, ip) VALUES (?, ?, ?, ?)')
      .run(actor, 'media_delete', mediaId, req.headers['x-real-ip'] || null);

    sendJson(res, 200, { ok: true });
}
```

**Step 4: Add `buildMediaObject` helper**

```js
function buildMediaObject(row) {
    return {
        id: row.id,
        archive_hash: row.archive_hash || null,
        archive_title: row.archive_title || null,
        title: row.title,
        mode: row.mode,
        duration_ms: row.duration_ms,
        status: row.status,
        error_msg: row.error_msg || null,
        created_at: row.created_at,
        mp4_url: row.mp4_path || null,
        gif_url: row.gif_path || null,
        thumb_url: row.thumb_path || null,
        share_url: `/share/${row.id}`,
    };
}
```

**Step 5: Wire routes into request handler**

```js
// In the main handleRequest routing:
const mediaMatch = pathname.match(/^\/api\/media\/([a-f0-9]{16})$/);
if (pathname === '/api/media' && method === 'GET') return handleListMedia(req, res, parsedUrl.query || {});
if (mediaMatch && method === 'GET') return handleGetMedia(req, res, mediaMatch[1]);
if (mediaMatch && method === 'DELETE') return handleDeleteMedia(req, res, mediaMatch[1]);
```

**Step 6: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(media): add GET/LIST/DELETE API endpoints for media"
```

---

## Task 5: Share Preview Page

**Files:**
- Create: `docker/share-page.html` (template)
- Modify: `docker/meta-server.js` (add `/share/:id` route)

**Step 1: Create the share page HTML template**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{TITLE}} — {{SITE_NAME}}</title>
    <meta property="og:title" content="{{TITLE}}" />
    <meta property="og:description" content="{{DESCRIPTION}}" />
    <meta property="og:type" content="video.other" />
    <meta property="og:video" content="{{SITE_URL}}{{MP4_URL}}" />
    <meta property="og:video:type" content="video/mp4" />
    <meta property="og:video:width" content="1280" />
    <meta property="og:video:height" content="720" />
    <meta property="og:image" content="{{SITE_URL}}{{THUMB_URL}}" />
    <meta property="og:url" content="{{SITE_URL}}/share/{{MEDIA_ID}}" />
    <meta property="og:site_name" content="{{SITE_NAME}}" />
    <meta name="twitter:card" content="player" />
    <meta name="twitter:title" content="{{TITLE}}" />
    <meta name="twitter:description" content="{{DESCRIPTION}}" />
    <meta name="twitter:image" content="{{SITE_URL}}{{THUMB_URL}}" />
    <meta name="twitter:player" content="{{SITE_URL}}{{MP4_URL}}" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #111; color: #eee; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
        .container { max-width: 960px; width: 100%; padding: 24px 16px; }
        video { width: 100%; border-radius: 8px; background: #000; }
        .info { margin-top: 16px; }
        .info h1 { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
        .info p { font-size: 14px; color: #999; margin-bottom: 12px; }
        .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
        .actions a { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; text-decoration: none; transition: background 0.15s; }
        .btn-primary { background: #5a9e97; color: #fff; }
        .btn-primary:hover { background: #4a8e87; }
        .btn-secondary { background: #333; color: #ccc; }
        .btn-secondary:hover { background: #444; }
        .creator { font-size: 12px; color: #666; margin-top: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <video controls autoplay muted loop playsinline>
            <source src="{{MP4_URL}}" type="video/mp4">
        </video>
        <div class="info">
            <h1>{{TITLE}}</h1>
            <p>{{DESCRIPTION}}</p>
            <span class="creator">{{CREATOR}}</span>
            <div class="actions">
                {{VIEW_3D_LINK}}
                {{GIF_LINK}}
            </div>
        </div>
    </div>
</body>
</html>
```

**Step 2: Copy template in Dockerfile**

After the existing `COPY docker/admin.html /opt/admin.html` line, add:

```dockerfile
COPY docker/share-page.html /opt/share-page.html
```

**Step 3: Add share page route handler in meta-server.js**

```js
function handleSharePage(req, res, mediaId) {
    const row = db.prepare(`
        SELECT m.*, a.hash AS archive_hash, a.title AS archive_title,
               a.description AS archive_description
        FROM media m
        LEFT JOIN archives a ON a.id = m.archive_id
        WHERE m.id = ? AND m.status = 'ready'
    `).get(mediaId);

    if (!row) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Media not found');
        return;
    }

    let template;
    try {
        template = fs.readFileSync('/opt/share-page.html', 'utf8');
    } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Share page template not found');
        return;
    }

    const title = row.title || 'Recording';
    const description = row.archive_description || SITE_DESCRIPTION;
    const creator = row.archive_title ? `From: ${row.archive_title}` : '';

    const view3dLink = row.archive_hash
        ? `<a class="btn-primary" href="/?archive=/archives/${row.archive_hash}.a3d">View in 3D</a>`
        : '';
    const gifLink = row.gif_path
        ? `<a class="btn-secondary" href="${row.gif_path}" download>Download GIF</a>`
        : '';

    const html = template
        .replace(/\{\{TITLE\}\}/g, escapeHtml(title))
        .replace(/\{\{DESCRIPTION\}\}/g, escapeHtml(description))
        .replace(/\{\{SITE_NAME\}\}/g, escapeHtml(SITE_NAME))
        .replace(/\{\{SITE_URL\}\}/g, SITE_URL)
        .replace(/\{\{MEDIA_ID\}\}/g, mediaId)
        .replace(/\{\{MP4_URL\}\}/g, row.mp4_path || '')
        .replace(/\{\{THUMB_URL\}\}/g, row.thumb_path || '')
        .replace(/\{\{CREATOR\}\}/g, escapeHtml(creator))
        .replace(/\{\{VIEW_3D_LINK\}\}/g, view3dLink)
        .replace(/\{\{GIF_LINK\}\}/g, gifLink);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

**Step 4: Wire route**

```js
const shareMatch = pathname.match(/^\/share\/([a-f0-9]{16})$/);
if (shareMatch) return handleSharePage(req, res, shareMatch[1]);
```

**Step 5: Commit**

```bash
git add docker/share-page.html docker/meta-server.js docker/Dockerfile
git commit -m "feat(media): add share preview page with OG/Twitter Card meta tags"
```

---

## Task 6: Docker + Nginx — FFmpeg & Media Serving

**Files:**
- Modify: `docker/Dockerfile` (add ffmpeg, media dir)
- Modify: `docker/nginx.conf.template` (add `/media/` location)

**Step 1: Add ffmpeg to Dockerfile**

In the final stage `FROM nginx:alpine`, in the existing `RUN apk add --no-cache ...` line (~line 18), append `ffmpeg`:

```dockerfile
RUN apk add --no-cache xz gettext python3 unzip libstdc++ ffmpeg && \
```

**Step 2: Add media directory creation**

After the existing `RUN mkdir -p /usr/share/nginx/html/meta /usr/share/nginx/html/thumbs /data`, add `media`:

```dockerfile
RUN mkdir -p /usr/share/nginx/html/meta /usr/share/nginx/html/thumbs /usr/share/nginx/html/media /data
```

**Step 3: Add nginx location for /media/**

In `docker/nginx.conf.template`, after the existing `/thumbs/` location block, add:

```nginx
    # Serve media files (recordings)
    location /media/ {
        alias /usr/share/nginx/html/media/;
        expires 7d;
        add_header Cache-Control "public";
        add_header Access-Control-Allow-Origin "*";
    }
```

**Step 4: Commit**

```bash
git add docker/Dockerfile docker/nginx.conf.template
git commit -m "feat(media): add ffmpeg to Docker image, nginx media serving"
```

---

## Task 7: Recording Manager — Core Module

**Files:**
- Create: `src/modules/recording-manager.ts`

**Step 1: Create the recording manager module**

This is the core client-side module. It handles:
- MediaRecorder setup with canvas.captureStream()
- Start/stop recording
- Compositing canvas for capturing DOM overlays
- Mode-specific camera automation hooks

```typescript
import { Logger, notify } from './utilities.js';

const log = Logger.getLogger('recording-manager');

export type RecordingMode = 'turntable' | 'walkthrough' | 'annotation-tour' | 'free';
export type RecordingState = 'idle' | 'recording' | 'recorded' | 'uploading';

export interface RecordingDeps {
    renderer: any;          // THREE.WebGLRenderer
    scene: any;             // THREE.Scene
    camera: any;            // THREE.PerspectiveCamera
    controls: any;          // OrbitControls
    canvas: HTMLCanvasElement;
    postProcessing?: { isEnabled(): boolean; render(): void };
}

interface RecordingResult {
    blob: Blob;
    duration: number;   // ms
    mode: RecordingMode;
}

let _deps: RecordingDeps | null = null;
let _state: RecordingState = 'idle';
let _recorder: MediaRecorder | null = null;
let _chunks: Blob[] = [];
let _startTime = 0;
let _result: RecordingResult | null = null;
let _compositeCanvas: HTMLCanvasElement | null = null;
let _compositeCtx: CanvasRenderingContext2D | null = null;
let _compositeStream: MediaStream | null = null;
let _compositeRafId = 0;
let _onRecordingComplete: ((result: RecordingResult) => void) | null = null;

// Overlay canvas for annotation popups during recording
let _overlayCanvas: HTMLCanvasElement | null = null;

// Timer display
let _timerInterval = 0;
const MAX_DURATION = 60_000; // 60 seconds

export function initRecordingManager(deps: RecordingDeps): void {
    _deps = deps;
    log.info('Recording manager initialized');
}

export function getRecordingState(): RecordingState {
    return _state;
}

export function getRecordingResult(): RecordingResult | null {
    return _result;
}

/**
 * Start recording the WebGL canvas.
 * Returns false if recording could not start.
 */
export function startRecording(
    mode: RecordingMode,
    onComplete: (result: RecordingResult) => void
): boolean {
    if (!_deps) {
        notify.error('Recording not initialized');
        return false;
    }
    if (_state === 'recording') {
        notify.error('Already recording');
        return false;
    }

    const canvas = _deps.canvas;

    // Create composite canvas matching the WebGL canvas size
    _compositeCanvas = document.createElement('canvas');
    _compositeCanvas.width = canvas.width;
    _compositeCanvas.height = canvas.height;
    _compositeCtx = _compositeCanvas.getContext('2d');

    if (!_compositeCtx) {
        notify.error('Could not create composite canvas');
        return false;
    }

    // Create overlay canvas for DOM elements (annotation popups)
    _overlayCanvas = document.createElement('canvas');
    _overlayCanvas.width = canvas.width;
    _overlayCanvas.height = canvas.height;

    // Start composite frame loop
    _compositeRafId = requestAnimationFrame(compositeFrame);

    // Capture stream from composite canvas
    _compositeStream = _compositeCanvas.captureStream(30);

    // Set up MediaRecorder
    const mimeTypes = [
        'video/webm; codecs=vp9',
        'video/webm; codecs=vp8',
        'video/webm',
    ];
    const mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m));
    if (!mimeType) {
        notify.error('Browser does not support WebM recording');
        cleanup();
        return false;
    }

    _chunks = [];
    _recorder = new MediaRecorder(_compositeStream, {
        mimeType,
        videoBitsPerSecond: 5_000_000, // 5 Mbps
    });

    _recorder.ondataavailable = (e) => {
        if (e.data.size > 0) _chunks.push(e.data);
    };

    _recorder.onstop = () => {
        const duration = Date.now() - _startTime;
        const blob = new Blob(_chunks, { type: 'video/webm' });
        _result = { blob, duration, mode };
        _state = 'recorded';
        clearInterval(_timerInterval);
        cancelAnimationFrame(_compositeRafId);
        _compositeRafId = 0;
        if (_onRecordingComplete) _onRecordingComplete(_result);
        showRecIndicator(false);
        log.info(`Recording complete: ${(duration / 1000).toFixed(1)}s, ${(blob.size / 1024 / 1024).toFixed(1)}MB`);
    };

    _onRecordingComplete = onComplete;
    _startTime = Date.now();
    _recorder.start(1000); // collect chunks every second
    _state = 'recording';

    // Start timer display
    updateTimerDisplay();
    _timerInterval = window.setInterval(updateTimerDisplay, 1000);

    // Auto-stop at max duration
    setTimeout(() => {
        if (_state === 'recording') stopRecording();
    }, MAX_DURATION);

    showRecIndicator(true);
    log.info(`Recording started (${mode}, ${mimeType})`);
    return true;
}

/**
 * Stop the current recording.
 */
export function stopRecording(): void {
    if (_state !== 'recording' || !_recorder) return;
    _recorder.stop();
    clearInterval(_timerInterval);
}

/**
 * Discard the recorded result and reset to idle.
 */
export function discardRecording(): void {
    _result = null;
    _state = 'idle';
    cleanup();
}

/**
 * Composite the WebGL canvas + overlay onto the recording canvas each frame.
 */
function compositeFrame(): void {
    if (!_compositeCtx || !_compositeCanvas || !_deps) return;

    // Draw the WebGL canvas
    _compositeCtx.drawImage(_deps.canvas, 0, 0);

    // Draw overlay canvas (annotation popups rendered here)
    if (_overlayCanvas) {
        _compositeCtx.drawImage(_overlayCanvas, 0, 0);
    }

    if (_state === 'recording') {
        _compositeRafId = requestAnimationFrame(compositeFrame);
    }
}

function cleanup(): void {
    if (_compositeRafId) {
        cancelAnimationFrame(_compositeRafId);
        _compositeRafId = 0;
    }
    _compositeCanvas = null;
    _compositeCtx = null;
    _compositeStream = null;
    _overlayCanvas = null;
    _recorder = null;
    _chunks = [];
}

function showRecIndicator(show: boolean): void {
    const indicator = document.getElementById('rec-indicator');
    if (indicator) indicator.style.display = show ? 'flex' : 'none';
}

function updateTimerDisplay(): void {
    const el = document.getElementById('rec-timer');
    if (!el) return;
    const elapsed = Math.floor((Date.now() - _startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get the overlay canvas for rendering annotation popups during recording.
 * Returns null if not currently recording.
 */
export function getOverlayCanvas(): HTMLCanvasElement | null {
    return _state === 'recording' ? _overlayCanvas : null;
}

/**
 * Upload the recorded video to the server.
 */
export async function uploadRecording(options: {
    title: string;
    archiveHash?: string;
    trimStart: number;
    trimEnd: number;
    serverUrl?: string;
}): Promise<{ id: string; status: string } | null> {
    if (!_result) {
        notify.error('No recording to upload');
        return null;
    }

    _state = 'uploading';

    const formData = new FormData();
    formData.append('video', _result.blob, 'recording.webm');
    formData.append('title', options.title);
    formData.append('mode', _result.mode);
    formData.append('duration_ms', String(_result.duration));
    formData.append('trim_start', String(options.trimStart));
    formData.append('trim_end', String(options.trimEnd));
    if (options.archiveHash) {
        formData.append('archive_hash', options.archiveHash);
    }

    try {
        const baseUrl = options.serverUrl || '';
        const res = await fetch(`${baseUrl}/api/media/upload`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        _state = 'idle';
        _result = null;
        cleanup();
        notify.success('Recording uploaded — processing...');
        return data;
    } catch (e: any) {
        _state = 'recorded'; // allow retry
        notify.error(`Upload failed: ${e.message}`);
        log.error('Upload error:', e);
        return null;
    }
}

/**
 * Poll server for media status until ready or error.
 */
export async function pollMediaStatus(
    mediaId: string,
    onStatusChange: (status: string) => void,
    serverUrl = ''
): Promise<void> {
    const poll = async () => {
        try {
            const res = await fetch(`${serverUrl}/api/media/${mediaId}`);
            if (!res.ok) return;
            const data = await res.json();
            onStatusChange(data.status);
            if (data.status === 'ready' || data.status === 'error') return;
            setTimeout(poll, 2000);
        } catch {
            setTimeout(poll, 5000);
        }
    };
    poll();
}
```

**Step 2: Commit**

```bash
git add src/modules/recording-manager.ts
git commit -m "feat(media): add recording-manager module with MediaRecorder capture"
```

---

## Task 8: Annotation Tour Camera Automation

**Files:**
- Create: `src/modules/annotation-tour.ts`

**Step 1: Create the annotation tour module**

Reuses `flyCamera` pattern from walkthrough-controller. Iterates annotations, flies to each, dwells, then moves to next.

```typescript
import { Logger } from './utilities.js';

const log = Logger.getLogger('annotation-tour');

export interface AnnotationTourDeps {
    camera: any;            // THREE.PerspectiveCamera
    controls: any;          // OrbitControls
    annotationSystem: any;  // AnnotationSystem
}

export interface AnnotationTourOptions {
    dwellTime: number;      // ms per annotation (default 3000)
    flyDuration: number;    // ms per flight (default 1500)
    onStart?: () => void;
    onAnnotationEnter?: (annotationId: string, index: number) => void;
    onAnnotationLeave?: (annotationId: string) => void;
    onComplete?: () => void;
}

let _running = false;
let _cancelRequested = false;
let _rafId = 0;
let _timeoutId = 0;

export function isRunning(): boolean {
    return _running;
}

export function startAnnotationTour(
    deps: AnnotationTourDeps,
    options: AnnotationTourOptions
): boolean {
    const annotations = deps.annotationSystem.getAnnotations();
    if (annotations.length === 0) {
        log.warn('No annotations for tour');
        return false;
    }

    _running = true;
    _cancelRequested = false;
    options.onStart?.();

    log.info(`Starting annotation tour: ${annotations.length} stops, ${options.dwellTime}ms dwell`);

    let index = 0;

    function visitNext(): void {
        if (_cancelRequested || index >= annotations.length) {
            _running = false;
            _cancelRequested = false;
            options.onComplete?.();
            return;
        }

        const anno = annotations[index];
        options.onAnnotationEnter?.(anno.id, index);

        // Fly camera to annotation viewpoint
        flyToAnnotation(deps, anno, options.flyDuration, () => {
            if (_cancelRequested) {
                _running = false;
                options.onComplete?.();
                return;
            }

            // Show annotation popup
            deps.annotationSystem.selectAnnotation(anno.id);

            // Dwell
            _timeoutId = window.setTimeout(() => {
                options.onAnnotationLeave?.(anno.id);
                index++;
                visitNext();
            }, options.dwellTime);
        });
    }

    visitNext();
    return true;
}

export function stopAnnotationTour(): void {
    _cancelRequested = true;
    if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = 0;
    }
    if (_timeoutId) {
        clearTimeout(_timeoutId);
        _timeoutId = 0;
    }
    _running = false;
}

function flyToAnnotation(
    deps: AnnotationTourDeps,
    annotation: any,
    duration: number,
    onComplete: () => void
): void {
    const cam = deps.camera;
    const ctrl = deps.controls;
    const startPos = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
    const startTarget = { x: ctrl.target.x, y: ctrl.target.y, z: ctrl.target.z };
    const endPos = annotation.camera_position;
    const endTarget = annotation.camera_target;
    const startTime = performance.now();

    function step(): void {
        if (_cancelRequested) { onComplete(); return; }

        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic

        cam.position.set(
            startPos.x + (endPos.x - startPos.x) * eased,
            startPos.y + (endPos.y - startPos.y) * eased,
            startPos.z + (endPos.z - startPos.z) * eased
        );
        ctrl.target.set(
            startTarget.x + (endTarget.x - startTarget.x) * eased,
            startTarget.y + (endTarget.y - startTarget.y) * eased,
            startTarget.z + (endTarget.z - startTarget.z) * eased
        );

        if (t < 1) {
            _rafId = requestAnimationFrame(step);
        } else {
            _rafId = 0;
            onComplete();
        }
    }

    _rafId = requestAnimationFrame(step);
}
```

**Step 2: Commit**

```bash
git add src/modules/annotation-tour.ts
git commit -m "feat(media): add annotation-tour camera automation module"
```

---

## Task 9: Recording Trim UI

**Files:**
- Create: `src/modules/recording-trim.ts`

**Step 1: Create the trim UI module**

Lightweight trim interface: video preview + timeline scrubber with start/end handles.

```typescript
import { Logger } from './utilities.js';

const log = Logger.getLogger('recording-trim');

export interface TrimResult {
    trimStart: number;  // seconds
    trimEnd: number;    // seconds
    title: string;
}

/**
 * Show the trim UI for a recorded WebM blob.
 * Returns a promise that resolves with trim settings or null if discarded.
 */
export function showTrimUI(
    container: HTMLElement,
    blob: Blob,
    defaultTitle: string
): Promise<TrimResult | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);

        container.innerHTML = '';
        container.classList.remove('hidden');

        // Video preview
        const video = document.createElement('video');
        video.src = url;
        video.controls = false;
        video.muted = true;
        video.playsInline = true;
        video.style.cssText = 'width:100%; border-radius:4px; background:#000; max-height:200px;';
        container.appendChild(video);

        // Timeline scrubber
        const timeline = document.createElement('div');
        timeline.className = 'trim-timeline';
        timeline.style.cssText = 'position:relative; height:32px; background:#1a1a1a; border-radius:4px; margin:8px 0; cursor:pointer;';

        const range = document.createElement('div');
        range.className = 'trim-range';
        range.style.cssText = 'position:absolute; top:0; bottom:0; background:rgba(90,158,151,0.3); border-left:2px solid #5a9e97; border-right:2px solid #5a9e97;';
        timeline.appendChild(range);

        const playhead = document.createElement('div');
        playhead.style.cssText = 'position:absolute; top:0; bottom:0; width:2px; background:#fff; pointer-events:none;';
        timeline.appendChild(playhead);

        container.appendChild(timeline);

        let trimStart = 0;
        let trimEnd = 0;
        let duration = 0;

        video.addEventListener('loadedmetadata', () => {
            duration = video.duration;
            trimEnd = duration;
            updateRange();
        });

        video.addEventListener('timeupdate', () => {
            if (duration > 0) {
                playhead.style.left = `${(video.currentTime / duration) * 100}%`;
            }
        });

        function updateRange(): void {
            if (duration <= 0) return;
            const startPct = (trimStart / duration) * 100;
            const endPct = (trimEnd / duration) * 100;
            range.style.left = `${startPct}%`;
            range.style.width = `${endPct - startPct}%`;
        }

        // Click on timeline to set trim points (left half = start, right half = end)
        timeline.addEventListener('click', (e) => {
            const rect = timeline.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const time = pct * duration;

            if (pct < 0.5) {
                trimStart = Math.max(0, Math.min(time, trimEnd - 0.5));
            } else {
                trimEnd = Math.max(trimStart + 0.5, Math.min(time, duration));
            }
            updateRange();
            video.currentTime = trimStart;
        });

        // Controls row
        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex; gap:6px; align-items:center; margin:8px 0;';

        const previewBtn = document.createElement('button');
        previewBtn.className = 'prop-btn';
        previewBtn.textContent = 'Preview';
        previewBtn.addEventListener('click', () => {
            video.currentTime = trimStart;
            video.play();
            // Stop at trimEnd
            const checkEnd = () => {
                if (video.currentTime >= trimEnd) {
                    video.pause();
                    video.removeEventListener('timeupdate', checkEnd);
                }
            };
            video.addEventListener('timeupdate', checkEnd);
        });
        controls.appendChild(previewBtn);

        const timeDisplay = document.createElement('span');
        timeDisplay.style.cssText = 'font-size:10px; color:#999; margin-left:auto;';
        const updateTimeDisplay = () => {
            timeDisplay.textContent = `${trimStart.toFixed(1)}s — ${trimEnd.toFixed(1)}s (${(trimEnd - trimStart).toFixed(1)}s)`;
        };
        updateTimeDisplay();
        // Update display when range changes
        const origUpdateRange = updateRange;
        updateRange = () => { origUpdateRange(); updateTimeDisplay(); };

        controls.appendChild(timeDisplay);
        container.appendChild(controls);

        // Title input
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = defaultTitle;
        titleInput.placeholder = 'Recording title';
        titleInput.className = 'prop-input';
        titleInput.style.cssText = 'width:100%; margin:4px 0 8px;';
        container.appendChild(titleInput);

        // Action buttons
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; gap:8px;';

        const uploadBtn = document.createElement('button');
        uploadBtn.className = 'prop-btn accent';
        uploadBtn.textContent = 'Upload';
        uploadBtn.addEventListener('click', () => {
            URL.revokeObjectURL(url);
            container.classList.add('hidden');
            resolve({
                trimStart,
                trimEnd,
                title: titleInput.value || defaultTitle,
            });
        });

        const discardBtn = document.createElement('button');
        discardBtn.className = 'prop-btn';
        discardBtn.textContent = 'Discard';
        discardBtn.addEventListener('click', () => {
            URL.revokeObjectURL(url);
            container.classList.add('hidden');
            container.innerHTML = '';
            resolve(null);
        });

        actions.appendChild(uploadBtn);
        actions.appendChild(discardBtn);
        container.appendChild(actions);

        // Auto-play once loaded
        video.load();
    });
}
```

**Step 2: Commit**

```bash
git add src/modules/recording-trim.ts
git commit -m "feat(media): add recording-trim UI module with timeline scrubber"
```

---

## Task 10: Editor HTML — Recording Panel & Viewport Indicator

**Files:**
- Modify: `src/editor/index.html` (add recording panel after screenshots section ~line 1673, add REC indicator in viewport)

**Step 1: Add the recording panel HTML**

After the closing `</div>` of the Screenshots `prop-section` (~line 1673), add:

```html
                <div class="prop-section open">
                    <div class="prop-section-hd">
                        <span class="prop-section-title">Recording</span>
                        <span class="prop-section-chevron">&#9654;</span>
                    </div>
                    <div class="prop-section-body">
                        <!-- Mode selector -->
                        <div id="rec-mode-selector" style="display:flex; gap:4px; margin-bottom:8px;">
                            <button class="prop-btn rec-mode-btn active" data-rec-mode="turntable" title="Turntable (360° rotation)">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>
                                <span style="font-size:9px;">Turntable</span>
                            </button>
                            <button class="prop-btn rec-mode-btn" data-rec-mode="walkthrough" title="Replay walkthrough">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 3l14 9-14 9V3z"/></svg>
                                <span style="font-size:9px;">Walkthrough</span>
                            </button>
                            <button class="prop-btn rec-mode-btn" data-rec-mode="annotation-tour" title="Annotation tour">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                                <span style="font-size:9px;">Tour</span>
                            </button>
                            <button class="prop-btn rec-mode-btn" data-rec-mode="free" title="Free camera recording">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                                <span style="font-size:9px;">Free</span>
                            </button>
                        </div>

                        <!-- Mode options (shown/hidden per mode) -->
                        <div id="rec-options-turntable" class="rec-options">
                            <label class="prop-label" style="font-size:10px;">Speed</label>
                            <input type="range" id="rec-turntable-speed" min="1" max="5" value="2" style="width:100%;">
                            <label style="font-size:10px; display:flex; align-items:center; gap:4px; margin-top:4px;">
                                <input type="checkbox" id="rec-turntable-full360" checked> Full 360°
                            </label>
                        </div>
                        <div id="rec-options-walkthrough" class="rec-options hidden">
                            <p class="prop-hint" id="rec-wt-hint">Plays the current walkthrough sequence while recording.</p>
                        </div>
                        <div id="rec-options-annotation-tour" class="rec-options hidden">
                            <label class="prop-label" style="font-size:10px;">Dwell per annotation</label>
                            <input type="range" id="rec-tour-dwell" min="1" max="8" value="3" style="width:100%;">
                            <span id="rec-tour-dwell-label" style="font-size:10px; color:#999;">3s</span>
                        </div>
                        <div id="rec-options-free" class="rec-options hidden">
                            <p class="prop-hint">Move the camera freely. Click stop when done.</p>
                        </div>

                        <!-- Record / Stop button -->
                        <div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
                            <button class="prop-btn accent" id="btn-rec-start" style="display:flex; align-items:center; gap:6px;">
                                <span style="width:10px; height:10px; border-radius:50%; background:#e53935; display:inline-block;"></span>
                                Record
                            </button>
                            <button class="prop-btn" id="btn-rec-stop" style="display:none; align-items:center; gap:6px;">
                                <span style="width:10px; height:10px; background:#e53935; display:inline-block;"></span>
                                Stop
                            </button>
                            <span id="rec-elapsed" style="font-size:10px; color:#999;"></span>
                        </div>

                        <!-- Trim UI container (populated by recording-trim.ts) -->
                        <div id="rec-trim-container" class="hidden" style="margin-top:8px;"></div>

                        <!-- Upload status -->
                        <div id="rec-upload-status" class="hidden" style="margin-top:8px;">
                            <span id="rec-upload-text" style="font-size:10px; color:var(--accent);"></span>
                        </div>
                    </div>
                </div>
```

**Step 2: Add REC viewport indicator**

Inside the `#viewer-container` div (near the existing viewer overlays), add:

```html
<!-- Recording indicator -->
<div id="rec-indicator" style="display:none; position:absolute; top:12px; right:12px; z-index:100; align-items:center; gap:6px; background:rgba(0,0,0,0.6); padding:4px 10px; border-radius:4px;">
    <span style="width:8px; height:8px; border-radius:50%; background:#e53935; animation:rec-pulse 1s infinite;"></span>
    <span style="font-size:11px; color:#fff; font-weight:600;">REC</span>
    <span id="rec-timer" style="font-size:11px; color:#ccc; font-family:monospace;">0:00</span>
</div>
```

**Step 3: Add CSS for REC pulse animation**

In `src/styles.css`, add:

```css
@keyframes rec-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
}

.rec-mode-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 4px;
    font-size: 9px;
}
.rec-mode-btn.active {
    background: rgba(90, 158, 151, 0.2);
    border-color: var(--accent);
}
.rec-options.hidden { display: none; }
```

**Step 4: Commit**

```bash
git add src/editor/index.html src/styles.css
git commit -m "feat(media): add recording panel HTML and REC indicator to editor"
```

---

## Task 11: Event Wiring — Connect Recording UI

**Files:**
- Modify: `src/modules/event-wiring.ts` (add recording event handlers)
- Modify: `src/types.ts` (add recording deps to EventWiringDeps if needed)
- Modify: `src/main.ts` (initialize recording manager, create deps, wire events)

**Step 1: Add recording imports and deps to event-wiring.ts**

After the existing screenshot wiring (~line 520), add a new section:

```typescript
    // ─── Recording controls ─────────────────────────────────
    if (deps.recording) {
        // Mode selector buttons
        document.querySelectorAll('.rec-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.rec-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = (btn as HTMLElement).dataset.recMode || 'free';
                // Show/hide mode-specific options
                document.querySelectorAll('.rec-options').forEach(el => el.classList.add('hidden'));
                const optionsEl = document.getElementById(`rec-options-${mode}`);
                if (optionsEl) optionsEl.classList.remove('hidden');
            });
        });

        // Dwell time slider label sync
        const dwellSlider = document.getElementById('rec-tour-dwell') as HTMLInputElement;
        const dwellLabel = document.getElementById('rec-tour-dwell-label');
        if (dwellSlider && dwellLabel) {
            dwellSlider.addEventListener('input', () => {
                dwellLabel.textContent = `${dwellSlider.value}s`;
            });
        }

        addListener('btn-rec-start', 'click', deps.recording.startRecording);
        addListener('btn-rec-stop', 'click', deps.recording.stopRecording);
    }
```

**Step 2: Add recording deps interface**

In `src/types.ts`, extend `EventWiringDeps` (or add alongside existing deps types):

```typescript
export interface RecordingWiringDeps {
    startRecording: () => void;
    stopRecording: () => void;
}
```

And add to `EventWiringDeps`:

```typescript
recording?: RecordingWiringDeps;
```

**Step 3: In main.ts, initialize recording manager and create deps**

Add imports at the top of `main.ts`:

```typescript
import {
    initRecordingManager,
    startRecording,
    stopRecording,
    discardRecording,
    getRecordingResult,
    uploadRecording,
    pollMediaStatus,
    type RecordingMode,
} from './modules/recording-manager.js';
import { showTrimUI } from './modules/recording-trim.js';
import {
    startAnnotationTour,
    stopAnnotationTour,
} from './modules/annotation-tour.js';
```

In `init()`, after screenshot manager setup, add:

```typescript
initRecordingManager({
    renderer,
    scene,
    camera,
    controls,
    canvas: renderer.domElement,
    postProcessing,
});
```

Create the recording handler that wires mode selection → recording → trim → upload:

```typescript
function handleStartRecording(): void {
    const activeMode = document.querySelector('.rec-mode-btn.active') as HTMLElement;
    const mode = (activeMode?.dataset.recMode || 'free') as RecordingMode;

    // Toggle button visibility
    const startBtn = document.getElementById('btn-rec-start');
    const stopBtn = document.getElementById('btn-rec-stop');
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'flex';

    const started = startRecording(mode, async (result) => {
        // Recording complete — show trim UI
        if (startBtn) startBtn.style.display = 'flex';
        if (stopBtn) stopBtn.style.display = 'none';

        const container = document.getElementById('rec-trim-container');
        if (!container) return;

        const archiveTitle = state.metadata?.title || 'Untitled';
        const defaultTitle = `${archiveTitle} - ${mode} - ${new Date().toLocaleDateString()}`;

        const trimResult = await showTrimUI(container, result.blob, defaultTitle);
        if (!trimResult) {
            discardRecording();
            return;
        }

        // Upload
        const statusEl = document.getElementById('rec-upload-status');
        const statusText = document.getElementById('rec-upload-text');
        if (statusEl) statusEl.classList.remove('hidden');
        if (statusText) statusText.textContent = 'Uploading...';

        const uploadResult = await uploadRecording({
            title: trimResult.title,
            archiveHash: state.currentArchiveHash || undefined,
            trimStart: trimResult.trimStart,
            trimEnd: trimResult.trimEnd,
        });

        if (uploadResult) {
            if (statusText) statusText.textContent = 'Processing...';
            pollMediaStatus(uploadResult.id, (status) => {
                if (statusText) {
                    if (status === 'ready') {
                        statusText.textContent = 'Ready!';
                        setTimeout(() => { if (statusEl) statusEl.classList.add('hidden'); }, 3000);
                    } else if (status === 'error') {
                        statusText.textContent = 'Transcode failed — try again';
                        statusText.style.color = 'var(--danger)';
                    }
                }
            });
        } else {
            if (statusEl) statusEl.classList.add('hidden');
        }
    });

    if (!started) {
        if (startBtn) startBtn.style.display = 'flex';
        if (stopBtn) stopBtn.style.display = 'none';
        return;
    }

    // Mode-specific automation
    if (mode === 'turntable') {
        controls.autoRotate = true;
        const speedSlider = document.getElementById('rec-turntable-speed') as HTMLInputElement;
        controls.autoRotateSpeed = parseFloat(speedSlider?.value || '2') * 2;
    } else if (mode === 'walkthrough') {
        // Import and trigger walkthrough playback (reuse existing preview)
        import('./modules/walkthrough-controller.js').then(wc => wc.playPreview());
    } else if (mode === 'annotation-tour') {
        const dwellSlider = document.getElementById('rec-tour-dwell') as HTMLInputElement;
        const dwellTime = (parseInt(dwellSlider?.value || '3')) * 1000;
        startAnnotationTour(
            { camera, controls, annotationSystem },
            {
                dwellTime,
                flyDuration: 1500,
                onComplete: () => stopRecording(),
            }
        );
    }
    // 'free' mode: user manually controls camera
}

function handleStopRecording(): void {
    stopRecording();
    // Stop any mode-specific automation
    controls.autoRotate = false;
    stopAnnotationTour();
}
```

Wire into the EventWiringDeps:

```typescript
recording: {
    startRecording: handleStartRecording,
    stopRecording: handleStopRecording,
},
```

**Step 4: Commit**

```bash
git add src/modules/event-wiring.ts src/types.ts src/main.ts
git commit -m "feat(media): wire recording UI events and mode automation in editor"
```

---

## Task 12: Build Verification

**Step 1: Run the TypeScript/Vite build**

Run: `npm run build`
Expected: Build succeeds with no errors. New modules are bundled into the editor entry point.

**Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK).

**Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass (new modules have no tests yet — they're UI/integration code).

**Step 4: Commit any lint/type fixes**

```bash
git add -u
git commit -m "fix(media): address lint/type issues from recording feature"
```

---

## Task 13: Docker Build Verification

**Step 1: Build the Docker image**

Run: `npm run docker:build` (or `npm run build && docker build -f docker/Dockerfile -t vitrine3d .`)
Expected: Image builds successfully with ffmpeg included.

**Step 2: Verify ffmpeg is available in the image**

Run: `docker run --rm vitrine3d ffmpeg -version`
Expected: Shows ffmpeg version info.

**Step 3: Commit any Docker fixes if needed**

---

## Summary: Commit Sequence

1. `feat(media): add SQLite media table schema and storage directory`
2. `feat(media): add POST /api/media/upload endpoint with busboy streaming`
3. `feat(media): add FFmpeg transcode pipeline (MP4 + GIF + thumbnail)`
4. `feat(media): add GET/LIST/DELETE API endpoints for media`
5. `feat(media): add share preview page with OG/Twitter Card meta tags`
6. `feat(media): add ffmpeg to Docker image, nginx media serving`
7. `feat(media): add recording-manager module with MediaRecorder capture`
8. `feat(media): add annotation-tour camera automation module`
9. `feat(media): add recording-trim UI module with timeline scrubber`
10. `feat(media): add recording panel HTML and REC indicator to editor`
11. `feat(media): wire recording UI events and mode automation in editor`
12. `fix(media): address lint/type issues from recording feature`
13. Docker build verification (no commit unless fixes needed)

## Future Enhancements (not in this plan)

- Library UI media tab (requires library browser changes)
- Annotation popup compositing into overlay canvas during recording
- Resolution selection (720p/1080p force)
- Batch recording from library view
- Media management in admin dashboard
