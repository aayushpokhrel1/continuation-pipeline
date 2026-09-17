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
