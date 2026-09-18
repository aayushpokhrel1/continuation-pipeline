# Continuation Bridge

The app path of Continuation Pipeline: a self hosted server that drives Claude Code
through the Claude Agent SDK, with a mobile PWA that starts a session in a chosen
repo, streams the agent's output, and lets you approve or deny each tool from your
phone. It runs inside WSL and is reached over your Tailscale network, no public
exposure.

Shipped: pick a repo (configured or auto-discovered), see a durable list of that repo's
past sessions, open one (with its history) or start a new one, stream output, approve or
deny tools, pick an approval mode (Ask / Auto-safe / YOLO), and get a Web Push notification
when a tool needs approval or a turn finishes. Sessions live in a server-side registry that
outlives the socket, so a pending approval waits while the phone is backgrounded and is
re-delivered on reconnect; the app auto-reconnects when foregrounded and a push deep-links
into its session. PWA polish and auto-start on boot come next (Slice C).

## Prerequisites

- WSL Ubuntu with Node 22 (this repo used nvm: `. ~/.nvm/nvm.sh && nvm install 22`).
- Claude Code logged in inside WSL (`claude` once, then the browser login). The SDK
  authenticates through that local login, there is no API key.
- Tailscale on the workstation and the phone, on the same account (the terminal path
  already sets this up).

## Setup

```bash
cd bridge
npm install
cp config.example.json config.json
# edit config.json: set a long random token and your repo list (WSL /mnt/c paths)
```

`config.json` holds your bearer token and is gitignored. Never commit it. Each repo
is `{ "name": "...", "path": "/mnt/c/..." }`; the agent runs with that path as its
working directory. Optionally set `"projectsDir": "/mnt/c/.../Projects"` and every git repo
directly under it is offered too (configured repos win on a path clash), so new projects
appear without editing config.

### Web Push (optional)

To enable phone notifications, add a `vapid` block to `config.json`:

```bash
npx web-push generate-vapid-keys   # prints a public and private key
```

```json
"vapid": {
  "subject": "mailto:you@example.com",
  "publicKey": "<the public key>",
  "privateKey": "<the private key>"
}
```

The private key is a secret and stays in `config.json` (gitignored); it is never sent
to the phone or logged. Without a `vapid` block the bridge still runs, just without
push (the `/vapid` and `/subscribe` endpoints return 404). Phone subscriptions are
stored in `subscriptions.json` (also gitignored). On iOS, Web Push only works once the
PWA is added to the Home Screen.

## Run

```bash
npm run dev        # starts the server on 127.0.0.1:<port> (default 8790)
```

Then publish it on your tailnet over HTTPS (from Windows PowerShell, where the
`tailscale` CLI lives; WSL and the host share 127.0.0.1 via WSL2 localhost forwarding):

```powershell
tailscale serve --bg https / http://127.0.0.1:8790
tailscale serve status
```

This serves the bridge at `https://<your-host>.<tailnet>.ts.net/` on the tailnet
only, with a real certificate. Nothing is exposed to the public internet.

## Auto-start on boot (Windows)

So the bridge is always up (no hand-starting), register a logon Scheduled Task that runs it
in WSL. From PowerShell (no admin needed):

```powershell
.\bridge\scripts\setup-autostart.ps1
```

It runs `bridge/scripts/start-bridge.sh` (idempotent: it no-ops if the bridge is already up)
at each logon. It first tries a Scheduled Task named `ContinuationBridge`; if the machine
blocks user task creation (Access denied / HRESULT 0x80070005, common on locked-down setups),
it falls back automatically to a hidden launcher in your Startup folder
(`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ContinuationBridge.vbs`) which needs
no special rights. The script prints which one it used and how to remove it:

- Scheduled Task: start now `Start-ScheduledTask -TaskName ContinuationBridge`; remove
  `Unregister-ScheduledTask -TaskName ContinuationBridge -Confirm:$false`.
- Startup launcher: start now `wscript "<path printed by the script>"`; remove
  `Remove-Item "<that path>"`.

Tailscale `serve` is already persistent (`--bg`), so nothing else is needed after a reboot.
`start-bridge.sh` also works on its own on Linux/macOS if you want a login-item / systemd unit
there.

## Use it from the phone

1. On the iPhone (already on the tailnet), open Safari to
   `https://<your-host>.<tailnet>.ts.net/`.
2. In the setup dialog, enter that same origin and your token, pick a repo and an
   approval mode (Ask / Auto-safe / YOLO), Connect. If Web Push is configured, you get
   a notification-permission prompt on Connect; allow it to receive pushes.
3. You land on the repo's session list: tap a past session to reopen it (its history
   loads), or "+ New session" to start fresh. Tap "Sessions" in the header any time to
   reopen the list and switch sessions without reconnecting; "Show archived" toggles the
   archived view; each row has Archive / Unarchive (soft, reversible, kept on disk). Tap
   the status (gear) to change repo/mode/token.
4. Send a message. In Ask mode, when the agent wants a tool an approval card appears
   with Allow and Deny; tap Allow and the result streams back. Auto-safe auto-approves
   read-only tools (Read/Glob/Grep) and prompts for the rest; YOLO runs everything
   without prompting.
5. Share sheet, Add to Home Screen, to install it as an app (required for iOS push).
   Backgrounding closes the socket; when you reopen (or tap a push) the app reconnects
   and drops you back into the session, with any pending approval waiting.

## Test and typecheck

```bash
npm test           # node:test suite via tsx
npm run typecheck  # tsc --noEmit
```

## Layout

```
src/config.ts       load and validate config.json
src/auth.ts         constant time bearer token check
src/approvals.ts    async approval registry (allow/deny promises)
src/protocol.ts     WebSocket message types (client <-> server)
src/source.ts       SessionSource interface (the seam for Stage 2/3 sources)
src/session.ts      one turn: source + approvals + streamed events
src/sdkSource.ts    Agent SDK impl of SessionSource (approval mode -> SDK options; listSessions/getHistory)
src/session.ts      one session: attach/detach-able, owns approvals, survives socket loss
src/sessionManager.ts  registry of live sessions keyed by SDK session id (outlives connections)
src/repos.ts        configured repos + auto-discovered git repos under projectsDir
src/push.ts         Web Push: VAPID send + subscription store (PushLike seam)
src/server.ts       HTTP (health, repos, vapid, subscribe, static) + WebSocket (list/start/attach/user/approve)
src/index.ts        entrypoint
public/             the PWA (session list, attach + history, reconnect; sw.js push + deep-link)
```

## Notes

- Approval modes are per session: Ask (every permissioned tool prompts the phone),
  Auto-safe (`allowedTools` auto-approves Read/Glob/Grep, the rest prompt), YOLO
  (`bypassPermissions`, nothing prompts). A denied tool returns "Denied from phone".
  YOLO runs any tool the agent picks without asking; only use it on a trusted run.
- Sessions live in a server-side registry, not the socket: backgrounding the phone (which
  iOS uses to kill the WebSocket) does not lose the turn. On reconnect the app re-attaches
  and any pending approval is re-sent. Sessions are kept for the process lifetime (no idle
  eviction yet).
- The server binds to 127.0.0.1 on purpose; Tailscale `serve` is what exposes it to
  the tailnet, so there is no open port on any other interface.
