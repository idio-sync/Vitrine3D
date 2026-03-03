# Stage 1: Build API npm dependencies
# better-sqlite3 is a native C++ addon — requires build tools unavailable in nginx:alpine
FROM node:alpine AS api-deps
WORKDIR /build
COPY docker/package.json docker/package-lock.json ./
RUN apk add --no-cache python3 make g++ && npm ci --omit=dev

# Final image
FROM nginx:alpine

# Install runtime tools:
# - gettext: envsubst for template substitution
# - nodejs: API server runtime
# - python3: metadata extraction JSON parsing
# - unzip: reading archive contents
RUN apk add --no-cache gettext nodejs python3 unzip

# Copy compiled API dependencies from build stage
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

# Create directories for archive metadata, thumbnails, and SQLite database
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
