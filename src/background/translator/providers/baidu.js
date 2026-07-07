// Baidu Fanyi (百度翻译开放平台) — official API, reachable from mainland China.
// Docs: https://api.fanyi.baidu.com/doc/21
//
// Auth: sign = MD5(appid + q + salt + secretKey). Batch requests join inputs
// with "\n" and the response returns one trans_result entry per line.
// The free tier is limited to ~1 QPS, so batches run sequentially.

import { md5 } from "../../../common/md5.js";
import { chunkByBudget, fetchWithTimeout, sleep } from "../../../common/utils.js";

const ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";
const TIMEOUT_MS = 10000;
const QPS_DELAY_MS = 1100; // free tier allows 1 request/second

// The 1-QPS limit applies per account, not per call — and with all_frames
// content scripts several CT_TRANSLATE_BATCH messages can hit this provider
// concurrently. Serialize every request through one module-level queue and
// enforce the spacing there.
let queue = Promise.resolve();
let lastRequestAt = 0;
function enqueue(fn) {
  const run = queue.then(async () => {
    const wait = lastRequestAt + QPS_DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  queue = run.catch(() => {}); // keep the chain alive after failures
  return run;
}

// Canonical codes -> Baidu codes
const LANG = {
  auto: "auto", en: "en", zh: "zh", "zh-TW": "cht", es: "spa", fr: "fra",
  de: "de", ja: "jp", ko: "kor", pt: "pt", ru: "ru", ar: "ara",
};

export function buildBaiduParams(q, { appId, secretKey, from, to, salt }) {
  const sign = md5(appId + q + salt + secretKey);
  return new URLSearchParams({ q, from, to, appid: appId, salt: String(salt), sign });
}

export async function translateBaidu(texts, { sourceLang = "auto", targetLang = "en", config = {} }) {
  const { appId, secretKey } = config;
  if (!appId || !secretKey) {
    throw new Error("Baidu provider needs an App ID and secret key (see Options)");
  }
  const from = LANG[sourceLang] || "auto";
  const to = LANG[targetLang];
  if (!to) throw new Error(`Baidu provider does not support target language: ${targetLang}`);

  // Newlines inside an input would desync the per-line response mapping.
  const inputs = texts.map(s => String(s ?? "").replace(/\n+/g, " "));
  const out = new Array(inputs.length);

  const batches = chunkByBudget(inputs, { maxItems: 30, maxChars: 1800 });
  for (const { start, slice } of batches) {
    const q = slice.join("\n");
    const salt = Date.now();
    const body = buildBaiduParams(q, { appId, secretKey, from, to, salt });

    const data = await enqueue(async () => {
      const res = await fetchWithTimeout(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }, TIMEOUT_MS);
      if (!res.ok) throw new Error(`Baidu HTTP ${res.status}`);
      return res.json();
    });
    if (data.error_code) {
      throw new Error(`Baidu error ${data.error_code}: ${data.error_msg || "unknown"}`);
    }

    const results = Array.isArray(data.trans_result) ? data.trans_result : [];
    if (results.length !== slice.length) {
      throw new Error(`Baidu returned ${results.length} lines for ${slice.length} inputs`);
    }
    results.forEach((r, i) => { out[start + i] = r.dst ?? slice[i]; });
  }
  return out;
}
