# Bridge Stage 3: terminal continuation (PTY hybrid) — design

Date: 2026-09-19. Status: approved, ready to build. This is approach C from
`docs/app-path-design.md`: attach the phone to the live `claude` terminal session.

## Goal

From the phone, mirror and drive the SAME live tmux session the terminal path already runs,
so the phone is a true continuation of the desktop `cc` session (shared state, live in both
places), not a separate agent. Approvals happen in the TUI, exactly as on the desktop.

## Mechanism (node-pty-free)

The terminal path runs `cc() { tmux new -A -s continuation 'claude'; }` (`setup.sh`,
`scripts/wsl-setup.sh`), so the persistent session is tmux **`continuation`**.

- **Attach, never create.** The bridge attaches to an existing tmux session; it never creates
  one. tmux session creation needs a controlling TTY the long-lived bridge process does not
  have (verified: `tmux new-session` under a non-TTY WSL invocation fails "open terminal
  failed"). If `continuation` is not running, the phone shows "run `cc` on the workstation
  first." This is also the correct product behavior for "continue MY session."
- **Stream via `script`.** The bridge spawns `script -qfc "tmux attach -t <name>" /dev/null`
  as a child process. `script(1)` (util-linux, present at `/usr/bin/script`) allocates a real
  PTY, so `tmux attach` runs as a genuine terminal client. The child's **stdout is the faithful
  terminal mirror** (full-screen TUI and all), and the child's **stdin is keystrokes**. No
  `node-pty` native build. Multiple tmux clients share one session, so phone and desktop mirror
  each other live.

Rejected: `node-pty` (native build in WSL is the problem we are avoiding); `pipe-pane` +
`send-keys` + `capture-pane` (would require reassembling screen state and translating every key
by hand; a real attach renders the TUI faithfully for free).

## Server

New `src/terminal.ts`, dependency-injectable `spawn` for testing:

```ts
import { spawn as nodeSpawn, type SpawnFn } from "node:child_process"; // SpawnFn = typeof spawn

export interface TermHandle { write(data: string): void; resize(cols: number, rows: number): void; kill(): void; }

// name is validated by the caller; attachTerminal ALSO guards the charset before building the
// shell string for `script -c`.
export function attachTerminal(
  name: string,
  onData: (data: string) => void,
  onExit: () => void,
  spawnFn?: typeof nodeSpawn,
): TermHandle;

export function listTerminals(spawnFn?: typeof nodeSpawn): Promise<string[]>;
```

- `attachTerminal`: reject names not matching `^[A-Za-z0-9_.-]+$` (throw). Spawn
  `spawnFn("script", ["-qfc", `tmux attach -t ${name}`, "/dev/null"], { env: { ...process.env,
  TERM: "xterm-256color" } })`. Pipe `child.stdout` and `child.stderr` (utf8) to `onData`;
  `child.on("exit", onExit)`. `write` -> `child.stdin.write(data)`. `resize(cols, rows)` ->
  `nodeSpawn("tmux", ["resize-window", "-t", name, "-x", String(cols), "-y", String(rows)])`
  (best-effort). `kill` -> `child.kill()`.
  `ponytail:` resize via `tmux resize-window` may fight a desktop client's size (smallest-client
  rule); set `window-size manual` if it matters in practice.
- `listTerminals`: run `tmux list-sessions -F "#{session_name}"`, resolve trimmed non-empty
  lines; resolve `[]` on non-zero exit / "no server running".

### Trust boundary

`name` reaches a shell string (`script -c "tmux attach -t <name>"`). It comes from an
authenticated client, but validate anyway: the `^[A-Za-z0-9_.-]+$` guard in `attachTerminal`
is mandatory (do not remove), and `server.ts` only attaches to a name returned by
`listTerminals` (allowlist). Belt and suspenders — this is a command-injection surface.

Overall this channel is a remote terminal into the workstation with full shell power and no
structured approval gate, behind the existing perimeter (bearer token + Tailscale,
user-initiated). Same trust boundary as the SSH terminal path. Documented in the README; no new
capability beyond what `cc` over SSH already grants.

## Protocol (`src/protocol.ts`)

- Client: `{ type: "termList" }`, `{ type: "termAttach"; name: string }`,
  `{ type: "termInput"; data: string }`, `{ type: "termResize"; cols: number; rows: number }`,
  `{ type: "termDetach" }`.
- Server: `{ type: "terms"; names: string[] }`, `{ type: "termOut"; data: string }`,
  `{ type: "termExit" }`.

## Server wiring (`src/server.ts`)

Per ws connection, keep `let term: TermHandle | undefined` alongside `current`. Handle:
- `termList` -> `listTerminals()` then `emit({ type: "terms", names })` (catch -> error).
- `termAttach` -> validate `name` is in `await listTerminals()`; if not, `emit({ type: "error",
  message: "no such terminal" })`. Else `term?.kill(); term = attachTerminal(name, (data) =>
  emit({ type: "termOut", data }), () => { emit({ type: "termExit" }); term = undefined; })`.
- `termInput` -> `term?.write(msg.data)`.
- `termResize` -> `term?.resize(msg.cols, msg.rows)`.
- `termDetach` -> `term?.kill(); term = undefined;`.
- `ws.on("close")` also `term?.kill()`.

## Client

- **xterm.js vendored locally** (offline-first PWA, no bundler): add `@xterm/xterm` as a bridge
  dependency and copy its `xterm.js` + `xterm.css` (and the `@xterm/addon-fit` fit addon) into
  `public/vendor/`. Reference them from `index.html`. The service worker's offline-shell cache
  list gains the vendor files. (Hand-rolling a terminal emulator is the over-engineering we
  avoid; xterm.js is the boring correct tool.)
- A "Terminal" button (in the sessions dialog). On tap: `send({ type: "termList" })`; if
  `continuation` is present attach it directly, else if several show a quick pick, else show
  "run cc first". On attach, reveal a full-pane `<div id="term">`, `new Terminal()` + FitAddon,
  `term.open(el)`, `fit()`. Wire `term.onData(d => send({ type: "termInput", data: d }))`,
  `term.onResize(({cols, rows}) => send({ type: "termResize", cols, rows }))`, and on
  `handleServer`: `termOut -> term.write(data)`, `termExit -> tear down + return to chat/list`.
  Send an initial `termResize` after `fit()`. A "back" control detaches (`termDetach`) and hides
  the terminal pane.

## Testing

- `src/terminal.test.ts` (node:test): inject a fake `spawnFn` returning a stub child
  (EventEmitter-ish with `stdout`/`stderr` emitters, a `stdin` recording writes, `kill`, and
  `on("exit")`). Assert: `attachTerminal` rejects a bad name (`"a; rm -rf"`); on good name it
  spawns `script` with the expected argv; child stdout data reaches `onData`; `write` reaches
  `child.stdin`; child `exit` fires `onExit`; `kill` calls `child.kill`. For `listTerminals`,
  inject a fake spawn whose stdout yields two names and assert they parse; a non-zero exit
  yields `[]`.
- `src/server.test.ts`: a `termList` message replies `terms` (with a fake source; the terminal
  handlers can be exercised with an injected/monkeypatched terminal module if practical, else
  cover `termList` only and leave attach to manual verification).
- Client + full TUI fidelity: browser-verified for xterm render + plumbing; the true mirror of
  the live `claude` TUI is confirmed by the user against the real `continuation` session on a
  real device (like the other phone-side checks).

## Scope (YAGNI)

MVP: attach to `continuation` (list others if present), stream, type, resize, detach on close.
**Deferred:** creating sessions from the phone, multiple concurrent terminals, copy-mode /
scrollback UI, mouse reporting, reconnect-with-replay of terminal scrollback. Add when needed.

## Routing (orchestration)

- `src/terminal.ts` + test, protocol, `server.ts` wiring: deepseek, verify via WSL
  `npm run verify`, review, commit.
- Vendor xterm.js (`npm i` + copy dist) and the client terminal view + SW cache entry: inline
  (dependency + browser-verified visual integration).
