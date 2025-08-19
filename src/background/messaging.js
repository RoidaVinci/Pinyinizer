import { translateBatch, clearTranslationCache } from "./translator/index.js";
import { getSettings, setSettings } from "./storage/settings.js";
import { annotateBatch } from "./annotator/index.js";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {

    // --- Translate requests (guarded by mode, with override) ---
    if (msg?.type === "CT_TRANSLATE_BATCH") {
      const settings = await getSettings();
      const { texts = [], opts = {} } = msg.payload || {};

      // Global kill switch: if disabled, do absolutely nothing.
      if (!settings.enabled) {
        sendResponse({ translations: texts });
        return;      }
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
      // Global kill switch: if disabled, do absolutely nothing.
      if (!settings.enabled) {
         sendResponse({ pinyins: texts });
        return;
      }
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

        // Badge state: OFF when disabled, PY when pinyin mode (and enabled), else empty
        const text = !s.enabled ? "OFF" : (s.mode === "pinyin" ? "PY" : "TR");
        chrome.action.setBadgeText({ text });
        // Optional (harmless if unsupported): subtle badge color cue
        try { chrome.action.setBadgeBackgroundColor?.({ color: !s.enabled ? "#777" : "#0b74e0" }); } catch {}
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
