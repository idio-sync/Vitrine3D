# Deployment Restructure Plan

Exploratory plan for hardening the deployment architecture to support internet-accessible
editor and admin/library views, while keeping the public kiosk viewer open. Written against
the current state of the codebase as a from-scratch reference, not an incremental PR guide.

**Deployment context**: This deployment runs behind a Cloudflare Tunnel with Zoraxy as the
local reverse proxy. TLS termination, DDoS protection, and rate limiting are all handled at
the Cloudflare edge. Authentication is provided by Cloudflare Access (Zero Trust). This
eliminates the need for Caddy and oauth2-proxy as separate containers — the viewer remains
a single container.

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
with untrusted users, the API is fully open. With Cloudflare Access as the auth gate,
the api should also validate the `Cf-Access-Authenticated-User-Email` header as defense
in depth — the api must not be fully open if Cloudflare is ever misconfigured or bypassed.

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

Single container behind Cloudflare Tunnel + Zoraxy. TLS, DDoS protection, rate limiting,
and authentication are all handled at the Cloudflare edge — no additional proxy containers
are needed.

```
Internet
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  Cloudflare Edge                                     │
│  ├── TLS termination (automatic)                     │
│  ├── DDoS / rate limiting (WAF rules)                │
│  └── Cloudflare Access (OIDC auth gate)              │
│       └── /editor/*, /admin*, /api/* → requires auth │
└────────────────────────┬─────────────────────────────┘
                         │ Cloudflare Tunnel
                         ▼
              ┌──────────────────┐
              │     Zoraxy       │  (local reverse proxy)
              └────────┬─────────┘
                       │
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
          │  /html/thumbs/         │  ← named volume
          └────────────────────────┘
```

Cloudflare Access injects `Cf-Access-Authenticated-User-Email` on every request that
passes its auth gate. The api validates this header as defense in depth.

### Routing split

| Path | Visibility | Auth |
|---|---|---|
| `/view/*` | Public | None |
| `/oembed`, `/health` | Public | None |
| `/archives/*`, `/thumbs/*` | Public | None |
| `/assets/*`, `config.js`, `*.wasm` | Public | None (both kiosk and editor bundles share `/assets/`) |
| `/` (kiosk viewer SPA) | Public | None |
| `/editor/` (editor SPA) | Internet | Cloudflare Access (Google Workspace OIDC) |
| `/admin` | Internet | Cloudflare Access |
| `/api/*` | Internet | Cloudflare Access + `Cf-Access-Authenticated-User-Email` header |

The static assets (`/assets/*`) must remain public because both Vite entry points (kiosk at
`/` and editor at `/editor/`) output chunks into the shared `dist/assets/` directory.
Restricting `/assets/` would break both the kiosk viewer and the editor.

---

## Docker Compose

Single service — Caddy and oauth2-proxy are not needed. Zoraxy handles routing from
the Cloudflare Tunnel to this container; Cloudflare Access handles authentication.

```yaml
services:
  viewer:
    build:
      context: .
      dockerfile: docker/Dockerfile
    restart: unless-stopped
    # No ports exposed to the host — Zoraxy connects via Docker network or localhost
    environment:
      - ADMIN_ENABLED=true
      - CHUNKED_UPLOAD=true
      - SITE_URL=${SITE_URL}
      - SITE_NAME=${SITE_NAME:-Vitrine3D}
      - OG_ENABLED=true
      # ... other env vars
    volumes:
      - archives:/usr/share/nginx/html/archives
      - thumbs:/usr/share/nginx/html/thumbs    # persists extracted thumbnails across rebuilds
      - app_data:/data                          # SQLite database
    healthcheck:
      # nginx answers /health directly — independent of the api process
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  archives:
  thumbs:
  app_data:
```

### Cloudflare Access Setup

Cloudflare Access replaces oauth2-proxy. Auth is enforced at the Cloudflare edge — no
credentials or OIDC client secrets are needed inside the container.

1. [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/) → Access → Applications
2. **Add an application** → Self-hosted
3. **Application domain**: `your-domain.com`
4. **Path**: leave blank to protect all routes, then add bypass rules for public paths (step 5)
5. **Bypass rules** — add a policy with Action = **Bypass** for these paths:
   - `/` (exact)
   - `/view/*`
   - `/archives/*`
   - `/thumbs/*`
   - `/assets/*`
   - `/oembed*`
   - `/health`
   - `/favicon*`
   - `/config.js`
6. **Allow rule** — add a policy with Action = **Allow**, Rule = Emails ending in `@yourcompany.com`
7. Under **Settings → Identity**, add Google Workspace as the identity provider

On every authenticated request Cloudflare injects:
- `Cf-Access-Authenticated-User-Email` — the verified email address
- `Cf-Access-Jwt-Assertion` — a signed JWT (optional: verify signature for extra hardness)

No secrets need to be added to docker-compose or the container environment.

### Zoraxy Routing

No Caddyfile is needed. Configure Zoraxy to proxy `your-domain.com` to the viewer
container's internal address. The connection method depends on how Zoraxy is deployed:

| Zoraxy deployment | Viewer target in Zoraxy |
|---|---|
| Host process (not containerised) | `http://localhost:80` or `http://127.0.0.1:80` — requires `ports: ["80:80"]` or a host-network-accessible port in docker-compose |
| Docker container, same `docker-compose.yml` | `http://viewer:80` — uses the Docker Compose service name on the shared network; no host port needed |
| Docker container, separate stack | `http://<bridge-IP>:80` or add both to a shared external Docker network and use the service name |

The simplest setup is to add a `ports: ["80:80"]` (or a non-privileged port like `8080:80`)
to the viewer service in docker-compose and point Zoraxy at `http://localhost:<port>`.
The container does not need to be on the same Docker network as Zoraxy for this to work.

TLS, rate limiting, and auth bypass/allow rules are all configured in the Cloudflare
dashboard (Zero Trust → Access) and Cloudflare WAF — not in Zoraxy or nginx.

> **Rate limiting**: Configure in Cloudflare WAF → Rate Limiting rules. Apply to public
> endpoints (e.g. `/archives/*`, `/view/*`) to prevent bandwidth abuse. No plugin or
> custom build required — it's a Cloudflare dashboard setting.

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

### 2. Validate the Cloudflare Access header on all admin routes

Cloudflare Access injects `Cf-Access-Authenticated-User-Email` after a successful login.
The API should verify this header is present before processing any admin request —
defense in depth, so the API isn't fully open if Cloudflare Access is ever misconfigured
or a request reaches the container through an unexpected path.

Since all traffic arrives via a Cloudflare Tunnel, header spoofing from the public internet
is not possible. The check is still worth keeping as an internal safety net.

```js
function requireAuth(req, res) {
    // Injected by Cloudflare Access after successful OIDC authentication
    const user = req.headers['cf-access-authenticated-user-email'];
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

> **Optional — JWT signature verification**: For maximum assurance, verify the
> `Cf-Access-Jwt-Assertion` header against Cloudflare's public keys at
> `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/certs`. This proves the
> header was set by Cloudflare and not by an internal misconfiguration. Useful if the
> container is ever reachable from paths that don't go through the Tunnel.

### 3. CSRF protection on state-changing routes

HMAC-signed token tied to the authenticated user identity. Avoids the subdomain cookie
injection vulnerability in the plain double-submit pattern (where an attacker controlling
any subdomain can inject a matching cookie + header pair).

The token is generated at startup from an in-memory key, served via `GET /api/csrf-token`,
and verified on every state-changing request. Tying the token to `Cf-Access-Authenticated-User-Email`
means a token stolen from one session is invalid for another.

```js
const crypto = require('crypto');

// Generated once at process start — not persisted, invalidates on restart (intentional)
const CSRF_KEY = crypto.randomBytes(32);

function csrfToken(user) {
    return crypto.createHmac('sha256', CSRF_KEY).update(user).digest('hex');
}

// GET /api/csrf-token — called by admin SPA on load
function handleCsrfToken(req, res) {
    const user = requireAuth(req, res);
    if (!user) return;
    sendJson(res, 200, { token: csrfToken(user) });
}

// On POST/PATCH/DELETE — verify
function checkCsrf(req, res) {
    const user = req.headers['cf-access-authenticated-user-email'];
    const header = req.headers['x-csrf-token'];
    const expected = user ? csrfToken(user) : null;
    if (!header || !expected || !crypto.timingSafeEqual(
        Buffer.from(header), Buffer.from(expected)
    )) {
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

> **Cloudflare upload size limit**: Cloudflare's free and pro plans cap individual HTTP
> request bodies at **100 MB**. Archives larger than this will be rejected at the
> Cloudflare edge before reaching the container. Two options:
> - Keep `CHUNKED_UPLOAD=true` and ensure the client chunks uploads at ≤ 100 MB per
>   part — each chunk individually satisfies the limit.
> - Switch to Cloudflare Business/Enterprise which raises or removes the cap.
> The busboy `limits.fileSize` check (container side) should be set to the chunk size,
> not the total archive size, when chunked upload is enabled.

### 5. Remove basic auth — pass Cloudflare Access header through nginx to the api

`docker-entrypoint.sh` currently generates `/etc/nginx/.htpasswd` and writes `auth_basic`
blocks into `admin-auth.conf.inc`. With Cloudflare Access handling auth externally at the
edge, these blocks must be removed — they would prompt a second password dialog after
the user has already authenticated through Cloudflare.

The `ADMIN_PASS`, `ADMIN_USER` env vars and the `openssl passwd` call in the entrypoint
can be removed entirely. The nginx admin location blocks become simple proxy directives
that forward the Cloudflare identity header the api already validates:

```nginx
# admin-auth.conf.inc — after migration (no auth_basic)
location /admin {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    # Forward the Cloudflare Access verified email to the api
    proxy_set_header Cf-Access-Authenticated-User-Email $http_cf_access_authenticated_user_email;
}

location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header Cf-Access-Authenticated-User-Email $http_cf_access_authenticated_user_email;
    client_max_body_size ${MAX_UPLOAD_SIZE:-1024}m;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
```

Also remove the `ADMIN_PASS`/`ADMIN_USER` `ENV` declarations from the Dockerfile and
their entries from `docker-compose.yml`.

Add a static `/health` location to `nginx.conf.template` so the health check passes
independently of the api process:

```nginx
location = /health {
    access_log off;
    return 200 "ok\n";
    add_header Content-Type text/plain;
}
```

This location answers from nginx directly — if the api crashes, nginx still returns 200
on `/health` and the container stays up (intentional: nginx serving static files is still
useful). For a stricter check that also validates the api, s6 supervision state can be
queried, but for most deployments the nginx-only check is sufficient.

### 6. Move credentials to Docker secrets

With Cloudflare Access handling auth, there are no OAuth client secrets to manage inside
the container. The only remaining secret is `SITE_URL` and any app-specific values you'd
prefer not to expose via `docker inspect` or process listings. If you add a `SESSION_KEY`
or similar signing secret in the future, use Docker secrets for it:

```yaml
# docker-compose.yml
secrets:
  session_key:
    file: ./secrets/session_key.txt

services:
  viewer:
    secrets: [session_key]
    # Read from /run/secrets/session_key at startup
```

For the current scope, environment variables are acceptable since there are no high-value
secrets — `SITE_URL`, `SITE_NAME`, etc. are not sensitive.

---

## Changes Required in the Dockerfile

### Replace entrypoint process management with s6-overlay

s6-overlay is designed for multi-process containers: proper supervision, clean shutdown,
dependency ordering between services.

```dockerfile
FROM node:alpine AS build
# ... npm ci, npm run build

# Separate stage for api dependencies — better-sqlite3 is a native C++ addon
# that requires build tools not available in nginx:alpine.
FROM node:alpine AS api-deps
WORKDIR /build
COPY docker/package.json docker/package-lock.json ./
RUN apk add --no-cache python3 make g++ && npm ci --omit=dev

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
COPY --from=api-deps /build/node_modules /opt/node_modules
COPY docker/nginx.conf.template /etc/nginx/templates/
COPY docker/api.js /opt/api.js
COPY docker/s6-rc.d/ /etc/s6-overlay/s6-rc.d/

# /data is where SQLite lives — mount a named volume here
RUN mkdir -p /data
VOLUME ["/data"]

ENTRYPOINT ["/init"]   # s6 init process
CMD []
```

> **`better-sqlite3` alternative**: If you want to avoid native compilation entirely,
> [`node-sqlite3-wasm`](https://github.com/tndrle/node-sqlite3-wasm) is a pure WASM
> drop-in that works on Alpine without build tools. The API differs slightly but the
> synchronous query pattern is the same.

### Entrypoint migration

The current `docker-entrypoint.sh` does two things before starting processes:
1. Generates ~6 nginx `.conf.inc` files via `envsubst` (cors-origins-map, kiosk-lock,
   embed-referers, og-location-root, admin-auth, view-proxy)
2. Runs `extract-meta.sh` to scan archives on startup

When switching to s6, `ENTRYPOINT ["/init"]` replaces the shell entrypoint. This work
must move to two `oneshot` services that run before nginx and the api start:

```
/etc/s6-overlay/s6-rc.d/
  init-config/
    type        ← "oneshot"
    up          ← /opt/generate-nginx-conf.sh   # replaces envsubst logic from entrypoint
  init-scan/
    type        ← "oneshot"
    up          ← /opt/extract-meta.sh /usr/share/nginx/html /usr/share/nginx/html
    dependencies.d/
      init-config ← scan runs after nginx conf files are written
  nginx/
    type        ← "longrun"
    run         ← exec nginx -g 'daemon off;'
    dependencies.d/
      init-config ← nginx starts after conf.inc files exist
      init-scan   ← nginx starts after initial archive scan
  api/
    type        ← "longrun"
    run         ← exec node /opt/api.js
    dependencies.d/
      init-scan ← api starts after scan completes (db must be ready)
```

`generate-nginx-conf.sh` is a standalone shell script extracted from the current
`docker-entrypoint.sh` — it runs `envsubst` against the templates and writes the
`.conf.inc` files. No other changes to the conf generation logic are needed.

`nginx` and `api` start concurrently after both oneshots finish. nginx will briefly 502
on `/api/*` proxied routes until the api process is ready — this is acceptable; nginx
retries automatically.

---

## SQLite Migration

Replaces `meta/*.json`, `_uuid-index.json`, and hash-based thumbnail lookup with a single
SQLite file at `/data/vitrine.db`. Requires adding `better-sqlite3` to the container's
Node.js dependencies.

### Schema

```sql
-- Run once at DB initialisation before creating tables.
-- WAL mode allows concurrent readers while the api is writing — important because
-- nginx serves /thumbs/ and /archives/ statically while the api may be mid-INSERT.
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;  -- safe with WAL, significantly faster than FULL

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

-- Audit trail: who did what, when, from where.
-- Populated by the api using the Cf-Access-Authenticated-User-Email header on every mutating request.
CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actor      TEXT    NOT NULL,            -- Cf-Access-Authenticated-User-Email
    action     TEXT    NOT NULL,            -- 'upload' | 'delete' | 'rename'
    target     TEXT,                        -- archive uuid
    detail     TEXT,                        -- JSON blob (old/new filename, size, etc.)
    ip         TEXT,                        -- X-Real-IP from nginx
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

> **Thumbnails volume**: The `thumbnail` column stores a relative path (`/thumbs/{hash}.jpg`).
> Thumbnails are written to the container filesystem by `extract-meta.sh`. Add a `thumbs:`
> named volume to the docker-compose `viewer` service (alongside `archives:` and `app_data:`)
> so thumbnails survive container rebuilds:
> ```yaml
> volumes:
>   - archives:/usr/share/nginx/html/archives
>   - thumbs:/usr/share/nginx/html/thumbs
>   - app_data:/data
> ```

> **Migration script**: When upgrading from the flat-file system, a one-shot migration script
> is needed to import existing `meta/{hash}.json` sidecars into SQLite. This script should
> live at `docker/migrate-to-sqlite.js`, read each sidecar, and INSERT with
> `INSERT OR IGNORE` to make it safe to re-run.

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

## Changes Required in admin.html

### Add CSRF token header to all mutating fetch calls

The admin SPA (`docker/admin.html`) makes bare `fetch` calls for `POST`/`PATCH`/`DELETE`
operations with no CSRF header. After adding server-side CSRF verification (item 3 above),
every mutating request must include the token.

Fetch the token once on page load, then attach it to all state-changing requests:

```js
// Fetch token once after page load (user is already authenticated via Cloudflare Access)
let csrfToken = null;
async function initCsrf() {
    const res = await fetch('/api/csrf-token');
    const data = await res.json();
    csrfToken = data.token;
}

// Helper — replaces bare fetch() for mutating requests
function adminFetch(url, options = {}) {
    return fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
            'X-CSRF-Token': csrfToken,
        },
    });
}

// Usage (replaces existing fetch calls):
// adminFetch(`/api/archives/${hash}`, { method: 'DELETE' })
// adminFetch('/api/archives', { method: 'POST', body: formData })
// adminFetch(`/api/archives/${hash}`, { method: 'PATCH', ... })
```

Call `initCsrf()` at startup before any user interaction can trigger a mutating request.

> **Token invalidation on api restart**: The CSRF key is generated at api process start
> and not persisted. If the api restarts (container redeploy, crash), all previously
> issued tokens become invalid and mutating requests return 403. `adminFetch` should
> handle this by re-fetching the token and retrying once on a 403 response:
> ```js
> async function adminFetch(url, options = {}) {
>     const res = await fetch(url, {
>         ...options,
>         headers: { ...(options.headers || {}), 'X-CSRF-Token': csrfToken },
>     });
>     if (res.status === 403) {
>         // Token may have been invalidated by an api restart — refresh and retry once
>         await initCsrf();
>         return fetch(url, {
>             ...options,
>             headers: { ...(options.headers || {}), 'X-CSRF-Token': csrfToken },
>         });
>     }
>     return res;
> }
> ```

### Display authenticated user identity

With Cloudflare Access, the logged-in user's email is available via
`Cf-Access-Authenticated-User-Email`. The api can expose it on a lightweight `GET /api/me`
endpoint, and the admin UI can display it in the header — a useful trust signal that
confirms which account is active:

```js
// GET /api/me in api.js
function handleMe(req, res) {
    const user = requireAuth(req, res);
    if (!user) return;
    sendJson(res, 200, { email: user });
}
```

---

## What Stays the Same

- Archive format (`.a3d`/`.a3z`) — no changes
- `extract-meta.sh` — still used for thumbnail and metadata extraction, just called safely
- nginx static file serving for archives, thumbs, assets
- OG/oEmbed response format
- Clean URL format (`/view/{uuid}`, `/view/{hash}`)
- All environment variable names — backwards compatible
- **No client-side auth gate needed** — Cloudflare Access enforces the auth boundary
  before any request reaches the container. The static SPA bundle does not need to know
  about authentication. The Cloudflare Access bypass policy for `/view/*` ensures UUID
  share links work for unauthenticated viewers without any JS-level changes.

---

## Migration Path (incremental, if not doing from scratch)

In rough priority order:

1. **`execSync` → `execFileSync`** — 5 min, no behaviour change, eliminates shell injection risk
2. **Configure Cloudflare Access in Zero Trust dashboard** — no container changes; adds the auth wall at the Cloudflare edge. Set up bypass policies for public paths (`/`, `/view/*`, `/archives/*`, `/assets/*`, `/health`) and an allow policy for your domain's email accounts. See the Cloudflare Access Setup section above.
3. **Add `Cf-Access-Authenticated-User-Email` check to admin routes** — ~30 lines, defense in depth; validates the header Cloudflare injects on every authenticated request so the API is not fully open if Cloudflare is ever misconfigured
4. **Add CSRF tokens to admin SPA + API** — server side ~50 lines (api.js); client side see item 9
5. **Remove basic auth from entrypoint + nginx** — delete `ADMIN_PASS`/`ADMIN_USER` env vars, remove `openssl passwd` from entrypoint, replace `auth_basic` blocks in `admin-auth.conf.inc` with plain proxy headers that forward `Cf-Access-Authenticated-User-Email`
6. **SQLite migration** — contained change to meta-server.js; write `docker/migrate-to-sqlite.js` to import existing JSON sidecars; run once
7. **s6-overlay** — Dockerfile change only, no application code changes; move startup scan to `init-scan` oneshot
8. **Replace custom multipart parser with busboy** — worth doing after SQLite, since upload handler needs rewriting anyway to record to DB
9. **Add CSRF fetch helper + `/api/me` to admin.html** — client-side companion to item 4; ~40 lines
10. **Add `thumbs:` named volume** — prevent thumbnail data loss on container rebuild
11. **Move app secrets to Docker secrets** — for any future signing keys (e.g. `SESSION_KEY`); no OAuth client secrets are needed since Cloudflare Access handles auth externally
12. **Add `.env.example`** — document all required and optional variables (`SITE_URL`, `SITE_NAME`, `OG_ENABLED`, `ADMIN_ENABLED`, etc.) for operator onboarding

Steps 1–5 are the security-relevant ones. Steps 6–12 are correctness and quality-of-life improvements.

---

## Local Development

With a single-container stack, local development is straightforward. There is no Caddy
or oauth2-proxy to spin up — just the viewer container.

### Basic local dev (auth disabled)

```yaml
# docker-compose.override.yml — commit a .example version, gitignore the real one
services:
  viewer:
    ports:
      - "8080:80"        # expose directly; Zoraxy/Cloudflare Tunnel not needed locally
    environment:
      - ADMIN_ENABLED=true
      # Inject a fake Cloudflare Access email so requireAuth() passes locally.
      # This env var is read by the entrypoint and written into nginx as a default header.
      - DEV_AUTH_USER=dev@localhost
```

```bash
docker compose up    # viewer on http://localhost:8080, admin panel accessible
```

### Simulating the Cloudflare Access header locally

The api's `requireAuth()` checks `Cf-Access-Authenticated-User-Email`. In production this
is injected by Cloudflare; locally you need to supply it yourself. Two options:

**Option A — nginx default header** (no app code change):
Add to the nginx location block for `/api/` in `admin-auth.conf.inc`:

```nginx
# local dev only — sets a fallback value when Cloudflare is not in the path
proxy_set_header Cf-Access-Authenticated-User-Email "${DEV_AUTH_USER:-}";
```

The entrypoint can skip writing this line when `DEV_AUTH_USER` is unset (production default).

**Option B — real Cloudflare Tunnel to localhost**:
`cloudflared` can expose a local port through your existing Cloudflare Tunnel:

```bash
cloudflared tunnel --url http://localhost:8080
```

This gives you a `*.trycloudflare.com` URL with real Cloudflare Access enforcement —
the full auth flow including `Cf-Access-Authenticated-User-Email` injection works exactly
as in production. Useful for testing the CSRF token flow end-to-end.

Add `dev/` to `.gitignore` if you store any local credential files there.

---

## Open Questions

- **SPA split**: ✅ Resolved — **Done.** `src/index.html` builds the kiosk viewer at `/`
  (public) and `src/editor/index.html` builds the editor at `/editor/` (protected). Both
  entry points share the same `dist/assets/` output directory. The auth boundary is enforced
  at the Cloudflare edge — Cloudflare Access bypasses `/`, `/view/*`, `/archives/*`,
  `/assets/*`, and `/health`, and requires authentication for `/editor/`, `/admin`, and
  `/api/*`. nginx has a `/editor/` location block with a comment for a future `auth_basic`
  fallback, but the primary gate is Cloudflare Access.

- **Auth provider**: ✅ Resolved — **Cloudflare Access (Zero Trust)** with Google Workspace
  as the identity provider. No OAuth client secrets are needed inside the container.
  Configure in the Cloudflare Zero Trust dashboard — see the Cloudflare Access Setup section
  above. The container receives the authenticated user's email via the
  `Cf-Access-Authenticated-User-Email` header on every protected request.

- **Audit logging**: ✅ Resolved — schema includes an `audit_log` table. The api populates
  it on every `upload`/`delete`/`rename` action using `Cf-Access-Authenticated-User-Email`
  as the actor and `X-Real-IP` forwarded by nginx. Add alongside the SQLite migration (step 6).

- **Health check tests the wrong process**: ✅ Resolved — add a static `location = /health`
  block to `nginx.conf.template` (see nginx changes in item 5 above). nginx answers
  directly; the health check no longer depends on the api process being up.

- **`.env.example` is missing**: The restructured stack uses `SITE_URL`, `SITE_NAME`,
  `OG_ENABLED`, `ADMIN_ENABLED`, `CHUNKED_UPLOAD`, and similar variables. No OAuth secrets
  are needed (Cloudflare Access handles auth at the edge). A `.env.example` committed to
  the repo with all variables and inline comments is the expected operator onboarding
  artifact for a self-hosted Docker project.

- **`/assets/*` is publicly downloadable** — including editor JS chunks: This is intentional
  and unavoidable (both Vite entry points write chunks to `dist/assets/`; gating `/assets/`
  would break the kiosk viewer). Noting it here so future maintainers do not attempt to
  restrict `/assets/` and silently break public kiosk viewers.
