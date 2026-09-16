#!/usr/bin/env bash
# Continuation Pipeline: prepare WSL for the terminal path.
# Installs tmux and adds a `cc` helper that attaches (or starts) the persistent
# Claude Code session. Idempotent: safe to re-run.
set -euo pipefail

echo "==> Installing tmux"
if ! command -v tmux >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq tmux
else
  echo "    already installed"
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "    WARNING: 'claude' is not on PATH inside WSL. Install Claude Code in WSL,"
  echo "             or the cc helper will have nothing to launch." >&2
fi

MARKER="# continuation-pipeline cc helper"
if ! grep -qF "$MARKER" "$HOME/.bashrc" 2>/dev/null; then
  echo "==> Adding cc helper to ~/.bashrc"
  cat >> "$HOME/.bashrc" <<'EOF'

# continuation-pipeline cc helper
# Attach the persistent Claude Code session, or create it if it does not exist.
cc() { tmux new -A -s continuation 'claude'; }
EOF
else
  echo "==> cc helper already present"
fi

echo ""
echo "Done. Open a new shell (or: source ~/.bashrc), then run: cc"
