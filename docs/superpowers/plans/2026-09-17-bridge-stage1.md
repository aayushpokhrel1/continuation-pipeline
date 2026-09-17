# Mobile Bridge Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From an iPhone PWA, start a Claude Code session in a chosen repo on the workstation, stream its output, approve or deny each tool call, and send follow-up messages, all over the existing Tailscale network behind a bearer token.

**Architecture:** A TypeScript Node server runs inside WSL and drives Claude Code through the Claude Agent SDK (`query()` per turn, `resume` by session id). The server exposes a small REST surface and a WebSocket that streams assistant text and `tool_use` events to a vanilla PWA and relays the user's allow/deny decisions back through the SDK's async `canUseTool` callback. Session sourcing sits behind a `SessionSource` interface so later stages (long-lived streaming, terminal continuation) slot in without a rewrite.

**Tech Stack:** Node 22+ (via nvm, no sudo), TypeScript, `@anthropic-ai/claude-agent-sdk`, `ws`, Node built-in `node:test` runner (run through `tsx`). Vanilla HTML/CSS/JS for the PWA. Tailscale `serve` for HTTPS.

**Spec:** `docs/app-path-design.md` (App path design, Stage 1 section and Agent SDK facts).

## Global Constraints

- **No em dashes or en dashes** anywhere (code, comments, docs, commit messages). Use commas, colons, parentheses, or two sentences.
- **Hosting is WSL.** All commands run inside WSL Ubuntu. Repo paths are `/mnt/c/...`. The bridge lives in the repo at `bridge/`.
- **Auth for the SDK is the local `claude` login** already set up in WSL. Never add an API key path.
- **Secrets never committed.** The real `bridge/config.json` (holds the bearer token) is gitignored; only `bridge/config.example.json` is committed.
- **Node 22+** (the Agent SDK npm package requires Node 22+).
- **Keep dependencies minimal** (ponytail): only `@anthropic-ai/claude-agent-sdk` and `ws` as runtime deps; `typescript`, `tsx`, `@types/node`, `@types/ws` as dev deps. No web framework, no test framework.
- **One active session per WebSocket connection** in Stage 1. Multi-session management is Stage 2/3.
- **Approval mode is Ask only** in Stage 1 (`permissionMode: 'default'`, every permissioned tool routes to the phone). Auto-safe and YOLO are Stage 2.

---

### Task 1: WSL Node toolchain and bridge scaffold with config loader

**Files:**
- Create: `bridge/package.json`
- Create: `bridge/tsconfig.json`
- Create: `bridge/config.example.json`
- Create: `bridge/src/config.ts`
- Create: `bridge/src/config.test.ts`
- Modify: `.gitignore` (add `bridge/config.json`, `bridge/node_modules/`, `bridge/dist/`)

**Interfaces:**
- Produces: `loadConfig(path: string): Config` where
  `Config = { port: number; token: string; repos: RepoRef[] }` and
  `RepoRef = { name: string; path: string }`. Throws `Error` on missing file, invalid JSON, missing/empty `token`, or empty `repos`.

- [ ] **Step 1: Install Node 22 in WSL (no sudo, via nvm)**

Run:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 22
node --version   # expect v22.x
```

- [ ] **Step 2: Scaffold the package**

Create `bridge/package.json`:
```json
{
  "name": "continuation-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --import tsx --test \"src/**/*.test.ts\"",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

Create `bridge/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src"]
}
```

Then run in `bridge/`:
```bash
cd bridge && npm install
```

(If `@anthropic-ai/claude-agent-sdk` resolves to a newer major, pin the version that matches the SDK facts in the spec and note it in the commit.)

- [ ] **Step 3: Write the failing test**

Create `bridge/src/config.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";

function writeTmp(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

test("loads a valid config", () => {
  const p = writeTmp({ port: 8790, token: "secret", repos: [{ name: "a", path: "/mnt/c/a" }] });
  const cfg = loadConfig(p);
  assert.equal(cfg.port, 8790);
  assert.equal(cfg.token, "secret");
  assert.deepEqual(cfg.repos, [{ name: "a", path: "/mnt/c/a" }]);
});

test("rejects an empty token", () => {
  const p = writeTmp({ port: 8790, token: "", repos: [{ name: "a", path: "/mnt/c/a" }] });
  assert.throws(() => loadConfig(p), /token/);
});

test("rejects empty repos", () => {
  const p = writeTmp({ port: 8790, token: "secret", repos: [] });
  assert.throws(() => loadConfig(p), /repos/);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd bridge && npm test`
Expected: FAIL (cannot find `./config.ts` / `loadConfig` not defined).

- [ ] **Step 5: Write minimal implementation**

Create `bridge/src/config.ts`:
```typescript
import { readFileSync } from "node:fs";

export interface RepoRef { name: string; path: string; }
export interface Config { port: number; token: string; repos: RepoRef[]; }

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw) as Partial<Config>;
  if (typeof data.token !== "string" || data.token.length === 0) {
    throw new Error("config: token must be a non-empty string");
  }
  if (!Array.isArray(data.repos) || data.repos.length === 0) {
    throw new Error("config: repos must be a non-empty array");
  }
  const port = typeof data.port === "number" ? data.port : 8790;
  return { port, token: data.token, repos: data.repos };
}
```

Create `bridge/config.example.json`:
```json
{
  "port": 8790,
  "token": "change-me-to-a-long-random-string",
  "repos": [
    { "name": "continuation-pipeline", "path": "/mnt/c/Users/aayus/dev/Projects/Continuation Pipeline" }
  ]
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd bridge && npm test`
Expected: PASS (3 tests).

- [ ] **Step 7: Update .gitignore and commit**

Add to the repo root `.gitignore`:
```
bridge/node_modules/
bridge/dist/
bridge/config.json
```

```bash
git add bridge/package.json bridge/package-lock.json bridge/tsconfig.json bridge/config.example.json bridge/src/config.ts bridge/src/config.test.ts .gitignore
git commit -m "feat(bridge): scaffold WSL Node bridge with config loader"
```

---

### Task 2: Bearer token authentication helper

**Files:**
- Create: `bridge/src/auth.ts`
- Create: `bridge/src/auth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `checkToken(expected: string, provided: string | undefined): boolean` (constant-time compare, false when `provided` is undefined or a length mismatch).

- [ ] **Step 1: Write the failing test**

Create `bridge/src/auth.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkToken } from "./auth.ts";

test("accepts the matching token", () => {
  assert.equal(checkToken("secret", "secret"), true);
});

test("rejects a wrong token", () => {
  assert.equal(checkToken("secret", "nope"), false);
});

test("rejects undefined", () => {
  assert.equal(checkToken("secret", undefined), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bridge && npm test`
Expected: FAIL (`checkToken` not defined).

- [ ] **Step 3: Write minimal implementation**

Create `bridge/src/auth.ts`:
```typescript
import { timingSafeEqual } from "node:crypto";

export function checkToken(expected: string, provided: string | undefined): boolean {
  if (provided === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bridge && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bridge/src/auth.ts bridge/src/auth.test.ts
git commit -m "feat(bridge): constant-time bearer token check"
```

---

### Task 3: Approval registry (async allow/deny)

**Files:**
- Create: `bridge/src/approvals.ts`
- Create: `bridge/src/approvals.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class ApprovalRegistry` with
  - `create(): { id: string; promise: Promise<Decision> }`
  - `resolve(id: string, decision: Decision): boolean` (returns false if the id is unknown)
  - `type Decision = "allow" | "deny"`

- [ ] **Step 1: Write the failing test**

Create `bridge/src/approvals.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalRegistry } from "./approvals.ts";

test("resolves a pending approval with the decision", async () => {
  const reg = new ApprovalRegistry();
  const { id, promise } = reg.create();
  assert.equal(typeof id, "string");
  const ok = reg.resolve(id, "allow");
  assert.equal(ok, true);
  assert.equal(await promise, "allow");
});

test("resolve of an unknown id returns false", () => {
  const reg = new ApprovalRegistry();
  assert.equal(reg.resolve("missing", "deny"), false);
});

test("each create yields a distinct id", () => {
  const reg = new ApprovalRegistry();
  assert.notEqual(reg.create().id, reg.create().id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bridge && npm test`
Expected: FAIL (`ApprovalRegistry` not defined).

- [ ] **Step 3: Write minimal implementation**

Create `bridge/src/approvals.ts`:
```typescript
import { randomUUID } from "node:crypto";

export type Decision = "allow" | "deny";

export class ApprovalRegistry {
  private pending = new Map<string, (d: Decision) => void>();

  create(): { id: string; promise: Promise<Decision> } {
    const id = randomUUID();
    const promise = new Promise<Decision>((resolve) => {
      this.pending.set(id, resolve);
    });
    return { id, promise };
  }

  resolve(id: string, decision: Decision): boolean {
    const fn = this.pending.get(id);
    if (!fn) return false;
    this.pending.delete(id);
    fn(decision);
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bridge && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bridge/src/approvals.ts bridge/src/approvals.test.ts
git commit -m "feat(bridge): async approval registry"
```

---

### Task 4: Protocol types and the SessionSource seam

**Files:**
- Create: `bridge/src/protocol.ts`
- Create: `bridge/src/source.ts`

**Interfaces:**
- Produces:
  - `protocol.ts`: the discriminated unions for WebSocket messages.
    - `ClientMessage = { type: "start"; repo: string } | { type: "user"; text: string } | { type: "approve"; id: string; decision: Decision }`
    - `ServerMessage = { type: "ready"; sessionId: string } | { type: "assistant"; text: string } | { type: "tool"; name: string; input: unknown } | { type: "approval"; id: string; name: string; input: unknown } | { type: "turn_done" } | { type: "error"; message: string }`
  - `source.ts`:
    - `type StreamEvent = { kind: "assistant"; text: string } | { kind: "tool"; name: string; input: unknown } | { kind: "result" }`
    - `type CanUseToolFn = (name: string, input: unknown) => Promise<Decision>`
    - `interface SendParams { repoPath: string; resumeId?: string; text: string; canUseTool: CanUseToolFn; onEvent: (e: StreamEvent) => void; }`
    - `interface SessionSource { send(p: SendParams): Promise<{ sessionId: string }>; }`

- [ ] **Step 1: Write the type modules**

Create `bridge/src/protocol.ts`:
```typescript
import type { Decision } from "./approvals.ts";

export type ClientMessage =
  | { type: "start"; repo: string }
  | { type: "user"; text: string }
  | { type: "approve"; id: string; decision: Decision };

export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "approval"; id: string; name: string; input: unknown }
  | { type: "turn_done" }
  | { type: "error"; message: string };
```

Create `bridge/src/source.ts`:
```typescript
import type { Decision } from "./approvals.ts";

export type StreamEvent =
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; input: unknown }
  | { kind: "result" };

export type CanUseToolFn = (name: string, input: unknown) => Promise<Decision>;

export interface SendParams {
  repoPath: string;
  resumeId?: string;
  text: string;
  canUseTool: CanUseToolFn;
  onEvent: (e: StreamEvent) => void;
}

export interface SessionSource {
  send(p: SendParams): Promise<{ sessionId: string }>;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd bridge && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add bridge/src/protocol.ts bridge/src/source.ts
git commit -m "feat(bridge): WS protocol types and SessionSource interface"
```

---

### Task 5: Session (wires a SessionSource to approvals and events)

**Files:**
- Create: `bridge/src/session.ts`
- Create: `bridge/src/session.test.ts`

**Interfaces:**
- Consumes: `SessionSource`, `SendParams`, `StreamEvent` (Task 4); `ApprovalRegistry`, `Decision` (Task 3); `ServerMessage` (Task 4).
- Produces: `class Session` with
  - `constructor(source: SessionSource, repoPath: string, emit: (m: ServerMessage) => void)`
  - `handleUser(text: string): Promise<void>` (runs one turn: resumes if a prior turn set the session id, emits `assistant`/`tool`/`approval`/`turn_done`)
  - `approve(id: string, decision: Decision): void`

- [ ] **Step 1: Write the failing test**

Create `bridge/src/session.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "./session.ts";
import type { SessionSource, SendParams } from "./source.ts";
import type { ServerMessage } from "./protocol.ts";

// Fake source: emits one assistant line, then asks to use one tool, then a result.
const fakeSource: SessionSource = {
  async send(p: SendParams) {
    p.onEvent({ kind: "assistant", text: "working" });
    const decision = await p.canUseTool("Bash", { command: "ls" });
    p.onEvent({ kind: "tool", name: "Bash", input: { command: "ls", decision } });
    p.onEvent({ kind: "result" });
    return { sessionId: "sess-1" };
  },
};

test("streams events and completes an approved turn", async () => {
  const out: ServerMessage[] = [];
  const s = new Session(fakeSource, "/mnt/c/repo", (m) => out.push(m));
  const turn = s.handleUser("hi");
  // Give the microtask queue a tick so the approval message is emitted.
  await new Promise((r) => setTimeout(r, 0));
  const approval = out.find((m) => m.type === "approval");
  assert.ok(approval && approval.type === "approval");
  s.approve(approval.id, "allow");
  await turn;

  assert.ok(out.some((m) => m.type === "assistant" && m.text === "working"));
  assert.ok(out.some((m) => m.type === "tool" && m.name === "Bash"));
  assert.ok(out.some((m) => m.type === "ready" && m.sessionId === "sess-1"));
  assert.ok(out.some((m) => m.type === "turn_done"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bridge && npm test`
Expected: FAIL (`Session` not defined).

- [ ] **Step 3: Write minimal implementation**

Create `bridge/src/session.ts`:
```typescript
import { ApprovalRegistry, type Decision } from "./approvals.ts";
import type { SessionSource } from "./source.ts";
import type { ServerMessage } from "./protocol.ts";

export class Session {
  private approvals = new ApprovalRegistry();
  private sessionId?: string;

  constructor(
    private source: SessionSource,
    private repoPath: string,
    private emit: (m: ServerMessage) => void,
  ) {}

  approve(id: string, decision: Decision): void {
    this.approvals.resolve(id, decision);
  }

  async handleUser(text: string): Promise<void> {
    try {
      const { sessionId } = await this.source.send({
        repoPath: this.repoPath,
        resumeId: this.sessionId,
        text,
        onEvent: (e) => {
          if (e.kind === "assistant") this.emit({ type: "assistant", text: e.text });
          else if (e.kind === "tool") this.emit({ type: "tool", name: e.name, input: e.input });
        },
        canUseTool: (name, input) => {
          const { id, promise } = this.approvals.create();
          this.emit({ type: "approval", id, name, input });
          return promise;
        },
      });
      this.sessionId = sessionId;
      this.emit({ type: "ready", sessionId });
      this.emit({ type: "turn_done" });
    } catch (err) {
      this.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bridge && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bridge/src/session.ts bridge/src/session.test.ts
git commit -m "feat(bridge): Session wiring source to approvals and events"
```

---

### Task 6: SdkSessionSource (real Agent SDK wrapper)

**Files:**
- Create: `bridge/src/sdkSource.ts`
- Create: `bridge/src/sdkSource.test.ts`

**Interfaces:**
- Consumes: `SessionSource`, `SendParams`, `StreamEvent` (Task 4).
- Produces: `class SdkSessionSource implements SessionSource`, constructed as `new SdkSessionSource(queryFn?)` where `queryFn` defaults to the SDK's `query`. It maps SDK messages to `StreamEvent`s, captures the session id from the SDK init message, and calls the SDK `canUseTool` option by delegating to `SendParams.canUseTool`.

**Notes for the implementer (verify against the installed SDK):**
- The SDK message stream includes a system/init message carrying `session_id`, assistant messages with `content` blocks (`text` and `tool_use`), and a final `result` message. Field names can shift between SDK versions, so read the installed package's types (`node_modules/@anthropic-ai/claude-agent-sdk`) and adjust the mapping. Keep the mapping in the one function below.
- The SDK `canUseTool` result shape is either `{ approved: boolean }` or `{ behavior: "allow" | "deny", ... }` depending on version. Centralize it in `toSdkResult` and confirm.

- [ ] **Step 1: Write the failing test (with an injected fake query)**

Create `bridge/src/sdkSource.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { SdkSessionSource } from "./sdkSource.ts";
import type { StreamEvent } from "./source.ts";

// A fake async generator matching the subset of SDK message shapes we map.
async function* fakeQuery(args: any) {
  // The SDK receives canUseTool in options; exercise it.
  const res = await args.options.canUseTool(
    { toolName: "Bash", input: { command: "ls" } },
    { signal: new AbortController().signal },
  );
  yield { type: "system", subtype: "init", session_id: "sess-9" };
  yield { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } };
  yield { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } };
  yield { type: "result", subtype: "success", permission: res };
}

test("maps SDK messages to StreamEvents and captures session id", async () => {
  const src = new SdkSessionSource(fakeQuery as any);
  const events: StreamEvent[] = [];
  const out = await src.send({
    repoPath: "/mnt/c/repo",
    text: "hi",
    onEvent: (e) => events.push(e),
    canUseTool: async () => "allow",
  });
  assert.equal(out.sessionId, "sess-9");
  assert.ok(events.some((e) => e.kind === "assistant" && e.text === "hello"));
  assert.ok(events.some((e) => e.kind === "tool" && e.name === "Bash"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bridge && npm test`
Expected: FAIL (`SdkSessionSource` not defined).

- [ ] **Step 3: Write minimal implementation**

Create `bridge/src/sdkSource.ts`:
```typescript
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { SessionSource, SendParams } from "./source.ts";
import type { Decision } from "./approvals.ts";

type QueryFn = typeof sdkQuery;

// Map our decision onto the SDK permission result. Confirm the shape against the
// installed SDK version and change ONLY here if it differs.
function toSdkResult(decision: Decision, input: unknown) {
  return decision === "allow"
    ? { behavior: "allow", updatedInput: input }
    : { behavior: "deny", message: "Denied from phone" };
}

export class SdkSessionSource implements SessionSource {
  constructor(private queryFn: QueryFn = sdkQuery) {}

  async send(p: SendParams): Promise<{ sessionId: string }> {
    let sessionId = "";
    const iterator = this.queryFn({
      prompt: p.text,
      options: {
        cwd: p.repoPath,
        resume: p.resumeId,
        permissionMode: "default",
        canUseTool: async (req: any) => {
          const name = req.toolName ?? req.name;
          const input = req.input;
          const decision = await p.canUseTool(name, input);
          return toSdkResult(decision, input);
        },
      },
    } as any);

    for await (const msg of iterator as any) {
      if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
        sessionId = msg.session_id;
      } else if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") p.onEvent({ kind: "assistant", text: block.text });
          else if (block.type === "tool_use") p.onEvent({ kind: "tool", name: block.name, input: block.input });
        }
      } else if (msg.type === "result") {
        p.onEvent({ kind: "result" });
      }
    }
    return { sessionId };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bridge && npm test`
Expected: PASS.

- [ ] **Step 5: Real smoke check (manual, needs claude login)**

Create `bridge/src/smoke.ts`:
```typescript
import { SdkSessionSource } from "./sdkSource.ts";

const repo = process.argv[2] ?? process.cwd();
const src = new SdkSessionSource();
const { sessionId } = await src.send({
  repoPath: repo,
  text: "In one sentence, what is in the current directory? Do not use any tools.",
  onEvent: (e) => console.log(JSON.stringify(e)),
  canUseTool: async () => "deny",
});
console.log("sessionId:", sessionId);
```

Run: `cd bridge && npx tsx src/smoke.ts "/mnt/c/Users/aayus/dev/Projects/Continuation Pipeline"`
Expected: assistant events print and a non-empty `sessionId`. If the message shape differs from the mapping, adjust `sdkSource.ts` (only the mapping) and re-run the unit test.

- [ ] **Step 6: Commit**

```bash
git add bridge/src/sdkSource.ts bridge/src/sdkSource.test.ts bridge/src/smoke.ts
git commit -m "feat(bridge): Agent SDK session source with injectable query"
```

---

### Task 7: HTTP + WebSocket server

**Files:**
- Create: `bridge/src/server.ts`
- Create: `bridge/src/index.ts`
- Create: `bridge/src/server.test.ts`

**Interfaces:**
- Consumes: `loadConfig`/`Config` (Task 1), `checkToken` (Task 2), `Session` (Task 5), `SessionSource` (Task 4), `ClientMessage`/`ServerMessage` (Task 4), `SdkSessionSource` (Task 6).
- Produces: `createServer(config: Config, source: SessionSource): http.Server`.
  - `GET /health` returns `200` `{ ok: true }` (no auth).
  - `GET /repos` requires `Authorization: Bearer <token>`, returns `{ repos: string[] }` (names only).
  - Static files from `bridge/public/` served at `/`.
  - WebSocket at `/ws`: the client passes the token as the second WebSocket subprotocol (`new WebSocket(url, ["bridge", token])`). On bad token the socket is closed with code 1008. Then it handles `ClientMessage`s: `start` selects the repo and creates a `Session`; `user` calls `session.handleUser`; `approve` calls `session.approve`.
- `index.ts` loads `bridge/config.json`, builds `new SdkSessionSource()`, and calls `createServer(...).listen(config.port, "127.0.0.1")` (127.0.0.1 because Tailscale `serve` fronts it).

- [ ] **Step 1: Write the failing integration test (with a fake source)**

Create `bridge/src/server.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "./server.ts";
import type { Config } from "./config.ts";
import type { SessionSource, SendParams } from "./source.ts";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";

const config: Config = { port: 0, token: "secret", repos: [{ name: "demo", path: "/tmp/demo" }] };

const fakeSource: SessionSource = {
  async send(p: SendParams) {
    p.onEvent({ kind: "assistant", text: "hi from agent" });
    await p.canUseTool("Bash", { command: "ls" }); // waits for approval
    p.onEvent({ kind: "result" });
    return { sessionId: "s1" };
  },
};

test("streams a turn and round-trips an approval over WS", async () => {
  const server = createServer(config, fakeSource);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bridge", "secret"]);
  const got: any[] = [];
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "start", repo: "demo" }));
      ws.send(JSON.stringify({ type: "user", text: "go" }));
    });
    ws.on("message", (data) => {
      const m = JSON.parse(data.toString());
      got.push(m);
      if (m.type === "approval") ws.send(JSON.stringify({ type: "approve", id: m.id, decision: "allow" }));
      if (m.type === "turn_done") resolve();
      if (m.type === "error") reject(new Error(m.message));
    });
    ws.on("error", reject);
  });

  ws.close();
  await new Promise<void>((r) => server.close(() => r()));

  assert.ok(got.some((m) => m.type === "assistant" && m.text === "hi from agent"));
  assert.ok(got.some((m) => m.type === "approval"));
  assert.ok(got.some((m) => m.type === "turn_done"));
});

test("rejects a bad WS token", async () => {
  const server = createServer(config, fakeSource);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bridge", "wrong"]);
  const closed = await new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  await new Promise<void>((r) => server.close(() => r()));
  assert.equal(closed, 1008);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bridge && npm test`
Expected: FAIL (`createServer` not defined).

- [ ] **Step 3: Write minimal implementation**

Create `bridge/src/server.ts`:
```typescript
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { WebSocketServer } from "ws";
import type { Config } from "./config.ts";
import { checkToken } from "./auth.ts";
import { Session } from "./session.ts";
import type { SessionSource } from "./source.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";

const PUBLIC_DIR = new URL("../public/", import.meta.url).pathname;
const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".webmanifest": "application/manifest+json", ".json": "application/json",
};

export function createServer(config: Config, source: SessionSource) {
  const http = createHttp(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/repos") {
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!checkToken(config.token, bearer)) { res.writeHead(401); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ repos: config.repos.map((r) => r.name) }));
      return;
    }
    // static files
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const path = normalize(join(PUBLIC_DIR, rel));
    if (!path.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });

  const wss = new WebSocketServer({ server: http, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const token = (req.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim())[1];
    if (!checkToken(config.token, token)) { ws.close(1008, "unauthorized"); return; }

    let session: Session | undefined;
    const emit = (m: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));

    ws.on("message", (data) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(data.toString()) as ClientMessage; }
      catch { emit({ type: "error", message: "bad json" }); return; }

      if (msg.type === "start") {
        const repo = config.repos.find((r) => r.name === msg.repo);
        if (!repo) { emit({ type: "error", message: "unknown repo" }); return; }
        session = new Session(source, repo.path, emit);
      } else if (msg.type === "user") {
        if (!session) { emit({ type: "error", message: "start a session first" }); return; }
        void session.handleUser(msg.text);
      } else if (msg.type === "approve") {
        session?.approve(msg.id, msg.decision);
      }
    });
  });

  return http;
}
```

Create `bridge/src/index.ts`:
```typescript
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";
import { SdkSessionSource } from "./sdkSource.ts";

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(join(here, "..", "config.json"));
const server = createServer(config, new SdkSessionSource());
server.listen(config.port, "127.0.0.1", () => {
  console.log(`bridge listening on 127.0.0.1:${config.port}`);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bridge && npm test`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add bridge/src/server.ts bridge/src/index.ts bridge/src/server.test.ts
git commit -m "feat(bridge): HTTP + WebSocket server with token-gated WS"
```

---

### Task 8: PWA client

**Files:**
- Create: `bridge/public/index.html`
- Create: `bridge/public/app.js`
- Create: `bridge/public/styles.css`
- Create: `bridge/public/manifest.webmanifest`
- Create: `bridge/public/sw.js`

**Interfaces:**
- Consumes: the WS protocol from Task 4 and the `/repos` endpoint from Task 7.
- Produces: a single-screen client. It stores the token and server origin in `localStorage`, fetches `/repos`, opens `new WebSocket(origin.replace('http','ws') + '/ws', ['bridge', token])`, sends `start`/`user`/`approve`, and renders `assistant`/`tool`/`approval`/`turn_done`/`error`.

- [ ] **Step 1: Create the client files**

Create `bridge/public/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Continuation</title>
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header><span id="status">disconnected</span></header>
  <main id="log"></main>
  <form id="composer">
    <input id="text" autocomplete="off" placeholder="Message the agent" />
    <button type="submit">Send</button>
  </form>
  <dialog id="setup">
    <form method="dialog">
      <label>Server origin<input id="origin" placeholder="https://yusha.tail0a3619.ts.net" /></label>
      <label>Token<input id="token" type="password" /></label>
      <label>Repo<select id="repo"></select></label>
      <button id="connect" type="submit">Connect</button>
    </form>
  </dialog>
  <script src="app.js"></script>
</body>
</html>
```

Create `bridge/public/app.js`:
```javascript
const $ = (id) => document.getElementById(id);
const log = $("log");
let ws;

function line(cls, text) {
  const el = document.createElement("div");
  el.className = "line " + cls;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function approvalCard(id, name, input) {
  const el = document.createElement("div");
  el.className = "line approval";
  el.innerHTML = `<b>Approve ${name}?</b><pre>${JSON.stringify(input, null, 2)}</pre>`;
  const allow = document.createElement("button");
  allow.textContent = "Allow";
  const deny = document.createElement("button");
  deny.textContent = "Deny";
  allow.onclick = () => { ws.send(JSON.stringify({ type: "approve", id, decision: "allow" })); el.remove(); };
  deny.onclick = () => { ws.send(JSON.stringify({ type: "approve", id, decision: "deny" })); el.remove(); };
  el.append(allow, deny);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

async function loadRepos(origin, token) {
  const res = await fetch(origin + "/repos", { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error("auth failed");
  const { repos } = await res.json();
  $("repo").innerHTML = repos.map((r) => `<option>${r}</option>`).join("");
}

function connect(origin, token, repo) {
  const wsUrl = origin.replace(/^http/, "ws") + "/ws";
  ws = new WebSocket(wsUrl, ["bridge", token]);
  ws.onopen = () => { $("status").textContent = "connected"; ws.send(JSON.stringify({ type: "start", repo })); };
  ws.onclose = () => ($("status").textContent = "disconnected");
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "assistant") line("assistant", m.text);
    else if (m.type === "tool") line("tool", "tool: " + m.name);
    else if (m.type === "approval") approvalCard(m.id, m.name, m.input);
    else if (m.type === "turn_done") line("meta", "done");
    else if (m.type === "error") line("error", m.message);
  };
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("text").value.trim();
  if (!text || !ws || ws.readyState !== ws.OPEN) return;
  line("user", text);
  ws.send(JSON.stringify({ type: "user", text }));
  $("text").value = "";
});

window.addEventListener("load", async () => {
  const origin = localStorage.getItem("origin") || location.origin;
  const token = localStorage.getItem("token") || "";
  $("origin").value = origin;
  $("token").value = token;
  const dlg = $("setup");
  if (token) { try { await loadRepos(origin, token); } catch {} }
  dlg.showModal();
  $("connect").addEventListener("click", async (e) => {
    e.preventDefault();
    const o = $("origin").value.trim(), t = $("token").value.trim();
    localStorage.setItem("origin", o); localStorage.setItem("token", t);
    try { await loadRepos(o, t); } catch { line("error", "could not load repos"); return; }
    connect(o, t, $("repo").value);
    dlg.close();
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
});
```

Create `bridge/public/styles.css`:
```css
:root { color-scheme: light dark; --gap: 12px; }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.4 system-ui, sans-serif; display: flex; flex-direction: column; height: 100dvh; }
header { padding: 10px 16px; border-bottom: 1px solid #8884; }
#log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: var(--gap); }
.line { padding: 8px 12px; border-radius: 10px; max-width: 90%; white-space: pre-wrap; word-break: break-word; }
.user { align-self: flex-end; background: #2563eb; color: #fff; }
.assistant { align-self: flex-start; background: #8882; }
.tool { align-self: flex-start; font-size: 13px; opacity: 0.8; }
.meta { align-self: center; font-size: 12px; opacity: 0.6; }
.error { align-self: center; color: #dc2626; }
.approval { align-self: stretch; background: #f59e0b22; border: 1px solid #f59e0b; }
.approval button { margin-right: 8px; margin-top: 8px; padding: 8px 16px; }
.approval pre { overflow-x: auto; }
#composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #8884; padding-bottom: max(12px, env(safe-area-inset-bottom)); }
#composer input { flex: 1; padding: 12px; font-size: 16px; }
dialog label { display: block; margin-bottom: 12px; }
dialog input, dialog select { width: 100%; padding: 10px; font-size: 16px; }
```

Create `bridge/public/manifest.webmanifest`:
```json
{
  "name": "Continuation",
  "short_name": "Continuation",
  "display": "standalone",
  "background_color": "#111111",
  "theme_color": "#111111",
  "start_url": "./",
  "icons": []
}
```

Create `bridge/public/sw.js`:
```javascript
// Stage 1: minimal service worker so the app is installable. Caching and Web Push land in Stage 2.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
```

- [ ] **Step 2: Verify in the local browser (server running with a real config)**

Create `bridge/config.json` (gitignored) from the example with a real long random token, then:
```bash
cd bridge && npm run dev
```
Open `http://127.0.0.1:8790/` in a browser. Enter origin `http://127.0.0.1:8790`, the token, pick the repo, Connect. Type "say hello and do not use tools". Expected: the status shows connected, an assistant line appears, no console errors. Type a request that triggers a tool (for example "list the files in this repo") and confirm an approval card appears with Allow / Deny and that Allow lets it proceed.

- [ ] **Step 3: Commit**

```bash
git add bridge/public/
git commit -m "feat(bridge): installable PWA client with approval cards"
```

---

### Task 9: Serve over Tailscale and end-to-end from the phone

**Files:**
- Create: `bridge/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: run and exposure instructions, and a verified phone-to-agent round trip.

- [ ] **Step 1: Put the server behind Tailscale HTTPS**

With the server running (`npm run dev` in `bridge/`), in another WSL shell run:
```bash
tailscale serve --bg https / http://127.0.0.1:8790
tailscale serve status
```
This publishes the bridge at `https://yusha.tail0a3619.ts.net/` on the tailnet only, with a real certificate, no public exposure. (If `tailscale` is not on the WSL PATH, run these from Windows PowerShell instead: `tailscale serve --bg https / http://127.0.0.1:8790`. The Node server binds to 127.0.0.1, which both WSL and the Windows host share, so either works.)

- [ ] **Step 2: Write `bridge/README.md`**

Document: install Node in WSL (nvm), `npm install`, copy `config.example.json` to `config.json` and set a long random token plus your repo list, `npm run dev`, then `tailscale serve` as above. Include the phone steps from Step 3 and a note that Stage 1 is Ask-mode only and one session per connection.

- [ ] **Step 3: End-to-end from the iPhone**

On the iPhone (already on the tailnet via the Tailscale app):
1. Open Safari to `https://yusha.tail0a3619.ts.net/`.
2. Enter that same origin and the token, pick a repo, Connect.
3. Send "list the files here". Confirm an approval card appears, tap Allow, and the result streams back.
4. Share sheet, Add to Home Screen, confirm it launches standalone.

Expected: a full phone-to-agent round trip with a tool approved from the phone.

- [ ] **Step 4: Commit**

```bash
git add bridge/README.md
git commit -m "docs(bridge): run and Tailscale serve instructions, Stage 1 e2e"
```

---

## Self-Review

**Spec coverage (Stage 1 items in `docs/app-path-design.md`):**
- Start a session in a chosen repo: Task 7 (`start` + repo list), Task 5.
- Stream output: Tasks 5, 6, 7 (`assistant`/`tool` events).
- Approve or deny tools from the phone: Tasks 3, 5, 6, 7, 8 (`canUseTool` to approval card).
- Send follow-ups: Task 5 (`handleUser` with `resume`), Task 7 (`user`).
- Bearer token over Tailscale: Tasks 2, 7 (subprotocol token), Task 9 (`tailscale serve`).
- Ask mode only, one session per connection: enforced in Tasks 5 and 7.
- WSL hosting, `/mnt/c` paths, claude login auth: Task 1 (nvm), Task 6 (SDK login), Global Constraints.

**Placeholder scan:** No "TBD"/"handle errors"/"similar to" left; every code step has real code. The one deliberate verify-at-build note is the SDK message/permission shape in Task 6, isolated to `toSdkResult` and the mapping loop, with a smoke step to confirm.

**Type consistency:** `SessionSource.send` signature is identical across Tasks 4, 5, 6, 7. `ServerMessage`/`ClientMessage` unions are defined once (Task 4) and consumed unchanged. `Decision` ("allow"/"deny") is consistent across approvals, session, source, protocol, client. `createServer(config, source)` matches between Task 7 and the test.
