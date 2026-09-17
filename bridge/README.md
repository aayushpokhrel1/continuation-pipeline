# Continuation Bridge (Stage 1)

The app path of Continuation Pipeline: a self hosted server that drives Claude Code
through the Claude Agent SDK, with a mobile PWA that starts a session in a chosen
repo, streams the agent's output, and lets you approve or deny each tool from your
phone. It runs inside WSL and is reached over your Tailscale network, no public
exposure.

Stage 1 scope: start a session in a chosen repo, stream output, approve or deny
tools (Ask mode), send follow ups. One session per connection. Session resume, Web
Push, and the auto approve modes come in Stage 2.

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
working directory.

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

## Use it from the phone

1. On the iPhone (already on the tailnet), open Safari to
   `https://<your-host>.<tailnet>.ts.net/`.
2. In the setup dialog, enter that same origin and your token, pick a repo, Connect.
3. Send a message. When the agent wants to use a tool, an approval card appears with
   Allow and Deny. Tap Allow and the result streams back.
4. Share sheet, Add to Home Screen, to install it as an app.

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
src/sdkSource.ts    Agent SDK implementation of SessionSource
src/server.ts       HTTP (health, repos, static) + WebSocket
src/index.ts        entrypoint
public/             the PWA
```

## Notes

- Ask mode only in Stage 1: every permissioned tool prompts the phone. Read the
  approval card before allowing; a denied tool returns "Denied from phone" to the agent.
- One session per WebSocket connection. Reconnecting starts a fresh session.
- The server binds to 127.0.0.1 on purpose; Tailscale `serve` is what exposes it to
  the tailnet, so there is no open port on any other interface.
