import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeAsciiParenSuffix,
  consumePlainLatinSuffix,
  normalizePinyin,
  splitPinyinSyllables,
  syllabifyOrCharLookup,
} from "../src/content/lib/pinyin-text.js";

test("consumeAsciiParenSuffix eats English glosses in parens", () => {
  const s = "北京 (Beijing) is big";
  const consumed = consumeAsciiParenSuffix(s, 2);
  assert.equal(s.slice(2 + consumed), " is big");
});

test("consumeAsciiParenSuffix ignores Han content in parens", () => {
  assert.equal(consumeAsciiParenSuffix("北京（首都）", 2), 0);
});

test("consumePlainLatinSuffix eats dash-separated glosses", () => {
  const s = "北京 — Beijing";
  assert.ok(consumePlainLatinSuffix(s, 2) > 0);
});

test("normalizePinyin strips punctuation and collapses spaces", () => {
  assert.equal(normalizePinyin(" nǐ,  hǎo (ma) "), "nǐ hǎo ma");
});

test("splitPinyinSyllables tokenizes with apostrophes and spaces", () => {
  assert.deepEqual(splitPinyinSyllables("xī'ān"), ["xī", "ān"]);
  assert.deepEqual(splitPinyinSyllables("nǐ hǎo"), ["nǐ", "hǎo"]);
});

test("syllabifyOrCharLookup falls back to the char map on mismatch", () => {
  const chars = ["你", "好"];
  const charMap = new Map([["你", "nǐ"], ["好", "hǎo"]]);
  // phrase splits into 2 tokens -> trusted
  assert.deepEqual(syllabifyOrCharLookup(chars, "ni hao", charMap), ["ni", "hao"]);
  // phrase splits into 1 token for 2 chars -> per-char fallback
  assert.deepEqual(syllabifyOrCharLookup(chars, "nihao", charMap), ["nǐ", "hǎo"]);
});
