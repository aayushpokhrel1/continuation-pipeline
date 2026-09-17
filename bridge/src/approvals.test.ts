import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalRegistry } from "./approvals.ts";

test("resolves a pending approval with the decision", async () => {
  const reg = new ApprovalRegistry();
  const { id, promise } = reg.create();
  assert.equal(typeof id, "string");
  const ok = reg.resolve(id, "allow");
  assert.equal(ok, true);
  assert.equal(await promise, "allow");
});

test("resolve of an unknown id returns false", () => {
  const reg = new ApprovalRegistry();
  assert.equal(reg.resolve("missing", "deny"), false);
});

test("each create yields a distinct id", () => {
  const reg = new ApprovalRegistry();
  assert.notEqual(reg.create().id, reg.create().id);
});
