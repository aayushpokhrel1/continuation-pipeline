import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDiff } from "./diff.ts";

test("Edit produces old lines then new lines", () => {
  const d = buildDiff("Edit", { file_path: "/a.ts", old_string: "a\nb", new_string: "c" });
  assert.ok(d);
  assert.equal(d.path, "/a.ts");
  assert.deepEqual(d.lines, [
    { sign: "-", text: "a" },
    { sign: "-", text: "b" },
    { sign: "+", text: "c" },
  ]);
});

test("MultiEdit concatenates edits in order", () => {
  const d = buildDiff("MultiEdit", {
    file_path: "/a.ts",
    edits: [
      { old_string: "a", new_string: "b" },
      { old_string: "c", new_string: "d" },
    ],
  });
  assert.ok(d);
  assert.equal(d.path, "/a.ts");
  assert.deepEqual(d.lines, [
    { sign: "-", text: "a" },
    { sign: "+", text: "b" },
    { sign: "-", text: "c" },
    { sign: "+", text: "d" },
  ]);
});

test("Write produces all plus lines", () => {
  const d = buildDiff("Write", { file_path: "/a.ts", content: "x\ny" });
  assert.ok(d);
  assert.equal(d.path, "/a.ts");
  assert.deepEqual(d.lines, [
    { sign: "+", text: "x" },
    { sign: "+", text: "y" },
  ]);
});

test("unknown tool returns null", () => {
  assert.equal(buildDiff("Bash", { command: "ls" }), null);
});

test("Edit with a missing field returns null", () => {
  assert.equal(buildDiff("Edit", { file_path: "/a.ts", old_string: "a" }), null);
});

test("truncates to MAX_LINES and reports the removed count", () => {
  const content = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const d = buildDiff("Write", { file_path: "/a.ts", content });
  assert.ok(d);
  assert.equal(d.lines.length, 40);
  assert.equal(d.truncated, 60);
});

test("drops a single trailing newline", () => {
  const d = buildDiff("Write", { file_path: "/a.ts", content: "a\nb\n" });
  assert.ok(d);
  assert.equal(d.lines.length, 2);
});
