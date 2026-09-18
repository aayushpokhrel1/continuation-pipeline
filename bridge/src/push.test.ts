import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PushService, type Vapid } from "./push.ts";

const vapid: Vapid = { subject: "mailto:a@b.c", publicKey: "pub", privateKey: "priv" };

function tmpStore(): string {
  const dir = mkdtempSync(join(tmpdir(), "push-"));
  return join(dir, "subscriptions.json");
}

function sub(endpoint: string): any {
  return { endpoint, keys: { p256dh: "k", auth: "a" } };
}

test("add dedupes by endpoint and persists", () => {
  const storePath = tmpStore();
  const svc = new PushService(vapid, storePath, async () => ({}));
  svc.add(sub("https://x/1"));
  svc.add(sub("https://x/1"));
  const stored = JSON.parse(readFileSync(storePath, "utf8"));
  assert.equal(stored.length, 1);
});

test("notify sends to every subscription", async () => {
  const storePath = tmpStore();
  let calls = 0;
  const svc = new PushService(vapid, storePath, async () => { calls++; return {}; });
  svc.add(sub("https://x/1"));
  svc.add(sub("https://x/2"));
  await svc.notify({ title: "t", body: "b" });
  assert.equal(calls, 2);
});

test("notify prunes a gone (410) subscription", async () => {
  const storePath = tmpStore();
  const svc = new PushService(vapid, storePath, async (s) => {
    if (s.endpoint === "https://x/1") throw { statusCode: 410 };
    return {};
  });
  svc.add(sub("https://x/1"));
  svc.add(sub("https://x/2"));
  await svc.notify({ title: "t", body: "b" });
  const stored = JSON.parse(readFileSync(storePath, "utf8"));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].endpoint, "https://x/2");
});
