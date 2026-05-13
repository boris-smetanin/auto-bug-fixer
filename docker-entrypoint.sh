#!/bin/sh
set -e

# /data is bind-mounted on dev macs from the host. The host's file ownership
# doesn't always match the `node` user (uid 1000) inside the container — fix
# it on startup so the server can write logs, clones, and the SQLite DB.
#
# Claude Code's CLI refuses --dangerously-skip-permissions when invoked as
# root, so the server *must* run as a non-root user. Running this fix-up via
# an entrypoint as root and then dropping privileges with gosu keeps the
# host bind-mount workflow ergonomic.

if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data
  exec gosu node "$@"
fi

exec "$@"
