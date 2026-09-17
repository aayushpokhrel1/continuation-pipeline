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
