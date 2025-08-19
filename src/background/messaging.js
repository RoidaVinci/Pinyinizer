import { translateBatch, clearTranslationCache } from "./translator/index.js";
import { getSettings, setSettings } from "./storage/settings.js";
import { annotateBatch } from "./annotator/index.js";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {

    // --- Translate requests (guarded by mode, with override) ---
    if (msg?.type === "CT_TRANSLATE_BATCH") {
      const settings = await getSettings();
      const { texts = [], opts = {} } = msg.payload || {};

      // Block translations in pinyin mode UNLESS the caller explicitly allows it.
      if (settings.mode === "pinyin" && !opts?.allowInPinyin) {
        sendResponse({ translations: texts });
        return;
      }

      try {
        const translations = await translateBatch(texts, { ...settings, ...opts });
        sendResponse({ translations });
      } catch (e) {
        console.error("[CT:bg] TRANSLATE failed:", e);
        sendResponse({ translations: texts });
      }
      return;
    }

    // --- Pinyin annotate requests ---
    if (msg?.type === "CT_ANNOTATE_BATCH") {
      const settings = await getSettings();
      const { texts = [] } = msg.payload || {};
      try {
        const pinyins = await annotateBatch(texts, settings);
        sendResponse({ pinyins });
      } catch (e) {
        console.error("[CT:bg] ANNOTATE failed:", e);
        sendResponse({ pinyins: texts });
      }
      return;
    }

    // --- Settings read ---
    if (msg?.type === "CT_GET_SETTINGS") {
      sendResponse(await getSettings());
      return;
    }

    // --- Settings write ---
    if (msg?.type === "CT_SET_SETTINGS") {
      await setSettings(msg.payload || {});
      try {
        const s = await getSettings();
        chrome.action.setBadgeText({ text: s.mode === "pinyin" ? "PY" : "" });
      } catch {}
      sendResponse({ ok: true });
      return;
    }

    // --- Clear translation cache ---
    if (msg?.type === "CT_CLEAR_CACHE") {
      await clearTranslationCache();
      sendResponse({ ok: true });
      return;
    }

  })();
  return true;
});
