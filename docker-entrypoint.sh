#!/bin/sh
set -e

# Als root gestartet: das data-Volume dem node-User geben (Bind-Mounts
# gehören sonst oft root), dann Privilegien abgeben. Kein manuelles
# chown auf dem Host nötig.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R node:node /app/data
  exec su-exec node "$@"
fi

exec "$@"
