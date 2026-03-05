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
 *   GET  /api/archives       → List all archives with metadata
 *   POST /api/archives       → Upload new archive (multipart/form-data, streamed)
 *   DELETE /api/archives/:hash → Delete archive + sidecar files
 *   PATCH  /api/archives/:hash → Rename archive
 *
 * Reads pre-extracted metadata from /usr/share/nginx/html/meta/{hash}.json
 * and serves thumbnails from /usr/share/nginx/html/thumbs/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const { execFileSync } = require('child_process');
const busboy = require('busboy');
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
const DB_PATH = process.env.DB_PATH || '/data/vitrine.db';

// --- Cloudflare Access auth ---

/**
 * Verify Cloudflare Access header. Returns the authenticated user email,
 * or sends 401 and returns null if the header is missing.
 * Defense in depth: Cloudflare injects this header on every authenticated request.
 */
function requireAuth(req, res) {
    const user = req.headers['cf-access-authenticated-user-email'];
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
            bb = busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD_SIZE } });
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
        const entries = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

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

        // Check for duplicate
        if (fs.existsSync(finalPath)) {
            try { fs.unlinkSync(tmpPath); } catch {}
            return sendJson(res, 409, { error: 'File already exists: ' + filename });
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
            asset_types: metaRaw.asset_types ? JSON.stringify(metaRaw.asset_types) : null,
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
            sendJson(res, 413, { error: 'Upload exceeds maximum size (' + Math.round(MAX_UPLOAD_SIZE / 1024 / 1024) + ' MB)' });
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

    // Delete from DB + audit log atomically
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
        asset_types: metaRaw.asset_types ? JSON.stringify(metaRaw.asset_types) : null,
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
                    asset_types: metaRaw.asset_types ? JSON.stringify(metaRaw.asset_types) : null,
                    metadata_raw: JSON.stringify(metaRaw),
                    oldHash: hash,
                });
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

        if (!collection.thumbnail && collection.archives.length > 0) {
            collection.thumbnail = collection.archives[0].thumbnail;
        }

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
                .run(actor, 'create_collection', slug, req.socket.remoteAddress);

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
                .run(actor, 'update_collection', updates.slug || slug, JSON.stringify(updates), req.socket.remoteAddress);

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
            .run(actor, 'delete_collection', slug, req.socket.remoteAddress);

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
                .run(actor, 'add_to_collection', slug, JSON.stringify({ hashes, added }), req.socket.remoteAddress);

            sendJson(res, 200, { ok: true, added });
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
            .run(actor, 'remove_from_collection', slug, archiveHash, req.socket.remoteAddress);

        sendJson(res, 200, { ok: true });
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
        if (fs.existsSync(finalPath)) {
            return sendJson(res, 409, { error: 'File already exists: ' + filename });
        }

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
            asset_types: metaRaw.asset_types ? JSON.stringify(metaRaw.asset_types) : null,
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

// --- Server ---

initDb();
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

    // Admin routes (only when enabled)
    if (ADMIN_ENABLED) {
        if (pathname === '/admin' && req.method === 'GET') {
            return handleAdminPage(req, res);
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
            if (req.method === 'PATCH') return handleUpdateCollection(req, res, cSlug);
            if (req.method === 'DELETE') return handleDeleteCollection(req, res, cSlug);
        }

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

        if (req.method === 'GET' && pathname === '/api/me') {
            return handleMe(req, res);
        }
        if (req.method === 'GET' && pathname === '/api/csrf-token') {
            return handleCsrfToken(req, res);
        }
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
