import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "./session.ts";
import type { SessionSource, SendParams } from "./source.ts";
import type { ServerMessage } from "./protocol.ts";

test("emits ready and registers on the session event", async () => {
  const fakeSource: SessionSource = {
    async send(p: SendParams) {
      p.onEvent({ kind: "session", sessionId: "s1" });
      return { sessionId: "s1" };
    },
  };
  const out: ServerMessage[] = [];
  let registered = 0;
  const s = new Session(fakeSource, "/r", "ask", () => { registered++; }, () => {});
  s.attach((m) => out.push(m));

  await s.handleUser("hi");

  assert.ok(out.some((m) => m.type === "ready" && m.sessionId === "s1"));
  assert.equal(registered, 1);
});

test("approval survives detach and replays after re-attach", async () => {
  const fakeSource: SessionSource = {
    async send(p: SendParams) {
      await p.canUseTool("Bash", { c: 1 });
      p.onEvent({ kind: "result" });
      return { sessionId: "s1" };
    },
  };
  const emit1: ServerMessage[] = [];
  const emit2: ServerMessage[] = [];
  const s = new Session(fakeSource, "/r", "ask", () => {}, () => {});
  s.attach((m) => emit1.push(m));

  const turn = s.handleUser("hi");
  await new Promise((r) => setTimeout(r, 0));
  const approval = emit1.find((m) => m.type === "approval");
  assert.ok(approval && approval.type === "approval");

  s.detach();
  s.attach((m) => emit2.push(m));
  s.replayPending();
  const replayed = emit2.find((m) => m.type === "approval");
  assert.ok(replayed && replayed.type === "approval");
  assert.equal(replayed.id, approval.id);

  s.approve(approval.id, "allow");
  await turn;
  assert.ok(emit2.some((m) => m.type === "turn_done"));
});

test("pushNotify fires on approval and turn_done", async () => {
  const fakeSource: SessionSource = {
    async send(p: SendParams) {
      await p.canUseTool("Bash", { c: 1 });
      p.onEvent({ kind: "result" });
      return { sessionId: "s1" };
    },
  };
  const pushes: { title: string; body: string }[] = [];
  const out: ServerMessage[] = [];
  const s = new Session(fakeSource, "/r", "ask", () => {}, (_id, payload) => pushes.push(payload));
  s.attach((m) => out.push(m));

  const turn = s.handleUser("hi");
  await new Promise((r) => setTimeout(r, 0));
  const approval = pushes.find((p) => p.title === "Approval needed");
  assert.ok(approval);
  assert.equal(approval.body, "Bash");

  // Resolve the pending approval so the turn can finish.
  const msg = out.find((m) => m.type === "approval");
  assert.ok(msg && msg.type === "approval");
  s.approve(msg.id, "allow");
  await turn;

  assert.ok(pushes.some((p) => p.title === "Turn finished"));
});
