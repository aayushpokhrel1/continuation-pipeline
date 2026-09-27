# Handover

Short resume note. The durable project knowledge (what it is, architecture, roadmap, setup,
security, gotchas) lives in the docs, not here. Read those first, then use the live context
below to pick up work.

## Read these first

- [`README.md`](README.md) - what the project is, the two paths, security model, full roadmap
  (all stages shipped), and the terminal-path quick start.
- [`bridge/README.md`](bridge/README.md) - the app-path bridge: setup, run, phone use, terminal
  continuation, layout, and gotchas.
- [`docs/app-path-design.md`](docs/app-path-design.md) - the app-path design and SDK facts.
- [`docs/superpowers/specs/`](docs/superpowers/specs/) - the per-slice design specs (diff,
  multi-repo, terminal continuation, Slice B).

## Current state

Backbone (Tailscale), terminal path (SSH + tmux `cc`), and the full app path (Stages 1-3) are
shipped and committed. The bridge is server-tested (WSL `npm run verify`, all green) and the
clients are browser-verified. Both paths have been driven from a real iPhone through Stage 2.

**Pending real-device checks (only doable on the phone, code is done):**
- iOS Web Push after Home-Screen install; Slice B background -> push -> resume with the approval
  waiting.
- Cross-repo overview attach and the live terminal mirror against a real `cc` `continuation`
  session (terminal render + plumbing are browser-verified with simulated output only).

## Live / operational context

- **Secret:** the bearer token and VAPID keys live in `bridge/config.json` (gitignored, local
  only, never commit). `config.projectsDir` is set to `/mnt/c/Users/aayus/dev/Projects`.
- **Run + verify through WSL** (Node 22 via nvm; the Windows-side `tsc`/`tsx` fail on POSIX
  symlinks):
  ```bash
  wsl -d Ubuntu -- bash -lc 'source /home/yusha/.nvm/nvm.sh && cd "/mnt/c/Users/aayus/dev/Projects/Continuation Pipeline/bridge" && npm run verify'
  ```
  `npm run dev` serves 127.0.0.1:8790; publish on the tailnet with `tailscale serve --bg
  https / http://127.0.0.1:8790` (from Windows PowerShell). Auto-start: `bridge/scripts/setup-autostart.ps1`.
- **Claude Code is installed and logged in inside WSL** (the SDK and `cc` share that login).

## Build workflow

Per the global CLAUDE.md: orchestrate/delegate implementation to the pipeline (`deepseek` for
modules, `free` for boilerplate) with `--verify`/review, keep design, SDK research, and security
in-session. Each slice gets a spec in `docs/superpowers/specs/` before build. When adding to the
roadmap or gotchas, put durable info in the READMEs and keep this file short.
