import { test } from "node:test";
import assert from "node:assert/strict";
import { SdkSessionSource } from "./sdkSource.ts";
import type { StreamEvent } from "./source.ts";

// A fake async generator matching the subset of SDK message shapes we map.
async function* fakeQuery(args: any) {
  // The SDK calls canUseTool as (toolName, input, options).
  await args.options.canUseTool("Bash", { command: "ls" }, {});
  yield { type: "system", subtype: "init", session_id: "sess-9" };
  yield { type: "assistant", session_id: "sess-9", message: { content: [{ type: "text", text: "hello" }] } };
  yield { type: "assistant", session_id: "sess-9", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } };
  yield { type: "result", subtype: "success" };
}

test("maps SDK messages to StreamEvents and captures session id", async () => {
  const src = new SdkSessionSource(fakeQuery as any);
  const events: StreamEvent[] = [];
  const out = await src.send({
    repoPath: "/mnt/c/repo",
    text: "hi",
    mode: "ask",
    onEvent: (e) => events.push(e),
    canUseTool: async () => "allow",
  });
  assert.equal(out.sessionId, "sess-9");
  assert.ok(events.some((e) => e.kind === "assistant" && e.text === "hello"));
  assert.ok(events.some((e) => e.kind === "tool" && e.name === "Bash"));
});

// A fake that records the options it was called with, then yields a minimal result.
function recordingQuery(record: { options?: any }) {
  return async function* (args: any) {
    record.options = args.options;
    yield { type: "result", subtype: "success", session_id: "sess-rec" };
  };
}

test("auto-safe mode allows read-only tools and keeps canUseTool", async () => {
  const record: { options?: any } = {};
  const src = new SdkSessionSource(recordingQuery(record) as any);
  await src.send({
    repoPath: "/mnt/c/repo",
    text: "hi",
    mode: "auto-safe",
    onEvent: () => {},
    canUseTool: async () => "allow",
  });
  assert.deepEqual(record.options.allowedTools, ["Read", "Glob", "Grep"]);
  assert.equal(record.options.permissionMode, "default");
  assert.equal(typeof record.options.canUseTool, "function");
});

test("yolo mode bypasses permissions and omits canUseTool", async () => {
  const record: { options?: any } = {};
  const src = new SdkSessionSource(recordingQuery(record) as any);
  await src.send({
    repoPath: "/mnt/c/repo",
    text: "hi",
    mode: "yolo",
    onEvent: () => {},
    canUseTool: async () => "allow",
  });
  assert.equal(record.options.permissionMode, "bypassPermissions");
  assert.equal(record.options.canUseTool, undefined);
});

test("listSessions maps and sorts newest-first", async () => {
  const fakeList = async () => [
    { sessionId: "a", summary: "old", lastModified: 1 },
    { sessionId: "b", customTitle: "New", lastModified: 2 },
  ];
  const src = new SdkSessionSource(undefined as any, fakeList as any, undefined as any);
  const out = await src.listSessions("/mnt/c/repo");
  assert.deepEqual(out, [
    { sessionId: "b", title: "New", lastModified: 2 },
    { sessionId: "a", title: "old", lastModified: 1 },
  ]);
});

test("getHistory maps user text and assistant text/tool", async () => {
  const fakeHistory = async () => [
    { type: "user", message: { content: "hi" } },
    { type: "assistant", message: { content: [{ type: "text", text: "hello" }, { type: "tool_use", name: "Bash" }] } },
    { type: "system", message: {} },
  ];
  const src = new SdkSessionSource(undefined as any, undefined as any, fakeHistory as any);
  const out = await src.getHistory("sess-1", "/mnt/c/repo");
  assert.deepEqual(out, [
    { role: "user", text: "hi" },
    { role: "assistant", text: "hello" },
    { role: "assistant", tool: "Bash" },
  ]);
});

test("send emits a session event when the id first appears", async () => {
  async function* sessionQuery() {
    yield { type: "system", subtype: "init", session_id: "sess-9" };
    yield { type: "result", subtype: "success" };
  }
  const src = new SdkSessionSource(sessionQuery as any);
  const events: StreamEvent[] = [];
  await src.send({
    repoPath: "/mnt/c/repo",
    text: "hi",
    mode: "ask",
    onEvent: (e) => events.push(e),
    canUseTool: async () => "allow",
  });
  assert.deepEqual(events.filter((e) => e.kind === "session"), [{ kind: "session", sessionId: "sess-9" }]);
});
