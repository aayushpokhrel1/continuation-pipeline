# Bridge Stage 2 Slice B: session continuity (design)

Status: SHIPPED 2026-09-18 (server + client verified in-browser; phone confirmation of
background/reconnect pending). Approach 1 (server-side session registry decoupled from the
socket). Real-device testing of Slice A showed that iOS suspends a
backgrounded PWA and kills the WebSocket, so the current one-socket-per-session model
loses the in-flight turn and any pending approval. Slice B makes push actionable: get
pinged, come back, and the turn is still waiting.

## Goals (from brainstorming)
1. Sessions survive a dropped/backgrounded socket. A pending approval waits server-side
   and is re-delivered when the phone reconnects, so you can Allow from the notification.
2. A durable, multi-session list per repo, across server restarts, with history replay
   when you open a session. Backed by the SDK's own on-disk session store (no DB).
3. Auto-reconnect when the app is foregrounded; deep-link from a push into its session.
4. Repo auto-discovery so new projects appear without editing config.

## Non-goals
- Long-lived streaming query (Approach 3). Keep one-query-per-turn with `resume`.
- Inline diffs, multi-repo management, terminal-continuation source (Stage 3).

## Architecture

### Identity model
- New session: client sends `start {repo, mode}`. The server begins the turn on the first
  `user` message. The SDK emits `session_id` early in the stream; the server captures it,
  registers the session in the manager under that id, and emits `ready {sessionId}` so the
  client persists it. (Before the id is known the client is the live socket, so events flow
  normally; the id arrives well before any approval.)
- Existing session: client sends `attach {sessionId, mode}`.

### Components
- **`SessionManager` (new `src/sessionManager.ts`)**: `Map<sessionId, Session>` of live
  sessions that outlive sockets. Methods: `create(repoPath, mode)`, `get(sessionId)`,
  `register(session)` (index once the sdk id is known), `attach(sessionId, emit)` /
  `detach(sessionId)`. Sessions are never evicted for now (process-lifetime; a TODO
  `ponytail:` note: add idle eviction if memory matters).
- **`Session` (refactor `src/session.ts`)**: owns `repoPath`, `mode`, `sdkSessionId?`,
  `ApprovalRegistry`, a settable `emit: (m: ServerMessage) => void` (defaults to a no-op
  when detached), and a `pushNotify: (payload) => void`. `emit` fires `pushNotify` on
  `approval` and `turn_done` regardless of whether a socket is attached. `handleUser(text)`
  runs a turn via `source.send` (resume when `sdkSessionId` is set); on the new
  `{kind:"session", sessionId}` event it sets `sdkSessionId`, asks the manager to register
  it, and emits `ready`. `replayPending()` re-emits any unresolved approvals to the current
  socket (called on attach).
- **`SessionSource` (extend `src/source.ts` + `src/sdkSource.ts`)**: add
  `listSessions(repoPath): Promise<SessionInfo[]>` and
  `getHistory(sessionId, repoPath): Promise<TranscriptEvent[]>`. `SdkSessionSource` wraps the
  SDK `listSessions({dir})` and `getSessionMessages(id, {dir})`, mapping `SDKSessionInfo` to
  `SessionInfo {sessionId, title, lastModified}` (title = customTitle ?? summary ??
  firstPrompt) and `SessionMessage` to the same transcript shape the live stream uses
  (assistant text, tool_use). Also add a `{kind:"session", sessionId}` StreamEvent emitted by
  `send` when it first sees `session_id`.
- **`server.ts`**: connection no longer owns a Session. On each client message it looks up /
  creates the session via the manager and attaches this socket's `emit`. `list` ->
  `source.listSessions` -> `sessions`. `attach` -> get-or-create session (create with the id
  for a historical one), send `history` from `source.getHistory`, then `replayPending`.
  `start` -> `manager.create`. `user`/`approve` -> route to the attached session. On ws
  `close`, `manager.detach` (session stays alive).
- **Push**: `push.notify` payload gains `sessionId`; `sw.js` `notificationclick` opens
  `./?session=<id>`. The Session's `pushNotify` is the manager-provided
  `(sessionId, payload) => push.notify(...)`.
- **Config / repos**: add optional `projectsDir` to Config. `/repos` returns configured
  repos plus, when `projectsDir` is set, every immediate subdirectory that contains a `.git`
  (name = folder name, path = its absolute path). Dedupe by path.

### Protocol (protocol.ts)
Client -> server:
- `{ type: "list"; repo: string }`
- `{ type: "start"; repo: string; mode?: ApprovalMode }`
- `{ type: "attach"; sessionId: string; repo: string; mode?: ApprovalMode }`
- `{ type: "user"; text: string }`
- `{ type: "approve"; id: string; decision: Decision }`

Server -> client:
- `{ type: "sessions"; items: SessionInfo[] }`
- `{ type: "history"; messages: TranscriptEvent[] }`
- `{ type: "ready"; sessionId: string }`
- `{ type: "assistant"; text }` | `{ type: "tool"; name; input }`
  | `{ type: "approval"; id; name; input }` | `{ type: "turn_done" }`
  | `{ type: "error"; message }`

`SessionInfo = { sessionId: string; title: string; lastModified: number }`.
`TranscriptEvent = { role: "user"|"assistant"; text?: string; tool?: string }` (reuse for
history and live; keep minimal).

### Data flow: approve-from-notification
1. Phone sends `user`; backgrounds. iOS kills the socket -> `manager.detach`. The session's
   `emit` becomes no-op but the turn keeps running; `canUseTool` awaits.
2. Agent hits a tool -> `approval` pending in the registry; `pushNotify` fires "Approval
   needed" with the sessionId.
3. Tap push -> app opens `?session=<id>` -> `attach {sessionId}` -> server sends `history`
   then `replayPending` re-emits the approval card.
4. Tap Allow -> `approve` resolves the awaiting promise -> turn continues -> `turn_done` push.

### Error handling
- `attach` to an unknown/expired id: reply `error` and let the client fall back to the list.
- `list`/`getHistory` failures: `error`; client shows the message, stays on the list.
- Bad json / unknown repo: as today.
- Detach while a turn runs: allowed; the turn continues headless (approvals pushed).

### Testing (node:test, per task)
- SessionManager: create/register/get; attach swaps emit; detach keeps the session;
  re-attach replays a pending approval (fake source).
- Session: `{kind:"session"}` event sets id + emits ready; approval survives a detach and
  resolves after re-attach.
- SdkSource: `listSessions` maps SDKSessionInfo -> SessionInfo; `getHistory` maps
  SessionMessage -> TranscriptEvent (fake SDK fns).
- server: `list` returns sessions; `attach` sends history then the pending approval; ws
  close does not drop the session (a later attach still works).
- config/repos: `projectsDir` discovery lists git subdirs and dedupes configured repos.
- Client is browser-verified by hand (session list renders, attach loads history,
  background/return re-attaches, push deep-links).

## Task breakdown (orchestration)
1. **Source: list + history + session event** (deepseek, verify). Extend `source.ts`
   (`SessionInfo`, `TranscriptEvent`, `listSessions`, `getHistory`, `{kind:"session"}`),
   implement in `sdkSource.ts` over the SDK, tests.
2. **SessionManager + Session decouple + server protocol** (deepseek, verify). Depends on 1.
   The registry, refactored Session, new protocol messages and server routing, push
   `pushNotify` wiring, tests.
3. **Repo auto-discovery** (deepseek or free, verify). `config.projectsDir` + `/repos`
   scan, config test.
4. **Client: list/attach/reconnect/deep-link** (in-session, browser-verified). Session-list
   screen, attach + history render, auto-reconnect on `visibilitychange`, `?session=` deep
   link, push `notificationclick` -> `?session=`.
5. **Docs**: design doc status, HANDOVER, bridge README, vault note.

Each delegated task runs with `npm run verify` (WSL) as `--verify` and commits on green;
the orchestrator reviews each diff (security-relevant: none new beyond Slice A, but the
attach path must keep the bearer check).
