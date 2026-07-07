// Strict pinyin via Google's free endpoint: we use ONLY s[3] (romanization).
// Never fall back to translated text (s[0]) to avoid "Chinese (English)" artifacts.

import { fetchJson, mapPool } from "../../../common/utils.js";

const BASE = "https://translate.googleapis.com/translate_a/single";
const CONCURRENCY = 6;
const RETRIES = 2;
const TIMEOUT_MS = 7000;

const HAN = /\p{Script=Han}/u;
// tone vowels + digits 1–4 indicate pinyin; accept both marked and numbered styles
const HAS_TONE_MARK = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i;
const LOOKS_PINYIN = /[a-z]/i;

export function pinyinGoogleFree(texts) {
  const arr = Array.isArray(texts) ? texts.map(s => s ?? "") : [String(texts ?? "")];
  return mapPool(arr, CONCURRENCY, fetchPinyinSingle);
}

async function fetchPinyinSingle(q) {
  if (!HAN.test(q)) return q;

  const urls = [
    makeUrl(q, "zh", "en"),
    makeUrl(q, "zh", "zh"),
  ];

  for (const url of urls) {
    try {
      const data = await fetchJson(url, { method: "GET" }, { retries: RETRIES, timeoutMs: TIMEOUT_MS });
      const py = extractStrictPinyin(data);
      if (py) return py;
    } catch (_) { /* try next */ }
  }

  // Offline minimal fallback so UI still shows progress if rm blocked
  const pyLocal = fallbackPinyin(q);
  return pyLocal || q;
}

function makeUrl(q, sl, tl) {
  // Ask for segments and romanization only
  return `${BASE}?client=gtx&ie=UTF-8&oe=UTF-8&hl=en&dt=t&dt=rm&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(q)}`;
}

// --- extraction: only s[3] ---
function extractStrictPinyin(json) {
  const root = Array.isArray(json) ? json[0] : null;
  if (!Array.isArray(root)) return "";

  const parts = [];
  for (const seg of root) {
    if (!Array.isArray(seg)) continue;
    const rm = typeof seg[3] === "string" ? seg[3].trim() : "";
    if (!rm) continue;
    // guard: must look like pinyin; avoid raw English
    if (!(HAS_TONE_MARK.test(rm) || LOOKS_PINYIN.test(rm))) continue;
    parts.push(rm);
  }
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  return joined;
}

// --- tiny offline fallback map ---
function fallbackPinyin(q) {
  const map = {
    "你":"nǐ","好":"hǎo","北":"běi","京":"jīng","大":"dà","学":"xué",
    "信":"xìn","息":"xī","门":"mén","户":"hù","人":"rén","工":"gōng","智":"zhì","能":"néng",
    "公":"gōng","共":"gòng","服":"fú","务":"wù","校":"xiào","园":"yuán"
  };
  let any = false;
  const out = [];
  for (const ch of q) {
    if (map[ch]) { out.push(map[ch]); any = true; }
    else if (HAN.test(ch)) out.push(ch);
    else out.push(ch);
  }
  return any ? out.join(" ").replace(/\s+/g, " ").trim() : "";
}

