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

- **Server** (TypeScript, native Windows Node): drives Claude Code through the
  Claude Agent SDK in headless streaming mode. Manages sessions (one per chosen
  cwd), streams assistant messages / tool calls / approval prompts, relays user
  messages and approve/deny decisions back.
- **Client** (PWA): session list, repo picker, chat view, tool-approval buttons,
  Web Push. Installable to the home screen.
- **Exposure**: bound to the Tailscale interface only, bearer token, HTTPS via
  `tailscale cert` / `tailscale serve`. Same perimeter as the terminal path.

## Open questions to resolve before its own spec

- Exact Agent SDK surface for remote tool approval (can approve/deny be driven
  programmatically per tool call, or does it need a permission-prompt hook?).
  Verify against the SDK docs before committing the protocol.
- Session persistence across bridge restarts (resume vs fresh).
- Multi-repo session management and cwd selection UX.

This gets its own brainstorm -> spec -> plan cycle when the terminal path has
been used enough to know what the phone UX actually needs.
