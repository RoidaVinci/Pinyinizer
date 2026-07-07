import { test } from "node:test";
import assert from "node:assert/strict";
import { deepMerge, DEFAULTS } from "../src/background/storage/settings.js";

test("deepMerge overlays nested objects", () => {
  const merged = deepMerge(DEFAULTS, { annotate: { showEnglish: true } });
  assert.equal(merged.annotate.showEnglish, true);
  assert.equal(merged.annotate.hanziScale, DEFAULTS.annotate.hanziScale); // untouched sibling
});

test("deepMerge replaces arrays wholesale", () => {
  const merged = deepMerge({ targetLangs: ["es", "en"] }, { targetLangs: ["zh"] });
  assert.deepEqual(merged.targetLangs, ["zh"]);
});

test("deepMerge keeps existing values for undefined", () => {
  const merged = deepMerge({ a: 1, b: 2 }, { a: undefined });
  assert.equal(merged.a, 1);
});

test("DEFAULTS include provider config for every configurable provider", () => {
  for (const id of ["google_cloud", "baidu", "youdao", "libretranslate", "local_llm", "nllb"]) {
    assert.ok(DEFAULTS.providerConfig[id], `missing providerConfig.${id}`);
  }
});
