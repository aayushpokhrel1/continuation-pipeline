import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "./sessionManager.ts";
import type { SessionSource, SendParams, SessionInfo, TranscriptEvent } from "./source.ts";

const sessionSource: SessionSource = {
  async send(p: SendParams) {
    p.onEvent({ kind: "session", sessionId: "s1" });
    return { sessionId: "s1" };
  },
};

test("registers by sdk id and get returns it", async () => {
  const manager = new SessionManager(sessionSource, () => {});
  const s = manager.create("/r", "ask");
  s.attach(() => {});
  await s.handleUser("hi");
  assert.equal(manager.get("s1"), s);
});

test("getOrCreate seeds a historical session and is idempotent", () => {
  const manager = new SessionManager(sessionSource, () => {});
  const a = manager.getOrCreate("old", "/r", "ask");
  assert.equal(a.sdkSessionId, "old");
  assert.equal(a.repoPath, "/r");
  const b = manager.getOrCreate("old", "/r", "ask");
  assert.equal(a, b);
});

test("list/getHistory delegate; missing source methods yield []", async () => {
  const items: SessionInfo[] = [{ sessionId: "s1", title: "demo", lastModified: 1 }];
  const history: TranscriptEvent[] = [{ role: "user", text: "hi" }];
  const withMethods: SessionSource = {
    ...sessionSource,
    async listSessions() { return items; },
    async getHistory() { return history; },
  };
  const manager = new SessionManager(withMethods, () => {});
  assert.deepEqual(await manager.listSessions("/r"), items);
  assert.deepEqual(await manager.getHistory("s1", "/r"), history);

  const bare = new SessionManager(sessionSource, () => {});
  assert.deepEqual(await bare.listSessions("/r"), []);
  assert.deepEqual(await bare.getHistory("s1", "/r"), []);
});

test("listSessions filters archived", async () => {
  const items: SessionInfo[] = [
    { sessionId: "a", title: "A", lastModified: 2 },
    { sessionId: "b", title: "B", lastModified: 1 },
  ];
  const source: SessionSource = {
    ...sessionSource,
    async listSessions() { return items; },
  };
  const manager = new SessionManager(source, () => {});
  manager.archive("a");
  assert.deepEqual(await manager.listSessions("/r"), [items[1]]);
  assert.deepEqual(await manager.listSessions("/r", true), [items[0]]);
});
