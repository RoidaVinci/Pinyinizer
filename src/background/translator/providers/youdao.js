// Youdao AI Cloud (有道智云) text translation — official API, reachable from
// mainland China. Docs: https://ai.youdao.com/DOCSIRMA/html/trans/api/wbfy/
//
// Auth (v3): sign = SHA-256(appKey + input(q) + salt + curtime + appSecret)
// where input(q) = q if len <= 20, else first10 + len + last10.

import { mapPool, fetchWithTimeout } from "../../../common/utils.js";

const ENDPOINT = "https://openapi.youdao.com/api";
const TIMEOUT_MS = 10000;
const CONCURRENCY = 2; // stay well under QPS limits

// Canonical codes -> Youdao codes
const LANG = {
  auto: "auto", en: "en", zh: "zh-CHS", "zh-TW": "zh-CHT", es: "es", fr: "fr",
  de: "de", ja: "ja", ko: "ko", pt: "pt", ru: "ru", ar: "ar",
};

// The "input" component of the v3 signature. Youdao's reference
// implementation uses UTF-16 units (JS q.length / Java String.length), NOT
// code points — matching that exactly matters for strings containing emoji
// or astral-plane characters, or the signature check fails server-side.
export function youdaoInput(q) {
  const len = q.length;
  if (len <= 20) return q;
  return q.substring(0, 10) + len + q.substring(len - 10, len);
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}

export async function translateYoudao(texts, { sourceLang = "auto", targetLang = "en", config = {} }) {
  const { appKey, appSecret } = config;
  if (!appKey || !appSecret) {
    throw new Error("Youdao provider needs an app key and secret (see Options)");
  }
  const from = LANG[sourceLang] || "auto";
  const to = LANG[targetLang];
  if (!to) throw new Error(`Youdao provider does not support target language: ${targetLang}`);

  return mapPool(texts, CONCURRENCY, async (raw) => {
    const q = String(raw ?? "");
    if (!q.trim()) return q;

    const salt = crypto.randomUUID();
    const curtime = String(Math.floor(Date.now() / 1000));
    const sign = await sha256Hex(appKey + youdaoInput(q) + salt + curtime + appSecret);

    const body = new URLSearchParams({
      q, from, to, appKey, salt, sign, signType: "v3", curtime,
    });
    const res = await fetchWithTimeout(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }, TIMEOUT_MS);
    if (!res.ok) throw new Error(`Youdao HTTP ${res.status}`);
    const data = await res.json();
    if (data.errorCode && data.errorCode !== "0") {
      throw new Error(`Youdao error ${data.errorCode}`);
    }
    return Array.isArray(data.translation) && data.translation.length
      ? data.translation.join(" ")
      : q;
  });
}
