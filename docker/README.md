# Docker Infrastructure

The Docker image runs a multi-process container supervised by [s6-overlay](https://github.com/just-containers/s6-overlay): **nginx** serves static files, and a **Node.js API server** (`meta-server.js`) handles metadata, admin operations, and video transcoding.

## Image Build

```bash
# From project root — runs Vite build first, then Docker build
npm run docker:build

# Or manually
npm run build
docker build -f docker/Dockerfile -t vitrine3d .
```

The Dockerfile uses a two-stage build:
1. **`api-deps`** — Installs Node.js npm dependencies (`better-sqlite3`, `busboy`) with native compilation
2. **Final image** — `nginx:alpine` with s6-overlay, Node 20 binary copied from stage 1, FFmpeg, and the Vite build output

## Container Layout

```
/usr/share/nginx/html/     Static files (Vite build output)
  archives/                Uploaded archive files (mount point)
  meta/                    Extracted metadata sidecars (auto-generated)
  thumbs/                  Extracted thumbnails (auto-generated)
  media/                   Transcoded video/GIF files
  config.js                Generated from config.js.template at startup
/opt/
  meta-server.js           Node.js API server
  admin.html               Admin panel page
  share-page.html          Social share landing page
  extract-meta.sh          Archive metadata extraction script
  migrate-to-sqlite.js     Migration script for legacy JSON sidecars
  node_modules/            API dependencies (better-sqlite3, busboy)
/data/
  vitrine.db               SQLite database (persistent volume)
/etc/nginx/
  nginx.conf               Generated from nginx.conf.template at startup
/etc/s6-overlay/s6-rc.d/   Process supervision config
```

## Processes (s6-overlay)

| Service | Description |
|---------|-------------|
| `init-config` | Generates `config.js` and `nginx.conf` from templates using env vars |
| `init-scan` | Scans for `.a3d`/`.a3z` files, extracts metadata and thumbnails |
| `nginx` | Serves static files, proxies API routes to meta-server |
| `api` | Node.js meta-server on port 3001 (internal) |

## Meta-Server (`meta-server.js`)

Zero-dependency Node.js HTTP server (uses only `better-sqlite3` and `busboy` from npm). Handles:

### OG/oEmbed Routes (always active)
| Route | Description |
|-------|-------------|
| `GET /` (bot UA) | HTML with Open Graph + Twitter Card meta tags |
| `GET /oembed` | oEmbed JSON response for WordPress embeds |
| `GET /health` | Health check endpoint |

### Admin Routes (`ADMIN_ENABLED=true`)
| Route | Description |
|-------|-------------|
| `GET /admin` | Admin panel HTML page |
| `GET /library` | Editorial-themed library browser page |
| `GET /api/archives` | List all archives with metadata |
| `POST /api/archives` | Upload archive (multipart, streamed) |
| `DELETE /api/archives/:hash` | Delete archive + sidecar files |
| `PATCH /api/archives/:hash` | Rename archive |
| `GET /api/collections` | List collections |
| `POST /api/collections` | Create collection |
| `PATCH /api/collections/:slug` | Update collection |
| `DELETE /api/collections/:slug` | Delete collection |

### Clean URL Routes
| Route | Description |
|-------|-------------|
| `GET /view/:hash` | Resolve hash to archive, serve viewer with injected config |

### Video Transcode Routes
| Route | Description |
|-------|-------------|
| `POST /api/transcode` | Upload WebM, transcode to MP4/GIF via FFmpeg |
| `GET /media/*` | Serve transcoded video/GIF files |

### Authentication

Admin API routes are protected by **Cloudflare Access**. The `Cf-Access-Authenticated-User-Email` header (injected by Cloudflare tunnel) is validated on every request. For local development, set `DEV_AUTH_USER=dev@example.com` to simulate authentication.

### Database

SQLite database at `/data/vitrine.db` stores:
- Archive metadata (hash, filename, path, title, size, timestamps)
- Collections and archive-collection membership
- Server settings

## Nginx Configuration

Generated from `nginx.conf.template` at startup via `generate-nginx-conf.sh`. Features:
- GZIP compression for text assets
- Cache headers (1 day for static files)
- CORS headers (configurable via `CORS_ORIGINS`)
- CSP `frame-ancestors` header (configurable via `FRAME_ANCESTORS`)
- Proper MIME types for `.a3d`, `.a3z`, `.e57`
- Bot user-agent detection for OG tag serving
- Proxy pass for `/api/*`, `/admin`, `/library`, `/view/*`, `/oembed`, `/health` to meta-server

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build (Node 20 + nginx:alpine + s6-overlay + FFmpeg) |
| `meta-server.js` | Node.js API server (~2,800 lines) |
| `admin.html` | Standalone admin panel page |
| `share-page.html` | Social share landing page with OG tags |
| `config.js.template` | `config.js` template with env var substitution |
| `nginx.conf.template` | nginx config template with env var substitution |
| `nginx.conf` | Static nginx config (local dev reference) |
| `generate-nginx-conf.sh` | Generates nginx.conf from template + env vars |
| `docker-entrypoint.sh` | Legacy entrypoint (superseded by s6-overlay) |
| `extract-meta.sh` | Scans archives, extracts manifest metadata and thumbnails |
| `migrate-to-sqlite.js` | Imports legacy JSON sidecars into SQLite |
| `package.json` | API-only npm dependencies (better-sqlite3, busboy) |
| `s6-rc.d/` | s6-overlay service definitions |

## Environment Variables

See [DEPLOYMENT.md](../docs/DEPLOYMENT.md) for the full environment variable reference. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_ENABLED` | `false` | Enable admin panel and library |
| `OG_ENABLED` | `false` | Enable Open Graph meta tags |
| `SITE_URL` | _(empty)_ | Canonical viewer URL |
| `ALLOWED_DOMAINS` | _(empty)_ | Trusted external domains for URL loading |
| `FRAME_ANCESTORS` | `'self'` | CSP frame-ancestors for iframe embedding |
| `MAX_UPLOAD_SIZE` | `1024` | Max upload size in MB |
| `DEFAULT_KIOSK_THEME` | `editorial` | Default theme for clean URL views |
| `APP_TITLE` | `Vitrine3D` | Browser tab title |

## Quick Start

```bash
# Basic viewer
docker run -p 8080:80 vitrine3d

# With admin panel and local archives
docker run -p 8080:80 \
  -v ./archives:/usr/share/nginx/html/archives:rw \
  -v vitrine_db:/data \
  -e ADMIN_ENABLED=true \
  -e DEV_AUTH_USER=dev@example.com \
  vitrine3d

# Full production stack
docker compose up -d
```

See [docker-compose.yml](../docker-compose.yml) and [DEPLOYMENT.md](../docs/DEPLOYMENT.md) for production deployment.
