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
