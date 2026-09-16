#!/usr/bin/env bash
# Continuation Pipeline: enable the terminal path on Linux or macOS.
#
# Ensures an SSH server, tmux, and (best effort) Tailscale are present, installs
# your phone's public key, adds the `cc` helper to your shell, and, when you
# supply a key, switches SSH to key only auth. It does NOT forward any router
# port: the tailnet is the only route in.
#
# Usage:
#   ./setup.sh                       # install tmux/ssh/cc, leave auth as is
#   ./setup.sh --key-path phone.pub  # also install the key and harden to key only
#   ./setup.sh --key "ssh-ed25519 AAAA... me@phone"
#
# Safe to re-run.
set -euo pipefail

PUBKEY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --key)       PUBKEY="$2"; shift 2 ;;
    --key-path)  PUBKEY="$(cat "$2")"; shift 2 ;;
    -h|--help)   grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

OS="$(uname -s)"
say() { printf '==> %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# --- package installs, per platform -----------------------------------------
install_linux_pkg() {  # install a package by name using whatever manager exists
  local pkg="$1"
  if   have apt-get; then sudo apt-get update -qq && sudo apt-get install -y -qq "$pkg"
  elif have dnf;     then sudo dnf install -y -q "$pkg"
  elif have pacman;  then sudo pacman -Sy --noconfirm "$pkg"
  elif have zypper;  then sudo zypper -q install -y "$pkg"
  else echo "No known package manager; install '$pkg' yourself." >&2; return 1
  fi
}

ensure_tmux() {
  if have tmux; then say "tmux already installed"; return; fi
  say "Installing tmux"
  case "$OS" in
    Linux)  install_linux_pkg tmux ;;
    Darwin) have brew && brew install tmux || { echo "Install Homebrew, then: brew install tmux" >&2; exit 1; } ;;
  esac
}

ensure_sshd() {
  case "$OS" in
    Linux)
      if ! have sshd && ! [ -x /usr/sbin/sshd ]; then
        say "Installing OpenSSH server"
        install_linux_pkg openssh-server || install_linux_pkg openssh || true
      fi
      say "Enabling and starting sshd"
      sudo systemctl enable --now ssh 2>/dev/null || sudo systemctl enable --now sshd 2>/dev/null || \
        echo "Could not manage sshd via systemctl; start it however your init does." >&2
      ;;
    Darwin)
      say "Enabling Remote Login (built in sshd)"
      sudo systemsetup -setremotelogin on || \
        echo "Enable it in System Settings > General > Sharing > Remote Login." >&2
      ;;
  esac
}

ensure_tailscale() {
  if have tailscale; then say "Tailscale already installed"; return; fi
  say "Installing Tailscale"
  case "$OS" in
    Linux)  curl -fsSL https://tailscale.com/install.sh | sh ;;
    Darwin)
      if have brew; then brew install --cask tailscale || brew install tailscale
      else echo "Install Tailscale from the Mac App Store or https://tailscale.com/download" >&2; fi
      ;;
  esac
}

install_key() {
  [ -n "$PUBKEY" ] || return 0
  local ak="$HOME/.ssh/authorized_keys"
  say "Installing key -> $ak"
  mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
  touch "$ak"; chmod 600 "$ak"
  grep -qF "$PUBKEY" "$ak" || printf '%s\n' "$PUBKEY" >> "$ak"
}

harden_ssh() {
  [ -n "$PUBKEY" ] || { say "No key supplied; leaving SSH auth unchanged"; return 0; }
  # ponytail: use the sshd_config.d drop in where it is honored; skip (do not sed
  # the main file) otherwise, so a distro without Include never gets a half edit.
  local dropdir=/etc/ssh/sshd_config.d
  if [ "$OS" = "Darwin" ]; then dropdir=/etc/ssh/sshd_config.d; fi
  if [ -d "$dropdir" ] && grep -qiE '^\s*Include\s+.*sshd_config\.d' /etc/ssh/sshd_config 2>/dev/null; then
    say "Switching SSH to key only auth (drop in)"
    printf 'PasswordAuthentication no\nPubkeyAuthentication yes\n' | \
      sudo tee "$dropdir/10-continuation.conf" >/dev/null
    if [ "$OS" = "Linux" ]; then sudo systemctl reload ssh 2>/dev/null || sudo systemctl reload sshd 2>/dev/null || true
    else sudo launchctl kickstart -k system/com.openssh.sshd 2>/dev/null || true; fi
  else
    echo "NOTE: no sshd_config.d Include found; key installed but password auth" >&2
    echo "      left on. Disable it by hand in /etc/ssh/sshd_config if you want." >&2
  fi
}

add_cc_helper() {
  local marker="# continuation-pipeline cc helper"
  local rc="$HOME/.bashrc"
  case "${SHELL##*/}" in zsh) rc="$HOME/.zshrc" ;; esac
  if grep -qF "$marker" "$rc" 2>/dev/null; then
    say "cc helper already present in $rc"
  else
    say "Adding cc helper to $rc"
    cat >> "$rc" <<'EOF'

# continuation-pipeline cc helper
# Attach the persistent Claude Code session, or create it if it does not exist.
cc() { tmux new -A -s continuation 'claude'; }
EOF
  fi
  have claude || echo "WARNING: 'claude' is not on PATH; cc will have nothing to launch." >&2
}

case "$OS" in
  Linux|Darwin) ;;
  *) echo "This script is for Linux/macOS. On Windows use setup.ps1." >&2; exit 2 ;;
esac

ensure_tailscale
ensure_sshd
ensure_tmux
install_key
harden_ssh
add_cc_helper

echo ""
say "Done."
echo "  1. Bring Tailscale up (if not already):  sudo tailscale up"
echo "  2. Install Tailscale on the phone, same account."
echo "  3. From the phone:  ssh $USER@<this-host>.<tailnet>.ts.net  then:  cc"
