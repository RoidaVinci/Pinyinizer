import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeAsciiParenSuffix,
  consumePlainLatinSuffix,
  normalizePinyin,
  splitPinyinSyllables,
  syllabifyOrCharLookup,
  toneOf,
  toneMarkOf,
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

test("toneOf reads the tone from marked pinyin", () => {
  assert.equal(toneOf("mā"), 1);
  assert.equal(toneOf("má"), 2);
  assert.equal(toneOf("mǎ"), 3);
  assert.equal(toneOf("mà"), 4);
  assert.equal(toneOf("ma"), 0);
  assert.equal(toneOf(""), 0);
  assert.equal(toneOf(undefined), 0);
});

test("toneOf handles ü, decomposed input and numbered styles", () => {
  assert.equal(toneOf("lǜ"), 4);
  assert.equal(toneOf("nǚ"), 3);
  assert.equal(toneOf("lü"), 0);           // diaeresis alone is not a tone
  assert.equal(toneOf("hǎo".normalize("NFD")), 3);
  assert.equal(toneOf("hao3"), 3);
  assert.equal(toneOf("ma5"), 0);          // neutral tone written as 5
});

test("toneMarkOf renders one standalone mark, nothing for neutral", () => {
  assert.deepEqual(
    ["mā", "má", "mǎ", "mà", "ma"].map(toneMarkOf),
    ["ˉ", "ˊ", "ˇ", "ˋ", ""],
  );
});
