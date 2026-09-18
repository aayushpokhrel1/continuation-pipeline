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
    p.onEvent({ kind: "session", sessionId: "s1" });
    p.onEvent({ kind: "assistant", text: "hi from agent" });
    await p.canUseTool("Bash", { command: "ls" }); // waits for approval
    p.onEvent({ kind: "result" });
    return { sessionId: "s1" };
  },
  async listSessions() {
    return [{ sessionId: "s1", title: "demo session", lastModified: 1 }];
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

test("lists sessions for a repo", async () => {
  const server = createServer(config, fakeSource);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bridge", "secret"]);
  const items = await new Promise<any[]>((resolve, reject) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "list", repo: "demo" })));
    ws.on("message", (data) => {
      const m = JSON.parse(data.toString());
      if (m.type === "sessions") resolve(m.items);
      if (m.type === "error") reject(new Error(m.message));
    });
    ws.on("error", reject);
  });

  ws.close();
  await new Promise<void>((r) => server.close(() => r()));

  assert.deepEqual(items, [{ sessionId: "s1", title: "demo session", lastModified: 1 }]);
});

test("archive hides a session from the default list", async () => {
  const server = createServer(config, fakeSource);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bridge", "secret"]);
  const sessions: any[] = [];
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "archive", sessionId: "s1" }));
      ws.send(JSON.stringify({ type: "list", repo: "demo" }));
      ws.send(JSON.stringify({ type: "list", repo: "demo", archived: true }));
    });
    ws.on("message", (data) => {
      const m = JSON.parse(data.toString());
      if (m.type === "sessions") {
        sessions.push(m);
        if (sessions.length === 2) resolve();
      }
      if (m.type === "error") reject(new Error(m.message));
    });
    ws.on("error", reject);
  });

  ws.close();
  await new Promise<void>((r) => server.close(() => r()));

  assert.deepEqual(sessions[0], { type: "sessions", items: [], archived: false });
  assert.equal(sessions[1].archived, true);
  assert.deepEqual(sessions[1].items, [{ sessionId: "s1", title: "demo session", lastModified: 1 }]);
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

test("serves the vapid public key and accepts a subscription", async () => {
  const fakePush = { publicKey: "PUB", added: [] as any[], add(s: any) { this.added.push(s); }, async notify() {} };
  const server = createServer(config, fakeSource, fakePush);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const vapidRes = await fetch(`${base}/vapid`, { headers: { authorization: "Bearer secret" } });
  assert.equal(vapidRes.status, 200);
  assert.deepEqual(await vapidRes.json(), { publicKey: "PUB" });

  const sub = { endpoint: "https://x/1", keys: { p256dh: "k", auth: "a" } };
  const subRes = await fetch(`${base}/subscribe`, {
    method: "POST",
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify(sub),
  });
  assert.equal(subRes.status, 201);
  assert.equal(fakePush.added.length, 1);
  assert.deepEqual(fakePush.added[0], sub);

  await new Promise<void>((r) => server.close(() => r()));
});
