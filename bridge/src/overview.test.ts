import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOverview } from "./overview.ts";

const config = { port: 0, token: "x", repos: [
  { name: "alpha", path: "/repos/alpha" },
  { name: "beta",  path: "/repos/beta" },
  { name: "bad",   path: "/repos/bad" },
] } as any;

const byPath: Record<string, any[]> = {
  "/repos/alpha": [{ sessionId: "a1", title: "A one", lastModified: 30 }],
  "/repos/beta":  [{ sessionId: "b1", title: "B one", lastModified: 50 },
                   { sessionId: "b2", title: "B two", lastModified: 10 }],
};

const manager = {
  async listSessions(repoPath: string) {
    if (repoPath === "/repos/bad") throw new Error("unreadable");
    return byPath[repoPath] ?? [];
  },
  liveRepoPaths() { return new Set(["/repos/beta"]); },
};

test("merges sessions across repos, sorted by lastModified desc, tagged with their repo", async () => {
  const ov = await buildOverview(config, manager);
  assert.deepEqual(ov.items.map((i) => i.sessionId), ["b1", "a1", "b2"]);
  const b1 = ov.items.find((i) => i.sessionId === "b1")!;
  assert.equal(b1.repo, "beta");
  assert.equal(b1.repoPath, "/repos/beta");
  const a1 = ov.items.find((i) => i.sessionId === "a1")!;
  assert.equal(a1.repo, "alpha");
  assert.equal(a1.repoPath, "/repos/alpha");
});

test("a repo that throws is skipped, not fatal", async () => {
  const ov = await buildOverview(config, manager);
  assert.ok(!ov.items.some((i) => i.repo === "bad"));
  assert.deepEqual(ov.items.map((i) => i.sessionId), ["b1", "a1", "b2"]);
});

test("repos carry per-repo lastModified and live flags, sorted live-first then recency", async () => {
  const ov = await buildOverview(config, manager);
  const byName = Object.fromEntries(ov.repos.map((r) => [r.name, r]));
  assert.equal(byName.alpha.lastModified, 30);
  assert.equal(byName.beta.lastModified, 50);
  assert.equal(byName.bad.lastModified, 0);
  assert.equal(byName.beta.live, true);
  assert.equal(byName.alpha.live, false);
  assert.equal(byName.bad.live, false);
  assert.equal(ov.repos[0].name, "beta");
});
