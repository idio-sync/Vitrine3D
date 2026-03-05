# Deployment Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the deployment architecture by replacing basic auth with Cloudflare Access header validation, CSRF protection, SQLite metadata storage, s6-overlay supervision, and busboy multipart parsing.

**Architecture:** Single viewer container behind Cloudflare Tunnel + Zoraxy. Auth is enforced at the Cloudflare edge; the API validates the injected `Cf-Access-Authenticated-User-Email` header as defense in depth. SQLite replaces flat JSON sidecar files. s6-overlay replaces the background-process shell entrypoint.

**Tech Stack:** nginx:alpine, Node.js, s6-overlay 3.2.0.0, better-sqlite3 (native) or node-sqlite3-wasm (pure WASM), busboy (multipart), Cloudflare Access (Zero Trust OIDC)

---

> **Testing note:** `meta-server.js` / `api.js` is server-side Node.js — not part of the Vite/Vitest build. Tests in this plan use `curl` against a running container. Run `docker compose up --build` to verify each step. The Vite frontend tests (`npm test`) remain unaffected by all changes here.

---

### Task 1: Replace `execSync` string concat with `execFileSync` array

This is a 5-minute change that eliminates the shell injection vector in `runExtractMeta`.

**Files:**
- Modify: `docker/meta-server.js:30` (require line)
- Modify: `docker/meta-server.js` (the `runExtractMeta` function, ~line 514–522)

**Step 1: Change the require at the top of meta-server.js**

Find:
```js
const { execSync } = require('child_process');
```
Replace with:
```js
const { execFileSync } = require('child_process');
```

**Step 2: Replace the execSync call in `runExtractMeta`**

Find (approximately lines 514–522):
```js
function runExtractMeta(absolutePath) {
    try {
        execSync(
            '/opt/extract-meta.sh "' + HTML_ROOT + '" "' + HTML_ROOT + '" "' + absolutePath + '"',
            { timeout: 30000 }
        );
```
Replace with:
```js
function runExtractMeta(absolutePath) {
    try {
        execFileSync(
            '/opt/extract-meta.sh',
            [HTML_ROOT, HTML_ROOT, absolutePath],
            { timeout: 30000, stdio: 'pipe' }
        );
```

**Step 3: Verify the file still parses**

Run:
```bash
node --check docker/meta-server.js
```
Expected: no output (syntax OK)

**Step 4: Commit**

```bash
git add docker/meta-server.js
git commit -m "fix: replace execSync string concat with execFileSync array in runExtractMeta"
```

---

### Task 2: Add `requireAuth()` to all admin routes in meta-server.js

Validates the `Cf-Access-Authenticated-User-Email` header Cloudflare injects. Defense in depth — the API is not fully open if Cloudflare is ever misconfigured. Also adds `GET /api/me`.

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add the `requireAuth` helper after the configuration block**

Locate the `// --- Configuration from environment ---` section (top of file). After the config constants, add:

```js
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
```

**Step 2: Add `handleMe` endpoint handler**

After the `requireAuth` function, add:

```js
// GET /api/me — returns the authenticated user's email
function handleMe(req, res) {
    const user = requireAuth(req, res);
    if (!user) return;
    sendJson(res, 200, { email: user });
}
```

**Step 3: Apply `requireAuth` guard to each admin handler**

For each of these functions, add `if (!requireAuth(req, res)) return;` as the first line of the function body (after parameter destructuring but before any logic):

- `handleListArchives(req, res)`
- `handleUploadArchive(req, res)`
- `handleDeleteArchive(req, res, hash)`
- `handleRenameArchive(req, res, hash)`
- `handleChunkUpload(req, res)`
- `handleChunkAssemble(req, res)`

Example pattern:
```js
function handleListArchives(req, res) {
    if (!requireAuth(req, res)) return;
    // ... existing code
}
```

**Step 4: Wire `handleMe` into the router**

Find the main request router (the large `if/else if` chain that checks `req.method` and `parsedUrl.pathname`). Add before the 404 fallback:

```js
if (req.method === 'GET' && parsedUrl.pathname === '/api/me') {
    return handleMe(req, res);
}
```

**Step 5: Syntax check**

```bash
node --check docker/meta-server.js
```
Expected: no output

**Step 6: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat: add requireAuth() CF Access header check on all admin routes + GET /api/me"
```

---

### Task 3: Add CSRF token generation and verification to meta-server.js

HMAC-signed token tied to the authenticated user email. Prevents CSRF attacks on state-changing routes once the API is internet-facing.

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add CSRF key and helpers after the `requireAuth` block**

```js
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
    if (!header || !expected || !crypto.timingSafeEqual(
        Buffer.from(header, 'hex'),
        Buffer.from(expected, 'hex')
    )) {
        sendJson(res, 403, { error: 'Invalid CSRF token' });
        return false;
    }
    return true;
}
```

**Step 2: Add `handleCsrfToken` endpoint handler**

```js
// GET /api/csrf-token — called by admin SPA on load
function handleCsrfToken(req, res) {
    const user = requireAuth(req, res);
    if (!user) return;
    sendJson(res, 200, { token: csrfToken(user) });
}
```

**Step 3: Apply `checkCsrf` guard to all state-changing handlers**

Add `if (!checkCsrf(req, res)) return;` as the second line (after `requireAuth`) in:
- `handleUploadArchive`
- `handleDeleteArchive`
- `handleRenameArchive`
- `handleChunkUpload`
- `handleChunkAssemble`

```js
function handleUploadArchive(req, res) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;
    // ... existing code
}
```

**Step 4: Wire `handleCsrfToken` into the router**

```js
if (req.method === 'GET' && parsedUrl.pathname === '/api/csrf-token') {
    return handleCsrfToken(req, res);
}
```

**Step 5: Syntax check**

```bash
node --check docker/meta-server.js
```
Expected: no output

**Step 6: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat: add HMAC CSRF token generation and verification on state-changing admin routes"
```

---

### Task 4: Remove basic auth — replace with CF Access header forwarding

Removes `ADMIN_PASS`/`ADMIN_USER` from the entrypoint and nginx. Replaces `auth_basic` with plain proxy headers that forward `Cf-Access-Authenticated-User-Email`.

**Files:**
- Modify: `docker/docker-entrypoint.sh`
- Modify: `docker/Dockerfile`
- Modify: `docker-compose.yml`

**Step 1: Update `docker-entrypoint.sh` — remove htpasswd generation and auth_basic blocks**

Find the entire admin panel section (from `if [ "${ADMIN_ENABLED}" = "true" ]; then` to the closing `fi`). Replace the `ADMIN_PASS` validation, `openssl passwd` call, and `admin-auth.conf.inc` generation with:

```sh
if [ "${ADMIN_ENABLED}" = "true" ]; then
    echo ""
    echo "Admin panel: ENABLED"
    echo "  MAX_UPLOAD_SIZE: ${MAX_UPLOAD_SIZE:-1024}MB"
    echo "  CHUNKED_UPLOAD: ${CHUNKED_UPLOAD:-false}"

    # Generate admin nginx config — forwards Cloudflare Access header to api
    cat > /etc/nginx/conf.d/admin-auth.conf.inc <<ADMINEOF
# Admin panel — proxied to api, auth enforced by Cloudflare Access at edge
location /admin {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header Cf-Access-Authenticated-User-Email \$http_cf_access_authenticated_user_email;
}

# API routes — proxied to api, auth enforced by Cloudflare Access at edge
location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header Cf-Access-Authenticated-User-Email \$http_cf_access_authenticated_user_email;
    client_max_body_size ${MAX_UPLOAD_SIZE:-1024}m;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
ADMINEOF

    # Local dev: if DEV_AUTH_USER is set, inject it as a fallback header when CF is not in the path
    if [ -n "${DEV_AUTH_USER}" ]; then
        echo "  DEV_AUTH_USER: ${DEV_AUTH_USER} (local dev override active)"
        # Append default_type header to api location for local dev
        cat >> /etc/nginx/conf.d/admin-auth.conf.inc <<DEVEOF

# Local dev fallback: set CF header when Cloudflare is not in the path
map \$http_cf_access_authenticated_user_email \$effective_auth_user {
    default \$http_cf_access_authenticated_user_email;
    "" "${DEV_AUTH_USER}";
}
DEVEOF
        # Note: dev override re-writes the location to use $effective_auth_user
        # Simplest approach: rewrite the whole admin-auth.conf.inc with dev header
        cat > /etc/nginx/conf.d/admin-auth.conf.inc <<DEVADMINEOF
location /admin {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header Cf-Access-Authenticated-User-Email "${DEV_AUTH_USER}";
}

location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header Cf-Access-Authenticated-User-Email "${DEV_AUTH_USER}";
    client_max_body_size ${MAX_UPLOAD_SIZE:-1024}m;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
DEVADMINEOF
    fi

    if [ ! -w "/usr/share/nginx/html/archives/" ]; then
        echo "  WARNING: /usr/share/nginx/html/archives/ is not writable."
        echo "  Mount with :rw for upload/delete/rename to work."
    fi
else
    : > /etc/nginx/conf.d/admin-auth.conf.inc
    echo ""
    echo "Admin panel: disabled (set ADMIN_ENABLED=true to enable)"
fi
```

**Step 2: Remove `ADMIN_PASS`/`ADMIN_USER` ENV from Dockerfile**

Find and remove these two lines:
```dockerfile
ENV ADMIN_USER="admin"
ENV ADMIN_PASS=""
```

Also remove `openssl` from the apk install line (it's only needed for htpasswd generation):
```dockerfile
# Before
RUN apk add --no-cache gettext nodejs openssl python3 unzip
# After
RUN apk add --no-cache gettext nodejs python3 unzip
```

**Step 3: Update `docker-compose.yml`**

Remove `ADMIN_USER` and `ADMIN_PASS` from the environment section:
```yaml
# Remove these two lines:
- ADMIN_USER=${ADMIN_USER:-admin}
- ADMIN_PASS=${ADMIN_PASS:-}
```

Change the archives volume mount from `:ro` to `:rw` (admin uploads need write access):
```yaml
# Before
- ./archives:/usr/share/nginx/html/archives:ro
# After
- ./archives:/usr/share/nginx/html/archives:rw
```

Add a `thumbs` named volume (prevents thumbnail data loss on container rebuild):
```yaml
volumes:
  - ./archives:/usr/share/nginx/html/archives:rw
  - thumbs:/usr/share/nginx/html/thumbs
  - app_data:/data
```

Add the named volume declarations at the bottom of `docker-compose.yml`:
```yaml
volumes:
  thumbs:
  app_data:
```

**Step 4: Syntax check the entrypoint**

```bash
bash -n docker/docker-entrypoint.sh
```
Expected: no output

**Step 5: Commit**

```bash
git add docker/docker-entrypoint.sh docker/Dockerfile docker-compose.yml
git commit -m "feat: replace basic auth with CF Access header forwarding; add thumbs/app_data named volumes"
```

---

### Task 5: Add `/health` static location to nginx.conf.template

Fixes the healthcheck so it answers from nginx independently of the api process.

**Files:**
- Modify: `docker/nginx.conf.template`
- Modify: `docker-compose.yml`

**Step 1: Add `/health` location block to nginx.conf.template**

Find the `# Editor bundle` location block:
```nginx
# Editor bundle — full authoring app
location /editor/ {
```

Insert _before_ it:
```nginx
# Health check — answered by nginx directly, independent of api process
location = /health {
    access_log off;
    return 200 "ok\n";
    add_header Content-Type text/plain;
}

```

**Step 2: Update healthcheck in docker-compose.yml**

```yaml
# Before
test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/"]
# After
test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/health"]
```

**Step 3: Commit**

```bash
git add docker/nginx.conf.template docker-compose.yml
git commit -m "feat: add static /health location to nginx; update healthcheck target"
```

---

### Task 6: Create docker/package.json and docker/package-lock.json for API dependencies

Prepares the npm dependency infrastructure for busboy and better-sqlite3 (used in later tasks). Creates a separate build stage in the Dockerfile so native compilation happens in node:alpine (which has build tools available) rather than nginx:alpine.

**Files:**
- Create: `docker/package.json`
- Modify: `docker/Dockerfile`

**Step 1: Create `docker/package.json`**

```json
{
  "name": "vitrine3d-api",
  "version": "1.0.0",
  "private": true,
  "description": "Vitrine3D API server dependencies",
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "busboy": "^1.6.0"
  }
}
```

**Step 2: Generate the lockfile**

```bash
cd docker && npm install --package-lock-only && cd ..
```
Expected: `docker/package-lock.json` created

**Step 3: Update `docker/Dockerfile` to add api-deps build stage**

Replace the current single-stage Dockerfile with a multi-stage build. Add a new `api-deps` stage _after_ a minimal `build` alias but _before_ the final `nginx:alpine` stage:

```dockerfile
FROM nginx:alpine AS final

# Install s6-overlay for process supervision
ARG S6_VERSION=3.2.0.0
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-x86_64.tar.xz /tmp/
RUN apk add --no-cache xz && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz
```

Wait — Task 6 is just about the package.json and lockfile + a build stage for npm deps. The full s6-overlay Dockerfile rewrite is Task 10. For now, add a second stage that builds the node_modules, and copy them in the existing nginx:alpine final stage.

Replace the existing Dockerfile content with:

```dockerfile
# Stage 1: build api npm dependencies (better-sqlite3 requires native compilation)
FROM node:alpine AS api-deps
WORKDIR /build
COPY docker/package.json docker/package-lock.json ./
RUN apk add --no-cache python3 make g++ && npm ci --omit=dev

# Final image
FROM nginx:alpine

# Install runtime tools
# - gettext: envsubst for template substitution
# - nodejs: API server runtime
# - python3: metadata extraction JSON parsing
# - unzip: reading archive contents
RUN apk add --no-cache gettext nodejs python3 unzip

# Copy api node_modules from build stage
COPY --from=api-deps /build/node_modules /opt/node_modules

# Copy nginx configuration template (processed by entrypoint)
COPY docker/nginx.conf.template /etc/nginx/templates/nginx.conf.template

# Copy Vite build output (run "npm run build" before "docker build")
COPY dist/ /usr/share/nginx/html/

# Copy the config template and entrypoint script
COPY docker/config.js.template /usr/share/nginx/html/config.js.template
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Copy OG/oEmbed API server, admin panel, and metadata extraction script
COPY docker/meta-server.js /opt/meta-server.js
COPY docker/admin.html /opt/admin.html
COPY docker/extract-meta.sh /opt/extract-meta.sh
RUN chmod +x /opt/extract-meta.sh

# Create directories for extracted metadata and thumbnails
RUN mkdir -p /usr/share/nginx/html/meta /usr/share/nginx/html/thumbs /data

# Environment variables with defaults
ENV DEFAULT_ARCHIVE_URL=""
ENV DEFAULT_SPLAT_URL=""
ENV DEFAULT_MODEL_URL=""
ENV DEFAULT_POINTCLOUD_URL=""
ENV SHOW_CONTROLS="true"
ENV ALLOWED_DOMAINS=""
ENV FRAME_ANCESTORS="'self'"
ENV CORS_ORIGINS=""
ENV KIOSK_LOCK=""
ENV ARCHIVE_PATH_PREFIX=""
ENV EMBED_REFERERS=""
ENV OG_ENABLED="false"
ENV SITE_NAME="Vitrine3D"
ENV SITE_URL=""
ENV SITE_DESCRIPTION="Interactive 3D viewer"
ENV OEMBED_WIDTH="960"
ENV OEMBED_HEIGHT="540"
ENV ADMIN_ENABLED="false"
ENV MAX_UPLOAD_SIZE="1024"
ENV CHUNKED_UPLOAD="false"
ENV DEFAULT_KIOSK_THEME=""

VOLUME ["/data"]

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
```

**Step 4: Verify the build**

```bash
npm run build && docker build -f docker/Dockerfile -t vitrine3d:test .
```
Expected: build completes successfully; `node_modules` copied into `/opt/node_modules`

**Step 5: Commit**

```bash
git add docker/package.json docker/package-lock.json docker/Dockerfile
git commit -m "build: add multi-stage Dockerfile with api-deps stage for better-sqlite3 and busboy"
```

---

### Task 7: Create SQLite schema initialisation and migration script

**Files:**
- Create: `docker/migrate-to-sqlite.js`
- Modify: `docker/meta-server.js` (add `initDb()`)

**Step 1: Add `initDb()` to meta-server.js**

At the top of meta-server.js, change the requires block to add better-sqlite3:

```js
const Database = require('/opt/node_modules/better-sqlite3');
```

Add a `DB_PATH` constant in the configuration section:
```js
const DB_PATH = process.env.DB_PATH || '/data/vitrine.db';
```

Add `initDb()` function and call it at startup:

```js
// --- SQLite setup ---

let db;

function initDb() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

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
    `);
}
```

**Step 2: Create `docker/migrate-to-sqlite.js`**

```js
#!/usr/bin/env node
'use strict';
/**
 * migrate-to-sqlite.js — One-shot migration from flat JSON sidecars to SQLite.
 *
 * Reads each meta/{hash}.json sidecar and the _uuid-index.json, then INSERTs
 * into /data/vitrine.db. Safe to re-run (uses INSERT OR IGNORE).
 *
 * Usage: node /opt/migrate-to-sqlite.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('/opt/node_modules/better-sqlite3');

const META_DIR = process.env.META_DIR || '/usr/share/nginx/html/meta';
const UUID_INDEX_PATH = path.join(META_DIR, '_uuid-index.json');
const DB_PATH = process.env.DB_PATH || '/data/vitrine.db';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Ensure tables exist (same schema as initDb in meta-server.js)
db.exec(`
    CREATE TABLE IF NOT EXISTS archives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL,
        hash TEXT UNIQUE NOT NULL,
        filename TEXT UNIQUE NOT NULL,
        title TEXT, description TEXT, thumbnail TEXT,
        asset_types TEXT, metadata_raw TEXT, size INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_archives_uuid ON archives(uuid);
    CREATE INDEX IF NOT EXISTS idx_archives_hash ON archives(hash);
`);

const insert = db.prepare(`
    INSERT OR IGNORE INTO archives
        (uuid, hash, filename, title, description, thumbnail, asset_types, metadata_raw, size)
    VALUES
        (@uuid, @hash, @filename, @title, @description, @thumbnail, @asset_types, @metadata_raw, @size)
`);

// Load UUID index
let uuidIndex = {};
try { uuidIndex = JSON.parse(fs.readFileSync(UUID_INDEX_PATH, 'utf8')); }
catch (_) { console.log('No UUID index found — UUIDs will be generated fresh.'); }

// Reverse map: archiveUrl -> uuid
const urlToUuid = uuidIndex;

let migrated = 0, skipped = 0;
const metaFiles = fs.readdirSync(META_DIR).filter(f => f.endsWith('.json') && f !== '_uuid-index.json');

for (const file of metaFiles) {
    const hash = path.basename(file, '.json');
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(META_DIR, file), 'utf8')); }
    catch (e) { console.warn('Skipping unreadable:', file, e.message); skipped++; continue; }

    const archiveUrl = '/archives/' + (meta.filename || hash);
    const uuid = urlToUuid[archiveUrl] || crypto.randomUUID();
    const thumbPath = `/thumbs/${hash}.jpg`;
    const thumbExists = fs.existsSync('/usr/share/nginx/html' + thumbPath);

    insert.run({
        uuid,
        hash,
        filename: meta.filename || hash,
        title: meta.title || null,
        description: meta.description || null,
        thumbnail: thumbExists ? thumbPath : null,
        asset_types: meta.asset_types ? JSON.stringify(meta.asset_types) : null,
        metadata_raw: JSON.stringify(meta),
        size: meta.size || null,
    });
    migrated++;
}

console.log(`Migration complete: ${migrated} inserted, ${skipped} skipped.`);
db.close();
```

**Step 3: Make the migration script executable in the Dockerfile**

Add to `docker/Dockerfile` after the `meta-server.js` COPY:
```dockerfile
COPY docker/migrate-to-sqlite.js /opt/migrate-to-sqlite.js
```

**Step 4: Syntax check**

```bash
node --check docker/meta-server.js
node --check docker/migrate-to-sqlite.js
```
Expected: no output from either

**Step 5: Commit**

```bash
git add docker/meta-server.js docker/migrate-to-sqlite.js docker/Dockerfile
git commit -m "feat: add SQLite schema initDb() and flat-file migration script"
```

---

### Task 8: Migrate meta-server.js flat-file reads/writes to SQLite

Replace every `_uuid-index.json`, `meta/{hash}.json`, and `fs.readdirSync(ARCHIVES_DIR)` pattern with DB queries.

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Remove the UUID index functions**

Delete these functions entirely (they are replaced by DB queries):
- `loadUuidIndex()`
- `saveUuidIndex()`
- `getOrCreateUuid(archiveUrl)`
- `migrateUuid(oldArchiveUrl, newArchiveUrl)`
- `deleteUuidEntry(archiveUrl)`
- `findArchiveByUuid(uuid)`

Also remove `const UUID_INDEX_PATH = ...` constant.

**Step 2: Replace `buildArchiveObject` to read from DB**

The current `buildArchiveObject` reads from `meta/{hash}.json`. Replace with a DB lookup:

```js
function buildArchiveObjectFromRow(row) {
    return {
        uuid: row.uuid,
        hash: row.hash,
        filename: row.filename,
        title: row.title || '',
        description: row.description || '',
        thumbnail: row.thumbnail || null,
        asset_types: row.asset_types ? JSON.parse(row.asset_types) : [],
        metadata: row.metadata_raw ? JSON.parse(row.metadata_raw) : {},
        size: row.size || 0,
        created_at: row.created_at,
    };
}
```

**Step 3: Replace `handleListArchives` to query DB**

```js
function handleListArchives(req, res) {
    if (!requireAuth(req, res)) return;
    const rows = db.prepare('SELECT * FROM archives ORDER BY created_at DESC').all();
    sendJson(res, 200, rows.map(buildArchiveObjectFromRow));
}
```

**Step 4: Update `handleUploadArchive` to INSERT into DB after extract-meta**

After calling `runExtractMeta(destPath)`, replace `getOrCreateUuid(archiveUrl)` with an INSERT:

```js
// Read extracted metadata (extract-meta.sh still writes the sidecar; we then import it)
let metaRaw = {};
const metaPath = path.join(META_DIR, hash + '.json');
try { metaRaw = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}

const thumbPath = `/thumbs/${hash}.jpg`;
const thumbExists = fs.existsSync(path.join(HTML_ROOT, 'thumbs', hash + '.jpg'));

db.prepare(`
    INSERT OR REPLACE INTO archives
        (uuid, hash, filename, title, description, thumbnail, asset_types, metadata_raw, size, updated_at)
    VALUES
        (@uuid, @hash, @filename, @title, @description, @thumbnail, @asset_types, @metadata_raw, @size, datetime('now'))
`).run({
    uuid: crypto.randomUUID(),
    hash,
    filename: sanitized,
    title: metaRaw.title || null,
    description: metaRaw.description || null,
    thumbnail: thumbExists ? thumbPath : null,
    asset_types: metaRaw.asset_types ? JSON.stringify(metaRaw.asset_types) : null,
    metadata_raw: JSON.stringify(metaRaw),
    size: fs.statSync(destPath).size,
});

// Write audit log
const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
  .run(actor, 'upload', sanitized, JSON.stringify({ size: fs.statSync(destPath).size }), req.headers['x-real-ip'] || null);
```

**Step 5: Update `handleDeleteArchive` to DELETE from DB**

Replace `deleteUuidEntry(...)` with:
```js
db.prepare('DELETE FROM archives WHERE hash = ?').run(hash);

const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
db.prepare(`INSERT INTO audit_log (actor, action, target, ip) VALUES (?, ?, ?, ?)`)
  .run(actor, 'delete', hash, req.headers['x-real-ip'] || null);
```

**Step 6: Update `handleRenameArchive` to UPDATE in DB**

Replace `migrateUuid(...)` with:
```js
db.prepare('UPDATE archives SET filename = ?, hash = ?, updated_at = datetime(\'now\') WHERE hash = ?')
  .run(sanitized, newHash, oldHash);

const actor = req.headers['cf-access-authenticated-user-email'] || 'unknown';
db.prepare(`INSERT INTO audit_log (actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)`)
  .run(actor, 'rename', oldHash, JSON.stringify({ old: archive.filename, new: sanitized }), req.headers['x-real-ip'] || null);
```

**Step 7: Update `handleViewArchiveByUuid` to query DB**

Replace `findArchiveByUuid(uuid)` with:
```js
const row = db.prepare('SELECT * FROM archives WHERE uuid = ?').get(uuid);
```

**Step 8: Update OG/oEmbed meta lookups to query DB by hash**

Replace all `loadMetaByHash(hash)` / `fs.readFileSync(metaPath)` patterns in the OG/oEmbed handlers with:
```js
const row = db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash);
```

**Step 9: Call `initDb()` at startup**

Find the server startup call (near the bottom of the file, `http.createServer(...).listen(PORT, ...)`). Add `initDb()` before it:

```js
initDb();
const server = http.createServer(handleRequest);
server.listen(PORT, '127.0.0.1', () => { ... });
```

**Step 10: Syntax check**

```bash
node --check docker/meta-server.js
```
Expected: no output

**Step 11: Verify with docker build + smoke test**

```bash
npm run build && docker build -f docker/Dockerfile -t vitrine3d:test .
docker run --rm -e ADMIN_ENABLED=true -e DEV_AUTH_USER=dev@localhost -p 8080:80 vitrine3d:test
# In another terminal:
curl -s http://localhost:8080/health
# Expected: ok
curl -s -H "Cf-Access-Authenticated-User-Email: dev@localhost" http://localhost:8080/api/me
# Expected: {"email":"dev@localhost"}
curl -s -H "Cf-Access-Authenticated-User-Email: dev@localhost" http://localhost:8080/api/archives
# Expected: []
```

**Step 12: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat: migrate meta-server from flat JSON sidecars to SQLite (better-sqlite3)"
```

---

### Task 9: Replace custom multipart parser with busboy

The hand-rolled boundary detection (~150 lines) is replaced with busboy, which is battle-tested.

**Files:**
- Modify: `docker/meta-server.js`

**Step 1: Add busboy require at the top of meta-server.js**

```js
const busboy = require('/opt/node_modules/busboy');
```

**Step 2: Replace `parseMultipartUpload` function**

Delete the entire `parseMultipartUpload` function (~150 lines).

Replace all call sites of `parseMultipartUpload(req, tmpPath, ...)` in `handleUploadArchive` with:

```js
async function handleUploadArchive(req, res) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;

    const tmpPath = `/tmp/v3d_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    let filename = '';

    await new Promise((resolve, reject) => {
        const bb = busboy({
            headers: req.headers,
            limits: { fileSize: MAX_UPLOAD_SIZE, files: 1 },
        });

        bb.on('file', (_field, stream, info) => {
            filename = sanitizeFilename(info.filename);
            if (!filename) {
                stream.resume();
                return reject(new Error('Missing or invalid filename'));
            }
            const write = fs.createWriteStream(tmpPath);
            let limitHit = false;

            stream.on('limit', () => {
                limitHit = true;
                write.destroy();
                fs.unlink(tmpPath, () => {});
                reject(Object.assign(new Error('File exceeds maximum upload size'), { status: 413 }));
            });

            stream.pipe(write);
            write.on('finish', () => { if (!limitHit) resolve(); });
            write.on('error', reject);
            stream.on('error', reject);
        });

        bb.on('error', reject);
        req.pipe(bb);
    }).catch(err => {
        const status = err.status || 400;
        sendJson(res, status, { error: err.message });
        return;
    });

    if (!filename) return; // error already sent

    // ... rest of the upload handler (move file to archives/, runExtractMeta, DB insert) unchanged
}
```

**Step 3: Syntax check**

```bash
node --check docker/meta-server.js
```
Expected: no output

**Step 4: Build and smoke test upload**

```bash
npm run build && docker build -f docker/Dockerfile -t vitrine3d:test .
docker run --rm -e ADMIN_ENABLED=true -e DEV_AUTH_USER=dev@localhost -p 8080:80 vitrine3d:test

# Get CSRF token
TOKEN=$(curl -s -H "Cf-Access-Authenticated-User-Email: dev@localhost" http://localhost:8080/api/csrf-token | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Upload a test archive (use any .a3d or .a3z file)
curl -s -X POST \
  -H "Cf-Access-Authenticated-User-Email: dev@localhost" \
  -H "X-CSRF-Token: $TOKEN" \
  -F "archive=@path/to/test.a3d" \
  http://localhost:8080/api/archives
```
Expected: JSON response with archive metadata

**Step 5: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat: replace hand-rolled multipart parser with busboy"
```

---

### Task 10: Replace shell entrypoint with s6-overlay process supervision

Adds proper supervision (restart on crash, dependency ordering) and separates config generation from process management.

**Files:**
- Modify: `docker/Dockerfile` (add s6-overlay, change ENTRYPOINT)
- Modify: `docker/docker-entrypoint.sh` → rename to `docker/generate-nginx-conf.sh` (config generation only)
- Create: `docker/s6-rc.d/init-config/type`
- Create: `docker/s6-rc.d/init-config/up`
- Create: `docker/s6-rc.d/init-scan/type`
- Create: `docker/s6-rc.d/init-scan/up`
- Create: `docker/s6-rc.d/init-scan/dependencies.d/init-config`
- Create: `docker/s6-rc.d/nginx/type`
- Create: `docker/s6-rc.d/nginx/run`
- Create: `docker/s6-rc.d/nginx/dependencies.d/init-config`
- Create: `docker/s6-rc.d/nginx/dependencies.d/init-scan`
- Create: `docker/s6-rc.d/api/type`
- Create: `docker/s6-rc.d/api/run`
- Create: `docker/s6-rc.d/api/dependencies.d/init-scan`
- Create: `docker/s6-rc.d/user/contents.d/init-config`
- Create: `docker/s6-rc.d/user/contents.d/init-scan`
- Create: `docker/s6-rc.d/user/contents.d/nginx`
- Create: `docker/s6-rc.d/user/contents.d/api`

**Step 1: Extract config generation into `docker/generate-nginx-conf.sh`**

Create `docker/generate-nginx-conf.sh` containing all the `envsubst` and `.conf.inc` generation logic from `docker-entrypoint.sh` — everything up to (but not including) the meta-server `node ... &` start. The script should end with `exit 0`. It does **not** start any processes.

The current `docker-entrypoint.sh` flow to move:
- `envsubst` for `config.js`
- `envsubst` for `nginx.conf`
- `cors-origins-map.conf.inc` generation
- `kiosk-lock.conf.inc` (empty)
- `embed-referers.conf.inc` generation
- `view-proxy.conf.inc` generation
- `og-location-root.conf.inc` + `og-oembed.conf.inc` generation
- `admin-auth.conf.inc` generation (without the meta-server start)

**Step 2: Update `docker/Dockerfile` to install s6-overlay and copy service files**

Update the final `FROM nginx:alpine` block to add s6-overlay installation and ENTRYPOINT:

```dockerfile
# Install s6-overlay for process supervision
ARG S6_VERSION=3.2.0.0
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-x86_64.tar.xz /tmp/
RUN apk add --no-cache xz gettext nodejs python3 unzip && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz
```

Copy the s6 service definitions and scripts:
```dockerfile
COPY docker/generate-nginx-conf.sh /opt/generate-nginx-conf.sh
COPY docker/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
RUN chmod +x /opt/generate-nginx-conf.sh

ENTRYPOINT ["/init"]
CMD []
```

Remove the old:
```dockerfile
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
```

**Step 3: Create s6 service definition files**

`docker/s6-rc.d/init-config/type`:
```
oneshot
```

`docker/s6-rc.d/init-config/up`:
```
/opt/generate-nginx-conf.sh
```

`docker/s6-rc.d/init-scan/type`:
```
oneshot
```

`docker/s6-rc.d/init-scan/up`:
```
/opt/extract-meta.sh /usr/share/nginx/html /usr/share/nginx/html
```

`docker/s6-rc.d/init-scan/dependencies.d/init-config` (empty file, declares dependency):
```
(empty file)
```

`docker/s6-rc.d/nginx/type`:
```
longrun
```

`docker/s6-rc.d/nginx/run`:
```
#!/bin/sh
exec nginx -g 'daemon off;'
```

`docker/s6-rc.d/nginx/dependencies.d/init-config` (empty file)
`docker/s6-rc.d/nginx/dependencies.d/init-scan` (empty file)

`docker/s6-rc.d/api/type`:
```
longrun
```

`docker/s6-rc.d/api/run`:
```
#!/bin/sh
exec node /opt/meta-server.js
```

`docker/s6-rc.d/api/dependencies.d/init-scan` (empty file)

Create a `user` bundle to start all services:

`docker/s6-rc.d/user/type`:
```
bundle
```

`docker/s6-rc.d/user/contents.d/init-config` (empty file)
`docker/s6-rc.d/user/contents.d/init-scan` (empty file)
`docker/s6-rc.d/user/contents.d/nginx` (empty file)
`docker/s6-rc.d/user/contents.d/api` (empty file)

Make the run scripts executable in the Dockerfile:
```dockerfile
RUN chmod +x /etc/s6-overlay/s6-rc.d/nginx/run \
              /etc/s6-overlay/s6-rc.d/api/run
```

**Step 4: Verify s6 bundle is wired up**

The `user` bundle must be listed in s6's default bundle to auto-start. Create:

`docker/s6-rc.d/user/contents.d/` — already done above.

Add to Dockerfile to ensure s6 starts the user bundle:
```dockerfile
RUN mkdir -p /etc/s6-overlay/s6-rc.d/user/contents.d
```
(This should already be done by the COPY.)

Also ensure s6 user bundle is linked into the `default` startup bundle. In s6-overlay 3.x the correct way is to create a `/etc/s6-overlay/s6-rc.d/default/` with the service in `contents.d`:

Rename `user` bundle to `default` for simplicity, or add the user bundle to the default bundle:

`docker/s6-rc.d/default/type`:
```
bundle
```
`docker/s6-rc.d/default/contents.d/user` (empty file)

**Step 5: Build and verify**

```bash
npm run build && docker build -f docker/Dockerfile -t vitrine3d:test .
docker run --rm -e ADMIN_ENABLED=true -e DEV_AUTH_USER=dev@localhost -p 8080:80 vitrine3d:test
```

In another terminal:
```bash
curl -s http://localhost:8080/health
# Expected: ok
curl -s -H "Cf-Access-Authenticated-User-Email: dev@localhost" http://localhost:8080/api/me
# Expected: {"email":"dev@localhost"}
```

**Step 6: Commit**

```bash
git add docker/Dockerfile docker/generate-nginx-conf.sh docker/s6-rc.d/
git commit -m "feat: replace shell entrypoint with s6-overlay supervision (nginx + api longrun services)"
```

---

### Task 11: Add CSRF fetch helper and user identity display to admin.html

Client-side companion to Task 3. All mutating fetch calls get CSRF token header. User email displayed in header.

**Files:**
- Modify: `docker/admin.html`

**Step 1: Add `initCsrf` and `adminFetch` before the existing `fetchArchives` function**

Find the `async function fetchArchives()` function in the `<script>` block. Insert before it:

```js
// CSRF token — fetched once on load, refreshed automatically on 403 (api restart)
let csrfToken = null;

async function initCsrf() {
    const res = await fetch('/api/csrf-token');
    if (!res.ok) throw new Error('Failed to fetch CSRF token');
    const data = await res.json();
    csrfToken = data.token;
}

async function adminFetch(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), 'X-CSRF-Token': csrfToken },
    });
    if (res.status === 403) {
        // Token may have been invalidated by an api restart — refresh and retry once
        await initCsrf();
        return fetch(url, {
            ...options,
            headers: { ...(options.headers || {}), 'X-CSRF-Token': csrfToken },
        });
    }
    return res;
}

async function loadUserIdentity() {
    try {
        const res = await fetch('/api/me');
        if (!res.ok) return;
        const data = await res.json();
        const el = document.getElementById('user-identity');
        if (el) el.textContent = data.email;
    } catch (_) {}
}
```

**Step 2: Replace bare `fetch()` calls with `adminFetch()` for mutating requests**

Find and replace each mutating fetch:

```js
// DELETE (around line 911)
// Before:
const res = await fetch('/api/archives/' + hash, { method: 'DELETE' });
// After:
const res = await adminFetch('/api/archives/' + hash, { method: 'DELETE' });

// PATCH (around line 920–921)
// Before:
const res = await fetch('/api/archives/' + hash, {
    method: 'PATCH',
// After:
const res = await adminFetch('/api/archives/' + hash, {
    method: 'PATCH',
```

For the `POST` upload (xhr-based, around line 905), the XHR approach does not use `adminFetch`. Replace it with a `fetch`-based upload using `adminFetch`:

```js
// Replace xhr.open('POST', '/api/archives') block with:
const formData = new FormData();
formData.append('archive', file);
const res = await adminFetch('/api/archives', { method: 'POST', body: formData });
if (!res.ok) throw new Error(await res.text());
const archive = await res.json();
// ... handle archive response
```

Note: The XHR approach was used for progress reporting. If progress reporting is needed, keep a separate `uploadWithProgress` function using XHR with the CSRF header added: `xhr.setRequestHeader('X-CSRF-Token', csrfToken)`.

**Step 3: Add user identity element to the header HTML**

Find the `.header-right` div in the HTML. Add a user email span:

```html
<div class="header-right">
    <span id="user-identity" style="font-size:11px; color: var(--text-muted);"></span>
    <!-- existing header-right content -->
</div>
```

**Step 4: Call `initCsrf` and `loadUserIdentity` on page load**

Find the `DOMContentLoaded` handler (or the init/startup call at the bottom of the script). Replace or augment:

```js
document.addEventListener('DOMContentLoaded', async () => {
    await initCsrf();
    loadUserIdentity(); // fire-and-forget
    await fetchArchives(); // or whatever the current init call is
    // ... rest of init
});
```

**Step 5: Verify in browser**

Build and run:
```bash
npm run build && docker build -f docker/Dockerfile -t vitrine3d:test .
docker run --rm -e ADMIN_ENABLED=true -e DEV_AUTH_USER=dev@localhost -p 8080:80 vitrine3d:test
```
Open `http://localhost:8080/admin` — confirm:
- User email `dev@localhost` appears in header
- List, delete, rename operations work without 403 errors

**Step 6: Commit**

```bash
git add docker/admin.html
git commit -m "feat: add CSRF fetch helper and user identity display to admin.html"
```

---

### Task 12: Add `.env.example`

Documents all required and optional environment variables for operator onboarding.

**Files:**
- Create: `.env.example`
- Modify: `.gitignore` (if not already ignoring `.env`)

**Step 1: Create `.env.example`**

```sh
# .env.example — copy to .env and fill in values before running docker compose

# === Required ===

# Canonical public URL of the viewer (e.g. https://viewer.yourcompany.com)
# Used for OG meta tag URLs and oEmbed endpoint
SITE_URL=https://viewer.yourcompany.com

# === Content defaults (optional) ===

# Default archive loaded on viewer startup
# DEFAULT_ARCHIVE_URL=https://viewer.yourcompany.com/archives/example.a3d

# === Display ===

SITE_NAME=Vitrine3D
SITE_DESCRIPTION=Interactive 3D viewer

# === Admin panel ===

# Set to true to enable the admin panel at /admin and the /api/* routes
ADMIN_ENABLED=false

# Maximum upload size in MB (per request or per chunk when CHUNKED_UPLOAD=true)
MAX_UPLOAD_SIZE=1024

# Enable chunked upload for archives > 100 MB (required for Cloudflare free/pro plan)
CHUNKED_UPLOAD=false

# === OG/oEmbed link previews ===

OG_ENABLED=false
# OEMBED_WIDTH=960
# OEMBED_HEIGHT=540

# === Security ===

# Allowed external domains for URL loading (space-separated)
# ALLOWED_DOMAINS=

# Content-Security-Policy frame-ancestors value (prevents clickjacking)
FRAME_ANCESTORS='self'

# Allowed CORS origins for API responses (space-separated, empty = same-origin only)
# CORS_ORIGINS=

# Kiosk embed security
# KIOSK_LOCK=true
# EMBED_REFERERS=client.com *.client.com
# ARCHIVE_PATH_PREFIX=/archives/

# === Local development only ===

# Simulate Cloudflare Access auth header locally (never set in production)
# DEV_AUTH_USER=dev@localhost

# === Rendering ===

# LOD splat budget overrides (default: 500000 SD / 1500000 HD)
# LOD_BUDGET_SD=500000
# LOD_BUDGET_HD=1500000
```

**Step 2: Ensure `.env` is gitignored**

```bash
grep -q "^\.env$" .gitignore || echo ".env" >> .gitignore
grep -q "^docker-compose\.override\.yml$" .gitignore || echo "docker-compose.override.yml" >> .gitignore
```

**Step 3: Commit**

```bash
git add .env.example .gitignore
git commit -m "docs: add .env.example with all environment variables documented"
```

---

## Summary

| Task | Spec Step | Files Changed | Risk |
|------|-----------|---------------|------|
| 1. execFileSync | 1 | meta-server.js | Low |
| 2. requireAuth | 3 | meta-server.js | Low |
| 3. CSRF server | 4 | meta-server.js | Low |
| 4. Remove basic auth | 5 | entrypoint, Dockerfile, compose | Medium |
| 5. /health endpoint | 5 | nginx.conf.template, compose | Low |
| 6. package.json + multi-stage build | 6,7,8 | Dockerfile, docker/package.json | Medium |
| 7. SQLite schema + migration | 6 | meta-server.js, migrate-to-sqlite.js | Medium |
| 8. Migrate to SQLite | 6 | meta-server.js | High |
| 9. busboy | 8 | meta-server.js | Medium |
| 10. s6-overlay | 7 | Dockerfile, s6-rc.d/, generate-nginx-conf.sh | High |
| 11. CSRF client + /api/me | 9 | admin.html | Low |
| 12. .env.example | 12 | .env.example, .gitignore | Low |

Tasks 1–5 are the security-relevant ones and can be deployed incrementally without Tasks 6–12.
