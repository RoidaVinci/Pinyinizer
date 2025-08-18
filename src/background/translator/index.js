import { fastHash } from "../../common/hash.js";
import { getMany, setMany, clearCache } from "../storage/cache.js";
import { applyGlossary, unmaskDNT } from "../glossary.js";
import { translateMock } from "./providers/mock.js";
import { translateHTTP } from "./providers/http.js";
import { translateGoogleFree } from "./providers/google_free.js";  // ← NEW
import { translateNLLB } from "./providers/nllb.js";
import { translatePinyin } from "./providers/pinyin.js";   // ← NEW

const PROVIDERS = { mock: translateMock,
    http: translateHTTP,
    google_free: translateGoogleFree ,
    nllb: translateNLLB,
    pinyin: translatePinyin ,
};


export async function translateBatch(texts, opts) {
  const {
    provider = "mock",
    targetLang = "es",
    sourceLang = "auto",
    targetMode = "translate",   // "translate" | "pinyin"
    context,
    glossary,
    cacheSalt = 1,           // bump to invalidate cache globally
  } = opts || {};

  const p = targetMode === "pinyin"
    ? translatePinyin
    : (PROVIDERS[provider] || translateMock);

  // ---- provider-aware cache keys (fixes “stuck on old results”) ----
  const normalized = texts.map(s => s ?? "");
  const keys = normalized.map(s => fastHash(`${cacheSalt}|${provider}|${targetMode}|${sourceLang}|${targetLang}|${s}`));
  const cached = await getMany(keys);

  const misses = [];
  const missIdx = [];
  normalized.forEach((s, i) => { if (cached[i] == null) { missIdx.push(i); misses.push(s); } });
  if (!misses.length) return cached;

  const pre = targetMode === "pinyin" ? misses : applyGlossary(misses, glossary);

  let translatedMisses = [];
  try {
    console.log("[CT:bg] provider:", provider, "batch:", misses.length, "sl:", sourceLang, "tl:", targetLang, "url:", context?.url);
    translatedMisses = await p(pre, { sourceLang, targetLang, context });
  } catch (e) {
    console.error("[CT:bg] provider error:", e?.message || e);
    // Last-resort: identity (do NOT silently switch providers).
    translatedMisses = misses.slice();
  }

  translatedMisses = targetMode === "pinyin"
    ? translatedMisses
    : translatedMisses.map(unmaskDNT);

  const write = [];
  translatedMisses.forEach((t, j) => {
    const i = missIdx[j];
    write.push([keys[i], t]);
    cached[i] = t;
  });
  if (write.length) await setMany(write);

  return cached;
}

// Optional helper so UI can clear memory cache quickly
export async function clearTranslationCache() {
  await clearCache?.();
  console.log("[CT:bg] cache cleared");
}
