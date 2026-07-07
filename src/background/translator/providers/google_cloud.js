// Google Cloud Translation v2 (official, API-key based).
// Docs: https://cloud.google.com/translate/docs/reference/rest/v2/translate

import { chunkByBudget, mapPool, fetchJson } from "../../../common/utils.js";

const ENDPOINT = "https://translation.googleapis.com/language/translate/v2";

// Canonical codes -> Cloud Translation codes
const LANG = { zh: "zh-CN", "zh-TW": "zh-TW" }; // everything else passes through

export async function translateGoogleCloud(texts, { sourceLang = "auto", targetLang = "en", config = {} }) {
  const { apiKey } = config;
  if (!apiKey) throw new Error("Google Cloud provider needs an API key (see Options)");

  const target = LANG[targetLang] || targetLang;
  const source = sourceLang === "auto" ? undefined : (LANG[sourceLang] || sourceLang);

  const inputs = texts.map(s => String(s ?? ""));
  const out = new Array(inputs.length);
  const batches = chunkByBudget(inputs, { maxItems: 100, maxChars: 8000 });

  await mapPool(batches, 4, async ({ start, slice }) => {
    const body = { q: slice, target, format: "text" };
    if (source) body.source = source;
    const data = await fetchJson(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const translations = data?.data?.translations;
    if (!Array.isArray(translations) || translations.length !== slice.length) {
      throw new Error("Google Cloud returned an unexpected response shape");
    }
    translations.forEach((t, i) => { out[start + i] = t.translatedText ?? slice[i]; });
  });

  return out;
}
