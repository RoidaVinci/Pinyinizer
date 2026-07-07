// Message router for the service worker.
//
// Protocol (content scripts + UI pages -> background):
//   CT_TRANSLATE_BATCH { texts, opts }  -> { translations }
//   CT_ANNOTATE_BATCH  { texts }        -> { pinyins }
//   CT_GET_SETTINGS                     -> settings object
//   CT_SET_SETTINGS    partial          -> { ok }
//   CT_CLEAR_CACHE                      -> { ok }
//   CT_TEST_PROVIDER   { provider, targetLang } -> { ok, result | error }
//
// Handlers that feed page content own their degraded response (identity:
// original text back), so a failure never breaks a page. The router itself
// stays type-agnostic and answers {ok:false} for anything else that throws.

import { translateBatch, clearTranslationCache } from "./translator/index.js";
import { getSettings, setSettings } from "./storage/settings.js";
import { annotateBatch } from "./annotator/index.js";
import { updateBadge } from "./badge.js";

const HANDLERS = {
  async CT_TRANSLATE_BATCH(payload) {
    const { texts = [], opts = {} } = payload || {};
    try {
      const settings = await getSettings();
      // Kill switch + mode guard: never translate when disabled, and in pinyin
      // mode only explicit requests (English glosses) may pass through.
      if (!settings.enabled) return { translations: texts };
      if (settings.mode === "pinyin" && !opts.allowInPinyin) return { translations: texts };
      return { translations: await translateBatch(texts, { ...settings, ...opts }) };
    } catch (e) {
      console.error("[CT:bg] CT_TRANSLATE_BATCH failed:", e);
      return { translations: texts };
    }
  },

  async CT_ANNOTATE_BATCH(payload) {
    const { texts = [] } = payload || {};
    try {
      const settings = await getSettings();
      if (!settings.enabled) return { pinyins: texts };
      return { pinyins: await annotateBatch(texts, settings) };
    } catch (e) {
      console.error("[CT:bg] CT_ANNOTATE_BATCH failed:", e);
      return { pinyins: texts };
    }
  },

  async CT_GET_SETTINGS() {
    return getSettings();
  },

  async CT_SET_SETTINGS(payload) {
    await setSettings(payload || {});
    updateBadge(await getSettings());
    return { ok: true };
  },

  async CT_CLEAR_CACHE() {
    await clearTranslationCache();
    return { ok: true };
  },

  // Options page "Test" button: one sample sentence through the chosen
  // provider — strict (surface errors) and uncached (leave no junk behind).
  async CT_TEST_PROVIDER(payload) {
    const settings = await getSettings();
    const { provider, targetLang = "es" } = payload || {};
    try {
      const [result] = await translateBatch(["Hello, world! How are you today?"], {
        ...settings,
        provider: provider || settings.provider,
        sourceLang: "en",
        targetLang: targetLang === "en" ? "es" : targetLang,
        strict: true,
        noCache: true,
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return false; // not ours; don't hold the port open

  handler(msg.payload)
    .then(sendResponse)
    .catch((e) => {
      console.error(`[CT:bg] ${msg.type} failed:`, e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    });
  return true; // async response
});
