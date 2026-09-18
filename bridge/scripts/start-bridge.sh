#!/usr/bin/env bash
# Start the Continuation bridge. Used by the logon auto-start task, but also fine to run by
# hand. Idempotent: exits cleanly if the bridge is already up. Resolves its own repo path, so
# there is nothing machine-specific to edit.
set -e

BRIDGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Already running? (default port 8790)
if curl -sf http://127.0.0.1:8790/health >/dev/null 2>&1; then
  echo "bridge already running"
  exit 0
fi

# Load Node via nvm if present (the logon shell may not have it on PATH).
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi

cd "$BRIDGE_DIR"
exec npx tsx src/index.ts
