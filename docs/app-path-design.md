# App path: custom mobile bridge (design notes)

Status: in progress. The terminal path (SSH + tmux) ships today and does not
depend on any of this. These notes capture the design so it is not re-derived.

## Goal

Drive Claude Code on the workstation from a phone with an app-like experience:
readable chat, one-tap tool approvals, and a push notification when the agent
needs a decision or finishes. Sessions run locally on the workstation, so they
keep full local file access, same as the terminal path.

## Why custom, not an existing wrapper

Wrappers exist (Happy, omnara, claude-code-webui). Building it is the point here:
the value is a defensible full-stack + systems + security project, and control
over the tool-approval UX. The trade is more work and more upkeep; accepted.

## Shape

```
phone PWA  <--- websocket over Tailscale HTTPS --->  bridge server (workstation)
                                                          |
                                                     Claude Agent SDK
                                                          |
                                                     claude, spawned in the chosen repo
```

- **Server** (TypeScript, Node inside WSL): drives Claude Code through the
  Claude Agent SDK in headless streaming mode. Manages sessions (one per chosen
  cwd), streams assistant messages / tool calls / approval prompts, relays user
  messages and approve/deny decisions back.
- **Client** (PWA): session list, repo picker, chat view, tool-approval buttons,
  Web Push. Installable to the home screen.
- **Exposure**: bound to the Tailscale interface only, bearer token, HTTPS via
  `tailscale serve`. Same perimeter as the terminal path.

## Confirmed decisions (2026-09-17)

- **Purpose:** both a real daily driver and a portfolio showpiece, built in stages
  so each stage is genuinely usable.
- **Hosting:** Node **inside WSL**, reusing the `claude` login already set up there
  (the SDK authenticates via the local `claude` session, not an API key) and matching
  the terminal path's environment. Repos are reached at `/mnt/c/...` paths.
- **Reuses what exists:** Tailscale is the shared transport (the bridge binds only to
  the tailnet, the phone reaches it over the same tailnet). Termius / OpenSSH stay the
  separate terminal path and are not involved in the bridge. The WSL `claude` login is
  shared by both `cc` and the bridge.
- **Session model:** the app manages its OWN sessions (start in a chosen repo, resume
  by session id). Continuing the live terminal `cc` session is a FUTURE option, so
  session sourcing sits behind a `SessionSource` interface (see approaches).

## Approaches (session sourcing)

- **A. One `query()` per turn + `resume` (chosen for Stage 1).** Each phone message
  runs `query({ resume: sessionId, cwd })`; `canUseTool` handles approvals in the turn.
  Simple, robust, maps directly onto resume.
- **B. Long-lived streaming `query()`** (feed an `AsyncIterable` of user messages into
  one running agent). Lower latency, more lifecycle complexity. Later optimization.
- **C. PTY / terminal-stream hybrid** (stream a real `claude` TUI). This is the
  "continue my terminal session" future feature. Kept as the reason session sourcing
  is behind an interface, not built now.

## Agent SDK facts (verified from code.claude.com/docs/en/agent-sdk/typescript)

- `query({ prompt, options })` returns an async generator of messages (assistant text
  blocks and `tool_use` events). `prompt` may be a string or `AsyncIterable<SDKUserMessage>`.
- `canUseTool?: (request, { signal }) => Promise<CanUseToolResult>` is an **async**
  permission callback, invoked only when a tool needs a prompt. This is the hook the
  phone approval flow awaits. Confirm the exact `CanUseToolResult` shape at build time
  (docs show `{ approved: true }`; some SDK versions use `{ behavior: 'allow' | 'deny' }`).
- Resume: `resume: sessionId`, `continue: true`, `forkSession: boolean`. History:
  `listSessions({ dir, limit })`, `getSessionMessages()`.
- `cwd: string` selects the repo. `permissionMode: 'default' | 'plan' | 'bypassPermissions'`.
- Auth: the SDK spawns the `claude` binary and uses its local login; pass env via `env`,
  or point at a specific binary with `pathToClaudeCodeExecutable`.

## Tool-approval modes (client-selectable per session)

- **Ask** (Stage 1): `permissionMode: 'default'`, every permissioned tool routes through
  `canUseTool` to the phone for allow/deny.
- **Auto-safe** (Stage 2): `allowedTools` auto-approves read-only tools; writes/bash prompt.
- **YOLO** (Stage 2): `permissionMode: 'bypassPermissions'` for a trusted run.

## Stages

- **Stage 1 (MVP, this plan):** start a session in a chosen repo, stream output, approve
  or deny tools from the phone, send follow-ups. Bearer token, over Tailscale. Ask mode only.
- **Stage 2:** session list + resume, Web Push, the three approval modes, installable PWA polish.
- **Stage 3:** multi-repo management, terminal-continuation source (C), inline diff viewing.
