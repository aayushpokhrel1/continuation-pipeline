# Handover

State handover for Continuation Pipeline, so a fresh session can resume without
rediscovering everything. Read this, then `docs/app-path-design.md` and the vault note
at `Knowledge-Vault/Projects/Continuation-Pipeline/index.md` (has the gotchas and the
full decision log).

Repo: https://github.com/aayushpokhrel1/continuation-pipeline (public, MIT).
What it is: secure phone to workstation access to Claude Code over a private Tailscale
network. Two layers: a terminal path (SSH + tmux) and a custom mobile bridge.

## Current state (2026-09-17)

| Piece | Status |
|-------|--------|
| Backbone: Tailscale tailnet | Done, live on this machine |
| Terminal path: SSH + tmux + `cc` (Windows/WSL, plus Linux/macOS `setup.sh`) | Done, verified from iPhone (Termius) |
| App path Stage 1: mobile bridge (SDK server + PWA, Ask-mode approvals) | Done, tested, live on the tailnet |
| App path Stage 2 | Not started (see Next) |
| App path Stage 3 | Not started |

Both paths have been driven from a real iPhone. Stage 1 was verified with 13 passing
tests, a clean typecheck, a live SDK smoke test, and the tailnet HTTPS endpoint.

## What works right now

**Terminal path:** from the phone, `ssh aayus@<host>.<tailnet>.ts.net` then `wsl` then
`cc` (attaches a persistent tmux session running Claude Code in WSL). Find the host name
with `tailscale status`.

**App path (the bridge):** the PWA at `https://<host>.<tailnet>.ts.net/` (Tailscale serve
proxies it to the WSL server on 127.0.0.1:8790). Enter the origin + token, pick a repo,
approve tools from the phone. The bearer token lives in `bridge/config.json` (gitignored,
local only, never commit it).

## Running the bridge

Inside WSL (Node 22 was installed via nvm at `/home/yusha/.nvm`):

```bash
. /home/yusha/.nvm/nvm.sh
cd "/mnt/c/Users/aayus/dev/Projects/Continuation Pipeline/bridge"
npm run dev            # serves on 127.0.0.1:8790
npm test               # 13 tests
npm run typecheck
```

Publish on the tailnet (from Windows PowerShell, where the `tailscale` CLI lives; serve is
already enabled on the tailnet):

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" serve --bg http://127.0.0.1:8790
& "C:\Program Files\Tailscale\tailscale.exe" serve status
```

The dev server must stay running for the phone to connect. Auto-start on boot is not set up
yet (a Stage 2 nicety).

## Where things live

```
setup.ps1, setup.sh, scripts/wsl-setup.sh   terminal path setup (Windows / Linux+macOS / WSL)
bridge/                                       the mobile bridge (Stage 1)
  src/                                         server, session, SDK source, protocol, auth, approvals
  public/                                      the PWA
  config.json                                  LOCAL secret (token + repo list), gitignored
  config.example.json                          template
  README.md                                    bridge run instructions
docs/app-path-design.md                        the app-path spec (decisions, SDK facts, staging)
docs/superpowers/plans/2026-09-17-bridge-stage1.md   the Stage 1 implementation plan (9 TDD tasks)
README.md                                      project overview
```

## Environment specifics on this machine

- WSL Ubuntu, user `yusha`. Node 22 via nvm (`. /home/yusha/.nvm/nvm.sh`).
- Claude Code is installed AND logged in inside WSL (the SDK and `cc` both use that login).
- Tailscale is up on the Windows host and serve is enabled for the tailnet.
- The bridge server binds 127.0.0.1; Windows reaches WSL there via WSL2 localhost forwarding.

## Gotchas (full list in the vault note)

- Git Bash to `wsl.exe` mangles shell variables ($HOME comes through empty). Use literal
  paths in `wsl -d Ubuntu -- bash -lc '...'`, or compute vars inside the WSL script.
- `tmux` does not run on native Windows; the persistent session lives in WSL.
- Windows OpenSSH admin keys go in `C:\ProgramData\ssh\administrators_authorized_keys`
  with locked ACLs (setup.ps1 handles it).
- Termius offering multiple keys trips sshd MaxAuthTries ("too many authentication
  failures"); pin one key to the host.
- Node file-URL paths: use `fileURLToPath`, not `.pathname` (this repo dir has a space).
- Agent SDK 0.3.274: `canUseTool(toolName, input, options) => PermissionResult`,
  `{behavior:'allow'|'deny'}`, `session_id` on every message.

## Next (Stage 2, when you resume)

Give the bridge its own brainstorm to spec to plan cycle, then build:
- Session list + resume (`listSessions` + `resume`), so the app shows past sessions.
- Web Push notifications when a tool needs approval or a turn finishes.
- The three approval modes: Ask (done), Auto-safe (`allowedTools`), YOLO (`bypassPermissions`).
- Installable PWA polish, and auto-start the bridge on boot.
Stage 3: multi-repo management, the terminal-session continuation source, inline diffs.

Build workflow used here (per the global CLAUDE.md): delegate implementation to the
pipeline (`deepseek` for modules, `free` for boilerplate) with review, keep design, SDK
research, and security in-session.

## Resuming in a new session

1. Open a session in this repo (CLAUDE.md and the vault note load context).
2. Read this file, `docs/app-path-design.md`, and the Stage 1 plan.
3. Check the bridge still runs (`npm run dev`, `npm test`), then brainstorm Stage 2.
