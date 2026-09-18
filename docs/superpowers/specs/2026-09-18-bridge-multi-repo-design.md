# Bridge Stage 3: multi-repo management (design)

Date: 2026-09-18. Status: approved, ready to build.

## Goal

From the phone, see and reach Claude Code sessions across every repo at once, switch repo
without re-entering the setup dialog, and see which repos have recent or in-flight activity.
A daily-driver navigation upgrade, not a new session engine.

## What already exists (Slice B), so is NOT rebuilt

- `SessionManager` (`src/sessionManager.ts`) holds every `Session` live, keyed by SDK session
  id, outliving the WebSocket and independent of repo.
- Detached sessions still fire Web Push on approval-needed and turn-finished, in any repo. So
  cross-repo notification already works; a waiting agent in repo B notifies you while you are
  viewing repo A.
- `discoverRepos(config)` (`src/repos.ts`) returns `RepoRef {name, path}` from `config.repos`
  plus git subdirs of `config.projectsDir`. `GET /repos` serves them.
- `source.listSessions(repoPath)` reads the SDK on-disk store for one repo; `list {repo}` /
  `sessions {items, archived}` is the per-repo protocol; `attach {sessionId, repo}` and
  `archive`/`unarchive` already carry the repo.

The missing piece is entirely on the read/navigation side: the client can only view one
repo's list at a time and has no cross-repo overview or lightweight switch.

## Approach (chosen)

Unified "All repos" view plus an inline repo switcher, built on one new protocol pair.
Eager aggregation: the server scans all repos on request. These calls are user-triggered and
infrequent, so a naive per-repo scan is fine (matches the existing `discoverRepos` posture).

Rejected: keeping per-repo-only lists (misses the top-ranked "see every waiting agent at
once" win); full concurrent multi-attach / split-screen viewing (YAGNI on a phone).

## Server

New `src/overview.ts`:

```ts
export interface OverviewSession extends SessionInfo { repo: string; repoPath: string; }
export interface OverviewRepo { name: string; path: string; lastModified: number; live: boolean; }
export interface Overview { items: OverviewSession[]; repos: OverviewRepo[]; }

// Minimal surface the overview needs, satisfied by SessionManager.
export interface OverviewManager {
  listSessions(repoPath: string, archived?: boolean): Promise<SessionInfo[]>;
  liveRepoPaths(): Set<string>;
}

export async function buildOverview(config: Config, manager: OverviewManager): Promise<Overview>;
```

Build on `SessionManager`, not the raw source, so archive filtering and the archive store stay
consistent with the per-repo `list` flow.

Behavior:
- Compute `const live = manager.liveRepoPaths()` once.
- For each `RepoRef` from `discoverRepos(config)`, call `manager.listSessions(repo.path, false)`
  inside a try/catch (a throwing repo yields `[]`, never fatal). Tag each `SessionInfo` with
  `repo: name, repoPath: path`.
- `items`: all tagged sessions merged, sorted by `lastModified` descending.
- `repos`: one entry per repo, `lastModified` = max session `lastModified` for that repo (0 if
  none), `live` = `live.has(repo.path)`, sorted by `live` first (true before false) then
  `lastModified` descending.
- Overview shows ACTIVE sessions only (`archived=false`); per-repo archived browsing stays in
  the existing `list` flow.

New `SessionManager` accessor (`src/sessionManager.ts`): `liveRepoPaths(): Set<string>` returns
`new Set([...this.sessions.values()].map((s) => s.repoPath))`. `Session.repoPath` is already a
public readonly field.

Protocol (`src/protocol.ts`):
- Client: `{ type: "listAll" }`.
- Server: `{ type: "sessionsAll"; items: OverviewSession[]; repos: OverviewRepo[] }`.
- `attach` / `archive` / `unarchive` unchanged.

`src/server.ts` `createServer`: add a `listAll` branch mirroring the `list` handler's
promise-then/catch shape: `buildOverview(config, manager).then((ov) => emit({ type:
"sessionsAll", items: ov.items, repos: ov.repos })).catch(...)`.

## Client (`public/app.js`, `public/styles.css`)

- The Sessions dialog gains a repo switcher row at the top: an "All repos" entry plus each
  repo from the last `sessionsAll`/`repos` payload, recency-sorted, each with a live-dot when
  `live`. Selecting "All repos" sends `listAll`; selecting a specific repo sends the existing
  `list {repo}` and sets `state.repo`.
- This replaces the current heavy "Change repo" button (which closes the dialog and reopens
  the full setup dialog). Changing the server origin/token still lives in setup, reachable
  from the status gear as today.
- In "All repos" mode each session row shows a small repo chip/label. Tapping a row sets
  `state.repo` to that row's `repoPath`, then attaches (existing `attachSession`, which already
  sends `{sessionId, repo}`).
- Per-repo rows and the archive/unarchive buttons are unchanged.
- New session: `start` still uses `state.repo`. In "All repos" browse mode there is no single
  repo, so "+ New session" first prompts to pick a repo (switch to that repo's view, then the
  existing new-session flow). Keep this minimal: if `state.repo` is empty in all-mode, the new
  button just switches the picker focus to a repo instead of starting.
- Refresh on dialog open and on foreground is enough; no live socket push of overview updates.

## Error handling

- A repo whose `listSessions` throws (unreadable store) is skipped with `[]`, never fails the
  whole overview (wrap per-repo in try/catch).
- Empty overview renders an empty-state line, same pattern as the current per-repo empty list.

## Testing

- `src/overview.test.ts` (node:test, mirrors existing tests): with a fake `SessionSource`
  whose `listSessions` returns different sets per repo path and a fake `discoverRepos` config,
  assert: items merged and sorted by `lastModified` desc with correct `repo`/`repoPath` tags;
  `repos` carry correct max `lastModified` and `live` from the injected `isLive`; a throwing
  repo is skipped, not fatal; a source without `listSessions` yields empty.
- `src/server.test.ts`: a `listAll` client message yields a `sessionsAll` reply (extend the
  existing server test harness).
- Client is browser-verified against the live server (unified list renders, repo switch
  re-lists over the open socket, repo chips + live-dot show, attach from all-mode lands in the
  right repo), same as the inline-diff slice.

## Deferred (YAGNI)

Split-screen concurrent viewing; live push of overview changes; per-repo unread badges;
archived sessions in the cross-repo view. Add when the overview feels stale or cramped in
real use.

## Build routing (orchestration)

- `overview.ts` + test and the protocol/server wiring: deepseek, `--verify` via WSL
  `npm run verify`, review the diff, commit. (The delegate `--verify` runs on Windows/cmd and
  cannot run the bridge's WSL-symlinked `tsc`/`tsx`; verify + commit through WSL manually, per
  the HANDOVER gotcha.)
- Client `app.js` + `styles.css`: inline, browser-verified.
