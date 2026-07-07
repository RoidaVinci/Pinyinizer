// LibreTranslate — open-source translation API (self-hosted or public
// instance). https://github.com/LibreTranslate/LibreTranslate

import { fetchJson } from "../../../common/utils.js";

// Canonical codes -> LibreTranslate codes
const LANG = { "zh-TW": "zt" }; // everything else passes through

export async function translateLibre(texts, { sourceLang = "auto", targetLang = "es", config = {} }) {
  const endpoint = (config.endpoint || "https://libretranslate.com").replace(/\/+$/, "");
  const body = {
    q: texts.map(s => String(s ?? "")),
    source: sourceLang === "auto" ? "auto" : (LANG[sourceLang] || sourceLang),
    target: LANG[targetLang] || targetLang,
    format: "text",
  };
  if (config.apiKey) body.api_key = config.apiKey;

  const data = await fetchJson(`${endpoint}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (data?.error) throw new Error(`LibreTranslate: ${data.error}`);
  // Array input -> {translatedText: [...]}, single -> {translatedText: "..."}
  const t = data?.translatedText;
  if (Array.isArray(t)) return t;
  if (typeof t === "string") return [t];
  if (Array.isArray(data)) return data.map(d => d.translatedText);
  throw new Error("LibreTranslate returned an unexpected response shape");
}
