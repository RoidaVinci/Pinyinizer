import { test } from "node:test";
import assert from "node:assert/strict";
import { fastHash, stableHash } from "../src/common/hash.js";

test("hashes are deterministic", () => {
  assert.equal(fastHash("hello"), fastHash("hello"));
  assert.equal(stableHash("hello"), stableHash("hello"));
});

test("stableHash separates strings that collide more easily on 32 bits", () => {
  // Sanity: distinct inputs (incl. unicode) map to distinct keys.
  const inputs = ["", "a", "b", "ab", "ba", "你好", "好你", "hello world", "hello worle"];
  const keys = new Set(inputs.map(stableHash));
  assert.equal(keys.size, inputs.length);
});

test("stableHash output shape is two base36 words", () => {
  assert.match(stableHash("anything"), /^[0-9a-z]+-[0-9a-z]+$/);
});
