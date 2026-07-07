// Translation orchestrator: cache lookup -> glossary masking -> provider call
// -> unmask -> cache write. Providers are pure functions; everything
// cross-cutting lives here.

import { stableHash } from "../../common/hash.js";
import { getMany, setMany, clearCache } from "../storage/cache.js";
import { applyGlossary, unmaskDNT } from "../glossary.js";
import { PROVIDERS } from "./providers/index.js";

export async function translateBatch(texts, opts) {
  const {
    provider = "google_free",
    targetLang = "es",
    sourceLang = "auto",
    context,
    glossary,
    providerConfig = {},
    cacheSalt = 1,  // bump to invalidate the cache globally
    noCache = false, // one-off requests (e.g. provider test) skip the cache
    strict = false,  // rethrow provider errors instead of identity fallback
  } = opts || {};

  const impl = PROVIDERS[provider];
  if (!impl) throw new Error(`Unknown translation provider: ${provider}`);
  const config = providerConfig[provider] || {};

  // Cache keys include provider + langs so switching either never shows
  // stale results from another combination.
  const normalized = texts.map(s => s ?? "");
  const keys = normalized.map(s => stableHash(`${cacheSalt}|${provider}|${sourceLang}|${targetLang}|${s}`));
  const cached = noCache ? new Array(normalized.length) : await getMany(keys);

  const misses = [];
  const missIdx = [];
  normalized.forEach((s, i) => {
    if (cached[i] == null) { missIdx.push(i); misses.push(s); }
  });
  if (!misses.length) return cached;

  const masked = applyGlossary(misses, glossary);

  let translated;
  try {
    console.debug(`[CT:bg] ${provider}: ${misses.length} texts, ${sourceLang} -> ${targetLang}`, context?.url || "");
    translated = await impl(masked, { sourceLang, targetLang, config, context });
    if (!Array.isArray(translated) || translated.length !== misses.length) {
      throw new Error(`provider returned ${translated?.length} results for ${misses.length} inputs`);
    }
  } catch (e) {
    if (strict) throw e;
    console.error(`[CT:bg] provider ${provider} failed:`, e?.message || e);
    // Identity fallback: leave the page untouched rather than silently
    // switching to a different provider. Not cached, so a later retry works.
    missIdx.forEach((i, j) => { cached[i] = misses[j]; });
    return cached;
  }

  const unmasked = translated.map(unmaskDNT);
  const write = [];
  unmasked.forEach((t, j) => {
    const i = missIdx[j];
    write.push([keys[i], t]);
    cached[i] = t;
  });
  if (write.length && !noCache) await setMany(write);

  return cached;
}

export async function clearTranslationCache() {
  await clearCache();
  console.debug("[CT:bg] cache cleared");
}
