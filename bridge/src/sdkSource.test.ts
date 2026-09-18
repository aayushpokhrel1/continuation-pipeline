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
