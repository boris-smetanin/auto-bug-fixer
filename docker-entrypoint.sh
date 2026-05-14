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
#
# The dev compose target additionally mounts anonymous volumes for the
# per-workspace node_modules trees; those start root-owned and need to be
# chown'd before npm/tsx can write to them as node. Paths that don't exist
# in a given run (e.g. anon volumes in prod) are skipped silently.

if [ "$(id -u)" = "0" ]; then
  mkdir -p /home/node/.config /home/node/.cache
  for d in /data /home/node \
           /app/node_modules /app/server/node_modules \
           /app/web/node_modules /app/shared/node_modules; do
    [ -e "$d" ] && chown -R node:node "$d" 2>/dev/null || true
  done
  # gosu does not switch HOME; without this, the node user would inherit the
  # root user's HOME and fail to write to ~/.npm, ~/.config/claude, etc.
  export HOME=/home/node
  exec gosu node "$@"
fi

exec "$@"
