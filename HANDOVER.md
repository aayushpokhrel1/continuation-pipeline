# Handover

State handover for Continuation Pipeline, so a fresh session can resume without
rediscovering everything. Read this, then `docs/app-path-design.md` and the vault note
at `Knowledge-Vault/Projects/Continuation-Pipeline/index.md` (has the gotchas and the
full decision log).

Repo: https://github.com/aayushpokhrel1/continuation-pipeline (public, MIT).
What it is: secure phone to workstation access to Claude Code over a private Tailscale
network. Two layers: a terminal path (SSH + tmux) and a custom mobile bridge.

## Current state (2026-09-18)

| Piece | Status |
|-------|--------|
| Backbone: Tailscale tailnet | Done, live on this machine |
| Terminal path: SSH + tmux + `cc` (Windows/WSL, plus Linux/macOS `setup.sh`) | Done, verified from iPhone (Termius) |
| App path Stage 1: mobile bridge (SDK server + PWA, Ask-mode approvals) | Done, tested, live on the tailnet |
| App path Stage 2, Slice A: approval modes (Ask/Auto-safe/YOLO) + Web Push | Done; phone push confirmed (turn-finished). Approving-while-away needed Slice B |
| App path Stage 2, Slice B: session continuity (registry, list+history, reconnect, deep-link, repo auto-discovery) | Done, server+client verified in-browser; phone background/reconnect pending a real-device test |
| App path Stage 2, Slice C: PWA polish (icons, offline shell) + auto-start on boot | Done; run bridge/scripts/setup-autostart.ps1 once to enable logon auto-start |
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

## Slice A (shipped 2026-09-18): approval modes + Web Push

- **Approval modes** are per session, chosen in the `start` message: `ask` (default,
  `canUseTool` routes all), `auto-safe` (`allowedTools: ['Read','Glob','Grep']` auto-approve,
  rest prompt), `yolo` (`bypassPermissions`, no `canUseTool`). Mapped in `sdkSource.ts`.
- **Web Push:** VAPID keys live in `config.json` (gitignored) and were generated on this
  machine already. `GET /vapid` serves the public key (bearer-auth); `POST /subscribe` stores
  the phone's subscription in a gitignored `subscriptions.json`; the server pushes on
  approval-needed and turn-finished. Client subscribes from the Connect tap. Uses `web-push`.
- **Still to verify:** open the PWA on the iPhone (must be added to the Home Screen for iOS
  Web Push), Connect, grant the notification prompt, then background it and trigger an
  approval or finish a turn to confirm the push arrives. Server side is smoke-verified
  (`/health`, `/vapid` 200 with token / 401 without, `/subscribe` 400 on bad JSON).

## Slice B (shipped 2026-09-18): session continuity

Design: `docs/superpowers/specs/2026-09-18-bridge-slice-b-design.md`. Approach 1: a
`SessionManager` (`src/sessionManager.ts`) holds sessions keyed by SDK session id that
outlive the WebSocket. `Session` (`src/session.ts`) is now attach/detach-able and fires
pushes even when detached, so a pending approval waits server-side and `replayPending()`
re-delivers it on reconnect. New protocol: `list`/`start`/`attach` from the client;
`sessions`/`history`/`ready` from the server. Durable list + history come from the SDK's
on-disk store (`listSessions({dir})` / `getSessionMessages(id,{dir})`, wrapped in
`sdkSource.ts`). Client shows a per-repo session list, replays history on attach,
auto-reconnects on `visibilitychange`, and deep-links from a push via `?session=<id>` (the
SW puts the id in the notification and navigates to it). Repo auto-discovery: set
`config.projectsDir` and `/repos` lists every git repo under it (already set locally to
`/mnt/c/Users/aayus/dev/Projects`, so 15 repos show up).

Verified in-browser against the live server: durable list, attach + history replay, new
session, deep-link. **Pending on a real phone:** background the app during a turn, get the
push, tap it, and confirm you land back in that session with the approval waiting (the
whole point). Auto-reconnect-on-foreground is code-verified but not phone-tested.

## Slice C (shipped 2026-09-18): PWA polish + auto-start

- Icons: `bridge/public/icon.svg` (lettermark) + `icon-180.png` (iOS apple-touch), wired into
  the manifest (`any maskable`) and `<link rel="apple-touch-icon">` + `theme-color`. To
  regenerate PNGs from the SVG there is no local converter; the SVG was rasterized via the
  in-app browser canvas (`fetch('/icon.svg')` -> Image -> canvas -> toDataURL). Server MIME map
  now includes `.svg`/`.png`.
- Offline shell: `sw.js` caches the shell and serves it **network-first** (fresh online,
  available offline, and this also fixes the "reload to get the new client" staleness), while
  bypassing `/ws /repos /vapid /subscribe /health`.
- Auto-start: `bridge/scripts/start-bridge.sh` (portable, idempotent) + `setup-autostart.ps1`
  registers a logon Scheduled Task `ContinuationBridge`. NOT auto-registered by Claude (it's a
  standing machine change); run the .ps1 once to enable.

## Next: Stage 3

Multi-repo management, the terminal-session continuation source (PTY hybrid), inline diff
viewing. Stage 2 (Slices A/B/C) is complete.

Build workflow: Slices A and B were built with `/orchestrate` (deepseek for the modules,
inline for the untestable/browser-verified client), each task verify+commit through the WSL
`npm run verify`. For the client, the design was written as near-final code in the brief and
verified live in the in-app browser.

Build workflow used here (per the global CLAUDE.md): delegate implementation to the
pipeline (`deepseek` for modules, `free` for boilerplate) with review, keep design, SDK
research, and security in-session.

## Resuming in a new session

1. Open a session in this repo (CLAUDE.md and the vault note load context).
2. Read this file, `docs/app-path-design.md`, and the Stage 1 plan.
3. Check the bridge still runs (`npm run dev`, `npm test`), then brainstorm Stage 2.
