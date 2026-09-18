import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchiveStore } from "./archive.ts";

test("persists archive state to a file", () => {
  const path = join(mkdtempSync(join(tmpdir(), "archive-")), "archived.json");
  const store = new ArchiveStore(path);
  store.archive("a");
  assert.ok(store.has("a"));

  const reloaded = new ArchiveStore(path);
  assert.ok(reloaded.has("a"));

  reloaded.unarchive("a");
  assert.ok(!reloaded.has("a"));
});

test("works in memory without a path", () => {
  const store = new ArchiveStore();
  store.archive("a");
  assert.ok(store.has("a"));
  store.unarchive("a");
  assert.ok(!store.has("a"));
});
