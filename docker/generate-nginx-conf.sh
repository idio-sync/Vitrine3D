#!/bin/sh
set -e

# Defaults — export so envsubst (a subprocess) can see values set here.
# Same fix applied to SERVER_NAMES in cf70a99.
# Normalize boolean env vars to lowercase (Docker/Unraid may pass TRUE/FALSE)
export ADMIN_ENABLED="$(echo "${ADMIN_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')"
export CHUNKED_UPLOAD="$(echo "${CHUNKED_UPLOAD:-false}" | tr '[:upper:]' '[:lower:]')"
export OG_ENABLED="$(echo "${OG_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')"
export KIOSK_LOCK="$(echo "${KIOSK_LOCK:-}" | tr '[:upper:]' '[:lower:]')"
export DEFAULT_KIOSK_THEME="${DEFAULT_KIOSK_THEME:-editorial}"
export APP_TITLE="${APP_TITLE:-Vitrine3D}"

# Substitute environment variables in the config template
envsubst '${DEFAULT_ARCHIVE_URL} ${DEFAULT_SPLAT_URL} ${DEFAULT_MODEL_URL} ${DEFAULT_POINTCLOUD_URL} ${ALLOWED_DOMAINS} ${KIOSK_LOCK} ${ARCHIVE_PATH_PREFIX} ${LOD_BUDGET_SD} ${LOD_BUDGET_HD} ${ADMIN_ENABLED} ${CHUNKED_UPLOAD} ${DEFAULT_KIOSK_THEME} ${APP_TITLE}' \
    < /usr/share/nginx/html/config.js.template \
    > /usr/share/nginx/html/config.js

# Substitute environment variables in the nginx config template
export SERVER_NAMES="${SERVER_NAMES:-localhost}"
envsubst '${FRAME_ANCESTORS} ${SERVER_NAMES} ${SITE_URL}' \
    < /etc/nginx/templates/nginx.conf.template \
    > /etc/nginx/conf.d/default.conf

# Generate CORS origin map from CORS_ORIGINS env var
# CORS_ORIGINS is a space-separated list of allowed origins (e.g., "https://app.example.com https://portal.example.com")
# When empty (default), no Access-Control-Allow-Origin header is emitted (same-origin only)
if [ -n "${CORS_ORIGINS}" ]; then
    {
        echo 'map $http_origin $cors_origin {'
        echo '    default "";'
        for origin in ${CORS_ORIGINS}; do
            echo "    \"${origin}\" \"${origin}\";"
        done
        echo '}'
    } > /etc/nginx/conf.d/cors-origins-map.conf.inc
else
    # No CORS origins — $cors_origin is always empty, so no header is emitted
    cat > /etc/nginx/conf.d/cors-origins-map.conf.inc <<'CORSEOF'
map $http_origin $cors_origin {
    default "";
}
CORSEOF
fi

echo "Configuration generated:"
echo "  DEFAULT_ARCHIVE_URL: ${DEFAULT_ARCHIVE_URL:-<not set>}"
echo "  DEFAULT_SPLAT_URL: ${DEFAULT_SPLAT_URL:-<not set>}"
echo "  DEFAULT_MODEL_URL: ${DEFAULT_MODEL_URL:-<not set>}"
echo "  DEFAULT_POINTCLOUD_URL: ${DEFAULT_POINTCLOUD_URL:-<not set>}"
echo "  ALLOWED_DOMAINS: ${ALLOWED_DOMAINS:-<not set>}"
echo "  FRAME_ANCESTORS: ${FRAME_ANCESTORS}"
echo "  SERVER_NAMES: ${SERVER_NAMES:-localhost}"
echo "  CORS_ORIGINS: ${CORS_ORIGINS:-<not set, same-origin only>}"
echo "  ARCHIVE_PATH_PREFIX: ${ARCHIVE_PATH_PREFIX:-<not set>}"

# kiosk-lock.conf.inc must exist (included by nginx.conf.template); always empty now
# that editor modules are in a separate bundle at /editor/
: > /etc/nginx/conf.d/kiosk-lock.conf.inc

# Generate embed referer check rules
if [ -n "${EMBED_REFERERS}" ]; then
    cat > /etc/nginx/conf.d/embed-referers.conf.inc <<REFEOF
valid_referers none server_names ${EMBED_REFERERS};
if (\$invalid_referer) {
    return 403;
}
REFEOF
    echo "  EMBED_REFERERS: ${EMBED_REFERERS}"
else
    : > /etc/nginx/conf.d/embed-referers.conf.inc
    echo "  EMBED_REFERERS: off (all referers allowed)"
fi

# Initialize conditional includes as empty (populated below if applicable)
: > /etc/nginx/conf.d/view-proxy.conf.inc

# --- Admin panel support ---

if [ "${ADMIN_ENABLED}" = "true" ]; then
    echo ""
    echo "Admin panel: ENABLED"
    echo "  MAX_UPLOAD_SIZE: ${MAX_UPLOAD_SIZE:-1024}MB"
    echo "  CHUNKED_UPLOAD: ${CHUNKED_UPLOAD:-false}"

    # Generate admin nginx config — forwards Cloudflare Access header to api
    # Auth is enforced at the Cloudflare edge; no basic auth needed inside the container
    if [ -n "${DEV_AUTH_USER}" ]; then
        # Local dev: inject a static CF header so requireAuth() passes without real Cloudflare
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
        echo ""
        echo "  *** WARNING: DEV_AUTH_USER is set. All /admin and /api/ requests will authenticate"
        echo "  *** as '${DEV_AUTH_USER}' regardless of actual credentials. REMOVE BEFORE PRODUCTION."
        echo ""
    else
        cat > /etc/nginx/conf.d/admin-auth.conf.inc <<ADMINEOF
location /admin {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    # Security: \$http_cf_access_authenticated_user_email reflects the incoming header.
    # Header spoofing is prevented by the Cloudflare Tunnel — only Cloudflare can
    # reach this container, so this header is always set by Cloudflare Access.
    proxy_set_header Cf-Access-Authenticated-User-Email \$http_cf_access_authenticated_user_email;
}

location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    # Security: \$http_cf_access_authenticated_user_email reflects the incoming header.
    # Header spoofing is prevented by the Cloudflare Tunnel — only Cloudflare can
    # reach this container, so this header is always set by Cloudflare Access.
    proxy_set_header Cf-Access-Authenticated-User-Email \$http_cf_access_authenticated_user_email;
    client_max_body_size ${MAX_UPLOAD_SIZE:-1024}m;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
ADMINEOF
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

# --- OG/oEmbed link preview support ---

if [ "${OG_ENABLED}" = "true" ]; then
    echo ""
    echo "OG/oEmbed link previews: ENABLED"
    echo "  SITE_NAME: ${SITE_NAME}"
    echo "  SITE_URL: ${SITE_URL:-<not set — required for OG URLs>}"
    echo "  SITE_DESCRIPTION: ${SITE_DESCRIPTION}"
    echo "  OEMBED_WIDTH: ${OEMBED_WIDTH}"
    echo "  OEMBED_HEIGHT: ${OEMBED_HEIGHT}"

    if [ -z "${SITE_URL}" ]; then
        echo "  WARNING: SITE_URL is not set. OG meta tags and oEmbed will use relative URLs."
        echo "  Set SITE_URL to your canonical viewer URL (e.g., https://viewer.yourcompany.com)"
    fi

    # Check for operator-provided default thumbnail
    if [ -f /usr/share/nginx/html/thumbs/default.jpg ]; then
        echo "  Default thumbnail: found"
    else
        echo "  Default thumbnail: NOT FOUND"
        echo "  Mount a default.jpg to /usr/share/nginx/html/thumbs/default.jpg for fallback previews"
    fi

    # Generate root location with bot detection
    # Uses rewrite to internal location (safe nginx pattern — avoids proxy_pass inside if)
    cat > /etc/nginx/conf.d/og-location-root.conf.inc <<'ROOTEOF'
location / {
    if ($is_bot) {
        rewrite ^(.*)$ /__og_bot_proxy$1 last;
    }
    try_files $uri $uri/ /index.html;
}
ROOTEOF

    # Generate oEmbed endpoint + internal bot proxy location
    cat > /etc/nginx/conf.d/og-oembed.conf.inc <<'OEMBEDEOF'
# oEmbed endpoint — always proxied to meta-server (not just for bots)
location /oembed {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Internal location for bot-proxied requests (rewritten from location /)
location /__og_bot_proxy {
    internal;
    rewrite ^/__og_bot_proxy(.*)$ $1 break;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
OEMBEDEOF

else
    # OG disabled — generate plain root location and empty oEmbed include
    cat > /etc/nginx/conf.d/og-location-root.conf.inc <<'ROOTEOF'
location / {
    try_files $uri $uri/ /index.html;
}
ROOTEOF
    : > /etc/nginx/conf.d/og-oembed.conf.inc
    echo ""
    echo "OG/oEmbed link previews: disabled (set OG_ENABLED=true to enable)"
fi

# Generate view-proxy.conf.inc when any feature that needs the meta-server is enabled
if [ "${OG_ENABLED}" = "true" ] || [ "${ADMIN_ENABLED}" = "true" ]; then
    cat > /etc/nginx/conf.d/view-proxy.conf.inc <<'VIEWEOF'
# UUID v4 format: /view/{8-4-4-4-12 hex with dashes}
location ~ "^/view/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
# Legacy 16-hex-char hash format: /view/{hash}
location ~ "^/view/[a-f0-9]{16}$" {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
VIEWEOF

    # Collection pages: /collection/{slug} — proxy to meta-server for HTML injection
    cat >> /etc/nginx/conf.d/view-proxy.conf.inc <<'COLLEOF'
# Collection pages: /collection/{slug}
location ~ "^/collection/[a-z0-9][a-z0-9-]{0,79}$" {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
COLLEOF
    echo "  Clean URLs: /view/{uuid}, /view/{hash}, and /collection/{slug} enabled"
fi

exit 0
