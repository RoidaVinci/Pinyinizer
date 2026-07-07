import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { md5 } from "../src/common/md5.js";

const ref = (s) => createHash("md5").update(s, "utf8").digest("hex");

test("md5 matches node:crypto on RFC 1321 vectors", () => {
  for (const s of ["", "a", "abc", "message digest", "abcdefghijklmnopqrstuvwxyz"]) {
    assert.equal(md5(s), ref(s));
  }
});

test("md5 handles UTF-8 (Chinese) and long inputs", () => {
  const cases = [
    "你好世界",
    "百度翻译appid20240101你好salt1435660288",
    "x".repeat(1000),
    "混合 mixed 内容 with ünïcode ✓",
  ];
  for (const s of cases) assert.equal(md5(s), ref(s));
});

test("md5 handles block-boundary lengths (55/56/64 bytes)", () => {
  for (const n of [55, 56, 63, 64, 65, 119, 120]) {
    const s = "a".repeat(n);
    assert.equal(md5(s), ref(s));
  }
});
