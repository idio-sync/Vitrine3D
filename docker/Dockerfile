# Stage 1: Build API npm dependencies
# better-sqlite3 is a native C++ addon — requires build tools unavailable in nginx:alpine
FROM node:alpine AS api-deps
WORKDIR /build
COPY docker/package.json docker/package-lock.json ./
RUN apk add --no-cache python3 make g++ && npm ci --omit=dev

# Final image
FROM nginx:alpine

# Install s6-overlay for process supervision
ARG S6_VERSION=3.2.0.0
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-x86_64.tar.xz /tmp/
RUN apk add --no-cache xz gettext nodejs python3 unzip && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz

# Copy compiled API dependencies from build stage
COPY --from=api-deps /build/node_modules /opt/node_modules

# Copy nginx configuration template (processed by entrypoint)
COPY docker/nginx.conf.template /etc/nginx/templates/nginx.conf.template

# Copy Vite build output (run "npm run build" before "docker build")
COPY dist/ /usr/share/nginx/html/

# Copy the config template and generate-nginx-conf script
COPY docker/config.js.template /usr/share/nginx/html/config.js.template

# Copy OG/oEmbed API server, admin panel, and metadata extraction script
COPY docker/meta-server.js /opt/meta-server.js
COPY docker/admin.html /opt/admin.html
COPY docker/extract-meta.sh /opt/extract-meta.sh
RUN chmod +x /opt/extract-meta.sh
COPY docker/migrate-to-sqlite.js /opt/migrate-to-sqlite.js

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

COPY docker/generate-nginx-conf.sh /opt/generate-nginx-conf.sh
COPY docker/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
RUN chmod +x /opt/generate-nginx-conf.sh \
              /etc/s6-overlay/s6-rc.d/nginx/run \
              /etc/s6-overlay/s6-rc.d/api/run

ENTRYPOINT ["/init"]
CMD []
