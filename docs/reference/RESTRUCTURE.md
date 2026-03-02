# Deployment Restructure Plan

Exploratory plan for hardening the deployment architecture to support internet-accessible
editor and admin/library views, while keeping the public kiosk viewer open. Written against
the current state of the codebase as a from-scratch reference, not an incremental PR guide.

---

## What the Current Structure Gets Wrong

Everything runs inside a single Docker container as two unsupervised processes (nginx +
meta-server.js), which causes a few structural problems:

**Metadata stored as flat files**
Archive metadata lives as SHA-256-named JSON sidecars (`meta/{hash}.json`), with a separate
`_uuid-index.json` to map UUIDs back to hashes. No search, no filtering, race conditions
under concurrent writes, and a fragile dual-file state to keep in sync.

**Admin API has no per-request authentication**
`ADMIN_ENABLED` just enables the routes. All protection is delegated to an IP-based VPN
restriction at the nginx/Caddy layer. If that layer is misconfigured or the VPN is shared
with untrusted users, the API is fully open.

**`execSync` with string concatenation**
`extract-meta.sh` is called by shelling out with a manually concatenated command string.
The filename is sanitised beforehand so it isn't currently exploitable, but the pattern
is fragile. Any future code path that skips sanitisation creates shell injection.

**Custom multipart parser**
The hand-rolled streaming multipart parser in `meta-server.js` works, but is ~150 lines
of custom boundary-detection code. Battle-tested libraries (`busboy`) have had years of
edge-case fixes that this implementation may not cover.

**No CSRF protection**
State-changing admin routes (POST/DELETE/PATCH) have no CSRF token check. Acceptable when
the API is VPN-only; required when it is internet-facing.

**Process supervision is a shell script**
`docker-entrypoint.sh` starts nginx and meta-server in the background. If either crashes,
nothing restarts it. No dependency ordering.

---

## Target Architecture

Three containers, one of which (the app) contains all application logic.

```
Internet
    │
    ▼
┌─────────────────────────────────────────┐
│  Caddy  (TLS termination, IP routing)   │
└────────────────┬────────────────────────┘
                 │
        ┌────────┴──────────┐
        ▼                   ▼
  Public routes        Protected routes
  /view/*, /oembed     /, /admin, /api/*
  /archives/*, etc.         │
        │                   ▼
        │         ┌──────────────────┐
        │         │  oauth2-proxy    │
        │         │  (Google/GitHub  │
        │         │   OIDC, 2FA)     │
        │         └────────┬─────────┘
        │                  │ X-Forwarded-User header
        └──────────────────┤
                           ▼
              ┌────────────────────────┐
              │     viewer container   │
              │  ┌──────────────────┐  │
              │  │  s6-overlay      │  │
              │  │  ├── nginx :80   │  │
              │  │  └── api  :3001  │  │
              │  └──────────────────┘  │
              │  /data/vitrine.db      │  ← named volume
              │  /html/archives/       │  ← named volume
              └────────────────────────┘
```

### Routing split

| Path | Visibility | Auth |
|---|---|---|
| `/view/*` | Public | None |
| `/oembed`, `/health` | Public | None |
| `/archives/*`, `/thumbs/*` | Public | None |
| `/assets/*`, `config.js`, `*.wasm` | Public | None (both kiosk and editor bundles share `/assets/`) |
| `/` (kiosk viewer SPA) | Public | None |
| `/editor/` (editor SPA) | Internet | oauth2-proxy session |
| `/admin` | Internet | oauth2-proxy session |
| `/api/*` | Internet | oauth2-proxy session + `X-Forwarded-User` header |

The static assets (`/assets/*`) must remain public because both Vite entry points (kiosk at
`/` and editor at `/editor/`) output chunks into the shared `dist/assets/` directory.
Restricting `/assets/` would break both the kiosk viewer and the editor.

---

## Docker Compose

```yaml
services:

  caddy:
    image: caddy:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:latest
    restart: unless-stopped
    command:
      - --provider=google
      - --email-domain=yourcompany.com             # restrict to your Google Workspace domain
      - --upstream=http://viewer:80
      - --http-address=0.0.0.0:4180
      - --cookie-secure=true
      - --cookie-name=_vitrine_session
      - --cookie-samesite=lax
      # Public routes — no auth required
      - --skip-auth-route=^/$                  # kiosk viewer SPA root
      - --skip-auth-route=^/index\.html$
      - --skip-auth-route=^/view/.*
      - --skip-auth-route=^/oembed
      - --skip-auth-route=^/health
      - --skip-auth-route=^/archives/.*
      - --skip-auth-route=^/thumbs/.*
      - --skip-auth-route=^/assets/.*
      - --skip-auth-route=^/favicon.*
      - --skip-auth-route=^/config\.js
    environment:
      - OAUTH2_PROXY_CLIENT_ID=${OAUTH_CLIENT_ID}
      - OAUTH2_PROXY_CLIENT_SECRET=${OAUTH_CLIENT_SECRET}
      - OAUTH2_PROXY_COOKIE_SECRET=${OAUTH_COOKIE_SECRET}  # openssl rand -base64 32

  viewer:
    build:
      context: .
      dockerfile: docker/Dockerfile
    restart: unless-stopped
    # No exposed ports — Caddy and oauth2-proxy route to it internally
    environment:
      - ADMIN_ENABLED=true
      - CHUNKED_UPLOAD=true
      - SITE_URL=${SITE_URL}
      - SITE_NAME=${SITE_NAME:-Vitrine3D}
      - OG_ENABLED=true
      # ... other env vars
    volumes:
      - archives:/usr/share/nginx/html/archives
      - app_data:/data   # SQLite database lives here
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  caddy_data:
  caddy_config:
  archives:
  app_data:
```

### Google Cloud OAuth Setup

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Authorized redirect URI: `https://your-domain.com/oauth2/callback`
4. Copy the Client ID and Secret into your environment
5. Generate a random cookie secret: `openssl rand -base64 32`
6. Set (or use Docker secrets — see Step 8):
   - `OAUTH_CLIENT_ID=...`
   - `OAUTH_CLIENT_SECRET=...`
   - `OAUTH_COOKIE_SECRET=...`

### Caddyfile

```
your-domain.com {
    # Public routes — bypass oauth2-proxy, go straight to viewer
    handle / {
        reverse_proxy viewer:80
    }
    handle /view/* {
        reverse_proxy viewer:80
    }
    handle /oembed* {
        reverse_proxy viewer:80
    }
    handle /archives/* {
        reverse_proxy viewer:80
    }
    handle /thumbs/* {
        reverse_proxy viewer:80
    }
    handle /assets/* {
        reverse_proxy viewer:80
    }
    handle /health {
        reverse_proxy viewer:80
    }

    # Everything else (including /editor/) — through oauth2-proxy
    handle {
        reverse_proxy oauth2-proxy:4180
    }

    # Optional: rate-limit public endpoints against bandwidth abuse
    rate_limit {remote_host} 30r/m
}
```

---

## Changes Required in meta-server.js

### 1. Replace `execSync` string concat with `execFileSync` array

```js
// Before
const { execSync } = require('child_process');
execSync('/opt/extract-meta.sh "' + HTML_ROOT + '" "' + HTML_ROOT + '" "' + absolutePath + '"', { timeout: 30000 });

// After
const { execFileSync } = require('child_process');
execFileSync('/opt/extract-meta.sh', [HTML_ROOT, HTML_ROOT, absolutePath], { timeout: 30000, stdio: 'pipe' });
```

### 2. Validate the forwarded user header on all admin routes

oauth2-proxy injects `X-Forwarded-User` (email) after a successful login. The API should
verify this header is present before processing any admin request — defense in depth, so
the API isn't fully open if the proxy layer is ever misconfigured.

```js
function requireAuth(req, res) {
    const user = req.headers['x-forwarded-user'] || req.headers['x-forwarded-email'];
    if (!user) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return null;
    }
    return user;
}

// In each admin handler:
function handleListArchives(req, res) {
    if (!requireAuth(req, res)) return;
    // ...
}
```

### 3. CSRF protection on state-changing routes

Double-submit cookie pattern. The admin SPA reads the cookie and echoes it in a request header.

```js
const crypto = require('crypto');

function csrfToken() {
    return crypto.randomBytes(24).toString('hex');
}

// On GET /admin — set cookie
res.setHeader('Set-Cookie', `csrf=${csrfToken()}; SameSite=Strict; Secure; Path=/`);

// On POST/PATCH/DELETE — verify
function checkCsrf(req, res) {
    const header = req.headers['x-csrf-token'];
    const cookie = parseCookies(req)['csrf'];
    if (!header || !cookie || header !== cookie) {
        sendJson(res, 403, { error: 'Invalid CSRF token' });
        return false;
    }
    return true;
}
```

### 4. Replace custom multipart parser with busboy

The custom parser in the current codebase works but is ~150 lines of hand-rolled
boundary detection. `busboy` is the standard Node.js solution, widely deployed and
well-fuzzed. Worth switching if the admin upload endpoint is internet-facing.

```js
const busboy = require('busboy');

async function handleUploadArchive(req, res) {
    if (!requireAuth(req, res)) return;
    if (!checkCsrf(req, res)) return;

    const bb = busboy({
        headers: req.headers,
        limits: { fileSize: MAX_UPLOAD_SIZE, files: 1 }
    });

    bb.on('file', (_field, stream, info) => {
        const filename = sanitizeFilename(info.filename);
        const tmpPath = `/tmp/v3d_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const write = fs.createWriteStream(tmpPath);

        stream.on('limit', () => {
            write.destroy();
            fs.unlink(tmpPath, () => {});
            sendJson(res, 413, { error: 'File exceeds maximum upload size' });
        });

        stream.pipe(write);
        write.on('finish', () => {
            // move to archives, run extract-meta, respond
        });
    });

    req.pipe(bb);
}
```

### 5. Move credentials to Docker secrets

`ADMIN_PASS` and OAuth secrets should not be in environment variables (visible via
`docker inspect`, process listings, log output).

```yaml
# docker-compose.yml
secrets:
  oauth_client_secret:
    file: ./secrets/oauth_client_secret.txt
  oauth_cookie_secret:
    file: ./secrets/oauth_cookie_secret.txt

services:
  oauth2-proxy:
    secrets: [oauth_client_secret, oauth_cookie_secret]
    # Read from /run/secrets/oauth_client_secret at startup
```

---

## Changes Required in the Dockerfile

### Replace entrypoint process management with s6-overlay

s6-overlay is designed for multi-process containers: proper supervision, clean shutdown,
dependency ordering between services.

```dockerfile
FROM node:alpine AS build
# ... npm ci, npm run build

FROM nginx:alpine

# Install s6-overlay
ARG S6_VERSION=3.2.0.0
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-x86_64.tar.xz /tmp/
RUN apk add --no-cache xz && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz

RUN apk add --no-cache nodejs unzip python3

COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY docker/nginx.conf.template /etc/nginx/templates/
COPY docker/api.js /opt/api.js
COPY docker/s6-rc.d/ /etc/s6-overlay/s6-rc.d/

# /data is where SQLite lives — mount a named volume here
RUN mkdir -p /data
VOLUME ["/data"]

ENTRYPOINT ["/init"]   # s6 init process
CMD []
```

s6 service definitions:

```
/etc/s6-overlay/s6-rc.d/
  nginx/
    type        ← "longrun"
    run         ← exec nginx -g 'daemon off;'
  api/
    type        ← "longrun"
    run         ← exec node /opt/api.js
    dependencies.d/
      nginx     ← api starts after nginx
```

---

## SQLite Migration

Replaces `meta/*.json`, `_uuid-index.json`, and hash-based thumbnail lookup with a single
SQLite file at `/data/vitrine.db`. Requires adding `better-sqlite3` to the container's
Node.js dependencies.

### Schema

```sql
CREATE TABLE IF NOT EXISTS archives (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid         TEXT    UNIQUE NOT NULL,
    hash         TEXT    UNIQUE NOT NULL,   -- 16-char SHA-256 prefix, kept for URL compat
    filename     TEXT    UNIQUE NOT NULL,
    title        TEXT,
    description  TEXT,
    thumbnail    TEXT,                      -- relative path, e.g. /thumbs/{hash}.jpg
    asset_types  TEXT,                      -- JSON array: ["splat","mesh"]
    metadata_raw TEXT,                      -- full Dublin Core JSON blob
    size         INTEGER,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_archives_uuid ON archives(uuid);
CREATE INDEX IF NOT EXISTS idx_archives_hash ON archives(hash);
```

### What changes in meta-server.js

| Current | Replacement |
|---|---|
| `fs.readFileSync('meta/{hash}.json')` | `db.prepare('SELECT * FROM archives WHERE hash = ?').get(hash)` |
| `loadUuidIndex()` / `saveUuidIndex()` | `db.prepare('SELECT * FROM archives WHERE uuid = ?').get(uuid)` |
| `fs.readdirSync(ARCHIVES_DIR)` + per-file meta read | Single `db.prepare('SELECT * FROM archives ORDER BY created_at DESC').all()` |
| `getOrCreateUuid(archiveUrl)` | INSERT with `crypto.randomUUID()` at upload time |
| `migrateUuid(old, new)` | `db.prepare('UPDATE archives SET filename = ?, hash = ? WHERE uuid = ?').run(...)` |
| `deleteUuidEntry(archiveUrl)` | `db.prepare('DELETE FROM archives WHERE uuid = ?').run(uuid)` |

---

## What Stays the Same

- Archive format (`.a3d`/`.a3z`) — no changes
- `extract-meta.sh` — still used for thumbnail and metadata extraction, just called safely
- nginx static file serving for archives, thumbs, assets
- OG/oEmbed response format
- Clean URL format (`/view/{uuid}`, `/view/{hash}`)
- All environment variable names — backwards compatible
- **No client-side auth gate needed** — oauth2-proxy enforces the auth boundary before
  nginx ever serves `index.html`. The static SPA bundle does not need to know about
  authentication. The `--skip-auth-route=^/view/.*` flag ensures UUID share links
  bypass the proxy entirely without any JS-level changes.

---

## Migration Path (incremental, if not doing from scratch)

In rough priority order:

1. **`execSync` → `execFileSync`** — 5 min, no behaviour change, eliminates shell injection risk
2. **Extract oauth2-proxy as a Compose service** — no app code changes, adds auth wall
3. **Add `X-Forwarded-User` check to admin routes** — ~30 lines, defense in depth
4. **Add CSRF tokens to admin SPA + API** — ~50 lines each side
5. **SQLite migration** — contained change to meta-server.js, run once to import existing JSON sidecars
6. **s6-overlay** — Dockerfile change only, no application code changes
7. **Replace custom multipart parser with busboy** — worth doing after SQLite, since upload handler needs rewriting anyway to record to DB
8. **Move secrets to Docker secrets** — ops change, no code changes

Steps 1–4 are the security-relevant ones. Steps 5–8 are quality-of-life improvements.

---

## Open Questions

- **SPA split**: ✅ Resolved — **Done.** `src/index.html` builds the kiosk viewer at `/`
  (public) and `src/editor/index.html` builds the editor at `/editor/` (protected). Both
  entry points share the same `dist/assets/` output directory. The auth boundary is still
  enforced at the proxy layer as planned — nginx has a `/editor/` location block with a
  comment for a future `auth_basic` fallback, but the primary gate is oauth2-proxy routing
  everything not in the skip-auth-route list through the OIDC flow.

- **oauth2-proxy provider**: ✅ Resolved — **Google Workspace** via `--provider=google`
  and `--email-domain=yourcompany.com`. Requires a Google Cloud OAuth 2.0 app with
  `https://your-domain.com/oauth2/callback` as an authorized redirect URI.
  See the Google Cloud OAuth Setup section above for step-by-step instructions.

- **Audit logging**: The current API has no audit trail. With internet-facing access, logging
  who uploaded/deleted/renamed what (using the `X-Forwarded-User` email) to a separate table
  in the SQLite DB is straightforward and worth adding alongside the SQLite migration.
