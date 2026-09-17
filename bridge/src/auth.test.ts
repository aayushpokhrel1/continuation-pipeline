import { test } from "node:test";
import assert from "node:assert/strict";
import { checkToken } from "./auth.ts";

test("accepts the matching token", () => {
  assert.equal(checkToken("secret", "secret"), true);
});

test("rejects a wrong token", () => {
  assert.equal(checkToken("secret", "nope"), false);
});

test("rejects undefined", () => {
  assert.equal(checkToken("secret", undefined), false);
});
