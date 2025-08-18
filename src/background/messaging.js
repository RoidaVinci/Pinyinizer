import { translateBatch, clearTranslationCache } from "./translator/index.js";
import { pinyinBatch } from "./pinyin.js";
import { getSettings, setSettings } from "./storage/settings.js";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
      if (msg?.type === "CT_TRANSLATE_BATCH") {
        const settings = await getSettings();
        const { texts = [], opts = {} } = msg.payload || {};
        try {
          const translations = await translateBatch(texts, { ...settings, ...opts });
          sendResponse({ translations });
        } catch (e) {
          console.error("[CT:bg] TRANSLATE failed:", e);
          sendResponse({ translations: texts });
        }
        return;
      }
      if (msg?.type === "CT_PINYIN_BATCH") {
        const settings = await getSettings();
        const { texts = [] } = msg.payload || {};
        if (!settings.pinyin) {
          sendResponse({ pinyin: texts });
          return;
        }
        try {
          const pinyin = await pinyinBatch(texts);
          sendResponse({ pinyin });
        } catch (e) {
          console.error("[CT:bg] PINYIN failed:", e);
          sendResponse({ pinyin: texts });
        }
        return;
      }
    if (msg?.type === "CT_GET_SETTINGS") {
      sendResponse(await getSettings()); return;
    }
    if (msg?.type === "CT_SET_SETTINGS") {
      await setSettings(msg.payload || {});
      sendResponse({ ok: true }); return;
    }
    if (msg?.type === "CT_CLEAR_CACHE") {
      await clearTranslationCache();
      sendResponse({ ok: true }); return;
    }
  })();
  return true;
});
