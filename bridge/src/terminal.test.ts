import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { attachTerminal, listTerminals } from "./terminal.ts";

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.writes = [];
  child.stdin = { write: (d: string) => child.writes.push(d) };
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

test("rejects an invalid terminal name", () => {
  assert.throws(() => attachTerminal("a; rm -rf", () => {}, () => {}), /invalid terminal name/);
});

test("spawns script with the tmux attach argv", () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const child = fakeChild();
  const spawnFn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return child;
  }) as any;

  attachTerminal("continuation", () => {}, () => {}, spawnFn);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "script");
  assert.deepEqual(calls[0].args, ["-qfc", "tmux attach -t continuation", "/dev/null"]);
});

test("child stdout data reaches onData", () => {
  const child = fakeChild();
  const spawnFn = (() => child) as any;
  const seen: string[] = [];

  attachTerminal("continuation", (d) => seen.push(d), () => {}, spawnFn);
  child.stdout.emit("data", Buffer.from("hi"));

  assert.deepEqual(seen, ["hi"]);
});

test("handle.write pushes to the child stdin", () => {
  const child = fakeChild();
  const spawnFn = (() => child) as any;

  const handle = attachTerminal("continuation", () => {}, () => {}, spawnFn);
  handle.write("x");

  assert.deepEqual(child.writes, ["x"]);
});

test("child exit fires onExit", () => {
  const child = fakeChild();
  const spawnFn = (() => child) as any;
  let exited = 0;

  attachTerminal("continuation", () => {}, () => { exited++; }, spawnFn);
  child.emit("exit", 0);

  assert.equal(exited, 1);
});

test("handle.kill kills the child", () => {
  const child = fakeChild();
  const spawnFn = (() => child) as any;

  const handle = attachTerminal("continuation", () => {}, () => {}, spawnFn);
  handle.kill();

  assert.equal(child.killed, true);
});

test("listTerminals resolves session names on a clean exit", async () => {
  const child = fakeChild();
  const spawnFn = (() => child) as any;

  const p = listTerminals(spawnFn);
  setImmediate(() => {
    child.stdout.emit("data", Buffer.from("continuation\nother\n"));
    child.emit("exit", 0);
  });

  assert.deepEqual(await p, ["continuation", "other"]);
});

test("listTerminals resolves an empty list on a non-zero exit", async () => {
  const child = fakeChild();
  const spawnFn = (() => child) as any;

  const p = listTerminals(spawnFn);
  setImmediate(() => child.emit("exit", 1));

  assert.deepEqual(await p, []);
});
