# Stage 1: Build API npm dependencies
# Pinned to Node 20 LTS: better-sqlite3 prebuilt binaries are published for LTS releases only.
# The same Node binary is copied to the final stage to guarantee ABI compatibility.
FROM node:20-alpine AS api-deps
WORKDIR /build
COPY docker/package.json docker/package-lock.json ./
RUN apk add --no-cache python3 make g++ && npm ci --omit=dev

# Final image
FROM nginx:alpine

# Install s6-overlay for process supervision
ARG S6_VERSION=3.2.0.0
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_VERSION}/s6-overlay-x86_64.tar.xz /tmp/
# libstdc++ is required by the Node binary and better-sqlite3 native addon.
# nodejs is NOT installed via apk — the build-stage binary is copied below for ABI compatibility.
RUN apk add --no-cache xz gettext python3 unzip libstdc++ ffmpeg && \
    apk add --no-cache --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community \
        libva-utils intel-media-driver && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz

# Copy Node 20 binary from build stage (must match the ABI better-sqlite3 was compiled against)
COPY --from=api-deps /usr/local/bin/node /usr/local/bin/node

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
COPY docker/share-page.html /opt/share-page.html
COPY docker/extract-meta.sh /opt/extract-meta.sh
RUN chmod +x /opt/extract-meta.sh
COPY docker/migrate-to-sqlite.js /opt/migrate-to-sqlite.js

# Create directories for archive metadata, thumbnails, and SQLite database
RUN mkdir -p /usr/share/nginx/html/meta /usr/share/nginx/html/thumbs /usr/share/nginx/html/media /data

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
ENV DEFAULT_KIOSK_THEME="editorial"
ENV APP_TITLE="Vitrine3D"
ENV DJI_API_KEY=""
ENV VIDEO_CODEC=""
ENV VAAPI_DEVICE=""
# Headless VA-API: suppress X11 connection attempts and set runtime dir
ENV LIBVA_DRIVER_NAME=iHD
ENV LIBVA_DRIVERS_PATH=/usr/lib/dri
ENV XDG_RUNTIME_DIR=/tmp

VOLUME ["/data"]

EXPOSE 80

COPY docker/generate-nginx-conf.sh /opt/generate-nginx-conf.sh
COPY docker/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
RUN chmod +x /opt/generate-nginx-conf.sh \
              /etc/s6-overlay/s6-rc.d/nginx/run \
              /etc/s6-overlay/s6-rc.d/api/run \
              /etc/s6-overlay/s6-rc.d/init-config/up \
              /etc/s6-overlay/s6-rc.d/init-scan/up

ENTRYPOINT ["/init"]
CMD []
