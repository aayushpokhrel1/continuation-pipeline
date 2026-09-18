import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { discoverRepos } from "./repos.ts";

function makeProjectsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "repos-"));
  mkdirSync(join(dir, "alpha", ".git"), { recursive: true });
  mkdirSync(join(dir, "beta"), { recursive: true });
  writeFileSync(join(dir, "notadir"), "");
  return dir;
}

test("discovers git repos under projectsDir", () => {
  const projectsDir = makeProjectsDir();
  const config: Config = {
    port: 0,
    token: "t",
    repos: [{ name: "cfg", path: "/somewhere" }],
    projectsDir,
  };
  const repos = discoverRepos(config);
  assert.ok(repos.some((r) => r.name === "cfg" && r.path === "/somewhere"));
  assert.ok(repos.some((r) => r.name === "alpha" && r.path === join(projectsDir, "alpha")));
  assert.ok(!repos.some((r) => r.name === "beta"));
});

test("returns exactly config.repos when projectsDir is undefined", () => {
  const config: Config = {
    port: 0,
    token: "t",
    repos: [{ name: "cfg", path: "/somewhere" }],
  };
  assert.deepEqual(discoverRepos(config), config.repos);
});

test("dedupes by path, configured repos win", () => {
  const projectsDir = makeProjectsDir();
  const config: Config = {
    port: 0,
    token: "t",
    repos: [{ name: "cfg", path: join(projectsDir, "alpha") }],
    projectsDir,
  };
  const repos = discoverRepos(config);
  const matches = repos.filter((r) => r.path === join(projectsDir, "alpha"));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "cfg");
});
