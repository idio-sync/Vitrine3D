#!/usr/bin/env node
'use strict';

/**
 * meta-server.js — Lightweight OG/oEmbed metadata server + Admin API for Vitrine3D
 *
 * Runs alongside nginx inside the Docker container. Zero npm dependencies.
 *
 * OG/oEmbed routes (always active when server is running):
 *   GET / (bot user-agent)  → HTML with OG + Twitter Card meta tags
 *   GET /oembed              → oEmbed JSON response
 *   GET /health              → 200 OK
 *
 * Admin routes (active when ADMIN_ENABLED=true):
 *   GET  /admin              → Admin panel HTML page
 *   GET  /library            → Library browser page (auth-gated, editorial card grid)
 *   GET  /api/archives       → List all archives with metadata
 *   POST /api/archives       → Upload new archive (multipart/form-data, streamed)
 *   DELETE /api/archives/:hash → Delete archive + sidecar files
 *   PATCH  /api/archives/:hash → Rename archive
 *
 * Reads pre-extracted metadata from /usr/share/nginx/html/meta/{hash}.json
 * and serves thumbnails from /usr/share/nginx/html/thumbs/
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const { execFileSync, execFile } = require('child_process');
const busboy = require('busboy');
const sharp = require('sharp');
const Database = require('/opt/node_modules/better-sqlite3');

// --- Configuration from environment ---

const PORT = parseInt(process.env.META_PORT || '3001', 10);
const SITE_NAME = process.env.SITE_NAME || 'Vitrine3D';
const SITE_URL = process.env.SITE_URL || '';
const SITE_DESCRIPTION = process.env.SITE_DESCRIPTION || 'Interactive 3D viewer';
const OEMBED_WIDTH = parseInt(process.env.OEMBED_WIDTH || '960', 10);
const OEMBED_HEIGHT = parseInt(process.env.OEMBED_HEIGHT || '540', 10);
const ADMIN_ENABLED = (process.env.ADMIN_ENABLED || '').toLowerCase() === 'true';
const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE || '1024', 10) * 1024 * 1024;
const CHUNKED_UPLOAD = (process.env.CHUNKED_UPLOAD || '').toLowerCase() === 'true';
const MAX_CHUNK_SIZE = 100 * 1024 * 1024; // 100 MB per-chunk hard cap
const CHUNKS_DIR = '/tmp/v3d_chunks';
const DEFAULT_KIOSK_THEME = process.env.DEFAULT_KIOSK_THEME || '';

const HTML_ROOT = '/usr/share/nginx/html';
const META_DIR = path.join(HTML_ROOT, 'meta');
const THUMBS_DIR = path.join(HTML_ROOT, 'thumbs');
const ARCHIVES_DIR = path.join(HTML_ROOT, 'archives');
const MEDIA_ROOT = path.join(HTML_ROOT, 'media');
const DB_PATH = process.env.DB_PATH || '/data/vitrine.db';

// --- Settings defaults registry ---
// Resolution: SQLite row → env var → hardcoded default
const SETTINGS_DEFAULTS = {
    'video.crf':              { default: '18',      type: 'number', label: 'Video CRF',              group: 'Video Transcode',  description: 'H.264 quality (0=lossless, 51=worst)', min: 0, max: 51 },
    'video.preset':           { default: 'fast',    type: 'select', label: 'Encoding Preset',         group: 'Video Transcode',  description: 'FFmpeg speed/quality tradeoff', options: ['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'] },
    'recording.bitrate':      { default: '16000000', type: 'number', label: 'Recording Bitrate (bps)', group: 'Video Recording',  description: 'WebM capture bitrate' },
    'recording.framerate':    { default: '30',      type: 'number', label: 'Recording FPS',           group: 'Video Recording',  description: 'Capture frame rate', min: 15, max: 60 },
    'recording.maxDuration':  { default: '60',      type: 'number', label: 'Max Recording Duration (s)', group: 'Video Recording', description: 'Maximum recording length', min: 10, max: 300 },
    'gif.fps':                { default: '15',      type: 'number', label: 'GIF FPS',                 group: 'GIF Generation',   description: 'GIF animation frame rate', min: 5, max: 30 },
    'gif.width':              { default: '480',     type: 'number', label: 'GIF Width (px)',           group: 'GIF Generation',   description: 'GIF output width (height auto)', min: 240, max: 1280 },
    'thumbnail.size':         { default: '512',     type: 'number', label: 'Thumbnail Size (px)',      group: 'Media Output',     description: 'Video thumbnail dimensions', min: 128, max: 1024 },
    'upload.maxSizeMb':       { default: '1024',    type: 'number', label: 'Max Upload Size (MB)',     group: 'Upload',           description: 'Maximum archive upload size', min: 1 },
    'lod.budgetSd':           { default: '1000000', type: 'number', label: 'LOD Budget — SD',         group: 'Renderer',         description: 'Max splats per frame (SD tier)' },
    'lod.budgetHd':           { default: '5000000', type: 'number', label: 'LOD Budget — HD',         group: 'Renderer',         description: 'Max splats per frame (HD tier)' },
    'renderer.maxPixelRatio': { default: '2',       type: 'number', label: 'Max Pixel Ratio',         group: 'Renderer',         description: 'Cap for high-DPI displays', min: 1, max: 4 },
    'flight.djiApiKey':       { default: '',        type: 'string', label: 'DJI API Key',             group: 'Flight Logs',      description: 'API key for decrypting v13+ DJI binary flight logs (.txt). Register at developer.dji.com' },
    'backup.maxVersions':     { default: '5',       type: 'number', label: 'Max Backup Versions',      group: 'Storage',          description: 'Maximum backup versions kept per archive (0 to disable backups)', min: 0, max: 50 },
};

// Env var mapping for settings (key → env var name)
const SETTINGS_ENV_MAP = {
    'upload.maxSizeMb': 'MAX_UPLOAD_SIZE',
    'video.crf':        'VIDEO_CRF',
    'video.preset':     'VIDEO_PRESET',
    'gif.fps':          'GIF_FPS',
    'gif.width':        'GIF_WIDTH',
    'thumbnail.size':   'THUMBNAIL_SIZE',
    'flight.djiApiKey': 'DJI_API_KEY',
};

// In-memory cache: { key: { value, expiry } }
const _settingsCache = {};
const SETTINGS_CACHE_TTL = 5000; // 5 seconds

/**
 * Resolve a single setting value: SQLite → env var → hardcoded default.
 * Cached for SETTINGS_CACHE_TTL ms.
 */
function getSetting(key) {
    const def = SETTINGS_DEFAULTS[key];
    if (!def) return undefined;

    const cached = _settingsCache[key];
    if (cached && Date.now() < cached.expiry) return cached.value;

    // 1. SQLite
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) {
        _settingsCache[key] = { value: row.value, expiry: Date.now() + SETTINGS_CACHE_TTL };
        return row.value;
    }

    // 2. Environment variable
    const envName = SETTINGS_ENV_MAP[key];
    if (envName && process.env[envName]) {
        const envVal = process.env[envName];
        _settingsCache[key] = { value: envVal, expiry: Date.now() + SETTINGS_CACHE_TTL };
        return envVal;
    }

    // 3. Hardcoded default
    _settingsCache[key] = { value: def.default, expiry: Date.now() + SETTINGS_CACHE_TTL };
    return def.default;
}

/**
 * Build the full settings response object for the API.
 * Returns all settings with resolved values, defaults, and metadata.
 */
function getAllSettings() {
    const dbRows = {};
    for (const row of db.prepare('SELECT key, value FROM settings').all()) {
        dbRows[row.key] = row.value;
    }

    const result = {};
    for (const [key, def] of Object.entries(SETTINGS_DEFAULTS)) {
        const dbVal = dbRows[key];
        const envName = SETTINGS_ENV_MAP[key];
        const envVal = envName && process.env[envName] ? process.env[envName] : null;
        const resolved = dbVal ?? envVal ?? def.default;

        result[key] = {
            value: resolved,
            default: def.default,
            isCustom: dbVal !== undefined,
            label: def.label,
            group: def.group,
            type: def.type,
        };
        if (def.description) result[key].description = def.description;
        if (def.min !== undefined) result[key].min = def.min;
        if (def.max !== undefined) result[key].max = def.max;
        if (def.options) result[key].options = def.options;
    }
    return result;
}

/**
 * Validate a setting value against its definition.
 * Returns null if valid, or an error string.
 */
function validateSetting(key, value) {
    const def = SETTINGS_DEFAULTS[key];
    if (!def) return 'Unknown setting: ' + key;

    if (def.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) return key + ': must be a number';
        if (def.min !== undefined && num < def.min) return key + ': minimum is ' + def.min;
        if (def.max !== undefined && num > def.max) return key + ': maximum is ' + def.max;
    }
    if (def.type === 'select') {
        if (!def.options.includes(value)) return key + ': must be one of ' + def.options.join(', ');
    }
    return null;
}

// --- Settings API handlers ---

function handleGetSettings(req, res) {
    sendJson(res, 200, getAllSettings());
}

function handlePutSettings(req, res) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        let updates;
        try {
            updates = JSON.parse(body);
        } catch {
            return sendJson(res, 400, { error: 'Invalid JSON' });
        }

        if (typeof updates !== 'object' || Array.isArray(updates)) {
            return sendJson(res, 400, { error: 'Expected object of key-value pairs' });
        }

        const errors = [];
        const valid = {};
        for (const [key, value] of Object.entries(updates)) {
            const err = validateSetting(key, String(value));
            if (err) errors.push(err);
            else valid[key] = String(value);
        }

        if (errors.length > 0) {
            return sendJson(res, 400, { error: 'Validation failed', details: errors });
        }

        const upsert = db.prepare(
            'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ' +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
        );
        const tx = db.transaction(() => {
            for (const [key, value] of Object.entries(valid)) {
                upsert.run(key, value);
                delete _settingsCache[key];
            }
        });
        tx();

        db.prepare(
            'INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)'
        ).run(actor, 'update_settings', null, JSON.stringify(valid), req.headers['x-real-ip'] || req.socket.remoteAddress);

        sendJson(res, 200, getAllSettings());
    });
}

function handleDeleteSetting(req, res, key) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    if (!SETTINGS_DEFAULTS[key]) {
        return sendJson(res, 400, { error: 'Unknown setting: ' + key });
    }

    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    delete _settingsCache[key];

    db.prepare(
        'INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)'
    ).run(actor, 'reset_setting', key, null, req.headers['x-real-ip'] || req.socket.remoteAddress);

    const settings = getAllSettings();
    sendJson(res, 200, settings[key]);
}

// --- Cloudflare Access auth ---

/**
 * Verify Cloudflare Access header. Returns the authenticated user email,
 * or sends 401 and returns null if the header is missing.
 * Defense in depth: Cloudflare injects this header on every authenticated request.
 */
function requireAuth(req, res) {
    let user = req.headers['cf-access-authenticated-user-email'];

    // Fallback: decode CF_Authorization JWT cookie for CF Access-bypassed paths
    // (e.g. /api/collections/* bypassed so Tauri can read without auth, but
    // the browser still carries the cookie from the main CF Access app)
    if (!user) {
        const cookieHeader = req.headers.cookie || '';
        const match = cookieHeader.match(/CF_Authorization=([^;]+)/);
        if (match) {
            try {
                const payload = JSON.parse(Buffer.from(match[1].split('.')[1], 'base64url').toString());
                if (payload.email) {
                    user = payload.email;
                    // Set on req so downstream checkCsrf() can find it
                    req.headers['cf-access-authenticated-user-email'] = user;
                }
            } catch (_) { /* invalid or expired JWT — ignore */ }
        }
    }

    if (!user) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return null;
    }
    return user;
}

// GET /api/me — returns the authenticated user's email
function handleMe(req, res) {
    const user = requireAuth(req, res);
    if (!user) return;
    sendJson(res, 200, { email: user });
}

// --- CSRF protection ---

// Generated once at process start — not persisted, invalidates on restart (intentional)
const CSRF_KEY = crypto.randomBytes(32);

function csrfToken(user) {
    return crypto.createHmac('sha256', CSRF_KEY).update(user).digest('hex');
}

/**
 * Verify CSRF token on state-changing requests.
 * Returns true if valid, sends 403 and returns false otherwise.
 */
function checkCsrf(req, res) {
    const user = req.headers['cf-access-authenticated-user-email'];
    const header = req.headers['x-csrf-token'];
    const expected = user ? csrfToken(user) : null;
    let valid = false;
    try {
        const headerBuf = Buffer.from(header || '', 'hex');
        const expectedBuf = Buffer.from(expected || '', 'hex');
        valid = !!(header && expected &&
            headerBuf.length === expectedBuf.length &&
            headerBuf.length > 0 &&
            crypto.timingSafeEqual(headerBuf, expectedBuf));
    } catch (_) {
        // length mismatch or other crypto error — treat as invalid
    }
    if (!valid) {
        sendJson(res, 403, { error: 'Invalid CSRF token' });
        return false;
    }
    return true;
}

// GET /api/csrf-token — called by admin SPA on load
function handleCsrfToken(req, res) {
    const user = requireAuth(req, res);
    if (!user) return;
    sendJson(res, 200, { token: csrfToken(user) });
}

// Admin HTML (loaded at startup if enabled)
const ADMIN_HTML = ADMIN_ENABLED ? (() => {
    try { return fs.readFileSync('/opt/admin.html', 'utf8'); }
    catch { return '<html><body><h1>Admin page not found</h1></body></html>'; }
})() : '';

// Index HTML (lazy-loaded for clean /view/ URLs)
let _indexHtml = null;
function getIndexHtml() {
    if (_indexHtml === null) {
        try { _indexHtml = fs.readFileSync(path.join(HTML_ROOT, 'index.html'), 'utf8'); }
        catch { _indexHtml = ''; }
    }
    return _indexHtml;
}

// --- SQLite database ---

let db;

function initDb() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS archives (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid         TEXT    UNIQUE NOT NULL,
            hash         TEXT    UNIQUE NOT NULL,
            filename     TEXT    UNIQUE NOT NULL,
            title        TEXT,
            description  TEXT,
            thumbnail    TEXT,
            asset_types  TEXT,
            metadata_raw TEXT,
            size         INTEGER,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_archives_uuid ON archives(uuid);
        CREATE INDEX IF NOT EXISTS idx_archives_hash ON archives(hash);

        CREATE TABLE IF NOT EXISTS audit_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            actor      TEXT    NOT NULL,
            action     TEXT    NOT NULL,
            target     TEXT,
            detail     TEXT,
            ip         TEXT,
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS collections (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            slug        TEXT    UNIQUE NOT NULL,
            name        TEXT    NOT NULL,
            description TEXT    DEFAULT '',
            thumbnail   TEXT,
            theme       TEXT,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_collections_slug ON collections(slug);

        CREATE TABLE IF NOT EXISTS collection_archives (
            collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            archive_id    INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
            sort_order    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (collection_id, archive_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ca_archive ON collection_archives(archive_id);

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

        CREATE TABLE IF NOT EXISTS settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS archive_versions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            archive_id  INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
            filename    TEXT    NOT NULL,
            size        INTEGER NOT NULL,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_av_archive ON archive_versions(archive_id);
    `);
}

/**
 * Convert a SQLite row from the archives table into the API response object.
 */
function buildArchiveObjectFromRow(row) {
    const archivePath = '/archives/' + row.filename;
    const parsedMeta = row.metadata_raw ? (() => { try { return JSON.parse(row.metadata_raw); } catch (_) { return {}; } })() : {};
    // SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS'; normalise to ISO 8601
    const modified = row.created_at ? row.created_at.replace(' ', 'T') + 'Z' : row.created_at;
    return {
        uuid: row.uuid,
        hash: row.hash,
        filename: row.filename,
        path: archivePath,
        viewerUrl: '/?archive=' + encodeURIComponent(archivePath),
        title: row.title || '',
        description: row.description || '',
        thumbnail: row.thumbnail || null,
        assets: row.asset_types ? (() => { try { return JSON.parse(row.asset_types); } catch (_) { return []; } })() : [],
        metadataFields: parsedMeta.metadata_fields || null,
        size: row.size || 0,
        modified,
    };
}

/**
 * Convert a SQLite row from the collections table into the API response object.
 */
function buildCollectionObject(row) {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description || '',
        thumbnail: row.thumbnail || null,
        theme: row.theme || null,
        archiveCount: row.archive_count || 0,
        created_at: row.created_at ? row.created_at.replace(' ', 'T') + 'Z' : row.created_at,
        updated_at: row.updated_at ? row.updated_at.replace(' ', 'T') + 'Z' : row.updated_at,
    };
}

/**
 * Generate a URL-safe slug from a name string.
 */
function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'collection';
}

/**
 * Read and parse a JSON request body. Calls cb(err, body).
 */
function readJsonBody(req, cb) {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
        try { cb(null, JSON.parse(data)); }
        catch (e) { cb(e, null); }
    });
    req.on('error', cb);
}

// --- Helpers ---

/**
 * Deterministic hash for an archive URL path.
 * Used to map archive URLs to their sidecar metadata files.
 */
function archiveHash(archiveUrl) {
    return crypto.createHash('sha256').update(archiveUrl).digest('hex').slice(0, 16);
}

/**
 * Generate a random 16-character hex ID for media records.
 */
function generateMediaId() {
    return crypto.randomBytes(8).toString('hex');
}


/**
 * Resolve the thumbnail URL for an archive.
 * Falls back to default thumbnail if archive-specific one doesn't exist.
 */
function thumbnailUrl(meta, archiveUrl) {
    if (meta && meta.thumbnail) {
        return SITE_URL + meta.thumbnail;
    }
    // Check if a hash-based thumbnail exists
    if (archiveUrl) {
        const hash = archiveHash(archiveUrl);
        const thumbPath = path.join(THUMBS_DIR, hash + '.jpg');
        if (fs.existsSync(thumbPath)) {
            return SITE_URL + '/thumbs/' + hash + '.jpg';
        }
    }
    // Fall back to operator-provided default
    const defaultThumb = path.join(THUMBS_DIR, 'default.jpg');
    if (fs.existsSync(defaultThumb)) {
        return SITE_URL + '/thumbs/default.jpg';
    }
    return '';
}

/**
 * Extract the ?archive= parameter from a full viewer URL.
 */
function extractArchiveParam(viewerUrl) {
    try {
        const parsed = new URL(viewerUrl);
        return parsed.searchParams.get('archive') || '';
    } catch {
        return '';
    }
}

/**
 * Generate a mosaic thumbnail for a collection from its archive thumbnails.
 * Layout: 2x2 grid for 4+, 2x1 for 2-3, single for 1, branded placeholder for 0.
 * Output: 640x360 JPEG at 85% quality saved to THUMBS_DIR as collection-{slug}-auto.jpg.
 * Returns the URL path string or null on error.
 */
async function generateCollectionMosaic(collectionId, slug) {
    const WIDTH = 640, HEIGHT = 360;
    const NAVY = { r: 8, g: 24, b: 42 };
    const autoPath = path.join(THUMBS_DIR, `collection-${slug}-auto.jpg`);

    const rows = db.prepare(`
        SELECT a.thumbnail FROM archives a
        JOIN collection_archives ca ON ca.archive_id = a.id
        WHERE ca.collection_id = ?
        ORDER BY ca.sort_order ASC
    `).all(collectionId);

    const thumbPaths = [];
    for (const row of rows) {
        if (!row.thumbnail) continue;
        const p = path.join(HTML_ROOT, row.thumbnail);
        if (fs.existsSync(p)) thumbPaths.push(p);
        if (thumbPaths.length >= 4) break;
    }

    try {
        if (thumbPaths.length === 0) {
            const name = db.prepare('SELECT name FROM collections WHERE id = ?').get(collectionId)?.name || '';
            const escapedName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
            const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="#08182a"/>
                <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
                    font-family="sans-serif" font-size="28" fill="#FEC03A">${escapedName}</text>
            </svg>`;
            await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(autoPath);
        } else if (thumbPaths.length === 1) {
            await sharp(thumbPaths[0]).resize(WIDTH, HEIGHT, { fit: 'cover' }).jpeg({ quality: 85 }).toFile(autoPath);
        } else if (thumbPaths.length <= 3) {
            const halfW = WIDTH / 2;
            const tiles = await Promise.all(
                thumbPaths.slice(0, 2).map(p => sharp(p).resize(Math.round(halfW), HEIGHT, { fit: 'cover' }).toBuffer())
            );
            await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: NAVY } })
                .composite([
                    { input: tiles[0], left: 0, top: 0 },
                    { input: tiles[1], left: Math.round(halfW), top: 0 },
                ]).jpeg({ quality: 85 }).toFile(autoPath);
        } else {
            const halfW = Math.round(WIDTH / 2);
            const halfH = Math.round(HEIGHT / 2);
            const tiles = await Promise.all(
                thumbPaths.slice(0, 4).map(p => sharp(p).resize(halfW, halfH, { fit: 'cover' }).toBuffer())
            );
            await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: NAVY } })
                .composite([
                    { input: tiles[0], left: 0, top: 0 },
                    { input: tiles[1], left: halfW, top: 0 },
                    { input: tiles[2], left: 0, top: halfH },
                    { input: tiles[3], left: halfW, top: halfH },
                ]).jpeg({ quality: 85 }).toFile(autoPath);
        }
        console.log(`[meta-server] Generated mosaic for collection "${slug}" at ${autoPath}`);
        return `/thumbs/collection-${slug}-auto.jpg`;
    } catch (err) {
        console.error(`[meta-server] Failed to generate mosaic for collection "${slug}":`, err);
        return null;
    }
}

/**
 * Regenerate the auto mosaic for a collection unless a manual thumbnail is set.
 * Updates the DB thumbnail field if a new mosaic is generated.
 */
async function maybeRegenerateMosaic(collectionId, slug) {
    const row = db.prepare('SELECT thumbnail FROM collections WHERE id = ?').get(collectionId);
    if (!row) return;
    const isManual = row.thumbnail && row.thumbnail.includes(`collection-${slug}.jpg`) && !row.thumbnail.includes('-auto');
    if (isManual) return;
    const autoPath = await generateCollectionMosaic(collectionId, slug);
    if (autoPath) {
        db.prepare('UPDATE collections SET thumbnail = ?, updated_at = datetime(\'now\') WHERE id = ?').run(autoPath, collectionId);
    }
}

/**
 * Escape HTML entities to prevent XSS in meta tag values.
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Strip common Markdown syntax to produce plain text suitable for OG descriptions.
 */
function stripMarkdown(text) {
    if (!text) return '';
    return text
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // remove images entirely
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')     // links → link text
        .replace(/^#{1,6}\s+.*$/gm, '')              // remove entire heading lines
        .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')  // bold/italic
        .replace(/_{1,3}([^_\n]+)_{1,3}/g, '$1')    // underscore bold/italic
        .replace(/`{3}[\s\S]*?`{3}/g, '')            // fenced code blocks
        .replace(/`([^`]+)`/g, '$1')                 // inline code
        .replace(/^>\s+/gm, '')                      // blockquotes
        .replace(/^[-*+]\s+/gm, '')                  // unordered list markers
        .replace(/^\d+\.\s+/gm, '')                  // ordered list markers
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Truncate a plain-text description to maxLen characters, breaking at a word boundary.
 */
function truncateDescription(text, maxLen = 155) {
    if (!text || text.length <= maxLen) return text;
    const cut = text.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut) + '\u2026';
}

/**
 * Check if a request is from a known bot/crawler.
 * Mirrors the $is_bot user-agent map in nginx.conf.template.
 */
const BOT_UA_RE = /googlebot|bingbot|slackbot|twitterbot|facebookexternalhit|linkedinbot|discordbot|whatsapp|applebot|iframely|embedly|pinterest|redditbot|telegrambot|viber|skypeuripreview|tumblr|vkshare|wordpress/i;

function isBotRequest(req) {
    return BOT_UA_RE.test(req.headers['user-agent'] || '');
}

/**
 * Write an OG/Twitter Card HTML response.
 * Shared by handleBotRequest (query-param URLs) and handleView* (clean URLs).
 */
function serveOgHtml(res, title, description, thumb, canonicalUrl, oembedUrl) {
    const t = escapeHtml(title);
    const d = escapeHtml(truncateDescription(stripMarkdown(description)));
    const u = escapeHtml(canonicalUrl);
    const oe = escapeHtml(oembedUrl);
    const i = escapeHtml(thumb);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${t}</title>

    <!-- Open Graph -->
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
    <meta property="og:title" content="${t}">
    <meta property="og:description" content="${d}">
    <meta property="og:url" content="${u}">
    ${i ? `<meta property="og:image" content="${i}">` : ''}

    <!-- Twitter Card -->
    <meta name="twitter:card" content="${i ? 'summary_large_image' : 'summary'}">
    <meta name="twitter:title" content="${t}">
    <meta name="twitter:description" content="${d}">
    ${i ? `<meta name="twitter:image" content="${i}">` : ''}

    <!-- oEmbed discovery -->
    <link rel="alternate" type="application/json+oembed" href="${oe}" title="${t}">

    <!-- Redirect human visitors that somehow reach this page -->
    <meta http-equiv="refresh" content="0;url=${u}">
</head>
<body>
    <p>Redirecting to <a href="${u}">${t}</a>...</p>
</body>
</html>`;

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
    });
    res.end(html);
}

// --- OG/oEmbed Route Handlers ---

/**
 * Generate HTML with OG + Twitter Card meta tags for bot crawlers.
 */
function handleBotRequest(req, res) {
    const parsed = url.parse(req.url, true);
    const archiveUrl = parsed.query.archive || '';
    const archiveFilename = path.basename(archiveUrl);
    const metaRow = archiveFilename ? db.prepare('SELECT * FROM archives WHERE filename = ?').get(archiveFilename) : null;
    const metaTitle = metaRow ? (metaRow.title || SITE_NAME) : SITE_NAME;
    const metaDescription = metaRow ? (metaRow.description || SITE_DESCRIPTION) : SITE_DESCRIPTION;
    const metaThumbnail = metaRow ? metaRow.thumbnail : null;

    serveOgHtml(
        res,
        metaTitle,
        metaDescription,
        metaThumbnail ? SITE_URL + metaThumbnail : thumbnailUrl(null, archiveUrl),
        SITE_URL + (req.url || '/'),
        SITE_URL + '/oembed?url=' + encodeURIComponent(SITE_URL + req.url) + '&format=json'
    );
}

/**
 * Handle /oembed requests per the oEmbed specification.
 */
function handleOembed(req, res) {
    const parsed = url.parse(req.url, true);
    const viewerUrl = parsed.query.url || '';
    const format = parsed.query.format || 'json';

    if (format !== 'json') {
        res.writeHead(501, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only JSON format is supported' }));
        return;
    }

    if (!viewerUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required "url" parameter' }));
        return;
    }

    let archiveUrl = extractArchiveParam(viewerUrl);
    let dbRow = null;

    // For clean /view/{uuid|hash} URLs there is no ?archive= param — look up by path
    if (!archiveUrl) {
        try {
            const parsedViewerUrl = new URL(viewerUrl);
            const uuidMatch = parsedViewerUrl.pathname.match(/^\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
            const hashMatch = parsedViewerUrl.pathname.match(/^\/view\/([a-f0-9]{16})$/);
            if (uuidMatch) dbRow = db.prepare('SELECT * FROM archives WHERE uuid = ?').get(uuidMatch[1]);
            else if (hashMatch) dbRow = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hashMatch[1]);
            if (dbRow) archiveUrl = '/archives/' + dbRow.filename;
        } catch { /* ignore invalid URL */ }
    } else {
        const h = archiveHash(archiveUrl);
        dbRow = db.prepare('SELECT * FROM archives WHERE hash = ?').get(h);
    }

    const title = (dbRow && dbRow.title) || SITE_NAME;
    const thumb = dbRow && dbRow.thumbnail ? SITE_URL + dbRow.thumbnail : thumbnailUrl(null, archiveUrl);

    // Build iframe embed URL with autoload=false for click-to-load gate
    const embedParams = new URLSearchParams();
    if (archiveUrl) embedParams.set('archive', archiveUrl);
    embedParams.set('kiosk', 'true');
    embedParams.set('controls', 'minimal');
    embedParams.set('autoload', 'false');
    const embedUrl = SITE_URL + '/?' + embedParams.toString();

    // Respect maxwidth/maxheight from consumer
    const maxWidth = parsed.query.maxwidth ? parseInt(parsed.query.maxwidth, 10) : null;
    const maxHeight = parsed.query.maxheight ? parseInt(parsed.query.maxheight, 10) : null;
    const width = maxWidth ? Math.min(OEMBED_WIDTH, maxWidth) : OEMBED_WIDTH;
    const height = maxHeight ? Math.min(OEMBED_HEIGHT, maxHeight) : OEMBED_HEIGHT;

    const response = {
        version: '1.0',
        type: 'rich',
        title: title,
        provider_name: SITE_NAME,
        provider_url: SITE_URL || undefined,
        width: width,
        height: height,
        html: `<iframe src="${embedUrl}" width="${width}" height="${height}" frameborder="0" allow="fullscreen" loading="lazy" style="border:0;border-radius:8px;"></iframe>`
    };

    if (thumb) {
        response.thumbnail_url = thumb;
        response.thumbnail_width = 512;
        response.thumbnail_height = 512;
    }

    res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(response));
}

/**
 * Health check endpoint.
 */
function handleHealth(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
}

/**
 * Proxy DJI keychain requests to avoid browser CORS restrictions.
 * POST /api/dji-keychains  — body: KeychainsRequest JSON from dji-log-parser-js
 * Forwards to DJI's API server-side with the configured API key.
 */
function handleDjiKeychains(req, res) {
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }

    const apiKey = getSetting('flight.djiApiKey') || process.env.DJI_API_KEY || '';
    console.log('[meta-server] DJI keychains proxy — apiKey resolved:', apiKey ? '***' + apiKey.slice(-4) : '(empty)', '| env:', process.env.DJI_API_KEY ? 'set' : 'unset');
    if (!apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'DJI API key not configured. Set DJI_API_KEY env var or configure via admin settings.' }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
        const postData = Buffer.from(body, 'utf-8');
        const options = {
            hostname: 'dev.dji.com',
            port: 443,
            path: '/openapi/v1/flight-records/keychains',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Api-Key': apiKey,
                'Content-Length': postData.length,
            },
        };

        const proxyReq = https.request(options, (proxyRes) => {
            let data = '';
            proxyRes.on('data', chunk => { data += chunk; });
            proxyRes.on('end', () => {
                res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
                res.end(data);
            });
        });

        proxyReq.on('error', (err) => {
            console.error('[meta-server] DJI keychains proxy error:', err.message);
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to reach DJI API: ' + err.message }));
        });

        proxyReq.write(postData);
        proxyReq.end();
    });
}

// --- Admin Helpers ---

/**
 * Sanitize an uploaded filename to prevent path traversal and dangerous patterns.
 */
function sanitizeFilename(name) {
    // Strip directory components
    let clean = String(name).split(/[/\\]/).pop() || '';
    // Only allow safe characters
    clean = clean.replace(/[^a-zA-Z0-9_.\-() ]/g, '_');
    // Collapse multiple underscores/spaces
    clean = clean.replace(/_{2,}/g, '_').replace(/ {2,}/g, ' ').trim();
    // Must end with .a3d or .a3z
    if (!/\.(a3d|a3z)$/i.test(clean)) {
        clean += '.a3d';
    }
    // Reject empty, dot-only, or suspicious names
    if (!clean || /^\./.test(clean) || clean === '.a3d' || clean === '.a3z') {
        return 'archive_' + Date.now() + '.a3d';
    }
    // Limit length
    if (clean.length > 200) {
        const ext = clean.slice(clean.lastIndexOf('.'));
        clean = clean.slice(0, 200 - ext.length) + ext;
    }
    return clean;
}

/**
 * Run extract-meta.sh on a single archive file to generate/regenerate sidecars.
 */
function runExtractMeta(absolutePath) {
    try {
        execFileSync(
            '/opt/extract-meta.sh',
            [HTML_ROOT, HTML_ROOT, absolutePath],
            { timeout: 30000, stdio: 'pipe' }
        );
    } catch (err) {
        console.error('[admin] extract-meta failed:', err.message);
    }
}

// --- Streaming Multipart Parser ---

/**
 * Parse a multipart/form-data upload using busboy, streaming the first file to disk.
 * Returns { tmpPath, filename }. Rejects with Error('LIMIT') if MAX_UPLOAD_SIZE exceeded.
 */
function parseMultipartUpload(req) {
    return new Promise((resolve, reject) => {
        const tmpPath = path.join('/tmp', 'v3d_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
        let filename = '';
        let writeStream = null;
        let settled = false;

        function finish(err, result) {
            if (settled) return;
            settled = true;
            if (err) {
                if (writeStream) { try { writeStream.destroy(); } catch {} }
                try { fs.unlinkSync(tmpPath); } catch {}
                reject(err);
            } else {
                resolve(result);
            }
        }

        let bb;
        try {
            bb = busboy({ headers: req.headers, limits: { fileSize: parseInt(getSetting('upload.maxSizeMb'), 10) * 1024 * 1024 } });
        } catch (err) {
            return reject(err);
        }

        bb.on('file', (_fieldname, file, info) => {
            filename = sanitizeFilename(info.filename || '');
            writeStream = fs.createWriteStream(tmpPath);
            writeStream.on('error', finish);
            file.on('limit', () => {
                req.unpipe(bb);
                bb.destroy();
                finish(new Error('LIMIT'));
            });
            file.pipe(writeStream);
        });

        bb.on('close', () => {
            if (!filename) return finish(new Error('No file field in upload'));
            if (!writeStream) return finish(new Error('No file data received'));
            // file.pipe(writeStream) already ends the stream; guard against double-end
            if (writeStream.writableFinished) {
                finish(null, { tmpPath, filename });
            } else {
                writeStream.end(() => finish(null, { tmpPath, filename }));
            }
        });

        bb.on('error', finish);
        req.on('error', finish);
        req.pipe(bb);
    });
}

// --- Admin API Handlers ---

function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

/**
 * GET /admin — serve the admin HTML page
 */
function handleAdminPage(req, res) {
    if (!requireAuth(req, res)) return;
    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(ADMIN_HTML);
}

/**
 * GET /library — serve the library browser page.
 * Auth-gated like /admin. Injects __VITRINE_LIBRARY flag for client-side rendering.
 */
function handleLibraryPage(req, res) {
    if (!requireAuth(req, res)) return;

    const indexHtml = getIndexHtml();
    if (!indexHtml) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('index.html not found');
        return;
    }

    const injectTag = '<script>window.__VITRINE_LIBRARY=true;</script>\n';

    let html = indexHtml.replace(/<head>/i, '<head>\n<base href="/">');
    html = html.replace(/<script[\s>]/i, (m) => injectTag + m);

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(html);
}

/**
 * GET /api/auth-callback — CF Access auth relay for Tauri app.
 * After CF Access authenticates the user, this reads the CF_Authorization
 * JWT cookie and redirects to the vitrine3d:// deep link with the token.
 */
function handleAuthCallback(req, res) {
    if (!requireAuth(req, res)) return;

    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/CF_Authorization=([^;]+)/);
    const token = match ? match[1] : '';

    const deepLink = 'vitrine3d://auth?token=' + encodeURIComponent(token);

    // Detect Android/mobile — Chrome blocks window.location.href to custom schemes
    // but honours intent:// URIs and user-initiated <a> clicks.
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    const isMobile = /android|iphone|ipad|mobile/i.test(ua);

    // Android intent:// URI — tells Chrome to launch the app by package scheme
    // without ERR_UNKNOWN_URL_SCHEME. Falls back gracefully if app not installed.
    const intentUri = 'intent://auth?token=' + encodeURIComponent(token) +
        '#Intent;scheme=vitrine3d;end';

    const html = '<!DOCTYPE html>\n' +
        '<html><head><meta charset="utf-8"><title>Vitrine3D — Authenticated</title>\n' +
        '<style>\n' +
        'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;\n' +
        '       background: #08182a; color: #e8ecf0; display: flex; align-items: center;\n' +
        '       justify-content: center; height: 100vh; margin: 0; text-align: center; }\n' +
        '.card { max-width: 400px; padding: 40px; }\n' +
        'h1 { font-size: 1.2rem; margin-bottom: 12px; }\n' +
        'p { color: rgba(140,160,180,0.7); font-size: 0.9rem; line-height: 1.5; }\n' +
        'a { color: #FEC03A; text-decoration: none; }\n' +
        '.btn { display: inline-block; margin-top: 20px; padding: 14px 32px;\n' +
        '       background: #FEC03A; color: #08182a; border-radius: 8px;\n' +
        '       font-weight: 600; font-size: 1rem; }\n' +
        '</style>\n' +
        '</head><body><div class="card">\n' +
        '<h1>Authentication Successful</h1>\n' +
        (isMobile
            // Mobile: show a prominent tap button (intent:// URI works on Android)
            ? '<p>Tap below to return to the app.</p>\n' +
              '<a class="btn" href="' + intentUri.replace(/"/g, '&quot;') + '">Open Vitrine3D</a>\n' +
              '<p style="margin-top: 16px; font-size: 0.8rem;">\n' +
              'Or try <a href="' + deepLink.replace(/"/g, '&quot;') + '">this link</a> if the button doesn\'t work.</p>\n'
            // Desktop: auto-redirect via JS (works on Windows/macOS/Linux)
            : '<p>Returning to Vitrine3D...</p>\n' +
              '<p style="margin-top: 24px; font-size: 0.8rem;">\n' +
              'If the app didn\'t open, <a href="' + deepLink.replace(/"/g, '&quot;') + '">click here</a>.</p>\n'
        ) +
        '<p style="font-size: 0.75rem; color: rgba(140,160,180,0.4);">You can close this tab after returning.</p>\n' +
        '</div>\n' +
        (isMobile ? '' : '<script>window.location.href = ' + JSON.stringify(deepLink) + ';</script>\n') +
        '</body></html>';

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
}

/**
 * GET /api/archives — list all archives
 */
function handleListArchives(req, res) {
    if (!requireAuth(req, res)) return;
    try {
        const rows = db.prepare('SELECT * FROM archives ORDER BY created_at DESC').all();
        const archives = rows.map(buildArchiveObjectFromRow);
        const storageUsed = rows.reduce((sum, r) => sum + (r.size || 0), 0);
        sendJson(res, 200, { archives, storageUsed });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * GET /api/audit-log — list audit log entries with optional filtering
 */
function handleAuditLog(req, res) {
    if (!requireAuth(req, res)) return;
    try {
        const query = url.parse(req.url, true).query;

        let limit = parseInt(query.limit, 10) || 50;
        if (limit > 200) limit = 200;
        let offset = parseInt(query.offset, 10) || 0;
        if (offset < 0) offset = 0;

        const conditions = [];
        const params = [];

        if (query.actor) {
            conditions.push('actor = ?');
            params.push(query.actor);
        }
        if (query.action) {
            conditions.push('action = ?');
            params.push(query.action);
        }
        if (query.from) {
            conditions.push("created_at >= datetime(?)");
            params.push(query.from);
        }
        if (query.to) {
            conditions.push("created_at <= datetime(?)");
            params.push(query.to);
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        const total = db.prepare(`SELECT COUNT(*) AS cnt FROM audit_log ${where}`).get(...params).cnt;
        const entries = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

        const actors = db.prepare('SELECT DISTINCT actor FROM audit_log WHERE actor IS NOT NULL ORDER BY actor').all().map(r => r.actor);
        const actions = db.prepare('SELECT DISTINCT action FROM audit_log WHERE action IS NOT NULL ORDER BY action').all().map(r => r.action);

        sendJson(res, 200, { entries, total, limit, offset, actors, actions });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * GET /api/storage — storage overview: archive list, disk usage, orphans
 */
function handleStorage(req, res) {
    if (!requireAuth(req, res)) return;
    try {
        const rows = db.prepare('SELECT hash, filename, size, asset_types, created_at FROM archives ORDER BY size DESC').all();
        const totalUsed = rows.reduce((sum, r) => sum + (r.size || 0), 0);

        let diskFree = null;
        let diskTotal = null;
        try {
            const stats = fs.statfsSync(ARCHIVES_DIR);
            diskTotal = stats.bsize * stats.blocks;
            diskFree = stats.bsize * stats.bfree;
        } catch {}

        let dbSize = null;
        try { dbSize = fs.statSync(DB_PATH).size; } catch {}

        const dbFilenames = new Set(rows.map(r => r.filename));
        let orphans = [];
        try {
            const files = fs.readdirSync(ARCHIVES_DIR);
            for (const file of files) {
                if (!dbFilenames.has(file)) {
                    let size = null;
                    try { size = fs.statSync(path.join(ARCHIVES_DIR, file)).size; } catch {}
                    orphans.push({ filename: file, size });
                }
            }
        } catch {}

        sendJson(res, 200, { archives: rows, totalUsed, diskFree, diskTotal, dbSize, orphans });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * DELETE /api/storage/orphans/:filename — delete an orphaned archive file
 */
function handleDeleteOrphan(req, res, filename) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;

    // Validate filename — no path separators, must end with .a3d or .a3z
    if (filename.includes('/') || filename.includes('\\')) {
        return sendJson(res, 400, { error: 'Invalid filename' });
    }
    if (!filename.endsWith('.a3d') && !filename.endsWith('.a3z')) {
        return sendJson(res, 400, { error: 'Invalid file type' });
    }

    const filePath = path.join(ARCHIVES_DIR, filename);

    // Path traversal protection
    try {
        const realPath = fs.realpathSync(filePath);
        const realArchivesDir = fs.realpathSync(ARCHIVES_DIR);
        if (!realPath.startsWith(realArchivesDir + '/') && realPath !== realArchivesDir) {
            return sendJson(res, 403, { error: 'Access denied' });
        }
    } catch {
        return sendJson(res, 404, { error: 'File not found' });
    }

    // Verify it's actually an orphan (not in DB)
    const existing = db.prepare('SELECT id FROM archives WHERE filename = ?').get(filename);
    if (existing) {
        return sendJson(res, 409, { error: 'File is tracked in database — use DELETE /api/archives/:hash instead' });
    }

    try {
        fs.unlinkSync(filePath);
    } catch (err) {
        return sendJson(res, 500, { error: err.message });
    }

    const orphanActor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
    db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
      .run(orphanActor, 'delete_orphan', filename, JSON.stringify({ orphan: true }), req.headers['x-real-ip'] || null);

    sendJson(res, 200, { deleted: true, filename });
}

/**
 * Prune old backup versions for an archive, keeping only maxVersions most recent.
 * Must be called inside an existing db.transaction().
 * @param {number} archiveId - The archive's DB row id
 * @param {number} maxVersions - Max backups to retain
 */
function pruneArchiveVersions(archiveId, maxVersions) {
    const versions = db.prepare(
        'SELECT id, filename FROM archive_versions WHERE archive_id = ? ORDER BY created_at DESC, id DESC'
    ).all(archiveId);

    const toDelete = versions.slice(maxVersions);
    const deleteStmt = db.prepare('DELETE FROM archive_versions WHERE id = ?');

    for (const v of toDelete) {
        const fullPath = path.join(ARCHIVES_DIR, v.filename);
        deleteStmt.run(v.id);
        try { fs.unlinkSync(fullPath); } catch {}
    }

    // Clean up empty history subdirectory
    if (toDelete.length > 0) {
        const histDir = path.dirname(path.join(ARCHIVES_DIR, versions[0].filename));
        try {
            const remaining = fs.readdirSync(histDir);
            if (remaining.length === 0) fs.rmdirSync(histDir);
        } catch {}
    }
}

/**
 * Back up an existing archive file to history/ and replace it with a new upload.
 * Handles backup rotation, DB upsert, metadata extraction, and audit logging.
 * Called by both handleUploadArchive and handleCompleteChunk when a file already exists.
 *
 * @param {Object} existingRow - The existing archives DB row (from SELECT * WHERE filename = ?)
 * @param {string} tmpPath - Path to the newly uploaded temp file
 * @param {string} filename - The target archive filename
 * @param {Object} req - HTTP request (for actor extraction)
 * @returns {Object} The updated archive DB row
 */
function backupAndReplace(existingRow, tmpPath, filename, req) {
    const finalPath = path.join(ARCHIVES_DIR, filename);
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);
    const maxVersions = parseInt(getSetting('backup.maxVersions'), 10) || 0;

    let backupRelPath = null;
    let existingSize = 0;

    // --- Phase 1: Filesystem operations (outside transaction) ---
    // If these fail, no DB state has changed — safe to abort.

    if (maxVersions > 0) {
        const histDir = path.join(ARCHIVES_DIR, 'history', basename);
        if (!fs.existsSync(histDir)) {
            fs.mkdirSync(histDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const backupFilename = basename + '.' + timestamp + ext;
        backupRelPath = path.join('history', basename, backupFilename);
        const backupFullPath = path.join(ARCHIVES_DIR, backupRelPath);

        existingSize = fs.statSync(finalPath).size;

        // Move existing file to history (rename if same FS, copy+delete otherwise)
        try {
            fs.renameSync(finalPath, backupFullPath);
        } catch {
            try {
                fs.copyFileSync(finalPath, backupFullPath);
                fs.unlinkSync(finalPath);
            } catch (copyErr) {
                // Clean up partial backup on failure
                try { fs.unlinkSync(backupFullPath); } catch {}
                throw copyErr;
            }
        }
    } else {
        // No backup — just remove existing file
        try { fs.unlinkSync(finalPath); } catch {}
    }

    // Move new upload into place
    try {
        fs.renameSync(tmpPath, finalPath);
    } catch {
        fs.copyFileSync(tmpPath, finalPath);
        try { fs.unlinkSync(tmpPath); } catch {}
    }

    // Extract metadata (slow — runs external shell script, keep outside transaction)
    const archiveUrl = '/archives/' + filename;
    const hash = archiveHash(archiveUrl);
    runExtractMeta(finalPath);

    let metaRaw = {};
    const metaJsonPath = path.join(META_DIR, hash + '.json');
    try { metaRaw = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8')); } catch (_) {}

    const thumbPath = '/thumbs/' + hash + '.jpg';
    const thumbExists = fs.existsSync(path.join(HTML_ROOT, 'thumbs', hash + '.jpg'));
    const newSize = fs.statSync(finalPath).size;

    // --- Phase 2: DB operations (inside transaction) ---
    // If the transaction fails, the file is already in place but DB is consistent.
    // Compensating FS rollback is not attempted — the file on disk is the newer version
    // which is the correct state even if the DB update needs to be retried.

    const doDbUpdates = db.transaction(() => {
        // Record backup version
        if (maxVersions > 0 && backupRelPath) {
            db.prepare(
                'INSERT INTO archive_versions (archive_id, filename, size) VALUES (?, ?, ?)'
            ).run(existingRow.id, backupRelPath, existingSize);

            pruneArchiveVersions(existingRow.id, maxVersions);
        }

        // Upsert archives row (uuid only used on first insert — preserved on conflict)
        db.prepare(`
            INSERT INTO archives
                (uuid, hash, filename, title, description, thumbnail, asset_types, metadata_raw, size, updated_at)
            VALUES
                (@uuid, @hash, @filename, @title, @description, @thumbnail, @asset_types, @metadata_raw, @size, datetime('now'))
            ON CONFLICT(hash) DO UPDATE SET
                filename    = excluded.filename,
                title       = excluded.title,
                description = excluded.description,
                thumbnail   = excluded.thumbnail,
                asset_types = excluded.asset_types,
                metadata_raw= excluded.metadata_raw,
                size        = excluded.size,
                updated_at  = excluded.updated_at
        `).run({
            uuid: crypto.randomUUID(),
            hash,
            filename,
            title: metaRaw.title || null,
            description: metaRaw.description || null,
            thumbnail: thumbExists ? thumbPath : null,
            asset_types: (metaRaw.asset_types || metaRaw.assets) ? JSON.stringify(metaRaw.asset_types || metaRaw.assets) : null,
            metadata_raw: JSON.stringify(metaRaw),
            size: newSize,
        });

        // Audit log
        const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
        db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
          .run(actor, 'upload_replace', filename, JSON.stringify({ hash, size: newSize, backed_up: maxVersions > 0 }), req.headers['x-real-ip'] || null);

        return db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
    });

    return doDbUpdates();
}

/**
 * POST /api/archives — upload a new archive
 */
async function handleUploadArchive(req, res) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;
    try {
        const { tmpPath, filename } = await parseMultipartUpload(req);
        const finalPath = path.join(ARCHIVES_DIR, filename);

        // Ensure archives directory exists
        if (!fs.existsSync(ARCHIVES_DIR)) {
            fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
        }

        // If file already exists, backup and replace instead of rejecting
        if (fs.existsSync(finalPath)) {
            const existingRow = db.prepare('SELECT * FROM archives WHERE filename = ?').get(filename);
            if (existingRow) {
                const updatedRow = backupAndReplace(existingRow, tmpPath, filename, req);
                return sendJson(res, 200, buildArchiveObjectFromRow(updatedRow));
            }
            // Edge case: file on disk but no DB row — remove orphan and proceed as new upload
            try { fs.unlinkSync(finalPath); } catch {}
        }

        // Move from temp to archives (rename if same filesystem, copy+delete otherwise)
        try {
            fs.renameSync(tmpPath, finalPath);
        } catch {
            // Cross-device: copy then delete
            fs.copyFileSync(tmpPath, finalPath);
            try { fs.unlinkSync(tmpPath); } catch {}
        }

        // Extract metadata
        const archiveUrl = '/archives/' + filename;
        const hash = archiveHash(archiveUrl);
        runExtractMeta(finalPath);

        // Import extracted metadata into SQLite
        let metaRaw = {};
        const metaJsonPath = path.join(META_DIR, hash + '.json');
        try { metaRaw = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8')); } catch (_) {}

        const thumbPath = '/thumbs/' + hash + '.jpg';
        const thumbExists = fs.existsSync(path.join(HTML_ROOT, 'thumbs', hash + '.jpg'));

        db.prepare(`
            INSERT INTO archives
                (uuid, hash, filename, title, description, thumbnail, asset_types, metadata_raw, size, updated_at)
            VALUES
                (@uuid, @hash, @filename, @title, @description, @thumbnail, @asset_types, @metadata_raw, @size, datetime('now'))
            ON CONFLICT(hash) DO UPDATE SET
                filename    = excluded.filename,
                title       = excluded.title,
                description = excluded.description,
                thumbnail   = excluded.thumbnail,
                asset_types = excluded.asset_types,
                metadata_raw= excluded.metadata_raw,
                size        = excluded.size,
                updated_at  = excluded.updated_at
        `).run({
            uuid: crypto.randomUUID(),
            hash,
            filename,
            title: metaRaw.title || null,
            description: metaRaw.description || null,
            thumbnail: thumbExists ? thumbPath : null,
            asset_types: (metaRaw.asset_types || metaRaw.assets) ? JSON.stringify(metaRaw.asset_types || metaRaw.assets) : null,
            metadata_raw: JSON.stringify(metaRaw),
            size: fs.statSync(finalPath).size,
        });

        // Audit log
        const uploadActor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
        db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
          .run(uploadActor, 'upload', filename, JSON.stringify({ hash, size: fs.statSync(finalPath).size }), req.headers['x-real-ip'] || null);

        const uploadedRow = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
        sendJson(res, 201, buildArchiveObjectFromRow(uploadedRow));
    } catch (err) {
        if (err.message === 'LIMIT') {
            sendJson(res, 413, { error: 'Upload exceeds maximum size (' + getSetting('upload.maxSizeMb') + ' MB)' });
        } else {
            console.error('[admin] Upload error:', err.message);
            sendJson(res, 500, { error: err.message });
        }
    }
}

/**
 * DELETE /api/archives/:hash — delete an archive and its sidecars
 */
function handleDeleteArchive(req, res, hash) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;
    const row = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
    if (!row) return sendJson(res, 404, { error: 'Archive not found' });

    const filePath = path.join(ARCHIVES_DIR, row.filename);

    // Path traversal protection: verify resolved path is under ARCHIVES_DIR
    try {
        const realPath = fs.realpathSync(filePath);
        const realArchivesDir = fs.realpathSync(ARCHIVES_DIR);
        if (!realPath.startsWith(realArchivesDir + '/') && realPath !== realArchivesDir) {
            return sendJson(res, 403, { error: 'Access denied' });
        }
    } catch {
        return sendJson(res, 404, { error: 'Archive not found' });
    }

    // Delete archive file
    try { fs.unlinkSync(filePath); } catch {}
    // Delete sidecar files
    try { fs.unlinkSync(path.join(META_DIR, hash + '.json')); } catch {}
    try { fs.unlinkSync(path.join(THUMBS_DIR, hash + '.jpg')); } catch {}
    // Delete history directory for this archive (backup files)
    const deleteBasename = path.parse(row.filename).name;
    const historyDir = path.join(ARCHIVES_DIR, 'history', deleteBasename);
    try { fs.rmSync(historyDir, { recursive: true }); } catch {}

    // Delete from DB + audit log atomically (archive_versions cascade-deleted)
    const deleteActor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
    db.transaction(() => {
        db.prepare('DELETE FROM archives WHERE hash = ?').run(hash);
        db.prepare(`INSERT INTO audit_log (actor, action, target, ip) VALUES (?, ?, ?, ?)`)
          .run(deleteActor, 'delete', hash, req.headers['x-real-ip'] || null);
    })();

    sendJson(res, 200, { deleted: true, path: '/archives/' + row.filename });
}

/**
 * POST /api/archives/:hash/regenerate — re-extract metadata and thumbnail
 */
function handleRegenerateArchive(req, res, hash) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;
    const row = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
    if (!row) return sendJson(res, 404, { error: 'Archive not found' });

    const filePath = path.join(ARCHIVES_DIR, row.filename);

    // Delete existing sidecar files so extract-meta.sh does a full re-extract
    try { fs.unlinkSync(path.join(META_DIR, hash + '.json')); } catch {}
    try { fs.unlinkSync(path.join(THUMBS_DIR, hash + '.jpg')); } catch {}

    runExtractMeta(filePath);

    // Re-import extracted metadata into SQLite
    let metaRaw = {};
    const metaJsonPath = path.join(META_DIR, hash + '.json');
    try { metaRaw = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8')); } catch (_) {}

    const thumbPath = '/thumbs/' + hash + '.jpg';
    const thumbExists = fs.existsSync(path.join(HTML_ROOT, 'thumbs', hash + '.jpg'));

    db.prepare(`
        UPDATE archives SET
            title = @title,
            description = @description,
            thumbnail = @thumbnail,
            asset_types = @asset_types,
            metadata_raw = @metadata_raw,
            updated_at = datetime('now')
        WHERE hash = @hash
    `).run({
        title: metaRaw.title || null,
        description: metaRaw.description || null,
        thumbnail: thumbExists ? thumbPath : null,
        asset_types: (metaRaw.asset_types || metaRaw.assets) ? JSON.stringify(metaRaw.asset_types || metaRaw.assets) : null,
        metadata_raw: JSON.stringify(metaRaw),
        hash,
    });

    const regenActor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
    db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
      .run(regenActor, 'regenerate', hash, JSON.stringify({ filename: row.filename }), req.headers['x-real-ip'] || null);

    const updatedRow = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
    sendJson(res, 200, buildArchiveObjectFromRow(updatedRow));
}

/**
 * PATCH /api/archives/:hash — rename an archive
 */
function handleRenameArchive(req, res, hash) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;
    let body = '';
    req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4096) {
            req.destroy();
            sendJson(res, 413, { error: 'Request body too large' });
        }
    });
    req.on('end', () => {
        try {
            const parsed = JSON.parse(body);
            const newName = parsed.filename;
            if (!newName) return sendJson(res, 400, { error: 'Missing filename' });

            const oldRow = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
            if (!oldRow) return sendJson(res, 404, { error: 'Archive not found' });

            const oldFilePath = path.join(ARCHIVES_DIR, oldRow.filename);

            // Path traversal protection
            try {
                const realPath = fs.realpathSync(oldFilePath);
                const realArchivesDir = fs.realpathSync(ARCHIVES_DIR);
                if (!realPath.startsWith(realArchivesDir + '/') && realPath !== realArchivesDir) {
                    return sendJson(res, 403, { error: 'Access denied' });
                }
            } catch {
                return sendJson(res, 404, { error: 'Archive not found' });
            }

            const sanitized = sanitizeFilename(newName);
            const newPath = path.join(ARCHIVES_DIR, sanitized);

            if (fs.existsSync(newPath)) {
                return sendJson(res, 409, { error: 'File already exists: ' + sanitized });
            }

            // Rename the file
            fs.renameSync(oldFilePath, newPath);

            // Rename history directory if it exists
            const oldBasename = path.parse(oldRow.filename).name;
            const newBasename = path.parse(sanitized).name;
            const oldHistDir = path.join(ARCHIVES_DIR, 'history', oldBasename);
            const newHistDir = path.join(ARCHIVES_DIR, 'history', newBasename);
            if (fs.existsSync(oldHistDir)) {
                if (fs.existsSync(newHistDir)) {
                    // Conflict — revert file rename and abort
                    fs.renameSync(newPath, oldFilePath);
                    return sendJson(res, 409, { error: 'History directory conflict: ' + newBasename });
                }
                fs.renameSync(oldHistDir, newHistDir);
            }

            // Clean old sidecar files
            try { fs.unlinkSync(path.join(META_DIR, hash + '.json')); } catch {}
            try { fs.unlinkSync(path.join(THUMBS_DIR, hash + '.jpg')); } catch {}

            // Regenerate metadata for the renamed file
            runExtractMeta(newPath);

            // Compute new hash based on new archive URL
            const newArchiveUrl = '/archives/' + sanitized;
            const newHash = archiveHash(newArchiveUrl);

            // Re-import extracted metadata
            let metaRaw = {};
            const metaJsonPath = path.join(META_DIR, newHash + '.json');
            try { metaRaw = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8')); } catch (_) {}

            const thumbPath = '/thumbs/' + newHash + '.jpg';
            const thumbExists = fs.existsSync(path.join(HTML_ROOT, 'thumbs', newHash + '.jpg'));

            // Update DB + audit log atomically — preserve uuid, update hash, filename, and metadata
            const renameActor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
            db.transaction(() => {
                db.prepare(`
                    UPDATE archives SET
                        hash = @newHash,
                        filename = @filename,
                        title = @title,
                        description = @description,
                        thumbnail = @thumbnail,
                        asset_types = @asset_types,
                        metadata_raw = @metadata_raw,
                        updated_at = datetime('now')
                    WHERE hash = @oldHash
                `).run({
                    newHash,
                    filename: sanitized,
                    title: metaRaw.title || null,
                    description: metaRaw.description || null,
                    thumbnail: thumbExists ? thumbPath : null,
                    asset_types: (metaRaw.asset_types || metaRaw.assets) ? JSON.stringify(metaRaw.asset_types || metaRaw.assets) : null,
                    metadata_raw: JSON.stringify(metaRaw),
                    oldHash: hash,
                });
                // Update version filenames to reflect new basename
                db.prepare(
                    'UPDATE archive_versions SET filename = replace(filename, ?, ?) WHERE archive_id = ?'
                ).run('history/' + oldBasename + '/', 'history/' + newBasename + '/', oldRow.id);

                db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
                  .run(renameActor, 'rename', hash, JSON.stringify({ old: oldRow.filename, new: sanitized }), req.headers['x-real-ip'] || null);
            })();

            const renamedRow = db.prepare('SELECT * FROM archives WHERE hash = ?').get(newHash);
            sendJson(res, 200, buildArchiveObjectFromRow(renamedRow));
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
    });
}

// --- Version History API Handlers ---

/**
 * GET /api/archives/:hash/versions — list backup versions for an archive
 */
function handleListVersions(req, res, hash) {
    if (!requireAuth(req, res)) return;
    const row = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
    if (!row) return sendJson(res, 404, { error: 'Archive not found' });

    const versions = db.prepare(
        'SELECT id, size, created_at FROM archive_versions WHERE archive_id = ? ORDER BY created_at DESC, id DESC'
    ).all(row.id);

    sendJson(res, 200, { versions });
}

/**
 * GET /api/archives/:hash/versions/:id/download — download a specific backup
 */
function handleDownloadVersion(req, res, hash, versionId) {
    if (!requireAuth(req, res)) return;
    const row = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
    if (!row) return sendJson(res, 404, { error: 'Archive not found' });

    const version = db.prepare(
        'SELECT * FROM archive_versions WHERE id = ? AND archive_id = ?'
    ).get(versionId, row.id);
    if (!version) return sendJson(res, 404, { error: 'Version not found' });

    // Path traversal protection: resolved path must be under ARCHIVES_DIR/history/
    const fullPath = path.join(ARCHIVES_DIR, version.filename);
    try {
        const realPath = fs.realpathSync(fullPath);
        const realHistoryDir = fs.realpathSync(path.join(ARCHIVES_DIR, 'history'));
        if (!realPath.startsWith(realHistoryDir + '/') && !realPath.startsWith(realHistoryDir + '\\')) {
            return sendJson(res, 403, { error: 'Access denied' });
        }
    } catch {
        return sendJson(res, 404, { error: 'Backup file not found on disk' });
    }

    const stat = fs.statSync(fullPath);
    const downloadName = path.basename(version.filename);
    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="' + downloadName + '"',
        'Content-Length': stat.size,
    });
    fs.createReadStream(fullPath).pipe(res);
}

/**
 * DELETE /api/archives/:hash/versions/:id — delete a specific backup
 */
function handleDeleteVersion(req, res, hash, versionId) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;
    const row = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
    if (!row) return sendJson(res, 404, { error: 'Archive not found' });

    const version = db.prepare(
        'SELECT * FROM archive_versions WHERE id = ? AND archive_id = ?'
    ).get(versionId, row.id);
    if (!version) return sendJson(res, 404, { error: 'Version not found' });

    // Path traversal protection
    const fullPath = path.join(ARCHIVES_DIR, version.filename);
    try {
        const realPath = fs.realpathSync(fullPath);
        const realHistoryDir = fs.realpathSync(path.join(ARCHIVES_DIR, 'history'));
        if (!realPath.startsWith(realHistoryDir + '/') && !realPath.startsWith(realHistoryDir + '\\')) {
            return sendJson(res, 403, { error: 'Access denied' });
        }
    } catch {
        // File already gone from disk — still delete DB row
    }

    // Delete file from disk
    try { fs.unlinkSync(fullPath); } catch {}

    // Delete DB row + audit
    const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
    db.transaction(() => {
        db.prepare('DELETE FROM archive_versions WHERE id = ?').run(versionId);
        db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
          .run(actor, 'delete_version', hash, JSON.stringify({ version_id: versionId }), req.headers['x-real-ip'] || null);
    })();

    // Clean up empty history subdirectory
    const histSubdir = path.dirname(fullPath);
    try {
        const remaining = fs.readdirSync(histSubdir);
        if (remaining.length === 0) fs.rmdirSync(histSubdir);
    } catch {}

    sendJson(res, 200, { deleted: true });
}

// --- Collection API Handlers ---

/**
 * GET /api/collections — list all collections with archive counts.
 * Public endpoint (no auth required).
 */
function handleListCollections(req, res) {
    try {
        const rows = db.prepare(`
            SELECT c.*, COUNT(ca.archive_id) AS archive_count
            FROM collections c
            LEFT JOIN collection_archives ca ON ca.collection_id = c.id
            GROUP BY c.id
            ORDER BY c.name ASC
        `).all();
        sendJson(res, 200, { collections: rows.map(buildCollectionObject) });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * GET /api/collections/:slug — get a single collection with its ordered archives.
 * Public endpoint (no auth required).
 */
function handleGetCollection(req, res, slug) {
    try {
        const row = db.prepare(`
            SELECT c.*, COUNT(ca.archive_id) AS archive_count
            FROM collections c
            LEFT JOIN collection_archives ca ON ca.collection_id = c.id
            WHERE c.slug = ?
            GROUP BY c.id
        `).get(slug);

        if (!row) {
            sendJson(res, 404, { error: 'Collection not found' });
            return;
        }

        const archiveRows = db.prepare(`
            SELECT a.* FROM archives a
            JOIN collection_archives ca ON ca.archive_id = a.id
            WHERE ca.collection_id = ?
            ORDER BY ca.sort_order ASC, a.title ASC
        `).all(row.id);

        const collection = buildCollectionObject(row);
        collection.archives = archiveRows.map(buildArchiveObjectFromRow);

        sendJson(res, 200, collection);
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * POST /api/collections — create a new collection.
 * Admin-gated. Body: { name, slug?, description?, thumbnail?, theme? }
 */
function handleCreateCollection(req, res) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
        const name = (body.name || '').trim();
        if (!name) return sendJson(res, 400, { error: 'Name is required' });

        const slug = (body.slug || slugify(name)).trim();
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
            return sendJson(res, 400, { error: 'Invalid slug: lowercase alphanumeric and hyphens only, 1-80 chars' });
        }

        const description = (body.description || '').trim();
        const thumbnail = body.thumbnail || null;
        const theme = body.theme || null;

        if (theme && !['editorial', 'gallery', 'exhibit', 'minimal'].includes(theme)) {
            return sendJson(res, 400, { error: 'Invalid theme' });
        }

        try {
            const existing = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
            if (existing) return sendJson(res, 409, { error: 'A collection with this slug already exists' });

            db.prepare(`
                INSERT INTO collections (slug, name, description, thumbnail, theme)
                VALUES (?, ?, ?, ?, ?)
            `).run(slug, name, description, thumbnail, theme);

            db.prepare(`INSERT INTO audit_log (actor, action, target, ip) VALUES (?, ?, ?, ?)`)
                .run(actor, 'create_collection', slug, req.headers['x-real-ip'] || req.socket.remoteAddress);

            const row = db.prepare('SELECT c.*, 0 AS archive_count FROM collections c WHERE slug = ?').get(slug);
            sendJson(res, 201, buildCollectionObject(row));
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
    });
}

/**
 * PATCH /api/collections/:slug — update collection metadata.
 */
function handleUpdateCollection(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });

        const row = db.prepare('SELECT * FROM collections WHERE slug = ?').get(slug);
        if (!row) return sendJson(res, 404, { error: 'Collection not found' });

        const updates = {};
        if (body.name !== undefined) updates.name = body.name.trim() || row.name;
        if (body.description !== undefined) updates.description = body.description.trim();
        if (body.thumbnail !== undefined) updates.thumbnail = body.thumbnail || null;
        if (body.theme !== undefined) {
            if (body.theme && !['editorial', 'gallery', 'exhibit', 'minimal'].includes(body.theme)) {
                return sendJson(res, 400, { error: 'Invalid theme' });
            }
            updates.theme = body.theme || null;
        }
        if (body.slug !== undefined) {
            const newSlug = body.slug.trim();
            if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(newSlug)) {
                return sendJson(res, 400, { error: 'Invalid slug' });
            }
            if (newSlug !== slug) {
                const conflict = db.prepare('SELECT id FROM collections WHERE slug = ?').get(newSlug);
                if (conflict) return sendJson(res, 409, { error: 'Slug already in use' });
                updates.slug = newSlug;
            }
        }

        if (Object.keys(updates).length === 0) {
            return sendJson(res, 200, buildCollectionObject(row));
        }

        try {
            const setClauses = Object.keys(updates).map(k => k + ' = ?');
            setClauses.push("updated_at = datetime('now')");
            const values = Object.values(updates);
            values.push(row.id);

            db.prepare('UPDATE collections SET ' + setClauses.join(', ') + ' WHERE id = ?').run(...values);

            db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
                .run(actor, 'update_collection', updates.slug || slug, JSON.stringify(updates), req.headers['x-real-ip'] || req.socket.remoteAddress);

            const updatedRow = db.prepare(`
                SELECT c.*, COUNT(ca.archive_id) AS archive_count
                FROM collections c
                LEFT JOIN collection_archives ca ON ca.collection_id = c.id
                WHERE c.id = ?
                GROUP BY c.id
            `).get(row.id);
            sendJson(res, 200, buildCollectionObject(updatedRow));
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
    });
}

/**
 * DELETE /api/collections/:slug — delete a collection.
 * Archives are NOT deleted, only membership links (via CASCADE).
 */
function handleDeleteCollection(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    try {
        const row = db.prepare('SELECT * FROM collections WHERE slug = ?').get(slug);
        if (!row) return sendJson(res, 404, { error: 'Collection not found' });

        if (row.thumbnail && row.thumbnail.startsWith('/thumbs/collection-')) {
            const thumbPath = path.join(HTML_ROOT, row.thumbnail);
            try { fs.unlinkSync(thumbPath); } catch (_) { /* ignore */ }
        }

        db.prepare('DELETE FROM collections WHERE id = ?').run(row.id);

        db.prepare('INSERT INTO audit_log (actor, action, target, ip) VALUES (?, ?, ?, ?)')
            .run(actor, 'delete_collection', slug, req.headers['x-real-ip'] || req.socket.remoteAddress);

        sendJson(res, 200, { ok: true });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * POST /api/collections/:slug/archives — add archive(s) to a collection.
 * Body: { hashes: ["abc123..."] }
 */
function handleAddCollectionArchives(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });

        const hashes = body.hashes;
        if (!Array.isArray(hashes) || hashes.length === 0) {
            return sendJson(res, 400, { error: 'hashes array is required' });
        }

        try {
            const coll = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
            if (!coll) return sendJson(res, 404, { error: 'Collection not found' });

            const maxOrder = db.prepare(
                'SELECT COALESCE(MAX(sort_order), -1) AS m FROM collection_archives WHERE collection_id = ?'
            ).get(coll.id).m;

            const insert = db.prepare(
                'INSERT OR IGNORE INTO collection_archives (collection_id, archive_id, sort_order) VALUES (?, ?, ?)'
            );

            let added = 0;
            for (let i = 0; i < hashes.length; i++) {
                const archive = db.prepare('SELECT id FROM archives WHERE hash = ?').get(hashes[i]);
                if (archive) {
                    const result = insert.run(coll.id, archive.id, maxOrder + 1 + i);
                    if (result.changes > 0) added++;
                }
            }

            db.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(coll.id);

            db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
                .run(actor, 'add_to_collection', slug, JSON.stringify({ hashes, added }), req.headers['x-real-ip'] || req.socket.remoteAddress);

            sendJson(res, 200, { ok: true, added });
            maybeRegenerateMosaic(coll.id, slug).catch(err =>
                console.error('[meta-server] Auto-mosaic regeneration failed after adding archives:', err)
            );
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
    });
}

/**
 * DELETE /api/collections/:slug/archives/:hash — remove one archive from a collection.
 */
function handleRemoveCollectionArchive(req, res, slug, archiveHash) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    try {
        const coll = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
        if (!coll) return sendJson(res, 404, { error: 'Collection not found' });

        const archive = db.prepare('SELECT id FROM archives WHERE hash = ?').get(archiveHash);
        if (!archive) return sendJson(res, 404, { error: 'Archive not found' });

        db.prepare('DELETE FROM collection_archives WHERE collection_id = ? AND archive_id = ?')
            .run(coll.id, archive.id);

        db.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(coll.id);

        db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
            .run(actor, 'remove_from_collection', slug, archiveHash, req.headers['x-real-ip'] || req.socket.remoteAddress);

        sendJson(res, 200, { ok: true });
        maybeRegenerateMosaic(coll.id, slug).catch(err =>
            console.error('[meta-server] Auto-mosaic regeneration failed after removing archive:', err)
        );
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * PATCH /api/collections/:slug/order — reorder archives in a collection.
 * Body: { hashes: ["hash1", "hash2", ...] }
 */
function handleReorderCollection(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, 400, { error: 'Invalid JSON' });

        const hashes = body.hashes;
        if (!Array.isArray(hashes)) return sendJson(res, 400, { error: 'hashes array is required' });

        try {
            const coll = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
            if (!coll) return sendJson(res, 404, { error: 'Collection not found' });

            const update = db.prepare(
                'UPDATE collection_archives SET sort_order = ? WHERE collection_id = ? AND archive_id = (SELECT id FROM archives WHERE hash = ?)'
            );

            const reorder = db.transaction(() => {
                for (let i = 0; i < hashes.length; i++) {
                    update.run(i, coll.id, hashes[i]);
                }
            });
            reorder();

            db.prepare("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(coll.id);

            sendJson(res, 200, { ok: true });
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
    });
}

/**
 * POST /api/collections/:slug/thumbnail — upload a manual thumbnail image.
 * Accepts .jpg/.jpeg/.png/.webp, converts to 640x360 JPEG, saves as collection-{slug}.jpg.
 */
async function handleUploadCollectionThumbnail(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    let tmpPath;
    try {
        const upload = await parseMultipartUpload(req);
        tmpPath = upload.tmpPath;
        const ext = path.extname(upload.filename).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            try { fs.unlinkSync(tmpPath); } catch {}
            return sendJson(res, 400, { error: 'Invalid image type. Allowed: jpg, jpeg, png, webp' });
        }

        const coll = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
        if (!coll) {
            try { fs.unlinkSync(tmpPath); } catch {}
            return sendJson(res, 404, { error: 'Collection not found' });
        }

        const destPath = path.join(THUMBS_DIR, `collection-${slug}.jpg`);
        await sharp(tmpPath).resize(640, 360, { fit: 'cover' }).jpeg({ quality: 85 }).toFile(destPath);
        try { fs.unlinkSync(tmpPath); } catch {}

        const thumbUrl = `/thumbs/collection-${slug}.jpg`;
        db.prepare("UPDATE collections SET thumbnail = ?, updated_at = datetime('now') WHERE id = ?").run(thumbUrl, coll.id);

        db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
            .run(actor, 'upload_collection_thumbnail', slug, thumbUrl, req.headers['x-real-ip'] || req.socket.remoteAddress);

        console.log(`[meta-server] Collection thumbnail uploaded for "${slug}" by ${actor}`);
        sendJson(res, 200, { ok: true, thumbnail: thumbUrl });
    } catch (err) {
        if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch {} }
        console.error('[meta-server] handleUploadCollectionThumbnail error:', err);
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * DELETE /api/collections/:slug/thumbnail — delete the manual thumbnail and regenerate auto mosaic.
 */
async function handleDeleteCollectionThumbnail(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    try {
        const coll = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
        if (!coll) return sendJson(res, 404, { error: 'Collection not found' });

        const manualPath = path.join(THUMBS_DIR, `collection-${slug}.jpg`);
        try { fs.unlinkSync(manualPath); } catch {}

        db.prepare("UPDATE collections SET thumbnail = NULL, updated_at = datetime('now') WHERE id = ?").run(coll.id);

        const autoThumb = await generateCollectionMosaic(coll.id, slug);
        if (autoThumb) {
            db.prepare("UPDATE collections SET thumbnail = ?, updated_at = datetime('now') WHERE id = ?").run(autoThumb, coll.id);
        }

        db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
            .run(actor, 'delete_collection_thumbnail', slug, '', req.headers['x-real-ip'] || req.socket.remoteAddress);

        console.log(`[meta-server] Collection thumbnail deleted for "${slug}" by ${actor}`);
        sendJson(res, 200, { ok: true, thumbnail: autoThumb });
    } catch (err) {
        console.error('[meta-server] handleDeleteCollectionThumbnail error:', err);
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * POST /api/collections/:slug/generate-thumbnail — force-regenerate the auto mosaic.
 */
async function handleGenerateCollectionThumbnail(req, res, slug) {
    const actor = requireAuth(req, res);
    if (!actor) return;
    if (!checkCsrf(req, res)) return;

    try {
        const coll = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug);
        if (!coll) return sendJson(res, 404, { error: 'Collection not found' });

        const autoThumb = await generateCollectionMosaic(coll.id, slug);
        if (autoThumb) {
            db.prepare("UPDATE collections SET thumbnail = ?, updated_at = datetime('now') WHERE id = ?").run(autoThumb, coll.id);
        }

        db.prepare('INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
            .run(actor, 'generate_collection_thumbnail', slug, autoThumb || '', req.headers['x-real-ip'] || req.socket.remoteAddress);

        console.log(`[meta-server] Collection thumbnail regenerated for "${slug}" by ${actor}`);
        sendJson(res, 200, { ok: true, thumbnail: autoThumb });
    } catch (err) {
        console.error('[meta-server] handleGenerateCollectionThumbnail error:', err);
        sendJson(res, 500, { error: err.message });
    }
}

// Share page HTML (lazy-loaded)
let _sharePageHtml = null;
function getSharePageHtml() {
    if (_sharePageHtml === null) {
        try { _sharePageHtml = fs.readFileSync('/opt/share-page.html', 'utf8'); }
        catch { _sharePageHtml = ''; }
    }
    return _sharePageHtml;
}

/**
 * GET /share/:mediaId — serve the share preview page for a media item.
 * Reads the share-page.html template and substitutes {{PLACEHOLDER}} values.
 */
function handleSharePage(req, res, mediaId) {
    const row = db.prepare(`
        SELECT m.*, a.hash AS archive_hash, a.title AS archive_title,
               a.description AS archive_description, a.filename AS archive_filename,
               a.uuid AS archive_uuid
        FROM media m
        LEFT JOIN archives a ON a.id = m.archive_id
        WHERE m.id = ? AND m.status = 'ready'
    `).get(mediaId);

    if (!row) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Share not found');
        return;
    }

    const template = getSharePageHtml();
    if (!template) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Share page template not found');
        return;
    }

    const title = escapeHtml(row.title || row.archive_title || SITE_NAME);
    const description = escapeHtml(row.archive_description || SITE_DESCRIPTION);
    const creator = escapeHtml('');
    // Absolute URLs for OG meta tags (crawlers need full URLs)
    const mp4AbsUrl = row.mp4_path ? SITE_URL + row.mp4_path : '';
    const thumbAbsUrl = row.thumb_path ? SITE_URL + row.thumb_path : '';
    // Relative paths for in-page elements — nginx sub_filter rewrites src="/ to include SITE_URL
    const mp4RelUrl = row.mp4_path || '';
    const thumbRelUrl = row.thumb_path || '';

    let view3dLink = '';
    if (row.archive_uuid) {
        view3dLink = '<a class="btn-primary" href="/view/' + encodeURIComponent(row.archive_uuid) + '?autoload=true">View in 3D</a>';
    } else if (row.archive_filename) {
        view3dLink = '<a class="btn-primary" href="/?archive=/archives/' + encodeURIComponent(row.archive_filename) + '">View in 3D</a>';
    }

    let gifLink = '';
    if (row.gif_path) {
        gifLink = '<a class="btn-secondary" href="' + escapeHtml(row.gif_path) + '" download>Download GIF</a>';
    }

    const html = template
        .replace(/\{\{TITLE\}\}/g, title)
        .replace(/\{\{DESCRIPTION\}\}/g, description)
        .replace(/\{\{SITE_NAME\}\}/g, escapeHtml(SITE_NAME))
        .replace(/\{\{SITE_URL\}\}/g, escapeHtml(SITE_URL))
        .replace(/\{\{MEDIA_ID\}\}/g, escapeHtml(mediaId))
        .replace(/\{\{MP4_URL\}\}/g, escapeHtml(mp4AbsUrl))
        .replace(/\{\{THUMB_URL\}\}/g, escapeHtml(thumbAbsUrl))
        .replace(/\{\{MP4_REL\}\}/g, escapeHtml(mp4RelUrl))
        .replace(/\{\{THUMB_REL\}\}/g, escapeHtml(thumbRelUrl))
        .replace(/\{\{CREATOR\}\}/g, creator)
        .replace(/\{\{LOGO_URL\}\}/g, '/themes/' + (DEFAULT_KIOSK_THEME || 'editorial') + '/logo.png')
        .replace(/\{\{VIEW_3D_LINK\}\}/g, view3dLink)
        .replace(/\{\{GIF_LINK\}\}/g, gifLink);

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(html);
}

/**
 * GET /collection/:slug — serve the kiosk HTML for a collection page.
 * Injects collection slug into window.__VITRINE_CLEAN_URL for client-side rendering.
 */
function handleCollectionPage(req, res, slug) {
    const row = db.prepare(`
        SELECT c.*, COUNT(ca.archive_id) AS archive_count
        FROM collections c
        LEFT JOIN collection_archives ca ON ca.collection_id = c.id
        WHERE c.slug = ?
        GROUP BY c.id
    `).get(slug);

    if (!row) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Collection not found');
        return;
    }

    if (isBotRequest(req)) {
        let thumb = row.thumbnail ? SITE_URL + row.thumbnail : null;
        if (!thumb) {
            const firstArchive = db.prepare(`
                SELECT a.thumbnail FROM archives a
                JOIN collection_archives ca ON ca.archive_id = a.id
                WHERE ca.collection_id = ?
                ORDER BY ca.sort_order ASC LIMIT 1
            `).get(row.id);
            if (firstArchive && firstArchive.thumbnail) thumb = SITE_URL + firstArchive.thumbnail;
        }
        return serveOgHtml(
            res,
            row.name || SITE_NAME,
            row.description || SITE_DESCRIPTION,
            thumb,
            SITE_URL + req.url,
            null
        );
    }

    const indexHtml = getIndexHtml();
    if (!indexHtml) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('index.html not found');
        return;
    }

    const inject = { collection: slug, kiosk: true };
    if (row.theme) inject.theme = row.theme;
    const injectTag = '<script>window.__VITRINE_CLEAN_URL=' + JSON.stringify(inject) + ';</script>\n';

    let html = indexHtml.replace(/<head>/i, '<head>\n<base href="/">');
    html = html.replace(/<script[\s>]/i, (m) => injectTag + m);

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(html);
}

// --- Clean URL Handler ---

/**
 * GET /view/:hash — serve the viewer with a clean URL.
 * Injects archive config into index.html so config.js picks it up automatically.
 * URL stays as /view/{hash} — no query params for archive/kiosk/autoload visible.
 */
function handleViewArchive(req, res, hash) {
    const row = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
    if (!row) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Archive not found');
        return;
    }

    if (isBotRequest(req)) {
        const archiveUrl = '/archives/' + row.filename;
        const thumb = row.thumbnail ? SITE_URL + row.thumbnail : thumbnailUrl(null, archiveUrl);
        return serveOgHtml(
            res,
            row.title || SITE_NAME,
            row.description || SITE_DESCRIPTION,
            thumb,
            SITE_URL + req.url,
            SITE_URL + '/oembed?url=' + encodeURIComponent(SITE_URL + req.url) + '&format=json'
        );
    }

    const indexHtml = getIndexHtml();
    if (!indexHtml) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('index.html not found');
        return;
    }

    const archiveUrl = '/archives/' + row.filename;
    const inject = { archive: archiveUrl, kiosk: true, autoload: false };
    inject.theme = DEFAULT_KIOSK_THEME || 'editorial';
    const injectTag = '<script>window.__VITRINE_CLEAN_URL=' + JSON.stringify(inject) + ';</script>\n';

    // Insert <base href="/"> so relative asset paths resolve from root (Vite uses base: './')
    // Insert config inject before the first <script> tag (not CSP's "script-src")
    let html = indexHtml.replace(/<head>/i, '<head>\n<base href="/">');
    html = html.replace(/<script[\s>]/i, (m) => injectTag + m);

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(html);
}

/**
 * GET /view/:uuid — serve the viewer via UUID-based clean URL.
 */
function handleViewArchiveByUuid(req, res, uuid) {
    const row = db.prepare('SELECT * FROM archives WHERE uuid = ?').get(uuid);
    if (!row) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Archive not found');
        return;
    }

    if (isBotRequest(req)) {
        const archiveUrl = '/archives/' + row.filename;
        const thumb = row.thumbnail ? SITE_URL + row.thumbnail : thumbnailUrl(null, archiveUrl);
        return serveOgHtml(
            res,
            row.title || SITE_NAME,
            row.description || SITE_DESCRIPTION,
            thumb,
            SITE_URL + req.url,
            SITE_URL + '/oembed?url=' + encodeURIComponent(SITE_URL + req.url) + '&format=json'
        );
    }

    const indexHtml = getIndexHtml();
    if (!indexHtml) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('index.html not found');
        return;
    }

    const archiveUrl = '/archives/' + row.filename;
    const inject = { archive: archiveUrl, kiosk: true, autoload: false };
    inject.theme = DEFAULT_KIOSK_THEME || 'editorial';
    const injectTag = '<script>window.__VITRINE_CLEAN_URL=' + JSON.stringify(inject) + ';</script>\n';

    let html = indexHtml.replace(/<head>/i, '<head>\n<base href="/">');
    html = html.replace(/<script[\s>]/i, (m) => injectTag + m);

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(html);
}

// --- Chunked Upload ---

/**
 * Remove chunk directories older than 24 hours from CHUNKS_DIR.
 */
function cleanupStaleChunks() {
    try {
        if (!fs.existsSync(CHUNKS_DIR)) return;
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const entry of fs.readdirSync(CHUNKS_DIR)) {
            const dirPath = path.join(CHUNKS_DIR, entry);
            try {
                const stat = fs.statSync(dirPath);
                if (stat.isDirectory() && stat.mtimeMs < cutoff) {
                    fs.rmSync(dirPath, { recursive: true, force: true });
                    console.log('[chunks] Cleaned stale upload dir:', entry);
                }
            } catch { /* ignore */ }
        }
    } catch (err) {
        console.error('[chunks] Cleanup error:', err.message);
    }
}

/**
 * POST /api/archives/chunks?uploadId=&chunkIndex=&totalChunks=&filename=
 * Body: raw binary chunk (application/octet-stream).
 * Streams each chunk to /tmp/v3d_chunks/{uploadId}/{chunkIndex}.part
 */
async function handleUploadChunk(req, res) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;
    try {
        const parsed = url.parse(req.url, true);
        const uploadId = (parsed.query.uploadId || '').toString();
        const chunkIndex = parseInt(parsed.query.chunkIndex, 10);
        const totalChunks = parseInt(parsed.query.totalChunks, 10);
        const filename = sanitizeFilename((parsed.query.filename || '').toString());

        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
            return sendJson(res, 400, { error: 'Invalid upload ID' });
        }
        if (!filename || isNaN(chunkIndex) || isNaN(totalChunks)) {
            return sendJson(res, 400, { error: 'Missing required parameters' });
        }
        if (chunkIndex < 0 || chunkIndex >= totalChunks || totalChunks < 1 || totalChunks > 200) {
            return sendJson(res, 400, { error: 'Invalid chunk parameters' });
        }

        const chunkDir = path.join(CHUNKS_DIR, uploadId);
        const metaPath = path.join(chunkDir, 'meta.json');
        const chunkPath = path.join(chunkDir, chunkIndex + '.part');

        if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });
        if (!fs.existsSync(metaPath)) {
            fs.writeFileSync(metaPath, JSON.stringify({ filename, totalChunks, created: Date.now() }));
        }

        let received = 0;
        const writeStream = fs.createWriteStream(chunkPath);
        await new Promise((resolve, reject) => {
            req.on('data', (data) => {
                received += data.length;
                if (received > MAX_CHUNK_SIZE) {
                    writeStream.destroy();
                    try { fs.unlinkSync(chunkPath); } catch {}
                    req.destroy();
                    reject(new Error('CHUNK_LIMIT'));
                    return;
                }
                writeStream.write(data);
            });
            req.on('end', () => writeStream.end(resolve));
            req.on('error', reject);
            writeStream.on('error', reject);
        });

        sendJson(res, 200, { received: true, chunkIndex });
    } catch (err) {
        if (err.message === 'CHUNK_LIMIT') {
            sendJson(res, 413, { error: 'Chunk exceeds ' + Math.round(MAX_CHUNK_SIZE / 1024 / 1024) + ' MB limit' });
        } else {
            console.error('[chunks] Upload error:', err.message);
            sendJson(res, 500, { error: err.message });
        }
    }
}

/**
 * POST /api/archives/chunks/:uploadId/complete
 * Assembles all .part files in order into the final archive, then runs extract-meta.
 */
async function handleCompleteChunk(req, res, uploadId) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;
    try {
        const chunkDir = path.join(CHUNKS_DIR, uploadId);
        const metaPath = path.join(chunkDir, 'meta.json');
        if (!fs.existsSync(metaPath)) {
            return sendJson(res, 404, { error: 'Upload session not found or expired' });
        }

        let meta;
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
        catch { return sendJson(res, 500, { error: 'Corrupt upload session' }); }

        const { filename, totalChunks } = meta;

        for (let i = 0; i < totalChunks; i++) {
            if (!fs.existsSync(path.join(chunkDir, i + '.part'))) {
                return sendJson(res, 400, { error: 'Missing chunk ' + i + ' of ' + totalChunks });
            }
        }

        if (!fs.existsSync(ARCHIVES_DIR)) fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
        const finalPath = path.join(ARCHIVES_DIR, filename);

        // Assemble chunks in order via streaming
        const tmpPath = path.join('/tmp', 'v3d_assembled_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
        const writeStream = fs.createWriteStream(tmpPath);
        for (let i = 0; i < totalChunks; i++) {
            await new Promise((resolve, reject) => {
                const readStream = fs.createReadStream(path.join(chunkDir, i + '.part'));
                readStream.on('error', reject);
                readStream.on('end', resolve);
                readStream.pipe(writeStream, { end: false });
            });
        }
        await new Promise((resolve, reject) => {
            writeStream.end();
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        // Clean up chunk dir before moving (best-effort)
        try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch {}

        // If file already exists, backup and replace instead of rejecting
        if (fs.existsSync(finalPath)) {
            const existingRow = db.prepare('SELECT * FROM archives WHERE filename = ?').get(filename);
            if (existingRow) {
                const updatedRow = backupAndReplace(existingRow, tmpPath, filename, req);
                return sendJson(res, 200, buildArchiveObjectFromRow(updatedRow));
            }
            // Edge case: file on disk but no DB row — remove orphan and proceed as new upload
            try { fs.unlinkSync(finalPath); } catch {}
        }

        try {
            fs.renameSync(tmpPath, finalPath);
        } catch {
            fs.copyFileSync(tmpPath, finalPath);
            try { fs.unlinkSync(tmpPath); } catch {}
        }

        runExtractMeta(finalPath);

        // Import extracted metadata into SQLite
        const chunkArchiveUrl = '/archives/' + filename;
        const chunkHash = archiveHash(chunkArchiveUrl);

        let metaRaw = {};
        const metaJsonPath = path.join(META_DIR, chunkHash + '.json');
        try { metaRaw = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8')); } catch (_) {}

        const thumbPath = '/thumbs/' + chunkHash + '.jpg';
        const thumbExists = fs.existsSync(path.join(HTML_ROOT, 'thumbs', chunkHash + '.jpg'));

        db.prepare(`
            INSERT INTO archives
                (uuid, hash, filename, title, description, thumbnail, asset_types, metadata_raw, size, updated_at)
            VALUES
                (@uuid, @hash, @filename, @title, @description, @thumbnail, @asset_types, @metadata_raw, @size, datetime('now'))
            ON CONFLICT(hash) DO UPDATE SET
                filename    = excluded.filename,
                title       = excluded.title,
                description = excluded.description,
                thumbnail   = excluded.thumbnail,
                asset_types = excluded.asset_types,
                metadata_raw= excluded.metadata_raw,
                size        = excluded.size,
                updated_at  = excluded.updated_at
        `).run({
            uuid: crypto.randomUUID(),
            hash: chunkHash,
            filename,
            title: metaRaw.title || null,
            description: metaRaw.description || null,
            thumbnail: thumbExists ? thumbPath : null,
            asset_types: (metaRaw.asset_types || metaRaw.assets) ? JSON.stringify(metaRaw.asset_types || metaRaw.assets) : null,
            metadata_raw: JSON.stringify(metaRaw),
            size: fs.statSync(finalPath).size,
        });

        const chunkActor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
        db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
          .run(chunkActor, 'upload', filename, JSON.stringify({ filename, size: fs.statSync(finalPath).size, chunked: true }), req.headers['x-real-ip'] || null);

        const assembledRow = db.prepare('SELECT * FROM archives WHERE hash = ?').get(chunkHash);
        sendJson(res, 201, buildArchiveObjectFromRow(assembledRow));
    } catch (err) {
        console.error('[chunks] Assembly error:', err.message);
        sendJson(res, 500, { error: err.message });
    }
}

// --- Media Transcode Pipeline ---

/**
 * Finalise a completed transcode: update DB with paths, clean up raw + palette files.
 */
function finishTranscode(mediaId, mp4Path, gifPath, thumbPath, mediaDir, rawPath, palettePath) {
    db.prepare(`
        UPDATE media SET status = 'ready', mp4_path = ?, gif_path = ?, thumb_path = ? WHERE id = ?
    `).run(
        mp4Path.replace(HTML_ROOT, '') || null,
        gifPath.replace(HTML_ROOT, '') || null,
        thumbPath.replace(HTML_ROOT, '') || null,
        mediaId
    );
    // Clean up raw WebM and GIF palette
    try { fs.unlinkSync(rawPath); } catch {}
    try { fs.unlinkSync(palettePath); } catch {}
}

/**
 * Run ffmpeg transcode pipeline for a media record (non-blocking, callback-based).
 * Steps: MP4 conversion → thumbnail → GIF palette → GIF encode → DB update.
 */
function transcodeMedia(mediaId) {
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
    if (!row) return;

    const mediaDir = path.join(MEDIA_ROOT, mediaId);
    const rawPath = path.join(mediaDir, 'raw.webm');
    const mp4Path = path.join(mediaDir, 'output.mp4');
    const thumbPath_ = path.join(mediaDir, 'thumb.jpg');
    const palettePath = path.join(mediaDir, 'palette.png');
    const gifPath = path.join(mediaDir, 'output.gif');

    db.prepare("UPDATE media SET status = 'processing' WHERE id = ?").run(mediaId);

    const trimStart = Number.isFinite(row.trim_start) ? row.trim_start : 0;
    const trimEnd = Number.isFinite(row.trim_end) ? row.trim_end : 0;

    // Build ffmpeg trim args
    const trimArgs = [];
    if (trimStart > 0) { trimArgs.push('-ss', String(trimStart)); }
    if (trimEnd > trimStart && trimEnd < Infinity) { trimArgs.push('-to', String(trimEnd)); }

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

    execFile('ffmpeg', mp4Args, (err) => {
        if (err) {
            console.error('[media] ffmpeg MP4 error:', err.message);
            db.prepare("UPDATE media SET status = 'error', error_msg = ? WHERE id = ?").run(err.message, mediaId);
            return;
        }

        // Step 2: Thumbnail — first frame as 512x512 JPEG
        const thumbArgs = [
            '-i', mp4Path,
            '-vframes', '1',
            '-vf', 'scale=' + getSetting('thumbnail.size') + ':' + getSetting('thumbnail.size') + ':force_original_aspect_ratio=decrease,pad=' + getSetting('thumbnail.size') + ':' + getSetting('thumbnail.size') + ':(ow-iw)/2:(oh-ih)/2',
            '-y', thumbPath_
        ];

        execFile('ffmpeg', thumbArgs, (err2) => {
            if (err2) {
                console.error('[media] ffmpeg thumbnail error:', err2.message);
                // Non-fatal — continue with GIF
            }

            // Step 3: GIF palette generation — use transcoded MP4 (stable timestamps)
            const paletteArgs = [
                '-i', mp4Path,
                '-vf', 'fps=' + getSetting('gif.fps') + ',scale=' + getSetting('gif.width') + ':-1:flags=lanczos,palettegen',
                '-y', palettePath
            ];

            execFile('ffmpeg', paletteArgs, (err3) => {
                if (err3) {
                    console.error('[media] ffmpeg palette error:', err3.message);
                    // Skip GIF, still mark ready with MP4 + thumb only
                    finishTranscode(mediaId, mp4Path, '', thumbPath_, mediaDir, rawPath, palettePath);
                    return;
                }

                // Step 4: GIF encode — from MP4 (already trimmed, stable frame timing)
                const gifArgs = [
                    '-i', mp4Path,
                    '-i', palettePath,
                    '-lavfi', 'fps=' + getSetting('gif.fps') + ',scale=' + getSetting('gif.width') + ':-1:flags=lanczos[x];[x][1:v]paletteuse',
                    '-y', gifPath
                ];

                execFile('ffmpeg', gifArgs, (err4) => {
                    if (err4) {
                        console.error('[media] ffmpeg GIF error:', err4.message);
                        finishTranscode(mediaId, mp4Path, '', thumbPath_, mediaDir, rawPath, palettePath);
                        return;
                    }
                    finishTranscode(mediaId, mp4Path, gifPath, thumbPath_, mediaDir, rawPath, palettePath);
                });
            });
        });
    });
}

// --- Media API Handlers ---

/**
 * Convert a media DB row into an API response object.
 */
function buildMediaObject(row) {
    return {
        id: row.id,
        archive_id: row.archive_id || null,
        archive_hash: row.archive_hash || null,
        archive_title: row.archive_title || null,
        title: row.title || null,
        mode: row.mode || null,
        duration_ms: row.duration_ms || 0,
        status: row.status,
        error_msg: row.error_msg || null,
        trim_start: row.trim_start || 0,
        trim_end: row.trim_end || 0,
        created_at: row.created_at ? row.created_at.replace(' ', 'T') + 'Z' : null,
        mp4_path: row.mp4_path || null,
        gif_path: row.gif_path || null,
        thumb_path: row.thumb_path || null,
        share_url: '/share/' + row.id,
    };
}

/**
 * GET /api/media/:id — get a single media record by ID, joined with archive info.
 */
function handleGetMedia(req, res, mediaId) {
    try {
        const row = db.prepare(`
            SELECT m.*, a.hash AS archive_hash, a.title AS archive_title
            FROM media m
            LEFT JOIN archives a ON a.id = m.archive_id
            WHERE m.id = ?
        `).get(mediaId);
        if (!row) return sendJson(res, 404, { error: 'Media not found' });
        sendJson(res, 200, buildMediaObject(row));
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * GET /api/media — list media records, optionally filtered by archive_hash query param.
 */
function handleListMedia(req, res, query) {
    try {
        let sql = `
            SELECT m.*, a.hash AS archive_hash, a.title AS archive_title
            FROM media m
            LEFT JOIN archives a ON a.id = m.archive_id
        `;
        const params = [];
        if (query.archive_hash) {
            sql += ' WHERE a.hash = ?';
            params.push(query.archive_hash);
        }
        sql += ' ORDER BY m.created_at DESC';
        const rows = db.prepare(sql).all(...params);
        sendJson(res, 200, { media: rows.map(buildMediaObject) });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * DELETE /api/media/:id — delete media files and DB row.
 */
function handleDeleteMedia(req, res, mediaId) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;

    try {
        const row = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
        if (!row) return sendJson(res, 404, { error: 'Media not found' });

        // Delete media directory (contains all generated files)
        const mediaDir = path.join(MEDIA_ROOT, mediaId);
        try { fs.rmSync(mediaDir, { recursive: true, force: true }); } catch {}

        db.prepare('DELETE FROM media WHERE id = ?').run(mediaId);

        sendJson(res, 200, { deleted: true, id: mediaId });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * POST /api/media/upload — upload a WebM recording and kick off transcoding.
 * Multipart fields: video (file), archive_hash, title, mode, duration_ms, trim_start, trim_end
 */
function handleMediaUpload(req, res) {
    if (!requireAuth(req, res)) return;

    const id = generateMediaId();
    const mediaDir = path.join(MEDIA_ROOT, id);
    let rawPath = path.join(mediaDir, 'raw.webm');

    let archiveHash_ = '';
    let title = '';
    let mode = '';
    let duration_ms = 0;
    let trim_start = 0;
    let trim_end = 0;

    let bb;
    try {
        bb = busboy({ headers: req.headers, limits: { fileSize: 200 * 1024 * 1024 } });
    } catch (err) {
        return sendJson(res, 400, { error: err.message });
    }

    let fileReceived = false;
    let settled = false;

    function finish(err) {
        if (settled) return;
        settled = true;
        if (err) {
            try { fs.rmSync(mediaDir, { recursive: true, force: true }); } catch {}
            if (err.message === 'LIMIT') {
                return sendJson(res, 413, { error: 'Upload exceeds 200 MB limit' });
            }
            return sendJson(res, 500, { error: err.message });
        }

        // Look up archive_id from hash or URL
        let archive_id = null;
        if (archiveHash_) {
            // archiveHash_ may be a hash, a relative path, or a full URL — try all
            let archiveRow = db.prepare('SELECT id FROM archives WHERE hash = ?').get(archiveHash_);
            if (!archiveRow) {
                // Try treating it as a URL/path and computing the hash
                let pathForHash = archiveHash_;
                // Strip origin from full URLs to get just the pathname
                try { pathForHash = new URL(archiveHash_).pathname; } catch { /* already a path or hash */ }
                const computed = archiveHash(pathForHash);
                archiveRow = db.prepare('SELECT id FROM archives WHERE hash = ?').get(computed);
            }
            if (archiveRow) archive_id = archiveRow.id;
        }

        try {
            db.prepare(`
                INSERT INTO media (id, archive_id, title, mode, duration_ms, status, trim_start, trim_end)
                VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
            `).run(id, archive_id, title || null, mode || null, duration_ms || 0, trim_start || 0, trim_end || 0);
        } catch (dbErr) {
            try { fs.rmSync(mediaDir, { recursive: true, force: true }); } catch {}
            return sendJson(res, 500, { error: dbErr.message });
        }

        sendJson(res, 200, { id, status: 'pending' });

        // Kick off transcode asynchronously
        transcodeMedia(id);
    }

    bb.on('field', (name, val) => {
        if (name === 'archive_hash') archiveHash_ = val;
        else if (name === 'title') title = val;
        else if (name === 'mode') mode = val;
        else if (name === 'duration_ms') duration_ms = parseInt(val, 10) || 0;
        else if (name === 'trim_start') { trim_start = parseFloat(val); if (!Number.isFinite(trim_start) || trim_start < 0) trim_start = 0; }
        else if (name === 'trim_end') { trim_end = parseFloat(val); if (!Number.isFinite(trim_end) || trim_end < 0) trim_end = 0; }
    });

    bb.on('file', (fieldname, file, info) => {
        if (fieldname !== 'video') {
            file.resume();
            return;
        }
        fileReceived = true;
        try { fs.mkdirSync(mediaDir, { recursive: true }); } catch {}
        const writeStream = fs.createWriteStream(rawPath);
        writeStream.on('error', finish);
        file.on('limit', () => {
            req.unpipe(bb);
            bb.destroy();
            finish(new Error('LIMIT'));
        });
        file.pipe(writeStream);
    });

    bb.on('close', () => {
        if (!fileReceived) return finish(new Error('No video field in upload'));
        finish(null);
    });

    bb.on('error', finish);
    req.on('error', finish);
    req.pipe(bb);
}

// --- Server ---

initDb();
if (!fs.existsSync(MEDIA_ROOT)) fs.mkdirSync(MEDIA_ROOT, { recursive: true });

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url);
    const pathname = parsed.pathname;

    // Health check
    if (pathname === '/health') return handleHealth(req, res);

    // oEmbed endpoint
    if (pathname === '/oembed') return handleOembed(req, res);

    // Clean archive URLs: /view/{uuid} (UUID v4, new format)
    const viewUuidMatch = pathname.match(/^\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (viewUuidMatch && req.method === 'GET') {
        return handleViewArchiveByUuid(req, res, viewUuidMatch[1]);
    }

    // Clean archive URLs: /view/{hash} (16 hex chars, legacy format)
    const viewMatch = pathname.match(/^\/view\/([a-f0-9]{16})$/);
    if (viewMatch && req.method === 'GET') {
        return handleViewArchive(req, res, viewMatch[1]);
    }

    // --- Collection routes (public reads) ---
    if (pathname === '/api/collections' && req.method === 'GET') {
        return handleListCollections(req, res);
    }

    const collSlugMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})$/);
    if (collSlugMatch && req.method === 'GET') {
        return handleGetCollection(req, res, collSlugMatch[1]);
    }

    // Collection pages: /collection/{slug}
    const collPageMatch = pathname.match(/^\/collection\/([a-z0-9][a-z0-9-]{0,79})$/);
    if (collPageMatch && req.method === 'GET') {
        return handleCollectionPage(req, res, collPageMatch[1]);
    }

    // Collection data API (public, bypasses /api/ CF Access gate)
    const collDataMatch = pathname.match(/^\/collection\/([a-z0-9][a-z0-9-]{0,79})\/data$/);
    if (collDataMatch && req.method === 'GET') {
        return handleGetCollection(req, res, collDataMatch[1]);
    }

    // Share preview pages: /share/{16-char-hex-id}
    const shareMatch = pathname.match(/^\/share\/([a-f0-9]{16})$/);
    if (shareMatch) return handleSharePage(req, res, shareMatch[1]);

    // Media routes (GET/LIST public; DELETE auth-gated inside handler)
    const parsedUrl = url.parse(req.url, true);
    const mediaMatch = pathname.match(/^\/api\/media\/([a-f0-9]{16})$/);
    if (pathname === '/api/media' && req.method === 'GET') return handleListMedia(req, res, parsedUrl.query || {});
    if (mediaMatch && req.method === 'GET') return handleGetMedia(req, res, mediaMatch[1]);
    if (mediaMatch && req.method === 'DELETE') return handleDeleteMedia(req, res, mediaMatch[1]);

    // DJI keychain proxy (no admin auth needed — API key is server-side)
    if (pathname === '/api/dji-keychains' && req.method === 'POST') {
        return handleDjiKeychains(req, res);
    }

    // Admin routes (only when enabled)
    if (ADMIN_ENABLED) {
        if (pathname === '/admin' && req.method === 'GET') {
            return handleAdminPage(req, res);
        }
        if (pathname === '/library' && req.method === 'GET') {
            return handleLibraryPage(req, res);
        }
        if (pathname === '/api/archives' && req.method === 'GET') {
            return handleListArchives(req, res);
        }
        if (pathname === '/api/audit-log' && req.method === 'GET') {
            return handleAuditLog(req, res);
        }
        if (pathname === '/api/storage' && req.method === 'GET') {
            return handleStorage(req, res);
        }
        if (pathname === '/api/settings' && req.method === 'GET') {
            return handleGetSettings(req, res);
        }
        if (pathname === '/api/settings' && req.method === 'PUT') {
            return handlePutSettings(req, res);
        }
        const settingKeyMatch = pathname.match(/^\/api\/settings\/(.+)$/);
        if (settingKeyMatch && req.method === 'DELETE') {
            return handleDeleteSetting(req, res, decodeURIComponent(settingKeyMatch[1]));
        }
        const orphanMatch = pathname.match(/^\/api\/storage\/orphans\/(.+)$/);
        if (orphanMatch && req.method === 'DELETE') {
            return handleDeleteOrphan(req, res, decodeURIComponent(orphanMatch[1]));
        }
        if (pathname === '/api/archives' && req.method === 'POST') {
            handleUploadArchive(req, res);
            return;
        }

        // Chunked upload routes (only when CHUNKED_UPLOAD=true)
        if (CHUNKED_UPLOAD) {
            if (pathname === '/api/archives/chunks' && req.method === 'POST') {
                handleUploadChunk(req, res);
                return;
            }
            const chunkCompleteMatch = pathname.match(/^\/api\/archives\/chunks\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/complete$/i);
            if (chunkCompleteMatch && req.method === 'POST') {
                handleCompleteChunk(req, res, chunkCompleteMatch[1].toLowerCase());
                return;
            }
        }

        // Match /api/archives/:hash/versions/:id/download
        const versionDownloadMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions\/(\d+)\/download$/);
        if (versionDownloadMatch && req.method === 'GET') {
            return handleDownloadVersion(req, res, versionDownloadMatch[1], parseInt(versionDownloadMatch[2], 10));
        }

        // Match /api/archives/:hash/versions/:id (DELETE)
        const versionIdMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions\/(\d+)$/);
        if (versionIdMatch && req.method === 'DELETE') {
            return handleDeleteVersion(req, res, versionIdMatch[1], parseInt(versionIdMatch[2], 10));
        }

        // Match /api/archives/:hash/versions (GET)
        const versionsMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/versions$/);
        if (versionsMatch && req.method === 'GET') {
            return handleListVersions(req, res, versionsMatch[1]);
        }

        // Match /api/archives/:hash/regenerate
        const regenMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/regenerate$/);
        if (regenMatch && req.method === 'POST') {
            return handleRegenerateArchive(req, res, regenMatch[1]);
        }

        // Match /api/archives/:hash (16 hex chars)
        const hashMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})$/);
        if (hashMatch) {
            const hash = hashMatch[1];
            if (req.method === 'DELETE') return handleDeleteArchive(req, res, hash);
            if (req.method === 'PATCH') return handleRenameArchive(req, res, hash);
        }

        // --- Collection admin routes ---
        if (pathname === '/api/collections' && req.method === 'POST') {
            return handleCreateCollection(req, res);
        }

        const collSlugAdminMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})$/);
        if (collSlugAdminMatch) {
            const cSlug = collSlugAdminMatch[1];
            const action = (url.parse(req.url, true).query.action || '').toString();

            // Query-param actions (flat URLs for CF Access bypass compatibility)
            if (action === 'add-archives' && req.method === 'POST') return handleAddCollectionArchives(req, res, cSlug);
            if (action === 'remove-archive' && req.method === 'DELETE') {
                const hash = (url.parse(req.url, true).query.hash || '').toString();
                if (/^[a-f0-9]{16}$/.test(hash)) return handleRemoveCollectionArchive(req, res, cSlug, hash);
                return sendJson(res, 400, { error: 'Invalid hash' });
            }
            if (action === 'reorder' && req.method === 'PATCH') return handleReorderCollection(req, res, cSlug);
            if (action === 'upload-thumbnail' && req.method === 'POST') return handleUploadCollectionThumbnail(req, res, cSlug);
            if (action === 'delete-thumbnail' && req.method === 'DELETE') return handleDeleteCollectionThumbnail(req, res, cSlug);
            if (action === 'generate-thumbnail' && req.method === 'POST') return handleGenerateCollectionThumbnail(req, res, cSlug);

            // Default slug actions (no action param)
            if (req.method === 'PATCH') return handleUpdateCollection(req, res, cSlug);
            if (req.method === 'DELETE') return handleDeleteCollection(req, res, cSlug);
        }

        // Legacy sub-path routes (backward compatibility)
        const collArchivesMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})\/archives$/);
        if (collArchivesMatch && req.method === 'POST') {
            return handleAddCollectionArchives(req, res, collArchivesMatch[1]);
        }

        const collArchiveRemoveMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})\/archives\/([a-f0-9]{16})$/);
        if (collArchiveRemoveMatch && req.method === 'DELETE') {
            return handleRemoveCollectionArchive(req, res, collArchiveRemoveMatch[1], collArchiveRemoveMatch[2]);
        }

        const collOrderMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})\/order$/);
        if (collOrderMatch && req.method === 'PATCH') {
            return handleReorderCollection(req, res, collOrderMatch[1]);
        }

        const collThumbMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})\/thumbnail$/);
        if (collThumbMatch) {
            if (req.method === 'POST') return handleUploadCollectionThumbnail(req, res, collThumbMatch[1]);
            if (req.method === 'DELETE') return handleDeleteCollectionThumbnail(req, res, collThumbMatch[1]);
        }

        const collGenThumbMatch = pathname.match(/^\/api\/collections\/([a-z0-9][a-z0-9-]{0,79})\/generate-thumbnail$/);
        if (collGenThumbMatch && req.method === 'POST') {
            return handleGenerateCollectionThumbnail(req, res, collGenThumbMatch[1]);
        }

        if (req.method === 'GET' && pathname === '/api/auth-callback') {
            return handleAuthCallback(req, res);
        }
        if (req.method === 'GET' && pathname === '/api/me') {
            return handleMe(req, res);
        }
        if (req.method === 'GET' && pathname === '/api/csrf-token') {
            return handleCsrfToken(req, res);
        }

        // Media routes
        if (pathname === '/api/media/upload' && req.method === 'POST') return handleMediaUpload(req, res);
    }

    // Default: bot HTML response (nginx only routes bots here)
    return handleBotRequest(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[meta-server] Listening on 127.0.0.1:${PORT}`);
    if (CHUNKED_UPLOAD) {
        console.log(`[meta-server] Chunked upload: ENABLED (chunks dir: ${CHUNKS_DIR})`);
        cleanupStaleChunks();
        setInterval(cleanupStaleChunks, 60 * 60 * 1000);
    }
    console.log(`[meta-server] SITE_NAME=${SITE_NAME}`);
    console.log(`[meta-server] SITE_URL=${SITE_URL || '(not set)'}`);
    if (ADMIN_ENABLED) {
        console.log(`[meta-server] Admin panel: ENABLED`);
        console.log(`[meta-server] MAX_UPLOAD_SIZE=${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)} MB`);
    }
});
