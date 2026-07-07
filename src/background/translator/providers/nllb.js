// Local NLLB server (e.g. facebook/nllb-200-distilled-600M behind a small
// FastAPI endpoint). Faster than an LLM for pure translation; fully offline.

import { fetchJson } from "../../../common/utils.js";

// Canonical codes -> NLLB (FLORES-200) tags
const LANG = {
  en: "eng_Latn", es: "spa_Latn", zh: "zho_Hans", "zh-TW": "zho_Hant",
  fr: "fra_Latn", de: "deu_Latn", ja: "jpn_Jpan", ko: "kor_Hang",
  pt: "por_Latn", ru: "rus_Cyrl", ar: "arb_Arab",
};

// NLLB has no auto-detect; make a cheap script-based guess. Non-Han text is
// assumed English (en->en degrades to near-identity, which is harmless;
// guessing any other language would actively garble pages).
function guessSource(texts) {
  const han = /\p{Script=Han}/u;
  return texts.some(s => typeof s === "string" && han.test(s)) ? "zh" : "en";
}

export async function translateNLLB(texts, { sourceLang = "auto", targetLang = "es", config = {} } = {}) {
  const endpoint = config.endpoint || "http://127.0.0.1:8899/translate";
  const arr = texts.map(s => String(s ?? ""));

  const src = sourceLang === "auto" ? guessSource(arr) : sourceLang;
  const source = LANG[src];
  const target = LANG[targetLang];
  if (!source) throw new Error(`NLLB provider does not support source language: ${src}`);
  if (!target) throw new Error(`NLLB provider does not support target language: ${targetLang}`);

  const data = await fetchJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: arr, source, target }),
  }, { retries: 0, timeoutMs: 60000 });

  if (Array.isArray(data?.translations)) return data.translations;
  if (typeof data?.translation === "string") return [data.translation];
  throw new Error("NLLB server returned an unexpected response shape");
}
