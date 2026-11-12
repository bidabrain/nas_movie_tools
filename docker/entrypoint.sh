#!/bin/sh
# Run as PUID/PGID (default 1000) so organized files are owned by the NAS user.
set -e
PUID=${PUID:-1000}
PGID=${PGID:-1000}
umask "${UMASK:-022}"
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = "0" ]; then
  chown "$PUID:$PGID" "$DATA_DIR" 2>/dev/null || true
  exec su-exec "$PUID:$PGID" "$@"
fi
exec "$@"
