#!/bin/sh
set -e

# Substitute environment variables in the config template
envsubst '${DEFAULT_ARCHIVE_URL} ${DEFAULT_SPLAT_URL} ${DEFAULT_MODEL_URL} ${DEFAULT_POINTCLOUD_URL} ${DEFAULT_ALIGNMENT_URL} ${SHOW_CONTROLS} ${ALLOWED_DOMAINS}' \
    < /usr/share/nginx/html/config.js.template \
    > /usr/share/nginx/html/config.js

# Substitute environment variables in the nginx config template
envsubst '${FRAME_ANCESTORS}' \
    < /etc/nginx/templates/nginx.conf.template \
    > /etc/nginx/conf.d/default.conf

echo "Configuration generated:"
echo "  DEFAULT_ARCHIVE_URL: ${DEFAULT_ARCHIVE_URL:-<not set>}"
echo "  DEFAULT_SPLAT_URL: ${DEFAULT_SPLAT_URL:-<not set>}"
echo "  DEFAULT_MODEL_URL: ${DEFAULT_MODEL_URL:-<not set>}"
echo "  DEFAULT_POINTCLOUD_URL: ${DEFAULT_POINTCLOUD_URL:-<not set>}"
echo "  DEFAULT_ALIGNMENT_URL: ${DEFAULT_ALIGNMENT_URL:-<not set>}"
echo "  SHOW_CONTROLS: ${SHOW_CONTROLS}"
echo "  ALLOWED_DOMAINS: ${ALLOWED_DOMAINS:-<not set>}"
echo "  FRAME_ANCESTORS: ${FRAME_ANCESTORS}"

# Execute the main command
exec "$@"
