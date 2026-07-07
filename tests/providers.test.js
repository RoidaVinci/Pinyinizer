import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildBaiduParams } from "../src/background/translator/providers/baidu.js";
import { youdaoInput } from "../src/background/translator/providers/youdao.js";
import { parseJsonArray } from "../src/background/translator/providers/local_llm.js";
import { PROVIDER_META } from "../src/background/translator/registry.js";
import { PROVIDERS } from "../src/background/translator/providers/index.js";

test("baidu signature matches the documented MD5(appid+q+salt+key)", () => {
  const params = buildBaiduParams("apple", {
    appId: "2015063000000001", secretKey: "12345678", from: "en", to: "zh", salt: 1435660288,
  });
  const expected = createHash("md5")
    .update("2015063000000001apple143566028812345678", "utf8").digest("hex");
  assert.equal(params.get("sign"), expected);
  assert.equal(params.get("q"), "apple");
  assert.equal(params.get("appid"), "2015063000000001");
});

test("youdao input truncation follows first10 + len + last10 (UTF-16 units)", () => {
  assert.equal(youdaoInput("short text"), "short text");
  const long = "abcdefghij0123456789KLMNOPQRST"; // 30 chars
  assert.equal(youdaoInput(long), "abcdefghij" + 30 + "KLMNOPQRST");

  // Reference implementation counts UTF-16 units (q.length), not code points:
  // the emoji is 2 units, so len and both slices must reflect that.
  const emoji = "这个视频真的太精彩了😀大家快来看看吧朋友们"; // 21 code points, 22 UTF-16 units
  assert.equal(emoji.length, 22);
  assert.equal(
    youdaoInput(emoji),
    emoji.substring(0, 10) + 22 + emoji.substring(12),
  );
});

test("parseJsonArray tolerates fences and prose", () => {
  assert.deepEqual(parseJsonArray('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseJsonArray('```json\n["a","b"]\n```'), ["a", "b"]);
  assert.deepEqual(parseJsonArray('Here you go: ["hola", "mundo"] hope that helps'), ["hola", "mundo"]);
  assert.equal(parseJsonArray("no array here"), null);
  assert.equal(parseJsonArray('{"not": "array"}'), null);
});

test("registry metadata and implementations stay in sync", () => {
  const metaIds = PROVIDER_META.map(m => m.id).sort();
  const implIds = Object.keys(PROVIDERS).sort();
  assert.deepEqual(metaIds, implIds);
});

test("keyed providers reject missing credentials", async () => {
  await assert.rejects(
    () => PROVIDERS.baidu(["hi"], { sourceLang: "en", targetLang: "zh", config: {} }),
    /App ID/);
  await assert.rejects(
    () => PROVIDERS.youdao(["hi"], { sourceLang: "en", targetLang: "zh", config: {} }),
    /app key/);
  await assert.rejects(
    () => PROVIDERS.google_cloud(["hi"], { sourceLang: "en", targetLang: "zh", config: {} }),
    /API key/);
});
